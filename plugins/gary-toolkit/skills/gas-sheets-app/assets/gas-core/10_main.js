/**
 * Web App 進入點與 action 路由。【registry 需要依你的應用調整】
 *
 * CORS：Apps Script 不回應 preflight（OPTIONS）請求。前端必須以
 * Content-Type: text/plain 送出 JSON 字串，讓瀏覽器視為「簡單請求」而略過 preflight。
 * 這裡不需要（也無法）自行設定 CORS 標頭。詳見 references/platform-traps.md。
 */

function doPost(e) {
  var result;
  try {
    var body = parseRequestBody(e);
    var action = normStr(body.action);
    if (action === '') fail('VALIDATION_ERROR', '缺少 action 參數');

    var entry = getActionRegistry()[action];
    if (!entry) fail('UNKNOWN_ACTION', '不支援的操作：' + action);

    var ctx = authenticate(body.idToken);
    requireRole(ctx, entry.roles);

    result = { success: true, data: entry.handler(ctx, body.data || {}) };
  } catch (err) {
    result = {
      success: false,
      error: {
        code: (err && err.code) ? err.code : 'INTERNAL_ERROR',
        message: (err && err.message) ? err.message : '系統發生未預期的錯誤'
      }
    };
    if (!err || !err.isAppError) {
      console.error('未預期錯誤: ' + (err && err.stack ? err.stack : err));
    }
  }
  return jsonOutput(result);
}

/**
 * 健康檢查。部署後可直接用瀏覽器開啟 /exec 網址確認是否上線 ——
 * 這是排查「前端連不上」時第一個該做的檢查，能立刻分辨是後端沒上線還是前端設定錯。
 */
function doGet() {
  return jsonOutput({
    success: true,
    data: { status: 'ok', serverTime: formatLocalIso(Date.now()) }
  });
}

function parseRequestBody(e) {
  if (!e || !e.postData || !e.postData.contents) {
    fail('VALIDATION_ERROR', '請求內容為空');
  }
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    fail('VALIDATION_ERROR', '請求格式不是合法的 JSON');
  }
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Action 註冊表。【改成你的 action】
 *
 * 刻意寫成函式而非頂層變數：Apps Script 依檔案順序執行頂層敘述，
 * 若在此以 var 直接引用後面檔案定義的函式，載入當下會取到 undefined。
 *
 * 把角色白名單放在註冊表而非各個 handler 裡，好處是「誰能做什麼」
 * 集中在一處可以一眼看完，也能寫一個測試掃過整張表驗證每個 action 都有明確的授權。
 */
function getActionRegistry() {
  var ALL = [ROLE.ADMIN, ROLE.EDITOR, ROLE.VIEWER];
  var WRITERS = [ROLE.ADMIN, ROLE.EDITOR];
  var ADMIN_ONLY = [ROLE.ADMIN];

  return {
    getProfile:   { roles: ALL,        handler: actionGetProfile },
    listRecords:  { roles: ALL,        handler: actionListRecords },
    createRecord: { roles: WRITERS,    handler: actionCreateRecord },
    refreshCache: { roles: ADMIN_ONLY, handler: actionRefreshCache }
  };
}
