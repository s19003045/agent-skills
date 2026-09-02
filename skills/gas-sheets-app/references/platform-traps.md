# Google 平台陷阱全集

每一項都是實際踩過的。共通特徵是：**錯誤訊息不會指向真正的原因**，
有些甚至完全不報錯，只是行為悄悄不對。

## 目錄

1. [CORS preflight 讓所有請求失敗](#1)
2. [試算表自動轉型竄改你的資料](#2)
3. [時區預設可能不是你的時區](#3)
4. [明確宣告 oauthScopes 會關閉自動偵測](#4)
5. [併發寫入互相覆蓋](#5)
6. [檔案分享權限等於公開到網際網路](#6)
7. [0.0.0.0 無法通過 Google 登入](#7)
8. [快取讓剛加入的人被拒絕](#8)
9. [base64Decode 回傳有號位元組](#9)
10. [ID Token 只有 1 小時](#10)
11. [改了程式碼但行為沒變](#11)
12. [Service Account 沒有 Drive 儲存配額](#12)

---

<a id="1"></a>
## 1. CORS preflight 讓所有請求失敗

**症狀**：前端每一個 API 呼叫都失敗，主控台顯示 CORS 錯誤。後端直接用瀏覽器開 `/exec` 卻正常。

**原因**：Apps Script Web App 不回應 preflight（OPTIONS）請求。只要請求觸發 preflight，
瀏覽器就會先送 OPTIONS，得不到回應，整個請求就失敗。`Content-Type: application/json`
正是會觸發 preflight 的條件之一。

**修法**：故意把請求降級成「簡單請求」——

```javascript
await fetch(GAS_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // 不是 application/json
  body: JSON.stringify({ idToken, action, data }),
  redirect: 'follow'   // /exec 會 302 轉址到 googleusercontent.com
});
```

內容仍然是 JSON 字串，後端用 `JSON.parse(e.postData.contents)` 解析。
這個寫法看起來很怪，但它是 Apps Script Web App 的標準做法，沒有別的辦法。

---

<a id="2"></a>
## 2. 試算表自動轉型竄改你的資料

**症狀**：三種各自獨立的災情。

| 寫入的值 | 實際存成 | 後果 |
|---|---|---|
| `'0123'`（驗證碼、學號） | 數字 `123` | 字串比對永遠失敗 |
| `'2026-09-02T19:00:00+08:00'` | Date 物件 | 讀回來格式全變 |
| `'=IMPORTXML(...)'`（使用者輸入） | 公式 | 內容被計算掉，且有資料外洩風險 |

第三項特別危險：使用者留言若以 `=` 開頭會變成活的公式，`IMPORTXML` 之類的函式
可以把試算表內容送到外部網址。這是 CSV/公式注入。

**修法**（三項都要做，缺一不可）：

1. 初始化時把整張表設為純文字格式：
   ```javascript
   sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setNumberFormat('@');
   ```
   要涵蓋 `getMaxRows()` 而不只是現有資料列，這樣之後新增的列會繼承格式。

2. 寫入前跳脫開頭為 `= + - @` 的字串（前置單引號，Sheets 視為純文字標記）：
   ```javascript
   function escapeForSheet(v) {
     var s = String(v);
     if (s.length && '=+-@'.indexOf(s.charAt(0)) >= 0) return "'" + s;
     return s;
   }
   ```

3. 讀取後一律正規化，並移除寫入時加的跳脫引號、處理被轉成 Date 的值：
   ```javascript
   function normStr(v) {
     if (v instanceof Date) return formatLocalIso(v.getTime());
     var s = String(v).trim();
     if (s.length > 1 && s.charAt(0) === "'" && '=+-@'.indexOf(s.charAt(1)) >= 0) s = s.slice(1);
     return s;
   }
   ```

布林值也要小心：Sheet 可能回傳 boolean `true`，也可能回傳字串 `'TRUE'`，兩者都要接受。

**額外建議**：驗證碼之類的短字串，字元集排除 `0/O`、`1/I/L` 這類易混淆字元，
既避免使用者輸入錯誤，也順便迴避純數字被轉型的問題。

---

<a id="3"></a>
## 3. 時區預設可能不是你的時區

**症狀**：時間窗判斷完全不對，可能差十幾個小時。

**原因**：Apps Script 專案有自己的時區設定，預設可能是 `America/Los_Angeles`。
`new Date('2026-09-02 19:00')` 這種沒有時區的字串會依專案時區解讀。

**修法**：`appsscript.json` 明確設定：

```json
{ "timeZone": "Asia/Taipei", "runtimeVersion": "V8" }
```

並在部署自我檢查裡驗證 `Session.getScriptTimeZone()`，才不會靠人記得。

**沒有日光節約時間的地區**（台灣、日本、韓國、中國、印度、泰國、新加坡、香港）
可以用固定偏移做純函式的時間解析，這讓時間邏輯能在本機測試：

```javascript
var LOCAL_UTC_OFFSET_MINUTES = 480;   // UTC+8
function parseLocalDateTime(text) { /* ... */ return utc - LOCAL_UTC_OFFSET_MINUTES * 60000; }
```

**有日光節約的地區**（美國、歐洲、澳洲多數地方）**不能這樣做**，一年會有兩次錯一小時。
必須改用帶時區名稱的 API：

```javascript
Utilities.formatDate(new Date(), 'America/New_York', "yyyy-MM-dd'T'HH:mm:ssXXX");
```

代價是這部分邏輯不能在本機純函式測試，需要在測試中假造 `Utilities`。

---

<a id="4"></a>
## 4. 明確宣告 oauthScopes 會關閉自動偵測

**症狀**：
```
Exception: Specified permissions are not sufficient to call Session.getEffectiveUser.
Required permissions: https://www.googleapis.com/auth/userinfo.email
```

**原因**：`appsscript.json` 沒有 `oauthScopes` 時，Apps Script 會掃描程式碼自動推斷需要的權限。
**一旦你自己列出清單，自動偵測就關閉了** —— 清單上沒有的權限，程式一律不給用。

**修法**：清單必須涵蓋程式用到的每一個 API：

| 你用了什麼 | 需要的權限 |
|---|---|
| `SpreadsheetApp` | `.../auth/spreadsheets` |
| `DriveApp` | `.../auth/drive` |
| `UrlFetchApp` | `.../auth/script.external_request` |
| `ScriptApp.newTrigger` | `.../auth/script.scriptapp` |
| `Session.getEffectiveUser` | `.../auth/userinfo.email` |
| `MailApp` / `GmailApp` | `.../auth/script.send_mail` |
| `CalendarApp` | `.../auth/calendar` |

`PropertiesService`、`CacheService`、`LockService`、`Utilities`、`ContentService` 不需要宣告。

**連帶災情要特別注意**：這個例外會中斷整個函式。如果它發生在一個「初始化」函式中段，
它後面的步驟會完全沒有執行，而錯誤訊息完全不會提到那些步驟。實際遇到的情況是
「6 張表都建好了，但範本資料是空的」，錯誤訊息只提到權限。

因此初始化流程中的**非關鍵步驟要各自隔離**：

```javascript
function safeStep_(label, fn) {
  try { return fn(); }
  catch (e) { return '[略過] ' + label + '：' + (e && e.message ? e.message : e); }
}
```

建表是必須成功的；種子資料只是便利措施，其中一步失敗不應讓另一步被無聲跳過。

**寫個測試守住它**：把「程式用到的 API → 需要的權限」列成對照表，驗證 manifest 有涵蓋。

---

<a id="5"></a>
## 5. 併發寫入互相覆蓋

**症狀**：兩個人同時操作，其中一個人的資料不見了。難以重現，而且不會報錯。

**原因**：「讀取整列 → 修改欄位 → 寫回整列」這個模式，兩個請求交錯執行時後寫的會蓋掉先寫的。

**修法**：`LockService` 包住**完整的讀取、檢查、寫入**：

```javascript
function withLock(fn) {
  var lock = LockService.getScriptLock();
  // 用 tryLock 而非 waitLock：前者回傳布林值，可轉成可重試的錯誤碼；
  // 後者直接拋例外，難以與其他錯誤區分
  if (!lock.tryLock(30000)) fail('SYSTEM_BUSY', '系統忙碌中，請稍後再試');
  try { return fn(); } finally { try { lock.releaseLock(); } catch (e) {} }
}
```

**兩個容易做錯的地方**：

- 只鎖住寫入那一行是沒用的，防重複檢查也必須在鎖內。
- **寫入前要重新讀取目標列**，不能用鎖外讀到的舊值：
  ```javascript
  function tableUpdate(table, rowNumber, partial) {
    var range = table.sheet.getRange(rowNumber, 1, 1, table.headers.length);
    var current = range.getValues()[0];        // 鎖內重讀
    range.setValues([objectToRow(partial, table.headers, current)]);
  }
  ```

**臨界區要短**。慢的操作（檔案上傳、Drive 權限調整）放在鎖外。
Apps Script 同時執行上限是 30，臨界區若耗時 1 秒，理論上每分鐘只能處理約 60 次寫入。
前端必須對 `SYSTEM_BUSY` 做指數退避重試。

---

<a id="6"></a>
## 6. 檔案分享權限等於公開到網際網路

**症狀**：沒有症狀 —— 這是最危險的一種。系統運作完全正常，但資料已經公開。

**原因**：`file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)`
的意思是任何人拿到連結都能看。連結會外流、可能被搜尋引擎索引。

**修法**：因為 Apps Script 以擁有者身分執行，可以直接精準操作權限：

```javascript
// 上傳時：檔案保持私有，只加入本人
file.addViewer(ownerEmail);

// 其他角色要看時，先做 RBAC 檢查，通過才即時授權
function actionGetFileLink(ctx, data) {
  var row = findRowById(readTable(SHEET.FILES), data.id);
  if (!canView(ctx, row)) fail('FORBIDDEN', '您沒有檢視這份檔案的權限');
  DriveApp.getFileById(row.drive_file_id).addViewer(ctx.email);
  return { viewLink: row.file_view_link };
}
```

**為什麼用「點開時才授權」而不是上傳時就全部加好**：權限異動時（例如換了負責人）
不必回頭修改上千個檔案的權限，成本從 O(檔案數) 降到 O(實際被開啟的數量)。

真的需要公開的檔案（例如公開展示區），把它當成一個**刻意的、可撤回的決定**：
明確標記、開放時 `setSharing(ANYONE_WITH_LINK)`、取消標記時改回 `PRIVATE` 並重新加回本人。

---

<a id="7"></a>
## 7. `0.0.0.0` 無法通過 Google 登入

**症狀**：登入時出現「已封鎖存取權：授權錯誤」，`400: invalid_request`，
訊息說「doesn't comply with Google's OAuth 2.0 policy」。

**原因**：`0.0.0.0` 是「監聽所有網路介面」的萬用位址，不是主機名稱。
瀏覽器連得上（作業系統會導向回送介面），但 Google OAuth 一律拒絕，
而且你也**無法**把它填進「已授權的 JavaScript 來源」—— Google Cloud Console 會擋下來。

**為什麼特別容易踩到**：`python3 -m http.server` 預設綁定 `0.0.0.0` 並印出
`Serving HTTP on 0.0.0.0 port 5173 (http://0.0.0.0:5173/)`，
而終端機會把那串文字變成**可點擊的連結**。點下去是完全合理的行為。
加 `--bind localhost` 也治不了本，它印出來的仍是 `127.0.0.1`。

**修法**（三層）：

1. 用 `scripts/serve.mjs`（本 skill 附的）取代 `python3 -m http.server`。
   它只綁 `127.0.0.1`，並明確印出應該使用的 `http://localhost:PORT`。
2. OAuth 設定裡**同時登記** `http://localhost:5173` 和 `http://127.0.0.1:5173`，
   在 Google 眼中這是兩個不同的來源。
3. 前端偵測 `location.hostname === '0.0.0.0'` 時直接顯示說明與切換連結，
   不要讓使用者對著載入畫面等 GIS 逾時。

---

<a id="8"></a>
## 8. 快取讓剛加入的人被拒絕

**症狀**：管理者把某人加進名冊，對方登入卻顯示「此帳號不在名冊中」。
等幾分鐘之後又自己好了。

**原因**：名冊快取的 TTL（通常 5 分鐘）還沒過期，系統手上仍是舊的那份。

**為什麼一定要修**：訊息聽起來像永久拒絕，完全沒有線索指向「再等一下」。
使用者只能反覆檢查是不是拼錯字，管理者也會以為系統壞了。

**修法**：查無此人時，略過快取重讀一次再決定拒絕：

```javascript
var record = loadRoles()[email];
if (!record) {
  record = loadRoles(true)[email];   // forceFresh
}
if (!record) fail('NOT_ENROLLED', '此帳號（' + email + '）不在名冊中');
```

這條路徑只在「找不到人」時走到，正常登入不會多付這次讀取成本。

**注意這只解決「新增」**。修改**既有**成員（改角色、改成停用）時那個人本來就在快取裡，
不會觸發重讀，最久仍要等 TTL 過期。停用帳號時這個延遲有安全意義，
所以要另外提供一個「立即重新讀取」的管理功能。

---

<a id="9"></a>
## 9. `base64Decode` 回傳有號位元組

**症狀**：檔案類型判斷（magic bytes）對某些檔案永遠失敗。

**原因**：`Utilities.base64Decode()` 回傳的是 Java 的 byte 陣列，範圍 **-128 ~ 127**，
不是 JavaScript 慣見的 0 ~ 255。任何大於 127 的位元組都會變成負數。

**修法**：比對前先 `& 0xFF`：

```javascript
function detectFileType(bytes) {
  if (!bytes || bytes.length < 4) return null;
  var b = [];
  for (var i = 0; i < 4; i++) b.push(bytes[i] & 0xFF);
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';  // %PDF
  if (b[0] === 0x50 && b[1] === 0x4B &&
      (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return 'zip';                 // PK
  return null;
}
```

順帶一提，**要檢查檔案內容而不是只信任副檔名**。把 `.exe` 改名成 `.pdf` 是最基本的繞過手法。

---

<a id="10"></a>
## 10. ID Token 只有 1 小時

**症狀**：使用者填到一半，送出時失敗，重新整理後又要重新登入。

**原因**：Google Identity Services 簽發的 ID Token 有效期是 1 小時。

**修法**：前端收到 `UNAUTHENTICATED` 時先嘗試靜默續發再重試一次：

```javascript
if (code === 'UNAUTHENTICATED' && !refreshed) {
  refreshed = true;
  const fresh = await refresh();     // google.accounts.id.prompt()
  if (fresh) continue;               // 用新 token 重試
  throw new ApiError('UNAUTHENTICATED', '登入已過期，請重新登入');
}
```

後端這邊，驗證結果應該快取（以 token 的雜湊為鍵），
TTL 取「token 剩餘壽命 − 60 秒」與快取上限的較小值。
不快取的話，每個請求都要多一次對 `oauth2.googleapis.com/tokeninfo` 的請求，
增加約 300ms 延遲，也會消耗 UrlFetch 配額。

**驗證 token 時必檢查三項**（少一項就有安全漏洞）：

```javascript
if (payload.aud !== CLIENT_ID) return null;   // 防止別站的 token 被拿來冒用 ← 最關鍵
if (['accounts.google.com', 'https://accounts.google.com'].indexOf(payload.iss) < 0) return null;
if (String(payload.email_verified) !== 'true') return null;
```

---

<a id="11"></a>
## 11. 改了程式碼但行為沒變

**症狀**：修好了 bug，重新整理網頁，行為完全一樣。

**原因**：Apps Script 的 Web App 網址綁定的是**部署版本**，不是最新的程式碼。

**修法**：「部署」→「管理部署作業」→ 點現有那筆的鉛筆圖示 → 版本選**新版本** → 部署。
這樣網址不變，使用者不用換連結。

如果按的是「新增部署作業」，會產生一個**全新的網址**，前端設定就要跟著改。

這是這個平台最常見的除錯陷阱，在文件裡一定要寫進去。

---

<a id="12"></a>
## 12. Service Account 沒有 Drive 儲存配額

**症狀**：用 Service Account 上傳檔案到 Drive 時失敗，
訊息是 `Service Accounts do not have storage quota`。

**原因**：Service Account 可以「讀寫別人的檔案」，但不能「擁有」檔案。

**為什麼這裡不會遇到**：Apps Script 以**你本人**的身分執行，檔案存在你自己的 Drive
（免費帳號 15GB），完全不需要 Service Account。

**如果你考慮改用 Service Account 架構**（例如換成 Node.js 後端），
就必須用 Google Workspace 的共用雲端硬碟，或用網域委派冒充真人帳號。
這是選擇 Apps Script 而非自架後端的一個實質優勢。
