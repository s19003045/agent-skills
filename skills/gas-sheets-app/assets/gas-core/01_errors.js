/** 應用層錯誤：帶有給前端判讀用的錯誤碼。 */
function AppError(code, message) {
  this.name = 'AppError';
  this.code = code || 'INTERNAL_ERROR';
  this.message = message || '系統發生錯誤';
  this.isAppError = true;
  this.stack = (new Error(this.message)).stack;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

function fail(code, message) {
  throw new AppError(code, message);
}
