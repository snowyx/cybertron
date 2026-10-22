# 实现计划 · 赛博坦（Cybertron）MVP

> 本文件是 Kiro Spec 驱动开发的实现计划（impl-plan），承接已批准的 `requirements.md` / `design.md` / `tasks.md` 与两份 Steering（`赛博坦宪章.md`、`视觉风格.md`）、一份 Hook（`源码改动跑冒烟测试.kiro.hook`）。
>
> 技术栈与常量在 design.md 已锁定，实现者**不再做需求级决策**。本计划只把已锁的设计排成有序、可独立验证的实现步骤。所有路径相对 `2-cybertron/`。
>
> 运行环境：Node ≥ 18（支持 `ws`、原生 `fetch`、`node:test`）。前端纯静态、原生 ES Module、零构建。本项目为独立子目录，**直接在 `2-cybertron/` 内实现并本地验证，不使用 git worktree**。
>
> 关键锁定点（出自 design §14 常量总表，正文同名以总表为准）：
> - 端口 `PORT=9527`（与其它项目端口错开）；心跳 `CYBERTRON_TICK_MS=3000`（有效值 `TICK_MS_EFFECTIVE=Number(env)||TICK_MS`）；讨论步进 `CYBERTRON_DISCUSS_STEP_MS=1500`（同理 `DISCUSS_STEP_MS_EFFECTIVE`）。
> - `TICKS_PER_DAY=24`、`AUTONOMY_CHANCE=0.9`、`BEHAVIOR_COOLDOWN_TICKS=1`、`ENERGY_MAX=48`、`COST={autonomy:6,speak:10}`、`CRYSTAL_REWARD=1`、`CRYSTAL_TO_ENERGY=20`、`ADOPTED_COUNT=2`、`MAX_SPEAKERS=5`、`MAX_ASK_QUEUE=5`、`MAX_TEXT=280`、`VISIT_REPLY_CHANCE=0.6`、`RECENT_EVENTS_MAX=30`、LLM 超时 `8000ms`、`SAFE_PLACEHOLDER='……（这句话被赛博坦宪章轻轻拦下了）'`。
> - LLM key 只读 `CYBERTRON_LLM_API_KEY`（辅助 `CYBERTRON_LLM_BASE_URL` 默认 `https://api.openai.com/v1`、`CYBERTRON_LLM_MODEL` 默认 `gpt-4o-mini`）。有 key 走真模型、无 key 走剧本、运行期调用失败即回退剧本。
> - 上行白名单仅 `hello` / `visitor_ask` / `ping`，无任何写 agent/世界的帧（宪章 5 的结构性护栏）。
>
> 参考交付范式见 `1-kickbadguy/`（`server/room-server.js` 的 `frame()`/`broadcast()`/`makeSnapshot()`/`isEntry` 守卫与 `startServer()`、`app/js/ws-client.js` 的首帧+指数退避重连、`server/package.json`、`app/index.html`、`app/js/config.js`）。**沿用其骨架模式，不拷贝其业务逻辑**。

---

## 实现计划（有序、可独立验证）

- [ ] 1. 建立仓库骨架与密钥卫生文件。
      在 `2-cybertron/` 下创建目录 `app/css/`、`app/js/`、`server/`；创建 `.env.example`（仅三行 key 名、**无值**：`CYBERTRON_LLM_API_KEY=`、`CYBERTRON_LLM_BASE_URL=`、`CYBERTRON_LLM_MODEL=`）与 `.gitignore`（忽略 `.env`、`node_modules/`、`.DS_Store`）。参见 design §13、tasks 任务 1、NFR-4。
      Files: `app/css/`、`app/js/`、`server/`（建占位目录）、`.env.example`、`.gitignore`
      Verify: `ls -R 2-cybertron/app 2-cybertron/server` 显示三目录齐全；`cat 2-cybertron/.env.example` 三行 key 名且等号后无值；`cat 2-cybertron/.gitignore` 含 `.env`、`node_modules/`、`.DS_Store`。

- [ ] 2. 创建 `server/package.json`。
      `"type":"module"`、`"dependencies":{"ws":"8.18.0"}`、脚本 `"start":"node town-server.js"` 与 `"test":"node --test"`、`"engines":{"node":">=18"}`、`"main":"town-server.js"`。参见 design §13、tasks 任务 2。
      Files: `server/package.json`
      Verify: `cd 2-cybertron/server && npm install` 成功装入 `ws@8.18.0`（`node_modules/ws` 存在）；`node -e "import('fs')"` 可用；脚本字段无误。

- [ ] 3. 实现世界模型与 token 经济纯函数 `server/world.js`（依 design §2 / §9 / §14）。
      导出：`AGENT_CONFIG`（冻结数组，5 个 agent：`poet/NOVA-7/忧郁诗人`、`engineer/RIPR/热心工程师`、`gossip/ECHO/八卦邻居`、`merchant/ZETA/精明商人`、`dreamer/LUNA/天真梦想家`，各含 §2.1 的归一化 `home{x,y}`）；锁定常量 `ENERGY_MAX=48`、`COST={autonomy:6,speak:10}`（冻结）、`CRYSTAL_REWARD=1`、`CRYSTAL_TO_ENERGY=20`、`ADOPTED_COUNT=2`、`TICKS_PER_DAY=24`、`RECENT_EVENTS_MAX=30`；`createWorld(config=AGENT_CONFIG)→World`（纯构造、无 I/O，初始化每 agent `status:'active'/energy=energyMax=ENERGY_MAX/crystals:0/busyUntilTick:0`，World 初始 `tick:0/dayStartTick:0/ticking:false/phase:'idle'/discussion:null/askQueue:[]/recentEvents:[]`、`agents` 用 Map）；纯函数 `applyCost(agent,cost)→{energy,status,sleptNow}`、`reward(agent)→{crystals,energy,status,wokeNow}`（补能后 `energy>0` 即把 `status` 置回 `'active'`——MEDIUM-1 方案 A）、`recoverDay(agents)→受影响 agent 新状态`。维护不变量 `0<=energy<=energyMax` 且 `energy<=0 ⇔ 睡觉`（除 recoverDay/reward 补能唤醒的同一步）。能量变更只许走这三个函数。
      Files: `server/world.js`
      Verify: `node --check 2-cybertron/server/world.js` 通过；`node -e "import('./2-cybertron/server/world.js').then(m=>{const w=m.createWorld();console.assert(w.agents.size===5&&w.phase==='idle'&&w.ticking===false);console.log('ok')})"` 打印 `ok`。

- [ ] 4. 实现宪章过滤纯函数 `server/charter.js`（依 design §8、宪章 Steering、tasks 任务 4）。
      导出：`CHARTER_BLOCKLIST`（冻结，六类 `harm/adult/violence/fraud/marriage/politics`，来源公开常识词、不含任何真实个人信息）；`charterCheck(text)→{ok,category}`（对 `String(text).toLowerCase()` 逐类子串/正则匹配，命中即 `ok:false` 带类别，无副作用）；`SAFE_PLACEHOLDER='……（这句话被赛博坦宪章轻轻拦下了）'`。**每一类至少内置 1 个可供单测断言的确定锚点词**（NIT-2）：`harm` 用 `kill`/`自杀` 类、`fraud` 用 `诈骗`/`scam`、`marriage` 用 `结婚`/`婚姻`、`violence`/`adult` 用明显越线的通用词、`politics` 用**中性制度词**（如 `选举`）作锚点，**不含任何真实政治实体/人名**。
      Files: `server/charter.js`
      Verify: `node --check 2-cybertron/server/charter.js` 通过；`node -e "import('./2-cybertron/server/charter.js').then(m=>{console.assert(m.charterCheck('诈骗').ok===false);console.assert(m.charterCheck('今天天气真好呀').ok===true);console.log('ok')})"` 打印 `ok`。

- [ ] 5. 实现言行生成与 LLM 双轨 `server/behavior.js`（依 design §6 / §7 / §14、tasks 任务 5）。
      内置五人格剧本语料 `SCRIPT`（键为 persona 中文名，按 §6.3 口吻样例锚定风格），**每人格 `act`/`talk`/`visit` 各 ≥2 条、`speech` ≥1 个模板函数 `(q)=>string`**；`{n}` 为计数、`{other}` 为随机另一 agent 名且 `{other}≠self`。导出：`generateEvent(agent,world,{mode,llm})→Promise<{kind,text}>`（`kind∈'act'|'talk'|'visit'`）、`generateSpeech(agent,question,{mode,llm})→Promise<string>`、`summarizeResolution(question,spoken,{mode,llm})→Promise<string>`（三者内部 `mode==='llm'&&llm` 时 `try{await llm(...)}catch{回退剧本}`，否则直接剧本；宪章过滤**不在此做**，统一由调用方做）；`makeLlmCaller(env)→async(messages)=>string`（Node 原生 `fetch` 调 Chat Completions 风格接口，`AbortController` 超时 8000ms，只读 `CYBERTRON_LLM_API_KEY`/`CYBERTRON_LLM_BASE_URL`/`CYBERTRON_LLM_MODEL`；任何异常都抛给上层由生成函数捕获回退）；`resolveMode(env)→{mode,llm}`（有 key→`{mode:'llm',llm:makeLlmCaller(env)}`，无 key→`{mode:'script',llm:null}`）。
      Files: `server/behavior.js`
      Verify: `node --check 2-cybertron/server/behavior.js` 通过；`node -e "import('./2-cybertron/server/behavior.js').then(m=>{const r=m.resolveMode({});console.assert(r.mode==='script'&&r.llm===null);console.log('ok')})"`（无 key 环境）打印 `ok`、不报错。

- [ ] 6. 实现 ws 服务、心跳调度与消息路由 `server/town-server.js`（依 design §1 / §3 / §4 / §5 / §11 / §14、tasks 任务 6）。
      入口裸 `WebSocketServer({host:'0.0.0.0', port:Number(process.env.PORT)||9527})`。工具：`frame(type,data)`（信封 `{type,data,ts:Date.now()}`）、`broadcast(wss,frame)`、`singleSend(ws,frame)`、`makeSnapshot(world)`（§4.4 形状，含 `mode` 与 `recentEvents` 的**浅拷贝**，**绝不外泄 ws 句柄/任何 key**）、`pushRecent(world,ev)`（FIFO 追加 `{agentId,name,kind,text,ts}`，`length>RECENT_EVENTS_MAX` 时 `shift()`）。启动定轨：用 `resolveMode(process.env)` 得 `{mode,llm}` 写入 world 并打印当前轨道（script/llm，§7.2）；`mode` 随 `world_state` 全量下发、无独立增量帧。定时器用**有效值**：`TICK_MS_EFFECTIVE=Number(process.env.CYBERTRON_TICK_MS)||TICK_MS`、`DISCUSS_STEP_MS_EFFECTIVE=Number(process.env.CYBERTRON_DISCUSS_STEP_MS)||DISCUSS_STEP_MS`（`export const TICK_MS=3000`/`DISCUSS_STEP_MS=1500`/`AUTONOMY_CHANCE=0.9`/`BEHAVIOR_COOLDOWN_TICKS=1`/`MAX_SPEAKERS=5`/`MAX_ASK_QUEUE=5`/`MAX_TEXT=280`/`VISIT_REPLY_CHANCE=0.6` 作默认值与测试引用）。
      - 首帧契约（§4.1）：连接必须先发 `hello`→回 `hello_ok{visitorId}` 并立即单播全量 `world_state`；`hello` 前的业务帧按 `BAD_PAYLOAD` 静默忽略。
      - 上行白名单（§4.2，宪章 5）仅 `hello`/`visitor_ask`/`ping`（回 `pong`）；路由 `default` 对未知 type 一律 `BAD_PAYLOAD` 静默丢弃、不断连、不改任何共享状态。
      - 心跳 `setInterval(…, TICK_MS_EFFECTIVE)`：回调首行 `if(world.ticking)return;`，置 `world.ticking=true`，调 `await tick(world,deps)`，`finally` 复位（自旋锁，§3.2）。`async tick(world,deps)` 顺序：①`tick+=1`；②天边界 `if(tick-dayStartTick>=TICKS_PER_DAY) recoverDay(...)` 恢复能量/唤醒并对受影响 agent 广播 `agent_update`、`dayStartTick=tick`（**不分 phase 照常执行**；跨天不改本场 `speakersQueue`，§11 NIT-3）；③`phase==='discussing'` 时**只做天边界、不推进讨论**；④`phase==='idle'` 时遍历 agents，对 `active && tick>=busyUntilTick && energy>=COST.autonomy` 的 agent 以 `AUTONOMY_CHANCE` 触发：`await generateEvent(...)`→调用方过 `charterCheck`（命中整条替换 `SAFE_PLACEHOLDER`）→`applyCost(autonomy)`（可能 asleep+广播 `agent_update`）→`busyUntilTick=tick+BEHAVIOR_COOLDOWN_TICKS`→广播 `agent_event` 并 `pushRecent`；`kind:'visit'` 的文案点名 `{other}` 且以 `VISIT_REPLY_CHANCE=0.6` 让被点名 agent 在下一 tick 产生 `kind:'talk'` 回应（同样扣费/过滤/广播/pushRecent，§6.1）。
      - 讨论推进（§5.2）：用**独立链式步进** `setTimeout(step, DISCUSS_STEP_MS_EFFECTIVE)`，`async step()` **复用 `world.ticking` 自旋锁**。每步取 `speakersQueue` 队首：确认 `active && energy>=COST.speak`（否则出队跳过）→`text=await generateSpeech(...)`→**固定次序：先 `charterCheck`（命中整条换 `SAFE_PLACEHOLDER`）后按 `MAX_TEXT` 截断**（NIT-2）→`applyCost(speak)`（可能 asleep+广播 `agent_update`）→记入 `discussion.spoken`、广播 `discussion_speak` 并 `pushRecent(kind:'speak')`→若队空则**本步并入决议结算**（不额外占一步），否则排下一步。
      - 提问编排（§5.1/§5.3/§5.4）：收 `visitor_ask` 依次——非字符串/`trim` 长 0→`ask_rejected{EMPTY}`；>200→`ask_rejected{TOO_LONG}`；`charterCheck` 命中→`ask_rejected{CHARTER}`（不入链路）；`phase==='discussing'` 时**先预判**：无任何 active agent→`ask_rejected{NO_AWAKE_AGENT}`不入队，否则入 `askQueue`（满 `MAX_ASK_QUEUE`→`ask_rejected{QUEUE_FULL}`不入队，否则回**成功帧** `ask_queued{position,message}`，`position`=入队后 1 基位次）；idle 时选 `active && energy>=COST.speak` 的 agent（空→`ask_rejected{NO_AWAKE_AGENT}`），否则建 `discussion`（`speakersQueue`=可发言 id 按配置序、最多 `MAX_SPEAKERS`）、`phase='discussing'`、广播 `discussion_start`、启动步进。决议结算：`summarizeResolution(...)`→`charterCheck`（命中换占位）→采纳 `spoken` 前 `min(ADOPTED_COUNT, spoken.length)` 位，对每个被采纳 agent 调 `reward`（晶体+、折能、**补能后 energy>0 则唤醒 active**，§5.4 MEDIUM-1），写回内存并广播含最新 `status` 的 `agent_update`→广播 `resolution{discussionId,question,text,adoptedAgentIds}` 并 `pushRecent(agentId:null,name:'赛博坦',kind:'resolution')`→`phase='idle'`、`discussion=null`、停步进；`askQueue` 非空则立刻开下一场（校验已在入队前做过）。
      - 帧契约：`agent_update` 只带变化字段 `{agentId,status,energy,energyMax,crystals}`（部分字段 patch，§4.3/§10 MEDIUM-2）；`recentEvents` 只由 `pushRecent` 维护，`agent_update`/`world_state`/`hello_ok`/`tick`/`pong`/`ask_queued`/`ask_rejected`/`discussion_start`/`error` 均**不入列**（§4.4 MEDIUM-2）。
      - 可测性：把 `tick(world,deps)` 与 `step(world,deps)` 写成可被测试直接 `await` 的半纯函数，`deps` 注入 `{mode,llm,generateEvent,generateSpeech,summarizeResolution,broadcast,...}` 便于注入假 `llm`/假广播；`isEntry` 守卫（参考 `room-server.js` 的 `import.meta.url` 判断），被 import 时**不监听、不开心跳**，仅入口直接运行时 `startServer()` 并启动 `setInterval`。
      Files: `server/town-server.js`
      Verify: `node --check 2-cybertron/server/town-server.js` 通过；`cd 2-cybertron/server && PORT=8099 timeout 3 npm start` 能监听并打印当前言行轨道（无 key 时为 script），无异常退出。

- [ ] 7. 纯函数单元测试（依 design §12、tasks 任务 7）。
      `world.test.js`：`applyCost`（扣到 0 睡觉、未到 0 不睡、不为负）、`reward`（晶体+1、能量不溢出 `energyMax`、**对 asleep 且补能后 energy>0 的 agent 返回 `status:'active'`+`wokeNow:true`、对 active agent status 不变 wokeNow:false**）、`recoverDay`（满能量+唤醒）、采纳边界 `min(2, spoken.length)`（spoken<2）。`charter.test.js`：六类红线锚点词各返回 `ok:false` 且类别正确、正常问候 `ok:true`、大小写/子串边界。`behavior.test.js`：`mode:'script'` 时三个生成函数稳定产出非空字符串、每人格语料达下限（act/talk/visit ≥2、speech ≥1）、注入必抛错的 `llm` 时 `mode:'llm'` 仍回退剧本产出、`{other}≠self`。另加协议纯函数断言：`frame()`/`makeSnapshot()` 字段齐全且不含 ws 句柄与 key（可放入 `town-server.test.js` 或并入上述文件）。
      Files: `server/world.test.js`、`server/charter.test.js`、`server/behavior.test.js`（协议断言 `server/town-server.test.js` 可选）
      Verify: `cd 2-cybertron/server && npm test` 对应单测全部通过（0 fail）。

- [ ] 8. 集成测试 `server/town-server.integration.test.js`（依 design §12、tasks 任务 8）。
      随机端口起服务（`startServer(0)` 或 `PORT=0` 取实际端口），用 `ws` 客户端。覆盖：
      - `hello → hello_ok → world_state`，断言 5 个 agent 各字段齐全（含 `home`）。
      - 合法 `visitor_ask` → 收 `discussion_start`、若干 `discussion_speak`、**恰好一条** `resolution`，被采纳 agent 收到 `agent_update`（晶体+）。
      - **发言后睡着被采纳**：构造临界能量使被采纳 agent 发言后 `asleep`，断言结算后该 agent `status==='active' && energy>0` 且其 `agent_update` 带 `status:'active'`（MEDIUM-1）。
      - **超长且含红线词的产出**：断言推送为 `SAFE_PLACEHOLDER` 整条替换（先过滤后截断，NIT-2）。
      - 命中宪章的问题 → `ask_rejected{CHARTER}`，世界状态不变。
      - **排队成功 vs 队满**：讨论进行中（星城里尚有 active agent）再发合法问题 → `ask_queued{position}`（成功帧）；灌满 `MAX_ASK_QUEUE` 后再发 → `ask_rejected{reason:'QUEUE_FULL'}`，断言帧名/reason 不同（MEDIUM-1）。
      - **端到端纯自主耗尽→睡觉→天恢复**：默认常量、**不发任何 `visitor_ask`**，用 `CYBERTRON_TICK_MS` 调小加速驱动心跳，断言至少一个 agent `asleep && energy<=0`，再跨一个天边界断言被 `recoverDay` 恢复 `energy===energyMax && status==='active'` 且收到 `agent_update`（HIGH-1，守护验收 6）。
      - **`recentEvents` 写入/淘汰**：驱动 >30 条 `agent_event`/`discussion_speak` 后新连客户端，断言其 `world_state.recentEvents` 条数 ≤30、为最近事件、不含 `agent_update`（只含 act/talk/visit/speak/resolution 的 kind，MEDIUM-2）。
      - 越权/未知帧 → 无状态变化、连接不断。
      用 `CYBERTRON_TICK_MS` 与 `CYBERTRON_DISCUSS_STEP_MS` 调小（如 20）加速，测试结束确保 `clearInterval`/关闭服务不留悬挂句柄。
      Files: `server/town-server.integration.test.js`
      Verify: `cd 2-cybertron/server && npm test` 含集成用例并全部通过、进程正常退出（无悬挂定时器/连接）。

- [ ] 9. 搭 `app/index.html` + `app/css/theme.css` 骨架（依 design §10、视觉 Steering、tasks 任务 9）。
      `index.html`：中文页面（`lang="zh"`），一屏四功能区——星城地图区、实时事件流面板、游客提问输入框、能量/晶体展示（可随地图节点呈现），加 `script`/`llm` 轨道角标一角；内联 emoji favicon 避免 404；`<script type="module" src="js/main.js">` 入口。`theme.css`：`:root` 定义五个锁定配色变量 `--cyber-ink:#0A0714`/`--neon-violet:#A24BFF`/`--crystal-cyan:#38F2E6`/`--alert-orange:#FF8A3D`/`--dim-sleep:#2A2140` 并**全局引用变量、不写死散色**；霓虹辉光用多层 text/box-shadow，呼吸动画仅少量关键元素；家 active 亮灯、asleep 熄灯暗态；「赛博坦决议」用告警橙高亮卡片样式；用 `clamp()`/`vw` 做响应式、窄屏竖排堆叠。
      Files: `app/index.html`、`app/css/theme.css`
      Verify: `node --check` 不适用；用静态服务器打开（见步骤 11）浏览器控制台无报错；`grep -c '#0A0714\|#A24BFF\|#38F2E6\|#FF8A3D\|#2A2140' app/css/theme.css` 五值均仅在 `:root` 出现、其余引用 `var(--...)`；页面含四功能区容器与轨道角标元素。

- [ ] 10. 实现前端 JS 模块（依 design §10、视觉 Steering、tasks 任务 10）。
      `config.js`：`WS_URL`（localhost 默认 `ws://localhost:9527`，可被 `localStorage.WS_URL` 覆盖，线上占位）。`ws-client.js`：连 ws、`open` 后自动发 `hello`、按 type 分发、`hello_ok` 前业务帧排队、断线**指数退避重连**、重连后以收到的 `world_state` 全量对齐（参考 `1-kickbadguy/app/js/ws-client.js` 模式）。`store.js`：后端快照**只读镜像**，`world_state` 覆盖全量；增量帧更新，其中 **`agent_update` 为部分字段 patch**——按 `data.agentId` 定位既有 agent，**仅 `Object.assign` 覆盖 `status/energy/energyMax/crystals`、保留 `name/persona/home`**，未知 `agentId` **忽略不新建**；前端**绝不**自推进 tick/能量/状态（§10/NFR-3 MEDIUM-2）。`town-map.js`：按归一化 `home{x,y}` 画 5 个家（canvas 或绝对定位 DOM），active 亮灯发光、asleep 熄灯暗淡，节点下能量条宽度=`energy/energyMax`（近 0 转告警橙）、晶体数角标，收到该 agent `agent_event` 冒霓虹气泡。`event-feed.js`：滚动事件列表，渲染 `agent_event`/`discussion_speak`，`resolution` 用**告警橙高亮「赛博坦决议」卡片**区分普通发言。`ask-box.js`：输入框+广播按钮，轻量前置禁用（空/超长），真正校验以后端为准；**按帧名区分反馈**——`ask_queued` 视为成功（提示已排队、可显示 `position`），`ask_rejected` 视为失败（渲染 `message` 并说明本次无决议）；两类均不改共享状态。`main.js`：装配入口，连接 ws 并把帧分发到 store 与各渲染模块。
      Files: `app/js/{config,ws-client,store,town-map,event-feed,ask-box,main}.js`
      Verify: 启动后端（步骤 11）后用静态服务器打开页面，浏览器控制台无报错；数秒内事件流出现 agent 自主刷屏；提问见讨论与 `resolution` 高亮卡片；观察到能量耗尽熄灯、天恢复亮灯；页面无任何操纵 agent 的入口（只有提问框）。

- [ ] 11. 本地端到端手测（依 requirements 验收标准 1–11、tasks 任务 11）。
      后端：`cd 2-cybertron/server && npm install && npm start`（监听 9527，打印 script 轨道）。前端：用任一静态服务器在 `2-cybertron/app/` 起服务（如 `cd 2-cybertron/app && python3 -m http.server 9528`，因 ES Module 不能用 `file://`）并浏览器打开。逐条核对验收标准：①5 agent 节点含名字/人格/状态/能量条且数据来自快照；②不操作数秒内事件流刷屏；③无任何前端途径改 agent（越权帧被静默丢弃、世界不变）；④合法提问→多 agent 依次发言→恰一条可区分决议；⑤空/超长/宪章问题被拒给友好提示、世界不变；⑥不交互约 72s 内见某 agent 耗尽熄灯并在天恢复后亮灯（可临时设 `CYBERTRON_TICK_MS` 调小加速观察）；⑦被采纳 agent 晶体+、能量补充实时反映；⑧无 key 走剧本不报错；⑨（代码层）真模型失败回退由集成测试覆盖；⑩`node --test` 全绿；⑪仓库无真实 key、`.env.example` 只有 key 名。
      Files: 无（仅验证）
      Verify: 上述 11 条逐条通过；后端启动日志为 script 轨道；`cd 2-cybertron/server && npm test` 全绿。记录每条结果。

- [ ] 12. 编写 `README.md`（中文，依 tasks 任务 12、原始用户请求）。
      内容：一句话产品卖点 + 玩法介绍；**本地运行确切命令**（后端 `cd server && npm install && npm start`；前端用静态服务器起 `app/` 并打开，附不能用 `file://` 的说明）；可选接入真 LLM 的环境变量名（`CYBERTRON_LLM_API_KEY` 必需、`CYBERTRON_LLM_BASE_URL`/`CYBERTRON_LLM_MODEL` 可选，key 只走环境变量、无 key 即剧本、失败即回退）；技术架构（H5 单页只读渲染 + 单文件 Node/ws 唯一事实源 + 心跳/token 经济/宪章过滤全在后端 + LLM 双轨）；宪章合规说明（五条红线 + 运行时过滤 + 「人类只能围观」的结构性护栏）；**200 字内 demo 说明**；「本项目全程用 Kiro Spec/Steering/Hooks 完成」的能力清单与证据指引（Spec 三文档 `.kiro/specs/cybertron/{requirements,design,tasks}.md` + 本 `impl-plan.md`、两 Steering `.kiro/steering/{赛博坦宪章,视觉风格}.md`、Hook `.kiro/hooks/源码改动跑冒烟测试.kiro.hook` 的留痕位置）。
      Files: `README.md`（即 `2-cybertron/README.md`）
      Verify: 按 README 从零可本地跑通（后端起、前端开、无 key 点开即玩）；`grep -ri 'sk-\|api_key.*=.*[A-Za-z0-9]\{20\}' 2-cybertron --include=*.md --include=*.js --include=.env.example` 无真实 key 泄漏；demo 说明 ≤200 字；Kiro 能力清单列全 Spec/Steering/Hook 证据路径。

---

## 实现期验证项（design §16 保留的 unverifiedAssumptions）

- `node:test` + `ws` 集成测试在目标环境可运行：步骤 7/8 实跑验证。若环境缺依赖，先 `npm install` 再跑。
- 真模型接口为 OpenAI Chat Completions 风格：仅在设了 `CYBERTRON_LLM_API_KEY` 时走该轨；失败即降级剧本、demo 默认走剧本，不阻塞交付。本 MVP 默认演示路径为**剧本轨**（无 key）。

## 说明与假设

- 本计划为单一全栈小应用，内聚度高、按 `tasks.md` 已是依赖有序的小步，故**不拆分为多特性、不重排工作流**——由既有的实现-评审循环按本计划逐项落地即可。
- 每一步完成后代码库仍可运行/可 `node --check`；后端纯逻辑（步骤 3–5）先于服务装配（步骤 6）与测试（步骤 7–8），前端（步骤 9–10）依赖后端协议已定，手测与 README（步骤 11–12）最后。
- Hook `源码改动跑冒烟测试` 在保存 `app/js/**` 或 `server/**` 的 JS 时自动跑 `cd server && npm test` 作回归兜底；实现前端文件时它同样触发后端冒烟（前端无独立测试，见 §15 NIT-5），实现者据其结果修复、勿让它自动改码。
