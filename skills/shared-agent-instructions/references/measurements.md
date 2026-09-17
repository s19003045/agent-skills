# 實測紀錄

每一條都用 `codex debug prompt-input` 量：它印出模型將收到的完整輸入（JSON），不呼叫模型、不花額度。
在說明書裡放可辨識的標記字串，再看標記有沒有出現在輸出裡。

## 2026-09-17

環境：Ubuntu，codex-cli 0.141.0 與 0.154.0（當天 changelog 上的最新版）。兩個版本結果相同。

| 實驗 | 做法 | 結果 |
|---|---|---|
| 單一檔案的上限 | `AGENTS.md` 共 54,676 bytes，開頭放標記 A、結尾放標記 B，中間是 700 行 ASCII 填充 | A 在、B 不在。最後出現的是第 420 行的前半段——從第 420 行開頭（byte 32,724）往後 44 bytes 被切斷，正好是 32,768 bytes，切在句子中間，沒有任何警告 |
| 調高上限 | 同一個檔案，`codex -c project_doc_max_bytes=65536 debug prompt-input hi` | B 出現 |
| 子目錄共用額度 | 根目錄 `AGENTS.md` 18,490 bytes、`sub/AGENTS.md` 18,228 bytes（合計 36,718），在 `sub/` 裡執行 | 根目錄那份的開頭與結尾都在；`sub/` 那份開頭在、結尾不在 |
| 只有 CLAUDE.md | repo 裡只有 `CLAUDE.md`（含標記） | 標記不在 |
| 符號連結（Linux） | `CLAUDE.md` 含標記，`AGENTS.md -> CLAUDE.md` | 標記在 |
| Windows 式簽出 | 把上一個 repo commit 後 `git -c core.symlinks=false clone` | `AGENTS.md` 是 9 bytes 的文字檔，內容 `CLAUDE.md`；標記不在 |
| 真實專案 | 一個 20 KB 的 `AGENTS.md`（中文為主），用 `core.symlinks=false` 簽出 | 第一節與最後一節都在 |

Claude Code 這一側沒有用 `claude -p` 量（當時那台機器的 API 額度不足）。依據是官方文件：
「Claude Code reads CLAUDE.md, not AGENTS.md. If your repository already uses AGENTS.md for other coding agents,
create a CLAUDE.md that imports it」（<https://code.claude.com/docs/en/memory.md#agentsmd>），
以及開新 session 後用 `/context` 或 `/memory` 確認。

## 重量一次

```bash
mkdir /tmp/codex-limit && cd /tmp/codex-limit && git init -q
{ echo 'FIRST-MARK'; for i in $(seq 1 700); do printf 'filler %04d: padding line with no information at all.\n' "$i"; done; echo 'LAST-MARK'; } > AGENTS.md
codex debug prompt-input hi | grep -c FIRST-MARK   # 1
codex debug prompt-input hi | grep -c LAST-MARK    # 0 表示仍然會截斷
codex debug prompt-input hi | grep -o 'filler [0-9]*' | tail -1   # 最後讀到哪一行
```

或直接對目標 repo 跑 `node scripts/codex-sees.mjs <目錄>`。結果與上表不同時，更新這份紀錄與 `SKILL.md`。
