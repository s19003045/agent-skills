/**
 * Apps Script Web App 用戶端。
 *
 * 兩個關鍵細節：
 *
 * 1. Content-Type 必須是 text/plain。
 *    Apps Script 不回應 CORS preflight（OPTIONS）請求，若用 application/json
 *    瀏覽器會先送 preflight，得不到回應，整個請求就失敗。改用 text/plain 可讓
 *    瀏覽器視為「簡單請求」而略過 preflight。內容仍然是 JSON 字串，
 *    後端以 JSON.parse(e.postData.contents) 解析。
 *
 * 2. /exec 會 302 轉址到 script.googleusercontent.com，因此必須允許跟隨轉址。
 */

import { GAS_URL } from './config.js';
import { getToken, refresh } from './auth.js';

/** 對應後端 06_lock.js 取鎖失敗時回傳的錯誤碼。 */
const RETRYABLE = new Set(['SYSTEM_BUSY']);
const MAX_RETRIES = 3;

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rawPost(payload) {
  const response = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new ApiError('NETWORK_ERROR', `伺服器回應 HTTP ${response.status}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    // Apps Script 發生未捕捉的錯誤時會回傳 HTML 錯誤頁而非 JSON
    throw new ApiError('BAD_RESPONSE', '伺服器回應格式錯誤，請確認 Apps Script 部署狀態');
  }
}

/**
 * 呼叫一個 action。
 * @param {string} action
 * @param {Object} [data]
 * @returns {Promise<Object>} 成功時的 data
 * @throws {ApiError}
 */
export async function callAction(action, data = {}) {
  let refreshed = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const idToken = getToken();
    if (!idToken) throw new ApiError('UNAUTHENTICATED', '尚未登入');

    let result;
    try {
      result = await rawPost({ idToken, action, data });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('NETWORK_ERROR', '無法連線到伺服器，請檢查網路');
    }

    if (result.success) return result.data;

    const { code, message } = result.error ?? {};

    // Token 過期：靜默續發後重試一次
    if (code === 'UNAUTHENTICATED' && !refreshed) {
      refreshed = true;
      const fresh = await refresh();
      if (fresh) continue;
      throw new ApiError('UNAUTHENTICATED', '登入已過期，請重新登入');
    }

    // 取鎖失敗：指數退避重試（100 人同時簽到時會發生）
    if (RETRYABLE.has(code) && attempt < MAX_RETRIES) {
      await sleep(400 * 2 ** attempt + Math.random() * 200);
      continue;
    }

    throw new ApiError(code ?? 'INTERNAL_ERROR', message ?? '操作失敗');
  }

  throw new ApiError('SYSTEM_BUSY', '系統忙碌中，請稍後再試');
}

/** 將 File 讀成 Base64（去除 data URL 前綴）。 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const index = result.indexOf('base64,');
      resolve(index >= 0 ? result.slice(index + 7) : result);
    };
    reader.onerror = () => reject(new ApiError('FILE_READ_ERROR', '讀取檔案失敗'));
    reader.readAsDataURL(file);
  });
}
