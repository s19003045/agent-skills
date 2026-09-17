#!/usr/bin/env node
/**
 * 看 Codex 實際收到了哪些說明書內容，而不是猜。
 *
 *   node codex-sees.mjs [目錄]        在該目錄啟動時 Codex 會看到什麼；預設為目前目錄
 *   CODEX_BIN=/path/to/codex node codex-sees.mjs
 *
 * 跑的是 `codex debug prompt-input`：它印出模型會收到的完整輸入，**不呼叫模型、不花額度**。
 * 對從 repo 根目錄到該目錄的每一份 AGENTS.md，檢查開頭與結尾是否都在裡面。
 *
 * 結束碼：0 每一份都完整；1 有檔案沒讀到或被截斷；2 無法執行 codex。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '.');
const codex = process.env.CODEX_BIN ?? 'codex';

let root = dir;
try {
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim();
} catch {
  // 不是 git repo：只看這個目錄本身
}

const chain = [root];
for (const part of path.relative(root, dir).split(path.sep).filter(Boolean)) {
  chain.push(path.join(chain.at(-1), part));
}
const files = chain.map((d) => path.join(d, 'AGENTS.md')).filter((f) => existsSync(f));
if (files.length === 0) {
  console.log(`✗ 從 ${root} 到 ${dir} 沒有任何 AGENTS.md，Codex 沒有說明書可讀`);
  process.exit(1);
}

let raw;
try {
  raw = execFileSync(codex, ['debug', 'prompt-input', 'hi'], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  console.log(`✗ 無法執行「${codex} debug prompt-input」：${err.message.split('\n')[0]}`);
  console.log('  需要已安裝的 Codex CLI；舊版可能沒有這個子指令。');
  process.exit(2);
}

// 輸出是 JSON；把所有字串接起來再找，避免跳脫字元的問題。
const seen = [];
(function collect(value) {
  if (typeof value === 'string') seen.push(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
})(JSON.parse(raw));
const text = seen.join('\n');

let bad = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim())
    .filter(Boolean);
  const rel = path.relative(root, file) || 'AGENTS.md';
  const size = Buffer.byteLength(readFileSync(file));
  if (lines.length === 0) {
    console.log(`! ${rel} 是空的`);
    continue;
  }
  if (lines.length === 1 && /^[\w./-]+\.md$/.test(lines[0])) {
    bad++;
    console.log(`✗ ${rel} 的內容只有「${lines[0]}」：符號連結被簽出成文字檔，Codex 讀到的只有這個檔名`);
    continue;
  }
  const head = text.includes(lines[0]);
  const tail = text.includes(lines.at(-1));
  if (head && tail) console.log(`✓ ${rel}（${size} bytes）完整`);
  else if (head) {
    bad++;
    console.log(`✗ ${rel}（${size} bytes）被截斷：開頭有，最後一行「${lines.at(-1).slice(0, 40)}」沒有`);
  } else {
    bad++;
    console.log(`✗ ${rel}（${size} bytes）沒讀到`);
  }
}
process.exit(bad === 0 ? 0 : 1);
