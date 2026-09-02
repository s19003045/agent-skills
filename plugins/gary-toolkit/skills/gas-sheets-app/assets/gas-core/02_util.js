/**
 * 純函式工具層 — 不依賴任何 Apps Script 全域物件，可在本機單元測試。
 *
 * 這一層存在的理由：Apps Script 的除錯體驗很差（沒有中斷點、log 要重新部署才看得到）。
 * 把所有不需要碰 SpreadsheetApp / DriveApp 的邏輯集中在這裡，就能在本機用
 * vitest 秒級迭代，只留薄薄一層轉接去碰 Google 的服務。
 */

/* ---------- 型別正規化（防 Google Sheet 自動轉型）---------- */

/**
 * 將儲存格值正規化為字串。
 * 同時移除寫入時為了避開公式而加上的跳脫單引號（見 escapeForSheet）。
 */
function normStr(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return formatLocalIso(v.getTime());
  var s = String(v).trim();
  if (s.length > 1 && s.charAt(0) === "'" && '=+-@'.indexOf(s.charAt(1)) >= 0) {
    s = s.slice(1);
  }
  return s;
}

function normLower(v) {
  return normStr(v).toLowerCase();
}

/** Sheet 可能回傳 boolean true 或字串 'TRUE'，兩者都要接受。 */
function normBool(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  var s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1';
}

function normInt(v, fallback) {
  var s = normStr(v);
  if (s === '') return fallback === undefined ? null : fallback;
  var n = parseInt(s, 10);
  if (isNaN(n)) return fallback === undefined ? null : fallback;
  return n;
}

/**
 * 寫入 Sheet 前的跳脫：開頭為 = + - @ 的字串會被當成公式，
 * 前置單引號可讓 Sheets 視為純文字（該引號不屬於儲存格的值）。
 */
function escapeForSheet(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  var s = String(v);
  if (s.length > 0 && '=+-@'.indexOf(s.charAt(0)) >= 0) return "'" + s;
  return s;
}

/* ---------- 標頭動態對照（禁止寫死欄位座標）---------- */

function buildHeaderMap(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var key = normStr(headers[i]);
    if (key !== '' && !Object.prototype.hasOwnProperty.call(map, key)) map[key] = i;
  }
  return map;
}

/** 缺欄位時立刻拋錯（fail fast），而不是等到執行到一半才出現空值。 */
function assertHeaders(headerMap, required, sheetName) {
  var missing = [];
  for (var i = 0; i < required.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(headerMap, required[i])) missing.push(required[i]);
  }
  if (missing.length) {
    fail('SCHEMA_ERROR', '工作表「' + sheetName + '」缺少欄位：' + missing.join('、'));
  }
  return true;
}

/** 將一列陣列依標頭對照轉為物件。 */
function rowToObject(row, headerMap) {
  var obj = {};
  for (var key in headerMap) {
    if (Object.prototype.hasOwnProperty.call(headerMap, key)) {
      obj[key] = row[headerMap[key]];
    }
  }
  return obj;
}

/** 將物件依標頭順序轉回列陣列，未提供的欄位保留 keepRow 中的原值。 */
function objectToRow(obj, headers, keepRow) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var key = headers[i];
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      row.push(escapeForSheet(obj[key]));
    } else {
      row.push(keepRow && keepRow.length > i ? keepRow[i] : '');
    }
  }
  return row;
}

/* ---------- 時間（Asia/Taipei 固定 UTC+8）---------- */

/**
 * 解析 'YYYY-MM-DD HH:mm' / 'YYYY-MM-DDTHH:mm:ss' 台北本地時間為 epoch 毫秒。
 * 無法解析時回傳 NaN。
 */
function parseLocalDateTime(text) {
  var s = normStr(text);
  if (s === '') return NaN;
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return NaN;
  var y = +m[1], mo = +m[2], d = +m[3];
  var h = m[4] === undefined ? 0 : +m[4];
  var mi = m[5] === undefined ? 0 : +m[5];
  var se = m[6] === undefined ? 0 : +m[6];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return NaN;
  var utc = Date.UTC(y, mo - 1, d, h, mi, se);
  var check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return NaN;  // 例如 2026-02-30 這種不存在的日期
  }
  return utc - LOCAL_UTC_OFFSET_MINUTES * 60000;
}

/** 輸出含時區偏移的 ISO8601，例如 2026-09-02T19:00:00+08:00 */
function formatLocalIso(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return '';
  var d = new Date(ms + LOCAL_UTC_OFFSET_MINUTES * 60000);
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) +
         'T' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()) +
         formatOffsetSuffix();
}

/** 由 LOCAL_UTC_OFFSET_MINUTES 產生 ISO8601 的偏移字尾，例如 +08:00。 */
function formatOffsetSuffix() {
  var total = LOCAL_UTC_OFFSET_MINUTES;
  var sign = total < 0 ? '-' : '+';
  var abs = Math.abs(total);
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  return sign + p2(Math.floor(abs / 60)) + ':' + p2(abs % 60);
}

/* ---------- 檔案 ---------- */

function sanitizeFileName(name) {
  var s = normStr(name)
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')  // 控制字元
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}

function extFromFileName(name) {
  var s = normStr(name);
  var i = s.lastIndexOf('.');
  if (i <= 0 || i === s.length - 1) return '';
  return s.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildSubmissionFileName(week, studentId, studentName, ext) {
  var w = normInt(week, 0);
  var id = sanitizeFileName(studentId).replace(/\s+/g, '') || 'NA';
  var nm = sanitizeFileName(studentName).replace(/\s+/g, '') || 'NA';
  var base = 'Week' + w + '_' + id + '_' + nm;
  var e = normStr(ext).toLowerCase().replace(/[^a-z0-9]/g, '');
  return e ? base + '.' + e : base;
}

/**
 * 以檔頭魔術位元組判定真實檔案型別，不信任使用者提供的副檔名。
 * 注意 Utilities.base64Decode 回傳的是有號位元組（-128~127），故需 & 0xFF。
 */
function detectFileType(bytes) {
  if (!bytes || bytes.length < 4) return null;
  var b = [];
  for (var i = 0; i < 4; i++) b.push(bytes[i] & 0xFF);
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0x50 && b[1] === 0x4B &&
      (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return 'zip';
  return null;
}

/** 去除 data URL 前綴，回傳純 Base64 內容。 */
function stripDataUrlPrefix(text) {
  var s = normStr(text);
  var i = s.indexOf('base64,');
  return i >= 0 ? s.slice(i + 7) : s;
}

/** Base64 字串解碼後的位元組數（不需真的解碼，用於上傳前的大小檢查）。 */
function base64ByteLength(b64) {
  var s = normStr(b64).replace(/\s+/g, '');
  if (s === '') return 0;
  var padding = 0;
  if (s.charAt(s.length - 1) === '=') padding++;
  if (s.charAt(s.length - 2) === '=') padding++;
  return Math.floor(s.length / 4) * 3 - padding;
}

/* ---------- 其他 ---------- */

/** 排除易混淆字元（0/O、1/I/L）的簽到碼字元集。 */
var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function isValidCheckinCodeFormat(code) {
  var s = normStr(code).toUpperCase();
  if (s.length !== 4) return false;
  for (var i = 0; i < s.length; i++) {
    if (CODE_ALPHABET.indexOf(s.charAt(i)) < 0) return false;
  }
  return true;
}

function clampInt(v, min, max) {
  var n = normInt(v, null);
  if (n === null) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function truncate(text, max) {
  var s = normStr(text);
  return s.length > max ? s.slice(0, max) : s;
}
