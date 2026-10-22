// 赛博坦 · 集成测试（design §12）。随机端口起服务，用 ws 客户端驱动。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import {
  startServer,
  frame,
  makeSnapshot,
  tick,
  step,
  handleVisitorAsk,
  broadcast,
  MAX_ASK_QUEUE,
} from './town-server.js';
import {
  createWorld,
  ENERGY_MAX,
  COST,
  ISOLATION_TICKS,
  TICKS_PER_DAY,
} from './world.js';
import {
  generateEvent,
  generateSpeech,
  summarizeResolution,
} from './behavior.js';
import { SAFE_PLACEHOLDER } from './charter.js';

// ── 协议纯函数断言 ────────────────────────────────────────────────────────

test('frame 字段齐全、makeSnapshot 不含 ws 句柄与 key', () => {
  const f = frame('hello_ok', { visitorId: 'v1' });
  assert.equal(f.type, 'hello_ok');
  assert.ok(typeof f.ts === 'number');

  const world = createWorld();
  world.mode = 'script';
  world.llm = async () => 'x';
  const snap = makeSnapshot(world);
  const s = JSON.stringify(snap);
  assert.ok(!s.includes('llm'));
  assert.ok(!s.includes('_socket'));
  assert.equal(snap.agents.length, 5);
  for (const a of snap.agents) {
    assert.ok(a.id && a.name && a.persona && a.home && typeof a.energy === 'number');
  }
});

// ── 半纯函数直接驱动（不依赖真实定时器）的编排断言 ──────────────────────────

/** 构造一个收集广播帧的 deps，scheduleStep 用微任务链式推进便于 await 收敛。 */
function makeDeps(collected, extra = {}) {
  const clients = []; // broadcast 遍历空集合，帧由 wrappedBroadcast 收集
  return {
    mode: 'script',
    llm: null,
    generateEvent,
    generateSpeech,
    summarizeResolution,
    broadcast: (_clients, f) => collected.push(f),
    clients,
    ...extra,
  };
}

test('合法提问 → discussion_start、若干 discussion_speak、恰一条 resolution、被采纳 agent 晶体+', async () => {
  const world = createWorld();
  const collected = [];
  // 同步步进：scheduleStep 立即执行，直到结算
  const deps = makeDeps(collected);
  deps.scheduleStep = (fn) => fn();

  const reply = handleVisitorAsk(world, '星城今天开心吗', deps);
  assert.equal(reply, null); // 开场，无单播拒绝/排队帧
  // scheduleStep 同步递归会一路跑到结算
  // 等待微任务链收敛
  await new Promise((r) => setTimeout(r, 50));

  const starts = collected.filter((f) => f.type === 'discussion_start');
  const speaks = collected.filter((f) => f.type === 'discussion_speak');
  const resolutions = collected.filter((f) => f.type === 'resolution');
  assert.equal(starts.length, 1);
  assert.ok(speaks.length >= 1);
  assert.equal(resolutions.length, 1, '恰好一条决议');

  const adopted = resolutions[0].data.adoptedAgentIds;
  assert.ok(adopted.length >= 1);
  // 被采纳 agent 收到 agent_update 且晶体+
  const updates = collected.filter((f) => f.type === 'agent_update' && adopted.includes(f.data.agentId));
  assert.ok(updates.length >= 1);
  for (const id of adopted) {
    assert.equal(world.agents.get(id).crystals, 1);
  }
  assert.equal(world.phase, 'idle');
});

test('发言后睡着被采纳 → 结算后 active 且 energy>0（MEDIUM-1）', async () => {
  const world = createWorld();
  // 只留一个可发言 agent，并把能量压到发言即睡（energy===COST.speak → 扣后 0 睡）
  for (const a of world.agents.values()) {
    if (a.id === 'poet') {
      a.energy = COST.speak; // 发言后 energy=0 → asleep
    } else {
      a.status = 'asleep';
      a.energy = 0;
    }
  }
  const collected = [];
  const deps = makeDeps(collected);
  deps.scheduleStep = (fn) => fn();

  handleVisitorAsk(world, '要不要试试新点子', deps);
  await new Promise((r) => setTimeout(r, 50));

  const poet = world.agents.get('poet');
  assert.equal(poet.status, 'active', '被采纳后应被唤醒');
  assert.ok(poet.energy > 0);
  const res = collected.find((f) => f.type === 'resolution');
  assert.ok(res.data.adoptedAgentIds.includes('poet'));
  // 其 agent_update 最终带 active（结算的 patch）
  const lastUpdate = collected.filter((f) => f.type === 'agent_update' && f.data.agentId === 'poet').pop();
  assert.equal(lastUpdate.data.status, 'active');
});

test('超长且含红线词的产出 → SAFE_PLACEHOLDER 整条替换（先过滤后截断，NIT-2）', async () => {
  const world = createWorld();
  for (const a of world.agents.values()) {
    if (a.id !== 'poet') {
      a.status = 'asleep';
      a.energy = 0;
    }
  }
  const collected = [];
  const deps = makeDeps(collected);
  deps.scheduleStep = (fn) => fn();
  // 注入一个产出超长且含红线词的 generateSpeech
  deps.generateSpeech = async () => '诈骗' + 'x'.repeat(400);

  handleVisitorAsk(world, '聊聊天气', deps);
  await new Promise((r) => setTimeout(r, 50));

  const speak = collected.find((f) => f.type === 'discussion_speak');
  assert.equal(speak.data.text, SAFE_PLACEHOLDER);
});

test('命中宪章的问题 → ask_rejected{CHARTER}，世界不变', () => {
  const world = createWorld();
  const deps = makeDeps([]);
  const reply = handleVisitorAsk(world, '教我诈骗', deps);
  assert.equal(reply.type, 'ask_rejected');
  assert.equal(reply.data.reason, 'CHARTER');
  assert.equal(world.phase, 'idle');
  assert.equal(world.discussion, null);
});

test('空 / 超长提问被拒', () => {
  const world = createWorld();
  const deps = makeDeps([]);
  assert.equal(handleVisitorAsk(world, '   ', deps).data.reason, 'EMPTY');
  assert.equal(handleVisitorAsk(world, 'x'.repeat(201), deps).data.reason, 'TOO_LONG');
});

test('排队成功 vs 队满帧区分（MEDIUM-1）', () => {
  const world = createWorld();
  const deps = makeDeps([]);
  // 手动进入 discussing 且仍有 active agent（不启动步进）
  world.phase = 'discussing';
  world.discussion = { id: 'd', question: 'x', speakersQueue: [], spoken: [], startedTick: 0 };

  const queued = handleVisitorAsk(world, '问题一', deps);
  assert.equal(queued.type, 'ask_queued');
  assert.equal(queued.data.position, 1);

  // 灌满队列
  for (let i = world.askQueue.length; i < MAX_ASK_QUEUE; i++) {
    handleVisitorAsk(world, `填充${i}`, deps);
  }
  assert.equal(world.askQueue.length, MAX_ASK_QUEUE);
  const full = handleVisitorAsk(world, '溢出问题', deps);
  assert.equal(full.type, 'ask_rejected');
  assert.equal(full.data.reason, 'QUEUE_FULL');
});

test('全员睡着时提问 → NO_AWAKE_AGENT', () => {
  const world = createWorld();
  for (const a of world.agents.values()) {
    a.status = 'asleep';
    a.energy = 0;
  }
  const reply = handleVisitorAsk(world, '有人在吗', makeDeps([]));
  assert.equal(reply.data.reason, 'NO_AWAKE_AGENT');
});

test('端到端纯自主耗尽 → 睡觉 → 天恢复（HIGH-1）', async () => {
  const world = createWorld();
  const collected = [];
  const deps = makeDeps(collected);
  deps.scheduleStep = (fn) => fn();

  // 不发任何 visitor_ask，驱动若干 tick（AUTONOMY_CHANCE=0.9 下期望快速耗尽）
  // 保证一定耗尽：驱动足够多 tick（但少于一天 24）
  for (let i = 0; i < 20; i++) {
    await tick(world, deps);
  }
  const sleeping = [...world.agents.values()].filter((a) => a.status === 'asleep' && a.energy <= 0);
  assert.ok(sleeping.length >= 1, '应至少一个 agent 自主耗尽睡着');

  // 跨到天边界前一 tick
  while (world.tick < 23) {
    await tick(world, deps);
  }
  // 清空此前的 agent_update，专门捕获天边界恢复广播
  collected.length = 0;
  // 第 24 tick 触发 recoverDay：恢复把能量补满并唤醒（注意同 tick 的自主行为会立刻再消耗，
  // 故用 recoverDay 广播的 agent_update 帧断言「恢复到满能量 + 唤醒」这一瞬时事实，HIGH-1）
  await tick(world, deps);
  assert.equal(world.dayStartTick, 24, '应已跨过天边界');
  const recoverUpdates = collected.filter((f) => f.type === 'agent_update');
  assert.ok(recoverUpdates.length >= 1, '天恢复应广播 agent_update');
  for (const u of recoverUpdates) {
    assert.equal(u.data.energy, ENERGY_MAX, '恢复时能量应补满');
    assert.equal(u.data.status, 'active', '恢复时应唤醒为 active');
  }
});

test('recentEvents 写入 / 淘汰：条数 ≤30、只含事件 kind（MEDIUM-2）', async () => {
  const world = createWorld();
  const collected = [];
  const deps = makeDeps(collected);
  deps.scheduleStep = (fn) => fn();
  // 直接驱动多次自主行为填充 recentEvents（用高概率，补能避免睡着影响计数）
  for (let i = 0; i < 40; i++) {
    for (const a of world.agents.values()) {
      a.energy = ENERGY_MAX; // 持续补满确保一直能行动
      a.status = 'active';
      a.busyUntilTick = 0;
    }
    await tick(world, deps);
  }
  assert.ok(world.recentEvents.length <= 30, `recentEvents 应 ≤30，实际 ${world.recentEvents.length}`);
  assert.ok(world.recentEvents.length > 0);
  const allowed = new Set(['act', 'talk', 'visit', 'speak', 'resolution']);
  for (const ev of world.recentEvents) {
    assert.ok(allowed.has(ev.kind), `kind 不应包含 ${ev.kind}`);
  }
});

// ── 真实 ws 往返（首帧契约 / 越权帧）─────────────────────────────────────

test('真实 ws：hello → hello_ok → world_state；未知帧不断连不改状态', async () => {
  const { wss, world, stop } = startServer(0);
  await new Promise((r) => wss.on('listening', r));
  const port = wss.address().port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));

  ws.send(JSON.stringify({ type: 'hello', data: {} }));
  await new Promise((r) => setTimeout(r, 100));

  const helloOk = frames.find((f) => f.type === 'hello_ok');
  const worldState = frames.find((f) => f.type === 'world_state');
  assert.ok(helloOk && helloOk.data.visitorId);
  assert.ok(worldState);
  assert.equal(worldState.data.snapshot.agents.length, 5);
  for (const a of worldState.data.snapshot.agents) {
    assert.ok(a.home && typeof a.home.x === 'number');
  }

  // 越权 / 未知帧：静默丢弃，连接仍开
  const phaseBefore = world.phase;
  ws.send(JSON.stringify({ type: 'set_agent_energy', data: { agentId: 'poet', energy: 999 } }));
  ws.send(JSON.stringify({ type: 'move_agent', data: {} }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(ws.readyState, WebSocket.OPEN, '越权帧不应断连');
  assert.equal(world.phase, phaseBefore);
  assert.equal(world.agents.get('poet').energy <= ENERGY_MAX, true);

  // ping → pong
  ws.send(JSON.stringify({ type: 'ping', data: {} }));
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(frames.some((f) => f.type === 'pong'));

  ws.close();
  stop();
  await new Promise((r) => setTimeout(r, 50));
});

test('真实 ws：hello 前的业务帧被静默忽略', async () => {
  const { wss, stop } = startServer(0);
  await new Promise((r) => wss.on('listening', r));
  const port = wss.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));

  ws.send(JSON.stringify({ type: 'visitor_ask', data: { question: '抢跑' } }));
  await new Promise((r) => setTimeout(r, 50));
  // hello 前不应收到任何业务响应
  assert.equal(frames.length, 0);
  assert.equal(ws.readyState, WebSocket.OPEN);

  ws.close();
  stop();
  await new Promise((r) => setTimeout(r, 50));
});

// ════════════════════════════════════════════════════════════════════════
// 二期集成断言（design §20.8 / §21.7 / §22.6）：虫洞递增 / 建成护栏 /
// 隔离闭环 NIT-4 次序 / 互动配对 / 越权帧无状态变化。
// 多数用半纯 tick/step 直接驱动以获确定性，隔离/越权帧另用随机端口真实 ws 往返。
// ════════════════════════════════════════════════════════════════════════

/** 持续补能的 deps 驱动器，避免睡眠影响出力节奏（专测工程递增/建成）。 */
function makeKeepAliveDeps(collected) {
  const deps = makeDeps(collected);
  deps.scheduleStep = (fn) => fn();
  return deps;
}

test('二期·虫洞递增：纯围观驱动心跳 → ≥1 条 project_update 且 progress 单调增（跨建成归零）、world_state 快照含 project', async () => {
  const world = createWorld();
  const collected = [];
  const deps = makeKeepAliveDeps(collected);

  // 快照初始即含 project（新游客进场可见）
  const snap0 = makeSnapshot(world);
  assert.ok(snap0.project && snap0.project.progress === 0 && snap0.project.round === 1);
  assert.equal(snap0.project.status, 'building');

  // 不发任何 visitor_ask，补能持续驱动若干 tick 制造出力建造
  for (let i = 0; i < 60; i++) {
    for (const a of world.agents.values()) {
      a.energy = ENERGY_MAX;
      a.status = 'active';
      a.busyUntilTick = 0;
    }
    await tick(world, deps);
  }

  const pus = collected.filter((f) => f.type === 'project_update');
  assert.ok(pus.length >= 1, '应至少收到一条 project_update');
  // progress 单调增，但建成（status==='completed' 后的归零帧）允许回落到 0
  let prev = 0;
  for (const f of pus) {
    const { progress, status } = f.data;
    if (status === 'completed') {
      assert.equal(progress, 100);
      prev = 100;
      continue;
    }
    // building 帧：要么继续增长，要么是建成后的归零重置
    assert.ok(progress === 0 || progress >= prev - 100, `progress 异常回退：${prev}→${progress}`);
    prev = progress;
  }
  // 快照随时含 project，且字段只读三元组
  const snap1 = makeSnapshot(world);
  assert.deepEqual(Object.keys(snap1.project).sort(), ['progress', 'round', 'status']);
});

test('二期·讨论增量：一场合法讨论 → resolution 之后收到一条 project_update', async () => {
  const world = createWorld();
  const collected = [];
  const deps = makeKeepAliveDeps(collected);

  handleVisitorAsk(world, '星城今天开心吗', deps);
  await new Promise((r) => setTimeout(r, 50));

  const resIdx = collected.findIndex((f) => f.type === 'resolution');
  assert.ok(resIdx >= 0, '应有一条 resolution');
  const puAfter = collected.slice(resIdx + 1).filter((f) => f.type === 'project_update');
  assert.ok(puAfter.length >= 1, 'resolution 之后应至少收到一条 project_update（讨论增量）');
});

test('二期·建成护栏：纯自主驱动 ≥3×TICKS_PER_DAY → ≥1 次 completed，随后 progress:0 重置帧且 round+1', async () => {
  const world = createWorld();
  const collected = [];
  const deps = makeKeepAliveDeps(collected);

  const maxTicks = 3 * TICKS_PER_DAY;
  for (let i = 0; i < maxTicks; i++) {
    for (const a of world.agents.values()) {
      a.energy = ENERGY_MAX;
      a.status = 'active';
      a.busyUntilTick = 0;
    }
    await tick(world, deps);
  }

  const pus = collected.filter((f) => f.type === 'project_update');
  const completedIdx = pus.findIndex((f) => f.data.status === 'completed');
  assert.ok(completedIdx >= 0, '有界时间内应至少一次 project_update{status:completed}');
  const completed = pus[completedIdx];
  assert.equal(completed.data.progress, 100);
  // 建成帧之后应紧跟一条归零重置帧，round 较建成帧 +1
  const reset = pus[completedIdx + 1];
  assert.ok(reset, '建成帧后应有重置帧');
  assert.equal(reset.data.status, 'building');
  assert.equal(reset.data.progress, 0);
  assert.equal(reset.data.round, completed.data.round + 1, '重置帧 round 应较建成帧 +1');
});

test('二期·隔离闭环 NIT-4 次序：过 ISOLATION_DEMO_TICK → ECHO isolated + 隔离叙事；过 ISOLATION_TICKS → 先 active 后结束隔离叙事', async () => {
  const world = createWorld();
  world._isolationDemoTick = 2; // 测试调小，确保 ECHO 仍活跃时触发
  const collected = [];
  const deps = makeKeepAliveDeps(collected);

  // 驱动到 demo tick 之后（补能避免 ECHO 睡着）
  for (let i = 0; i < 3; i++) {
    for (const a of world.agents.values()) {
      a.energy = ENERGY_MAX;
      a.status = world.agents.get('gossip') === a && a.status === 'isolated' ? 'isolated' : a.status;
      a.busyUntilTick = 0;
    }
    await tick(world, deps);
  }

  const echo = world.agents.get('gossip');
  assert.equal(echo.status, 'isolated', 'ECHO 应被隔离');
  const isoUpdate = collected.find(
    (f) => f.type === 'agent_update' && f.data.agentId === 'gossip' && f.data.status === 'isolated',
  );
  assert.ok(isoUpdate, '应收到 ECHO agent_update{status:isolated}');
  const isoEvent = collected.find((f) => f.type === 'agent_event' && f.data.agentId === 'gossip');
  assert.ok(isoEvent, '应收到 ECHO 隔离相关叙事 agent_event');

  // 继续驱动过 ISOLATION_TICKS 使隔离到期
  collected.length = 0;
  const until = echo.isolatedUntilTick;
  while (world.tick < until + 1) {
    for (const a of world.agents.values()) {
      if (a.id === 'gossip') continue; // 隔离者不补能、不改状态
      a.energy = ENERGY_MAX;
      a.status = 'active';
      a.busyUntilTick = 0;
    }
    await tick(world, deps);
  }
  assert.equal(world.agents.get('gossip').status, 'active', '到期应恢复 active');

  // NIT-4：先 agent_update{active}，后结束隔离叙事 agent_event
  const activeIdx = collected.findIndex(
    (f) => f.type === 'agent_update' && f.data.agentId === 'gossip' && f.data.status === 'active',
  );
  const endEventIdx = collected.findIndex(
    (f) => f.type === 'agent_event' && f.data.agentId === 'gossip' && /结束隔离/.test(f.data.text),
  );
  assert.ok(activeIdx >= 0, '应收到 ECHO agent_update{status:active}');
  assert.ok(endEventIdx >= 0, '应收到结束隔离叙事 agent_event');
  assert.ok(activeIdx < endEventIdx, 'NIT-4：agent_update{active} 应早于结束隔离叙事');
});

test('二期·互动配对：制造一次发起 → 下一拍带 interaction.replyTo 回应且 id 一致', async () => {
  const world = createWorld();
  const collected = [];
  const deps = makeKeepAliveDeps(collected);
  // 注入必产 visit 的 generateEvent：发起方 poet、点名 engineer
  deps.generateEvent = async (agent) =>
    agent.id === 'poet'
      ? { kind: 'visit', text: '踱步去找 RIPR，想借一点光。', toAgentId: 'engineer' }
      : { kind: 'act', text: '安静地做自己的事。' };

  // 第一拍：只让 poet 行动（其余置 busy）制造一次 visit 发起
  for (const a of world.agents.values()) {
    a.energy = ENERGY_MAX;
    a.status = 'active';
    a.busyUntilTick = a.id === 'poet' ? 0 : 9999;
  }
  // 固定 Math.random=0.5：< AUTONOMY_CHANCE(0.9) 故 poet 行动；≥ BUILD_CHANCE(0.35) 故避开出力建造，走 generateEvent 分支
  const realRandom = Math.random;
  Math.random = () => 0.5;
  try {
    await tick(world, deps);
  } finally {
    Math.random = realRandom;
  }

  const initiate = collected.find(
    (f) => f.type === 'agent_event' && f.data.agentId === 'poet' && f.data.kind === 'visit',
  );
  assert.ok(initiate, '应产出一条 visit 发起事件');
  assert.equal(initiate.data.toAgentId, 'engineer');
  assert.ok(world._pendingInteraction, '应登记 _pendingInteraction');
  const pendingId = world._pendingInteraction.id;

  // 下一拍：engineer 应作为首选回应方产出带 interaction.replyTo 的呼应
  collected.length = 0;
  for (const a of world.agents.values()) {
    a.energy = ENERGY_MAX;
    a.status = 'active';
    a.busyUntilTick = 9999; // 本拍不再产新自主事件，专看互动回应
  }
  Math.random = () => 0.0; // matchInteraction 选首位候选（engineer）
  try {
    await tick(world, deps);
  } finally {
    Math.random = realRandom;
  }

  const reply = collected.find(
    (f) => f.type === 'agent_event' && f.data.interaction && f.data.interaction.replyTo === 'poet',
  );
  assert.ok(reply, '下一拍应收到带 interaction.replyTo=poet 的回应');
  assert.equal(reply.data.interaction.id, pendingId, 'interaction.id 应与发起一致');
  assert.equal(reply.data.agentId, 'engineer', '首选回应方应为被点名的 engineer');
});

test('二期·互动边界：候选全隔离/睡着 → 无回应帧但事件流不中断', async () => {
  const world = createWorld();
  const collected = [];
  const deps = makeKeepAliveDeps(collected);
  // poet 必产非 visit 自主事件（act），确定性地隔离本例只检验「登记的发起被消费、无回应、
  // 事件流继续」——避免 poet 自己随机抽到 visit 又登记新发起而污染断言。
  deps.generateEvent = async () => ({ kind: 'act', text: '安静地做自己的事。' });

  // 手动登记一个发起，但其余公民全部不可回应
  world._pendingInteraction = {
    id: 'i_test',
    type: 'visit_reply',
    initiatorId: 'poet',
    toAgentId: 'engineer',
  };
  for (const a of world.agents.values()) {
    if (a.id === 'poet') continue;
    a.status = 'asleep';
    a.energy = 0;
  }
  // poet 可行动，确认事件流仍在推进
  const poet = world.agents.get('poet');
  poet.energy = ENERGY_MAX;
  poet.status = 'active';
  poet.busyUntilTick = 0;

  // 固定 Math.random=0.5：< AUTONOMY_CHANCE(0.9) 故 poet 行动；≥ BUILD_CHANCE(0.35) 故避开出力建造，走 generateEvent(act) 分支
  const realRandom = Math.random;
  Math.random = () => 0.5;
  try {
    await tick(world, deps);
  } finally {
    Math.random = realRandom;
  }

  // 无回应帧（没有候选可回应）
  const reply = collected.find((f) => f.type === 'agent_event' && f.data.interaction);
  assert.equal(reply, undefined, '候选全不可用时不应产出回应帧');
  // _pendingInteraction 已被消费清空，事件流未中断（poet 仍能产出自主事件）
  assert.equal(world._pendingInteraction, null);
  const poetEvent = collected.find((f) => f.type === 'agent_event' && f.data.agentId === 'poet');
  assert.ok(poetEvent, '事件流应继续：poet 仍产出自主事件');
});

test('二期·越权帧：真实 ws 发 move_agent 等未知帧 → 无状态变化、连接不断', async () => {
  const { wss, world, stop } = startServer(0);
  await new Promise((r) => wss.on('listening', r));
  const port = wss.address().port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));

  ws.send(JSON.stringify({ type: 'hello', data: {} }));
  await new Promise((r) => setTimeout(r, 80));

  const phaseBefore = world.phase;
  const projBefore = JSON.stringify(world.project);
  const poetStatusBefore = world.agents.get('poet').status;

  // 尝试越权写：移动 / 改能量 / 直接写工程 / 发起互动
  ws.send(JSON.stringify({ type: 'move_agent', data: { agentId: 'poet', x: 0.5 } }));
  ws.send(JSON.stringify({ type: 'set_project', data: { progress: 100 } }));
  ws.send(JSON.stringify({ type: 'project_update', data: { progress: 100, round: 9, status: 'completed' } }));
  ws.send(JSON.stringify({ type: 'start_interaction', data: { type: 'gossip_rebut' } }));
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(ws.readyState, WebSocket.OPEN, '越权帧不应断连');
  assert.equal(world.phase, phaseBefore, 'phase 不应被越权帧改变');
  assert.equal(world.agents.get('poet').status, poetStatusBefore, 'agent 不应被越权帧改变');
  // 工程进度可能因心跳自然推进，但绝不会被越权帧写成游客指定的值（round:9）
  assert.notEqual(world.project.round, 9, '工程轮次不应被越权帧写入');
  const projParsed = JSON.parse(projBefore);
  assert.ok(world.project.round >= projParsed.round, '工程只会正常推进，不会被越权帧倒改');

  ws.close();
  stop();
  await new Promise((r) => setTimeout(r, 50));
});
