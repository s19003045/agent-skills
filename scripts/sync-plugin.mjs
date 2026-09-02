#!/usr/bin/env node
/**
 * 把 skills/ 的內容同步到各 plugin 的 skills 目錄。
 *
 * 為什麼需要兩份：
 *   skills/                    ← 正本。Codex 直接讀這裡，Claude 手動安裝也複製這裡
 *   plugins/<name>/skills/     ← Claude Code 的 marketplace 要求的目錄結構
 *
 * 用 symlink 可以省掉這份重複，但 marketplace 安裝時若在不支援 symlink 的環境
 * （Windows、某些 CI）就會靜默失敗 —— 那是「沒有人裝得起來」等級的失敗，
 * 不值得為了省 100KB 去冒險。改用同步腳本 + CI 檢查，drift 不可能發生。
 *
 * 用法：node scripts/sync-plugin.mjs [--check]
 *   --check 只比對不寫入，供 CI 使用
 */

import { readFileSync, readdirSync, statSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SOURCE = path.join(ROOT, 'skills');
const checkOnly = process.argv.includes('--check');

const marketplace = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

let drift = 0;

for (const entry of marketplace.plugins) {
  const target = path.join(ROOT, entry.source, 'skills');

  if (checkOnly) {
    const sourceFiles = listFiles(SOURCE);
    const targetFiles = existsSync(target) ? listFiles(target) : [];

    const missing = sourceFiles.filter((f) => !targetFiles.includes(f));
    const extra = targetFiles.filter((f) => !sourceFiles.includes(f));
    const differing = sourceFiles
      .filter((f) => targetFiles.includes(f))
      .filter((f) => readFileSync(path.join(SOURCE, f)).compare(readFileSync(path.join(target, f))) !== 0);

    if (missing.length || extra.length || differing.length) {
      drift++;
      console.error(`✗ ${entry.name} 與 skills/ 不同步`);
      for (const f of missing) console.error(`    缺少：${f}`);
      for (const f of extra) console.error(`    多餘：${f}`);
      for (const f of differing) console.error(`    內容不同：${f}`);
    } else {
      console.log(`✓ ${entry.name} 與 skills/ 一致（${sourceFiles.length} 個檔案）`);
    }
    continue;
  }

  rmSync(target, { recursive: true, force: true });
  for (const rel of listFiles(SOURCE)) {
    const dest = path.join(target, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(SOURCE, rel), dest);
  }
  console.log(`✓ 已同步 ${entry.name}（${listFiles(SOURCE).length} 個檔案）`);
}

if (checkOnly && drift > 0) {
  console.error('\n請執行 `npm run sync` 後重新提交。\n');
  process.exit(1);
}
