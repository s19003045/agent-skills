#!/usr/bin/env node
/**
 * 檢查一個 repo 的 agent 說明書：Codex 與 Claude Code 是不是都讀得到、讀得完。
 * 不需要安裝任何 agent，只看檔案與 git。
 *
 *   node check-instructions.mjs [repo 目錄]      預設為目前目錄
 *
 * 結束碼：0 沒有問題（可能有提醒）；1 有會讓 agent 讀不到或讀不完規則的問題。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Codex 讀 AGENTS.md 的預設上限（project_doc_max_bytes），從 repo 根目錄到啟動目錄的各份合計。 */
export const CODEX_LIMIT = 32 * 1024;

function git(cwd, ...args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

export function checkRepo(dir) {
  const start = path.resolve(dir);
  const root = git(start, 'rev-parse', '--show-toplevel')?.trim() || start;
  const problems = [];
  const notes = [];

  // git 記錄的檔案型態：120000 是符號連結。Windows 上簽出後工作目錄裡已經是一般檔案，
  // 只看工作目錄會漏掉，所以兩邊都看。
  const modes = new Map();
  for (const line of (git(root, 'ls-files', '-s') ?? '').split('\n')) {
    const m = /^(\d{6}) \S+ \d\t(.+)$/.exec(line);
    if (m && /(^|\/)(AGENTS|CLAUDE)\.md$/.test(m[2])) modes.set(m[2], m[1]);
  }
  // 還沒 commit 的也算：寫到一半的子目錄說明書正是最該先檢查的。
  const untracked = (git(root, 'ls-files', '--others', '--exclude-standard') ?? '')
    .split('\n')
    .filter((f) => /(^|\/)(AGENTS|CLAUDE)\.md$/.test(f));
  const instructionFiles = new Set(['AGENTS.md', 'CLAUDE.md', ...modes.keys(), ...untracked]);

  const agentsSizes = new Map();
  for (const rel of [...instructionFiles].sort()) {
    const full = path.join(root, rel);
    const inGitAsLink = modes.get(rel) === '120000';
    const onDisk = existsSync(full) || isLink(full);
    if (!onDisk && !inGitAsLink) continue;

    if (inGitAsLink || isLink(full)) {
      problems.push(
        `${rel} 是符號連結。Windows 上的 git 預設不建立符號連結，簽出後會變成內容只有目標檔名的文字檔，` +
          'agent 讀到的就只有那個檔名。改成一般檔案（見 SKILL.md 的建議做法）。',
      );
      continue;
    }
    const content = readFileSync(full, 'utf8');
    if (/^[\w./-]+\.md\s*$/.test(content)) {
      problems.push(
        `${rel} 的內容只有「${content.trim()}」，看起來是在不支援符號連結的環境被簽出的符號連結。agent 讀不到任何規則。`,
      );
      continue;
    }
    if (path.basename(rel) === 'AGENTS.md') agentsSizes.set(rel, Buffer.byteLength(content));
  }

  const hasAgents = agentsSizes.has('AGENTS.md');
  const claudePath = path.join(root, 'CLAUDE.md');
  const hasClaude = existsSync(claudePath) && !isLink(claudePath) && modes.get('CLAUDE.md') !== '120000';

  if (!hasAgents && hasClaude && !problems.some((p) => p.startsWith('AGENTS.md'))) {
    problems.push('只有 CLAUDE.md，沒有 AGENTS.md：Codex 不讀 CLAUDE.md，等於沒有說明書。');
  }
  const noClaudeAtAll = !existsSync(claudePath) && !isLink(claudePath) && !modes.has('CLAUDE.md');
  if (hasAgents && noClaudeAtAll) {
    notes.push('沒有 CLAUDE.md：Claude Code 不讀 AGENTS.md。加一個內容只有一行 `@AGENTS.md` 的 CLAUDE.md。');
  }
  if (hasAgents && hasClaude && !/^@AGENTS\.md\s*$/m.test(readFileSync(claudePath, 'utf8'))) {
    notes.push('CLAUDE.md 沒有引用 @AGENTS.md：兩份說明書各寫各的，遲早會分歧。');
  }

  // 從根目錄到每一份 AGENTS.md 所在的目錄，Codex 把沿路的 AGENTS.md 接起來，共用同一個上限。
  for (const rel of [...agentsSizes.keys()].sort()) {
    const dirs = path.dirname(rel) === '.' ? [] : path.dirname(rel).split('/');
    let total = agentsSizes.get('AGENTS.md') ?? 0;
    for (let i = 1; i <= dirs.length; i++) {
      total += agentsSizes.get(`${dirs.slice(0, i).join('/')}/AGENTS.md`) ?? 0;
    }
    const where = rel === 'AGENTS.md' ? '在 repo 根目錄' : `在 ${path.dirname(rel)}/ 底下`;
    if (total > CODEX_LIMIT) {
      problems.push(
        `${where}啟動 Codex 時，AGENTS.md 合計 ${total} bytes，超過 ${CODEX_LIMIT}：後面的部分會在句子中間被切掉，沒有任何警告。` +
          '把細節移到其他文件，說明書只留規則與指路。',
      );
    } else if (total > CODEX_LIMIT * 0.9) {
      notes.push(`${where}啟動 Codex 時，AGENTS.md 合計 ${total} bytes，已超過上限的九成。`);
    }
  }

  return { root, problems, notes, agentsBytes: agentsSizes.get('AGENTS.md') ?? null };
}

function isLink(full) {
  try {
    return lstatSync(full).isSymbolicLink();
  } catch {
    return false;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { root, problems, notes, agentsBytes } = checkRepo(process.argv[2] ?? '.');
  console.log(`檢查 ${root}`);
  for (const p of problems) console.log(`✗ ${p}`);
  for (const n of notes) console.log(`! ${n}`);
  if (problems.length === 0) {
    console.log(
      agentsBytes === null
        ? '✓ 沒有發現會讓 agent 讀不到規則的問題（這個 repo 沒有 AGENTS.md）'
        : `✓ 沒有發現會讓 agent 讀不到規則的問題（AGENTS.md ${agentsBytes} / ${CODEX_LIMIT} bytes）`,
    );
  }
  process.exit(problems.length === 0 ? 0 : 1);
}
