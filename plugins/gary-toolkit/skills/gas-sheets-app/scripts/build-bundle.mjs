/**
 * 把 gas/ 底下的所有檔案合併成單一 dist/Code.gs。
 *
 * 為什麼可以直接串接：Apps Script 本來就是把專案內所有 .gs 檔載入同一個全域作用域，
 * 而本專案的頂層宣告一律使用 var 與 function（不用 const/let/class），
 * 因此依檔名順序串接後的行為與分檔完全相同。
 *
 * 用途：讓不熟悉 clasp 的使用者只需在 Apps Script 編輯器貼上一個檔案即可完成部署。
 *
 * 執行：npm run build
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const GAS_DIR = path.join(ROOT, 'gas');
const OUT_DIR = path.join(ROOT, 'dist');

const files = readdirSync(GAS_DIR).filter((f) => f.endsWith('.js')).sort();

const header = `/**
 * CourseSheet Hub — 後端完整程式碼（自動產生，請勿直接修改）
 *
 * 這個檔案由 gas/ 目錄下的 ${files.length} 個原始檔合併而成：
${files.map((f) => ` *   - ${f}`).join('\n')}
 *
 * 要修改功能請改 gas/ 底下的原始檔，再執行 npm run build 重新產生。
 *
 * 使用方式：全選複製本檔案內容，貼進 Apps Script 編輯器的 Code.gs（或「程式碼.gs」）。
 */

`;

const body = files
  .map((file) => {
    const source = readFileSync(path.join(GAS_DIR, file), 'utf8').trimEnd();
    const banner = `/* ${'='.repeat(72)}\n   ${file}\n   ${'='.repeat(72)} */`;
    return `${banner}\n\n${source}\n`;
  })
  .join('\n');

mkdirSync(OUT_DIR, { recursive: true });

const bundlePath = path.join(OUT_DIR, 'Code.gs');
writeFileSync(bundlePath, header + body);

// appsscript.json 也一併複製到 dist，方便一次取用
const manifest = readFileSync(path.join(GAS_DIR, 'appsscript.json'), 'utf8');
writeFileSync(path.join(OUT_DIR, 'appsscript.json'), manifest);

const lines = (header + body).split('\n').length;
console.log(`已產生 dist/Code.gs（${files.length} 個原始檔，共 ${lines} 行）`);
console.log('已複製 dist/appsscript.json');
