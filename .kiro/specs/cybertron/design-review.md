# 设计评审 · 赛博坦（Cybertron）—— 第四轮

> 评审对象：`2-cybertron/.kiro/specs/cybertron/` 下 `requirements.md` / `design.md` / `tasks.md`，及 `.kiro/steering/`（赛博坦宪章、视觉风格）与 `.kiro/hooks/源码改动跑冒烟测试.kiro.hook`。
> 需求来源：`2-cybertron/general_spec.md`、`2-cybertron/00-思路与决策.md`、原始用户请求（「按 general_spec 执行」「无趣之趣；先做本地部署」）。
> 评审方式：脱离生成上下文、独立复核；对设计声称可复用的参考作品 `1-kickbadguy` 实际读源码核实。
> 裁决机制：HIGH + MEDIUM 计数 > 0 即 CHANGES_REQUESTED；= 0 即 APPROVED。

本设计已经历三轮评审并逐条应对（§15/§16/§17），整体成熟度高：五件套在 requirements 有编号可测验收标准、在 design 有具体方案；LLM 双轨环境变量名锁定（`CYBERTRON_LLM_API_KEY`）、无 key 静默走剧本规则明确；前后端消息帧契约（§4）详尽到可照做；token 经济（§9）与宪章过滤（§8）均设计为可单测纯函数。本轮仍发现一处 MEDIUM 级跨节冲突和若干 NIT。

---

## 一、Findings

### MEDIUM-1 · `recoverDay` 函数签名在 §9 与 §3.2 两处互相矛盾，实现者无法确定其契约

**位置**：design §9（定义）vs §3.2 第 2 步（调用）vs tasks 任务 3（列为纯函数）。

**问题**：同一个纯函数在两处有不一致的签名与语义，而它恰是 NFR-5 要求单测覆盖的 token 经济核心函数之一：

- §9 定义为 `export function recoverDay(agents) { ... }`，注释「天恢复：返回受影响 agent 的新状态数组（energy 满、asleep→active）」——**入参是 agents（数组/集合），返回新状态数组**，与同节 `applyCost`/`reward` 一致的「无 I/O、返回新值供调用方写回」纯函数风格。
- §3.2 第 2 步写 `if (world.tick - world.dayStartTick >= TICKS_PER_DAY) recoverDay(world)`——**入参是整个 `world`**，且紧接着「恢复能量、唤醒 agent、`dayStartTick = world.tick`，并广播受影响 agent 的 `agent_update`」，读起来像是 `recoverDay` 直接改写 world（含 `dayStartTick`）甚至触发广播。

两者在「入参是 `agents` 还是 `world`」「是纯函数返回新值、还是就地改写 world 并顺带设 `dayStartTick`」上直接冲突。§9 还声明不变量「由 `applyCost`/`reward`/`recoverDay` 三个函数独占维护」且「便于单测穷举边界」，这只有在 `recoverDay` 是无副作用纯函数时成立；但 §3.2 的 `recoverDay(world)` 调用形态会把 `dayStartTick` 赋值和广播混进去，破坏可测纯度。实现者据 §9 写纯函数会与 §3.2 调用处对不上；据 §3.2 写成改 world 的函数又违反 §9 的纯函数/可测承诺。tasks 任务 3 只列 `recoverDay` 名字，未消歧。

**具体修复（二选一，建议方案 A 以保持与 §9 纯函数族一致）**：

- 方案 A（推荐）：锁定 `recoverDay` 为纯函数，签名 `export function recoverDay(agents) → [{ id, energy, status, wokeNow }...]`（或返回整批新 agent 运行时快照），**只计算能量恢复与 asleep→active，不碰 `dayStartTick`、不广播**。把 §3.2 第 2 步改为：
  ```js
  if (world.tick - world.dayStartTick >= TICKS_PER_DAY) {
    const changes = recoverDay([...world.agents.values()]);   // 纯计算
    for (const c of changes) { /* 写回 world.agents 对应字段 */ }
    world.dayStartTick = world.tick;                          // 由 tick() 负责
    // 对 wokeNow / energy 变化的 agent 广播 agent_update（由 tick() 负责）
  }
  ```
  即「`dayStartTick` 赋值 + 广播」是 `tick()`（town-server.js）的职责，`recoverDay` 保持无 I/O。
- 方案 B：明确 `recoverDay(world)` 就地改写 world 并返回受影响 agent 列表供广播，同时在 §9 收回「纯函数独占维护不变量、可穷举单测」对 `recoverDay` 的措辞，改为对其「能量/状态计算子逻辑」单测。

无论哪个方案，请同步修正 §9 定义、§3.2 调用、tasks 任务 3 与 §12「`recoverDay`（满能量 + 唤醒）」单测描述，使四处签名一致。

---

### NIT-1 · 讨论中「全员睡着」预判与排队后真正取用的发言资格判据不一致，可能把注定无果的提问排进队列

**位置**：design §5.1 第 4 步（预判）与第 5 步（取用判据）。

**问题**：§5.1 第 4 步（NIT-1 修复引入的轻量预判）判「镇上无任何 `status==='active'` 的 agent」才直接拒；但第 5 步真正选发言人用的是更严的 `status==='active' && energy>=COST.speak`。于是存在一档状态：**全员 active 但都 `energy < COST.speak`**。此时预判（只看 active）放行、问题入队回 `ask_queued`，但该问题被取出处理时第 5 步选不出人、回 `ask_rejected{NO_AWAKE_AGENT}`——游客先被告知「已排队、稍后有结果」，最终却无结果。与第 4 步「选择排队是为了对游客更友好」的意图略有出入。

本条定位 NIT：设计已明确称其为「轻量预判」，且该窗口短暂（天恢复会补满能量），不阻塞。但建议澄清以免实现者困惑。

**具体修复**：将 §5.1 第 4 步预判判据与第 5 步取用判据对齐，改为「镇上无任何 `status==='active' && energy>=COST.speak` 的 agent 时直接 `ask_rejected{NO_AWAKE_AGENT}` 不入队」；或在第 4 步显式注明「预判只做 active 粗筛，极端低能量档可能排队后仍 NO_AWAKE，可接受」，让实现者知道这是有意为之而非遗漏。

---

### NIT-2 · `spoken.length === 0` 时仍结算决议的行为未显式定义（当前虽不可达，建议补一句防御性说明）

**位置**：design §5.4 决议结算、§11 边界、§6.2 `summarizeResolution` 签名。

**问题**：§5.2 第 1 步允许逐个 speaker「不满足 `energy>=COST.speak` 则跳过（出队不发言）」。若一场讨论的所有 speaker 都被跳过，`discussion.spoken` 为空，§5.4 第 3 步 `ADOPTED_COUNT = min(2, spoken.length) = 0`、`summarizeResolution(question, [], mode)` 会收到空发言列表，产出的「赛博坦决议」内容未定义。requirements 3.4 的语义是「参与讨论的 agent 均已发言 → 产出决议」，零发言时产出一条决议属语义真空。

经分析此分支在当前常量下**实际不可达**：speaker 在 §5.1 第 6 步按 `energy>=COST.speak` 选入；讨论推进期间 `phase==='discussing'`，自主行为不跑（不扣能量），唯一的能量变更是跨天 `recoverDay`（只加不减且不改本场队列，§11 NIT-3）。故被选入的 speaker 到自己那步时能量不会低于入选时，不会被第 5.2.1 跳过。因此降为 NIT。

**具体修复**：在 §11 补一条边界：「§5.2 的逐步跳过在当前常量组下不会清空 `spoken`（选入后能量不被扣减）；作为防御性约定，若 `spoken.length===0`，则不产出 `resolution`、直接 `phase='idle'` 并处理 `askQueue` 下一项（或产出一条固定占位决议文案），实现者二选一并写死。」顺带明确 `summarizeResolution` 对空 `spoken` 的返回约定。

---

### NIT-3 · README「一条命令跑通」与 server 需先 `npm install` 之间的步骤未在 spec 层对齐

**位置**：tasks 任务 2（`cd server && npm install` 装 `ws`）、任务 12（README「本地一条命令跑通步骤」）、用户硬约束「先做本地部署让我看看效果」。

**问题**：后端依赖 `ws`（§0/§13/§14），首次运行必须先 `npm install`；但 00-思路与决策.md 与 tasks 任务 12 多处宣称「本地一条命令跑通 / 点开即看」。「一条命令」与「先 install 再 start」之间的落差未在 spec 层点明。这不影响实现正确性，但影响用户第一印象（用户明确要「先本地部署看效果」），值得在 README 任务里写清。

**具体修复**：tasks 任务 12 的 Verify 明确 README 要给出「首次：`cd server && npm install && npm start`；之后：`npm start`」两档，并说明前端如何打开（直接 `file://` 打开 `app/index.html` 还是需一个静态服务器——§10 `ws-client.js` 连 `ws://<host>:<port>`，若前端用 `file://` 打开需确认跨源/mixed-content 不挡 WebSocket；建议 README 给一个 `npx serve app` 或 Node 静态托管的明确指引）。

---

## 二、已验证的假设（Verified Assumptions）

1. **参考作品 `1-kickbadguy` 存在，且 design 声称可复用的模式全部真实**。已读 `1-kickbadguy/server/room-server.js` 核实：`frame(type,data)` 返回 `{type,data,ts:Date.now()}`；`makeSnapshot(room,self)` 只拼普通字段、绝不外泄 ws 句柄；首帧契约为 `hello→hello_ok`，`hello`/`hello_ok` 之前到达的业务帧按 `BAD_PAYLOAD` `console.debug` 静默忽略、未知 `type` 走 `default` 同样静默；`singleSend` 以 `WebSocket.OPEN` 守卫。design §1/§4.0/§4.1/§4.2/§8.4 的复用与「上行白名单 + default 静默丢弃 = 结构性不可操纵」断言成立。
2. **技术栈可行**。`1-kickbadguy/server/package.json` 为 `type:module`、`deps.ws` 固定版本、`scripts.test:"node --test"`——design §0/§13、tasks 任务 2 的 `ws 8.18.0 / node --test / node>=18` 锁定与既有工程一致。
3. **五件套在 requirements 均有编号可测验收标准**：小镇地图（需求 1 / 验收 1）、agent 自主生活（需求 2 / 验收 2、3）、游客广播提问→讨论→决议（需求 3 / 验收 4、5）、token 经济（需求 4 / 验收 6、7）、宪章护栏（需求 9 / 验收 5；含「只能围观」硬规则验收 3）。design 对每件均有具体方案（§2/§3/§5/§9/§8）。
4. **LLM 双轨优雅降级明确可落地**：环境变量名锁定 `CYBERTRON_LLM_API_KEY`（§7.1/§14），`hasKey=!!(env && trim)` 启动定轨（§7.2），无 key → `mode='script'`、`llm=null`、不发任何外部请求、不报错（需求 5.1/5.4）；真模型失败经 `try/catch` 全部回退剧本（§7.3 错误矩阵，需求 5.3）；`.env.example` 仅 key 名无值、`.gitignore` 忽略 `.env`（NFR-4/验收 11）。
5. **前后端消息帧契约具体到可直接实现**：统一信封 `{type,data,ts}`（§4.0）、上行白名单三帧（§4.2）、下行帧逐个列出字段与触发时机（§4.3，含 `ask_queued` 成功帧与 `ask_rejected.reason` 五值枚举的拆分）、`world_state` 快照形状（§4.4）、新游客时序图（§4.5）、`agent_update` 部分字段 patch 合并语义与 `recentEvents` 的 `pushRecent` 写入/FIFO 淘汰规则均写死。
6. **token 经济与宪章过滤被设计成可做纯函数单测**：§9 `applyCost/reward/recoverDay` 无 I/O 返回新值（除 recoverDay 签名见 MEDIUM-1）、常量集中 §14；§8.2 `charterCheck(text)→{ok,category}` 无副作用；§12 与 tasks 任务 7/8 给出了对应单测与集成断言（含 reward 唤醒、六类命中锚点、排队 vs 队满帧区分、纯自主耗尽→睡觉→天恢复端到端）。NFR-5/验收 10 可满足。
7. **HIGH-1（上一轮）常量自洽性复核通过**：`ENERGY_MAX=48 / COST.autonomy=6 / BEHAVIOR_COOLDOWN_TICKS=1 / AUTONOMY_CHANCE=0.9 / TICKS_PER_DAY=24` 下，一天期望自主行动 `24×0.9≈21.6` 次 > 耗尽所需 `48/6=8` 次，纯自主 agent 必在天内熄灯、第 24 tick 被恢复，闭环 ≈72s，默认不交互可见——与验收标准 6 / 需求 4.5 一致。
8. **NFR-2 时延核算成立**：讨论与心跳解耦，`DISCUSS_STEP_MS=1500`、`MAX_SPEAKERS=5`、末步并入结算，最坏 5×1.5s=7.5s ≤ 10s（剧本轨 await≈0）。
9. **Steering 与 Hook 自洽**：宪章 steering 的上行白名单、六类词表、双轨一致过滤与 design §4.2/§8 一一对应；视觉 steering 的五个锁定色值、家亮/熄灯语义、决议高亮卡片与 design §10 / requirements 需求 1、3.4 一致；Hook 匹配 `app/js/**` 与 `server/**` 并统一跑后端 `npm test`，`prompt` 已说明前端无独立测试、保存前端亦跑后端冒烟作回归兜底（§15 NIT-5 应对）。

---

## 三、未验证 / 需实现期验证的假设（Unverified Assumptions）

1. **真模型接口为 OpenAI Chat Completions 风格**（§7.3 用 `CYBERTRON_LLM_BASE_URL` 默认 `.../v1` + `CYBERTRON_LLM_MODEL` 默认 `gpt-4o-mini`）。未对任何真实端点发起请求核实。**不阻塞**：无 key 即不进该轨；有 key 但接口不符时 `try/catch` 回退剧本，demo（走剧本）不受影响。保留为实现期验证项。
2. **`node:test` + `ws` 客户端集成测试在目标机可运行**。设计声称本机 Node 满足 ≥18 且原生 `fetch`/`AbortController`/`node:test` 可用（上一轮 design-review.json 记为 v26.0.0）；本轮未重新执行 `node --version` 核实。**不阻塞**：属实现期 `npm test` 自然暴露，且与参考作品同栈（`1-kickbadguy` 已有同类集成测试文件）。

---

## 四、裁决

发现 MEDIUM×1、NIT×3。按机械计数 HIGH+MEDIUM = 1 > 0。

**裁决：CHANGES_REQUESTED。**

阻塞项仅 MEDIUM-1（`recoverDay` 跨节签名冲突），是一处定义/调用矛盾，澄清签名即可闭环，属快速回环。NIT-1/2/3 建议一并澄清以减少实现期歧义，但不单独构成阻塞。
