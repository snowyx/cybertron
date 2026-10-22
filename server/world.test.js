// 赛博坦 · world.js token 经济纯函数单测（design §12）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorld,
  applyCost,
  reward,
  recoverDay,
  advanceProject,
  enterIsolation,
  tickIsolation,
  tickSleep,
  AGENT_CONFIG,
  ENERGY_MAX,
  COST,
  CRYSTAL_REWARD,
  CRYSTAL_TO_ENERGY,
  ADOPTED_COUNT,
  ISOLATION_TICKS,
  SLEEP_TICKS,
} from './world.js';

test('createWorld 初始化 5 个 active 满能量 agent 与 idle 世界', () => {
  const w = createWorld();
  assert.equal(w.agents.size, 5);
  assert.equal(w.phase, 'idle');
  assert.equal(w.ticking, false);
  assert.equal(w.discussion, null);
  assert.deepEqual(w.askQueue, []);
  assert.deepEqual(w.recentEvents, []);
  assert.deepEqual(w.project, { progress: 0, round: 1, status: 'building' }); // 二期：虫洞工程初始态
  for (const a of w.agents.values()) {
    assert.equal(a.status, 'active');
    assert.equal(a.energy, ENERGY_MAX);
    assert.equal(a.energyMax, ENERGY_MAX);
    assert.equal(a.crystals, 0);
    assert.equal(a.isolatedUntilTick, 0); // 二期：隔离字段初始 0
    assert.ok(a.home && typeof a.home.x === 'number');
  }
});

test('applyCost 未扣到 0 不睡觉', () => {
  const agent = { status: 'active', energy: 48 };
  const r = applyCost(agent, COST.autonomy);
  assert.equal(r.energy, 42);
  assert.equal(r.status, 'active');
  assert.equal(r.sleptNow, false);
});

test('applyCost 扣到 <=0 睡觉且能量不为负', () => {
  const agent = { status: 'active', energy: 4 };
  const r = applyCost(agent, COST.speak);
  assert.equal(r.energy, 0);
  assert.equal(r.status, 'asleep');
  assert.equal(r.sleptNow, true);
});

test('reward 晶体+1、能量不溢出 energyMax', () => {
  const agent = { status: 'active', energy: ENERGY_MAX - 5, energyMax: ENERGY_MAX, crystals: 2 };
  const r = reward(agent);
  assert.equal(r.crystals, 2 + CRYSTAL_REWARD);
  assert.equal(r.energy, ENERGY_MAX); // min(max, 43+20)=48 不溢出
  assert.equal(r.status, 'active');
  assert.equal(r.wokeNow, false);
});

test('reward 对睡着且补能后 energy>0 的 agent 唤醒（MEDIUM-1）', () => {
  const agent = { status: 'asleep', energy: 0, energyMax: ENERGY_MAX, crystals: 0 };
  const r = reward(agent);
  assert.equal(r.energy, CRYSTAL_TO_ENERGY);
  assert.equal(r.status, 'active');
  assert.equal(r.wokeNow, true);
  assert.equal(r.crystals, 1);
});

test('recoverDay 把能量补满并唤醒睡着者', () => {
  const agents = [
    { id: 'a', status: 'asleep', energy: 0, energyMax: ENERGY_MAX },
    { id: 'b', status: 'active', energy: ENERGY_MAX, energyMax: ENERGY_MAX }, // 满能量 active 不受影响
    { id: 'c', status: 'active', energy: 10, energyMax: ENERGY_MAX },
  ];
  const affected = recoverDay(agents);
  const ids = affected.map((x) => x.id).sort();
  assert.deepEqual(ids, ['a', 'c']); // b 无变化不列入
  for (const u of affected) {
    assert.equal(u.energy, ENERGY_MAX);
    assert.equal(u.status, 'active');
  }
});

test('采纳边界 min(ADOPTED_COUNT, spoken.length)（spoken<2）', () => {
  assert.equal(Math.min(ADOPTED_COUNT, 1), 1);
  assert.equal(Math.min(ADOPTED_COUNT, 0), 0);
  assert.equal(Math.min(ADOPTED_COUNT, 5), ADOPTED_COUNT);
});

test('AGENT_CONFIG 为冻结的 5 人配置', () => {
  assert.equal(AGENT_CONFIG.length, 5);
  assert.ok(Object.isFrozen(AGENT_CONFIG));
});

// ── 二期：虫洞工程推进 advanceProject（§20.1/§20.3） ──────────────────────────

test('advanceProject 未达 100 仅累加进度、不建成', () => {
  const r = advanceProject({ progress: 10, round: 1, status: 'building' }, 4);
  assert.deepEqual(r, {
    progress: 14,
    round: 1,
    status: 'building',
    completedNow: false,
    completedRound: null,
  });
});

test('advanceProject 恰达 100 建成重置、round+1、标记旧 round', () => {
  const r = advanceProject({ progress: 96, round: 1, status: 'building' }, 4);
  assert.deepEqual(r, {
    progress: 0,
    round: 2,
    status: 'building',
    completedNow: true,
    completedRound: 1,
  });
});

test('advanceProject 跨 100 不取模、不留溢出余量，恒归零', () => {
  const a = advanceProject({ progress: 96, round: 1, status: 'building' }, 8); // raw=104
  assert.equal(a.progress, 0);
  assert.equal(a.completedNow, true);
  const b = advanceProject({ progress: 99, round: 1, status: 'building' }, 4); // raw=103
  assert.equal(b.progress, 0);
  assert.equal(b.completedNow, true);
});

test('advanceProject 连续两次建成后 round===3', () => {
  let p = { progress: 0, round: 1, status: 'building' };
  let r = advanceProject(p, 100);
  assert.equal(r.round, 2);
  assert.equal(r.completedNow, true);
  r = advanceProject({ progress: r.progress, round: r.round, status: r.status }, 100);
  assert.equal(r.round, 3);
  assert.equal(r.completedNow, true);
});

// ── 二期：隔离状态机 enterIsolation/tickIsolation（§21.1/§21.3/§21.6） ────────

test('enterIsolation 从 active/asleep 均进入隔离且到期 tick=nowTick+ISOLATION_TICKS', () => {
  const now = 5;
  const a = enterIsolation({ status: 'active', isolatedUntilTick: 0 }, now);
  assert.deepEqual(a, { status: 'isolated', isolatedUntilTick: now + ISOLATION_TICKS });
  const b = enterIsolation({ status: 'asleep', isolatedUntilTick: 0 }, now);
  assert.deepEqual(b, { status: 'isolated', isolatedUntilTick: now + ISOLATION_TICKS });
});

test('tickIsolation 未到期 releasedNow:false 不改状态', () => {
  const agent = { status: 'isolated', isolatedUntilTick: 10 };
  const r = tickIsolation(agent, 9);
  assert.deepEqual(r, { releasedNow: false });
});

test('tickIsolation 到期解除为 active、isolatedUntilTick 归零', () => {
  const agent = { status: 'isolated', isolatedUntilTick: 10 };
  const r = tickIsolation(agent, 10);
  assert.deepEqual(r, { status: 'active', isolatedUntilTick: 0, releasedNow: true });
});

test('tickIsolation 非 isolated 恒 releasedNow:false', () => {
  assert.deepEqual(tickIsolation({ status: 'active', isolatedUntilTick: 0 }, 100), { releasedNow: false });
  assert.deepEqual(tickIsolation({ status: 'asleep', isolatedUntilTick: 0 }, 100), { releasedNow: false });
});

// ── 二期：recoverDay 跳过 isolated（§21.6） ──────────────────────────────────

test('recoverDay 跳过 isolated agent：不入 affected、不改字段，active/asleep 对照组仍入', () => {
  const agents = [
    { id: 'iso', status: 'isolated', energy: 3, energyMax: ENERGY_MAX, isolatedUntilTick: 20 }, // 能量未满但隔离 → 跳过
    { id: 'act', status: 'active', energy: 10, energyMax: ENERGY_MAX }, // 对照：active 低能量 → 入
    { id: 'slp', status: 'asleep', energy: 0, energyMax: ENERGY_MAX }, // 对照：asleep → 入
  ];
  const affected = recoverDay(agents);
  const ids = affected.map((x) => x.id).sort();
  assert.deepEqual(ids, ['act', 'slp']); // isolated 不列入
  // 隔离 agent 入参字段不被改动（纯函数）
  assert.equal(agents[0].status, 'isolated');
  assert.equal(agents[0].energy, 3);
  assert.equal(agents[0].isolatedUntilTick, 20);
});

// ── 短睡眠到期 tickSleep（能量耗尽睡约 SLEEP_TICKS 即自动醒，避免全员长时间打烊） ──

test('tickSleep 到期：asleep 且 nowTick>=wakeAtTick → 醒来、补满能量、清零计时', () => {
  const agent = { status: 'asleep', energy: 0, energyMax: ENERGY_MAX, wakeAtTick: 10 };
  const r = tickSleep(agent, 10);
  assert.deepEqual(r, { status: 'active', energy: ENERGY_MAX, wakeAtTick: 0, wokeNow: true });
});

test('tickSleep 未到期：asleep 但 nowTick<wakeAtTick → 不醒', () => {
  const agent = { status: 'asleep', energy: 0, energyMax: ENERGY_MAX, wakeAtTick: 10 };
  assert.deepEqual(tickSleep(agent, 9), { wokeNow: false });
});

test('tickSleep 对 active / wakeAtTick=0 恒不触发', () => {
  assert.deepEqual(tickSleep({ status: 'active', energy: 5, energyMax: ENERGY_MAX, wakeAtTick: 0 }, 100), { wokeNow: false });
  assert.deepEqual(tickSleep({ status: 'asleep', energy: 0, energyMax: ENERGY_MAX, wakeAtTick: 0 }, 100), { wokeNow: false });
});

test('SLEEP_TICKS 为正整数且远小于一天，保证睡眠短暂', () => {
  assert.ok(Number.isInteger(SLEEP_TICKS) && SLEEP_TICKS > 0);
  assert.ok(SLEEP_TICKS < 24);
});
