/**
 * Action 範例。【整個檔案換成你的功能】
 *
 * 保留這個檔案是為了讓骨架「開箱即可跑」—— 複製 gas-core 之後不必補任何東西
 * 就能執行 setupSpreadsheet、跑測試、部署，確認整條路徑通了再開始寫功能。
 *
 * 每個 handler 的簽章都是 (ctx, data)：
 *   ctx  = { email, name, role }  已通過驗證與授權，可以信任
 *   data = 前端送來的 payload      完全不可信，一律要驗證
 */

function actionGetProfile(ctx) {
  return {
    email: ctx.email,
    name: ctx.name,
    role: ctx.role,
    serverTime: formatLocalIso(Date.now())
  };
}

/**
 * 讀取清單。
 *
 * 注意授權是在這裡做的，不是在前端。ADMIN 看得到全部，其他人只看得到自己的 ——
 * 前端不送任何篩選條件，也不能相信前端送來的身分。
 */
function actionListRecords(ctx) {
  var table = readTable(SHEET.MAIN);
  var list = [];
  for (var i = 0; i < table.rows.length; i++) {
    var r = table.rows[i];
    var owner = normLower(r.owner_email);
    if (ctx.role !== ROLE.ADMIN && owner !== ctx.email) continue;

    var item = {
      id: normStr(r.id),
      content: normStr(r.content),
      createdAt: normStr(r.created_at),
      status: normStr(r.status),
      isMine: owner === ctx.email
    };
    // 只有管理者看得到擁有者是誰；其他角色拿到的資料不含任何他人 email
    if (ctx.role === ROLE.ADMIN) item.ownerEmail = owner;
    list.push(item);
  }
  return { records: list };
}

function actionCreateRecord(ctx, data) {
  var content = truncate(data.content, LIMITS.TEXT_MAX);
  if (content === '') fail('VALIDATION_ERROR', '內容不可為空');

  var row = {
    id: newId(),
    owner_email: ctx.email,
    content: content,          // objectToRow 會處理公式跳脫
    created_at: formatLocalIso(Date.now()),
    status: 'ACTIVE'
  };

  // 附加操作理論上不需要鎖，但統一走同一條路徑可以避免日後改成
  // 「讀→改→寫」時忘記加鎖
  withLock(function () {
    tableAppend(readTable(SHEET.MAIN), row);
  });

  return { id: row.id, message: '已建立' };
}

/**
 * 立即重新讀取名冊。
 *
 * 「查無此人」時 authenticate 會自動重讀，所以新增成員不需要用到這個。
 * 這是為了「修改既有成員」的情況 —— 例如把某人改成 DISABLED。
 * 那些人本來就在快取裡，不會觸發自動重讀，最久要等 TTL 過期才生效；
 * 停用帳號時這段延遲有安全意義，所以要能立即套用。
 */
function actionRefreshCache(ctx) {
  clearCaches();
  var roles = loadRoles(true);
  var count = 0;
  for (var e in roles) count++;
  return { rosterCount: count, message: '已重新讀取名冊（' + count + ' 人）' };
}
