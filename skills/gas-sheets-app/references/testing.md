# 本機測試 Apps Script

Apps Script 的除錯體驗很差：沒有中斷點、看 log 要重新部署、每次執行 1～3 秒。
如果只靠「改完部署、部署完手動點」來驗證，開發速度會慢到難以接受。

這套方法讓你在**本機毫秒級**跑完整條請求路徑，不需要部署、不碰真實試算表、不消耗任何配額。

## 核心想法

用 Node 的 `vm.runInContext` 載入 `gas/` 底下**實際要部署的那份原始碼**，
把 Google 的服務換成記憶體假實作注入沙箱。

關鍵是「載入實際部署的原始碼」而不是為了測試另外抄一份邏輯 ——
抄一份的話，測試通過不代表部署的東西會動。

```javascript
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';

export function loadGas(globals = {}) {
  const sandbox = { console, ...globals };
  const context = vm.createContext(sandbox);
  for (const file of readdirSync(GAS_DIR).filter(f => f.endsWith('.js')).sort()) {
    vm.runInContext(readFileSync(path.join(GAS_DIR, file), 'utf8'), context, { filename: file });
  }
  return sandbox;   // 頂層 var / function 都掛在這上面
}
```

**這正是為什麼要求頂層一律用 `var` 和 `function`。** `const` / `let` / `class`
建立的是詞法繫結，不會成為 `globalThis` 的屬性，沙箱外就取不到，測試會拿到一堆 `undefined`。
這個慣例同時也是 Apps Script 跨檔案取用最穩定的寫法，兩件事剛好一致。

## 假的 Google 服務

`assets/test-harness/fakeGoogle.js` 提供記憶體版的
`SpreadsheetApp`、`DriveApp`、`CacheService`、`LockService`、`UrlFetchApp`、
`Utilities`、`PropertiesService`、`ContentService`、`Session`、`ScriptApp`。

幾個實作上必須忠實模擬的細節，否則測試會過但實際會壞：

- **`Utilities.base64Decode` 要回傳有號位元組**（-128 ~ 127），這樣才測得到 `& 0xFF` 的處理
- **試算表用二維陣列表示**，`getRange().setValues()` 要能自動延長列數
- **`LockService` 要真的會擋**，這樣才測得到取鎖失敗的路徑
- **`UrlFetchApp` 依 token 回傳對應的 email**，讓測試能模擬不同身分

## 時間要凍結

時間相關的邏輯（時間窗、逾期判斷）若依賴真實時間，測試會隨時間漂移。
把 `Date` 也注入沙箱：

```javascript
function frozenDate(fixedMs) {
  const RealDate = Date;
  function FrozenDate(...args) {
    return args.length === 0 ? new RealDate(fixedMs) : new RealDate(...args);
  }
  FrozenDate.now = () => fixedMs;
  FrozenDate.UTC = RealDate.UTC;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.prototype = RealDate.prototype;   // instanceof 才會成立
  return FrozenDate;
}

const gas = loadGas({ ...fake.services, Date: frozenDate(FIXED_MS) });
```

## 端到端測試長這樣

```javascript
const call = (action, idToken, data = {}) =>
  JSON.parse(gas.doPost({
    postData: { contents: JSON.stringify({ idToken, action, data }) }
  }).getContent());

it('重複操作被拒絕，且不會產生第二筆', () => {
  const env = createEnv();
  env.ok('checkin', TOKENS.user1, { week: 1, code: 'A8X2' });
  expect(env.call('checkin', TOKENS.user1, { week: 1, code: 'A8X2' }).error.code)
    .toBe('ALREADY_CHECKED_IN');
  expect(env.fake.rowsOf('Attendances')).toHaveLength(1);
});
```

## 值得優先寫的測試

不是為了覆蓋率，而是這幾類問題最容易在部署後才爆、而且後果最嚴重：

| 類別 | 為什麼優先 |
|---|---|
| **RBAC 權限矩陣**（每個 action × 每種角色） | 授權漏洞是最嚴重的缺陷，而且靠手動點很難全部試過 |
| **越權操作被擋** | 前端只送 id，惡意使用者可以自行竄改。必須驗證後端有二次檢查 |
| **資料外洩** | 斷言回應的 JSON **不包含**不該出現的欄位（他人 email、驗證碼） |
| **併發與重複** | 手動幾乎測不出來 |
| **欄位順序調換／新增欄位** | 管理者會直接改試算表，系統不能因此崩潰 |
| **權限宣告涵蓋所有用到的 API** | 見 platform-traps #4，這個錯誤只在執行時才出現 |

資料外洩的斷言寫法很有用：

```javascript
it('學員視角的回應不含任何他人 email', () => {
  const data = ok('getQnA', TOKENS.student2);
  expect(JSON.stringify(data)).not.toContain(EMAILS.student1);
});
```

## 用變異測試確認測試真的有在把關

寫完測試後，**故意把程式改壞，確認測試會失敗**。
測試全過但其實抓不到問題，比沒有測試更危險 —— 它給你錯誤的信心。

值得驗證的變異：

```bash
# 把驗證碼也回傳給一般使用者 → 應該有測試失敗
# 拿掉越權檢查 → 應該有測試失敗
# 拿掉匿名剝除 → 應該有測試失敗
# 從 oauthScopes 移除一項 → 應該有測試失敗
```

實際做過一次，發現其中一個「保護機制」的測試根本沒走到那條路徑
（例外在更外層就被吃掉了）。不做變異測試不會發現。

## 驗證打包產物

如果用 `scripts/build-bundle.mjs` 把後端合併成單一檔案給使用者貼上，
**要另外測合併後的檔案**。使用者部署的是合併檔，如果合併過程弄壞了什麼，
分檔版本的測試全過也沒有意義。

比對方式不要寫死數量（新增功能就會壞），直接跟分檔版本逐項比對：

```javascript
expect(Object.keys(bundleRegistry).sort()).toEqual(Object.keys(splitRegistry).sort());
```

## 這套方法測不到什麼

要誠實面對邊界，這些仍然只能在真實環境驗證：

- Google 的實際 API 行為（配額、真實的權限錯誤、Drive 的邊界情況）
- OAuth 登入流程本身
- 真實的併發（假的 LockService 是單執行緒的）
- 試算表的實際轉型行為（假實作不會轉型，所以轉型防護只能測「有沒有做跳脫」）

因此部署後仍要跑一次 `verifySetup()`，並手動走過一輪主要流程。
