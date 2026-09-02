/**
 * Google Identity Services 整合。
 *
 * GIS 簽發的 ID Token 有效期只有 1 小時。過期後任何 API 呼叫都會得到
 * UNAUTHENTICATED，因此這裡提供 refresh()：先嘗試靜默續發，
 * 失敗才要求使用者重新登入。api.js 會在收到 401 時自動呼叫它。
 */

import { CLIENT_ID } from './config.js';

let currentToken = null;
let pendingResolve = null;
let onSignedOut = null;

/** 供 api.js 讀取目前的 token。 */
export function getToken() {
  return currentToken;
}

export function setSignOutHandler(fn) {
  onSignedOut = fn;
}

function handleCredential(response) {
  currentToken = response.credential;
  try { sessionStorage.setItem('cs_token', currentToken); } catch { /* 私密瀏覽模式 */ }

  if (pendingResolve) {
    // 這是 refresh() 觸發的續發，交回給等待中的呼叫者，不重新進入應用程式
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve(currentToken);
    return;
  }
  // 使用者主動登入（按鈕或 One Tap）
  window.dispatchEvent(new CustomEvent('cs:signed-in'));
}

/** 等待 GIS SDK 載入完成（script 標籤是 async defer）。 */
function waitForGis(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      if (window.google?.accounts?.id) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('無法載入 Google 登入服務，請檢查網路連線'));
      }
      setTimeout(poll, 50);
    })();
  });
}

export async function initAuth({ buttonContainer }) {
  await waitForGis();

  google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: handleCredential,
    auto_select: true,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true
  });

  google.accounts.id.renderButton(buttonContainer, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    locale: 'zh_TW',
    width: 280
  });

  // sessionStorage 中的 token 可能已過期，交由第一次 API 呼叫驗證；
  // 失敗時 api.js 會觸發 refresh()。
  try {
    const stored = sessionStorage.getItem('cs_token');
    if (stored) currentToken = stored;
  } catch { /* 忽略 */ }

  return currentToken;
}

/**
 * 靜默續發 token。
 * @returns {Promise<string|null>} 成功回傳新 token，需要使用者互動時回傳 null
 */
export function refresh(timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!window.google?.accounts?.id) return resolve(null);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      pendingResolve = null;
      resolve(value);
    };

    pendingResolve = (token) => finish(token);
    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      google.accounts.id.prompt((notification) => {
        // 無法靜默顯示時直接放棄，改走完整登入流程
        const blocked = notification.isNotDisplayed?.() ||
                        notification.isSkippedMoment?.() ||
                        notification.isDismissedMoment?.();
        if (blocked && !currentTokenChangedSince(timer)) finish(null);
      });
    } catch {
      finish(null);
    }
  });
}

// prompt 的 callback 可能早於 credential callback 觸發，這個小旗標避免誤判失敗
let lastTokenAtPrompt = null;
function currentTokenChangedSince() {
  const changed = currentToken !== lastTokenAtPrompt;
  lastTokenAtPrompt = currentToken;
  return changed;
}

export function signOut() {
  currentToken = null;
  try { sessionStorage.removeItem('cs_token'); } catch { /* 忽略 */ }
  try { google.accounts.id.disableAutoSelect(); } catch { /* 忽略 */ }
  if (onSignedOut) onSignedOut();
}
