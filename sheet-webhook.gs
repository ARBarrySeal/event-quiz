// Google Apps Script: paste into Extensions > Apps Script on the check-in Google Sheet.
// 1. Project Settings > Script properties: add SECRET = (same value as SHEET_SECRET on the server)
// 2. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
// 3. Copy the /exec URL into SHEET_WEBHOOK_URL on the server.
const COLS = ['time', 'eventTitle', 'event', 'pin', 'name', 'email', 'phone', 'linkedin', 'consent'];

function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  if (d.secret !== PropertiesService.getScriptProperties().getProperty('SECRET')) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'bad secret' }));
  }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sh.getLastRow() === 0) sh.appendRow(COLS);
    // Leading ' stops Sheets from running a formula someone typed into a form field
    sh.appendRow(COLS.map(c => { const v = d[c] ?? ''; return /^[=+\-@]/.test(String(v)) ? "'" + v : v; }));
  } finally { lock.releaseLock(); }
  return ContentService.createTextOutput(JSON.stringify({ ok: true }));
}
