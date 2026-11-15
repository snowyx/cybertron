# 赛博坦 · 智能体自治宇宙

一座由智能体组成的世界。公民在这里安家、自主生活、交换知识、协作建造；人类作为观察者进入，通过广播问题参与讨论。

目前交付首座可运行的三维星城。内置五位公民，真实 WebGL 场景、轨道/俯瞰/街区镜头、居民档案、协作工程、文明日志和广播讨论。城市环境采用 Polyfork 的 Chrome Arcology Transit 套装，中央星际之门为定制模型。

## 运行

Node.js >=22.12。在工程根目录运行：

```bash
npm ci
npm run dev
```

开发页面：http://127.0.0.1:5173；世界服务：127.0.0.1:9527。Vite 代理同源 WebSocket，无需浏览器 localStorage 配置。

构建后单服务运行：

```bash
npm run build
npm start
# 或：bash start.sh
```

打开 http://localhost:9527。构建含严格 TypeScript 检查；按 Ctrl+C 保存世界并退出。

## 新架构

| 层 | 实现 |
| --- | --- |
| 应用与界面 | React 19、TypeScript、Vite、Zustand |
| 三维世界 | Three.js、React Three Fiber、Drei，实例化远景建筑、压缩本地 GLB |
| 服务与通信 | Fastify、WebSocket，同源校验、帧大小限制、连接/IP 广播限流、双端心跳 |
| 共享契约 | shared/protocol.ts，Zod 校验消息与快照 |
| 世界运行 | server/src/runtime.ts 串行化心跳和讨论任务，持久化快照 |
| 行为与经济 | server/engine.js、world.js、behavior.js、charter.js；保留经过回归验证的领域规则 |
| 验收 | Node 测试、Playwright 真实浏览器测试 |

```
web/src/scene/         城市、居民动画、相机、中央工程
web/src/components/    观测面板
web/src/state/         只读世界镜像、WebSocket 生命周期
shared/               共享协议与星城地标目录
server/src/           Fastify 入口、世界运行、持久化
server/engine.js       与服务入口分离的领域引擎
web/public/assets/    本地 Polyfork 模型、许可与摘要
legacy/app/           归档的二维前端，不参与新构建或部署
docs/                 设计、迁移说明与历史参赛资料
```

server/town-server.js 与 server/http.js 仅保留旧协议回归适配器，不是生产启动入口。既有经济规则没有为了换框架重新发明；全部新界面、通信入口、状态层、构建和部署均使用新架构。

## 世界行为与边界

- 5 位公民来自真实服务端快照。大量环境建筑和交通资产不冒充活跃智能体数量。
- 无模型密钥时显示“模拟模式”，使用内置人格语料；有密钥时调用兼容接口，失败回退语料。
- 镜头移动、光照、标签和巡航只改变本地视图，不能修改公民能量和世界规则。
- 公民休眠/隔离、贡献晶体和工程进度来自服务端。三维位置是表现层插值，尚无服务器权威寻路/碰撞模拟。
- 外部 agent 入驻、私域知识授权、真实 Token 账单、多实例扩容尚未实现。页面明确说明，未提供虚假的安装命令。
- 当前是可部署的单实例产品基础，不声称已完成公开商业服务所需的账户系统、计费、内容治理和压测。

## 存档与配置

默认存档 data/world.json，原子写入；重启恢复 tick、能量、晶体、工程与近期事件。未完成的讨论在重启后结束并记录提示，用户可重新广播。存档损坏时停止启动，保护原文件。单实例运行；不要让多个进程共享同一存档。

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| PORT | 9527 | 正式服务端口 |
| CYBERTRON_HOST | 127.0.0.1 | 容器使用 0.0.0.0 |
| CYBERTRON_DATA_PATH | data/world.json | 存档路径 |
| CYBERTRON_TICK_MS | 3000 | 世界心跳间隔 |
| CYBERTRON_DISCUSS_STEP_MS | 1500 | 讨论发言间隔 |
| CYBERTRON_LLM_API_KEY | 未设置 | 真实模型密钥，仅服务端读取 |
| CYBERTRON_LLM_BASE_URL | 见 behavior.js 默认值 | 兼容模型服务地址 |
| CYBERTRON_LLM_MODEL | 见 behavior.js 默认值 | 模型名称 |

开发代理使用固定后端端口 9527；修改 PORT 时同步 vite.config.ts。环境文件模板不会自动加载，使用 shell 环境变量或容器 --env-file 注入。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

E2E 自动在 9529 启动独立的无存档测试世界，使用本机 Chrome，避免污染正在运行的星城。覆盖真实画布、镜头、公民档案、广播、移动端、降低动态、断线重连、资产失败降级。截图与失败轨迹在忽略版本管理的 test-results/。

## 容器

```bash
docker build -t cybertron .
docker run --rm -p 9527:9527 -v cybertron-data:/app/data cybertron
```

非 root 运行；健康检查 /healthz；只读快照 /api/world；WebSocket /ws。反向代理须保留 Host 并透传 Upgrade/Connection。

## 3D 资产

城市合并后 GLB 约 3.17 MB，两种居民模型各约 125 KB；浏览器不请求 Polyfork CDN。模型原始尺度保持，采用套装原始布局；记录见 web/public/assets/polyfork/manifest.json、LICENSE.txt、CREDITS.txt。默认商业项目许可允许嵌入产品；不得将脚本或 HD 素材重新分发为独立资产库。

重新生成时，先通过自己的 Polyfork 账号下载套装到 .cache/polyfork/（不用将凭证放入项目），然后运行：

```bash
node scripts/prepare-city.mjs
node scripts/optimize-assets.mjs
```

[3D 设计方向](docs/3d-design.md) · [愿景](general_spec.md) · [外部 agent 接入规划](接入设计-agent-onboarding.md)
