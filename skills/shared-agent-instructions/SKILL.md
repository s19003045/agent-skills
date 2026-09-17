---
name: shared-agent-instructions
description: |
  讓同一份專案說明書同時被 Codex（讀 AGENTS.md）與 Claude Code（讀 CLAUDE.md）完整讀到。
  涵蓋三個文件沒寫、而且在開發者自己電腦上測不出來的陷阱：符號連結在 Windows 簽出後變成只有檔名的文字檔、
  Codex 只讀 AGENTS.md 前 32 KiB 且無聲截斷（子目錄的 AGENTS.md 共用同一個額度）、Codex 完全不讀 CLAUDE.md。
  附不需安裝 agent 的靜態檢查，以及用 codex debug prompt-input 看 Codex 實際收到什麼的實測腳本。

  只要遇到下列任何一種情況就該使用：新增、改寫或搬移 AGENTS.md 或 CLAUDE.md；想讓 Codex 和 Claude Code
  共用規則、考慮把 AGENTS.md 做成 CLAUDE.md 的 symlink（或反過來）；說明書越寫越長；在子目錄放 AGENTS.md；
  團隊有人用 Windows；抱怨「Codex 不照 AGENTS.md 後面的規則」「換電腦後 agent 好像沒讀到專案說明」
  「Codex 說沒有專案指示」；要把專案交接給用不同 agent 或不同作業系統的人。
---

# 一份說明書，兩個 agent 都讀得完

Codex 讀 `AGENTS.md`，Claude Code 讀 `CLAUDE.md`。想讓兩邊共用規則時，最直覺的兩種做法都有陷阱，
而且**在寫說明書的那台電腦上看起來完全正常**——問題只會出現在別人的電腦上，或是規則寫到很後面才出現。

以下每一條都實測過（版本與重現方法見 `references/measurements.md`）。

## 三個陷阱

### 1. 符號連結在 Windows 上會變成一行字

`ln -s CLAUDE.md AGENTS.md` 在 Linux／macOS 上兩邊都讀得到。但 **Windows 上的 git 預設 `core.symlinks=false`**，
簽出後 `AGENTS.md` 是一個 9 bytes 的文字檔，內容就是 `CLAUDE.md` 這幾個字。Codex 讀到的說明書只有這一個檔名。

建立連結的人永遠看不到這個問題。用 `git -c core.symlinks=false clone <repo>` 就能在任何系統上重現。

### 2. Codex 只讀前 32 KiB，超過的部分無聲消失

Codex 的 `project_doc_max_bytes` 預設 32768 bytes。超過時**在句子中間直接切斷，沒有任何警告**，
agent 也不知道自己少讀了什麼。

- 中文一個字 3 bytes，上限約一萬一千字。
- **這是合計的額度**：Codex 把 repo 根目錄一路到啟動目錄上的每一份 `AGENTS.md` 接起來，一起算。
  根目錄 18 KB 加 `apps/web/AGENTS.md` 18 KB，從 `apps/web` 啟動時，被切掉的是**子目錄那份的後半段**。
- 可以在 Codex 設定裡調高 `project_doc_max_bytes`，但那是**每一台電腦各自的設定**，
  團隊裡只要有一台沒改就讀不完。把說明書變短才可靠。

### 3. Codex 不讀 CLAUDE.md

只有 `CLAUDE.md`、沒有 `AGENTS.md` 的 repo，對 Codex 來說就是沒有說明書。反過來，Claude Code 也不讀 `AGENTS.md`
（官方文件明寫：<https://code.claude.com/docs/en/memory.md#agentsmd>）。

## 建議做法

1. **`AGENTS.md` 放正本**，一般檔案，不是連結。
2. **`CLAUDE.md` 只寫一行**：
   ```
   @AGENTS.md
   ```
   這是 Claude Code 文件建議的寫法：`@` 引用以「寫引用的那個檔案」為基準解析相對路徑，專案內的檔案不會跳出核准視窗。
3. **最重要的規則放最前面**。就算哪天超過上限，被切掉的也是比較不重要的細節。
4. **說明書只放規則與指路**，長的內容（操作步驟、背景、範例）放到其他文件，在說明書裡寫「做 X 之前先讀 `docs/x.md`」。
5. 子目錄真的需要自己的 `AGENTS.md` 時，把**根目錄那份加上最深那份**的大小一起算。
6. 在專案的測試或 CI 裡守住：不是符號連結、`CLAUDE.md` 只有那一行、大小在上限內。
   規則寫得再清楚，沒有東西擋，下一個人照樣會把連結加回來。

把既有的連結換成這個做法：

```bash
git rm AGENTS.md                 # 刪掉連結（若連結方向相反，改刪 CLAUDE.md）
git mv CLAUDE.md AGENTS.md        # 正本改名，保留歷史
printf '@AGENTS.md\n' > CLAUDE.md
git add CLAUDE.md
```

改名之後，把文件與程式註解裡「見 CLAUDE.md §x」這類指向，改成指向 `AGENTS.md`。

## 驗證

### 靜態檢查（不需要安裝任何 agent）

```bash
node scripts/check-instructions.mjs <repo 目錄>
```

會抓出：git 裡記錄成符號連結的說明書（即使工作目錄已經是文字檔）、內容只有一個檔名的說明書、
超過上限或接近上限（九成）的 `AGENTS.md`、子目錄合計超過上限、只有 `CLAUDE.md`、
`CLAUDE.md` 沒有引用 `AGENTS.md`（兩份遲早分歧）。有會讓 agent 讀不到的問題時結束碼為 1，可以直接放進 CI。

### 看 Codex 實際收到什麼

```bash
node scripts/codex-sees.mjs <目錄>        # 在該目錄啟動 Codex 時的情況
```

它執行 `codex debug prompt-input`，這個子指令會印出模型將收到的完整輸入，**不呼叫模型、不花額度**，
再檢查從 repo 根目錄到該目錄的每一份 `AGENTS.md`，開頭與最後一行是否都在裡面。
回報「完整」「被截斷（並指出消失的最後一行）」或「沒讀到」。找不到 codex 時結束碼為 2，不會假裝通過。

要驗證 Windows 同事的情況：先 `git -c core.symlinks=false clone` 一份，再對那份跑這兩支。

### Claude Code 這一側

在專案裡開一個新的 session，執行 `/context` 或 `/memory`，確認 `AGENTS.md` 出現在已載入的檔案裡。

### 這兩支腳本本身

`scripts/instructions.test.mjs` 用真的 git repo 重現每一種壞法（符號連結、Windows 式簽出、超過上限、
子目錄合計超過、只有 `CLAUDE.md`），`codex-sees.mjs` 接一個照實測行為截斷的假 codex：

```bash
node --test scripts/instructions.test.mjs
```

## 版本會變

32 KiB 與「合計」的行為是在特定 Codex 版本上量到的。Codex 更新後若懷疑行為變了，
**不要相信這份文件，跑 `scripts/codex-sees.mjs`**，並依 `references/measurements.md` 的方法重量一次、更新紀錄。
