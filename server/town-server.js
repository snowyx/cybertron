// 赛博坦 · 单文件 Node WebSocket 9号星城服务（唯一事实源）
// 依据 design.md §1/§3/§4/§5/§11/§14、.kiro/steering/赛博坦宪章.md。
//
// 设计要点：
//   - 内存 World 是「单一事实源」：所有共享状态只由后端持有与变更，前端只读镜像。
//   - 裸 ws server，监听 0.0.0.0:PORT（默认 9527，与其它项目端口错开）。
//   - 首帧契约：每条连接必须先发 hello → 回 hello_ok{visitorId} + 立即单播全量 world_state。
//   - 上行白名单仅 hello / visitor_ask / ping（宪章 5 的结构性护栏）；未知帧 BAD_PAYLOAD 静默丢弃。
//   - 心跳 tick() 与讨论步进 step() 共用 world.ticking 自旋锁，串行化改写共享状态。
//
// 可测性：tick(world,deps) / step(world,deps) 写成可被测试直接 await 的半纯函数，
// deps 注入生成函数与广播，便于注入假 llm / 假广播。被 import 时不监听、不开心跳。

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createRequestHandler } from './http.js';
import { createWorld } from './world.js';
import { resolveMode, generateEvent, generateSpeech, summarizeResolution } from './behavior.js';
import { ASK_COOLDOWN_MS, TICK_MS, DISCUSS_STEP_MS, ISOLATION_DEMO_TICK, frame, singleSend, broadcast, makeSnapshot, tick, handleVisitorAsk } from './engine.js';
export * from './engine.js';

// ──────────────────────────────────────────────────────────────────────────
// 消息路由
// ──────────────────────────────────────────────────────────────────────────

function routeMessage(ws, raw, world, deps) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return; // BAD_PAYLOAD 静默丢弃
  }
  if (!msg || typeof msg.type !== 'string') return;

  const acked = ws._helloAcked === true;

  if (msg.type === 'hello') {
    ws._helloAcked = true;
    const visitorId = `v${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    ws._visitorId = visitorId;
    singleSend(ws, frame('hello_ok', { visitorId }));
    singleSend(ws, frame('world_state', { snapshot: makeSnapshot(world) }));
    return;
  }

  // hello 之前的业务帧静默忽略（BAD_PAYLOAD）
  if (!acked) return;

  switch (msg.type) {
    case 'ping':
      singleSend(ws, frame('pong', {}));
      break;
    case 'visitor_ask': {
      // 生产护栏：单连接提问冷却，防止游客刷屏拖垮讨论队列
      const now = Date.now();
      if (ws._lastAskAt && now - ws._lastAskAt < ASK_COOLDOWN_MS) {
        singleSend(ws, frame('ask_rejected', { reason: 'RATE_LIMIT', message: '问得太快啦，喘口气再问~' }));
        return;
      }
      ws._lastAskAt = now;
      const question = msg.data && msg.data.question;
      const reply = handleVisitorAsk(world, question, deps);
      if (reply) singleSend(ws, reply);
      break;
    }
    default:
      // 上行白名单外的未知 / 越权帧：BAD_PAYLOAD 静默丢弃，不断连、不改状态（宪章 5）
      break;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 服务启动（仅作为入口直接运行时）
// ──────────────────────────────────────────────────────────────────────────

/**
 * 启动生产服务：同一端口提供 HTTP（静态前端 + /healthz）与 WebSocket 升级。
 * 返回 { httpServer, wss, world, stop, deps }。
 * @param {number|{port?:number, host?:string}} [options] 端口；0 表示系统分配（便于集成测试）。
 */
export function startServer(options = {}) {
  if (typeof options === 'number') options = { port: options }; // 向后兼容 startServer(0)
  const port = options.port ?? (Number(process.env.PORT) || 9527);
  // 安全默认只绑回环；生产 / 容器经 CYBERTRON_HOST=0.0.0.0 放开
  const host = options.host ?? process.env.CYBERTRON_HOST ?? '127.0.0.1';

  const world = createWorld();
  const { mode, llm } = resolveMode(process.env);
  world.mode = mode;
  world.llm = llm;

  const TICK_MS_EFFECTIVE = Number(process.env.CYBERTRON_TICK_MS) || TICK_MS;
  const DISCUSS_STEP_MS_EFFECTIVE = Number(process.env.CYBERTRON_DISCUSS_STEP_MS) || DISCUSS_STEP_MS;
  // 二期：demo 隔离触发 tick 可经 env 调小（仅测试/调试用，缺省走常量，§25）
  world._isolationDemoTick = Number(process.env.CYBERTRON_ISOLATION_DEMO_TICK) || ISOLATION_DEMO_TICK;

  const httpServer = createServer(
    createRequestHandler({
      snapshot: () => ({
        mode: world.mode,
        tick: world.tick,
        phase: world.phase,
        agents: world.agents.size,
      }),
    }),
  );
  const wss = new WebSocketServer({ server: httpServer });

  const deps = {
    mode,
    llm,
    generateEvent,
    generateSpeech,
    summarizeResolution,
    broadcast,
    clients: wss.clients,
    discussStepMs: DISCUSS_STEP_MS_EFFECTIVE,
  };

  wss.on('connection', (ws) => {
    ws._helloAcked = false;
    ws.on('message', (data) => routeMessage(ws, data.toString(), world, deps));
    ws.on('error', () => {
      /* 忽略单连接错误，不中断服务 */
    });
  });

  // 心跳自旋锁调度（§3.2）
  const timer = setInterval(() => {
    if (world.ticking) return;
    world.ticking = true;
    tick(world, deps)
      .catch((err) => console.debug('[tick] error:', err.message))
      .finally(() => {
        world.ticking = false;
      });
  }, TICK_MS_EFFECTIVE);
  if (typeof timer.unref === 'function') timer.unref();

  httpServer.on('listening', () => {
    const addr = httpServer.address();
    const p = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`[town-server] 赛博坦9号星城已启动：http://${host === '0.0.0.0' ? 'localhost' : host}:${p}`);
    console.log(`[town-server] ws:// ${host}:${p} · HTTP 静态托管 + /healthz`);
    console.log(
      `[town-server] 言行轨道：${mode === 'llm' ? '真实模型（检测到 CYBERTRON_LLM_API_KEY）' : '剧本化（无 key，离线稳定）'}`,
    );
  });

  function stop() {
    clearInterval(timer);
    if (world._stepTimer) clearTimeout(world._stepTimer);
    for (const ws of wss.clients) {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
    }
    wss.close();
    httpServer.close();
  }

  httpServer.listen(port, host);

  return { httpServer, wss, world, stop, deps };
}

// 作为入口直接运行时启动监听；被 import（测试）时不启动。
const isEntry = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const thisPath = new URL(import.meta.url).pathname;
    return entry === thisPath || entry.endsWith('town-server.js');
  } catch {
    return false;
  }
})();

if (isEntry) {
  const { stop } = startServer();

  // 优雅停机：先停心跳与讨论步进，再断开连接、关闭 HTTP。
  function shutdown(signal) {
    console.log(`[town-server] 收到 ${signal}，赛博坦星城熄灯中……`);
    try {
      stop();
    } catch (err) {
      console.error('[town-server] 停机异常', err);
    }
    setTimeout(() => process.exit(0), 1500).unref?.();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
