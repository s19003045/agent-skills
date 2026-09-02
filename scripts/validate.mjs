#!/usr/bin/env node
/**
 * 結構驗證。CI 與本機跑同一支。
 *
 * 這支腳本存在的理由：skill 最大的風險不是寫得不好，而是悄悄腐化 ——
 * 內容過期、資產壞掉、description 打錯導致永遠不被觸發。
 * 這些都不會有人主動發現，只會在某天被用到時給出有自信的錯誤指引。
 * 所以每一項檢查都對應一種「不檢查就沒有人會發現」的失敗。
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SKILLS_DIR = path.join(ROOT, 'skills');

let failures = 0;
let checks = 0;

function check(label, fn) {
  checks++;
  try {
    const detail = fn();
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL ${label} — ${error.message}`);
  }
}

/** 極簡 YAML frontmatter 解析：只需要頂層的 name 與 description。 */
function parseFrontmatter(source, file) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) throw new Error(`${file} 沒有 YAML frontmatter`);

  const fields = {};
  let currentKey = null;
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1];
      fields[currentKey] = (kv[2] === '|' || kv[2] === '>') ? '' : kv[2].replace(/^["']|["']$/g, '');
    } else if (currentKey && line.trim()) {
      fields[currentKey] += (fields[currentKey] ? ' ' : '') + line.trim();
    }
  }
  return fields;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

console.log('\n--- Claude Code marketplace ---');

let marketplace;
check('marketplace.json 為合法 JSON', () => {
  marketplace = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  return `${marketplace.plugins.length} 個 plugin`;
});

check('marketplace 必要欄位齊全', () => {
  for (const field of ['name', 'description', 'owner', 'plugins']) {
    if (!marketplace[field]) throw new Error(`缺少 ${field}`);
  }
});

for (const entry of marketplace?.plugins ?? []) {
  check(`${entry.name}：source 指向存在的目錄`, () => {
    if (!entry.source?.startsWith('./')) throw new Error('source 應為相對路徑');
    if (!existsSync(path.join(ROOT, entry.source))) throw new Error(`找不到 ${entry.source}`);
    return entry.source;
  });

  check(`${entry.name}：plugin.json 存在且名稱一致`, () => {
    const file = path.join(ROOT, entry.source, '.claude-plugin', 'plugin.json');
    if (!existsSync(file)) throw new Error('缺少 .claude-plugin/plugin.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    // 不一致的話裝得起來但叫不出來，而且完全不報錯
    if (manifest.name !== entry.name) {
      throw new Error(`plugin.json 是「${manifest.name}」，marketplace 是「${entry.name}」`);
    }
  });
}

console.log('\n--- skill 內容 ---');

const skills = existsSync(SKILLS_DIR)
  ? readdirSync(SKILLS_DIR)
      .filter((name) => statSync(path.join(SKILLS_DIR, name)).isDirectory())
      .map((name) => ({ name, dir: path.join(SKILLS_DIR, name) }))
  : [];

check('skills/ 至少有一個 skill', () => {
  if (skills.length === 0) throw new Error('沒有找到任何 skill');
  return `${skills.length} 個`;
});

for (const skill of skills) {
  const skillMd = path.join(skill.dir, 'SKILL.md');
  let fields;

  check(`${skill.name}：SKILL.md 有合法 frontmatter`, () => {
    if (!existsSync(skillMd)) throw new Error('找不到 SKILL.md');
    fields = parseFrontmatter(readFileSync(skillMd, 'utf8'), 'SKILL.md');
    if (!fields.name) throw new Error('缺少 name');
    if (!fields.description) throw new Error('缺少 description');
  });

  check(`${skill.name}：name 與目錄名一致`, () => {
    if (fields?.name !== skill.name) {
      throw new Error(`frontmatter 是「${fields?.name}」，目錄是「${skill.name}」`);
    }
  });

  check(`${skill.name}：description 足以判斷觸發時機`, () => {
    // description 是唯一決定「會不會被想起來」的東西。寫得太短等於裝了也用不到，
    // 而這種失敗完全靜默 —— 不會有任何錯誤訊息告訴你
    const length = fields?.description?.length ?? 0;
    if (length < 120) throw new Error(`只有 ${length} 字元，建議 120 以上並寫明觸發情境`);
    return `${length} 字元`;
  });

  check(`${skill.name}：SKILL.md 篇幅合理`, () => {
    const lines = readFileSync(skillMd, 'utf8').split('\n').length;
    if (lines > 500) throw new Error(`${lines} 行，建議拆到 references/`);
    return `${lines} 行`;
  });

  check(`${skill.name}：內文引用的檔案都存在`, () => {
    const source = readFileSync(skillMd, 'utf8');
    const refs = [...source.matchAll(/`((?:references|assets|scripts|evals)\/[\w./-]+)`/g)].map((m) => m[1]);
    const missing = [...new Set(refs)].filter((rel) => !existsSync(path.join(skill.dir, rel)));
    if (missing.length) throw new Error(`找不到：${missing.join('、')}`);
    return `${new Set(refs).size} 個引用`;
  });

  check(`${skill.name}：沒有夾帶憑證或個資`, () => {
    // 整包要公開分享出去，這是最後一道防線
    const patterns = [
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /AKfycb[\w-]{20,}/,                                        // Apps Script 部署 ID
      /\d{6,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com/,      // OAuth 用戶端 ID
      /"private_key"\s*:/,
      /gh[pousr]_[A-Za-z0-9]{16,}/                               // GitHub token
    ];
    const offenders = walk(skill.dir)
      .filter((f) => /\.(js|mjs|json|md|html|css|ya?ml|txt)$/.test(f))
      .filter((f) => patterns.some((p) => p.test(readFileSync(f, 'utf8'))))
      .map((f) => path.relative(ROOT, f));
    if (offenders.length) throw new Error(`可疑內容：${offenders.join('、')}`);
  });

  check(`${skill.name}：Codex 相容（同格式，無 Claude 專屬語法）`, () => {
    // Claude 與 Codex 的 SKILL.md 格式相同，但若在內文寫死 ~/.claude/skills
    // 這類路徑，複製到 Codex 就會給出錯誤指引
    const source = readFileSync(skillMd, 'utf8');
    const claudeOnly = ['~/.claude/skills', '.claude/skills', 'claude plugin ', '/plugin install'];
    const found = claudeOnly.filter((token) => source.includes(token));
    if (found.length) throw new Error(`內文寫死 Claude 專屬路徑：${found.join('、')}`);
  });
}

console.log(`\n${failures === 0 ? '=== 全部通過 ===' : '=== 有項目未通過 ==='}  ${checks - failures}/${checks}\n`);
process.exit(failures === 0 ? 0 : 1);
