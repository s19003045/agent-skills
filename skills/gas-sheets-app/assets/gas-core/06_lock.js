/**
 * 併發控制。
 *
 * 三個寫入路徑（簽到、繳交、批改）都必須以此包住完整的「讀 → 檢查 → 寫」，
 * 否則會出現重複簽到或分數互相覆蓋。見 docs/SRS.md §5.3。
 *
 * 使用 tryLock 而非 waitLock：前者回傳布林值，可轉成可重試的 SYSTEM_BUSY，
 * 後者會直接拋出例外，難以與其他錯誤區分。
 */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LIMITS.LOCK_WAIT_MS)) {
    fail('SYSTEM_BUSY', '系統忙碌中，請稍後再試');
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e) { /* 忽略 */ }
  }
}
