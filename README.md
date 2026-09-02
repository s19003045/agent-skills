# agent-skills

可同時用於 **Claude Code** 與 **Codex** 的 skill 集合。

兩邊的 skill 格式相同（`SKILL.md` + YAML frontmatter + `references/` `assets/` `scripts/`），
所以同一份內容不必寫兩次，只有安裝方式不同。

## 收錄的 skill

| Skill | 做什麼 | 來源 |
|---|---|---|
| [`gas-sheets-app`](skills/gas-sheets-app) | 用 Google 試算表當資料庫、Google 帳號登入、不架後端做出有權限控管的網頁應用。含可直接跑的骨架、本機測試工具、部署流程 | 一個實際開發並部署完成的課程管理系統 |

---

## 安裝

### Claude Code

```bash
/plugin marketplace add s19003045/agent-skills
```

```bash
/plugin install gary-toolkit@gary-skills
```

### Codex

複製到 `$CODEX_HOME/skills/`（預設是 `~/.codex/skills/`）：

```bash
git clone https://github.com/s19003045/agent-skills.git /tmp/agent-skills
cp -r /tmp/agent-skills/skills/gas-sheets-app ~/.codex/skills/
```

也可以請 Codex 用內建的 `skill-installer` 從這個 repo 的 `skills` 路徑安裝。

需確認 `~/.codex/config.toml` 有啟用：

```toml
[features]
skills = true
```

### 手動安裝（任何支援 SKILL.md 的工具）

直接把 `skills/<name>/` 整個目錄複製到該工具的 skill 目錄即可。
skill 內容不含任何工具專屬的路徑或指令。

---

## 這個 repo 的品質標準

skill 最大的風險不是寫得不好，而是**悄悄腐化** —— 內容過期、資產壞掉、
description 打錯導致永遠不被觸發。這些都不會有人主動發現，
只會在某天被用到時給出很有自信的錯誤指引。

所以每份 skill 都要滿足：

**1. 內容必須是查不到的東西。** 判準是「這個知識是不是文件裡沒有、或查到的是錯的」。
模型本來就會的事情（怎麼寫 React component）不該放進來 —— 那只會佔用 context 又沒有增益。

**2. 附可執行的驗證。** 光有文字沒有用。`gas-sheets-app` 附了 `smoke.test.js`，
CI 會照 `SKILL.md` 教的步驟把骨架實際組起來跑一遍。
撰寫時就是靠這個驗證當場抓到兩個 bug。

**3. description 要寫明觸發情境。** 它是唯一決定「會不會在對的時機被想起來」的欄位。
內容再好，不觸發就等於不存在。CI 會擋掉太短的 description。

**4. 不夾帶憑證或個資。** CI 會掃私鑰、OAuth 用戶端 ID、Apps Script 部署 ID、GitHub token。

---

## 開發

```bash
npm install
npm run check
```

`check` 會依序跑三件事：

| 指令 | 檢查什麼 |
|---|---|
| `npm run validate` | frontmatter、name 與目錄一致、description 長度、內文引用的檔案存在、無憑證外洩、無 Claude 專屬路徑 |
| `npm run sync:check` | `plugins/` 底下的副本與 `skills/` 一致 |
| `npm test` | 照 SKILL.md 的步驟組裝骨架並實際跑測試 |

### 目錄結構

```
skills/<name>/            ← 正本。Codex 直接用，手動安裝也用這裡
  SKILL.md                  內容主體（500 行以內，其餘放 references/）
  references/               按需讀取的細節文件
  assets/                   可複製使用的程式碼
  scripts/                  可執行的工具
  evals/                    觸發測試用的提問範例

.claude-plugin/           ← Claude Code marketplace 目錄（必須在 repo 根目錄）
plugins/<plugin>/skills/  ← 由 skills/ 同步而來，勿手動編輯
```

`plugins/` 底下是重複的一份，因為 Claude Code 的 marketplace 要求那個目錄結構。
本來可以用 symlink 省掉，但 marketplace 安裝時若遇到不支援 symlink 的環境會**靜默失敗** ——
那是「沒有人裝得起來」等級的問題，不值得為了省 100KB 冒險。
改用同步腳本 + CI 檢查，讓 drift 不可能發生。

### 新增一個 skill

```bash
mkdir -p skills/<name>
# 寫 SKILL.md，把細節放 references/
npm run sync      # 同步到 plugins/
npm run check     # 全部通過才提交
```

新 skill 也要加進 `.claude-plugin/marketplace.json` 對應 plugin 的說明，
並更新本檔案上方的表格。

---

## 授權

MIT
