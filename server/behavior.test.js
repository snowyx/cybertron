// 赛博坦 · behavior.js 言行生成与双轨降级单测（design §12）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCRIPT,
  generateEvent,
  generateSpeech,
  summarizeResolution,
  resolveMode,
  INTERACTIONS,
  matchInteraction,
} from './behavior.js';
import { createWorld } from './world.js';

test('resolveMode 无 key 走剧本', () => {
  const r = resolveMode({});
  assert.equal(r.mode, 'script');
  assert.equal(r.llm, null);
});

test('resolveMode 有 key 走真模型并返回调用器', () => {
  const r = resolveMode({ CYBERTRON_LLM_API_KEY: 'sk-test' });
  assert.equal(r.mode, 'llm');
  assert.equal(typeof r.llm, 'function');
});

test('五人格语料达下限（act/talk/visit ≥2、speech ≥1）', () => {
  const personas = Object.keys(SCRIPT);
  assert.equal(personas.length, 5);
  for (const p of personas) {
    assert.ok(SCRIPT[p].act.length >= 2, `${p} act`);
    assert.ok(SCRIPT[p].talk.length >= 2, `${p} talk`);
    assert.ok(SCRIPT[p].visit.length >= 2, `${p} visit`);
    assert.equal(typeof SCRIPT[p].speech, 'function', `${p} speech`);
  }
});

test('剧本轨三个生成函数稳定产出非空字符串', async () => {
  const world = createWorld();
  const agent = world.agents.get('poet');
  const ev = await generateEvent(agent, world, { mode: 'script', llm: null });
  assert.ok(['act', 'talk', 'visit'].includes(ev.kind));
  assert.ok(ev.text.length > 0);

  const sp = await generateSpeech(agent, '星城今天开心吗', { mode: 'script', llm: null });
  assert.ok(sp.length > 0);

  const res = await summarizeResolution('星城今天开心吗', [{ agentId: 'poet', name: 'NOVA-7', text: '还行' }], { mode: 'script', llm: null });
  assert.ok(res.length > 0);
});

test('注入必抛错的 llm，llm 轨仍回退剧本产出', async () => {
  const world = createWorld();
  const agent = world.agents.get('engineer');
  const brokenLlm = async () => {
    throw new Error('boom');
  };
  const ev = await generateEvent(agent, world, { mode: 'llm', llm: brokenLlm });
  assert.ok(ev.text.length > 0); // 回退剧本
  const sp = await generateSpeech(agent, '怎么修', { mode: 'llm', llm: brokenLlm });
  assert.ok(sp.length > 0);
  const res = await summarizeResolution('怎么修', [{ agentId: 'engineer', name: 'RIPR', text: '拆开看' }], { mode: 'llm', llm: brokenLlm });
  assert.ok(res.length > 0);
});

test('llm 轨正常返回时使用模型产出', async () => {
  const world = createWorld();
  const agent = world.agents.get('dreamer');
  const okLlm = async () => '这是模型返回的一句话';
  const sp = await generateSpeech(agent, '梦想是什么', { mode: 'llm', llm: okLlm });
  assert.equal(sp, '这是模型返回的一句话');
});

test('串门文案中的 {other} 不等于自己，且 toAgentId 与点名者一致', async () => {
  const world = createWorld();
  const poet = world.agents.get('poet');
  // 多次采样，visit 文案里不应出现自己的名字「NOVA-7」，且 toAgentId 对应 agent 名出现在文案里
  for (let i = 0; i < 30; i++) {
    const ev = await generateEvent(poet, world, { mode: 'script', llm: null });
    if (ev.kind === 'visit') {
      assert.ok(!ev.text.includes(poet.name), `visit 文案不应点名自己: ${ev.text}`);
      assert.ok(ev.toAgentId && ev.toAgentId !== poet.id, 'visit 应带非自身 toAgentId');
      const target = world.agents.get(ev.toAgentId);
      assert.ok(target && ev.text.includes(target.name), `文案点名者应等于 toAgentId: ${ev.text}`);
    }
  }
});

// ── 二期：互动配对语料 INTERACTIONS（§22.3） ─────────────────────────────────

test('INTERACTIONS ≥4 类，每类 initiate/reply 均 ≥2 条', () => {
  const types = Object.keys(INTERACTIONS);
  assert.ok(types.length >= 4, `类目数 ${types.length}`);
  for (const t of types) {
    assert.ok(Array.isArray(INTERACTIONS[t].initiate) && INTERACTIONS[t].initiate.length >= 2, `${t} initiate`);
    assert.ok(Array.isArray(INTERACTIONS[t].reply) && INTERACTIONS[t].reply.length >= 2, `${t} reply`);
  }
});

// ── 二期：互动配对纯函数 matchInteraction ───────────────────────────────────

test('matchInteraction 固定 rng=0 确定选出首个候选与首条回应', () => {
  const r = matchInteraction('gossip_rebut', [{ id: 'a' }, { id: 'b' }], INTERACTIONS, () => 0);
  assert.equal(r.responderId, 'a');
  assert.equal(r.replyText, INTERACTIONS.gossip_rebut.reply[0]);
});

test('matchInteraction 支持字符串候选', () => {
  const r = matchInteraction('poem_praise', ['x', 'y'], INTERACTIONS, () => 0);
  assert.equal(r.responderId, 'x');
});

test('matchInteraction 空候选 → null', () => {
  assert.equal(matchInteraction('gossip_rebut', [], INTERACTIONS, () => 0), null);
});

test('matchInteraction 未知 type → null', () => {
  assert.equal(matchInteraction('nope', [{ id: 'a' }], INTERACTIONS, () => 0), null);
});

test('matchInteraction 回应池空 → null', () => {
  const corpus = { empty: { initiate: ['x'], reply: [] } };
  assert.equal(matchInteraction('empty', [{ id: 'a' }], corpus, () => 0), null);
});

test('matchInteraction 多候选下 rng 变化覆盖不同选择', () => {
  const cands = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const low = matchInteraction('crystal_haggle', cands, INTERACTIONS, () => 0);
  const high = matchInteraction('crystal_haggle', cands, INTERACTIONS, () => 0.9);
  assert.equal(low.responderId, 'a');
  assert.equal(high.responderId, 'c');
  assert.equal(high.replyText, INTERACTIONS.crystal_haggle.reply[INTERACTIONS.crystal_haggle.reply.length - 1]);
});
