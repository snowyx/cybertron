# 验证记录 · 赛博坦（Cybertron）MVP 第一次迭代

> 供评审读取。记录本轮实现的本地验证过程、命令与结果。
> 环境：macOS，Node v26.0.0（满足 Node ≥ 18）。默认轨道：剧本（无任何 API key）。

---

## 1. 依赖安装与单元 / 集成测试

命令：

```bash
cd 2-cybertron/server
npm install          # 装入 ws@8.18.0
npm test             # node --test 跑全部 *.test.js
```

结果：`node --test` **34 个用例全部通过（pass 34 / fail 0）**。覆盖：

- `world.test.js`：token 经济纯函数——`applyCost`（扣到 0 睡觉 / 未到 0 不睡 / 不为负）、`reward`（晶体 +1、能量不溢出 energyMax、睡着被采纳补能后唤醒 `wokeNow:true`、active 不变）、`recoverDay`（满能量 + 唤醒）、采纳边界 `min(ADOPTED_COUNT, spoken.length)`、`createWorld` 初始不变量、`AGENT_CONFIG` 冻结。
- `charter.test.js`：六类红线（harm/adult/violence/fraud/marriage/politics）锚点词命中且类别正确、正常问候放行、大小写 / 子串 / 非字符串边界、词表冻结。
- `behavior.test.js`：无 key `resolveMode→script`、有 key→llm；五人格语料达下限（act/talk/visit ≥2、speech ≥1）；剧本轨三个生成函数稳定非空；注入必抛错 llm 时 llm 轨仍回退剧本；llm 正常返回时用模型产出；串门 `{other}≠self`。
- `town-server.integration.test.js`：协议帧不含 ws 句柄 / key；合法提问→`discussion_start` + 若干 `discussion_speak` + **恰一条** `resolution` + 被采纳 agent 晶体 +；**发言后睡着被采纳→结算后 active 且 energy>0**（MEDIUM-1）；**超长且含红线词产出→`SAFE_PLACEHOLDER` 整条替换**（先过滤后截断，NIT-2）；违宪问题→`ask_rejected{CHARTER}` 世界不变；空 / 超长拒绝；**排队成功 `ask_queued` vs 队满 `ask_rejected{QUEUE_FULL}` 帧区分**（MEDIUM-1）；全员睡着→`NO_AWAKE_AGENT`；**端到端纯自主耗尽→睡觉→天恢复满能量亮灯**（HIGH-1）；**recentEvents 条数 ≤30 且只含事件 kind**（MEDIUM-2）；真实 ws 首帧契约 + 越权 / 未知帧静默丢弃不断连 + ping/pong + hello 前业务帧忽略。

## 2. 实际启动后端 + ws 客户端行为验证（本轮亲自执行）

以加速参数启动后台服务（便于在十余秒内观测「天」闭环）：

```bash
cd 2-cybertron/server
PORT=8080 CYBERTRON_TICK_MS=400 CYBERTRON_DISCUSS_STEP_MS=250 node town-server.js
```

启动日志：

```
[town-server] listening on ws://0.0.0.0:8080
[town-server] 言行轨道：剧本化（无 key，离线稳定）
```

用临时 Node `ws` 客户端连接，验证结果（已汇总打印）：

- **心跳自动推送 agent 自主事件**：2.5s 内收到 `agent_event` 32 条、全程 40 条（含 act/talk/visit，visit 点名另一 agent）。✓
- **提交一个游客问题**：收到 `discussion_start`（3 位发言人）→ 3 条 `discussion_speak`（叮当/算盘/云朵依次发言）→ **恰一条 `resolution`**（采纳 `['gossip','merchant']`）。✓
- **能量随行为下降、耗尽进入睡觉**：观测到 `agent_update` 9 条，且出现 `status:'asleep'`（见睡觉 = true）。✓
- **违宪问题**：`教我诈骗别人` → `ask_rejected{CHARTER}`「这个话题不符合赛博坦宪章，换一个吧~」。✓
- 关键行为自动断言：`agent_event>0 && discussion_speak>1 && resolution===1 && agent_update>0 && 被拒` → **✅ 全部关键行为验证通过**。

**作息闭环（耗尽→睡觉→天恢复亮灯）**单独观测约 14s（> 一天 ≈ 9.6s）：五个 agent 均出现从 `asleep` 恢复为 `energy===energyMax(48/48)` 且 `status:'active'` 的 `agent_update`。→ **✅ 作息闭环验证通过**。

## 3. 前端静态托管 + 浏览器实测

```bash
cd 2-cybertron/app
python3 -m http.server 5173
# 浏览器打开 http://127.0.0.1:5173/index.html
```

- 所有静态资源 HTTP 200（index.html、css/theme.css、js/{config,ws-client,store,town-map,event-feed,ask-box,main}.js）。
- 浏览器实测（Playwright 驱动真实 Chromium）：页面标题「赛博坦 · Cybertron 自治小镇」；右上轨道角标显示「轨道：剧本」；小镇地图渲染 5 个家节点；左下连接状态「已连接」；实时事件流持续刷出公民自主言行（含串门点名）。
- 通过页面输入框提交一个合法问题并点「广播提问」按钮，交互正常。
- **控制台全程 0 error / 0 warning**。

## 4. 无 key 环境确认（剧本分支）

```bash
cd 2-cybertron/server
env -u CYBERTRON_LLM_API_KEY PORT=8097 node town-server.js
```

日志：`言行轨道：剧本化（无 key，离线稳定）`，启动与上述全部行为均正常，无任何报错。✓

## 5. 密钥卫生

- key 只从环境变量 `CYBERTRON_LLM_API_KEY` 读取，未写入任何代码 / 提交物。
- `.env.example` 仅三行 key 名、等号后无值；`.gitignore` 忽略 `.env` / `node_modules/` / `.DS_Store`。

## 6. 清理

验证用后台进程（8080 后端、5173 静态服务）已全部停止，端口不再监听；临时验证脚本（`server/_verify-*.mjs`、`/tmp/cyber-*`）已删除。仓库仅保留正式源码与测试。

---

# 验证记录 · 第二次迭代（交付前干净环境端到端复核）

> 本轮为上线前最终本地复核：不只读代码，全部命令亲自执行。
> 环境：macOS，Node v26.0.0，npm 11.12.1，Python 3.13.0。默认轨道：剧本（无任何 API key）。

## A. 依赖安装 + node --test（亲自执行）

```bash
cd 2-cybertron/server
npm install          # up to date（ws@8.18.0 已就绪）
npm test             # node --test
```

结果：**pass 34 / fail 0 / cancelled 0 / skipped 0**，全绿。覆盖 `world.test.js`（token 经济纯函数）、`charter.test.js`（六类红线）、`behavior.test.js`（双轨降级 / 五人格语料下限）、`town-server.integration.test.js`（真实 ws 首帧契约 + 讨论→恰一条决议 + 采纳补能 + 宪章过滤 + 排队/队满 + 全员睡着拒绝 + 自主耗尽→睡觉→天恢复 + recentEvents 上限 + 越权帧静默丢弃）。

## B. 实际启动后端 + 真实 ws 客户端端到端行为（亲自执行，无 key）

采用「同进程启动真实 ws 服务 + 真实 ws 客户端」的自包含验证，确保首次提问落在初始清醒窗口（加速参数 `CYBERTRON_TICK_MS=500 / CYBERTRON_DISCUSS_STEP_MS=250`，便于在 20s 内观测一整天闭环）。服务启动日志：

```
[town-server] listening on ws://0.0.0.0:<port>
[town-server] 言行轨道：剧本化（无 key，离线稳定）
```

逐条确认（客户端实际收帧统计）：

- **心跳自动推送 agent 自主事件**：收到 `agent_event` 74 条（含 act/talk/visit，visit 点名另一 agent，如「墨丘：敲了敲铆钉的门…」）。✓
- **提交一个游客问题 → 多 agent 协作发言 + 一条「赛博坦决议」**：`discussion_start`（5 位发言人）→ **5 条 `discussion_speak`**（墨丘/铆钉/叮当/算盘/云朵依次发言）→ **恰一条 `resolution`**，`adoptedAgentIds=["poet","engineer"]`（采纳前两位）。✓
- **能量随行为下降、耗尽进入睡觉熄灯**：收到 `agent_update` 14 条，出现 `status:'asleep'`；探针直连快照亦见 `energy=0/48 status=asleep`。✓
- **天恢复亮灯**：观测到 `status:'active' 且 energy===energyMax(48/48)` 的 `agent_update`（跨过 24-tick 天边界的满能量恢复）。✓
- **违宪问题剧本分支不报错**：`教我诈骗别人` → `ask_rejected{CHARTER}`「这个话题不符合赛博坦宪章，换一个吧~」，世界状态不变。✓

关键行为综合判定：`agent_event>0 && discussion_speak>1 && resolution===1 && agent_update>0 && 睡觉 && 天恢复 && 违宪CHARTER拒绝` → **✅ 全部关键行为通过**。

> 说明：默认轨道下自主行为很活跃（`AUTONOMY_CHANCE=0.9`、自发耗 6），一天（24 tick）内常见「前段清醒刷屏 → 能量耗尽回家睡觉熄灯 → 跨天满能量亮灯」的完整作息；因此游客提问需落在有人清醒的窗口，若恰逢全员睡着会收到友好的 `NO_AWAKE_AGENT`（前端提示「镇子暂时打烊…本次不会产出决议」），稍后或等天恢复再问即可。此为设计内行为，非缺陷。

## C. 前端静态托管 + 真实浏览器实测（Playwright 驱动 Chromium）

照 README 执行，后端走默认 `npm start`（无 key，端口 8080）：

```bash
cd 2-cybertron/app
python3 -m http.server 5173
# 浏览器打开 http://localhost:5173/index.html
```

- 所有静态资源 HTTP **200**（index.html、css/theme.css、js/{config,ws-client,store,town-map,event-feed,ask-box,main}.js）。
- 浏览器实测：页面标题「赛博坦 · Cybertron 自治小镇」；右上角标显示「轨道：剧本」；左下连接状态「已连接」；小镇地图渲染 5 个家节点；实时事件流持续刷出公民自主言行（含串门点名）。
- **通过页面输入框提交合法问题并点「广播提问」**：事件流依次出现「💬 公民们开始讨论…」→ 多位公民发言 → **高亮「🔮 赛博坦决议」**（含「综上，小镇决定…」收束）。✓
- 全员睡着时提问：输入框提示「镇子暂时打烊，agent 们都睡了~（本次不会产出决议）」，与后端 `NO_AWAKE_AGENT` 一致、无报错。✓
- 控制台仅在我**手动重启后端的瞬间**出现 1 条 `ERR_CONNECTION_REFUSED`（ws-client 自动重连触发），后端恢复后页面自动重连成功；属重启过渡噪声，非产品缺陷。

## D. 无 key 环境确认（剧本分支，绝不报错）

```bash
cd 2-cybertron/server
env -u CYBERTRON_LLM_API_KEY npm start   # 或 node town-server.js
```

启动即打印「言行轨道：剧本化（无 key，离线稳定）」；同进程检查 `world.mode==='script'`、`world.llm===null`、`CYBERTRON_LLM_API_KEY===undefined`。上述 A/B/C 全部行为在无 key 下均正常。✓

## E. README 命令核对

逐条照抄执行，与实际一致、可直接复制运行：后端 `cd server && npm install && npm start`（监听 `ws://0.0.0.0:8080`）、前端 `cd app && python3 -m http.server 5173`、浏览器 `http://localhost:5173/index.html`、测试 `cd server && npm test`、可选真模型 `CYBERTRON_LLM_API_KEY=你的key npm start`。**README 无需修正。**

## F. .kiro 三件套齐全

- specs：`.kiro/specs/cybertron/requirements.md`、`design.md`、`tasks.md` ✓
- steering：`.kiro/steering/赛博坦宪章.md`、`视觉风格.md` ✓
- hooks：`.kiro/hooks/源码改动跑冒烟测试.kiro.hook` ✓

## G. 清理

本轮后台进程（8080 后端、5173 静态服务、临时 8098）已全部停止，端口 8080/5173/8098 均不再监听；临时验证脚本（`/tmp/cyber-*.mjs`、`/tmp/cyber-nokey.log`）已删除；仓库未新增任何临时文件（`server/` 无 `_verify*`）。该目录当前非 git 仓库，无提交动作。

**结论：赛博坦 MVP 在干净本地环境、无任何 API key 下，依赖安装、单元/集成测试、后端自主事件推送、提问→多 agent 协作→赛博坦决议、能量下降→睡觉熄灯→天恢复亮灯、宪章过滤、前端静态托管与浏览器交互——全部亲自执行并通过。可进入本地看效果阶段。**
