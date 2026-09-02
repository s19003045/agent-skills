/**
 * 部署設定 —— 完成部署後把下面兩個預設值換掉。
 *
 * 這兩個值在架構上本來就是公開的：瀏覽器必須知道它們才能運作，
 * 任何人打開網站看原始碼都拿得到。它們不是密鑰，放進版控沒有問題。
 * 真正的機密（Service Account 金鑰之類）在這個架構下根本不存在 ——
 * 敏感設定都放在 Apps Script 的指令碼屬性裡，不會出現在前端。
 *
 * globalThis.COURSESHEET_CONFIG 可在載入本模組前覆寫這兩個值，
 * 離線預覽或多環境部署可利用這個機制。
 */
const overrides = globalThis.COURSESHEET_CONFIG ?? {};

/** Google Cloud Console 建立的 OAuth 2.0 用戶端 ID（網頁應用程式） */
export const CLIENT_ID = String(overrides.clientId ?? '').trim();

/** Apps Script 部署為 Web App 後取得的 /exec 網址 */
export const GAS_URL = String(overrides.gasUrl ?? '').trim();

export function isConfigured() {
  return CLIENT_ID !== '' && GAS_URL !== '';
}
