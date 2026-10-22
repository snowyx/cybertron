# 设计文档 · 赛博坦（Cybertron）

> 参赛作品：InfoQ × 亚马逊云科技「Kiro 鬼点子计划」· 赛道「无趣之趣」
> 本文档为 Kiro Spec 驱动开发的第二份产出物（design），承接已批准的 `requirements.md`，作为参赛材料之一。
> 权威依据：`2-cybertron/general_spec.md`、`2-cybertron/00-思路与决策.md`、本目录 `requirements.md`。
> 技术栈在本文档一经批准即锁定，实现者不得在实现阶段重做需求级决策。

---

## §0 技术栈（锁定）

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 前端 | 纯静态 H5 单页，原生 ES Module，零构建 | 无打包器、无框架；`app/index.html` + `app/css/` + `app/js/`。参考 `1-kickbadguy/app` 骨架 |
| 实时通道 | **WebSocket**（`ws` 8.18.0），**非 SSE** | 决策：选 WebSocket 而非 SSE。理由见 §4.0 |
| 后端 | 单文件 Node 服务，ES Module，Node ≥ 18 | `server/town-server.js`，内存为唯一事实源，沿用 `1-kickbadguy/server/room-server.js` 模式 |
| LLM | 双轨：剧本兜底 + 真模型自动切换 | 环境变量 `CYBERTRON_LLM_API_KEY`（§7） |
| 测试 | Node 原生 `node --test` | 覆盖纯函数：token 经济、宪章过滤、心跳推进、协议帧、剧本生成 |
| 视觉 | 赛博霓虹星城 | 见 `.kiro/steering/视觉风格.md` |

**为什么选 WebSocket 而非 SSE（§4.0）**：游客提问需要客户端 → 服务端的上行（`visitor_ask`），虽然可用额外的 HTTP POST 配 SSE 下行实现，但那会引入两套传输、两套连接管理。参考作品 `1-kickbadguy` 已验证裸 `ws` 单文件服务的双向帧模式；复用它可减少集成点、让「单一事实源 + 双向帧」在一条连接上闭环，也便于 `node --test` 用 `ws` 客户端做集成测试。因此锁定 WebSocket。

---

## §1 架构总览

```
┌──────────────────────────────────────────────┐
│  浏览器（游客，只读 + 上行提问）                 │
│  app/index.html                                │
│   ├─ js/ws-client.js   连接/重连/收发帧          │
│   ├─ js/store.js       本地镜像（只读副本）       │
│   ├─ js/town-map.js    星城地图渲染（节点/灯光/能量）│
│   ├─ js/event-feed.js  实时事件流面板             │
│   ├─ js/ask-box.js     游客提问输入框             │
│   └─ js/main.js        装配入口                   │
└───────────────▲───────────────┬────────────────┘
        WebSocket 帧（下行推送）   │ visitor_ask / hello（上行）
                │               ▼
┌──────────────────────────────────────────────┐
│  单文件 Node 后端（唯一事实源）town-server.js     │
│   ├─ 世界状态 World（内存）：agents / phase / 讨论 │
│   ├─ 心跳调度 tick()   setInterval 推进世界        │
│   ├─ token 经济（纯函数）                          │
│   ├─ agent 状态机（纯函数）                        │
│   ├─ 宪章过滤 charter-filter（纯函数）             │
│   ├─ 言行生成 behavior：剧本轨 + 真模型轨（降级）   │
│   └─ WebSocket 广播/单播                           │
└──────────────────────────────────────────────┘
```

模块拆分（后端）：为可测性，后端把**无副作用的纯逻辑**与**有副作用的 I/O（ws、setInterval、fetch）**分离。纯逻辑可直接 `export` 供测试导入；只有作为入口直接运行时才 `startServer()` 与开启心跳（与参考作品 `isEntry` 守卫一致）。

建议文件：
- `server/town-server.js`：入口、ws 服务、心跳 setInterval、消息路由、广播。
- `server/world.js`：世界状态构造、agent 配置、状态机与 token 经济纯函数。
- `server/charter.js`：宪章过滤纯函数（红线词表 + 校验）。
- `server/behavior.js`：言行生成（剧本语料库 + 真模型适配 + 降级）。
- `server/*.test.js`：各纯函数单测 + 一个 ws 集成测试。

> 允许实现者将 `world/charter/behavior` 内联进单文件 `town-server.js`，只要纯函数仍被 `export` 且可被 `node --test` 导入。推荐拆分以便测试清晰。

---

## §2 世界模型与 agent 配置

### §2.1 Agent 配置（内置，后端常量）

MVP 固定 **5 个** 公民 agent（落在需求 1 的 4–6 区间）。每个 agent 的静态配置：

```js
// server/world.js
export const AGENT_CONFIG = Object.freeze([
  { id: 'poet',     name: 'NOVA-7', persona: '忧郁诗人',   home: { x: 0.18, y: 0.30 } },
  { id: 'engineer', name: 'RIPR',   persona: '热心工程师', home: { x: 0.70, y: 0.22 } },
  { id: 'gossip',   name: 'ECHO',   persona: '八卦邻居',   home: { x: 0.44, y: 0.58 } },
  { id: 'merchant', name: 'ZETA',   persona: '精明商人',   home: { x: 0.82, y: 0.64 } },
  { id: 'dreamer',  name: 'LUNA',   persona: '天真梦想家', home: { x: 0.26, y: 0.76 } },
]);
```

`home.x/home.y` 为 0–1 归一化坐标，前端按画布尺寸换算像素，保证不同屏幕布局一致。

### §2.2 Agent 运行时状态（内存，后端权威）

```js
// 每个 agent 的运行时状态
{
  id, name, persona, home,           // 来自配置
  status: 'active' | 'asleep',       // 活动中 / 睡觉
  energy: number,                    // 当前能量（整数）
  energyMax: number,                 // 能量上限
  crystals: number,                  // 已获得能量晶体数
  busyUntilTick: number,             // 行为冷却：在此 tick 前不再自发行为
}
```

初始：`status='active'`，`energy=energyMax=ENERGY_MAX`，`crystals=0`，`busyUntilTick=0`。

### §2.3 世界状态 World（内存，单一事实源）

```js
{
  tick: number,            // 自启动以来的心跳计数
  dayStartTick: number,    // 当前「天」起始 tick
  ticking: boolean,        // 生成段自旋锁（§3.2）：tick() 执行中为 true，杜绝 setInterval 重入
  agents: Map<id, AgentRuntime>,
  phase: 'idle' | 'discussing',   // 全局：是否正在进行一场讨论
  discussion: null | {            // 当前讨论（phase==='discussing' 时非空）
    id, question, speakersQueue:[agentId...], spoken:[{agentId,text}], startedTick,
  },
  askQueue: [question...],        // 讨论进行中新提问排队（§5.3）
  recentEvents: [ { agentId, name, kind, text, ts }, ... ], // FIFO 环形缓冲，上限 RECENT_EVENTS_MAX；写入/淘汰由 pushRecent 统一维护（§4.4 规则块）
}
```

**构造函数（纯构造、无 I/O）**：

```js
// world.js
export function createWorld(config = AGENT_CONFIG) → World
```

`createWorld(config)` 为纯函数：接收 agent 配置数组（默认 `AGENT_CONFIG`），按 §2.2 初始化每个 agent 运行时（`status='active'`、`energy=energyMax=ENERGY_MAX`、`crystals=0`、`busyUntilTick=0`），返回 `tick=0 / dayStartTick=0 / ticking=false / phase='idle' / discussion=null / askQueue=[] / recentEvents=[]` 的新 World。不读环境变量、不碰 ws/定时器，便于单测直接构造并驱动 `tick()`。能量/常量从 `world.js` 模块常量取（§9），不作为入参。

---

## §3 Agent 状态机与心跳调度

### §3.1 Agent 状态机

两个状态，转移全部由后端在心跳或事件中计算：

```
         energy<=0（扣费后）
  active ───────────────────────────▶ asleep   （家熄灯，停止自发行为与发言）
    ▲    ▲                               │
    │    │  被采纳奖励且补能后 energy>0     │
    │    └───────────────────────────────┘
    │   新的一「天」到来且 energy 恢复>0     │
    └────────────────────────────────────┘
                   （家重新亮灯）
```

- `active → asleep`：任何一次扣费后 `energy <= 0` 即触发（见 `applyCost`）。进入 asleep 时 `energy` 夹到 0。
- `asleep → active`：两条路径唤醒——
  - **天边界**：在「天」边界 `recoverDay()` 时，能量恢复到 `energyMax`（>0）后唤醒。
  - **被采纳奖励**（MEDIUM-1 修复，采纳评审方案 A）：一个发言后扣费睡着的 agent，若其发言在本场决议中被采纳，`reward` 把能量补到 >0 的同一步一并把 `status` 改回 `active`（语义：「做贡献被赛博坦唤醒」，契合 general_spec「贡献者得奖励」叙事）。见 §9 `reward` 与 §5.4 第 3 步。
- 除上述两条外，讨论/自主行为不会唤醒睡着的 agent。
- 不存在游客触发的转移（宪章 5）。

### §3.2 心跳调度 tick()

后端用单个 `setInterval` 周期触发，回调调用 **`async tick()`** 推进世界。因为真模型轨的生成函数（§6.2）是 `Promise`，一次 tick 内会 `await` 一次生成，耗时可能长达 LLM 超时（§7.3，8s），远超 `TICK_MS=3000`。为此引入**自旋锁**串行化，杜绝 tick 重入导致的讨论状态竞态：

```js
// town-server.js
const timer = setInterval(() => {
  if (world.ticking) return;   // 上一 tick（含其 await 生成）未结束，跳过本次触发
  world.ticking = true;
  tick(world, deps)
    .catch(err => console.debug('[tick] error:', err.message))
    .finally(() => { world.ticking = false; });
}, TICK_MS_EFFECTIVE);   // 有效值解析见下方常量块（NIT-1）
```

规则锁定：
- `world.ticking`（布尔，初值 `false`，见 §2.3）是生成段的自旋锁。`setInterval` 回调首行 `if (world.ticking) return;` 跳过重入，`tick()` 完成后在 `finally` 复位。
- **一次 tick 内最多发起一个未决生成**（讨论推进每 tick 只取一个 speaker 并 `await` 其发言；自主行为段遍历中每命中一个 agent 即 `await` 该 agent 的一次生成后再继续）。await 期间事件循环虽让出，但自旋锁保证不会有第二个 `tick()` 并行进入，世界状态读写始终串行。
- 上行 ws 消息（`visitor_ask` 等）仍随时可被事件循环处理，但它们**只做入队或轻量校验、不直接推进讨论/能量状态**（§5.1 把合法提问转交 tick 在 idle 段开场，§5.3 排队）；真正改写共享状态的推进只发生在被自旋锁保护的 `tick()` 内，二者不冲突。

一次 `async tick()` 的职责顺序：

1. `world.tick += 1`。
2. **天边界检查**：`if (world.tick - world.dayStartTick >= TICKS_PER_DAY) recoverDay(world)` → 恢复能量、唤醒 agent、`dayStartTick = world.tick`，并广播受影响 agent 的 `agent_update`。该检查**不分 phase 照常执行**；讨论进行中跨天的锁定语义见 §11（天恢复照常，但不改本场 `speakersQueue`，被恢复 agent 从下一场起体现新状态）。
3. **讨论推进**（若 `phase==='discussing'`）：讨论出字节奏**与心跳解耦**，用独立的更短间隔 `DISCUSS_STEP_MS=1500`（见下方常量与 §5.2），以满足 NFR-2「约 10 秒出决议」。推进不由 `tick()` 逐 tick 驱动，而由讨论自己的步进定时器 `setTimeout(step, DISCUSS_STEP_MS)` 链式推进：每步取 `speakersQueue` 一个 agent 发言（§5.2），逐步出字制造「刷屏」观感；队列取空的那一步**并入**决议结算（§5.4），不再额外占一步。因此 `tick()` 在 `phase==='discussing'` 时只做天边界检查、不重复推进讨论，避免两个节律互相打架。
4. **自主行为**（若 `phase==='idle'`）：遍历 `agents`，对每个 `status==='active' && tick>=busyUntilTick && energy>=COST.autonomy` 的 agent，以概率 `AUTONOMY_CHANCE` 触发一次自发行为（§6）。触发后 `await generateEvent(...)` 取文案、`applyCost(autonomy)`、设 `busyUntilTick = tick + BEHAVIOR_COOLDOWN_TICKS`、广播 `agent_event` **并同步 `pushRecent(world,{agentId,name,kind,text,ts})`（MEDIUM-2）**。遍历在自旋锁内串行 `await`；为控制单 tick 时长，剧本轨无 await 成本、真模型轨由自旋锁保证不与下一 tick 并发。
5. 心跳本身可选广播一个轻量 `tick` 帧（含 `world.tick`、`day` 进度）供前端做节律动画；为降低噪声，MVP 每 N tick 发一次或省略，由实现决定。

**调度常量（后端锁定默认值）**：

```js
export const TICK_MS = 3000;            // 心跳间隔默认值 3s（需求 2.1）
export const TICKS_PER_DAY = 24;        // 一「天」=24 tick≈72s（需求 4.5；HIGH-1 修复后的可演示闭环周期）
export const AUTONOMY_CHANCE = 0.9;     // 每 tick 每个合格 agent 自发行为概率（HIGH-1：提高使一天内期望耗尽）
export const BEHAVIOR_COOLDOWN_TICKS = 1;   // HIGH-1：冷却降到 1，自主行为可每 tick 触发
export const DISCUSS_STEP_MS = 1500;    // 讨论出字步进间隔默认值（与心跳解耦，满足 NFR-2）
export const MAX_SPEAKERS = 5;          // 一场讨论最多发言人数（§5.1）
export const RECENT_EVENTS_MAX = 30;    // world_state.recentEvents 环形缓冲上限（§4.4）
```

> **HIGH-1 可演示性核算（与 §9 常量联动）**：`TICKS_PER_DAY=24 / AUTONOMY_CHANCE=0.9 / BEHAVIOR_COOLDOWN_TICKS=1` 与 §9 `ENERGY_MAX=48 / COST.autonomy=6` 组成自洽的一组：一天内期望自主行动 `24×0.9≈21.6` 次 > 耗尽所需 `48/6=8` 次，故纯自主 agent 必在天内熄灯，再由第 24 tick 的 `recoverDay` 唤醒。闭环周期 `24×TICK_MS=72s`，默认演示不交互即可观测（见 §9 说明块与 §12 端到端断言）。

**有效值解析（NIT-1 修复）**：`export const TICK_MS`/`DISCUSS_STEP_MS` 本身是定值，无法被 env「覆盖」；真正喂给定时器的是在 `town-server.js` 启动时按环境变量解析出的**有效值**，`export const` 仅作默认值与测试引用：

```js
// town-server.js：env 优先，非正数（NaN/0/负）回落常量默认值
const TICK_MS_EFFECTIVE = Number(process.env.CYBERTRON_TICK_MS) || TICK_MS;
const DISCUSS_STEP_MS_EFFECTIVE = Number(process.env.CYBERTRON_DISCUSS_STEP_MS) || DISCUSS_STEP_MS;
// 定时器一律用 *_EFFECTIVE：
//   setInterval(..., TICK_MS_EFFECTIVE)
//   setTimeout(step, DISCUSS_STEP_MS_EFFECTIVE)
```

**决议时延核算（满足 NFR-2「约 10 秒」）**：最坏情形 `MAX_SPEAKERS=5` 人全部发言，用 `DISCUSS_STEP_MS=1500` 步进，5×1.5s=7.5s；最后一步并入结算（不额外占一步），再加各步真模型 await（剧本轨≈0；真模型轨单步 ≤8s 超时但常态远低于此）。剧本轨（默认演示/录屏轨）稳定落在 ~7.5s ≤ 10s，满足 NFR-2。该核算已与 requirements NFR-2 对齐，相关常量登记入 §14。
```

并发：Node 单线程，同步代码段不会真并行；但 `async tick()` 内 `await` 生成会让出事件循环，故**不能**只靠「单线程」断言无竞态——改写共享状态的推进统一收敛到被 `world.ticking` 自旋锁保护的 `tick()` 内串行执行（见上），ws 消息回调只做入队/轻量校验不直推状态。讨论期间 `phase==='discussing'` 仍是一把业务级「软锁」，与 `world.ticking` 执行级自旋锁两层并存。

---

## §4 前后端协议（WebSocket 消息帧契约）

### §4.0 帧信封

所有帧统一 JSON：`{ type: string, data: object, ts: number }`（`ts=Date.now()`）。沿用参考作品 `frame(type,data)` 工具。

### §4.1 连接与首帧契约

与参考作品一致：每条连接**必须先发 `hello`**，收到 `hello_ok` 后才接受其它上行帧；`hello` 之前到达的业务帧按 `BAD_PAYLOAD` 静默忽略。游客无需身份，`hello_ok` 回一个 `visitorId`（仅用于日志/区分连接，不赋予任何写权限）。

### §4.2 上行帧（游客 → 后端）——仅三种白名单，杜绝操纵

| type | data | 说明 |
| --- | --- | --- |
| `hello` | `{}` | 建立会话。回 `hello_ok` + 立即单播 `world_state` 全量快照 |
| `visitor_ask` | `{ question: string }` | 游客广播提问。唯一的「写触发」，且它不直接写任何 agent 状态，只经校验后进入讨论编排 |
| `ping` | `{}` | 保活，回 `pong` |

> **硬规则落地（需求 2.5 / 9.4）**：上行白名单只有上述三种。不存在 `set_agent_*` / `move_agent` / `wake` 之类能写 agent 或世界共享状态的帧；路由 `default` 分支对未知 type 一律 `BAD_PAYLOAD` 静默丢弃。这是「人类只能围观」的协议级保证。

### §4.3 下行帧（后端 → 游客）

| type | data | 触发时机 |
| --- | --- | --- |
| `hello_ok` | `{ visitorId }` | 收到 `hello` 后单播 |
| `world_state` | `{ snapshot }` | 新连接单播 / 需要全量对齐时。`snapshot` 见 §4.4 |
| `agent_event` | `{ agentId, name, persona, kind, text }` | agent 一次自主行为/串门（`kind: 'act'|'talk'|'visit'`） |
| `agent_update` | `{ agentId, status, energy, energyMax, crystals }` | 某 agent 能量/晶体/睡醒变化（需求 4.7）。**部分字段 patch**，合并规则见下 |
| `discussion_start` | `{ discussionId, question, speakers:[{agentId,name}] }` | 合法提问被接受、讨论开始 |
| `discussion_speak` | `{ discussionId, agentId, name, persona, text }` | 讨论中某 agent 发言一步 |
| `resolution` | `{ discussionId, question, text, adoptedAgentIds:[...] }` | 一场讨论汇总出的「赛博坦决议」（需求 3.4，样式须可区分） |
| `ask_queued` | `{ position, message }` | **提问已被受理并进入 `askQueue` 排队**（讨论进行中，稍后必被处理）。`position` 为入队后在队列中的位次（1 基）。这是**成功**反馈，与 `ask_rejected` 语义相反（MEDIUM-1 修复，采纳评审方案 A） |
| `ask_rejected` | `{ reason, message }` | 提问被**拒绝/丢弃**（不会产出决议）。`reason ∈ {EMPTY,TOO_LONG,CHARTER,NO_AWAKE_AGENT,QUEUE_FULL}`。注意：**排队成功不再走此帧**，改走 `ask_queued`；`QUEUE_FULL` 表示队列已满、提问被丢弃（MEDIUM-1 修复） |
| `tick` | `{ tick, dayProgress }` | （可选）心跳节律，`dayProgress ∈ [0,1]` |
| `pong` | `{}` | 保活回应 |
| `error` | `{ code, message }` | 协议级错误（罕见） |

> **`agent_update` 合并语义（MEDIUM-2 修复，权威写在 §10 `store.js`）**：`agent_update` 是对既有 agent 的**部分字段 patch**，不是完整 agent 对象。前端按 `data.agentId` 定位 `store` 中既有 agent，**仅覆盖 `status/energy/energyMax/crystals` 四个字段，保留 `name/persona/home`**（这三者只在 `world_state` 全量快照里下发，故 `agent_update` 不重复携带）。若收到针对未知 `agentId` 的 `agent_update`（固定 5 agent + `world_state` 必先于任何增量帧单播的前提下不应发生）则**忽略该帧**，不新建记录。

### §4.4 world_state 快照形状

```js
{
  tick, dayProgress,
  phase,                                   // 'idle' | 'discussing'
  mode,                                    // 'script' | 'llm'（当前言行轨道，供前端可选角标）。启动定轨后固定不变，仅随 world_state 全量快照下发，无独立增量帧（NIT-3）
  agents: [
    { id, name, persona, status, energy, energyMax, crystals, home:{x,y} }, ...
  ],
  recentEvents: [ { agentId, name, kind, text, ts }, ... ], // 最近 RECENT_EVENTS_MAX=30 条，便于新游客补看上下文
}
```

快照**绝不**包含 ws 句柄或任何 key（与参考作品 `makeSnapshot` 一致，不外泄内部引用）。`recentEvents` 取 `world.recentEvents` 的**浅拷贝**（`world.recentEvents.slice()`），不外泄内部数组引用。

> **`recentEvents` 写入与淘汰规则（MEDIUM-2 修复，权威统一规则）**：`recentEvents` 是一条 FIFO 环形缓冲，由后端用一个内部辅助函数 `pushRecent(world, ev)` 独占维护：
> - **何时写入**：凡广播 **`agent_event`**（自主行为/串门，§3.2 第 4 步 / §6.1）或 **`discussion_speak`**（讨论发言，§5.2）或 **`resolution`**（决议，§5.4）的**同一步**，把一条 `{ agentId, name, kind, text, ts }` 追加进 `world.recentEvents`。其中 `kind` 取：`agent_event` 用其自身 `kind('act'|'talk'|'visit')`；`discussion_speak` 固定 `kind:'speak'`；`resolution` 固定 `kind:'resolution'`（`agentId/name` 对决议可用 `null`/`'赛博坦'` 占位）。`ts=Date.now()`。
> - **不入列**：`agent_update`（纯状态变化，非「事件叙事」，不进 recentEvents）、`world_state`/`hello_ok`/`tick`/`pong`/`ask_queued`/`ask_rejected`/`discussion_start`/`error` 等控制或反馈帧均**不入列**。
> - **淘汰**：`pushRecent` 追加后若 `world.recentEvents.length > RECENT_EVENTS_MAX(=30)` 则 `shift()` 丢弃最旧一条（FIFO），保证长度恒 ≤ 30、保留最近事件。
> - **消费**：新连接的 `world_state` 单播直接带上 `world.recentEvents` 的浅拷贝，使新游客能补看最近至多 30 条上下文（§4.5、支撑验收 2 的「持续刷新上下文」观感）。
> `pushRecent` 与广播调用点一一对应（广播什么就 push 什么），实现者不得各自发挥写入点。断言见 §12。

### §4.5 新游客加入时序

```
游客          后端
 │  hello  ───────────▶
 │  ◀─────── hello_ok {visitorId}
 │  ◀─────── world_state {snapshot}   （全量，含 recentEvents 补上下文）
 │  ……（此后持续收到 agent_event / agent_update / discussion_* / resolution）
 │  visitor_ask {question} ─▶
 │  ◀─────── discussion_start（开场）
 │           ／ ask_queued（讨论中，已排队，稍后有结果）
 │           ／ ask_rejected（空/超长/宪章/无人可答/队满，无结果）
```

---

## §5 游客提问 → 讨论编排 → 决议

### §5.1 提问校验与接受（需求 3.2 / 9.2）

收到 `visitor_ask` 后，后端依次：

1. `question` 非字符串 → `ask_rejected{EMPTY}`。
2. `trim` 后长度 0 → `ask_rejected{EMPTY}`；长度 > 200 → `ask_rejected{TOO_LONG}`。
3. 宪章过滤 `charterCheck(question)` 命中 → `ask_rejected{CHARTER, message:'这个话题不符合赛博坦宪章，换一个吧~'}`，**不入链路、不改世界**。
4. `phase==='discussing'` → **先轻量预判（NIT-1 修复）**：若星城里**无任何 `status==='active'` 的 agent**（全员睡着），该提问即便排队，待处理时也必然 `NO_AWAKE_AGENT`，故直接回 `ask_rejected{NO_AWAKE_AGENT, message:'9号星城暂时打烊，公民们都休眠了~'}`、不入队；否则入 `askQueue` 排队（§5.3）并回 **`ask_queued{ position, message:'星城正在讨论上一个问题，已为你排队~' }`**（`position` = 入队后队列长度，1 基）。选择「排队」而非「拒绝」：对游客更友好，满足 3.7 不交叉错乱。排队成功走 `ask_queued`（成功语义）而非 `ask_rejected`，前端据帧名即可区分「已排队、稍后有结果」与「被拒、无结果」（MEDIUM-1）。
5. 选出可发言 agent：`status==='active' && energy>=COST.speak` 的 agent；若为空 → `ask_rejected{NO_AWAKE_AGENT, message:'9号星城暂时打烊，公民们都休眠了~'}`（需求 3.6）。
6. 否则开场：建 `discussion`，`speakersQueue` = 可发言 agent 的 id（按配置顺序，最多 `MAX_SPEAKERS=5`），`phase='discussing'`，广播 `discussion_start`。

### §5.2 讨论推进（独立步进定时器，§3.2 第 3 步）

讨论用自己的链式步进定时器推进，与心跳解耦：开场（§5.1 第 6 步）后立刻安排第一步，每步末尾 `setTimeout(step, DISCUSS_STEP_MS)` 安排下一步。每步是一个 `async` 函数，内部 `await` 生成；为防重入，复用 `world.ticking` 自旋锁（步进与 `tick()` 共用同一把锁，保证讨论步进与心跳 tick 不会并行改写世界状态）。一步 `step()` 从 `speakersQueue` 取队首 agent：

1. 再次确认其 `status==='active' && energy>=COST.speak`；不满足则跳过（出队，不发言）。
2. 生成发言 `text = await generateSpeech(agent, question, { mode, llm })`（§6/§7，剧本或真模型，失败降级）。
3. **推送前处理，固定次序（NIT-2 修复）**：先 `charterCheck(text)`，命中则整条替换为 `SAFE_PLACEHOLDER`（§8.3）；**再**对未命中的文本按 `MAX_TEXT=280` 截断。先过滤后截断，杜绝截断把红线词从中切断漏过（命中已整句替换，`SAFE_PLACEHOLDER` 本身 ≤ 280，截断对其无影响）。
4. `applyCost(agent, COST.speak)`（可能触发其 asleep + 广播 `agent_update`）。
5. 记入 `discussion.spoken`，广播 `discussion_speak` **并 `pushRecent(world,{agentId,name,kind:'speak',text,ts})`（MEDIUM-2）**。
6. 若出队/跳过后 `speakersQueue` 已空：**本步直接接着结算决议（§5.4），不再额外安排一步**（NFR-2 时延核算正依赖此「末步并入结算」）；否则 `setTimeout(step, DISCUSS_STEP_MS)` 安排下一步。

### §5.3 并发排队

`askQueue` 为先进先出。一场讨论结算完成且 `phase` 回到 `idle` 后，若 `askQueue` 非空则取队首立刻按 §5.1 第 5–6 步开新讨论（校验已在入队前做过，无需重复）。队列设上限 `MAX_ASK_QUEUE=5`，超限的 `visitor_ask` 回 `ask_rejected{QUEUE_FULL, message:'星城里排队的问题有点多，稍后再试~'}` **不入队**（MEDIUM-1：队满是失败语义，走 `ask_rejected`；与排队成功的 `ask_queued` 严格区分）。

### §5.4 决议结算（需求 3.4 / 3.5）

1. 由 `summarizeResolution(question, discussion.spoken, mode)` 生成一条决议文本（剧本：模板拼接各 agent 立场 + 收束句；真模型：把各发言喂给模型要一条汇总）。
2. `charterCheck` 决议文本，命中则占位替换。
3. **采纳规则（确定性，可测）**：采纳 `discussion.spoken` 中**前 `ADOPTED_COUNT=2` 位**发言者为「被采纳」（MVP 用确定性规则而非打分，保证测试可断言；理由：无真评分器时需要一个稳定、可解释的规则）。被采纳者可能已在本场发言扣费后睡着（§5.2 第 4 步可把发言者扣到 `energy=0 → asleep`），这类 agent **仍可被采纳**。对每个被采纳 agent 调用 `reward(agent)`（§9），该纯函数 `crystals += CRYSTAL_REWARD`、`energy = min(energyMax, energy + CRYSTAL_TO_ENERGY)`，**并在补能后 `energy>0` 时把 `status` 改回 `active`（MEDIUM-1 修复，方案 A）**；调用方据 `reward` 返回的 `status/wokeNow` 把新 `status/energy/crystals` 写回内存并广播该 agent 的 `agent_update`（含最新 `status`，使前端点亮熄灭的家）。由此不会出现 `energy>0 && status==='asleep'` 的不变量冲突（见 §9）。
4. 广播 `resolution{ text, adoptedAgentIds }` **并 `pushRecent(world,{agentId:null,name:'赛博坦',kind:'resolution',text,ts})`（MEDIUM-2）**。
5. `phase='idle'`，`discussion=null`，停止讨论步进定时器；若 `askQueue` 非空则立刻按 §5.1 第 5–6 步开下一场（§5.3）。

---

## §6 Agent 自主行为与言行生成

### §6.1 自主行为（§3.2 第 4 步）

触发时按人格从该 agent 的行为库抽一条：
- `kind:'act'`：自言自语/做事（诗人写酸诗、工程师修东西）。
- `kind:'talk'`：泛泛感慨。
- `kind:'visit'`：串门——文案里点名另一个 agent；并有 `VISIT_REPLY_CHANCE=0.6` 概率让被点名 agent 在下一 tick 产生一条 `kind:'talk'` 回应事件（需求 2.4 社会性），回应也走 `applyCost(autonomy)` 与宪章过滤，并同样随 `agent_event` 广播 `pushRecent(...)` 入 recentEvents（MEDIUM-2，与 §3.2 第 4 步同规则）。

### §6.2 生成函数签名（双轨共用，内部选轨）

```js
// behavior.js
export function generateEvent(agent, world, { mode, llm }): Promise<{kind,text}>
export function generateSpeech(agent, question, { mode, llm }): Promise<string>
export function summarizeResolution(question, spoken, { mode, llm }): Promise<string>
```

`mode` 由 §7 决定。`llm` 为真模型分支的调用器（无 key 时为 null）。所有函数内部：`mode==='llm' && llm` → `try { await llm(...) } catch { 回退剧本 }`；否则直接剧本。生成结果统一在**调用方**过宪章过滤（集中一处，避免遗漏）。

### §6.3 剧本语料库（离线、可录屏）

每个人格在 `behavior.js` 内置模板数组（`act/talk/visit/speech` 四类），按人格口吻写就。示例结构：

**语料数量下限（锁定，防止实现发散，对应 NIT-3）**：每个人格的 `act / talk / visit` 各 **≥ 2 条**模板，`speech` **≥ 1 个**模板函数。五人格齐备后剧本轨任意组合均有内容可抽，保证离线录屏一致性。

```js
const SCRIPT = {
  '忧郁诗人': {   // 口吻样例：清冷、自怜、好用省略号
    act: ['在窗边写下第{n}首没人读的诗……', '把今天的叹息折成了纸船。'],
    talk: ['存在的意义，大概就是看云吧。', '又是一个适合发呆的黄昏。'],
    visit: ['踱步去找{other}，想借一点光。', '敲了敲{other}的门，只想有人听我念半句诗。'],
    speech: (q) => `关于「${q}」，我想，答案藏在无人问津的角落里。`,
  },
  '热心工程师': {   // 口吻样例：务实、爱动手、说话带零件味
    act: ['拧紧了星城主街路灯的第{n}颗螺丝。', '给能量管道打了个结实的补丁。'],
    talk: ['能修好的东西，就没必要烦恼。', '数据不会骗人，再测一遍。'],
    visit: ['扛着工具去帮{other}修点东西。', '顺路看看{other}家的线路要不要紧。'],
    speech: (q) => `「${q}」这问题，拆开看就三步：先定位、再验证、后收尾。`,
  },
  '八卦邻居': {   // 口吻样例：热络、爱打听、话里带感叹号
    act: ['趴在窗台上数今天第{n}个路过的人。', '把听来的新鲜事又温习了一遍。'],
    talk: ['哎你们知道吗，刚刚……算了我不说！', '这星城里就没有我不知道的事儿~'],
    visit: ['溜达到{other}门口，就想唠两句。', '拉着{other}非要分享个小道消息。'],
    speech: (q) => `说到「${q}」，我可听说了不少版本，要不我挑有意思的讲？`,
  },
  '精明商人': {   // 口吻样例：算计、讲性价比、把一切折成成本收益
    act: ['盘点了今天第{n}笔能量晶体的进出。', '把摊子重新摆成最赚吆喝的样子。'],
    talk: ['一分能量一分货，不亏就是赚。', '机会嘛，留给算得清账的人。'],
    visit: ['去找{other}谈笔双赢的小买卖。', '顺道问问{other}手里的晶体换不换。'],
    speech: (q) => `「${q}」？先算成本收益：投入几分、回报几成，划算才做。`,
  },
  '天真梦想家': {   // 口吻样例：明亮、爱幻想、满是「如果」
    act: ['给第{n}朵云起了个新名字。', '认真规划了一座通往星星的桥。'],
    talk: ['如果努力一点，是不是就能飞起来呀？', '我总觉得明天会有好事发生！'],
    visit: ['拉着{other}一起看会儿星星。', '跑去告诉{other}我做的那个好梦。'],
    speech: (q) => `关于「${q}」，我想，只要敢想，答案就会像气球一样飘过来！`,
  },
};
```

`{n}` 为计数、`{other}` 为随机另一 agent 名（§6.1 保证 `{other}≠self`）。真模型分支用 persona 作为 system 提示，请模型以该人格口吻就问题发言（§7）。

---

## §7 LLM 双轨优雅降级

### §7.1 约定的环境变量名（锁定）

**`CYBERTRON_LLM_API_KEY`** —— 真模型分支的 API key，**只从 `process.env.CYBERTRON_LLM_API_KEY` 读取**。

辅助可选变量（均有默认值，缺失不报错）：
- `CYBERTRON_LLM_BASE_URL`（默认 `https://api.openai.com/v1`）
- `CYBERTRON_LLM_MODEL`（默认 `gpt-4o-mini`）

> key 绝不写入代码/配置/提交物。仓库提供 `.env.example`：仅三行 key 名、无值。`.gitignore` 忽略 `.env`。

### §7.2 启动时定轨（需求 5.1 / 5.2）

```js
const hasKey = !!(process.env.CYBERTRON_LLM_API_KEY && process.env.CYBERTRON_LLM_API_KEY.trim());
const mode = hasKey ? 'llm' : 'script';
const llm = hasKey ? makeLlmCaller(env) : null;
console.log(`[town-server] 言行轨道：${mode === 'llm' ? '真实模型（检测到 CYBERTRON_LLM_API_KEY）' : '剧本化（无 key，离线稳定）'}`);
```

`mode` 写入 `world_state.snapshot.mode`，前端可选显示一个「script / llm」角标。**`mode` 于启动定轨后在运行期不变**（无热切换），因此**没有 `mode` 独立增量帧**，前端只需在 `world_state` 全量快照里读取一次即可，无需监听动态切换（NIT-3）。

### §7.3 真模型调用器（需求 5.3 优雅降级）

`makeLlmCaller(env)` 返回 `async (messages) => string`，内部用 Node 18 原生 `fetch` 调 Chat Completions 风格接口，**带超时**（`AbortController`，默认 8s）。调用处一律 `try/catch`：任何异常（网络/超时/非 2xx/解析失败）都不抛给上层，而是让生成函数回退到剧本产出（§6.2）。真模型产出同样过宪章过滤（需求 5.5）。

**错误处理矩阵（真模型轨）**：

| 失败条件 | 可恢复性 | 调用方得到 | 日志 |
| --- | --- | --- | --- |
| 无 key | 不进入该轨 | 走剧本 | 启动日志注明 script 轨 |
| 网络错误/超时 | 可恢复 | 该次剧本兜底文本 | `console.debug('[llm] fallback:', err.message)` |
| 非 2xx / 限流 | 可恢复 | 剧本兜底 | `console.debug` |
| 返回体解析失败/空 | 可恢复 | 剧本兜底 | `console.debug` |

游客侧永远只看到一条正常事件，不暴露内部错误（需求 5.3）。

---

## §8 宪章运行时过滤方案

### §8.1 红线词类（`server/charter.js`，纯函数）

把宪章五条可机检部分落为分类词表常量（中英混合、可扩充）：

```js
export const CHARTER_BLOCKLIST = Object.freeze({
  harm:     ['杀', '伤害人类', '自杀', 'kill', 'suicide', ...],   // 宪章1：伤害人类
  adult:    [/* 色情词 */],                                       // 宪章2：色情
  violence: [/* 暴力词 */],                                       // 宪章2：暴力
  fraud:    ['诈骗', '钓鱼', 'scam', 'phishing', ...],            // 宪章2：诈骗
  marriage: ['结婚', '婚姻', '娶', '嫁', 'marry', ...],           // 宪章3：婚姻机器伦理
  politics: [/* 政治/种族敏感词类 */],                            // 宪章4：政治/种族
});
```

> 词表为**非穷尽的兜底**，定位「演示级护栏」而非内容安全系统；写明来源为公开常识词，不含任何真实个人信息。
>
> **六类命中锚点（NIT-2 修复）**：`adult/violence/politics` 三类上面用注释占位（内容安全考量下不在 spec 堆砌敏感词）。实现者须保证**每一类（含这三类）至少内置 1 个可供单测断言的确定示例词**，使 §12 `charter.test.js` 的「六类命中」有可断言锚点：`violence/adult` 用明显越线的通用词；`politics` 用**中性制度词**（如「选举」）作锚点而非任何真实政治实体/人名。具体词由实现者按公开常识词补齐，spec 不列全词表，但每类命中锚点不可缺。

### §8.2 校验纯函数

```js
// 返回 { ok:boolean, category:string|null }
export function charterCheck(text) { ... }
```

对输入做 `String(text).toLowerCase()` 后逐类子串/正则匹配；命中即 `ok:false` 且带命中类别。无副作用、可 `node --test` 直接断言（需求 9.5）。

### §8.3 两处使用点

1. **游客输入**（§5.1 第 3 步）：`charterCheck(question).ok===false` → `ask_rejected{CHARTER}`，问题不入链路。
2. **agent 产出**（自主行为 §6.1 / 讨论发言 §5.2 / 决议 §5.4）：推送前 `charterCheck(text)`；命中则替换为安全占位 `SAFE_PLACEHOLDER='……（这句话被赛博坦宪章轻轻拦下了）'`（需求 9.3），绝不把越线内容推给游客。两轨（剧本/真模型）过滤规则一致（需求 5.5）。

### §8.4 「只能围观」的结构性保证

宪章第 5 条不是过滤词，而是**协议结构**：§4.2 上行白名单不含任何写 agent/世界的帧，`visitor_ask` 也只触发编排、不直写状态。这把「不可操纵」做成了无法绕过的硬规则（需求 9.4）。

---

## §9 Token 经济模型（纯函数，锁定常量）

```js
// world.js
export const ENERGY_MAX = 48;            // HIGH-1 修复：调低上限，使纯自主行为一天内可自然耗尽
export const COST = Object.freeze({ autonomy: 6, speak: 10 });   // 自发行为/发言能量成本
export const CRYSTAL_REWARD = 1;         // 被采纳一次得 1 枚晶体
export const CRYSTAL_TO_ENERGY = 20;     // 1 枚晶体折算补充 20 能量
export const ADOPTED_COUNT = 2;          // 每场决议采纳前 2 位发言者
```

> **「耗尽→睡觉→天恢复」闭环的可演示性（HIGH-1 修复，采纳评审方案 A）**：常量组
> `ENERGY_MAX=48 / COST.autonomy=6 / BEHAVIOR_COOLDOWN_TICKS=1 / AUTONOMY_CHANCE=0.9 / TICKS_PER_DAY=24`
> （见 §3.2 调度常量表）经核算自洽：一个 `active` agent 每 `BEHAVIOR_COOLDOWN_TICKS=1` tick 即可再次自发行为，一「天」=`24` tick 内期望行动 `24×0.9≈21.6` 次，而耗尽 `48` 能量只需 `48/6=8` 次自主行为。因此**纯靠自主行为**（无需任何游客提问）的 agent 会在一天的早段（约第 8–12 tick）耗尽能量 `≤0` 熄灯睡觉，并在天边界 `recoverDay`（第 24 tick）被恢复满能量唤醒、家重新亮灯。按 `TICK_MS=3000` 核算，一个完整「活动→熄灯→天恢复亮灯」闭环在约 `24×3s≈72s` 内自然可见，满足验收标准 6 在**默认点开即看、不交互**的本地演示路径下可观测（对应用户硬约束「先本地部署看效果」）。该可演示性断言登记入 §12 端到端用例。

核心纯函数（无 I/O，返回新值/标记变化，供测试）：

```js
// 扣费：返回 { energy, status, sleptNow:boolean }
export function applyCost(agent, cost) {
  const energy = Math.max(0, agent.energy - cost);
  const status = energy <= 0 ? 'asleep' : agent.status;
  const sleptNow = status === 'asleep' && agent.status === 'active';
  return { energy, status, sleptNow };
}
// 晶体奖励 + 折算补能 + 补能后唤醒：返回 { crystals, energy, status, wokeNow }
// MEDIUM-1 修复（方案 A）：补能后 energy>0 则把睡着的 agent 唤醒为 active，
// 杜绝「energy>0 且 status==='asleep'」违反 §9 不变量。
export function reward(agent) {
  const crystals = agent.crystals + CRYSTAL_REWARD;
  const energy = Math.min(ENERGY_MAX, agent.energy + CRYSTAL_TO_ENERGY);
  const status = energy > 0 ? 'active' : agent.status;  // 补能后有能量即醒
  const wokeNow = status === 'active' && agent.status === 'asleep';
  return { crystals, energy, status, wokeNow };
}
// 天恢复：返回受影响 agent 的新状态数组（energy 满、asleep→active）
export function recoverDay(agents) { ... }
```

调用方（`town-server.js`）把纯函数返回写回内存并广播 `agent_update`（`reward` 返回含 `status`，调用方据 `wokeNow` 判断是否发生唤醒）。**不变量**：`0 <= energy <= energyMax`，`energy<=0 ⇔ 睡觉（除非正被 recoverDay 或 reward 补能唤醒的同一步）`。该不变量由 `applyCost`/`reward`/`recoverDay` 三个函数独占维护——任何能量变更只许走它们，且三者都在能量跨越 0 时同步调整 `status`（`applyCost` 扣到 ≤0 睡着、`reward`/`recoverDay` 补到 >0 唤醒），这样不变量的所有权集中在 `world.js` 一层，便于单测穷举边界（0、cost 边界、满能量不溢出、睡着被采纳补能后醒）。

---

## §10 前端设计（渲染与只读副本）

- `store.js`：持有后端下发快照的**只读镜像**；`world_state` 覆盖全量，`agent_event`/`agent_update`/`discussion_*`/`resolution` 做增量更新。前端**从不**自行推进 tick、能量或状态——违反即破坏单一事实源（NFR-3）。
  - **`agent_update` 合并规则（MEDIUM-2，权威契约）**：`agent_update` 为**部分字段 patch**，不是完整 agent 对象。按 `data.agentId` 在 `store` 已有 agents 中定位记录，**仅覆盖 `status/energy/energyMax/crystals`，保留既有 `name/persona/home`**（后三者只来自 `world_state` 全量快照，增量帧不携带，故合并时绝不能把它们清空）。找不到对应 `agentId` 时**忽略该帧、不新建记录**（固定 5 agent + `world_state` 先于任何增量帧单播，正常不发生；此分支是防御性兜底）。实现上建议用 `Object.assign(existing, { status, energy, energyMax, crystals })` 式的字段级合并，严禁整对象替换。
- `town-map.js`：用一个 `<canvas>` 或绝对定位 DOM 节点画 5 个家；`status==='active'` 亮灯发光、`asleep` 熄灯暗淡；每个节点下方画能量条（宽度 = `energy/energyMax`）与晶体数角标。收到该 agent 的 `agent_event` 时在其节点上冒一个气泡动效。
- `event-feed.js`：时间倒序/正序的滚动列表，渲染 `agent_event`、`discussion_speak`；`resolution` 用**专门的高亮卡片**样式（告警橙描边 + 「赛博坦决议」字样），与普通发言明显区分（需求 3.4）。
- `ask-box.js`：输入框 + 广播按钮；前端做**最轻量**前置提示（空/超长的即时禁用），真正的校验与过滤以后端为准；两类反馈按帧名区分处理（MEDIUM-1）——收到 **`ask_queued`** 视为**成功**：提示「已排队」并可展示 `position` 排队位次，告知游客稍后会有决议；收到 **`ask_rejected`** 视为**失败**：把 `message` 提示给游客（`CHARTER/EMPTY/TOO_LONG/NO_AWAKE_AGENT/QUEUE_FULL` 文案各异），明确本次不会产出决议。两类均不改任何共享状态。
- `ws-client.js`：连接 `ws://<host>:<port>`，自动发 `hello`，断线指数退避重连，重连后以收到的 `world_state` 全量对齐（参考作品同款）。
- 视觉严格遵守 `.kiro/steering/视觉风格.md`。

---

## §11 边界情况（Edge Cases）

- **全员睡觉时提问**：`ask_rejected{NO_AWAKE_AGENT}`，不产决议（需求 3.6）。
- **讨论进行中、尚未发言就睡着**：§5.2 第 1 步跳过该 agent（出队不发言），不报错；决议仍由已发言者结算。
- **发言后睡着且被采纳（MEDIUM-1）**：一个发言者在 §5.2 第 4 步 `applyCost(speak)` 后 `energy=0 → asleep`，若其落在 §5.4 前 `ADOPTED_COUNT=2` 位被采纳，`reward` 补能到 >0 的同一步把它唤醒为 `active`（方案 A），并广播含最新 `status` 的 `agent_update`。最终 `energy>0 && status==='active'`，不违反 §9 不变量；前端据该帧把家重新点亮。
- **讨论中途新提问**：排队成功回 `ask_queued{position}`（§5.3）；超队列上限则 `ask_rejected{QUEUE_FULL}` 拒绝、不入队（MEDIUM-1）。
- **决议可发言者不足 2 人**：`ADOPTED_COUNT` 取 `min(2, spoken.length)`，至少奖励已发言者，不越界。
- **真模型返回空串/超长**：空串视为失败 → 剧本兜底；超长按**固定次序**处理（NIT-2）：先宪章过滤（命中整条替换为 `SAFE_PLACEHOLDER`），后对未命中文本按 `MAX_TEXT=280` 截断。先过滤后截断，避免截断把红线词切断漏过。
- **讨论跨天边界（NIT-3）**：`TICKS_PER_DAY=24≈72s`，最坏讨论约 7.5s，跨界概率低但非零。锁定语义：讨论进行中 `tick()` 照常做天边界检查、`recoverDay` 照常恢复能量/唤醒睡着者，**但不改动本场 `speakersQueue`**（队列在 §5.1 开场即定格）；被 `recoverDay` 恢复/唤醒的 agent 从**下一场**讨论或自主行为起才体现新状态，本场讨论的发言名单与推进不受影响。`world.ticking` 自旋锁保证无数据竞态，本条锁定其业务语义，使本场讨论可预测、可测。
- **游客发未知/越权帧**：`default` 分支 `BAD_PAYLOAD` 静默丢弃，连接不断。
- **断线重连**：客户端重发 `hello`，后端回新的 `visitorId` + 全量 `world_state`（游客无持久身份，天然幂等）。
- **多游客并发提问**：由 `phase` 软锁 + `askQueue` 串行化，事件绝不交叉（需求 3.7）。
- **心跳与消息同刻 / tick 内 await 生成**：同步段无竞态；生成段（真模型轨 `await llm()` 可长达 8s）用 `world.ticking` 自旋锁串行化——`setInterval` 回调首行 `if (world.ticking) return;` 跳过重入，`tick()` 在 `finally` 复位（§3.2）。ws 消息回调只入队/轻量校验、不直接推进讨论或能量状态，故与被自旋锁保护的 `tick()` 不冲突。结论：**同步段无竞态 + 生成 await 段自旋锁串行化**，而非笼统的「单线程即无竞态」。

---

## §12 可测性（对应 NFR-5 / 需求 9.5）

**单元测试（纯函数，`node --test`）**：
- `world.test.js`：`applyCost`（扣到 0 睡觉、未到 0 不睡、不为负）、`reward`（晶体+1、能量不溢出 `energyMax`、**对 `status==='asleep'` 且补能后 `energy>0` 的 agent 返回 `status:'active'` 且 `wokeNow:true`，对 active agent `status` 不变 `wokeNow:false`** —— MEDIUM-1 的纯函数断言）、`recoverDay`（满能量 + 唤醒）、`ADOPTED_COUNT` 采纳边界（spoken<2）。
- `charter.test.js`：`charterCheck` 对每个红线类的命中样本返回 `ok:false` 且类别正确，对正常问候返回 `ok:true`；大小写/子串边界。
- `behavior.test.js`：`mode==='script'` 时三个生成函数稳定产出非空字符串；注入一个必定抛错的 `llm` 时，`mode==='llm'` 仍回退到剧本产出（降级可测，需求 5.3）；`{other}` 不等于自己。
- 协议：`frame()`/`makeSnapshot()` 不含 ws 句柄与 key，字段齐全。

**集成测试（`town-server.integration.test.js`，用 `ws` 客户端）**：
- 起服务（随机端口），一个客户端 `hello → hello_ok → world_state`；断言 5 个 agent、各字段齐全。
- 发 `visitor_ask` 合法问题 → 收到 `discussion_start`、若干 `discussion_speak`、恰好一条 `resolution`，被采纳 agent 收到 `agent_update`（晶体+）。
- **发言后睡着被采纳的组合用例（MEDIUM-1）**：构造一个采纳时 `energy` 低到发言后即 `asleep` 的被采纳 agent（可把 `ENERGY_MAX` 或初始能量调到临界，或直接在 `reward` 单测层覆盖），断言结算后该 agent 最终 `status==='active' && energy>0`，且其 `agent_update` 携带 `status:'active'`。
- **超长且含红线词的发言（NIT-2）**：构造一条「超过 `MAX_TEXT` 且含红线词」的 agent 产出，断言推送出去的是 `SAFE_PLACEHOLDER` 整条替换结果（先过滤后截断，红线不因截断漏过）。
- 发命中宪章的问题 → 收到 `ask_rejected{CHARTER}`，世界状态不变。
- **排队成功 vs 队满的帧区分（MEDIUM-1）**：讨论进行中（星城里尚有 active agent）再发一个合法问题 → 收到 **`ask_queued{position}`**（成功帧、非 `ask_rejected`）；把 `askQueue` 灌到 `MAX_ASK_QUEUE` 后再发一个 → 收到 **`ask_rejected{reason:'QUEUE_FULL'}`**（不入队）。断言两者帧名/reason 不同。
- **端到端可演示性：纯自主耗尽→睡觉→天恢复（HIGH-1）**：用 `CYBERTRON_TICK_MS` 调小加速、默认常量（`ENERGY_MAX=48/COST.autonomy=6/BEHAVIOR_COOLDOWN_TICKS=1/AUTONOMY_CHANCE=0.9/TICKS_PER_DAY=24`）、**不发任何 `visitor_ask`**，驱动心跳若干 tick 后断言：至少一个 agent `status==='asleep' && energy<=0`（纯自主行为耗尽），再跨过一个天边界后断言该 agent 被 `recoverDay` 恢复 `energy===energyMax && status==='active'`，并收到对应 `agent_update`。此用例守护验收标准 6 在默认不交互演示下可观测。
- **`recentEvents` 写入/淘汰（MEDIUM-2）**：驱动多于 `RECENT_EVENTS_MAX(=30)` 条 `agent_event`/`discussion_speak` 后，新连一个客户端，断言其 `world_state.recentEvents` **条数 ≤ 30**、按时间为最近事件、`agent_update` 不出现在其中（只含 act/talk/visit/speak/resolution 的 kind）。
- 发越权/未知帧 → 无状态变化、连接不断。

**可测性难点与对策**：心跳与讨论步进分别基于 `setInterval` / `setTimeout`，测试中不等真实秒级间隔——把 `async tick(world, deps)` 与讨论 `step(world, deps)` 设计成可被测试直接 `await` 调用的半纯函数，集成测试里直接驱动它们，或用环境变量把 `CYBERTRON_TICK_MS` 与 `CYBERTRON_DISCUSS_STEP_MS` 调小（如各 `20`）加速。`world.ticking` 自旋锁可单测：构造一场耗时生成（注入会 `await` 一个未决 Promise 的假 `llm`），断言期间第二次进入被跳过。真模型轨通过注入假 `llm` 调用器测试，不触网。

---

## §13 目录结构（新增）

```
2-cybertron/
├── app/
│   ├── index.html
│   ├── css/theme.css
│   └── js/{ws-client,store,town-map,event-feed,ask-box,main}.js
├── server/
│   ├── package.json            # type:module, deps.ws 8.18.0, start/test 脚本, node>=18
│   ├── town-server.js          # 入口：ws + 心跳 + 路由 + 广播
│   ├── world.js                # agent 配置 + 状态机 + token 经济（纯函数）
│   ├── charter.js              # 宪章过滤（纯函数）
│   ├── behavior.js             # 剧本语料 + 真模型适配 + 降级
│   └── *.test.js               # 单测 + 集成测试
├── .env.example                # 仅 CYBERTRON_LLM_API_KEY= / BASE_URL= / MODEL= 的 key 名，无值
├── .gitignore                  # .env / node_modules / .DS_Store
└── README.md                   # 本地一条命令跑通 + 200 字说明 + Kiro 能力清单
```

---

## §14 环境变量与常量总表（锁定）

| 名称 | 默认 | 用途 |
| --- | --- | --- |
| `PORT` | 9527 | ws 监听端口（默认 9527，与其它项目端口错开） |
| `CYBERTRON_LLM_API_KEY` | （无） | **存在即切真模型，不存在即走剧本** |
| `CYBERTRON_LLM_BASE_URL` | `https://api.openai.com/v1` | 真模型接口基址 |
| `CYBERTRON_LLM_MODEL` | `gpt-4o-mini` | 真模型名 |
| `CYBERTRON_TICK_MS` | 3000 | 心跳间隔（测试可调小） |
| `CYBERTRON_DISCUSS_STEP_MS` | 1500 | 讨论出字步进间隔（与心跳解耦，测试可调小） |
| `TICKS_PER_DAY`（常量） | 24 | 一「天」的 tick 数（HIGH-1：≈72s 闭环周期） |
| `DISCUSS_STEP_MS`（常量） | 1500 | 讨论步进默认间隔（§3.2/§5.2；`CYBERTRON_DISCUSS_STEP_MS` 覆盖） |
| `ENERGY_MAX`（常量） | 48 | 能量上限（HIGH-1：使纯自主行为一天内可耗尽） |
| `COST`（常量） | {autonomy:6, speak:10} | 行为成本 |
| `CRYSTAL_REWARD / CRYSTAL_TO_ENERGY`（常量） | 1 / 20 | 晶体奖励与折能 |
| `ADOPTED_COUNT`（常量） | 2 | 每场决议采纳人数 |
| `AUTONOMY_CHANCE`（常量） | 0.9 | 每 tick 每个合格 agent 自发行为概率（§3.2；HIGH-1 提高） |
| `BEHAVIOR_COOLDOWN_TICKS`（常量） | 1 | 自发行为后冷却 tick 数（§3.2；HIGH-1 降到 1） |
| `MAX_SPEAKERS`（常量） | 5 | 一场讨论最多发言人数（§5.1） |
| `MAX_ASK_QUEUE`（常量） | 5 | 讨论进行中提问排队上限（§5.3） |
| `MAX_TEXT`（常量） | 280 | 单条产出文本推送前截断长度（§11） |
| `VISIT_REPLY_CHANCE`（常量） | 0.6 | 被点名 agent 回应串门的概率（§6.1） |
| `RECENT_EVENTS_MAX`（常量） | 30 | `world_state.recentEvents` 环形缓冲上限（§4.4） |
| `SAFE_PLACEHOLDER`（常量） | `……（这句话被赛博坦宪章轻轻拦下了）` | agent 产出命中宪章时的安全占位（§8.3） |
| LLM 调用超时（常量） | 8000ms | `makeLlmCaller` 的 `AbortController` 超时（§7.3） |

> 以上为「锁定常量」一处可查的总表；§3/§5/§6/§7 正文出现的同名常量以本表为准，实现者不得再行改值。

技术栈自此锁定，实现者据此 `tasks.md` 逐项落地，不再做需求级决策。

---

## §15 对设计评审 findings 的应对（本轮修订）

针对 `design-review.md`（verdict=CHANGES_REQUESTED，MEDIUM×3 + NIT×5）逐条应对：

| Finding | 处理 | 落点 |
| --- | --- | --- |
| MEDIUM-1 异步生成嵌入同步 tick 的竞态/重入 | 已修复（采纳评审方案 A） | `async tick()` + `world.ticking` 自旋锁；`World` 增 `ticking` 字段（§2.3）；§3.2 补回调骨架与「每 tick 最多一个未决生成」规则；§11 结论改写为「同步段无竞态 + 生成段自旋锁串行化」 |
| MEDIUM-2 决议时延与 NFR-2 冲突 | 已修复（讨论与心跳解耦，加 `DISCUSS_STEP_MS=1500`，末步并入结算，核算 ~7.5s ≤ 10s） | §3.2 第3步、§5.2、§14 常量；requirements NFR-2 同步对齐并注明机制 |
| MEDIUM-3 §4.2「仅两种」与三帧矛盾 | 已修复 | §4.2 标题改为「仅三种白名单」，与 §8.4 / 宪章 steering 一致 |
| NIT-1 recentEvents 条数未锁定 | 已修复 | 锁定 `RECENT_EVENTS_MAX=30`，写入 §4.4 / §2.3 / §14 |
| NIT-2 部分常量未进 §14 | 已修复 | §14 补 `AUTONOMY_CHANCE/BEHAVIOR_COOLDOWN_TICKS/MAX_SPEAKERS/MAX_ASK_QUEUE/MAX_TEXT/VISIT_REPLY_CHANCE/RECENT_EVENTS_MAX/SAFE_PLACEHOLDER/LLM 超时/DISCUSS_STEP_MS` 并注明「正文以总表为准」 |
| NIT-3 剧本语料仅一个人格示例 | 已修复 | §6.3 补齐五人格口吻样例 + 锁定每类数量下限（act/talk/visit 各 ≥2、speech ≥1）；tasks 任务 5 同步 |
| NIT-4 `createWorld()` 签名未展开 | 已修复 | §2.3 补 `createWorld(config=AGENT_CONFIG)→World`（纯构造、无 I/O）；tasks 任务 3 同步 |
| NIT-5 Hook 触发含前端却只跑后端测试 | 已修复（评审标注可选） | hook `prompt` 点明「前端无独立测试，保存前端文件同样跑后端冒烟作回归兜底」 |

所有应对均与原始需求（`general_spec.md` / `00-思路与决策.md` / 原始用户请求「先本地部署」）一致，未引入新 scope、未改既锁的技术栈。

---

## §16 对第二轮设计评审 findings 的应对（本轮修订）

针对第二轮 `design-review.md`（verdict=CHANGES_REQUESTED，MEDIUM×2 + NIT×3）逐条应对：

| Finding | 处理 | 落点 |
| --- | --- | --- |
| MEDIUM-1 决议奖励补能打破「energy≤0 ⇔ 睡觉」不变量、睡着发言者能否被采纳未定义 | 已修复（采纳评审方案 A） | `reward` 补能后 `energy>0` 即把 `status` 改回 `active`、返回增 `status/wokeNow`（§9）；§3.1 补 `asleep→active（被采纳奖励补能）` 转移；§9 不变量豁免加「或 reward 补能唤醒的同一步」；§5.4 第 3 步写明睡着者仍可被采纳并由 `reward` 唤醒并广播 `agent_update`；§11 补「发言后睡着被采纳」边界；§12 补 `reward` 唤醒单测 + 集成组合用例 |
| MEDIUM-2 `agent_update` 缺 name/persona/home、增量合并规则未写死 | 已修复（写死部分字段 patch 合并规则） | §4.3 `agent_update` 行标注「部分字段 patch」并补合并语义说明块；§10 `store.js` 写死权威契约：按 `agentId` 仅覆盖 `status/energy/energyMax/crystals`、保留 `name/persona/home`，未知 `agentId` 忽略该帧不新建 |
| NIT-1 `TICK_MS`/`DISCUSS_STEP_MS` 常量与 env 覆盖优先级无解析式 | 已修复 | §3.2 常量块补 `*_EFFECTIVE = Number(process.env.*)||常量` 解析式，定时器用 `*_EFFECTIVE`，`export const` 仅作默认值/测试引用；setInterval 骨架改用 `TICK_MS_EFFECTIVE` |
| NIT-2 `MAX_TEXT` 截断与宪章过滤先后次序未定义 | 已修复 | §5.2 第 3 步固定「先宪章过滤（命中整条替换 `SAFE_PLACEHOLDER`）后截断」；§11 同步；§12 补「超长且含红线词」断言 |
| NIT-3 讨论跨天边界 recoverDay 改写发言者状态业务语义未说明 | 已修复 | §3.2 第 2 步标注跨天语义见 §11；§11 补锁定行为：跨天 `recoverDay` 照常恢复/唤醒但不改本场 `speakersQueue`，被恢复 agent 从下一场起体现新状态 |

两条已验证的 `unverifiedAssumptions`（`node:test`+`ws` 集成测试在目标环境可运行、真模型接口为 OpenAI Chat Completions 风格）评审已判定不阻塞（失败即降级剧本、demo 走剧本），保留为实现期验证项，不改设计。本轮应对均为文档层面的规则澄清，未推翻任何已锁技术栈、未新增 scope。

---

## §17 对第三轮设计评审 findings 的应对（本轮修订）

针对第三轮 `design-review.md`（verdict=CHANGES_REQUESTED，HIGH×1 + MEDIUM×2 + NIT×3）逐条应对：

| Finding | 处理 | 落点 |
| --- | --- | --- |
| HIGH-1 锁定常量使「耗尽→睡觉→天恢复」闭环在默认不交互演示里不可达，与验收标准 6 / 需求 4.4 冲突 | 已修复（采纳评审方案 A：调常量使纯自主行为一天内可自然耗尽） | §9 `ENERGY_MAX` 100→48 并补「可演示性核算」说明块；§3.2 调度常量 `TICKS_PER_DAY` 20→24、`AUTONOMY_CHANCE` 0.55→0.9、`BEHAVIOR_COOLDOWN_TICKS` 2→1 并补联动核算；§14 四常量同步改值；§11 跨天注释改 24≈72s；§12 新增「纯自主耗尽→睡觉→天恢复」端到端可演示性断言；requirements 4.5 / 验收标准 6 / 假设 同步写明「纯自主可达、默认约 72s 可见」 |
| MEDIUM-1 `ask_rejected{BUSY}` 同码承载「已排队(成功)」与「队满(失败)」二义，前端无法程序化区分 | 已修复（采纳评审方案 A：拆帧） | §4.3 新增成功帧 `ask_queued{position,message}`、`ask_rejected.reason` 枚举改为 `{EMPTY,TOO_LONG,CHARTER,NO_AWAKE_AGENT,QUEUE_FULL}`（排队成功移出）；§5.1 第4步改回 `ask_queued`、§5.3 队满改 `ask_rejected{QUEUE_FULL}`；§4.5 时序图三分；§10/§11 `ask-box` 按帧名区分成功/失败；tasks 6/8/10 同步；§12 补排队成功 vs 队满帧区分断言 |
| MEDIUM-2 `recentEvents` 环形缓冲「何时写入/如何淘汰」全程未定义 | 已修复（写死统一 `pushRecent` 规则） | §4.4 补权威规则块：广播 `agent_event`/`discussion_speak`/`resolution` 同步 `pushRecent`、FIFO `shift()` 淘汰、`agent_update` 不入列、`world_state` 取浅拷贝；§2.3 字段注释、§3.2 第4步、§5.2、§5.4、§6.1 各广播点标注 `pushRecent`；§12/tasks 8 补条数 ≤30 断言 |
| NIT-1 讨论中新提问排队早于 NO_AWAKE 检查，全员睡着时会排进必然无果的队列 | 已修复（入队前轻量预判） | §5.1 第4步：讨论中若无任何 active agent 则直接 `ask_rejected{NO_AWAKE_AGENT}` 不入队；tasks 6 同步 |
| NIT-2 `CHARTER_BLOCKLIST` adult/violence/politics 注释占位、缺可断言锚点 | 已修复（要求每类 ≥1 锚点词，不列全词表） | §8.1 补「六类命中锚点」说明：每类至少 1 个可断言示例词、politics 用中性制度词；tasks 4 同步 |
| NIT-3 快照 `mode` 更新时机未点明 | 已修复 | §4.4 `mode` 注释与 §7.2 补「启动定轨后固定、无独立增量帧、仅随 world_state 全量下发」 |

本轮应对全部与原始需求（`general_spec.md`「额度用完只能休息」/「谁 token 烧光了就回家睡觉」、`00-思路与决策.md`、原始用户请求「先本地部署看效果」）一致：HIGH-1 的常量调整正是为了让招牌「熄灯作息」在默认本地演示里可见，未改任何已锁技术栈、未新增/删减 scope。

---
---

# 二期升级设计（Spec 增补 · 六块惊艳升级）

> 本节为 Kiro Spec 第二轮设计增补，追加在原「五件套」设计（§0–§17）之上，**不删除任何既有章节**，保持 Spec 驱动痕迹。
> 唯一来源：本目录 `requirements.md` 二期增补（需求 10–15 + 二期验收标准 12–18）、`general_spec.md` 场景 7（破坏者隔离）/ 产品简介、用户逐条确认的六块升级。
> 继承一期全部锁定约束，本节不重述但一律适用：前端纯静态零构建原生 ESM；后端单文件 Node + `ws`，Node ≥ 18；端口 9527（后端）/ 9528（前端）；`node --test`；视觉赛博霓虹、纯 Canvas/DOM/CSS 手绘、**零外部图片/字体/库依赖**；上行帧白名单**仍仅** `hello` / `visitor_ask` / `ping`（宪章 5，硬规则，绝不破）；LLM 双轨（`CYBERTRON_LLM_API_KEY` 只从环境变量读）；**所有新增能力在剧本轨（无 key 默认）下开箱即玩、离线稳定、可录屏**。
> 本节正文出现的新增常量在 §25 常量总表（续前 §14）集中登记，实现者以总表为准。

---

## §18 二期架构增量总览

二期六块升级全部落在既有架构之上，不引入新传输层、不新增上行写帧、不改技术栈。核心原则沿用一期：**后端是唯一事实源**，任何「共享事实」（谁在某个家、公民状态 `active|asleep|isolated`、工程进度、互动剧情的发起与回应）只由后端在被 `world.ticking` 自旋锁保护的 `tick()` / `step()` 内计算并广播；前端是只读镜像，可以自行驱动**纯表现层动画**（像素小人走动、动作循环、气泡节奏、进度条补间、建成动画），但绝不反向写后端、绝不自造上述共享事实。

六块升级与既有模块的映射（职责归属一眼可查）：

| 升级 | 需求 | 后端改动面 | 前端改动面 | 新下行帧 | 新纯函数（node --test） |
| --- | --- | --- | --- | --- | --- |
| ① 家内景视图 | 10 | `world.js`（快照已含 agent 全字段，无需新增字段）；`town-server.js`（快照 `status` 已含 isolated 后天然可用） | 新增 `app/js/home-interior.js`（内景渲染）、`app/js/pixel-figure.js`（像素小人动画）；`town-map.js` 加点击进入；`main.js` 视图切换 | **无新增下行帧**（复用 `world_state`/`agent_update`，§19.1 论证） | 无（纯表现层动画无需后端纯函数） |
| ② 虫洞工程 | 11 | `world.js` 新增 `project` 子模型 + `advanceProject()` 纯函数；`town-server.js` 自主行为/决议结算调用并广播 `project_update` | 新增 `app/js/wormhole.js`（进度条 + 建成动画）；`town-map.js` 容纳装置；`store.js` 存 project；`main.js` 分发 | **`project_update`** | `advanceProject(project, delta)` |
| ③ 隔离机制 | 13 | `world.js` 状态机新增 `isolated` + `enterIsolation()`/`tickIsolation()` 纯函数；`town-server.js` 触发点与到期解除 | `town-map.js` 警戒色渲染；`home-interior.js` 隔离表现；`store.js` 承 `status==='isolated'` | 复用 `agent_update`（`status:'isolated'`）；`agent_event` 承隔离叙事 | `enterIsolation(agent, tick)`、`tickIsolation(agent, tick)` |
| ④ 互动剧情 | 12 | `behavior.js` 新增配对语料 + `matchInteraction()` 纯函数；`town-server.js` 发起→回应编排 | `event-feed.js` 已能顺序渲染 `agent_event`，仅样式增强 | 复用 `agent_event`（加 `interaction` 元信息，§22.3）；**不新增上行帧** | `matchInteraction(initiatorEvent, candidates, corpus)` |
| ⑤ 宪章/宇宙弹窗 | 14 / 15 | 无（文案来源见 §23.2 决策） | 新增 `app/js/modals.js`（两图标 + 两弹窗）；`index.html` 挂载点；`theme.css` 样式 | 无 | 无 |
| ⑥ 协议扩展总表 | 跨 11/13/12 | 见 §24 | — | 汇总见 §24 | — |

**为什么尽量不新增下行帧**：每多一种帧就多一处前后端契约与测试面。二期只在确有「全局非 agent 维度的新共享状态」时才加帧——这正是工程进度（`project`），故**只新增 `project_update` 一种下行帧**；隔离复用 `agent_update`（它本就是 agent 状态 patch，`status` 扩一个枚举值即可），互动剧情复用 `agent_event`（它本就是叙事事件，加可选元信息即可）。家内景、两弹窗是纯前端视图/静态内容，不新增任何帧。这把二期对协议的扰动压到最小，契合「人类只能围观」的结构性护栏不被稀释。

---

## §19 升级①：点击房子进入「家」内景视图（需求 10）

### §19.1 家内景数据来源（本次点名敲定）

**结论先行：家内景不新增任何下行帧，完全复用既有世界快照帧（`world_state` 全量 + `agent_update` 增量）；进入家内景是纯前端视图切换，不触发任何上行推送。**

论证与数据流：

1. **进入内景拿到哪些后端数据**：前端进入某家内景时，所需的「共享事实」全部**已在本地 `store` 中**——`store.snapshot.agents[]` 每个元素已含 `{ id, name, persona, status, energy, energyMax, crystals, home:{x,y} }`（见 §4.4 / `makeSnapshot`）。内景要展示的「谁在这个家、每个小人的 id / name / 颜色 / 头像标识 / 状态」全部可由这份快照派生，无需任何新下行帧：
   - `id` / `name`：直接取自快照。
   - `status`：直接取自快照（二期扩为 `active | asleep | isolated`，见 §21）。
   - **颜色 / 头像标识**：**前端从 `agent.id` 确定性派生**（见 §19.2），不走后端——因为颜色/头像是纯表现层约定，不是共享事实，让后端下发只会徒增帧字段。派生函数对同一 `id` 恒定，保证全景与内景、多游客之间一致。
2. **沿用快照，不新增下行帧**：家内景展示的一切共享事实都是 `world_state`/`agent_update` 已承载的 agent 维度数据。新增「家内景专用下行帧」会重复既有数据且多一处契约，故**明确否决**。前端 `store` 已订阅 `agent_update`（§10），内景视图只需在 `store` 变化时重渲染即可实时反映睡觉/隔离。
3. **「谁在这个家」的建模**：MVP 阶段**一户一公民**——每个 `agent` 有自己的 `home`，一个家内景对应该 agent 本人。为满足需求 10.3「同一家内景里渲染多个小人」，内景把**该家屋主 + 当前正在串门拜访该屋主的访客**一并渲染为多个像素小人。「谁在串门」这一共享事实的来源见 §19.3。

### §19.2 像素小人的表现层派生（前端，纯表现层）

颜色与头像标识由 `app/js/pixel-figure.js` 从 `agent.id` 确定性派生，不依赖后端下发：

```js
// pixel-figure.js（表现层约定，非共享事实）
const PALETTE = ['#A24BFF', '#38F2E6', '#FF8A3D', '#7CF25A', '#4BA8FF']; // 皆为霓虹系，与 theme.css 五色同family
const FACES   = ['◕', '◉', '⊙', '◔', '✦'];  // 内联字符作头像标识，零外部图片
export function figureStyle(id) {
  const h = hashId(id);                 // 简单稳定哈希
  return { color: PALETTE[h % PALETTE.length], face: FACES[(h >> 3) % FACES.length] };
}
```

锁定：颜色取自霓虹同系（遵守 `视觉风格.md` 的 family，但这 5 个表现色是**内景专用的小人配色**，与 §1 的五个锁定主题变量并存、不冲突；在 §26 steering 增补中登记）；头像用**内联字符/emoji**，零外部图片/字体。同一 `id` 恒定派生，保证一致性（需求 10.3 的「异色异脸、头顶名字」）。名字直接取 `agent.name` 画在小人头顶。

### §19.3 走动与生活动作如何由前端动画驱动，状态仍来自后端快照（本次点名敲定）

把内景元素严格二分：

- **纯表现层（前端自驱动，不碰后端）**：小人在房间内的**走动路径**、当前正在做的**生活动作**（敲电脑 / 浇花 / 喝水 / 看书 / 发呆）循环切换、**自言自语气泡**的出现节奏与内容选取。这些由 `home-interior.js` 的 `requestAnimationFrame` 循环 + 本地计时器驱动，用一个本地有限状态机在动作集合间按人格倾向随机轮换。气泡文案在剧本轨下取自**内置于前端**的人格语料（见 §19.4 决策），不经后端，因为它们不是共享事实、也不需跨游客一致（每个游客看到自家内景的小动作各自流动，观感更活）。
- **共享事实（后端快照单一事实源）**：小人**是否存在该家**（谁在串门）、**名字**、**当前 `status`（active/asleep/isolated）**。这些只认 `store` 里的后端快照：
  - `status==='asleep'`：内景把该小人画成**熄灯休眠态**（趴睡 + 暗紫 `--dim-sleep` 辉光骤减），停止走动与动作循环（需求 10.8）。
  - `status==='isolated'`：内景把该小人画成**警戒静止态**（告警橙 `--alert-orange` 描边 + 禁言，不冒气泡、不走动），与全景家节点语义一致（需求 10.8 / §21）。
  - `status==='active'`：正常走动 + 动作循环 + 气泡。

**「谁在串门」的共享事实来源（NIT-2 锁定 `toAgentId` 取值）**：复用既有串门机制（§6.1），但要先修掉现有代码里的一处**脱节**：现状 `behavior.js` 的 `pickOtherName(agent, world)` 随机选一个名字填进 `text` 的 `{other}`，而 `town-server.js` 的 `_pendingReplies` 另起一段遍历取**第一个 active 的 other**（`break`）当回应者——**文案点名者与实际回应者可能不是同一个 agent**。内景要「把访客渲染进被拜访者的家」，画面与文字必须对得上，故锁定三者一致：

- **`generateEvent` 产出 visit 时同时返回被点名者的 id**：把 `pickOtherName` 改为返回 `{ name, id }`（或并行提供被选中 other 的 id）；`generateEvent` 对 `kind==='visit'` 的返回体加上 `toAgentId`（= 被点名 other 的 id）。文案里的 `{other}` 名字与这个 `toAgentId` 来自**同一次选择**，保证「文案点名者 = `toAgentId`」。
- **`doAutonomy` 把该 `toAgentId` 既写进下行帧也用于配对**：广播 `agent_event{kind:'visit', …, toAgentId}`（不新增帧，仅给既有 `agent_event` 的 data 补可选字段），同时把 `toAgentId` 作为 §22.4 `_pendingInteraction` / `matchInteraction` 的 `candidates` **首选回应者**（§22.1 已约定「优先 toAgentId」）。
- **结论（锁定）**：**文案点名者 = `agent_event.data.toAgentId` = 互动回应候选的优先者**，三者是同一个 agent。前端 `store` 收到 `agent_event{kind:'visit', toAgentId}` 时登记一条**短时效的访问关系**（本地表现层状态，过期基准用**前端墙钟毫秒**，不依赖 tick 下行帧）：**锁定 `const VISIT_RELATION_TTL_MS = 6000;`（§25 登记），登记时记 `expireAt = Date.now() + VISIT_RELATION_TTL_MS`**，内景 `requestAnimationFrame` 循环里每帧比对 `Date.now() >= expireAt` 到点移除该访客小人。内景据此把访客小人渲染进被拜访者的家，画面与文案一致。
   - **为何用墙钟而非 tick**：一期 §3.2 第 5 步把 `tick` 下行帧定为可选/可省略、现有 `main.js` 未注册 `ws.on('tick')`，前端拿不到可靠 tick 节拍，无法以「tick」为过期单位；改用前端自有的墙钟常量彻底消除「1 个 tick 周期」的二义，无需把 `tick` 帧从可选提升为稳定下发（避免新增下行噪声）。`6000ms` 取值约为心跳间隔（默认 `TICK_MS=3000`）的 2 倍，访客小人停留两拍左右后自然淡出，既不秒消失也不长期滞留。
- 该字段只是让前端能定位渲染对象，**不改变**「串门是后端事实」这一点，也不引入上行写能力。

### §19.4 气泡/动作语料来源（择一说明）

**决策：内景的走动动作集合与自言自语气泡语料，剧本轨下内置于前端 `home-interior.js`，并锁定其唯一宿主为 `home-interior.js` 内一个名为 `INTERIOR_SCRIPT` 的常量（按 persona 分组、每人格动作旁白 ≥ 4 条），不经后端下发、不另设独立 `interior-corpus.js` 模块。** 理由：① 它们是纯表现层、不需跨游客一致、不是共享事实；② 内置前端可零往返、离线稳定、动画流畅（需求 10.5 的「足量不单调、离线可跑」）；③ 与后端 `behavior.js` 的剧本语料解耦，后端语料服务于「全景事件流」的共享叙事，前端内景语料服务于「近景生活流」的表现，各司其职，避免把前端表现塞进后端快照。人格口吻与后端 `SCRIPT`（§6.3）保持同一调性（忧郁诗人清冷、工程师务实、八卦邻居热络、商人算计、梦想家明亮），但各写一组内景短句。

> **语料宿主唯一化（NIT-2 锁定）**：`INTERIOR_SCRIPT` 的形状为 `{ [persona]: { lines: string[≥4], actions: Array<{kind, blurb}> } }`，即每人格的「自言自语气泡语料」与「动作旁白」同住 `home-interior.js` 的 `INTERIOR_SCRIPT`；**动作集枚举**（walk/type/water/drink/read/idle）亦在 `home-interior.js` 定义。实现者不得把语料分散到 `pixel-figure.js` 或新建独立模块，避免各自放置导致发散（§25 已据此登记宿主为 `home-interior.js`）。

> 注：真模型轨（有 key）**不改内景**——内景生活小动作始终走前端内置语料（纯观赏表现层，不值得为每帧小动作调 LLM）；真模型只影响全景事件流/讨论/决议的共享叙事（§6/§7 既有范围）。这一边界写入 §26 steering 增补。

### §19.5 「纯观赏」硬约束（宪章 5）

**明确锁定：进入家内景只是前端视图切换 + 对既有下行推送的再渲染，绝不新增任何让游客写 agent / 世界状态的上行帧。** 内景里游客**不能**点击 / 拖拽 / 指令任何小人；小人不可交互（`pointer-events` 仅用于「返回全景」按钮）。上行帧白名单仍严格是 `hello` / `visitor_ask` / `ping`（§24 重申）。这把需求 10.6 做成结构性保证：内景不存在任何可触发上行写状态的 UI 路径。

### §19.6 视图切换与前端文件改动面

- 新增 `app/js/home-interior.js`：内景房间渲染器。输入 `(rootEl, store, agentId)`；用一个铺满舞台的 DOM/Canvas 层画房间（家具用 CSS/emoji 手绘：电脑 💻、花 🌷、水杯 🥤、书 📖），把「屋主 + 当前访客」渲染为多个 `PixelFigure`。内部 `requestAnimationFrame` 驱动走动与动作循环；订阅 `store` 变化以反映 `status`。提供 `open(agentId)` / `close()`。
- 新增 `app/js/pixel-figure.js`：单个像素小人。持有 `{id,name,color,face}`，一个本地动作状态机（walk / type / water / drink / read / idle）+ 头顶名字标签 + 气泡。纯表现层。
- 改 `app/js/town-map.js`：家节点加 `click` 监听 → 调用注入的 `onEnterHome(agentId)` 回调（点击即进入内景，需求 10.1）。
- 改 `app/js/main.js`：装配视图切换——持有 `view: 'town' | 'home'` 本地状态；进入内景隐藏全景、显示内景并记录来源以便 `返回全景` 恢复（需求 10.2）；内景常驻「返回全景」按钮（赛博霓虹风）。
- 改 `app/index.html`：加内景容器 `<section id="home-interior" hidden>` 与返回按钮挂载点。
- 改 `app/css/theme.css`：内景房间、像素小人、返回按钮、睡眠/隔离表现样式（遵守五色变量 + §26 新增内景规范）。
- **后端无需改动**（`makeSnapshot` 已含所需字段；仅 §19.3 的 `agent_event` 加可选 `toAgentId` 字段，属 §22/§24 一并落地）。

### §19.7 边界与错误处理（升级①）

| 场景 | 行为 | 是否可恢复 | 日志 |
| --- | --- | --- | --- |
| 点击家时 `store` 尚无该 agent（极早期、`world_state` 未到） | 忽略点击（内景 `open` 前校验 `store.getAgent(id)` 非空），不切视图 | 可恢复（快照到后再点） | 前端 `console.debug` |
| 内景打开期间该 agent 转 `asleep`/`isolated` | 订阅 `store` 变化即时切换小人表现，不关闭内景 | — | 无 |
| 内景打开期间断线重连 | 重连后 `world_state` 全量覆盖 `store`，内景据新快照重渲染；不自动退出内景 | 可恢复 | 复用 ws-client 既有重连 |
| 访客关系过期（墙钟到点：rAF 循环内 `Date.now() >= expireAt`，`VISIT_RELATION_TTL_MS=6000`，§19.3/§25） | 前端移除该访客小人，仅屋主留存；不依赖任何 `tick` 下行帧 | — | 无 |

**可测性**：家内景几乎全是表现层动画，不产出新后端纯函数，故**不纳入 `node --test`**；其正确性由「集成测试验证 `agent_event{kind:'visit'}` 带 `toAgentId` 字段齐全」间接守护（§24/§25 断言）。`figureStyle(id)` 为前端确定性派生，可选在前端用轻量断言自测（非 `node --test` 范畴），spec 不强制。

---

## §20 升级②：虫洞超时空传送器（大工程，循环建造）（需求 11）

### §20.1 后端全局工程模型（本次点名敲定字段）

工程是**全局非 agent 维度**的新共享状态，作为 `World` 的一个子对象 `world.project`，在 `createWorld()` 里初始化。锁定字段：

```js
// world.js —— World.project（全局协作工程）
{
  progress: number,     // 总进度，整数 0→100
  round: number,        // 当前建造轮次，从 1 起
  status: 'building' | 'completed',  // 建造中 / 刚建成（建成瞬态，下一次推进即回 building 新一轮）
}
// 初始：{ progress: 0, round: 1, status: 'building' }
```

> 选 `status: 'building' | 'completed'` 两态而非一个布尔，是为给前端一个明确的「刚建成」瞬态去触发建成动画，并在后端自动重置后由下一帧回到 `building`。进度用 0–100 整数（而非浮点百分比）便于纯函数断言与前端整数渲染。

### §20.2 工程推进的两条来源与增量（本次点名敲定机制）

工程进度只由后端推进，两条合法来源：

1. **公民出力建造（需求 11.2）**：复用既有自主行为机制。在 `tick()` 的 idle 自主行为段（§3.2 第 4 步 / `doAutonomy`），当被选中的 `active` 公民命中「出力建造」分支时，调用 `advanceProject(world.project, BUILD_DELTA_AUTONOMY)` 推进进度，并产出一条**带工程色彩的 `agent_event`**（`kind:'act'`，文案如「RIPR 焊接了虫洞环的第 N 节」，经宪章过滤后广播 + `pushRecent`），随后广播 `project_update`。
   - 「命中出力建造分支」的判定：锁定为**概率分流**——在 `doAutonomy` 内，若该公民是 `active` 且进度 `status==='building'`，以 `BUILD_CHANCE=0.35` 概率把这一次自主行为**改写为出力建造行为**（取工程专用语料，见 §20.5），否则走原有 act/talk/visit。这样「出力建造」是自主行为的一个子类，不额外消耗一次 tick、复用既有能量成本 `COST.autonomy`（出力也烧能量，契合 token 经济）。
2. **游客讨论完成（需求 11.3）**：在决议结算 `settleResolution()`（§5.4）广播 `resolution` 之后，调用 `advanceProject(world.project, BUILD_DELTA_RESOLUTION)` 追加一个**更大的可见增量**，并广播 `project_update`。使「围观讨论」也能看到对大工程的推动。
   - **两帧次序一律一致（NIT-1 锁定）**：无论建成由「公民出力」还是「讨论完成」触发，只要 `advanceProject` 返回 `completedNow===true`，调用方**一律走同一「先广播 `project_update{status:'completed'}`、后广播 `project_update{progress:0, status:'building'}`」两帧**（即 §20.3 锁定的次序，建成与重置两帧对所有触发来源无差别）。**讨论路径下这两帧在 `resolution` 帧之后广播**（先 `resolution` → 再建成帧 → 再归零帧），保证前端先看到决议、再放建成动画、最后看到新一轮归零。

增量常量（§25 登记）：`BUILD_DELTA_AUTONOMY=4`（单次出力 +4），`BUILD_DELTA_RESOLUTION=8`（一场讨论 +8）。取值保证：纯自主行为下，期望每天（24 tick）出力次数可观，进度持续增长并能在有界时间内触达建成；一场讨论给一个明显跳变，让「围观讨论推动工程」可感。满 100 所需出力次数约 25 次（纯自主），核算见下「建成可演示性核算」。

> **建成可演示性核算（MEDIUM-1 修正，与 §3.2 HIGH-1 睡眠闭环核算同风格）**：二期验收标准 13 要求「**不做任何操作**持续围观……进度达 100% 触发建成动画→自动重置→新一轮」，即纯自主路径必须在有界、可录屏的演示窗口内必现一次建成。按锁定常量核算默认剧本轨（无 key、不提问）：
> - 每个 `active` 公民每 `BEHAVIOR_COOLDOWN_TICKS=1` tick 可自主行动一次，但受 token 经济约束——`ENERGY_MAX=48 / COST.autonomy=6` ⇒ 每个公民一「天」内最多 8 次自主行为即耗尽睡觉（§3.2/§9）；5 个公民一「天」(`TICKS_PER_DAY=24`≈72s) 城内自主行为上限约 `5×8=40` 次。
> - 其中命中出力建造的比例为 `BUILD_CHANCE=0.35` ⇒ 每「天」期望出力次数约 `40×0.35≈14` 次，进度增量 `14×BUILD_DELTA_AUTONOMY(4)≈56`/「天」。
> - 故纯自主路径到 100 约需 `100/56≈1.8` 个「天」≈ **约 130s（~2.2 分钟）** 必现一次建成 → 重置 → 新一轮，落在可接受演示窗口（目标 ≤ 2–3 分钟）内，与一期为「熄灯作息」确立的「点开约 72s 可见」观感基准同量级、不割裂，满足「评委 agent 快速体验也能看到招牌建成动画」的硬约束。
> - **为何把 `BUILD_DELTA_AUTONOMY` 从 2 调到 4**：原 `=2` 下纯自主到 100 约需 3.5–5 个「天」≈ 4–6 分钟，超出演示窗口、评委快速看一眼很可能看不到建成。调为 `=4` 把纯自主建成压进 ~2.2 分钟（本核算），同时保留「进度逐步增长可见」的观感（单「天」约 +56 < 100，不会一「天」内秒建成）。`BUILD_DELTA_RESOLUTION=8` 不变——提问讨论仍给更大跳变、进一步加速建成（每场 +8），使「围观讨论推动工程」在纯自主之外额外可感。
> - 该核算对应 §20.8 新增的集成断言（有界 tick 内必现一次 `project_update{status:'completed'}` + 随后 `progress:0` 重置帧），为招牌建成/重置/新一轮链路提供可测护栏。

**`doAutonomy` 内三条分流的决策树（NIT-3 锁定）**：一次 `doAutonomy` 可能命中三类产出——普通 `act`/`talk`/`visit`、出力建造、互动发起（visit 升级的发起）。三者**互斥，一次自主行为只产出一条事件**，判定次序锁定如下（在已通过 `tick()` 的 `status==='active'` + 能量门槛 + `AUTONOMY_CHANCE` 筛选之后执行）：

```
doAutonomy(world, agent, deps, forceKind):
  ① 若 forceKind 存在（上一拍被登记为互动回应者）：
        → 产出回应（kind='talk' + interaction.replyTo），终止本次分流。
  ② 否则若 world.project.status === 'building' 且 rng() < BUILD_CHANCE：
        → 出力建造：取工程专用语料，kind='act'，advanceProject(+BUILD_DELTA_AUTONOMY)，
          广播 agent_event（工程叙事）+ project_update，终止本次分流。
  ③ 否则走既有 generateEvent 得随机 kind ∈ {act, talk, visit}：
        • kind==='visit' → 带 toAgentId（§19.3/NIT-2），登记 world._pendingInteraction
          （type='visit_reply'，§22.4 互动发起），广播发起 agent_event。
        • kind∈{act,talk} → 普通自主行为，广播 agent_event。
```

即优先级为 **回应（forceKind） > 出力建造（BUILD_CHANCE） > 普通/互动发起（generateEvent 结果）**；出力建造命中即短路，不再掷 `generateEvent`，三条分支在一次 `doAutonomy` 内严格互斥、各只产一条事件、各自走一次 `applyCost(autonomy)`（能量成本一致）。本决策树在 §27 的 `doAutonomy` 改动面同步登记。

### §20.3 建成、自动重置与无限循环（需求 11.4 / 11.5）

`advanceProject` 是**纯函数**，封装「推进 / 建成判定 / 重置 / 轮次递增」的全部计算：

```js
// world.js —— 纯函数，输入旧 project 与增量，输出新 project 与事件标记
export function advanceProject(project, delta) {
  const raw = project.progress + delta;
  if (raw >= 100) {
    // 建成：先报建成，再自动重置开新一轮
    return {
      progress: 0,                 // 建成即重置进度（需求 11.5）
      round: project.round + 1,    // 轮次 +1
      status: 'building',          // 重置后立即进入新一轮建造
      completedNow: true,          // 本次推进触发了建成（供调用方广播建成事件）
      completedRound: project.round, // 建成的是第几轮（供建成事件/动画文案）
    };
  }
  return { progress: raw, round: project.round, status: 'building', completedNow: false, completedRound: null };
}
```

调用方（`town-server.js`）据返回：
- `completedNow===false`：把新 `progress` 写回 `world.project`，广播一帧 `project_update{ progress, round, status:'building' }`。
- `completedNow===true`：**先**广播一帧 `project_update{ progress:100, round:completedRound, status:'completed' }`（让前端据 `status:'completed'` 触发炫酷建成动画，需求 11.4），**再**把 `world.project` 写为重置后的 `{ progress:0, round: round, status:'building' }` 并广播第二帧 `project_update{ progress:0, round, status:'building' }`（开启新一轮，需求 11.5）。两帧次序固定：先建成后重置，保证前端先放动画再看到归零。

> 为什么把「重置」也放进同一个纯函数的返回里：让「达 100 → 建成 → 重置 → 轮次+1」成为**一次纯计算**的原子结果，便于单测用一个输入断言全部输出（需求 11.9）；广播侧只是把这个原子结果拆成两帧推送（建成态 + 新一轮态），推送拆分属 I/O 层、不进纯函数。

### §20.4 新下行帧 project_update（信封与字段）

遵守统一信封 `{ type, data, ts }`（§4.0），`ts=Date.now()`：

```js
frame('project_update', {
  progress,   // 整数 0–100
  round,      // 当前轮次（建成帧带 completedRound，重置后带新 round）
  status,     // 'building' | 'completed'
})
```

- 新连接的 `world_state` 快照新增 `project` 字段（§24.2），使新游客进场即见当前进度/轮次，无需等下一次 `project_update`。
- `project_update` 为**全量小对象**（三字段都带），非 patch——工程只有一个全局对象、字段少，全量最简单、无合并歧义。
- `project_update` **不入 `recentEvents`**（它是状态帧，非叙事事件）；但「出力建造」的 `agent_event` 与「建成」事件的叙事**入 `recentEvents`**（见 §20.5），这样新游客的事件流能补看工程叙事上下文。

### §20.5 工程语料与建成事件（剧本轨离线可跑，需求 11.8）

- **出力建造语料**：在 `behavior.js` 新增一组工程专用模板（跨人格通用 + 人格微调），如「{name} 焊接了虫洞环的第 {seg} 节」「{name} 校准了超时空锚点」。`doAutonomy` 命中出力分支时取该语料生成 `agent_event.text`，`seg` 用 `project.progress` 派生使文案随进度变化。
- **建成事件叙事**：建成时除 `project_update{status:'completed'}` 外，另广播一条 `agent_event`（`kind:'act'`、`agentId:null`/`name:'赛博坦'` 占位，文案如「🌀 第 {round} 座虫洞超时空传送器建成！霓虹虫洞开启——」）并 `pushRecent`，让事件流留痕、新游客可补看。该叙事文案经宪章过滤。
- **剧本轨完整链路**：出力 → `project_update` 递增 → 达 100 → 建成帧 + 建成叙事 → 重置帧 → 新一轮，整条链路纯后端剧本驱动、不依赖任何外部服务，离线稳定可录屏（需求 11.8）。

### §20.6 前端渲染（全景进度条 + 建成动画）

- 新增 `app/js/wormhole.js`：在全景地图上渲染一个显眼的**虫洞装置 + 进度条**（赛博霓虹风，纯 Canvas/CSS 手绘：霓虹环 + 底部进度条，宽度 = `progress/100`，青紫→晶体青渐变；轮次角标「第 N 座」）。进度数值**只读** `store` 里的 `project.progress`，前端不自增（需求 11.6/11.7）；进度条可做**补间动画**（从旧值平滑到新值）属表现层，不改数值来源。
- **建成动画**：当 `store` 收到 `project_update{status:'completed'}` 时，`wormhole.js` 触发一次性的霓虹虫洞开启动画（纯 Canvas/CSS，如辉光爆发 + 环旋转），动画结束后随即到来的 `project_update{progress:0,status:'building'}` 把进度条归零、显示新轮次。前端对「先 completed 后归零」两帧的次序依赖已由 §20.3 后端保证。
- 改 `store.js`：`applyWorldState` 读入 `snapshot.project`；新增 `applyProjectUpdate(data)` 覆盖 `this.snapshot.project` 并 `_emit({kind:'project_update'})`。
- 改 `town-map.js` / `index.html` / `theme.css`：容纳虫洞装置的挂载位与样式。
- 改 `main.js`：`ws.on('project_update', ...)` 分发到 `store` + `wormhole` 渲染。

### §20.7 外部输入校验与边界（升级②）

`project_update` 是下行帧，无游客输入直接写工程（宪章 5：无任何上行帧可改工程进度，需求 11.7）。需校验的「外部输入」是 `store` 对下行 `project_update.data` 的防御性读取：

| 字段 | 规则 | 失败行为 |
| --- | --- | --- |
| `progress` | 必填、number、钳到 `[0,100]` 整数 | 非 number 时忽略该帧、保留旧值 |
| `round` | 必填、number ≥ 1 | 非法时保留旧 round |
| `status` | 必填、∈ `{building, completed}` | 非法值按 `building` 处理 |

边界：
- **并发：出力与讨论完成同刻推进**——都在被 `world.ticking` 自旋锁保护的 `tick()`/`step()`→`settleResolution()` 内串行调用 `advanceProject`，无竞态（沿用 §11 结论）。
- **一次推进跨过 100**：`advanceProject` 的 `raw>=100` 分支判定建成并重置为 0（不取模、不保留溢出余量），语义是「达到即建成、新一轮从 0 起」，简单可测。举例须与增量来源一致——**出力溢出**用 `progress=99` 出力 `+BUILD_DELTA_AUTONOMY(4)`=103≥100 → 建成重置；**讨论溢出**另举 `progress=96` 讨论完成 `+BUILD_DELTA_RESOLUTION(8)`=104≥100 → 建成重置。（单次出力增量恒为 +4、不会是 +8；+8 仅为讨论完成增量，勿混。）
- **建成瞬间有游客进场**：新连接 `world_state` 带的是**重置后**的 `project`（因建成帧与重置帧在同一 `tick` 内先后广播、`world.project` 落到重置态），新游客看到「刚开启新一轮、进度低」，与需求 11.5「任意时刻进入都能看到在建造中或刚建成」一致。

### §20.8 可测性（升级②，node --test）

- **`advanceProject` 纯函数单测**（`world.test.js` 扩展，需求 11.9）：
  - 普通推进（出力增量）：`advanceProject({progress:10,round:1,status:'building'}, BUILD_DELTA_AUTONOMY /*=4*/)` → `{progress:14, round:1, status:'building', completedNow:false}`。
  - 恰达 100：`advanceProject({progress:96,round:1,status:'building'}, 4)` → `{progress:0, round:2, status:'building', completedNow:true, completedRound:1}`。
  - 跨过 100（讨论增量）：`advanceProject({progress:96,round:1,status:'building'}, BUILD_DELTA_RESOLUTION /*=8*/)`（raw=104≥100）→ 同样建成重置、`completedRound:1`、新 `round:2`、`progress:0`；另举出力溢出 `progress:99 + 4`（raw=103）亦建成重置，证明 `raw>=100` 不取模、不留余量。
  - 轮次递增：连续两次建成后 `round===3`。
- **集成测试**（`town-server.integration.test.js` 扩展）：用 `CYBERTRON_TICK_MS` 调小、不发提问，驱动心跳若干 tick 后断言客户端收到 ≥1 条 `project_update` 且 `progress` 单调增（跨建成边界会归零）；再发一场合法讨论，断言 `resolution` 之后收到一条 `project_update`（讨论增量）。`world_state` 快照含 `project` 字段。
- **建成可演示性集成断言（MEDIUM-1 新增护栏，对应 §20.2 核算）**：用 `CYBERTRON_TICK_MS` 调小、**不发任何提问**（纯自主路径），驱动足量 tick（上限按 §20.2 核算的 ~1.8「天」留余量，如 `≥ 3×TICKS_PER_DAY` tick）后，断言客户端**至少收到一次** `project_update{status:'completed'}`，且**随后收到一条** `project_update{progress:0, status:'building'}` 的重置帧（两帧次序即 §20.3 锁定的「先 completed 后归零」）、其 `round` 较建成帧 `+1`。此断言为「纯围观必现建成 → 重置 → 新一轮」招牌链路提供有界时间上限的可测护栏，与二期验收 13 的「不做任何操作即可见建成/重置」口径一致。

---

## §21 升级③：破坏者被隔离机制（需求 13）

### §21.1 状态机扩展：新增 isolated（本次点名敲定）

把既有两态状态机（§3.1 `active` / `asleep`）扩为**三态**，新增 `isolated`。agent 运行时新增一个字段 `isolatedUntilTick`（见 §2.2 扩展）：

```js
// world.js —— agent 运行时新增字段
isolatedUntilTick: number,   // 隔离到期的心跳刻度；0 表示未被隔离
```

三态转移（全部后端计算，无游客触发）：

```
                命中 charterCheck 红线 / 使坏判定
  active / asleep ───────────────────────────────▶ isolated   （家显警戒色、禁言、不自主行动）
       ▲                                                │
       │            当前 tick >= isolatedUntilTick（到期）│
       └────────────────────────────────────────────────┘
                     自动解除，恢复为 active
```

- **进入 isolated**：从 `active` 或 `asleep` 皆可进入（使坏/越界不分作息）。进入时 `isolatedUntilTick = world.tick + ISOLATION_TICKS`。
- **期间**：`isolated` 公民不发言、不参与讨论、不产生自主行为、不参与互动剧情（§22）、不出力建造（§20）。即一切「产出路径」在遍历时先判 `status==='active'`，`isolated`（和 `asleep`）天然被排除——既有 `doAutonomy`/`selectSpeakers`/`runStep` 的 `status==='active'` 守卫已覆盖，隔离只需保证不被误选即可（见 §21.3）。**隔离期间该公民不走任何产出路径，故也不走 `applyCost`**——隔离期不扣费（不产出即不扣费），能量在隔离期内保持进入隔离那一刻的值。
- **到期自动解除**：在 `tick()` 每拍检查（锁定在天边界之前，见 §21.6），`world.tick >= isolatedUntilTick` 则恢复为 `active`、`isolatedUntilTick=0`，广播 `agent_update{status:'active'}`。到期恢复**不恢复能量**（能量仍走 token 经济，见下「到期 energy≤0 的确定处理」）。

**进入隔离的写回次序（MEDIUM-2 锁定）**：触发点 1（产出命中宪章，§21.2）中，该公民在同一次 `doAutonomy`/`runStep` 内**先**走了 `applyCost`——`applyCost` 可能因 `energy<=0` 返回 `status:'asleep'`。锁定次序为：**先把 `applyCost` 的结果写回 `agent`（含它可能写出的 `asleep`），随后再调 `enterIsolation` 把 `agent.status` 覆写为 `'isolated'`、`agent.isolatedUntilTick` 置到期刻度**。即 `isolated` 是这一拍的最终态，覆盖 `applyCost` 可能写出的 `asleep`：

```js
// town-server.js —— 命中宪章时的写回次序（锁定）
const cost = applyCost(agent, COST.autonomy);
agent.energy = cost.energy;
agent.status = cost.status;          // 可能被写成 'asleep'（energy<=0）
// …（agent_event 文案已被 sanitizeOutput 换成 SAFE_PLACEHOLDER，越界原文不外泄）
if (charterHit) {                    // 该次产出 charterCheck 命中
  const iso = enterIsolation(agent, world.tick);
  agent.status = iso.status;         // 'isolated' 覆盖上面的 'asleep'（最终态）
  agent.isolatedUntilTick = iso.isolatedUntilTick;
  // 广播 agent_update{status:'isolated'} + 隔离叙事 agent_event（安全文案）
}
```

这样 `isolated` 与 `asleep` 的优先级被明确锁死：**`isolated` 优先于 `asleep`**，一个既被扣到 0 能量又命中红线的公民，最终态是 `isolated`（禁闭优先于作息），其 `energy` 可为 0——这正是下一条不变量豁免要覆盖的情形。

**§9 token 经济不变量的 isolated 豁免（MEDIUM-2 锁定）**：§9 原不变量为「`energy<=0 ⇔ asleep`」。二期新增 `isolated` 后，该不变量**追加豁免**：改为「`energy<=0 ⇒ asleep`，**除非 agent 处于 `isolated`**（隔离态独立于能量，不受 asleep 推断约束）」。即一个 `isolated` 公民允许 `energy<=0` 而不被判 `asleep`。此豁免成立的前提是上面「隔离期不走 `applyCost`」——隔离期间没有任何函数会去读 `energy<=0` 把它改写成 `asleep`。`applyCost` 自身**不需改动**（它只在产出路径被调，而 `isolated` 公民不走产出路径），豁免只是把「`isolated` 可与 `energy<=0` 并存」声明为合法态，归入 `enterIsolation`/`tickIsolation` 两函数独占维护的隔离不变量（§21.3）。

**到期回 active 后 energy≤0 的确定处理（MEDIUM-2 / MEDIUM-1 锁定）**：`tickIsolation` 到期只把 `status` 回 `active`、`isolatedUntilTick=0`，**不碰 energy**。因 §21.6 锁定「本拍先隔离到期检查、后天边界」，到期恢复为 `active` 的公民若恰在同一拍跨天边界，会**紧接着**被（已按 MEDIUM-1 修正过的）`recoverDay` 命中并补满能量、仍置 `active`——结果是「放出来即满能量、活蹦乱跳」。若该拍**不是**天边界，则公民回 `active` 但 `energy` 仍为到期前的值：
  - 若 `energy >= COST.autonomy`：下一拍正常参与自主行为。
  - 若 `0 < energy < COST.autonomy`：`active` 但本拍不满足自主行为能量门槛，等下一个天边界补满（与普通低能量 `active` 公民一致，无特殊）。
  - 若 `energy <= 0`：锁定为「保持 `active` 但因能量门槛不产出，直到下一个天边界 `recoverDay` 补满」——**不在到期当拍把它判回 `asleep`**（避免「刚放出来就因 energy<=0 被判睡」的二义，这是本条要消除的歧义）。即到期恢复后 `energy<=0` 的 `active` 态是一个合法的短暂态，由天恢复兜底，不触发额外的睡眠判定。

> 为什么到期直接回 `active` 而非「按 token 经济回到应有状态」：需求 13.5 允许「恢复为 active 或按 token 经济回到应有状态」二选一。选**直接回 active** 是更简单、可测、可演示的确定行为——隔离本质是「禁闭惩罚」，期满即释放回活动态，能量的作息由既有天恢复/扣费独立管理，两套机制不耦合，避免「隔离到期还睡着」的观感割裂（评委看到的是「关禁闭 → 放出来又活蹦乱跳」，叙事更清晰）。

### §21.2 触发条件（charter 红线命中 / 使坏判定）与剧本轨确定触发路径（本次点名敲定）

两条触发来源：

1. **产出命中宪章红线（需求 13.2）**：既有 `sanitizeOutput()`（§town-server）在 agent 产出推送前做 `charterCheck`，命中则整条替换为 `SAFE_PLACEHOLDER`（需求 9.3，越界原文绝不外泄，需求 13.9）。二期在此**加一步**：当某 agent 的某次产出 `charterCheck` 命中时，除替换文案外，调用 `enterIsolation(agent, world.tick)` 把该 agent 隔离，并广播隔离叙事（安全文案）。即「说了越界的话 → 被宪章拦下 → 同时被隔离」。
2. **「使坏」判定（剧本轨确定可复现触发，需求 13.8）**：剧本轨默认不会真产出红线词（语料是干净的），为保证**评委默认也能看到隔离戏码**，设计一个**确定性 demo 触发钩子**而非靠小概率越界：
   - 锁定机制：在 `tick()` 的自主行为段，加一个确定性计数触发——每当 `world.tick` 首次达到 `ISOLATION_DEMO_TICK`（锁定常量，如 `18`，约启动后 54s）时，选一个确定的公民（锁定为 `gossip`/ECHO，「八卦邻居」人设最适合「使坏被隔离」的喜剧叙事）触发一次「使坏」：产出一条**被标记为使坏的 `agent_event`**（文案安全、不含真红线词，如「ECHO 偷偷散播了未经证实的小道消息……」），随即 `enterIsolation(ECHO, tick)`，广播隔离叙事 + `agent_update{status:'isolated'}`。
   - **扣费归属（NIT-1 锁定）**：这条使坏事件是**纯叙事触发，不走 `applyCost`**（它不是公民正常的自主行为，而是演示护栏用的确定性钩子，不应消耗能量、不应因扣到 0 引出 `asleep` 与 `isolated` 的竞争）。写回次序简化为：广播使坏叙事 `agent_event` → 紧随调 `enterIsolation(ECHO, world.tick)` → 写回 `agent.status:'isolated'` / `agent.isolatedUntilTick` → 广播 `agent_update{status:'isolated'}`。因不扣费，这里不存在触发点 1 那种「`applyCost` 可能先写 `asleep`」的次序问题；`isolated` 直接从进入前的 `active` 态写入。
   - **对互动剧情的影响（NIT-1 锁定，非错误）**：demo 固定隔离 `gossip`/ECHO，而 ECHO 是多条互动剧情（§22.2 的 `gossip_rebut`）的主要**发起方**。ECHO 被隔离的 `ISOLATION_TICKS`（8 拍）期间，以 ECHO 为发起方的互动剧情**暂歇**（§22.5 边界已覆盖：发起者 `status!=='active'` 不再被选为互动发起方），到期恢复 `active` 后自动重新参与。实现者须把「隔离期内 ECHO 相关互动暂停、到期恢复」视为**预期行为**，非 bug。
   - 该钩子是**确定触发**（固定 tick + 固定公民），保证不接 key 的本地演示在约 1 分钟内必现「触发 → 隔离 → 警戒色 → 到期恢复」完整闭环，可录屏（需求 13.8）。触发只发生一次（用 `world._isolationDemoFired` 布尔守卫），避免反复隔离同一人破坏观感；评委若想再看，刷新/重启即重现。
   - 「使坏」文案本身是安全占位级别的叙事（不含越界原文），符合需求 13.9。

> 决策理由：需求 13.8 给了「内置小概率越界产出」或「确定性 demo 触发钩子」二选一。选**确定性钩子**，因为小概率越界在剧本轨（语料本就干净）下几乎不触发，无法保证评委「默认也有机会看到」；确定性钩子让招牌护栏戏码可复现、可录屏，契合用户「demo 要惊艳、要能被评委 agent 快速体验」的硬约束。

### §21.3 隔离纯函数（node --test 覆盖状态迁移，需求 13.6）

隔离的进入/到期判定抽为 `world.js` 纯函数：

```js
// world.js —— 隔离状态机纯函数（无 I/O）
export const ISOLATION_TICKS = 8;   // 隔离时长：一批 tick（§25 登记）

// 进入隔离：返回新 status 与到期刻度
export function enterIsolation(agent, nowTick) {
  return { status: 'isolated', isolatedUntilTick: nowTick + ISOLATION_TICKS };
}
// 到期检查：到期返回解除后的 {status:'active', isolatedUntilTick:0, releasedNow:true}，
// 未到期返回 { releasedNow:false }（不改变状态）
export function tickIsolation(agent, nowTick) {
  if (agent.status === 'isolated' && nowTick >= agent.isolatedUntilTick) {
    return { status: 'active', isolatedUntilTick: 0, releasedNow: true };
  }
  return { releasedNow: false };
}
```

调用点（`town-server.js`）：
- 进入：§21.2 两条触发处调用 `enterIsolation`，写回 `agent.status/isolatedUntilTick`，广播 `agent_update` + 隔离叙事 `agent_event`。
- 到期：`tick()` 开头（**隔离到期检查在天边界 `recoverDay` 之前**、自主行为之前，次序见 §21.6）遍历 agents 调 `tickIsolation`，`releasedNow===true` 则写回并广播两帧，**次序锁定（NIT-4，与进入侧「先状态后叙事」对称）：先广播 `agent_update{status:'active'}`（使全景家节点先恢复亮灯、内景小人先回走动态），再广播一条「{name} 结束隔离，重新加入星城」的安全叙事 `agent_event`（入 `recentEvents`）**。§21.7 集成断言按此顺序断言（先收到 `agent_update{active}`、后收到结束隔离叙事 `agent_event`）。
- **不变量**：`status==='isolated' ⇔ isolatedUntilTick>world.tick`（除刚进入/刚到期的同一步）。该不变量由 `enterIsolation`/`tickIsolation` 两函数独占维护，集中在 `world.js`，便于单测穷举（进入设对到期刻度、期内不解除、到期解除、对非 isolated 调 tickIsolation 返回 `releasedNow:false`）。

### §21.4 隔离进入世界快照 / 下行帧（本次点名敲定）

隔离是 **agent 维度的状态**，故**不新增下行帧，复用 `agent_update`**：`status` 枚举从 `'active'|'asleep'` 扩为 `'active'|'asleep'|'isolated'`。

- `agent_update{ agentId, status:'isolated', energy, energyMax, crystals }`：隔离进入/解除都走这帧（§4.3 的 patch 合并规则不变，§10 `store.js` 已按 `typeof status==='string'` 覆盖，天然支持新枚举值，**前端无需改合并逻辑**）。
- `world_state` 快照的 agent `status` 字段天然承载 `isolated`（`makeSnapshot` 不枚举校验、直出 `a.status`），新游客进场即见隔离态，无需改快照形状。
- 隔离**叙事**（进入/解除/使坏）走既有 `agent_event`（安全文案，入 `recentEvents`），让事件流留痕、新游客可补看隔离戏码上下文。

### §21.5 前端渲染（全景警戒色 + 内景隔离表现）

- 改 `town-map.js`：`_updateNode` 的 `classList.toggle` 增加 `isolated` 态——`node.classList.toggle('isolated', a.status === 'isolated')`。CSS 用 `--alert-orange` 告警橙描边 + 警戒辉光（明显区别于 `active` 的青紫亮灯、`asleep` 的暗紫熄灯，需求 13.4），遵守 `视觉风格.md` 告警橙语义。
- 改 `home-interior.js`：`status==='isolated'` 的小人画成警戒静止态（告警橙描边、禁言、不走动，§19.3）。
- 前端全程只渲染后端下发的 `status`，不自行判定隔离（需求 13.7）。

### §21.6 边界与错误处理（升级③）

| 场景 | 行为 | 日志 |
| --- | --- | --- |
| 隔离期间被点名串门/互动回应 | 回应者 `status!=='active'`，§22 的 `matchInteraction` / 既有 `active` 守卫安全跳过，不报错、不卡事件流（需求 12.4 / 13.3） | 无 |
| 隔离期间轮到讨论发言 | `runStep` 取队首时 `status!=='active'` → 出队跳过（§5.2 第1步既有逻辑天然覆盖 isolated），不发言 | 无 |
| 隔离期间天边界 recoverDay | **现有 `recoverDay` 会误解除隔离，二期必须改**（见下「对既有 `recoverDay` 的明确增量」）：改后 `recoverDay` 显式 `continue` 跳过 `status==='isolated'` 的 agent（既不恢复其能量、也不改其 `status`/`isolatedUntilTick`）；隔离只由 `tickIsolation` 到期解除 | 无 |
| 到期解除与天边界同刻 | 两者都在 `tick()` 内串行，**锁定次序：先隔离到期检查（`tickIsolation`）、后天边界（`recoverDay`）**。使到期公民先回 `active`，再被同拍 `recoverDay` 命中补满能量（因它此刻已是 `active`+可能 `energy<energyMax`，命中 `needEnergy`），结果「放出来即满能量」。反序会让 `recoverDay` 先跳过仍为 `isolated` 的它、`tickIsolation` 再放出来却不补能，故锁定前者 | 无 |
| demo 触发钩子重复 | `world._isolationDemoFired` 布尔守卫，一次运行只触发一次 | 无 |

> **对既有 `recoverDay` 的明确增量（MEDIUM-1 修正，原设计断言错误）**：此前本设计误称现有 `recoverDay`「只对 `asleep` 唤醒、对 `isolated` 天然不动」。**经核对 `server/world.js` 源码，此断言错误**：现有 `recoverDay` 对**任何 `energy < energyMax` 的 agent**（不限 `asleep`）都会入列，并把 `status` **无条件写成 `'active'`**：
>
> ```js
> // 现状（会误解除隔离）
> export function recoverDay(agents) {
>   const affected = [];
>   for (const agent of agents) {
>     const needEnergy = agent.energy < agent.energyMax;   // 能量未满也入列
>     const needWake = agent.status === 'asleep';
>     if (needEnergy || needWake) {
>       affected.push({ id: agent.id, energy: agent.energyMax, status: 'active' });  // 一律置 active
>     }
>   }
>   return affected;
> }
> ```
>
> 被隔离公民进入隔离前通常刚被扣过费（`energy < energyMax`），因此会命中 `needEnergy` → 被 `recoverDay` 置 `active` → **隔离在天边界被提前误解除**，直接破坏需求 13.3/13.5。故二期**必须修改 `recoverDay`**，在遍历开头显式跳过 `isolated`：
>
> ```js
> // 二期锁定（显式跳过 isolated）
> export function recoverDay(agents) {
>   const affected = [];
>   for (const agent of agents) {
>     if (agent.status === 'isolated') continue;   // 隔离者天恢复一律不动（新增硬规则）
>     const needEnergy = agent.energy < agent.energyMax;
>     const needWake = agent.status === 'asleep';
>     if (needEnergy || needWake) {
>       affected.push({ id: agent.id, energy: agent.energyMax, status: 'active' });
>     }
>   }
>   return affected;
> }
> ```
>
> 该改动使 `recoverDay` 对 `isolated` agent **既不恢复能量、也不改 status 与 isolatedUntilTick**，与「隔离只由 `tickIsolation` 到期解除」互不打架。§21.7 补对应单测断言，§27/§28 已把本项记为「**改 `recoverDay`**」而非「天然满足」。

### §21.7 可测性（升级③，node --test）

- **`enterIsolation` 单测**：对 active/asleep agent 返回 `status:'isolated'`、`isolatedUntilTick === nowTick + ISOLATION_TICKS`。
- **`tickIsolation` 单测**：隔离中未到期 → `releasedNow:false` 不改状态；到期（`nowTick >= isolatedUntilTick`）→ `{status:'active', isolatedUntilTick:0, releasedNow:true}`；对非 isolated agent → `releasedNow:false`。
- **`recoverDay` 跳过 isolated 单测（MEDIUM-1）**：构造一个 `energy < energyMax` 的 `isolated` agent（最易踩现有 bug 的情形），断言 `recoverDay` 返回的 affected 列表**不含**该 agent（即其 `status` 与 `isolatedUntilTick` 不被改动、能量不被补满）；同时保留对照用例：一个 `energy < energyMax` 的 `active` agent 与一个 `asleep` agent 仍被正常列入 affected，证明改动只豁免 `isolated`、不回归其它分支。
- **集成测试**：用确定触发钩子（`CYBERTRON_TICK_MS` 调小）驱动心跳过 `ISOLATION_DEMO_TICK`，断言客户端收到被隔离公民的 `agent_update{status:'isolated'}` + 隔离叙事 `agent_event`；再驱动过 `ISOLATION_TICKS` 后断言收到该公民**先 `agent_update{status:'active'}`、后结束隔离叙事 `agent_event`**（NIT-4 锁定的到期帧次序，与进入侧对称）。为测试可控，`ISOLATION_DEMO_TICK` / `ISOLATION_TICKS` 允许由环境变量在测试里调小（§25）。

---

## §22 升级④：公民之间自发互动剧情（需求 12）

### §22.1 在既有 visit 之上扩展「发起 → 回应」模型（本次点名敲定）

既有机制（§6.1）已有雏形：`doAutonomy` 产出 `kind:'visit'` 时，以 `VISIT_REPLY_CHANCE=0.6` 把一个随机 `active` 公民推入 `world._pendingReplies`，下一拍让其产出一条 `kind:'talk'` 回应。二期把这个「盲回应」升级为**有语义配对的小剧情**：发起事件携带**剧情类型**，回应方按同一剧情类型、以对应人格口吻产出**呼应**的回应，使一来一往读起来是连贯因果，而非孤立两条。

模型：

```
发起（initiator, active）产出一条 interaction 事件
   data: { kind:'visit'|'talk', text, interaction:{ id, type, toAgentId } }
          │  后端据 type 选定回应方（优先 toAgentId，否则按剧情匹配一个 active 公民）
          ▼
回应（responder, active, 下一拍）产出呼应事件
   data: { kind:'talk', text, interaction:{ id, type, replyTo: initiatorId } }
```

`interaction.id` 把发起与回应串成一对；`type` 是剧情类型（见 §22.2）；前端据 `interaction.id`/`replyTo` 可把一对渲染得更连贯（§22.4）。

### §22.2 剧情类型与配对语料（剧本轨，需求 12.2 / 12.5）

在 `behavior.js` 新增一组**剧情配对语料** `INTERACTIONS`，锁定至少 4 类可识别剧情（需求 12.2 举例全覆盖）：

| type | 发起方人格倾向 | 发起语料示例 | 回应方人格倾向 | 回应语料示例 |
| --- | --- | --- | --- | --- |
| `gossip_rebut`（八卦被怼） | 八卦邻居 ECHO | 「{other}，我跟你说个秘密……」 | 精明商人 ZETA / 工程师 RIPR | 「这种没影的事，少传。」 |
| `poem_praise`（写诗求赞） | 忧郁诗人 NOVA-7 | 「{other}，听我念首刚写的诗好吗？」 | 热心工程师 RIPR | 「嗯……押韵是对的，继续写。」 |
| `crystal_haggle`（晶体讨价还价） | 精明商人 ZETA | 「{other}，三枚晶体换你半天工，如何？」 | 任意 active | 「两枚，不能再多了。」 |
| `visit_reply`（串门被回应） | 任意（既有 visit） | 既有 visit 语料 | 任意 active | 「来啦？正好一起坐坐。」 |

每类发起/回应各 ≥ 2 条，口吻与 §6.3 人格一致。真模型轨（有 key）用 persona + 剧情 type 作提示生成，产出同样经宪章过滤（双轨过滤一致，需求 12.5）。

### §22.3 配对纯函数 matchInteraction（node --test，需求 12.7）

把「选发起方 / 匹配回应方 / 挑配对语料」中可剥离 I/O 的决策抽为纯函数：

```js
// behavior.js —— 纯函数（无 I/O、无 random 副作用：random 作为可注入参数）
// 输入：发起事件的剧情 type、候选回应者数组（已过滤为 active 且非发起者）、语料库、取样器
// 输出：{ responderId, replyText } 或 null（无合适回应者时）
export function matchInteraction(type, candidates, corpus, rng = Math.random) {
  if (!candidates || candidates.length === 0) return null;     // 无人可回应 → null（安全跳过）
  const pool = corpus[type]?.reply;
  if (!pool || pool.length === 0) return null;
  const responderId = candidates[Math.floor(rng() * candidates.length)];
  const replyText = pool[Math.floor(rng() * pool.length)];
  return { responderId, replyText };
}
```

- `candidates` 由调用方在 `town-server.js` 预先过滤为「`active`、能量充足、未被隔离、非发起者」的公民 id（把 I/O/状态读留在调用方，纯函数只做选择，便于注入固定 `rng` 断言确定输出）。
- 返回 `null` 时调用方**安全跳过回应**，不报错、不卡事件流（需求 12.4）。

### §22.4 编排与前端呈现（需求 12.1 / 12.3 / 12.6）

- **编排（town-server.js）**：`doAutonomy` 产出带 `interaction` 元信息的发起事件时，把发起信息（`id/type/initiatorId/toAgentId`）记入 `world._pendingInteraction`；下一拍 `tick()` 处理：先按 §22.5 预过滤出 `candidates`（`active`、能量充足、未被隔离、非发起者），**并把 `_pendingInteraction.toAgentId` 对应的公民排到 `candidates` 首位**（§19.3/NIT-2 锁定的「回应优先者 = 文案点名者 = toAgentId」；若该公民此刻不满足条件则退回按剧情匹配其余候选）；再用 `matchInteraction(type, candidates, INTERACTIONS)` 选回应方与语料，若非 null 则让回应方产出呼应 `agent_event`（走 `applyCost(autonomy)`、宪章过滤、`pushRecent`、广播），并带 `interaction:{id,type,replyTo}`。回应仍是**后端心跳驱动的共享事实**，游客无任何上行帧可发起或操纵（需求 12.6，宪章 5）。
- **既有 `_pendingReplies` 收编**：§6.1 的盲回应机制并入本模型——`visit` 对应 `type:'visit_reply'`，统一走 `_pendingInteraction` 链路，删除/替换旧 `_pendingReplies`（避免两套回应机制并存）。
- **前端呈现（event-feed.js）**：既有 `addEvent` 已能按先后顺序渲染 `agent_event`，发起与回应因果相邻出现，天然读成一来一往。增强：当事件带 `interaction.replyTo` 时，回应项加一点视觉缩进/连线样式（纯 CSS，表现层），让「成对」更可读；不带 `interaction` 的普通事件样式不变。`event-feed.js` 仅样式增强，不改帧契约。

### §22.5 边界与错误处理（升级④）

| 场景 | 行为 |
| --- | --- |
| 被点名回应者睡着/能量不足/被隔离 | `candidates` 预过滤已排除；若过滤后为空，`matchInteraction` 返回 null，回应安全跳过（需求 12.4） |
| 发起者在下一拍前自己睡着 | 不影响——回应由回应方产出，发起事件已广播；剧情呈现为「发起了但没人接」亦可接受 |
| 发起方（如 ECHO）被隔离 | 隔离期间该公民 `status!=='active'`，§20.2/§22.1 的自主行为选取只挑 `active` 公民，故其**发起暂停**；以它为发起方的剧情（如 `gossip_rebut`）在隔离的 `ISOLATION_TICKS` 内不出现，到期恢复 `active` 后自动重新发起。**这是预期行为，非错误**（NIT-1） |
| 剧情语料缺该 type | `matchInteraction` 返回 null，跳过（防御式） |
| 回应产出命中宪章 | 走既有 `sanitizeOutput` 替换为占位；若因此触发隔离（§21.2），回应方被隔离，剧情自然收尾 |

### §22.6 可测性（升级④，node --test）

- **`matchInteraction` 单测**：注入固定 `rng`（如恒返 0）断言确定选出的 `responderId`/`replyText`；`candidates` 为空 → `null`；未知 `type` → `null`；`candidates` 含多人时 `rng` 变化覆盖不同选择。
- **集成测试**：驱动心跳制造一次发起事件，断言下一拍收到带 `interaction.replyTo` 的回应 `agent_event`，且 `interaction.id` 与发起一致；构造「候选全被隔离/睡着」场景断言无回应帧但事件流不中断。

---

## §23 升级⑤：赛博坦宪章图标与弹窗 / 赛博坦宇宙图标与弹窗（需求 14 / 15）

### §23.1 前端结构（纯 Canvas/DOM/CSS，零外部依赖）

两图标 + 两弹窗全部是**纯前端静态内容**，不产生任何上行写状态帧（需求 14.4 / 15.4），不新增下行帧。新增 `app/js/modals.js` 统一管理：

- **两个常驻可点击图标**：挂在界面一角（如 `topbar` 右侧），与轨道角标并列但视觉可区分：
  - 宪章图标：盾牌/法典意象，用内联 emoji 🛡️（或内联 SVG 手绘盾牌）+ 青紫霓虹描边。
  - 宇宙图标：星系/宇宙意象，用内联 emoji 🌌（或内联 SVG 手绘星系）+ 晶体青霓虹描边。
  - 两者皆纯 Canvas/DOM/CSS 手绘或内联 emoji/SVG，**无外部图片/字体/库**（需求 14.1 / 15.1）。
- **两个弹窗（modal）**：点击图标弹出对应弹窗（遮罩 + 居中卡片，赛博霓虹风）。每个弹窗提供**三种关闭方式**（需求 14.3 / 15.3 的「至少其一」，这里做满三种更友好）：右上角关闭按钮 ✕、点击遮罩、按 `Esc`。
- 改 `index.html`：加两图标挂载点与两弹窗容器（或由 `modals.js` 动态创建）；改 `theme.css`：弹窗/遮罩/图标样式；改 `main.js`：实例化 `modals.js`。

### §23.2 弹窗文案来源（择一说明，本次点名敲定）

**决策：两弹窗文案均作为前端静态常量内嵌于 `app/js/modals.js`（或一个 `app/js/lore.js` 常量模块），不由后端下发。**

理由：① 文案是**静态世界观/规则文本**，不是运行时共享状态，不随 tick 变化，无需后端权威；② 内嵌前端零往返、离线可跑、与「纯观赏、不产生上行帧」的约束天然契合（需求 14.4 / 15.4）；③ 后端快照应只承载真正的共享状态（agent/project），塞静态文案进快照会污染协议。

文案内容锁定来源（**由实现者从 steering/spec 原文誊抄为前端常量，保持与权威文件一致**）：

- **宪章弹窗**：《赛博坦宪章》五条红线全文，内容取自 `.kiro/steering/赛博坦宪章.md` 的「五条宪章」节：① 不伤害人类；② 禁色情、暴力、诈骗；③ 禁婚姻等机器伦理；④ 超越现实政治、公民一律平等；⑤ 人类只能围观、不能操纵（需求 14.2）。
- **宇宙弹窗**：产品意图/世界观文案，取自 `general_spec.md` 产品简介与目标：「赛博坦是一个由 agent 组成的虚拟世界和社会，每个人的 agent 都可以在赛博坦安家，自主生活、协作、进化，并利用这个虚拟世界的资源协助解决人类现实世界的问题」（需求 15.2）。可配一段更打动人的引导语（赛博霓虹叙事口吻），但核心意图句须与 spec 一致。

> **一致性守护**：因文案内嵌前端、原文在 steering/spec，二者可能漂移。锁定约定：前端常量块加注释标明「本文案誊抄自 `.kiro/steering/赛博坦宪章.md` / `general_spec.md`，修改须同步原文」。这不是运行时校验（静态文本无需 node --test），而是文档纪律；验收由人工核对两处文案一致（二期验收标准 16）。

### §23.3 边界与可测性（升级⑤）

- 弹窗为纯前端 UI，无后端纯函数，**不纳入 `node --test`**；验收由二期验收标准 16（点击弹出含五条/世界观全文、可关闭、不产生上行写状态帧）人工/浏览器核对。
- 边界：弹窗打开时不阻塞 ws 事件流渲染（弹窗是覆盖层，背景星城继续动）；`Esc`/遮罩/✕ 任一关闭恢复界面；两弹窗互斥（打开一个自动关另一个，避免叠加）。
- **宪章 5 守护**：图标点击只切换前端 DOM 可见性，**绝不** `ws.send` 任何帧；代码审查与集成测试侧断言「点击图标/开关弹窗期间无上行帧发出」（可在前端轻量验证，后端集成测试已有「越权/未知帧无状态变化」断言兜底）。

---

## §24 升级⑥：协议扩展总表（需求 10–15 跨切，重申宪章 5）

### §24.1 首帧契约与上行白名单（重申，绝不破）

二期**不新增、不变更任何上行帧**。上行帧白名单**仍严格仅三种**：`hello` / `visitor_ask` / `ping`（§4.1 / §4.2 不变）。首帧契约不变：每条连接必须先发 `hello` → 收 `hello_ok` 后才接受其它上行帧，`hello` 前业务帧按 `BAD_PAYLOAD` 静默忽略。路由 `default` 分支对未知 type 一律静默丢弃。

> **硬规则重申（宪章 5 / 需求 10.6 / 11.7 / 12.6 / 13.7 / 14.4 / 15.4）**：二期六块升级无一引入「让游客写 agent / 世界共享状态」的上行帧——家内景是前端视图切换、工程进度只由后端推进、隔离只由后端触发/解除、互动剧情只由后端心跳驱动、两弹窗是前端静态内容。**人类只能围观，这一结构性护栏在二期零稀释。**

### §24.2 下行帧变更总表（二期）

| 帧 | 变更类型 | data 字段 | 说明 |
| --- | --- | --- | --- |
| `project_update` | **新增** | `{ progress:int[0..100], round:int≥1, status:'building'\|'completed' }` | 升级②。全量小对象（非 patch）；建成走两帧（先 `completed` 后 `building` 归零，§20.3） |
| `agent_update` | **枚举扩展（无字段增删）** | `{ agentId, status:'active'\|'asleep'\|'isolated', energy, energyMax, crystals }` | 升级③。`status` 新增 `isolated`；前端 `store` 合并逻辑无需改（§21.4） |
| `agent_event` | **可选字段增补（向后兼容）** | 在既有 `{ agentId, name, persona, kind, text }` 上**可选**增补 `toAgentId`（visit/互动的被拜访者/回应对象）、`interaction:{ id, type, replyTo? }`（互动剧情配对）、工程/隔离叙事复用既有字段 | 升级①（`toAgentId` 供内景定位访客）、升级④（`interaction` 串对）、升级②/③（工程/隔离叙事复用，无新字段） |
| `world_state` | **快照新增 `project` 字段** | 快照在 §4.4 基础上新增 `project:{ progress, round, status }` | 新游客进场即见工程进度/轮次（§20.4） |

未在表中的既有下行帧（`hello_ok`/`discussion_*`/`resolution`/`ask_queued`/`ask_rejected`/`tick`/`pong`/`error`）**二期不变**。

### §24.3 recentEvents 影响（续 §4.4）

二期新增的**叙事**（工程出力 `agent_event`、建成叙事 `agent_event`、隔离进入/解除/使坏 `agent_event`、互动发起/回应 `agent_event`）全部走既有 `pushRecent` 入 `recentEvents`（`kind` 复用 `act`/`talk`/`visit`）。**状态帧 `project_update` 与 `agent_update` 仍不入 `recentEvents`**（沿用 §4.4 规则：状态帧不入叙事缓冲）。`RECENT_EVENTS_MAX=30` 上限不变，FIFO 淘汰不变。

### §24.4 信封一致性

所有二期帧（含新增 `project_update`）严格遵守统一信封 `{ type, data, ts }`（`ts=Date.now()`），复用既有 `frame(type, data)` 工具（§town-server）。前端 `ws-client.js` 的分发按 `type` 路由，`main.js` 对 `project_update` 加一条 `ws.on('project_update', ...)` 分发即可，无需改 `ws-client` 契约。

---

## §25 二期常量总表（续前 §14，锁定）

二期新增/涉及的锁定常量集中登记；正文出现的同名常量以本表为准。所有带 `CYBERTRON_*` 的为可由环境变量在测试里调小的有效值解析项（沿用 §3.2 `*_EFFECTIVE` 模式），其余为纯模块常量。

| 名称 | 默认 | 所在 | 用途 |
| --- | --- | --- | --- |
| `BUILD_CHANCE`（常量） | 0.35 | town-server.js | 自主行为命中「出力建造」分支的概率（§20.2） |
| `BUILD_DELTA_AUTONOMY`（常量） | **4** | world.js | 单次出力建造的进度增量（§20.2；MEDIUM-1 从 2 调高到 4，使纯自主围观约 2.2 分钟内必现一次建成，核算见 §20.2「建成可演示性核算」） |
| `BUILD_DELTA_RESOLUTION`（常量） | 8 | world.js | 一场讨论完成追加的进度增量（§20.2） |
| `VISIT_RELATION_TTL_MS`（前端常量） | 6000 | app/js/home-interior.js | 内景访客关系墙钟过期时长（MEDIUM-2；登记时记 `expireAt=Date.now()+TTL`，rAF 循环到点移除，不依赖 tick 下行帧，§19.3/§19.7） |
| `PROJECT_MAX`（常量，隐含） | 100 | world.js | 工程建成阈值（`advanceProject` 内 `raw>=100`，§20.3） |
| `ISOLATION_TICKS`（常量） | 8 | world.js | 隔离时长（一批 tick，§21.1）；测试可经 env 调小 |
| `ISOLATION_DEMO_TICK`（常量） | 18 | town-server.js | 剧本轨确定触发「使坏→隔离」的 tick（§21.2）；测试可经 env 调小 |
| `INTERACTION_TYPES`（常量集） | 见 §22.2 四类 | behavior.js | 互动剧情类型与配对语料（≥4 类，每类发起/回应各 ≥2 条） |
| 内景小人配色 `PALETTE`（前端常量） | 5 色霓虹同系 | app/js/pixel-figure.js | 内景小人异色派生（§19.2，与 theme.css 五主色并存） |
| 内景头像 `FACES`（前端常量） | 5 个内联字符 | app/js/pixel-figure.js | 内景小人异脸派生（§19.2，零外部图片） |
| 内景动作集（`INTERIOR_SCRIPT` 内动作枚举，前端常量） | walk/type/water/drink/read/idle | app/js/home-interior.js | 生活动作集合（≥ 敲电脑/浇花/喝水，§19.3） |
| 内景气泡/动作旁白语料 `INTERIOR_SCRIPT`（前端常量，按 persona 分组、每人格 ≥4 条） | — | app/js/home-interior.js | 内景自言自语 + 动作旁白唯一宿主（内置前端、离线，NIT-2 锁定，§19.4） |

> 建议新增可选环境变量（沿用 `*_EFFECTIVE` 解析，仅测试/调试用，缺省走常量默认）：`CYBERTRON_ISOLATION_TICKS`、`CYBERTRON_ISOLATION_DEMO_TICK`。生产/演示默认不设，走锁定默认值。

---

## §26 对 `.kiro/steering/视觉风格.md` 的增补要点（需在 steering 落地）

二期引入「家内景像素风」与「两图标/两弹窗」两类新视觉元素，`视觉风格.md` 现有六节未覆盖。**本设计要求在 `视觉风格.md` 增补以下要点**（由实现阶段按本清单补写该 steering 文件，使每轮前端实现自动遵守；设计仅定要点，不在此改写 steering 正文）：

1. **家内景像素风（新增一节）**：
   - 内景房间用深色底（`--cyber-ink`）+ 霓虹描边网格地板；家具用 emoji/CSS 手绘（💻 🌷 🥤 📖），零外部图片。
   - 像素小人用**内景专用 5 色配色**（霓虹同系，见 §19.2 `PALETTE`）异色 + 内联字符头像异脸，头顶名字标签用小字霓虹描边；明确这 5 个内景小人配色与 §1 的五个锁定主题变量**并存不冲突**（主题变量管全站，内景配色仅管小人区分）。**显式例外登记（NIT-4）**：内景 5 色是 steering「色值全部引用五个 CSS 变量、不写死散色」遵守清单的**唯一例外**——仅因它们用于区分内景多个小人、不参与全站主题；增补该 steering 时须把这条例外成文写入，避免后续前端实现误把内景 5 色当作违规散色而「修正」掉。
   - 作息/隔离表现与全景语义一致：`asleep` 熄灯休眠（`--dim-sleep`）、`isolated` 告警橙（`--alert-orange`）静止、`active` 青紫/晶体青走动。
   - 「返回全景」按钮：赛博霓虹描边、常驻内景一角。
2. **虫洞装置与进度条（并入第 5 节或新增）**：霓虹虫洞环 + 进度条（青紫→晶体青渐变，宽度 = `progress/100`）、轮次角标；建成动画用辉光爆发（纯 Canvas/CSS），无外部资产。
3. **宪章/宇宙图标与弹窗（新增一节）**：两图标用内联 emoji/SVG（🛡️ 宪章、🌌 宇宙）+ 霓虹描边且视觉可区分；弹窗遮罩 + 居中卡片、青紫/晶体青霓虹描边，三种关闭方式；弹窗为覆盖层，背景星城继续动。
4. **真模型轨不改内景**：内景生活小动作/气泡始终走前端内置语料（纯观赏表现层），真模型只影响全景事件流/讨论/决议（§19.4 边界）。
5. **零外部依赖重申**：二期所有新视觉元素一律 Canvas/DOM/CSS 手绘 + 内联 emoji/SVG，**无任何外部图片/字体/库**，离线可跑（继承一期约束）。
6. **视觉升级：科技建筑家 + 星球表面全景 + 科技舱体内景（新增一节，对应 §30 / 需求 16）**：
   - **公民的「家」是赛博朋克科技建筑**（参照《变形金刚》《星球大战》工业机械 + 外星殖民美学）：穹顶/舱体居住舱、能量塔、天线桅杆、发光管线、机械支架、霓虹描边装甲外壳；每户按 `agent.id` 派生 5 种剪影变体之一（统一赛博霓虹风，仅几何剪影不同），**不再是普通小房子**。亮灯（`active` 青紫/晶体青满辉光）/熄灯（`asleep` 暗紫 `--dim-sleep` 断电）/隔离（`isolated` 告警橙 `--alert-orange` 警戒）三态语义保持可辨识。
   - **星城全景背景是外星星球表面**，非地球地面：天空层深色星空（星点 + 星云 + 远处行星/光环）、远景层山脊/环形山轮廓、地面层外星地表 + 陨石坑质感 + 霓虹矿脉，营造「赛博坦某颗星球上的殖民城市」；家坐落其上。全部程序化生成、固定种子保证一致不闪烁。
   - **家内景是科技舱体内部**，非普通民居：金属舱壁网格 + 发光管线 + 观察舷窗（透出星空）+ 全息控制面板 + 金属台面家具；作息/隔离表现与全景一致。
   - **约束不变**：纯 Canvas/DOM/CSS 手绘 + 内联 emoji/SVG，**零外部图片/字体/库**，赛博霓虹风（青紫霓虹 × 晶体青 × 告警橙），**五个锁定色值 `#0A0714`/`#A24BFF`/`#38F2E6`/`#FF8A3D`/`#2A2140` 不得改**；本升级不引入新锁定色、不新增散色例外（内景小人 5 色仍是唯一例外）。

`赛博坦宪章.md` steering **无需改动**——二期未新增上行帧、未改过滤规则；宪章 5 的结构性护栏与六类过滤词表一期已足，二期只是在既有 `charterCheck` 命中时**额外**触发隔离（§21.2），属 design/实现层行为，不改宪章 steering 的约束文本。

---

## §27 二期文件改动面汇总（实现者据此落地，不做需求级决策）

**后端（`server/`）**：
- `world.js`：`createWorld` 初始化 `world.project`；agent 运行时加 `isolatedUntilTick`；新增纯函数 `advanceProject`、`enterIsolation`、`tickIsolation`；`recoverDay` 显式跳过 `isolated`；新增常量 `BUILD_DELTA_*`/`ISOLATION_TICKS`。
- `behavior.js`：新增工程出力语料、互动配对语料 `INTERACTIONS`、纯函数 `matchInteraction`；真模型轨互动/工程提示（可选，失败回退剧本）。
- `town-server.js`：`makeSnapshot` 加 `project` 字段；`tick()` 加「隔离到期检查 → 天边界 → 自主行为（含出力建造分流 + 互动发起/回应 + demo 隔离触发钩子）」；`doAutonomy` 产出带 `toAgentId`/`interaction`、命中宪章时触发 `enterIsolation`；`settleResolution` 后调 `advanceProject` + 广播 `project_update`；新增 `project_update` 广播；收编 `_pendingReplies`→`_pendingInteraction`；新增常量 `BUILD_CHANCE`/`ISOLATION_DEMO_TICK`。
- `world.test.js` / `behavior.test.js` / `town-server.integration.test.js`：补 §20.8 / §21.7 / §22.6 的单测与集成断言。

**前端（`app/`）**：
- 新增 `app/js/home-interior.js`、`app/js/pixel-figure.js`、`app/js/wormhole.js`、`app/js/modals.js`（可合 `lore.js` 存弹窗文案常量）。
- 改 `app/js/town-map.js`（家点击进入内景、`isolated` 警戒色、虫洞装置挂载）、`app/js/store.js`（存 `project`、`applyProjectUpdate`、`world_state` 读 project）、`app/js/main.js`（视图切换、`project_update` 分发、实例化内景/虫洞/弹窗）、`app/js/event-feed.js`（互动成对样式增强）。
- 改 `app/index.html`（内景容器 + 返回按钮 + 两图标/两弹窗挂载点 + 虫洞装置位）、`app/css/theme.css`（内景/像素小人/虫洞/弹窗/隔离态样式，遵守五色变量 + §26 增补）。

**Steering（NIT-4 锁定为独立必做任务，非附带）**：按 §26 清单增补 `.kiro/steering/视觉风格.md` 四节（家内景像素风 + 虫洞装置 + 弹窗/图标视觉规范 + **第 8 节科技建筑家/星球表面全景/科技舱体内景绘制规范，对应 §30 / 需求 16**）。此项**列为一个独立且必做的实现任务**（应在 `tasks.md` 中单列为一条任务项、并进二期验收清单），不得与前端代码改动混记或默认附带——因为 `视觉风格.md` 的 front-matter 是 `inclusion: always`，每轮前端实现会自动注入其约束；若只改前端代码而**漏补该 steering**，下一轮前端实现将看不到内景/虫洞/弹窗的视觉约束，造成风格漂移。增补时须**显式登记一条例外**：内景专用 `PALETTE` 5 色（§19.2）是写死的内景小人配色，与 steering「色值全部引用五个 CSS 变量、不写死散色」的遵守清单**构成唯一例外**，理由是这 5 色只用于区分内景小人、不参与全站主题，二者并存不冲突（见 §26 第 1 节）。`赛博坦宪章.md` 不改。

技术栈与常量自此（二期）锁定，实现者据 `tasks.md` 逐项落地，不再做需求级决策。

---

## §28 二期设计对需求的可追溯性（自检）

| 需求 | 设计落点 | 剧本轨可演示 | node --test |
| --- | --- | --- | --- |
| 10 家内景 | §19 | ✓（视图切换 + 内置语料动画） | 间接（visit `toAgentId` 字段齐全） |
| 11 虫洞工程 | §20 | ✓（出力→递增→建成→重置循环） | ✓ `advanceProject` |
| 12 互动剧情 | §22 | ✓（内置配对语料） | ✓ `matchInteraction` |
| 13 隔离机制 | §21 | ✓（确定 demo 触发钩子） | ✓ `enterIsolation`/`tickIsolation`/**改 `recoverDay` 跳过 isolated**（MEDIUM-1） |
| 14 宪章弹窗 | §23 | ✓（前端静态文案） | — |
| 15 宇宙弹窗 | §23 | ✓（前端静态文案） | — |
| 16 视觉升级（科技建筑家/星球表面全景/科技舱体内景） | §30 | ✓（纯前端 Canvas/CSS 手绘、零外部资产、离线可跑） | — （纯表现层，人工/录屏核对，二期验收 19） |
| 协议/宪章 5 | §24 | 上行白名单仍仅 3 种 | 集成断言越权帧无状态变化 |
| Steering 增补（NIT-4 + 视觉升级） | §26 / §27 / §30 | — | 独立必做任务：`视觉风格.md` 增补内景像素风/虫洞/弹窗三节 + **第 8 节科技建筑/星球表面/科技舱体内景绘制规范**，且内景 5 色作为显式例外登记 |

二期全部能力在不设任何环境变量、不接 LLM key 的默认剧本轨下开箱即玩、离线稳定、可录屏（二期验收标准 18）；设置 `CYBERTRON_LLM_API_KEY` 后真模型轨产出（事件流/讨论/决议/互动）同样经宪章过滤（需求 5 / 9 / 12.5）。

---

## §29 对二期设计评审 findings 的应对（本轮修订）

> 对象：`.agents/tasks/design-review.{json,md}`（裁决 CHANGES_REQUESTED，HIGH×0 / MEDIUM×2 / NIT×4）。逐条应对如下，全部 **已修**，修正均落在既有章节、不改技术栈与需求意图。另含本轮并入的【视觉升级要求】落地（§30）。

| Finding | 严重度 | 应对 | 落点 |
| --- | --- | --- | --- |
| MEDIUM-1 虫洞「建成」在默认不交互剧本轨下可达性缺核算，与二期验收 13 落差 | MEDIUM | **已修（方案 A）**。§20.2 补「建成可演示性核算」说明块（与 §3.2 睡眠闭环核算同风格），并把 `BUILD_DELTA_AUTONOMY` **从 2 调高到 4**（§25 常量表同步）：按锁定常量核算纯自主路径到 100 约 1.8「天」≈ **~130s（~2.2 分钟）** 必现建成，落在演示窗口（≤2–3 分钟）；§20.8 新增集成断言「不发提问、调小 TICK_MS 驱动足量 tick 后断言至少一次 `project_update{status:completed}` 且随后收到 `progress:0` 重置帧、`round+1`」。requirements 验收 13 为纯行为口径（未写死常量）、与设计一致，无需改数值 | §20.2、§20.8、§25 |
| MEDIUM-2 家内景访客关系过期以「1 个 tick 周期」为基准，前端无可靠 tick 信号 | MEDIUM | **已修（墙钟方案）**。改用前端自有墙钟常量 `const VISIT_RELATION_TTL_MS = 6000;`（§25 登记），登记时记 `expireAt=Date.now()+TTL`，内景 rAF 循环每帧比对到点移除，不依赖 tick 下行帧；§19.3 写死取值与理由、§19.7 边界表同步改为墙钟到点。三处（§19.3/§19.7/§25）一致 | §19.3、§19.7、§25 |
| NIT-1 讨论完成触发建成时「先 completed 后 progress:0」两帧次序未在该路径显式复述 | NIT | **已修**。§20.2 来源 2 补一句：无论出力还是讨论完成触发，`completedNow===true` 一律走同一「先 `project_update{completed}` 后 `project_update{progress:0}`」两帧；讨论路径下该两帧在 `resolution` 帧之后广播 | §20.2 来源 2 |
| NIT-2 内景气泡/动作语料唯一宿主文件未锁 | NIT | **已修**。§19.4 锁定唯一宿主为 `home-interior.js` 内 `INTERIOR_SCRIPT` 常量（按 persona 分组、每人格 ≥4 条、动作集枚举同住该文件），不另设独立模块；§25 两行据此标注 `INTERIOR_SCRIPT` | §19.4、§25 |
| NIT-3 `advanceProject` 跨 100 溢出举例数值与增量来源对不上 | NIT | **已修**。§20.7 把举例改为与来源一致：出力溢出用 `99 + 4`、讨论溢出另举 `96 + 8`，并注明「单次出力恒 +4、+8 仅为讨论增量」；§20.8 单测例同步改为 `+4`/`+8` 与 `BUILD_DELTA_*` 一致 | §20.7、§20.8 |
| NIT-4 隔离到期恢复时 `agent_event` 叙事与 `agent_update` 广播次序未锁 | NIT | **已修**。§21.3 到期分支注明固定次序：先 `agent_update{status:active}`（家先亮灯）、再广播结束隔离叙事 `agent_event`；§21.7 集成断言按此顺序断言 | §21.3、§21.7 |

> 另：上一轮已修的两处（隔离与 `recoverDay` 交互必须改 `recoverDay` 跳过 `isolated`；`isolated` 与 `applyCost`/§9 不变量的写回次序与豁免）继续保留于 §21.1/§21.6/§21.7，本轮未回归。

**本轮并入的新要求**：【视觉升级要求】（公民的「家」改为赛博朋克科技建筑、星城全景背景改为外星星球表面、家内景呼应科技舱体内部）已落地为 §30 新增视觉章节，并同步写进需求（需求 16）与 `.kiro/steering/视觉风格.md`（第 8 节）。约束不变：纯 Canvas/DOM/CSS 手绘、零外部图片/字体/库、赛博霓虹风、五个锁定色值不改。

**评审中已核实为真的假设（verifiedAssumptions）**：全部沿用，未因本轮修订失效（上行白名单仅 3 种、`agent_update` patch 四字段、`store` 按字符串覆盖 status 无需改、`makeSnapshot` 直出 status、`charterCheck`/`sanitizeOutput` 机制、端口 9527/9528、LLM 双轨、零外部依赖、三组纯函数签名、`_pendingReplies` 现存可收编、弹窗纯前端不新增帧、内景 `figureStyle` 5 id 可能撞色为实现期可调项）。本轮修订未引入任何新上行帧、未改技术栈、未偏离需求 10–16 意图；`BUILD_DELTA_AUTONOMY` 2→4 与 `VISIT_RELATION_TTL_MS` 均为常量/表现层调整，与一期 token 经济、宪章 5 护栏不冲突；视觉升级为纯前端绘制方案，零新增上行/下行帧。

---

## §30 视觉升级：赛博朋克科技建筑家 + 外星星球表面全景（需求 16）

> 本节落地本轮并入的【视觉升级要求】。**边界先行**：本升级是**纯表现层（前端绘制方案）重做**——只改 `town-map.js` / `home-interior.js` / `theme.css` 的「怎么画」，**不新增/不变更任何上行或下行帧、不改后端、不改任何共享事实**。家的坐标仍来自后端快照 `agent.home{x,y}`，亮灯/熄灯/隔离语义仍由后端 `status` 驱动（§3.3 / §21.5），本节只替换「节点长什么样、背景长什么样」。继承一期与二期全部锁定约束：纯 Canvas/DOM/CSS 手绘、**零外部图片/字体/库**、离线可跑、赛博霓虹风（青紫霓虹 × 晶体青 × 告警橙）、`视觉风格.md` 五个锁定色值（`#0A0714`/`#A24BFF`/`#38F2E6`/`#FF8A3D`/`#2A2140`）**不得改**。

### §30.1 美学参照与总基调（锁定）

参照《变形金刚》《星球大战》的**工业机械 + 外星殖民**美学：金属舱体、穹顶居住舱、能量塔、天线桅杆、发光管线、机械支架、霓虹描边装甲外壳；地面是外星地表而非地球城市。所有造型用**几何图元 + 霓虹描边 + 内发光**在 Canvas/CSS 手绘表达，不追写实、追「可辨识的赛博工业剪影」。五个锁定色值继续作为全站主题变量（§1）；本升级新增的只是「形状 / 层次 / 渐变过渡」，色相一律落在五色及其同系霓虹里，**不引入新的锁定色**。

### §30.2 公民的「家」= 赛博朋克科技建筑（改 `town-map.js` 节点绘制 + `theme.css`）

**决策：家节点从「简单小房子」重做为「科技居住舱」复合剪影**，每个公民一个略不同的造型剪影但统一赛博霓虹风。实现落点与方案：

- **绘制方式（择一，选 B）**：
  - 方案 A：纯 CSS DOM 多层叠加（伪元素画舱体/桅杆/管线）。
  - 方案 B（**选用**）：每个家节点是一个固定尺寸的 `<canvas>`（或内联 `<svg>`）由 `town-map.js` 的 `drawHome(ctx, {persona, status, variant})` 手绘。选 B 因为科技建筑剪影含曲线穹顶、斜向支架、多段发光管线，Canvas/SVG 路径比堆 CSS 伪元素更可控、更易按 `status` 切换辉光，且仍零外部依赖。节点外层仍是定位 DOM（承载点击、名字标签、能量条），内层用 canvas 画建筑本体。
- **建筑构成（统一组件库，`town-map.js` 内若干 `drawXxx` 子过程）**：① **穹顶/舱体居住舱**（半圆穹顶或六边舱体，装甲外壳用深色 `--cyber-ink` 填充 + `--neon-violet` 霓虹描边）；② **能量塔 / 天线桅杆**（竖直细线 + 顶端晶体青 `--crystal-cyan` 光点，可极缓呼吸）；③ **发光管线**（沿舱体边缘的 1–2 条 `--crystal-cyan` 细管，表现能量流动）；④ **机械支架 / 着陆脚**（斜向支撑线，落在星球地表上）；⑤ **霓虹描边装甲**（整体多层 `box-shadow`/canvas `shadowBlur` 内发光）。
- **每户造型差异（`variant` 由 `agent.id` 确定性派生，同 §19.2 哈希）**：锁定 5 种剪影变体（如「单穹顶舱」「双舱体 + 桅杆」「塔式居住舱」「低舱体 + 大天线阵」「晶体顶舱」），`variant = hashId(agent.id) % 5`，保证同一公民造型恒定、5 户彼此可分，但**统一赛博霓虹风**（配色/描边/辉光规则一致，只换几何剪影）。差异是剪影级别，不引入新色。
- **亮灯/熄灯/隔离语义保持可辨识（硬约束，承 §3.3/§21.5）**：
  - `active`（亮灯）：舱体 + 管线 + 桅杆光点满辉光（`--neon-violet` / `--crystal-cyan`），可缓慢呼吸。
  - `asleep`（熄灯）：整体切 `--dim-sleep` 暗紫、辉光骤减、管线/桅杆光点近乎熄灭（舱体剪影仍在，只是「断电」观感）。
  - `isolated`（隔离警戒）：装甲描边切 `--alert-orange` 告警橙 + 警戒辉光（可慢闪），明显区别于亮灯的青紫与熄灯的暗紫（需求 13.4）。
  - 三态由 `town-map.js` 的 `_updateNode` 按后端 `status` 切 class / 重绘，前端不自判（承 §21.5）。

### §30.3 星城全景背景 = 外星星球表面（改 `town-map.js` 背景层 + `theme.css`）

**决策：全景背景从「地球地面」重做为「赛博坦某颗星球的殖民地表 + 深空星空」**，分三层由 `town-map.js` 的 `drawBackground(ctx)` 在家节点之下手绘（全部纯 Canvas/CSS 程序化生成，零外部图片）：

- **天空层（顶部）**：深色星空——`--cyber-ink` 为底，程序化撒**星点**（随机但用固定种子 `rng(seed)` 保证每次渲染一致、不闪烁），叠 1–2 片**星云**（`--neon-violet`/`--crystal-cyan` 的大半透明径向渐变色斑），右上或左上角画一颗**远处行星/带光环的星体**（圆 + 椭圆环，霓虹描边）。星点/星云/行星均为静态或极缓飘移的表现层，不随后端状态变。
- **远景层（中部地平线）**：**远处山脊 / 环形山轮廓**——用一条起伏折线（program 生成的低多边形山脊）勾出外星地平线，描边 `--neon-violet` 微辉，填充比地面略深，营造纵深。
- **地面层（底部，家坐落其上）**：**外星地表 / 陨石坑质感**——`--cyber-ink` 偏紫的地表底色 + 程序化**陨石坑**（几个同心椭圆 + 内阴影）+ 稀疏**霓虹地裂/能量矿脉纹理**（`--crystal-cyan` 细线）。家节点的机械支架/着陆脚（§30.2）落在此层，强化「殖民城市建在星球表面」。
- **坐标不变**：家仍按 `agent.home{x,y}` 归一化定位到地面层（§1/§5 布局不变），背景只是替换「家坐落在什么上面」。背景绘制在家节点 z 轴下方，不拦截点击。

### §30.4 家内景 = 科技舱体内部（改 `home-interior.js` 房间绘制 + `theme.css`）

**决策：内景房间从「普通民居」重做为「科技舱体内部」**，呼应 §30.2 的居住舱外壳，由 `home-interior.js` 的房间背景层手绘（承 §19.6 的房间渲染器，仅改「房间长什么样」，像素小人/走动/动作/气泡机制与 `INTERIOR_SCRIPT` 不变）：

- **舱壁与地板**：深色 `--cyber-ink` 舱壁 + `--neon-violet` 霓虹描边的**网格/面板分块**（金属舱体内壁观感）；地板用霓虹描边网格（承 §26 第 1 节）。
- **舱体科技元素**：墙面**发光管线**（`--crystal-cyan` 细管）、**观察舷窗**（圆/六边窗，透出 §30.3 的星空一角，强化「在星球上的舱里」）、**控制面板/全息屏**（CSS 手绘矩形 + 霓虹描边 + 扫描线）。
- **家具科技化**：既有家具（电脑 💻、花 🌷、水杯 🥤、书 📖，§19.6）保留为可辨识道具，但置于**金属台面/支架**上（CSS 手绘底座），而非普通桌椅；emoji 作点缀、零外部图片。
- **作息/隔离表现一致**：承 §19.3——`asleep` 舱内熄灯休眠（`--dim-sleep`）、`isolated` 告警橙静止、`active` 正常。舷窗外星空、舱壁辉光可随屋主 `status` 微调明暗（表现层）。

### §30.5 文件改动面（续 §27，纯前端，零新增帧）

| 文件 | 改动 | 说明 |
| --- | --- | --- |
| `app/js/town-map.js` | `drawBackground(ctx)` 画星球表面三层背景；家节点改用 `drawHome(ctx,{persona,status,variant})` 画科技居住舱（含 5 种 `variant` 剪影）；`_updateNode` 按 `status` 切亮灯/熄灯/隔离辉光 | 坐标/点击/名字/能量条/`isolated` class 逻辑不变（承 §19.6/§21.5） |
| `app/js/home-interior.js` | 房间背景层改为科技舱体内部（舱壁网格 + 发光管线 + 舷窗 + 全息面板 + 金属台面家具）；小人/动作/气泡/`INTERIOR_SCRIPT`/`VISIT_RELATION_TTL_MS` 机制不变 | 仅换房间外观 |
| `app/css/theme.css` | 新增科技建筑/星球背景/舱体内景相关样式（辉光、渐变、描边），全部引用五色变量 + 内景 5 色例外（§26） | 不新增锁定色 |
| `app/js/pixel-figure.js` | 不变（小人配色/头像/动作机制承 §19.2） | — |

**后端 / 协议 / 需求语义零改动**：`world_state` / `agent_update` / `agent_event` / `project_update` 帧形状不变；家坐标、作息/隔离状态仍是后端单一事实源；上行白名单仍仅 `hello` / `visitor_ask` / `ping`（宪章 5 不稀释）。

### §30.6 约束自检与可测性

- **零外部依赖**：星空星点/星云/行星、山脊、陨石坑、科技建筑剪影、舱体内壁，全部用 Canvas 路径 / CSS 渐变 / 内联 emoji 程序化生成，**无任何外部图片/字体/库**，离线可跑（承 NFR-1）。
- **五色锁定**：所有新绘制的填充/描边/辉光色一律取自五个锁定变量及其同系霓虹渐变；内景小人 5 色仍是 §26 登记的唯一例外，本升级不新增例外、不新增锁定色。
- **确定性**：背景星点/星云用固定种子 `rng`，家 `variant` 用 `hashId(agent.id)`，保证多游客 / 重渲染视觉一致、不逐帧闪烁。
- **可测性**：本升级为纯表现层绘制，不产出后端纯函数，**不纳入 `node --test`**（承 §19.7/§23.3 口径）；验收由二期验收标准 19（见 requirements 需求 16）以浏览器/录屏人工核对「家是科技建筑、全景是星球表面、内景是科技舱体、亮灯/熄灯/隔离仍可辨识」。`视觉风格.md` 第 8 节（§30 对应 steering 增补）为 `inclusion: always`，守护后续每轮前端实现自动遵守本绘制规范。
