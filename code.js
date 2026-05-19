/**
 * בית ויליאמס - Backend
 *
 * הוראות:
 *   1. צור Google Sheet חדש
 *   2. Extensions → Apps Script
 *   3. הדבק את הקוד הזה ב-Code.gs
 *   4. עדכן את SPREADSHEET_ID למטה ל-ID של הגיליון החדש
 *      ה-ID נמצא ב-URL בין /d/ ל-/edit
 *   5. הוסף קובץ HTML חדש בשם "Index" והדבק את index.html
 *   6. הרץ פעם אחת את setup()
 *   7. Deploy → New deployment → Web app, Execute as: Me, Anyone has access
 *
 * משתמשים: ערוך אותם ישירות בטאב 'users' בגיליון.
 * role יכול להיות: admin / bookings / maint / house
 */

// ⚙ עדכן את ה-ID של הגיליון:
const SPREADSHEET_ID = '1zEJS5MV8tD0Op9QKOcNGoeTihRDk7ROPFJb70aP-AaY';

const SHEETS = {
  users:          ['username','password','role','display'],
  maintenance:    ['id','title','description','location','dueDate','status','source','urgency','createdByName','createdAt','completedAt'],
  turnovers:      ['id','room','date','guests','children','babies','hasCrib','hasHighChair','notes','isReturning','isOccupied','status','gardenDone','gardenDoneAt','createdAt','completedAt','reportSource','eventType','bookingId','arrivalDate','departureDate','reportMonth'],
  notifications:  ['id','for','message','room','date','read','createdAt','pushSent'],
  shopping:       ['id','item','quantity','note','requestedBy','status','requestedAt','purchasedAt','category'],
  hours:          ['id','userId','userName','date','startTime','endTime','totalHours','createdAt'],
  pool_logs:      ['id','type','doneAt','doneBy','notes'],
  pool_equipment: ['id','name','lastReplaced','notes'],
  report_sync:    ['id','syncedAt','arrivals','departures','sameDay','newRows','changedRows','unchangedRows','removedRows','writtenRows','skippedRows','manualOverrides','totalRows','status','message','reportMonth'],
  messages:       ['id','threadId','from','fromName','to','toName','message','read','createdAt','expiresAt'],
};

const DEFAULT_USERS = [
  ['eldad', '050571', 'admin',    'אלדד'],
  ['ifat',  '1234',   'bookings', 'יפעת'],
  ['offer', '03907',  'maint',    'עופר'],
  ['jude',  '12345',  'house',    'ג׳וד'],
];

const DEFAULT_POOL_EQUIPMENT = [
  ['eq_uv_1', 'מנורת UV', '', ''],
];

function getSS() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureSheet(name) {
  const ss = getSS();
  let sheet = ss.getSheetByName(name);
  if (!sheet && SHEETS[name]) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, SHEETS[name].length)
      .setValues([SHEETS[name]])
      .setFontWeight('bold')
      .setBackground('#F0F0F0');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function cleanupExpiredMessages() {
  const sheet = ensureSheet('messages');
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const headers = SHEETS.messages;
  const expiresAtIndex = headers.indexOf('expiresAt');
  if (expiresAtIndex === -1) return 0;

  const now = new Date().getTime();
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  let removed = 0;

  for (let i = rows.length - 1; i >= 0; i--) {
    const value = rows[i][expiresAtIndex];
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (time && time <= now) {
      sheet.deleteRow(i + 2);
      removed += 1;
    }
  }

  return removed;
}

/** הרץ פעם אחת */
function setup() {
  const ss = getSS();

  Object.keys(SHEETS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);

    const headers = SHEETS[name];

    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#F0F0F0');

    sheet.setFrozenRows(1);
  });

  const usersSheet = ss.getSheetByName('users');
  if (usersSheet.getLastRow() <= 1) {
    usersSheet.getRange(2, 1, DEFAULT_USERS.length, 4).setValues(DEFAULT_USERS);
  }

  const eqSheet = ss.getSheetByName('pool_equipment');
  if (eqSheet.getLastRow() <= 1) {
    eqSheet.getRange(2, 1, DEFAULT_POOL_EQUIPMENT.length, 4).setValues(DEFAULT_POOL_EQUIPMENT);
  }

  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (def && def.getLastRow() <= 1) {
    try {
      ss.deleteSheet(def);
    } catch (e) {}
  }

  Logger.log('✅ Setup complete');
}

/** מחיקה של נתונים, משאיר users + headers */
function clearAllData() {
  const ss = getSS();

  ['maintenance','turnovers','notifications','shopping','hours','pool_logs','report_sync','messages'].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    }
  });

  Logger.log('✅ Data cleared');
}

function doGet(e) {
  if (e && e.parameter && e.parameter.action) {
    return handleApiGet(e);
  }

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('בית ויליאמס')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function handleApiGet(e) {
  try {
    if (e.parameter.action === 'read') {
      cleanupExpiredMessages();
      const result = {};

      Object.keys(SHEETS).forEach(name => {
        result[name] = readSheet(name);
      });

      return jsonResponse({ ok: true, data: result });
    }

    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    cleanupExpiredMessages();
    const body = JSON.parse(e.postData.contents);
    const { table, op, record, id, rows, summary } = body;

    if (!SHEETS[table]) {
      throw new Error('Unknown table: ' + table);
    }

    if (table === 'users') {
      throw new Error('Users are read-only via API');
    }

    let result;

    if (op === 'add') {
      result = addRecord(table, record);
    } else if (op === 'update') {
      result = updateRecord(table, record);
    } else if (op === 'delete') {
      result = deleteRecord(table, id);
    } else if (table === 'turnovers' && op === 'syncReports') {
      result = syncReportTurnovers(rows || [], summary || {});
    } else {
      throw new Error('Unknown op: ' + op);
    }

    return jsonResponse({ ok: true, result });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function readSheet(name) {
  const sheet = getSS().getSheetByName(name);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const headers = SHEETS[name];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  return values.map(row => {
    const obj = {};

    headers.forEach((h, i) => {
      let v = row[i];

      if (
        h === 'hasCrib' ||
        h === 'hasHighChair' ||
        h === 'isReturning' ||
        h === 'isOccupied' ||
        h === 'read' ||
        h === 'gardenDone'
      ) {
        v = v === true || v === 'TRUE' || v === 'true';
      } else if (
        h === 'guests' ||
        h === 'children' ||
        h === 'babies' ||
        h === 'quantity' ||
        h === 'totalHours' ||
        h === 'arrivals' ||
        h === 'departures' ||
        h === 'sameDay' ||
        h === 'newRows' ||
        h === 'changedRows' ||
        h === 'unchangedRows' ||
        h === 'removedRows' ||
        h === 'writtenRows' ||
        h === 'skippedRows' ||
        h === 'manualOverrides' ||
        h === 'totalRows'
      ) {
        v = (v === '' || v === null) ? null : Number(v);
      } else if (
        (h === 'date' || h === 'dueDate' || h === 'lastReplaced') &&
        v instanceof Date
      ) {
        const yyyy = v.getFullYear();
        const mm = String(v.getMonth() + 1).padStart(2, '0');
        const dd = String(v.getDate()).padStart(2, '0');
        v = `${yyyy}-${mm}-${dd}`;
      } else if (v instanceof Date) {
        v = v.toISOString();
      } else if (h === 'password') {
        v = String(v);
      }

      obj[h] = v;
    });

    return obj;
  });
}

function addRecord(table, record) {
  const sheet = ensureSheet(table);
  const headers = SHEETS[table];

  const row = headers.map(h => {
    if (h === 'pushSent') return '';
    return record[h] === undefined || record[h] === null ? '' : record[h];
  });

  sheet.appendRow(row);
  return record;
}

function updateRecord(table, record) {
  const sheet = ensureSheet(table);
  const headers = SHEETS[table];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error('Empty table');
  }

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
  const idx = ids.findIndex(x => String(x) === String(record.id));

  if (idx === -1) {
    throw new Error('Not found: ' + record.id);
  }

  const row = headers.map(h => {
    if (h === 'pushSent') {
      return record[h] === undefined || record[h] === null ? '' : record[h];
    }

    return record[h] === undefined || record[h] === null ? '' : record[h];
  });

  sheet.getRange(idx + 2, 1, 1, headers.length).setValues([row]);
  return record;
}

function deleteRecord(table, id) {
  const sheet = ensureSheet(table);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
  const idx = ids.findIndex(x => String(x) === String(id));

  if (idx === -1) return null;

  sheet.deleteRow(idx + 2);

  return { id, deleted: true };
}

function isReportTurnover_(row, headers) {
  const idIndex = headers.indexOf('id');
  const reportSourceIndex = headers.indexOf('reportSource');
  const id = idIndex === -1 ? '' : String(row[idIndex] || '');
  const source = reportSourceIndex === -1 ? '' : String(row[reportSourceIndex] || '').trim().toLowerCase();
  return id.indexOf('report-') === 0 || source === 'report' || source === 'local';
}

function roomDateKey_(record) {
  const room = String(record.room || '').trim().toLowerCase();
  const date = String(record.date || '').slice(0, 10);
  return room && date ? room + '|' + date : '';
}

function recordMonthKey_(record) {
  return String(record.date || '').slice(0, 7);
}

function createReportSyncNotifications_(summary) {
  const hasChanges =
    Number(summary.newRows || 0) > 0 ||
    Number(summary.changedRows || 0) > 0 ||
    Number(summary.removedRows || 0) > 0 ||
    Number(summary.manualOverrides || 0) > 0;

  if (!hasChanges) return [];

  const message = [
    'דוחות כניסות ועזיבות נשמרו בשיטס',
    Number(summary.newRows || 0) + ' חדשים',
    Number(summary.changedRows || 0) + ' שונו',
    Number(summary.removedRows || 0) + ' הוסרו',
    Number(summary.sameDay || 0) + ' החלפות'
  ].join(' · ');

  return ['house', 'bookings', 'admin'].map(target => ({
    id: 'report-notice-' + new Date().getTime() + '-' + target,
    for: target,
    message: message,
    room: 'דוחות',
    date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    read: false,
    createdAt: new Date().toISOString(),
    pushSent: ''
  }));
}

function ensureSheetHeaders_(name) {
  const ss = getSS();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const headers = SHEETS[name];
  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#F0F0F0');
  sheet.setFrozenRows(1);

  return sheet;
}

function normalizeSyncValue_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  if (value === true || value === 'TRUE' || value === 'true') return 'true';
  if (value === false || value === 'FALSE' || value === 'false' || value === null || value === undefined) return '';

  return String(value).trim();
}

const REPORT_COMPARE_FIELDS = ['id','room','date','guests','children','babies','notes','isOccupied','eventType','bookingId','arrivalDate','departureDate','reportMonth'];
const REPORT_UPDATE_FIELDS = ['id','room','date','guests','children','babies','notes','isOccupied','reportSource','eventType','bookingId','arrivalDate','departureDate','reportMonth'];

function rowToRecord_(row, headers) {
  const record = {};
  headers.forEach((header, index) => {
    record[header] = row[index];
  });
  return record;
}

function recordToRow_(record, headers) {
  return headers.map(header => record[header] === undefined || record[header] === null ? '' : record[header]);
}

function reportRecordsEqual_(currentRecord, nextRecord) {
  for (let i = 0; i < REPORT_COMPARE_FIELDS.length; i++) {
    const field = REPORT_COMPARE_FIELDS[i];
    if (normalizeSyncValue_(currentRecord[field]) !== normalizeSyncValue_(nextRecord[field])) {
      return false;
    }
  }

  return true;
}

function mergeReportRecord_(currentRecord, nextRecord) {
  const merged = Object.assign({}, currentRecord);
  REPORT_UPDATE_FIELDS.forEach(field => {
    merged[field] = nextRecord[field];
  });
  merged.reportSource = 'report';
  return merged;
}

function appendReportSync_(summary) {
  ensureSheetHeaders_('report_sync');

  const record = {
    id: 'report-sync-' + new Date().getTime(),
    syncedAt: new Date().toISOString(),
    arrivals: Number(summary.arrivals || 0),
    departures: Number(summary.departures || 0),
    sameDay: Number(summary.sameDay || 0),
    newRows: Number(summary.newRows || 0),
    changedRows: Number(summary.changedRows || 0),
    unchangedRows: Number(summary.unchangedRows || 0),
    removedRows: Number(summary.removedRows || 0),
    writtenRows: Number(summary.writtenRows || 0),
    skippedRows: Number(summary.skippedRows || 0),
    manualOverrides: Number(summary.manualOverrides || 0),
    totalRows: Number(summary.totalRows || 0),
    status: summary.status || 'ok',
    message: summary.message || '',
    reportMonth: summary.reportMonth || ''
  };

  addRecord('report_sync', record);
  return record;
}

function syncReportTurnovers(rows, summary) {
  if (!Array.isArray(rows)) {
    throw new Error('rows must be an array');
  }

  const sheet = ensureSheetHeaders_('turnovers');
  const headers = SHEETS.turnovers;
  const lastRow = sheet.getLastRow();
  const idIndex = headers.indexOf('id');
  const currentRows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().map((values, index) => ({
      values: values,
      rowNumber: index + 2,
      record: rowToRecord_(values, headers)
    }))
    : [];
  const reportMonths = {};
  rows.forEach(record => {
    const month = recordMonthKey_(record);
    if (month) reportMonths[month] = true;
  });
  const reportMonthKeys = Object.keys(reportMonths).sort();
  const isInReportMonth = item => Boolean(reportMonths[recordMonthKey_(item.record)]);
  const currentReportRows = currentRows
    .filter(item => isReportTurnover_(item.values, headers))
    .filter(isInReportMonth);
  const manualRowsByRoomDate = {};
  currentRows
    .filter(item => !isReportTurnover_(item.values, headers))
    .filter(isInReportMonth)
    .forEach(item => {
      const key = roomDateKey_(item.record);
      if (key) manualRowsByRoomDate[key] = item;
    });
  const currentById = {};
  currentReportRows.forEach(item => {
    currentById[String(item.values[idIndex] || '')] = item;
  });

  const incomingById = {};
  const manualOverrides = [];
  const incomingRows = rows.map(record => {
    const row = headers.map(h => {
      if (h === 'reportSource') return 'report';
      return record[h] === undefined || record[h] === null ? '' : record[h];
    });
    const nextRecord = rowToRecord_(row, headers);
    const isDeparture = String(nextRecord.eventType || '').trim() === 'departure';
    const manualOverride = isDeparture ? null : manualRowsByRoomDate[roomDateKey_(nextRecord)];
    if (manualOverride) {
      manualOverrides.push({
        id: String(row[idIndex] || ''),
        room: nextRecord.room || '',
        date: nextRecord.date || '',
        manualId: manualOverride.record.id || '',
        rowNumber: manualOverride.rowNumber
      });
    }
    incomingById[String(row[idIndex] || '')] = true;
    return {
      id: String(row[idIndex] || ''),
      row: row,
      record: nextRecord
    };
  }).filter(item => item && item.id);

  const newRows = [];
  const changedRows = [];
  let unchangedRows = 0;

  incomingRows.forEach(item => {
    const current = currentById[item.id];
    if (!current) {
      newRows.push(item);
      return;
    }

    if (reportRecordsEqual_(current.record, item.record)) {
      unchangedRows += 1;
      return;
    }

    const merged = mergeReportRecord_(current.record, item.record);
    changedRows.push({
      rowNumber: current.rowNumber,
      row: recordToRow_(merged, headers)
    });
  });

  const removedRows = currentReportRows.filter(item => !incomingById[String(item.values[idIndex] || '')]);

  changedRows.forEach(item => {
    sheet.getRange(item.rowNumber, 1, 1, headers.length).setValues([item.row]);
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length)
      .setValues(newRows.map(item => item.row));
  }

  manualOverrides
    .concat(removedRows)
    .slice()
    .sort((a, b) => b.rowNumber - a.rowNumber)
    .forEach(item => {
      sheet.deleteRow(item.rowNumber);
    });

  const serverSummary = {
    arrivals: Number(summary.arrivals || rows.length || 0),
    departures: Number(summary.departures || 0),
    sameDay: Number(summary.sameDay || 0),
    newRows: newRows.length,
    changedRows: changedRows.length,
    unchangedRows: unchangedRows,
    removedRows: removedRows.length,
    writtenRows: newRows.length + changedRows.length,
    skippedRows: unchangedRows,
    manualOverrides: manualOverrides.length,
    totalRows: rows.length,
    reportMonth: reportMonthKeys.length === 1 ? reportMonthKeys[0] : reportMonthKeys.join(','),
    status: manualOverrides.length ? 'manual-overrides' : 'ok',
    message: manualOverrides.length
      ? 'Report rows replaced matching manual entries'
      : 'Reports synced to Sheets'
  };

  const notifications = createReportSyncNotifications_(serverSummary);
  notifications.forEach(notification => {
    addRecord('notifications', notification);
  });

  const syncRecord = appendReportSync_(serverSummary);

  return {
    synced: rows.length,
    newRows: serverSummary.newRows,
    changedRows: serverSummary.changedRows,
    unchangedRows: serverSummary.unchangedRows,
    removedRows: serverSummary.removedRows,
    writtenRows: serverSummary.writtenRows,
    skippedRows: serverSummary.skippedRows,
    manualOverrides: serverSummary.manualOverrides,
    reportMonth: serverSummary.reportMonth,
    total: rows.length,
    notifications: notifications.length,
    syncRecord: syncRecord
  };
}

function validateSchema() {
  const ss = getSS();
  const report = [];
  let ok = true;

  Object.keys(SHEETS).forEach(name => {
    const expected = SHEETS[name];
    const sheet = ss.getSheetByName(name);

    if (!sheet) {
      ok = false;
      report.push('Missing sheet: ' + name);
      return;
    }

    const lastColumn = Math.max(sheet.getLastColumn(), expected.length);
    const actual = sheet.getRange(1, 1, 1, lastColumn)
      .getValues()[0]
      .map(value => String(value || '').trim());

    expected.forEach((header, index) => {
      if (actual[index] !== header) {
        ok = false;
        report.push(
          'Sheet ' + name +
          ' column ' + (index + 1) +
          ' expected ' + header +
          ' but found ' + (actual[index] || 'empty')
        );
      }
    });
  });

  const result = ok ? 'OK - schema is valid' : report.join('\n');
  Logger.log(result);
  return result;
}

function repairSchema() {
  setup();
  return validateSchema();
}

/*
  Report sync writes only new or changed report fields, skips identical rows,
  preserves operational fields, deletes removed report rows,
  and records every successful sync.
*/
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * שליחת Push דרך OneSignal
 * דורש Script Properties:
 * ONESIGNAL_APP_ID
 * ONESIGNAL_REST_API_KEY
 */
function getNotificationTargets_(target) {
  const cleanTarget = String(target || "").trim();
  if (!cleanTarget) return [];

  const usersSheet = getSS().getSheetByName("users");
  if (!usersSheet || usersSheet.getLastRow() < 2) return [];

  const values = usersSheet.getDataRange().getValues();
  const headers = values.shift();
  const usernameIndex = headers.indexOf("username");
  const roleIndex = headers.indexOf("role");

  if (usernameIndex === -1 || roleIndex === -1) return [];

  return values
    .filter(row => String(row[usernameIndex] || "").trim())
    .filter(row => {
      const username = String(row[usernameIndex] || "").trim();
      const role = String(row[roleIndex] || "").trim();
      return cleanTarget === "all" || cleanTarget === username || cleanTarget === role;
    })
    .map(row => String(row[usernameIndex] || "").trim());
}

function sendOneSignalPush(title, message, target = "admin") {
  const props = PropertiesService.getScriptProperties();

  const appId = props.getProperty("ONESIGNAL_APP_ID");
  const apiKey = props.getProperty("ONESIGNAL_REST_API_KEY");

  if (!appId) {
    throw new Error("Missing ONESIGNAL_APP_ID in Script Properties");
  }

  if (!apiKey) {
    throw new Error("Missing ONESIGNAL_REST_API_KEY in Script Properties");
  }

  const safeTitle = String(title || "בית ויליאמס").trim() || "בית ויליאמס";
  const safeMessage = String(message || "").trim();

  if (!safeMessage) {
    Logger.log("Push skipped: empty message");
    return {
      ok: false,
      skipped: true,
      code: 0,
      body: "empty message"
    };
  }

  const externalIds = getNotificationTargets_(target);

  if (!externalIds.length) {
    Logger.log("Push skipped: no users for target " + target);
    return {
      ok: false,
      skipped: true,
      code: 0,
      body: "no targets"
    };
  }

  const payload = {
    app_id: appId,
    target_channel: "push",
    include_aliases: {
      external_id: externalIds
    },
    headings: {
      en: safeTitle
    },
    contents: {
      en: safeMessage
    },
    url: "https://williams-house.onrender.com"
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Key " + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch("https://api.onesignal.com/notifications", options);
  const code = response.getResponseCode();
  const body = response.getContentText();

  Logger.log("OneSignal status: " + code);
  Logger.log(body);

  return {
    ok: code >= 200 && code < 300,
    code: code,
    body: body
  };
}

/** בדיקת Push ידנית */
function testOneSignalPush() {
  const result = sendOneSignalPush(
    "בדיקה מגוגל שיטס",
    "אם זה הגיע, החיבור בין Google Apps Script ל-OneSignal עובד ✅"
  );

  Logger.log(JSON.stringify(result));
  return JSON.stringify(result);
}

/**
 * סורק את טאב notifications
 * שולח Push רק לשורות שלא נקראו ושלא נשלחו
 * ואז מסמן בעמודה H:
 * כן = נשלח
 * דלג-ריק = לא היה טקסט הודעה
 * שגיאה = OneSignal החזיר שגיאה
 */
function checkNotificationsAndSendPush() {
  const ss = getSS();
  const sheet = ss.getSheetByName("notifications");

  if (!sheet) {
    throw new Error("Sheet 'notifications' not found");
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("No notifications to check");
    return;
  }

  const pushHeader = sheet.getRange(1, 8).getValue();

  if (pushHeader !== "pushSent") {
    sheet.getRange(1, 8).setValue("pushSent");
    SpreadsheetApp.flush();
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;

    const id = rows[i][0];        // A: id
    const target = String(rows[i][1] || "").trim(); // B: for
    const messageRaw = rows[i][2]; // C: message
    const roomRaw = rows[i][3];    // D: room
    const read = rows[i][5];       // F: read
    const pushSent = rows[i][7];   // H: pushSent

    const message = String(messageRaw || "").trim();
    const room = String(roomRaw || "").trim();

    const isUnread = read === false || read === "FALSE" || read === "";
    const wasNotSent = pushSent === "" || pushSent === null;

    if (!isUnread || !wasNotSent) {
      continue;
    }

    if (!message) {
      sheet.getRange(rowNumber, 8).setValue("דלג-ריק");
      SpreadsheetApp.flush();
      Logger.log("Skipped empty notification message. row: " + rowNumber + ", id: " + id);
      continue;
    }

    const title = room
      ? "התראה חדשה - " + room
      : "התראה חדשה מבית ויליאמס";

    const result = sendOneSignalPush(title, message, target);

    if (result && result.ok) {
      sheet.getRange(rowNumber, 8).setValue("כן");
      SpreadsheetApp.flush();
      Logger.log("Push sent and marked YES for row: " + rowNumber + ", id: " + id);
    } else {
      const errorText = result && result.code ? "שגיאה " + result.code : "שגיאה";
      sheet.getRange(rowNumber, 8).setValue(errorText);
      SpreadsheetApp.flush();
      Logger.log("Push failed for row: " + rowNumber + ", id: " + id + ", result: " + JSON.stringify(result));
    }
  }
}
