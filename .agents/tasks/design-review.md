# 设计评审 · 赛博坦9号星城二期（收尾修复 + 视觉升级）

- 评审对象：`2-cybertron/.kiro/specs/cybertron/design.md`（§18–§30 二期增补，含其所依赖的一期 §0–§17）
- 对照需求：`2-cybertron/.kiro/specs/cybertron/requirements.md`（需求 10–16 + 二期验收 12–19）
- 视觉 steering：`2-cybertron/.kiro/steering/视觉风格.md`（§8 + 遵守清单）
- 上一轮裁决：`.agents/tasks/design-review.{md,json}`（CHANGES_REQUESTED，HIGH×0 / MEDIUM×2 / NIT×4）
- 裁决：**APPROVED**（HIGH×0 / MEDIUM×0 / NIT×0）

本轮逐条核对上一轮两个 MEDIUM、四个 NIT 的落实情况，并核对本轮并入的【视觉升级要求】是否写进设计视觉章节（§30）、需求（需求 16 / 验收 19）、视觉 steering（§8），以及硬约束是否未被稀释。结论：**上一轮全部 6 条 finding 已修且落点一致、相互印证；视觉升级三处（design §30 / requirements 需求 16 / steering §8）齐备且口径一致；上行白名单、信封/首帧契约、零依赖零构建、端口 9527/9528、五个锁定色值等硬约束全部未被稀释。** 本轮未发现新的 HIGH/MEDIUM/NIT，判 APPROVED，可进入实现。

---

## 逐条 finding 状态

### 上一轮 MEDIUM-1 — 虫洞「建成」默认不交互可达性缺核算 —— 已解决 ✅

- **核算块已补（§20.2「建成可演示性核算」）**，与 §3.2 睡眠闭环核算同风格。核对其算式自洽：
  - 每公民一「天」自主行为上限 `ENERGY_MAX 48 / COST.autonomy 6 = 8` 次；5 公民 `≈40` 次/「天」。
  - 命中出力 `×BUILD_CHANCE 0.35 ≈14` 次/「天」；进度增量 `14×BUILD_DELTA_AUTONOMY(4)≈56`/「天」。
  - 到 100 约 `100/56≈1.8`「天」`×72s≈130s（~2.2 分钟）`，落在声明的 ≤2–3 分钟演示窗口内。算式与所引常量一致，结论可复核。
- **常量已调高**：`BUILD_DELTA_AUTONOMY` 2→4，§25 常量表与 §20.2 正文、§29 应对表三处一致标注 `=4` 并给出「2→4」的理由（原 =2 约需 4–6 分钟超窗）。`BUILD_DELTA_RESOLUTION=8` 保留。
- **集成断言已补（§20.8 末条）**：「用 `CYBERTRON_TICK_MS` 调小、不发任何提问（纯自主），驱动足量 tick（上限 `≥3×TICKS_PER_DAY` 留余量）后断言至少一次 `project_update{status:'completed'}` 且随后收到 `project_update{progress:0,status:'building'}` 重置帧、`round+1`」——正是上一轮要求的「默认路径有界时间内必现 completed 且随后 progress:0」护栏。
- **口径一致**：requirements 验收 13 为纯行为口径（「不做任何操作持续围观…达 100%→建成→自动重置→新一轮」，不写死常量/秒数），design §20.2 以核算 + §20.8 以可测护栏把它具体化为「有界时间必现」，二者不冲突（设计更具体、更严格）；§28 追溯表「✓ 剧本轨可演示」现由核算块 + 集成断言背书，不再是无根据打勾。采纳了上一轮的方案 A，未改需求数值。

### 上一轮 MEDIUM-2 — 家内景访客关系过期基准含糊 —— 已解决 ✅

- 过期基准已由「如 1 个 tick 周期」改为**前端墙钟常量**：`const VISIT_RELATION_TTL_MS = 6000;`，登记 `expireAt = Date.now() + VISIT_RELATION_TTL_MS`，内景 `requestAnimationFrame` 循环每帧比对 `Date.now() >= expireAt` 到点移除，**明确不依赖 `tick` 下行帧**（并给出理由：一期 §3.2 第 5 步 tick 帧可选、`main.js` 未注册 `ws.on('tick')`）。
- **三处一致**：§19.3（锁定取值 + 墙钟理由 + 6000≈2 拍）、§19.7 边界表（「墙钟到点：rAF 循环内 `Date.now() >= expireAt`，不依赖任何 `tick` 下行帧」）、§25 常量表（`VISIT_RELATION_TTL_MS=6000`，宿主 `home-interior.js`）全部对齐，二义消除。采纳上一轮推荐的墙钟方案。

### 上一轮 NIT-1 — 讨论完成触发建成的两帧次序未在该路径复述 —— 已解决 ✅

- §20.2 来源 2 已补「两帧次序一律一致（NIT-1 锁定）」：无论出力还是讨论完成触发，`completedNow===true` 一律走同一「先 `project_update{status:'completed'}` 后 `project_update{progress:0,status:'building'}`」两帧；并明确讨论路径下这两帧在 `resolution` 帧之后广播（先 `resolution`→建成帧→归零帧）。与 §20.3 锁定次序呼应。

### 上一轮 NIT-2 — 内景气泡/动作语料唯一宿主未锁 —— 已解决 ✅

- §19.4 锁定唯一宿主为 `home-interior.js` 内 `INTERIOR_SCRIPT` 常量（按 persona 分组、每人格 ≥4 条、动作集枚举 walk/type/water/drink/read/idle 同住该文件），明确「不另设独立 `interior-corpus.js` 模块」。§25 两行据此标注宿主为 `home-interior.js`。发散点收敛。

### 上一轮 NIT-3 — advanceProject 跨 100 溢出举例与增量来源对不上 —— 已解决 ✅

- §20.7 边界举例已改为与来源一致：出力溢出用 `progress=99 + BUILD_DELTA_AUTONOMY(4)=103`、讨论溢出另举 `progress=96 + BUILD_DELTA_RESOLUTION(8)=104`，并注明「单次出力增量恒为 +4、不会是 +8；+8 仅为讨论完成增量」。§20.8 单测例同步用 `+4`/`+8`。混淆消除。

### 上一轮 NIT-4 — 隔离到期恢复两帧次序未锁 —— 已解决 ✅

- §21.3 到期分支已锁定次序（与进入侧「先状态后叙事」对称）：**先广播 `agent_update{status:'active'}`（家先亮灯、内景小人先回走动态），再广播「{name} 结束隔离」安全叙事 `agent_event`（入 recentEvents）**。§21.7 集成断言按此顺序断言（先收 `agent_update{active}`、后收结束隔离叙事）。对称性补齐。

---

## 本轮新增【视觉升级要求】落实核对（无 finding）

要求：家为科技感未来建筑（金属舱体/穹顶/能量塔/天线桅杆/发光管线/机械支架/霓虹装甲，非普通小房子）、全景背景为星球表面（外星地表/陨石坑/远山脊或环形山/深色星空）、家内景呼应科技舱体内部；仍纯 Canvas/DOM/CSS 手绘、零外部依赖、五个锁定色值未改、亮灯/熄灯/隔离警戒色语义仍可辨识。核对结果：

1. **写进设计视觉章节**：design 新增完整 §30「视觉升级：赛博朋克科技建筑家 + 外星星球表面全景」——§30.2 科技居住舱（穹顶/舱体/能量塔/天线桅杆/发光管线/机械支架/霓虹装甲，`variant=hashId(id)%5` 五剪影，明确「非普通小房子」）、§30.3 星球表面三层背景（深空星空+星点+星云+远处行星 / 远山脊·环形山 / 外星地表+陨石坑+霓虹矿脉）、§30.4 科技舱体内景（舱壁网格+发光管线+观察舷窗+全息面板+金属台面家具，「非普通民居」）、§30.5 文件改动面、§30.6 约束自检。
2. **写进需求**：requirements 新增需求 16（16.1–16.7）与二期验收标准 19，覆盖科技建筑家 / 星球表面全景 / 科技舱体内景 / 三态语义可辨识 / 纯手绘零外部依赖 / 五色锁定 / 零新增上行下行帧。
3. **写进视觉 steering**：`视觉风格.md` 新增 §8（8.1 科技建筑家、8.2 星球表面全景、8.3 科技舱体内景、8.4 硬约束），`inclusion: always`；遵守清单新增科技建筑 / 星球背景 / 科技舱体内景 / 零外部依赖四条自检项。
4. **三态语义仍可辨识**：§30.2 / §8.1 / §21.5 一致——`active` 青紫/晶体青满辉光、`asleep` `--dim-sleep` 暗紫断电近熄、`isolated` `--alert-orange` 告警橙警戒（可慢闪），由后端 `status` 驱动、前端只渲染不自判。
5. **纯 Canvas/DOM/CSS 手绘 + 零外部依赖**：§30.1/§30.6/§8.4 反复锁定「几何图元 + 霓虹描边 + 内发光 + 内联 emoji/SVG，无任何外部图片/字体/库，离线可跑」；背景用固定种子 `rng` 保证一致不闪烁。
6. **五个锁定色值未改**：`#0A0714`/`#A24BFF`/`#38F2E6`/`#FF8A3D`/`#2A2140` 在 steering §1 与遵守清单原样保留，§30.1/§30.6/§8.4 均声明「不引入新锁定色、不新增散色例外（内景小人 5 色仍是唯一例外）」。
7. **纯表现层、零新增帧**：§30 开头「边界先行」与 §30.5 明确——只改 `town-map.js`/`home-interior.js`/`theme.css` 的「怎么画」，`world_state`/`agent_update`/`agent_event`/`project_update` 帧形状不变，家坐标与作息/隔离仍是后端单一事实源。

视觉升级三处落点齐备、口径一致，未发现遗漏或矛盾。

---

## 硬约束未被稀释核对（无 finding）

- **上行帧白名单仅 `hello`/`visitor_ask`/`ping`**：§4.2 标题「仅三种白名单」、§24.1「二期不新增不变更任何上行帧…仍严格仅三种」、§30.5「上行白名单仍仅 hello/visitor_ask/ping」。二期六块无一新增上行写帧——家内景是前端视图切换（§19.5）、工程进度只后端推进（§20）、隔离只后端触发/解除（§21）、互动只后端心跳驱动（§22）、两弹窗纯前端静态（§23）、视觉升级纯绘制（§30）。✅
- **信封与首帧契约不变**：§24.1 重申首帧必须 `hello`→`hello_ok`，`default` 未知帧 `BAD_PAYLOAD` 静默丢弃；§24.4 所有二期帧（含新增 `project_update`）严格遵守 `{type,data,ts}` 统一信封、复用 `frame()`。✅
- **不新增游客写帧**：唯一新增下行帧 `project_update`（§24.2），`agent_update` 仅枚举扩 `isolated`（无字段增删）、`agent_event` 仅可选增补字段（向后兼容）、`world_state` 快照加只读 `project` 字段——全为下行，无上行。✅
- **默认剧本轨可完整演示六块**：§28 追溯表逐块「✓ 剧本轨可演示」，且虫洞建成由 §20.2 核算 + §20.8 断言、隔离由 §21.2 确定 demo 钩子（tick 18 固定隔离 ECHO）兜底可见、互动由 §22.2 内置配对语料、内景由 §19.4 内置 `INTERIOR_SCRIPT`、弹窗由 §23.2 前端静态文案、视觉由 §30 纯手绘。二期验收 18 口径一致。✅
- **零依赖零构建**：§18 前言与 §30.6 重申前端纯原生 ESM 零构建、后端仅依赖 `ws`、全部新视觉元素零外部图片/字体/库、离线可跑。✅
- **端口 9527/9528**：§14 `PORT=9527`、§18 前言「端口沿用 9527（后端）/ 9528（前端）」。✅

---

## 已核实的假设（Verified Assumptions）

本轮直接读 design.md 全文（§0–§30）、requirements.md 全文、视觉风格.md 全文核对，沿用并复核上一轮已验证项（对现有源码的断言上一轮已逐条读源码核实，本轮未见回归）：

1. 上一轮两个 MEDIUM + 四个 NIT 的修复均落在 design 既有章节，且**彼此印证、未相互矛盾**：MEDIUM-1 的 `BUILD_DELTA_AUTONOMY=4` 在 §20.2 正文 / §25 常量表 / §29 应对表三处同值；MEDIUM-2 的 `VISIT_RELATION_TTL_MS=6000` 在 §19.3 / §19.7 / §25 三处同值；NIT-3 的 `+4`/`+8` 在 §20.7 边界与 §20.8 单测一致。
2. MEDIUM-1 核算算式与所引常量（`ENERGY_MAX=48`/`COST.autonomy=6`/`BUILD_CHANCE=0.35`/`BUILD_DELTA_AUTONOMY=4`/`TICKS_PER_DAY=24`/`TICK_MS=3000`）自洽，`~130s`≈2.2 分钟结论可复核，落在声明演示窗口内；§20.8 集成断言的 tick 上限 `≥3×TICKS_PER_DAY` 相对 1.8「天」期望留足余量（覆盖 demo 隔离 ECHO 导致出力略降的保守情形）。
3. 五个锁定色值 `#0A0714`/`#A24BFF`/`#38F2E6`/`#FF8A3D`/`#2A2140` 在 steering §1 与遵守清单原样保留，视觉升级未改任一色值、未新增锁定色、未新增散色例外（内景小人 5 色仍是唯一例外且三处登记一致）。
4. 视觉升级为纯前端表现层：design §30.5「后端/协议/需求语义零改动」、requirements 需求 16 头注「不新增/不变更任何上行或下行帧、不改后端、不改任何共享事实」、steering §8.4「零新增上行/下行帧」三处一致，家坐标与作息/隔离仍后端单一事实源。
5. 上行白名单仅三种、`project_update` 为唯一新增下行帧、`agent_update` 仅枚举扩 `isolated`、`agent_event` 仅可选字段增补——协议扰动最小、「人类只能围观」结构性护栏零稀释（§24）。
6. 沿用上一轮已读源码核实项（本轮未改动相关设计，判定继续成立）：`recoverDay` 需显式跳过 `isolated`（§21.6 修前/修后代码与源码一致）、`agent_update` 四字段 patch 且 `store` 按 `agentId` 覆盖保留 `name/persona/home`、`makeSnapshot` 直出 `status` 不枚举校验、现有 visit 回应脱节需锁 `toAgentId` 三者一致、`_pendingReplies` 可被 `_pendingInteraction` 收编、`sanitizeOutput` 先过滤后截断、`charter.js` 六类词表齐全、端口 9527/9528、零依赖零构建、三组纯函数可扩展、两弹窗纯前端不新增帧、`town-map.js` 现仅 toggle active/asleep。

## 未核实 / 判为不阻塞的假设（Unverified / Non-blocking Assumptions）

1. `node:test` + `ws` 集成测试在目标环境可运行、真模型接口为 OpenAI Chat Completions 风格——失败即降级剧本、demo 走剧本，不阻塞，保留为实现期验证项。
2. 虫洞/隔离/互动真模型轨提示词产出质量——真模型为可选增强、失败回退剧本机制已验证存在，非设计阶段可核实，不阻塞。
3. `figureStyle(id)` / 家 `variant=hashId(id)%5` 对 5 个固定 id 不保证两两异色异脸异剪影（PALETTE/FACES 各 5 + 位移哈希可能撞色/撞剪影）——属表现层、不影响共享事实，实现期可调（改哈希或按配置序定序分配），不阻塞；实现者宜留意需求 10.3 五人同框可辨识度。
4. MEDIUM-1 核算中「demo 隔离钩子固定在 tick 18 隔离 ECHO 的 8 拍内 ECHO 不出力」会使单「天」出力次数略低于 40 上限的理论值——核算已以「上限约 5×8=40」作保守基准、§20.8 断言又留 `≥3×TICKS_PER_DAY` 余量，故不影响「有界时间必现建成」的结论，不阻塞。

---

## 裁决依据

逐条核对：上一轮 MEDIUM-1 / MEDIUM-2 / NIT-1 / NIT-2 / NIT-3 / NIT-4 **全部已解决**（修复落点一致、相互印证、算式可复核）；本轮并入的视觉升级要求在 design §30 / requirements 需求 16·验收 19 / steering §8 三处**齐备且口径一致**；上行白名单、信封/首帧契约、不新增游客写帧、默认剧本轨六块可演示、零依赖零构建、端口 9527/9528、五个锁定色值等**硬约束全部未被稀释**。本轮未发现新的 HIGH/MEDIUM/NIT。

HIGH + MEDIUM 发现数 = 0 → **APPROVED**。设计可进入实现。
