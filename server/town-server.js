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

import { WebSocketServer, WebSocket } from 'ws';
import {
  createWorld,
  applyCost,
  reward,
  recoverDay,
  advanceProject,
  enterIsolation,
  tickIsolation,
  tickSleep,
  COST,
  ADOPTED_COUNT,
  TICKS_PER_DAY,
  SLEEP_TICKS,
  RECENT_EVENTS_MAX,
  BUILD_DELTA_AUTONOMY,
  BUILD_DELTA_RESOLUTION,
} from './world.js';
import { charterCheck, SAFE_PLACEHOLDER } from './charter.js';
import {
  generateEvent,
  generateSpeech,
  summarizeResolution,
  renderBuildLine,
  matchInteraction,
  INTERACTIONS,
  resolveMode,
} from './behavior.js';

// ──────────────────────────────────────────────────────────────────────────
// 调度常量（锁定默认值，env 可覆盖见 *_EFFECTIVE，design §3.2 / §14）
// ──────────────────────────────────────────────────────────────────────────

export const TICK_MS = 3000; // 心跳间隔默认值
export const DISCUSS_STEP_MS = 1500; // 讨论出字步进间隔默认值（与心跳解耦）
export const AUTONOMY_CHANCE = 0.9; // 每 tick 每个合格 agent 自发行为概率
export const BEHAVIOR_COOLDOWN_TICKS = 1; // 自发行为后冷却 tick 数
export const MAX_SPEAKERS = 5; // 一场讨论最多发言人数
export const MAX_ASK_QUEUE = 5; // 讨论进行中提问排队上限
export const MAX_TEXT = 280; // 单条产出文本推送前截断长度
export const VISIT_REPLY_CHANCE = 0.6; // 被点名 agent 回应串门的概率

// ──────────────────────────────────────────────────────────────────────────
// 二期：虫洞出力分流 + demo 隔离触发常量（design §20.2 / §21.2 / §25）
// ──────────────────────────────────────────────────────────────────────────

export const BUILD_CHANCE = 0.35; // 自主行为命中「出力建造」分支的概率（§20.2）
export const ISOLATION_DEMO_TICK = 18; // 剧本轨「使坏→隔离」的触发周期 tick 数（§21.2）：每隔这么多 tick、ECHO 不在隔离中就再触发一次，使任何时候连上的观众都能看到完整隔离闭环；env CYBERTRON_ISOLATION_DEMO_TICK 可调小

// ──────────────────────────────────────────────────────────────────────────
// 协议工具（信封 / 发送 / 广播 / 快照）
// ──────────────────────────────────────────────────────────────────────────

/** 统一 JSON 帧信封：{type,data,ts}。 */
export function frame(type, data) {
  return { type, data, ts: Date.now() };
}

/** 对一条连接单播一帧。 */
export function singleSend(ws, f) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(f));
  }
}

/** 对全体在线连接广播一帧。clients 为 ws 连接集合（Set 或 wss.clients）。 */
export function broadcast(clients, f) {
  const payload = JSON.stringify(f);
  for (const ws of clients) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

/**
 * 构造 world_state 快照（design §4.4）。绝不外泄 ws 句柄 / 任何 key。
 * recentEvents 取浅拷贝，不外泄内部数组引用。
 */
export function makeSnapshot(world) {
  const agents = [];
  for (const a of world.agents.values()) {
    agents.push({
      id: a.id,
      name: a.name,
      persona: a.persona,
      status: a.status,
      energy: a.energy,
      energyMax: a.energyMax,
      crystals: a.crystals,
      home: { x: a.home.x, y: a.home.y },
    });
  }
  return {
    tick: world.tick,
    dayProgress: ((world.tick - world.dayStartTick) % TICKS_PER_DAY) / TICKS_PER_DAY,
    phase: world.phase,
    mode: world.mode,
    agents,
    recentEvents: world.recentEvents.slice(),
    // 二期：只读工程快照，新游客进场即见当前进度/轮次（§24.2 / §20.4）
    project: {
      progress: world.project.progress,
      round: world.project.round,
      status: world.project.status,
    },
  };
}

/**
 * recentEvents 环形缓冲的唯一写入点（design §4.4）。FIFO，超 RECENT_EVENTS_MAX 丢最旧。
 * 只在广播 agent_event / discussion_speak / resolution 的同一步调用。
 */
export function pushRecent(world, ev) {
  world.recentEvents.push({
    agentId: ev.agentId ?? null,
    name: ev.name ?? null,
    kind: ev.kind,
    text: ev.text,
    ts: ev.ts ?? Date.now(),
  });
  while (world.recentEvents.length > RECENT_EVENTS_MAX) {
    world.recentEvents.shift();
  }
}

/** 推送前固定次序处理：先宪章过滤（命中整条换占位），后按 MAX_TEXT 截断（NIT-2）。 */
function sanitizeOutput(text) {
  const check = charterCheck(text);
  if (!check.ok) return SAFE_PLACEHOLDER;
  const s = String(text);
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
}

/**
 * 推送前处理 + 宪章命中标记。返回 {text, charterHit}：命中则 text 为占位（越界原文不外泄），
 * 供调用方据 charterHit 触发隔离（§21.2 触发点 1）。
 */
function sanitizeWithCheck(text) {
  const check = charterCheck(text);
  if (!check.ok) return { text: SAFE_PLACEHOLDER, charterHit: true };
  const s = String(text);
  return { text: s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s, charterHit: false };
}

/**
 * 隔离触发点（§21.2 触发点 1）：产出命中宪章时，在已写回 applyCost 结果（可能 asleep）之后，
 * 调 enterIsolation 覆写 status='isolated'/isolatedUntilTick（isolated 优先于 asleep），
 * 广播 agent_update{status:'isolated'} + 隔离安全叙事 agent_event（越界原文已换占位、不外泄）。
 */
function triggerIsolation(world, agent, deps) {
  const iso = enterIsolation(agent, world.tick);
  agent.status = iso.status;
  agent.isolatedUntilTick = iso.isolatedUntilTick;
  deps.broadcast(deps.clients, frame('agent_update', patchFields(agent)));
  const text = sanitizeOutput(`${agent.name} 的言论越过了赛博坦宪章，被暂时请进隔离舱冷静一下。`);
  const ts = Date.now();
  deps.broadcast(
    deps.clients,
    frame('agent_event', { agentId: agent.id, name: agent.name, persona: agent.persona, kind: 'talk', text }),
  );
  pushRecent(world, { agentId: agent.id, name: agent.name, kind: 'talk', text, ts });
}

// ──────────────────────────────────────────────────────────────────────────
// 心跳 tick（半纯：可被测试直接 await；deps 注入生成函数与广播）
// ──────────────────────────────────────────────────────────────────────────

/**
 * 推进世界一个心跳。顺序：tick+1 → 天边界 → 讨论期只做天边界 → idle 自主行为。
 * @param {World} world
 * @param {object} deps { mode, llm, generateEvent, generateSpeech, summarizeResolution, broadcast, clients }
 */
export async function tick(world, deps) {
  // ① 心跳 +1
  world.tick += 1;

  // ② 隔离到期检查（锁定在天边界之前，§21.6）：releasedNow 则先广播 agent_update{active}、
  //    后广播「结束隔离」安全叙事 agent_event（NIT-4 次序，与进入侧「先状态后叙事」对称）。
  for (const agent of world.agents.values()) {
    const r = tickIsolation(agent, world.tick);
    if (r.releasedNow) {
      agent.status = r.status;
      agent.isolatedUntilTick = r.isolatedUntilTick;
      deps.broadcast(deps.clients, frame('agent_update', patchFields(agent)));
      const text = sanitizeOutput(`${agent.name} 结束隔离，重新加入星城。`);
      const ts = Date.now();
      deps.broadcast(
        deps.clients,
        frame('agent_event', {
          agentId: agent.id,
          name: agent.name,
          persona: agent.persona,
          kind: 'talk',
          text,
        }),
      );
      pushRecent(world, { agentId: agent.id, name: agent.name, kind: 'talk', text, ts });
      // 记录 ECHO 解除隔离的 tick，作为下一次 demo 隔离触发的节流基准（见 maybeFireIsolationDemo）
      if (agent.id === 'gossip') world._lastIsolationEndTick = world.tick;
    }
  }

  // ②.5 短睡眠到期检查：睡着的公民睡约 SLEEP_TICKS（≈10s）即自动醒来补能，
  //      避免「全员长时间打烊、游客提问 NO_AWAKE_AGENT」。隔离者不受影响（上一步已单独处理）。
  for (const agent of world.agents.values()) {
    const s = tickSleep(agent, world.tick);
    if (s.wokeNow) {
      agent.status = s.status;
      agent.energy = s.energy;
      agent.wakeAtTick = s.wakeAtTick;
      deps.broadcast(deps.clients, frame('agent_update', patchFields(agent)));
    }
  }

  // ③ 天边界检查（不分 phase 照常执行；recoverDay 已跳过 isolated，§21.6）
  if (world.tick - world.dayStartTick >= TICKS_PER_DAY) {
    const affected = recoverDay(world.agents.values());
    for (const u of affected) {
      const agent = world.agents.get(u.id);
      agent.energy = u.energy;
      agent.status = u.status;
      deps.broadcast(deps.clients, frame('agent_update', patchFields(agent)));
    }
    world.dayStartTick = world.tick;
  }

  // 讨论进行中：只做隔离到期 + 天边界，不在 tick 里推进讨论（讨论由 step 独立步进）
  if (world.phase === 'discussing') return;

  // ④ idle：先处理上一拍登记的互动回应（§22.4），再遍历 agents 触发自主行为
  if (world.phase === 'idle') {
    // demo 隔离触发钩子：world.tick 首次达 ISOLATION_DEMO_TICK 时对 ECHO 使坏→隔离（§21.2）
    maybeFireIsolationDemo(world, deps);

    // 处理上一拍登记的互动回应（§22.4 配对编排）
    if (world._pendingInteraction) {
      const pending = world._pendingInteraction;
      world._pendingInteraction = null;
      resolveInteraction(world, pending, deps);
    }

    for (const agent of world.agents.values()) {
      if (
        agent.status === 'active' &&
        world.tick >= agent.busyUntilTick &&
        agent.energy >= COST.autonomy &&
        Math.random() < AUTONOMY_CHANCE
      ) {
        await doAutonomy(world, agent, deps);
      }
    }
  }
}

/**
 * demo 隔离触发钩子（§21.2）：world.tick 首次达 ISOLATION_DEMO_TICK 时，对 gossip/ECHO
 * 广播一条安全使坏叙事 agent_event（不走 applyCost，NIT-1）、随即 enterIsolation 写回 +
 * 广播 agent_update{status:'isolated'}。_isolationDemoFired 布尔守卫确保只触发一次。
 */
function maybeFireIsolationDemo(world, deps) {
  // 周期性触发：每 demoTick 个 tick 若 ECHO 不在隔离中就触发一次使坏→隔离，
  // 使任何时候连上的观众都能在一个周期内看到完整隔离闭环（不再是一次性、对空广播即丢失）。
  const demoTick = world._isolationDemoTick ?? ISOLATION_DEMO_TICK;
  if (world.tick < demoTick) return;
  const echo = world.agents.get('gossip');
  if (!echo || echo.status === 'isolated') return; // ECHO 仍在隔离中则本拍不触发（隔离期自然成为节流间隔）
  // 两次隔离之间至少间隔一个完整周期(demoTick)的「正常活跃期」：从上次解除隔离算起，
  // 保证 ECHO 恢复后能正常活跃一阵再被触发，避免一恢复就又被抓走。
  if (world._lastIsolationEndTick != null && world.tick - world._lastIsolationEndTick < demoTick) return;
  world._lastIsolationDemoTick = world.tick;

  // 使坏叙事（文案安全、不含红线词；不走 applyCost，§21.2 NIT-1）
  const text = sanitizeOutput(`${echo.name} 偷偷散播了未经证实的小道消息……`);
  const ts = Date.now();
  deps.broadcast(
    deps.clients,
    frame('agent_event', {
      agentId: echo.id,
      name: echo.name,
      persona: echo.persona,
      kind: 'talk',
      text,
    }),
  );
  pushRecent(world, { agentId: echo.id, name: echo.name, kind: 'talk', text, ts });

  // 进入隔离：isolated 直接从 active 写入（§21.2 NIT-1）
  const iso = enterIsolation(echo, world.tick);
  echo.status = iso.status;
  echo.isolatedUntilTick = iso.isolatedUntilTick;
  deps.broadcast(deps.clients, frame('agent_update', patchFields(echo)));
}

/**
 * 互动回应编排（§22.4 / §22.5）。对上一拍登记的 _pendingInteraction：
 * 预过滤 candidates（active、energy>=COST.autonomy、未被隔离、非发起者），toAgentId 排首位，
 * matchInteraction 选回应方与语料；非 null 则让回应方走 doAutonomy(forceKind='talk') 产出
 * 带 interaction:{id,type,replyTo} 的呼应 agent_event；返回 null 安全跳过不报错不卡事件流。
 */
function resolveInteraction(world, pending, deps) {
  const candidates = [];
  for (const a of world.agents.values()) {
    if (
      a.id !== pending.initiatorId &&
      a.status === 'active' &&
      a.energy >= COST.autonomy
    ) {
      candidates.push({ id: a.id });
    }
  }
  // 把 toAgentId 对应公民排到首位（§19.3/NIT-2「回应优先者 = 文案点名者」）
  if (pending.toAgentId) {
    const i = candidates.findIndex((c) => c.id === pending.toAgentId);
    if (i > 0) {
      const [picked] = candidates.splice(i, 1);
      candidates.unshift(picked);
    }
  }
  const match = matchInteraction(pending.type, candidates, INTERACTIONS);
  if (!match) return; // 无合适回应者：安全跳过，不报错、不卡事件流（§22.5）
  const responder = world.agents.get(match.responderId);
  if (!responder || responder.status !== 'active' || responder.energy < COST.autonomy) return;
  const interaction = { id: pending.id, type: pending.type, replyTo: pending.initiatorId };
  doAutonomy(world, responder, deps, 'talk', { interaction, replyText: match.replyText });
}

/** patch 帧只带变化字段（design §4.3 / §10）。 */
function patchFields(agent) {
  return {
    agentId: agent.id,
    status: agent.status,
    energy: agent.energy,
    energyMax: agent.energyMax,
    crystals: agent.crystals,
  };
}

/**
 * 一次自主行为（§20.2 三分流决策树）：三条分支互斥、一次只产一条事件、各走一次 applyCost(autonomy)。
 * 优先级：回应（forceKind） > 出力建造（building && rng<BUILD_CHANCE） > 普通/互动发起（generateEvent）。
 * @param {string} [forceKind] 存在即为互动回应者，产出 kind='talk' 呼应事件
 * @param {object} [replyMeta] { interaction:{id,type,replyTo}, replyText } 回应元信息（forceKind 分支用）
 */
async function doAutonomy(world, agent, deps, forceKind, replyMeta) {
  // ① 回应（forceKind）：产出呼应事件（kind='talk' + interaction.replyTo）
  if (forceKind) {
    const sanitized = sanitizeWithCheck(
      replyMeta && replyMeta.replyText ? replyMeta.replyText : '嗯，我接着你的话说两句。',
    );
    applyAutonomyCost(world, agent, deps);
    const data = { agentId: agent.id, name: agent.name, persona: agent.persona, kind: forceKind, text: sanitized.text };
    if (replyMeta && replyMeta.interaction) data.interaction = replyMeta.interaction;
    broadcastEvent(world, agent, deps, forceKind, sanitized.text, data);
    if (sanitized.charterHit) triggerIsolation(world, agent, deps);
    return;
  }

  // ② 出力建造：building 且命中 BUILD_CHANCE → 工程语料 kind='act'，推进进度 + 广播 project_update
  if (world.project.status === 'building' && Math.random() < BUILD_CHANCE) {
    const sanitized = sanitizeWithCheck(renderBuildLine(agent.name, world.project.progress));
    applyAutonomyCost(world, agent, deps);
    broadcastEvent(world, agent, deps, 'act', sanitized.text, {
      agentId: agent.id,
      name: agent.name,
      persona: agent.persona,
      kind: 'act',
      text: sanitized.text,
    });
    if (sanitized.charterHit) triggerIsolation(world, agent, deps);
    broadcastProjectAdvance(world, deps, BUILD_DELTA_AUTONOMY);
    return;
  }

  // ③ 普通 / 互动发起（generateEvent 结果）
  const ev = await deps.generateEvent(agent, world, { mode: deps.mode, llm: deps.llm });
  const kind = ev.kind;
  const sanitized = sanitizeWithCheck(ev.text);
  applyAutonomyCost(world, agent, deps);
  const data = { agentId: agent.id, name: agent.name, persona: agent.persona, kind, text: sanitized.text };
  if (kind === 'visit' && ev.toAgentId) data.toAgentId = ev.toAgentId;
  broadcastEvent(world, agent, deps, kind, sanitized.text, data);
  if (sanitized.charterHit) {
    triggerIsolation(world, agent, deps);
    return; // 被隔离后不再登记互动发起
  }

  // visit → 登记互动发起（type='visit_reply'），下一拍 tick() 配对回应（§22.4）
  if (kind === 'visit') {
    world._pendingInteraction = {
      id: `i${world.tick}_${Date.now()}`,
      type: 'visit_reply',
      initiatorId: agent.id,
      toAgentId: ev.toAgentId || null,
    };
  }
}

/** 扣一次自主行为能量成本并冷却；睡着则广播 agent_update（共用于三分支）。 */
function applyAutonomyCost(world, agent, deps) {
  const cost = applyCost(agent, COST.autonomy);
  agent.energy = cost.energy;
  agent.status = cost.status;
  agent.busyUntilTick = world.tick + BEHAVIOR_COOLDOWN_TICKS;
  if (cost.sleptNow) agent.wakeAtTick = world.tick + SLEEP_TICKS; // 睡着即设短睡眠到期，约 10s 后自动醒
  agent._sleptNow = cost.sleptNow;
}

/** 广播一条 agent_event + pushRecent，睡着（上一步扣费记录）则补广播 agent_update。 */
function broadcastEvent(world, agent, deps, kind, text, data) {
  const ts = Date.now();
  deps.broadcast(deps.clients, frame('agent_event', data));
  pushRecent(world, { agentId: agent.id, name: agent.name, kind, text, ts });
  if (agent._sleptNow) {
    agent._sleptNow = false;
    deps.broadcast(deps.clients, frame('agent_update', patchFields(agent)));
  }
}

/**
 * 推进虫洞工程并广播 project_update（统一两帧次序，NIT-1，§20.3）。
 * completedNow===true：先广播 completed 帧（progress:100,round:completedRound），再写回重置态
 * 并广播 building 归零帧（progress:0），另广播一条建成叙事 agent_event（agentId:null/'赛博坦'）。
 */
function broadcastProjectAdvance(world, deps, delta) {
  const next = advanceProject(world.project, delta);
  if (!next.completedNow) {
    world.project = { progress: next.progress, round: next.round, status: 'building' };
    deps.broadcast(
      deps.clients,
      frame('project_update', { progress: next.progress, round: next.round, status: 'building' }),
    );
    return;
  }
  // 建成：先 completed 帧
  deps.broadcast(
    deps.clients,
    frame('project_update', { progress: 100, round: next.completedRound, status: 'completed' }),
  );
  // 建成叙事（agentId:null / name:'赛博坦'，过宪章 + pushRecent，§20.5）
  const narrative = sanitizeOutput(
    `🌀 第 ${next.completedRound} 座虫洞超时空传送器建成！霓虹虫洞开启——`,
  );
  deps.broadcast(
    deps.clients,
    frame('agent_event', { agentId: null, name: '赛博坦', persona: null, kind: 'act', text: narrative }),
  );
  pushRecent(world, { agentId: null, name: '赛博坦', kind: 'act', text: narrative, ts: Date.now() });
  // 重置态并广播归零帧
  world.project = { progress: 0, round: next.round, status: 'building' };
  deps.broadcast(
    deps.clients,
    frame('project_update', { progress: 0, round: next.round, status: 'building' }),
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 讨论编排（提问 → 开场 → 步进 → 决议）
// ──────────────────────────────────────────────────────────────────────────

/** 处理一条 visitor_ask：校验 / 入队 / 开场。返回要单播给该连接的帧（或 null）。 */
export function handleVisitorAsk(world, question, deps) {
  if (typeof question !== 'string') {
    return frame('ask_rejected', { reason: 'EMPTY', message: '问题不能为空哦~' });
  }
  const q = question.trim();
  if (q.length === 0) {
    return frame('ask_rejected', { reason: 'EMPTY', message: '问题不能为空哦~' });
  }
  if (q.length > 200) {
    return frame('ask_rejected', { reason: 'TOO_LONG', message: '问题太长啦，精简一下再问~' });
  }
  if (!charterCheck(q).ok) {
    return frame('ask_rejected', { reason: 'CHARTER', message: '这个话题不符合赛博坦宪章，换一个吧~' });
  }

  const hasAnyActive = [...world.agents.values()].some((a) => a.status === 'active');

  if (world.phase === 'discussing') {
    // 先轻量预判：全员睡着则排队也无果，直接拒（NIT-1）
    if (!hasAnyActive) {
      return frame('ask_rejected', { reason: 'NO_AWAKE_AGENT', message: '9号星城暂时打烊，公民们都休眠了~' });
    }
    if (world.askQueue.length >= MAX_ASK_QUEUE) {
      return frame('ask_rejected', { reason: 'QUEUE_FULL', message: '星城里排队的问题有点多，稍后再试~' });
    }
    world.askQueue.push(q);
    return frame('ask_queued', { position: world.askQueue.length, message: '星城正在讨论上一个问题，已为你排队~' });
  }

  // idle：选可发言 agent
  const speakers = selectSpeakers(world);
  if (speakers.length === 0) {
    return frame('ask_rejected', { reason: 'NO_AWAKE_AGENT', message: '9号星城暂时打烊，公民们都休眠了~' });
  }
  startDiscussion(world, q, speakers, deps);
  return null; // discussion_start 已广播
}

/** 选可发言 agent（active && energy>=COST.speak），按配置序，最多 MAX_SPEAKERS。 */
function selectSpeakers(world) {
  const ids = [];
  for (const a of world.agents.values()) {
    if (a.status === 'active' && a.energy >= COST.speak) {
      ids.push(a.id);
      if (ids.length >= MAX_SPEAKERS) break;
    }
  }
  return ids;
}

/** 开场：建 discussion、置 phase、广播 discussion_start、安排第一步。 */
function startDiscussion(world, question, speakerIds, deps) {
  const id = `d${world.tick}_${Date.now()}`;
  world.discussion = {
    id,
    question,
    speakersQueue: speakerIds.slice(),
    spoken: [],
    startedTick: world.tick,
  };
  world.phase = 'discussing';
  const speakers = speakerIds.map((sid) => {
    const a = world.agents.get(sid);
    return { agentId: a.id, name: a.name };
  });
  deps.broadcast(deps.clients, frame('discussion_start', { discussionId: id, question, speakers }));
  scheduleStep(world, deps);
}

/** 安排下一步讨论步进（独立链式 setTimeout，可被测试覆写为直接驱动）。 */
function scheduleStep(world, deps) {
  if (deps.scheduleStep) {
    deps.scheduleStep(() => runStep(world, deps));
    return;
  }
  const delay = deps.discussStepMs ?? DISCUSS_STEP_MS;
  world._stepTimer = setTimeout(() => {
    if (world.ticking) {
      // 自旋锁占用中，稍后重排
      scheduleStep(world, deps);
      return;
    }
    world.ticking = true;
    runStep(world, deps)
      .catch((err) => console.debug('[step] error:', err.message))
      .finally(() => {
        world.ticking = false;
      });
  }, delay);
  if (typeof world._stepTimer.unref === 'function') world._stepTimer.unref();
}

/**
 * 讨论一步（半纯，可被测试直接 await）。取队首发言，队空则本步并入决议结算。
 */
export async function step(world, deps) {
  return runStep(world, deps);
}

async function runStep(world, deps) {
  const d = world.discussion;
  if (!d) return;

  // 取队首，跳过不满足发言条件的
  let speaker = null;
  while (d.speakersQueue.length > 0) {
    const id = d.speakersQueue.shift();
    const agent = world.agents.get(id);
    if (agent && agent.status === 'active' && agent.energy >= COST.speak) {
      speaker = agent;
      break;
    }
  }

  if (speaker) {
    const raw = await deps.generateSpeech(speaker, d.question, { mode: deps.mode, llm: deps.llm });
    const sanitized = sanitizeWithCheck(raw);
    const text = sanitized.text;

    const cost = applyCost(speaker, COST.speak);
    speaker.energy = cost.energy;
    speaker.status = cost.status;
    if (cost.sleptNow) speaker.wakeAtTick = world.tick + SLEEP_TICKS; // 睡着即设短睡眠到期

    d.spoken.push({ agentId: speaker.id, name: speaker.name, text });
    const ts = Date.now();
    deps.broadcast(
      deps.clients,
      frame('discussion_speak', {
        discussionId: d.id,
        agentId: speaker.id,
        name: speaker.name,
        persona: speaker.persona,
        text,
      }),
    );
    pushRecent(world, { agentId: speaker.id, name: speaker.name, kind: 'speak', text, ts });
    if (cost.sleptNow) {
      deps.broadcast(deps.clients, frame('agent_update', patchFields(speaker)));
    }
    // 隔离触发点 1（§21.2）：发言命中宪章，写回扣费后覆写 isolated（优先于 asleep）
    if (sanitized.charterHit) {
      triggerIsolation(world, speaker, deps);
    }
  }

  // 队空（含本步跳过后为空）：并入结算；否则安排下一步
  if (d.speakersQueue.length === 0) {
    await settleResolution(world, deps);
  } else {
    scheduleStep(world, deps);
  }
}

/** 决议结算（design §5.4）。 */
async function settleResolution(world, deps) {
  const d = world.discussion;
  if (!d) return;

  const rawText = await deps.summarizeResolution(d.question, d.spoken, { mode: deps.mode, llm: deps.llm });
  const text = sanitizeOutput(rawText);

  // 采纳前 min(ADOPTED_COUNT, spoken.length) 位发言者
  const adoptCount = Math.min(ADOPTED_COUNT, d.spoken.length);
  const adoptedAgentIds = [];
  for (let i = 0; i < adoptCount; i++) {
    const agentId = d.spoken[i].agentId;
    const agent = world.agents.get(agentId);
    if (!agent) continue;
    const r = reward(agent);
    agent.crystals = r.crystals;
    agent.energy = r.energy;
    agent.status = r.status;
    adoptedAgentIds.push(agentId);
    deps.broadcast(deps.clients, frame('agent_update', patchFields(agent)));
  }

  const ts = Date.now();
  deps.broadcast(
    deps.clients,
    frame('resolution', { discussionId: d.id, question: d.question, text, adoptedAgentIds }),
  );
  pushRecent(world, { agentId: null, name: '赛博坦', kind: 'resolution', text, ts });

  // 二期：决议结算后推进虫洞工程（§20.2 来源 2）。建成两帧次序统一走 broadcastProjectAdvance，
  // 讨论路径下这些 project_update / 建成叙事帧在 resolution 之后广播（NIT-1）。
  broadcastProjectAdvance(world, deps, BUILD_DELTA_RESOLUTION);

  world.phase = 'idle';
  world.discussion = null;
  if (world._stepTimer) {
    clearTimeout(world._stepTimer);
    world._stepTimer = null;
  }

  // askQueue 非空则立刻开下一场（校验已在入队前做过）
  if (world.askQueue.length > 0) {
    const nextQ = world.askQueue.shift();
    const speakers = selectSpeakers(world);
    if (speakers.length > 0) {
      startDiscussion(world, nextQ, speakers, deps);
    }
    // 若此刻无人可发言，丢弃该问题（极端跨天边界，罕见）
  }
}

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
 * 启动 ws 服务与心跳。返回 { wss, world, stop }。
 * @param {number} [port] 监听端口；0 表示系统分配（便于集成测试）。
 */
export function startServer(port = Number(process.env.PORT) || 9527) {
  const world = createWorld();
  const { mode, llm } = resolveMode(process.env);
  world.mode = mode;
  world.llm = llm;

  const TICK_MS_EFFECTIVE = Number(process.env.CYBERTRON_TICK_MS) || TICK_MS;
  const DISCUSS_STEP_MS_EFFECTIVE = Number(process.env.CYBERTRON_DISCUSS_STEP_MS) || DISCUSS_STEP_MS;
  // 二期：demo 隔离触发 tick 可经 env 调小（仅测试/调试用，缺省走常量，§25）
  world._isolationDemoTick = Number(process.env.CYBERTRON_ISOLATION_DEMO_TICK) || ISOLATION_DEMO_TICK;

  const wss = new WebSocketServer({ host: '0.0.0.0', port });

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

  wss.on('listening', () => {
    const addr = wss.address();
    const p = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`[town-server] listening on ws://0.0.0.0:${p}`);
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
  }

  return { wss, world, stop, deps };
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
  startServer();
}
