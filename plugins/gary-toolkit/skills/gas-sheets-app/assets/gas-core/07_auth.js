/**
 * 身分驗證與 RBAC。這是整個系統的信任邊界：
 * 前端送來的一切都不可信，使用者身分只認 Google 簽發的 ID Token。
 */

/**
 * 驗證 Google ID Token 並取回經確認的 email。
 * 驗證失敗回傳 null。
 *
 * 為什麼要檢查這三項：
 *   aud  — 防止其他網站的 token 被拿來冒用本系統（最關鍵的一項）
 *   iss  — 確認簽發者確實是 Google
 *   email_verified — 確認該 email 已被 Google 驗證過
 *
 * 結果會快取，避免每個請求都多一次 300ms 的對外請求。
 * 快取 TTL 取「token 剩餘壽命 - 60 秒」與 300 秒的較小值，確保不會用到過期的 token。
 */
function verifyIdToken(idToken) {
  var token = normStr(idToken);
  if (token === '' || token.length > 4096) return null;

  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token);
  var key = 'tok_' + Utilities.base64Encode(digest);

  var cached = null;
  try { cached = CacheService.getScriptCache().get(key); } catch (e) { cached = null; }
  if (cached) return cached;

  var response;
  try {
    response = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true, followRedirects: false }
    );
  } catch (e) {
    return null;
  }
  if (response.getResponseCode() !== 200) return null;

  var payload;
  try { payload = JSON.parse(response.getContentText()); } catch (e) { return null; }

  var cfg = getConfig();
  if (payload.aud !== cfg.clientId) return null;
  if (['accounts.google.com', 'https://accounts.google.com'].indexOf(payload.iss) < 0) return null;
  if (String(payload.email_verified) !== 'true') return null;
  if (!payload.email) return null;

  var email = String(payload.email).toLowerCase();
  var remaining = Number(payload.exp) - Math.floor(Date.now() / 1000) - 60;
  var ttl = Math.min(LIMITS.CACHE_TTL_SECONDS, remaining);
  if (ttl > 0) {
    try { CacheService.getScriptCache().put(key, email, ttl); } catch (e) { /* 忽略 */ }
  }
  return email;
}

/**
 * 驗證身分並解析角色。
 * @return {{email:string, name:string, role:string}}
 */
function authenticate(idToken) {
  var email = verifyIdToken(idToken);
  if (!email) fail('UNAUTHENTICATED', '登入憑證無效或已過期，請重新登入');

  var record = loadRoles()[email];

  // 名冊快取的 TTL 是 5 分鐘。講師剛把某人加進名冊時，快取仍是舊的，
  // 那個人會看到「不在名冊中」而不知道其實只要再等一下。
  // 因此在拒絕之前，略過快取重讀一次名冊再確認。
  // 這條路徑只在「查無此人」時走到，正常登入不會多付這次讀取成本。
  if (!record) {
    record = loadRoles(true)[email];
  }

  // 錯誤訊息帶上實際驗證到的 email：Workspace 帳號可能有別名，
  // Google 回報的主要地址未必等於講師填進名冊的那一個，不寫出來無從察覺。
  if (!record) {
    fail('NOT_ENROLLED', '此帳號（' + email + '）不在本課程名冊中，請確認管理者填入名冊的是這個地址');
  }
  if (record.status !== USER_STATUS.ACTIVE) {
    fail('ACCOUNT_DISABLED', '此帳號（' + email + '）已停用，請聯絡管理者');
  }
  // 從 ROLE 列舉推導有效角色，而不是寫死清單 ——
  // 這樣在 00_config.js 增減角色時，不必記得回來同步這裡
  var validRoles = [];
  for (var key in ROLE) validRoles.push(ROLE[key]);
  if (validRoles.indexOf(record.role) < 0) {
    fail('NOT_ENROLLED', '此帳號的角色「' + record.role + '」無效，' +
                         '應為 ' + validRoles.join('、') + ' 其中之一');
  }
  return { email: email, name: record.name || email, role: record.role };
}

function requireRole(ctx, allowedRoles) {
  if (allowedRoles.indexOf(ctx.role) < 0) {
    fail('FORBIDDEN', '權限不足');
  }
}

/** 取得目前使用者在主資料表中的紀錄（依你的應用調整）。 */
function requireStudentRecord(ctx) {
  var record = loadUsers()[ctx.email];
  if (!record) {
    record = loadUsers(true)[ctx.email];   // 同 authenticate：快取可能是舊的
  }
  if (!record) {
    fail('NOT_ENROLLED',
         '找不到您的學員資料（' + ctx.email + '），請聯絡管理者確認名冊已加入這個地址');
  }
  return record;
}
