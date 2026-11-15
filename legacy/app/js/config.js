// 前端运行时配置（design §10 / §13）。
// WS_URL 单一事实源，优先级：localStorage 覆盖 > localhost 默认 > 线上占位。
//   - 本地开发：默认连本机星城服务 ws://localhost:9527
//   - 线上部署：把占位改成实际地址，或在控制台执行
//     localStorage.setItem('WS_URL','wss://your-host') 临时覆盖。
const isLocalHost =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

export const CONFIG = {
  WS_URL:
    (typeof localStorage !== 'undefined' && localStorage.getItem('WS_URL')) ||
    (isLocalHost ? 'ws://localhost:9527' : 'wss://REPLACE_WITH_CYBERTRON_HOST'),
};
