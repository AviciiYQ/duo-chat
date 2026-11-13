// 本地静态服务器 · 只为解决 file:// 的跨域问题
// 用法：node server.mjs [端口]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.AC_PORT || 7801);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400); res.end('bad url'); return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  // 只允许读本目录，防目录穿越
  const target = path.join(__dirname, path.normalize(urlPath).replace(/^([/\\])+/, ''));
  if (!target.startsWith(__dirname)) {
    res.writeHead(403); res.end('forbidden'); return;
  }

  fs.readFile(target, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`群聊 AI 已启动： http://127.0.0.1:${PORT}`);
  console.log('目录：' + __dirname);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`端口 ${PORT} 被占用，换一个：node server.mjs 7802`);
  else console.error(e);
  process.exit(1);
});
