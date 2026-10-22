# 「赛博坦小镇 → 赛博坦9号星城」改名：语义/叙事层评审

本轮把用户可见设定从「赛博坦（自治）小镇」改名为太空殖民城市「赛博坦9号星城」（简称「星城」），覆盖后端消息文案、agent 语料、前端界面文字、README、决策书、两份 steering、以及 cybertron spec 下的 requirements/design/tasks/impl-plan。目标是在统一措辞的同时保留原有俏皮友好的「无趣之趣」调性，并且不触碰被明令保留的内部技术标识符与品牌/制度专有名词。

证据说明：该目录不是 git 仓库（`git` 在 `2-cybertron/` 及其父级均报 not a repository），因此无 `git diff`、无提交信息可读。本评审以「当前文件状态 + 全仓 grep 比对新旧措辞 + coder 在 `verification-note.md` 的记录」为依据。按要求没有重跑 `node --test`、没有做全量重验；仅对测试文件与被怀疑的留痕档案做了窄范围抽查。

Watch for:
- **（possible）改名后的 `node --test` 结果没有新的留痕**：`verification-note.md` 两段记录都描述的是改名前的版本（里面页面标题仍写「赛博坦 · Cybertron 自治小镇」、并断言「README 无需修正」），其 pass 34/0 对应的是改名前代码。本次改名动过测试输入串（`behavior.test.js`/集成测试里的 `'星城今天开心吗'`），但没有一条针对改名后代码的测试结果记录。属证据缺口，非已知代码缺陷（见下文测试一节的理由）。
- **（confirmed）三份评审留痕档案仍含旧词「小镇/镇子」**：`verification-note.md`、`code-review.md`、`design-review.md`。按本任务第 4 点，这三份 `.kiro/specs/cybertron/` 下的留痕档案不动是被允许的，不计为阻断性问题，此处仅作记录。

**Verdict**: APPROVED

## 高层视图

文案改名做得干净、非机械替换。用户可见面（server 的 `ask_rejected`/`ask_queued` 文案、behavior.js 五人格语料、index.html/theme.css 界面、README、决策书、两份 steering、requirements/design/tasks/impl-plan）里旧词「小镇/自治小镇/镇子」已全部清除，统一成「9号星城」或简称「星城」，并把世界观从「自治小镇」升格为「殖民城市 / 可俯瞰的赛博电子鱼缸星城」，读起来自然连贯。

调性保持住了。后端那些友好提示（「9号星城暂时打烊，公民们都休眠了~」「星城里排队的问题有点多，稍后再试~」）和决议收束语（「9号星城决定带着这些想法，继续温柔地运转下去」）延续了原来的俏皮口吻；居民统称仍用「公民」，与殖民城市设定比「镇民」更贴。

被明令保留的内部技术标识符全部原封未动：文件名 `town-server.js` / `town-map.js`、类名 `TownMap`、package.json 的 `name: cybertron-town-server` 与 `main`/`scripts`、日志前缀 `[town-server]`、DOM id `town-map`、`import` 路径与变量名均未被改名波及。

品牌与制度专有名词保留正确：品牌「赛博坦 / Cybertron」未被改掉；「赛博坦决议」「赛博坦宪章」保持原样，没有被啰嗦地改成「赛博坦9号星城决议/宪章」——对这两个词的 grep 零命中，说明没有过度替换。

唯一需要留意的是测试证据的时效性：改名后没有新的 `node --test` 留痕，但改动性质（纯文案 + 测试输入串）不触及任何断言，故不构成阻断。

<details>
<summary>Issues (2)</summary>

1. **改名后缺新测试留痕（possible）** — `verification-note.md` 记录的是改名前版本的 34/0；本次动过测试输入串但无改名后的 `node --test` 结果留痕。改动是纯文案+输入串、不碰断言，不阻断；建议补跑一次 `cd server && npm test` 并追加一行记录以闭合证据。
2. **三份评审留痕仍含「小镇/镇子」（confirmed，非问题）** — `verification-note.md`/`code-review.md`/`design-review.md`。按任务第 4 点属允许不动，仅记录；如追求全仓一致可日后一并刷新。

</details>

<details>
<summary>Details</summary>

### 用户可见文案已统一到「9号星城」，且非机械替换

全仓按文件统计旧词命中：`grep -rl 小镇`（排除 node_modules）只剩 `.kiro/specs/cybertron/` 下的 `verification-note.md`、`code-review.md`、`design-review.md` 三份；`镇子/本镇/镇里/镇民/全镇` 的命中也全部落在 `verification-note.md`。所有运行期/用户可见文件——`server/town-server.js`、`server/behavior.js`、`app/index.html`、`app/css/theme.css`、`app/js/*`、`README.md`、`00-思路与决策.md`、`.kiro/steering/*`、`requirements.md`/`design.md`/`tasks.md`/`impl-plan.md`——旧词零命中。

改名不是逐字替换，而是把设定整体升格。requirements 概述现在是「赛博坦9号星城是一个『人类只能买票围观的 AI 殖民城市』」；决策书一句话卖点同样是「AI 殖民城市——赛博坦9号星城」；README 导语是「一座你只能围观、不能操纵的赛博霓虹殖民城市『赛博坦9号星城』」。原先的「自治小镇」框架已被「殖民城市 / 可俯瞰的赛博电子鱼缸星城」替代，`grep 自治` 在用户可见面零命中。简称「星城」在正文、地图标签、config 注释里自然承接全称，没有每次都写满「赛博坦9号星城」的累赘感。

调性延续方面，后端全部提示语仍是俏皮口吻：

```
EMPTY        问题不能为空哦~
TOO_LONG     问题太长啦，精简一下再问~
CHARTER      这个话题不符合赛博坦宪章，换一个吧~
NO_AWAKE     9号星城暂时打烊，公民们都休眠了~
QUEUE_FULL   星城里排队的问题有点多，稍后再试~
ask_queued   星城正在讨论上一个问题，已为你排队~
```

behavior.js 的剧本决议收束 `关于「${question}」，赛博坦听取了各位公民的声音：${stances}。综上，9号星城决定带着这些想法，继续温柔地运转下去。` 把品牌（赛博坦听取）与地名（9号星城决定）各安其位，读起来顺，没有把「赛博坦」硬塞进地名或反过来。五人格语料里的「星城主街路灯」「这星城里就没有我不知道的事儿~」等替换也贴合语境。前端 index.html 标题 `赛博坦 · Cybertron 9号星城`、h1 `赛博坦 Cybertron · 9号星城`、tagline「人类只能围观，不能操纵。公民 agent 自主生活、讨论与决议。」均自然。

### 内部技术标识符原封未动

被明令保留的标识符逐一核对均未受改名影响：

- 文件名：`server/town-server.js`、`app/js/town-map.js` 均在；`town-server.js` 自识别逻辑 `entry.endsWith('town-server.js')` 保留。
- 类名：`app/js/town-map.js` 的 `export class TownMap`、`main.js` 的 `import { TownMap }` 与 `new TownMap(...)` 原样。
- DOM / 变量：`main.js` 的 `getElementById('town-map')`、局部变量 `townMap` 未动。
- package.json：`name: "cybertron-town-server"`、`main: "town-server.js"`、`scripts.start: "node town-server.js"`、`scripts.test: "node --test"` 全部保留；仅 `description` 字段文案含「9号星城」属可改的描述性文字，非标识符。
- 日志前缀：`console.log('[town-server] listening ...')` 与 `[town-server] 言行轨道：...` 两处前缀原样。

没有发现任何把 `town` 误改成 `star`/`city` 一类波及标识符的痕迹。

### 品牌与制度专有名词保留

品牌「赛博坦 / Cybertron」在标题、package 名、charter、README 等处均保留。制度名词未被改名污染：针对 `赛博坦9号星城决议`、`9号星城决议`、`赛博坦9号星城宪章`、`9号星城宪章` 的 grep **零命中**，说明「赛博坦决议」「赛博坦宪章」没有被啰嗦地加上「9号星城」。两词仍以原形广泛存在（`赛博坦决议` 命中落在 theme.css/event-feed.js/behavior.js/README/requirements 等；`赛博坦宪章` 命中落在 charter.js/town-server.js/steering/requirements 等）。charter 里红线条款中的「赛博坦」指世界/品牌层面（如「不在赛博坦引入 agent 婚姻」「不把现实政治代入赛博坦」），保留原样是正确的，不该替换成地名。

### 测试：无改名后留痕，但改动性质不触及断言

`verification-note.md` 两段记录均为改名前版本——其中浏览器实测写「页面标题『赛博坦 · Cybertron 自治小镇』」、并断言「README 无需修正」，与当前已改名的 index.html（标题 `9号星城`）和 README（导语 `殖民城市「赛博坦9号星城」`）不符，可确认该记录早于本次改名，其 `pass 34 / fail 0` 对应的是改名前代码。

本次改名动过测试里的输入串：`behavior.test.js` 的 `generateSpeech(agent, '星城今天开心吗', ...)` / `summarizeResolution('星城今天开心吗', ...)` 与集成测试 `handleVisitorAsk(world, '星城今天开心吗', deps)` 都已是新措辞。抽查这些测试的断言可见它们只校验结构性结果——`assert.equal(resolutions.length, 1, '恰好一条决议')`、帧类型、`reason` 枚举、能量/状态数值——没有任何一条对 agent 产出或 server `message` 做精确中文串断言。因此文案改名与输入串改名都不会触动断言，34/0 在改名后大概率仍成立。

据此判断：改名未改动任何断言逻辑，输入串改动是合理且与改名一致的；缺的只是一次改名后 `node --test` 的结果留痕。这是证据缺口（possible），不是已知失败，故不作阻断。补一次 `cd server && npm test` 并在 verification-note 追加一行即可闭合。

### 评审留痕档案的旧词属允许范围

`verification-note.md`、`code-review.md`、`design-review.md` 三份 `.kiro/specs/cybertron/` 下的留痕仍含「小镇/镇子」（如 code-review「### 1. 小镇地图与 agent 节点」、design-review「小镇地图（需求 1 / 验收 1）」、verification-note 多处）。按本任务第 4 点，这些留痕档案不动是被允许的、不计阻断。它们的内在一致性也未被破坏（都是对历史版本的如实记录）。如追求全仓措辞一致，可日后统一刷新，但与本次改名的验收无关。

</details>

<details>
<summary>文件清单（参考）</summary>

无 git，以下为与改名相关、已核对的文件及其改名层面结论：

- `server/town-server.js` — 文件头注释与 6 条用户提示文案改为「9号星城/星城」；标识符/日志前缀/自识别逻辑未动。
- `server/behavior.js` — 五人格语料与 LLM system prompt、剧本决议收束改为「9号星城/星城」；品牌「赛博坦」保留。
- `server/package.json` — 仅 `description` 文案含「9号星城」；`name`/`main`/`scripts` 标识符未动。
- `app/index.html` — 标题、h1、tagline、地图区 label 改为「9号星城/星城」。
- `app/css/theme.css` — 头注释与地图分区注释改为「9号星城/星城」；「赛博坦决议」高亮卡片文案保留。
- `app/js/town-map.js`、`app/js/config.js` — 注释改为「星城」；`TownMap` 类名、`town-map` 相关标识符未动。
- `app/js/event-feed.js`、`app/js/ask-box.js` — 「赛博坦决议」字样与提示文案保留/自然。
- `README.md`、`00-思路与决策.md` — 导语/卖点/玩法改为「殖民城市 / 赛博坦9号星城 / 星城」；「赛博坦决议」「赛博坦宪章」保留。
- `.kiro/steering/视觉风格.md`、`.kiro/steering/赛博坦宪章.md` — 视觉风格改为「星城」；宪章中世界/品牌层面的「赛博坦」保留。
- `.kiro/specs/cybertron/requirements.md`、`design.md`、`tasks.md`、`impl-plan.md` — 设定与地图/提示文案改为「9号星城/星城」；制度名词保留。
- `.kiro/specs/cybertron/verification-note.md`、`code-review.md`、`design-review.md` — 留痕档案，仍含旧词「小镇/镇子」，按任务允许不动。
- `server/*.test.js` — 测试输入串已改为「星城」；断言为结构性、不含精确中文串断言。

</details>
