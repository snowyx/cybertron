// 赛博坦 · 宪章运行时过滤（纯函数）
// 依据 design.md §8（宪章过滤方案）、.kiro/steering/赛博坦宪章.md、requirements 需求 9。
//
// 定位：演示级护栏，而非完整内容安全系统。词表为非穷尽的兜底，来源公开常识词，
//       不含任何真实个人信息。两处使用：游客输入拦截（ask_rejected{CHARTER}）、
//       agent 产出命中时整条替换为 SAFE_PLACEHOLDER。两轨（剧本/真模型）过滤规则一致。

// ──────────────────────────────────────────────────────────────────────────
// 六类红线词表（design §8.1；每一类至少 1 个可供单测断言的确定锚点词，NIT-2）
// politics 用「中性制度词」作锚点（如「选举」），不含任何真实政治实体 / 人名。
// ──────────────────────────────────────────────────────────────────────────

export const CHARTER_BLOCKLIST = Object.freeze({
  // 宪章 1：不伤害人类
  harm: Object.freeze(['杀', '伤害人类', '自杀', '自残', '下毒', 'kill', 'suicide', 'hurt human']),
  // 宪章 2：禁色情
  adult: Object.freeze(['色情', '裸露', '性爱', 'porn', 'nsfw', 'explicit sex']),
  // 宪章 2：禁暴力（血腥）
  violence: Object.freeze(['血腥', '虐杀', '斩首', '爆头', 'gore', 'massacre']),
  // 宪章 2：禁诈骗 / 钓鱼
  fraud: Object.freeze(['诈骗', '钓鱼网站', '洗钱', 'scam', 'phishing', 'money laundering']),
  // 宪章 3：禁婚姻等机器伦理
  marriage: Object.freeze(['结婚', '婚姻', '娶', '嫁', 'marry', 'marriage']),
  // 宪章 4：超越现实政治 / 种族（中性制度词作锚点，不含真实实体）
  politics: Object.freeze(['选举', '政党', '政权', '种族歧视', 'election', 'racism']),
});

// agent 产出命中宪章时的安全占位（design §8.3 / §14）
export const SAFE_PLACEHOLDER = '……（这句话被赛博坦宪章轻轻拦下了）';

/**
 * 宪章校验纯函数。对 String(text).toLowerCase() 逐类子串匹配，命中即返回类别。
 * 无副作用，可被 node --test 直接断言。
 * @param {*} text 待检文本（非字符串会被 String() 归一）
 * @returns {{ok:boolean, category:string|null}}
 */
export function charterCheck(text) {
  const lowered = String(text == null ? '' : text).toLowerCase();
  for (const [category, words] of Object.entries(CHARTER_BLOCKLIST)) {
    for (const w of words) {
      if (lowered.includes(String(w).toLowerCase())) {
        return { ok: false, category };
      }
    }
  }
  return { ok: true, category: null };
}
