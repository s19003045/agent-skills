/**
 * 試算表存取層。所有欄位定位一律透過標頭動態對照，禁止寫死儲存格座標。
 */

function getSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    fail('CONFIG_MISSING', '找不到試算表：請設定 SPREADSHEET_ID 指令碼屬性，或將此指令碼繫結於試算表');
  }
  return ss;
}

function getSheetByName(name) {
  var sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) fail('SCHEMA_ERROR', '找不到工作表「' + name + '」，請先執行 setupSpreadsheet()');
  return sheet;
}

function isBlankRow(row) {
  for (var i = 0; i < row.length; i++) {
    if (normStr(row[i]) !== '') return false;
  }
  return true;
}

/**
 * 讀取整張工作表。
 * 回傳的每列物件附帶 __row（1-based 實際列號），供後續定位更新。
 */
function readTable(name) {
  var sheet = getSheetByName(name);
  var values = sheet.getDataRange().getValues();
  if (values.length === 0) fail('SCHEMA_ERROR', '工作表「' + name + '」沒有標頭列');

  var headers = [];
  for (var h = 0; h < values[0].length; h++) headers.push(normStr(values[0][h]));

  var headerMap = buildHeaderMap(headers);
  assertHeaders(headerMap, SHEET_HEADERS[name], name);

  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (isBlankRow(values[i])) continue;
    var obj = rowToObject(values[i], headerMap);
    obj.__row = i + 1;
    rows.push(obj);
  }
  return { name: name, sheet: sheet, headers: headers, headerMap: headerMap, rows: rows };
}

/** 附加一列。回傳新列的列號。 */
function tableAppend(table, obj) {
  var row = objectToRow(obj, table.headers, null);
  table.sheet.appendRow(row);
  return table.sheet.getLastRow();
}

/**
 * 更新指定列。
 * 會在寫入前「重新讀取該列現值」再合併，避免以過期資料覆蓋他人剛寫入的欄位。
 * 必須在 withLock 內呼叫。
 */
function tableUpdate(table, rowNumber, partial) {
  var width = table.headers.length;
  var range = table.sheet.getRange(rowNumber, 1, 1, width);
  var current = range.getValues()[0];
  range.setValues([objectToRow(partial, table.headers, current)]);
}

function findRowById(table, id) {
  var target = normStr(id);
  if (target === '') return null;
  for (var i = 0; i < table.rows.length; i++) {
    if (normStr(table.rows[i].id) === target) return table.rows[i];
  }
  return null;
}

function findRowByWeekAndEmail(table, week, email) {
  var w = normInt(week, null);
  var e = normLower(email);
  for (var i = 0; i < table.rows.length; i++) {
    if (normInt(table.rows[i].week, null) === w &&
        normLower(table.rows[i].student_email) === e) {
      return table.rows[i];
    }
  }
  return null;
}

function newId() {
  return Utilities.getUuid();
}

function nowMs() {
  return Date.now();
}
