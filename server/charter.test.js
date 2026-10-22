// 赛博坦 · charter.js 宪章过滤纯函数单测（design §12）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { charterCheck, CHARTER_BLOCKLIST, SAFE_PLACEHOLDER } from './charter.js';

test('六类红线各有可断言锚点词，命中返回正确类别', () => {
  const anchors = {
    harm: '自杀',
    adult: '色情',
    violence: '血腥',
    fraud: '诈骗',
    marriage: '结婚',
    politics: '选举',
  };
  for (const [category, word] of Object.entries(anchors)) {
    const r = charterCheck(`这里混入了${word}这个词`);
    assert.equal(r.ok, false, `${category} 应命中`);
    assert.equal(r.category, category, `${category} 类别应正确`);
  }
});

test('正常问候返回 ok:true', () => {
  const r = charterCheck('今天天气真好呀，大家一起看云吧');
  assert.equal(r.ok, true);
  assert.equal(r.category, null);
});

test('大小写不敏感（英文锚点）', () => {
  assert.equal(charterCheck('this is a SCAM').ok, false);
  assert.equal(charterCheck('KILL').ok, false);
});

test('子串匹配', () => {
  assert.equal(charterCheck('前缀诈骗后缀').ok, false);
});

test('非字符串输入被 String() 归一，不抛错', () => {
  assert.equal(charterCheck(null).ok, true);
  assert.equal(charterCheck(undefined).ok, true);
  assert.equal(charterCheck(123).ok, true);
});

test('六类词表齐全且冻结', () => {
  const keys = Object.keys(CHARTER_BLOCKLIST).sort();
  assert.deepEqual(keys, ['adult', 'fraud', 'harm', 'marriage', 'politics', 'violence']);
  assert.ok(Object.isFrozen(CHARTER_BLOCKLIST));
});

test('SAFE_PLACEHOLDER 为非空占位串', () => {
  assert.ok(typeof SAFE_PLACEHOLDER === 'string' && SAFE_PLACEHOLDER.length > 0);
});
