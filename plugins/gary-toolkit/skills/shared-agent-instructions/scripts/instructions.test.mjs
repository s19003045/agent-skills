/**
 * check-instructions.mjs 與 codex-sees.mjs 的測試。每一種壞法都用真的 git repo 重現：
 * 符號連結、Windows 式簽出（core.symlinks=false）、超過上限、子目錄合計超過上限、只有 CLAUDE.md。
 *
 * codex-sees.mjs 在這裡接的是假的 codex（照實測到的行為：從 repo 根目錄到啟動目錄的 AGENTS.md
 * 接起來、在上限處切掉），真的 Codex 怎麼量見 references/measurements.md。
 *
 *   node --test scripts/instructions.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(HERE, 'check-instructions.mjs');
const SEES = path.join(HERE, 'codex-sees.mjs');
const work = mkdtempSync(path.join(tmpdir(), 'shared-agent-instructions-'));
after(() => rmSync(work, { recursive: true, force: true }));

let counter = 0;
function repo(files, { symlinks = {}, commit = true } = {}) {
  const dir = path.join(work, `repo-${++counter}`);
  mkdirSync(dir);
  git(dir, 'init', '-q');
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  for (const [link, target] of Object.entries(symlinks)) symlinkSync(target, path.join(dir, link));
  if (commit) {
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'x');
  }
  return dir;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function run(script, dir, env = {}) {
  const r = spawnSync(process.execPath, [script, dir], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: r.stdout };
}

const bytes = (n, label) => `${label}\n${'x'.repeat(n - label.length - 1)}`;
const GOOD_AGENTS = '# Rules\n\nAlways run the tests.\n';

describe('check-instructions.mjs', () => {
  it('AGENTS.md as the source and CLAUDE.md importing it passes', () => {
    const dir = repo({ 'AGENTS.md': GOOD_AGENTS, 'CLAUDE.md': '@AGENTS.md\n' });
    const r = run(CHECK, dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓/);
    assert.doesNotMatch(r.out, /[✗!] /);
  });

  it('a committed symlink fails, and so does its Windows-style checkout', () => {
    const linked = repo({ 'CLAUDE.md': GOOD_AGENTS }, { symlinks: { 'AGENTS.md': 'CLAUDE.md' } });
    const r = run(CHECK, linked);
    assert.equal(r.code, 1);
    assert.match(r.out, /AGENTS\.md 是符號連結/);

    // What a teammate on Windows actually gets: a 9-byte text file saying "CLAUDE.md".
    const windows = path.join(work, `windows-${++counter}`);
    execFileSync('git', ['-c', 'core.symlinks=false', 'clone', '-q', linked, windows]);
    const w = run(CHECK, windows);
    assert.equal(w.code, 1);
    assert.match(w.out, /符號連結/);
  });

  it('a text file that only names another file fails even when git no longer knows it was a link', () => {
    const dir = repo({ 'AGENTS.md': 'CLAUDE.md', 'CLAUDE.md': GOOD_AGENTS });
    const r = run(CHECK, dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /內容只有「CLAUDE\.md」/);
  });

  it('over the Codex limit fails; near it is a warning', () => {
    const over = repo({ 'AGENTS.md': bytes(32 * 1024 + 1, '# big'), 'CLAUDE.md': '@AGENTS.md\n' });
    const r = run(CHECK, over);
    assert.equal(r.code, 1);
    assert.match(r.out, /合計 32769 bytes，超過 32768/);

    const near = repo({ 'AGENTS.md': bytes(31 * 1024, '# near'), 'CLAUDE.md': '@AGENTS.md\n' });
    const n = run(CHECK, near);
    assert.equal(n.code, 0);
    assert.match(n.out, /已超過上限的九成/);
  });

  it('nested AGENTS.md files share the limit, including ones not committed yet', () => {
    const dir = repo(
      {
        'AGENTS.md': bytes(18 * 1024, '# root'),
        'CLAUDE.md': '@AGENTS.md\n',
        'apps/web/AGENTS.md': bytes(18 * 1024, '# web'),
      },
      { commit: false },
    );
    const r = run(CHECK, dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /在 apps\/web\/ 底下啟動 Codex 時/);
  });

  it('only CLAUDE.md fails for Codex; only AGENTS.md is a note for Claude Code', () => {
    const claudeOnly = run(CHECK, repo({ 'CLAUDE.md': GOOD_AGENTS }));
    assert.equal(claudeOnly.code, 1);
    assert.match(claudeOnly.out, /Codex 不讀 CLAUDE\.md/);

    const agentsOnly = run(CHECK, repo({ 'AGENTS.md': GOOD_AGENTS }));
    assert.equal(agentsOnly.code, 0);
    assert.match(agentsOnly.out, /Claude Code 不讀 AGENTS\.md/);
  });
});

describe('codex-sees.mjs', () => {
  // Behaves like codex debug prompt-input as measured: concatenates AGENTS.md from the git root
  // down to the working directory and cuts the result at FAKE_LIMIT bytes.
  const fake = path.join(work, 'fake-codex.mjs');
  writeFileSync(
    fake,
    `#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const dirs = [root];
for (const p of path.relative(root, process.cwd()).split(path.sep).filter(Boolean)) dirs.push(path.join(dirs.at(-1), p));
const joined = Buffer.concat(dirs.map((d) => path.join(d, 'AGENTS.md')).filter(existsSync).map((f) => readFileSync(f)));
const text = joined.subarray(0, Number(process.env.FAKE_LIMIT ?? 32768)).toString('utf8');
console.log(JSON.stringify([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<INSTRUCTIONS>' + text + '</INSTRUCTIONS>' }] }]));
`,
  );
  chmodSync(fake, 0o755);
  const sees = (dir, env = {}) => run(SEES, dir, { CODEX_BIN: fake, ...env });

  it('a file that fits is complete', () => {
    const r = sees(repo({ 'AGENTS.md': `${GOOD_AGENTS}Last rule: keep it short.\n` }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓ AGENTS\.md（\d+ bytes）完整/);
  });

  it('a file past the limit is reported as cut, naming the line that was lost', () => {
    const r = sees(repo({ 'AGENTS.md': `${bytes(33 * 1024, '# big')}\nLast rule: never skip the tests.\n` }));
    assert.equal(r.code, 1);
    assert.match(r.out, /被截斷：開頭有，最後一行「Last rule: never skip the tests\.」沒有/);
  });

  it('from a subdirectory, the deeper file is the one that gets cut', () => {
    const dir = repo({
      'AGENTS.md': `${bytes(18 * 1024, '# root')}\nroot end\n`,
      'apps/web/AGENTS.md': `# web rules\n${'y'.repeat(18 * 1024)}\nweb end\n`,
    });
    const r = sees(path.join(dir, 'apps/web'));
    assert.equal(r.code, 1);
    assert.match(r.out, /✓ AGENTS\.md/);
    assert.match(r.out, /✗ apps\/web\/AGENTS\.md（\d+ bytes）被截斷/);
  });

  it('a checked-out symlink is not "complete" just because Codex read its nine bytes', () => {
    const r = sees(repo({ 'AGENTS.md': 'CLAUDE.md', 'CLAUDE.md': GOOD_AGENTS }));
    assert.equal(r.code, 1);
    assert.match(r.out, /內容只有「CLAUDE\.md」/);
  });

  it('no codex is exit 2, not a pass', () => {
    const r = sees(repo({ 'AGENTS.md': GOOD_AGENTS }), { CODEX_BIN: path.join(work, 'no-such-codex') });
    assert.equal(r.code, 2);
  });
});
