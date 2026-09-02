import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// 依你的專案結構調整這個路徑
const GAS_DIR = path.resolve(fileURLToPath(new URL('../../gas', import.meta.url)));

/**
 * 將 gas/ 目錄下的原始碼載入獨立的 VM 沙箱。
 *
 * 之所以用 vm 而不是 import：GAS 檔案不能有 import/export（Apps Script 不支援 ES Module），
 * 而頂層 var/function 會掛到 globalThis。用 vm 載入等於測試「實際部署的那份原始碼」，
 * 不需要為了測試而複製一份邏輯。
 *
 * @param {Object} globals 要注入沙箱的 Google 服務假實作
 * @param {string[]} [only] 只載入指定檔案（預設全部，依檔名排序＝Apps Script 的載入順序）
 */
export function loadGas(globals = {}, only = null) {
  const sandbox = { console, ...globals };
  const context = vm.createContext(sandbox);

  const files = only ?? readdirSync(GAS_DIR).filter((f) => f.endsWith('.js')).sort();
  for (const file of files) {
    const code = readFileSync(path.join(GAS_DIR, file), 'utf8');
    vm.runInContext(code, context, { filename: `gas/${file}` });
  }

  // 提供沙箱內的建構子，讓測試能建立與沙箱同 realm 的物件（instanceof 才會成立）
  vm.runInContext(
    'this.__makeDate = function (ms) { return new Date(ms); };',
    context
  );

  return sandbox;
}

/** 執行一段會拋出 AppError 的程式，回傳該錯誤（未拋出則測試失敗）。 */
export function captureError(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('預期會拋出錯誤，但沒有');
}
