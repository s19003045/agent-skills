/**
 * 記憶體快取層（CacheService）。
 * __RBAC_Roles / Users / Schedule 屬讀多寫少，以 TTL 5 分鐘快取，
 * 講師變更指派或排程時主動失效（見 24_instructor.js）。
 *
 * 注意：CacheService 單一鍵值上限 100KB。100 人規模的名冊約 15KB，安全。
 */

var CACHE_KEY = {
  ROLES: 'cs_roles_v1',
  USERS: 'cs_users_v1',
  SCHEDULE: 'cs_schedule_v1'
};

function cacheGetJson(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;   // 快取故障絕不能讓主流程失敗
  }
}

function cachePutJson(key, value, ttlSeconds) {
  try {
    var raw = JSON.stringify(value);
    if (raw.length > 95000) return;   // 超過上限就放棄快取，改為每次重讀
    CacheService.getScriptCache().put(key, raw, ttlSeconds || LIMITS.CACHE_TTL_SECONDS);
  } catch (e) { /* 忽略 */ }
}

function cacheInvalidate(keys) {
  try {
    CacheService.getScriptCache().removeAll(keys);
  } catch (e) { /* 忽略 */ }
}

/* ---------- 具快取的資料載入器（依你的應用調整）---------- */

/**
 * 範本：把一張「讀多寫少」的工作表載入成以主鍵為索引的物件。
 *
 * forceFresh 參數不是可有可無的：快取 TTL 內若有人剛被加進名冊，
 * 他會查不到自己而看到「查無此人」，並誤以為是永久拒絕。
 * 上層應該在「查無此人」時用 forceFresh 重讀一次再決定拒絕（見 07_auth.js）。
 */
function loadRoles(forceFresh) {
  var cached = forceFresh ? null : cacheGetJson(CACHE_KEY.ROLES);
  if (cached) return cached;

  var table = readTable(SHEET.ROLES);
  var map = {};
  for (var i = 0; i < table.rows.length; i++) {
    var r = table.rows[i];
    var email = normLower(r.email);
    if (!email) continue;
    map[email] = {
      email: email,
      name: normStr(r.name),
      role: normStr(r.role).toUpperCase(),
      status: normStr(r.status).toUpperCase() || USER_STATUS.ACTIVE
    };
  }
  cachePutJson(CACHE_KEY.ROLES, map);
  return map;
}

/**
 * 清除所有快取。
 *
 * 兩種用途：
 *   1. 從 Apps Script 編輯器手動執行，讓名冊或排程的異動立即生效
 *   2. 講師透過 refreshCache 動作從系統介面觸發
 *
 * 一般情況不需要用到 —— 查無此人時系統會自動重讀一次名冊（見 07_auth.js）。
 */
function clearCaches() {
  cacheInvalidate([CACHE_KEY.ROLES, CACHE_KEY.USERS, CACHE_KEY.SCHEDULE]);
  var message = '已清除名冊、學員與排程快取';
  console.log(message);
  return message;
}
