# 代码评审 · 赛博坦（Cybertron）MVP 第一次迭代

> 评审对象：`2-cybertron/` 实现，对照 `.kiro/specs/cybertron/{requirements,design,impl-plan}.md`。
> 验证证据：`.kiro/specs/cybertron/verification-note.md`（coder 记录）。本仓库非 git 仓库，无提交记录可读，验证证据以 verification-note.md 为准。
> 结论：**APPROVED**，无阻塞 finding。

## 评审范围与方法

- 阅读了全部实现源码：`server/{world,charter,behavior,town-server}.js`、`server/*.test.js`、`app/index.html`、`app/css/theme.css`、`app/js/{config,ws-client,store,town-map,event-feed,ask-box,main}.js`、`README.md`、`.env.example`、`.gitignore`。
- 对照 design.md（§2/§3/§4/§5/§6/§7/§8/§9/§10/§11/§12/§14）与 impl-plan 的 12 步逐项核对。
- 验证是 coder 职责。阅读 verification-note.md 作为验证证据，并与测试源码交叉核对其断言；未重跑整套测试（证据完整、无具体可指明疑点）。

## 验证证据核验

verification-note.md 记录具体可核：
- 依赖安装 `ws@8.18.0`、`node --test` 34/34 通过；逐文件列出覆盖点。
- 实启后端 + ws 客户端：心跳自动推送 agent_event、合法提问→discussion_start/speak/恰一条 resolution、能量耗尽 asleep、违宪问题 ask_rejected{CHARTER}、作息闭环（耗尽→睡觉→天恢复满能量亮灯）。
- 前端静态托管 + Playwright 实测：四要素渲染、轨道角标、控制台 0 error/0 warning。
- 无 key 环境确认走剧本分支、无报错。密钥卫生、清理。

交叉核对：所列断言均能在 `town-server.integration.test.js` / `world.test.js` / `charter.test.js` / `behavior.test.js` 中找到对应用例（见下文各项），证据可信。

## 五件套与硬约束核对

### 1. 小镇地图与 agent 节点（名字/人格/状态/能量条）
- `world.js AGENT_CONFIG` 固定 5 个 agent（落在 4–6），含 id/name/persona/归一化 home。
- `makeSnapshot` 下发 name/persona/status/energy/energyMax/crystals/home；`town-map.js` 渲染家节点、名字、人格标签、能量条（width=energy/energyMax）、晶体角标，active 亮灯/asleep 熄灯用 class 切换。
- 前端初始全量来自 `world_state` 快照，不自造数据（store.applyWorldState 全量覆盖）。符合需求 1.1–1.5。

### 2. Agent 自主生活（后端心跳驱动、前端只渲染、游客不可操纵）
- 后端 `setInterval → tick()` 驱动，自旋锁 `world.ticking` 串行化（§3.2）。idle 段按 AUTONOMY_CHANCE 触发 `generateEvent`，串门 visit 点名他人并以 VISIT_REPLY_CHANCE 触发下一 tick 回应（社会性，需求 2.4）。
- 前端 store 为只读镜像，`agent_update` 为部分字段 patch（仅 status/energy/energyMax/crystals，保留 name/persona/home，未知 agentId 忽略），从不自推进 tick/能量（NFR-3）。
- **硬规则（宪章 5）**：上行白名单仅 `hello/visitor_ask/ping`，`routeMessage` default 分支对未知/越权帧静默丢弃、不断连、不改状态；集成测试用 `set_agent_energy`/`move_agent` 验证世界不变、连接不断。符合需求 2.5 / 9.4。

### 3. 广播提问 → 多 agent 协作 → 赛博坦决议
- `handleVisitorAsk` 前置校验（非字符串/空→EMPTY、>200→TOO_LONG、宪章命中→CHARTER）+ 宪章过滤，不入链路不改世界。
- 讨论用独立链式 `setTimeout(step)` 步进，与心跳解耦；逐步 `discussion_speak`，队空本步并入 `settleResolution`，产出**恰一条** `resolution`（集成测试断言 resolutions.length===1）。决议带专门帧型，前端 event-feed 用告警橙高亮卡片区分。
- 全员睡着→NO_AWAKE_AGENT 友好提示不产决议（需求 3.6）；并发用 phase 软锁 + askQueue 排队（ask_queued 成功 vs QUEUE_FULL 拒绝，帧名区分），事件不交叉（需求 3.7）。符合需求 3.1–3.7。

### 4. Token 经济（纯函数）
- `world.js` 纯函数 `applyCost`/`reward`/`recoverDay` 无 I/O，不变量 `0≤energy≤energyMax` 且 `energy≤0⇔睡觉`（reward/recoverDay 补能唤醒同步改 status）集中维护。常量组 ENERGY_MAX=48/COST{autonomy:6,speak:10}/CRYSTAL_REWARD=1/CRYSTAL_TO_ENERGY=20/ADOPTED_COUNT=2/TICKS_PER_DAY=24 与 design §9/§14 一致。
- 耗尽睡觉熄灯、按天 recoverDay 恢复满能量唤醒亮灯；被采纳 reward 补能并唤醒（MEDIUM-1 方案 A）。
- 核心逻辑为可单测纯函数：`world.test.js` 覆盖扣到 0 睡觉/未到不睡/不为负、reward 晶体+/不溢出/睡着补能唤醒 wokeNow、recoverDay、采纳边界 min(ADOPTED_COUNT, spoken.length)。符合需求 4.1–4.7、NFR-5。

### 5. 宪章护栏（运行时兜底过滤，可单测纯函数）
- `charter.js charterCheck` 纯函数，六类词表（harm/adult/violence/fraud/marriage/politics，politics 用中性制度词锚点），`String().toLowerCase()` 子串匹配，无副作用。
- 运行时两处兜底：游客输入命中→ask_rejected{CHARTER}（§5.1）；agent 产出推送前 `sanitizeOutput` 先过滤（命中整条换 SAFE_PLACEHOLDER）后按 MAX_TEXT=280 截断（NIT-2，先过滤后截断，红线不因截断漏过），剧本/真模型两轨一致。
- `charter.test.js` 覆盖六类命中锚点+类别、正常放行、大小写/子串/非字符串边界、词表冻结。符合需求 9.1–9.5。

### 6. LLM 双轨优雅降级
- `resolveMode` 仅从 `process.env.CYBERTRON_LLM_API_KEY` 读取并 trim 判定；无 key→{mode:'script',llm:null} 静默走剧本、不发外部请求、不报错；有 key→真模型轨。
- `makeLlmCaller` 用原生 fetch + AbortController 8s 超时，非 2xx/空返回/异常均抛给上层由生成函数 try/catch 回退剧本；真模型产出同样过宪章过滤（调用方 sanitizeOutput）。
- key 只从环境变量读取，未写入任何代码/配置/提交物（全库 grep `sk-[A-Za-z0-9]{20}` 无匹配）；`.env.example` 仅三行 key 名、等号后无值；`.gitignore` 忽略 `.env`/`node_modules/`/`.DS_Store`。
- `behavior.test.js` 覆盖无 key→script、有 key→llm、注入必抛错 llm 仍回退剧本、llm 正常返回用模型产出。符合需求 5.1–5.5、NFR-4。

### 7. 前端零构建原生 ES Module、深色赛博霓虹、一屏四要素、只渲染
- `index.html` lang=zh，`<script type="module">` 入口，内联 emoji favicon；四要素齐备（小镇地图、实时事件流、提问框、能量/晶体随节点呈现）+ 轨道角标。
- `theme.css` 五个锁定配色仅在 `:root` 出现（grep 确认），其余引用变量。
- 前端只渲染：store 只读镜像、ws-client 无业务状态、town-map/event-feed 纯渲染（含 XSS 转义）。符合 NFR-1、design §10、视觉 Steering。

### 8. 测试覆盖
- token 经济纯函数（world.test.js）、宪章过滤纯函数（charter.test.js）、后端事件流/提问讨论集成测试（town-server.integration.test.js：合法提问全链路、发言后睡着被采纳、超长含红线词替换、CHARTER 拒绝、排队 vs 队满、全员睡着、端到端纯自主耗尽→睡觉→天恢复、recentEvents≤30 只含事件 kind、真实 ws 首帧/越权/ping-pong/hello 前忽略）。覆盖面与 design §12 一致。

### 9. README（中文）
- 玩法、本地运行确切命令（后端 npm install/start、前端静态服务器 + 不能用 file:// 说明、npm test）、LLM 环境变量名与表格、技术架构图、宪章合规（内容过滤 + 结构性护栏）、demo 说明（≤200 字）、Kiro 能力清单与证据路径（Spec/Steering/Hook）齐备。

## 其它核对

- `step()`/`runStep()` 导出版本不自置 `world.ticking`（仅供测试直接驱动）；生产路径中 `scheduleStep` 定时器与 `setInterval` 心跳均检查并置位 `world.ticking`，无 tick 与 step 并发改写共享状态的竞态。非阻塞。
- `agent_update` patch 语义前后端一致；`recentEvents` 仅由 `pushRecent` 维护、FIFO 上限 30、不收 agent_update。
- 定时器 `unref()`、`stop()` 清理 interval/step timer/连接，集成测试进程可正常退出。

## 结论

对照 requirements / design / impl-plan，五件套与全部硬约束均已正确落地，验证证据完整且与测试源码一致。未发现可达的正确性、安全或数据失败类阻塞问题。

**裁决：APPROVED（无阻塞 finding）。**
