/** 需要建立與驗證的工作表清單，來源是 00_config.js 的 SHEET_HEADERS。 */
function listSheetNames() {
  var names = [];
  for (var name in SHEET_HEADERS) names.push(name);
  return names;
}

/**
 * 一次性初始化與自我檢查。
 * 這兩個函式從 Apps Script 編輯器的「執行」下拉選單手動執行，不對外開放。
 */

/**
 * 建立 6 張工作表、寫入標頭、將整張表設為純文字格式。
 *
 * 純文字格式是關鍵：Google Sheet 預設會把 '0123' 轉成數字 123、
 * 把日期字串轉成 Date 物件，導致比對全面失效（見 docs/SRS.md §5.2）。
 *
 * 可重複執行：已存在的工作表只會補齊缺少的標頭，不會清空既有資料。
 */
function setupSpreadsheet() {
  var ss = getSpreadsheet();
  var report = [];

  // 工作表清單直接由 SHEET_HEADERS 推導，不另外維護一份 ——
  // 兩份清單遲早會不同步，而且不同步時的錯誤訊息完全看不出原因
  var order = listSheetNames();

  for (var i = 0; i < order.length; i++) {
    var name = order[i];
    var headers = SHEET_HEADERS[name];
    var sheet = ss.getSheetByName(name);
    var created = false;

    if (!sheet) {
      sheet = ss.insertSheet(name);
      created = true;
    }

    // 整張表設為純文字，這樣之後任何新增列都會繼承此格式
    sheet.getRange(1, 1, sheet.getMaxRows(), Math.max(sheet.getMaxColumns(), headers.length))
         .setNumberFormat('@');

    var existing = sheet.getLastColumn() > 0
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (v) {
          return String(v).trim();
        })
      : [];

    if (existing.length === 0 || existing.join('') === '') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      report.push((created ? '建立' : '寫入標頭') + '：' + name);
    } else {
      var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
      if (missing.length) {
        sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
        report.push('補齊欄位：' + name + ' → ' + missing.join('、'));
      } else {
        report.push('已存在且欄位完整：' + name);
      }
    }

    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, sheet.getLastColumn())
         .setFontWeight('bold')
         .setBackground('#E8EAED');
    sheet.autoResizeColumns(1, sheet.getLastColumn());
  }

  // 移除試算表預設的空白工作表
  var defaultSheet = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
    report.push('移除預設空白工作表');
  }

  // 這兩步各自獨立：其中一步失敗（例如權限不足）不應讓另一步也做不成
  report.push(safeStep_('寫入擁有者種子資料', function () { return seedInstructor_(ss); }));
  report.push(safeStep_('建立應用專屬種子資料', function () { return seedInitialData_(ss); }));

  var text = report.join('\n');
  console.log(text);
  return text;
}

/**
 * 執行一個非關鍵步驟。失敗只記錄訊息，不中斷整個初始化流程。
 *
 * 建表本身是必須成功的；種子資料只是便利措施，缺了可以手動補。
 * 讓種子資料的錯誤中斷整個 setupSpreadsheet，會使後面的步驟被無聲跳過。
 */
function safeStep_(label, fn) {
  try {
    return fn();
  } catch (e) {
    return '[略過] ' + label + '：' + (e && e.message ? e.message : e);
  }
}

/**
 * 取得試算表擁有者的 email。
 *
 * 優先透過 Drive 讀取檔案擁有者，因為那只需要本專案已宣告的 drive 權限；
 * Session.getEffectiveUser 另外需要 userinfo.email 權限，作為後備方案。
 */
function resolveOwnerEmail_(ss) {
  try {
    var owner = DriveApp.getFileById(ss.getId()).getOwner();
    if (owner) {
      var fromDrive = String(owner.getEmail() || '').trim().toLowerCase();
      if (fromDrive) return fromDrive;
    }
  } catch (e) { /* 共用雲端硬碟沒有擁有者，或權限不足，改用下面的方式 */ }

  try {
    return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

/** 把試算表擁有者寫入名冊，否則部署完成後沒有任何人能登入。 */
function seedInstructor_(ss) {
  var email = resolveOwnerEmail_(ss);
  if (!email) {
    return '略過擁有者種子資料：無法取得帳號 email，請手動在 __RBAC_Roles 新增自己';
  }

  var sheet = ss.getSheetByName(SHEET.ROLES);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === email) {
      return '擁有者已存在於名冊：' + email;
    }
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = buildHeaderMap(headers);
  var row = [];
  for (var c = 0; c < headers.length; c++) row.push('');
  row[map['email']] = email;
  row[map['name']] = '管理者';
  row[map['role']] = ROLE.ADMIN;
  row[map['status']] = USER_STATUS.ACTIVE;
  sheet.appendRow(row);
  return '已將擁有者加入名冊：' + email;
}

/**
 * 應用專屬的種子資料放這裡（選用）。
 *
 * 例如預先建立好一批空白列讓使用者填寫。要點是「已有資料就不要覆蓋」，
 * 讓 setupSpreadsheet 可以安全地重複執行。
 */
function seedInitialData_(ss) {
  return '（無應用專屬種子資料）';
}

/**
 * 部署前自我檢查：一次驗證設定、工作表結構、Drive 存取與名冊。
 * 建議每次改設定後都執行一次，比部署後才發現問題快得多。
 */
function verifySetup() {
  var lines = [];
  var ok = true;

  function check(label, fn) {
    try {
      var detail = fn();
      lines.push('[通過] ' + label + (detail ? ' — ' + detail : ''));
    } catch (e) {
      ok = false;
      lines.push('[失敗] ' + label + ' — ' + (e && e.message ? e.message : e));
    }
  }

  check('時區設定', function () {
    var tz = Session.getScriptTimeZone();
    if (tz !== 'Asia/Taipei') {
      throw new Error('目前為 ' + tz + '，請在 appsscript.json 設為 Asia/Taipei');
    }
    return tz;
  });

  check('指令碼屬性 CLIENT_ID / DRIVE_FOLDER_ID', function () {
    var cfg = getConfig();
    return cfg.clientId.slice(0, 12) + '… / ' + cfg.driveFolderId;
  });

  check('試算表可存取', function () {
    return getSpreadsheet().getName();
  });

  // 工作表清單直接由 SHEET_HEADERS 推導，不另外維護一份 ——
  // 兩份清單遲早會不同步，而且不同步時的錯誤訊息完全看不出原因
  var order = listSheetNames();
  for (var i = 0; i < order.length; i++) {
    (function (name) {
      check('工作表結構 ' + name, function () {
        var t = readTable(name);
        return t.rows.length + ' 筆資料';
      });
    })(order[i]);
  }

  check('Drive 作業資料夾可寫入', function () {
    var folder = DriveApp.getFolderById(getConfig().driveFolderId);
    var probe = folder.createFile(
      Utilities.newBlob('coursesheet-hub verify', 'text/plain', '__verify_probe.txt'));
    probe.setTrashed(true);
    return folder.getName();
  });

  check('可取得帳號 email（需 userinfo.email 權限）', function () {
    var email = resolveOwnerEmail_(getSpreadsheet());
    if (!email) {
      throw new Error('無法取得 email。請確認 appsscript.json 的 oauthScopes 含有 ' +
                      'https://www.googleapis.com/auth/userinfo.email，改完後重新授權');
    }
    return email;
  });

  check('名冊中至少有一位 ACTIVE 管理者', function () {
    var roles = loadRoles();
    for (var e in roles) {
      if (roles[e].role === ROLE.ADMIN && roles[e].status === USER_STATUS.ACTIVE) return e;
    }
    throw new Error('找不到 ACTIVE 的 ADMIN，部署完成後將無人可登入管理');
  });

  check('對外網路請求可用（ID Token 驗證需要）', function () {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=invalid',
                                { muteHttpExceptions: true });
    return 'HTTP ' + res.getResponseCode();
  });

  var summary = (ok ? '=== 全部通過 ===' : '=== 有項目未通過 ===') + '\n' + lines.join('\n');
  console.log(summary);
  return summary;
}
