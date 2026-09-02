#!/usr/bin/env node
/**
 * 跑每個 skill 自帶的冒煙測試。
 *
 * 這是這個 repo 唯一能擋住「skill 腐化」的機制。結構驗證只能證明檔案還在，
 * 證明不了裡面的程式碼還能跑。做法是照 SKILL.md 教的步驟把骨架實際組起來
 * 再跑測試 —— 也就是把「使用者會做的事」自動化。
 *
 * 慣例：skill 若有 assets/test-harness/smoke.test.js，就把 assets/gas-core
 * 組成 gas/、test-harness 組成 tests/helpers/，然後跑 vitest。
 */

import { readdirSync, existsSync, mkdirSync, cpSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SKILLS_DIR = path.join(ROOT, 'skills');

let ran = 0;
let failed = 0;

for (const name of readdirSync(SKILLS_DIR)) {
  const skillDir = path.join(SKILLS_DIR, name);
  if (!statSync(skillDir).isDirectory()) continue;

  const smokeTest = path.join(skillDir, 'assets', 'test-harness', 'smoke.test.js');
  const core = path.join(skillDir, 'assets', 'gas-core');
  if (!existsSync(smokeTest) || !existsSync(core)) {
    console.log(`- ${name}：沒有冒煙測試，略過`);
    continue;
  }

  const work = path.join(tmpdir(), `skill-smoke-${name}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(path.join(work, 'tests', 'helpers'), { recursive: true });

  // 完全照 SKILL.md 說的步驟組裝
  cpSync(core, path.join(work, 'gas'), { recursive: true });
  cpSync(path.join(skillDir, 'assets', 'test-harness'), path.join(work, 'tests', 'helpers'), { recursive: true });
  cpSync(smokeTest, path.join(work, 'tests', 'smoke.test.js'));
  rmSync(path.join(work, 'tests', 'helpers', 'smoke.test.js'), { force: true });

  execFileSync('node', ['-e', `require('fs').writeFileSync(
    ${JSON.stringify(path.join(work, 'package.json'))},
    JSON.stringify({ name: 'smoke', private: true, type: 'module' }, null, 2))`]);

  console.log(`\n=== ${name} ===`);
  ran++;
  try {
    execFileSync('npx', ['vitest', 'run', '--root', work], {
      cwd: ROOT,
      stdio: 'inherit'
    });
  } catch {
    failed++;
    console.error(`FAIL ${name} 的冒煙測試未通過`);
  }
}

console.log(`\n跑了 ${ran} 個 skill 的冒煙測試，${failed} 個失敗\n`);
process.exit(failed === 0 ? 0 : 1);
