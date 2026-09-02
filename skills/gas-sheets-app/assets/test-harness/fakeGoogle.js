import crypto from 'node:crypto';

/**
 * Google Apps Script 服務的記憶體假實作。
 *
 * 目的：讓完整的 doPost 請求路徑（驗證 → RBAC → 讀寫 → 回應）能在本機跑起來，
 * 不必部署、不碰真實試算表，也不消耗任何配額。
 */

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet.data[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = src[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      const target = this.row - 1 + r;
      while (this.sheet.data.length <= target) this.sheet.data.push([]);
      const line = this.sheet.data[target];
      for (let c = 0; c < values[r].length; c++) {
        line[this.col - 1 + c] = values[r][c];
      }
    }
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class FakeSheet {
  constructor(name, data) {
    this.name = name;
    this.data = data || [];
  }
  getName() { return this.name; }
  width() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.width(); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getMaxColumns() { return Math.max(26, this.width()); }
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    return new FakeRange(this, row, col, numRows, numCols);
  }
  appendRow(row) { this.data.push(row.slice()); return this; }
  setFrozenRows() { return this; }
  autoResizeColumns() { return this; }
}

class FakeSpreadsheet {
  constructor(name, sheets) {
    this.name = name;
    this.sheets = sheets;
  }
  getId() { return 'fake-spreadsheet-id'; }
  getName() { return this.name; }
  getSheetByName(name) { return this.sheets[name] || null; }
  getSheets() { return Object.values(this.sheets); }
  insertSheet(name) {
    this.sheets[name] = new FakeSheet(name, []);
    return this.sheets[name];
  }
  deleteSheet(sheet) { delete this.sheets[sheet.getName()]; }
}

class FakeFile {
  constructor(store, id, name, bytes) {
    this.store = store;
    this.id = id;
    this.name = name;
    this.bytes = bytes;
    this.viewers = [];
    this.access = 'PRIVATE';
    this.trashed = false;
    this.createdAt = new Date();
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return `https://drive.google.com/file/d/${this.id}/view`; }
  getDateCreated() { return this.createdAt; }
  addViewer(email) {
    if (!email) throw new Error('no email');
    if (!this.viewers.includes(email)) this.viewers.push(email);
    return this;
  }
  setSharing(access) { this.access = String(access); return this; }
  setTrashed(v) { this.trashed = !!v; return this; }
  makeCopy(name, folder) {
    const copy = this.store.createFileRaw(name, this.bytes);
    folder.fileIds.push(copy.id);
    return copy;
  }
}

class FakeFolder {
  constructor(store, id, name) {
    this.store = store;
    this.id = id;
    this.name = name;
    this.fileIds = [];
  }
  getId() { return this.id; }
  getName() { return this.name; }
  createFile(blob) {
    const file = this.store.createFileRaw(blob.getName(), blob.getBytes());
    this.fileIds.push(file.id);
    return file;
  }
  createFolder(name) { return this.store.createFolder(name); }
  getFoldersByName() { return { hasNext: () => false, next: () => null }; }
  getFiles() {
    const files = this.fileIds.map((id) => this.store.files.get(id)).filter((f) => f && !f.trashed);
    let i = 0;
    return { hasNext: () => i < files.length, next: () => files[i++] };
  }
}

/**
 * 建立整組假服務。
 * @param {Object} options
 * @param {Object<string, Array<Array<any>>>} options.sheets 工作表名稱 → 二維陣列（含標頭列）
 * @param {Object<string, string>} options.tokens ID Token → 已驗證的 email
 * @param {Object<string, string>} [options.properties] 指令碼屬性
 */
export function createFakeGoogle({ sheets, tokens = {}, properties = {} }) {
  const sheetObjects = {};
  for (const [name, rows] of Object.entries(sheets)) {
    sheetObjects[name] = new FakeSheet(name, rows.map((r) => r.slice()));
  }
  const spreadsheet = new FakeSpreadsheet('CourseSheet Hub (fake)', sheetObjects);

  const driveStore = {
    files: new Map(),
    folders: new Map(),
    seq: 0,
    createFileRaw(name, bytes) {
      const id = `file-${++this.seq}`;
      const f = new FakeFile(this, id, name, bytes);
      this.files.set(id, f);
      return f;
    },
    createFolder(name) {
      const id = `folder-${++this.seq}`;
      const f = new FakeFolder(this, id, name);
      this.folders.set(id, f);
      return f;
    }
  };
  const rootFolder = driveStore.createFolder('Homework');

  const props = {
    CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    DRIVE_FOLDER_ID: rootFolder.getId(),
    ...properties
  };

  const cacheStore = new Map();
  const lockState = { held: false };
  const fetchLog = [];

  let uuidSeq = 0;

  const services = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: () => spreadsheet
    },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; }
      })
    },

    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cacheStore.has(k) ? cacheStore.get(k) : null),
        put: (k, v) => { cacheStore.set(k, v); },
        remove: (k) => { cacheStore.delete(k); },
        removeAll: (keys) => { keys.forEach((k) => cacheStore.delete(k)); }
      })
    },

    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (lockState.held) return false;
          lockState.held = true;
          return true;
        },
        releaseLock: () => { lockState.held = false; }
      })
    },

    UrlFetchApp: {
      fetch: (url) => {
        fetchLog.push(url);
        const match = /id_token=([^&]+)/.exec(url);
        const token = match ? decodeURIComponent(match[1]) : '';
        const email = tokens[token];
        if (!email) {
          return {
            getResponseCode: () => 400,
            getContentText: () => JSON.stringify({ error: 'invalid_token' })
          };
        }
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            aud: props.CLIENT_ID,
            iss: 'https://accounts.google.com',
            email,
            email_verified: 'true',
            exp: String(Math.floor(Date.now() / 1000) + 3600)
          })
        };
      }
    },

    Utilities: {
      getUuid: () => `uuid-${++uuidSeq}`,
      base64Encode: (input) => Buffer.from(
        typeof input === 'string' ? input : Uint8Array.from(input.map((b) => b & 0xff))
      ).toString('base64'),
      base64Decode: (b64) => {
        const buf = Buffer.from(b64, 'base64');
        // GAS 回傳有號位元組，這裡忠實模擬
        return Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
      },
      computeDigest: (_algo, text) =>
        Array.from(crypto.createHash('sha256').update(String(text)).digest())
          .map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      newBlob: (bytes, contentType, name) => ({
        getBytes: () => bytes,
        getName: () => name,
        getContentType: () => contentType
      }),
      formatDate: (date, _tz, fmt) => {
        const d = new Date(date.getTime() + 8 * 3600 * 1000);
        const p = (n) => String(n).padStart(2, '0');
        return fmt
          .replace('yyyy', d.getUTCFullYear())
          .replace('MM', p(d.getUTCMonth() + 1))
          .replace('dd', p(d.getUTCDate()))
          .replace('HH', p(d.getUTCHours()))
          .replace('mm', p(d.getUTCMinutes()));
      }
    },

    DriveApp: {
      getFolderById: (id) => {
        const f = driveStore.folders.get(id);
        if (!f) throw new Error('folder not found: ' + id);
        return f;
      },
      getFileById: (id) => {
        const f = driveStore.files.get(id);
        if (!f) throw new Error('file not found: ' + id);
        return f;
      },
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
      Permission: { VIEW: 'VIEW', NONE: 'NONE' }
    },

    ContentService: {
      createTextOutput: (text) => ({
        content: text,
        setMimeType() { return this; },
        getContent() { return this.content; }
      }),
      MimeType: { JSON: 'JSON' }
    },

    Session: {
      getEffectiveUser: () => ({ getEmail: () => 'instructor@example.com' }),
      getScriptTimeZone: () => 'Asia/Taipei'
    },

    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({
        timeBased: () => ({
          onWeekDay: () => ({ atHour: () => ({ create: () => {} }) })
        })
      }),
      WeekDay: { MONDAY: 'MONDAY' }
    }
  };

  return {
    services,
    spreadsheet,
    sheetObjects,
    tokens,
    driveStore,
    rootFolder,
    cacheStore,
    fetchLog,
    /** 取得某工作表目前的資料列（不含標頭），供斷言使用 */
    rowsOf(name) {
      const sheet = sheetObjects[name];
      const values = sheet.data;
      const headers = values[0].map((h) => String(h).trim());
      return values.slice(1)
        .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
        .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
    }
  };
}
