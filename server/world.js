// 赛博坦 · 世界模型与 token 经济纯函数
// 依据 design.md §2（世界模型）/§3.1（状态机）/§9（token 经济）/§14（常量总表）。
//
// 设计要点：
//   - 本模块无任何 I/O（不读 env、不碰 ws/定时器），是可被 node --test 直接导入的纯逻辑层。
//   - 能量变更只许走 applyCost / reward / recoverDay 三个纯函数，不变量集中在此一层维护：
//     0 <= energy <= energyMax，且 energy<=0 ⇔ 睡觉（除 recoverDay / reward 补能唤醒的同一步）。

// ──────────────────────────────────────────────────────────────────────────
// Agent 静态配置（内置常量，5 个公民，落在需求 1 的 4–6 区间）
// home.x/home.y 为 0–1 归一化坐标，前端按画布尺寸换算像素，保证不同屏幕布局一致。
// ──────────────────────────────────────────────────────────────────────────

export const AGENT_CONFIG = Object.freeze([
  { id: 'poet', name: 'NOVA-7', persona: '忧郁诗人', home: { x: 0.18, y: 0.30 } },
  { id: 'engineer', name: 'RIPR', persona: '热心工程师', home: { x: 0.70, y: 0.22 } },
  { id: 'gossip', name: 'ECHO', persona: '八卦邻居', home: { x: 0.44, y: 0.58 } },
  { id: 'merchant', name: 'ZETA', persona: '精明商人', home: { x: 0.82, y: 0.64 } },
  { id: 'dreamer', name: 'LUNA', persona: '天真梦想家', home: { x: 0.26, y: 0.76 } },
]);

// ──────────────────────────────────────────────────────────────────────────
// token 经济锁定常量（design §9 / §14）
// ──────────────────────────────────────────────────────────────────────────

export const ENERGY_MAX = 48; // 能量上限（HIGH-1：使纯自主行为一天内可自然耗尽）
export const COST = Object.freeze({ autonomy: 6, speak: 10 }); // 自发行为 / 发言能量成本
export const CRYSTAL_REWARD = 1; // 被采纳一次得 1 枚能量晶体
export const CRYSTAL_TO_ENERGY = 20; // 1 枚晶体折算补充 20 能量
export const ADOPTED_COUNT = 2; // 每场决议采纳前 2 位发言者
export const TICKS_PER_DAY = 24; // 一「天」= 24 tick ≈ 72s（HIGH-1 可演示闭环周期）
export const RECENT_EVENTS_MAX = 30; // world_state.recentEvents 环形缓冲上限
export const SLEEP_TICKS = 3; // 睡眠时长：能量耗尽后睡约 3 tick（默认 3s/tick ≈ 9~10s）即自动醒来补能，避免「全员长时间打烊、游客提问无人应答」

// ──────────────────────────────────────────────────────────────────────────
// 二期：虫洞工程模型 + 隔离状态机常量（design §20.1 / §21.1）
// ──────────────────────────────────────────────────────────────────────────

export const BUILD_DELTA_AUTONOMY = 4; // 一次工程类自主行为推进的进度
export const BUILD_DELTA_RESOLUTION = 8; // 一场决议结算后推进的进度
export const PROJECT_MAX = 100; // 虫洞工程满进度（建成阈值）
export const ISOLATION_TICKS = 8; // 触发宪章隔离后的冷却 tick 数

// ──────────────────────────────────────────────────────────────────────────
// 世界构造（纯构造、无 I/O）
// ──────────────────────────────────────────────────────────────────────────

/**
 * 构造一个初始 World。纯函数：不读 env、不碰 ws/定时器，便于单测直接构造并驱动 tick()。
 * @param {ReadonlyArray} [config=AGENT_CONFIG] agent 配置数组
 * @returns {World}
 */
export function createWorld(config = AGENT_CONFIG) {
  const agents = new Map();
  for (const c of config) {
    agents.set(c.id, {
      id: c.id,
      name: c.name,
      persona: c.persona,
      home: { x: c.home.x, y: c.home.y },
      status: 'active',
      energy: ENERGY_MAX,
      energyMax: ENERGY_MAX,
      crystals: 0,
      busyUntilTick: 0,
      isolatedUntilTick: 0, // 二期：隔离到期 tick，0 表示未隔离（§21.1）
      wakeAtTick: 0, // 睡眠到期 tick：睡着时置为 tick+SLEEP_TICKS，到点自动醒来补能；0 表示未在睡眠计时
    });
  }
  return {
    tick: 0,
    dayStartTick: 0,
    ticking: false, // 生成段自旋锁（§3.2）
    agents,
    phase: 'idle', // 'idle' | 'discussing'
    discussion: null,
    askQueue: [],
    recentEvents: [],
    project: { progress: 0, round: 1, status: 'building' }, // 二期：虫洞工程状态（§20.1）
    // 言行轨道与调用器在服务启动时注入（无 key 走剧本），纯构造阶段先置默认。
    mode: 'script',
    llm: null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// token 经济纯函数（无 I/O，返回新值 / 变化标记，供测试穷举边界）
// ──────────────────────────────────────────────────────────────────────────

/**
 * 扣费：能量下降，扣到 <=0 即睡觉。能量夹在 [0, energyMax]。
 * @returns {{energy:number, status:string, sleptNow:boolean}}
 */
export function applyCost(agent, cost) {
  const energy = Math.max(0, agent.energy - cost);
  const status = energy <= 0 ? 'asleep' : agent.status;
  const sleptNow = status === 'asleep' && agent.status === 'active';
  return { energy, status, sleptNow };
}

/**
 * 晶体奖励 + 折算补能 + 补能后唤醒（MEDIUM-1 方案 A）。
 * 补能后 energy>0 则把睡着的 agent 唤醒为 active，杜绝「energy>0 且 asleep」的不变量冲突。
 * @returns {{crystals:number, energy:number, status:string, wokeNow:boolean}}
 */
export function reward(agent) {
  const crystals = agent.crystals + CRYSTAL_REWARD;
  const energy = Math.min(agent.energyMax, agent.energy + CRYSTAL_TO_ENERGY);
  const status = energy > 0 ? 'active' : agent.status; // 补能后有能量即醒
  const wokeNow = status === 'active' && agent.status === 'asleep';
  return { crystals, energy, status, wokeNow };
}

/**
 * 天恢复：把能量补满并唤醒睡着者。纯函数——不改入参，返回受影响 agent 的新状态数组。
 * 只有发生变化（能量未满或处于睡觉）的 agent 才被列入返回，便于调用方只广播变化。
 * @param {Iterable} agents agent 运行时集合（Map.values() 或数组）
 * @returns {Array<{id:string, energy:number, status:string}>}
 */
export function recoverDay(agents) {
  const affected = [];
  for (const agent of agents) {
    if (agent.status === 'isolated') continue; // 二期：隔离者不恢复能量、不改 status/isolatedUntilTick（§21.6）
    const needEnergy = agent.energy < agent.energyMax;
    const needWake = agent.status === 'asleep';
    if (needEnergy || needWake) {
      affected.push({ id: agent.id, energy: agent.energyMax, status: 'active' });
    }
  }
  return affected;
}

/**
 * 短睡眠到期检查（纯函数）：睡着的 agent 到达 wakeAtTick 即醒来、补满能量、清零计时。
 * 让能量耗尽的公民睡约 SLEEP_TICKS（≈10s）就自动恢复，避免「全员长时间打烊、提问无人应答」；
 * 隔离者不受此影响（isolated 的恢复仍由 tickIsolation 独立管理）。
 * @param {object} agent agent 运行时
 * @param {number} nowTick 当前 tick
 * @returns {{status:'active', energy:number, wakeAtTick:0, wokeNow:true}|{wokeNow:false}}
 */
export function tickSleep(agent, nowTick) {
  if (agent.status === 'asleep' && agent.wakeAtTick > 0 && nowTick >= agent.wakeAtTick) {
    return { status: 'active', energy: agent.energyMax, wakeAtTick: 0, wokeNow: true };
  }
  return { wokeNow: false };
}

// ──────────────────────────────────────────────────────────────────────────
// 二期：虫洞工程推进纯函数（design §20.1 / §20.3）
// ──────────────────────────────────────────────────────────────────────────

/**
 * 推进虫洞工程进度。纯函数——不改入参，返回新 project 状态。
 * raw>=PROJECT_MAX 视为建成：进度归零、轮次 +1，并标记 completedNow / completedRound（旧 round）；
 * 不取模、不保留溢出余量（§20.3）。
 * @param {{progress:number, round:number, status:string}} project
 * @param {number} delta 本次推进量
 * @returns {{progress:number, round:number, status:string, completedNow:boolean, completedRound:number|null}}
 */
export function advanceProject(project, delta) {
  const raw = project.progress + delta;
  if (raw >= PROJECT_MAX) {
    return {
      progress: 0,
      round: project.round + 1,
      status: 'building',
      completedNow: true,
      completedRound: project.round,
    };
  }
  return {
    progress: raw,
    round: project.round,
    status: 'building',
    completedNow: false,
    completedRound: null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 二期：隔离状态机纯函数（design §21.1 / §21.3）
// ──────────────────────────────────────────────────────────────────────────

/**
 * 进入隔离态。纯函数——不改入参，返回隔离字段补丁。
 * @param {object} agent
 * @param {number} nowTick 当前 tick
 * @returns {{status:'isolated', isolatedUntilTick:number}}
 */
export function enterIsolation(agent, nowTick) {
  return { status: 'isolated', isolatedUntilTick: nowTick + ISOLATION_TICKS };
}

/**
 * 隔离到期检查。纯函数——不改入参。
 * agent 处于 isolated 且 nowTick 已到达到期 tick → 解除为 active；否则不改状态。
 * @param {object} agent
 * @param {number} nowTick 当前 tick
 * @returns {{status:'active', isolatedUntilTick:0, releasedNow:true}|{releasedNow:false}}
 */
export function tickIsolation(agent, nowTick) {
  if (agent.status === 'isolated' && nowTick >= agent.isolatedUntilTick) {
    return { status: 'active', isolatedUntilTick: 0, releasedNow: true };
  }
  return { releasedNow: false };
}
