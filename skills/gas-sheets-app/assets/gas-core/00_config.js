/**
 * 常數與設定。【這個檔案需要依你的應用調整】
 *
 * 重要慣例：所有 .js 檔案的頂層宣告一律使用 var 與 function，
 * 不使用 const / let / class。兩個理由：
 *   1. Apps Script 各檔案共用同一個全域作用域，var 與 function 會掛到 globalThis，
 *      跨檔案取用最穩定；const/let/class 建立的是詞法繫結，不會成為全域屬性。
 *   2. 單元測試以 vm.runInContext 載入原始碼，只有 globalThis 上的成員取得到。
 *      違反這條慣例，測試會拿到一堆 undefined 而看不出原因。
 */

/* ---------- 工作表名稱與欄位（改成你的）---------- */

var SHEET = {
  ROLES: '__RBAC_Roles',     // 誰能登入、角色是什麼
  MAIN: 'Records'            // 你的主資料表
};

/**
 * 每張工作表的欄位定義。
 * 這同時是 90_setup.js 建表的依據，也是啟動時驗證結構的依據 ——
 * 只在這裡定義一次，程式其他地方一律透過標頭動態對照取值，不寫死欄位位置。
 */
var SHEET_HEADERS = {
  '__RBAC_Roles': ['email', 'name', 'role', 'status'],
  'Records': ['id', 'owner_email', 'content', 'created_at', 'status']
};

/* ---------- 列舉值 ---------- */

var ROLE = { ADMIN: 'ADMIN', EDITOR: 'EDITOR', VIEWER: 'VIEWER' };
var USER_STATUS = { ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' };

/* ---------- 時間 ---------- */

/**
 * 本地時間相對 UTC 的固定偏移（分鐘）。台北為 +8 小時 = 480。
 *
 * 這個做法只在「沒有日光節約時間」的地區成立（台灣、日本、韓國、中國、印度、
 * 泰國、新加坡等）。若你的使用者在有日光節約的地區（美國、歐洲、澳洲多數地方），
 * 不能用固定偏移，必須改用 Utilities.formatDate(date, 'America/New_York', ...)
 * 之類帶時區名稱的 API，否則一年會有兩次算錯一小時。
 */
var LOCAL_UTC_OFFSET_MINUTES = 480;

/* ---------- 限制 ---------- */

var LIMITS = {
  UPLOAD_MAX_BYTES: 5 * 1024 * 1024,   // Base64 管線的實務上限，見 references/platform-traps.md
  ALLOWED_EXTENSIONS: ['pdf', 'zip'],
  LOCK_WAIT_MS: 30000,
  CACHE_TTL_SECONDS: 300,
  TEXT_MAX: 2000
};

/**
 * 讀取指令碼屬性（Script Properties）。
 *
 * 為什麼不寫死在程式碼裡：這些值每個部署都不同，寫死會讓「改設定」變成「改程式碼再重新部署」。
 * 設定位置：Apps Script 編輯器 → 專案設定 → 指令碼屬性。
 */
function getConfig() {
  var props = PropertiesService.getScriptProperties();
  var cfg = {
    clientId: props.getProperty('CLIENT_ID'),
    driveFolderId: props.getProperty('DRIVE_FOLDER_ID'),
    spreadsheetId: props.getProperty('SPREADSHEET_ID') || ''
  };
  if (!cfg.clientId) throw new AppError('CONFIG_MISSING', '尚未設定 CLIENT_ID 指令碼屬性');
  return cfg;
}
