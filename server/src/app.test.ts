import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from './app.js';
import { WorldRepository } from './persistence.js';
import { WorldRuntime } from './runtime.js';

test('Fastify serves real assets, 404s missing assets, and rejects malformed paths', async (t) => {
  const { app } = await createApp({ dataPath: null, tickMs: 100000 });
  t.after(() => app.close());
  assert.equal((await app.inject('/healthz')).json().ok, true);
  assert.equal((await app.inject('/api/world')).json().agents.length, 5);
  assert.equal((await app.inject('/assets/not-a-file.js')).statusCode, 404);
  const malformed = await app.inject('/%E0%A4%A');
  assert.ok(malformed.statusCode >= 400);
  assert.equal((await app.inject('/api/missing')).statusCode, 404);
});

test('WebSocket requires handshake, refuses mutations, acknowledges discussion, and rate limits reconnects by IP', async (t) => {
  const { app, runtime } = await createApp({ dataPath: null, tickMs: 100000, stepMs: 10 });
  t.after(() => app.close());
  await app.ready();
  const ws = await app.injectWS('/ws');
  const messages: any[] = [];
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  t.after(() => ws.terminate());
  ws.send(JSON.stringify({ type: 'visitor_ask', data: { question: '测试' } }));
  ws.send(JSON.stringify({ type: 'hello', data: {} }));
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(messages[0].type, 'hello_ok');
  assert.equal(messages[1].type, 'world_state');
  ws.send(JSON.stringify({ type: 'set_agent_energy', data: { energy: 999 } }));
  const resolution = new Promise<void>((resolve) =>
    ws.on('message', (d) => {
      if (JSON.parse(d.toString()).type === 'resolution') resolve();
    }),
  );
  ws.send(JSON.stringify({ type: 'visitor_ask', data: { question: '如何共同探索未知？' } }));
  await resolution;
  assert.ok(messages.some((m) => m.type === 'ask_accepted'));
  assert.equal(messages.filter((m) => m.type === 'resolution').length, 1);
  assert.ok(
    messages.some((m) => m.type === 'world_tick' && m.data.snapshot.dayProgress !== undefined),
  );
  assert.ok([...runtime.world.agents.values()].every((a) => a.energy <= a.energyMax));
  ws.send(JSON.stringify({ type: 'visitor_ask', data: { question: '再次提交' } }));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(messages.some((m) => m.type === 'ask_rejected' && m.data.reason === 'RATE_LIMIT'));
});

test('WebSocket rejects cross-origin requests', async (t) => {
  const { app } = await createApp({ dataPath: null, tickMs: 100000 });
  t.after(() => app.close());
  await app.ready();
  const ws = await app.injectWS('/ws', {
    headers: { host: 'localhost', origin: 'https://unrelated.example' },
  });
  const closed = once(ws, 'close');
  ws.resume();
  const [code] = await closed;
  assert.equal(code, 1008);
});

test('Persistent snapshot survives restart without leaking credentials or in-flight timers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cybertron-'));
  const path = join(dir, 'world.json');
  try {
    const first = new WorldRuntime(new WorldRepository(path), 100000);
    await first.start();
    first.world.tick = 8;
    first.world.agents.get('poet')!.crystals = 9;
    first.world.project.progress = 42;
    await first.stop();
    const raw = await readFile(path, 'utf8');
    assert.ok(!raw.includes('API_KEY'));
    assert.ok(!raw.includes('_stepTimer'));
    const second = new WorldRuntime(new WorldRepository(path), 100000);
    await second.start();
    assert.equal(second.world.tick, 8);
    assert.equal(second.world.agents.get('poet')!.crystals, 9);
    assert.equal(second.world.project.progress, 42);
    await second.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
