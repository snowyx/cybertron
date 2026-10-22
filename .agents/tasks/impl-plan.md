# 赛博坦（Cybertron）二期实现计划

> 承接已批准的二期设计（`design.md` §18–§30，裁决 `design-review.json` verdict=APPROVED）与二期需求（`requirements.md` 需求 10–16）。
> 本计划把二期六块功能 + 视觉升级拆成有序、可独立验证的小步，按依赖排序，每步完成后代码库仍可运行、`node --test` 仍可全绿。
> 工作目录：`2-cybertron/`（**直接在此目录内工作，不用 git worktree**）。文件路径均相对该目录。
> 构建/测试命令（探索时确认）：后端语法检查 `node --check <file>`；后端全量测试 `cd server && npm test`（即 `node --test`，基线 34 用例全绿）；前端零构建，`bash start.sh` 起后端 9527 + 前端 9528。

## 硬约束（全程遵守，每步须自检）

- **人类只能围观**：上行帧白名单**仍严格仅** `hello`/`visitor_ask`/`ping`；`{type,data,ts}` 信封不变；`hello→hello_ok` 首帧契约不变；二期**零新增游客写帧**。唯一新增下行帧是 `project_update`；`agent_update` 仅把 `status` 枚举扩 `isolated`（无字段增删）；`agent_event` 仅可选字段增补（`toAgentId`/`interaction`，向后兼容）；`world_state` 快照加只读 `project` 字段。
- **剧本轨开箱即玩**：无任何 API key（默认）下六块全部可演示、离线稳定、可录屏；有 key 走真模型、运行时失败回退剧本；key 只从 `CYBERTRON_LLM_API_KEY` 读。
- **零外部依赖、零构建**：后端仅依赖 `ws`；前端纯原生 ESM；新视觉元素**零外部图片/字体/库**（纯 Canvas/DOM/CSS + 内联 emoji/SVG），离线可跑。
- **端口 9527（后端）/ 9528（前端）**，`start.sh` 一键启动不退化。
- **视觉五锁定色值不改**：`#0A0714`/`#A24BFF`/`#38F2E6`/`#FF8A3D`/`#2A2140`；不新增锁定色；内景小人 5 色是唯一散色例外（steering 已登记）。
- **可纯函数化的新逻辑都写成可被 `node --test` 覆盖的纯函数并补单测**：`advanceProject` / `enterIsolation` / `tickIsolation` / 修后的 `recoverDay` / `matchInteraction`。

## 实现顺序总览（按依赖）

后端纯函数与语料（1–2）→ 后端装配与新协议帧（3–5）→ 后端测试（6–7）→ 前端新模块与视觉升级（8–12）→ Steering 与端到端验收（13–14）。
后端纯函数是一切的基础，先落地并单测；装配层依赖纯函数；前端依赖后端已能广播新帧/新字段；Steering 与手测收尾。

---

# 实现计划（有序）

- [ ] 1. 扩展 `server/world.js`：虫洞工程模型 + `advanceProject` 纯函数 + 隔离状态机纯函数 + 修 `recoverDay`。
      `createWorld` 初始化 `world.project={progress:0,round:1,status:'building'}`，每个 agent 运行时加 `isolatedUntilTick:0`；新增常量 `BUILD_DELTA_AUTONOMY=4`、`BUILD_DELTA_RESOLUTION=8`、`PROJECT_MAX=100`、`ISOLATION_TICKS=8`；新增纯函数 `advanceProject(project,delta)`（`raw=progress+delta`，`raw>=100`→`{progress:0,round:round+1,status:'building',completedNow:true,completedRound:round}`，否则 `{progress:raw,round,status:'building',completedNow:false,completedRound:null}`，不取模不留余量）、`enterIsolation(agent,nowTick)→{status:'isolated',isolatedUntilTick:nowTick+ISOLATION_TICKS}`、`tickIsolation(agent,nowTick)→到期(status==='isolated' && nowTick>=isolatedUntilTick)返回{status:'active',isolatedUntilTick:0,releasedNow:true}，否则{releasedNow:false}`；**修 `recoverDay`：遍历开头加 `if (agent.status==='isolated') continue;`**（显式跳过隔离者，既不恢复能量也不改 status/isolatedUntilTick，design §21.6 现有代码会误解除隔离，必须改）。
      决策与理由：工程/隔离的全部可剥离 I/O 的计算都放进 `world.js` 纯函数层（与一期 `applyCost/reward/recoverDay` 同址），不变量集中维护；`advanceProject` 把「推进/建成/重置/轮次+1」做成一次原子纯计算便于单测；isolated 不变量追加「`energy<=0 ⇒ asleep`，除非 isolated」豁免（隔离期不走 `applyCost`，故无需改 `applyCost`）。
      Files: `server/world.js`
      Verify: `node --check server/world.js` 通过；`cd server && npm test` 一期 `world.test.js` 不回归（新函数此步未加测，下步补）。

- [ ] 2. 扩展 `server/behavior.js`：工程出力语料 + 互动配对语料 `INTERACTIONS` + `matchInteraction` 纯函数；`pickOtherName` 改为返回 `{name,id}`。
      新增工程出力语料（跨人格通用模板，如「{name} 焊接了虫洞环的第 {seg} 节」「{name} 校准了超时空锚点」，`seg` 由进度派生）；新增 `INTERACTIONS` 配对语料常量（**≥4 类**：`gossip_rebut`/`poem_praise`/`crystal_haggle`/`visit_reply`，每类 `{initiate:[≥2],reply:[≥2]}`，口吻与 §6.3 五人格一致）；导出纯函数 `matchInteraction(type,candidates,corpus,rng=Math.random)`——`candidates` 空 / `corpus[type]` 缺 / `reply` 池空 → 返回 `null`，否则按 `rng` 从 `candidates` 选 `responderId`、从 `corpus[type].reply` 选 `replyText`，返回 `{responderId,replyText}`（无 I/O、`rng` 可注入）；把 `pickOtherName(agent,world)` 改为返回 `{name,id}`（供 `generateEvent` 对 `kind==='visit'` 产出 `toAgentId`，保证文案点名者=toAgentId，§19.3 NIT-2）；真模型轨互动/工程提示为可选增强、失败回退剧本。
      决策与理由：互动配对的决策（选回应方 + 挑语料）抽成可注入 `rng` 的纯函数，I/O/状态读留在 town-server 调用方；工程/互动语料与一期 `SCRIPT` 解耦但同住 `behavior.js`，服务全景共享叙事。
      Files: `server/behavior.js`
      Verify: `node --check server/behavior.js` 通过；注入固定 `rng` 时 `matchInteraction` 输出确定；一期 `behavior.test.js` 不回归（`cd server && npm test`）。

- [ ] 3. 在 `server/town-server.js` 装配虫洞工程推进 + 新增 `project_update` 下行帧 + 快照加 `project`。
      新增常量 `BUILD_CHANCE=0.35`；`makeSnapshot` 快照加 `project:{progress,round,status}`（取 `world.project`）；`doAutonomy` 按 §20.2 决策树重构为三条互斥分流（优先级 **回应 forceKind > 出力建造 BUILD_CHANCE > 普通/互动发起**）：命中出力建造（`active` 且 `project.status==='building'` 且 `rng()<BUILD_CHANCE`）时取工程语料生成 `agent_event{kind:'act'}`（过 `sanitizeOutput` + `pushRecent`）、`applyCost(autonomy)`、调 `advanceProject(world.project,BUILD_DELTA_AUTONOMY)` 写回、广播 `project_update`、短路不再掷 `generateEvent`；`settleResolution` 在广播 `resolution` 之后调 `advanceProject(world.project,BUILD_DELTA_RESOLUTION)` 写回并广播 `project_update`；**建成两帧次序锁定（NIT-1，对所有触发来源一致）**：`completedNow===true` 一律「先广播 `project_update{progress:100,round:completedRound,status:'completed'}`、再写回 `world.project` 重置态并广播 `project_update{progress:0,round,status:'building'}`」（讨论路径下这两帧在 `resolution` 之后）；建成时另广播一条建成叙事 `agent_event`（`agentId:null`/`name:'赛博坦'`，过宪章 + `pushRecent`）。新帧走既有 `frame()`，`project_update` 为全量小对象、**不入 `recentEvents`**。
      Files: `server/town-server.js`
      Verify: `node --check server/town-server.js` 通过；`cd server && npm start` 打印剧本轨不报错；一期集成测试不回归（`npm test`）。

- [ ] 4. 在 `server/town-server.js` 装配破坏者隔离：到期检查 + 两条触发 + demo 钩子。
      新增常量 `ISOLATION_DEMO_TICK=18`（可经 `CYBERTRON_ISOLATION_DEMO_TICK` 调小、沿用 `*_EFFECTIVE` 模式）；**`tick()` 顺序改为「① tick+1 → ② 隔离到期检查（`tickIsolation`）→ ③ 天边界（`recoverDay`）→ ④（idle）自主行为」**（隔离到期必须在天边界之前，§21.6，否则 `recoverDay` 跳过仍 isolated 的它、`tickIsolation` 放出来却不补能）：到期遍历调 `tickIsolation`，`releasedNow` 则写回并**按 NIT-4 次序**先广播 `agent_update{status:'active'}`、再广播「{name} 结束隔离，重新加入星城」安全叙事 `agent_event`（`pushRecent`）；触发点 1（产出命中宪章）：`doAutonomy`/`runStep` 中某次产出 `charterCheck` 命中时，**先写回 `applyCost` 结果（可能 asleep），再调 `enterIsolation` 覆写 `agent.status='isolated'`/`isolatedUntilTick`**（isolated 优先于 asleep），广播 `agent_update{status:'isolated'}` + 隔离叙事（安全文案，越界原文经 `sanitizeOutput` 已换占位、不外泄）；触发点 2（demo 钩子）：`world.tick` 首次达 `ISOLATION_DEMO_TICK` 时（`world._isolationDemoFired` 布尔守卫、仅一次）对 `gossip`/ECHO 广播一条**安全**使坏叙事 `agent_event`（**不走 `applyCost`**，§21.2 NIT-1）、随即 `enterIsolation(ECHO,world.tick)` 写回 + 广播 `agent_update{status:'isolated'}`。隔离复用 `agent_update`（`status` 扩 `isolated`，无新帧）。
      Files: `server/town-server.js`
      Verify: `node --check` 通过；`npm start` 不报错；一期测试不回归（集成测试于下步补隔离断言）。

- [ ] 5. 在 `server/town-server.js` 装配互动剧情：发起→回应编排，`_pendingReplies` 收编为 `_pendingInteraction`。
      `generateEvent` 产出 `kind:'visit'` 时携带 `toAgentId`（来自步骤 2 改造后的 `pickOtherName` 返回 id）；`doAutonomy` 广播的 `agent_event` data 增补**可选** `toAgentId`（visit）；**用 `world._pendingInteraction` 替换删除旧 `world._pendingReplies`**：`doAutonomy` 产出 visit/互动发起时记 `{id,type,initiatorId,toAgentId}`，下一拍 `tick()` 处理——先按 §22.5 预过滤 `candidates`（`active`、`energy>=COST.autonomy`、未被隔离、非发起者）并把 `toAgentId` 对应公民排首位（不满足则退回其余候选），再 `matchInteraction(type,candidates,INTERACTIONS)`，非 null 则让回应方走 `doAutonomy(..., forceKind='talk')` 产出带 `interaction:{id,type,replyTo:initiatorId}` 的呼应 `agent_event`（`applyCost(autonomy)`、过宪章、`pushRecent`、广播），返回 null 安全跳过不报错、不卡事件流；visit 对应 `type:'visit_reply'` 统一走本链路。回应仍后端心跳驱动、无任何上行帧可发起（宪章 5）。
      决策与理由：收编为单一 `_pendingInteraction` 链路避免「盲回应」与「有语义配对」两套机制并存；`toAgentId=文案点名者=互动回应优先者`三者锁为同一 agent，供前端内景把访客渲染进被拜访者的家。
      Files: `server/town-server.js`
      Verify: `node --check` 通过；`npm start` 不报错；下步集成断言验证一来一往。

- [ ] 6. 补二期后端纯函数单测 `server/world.test.js` + `server/behavior.test.js`。
      `world.test.js` 扩展：`advanceProject`（`{10,1,building}+4→{14,1,building,completedNow:false}`；恰达 100 `{96,1}+4→{0,2,building,completedNow:true,completedRound:1}`；跨 100 讨论增量 `{96,1}+8` 与出力溢出 `{99,1}+4`（raw=103）均建成重置、不取模；连续两次建成后 `round===3`）、`enterIsolation`（active/asleep → `isolated` 且 `isolatedUntilTick===nowTick+ISOLATION_TICKS`）、`tickIsolation`（未到期 `releasedNow:false` 不改状态、到期 `{active,0,releasedNow:true}`、对非 isolated `releasedNow:false`）、**`recoverDay` 跳过 isolated**（构造 `energy<energyMax` 的 isolated agent 断言不入 affected；对照组 `energy<energyMax` 的 active 与一个 asleep 仍入 affected，证明只豁免 isolated）。`behavior.test.js` 扩展：`matchInteraction`（固定 `rng` 确定选出 `responderId/replyText`、`candidates` 空 → null、未知 type → null、多候选时 `rng` 变化覆盖不同选择）、`INTERACTIONS` 四类且每类 initiate/reply ≥2 条。
      Files: `server/world.test.js`、`server/behavior.test.js`
      Verify: `cd server && npm test` 新增用例全通过、一期用例不回归。

- [ ] 7. 补二期后端集成断言 `server/town-server.integration.test.js`。
      用 `CYBERTRON_TICK_MS`（及需要时 `CYBERTRON_ISOLATION_DEMO_TICK`）调小加速。新增：①**虫洞递增 + 讨论增量**：不发提问驱动心跳，断言收到 ≥1 条 `project_update` 且 `progress` 单调增（跨建成归零）、`world_state` 快照含 `project`；发一场合法讨论断言 `resolution` 之后收到一条 `project_update`。②**建成可演示性护栏（MEDIUM-1）**：不发任何提问、驱动 `≥3×TICKS_PER_DAY` tick，断言至少一次 `project_update{status:'completed'}` 且**随后** `project_update{progress:0,status:'building'}` 重置帧、`round` 较建成帧 +1（次序即 §20.3）。③**隔离闭环（NIT-4 次序）**：驱动过 `ISOLATION_DEMO_TICK` 断言 ECHO `agent_update{status:'isolated'}` + 隔离叙事；再过 `ISOLATION_TICKS` 断言**先** `agent_update{status:'active'}`、**后**结束隔离叙事 `agent_event`。④**互动配对**：制造一次发起，断言下一拍收到带 `interaction.replyTo` 的回应且 `interaction.id` 一致；候选全隔离/睡着时断言无回应帧但事件流不中断。⑤**上行白名单不破**：发未知/越权帧（如 `move_agent`）断言无状态变化、连接不断。
      Files: `server/town-server.integration.test.js`
      Verify: `cd server && npm test` 含二期集成用例并全通过（后端二期至此完成，下为前端）。

- [ ] 8. 新增像素小人 `app/js/pixel-figure.js`。
      导出 `figureStyle(id)` 与 `PixelFigure` 类：`PALETTE`（5 色霓虹同系）+ `FACES`（5 个内联字符）按 `hashId(id)` 确定性派生异色异脸（同一 id 恒定）；`PixelFigure` 持 `{id,name,color,face}`、一个本地动作状态机（walk/type/water/drink/read/idle）+ 头顶名字标签 + 气泡渲染；纯表现层、零外部图片。`PALETTE`/`FACES` 为内景专用（与 theme.css 五主色并存，steering 登记的唯一散色例外）。
      Files: `app/js/pixel-figure.js`
      Verify: 浏览器 import 不报错；同一 id 多次 `figureStyle` 返回一致；5 个 agent id 尽量异色异脸。

- [ ] 9. 新增家内景渲染器 `app/js/home-interior.js`（含 §30.4 科技舱体内景）。
      输入 `(rootEl, store, agentId)`，提供 `open(agentId)`/`close()`；**唯一宿主** `INTERIOR_SCRIPT` 常量（按 persona 分组、每人格气泡语料 + 动作旁白 ≥4 条、动作集枚举 walk/type/water/drink/read/idle 同住本文件，NIT-2）；前端常量 `VISIT_RELATION_TTL_MS=6000`；`requestAnimationFrame` 驱动小人走动 + 动作循环 + 气泡（纯表现层）；**共享事实（谁在家、名字、status）只读 `store`**：`asleep` 熄灯休眠、`isolated` 告警橙静止禁言不冒气泡、`active` 正常走动；收到 `agent_event{kind:'visit',toAgentId}` 登记访客关系 `expireAt=Date.now()+VISIT_RELATION_TTL_MS`，rAF 每帧比对 `Date.now()>=expireAt` 移除访客小人（**不依赖 tick 下行帧**）；把屋主 + 当前访客渲染为多个 `PixelFigure`；**内景纯观赏**——小人不可点击/拖拽/指令，仅「返回全景」按钮可交互（`open`/`close` 前校验 `store.getAgent(id)` 非空）。房间背景按 §30.4 画科技舱体内部（舱壁网格 + 发光管线 + 观察舷窗透星空 + 全息面板 + 金属台面家具 💻🌷🥤📖），遵守五色变量。
      Files: `app/js/home-interior.js`
      Verify: 进入内景见多个异色异脸带名字小人走动/冒气泡/循环敲电脑-浇花-喝水等动作；asleep/isolated 表现正确；可返回全景；无任何上行帧发出。

- [ ] 10. 新增虫洞装置 `app/js/wormhole.js` + `store.js` 承 project。
      `wormhole.js`：全景上渲染霓虹虫洞环 + 进度条（宽度=`progress/100`，青紫→晶体青渐变，轮次角标「第 N 座」），进度**只读** `store.snapshot.project`、前端不自增（可做补间动画）；收到 `project_update{status:'completed'}` 触发一次性建成动画（辉光爆发 + 环旋转，纯 Canvas/CSS），随后 `{progress:0}` 帧归零显示新轮次。改 `store.js`：`applyWorldState` 读入 `snapshot.project`（存 `this.snapshot.project`）；新增 `applyProjectUpdate(data)`（防御式校验 `progress∈[0,100]` number、`round≥1`、`status∈{building,completed}`，非法保留旧值）覆盖 `snapshot.project` 并 `_emit({kind:'project_update'})`。
      Files: `app/js/wormhole.js`、`app/js/store.js`
      Verify: 不操作围观见进度条增长、达 100 播建成动画后归零 + 轮次 +1；进度只读后端、多游客一致。

- [ ] 11. 新增宪章/宇宙两图标两弹窗 `app/js/modals.js`。
      两常驻可点击图标（🛡️ 宪章青紫描边 / 🌌 宇宙晶体青描边，内联 emoji/SVG，视觉可区分，挂 topbar 一角）；两弹窗（遮罩 + 居中卡片，赛博霓虹风）各三种关闭方式（✕ / 点遮罩 / Esc）、两弹窗互斥（开一个自动关另一个）、弹窗为覆盖层不阻塞背景星城动画；**文案为前端静态常量**：宪章弹窗誊抄 `.kiro/steering/赛博坦宪章.md` 五条全文、宇宙弹窗誊抄 `general_spec.md` 产品简介与目标（可配一段霓虹叙事引导语，核心意图句须与 spec 一致），常量块加注释「誊抄自权威文件，修改须同步原文」；点击图标/开关弹窗**绝不 `ws.send` 任何帧**（宪章 5）。
      Files: `app/js/modals.js`
      Verify: 点宪章图标弹五条全文、点宇宙图标弹世界观文案；✕/遮罩/Esc 三种方式均可关闭；开关弹窗期间无上行帧发出。

- [ ] 12. 装配前端二期：视图切换 + 隔离色 + 科技建筑/星球背景 + 帧分发 + 事件流成对样式（§30.2/§30.3 视觉升级在此落地）。
      改 `main.js`：持 `view:'town'|'home'` 本地状态；`town-map` 家点击 → `onEnterHome(agentId)` 进内景（隐藏全景、显内景、记来源以便返回）、内景常驻「返回全景」按钮恢复先前全景；实例化 `home-interior`/`wormhole`/`modals`；新增 `ws.on('project_update', data => { store.applyProjectUpdate(data); wormhole.render(); })`；`agent_update` 分发时全景 + 内景同步 `isolated` 表现。改 `town-map.js`：家节点加 `click` → `onEnterHome(agentId)`；`_updateNode` 增 `node.classList.toggle('isolated', a.status==='isolated')`；**家节点按 §30.2 用内层 `<canvas>`/`<svg>` 画科技居住舱**（`drawHome(ctx,{persona,status,variant})`，`variant=hashId(id)%5` 五剪影：穹顶/舱体/能量塔/天线桅杆/发光管线/机械支架/霓虹装甲），三态辉光（active 青紫满辉光可呼吸 / asleep `--dim-sleep` 断电近熄 / isolated `--alert-orange` 警戒可慢闪）；**全景背景按 §30.3 用 `drawBackground(ctx)` 画外星星球表面三层**（固定种子 rng 的星空星点/星云/远处行星 → 远山脊/环形山 → 外星地表/陨石坑/霓虹矿脉），家按 `home{x,y}` 坐落地面层、背景 z 轴在家节点下方不拦截点击。改 `event-feed.js`：带 `interaction.replyTo` 的回应项加缩进/连线样式（纯 CSS），不带 `interaction` 的普通事件样式不变、帧契约不变。改 `index.html`：加内景容器 `<section id="home-interior" hidden>` + 返回按钮挂载点 + 两图标两弹窗挂载点 + 虫洞装置位。改 `theme.css`：内景房间/像素小人/虫洞装置/弹窗遮罩/隔离态/科技建筑/星球背景/舱体内景样式，全部引用五色变量（+ 内景 5 色例外），不新增锁定色。
      Files: `app/js/main.js`、`app/js/town-map.js`、`app/js/event-feed.js`、`app/index.html`、`app/css/theme.css`
      Verify: `bash start.sh`（后端 9527 / 前端 9528）起；点家进内景再返回；见虫洞进度增长 + 达 100 建成动画 + 自动重置新一轮；见 ECHO 隔离警戒色区别于亮灯/熄灯；见家为科技建筑 + 全景为外星星球表面；事件流成对互动可读；两弹窗可开关；游客无法操纵任何 agent。

- [ ] 13. 增补 `.kiro/steering/视觉风格.md`（§26 清单，独立必做任务）。
      核对并补齐 §26 四项要点：**家内景像素风节**（内景房间深底 `--cyber-ink` + 霓虹网格地板、家具 emoji、内景小人 5 色异色 + 内联字符头像异脸 + 头顶名字、asleep/isolated/active 表现、返回按钮赛博霓虹描边）、**虫洞装置与进度条**（霓虹环 + 进度条青紫→晶体青渐变 + 轮次角标 + 建成辉光动画，无外部资产）、**宪章/宇宙图标与弹窗节**（🛡️/🌌 内联图标视觉可区分 + 弹窗遮罩居中卡片 + 三种关闭 + 覆盖层背景继续动）；第 8 节科技建筑/星球表面/科技舱体内景已在（对应 §30，核对齐全，如缺则补）；**显式登记内景小人 5 色为「色值全部引用五个 CSS 变量、不写死散色」遵守清单的唯一例外**（避免后续前端实现误把它当违规散色删掉）；front-matter 保持 `inclusion: always`。`赛博坦宪章.md` 不改。
      决策与理由：`视觉风格.md` 是 `inclusion:always`，每轮前端实现自动注入；只改前端代码而漏补该 steering 会导致下一轮前端风格漂移，故列为独立必做任务（design §27 要求）。
      Files: `.kiro/steering/视觉风格.md`
      Verify: 四项要点齐全；内景 5 色例外成文登记；front-matter 仍 `inclusion:always`。

- [ ] 14. 二期端到端手测与收尾（依 requirements 二期验收标准 12–19）。
      `bash start.sh` 起后端 9527 + 前端 9528，逐项核对二期验收 12–19：①点家进内景（多小人异色异脸带名字走动/气泡/敲电脑-浇花-喝水循环、可返回全景）；②不操作见虫洞进度增长 + 讨论增量 + 达 100 建成动画 + 自动重置新一轮循环不止；③事件流读到成对互动剧情（八卦被怼/求赞/讨价还价/串门回应，口吻符合各自人格）；④确定触发 ECHO 隔离（约第 18 tick，警戒色、禁言不产出、到期自动恢复 active 亮灯）；⑤点宪章图标弹五条全文、点宇宙图标弹世界观文案、均可关闭且无上行写帧；⑥家为科技建筑 + 全景为外星星球表面 + 内景为科技舱体 + 三态可辨识；⑦二期纯函数 + 集成 `node --test` 全绿；⑧上行白名单仍仅 `hello`/`visitor_ask`/`ping`；⑨无 key 剧本轨开箱即玩、离线稳定、可完整录屏。
      Verify: 二期验收 12–19 逐条通过并记录；`cd server && npm test` 全绿；`bash start.sh` 一键启动不退化（9527/9528）。

---

## 需求—设计—计划可追溯性（自检）

| 功能块 | 需求 | 设计 | 计划步骤 | 纯函数 + 单测点 |
| --- | --- | --- | --- | --- |
| ① 家内景视图 | 10 / 16.4 | §19 / §30.4 | 8、9、12 | 无（纯表现层，由集成断言 `agent_event.toAgentId` 齐全间接守护） |
| ② 虫洞工程 | 11 | §20 | 1、3、6、7、10、12 | `advanceProject`（步 1，单测步 6 普通/恰达/跨100/轮次，集成步 7 建成护栏） |
| ③ 隔离机制 | 13 | §21 | 1、4、6、7、12 | `enterIsolation`/`tickIsolation`/修 `recoverDay`（步 1，单测步 6，集成步 7 隔离闭环 NIT-4 次序） |
| ④ 互动剧情 | 12 | §22 | 2、5、6、7、12 | `matchInteraction`（步 2，单测步 6 固定 rng/空/未知 type，集成步 7 一来一往） |
| ⑤ 宪章弹窗 | 14 | §23 | 11 | —（前端静态文案） |
| ⑥ 宇宙弹窗 | 15 | §23 | 11 | —（前端静态文案） |
| 视觉升级 | 16 | §30 | 8、9、12、13 | —（纯表现层，手测/录屏 + steering 守护） |
| 协议/宪章 5 | 跨 10–16 | §24 | 3（project_update）、全程 | 集成断言越权帧无状态变化（步 7） |

## 风险与假设（实现期留意，不阻塞）

- `figureStyle(id)`/家 `variant=hashId(id)%5` 对 5 个固定 id 不保证两两异色异脸异剪影（哈希可能撞）——属表现层，实现期可调哈希或按配置序定序分配，留意需求 10.3 五人同框可辨识度。
- 真模型轨（有 key）互动/工程提示词产出质量为可选增强，失败回退剧本机制已存在，不阻塞剧本轨演示。
- `node:test` + `ws` 集成测试在目标环境可运行为实现期验证项；若环境受限无法起 ws，单测纯函数仍须全绿，集成断言失败须定位而非跳过。
