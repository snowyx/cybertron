// 零依赖静态文件服务：托管 ../app 下的前端（纯静态 H5）。
// 存在的意义：评委机器不一定有 python3，但一定有 Node（后端就是 Node），
// 用它起前端可让「一键启动」不依赖 Node 之外的任何东西。
//
// 用法：node static-server.js [port]  默认端口 5173，根目录固定为 ../app。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'app'); // 前端根目录
const PORT = Number(process.argv[2]) || Number(process.env.CYBERTRON_WEB_PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    // 去掉查询串，默认文档 index.html
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
    // 防目录穿越：规范化后必须仍在 ROOT 内
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`[static-server] 前端已托管： http://localhost:${PORT}/`);
});
