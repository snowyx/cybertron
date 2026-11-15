// 赛博坦 · HTTP 层：同一端口托管前端静态资源 + /healthz 健康检查。
// 生产形态：单进程单端口（HTTP + WebSocket 升级），部署只需要暴露一个端口。
//
// 设计要点：
//   - 零依赖静态托管：HTML 不缓存（保证发版即生效），静态资源短缓存。
//   - 防目录穿越：normalize 后必须仍在 ROOT 内。
//   - /healthz：进程存活 + 言行轨道 + 公民规模，供容器 / 负载均衡探活。

import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = join(__dirname, '..', 'legacy', 'app'); // 旧二维版本的回归适配器

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function noCacheHeaders() {
  return { 'Cache-Control': 'no-cache, must-revalidate' };
}

function assetHeaders() {
  return { 'Cache-Control': 'public, max-age=300' };
}

/**
 * 创建 HTTP 请求处理器：/healthz + 静态资源。
 * @param {object} [opts]
 * @param {() => object} [opts.snapshot] 健康检查附加信息（如 world 概览）
 */
export function createRequestHandler(opts = {}) {
  const extra = typeof opts.snapshot === 'function' ? opts.snapshot : () => ({});

  return async function handle(req, res) {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

    if (urlPath === '/healthz') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        ...noCacheHeaders(),
      });
      res.end(JSON.stringify({ ok: true, uptime: process.uptime(), ...extra() }));
      return;
    }

    try {
      let filePath = normalize(join(WEB_ROOT, urlPath === '/' ? 'index.html' : urlPath));
      if (!filePath.startsWith(WEB_ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      // 目录/不存在 → 回退 SPA 首页
      let st = null;
      try {
        st = await stat(filePath);
      } catch {
        st = null;
      }
      if (!st) filePath = join(WEB_ROOT, 'index.html');
      else if (st.isDirectory()) filePath = join(filePath, 'index.html');

      const body = await readFile(filePath);
      const ext = extname(filePath);
      const headers = ext === '.html' ? noCacheHeaders() : assetHeaders();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...headers });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    }
  };
}
