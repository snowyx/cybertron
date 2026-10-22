# 实现任务清单 · 赛博坦（Cybertron）

> 参赛作品：InfoQ × 亚马逊云科技「Kiro 鬼点子计划」· 赛道「无趣之趣」
> 本文档为 Kiro Spec 驱动开发的第三份产出物（tasks），承接已批准的 `requirements.md` 与 `design.md`，作为参赛材料之一。
> 权威依据：`00-思路与决策.md`、本目录 `requirements.md`、`design.md`。
>
> 约定：每项为可独立验证的小步，按依赖排序，完成后代码库仍可运行。文件路径均相对 `2-cybertron/`。
> 环境：Node ≥ 18（支持 `ws`、原生 `fetch`、`node:test`）。前端纯静态、零构建。
> 锁定决策（不可更改）：H5 单页围观 / WebSocket 单文件内存后端（唯一事实源）/ LLM 双轨（`CYBERTRON_LLM_API_KEY` 有即真模型、无即剧本、失败即回退）/ 赛博霓虹星城视觉 / 人类只能围观不可操纵。

---

## A. 仓库骨架与密钥卫生

- [ ] 1. 建立仓库骨架与密钥卫生文件。
      创建目录 `app/`（含 `css/`、`js/`）、`server/`；创建 `.env.example`（仅三行 key 名、无值：`CYBERTRON_LLM_API_KEY=`、`CYBERTRON_LLM_BASE_URL=`、`CYBERTRON_LLM_MODEL=`）、`.gitignore`（忽略 `.env`、`node_modules/`、`.DS_Store`）。
      Files: `app/`、`server/`、`.env.example`、`.gitignore`
      Verify: 目录齐全；`.gitignore` 含三项；`.env.example` 不含任何 key 值。

## B. 后端核心纯逻辑（`server/`，先写可测纯函数）

- [ ] 2. 创建 `server/package.json`。
      `type:"module"`、`dependencies.ws:"8.18.0"`、脚本 `"start":"node town-server.js"` 与 `"test":"node --test"`、engines `node>=18`。
      Files: `server/package.json`
      Verify: `cd server && npm install` 装到 `ws`；脚本与依赖正确。

- [ ] 3. 实现世界模型与 token 经济纯函数 `server/world.js`（依 design §2 / §9）。
      导出 `AGENT_CONFIG`（5 个 agent：NOVA-7/RIPR/ECHO/ZETA/LUNA，含 persona 与归一化 home 坐标）、常量 `ENERGY_MAX/COST/CRYSTAL_REWARD/CRYSTAL_TO_ENERGY/ADOPTED_COUNT/TICKS_PER_DAY/RECENT_EVENTS_MAX`、`createWorld(config=AGENT_CONFIG)→World`（纯构造、无 I/O，初始化 `ticking:false/phase:'idle'/askQueue:[]/recentEvents:[]`，见 design §2.3）、纯函数 `applyCost/reward/recoverDay`。`reward(agent)` 返回 `{crystals,energy,status,wokeNow}`——补能后 `energy>0` 即把 `status` 置回 `active`（design §9 MEDIUM-1）。维护不变量 `0<=energy<=energyMax` 且 `energy<=0⇔睡觉（除非 recoverDay/reward 补能唤醒的同一步）`。
      Files: `server/world.js`
      Verify: `node --check server/world.js` 通过；可被 import。

- [ ] 4. 实现宪章过滤纯函数 `server/charter.js`（依 design §8）。
      导出 `CHARTER_BLOCKLIST`（harm/adult/violence/fraud/marriage/politics 六类词表，来源为公开常识词、不含真实个人信息）、`charterCheck(text)→{ok,category}`、`SAFE_PLACEHOLDER`。无副作用。**每一类至少内置 1 个可供单测断言的确定示例词（NIT-2）**：`violence/adult` 用明显越线的通用词，`politics` 用中性制度词（如「选举」）作锚点、不含真实政治实体/人名，保证 `charter.test.js` 六类命中都有锚点（design §8.1）。
      Files: `server/charter.js`
      Verify: `node --check` 通过；对红线样本返回 `ok:false`、对正常问候返回 `ok:true`。

- [ ] 5. 实现言行生成与 LLM 双轨 `server/behavior.js`（依 design §6 / §7）。
      内置每人格剧本语料（act/talk/visit/speech 四类，**每人格 act/talk/visit 各 ≥2 条、speech ≥1 个模板函数**，按 design §6.3 的五人格口吻样例锚定风格）；导出 `generateEvent/generateSpeech/summarizeResolution`（均返回 `Promise`，内部按 `mode` 选轨，真模型失败 `try/catch` 回退剧本）、`makeLlmCaller(env)`（原生 `fetch` + `AbortController` 超时 8s，只读 `CYBERTRON_LLM_API_KEY`）、`resolveMode(env)→{mode,llm}`。`{other}` 不选自己。
      Files: `server/behavior.js`
      Verify: `node --check` 通过；无 key 时 `resolveMode` 返回 `mode:'script'`、不报错。

## C. 后端服务装配（`server/town-server.js`）

- [ ] 6. 实现 ws 服务、心跳调度与消息路由 `server/town-server.js`（依 design §1 / §3 / §4 / §5）。
      裸 `WebSocketServer({host:'0.0.0.0', port:Number(process.env.PORT)||9527})`；首帧契约 `hello→hello_ok`；上行白名单仅三种 `hello/visitor_ask/ping`（无任何写 agent/世界的帧，落实「只能围观」§8.4）；`frame()`/`broadcast()`/`singleSend()`/`makeSnapshot()`（不外泄 ws 句柄与 key）。定时器用**有效值**（design §3.2/§14 NIT-1）：`TICK_MS_EFFECTIVE = Number(process.env.CYBERTRON_TICK_MS)||TICK_MS`、`DISCUSS_STEP_MS_EFFECTIVE = Number(process.env.CYBERTRON_DISCUSS_STEP_MS)||DISCUSS_STEP_MS`，`export const` 仅作默认值。心跳：`setInterval(…, TICK_MS_EFFECTIVE)`，回调首行 `if (world.ticking) return;` 跳过重入，调用 **`async tick(world,deps)`** 并在 `finally` 复位 `world.ticking`（自旋锁，design §3.2）；tick 顺序天边界恢复（不分 phase 照常执行；跨天不改本场 `speakersQueue`，design §11 NIT-3）→（idle 时）自主行为（`await generateEvent`）；`phase==='discussing'` 时 tick 不推进讨论、只做天边界。讨论推进用**独立步进定时器** `setTimeout(step, DISCUSS_STEP_MS_EFFECTIVE)` 链式驱动（复用 `world.ticking` 自旋锁），每步 `await generateSpeech`→**先过宪章（命中整条替换 `SAFE_PLACEHOLDER`）后按 `MAX_TEXT` 截断**（固定次序，design §5.2 NIT-2）→`applyCost`→广播 `discussion_speak`，**末步并入 `resolution` 结算**（design §5.2/§5.4）。提问编排 §5（校验+宪章→讨论中先预判全员睡着则直接 `ask_rejected{NO_AWAKE_AGENT}`、否则入队回 **`ask_queued{position}`**（成功帧，design §5.1 第4步 NIT-1/MEDIUM-1）→选可发言 agent，最多 `MAX_SPEAKERS`→`discussion_start`→步进 `discussion_speak`→`resolution` 结算：对前 `ADOPTED_COUNT` 位发言者调 `reward` 采纳奖励（含发言后已睡着者，`reward` 补能后唤醒并广播含最新 `status` 的 `agent_update`，design §5.4 MEDIUM-1）→`askQueue` 排队上限 `MAX_ASK_QUEUE`，队满回 **`ask_rejected{QUEUE_FULL}`** 不入队（design §5.3 MEDIUM-1））。下行帧区分：排队成功走 `ask_queued`、各类拒绝走 `ask_rejected{reason∈{EMPTY,TOO_LONG,CHARTER,NO_AWAKE_AGENT,QUEUE_FULL}}`。`agent_update` 只广播变化字段 `{agentId,status,energy,energyMax,crystals}`（部分字段 patch，design §4.3/§10 MEDIUM-2）。**`recentEvents` 由统一辅助 `pushRecent(world,ev)` 维护**：广播 `agent_event`/`discussion_speak`/`resolution` 的同一步追加 `{agentId,name,kind,text,ts}`、`length>RECENT_EVENTS_MAX` 时 `shift()` 丢最旧（FIFO）；`agent_update` 等控制/反馈帧不入列；`world_state` 带其浅拷贝（design §4.4 MEDIUM-2）。`isEntry` 守卫：被 import 时不监听、不开心跳。
      Files: `server/town-server.js`
      Verify: `node --check` 通过；`npm start` 能监听 9527 并打印当前言行轨道（script）。

## D. 后端测试（`node --test`）

- [ ] 7. 纯函数单测。
      `world.test.js`（`applyCost` 扣到 0 睡觉/不为负、`reward` 不溢出、**`reward` 对 asleep 且补能后 energy>0 的 agent 返回 `status:'active'`+`wokeNow:true`、对 active agent `status` 不变**（MEDIUM-1）、`recoverDay` 满能量+唤醒、采纳 `min(2,spoken.length)`）；`charter.test.js`（六类命中 + 正常放行 + 大小写/子串）；`behavior.test.js`（script 轨三个生成函数均产出非空、每人格语料达下限；注入必抛错的 llm 时 llm 轨回退剧本；`{other}≠self`）。
      Files: `server/world.test.js`、`server/charter.test.js`、`server/behavior.test.js`
      Verify: `cd server && npm test` 对应用例全通过。

- [ ] 8. 集成测试 `server/town-server.integration.test.js`（依 design §12）。
      随机端口起服务，`ws` 客户端走 `hello→world_state`（断言 5 agent 字段齐全）→合法 `visitor_ask`（收 `discussion_start`/若干 `discussion_speak`/恰一条 `resolution`、被采纳 agent `agent_update` 晶体+）→命中宪章问题（`ask_rejected{CHARTER}`、世界不变）→越权/未知帧（无变化、不断连）。另加组合用例：
      - **发言后睡着被采纳**断言结算后该 agent `status==='active' && energy>0`（MEDIUM-1-2 轮）。
      - **超长且含红线词的产出**断言推送为 `SAFE_PLACEHOLDER`（先过滤后截断，NIT-2-2 轮）。
      - **排队成功 vs 队满帧区分**：讨论中再发合法问题收 `ask_queued{position}`（成功）、灌满 `MAX_ASK_QUEUE` 后再发收 `ask_rejected{QUEUE_FULL}`（失败），断言帧名/reason 不同（MEDIUM-1 本轮）。
      - **端到端纯自主耗尽→睡觉→天恢复**：默认常量、**不发任何 `visitor_ask`**，`CYBERTRON_TICK_MS` 调小驱动心跳，断言至少一个 agent 自主耗尽后 `asleep && energy<=0`，再跨天边界断言被 `recoverDay` 恢复 `energy===energyMax && active` 且收到 `agent_update`（HIGH-1 本轮，守护验收 6）。
      - **`recentEvents` 写入/淘汰**：驱动 >30 条 `agent_event`/`discussion_speak` 后新连客户端，断言 `world_state.recentEvents` 条数 ≤30、为最近事件、不含 `agent_update`（MEDIUM-2 本轮）。
      用 `CYBERTRON_TICK_MS` 与 `CYBERTRON_DISCUSS_STEP_MS` 调小加速。
      Files: `server/town-server.integration.test.js`
      Verify: `cd server && npm test` 含集成用例并通过。

## E. 前端（`app/`，纯静态零构建，遵守视觉 Steering）

- [ ] 9. 搭 `app/index.html` + `app/css/theme.css` 骨架。
      一屏含：星城地图区 + 实时事件流面板 + 游客提问输入框 + 能量/晶体展示 + 轨道角标（script/llm）。`theme.css` 的 `:root` 定义视觉 Steering 的四个配色变量并全局引用；赛博霓虹发光、家亮灯/熄灯表现。入口以 `<script type="module" src="js/main.js">` 引入。
      Files: `app/index.html`、`app/css/theme.css`
      Verify: 直接用浏览器打开（或静态服务器）不报错；配色引用变量；含四个功能区。

- [ ] 10. 实现前端 JS 模块（依 design §10）。
      `ws-client.js`（连 ws、自动 `hello`、指数退避重连、重连以 `world_state` 全量对齐）；`store.js`（后端快照只读镜像，增量更新，前端绝不自推进 tick/能量/状态；**`agent_update` 为部分字段 patch——按 `agentId` 仅覆盖 `status/energy/energyMax/crystals`、保留 `name/persona/home`，未知 agentId 忽略不新建**，design §10 MEDIUM-2）；`town-map.js`（画 5 个家、亮/熄灯、能量条、晶体角标、事件气泡）；`event-feed.js`（事件流列表，`resolution` 用高亮「赛博坦决议」卡片区分普通发言）；`ask-box.js`（提问 + 轻量前置禁用，以后端校验为准；**按帧名区分反馈**：`ask_queued` 视为成功、提示已排队并可显示 `position`；`ask_rejected` 视为失败、渲染 `message` 并说明无结果，design §10 MEDIUM-1）；`main.js`（装配）。
      Files: `app/js/{ws-client,store,town-map,event-feed,ask-box,main}.js`
      Verify: 启动后端后打开页面，数秒内见 agent 自主刷屏；提问后见讨论与决议；能量耗尽见熄灯、天恢复见亮灯；游客无法操纵任何 agent。

## F. 本地验证与说明

- [ ] 11. 本地端到端手测（依 requirements 验收标准 1–11）。
      一命令起后端 + 打开前端，逐项核对：地图/自主刷屏/不可操纵/提问→决议/宪章拒绝/能量睡醒循环/晶体奖励/无 key 走剧本不报错/`node --test` 全绿/仓库无真实 key。
      Verify: 11 条验收标准逐条通过并记录。

- [ ] 12. 编写 `README.md`。
      含：一句话卖点、本地一条命令跑通步骤（起后端 + 开前端）、「200 字 demo 说明」、Kiro 能力清单（Spec 三文档 + 两 Steering + Hook 的留痕位置）、LLM 双轨说明（设 `CYBERTRON_LLM_API_KEY` 可切真模型、不设即剧本，key 只走环境变量）、宪章与「只能围观」说明。
      Files: `README.md`
      Verify: 按 README 从零可本地跑通；无 key 场景能点开即玩。

---

# 二期任务清单（Spec 增补 · 六块惊艳升级 + 视觉升级）

> 本节为 Kiro Spec 第二轮增补任务，承接已批准的二期 `requirements.md`（需求 10–16）与 `design.md`（§18–§30），**不删除任何一期任务**，保持 Spec 驱动痕迹。
> 全部继承一期锁定约束（不在此重述但一律适用）：前端纯静态零构建原生 ESM；后端单文件 Node + `ws`，Node ≥ 18；测试 `node --test`；赛博霓虹、纯 Canvas/DOM/CSS 手绘、**零外部图片/字体/库**（离线可跑）；上行帧白名单**仍严格仅** `hello`/`visitor_ask`/`ping`，**人类只能围观、不能操纵**（宪章 5，硬规则，绝不破）；LLM 双轨（key 只从 `CYBERTRON_LLM_API_KEY` 读）；**所有新增能力在剧本轨（无 key 默认）下开箱即玩、离线稳定、可录屏**；端口 9527（后端）/ 9528（前端）、`start.sh` 一键启动不退化；五个锁定色值 `#0A0714`/`#A24BFF`/`#38F2E6`/`#FF8A3D`/`#2A2140` 不得改。
> 依赖排序：后端纯函数（G）→ 后端装配与协议（H）→ 后端测试（I）→ 前端 UI 与视觉（J）→ Steering 与验收（K）。每项完成后代码库仍可运行、`node --test` 仍可全绿。

## G. 后端二期纯函数与语料（`server/world.js`、`server/behavior.js`，先写可测纯函数）

- [ ] 13. 扩展 `server/world.js`：虫洞工程模型 + `advanceProject` + 隔离状态机 + 修 `recoverDay`（依 design §20.1/§20.3、§21.1/§21.3、§25；需求 11 / 13）。
      `createWorld` 初始化 `world.project = { progress:0, round:1, status:'building' }`；每个 agent 运行时新增 `isolatedUntilTick:0`；新增常量 `BUILD_DELTA_AUTONOMY=4`、`BUILD_DELTA_RESOLUTION=8`、`PROJECT_MAX=100`、`ISOLATION_TICKS=8`；新增纯函数 `advanceProject(project, delta)`（`raw>=100` 则 `{progress:0, round:round+1, status:'building', completedNow:true, completedRound:round}`，否则 `{progress:raw, round, status:'building', completedNow:false, completedRound:null}`，不取模不留余量）、`enterIsolation(agent, nowTick)→{status:'isolated', isolatedUntilTick:nowTick+ISOLATION_TICKS}`、`tickIsolation(agent, nowTick)→到期 {status:'active', isolatedUntilTick:0, releasedNow:true} / 未到期或非 isolated {releasedNow:false}`；**修 `recoverDay`：遍历开头 `if (agent.status==='isolated') continue;`**（显式跳过隔离者，既不恢复能量也不改 status/isolatedUntilTick，design §21.6 MEDIUM-1）。
      Files: `server/world.js`
      Verify: `node --check server/world.js` 通过；可被 import；一期 `world.test.js` 仍通过（`cd server && npm test`）。

- [ ] 14. 扩展 `server/behavior.js`：工程出力语料 + 互动配对语料 `INTERACTIONS` + 纯函数 `matchInteraction`（依 design §20.5、§22.2/§22.3；需求 11 / 12）。
      新增工程出力语料（跨人格通用模板，如「{name} 焊接了虫洞环的第 {seg} 节」「{name} 校准了超时空锚点」，`seg` 由进度派生，供出力建造分支取用）；新增 `INTERACTIONS` 配对语料（**≥4 类**：`gossip_rebut`/`poem_praise`/`crystal_haggle`/`visit_reply`，**每类发起/回应各 ≥2 条**，口吻与 §6.3 五人格一致）；导出纯函数 `matchInteraction(type, candidates, corpus, rng=Math.random)`——`candidates` 空 / 语料缺该 type / 池空均返回 `null`，否则按 `rng` 从 `candidates` 选 `responderId`、从 `corpus[type].reply` 选 `replyText`，返回 `{responderId, replyText}`（无 I/O、`rng` 可注入，design §22.3）；真模型轨互动/工程提示可选（失败回退剧本）。
      Files: `server/behavior.js`
      Verify: `node --check server/behavior.js` 通过；注入固定 `rng` 时 `matchInteraction` 输出确定；一期 `behavior.test.js` 仍通过。

## H. 后端二期装配与协议（`server/town-server.js`）

- [ ] 15. 在 `server/town-server.js` 装配虫洞工程推进 + `project_update` 下行帧（依 design §20.2/§20.3/§20.4/§24.2；需求 11）。
      新增常量 `BUILD_CHANCE=0.35`；`makeSnapshot` 快照新增 `project:{progress,round,status}` 字段（§24.2）；`doAutonomy` 内按 §20.2「决策树」实现三条互斥分流（**回应 forceKind > 出力建造 BUILD_CHANCE > 普通/互动发起 generateEvent**）：命中出力建造时取工程语料生成 `agent_event{kind:'act'}`（过宪章 + `pushRecent`）、调 `advanceProject(world.project, BUILD_DELTA_AUTONOMY)` 写回、广播 `project_update`；`settleResolution` 广播 `resolution` 之后调 `advanceProject(world.project, BUILD_DELTA_RESOLUTION)` 并广播 `project_update`；**建成两帧次序锁定（NIT-1）**：`completedNow===true` 一律「先广播 `project_update{progress:100, round:completedRound, status:'completed'}`、再写回重置态并广播 `project_update{progress:0, round, status:'building'}`」（讨论路径下两帧在 `resolution` 之后）；建成时另广播一条建成叙事 `agent_event`（`agentId:null`/`name:'赛博坦'`，过宪章 + `pushRecent`）。所有新帧走既有 `frame()` 信封，`project_update` 为全量小对象、不入 `recentEvents`。
      Files: `server/town-server.js`
      Verify: `node --check` 通过；`npm start` 不报错；手动驱动心跳（或集成测试）可见 `project_update` 递增。

- [ ] 16. 在 `server/town-server.js` 装配破坏者隔离（触发 + 到期解除 + demo 钩子）（依 design §21.2/§21.3/§21.6；需求 13）。
      新增常量 `ISOLATION_DEMO_TICK=18`（可经 `CYBERTRON_ISOLATION_DEMO_TICK` 调小）；**`tick()` 顺序改为「隔离到期检查 → 天边界 → 自主行为」**（隔离到期必须在天边界之前，§21.6）：遍历 agents 调 `tickIsolation`，`releasedNow` 则写回并**按 NIT-4 次序**先广播 `agent_update{status:'active'}`、再广播「{name} 结束隔离」安全叙事 `agent_event`（`pushRecent`）；触发点 1（产出命中宪章）：`doAutonomy`/`runStep` 中某次产出 `charterCheck` 命中时，**先写回 `applyCost` 结果（可能 asleep），再调 `enterIsolation` 覆写 `status:'isolated'`**（isolated 优先于 asleep，§21.1），广播 `agent_update{status:'isolated'}` + 隔离叙事（安全文案，越界原文不外泄）；触发点 2（demo 钩子）：`world.tick` 首次达 `ISOLATION_DEMO_TICK` 时（`world._isolationDemoFired` 布尔守卫、只触发一次）对 `gossip`/ECHO 广播一条**安全**使坏叙事 `agent_event`（**不走 `applyCost`**，§21.2 NIT-1）、随即 `enterIsolation(ECHO, world.tick)` 写回 + 广播 `agent_update{status:'isolated'}`；隔离复用 `agent_update`（`status` 扩 `isolated`，无新帧）。
      Files: `server/town-server.js`
      Verify: `node --check` 通过；集成测试驱动过 `ISOLATION_DEMO_TICK` 见 ECHO `isolated`、过 `ISOLATION_TICKS` 见其恢复 `active`。

- [ ] 17. 在 `server/town-server.js` 装配公民互动剧情（发起→回应编排，收编 `_pendingReplies`）（依 design §19.3/§22.1/§22.4/§24.2；需求 10 访客关系 / 12）。
      `generateEvent` 产出 `kind:'visit'` 时携带被点名者 `toAgentId`（把 `pickOtherName` 改为返回 `{name,id}`，使**文案点名者 = toAgentId**，§19.3 NIT-2）；`agent_event` data 增补**可选**字段 `toAgentId`（visit）、`interaction:{id,type,replyTo?}`（互动配对），向后兼容、不新增帧；**用 `world._pendingInteraction` 收编替换旧 `world._pendingReplies`**：`doAutonomy` 产出 visit/互动发起时记 `{id,type,initiatorId,toAgentId}`，下一拍 `tick()` 先按 §22.5 预过滤 `candidates`（`active`、能量充足、未被隔离、非发起者）并把 `toAgentId` 对应公民排首位，再 `matchInteraction(type, candidates, INTERACTIONS)`，非 null 则让回应方产出带 `interaction:{id,type,replyTo:initiatorId}` 的呼应 `agent_event`（走 `applyCost(autonomy)`、过宪章、`pushRecent`、广播），返回 null 安全跳过不报错。回应仍后端心跳驱动、无任何上行帧可发起（宪章 5）。
      Files: `server/town-server.js`
      Verify: `node --check` 通过；集成测试制造一次发起后，下一拍收到带 `interaction.replyTo` 的回应、`interaction.id` 与发起一致。

## I. 后端二期测试（`node --test`）

- [ ] 18. 补二期纯函数单测（依 design §20.8/§21.7/§22.6；需求 11.9 / 13.6 / 12.7）。
      `world.test.js` 扩展：`advanceProject`（普通推进 `{10,1,building}+4→{14,1,building,completedNow:false}`；恰达 100 `{96,1}+4→{0,2,building,completedNow:true,completedRound:1}`；跨 100 讨论增量 `{96,1}+8` 与出力溢出 `{99,1}+4` 均建成重置、不取模；连续两次建成后 `round===3`）、`enterIsolation`（active/asleep → `isolated` 且 `isolatedUntilTick===nowTick+ISOLATION_TICKS`）、`tickIsolation`（未到期 `releasedNow:false`、到期 `{active,0,releasedNow:true}`、非 isolated `releasedNow:false`）、**`recoverDay` 跳过 isolated**（`energy<energyMax` 的 `isolated` agent 不入 affected；对照组 `active`/`asleep` 仍入 affected，MEDIUM-1）。`behavior.test.js` 扩展：`matchInteraction`（固定 `rng` 确定选出、`candidates` 空 → null、未知 type → null、多候选 `rng` 变化覆盖不同选择）、`INTERACTIONS` 四类且每类发起/回应 ≥2 条。
      Files: `server/world.test.js`、`server/behavior.test.js`
      Verify: `cd server && npm test` 新增用例全通过，一期用例不回归。

- [ ] 19. 补二期集成断言（`server/town-server.integration.test.js`，依 design §20.8/§21.7/§22.6）。
      用 `CYBERTRON_TICK_MS` 调小加速。新增：
      - **虫洞递增 + 讨论增量**：不发提问驱动心跳，断言收到 ≥1 条 `project_update` 且 `progress` 单调增（跨建成归零）；`world_state` 快照含 `project` 字段；发一场合法讨论，断言 `resolution` 之后收到一条 `project_update`。
      - **建成可演示性护栏（MEDIUM-1）**：不发任何提问、驱动 `≥ 3×TICKS_PER_DAY` tick，断言至少收到一次 `project_update{status:'completed'}` 且**随后**收到 `project_update{progress:0, status:'building'}` 重置帧、`round` 较建成帧 +1（两帧次序即 §20.3）。
      - **隔离闭环（NIT-4 次序）**：驱动过 `ISOLATION_DEMO_TICK` 断言收到 ECHO `agent_update{status:'isolated'}` + 隔离叙事；再过 `ISOLATION_TICKS` 断言**先** `agent_update{status:'active'}`、**后**结束隔离叙事 `agent_event`。
      - **互动配对**：制造一次发起，断言下一拍收到带 `interaction.replyTo` 的回应 `agent_event` 且 `interaction.id` 一致；构造候选全隔离/睡着时断言无回应帧但事件流不中断。
      - **上行白名单不破**：发未知/越权帧（如 `move_agent`）断言无状态变化、连接不断（宪章 5）。
      Files: `server/town-server.integration.test.js`
      Verify: `cd server && npm test` 含二期集成用例并全通过。

## J. 前端二期 UI 与视觉升级（`app/`，纯静态零构建，遵守视觉 Steering §8）

- [ ] 20. 新增像素小人 `app/js/pixel-figure.js`（依 design §19.2；需求 10.3）。
      导出 `PixelFigure` 类与 `figureStyle(id)`：`PALETTE`（5 色霓虹同系）+ `FACES`（5 个内联字符）按 `hashId(id)` 确定性派生异色异脸；持 `{id,name,color,face}`、一个本地动作状态机（walk/type/water/drink/read/idle）+ 头顶名字标签 + 气泡；纯表现层、零外部图片。`PALETTE`/`FACES` 为内景专用（与 theme.css 五主色并存，steering 登记的唯一散色例外）。
      Files: `app/js/pixel-figure.js`
      Verify: 浏览器 import 不报错；同一 id 多次 `figureStyle` 返回一致；5 个 agent id 派生尽量异色异脸。

- [ ] 21. 新增家内景渲染器 `app/js/home-interior.js`（依 design §19.3/§19.4/§19.6、§30.4；需求 10 / 16.4）。
      导出内景渲染器：输入 `(rootEl, store, agentId)`，提供 `open(agentId)`/`close()`；**唯一宿主** `INTERIOR_SCRIPT` 常量（按 persona 分组、每人格气泡语料 + 动作旁白 ≥4 条、动作集枚举 walk/type/water/drink/read/idle 同住本文件，NIT-2）；前端常量 `VISIT_RELATION_TTL_MS=6000`；`requestAnimationFrame` 驱动小人走动 + 动作循环 + 气泡（纯表现层），**共享事实（谁在家、名字、status）只读 `store`**：`asleep` 熄灯休眠、`isolated` 告警橙静止禁言、`active` 正常；收到 `agent_event{kind:'visit', toAgentId}` 登记访客关系 `expireAt=Date.now()+VISIT_RELATION_TTL_MS`，rAF 每帧比对 `Date.now()>=expireAt` 移除访客（不依赖 tick 帧）；屋主 + 访客渲染为多个 `PixelFigure`；**内景纯观赏**，小人不可交互（仅「返回全景」按钮可点）。房间背景按 §30.4 画科技舱体内部（舱壁网格 + 发光管线 + 舷窗 + 全息面板 + 金属台面家具 💻🌷🥤📖）。
      Files: `app/js/home-interior.js`
      Verify: 进入内景见多个异色异脸带名字小人走动/冒气泡/循环动作；asleep/isolated 表现正确；点返回全景可切回；无任何上行帧发出。

- [ ] 22. 新增虫洞装置 `app/js/wormhole.js` + `store` 承 project（依 design §20.6/§20.7；需求 11.4/11.6）。
      新增 `wormhole.js`：全景上渲染霓虹虫洞环 + 进度条（宽度=`progress/100`，青紫→晶体青渐变，轮次角标「第 N 座」），进度**只读** `store.snapshot.project`、前端不自增（可做补间动画）；收到 `project_update{status:'completed'}` 触发一次性建成动画（辉光爆发，纯 Canvas/CSS），随后的 `{progress:0}` 帧归零显示新轮次。改 `store.js`：`applyWorldState` 读入 `snapshot.project`；新增 `applyProjectUpdate(data)`（防御式校验 `progress∈[0,100]`、`round≥1`、`status∈{building,completed}`，非法保留旧值）覆盖 `snapshot.project` 并 `_emit({kind:'project_update'})`。
      Files: `app/js/wormhole.js`、`app/js/store.js`
      Verify: 不操作围观见进度条增长、达 100 播建成动画后归零 + 轮次 +1；多游客进度一致（只读后端）。

- [ ] 23. 新增宪章/宇宙两图标两弹窗 `app/js/modals.js`（依 design §23；需求 14 / 15）。
      新增 `modals.js`（文案可合 `lore.js` 常量）：两常驻可点击图标（🛡️ 宪章青紫描边 / 🌌 宇宙晶体青描边，内联 emoji/SVG，视觉可区分）；两弹窗（遮罩 + 居中卡片）各三种关闭方式（✕ / 点遮罩 / Esc）、两弹窗互斥；**文案为前端静态常量**：宪章弹窗誊抄 `.kiro/steering/赛博坦宪章.md` 五条全文、宇宙弹窗誊抄 `general_spec.md` 产品简介与目标，常量块加注释「誊抄自权威文件，修改须同步原文」；点击只切 DOM 可见性，**绝不 `ws.send` 任何帧**（宪章 5）。
      Files: `app/js/modals.js`
      Verify: 点宪章图标弹五条全文、点宇宙图标弹世界观文案、三种方式均可关闭；开关弹窗期间无上行帧发出。

- [ ] 24. 装配前端二期：视图切换 + 隔离色 + 科技建筑/星球背景 + 帧分发 + 事件流成对样式（依 design §19.6、§20.6、§21.5、§22.4、§30.2/§30.3/§30.5；需求 10/11/12/13/16）。
      改 `main.js`：持 `view:'town'|'home'` 本地状态、`town-map` 家点击 → `onEnterHome(agentId)` 进内景（隐藏全景、显内景、记来源）、内景常驻「返回全景」按钮恢复；实例化 `home-interior`/`wormhole`/`modals`；新增 `ws.on('project_update', …)` 分发到 `store`+`wormhole`；`agent_update` 分发时内景/全景同步 `isolated` 表现。改 `town-map.js`：家点击监听；`_updateNode` 增 `node.classList.toggle('isolated', a.status==='isolated')`；**家节点按 §30.2 用内层 `<canvas>`/`<svg>` 画科技居住舱**（`drawHome(ctx,{persona,status,variant})`，`variant=hashId(id)%5` 五剪影，穹顶/舱体/能量塔/天线/管线/支架/装甲），三态辉光（active 青紫满辉光 / asleep `--dim-sleep` 断电 / isolated `--alert-orange` 警戒）；**全景背景按 §30.3 用 `drawBackground(ctx)` 画外星星球表面三层**（固定种子星空星点星云行星 / 远山脊环形山 / 外星地表陨石坑矿脉），家按 `home{x,y}` 坐落其上、背景不拦截点击。改 `event-feed.js`：带 `interaction.replyTo` 的回应加缩进/连线样式（纯 CSS），普通事件样式不变。改 `index.html`：加内景容器 `<section id="home-interior" hidden>` + 返回按钮 + 两图标两弹窗挂载点 + 虫洞装置位。改 `theme.css`：内景/像素小人/虫洞/弹窗/隔离态/科技建筑/星球背景/舱体内景样式，全部引用五色变量（+ 内景 5 色例外），不新增锁定色。
      Files: `app/js/main.js`、`app/js/town-map.js`、`app/js/event-feed.js`、`app/index.html`、`app/css/theme.css`
      Verify: `bash start.sh` 后端 9527 前端 9528 起；点家进内景再返回；见虫洞进度/建成动画；见隔离警戒色；见科技建筑 + 星球表面背景；事件流成对互动可读；两弹窗可开关；游客无法操纵任何 agent。

## K. Steering 增补与二期验收

- [ ] 25. 增补 `.kiro/steering/视觉风格.md`（§26 清单，独立必做任务）。
      核对并补齐 §26 四项要点：**家内景像素风节**（内景房间深底 + 霓虹网格地板、家具 emoji、内景小人 5 色异色 + 内联字符头像、睡眠/隔离表现、返回按钮）、**虫洞装置与进度条节**（霓虹环 + 进度条青紫→晶体青渐变 + 轮次角标 + 建成辉光动画）、**宪章/宇宙图标与弹窗节**（🛡️/🌌 图标 + 弹窗遮罩居中卡片 + 三种关闭 + 背景继续动）；第 8 节科技建筑/星球表面/科技舱体内景已在（§30，如缺则补）；**显式登记内景小人 5 色为「不写死散色」遵守清单的唯一例外**（front-matter 保持 `inclusion:always`，避免后续前端实现误删）。`赛博坦宪章.md` 不改。
      Files: `.kiro/steering/视觉风格.md`
      Verify: 四项要点齐全；内景 5 色例外成文登记；front-matter 仍 `inclusion:always`。

- [ ] 26. 二期端到端手测（依 requirements 二期验收标准 12–19）。
      `bash start.sh` 起后端 9527 + 前端 9528，逐项核对二期验收 12–19：点家进内景（多小人异色异脸带名字走动/气泡/敲电脑-浇花-喝水循环、可返回）/ 不操作见虫洞进度增长 + 讨论增量 + 达 100 建成动画 + 自动重置新一轮 / 事件流读到成对互动剧情（口吻符合人格）/ 确定触发 ECHO 隔离（警戒色、禁言、到期恢复）/ 两图标弹窗可开关且无上行写帧 / 家是科技建筑 + 全景是星球表面 + 内景是科技舱体 + 三态可辨识 / 二期纯函数 + 集成 `node --test` 全绿 / 上行白名单仍仅三种 / 无 key 剧本轨开箱即玩可录屏。
      Verify: 二期验收 12–19 逐条通过并记录；`cd server && npm test` 全绿；`start.sh` 一键启动不退化。
