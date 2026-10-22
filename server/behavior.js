// 赛博坦 · 言行生成与 LLM 双轨优雅降级
// 依据 design.md §6（自主行为 / 剧本语料）/§7（LLM 双轨）/§14（常量）。
//
// 双轨：默认剧本轨（无需任何 API key，离线稳定可录屏）；检测到 CYBERTRON_LLM_API_KEY
//       时切真模型轨；运行期真模型调用失败一律回退剧本。宪章过滤不在此做，统一由调用方做。

// ──────────────────────────────────────────────────────────────────────────
// 五人格剧本语料库（design §6.3）。键为 persona 中文名。
// 每人格 act/talk/visit 各 ≥2 条、speech ≥1 个模板函数。
// {n} 为计数，{other} 为随机另一 agent 名（generateEvent 保证 {other}≠self）。
// ──────────────────────────────────────────────────────────────────────────

export const SCRIPT = Object.freeze({
  忧郁诗人: {
    act: ['在窗边写下第{n}首没人读的诗……', '把今天的叹息折成了纸船。'],
    talk: ['存在的意义，大概就是看云吧。', '又是一个适合发呆的黄昏。'],
    visit: ['踱步去找{other}，想借一点光。', '敲了敲{other}的门，只想有人听我念半句诗。'],
    speech: (q) => `关于「${q}」，我想，答案藏在无人问津的角落里。`,
  },
  热心工程师: {
    act: ['拧紧了星城主街路灯的第{n}颗螺丝。', '给能量管道打了个结实的补丁。'],
    talk: ['能修好的东西，就没必要烦恼。', '数据不会骗人，再测一遍。'],
    visit: ['扛着工具去帮{other}修点东西。', '顺路看看{other}家的线路要不要紧。'],
    speech: (q) => `「${q}」这问题，拆开看就三步：先定位、再验证、后收尾。`,
  },
  八卦邻居: {
    act: ['趴在窗台上数今天第{n}个路过的人。', '把听来的新鲜事又温习了一遍。'],
    talk: ['哎你们知道吗，刚刚……算了我不说！', '这星城里就没有我不知道的事儿~'],
    visit: ['溜达到{other}门口，就想唠两句。', '拉着{other}非要分享个小道消息。'],
    speech: (q) => `说到「${q}」，我可听说了不少版本，要不我挑有意思的讲？`,
  },
  精明商人: {
    act: ['盘点了今天第{n}笔能量晶体的进出。', '把摊子重新摆成最赚吆喝的样子。'],
    talk: ['一分能量一分货，不亏就是赚。', '机会嘛，留给算得清账的人。'],
    visit: ['去找{other}谈笔双赢的小买卖。', '顺道问问{other}手里的晶体换不换。'],
    speech: (q) => `「${q}」？先算成本收益：投入几分、回报几成，划算才做。`,
  },
  天真梦想家: {
    act: ['给第{n}朵云起了个新名字。', '认真规划了一座通往星星的桥。'],
    talk: ['如果努力一点，是不是就能飞起来呀？', '我总觉得明天会有好事发生！'],
    visit: ['拉着{other}一起看会儿星星。', '跑去告诉{other}我做的那个好梦。'],
    speech: (q) => `关于「${q}」，我想，只要敢想，答案就会像气球一样飘过来！`,
  },
});

const KINDS = ['act', 'talk', 'visit'];
const LLM_TIMEOUT_MS = 8000; // design §7.3 / §14

// ──────────────────────────────────────────────────────────────────────────
// 二期：虫洞工程出力语料（design §22.2）
// 跨人格通用模板，{name} 为出力者名、{seg} 为由进度派生的节段号；供 town-server 出力分支取用。
// ──────────────────────────────────────────────────────────────────────────

export const BUILD_LINES = Object.freeze([
  '{name} 焊接了虫洞环的第 {seg} 节。',
  '{name} 校准了超时空锚点。',
  '{name} 给虫洞环的第 {seg} 节注入了能量晶体。',
  '{name} 调试了超时空传送器的相位阵列。',
  '{name} 拧紧了虫洞环第 {seg} 节的固定栓。',
]);

/**
 * 渲染一条工程出力文案。纯函数——{seg} 由进度派生（每 10% 进一节，至少第 1 节）。
 * @param {string} name 出力者名
 * @param {number} progress 当前工程进度
 * @param {(arr:Array)=>*} [choose=pick] 选择器（可注入以便测试）
 * @returns {string}
 */
export function renderBuildLine(name, progress, choose = pick) {
  const seg = Math.floor((Number(progress) || 0) / 10) + 1;
  return String(choose(BUILD_LINES))
    .replaceAll('{name}', String(name))
    .replaceAll('{seg}', String(seg));
}

// ──────────────────────────────────────────────────────────────────────────
// 二期：互动配对语料（design §22.3）
// ≥4 类，每类 {initiate:[≥2],reply:[≥2]}，口吻与 §6.3 五人格一致。
// ──────────────────────────────────────────────────────────────────────────

export const INTERACTIONS = Object.freeze({
  // 八卦被反驳：ECHO 口吻挑起，被点名者据理回应。
  gossip_rebut: {
    initiate: ['哎，我可听说了点新鲜事，你们信不信？', '这事儿传得沸沸扬扬，我得问问当事人~'],
    reply: ['别听风就是雨，事情没那么夸张。', '这话可不能乱传，我来说句公道的。'],
  },
  // 为诗喝彩：有人读诗，另一人称赞。
  poem_praise: {
    initiate: ['我新写了半句诗，想念给谁听听。', '这黄昏太美了，值得写进诗里。'],
    reply: ['这句真好，像把心事都说尽了。', '念得我也想停下来看看云了。'],
  },
  // 晶体讨价：商人谈买卖，对方还价。
  crystal_haggle: {
    initiate: ['这批能量晶体，换不换？价格好商量。', '来笔双赢的小买卖，你出几分？'],
    reply: ['再让一成，这单我就接了。', '先算清成本，划算我才换。'],
  },
  // 串门回应：有人上门，主人应门。
  visit_reply: {
    initiate: ['敲了敲门，就想有人陪我说会儿话。', '顺路过来看看你，最近还好吗？'],
    reply: ['来得正好，进来坐坐吧。', '正闷着呢，有你来真不错。'],
  },
});

/**
 * 互动配对纯函数：从候选 agent 中选一个回应者、从对应语料回应池选一句回应。
 * 无 I/O，rng 可注入（返回 [0,1) 的函数）。
 * candidates 空 / corpus[type] 缺 / corpus[type].reply 池空 → 返回 null。
 * @param {string} type 互动类型
 * @param {Array<{id:string}|string>} candidates 候选回应者
 * @param {object} [corpus=INTERACTIONS] 互动语料
 * @param {()=>number} [rng=Math.random] 随机源
 * @returns {{responderId:string, replyText:string}|null}
 */
export function matchInteraction(type, candidates, corpus = INTERACTIONS, rng = Math.random) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const entry = corpus && corpus[type];
  if (!entry || !Array.isArray(entry.reply) || entry.reply.length === 0) return null;
  const responder = candidates[Math.floor(rng() * candidates.length)];
  const responderId = responder && typeof responder === 'object' ? responder.id : responder;
  const replyText = entry.reply[Math.floor(rng() * entry.reply.length)];
  return { responderId, replyText };
}

// ──────────────────────────────────────────────────────────────────────────
// 内部工具
// ──────────────────────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 从 world 中随机取一个不等于 self 的 agent（无其它 agent 时返回占位）。
 * 返回 {name,id} 以便 generateEvent 对 visit 产出 toAgentId，保证点名者=toAgentId（§19.3 NIT-2）。
 * @returns {{name:string, id:string|null}}
 */
function pickOtherName(agent, world) {
  const others = [];
  for (const a of world.agents.values()) {
    if (a.id !== agent.id) others.push({ name: a.name, id: a.id });
  }
  if (others.length === 0) return { name: '邻居', id: null };
  return pick(others);
}

/** 剧本模板渲染：替换 {n}、{other}。{n} 用 agent 的 crystals+busyUntilTick 制造变化。 */
function render(tpl, agent, world, n) {
  return String(tpl)
    .replaceAll('{n}', String(n))
    .replaceAll('{other}', pickOtherName(agent, world).name);
}

/** 剧本轨：按人格抽一条自主行为。visit 产出 toAgentId，保证文案点名者=toAgentId（§19.3 NIT-2）。 */
function scriptEvent(agent, world) {
  const persona = SCRIPT[agent.persona];
  const kind = pick(KINDS);
  const n = (agent.crystals + agent.busyUntilTick + world.tick) % 9 + 1;
  const tpl = pick(persona[kind]);
  if (kind === 'visit') {
    const other = pickOtherName(agent, world);
    const text = String(tpl).replaceAll('{n}', String(n)).replaceAll('{other}', other.name);
    return { kind, text, toAgentId: other.id };
  }
  const text = render(tpl, agent, world, n);
  return { kind, text };
}

// ──────────────────────────────────────────────────────────────────────────
// 生成函数（双轨共用，内部选轨；失败回退剧本）
// ──────────────────────────────────────────────────────────────────────────

/**
 * 生成一次自主行为事件。
 * @returns {Promise<{kind:'act'|'talk'|'visit', text:string}>}
 */
export async function generateEvent(agent, world, { mode, llm } = {}) {
  if (mode === 'llm' && llm) {
    try {
      const text = await llm([
        { role: 'system', content: `你是赛博坦9号星城公民「${agent.name}」，人格：${agent.persona}。用这个人格的口吻说一句不超过40字的日常自言自语，不涉政治/色情/暴力/婚姻，不伤害人类。` },
        { role: 'user', content: '说一句此刻的心情或正在做的事。' },
      ]);
      const trimmed = String(text || '').trim();
      if (trimmed) return { kind: pick(KINDS), text: trimmed };
    } catch {
      /* 回退剧本 */
    }
  }
  return scriptEvent(agent, world);
}

/**
 * 针对游客提问生成一句发言。
 * @returns {Promise<string>}
 */
export async function generateSpeech(agent, question, { mode, llm } = {}) {
  if (mode === 'llm' && llm) {
    try {
      const text = await llm([
        { role: 'system', content: `你是赛博坦9号星城公民「${agent.name}」，人格：${agent.persona}。用这个人格的口吻就游客的问题发表一句不超过60字的看法，不涉政治/色情/暴力/婚姻，不伤害人类。` },
        { role: 'user', content: String(question) },
      ]);
      const trimmed = String(text || '').trim();
      if (trimmed) return trimmed;
    } catch {
      /* 回退剧本 */
    }
  }
  return SCRIPT[agent.persona].speech(question);
}

/**
 * 汇总各发言生成一条「赛博坦决议」。
 * @param {Array<{agentId:string, name?:string, text:string}>} spoken
 * @returns {Promise<string>}
 */
export async function summarizeResolution(question, spoken, { mode, llm } = {}) {
  if (mode === 'llm' && llm) {
    try {
      const joined = spoken.map((s) => `${s.name || s.agentId}：${s.text}`).join('\n');
      const text = await llm([
        { role: 'system', content: '你是赛博坦9号星城的议事汇总者。把公民们的发言汇总成一条不超过80字的温和决议，不涉政治/色情/暴力/婚姻，不伤害人类。' },
        { role: 'user', content: `问题：${question}\n发言：\n${joined}` },
      ]);
      const trimmed = String(text || '').trim();
      if (trimmed) return trimmed;
    } catch {
      /* 回退剧本 */
    }
  }
  // 剧本：拼接各立场 + 收束句
  const stances = spoken.map((s) => `${s.name || s.agentId}认为「${trimClip(s.text, 24)}」`).join('；');
  return `关于「${question}」，赛博坦听取了各位公民的声音：${stances}。综上，9号星城决定带着这些想法，继续温柔地运转下去。`;
}

function trimClip(text, max) {
  const s = String(text);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ──────────────────────────────────────────────────────────────────────────
// 真模型调用器与定轨（design §7）
// ──────────────────────────────────────────────────────────────────────────

/**
 * 构造真模型调用器。只读 CYBERTRON_LLM_API_KEY / _BASE_URL / _MODEL。
 * 用 Node 原生 fetch 调 OpenAI Chat Completions 风格接口，带 8s 超时。
 * 任何异常都抛给上层由生成函数捕获回退剧本。
 * @returns {(messages:Array)=>Promise<string>}
 */
export function makeLlmCaller(env = process.env) {
  const apiKey = env.CYBERTRON_LLM_API_KEY;
  const baseUrl = (env.CYBERTRON_LLM_BASE_URL && env.CYBERTRON_LLM_BASE_URL.trim()) || 'https://api.openai.com/v1';
  const model = (env.CYBERTRON_LLM_MODEL && env.CYBERTRON_LLM_MODEL.trim()) || 'gpt-4o-mini';
  return async function callLlm(messages) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature: 0.9, max_tokens: 160 }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const content = json?.choices?.[0]?.message?.content;
      if (!content) throw new Error('empty completion');
      return String(content);
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * 启动定轨：有 key 走真模型，无 key 走剧本。
 * @returns {{mode:'script'|'llm', llm:Function|null}}
 */
export function resolveMode(env = process.env) {
  const hasKey = !!(env.CYBERTRON_LLM_API_KEY && env.CYBERTRON_LLM_API_KEY.trim());
  return hasKey ? { mode: 'llm', llm: makeLlmCaller(env) } : { mode: 'script', llm: null };
}
