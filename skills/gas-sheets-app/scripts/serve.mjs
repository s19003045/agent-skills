/**
 * 本機開發用的靜態伺服器。
 *
 * 為什麼不直接用 python3 -m http.server：
 * 它預設綁定 0.0.0.0 並印出 http://0.0.0.0:5173/，而終端機會把那串文字變成
 * 可點擊的連結。點下去之後 Google 登入必定失敗 —— 0.0.0.0 不是合法的主機名稱，
 * OAuth 一律拒絕，而且它也填不進「已授權的 JavaScript 來源」。
 * 加上 --bind localhost 也沒用，它印出來的仍是 127.0.0.1。
 *
 * 這支程式只綁定回送介面，並且明確印出應該使用的 localhost 網址。
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../web', import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  // 阻擋路徑穿越
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: pathname + '/' }).end();
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'
    }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
});

server.listen(PORT, HOST, () => {
  const bar = '─'.repeat(46);
  console.log(`
┌${bar}┐
   CourseSheet Hub 開發伺服器已啟動

   請開啟這個網址（不要用 0.0.0.0 或 127.0.0.1）：

       http://localhost:${PORT}

   離線 UI 預覽（不需部署 Apps Script）：
       http://localhost:${PORT}/dev-preview.html?role=INSTRUCTOR

   按 Ctrl+C 結束
└${bar}┘
`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n通訊埠 ${PORT} 已被占用。請先關閉另一個伺服器，或改用其他通訊埠：\n`);
    console.error(`    PORT=5174 npm run serve\n`);
    console.error('  （改了通訊埠也要回 Google Cloud 把新的網址加進「已授權的 JavaScript 來源」）\n');
    process.exit(1);
  }
  throw error;
});
