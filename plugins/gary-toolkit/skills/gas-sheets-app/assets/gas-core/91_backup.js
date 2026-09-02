/**
 * 每週自動備份。
 *
 * Google Sheet 沒有交易機制，人為誤刪或程式錯誤只能靠快照還原，
 * 因此這不是選配功能。
 */

var BACKUP_FOLDER_NAME = 'CourseSheetHub_Backups';
var BACKUP_KEEP = 8;

function createWeeklyBackup() {
  var ss = getSpreadsheet();
  var parent = DriveApp.getFolderById(getConfig().driveFolderId);

  var folders = parent.getFoldersByName(BACKUP_FOLDER_NAME);
  var backupFolder = folders.hasNext() ? folders.next() : parent.createFolder(BACKUP_FOLDER_NAME);

  var stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd_HHmm');
  var copy = DriveApp.getFileById(ss.getId()).makeCopy('backup_' + stamp, backupFolder);

  pruneBackups_(backupFolder);
  console.log('備份完成：' + copy.getName());
  return copy.getName();
}

/** 只保留最近 BACKUP_KEEP 份。 */
function pruneBackups_(folder) {
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    files.push({ file: f, time: f.getDateCreated().getTime() });
  }
  files.sort(function (a, b) { return b.time - a.time; });
  for (var i = BACKUP_KEEP; i < files.length; i++) {
    files[i].file.setTrashed(true);
  }
}

/** 安裝每週備份觸發器（重複執行不會產生重複觸發器）。 */
function installTriggers() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'createWeeklyBackup') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger('createWeeklyBackup')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(3)
    .create();
  console.log('已安裝每週一 03:00 的備份觸發器');
  return 'ok';
}
