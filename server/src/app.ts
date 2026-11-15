import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ClientMessage } from '../../shared/protocol.js';
import { frame } from '../engine.js';
import { WorldRuntime } from './runtime.js';
import { WorldRepository } from './persistence.js';

export interface AppOptions {
  dataPath?: string | null;
  webRoot?: string;
  logger?: boolean;
  tickMs?: number;
  stepMs?: number;
}
export async function createApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 8192,
    forceCloseConnections: true,
  });
  const runtime = new WorldRuntime(
    new WorldRepository(
      options.dataPath === undefined ? resolve('data/world.json') : options.dataPath,
    ),
    options.tickMs ?? 3000,
    options.stepMs ?? 1500,
  );
  await runtime.start();
  await app.register(websocket, {
    options: { maxPayload: 8192 },
    preClose: function (done) {
      for (const client of this.websocketServer.clients) client.terminate();
      this.websocketServer.close(done);
    },
  });
  const limits = new Map<string, { until: number; count: number }>();
  const connections = new Set<() => void>();
  const cleanup = setInterval(() => {
    for (const [ip, l] of limits) if (l.until < Date.now()) limits.delete(ip);
  }, 60000);
  cleanup.unref();
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    return payload;
  });
  app.get('/healthz', async () => ({
    ok: true,
    version: '0.3.0',
    uptime: process.uptime(),
    tick: runtime.world.tick,
    agents: runtime.world.agents.size,
    mode: runtime.world.mode,
  }));
  app.get('/api/world', async () => runtime.snapshot());
  app.get('/ws', { websocket: true }, (socket, request) => {
    const origin = request.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== request.headers.host) {
          socket.close(1008, 'Origin mismatch');
          return;
        }
      } catch {
        socket.close(1008, 'Invalid origin');
        return;
      }
    }
    let ready = false;
    let lastAsk = 0;
    let alive = true;
    const send = (f: unknown) => {
      if (socket.readyState === 1) {
        if (socket.bufferedAmount > 1024 * 1024) {
          socket.close(1013, 'Slow consumer');
          return;
        }
        socket.send(JSON.stringify(f));
      }
    };
    const listener = (f: unknown) => {
      if (ready) send(f);
    };
    runtime.listeners.add(listener);
    const handshake = setTimeout(() => {
      if (!ready) socket.close(1008, 'Handshake timeout');
    }, 10000);
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 30000);
    const release = () => {
      clearTimeout(handshake);
      clearInterval(heartbeat);
      runtime.listeners.delete(listener);
    };
    const shutdown = () => {
      release();
      socket.terminate();
    };
    connections.add(shutdown);
    socket.on('pong', () => {
      alive = true;
    });
    socket.on('message', async (raw) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const result = ClientMessage.safeParse(json);
      if (!result.success) {
        if (ready && (json as { type?: string })?.type === 'visitor_ask')
          send(frame('ask_rejected', { reason: 'INVALID', message: '请输入 1–200 字的问题。' }));
        return;
      }
      const m = result.data;
      if (m.type === 'hello') {
        if (ready) return;
        ready = true;
        clearTimeout(handshake);
        send(frame('hello_ok', { visitorId: randomUUID() }));
        send(frame('world_state', { snapshot: runtime.snapshot() }));
        return;
      }
      if (!ready) return;
      if (m.type === 'ping') {
        send(frame('pong', {}));
        return;
      }
      const now = Date.now();
      let limit = limits.get(request.ip);
      if (!limit || limit.until < now) limit = { until: now + 60000, count: 0 };
      if (now - lastAsk < 3000 || limit.count >= 10) {
        send(
          frame('ask_rejected', { reason: 'RATE_LIMIT', message: '广播过于频繁，请稍后再试。' }),
        );
        return;
      }
      lastAsk = now;
      limit.count++;
      limits.set(request.ip, limit);
      try {
        const reply = await runtime.ask(m.data.question);
        send(reply ?? frame('ask_accepted', { message: '问题已广播，公民正在讨论。' }));
      } catch (e) {
        app.log.error(e);
        send(frame('ask_rejected', { reason: 'SERVICE', message: '广播暂时失败，请稍后重试。' }));
      }
    });
    socket.on('error', (e) => app.log.warn(e));
    socket.on('close', () => {
      release();
      connections.delete(shutdown);
    });
  });
  await app.register(staticFiles, {
    root: options.webRoot ?? resolve('dist'),
    wildcard: false,
    maxAge: 0,
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.includes('.'))
      return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Not found' });
  });
  app.addHook('onClose', async () => {
    clearInterval(cleanup);
    await runtime.stop();
  });
  app.addHook('preClose', async () => {
    for (const close of connections) close();
    connections.clear();
  });
  return { app, runtime };
}
