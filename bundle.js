/**
 * ============================================================
 * בית ויליאמס - Backend (Apps Script)
 * ============================================================
 * קובץ זה משמש גם כ-API וגם כ-מארח של האפליקציה.
 *
 * הוראות הפעלה:
 *  1. העתק את כל הקובץ הזה ל-Code.gs
 *  2. הרץ פעם אחת את הפונקציה setup()
 *  3. Deploy → New Deployment → Web app
 *     - Execute as: Me
 *     - Who has access: Anyone with the link
 *  4. שתף את ה-URL עם הצוות
 */

const SHEETS = {
  maintenance:   ['id','title','description','location','dueDate','status','source','urgency','createdByName','createdAt','completedAt'],
  turnovers:     ['id','room','date','guests','kids','hasCrib','hasHighChair','notes','isReturning','isOccupied','status','gardenDone','gardenDoneAt','createdAt','completedAt'],
  notifications: ['id','for','message','room','date','read','createdAt'],
  shopping:      ['id','item','quantity','note','requestedBy','status','requestedAt','purchasedAt'],
  hours:         ['id','userId','userName','date','startTime','endTime','totalHours','createdAt'],
};

/** ID של הגיליון הקשור - עדכן אם יוצרים גיליון חדש */
const SPREADSHEET_ID = '1zEJS5MV8tD0Op9QKOcNGoeTihRDk7ROPFJb70aP-AaY';

function getSS() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

/** הרץ ידנית פעם אחת - יוצר את הטאבים והעמודות */
function setup() {
  const ss = getSS();
  Object.keys(SHEETS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = SHEETS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#F0F0F0');
    sheet.setFrozenRows(1);
  });
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (def && def.getLastRow() <= 1) { try { ss.deleteSheet(def); } catch(e){} }
  Logger.log('✅ Setup complete');
}

/** הרץ ידנית כדי לנקות את כל הנתונים (משאיר את ה-headers) */
function clearAllData() {
  const ss = getSS();
  Object.keys(SHEETS).forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    }
  });
  Logger.log('✅ All data cleared');
}

function doGet(e) {
  if (e && e.parameter && e.parameter.action) return handleApiGet(e);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('בית ויליאמס')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function handleApiGet(e) {
  try {
    if (e.parameter.action === 'read') {
      const result = {};
      Object.keys(SHEETS).forEach(name => { result[name] = readSheet(name); });
      return jsonResponse({ ok: true, data: result });
    }
    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { table, op, record, id } = body;
    if (!SHEETS[table]) throw new Error('Unknown table: ' + table);
    let result;
    if (op === 'add') result = addRecord(table, record);
    else if (op === 'update') result = updateRecord(table, record);
    else if (op === 'delete') result = deleteRecord(table, id);
    else throw new Error('Unknown op: ' + op);
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
      if (h === 'hasCrib' || h === 'hasHighChair' || h === 'isReturning' ||
          h === 'isOccupied' || h === 'read' || h === 'gardenDone') {
        v = v === true || v === 'TRUE' || v === 'true';
      }
      if (h === 'guests' || h === 'quantity' || h === 'totalHours') {
        v = (v === '' || v === null) ? null : Number(v);
      }
      if (h === 'kids') {
        // stored as JSON string in cell
        try { v = (v && typeof v === 'string') ? JSON.parse(v) : (Array.isArray(v) ? v : []); }
        catch { v = []; }
      }
      // Date-only columns (no time component): return YYYY-MM-DD
      if ((h === 'date' || h === 'dueDate') && v instanceof Date) {
        const yyyy = v.getFullYear();
        const mm = String(v.getMonth() + 1).padStart(2, '0');
        const dd = String(v.getDate()).padStart(2, '0');
        v = `${yyyy}-${mm}-${dd}`;
      } else if (v instanceof Date) {
        v = v.toISOString();
      }
      obj[h] = v;
    });
    return obj;
  });
}

function addRecord(table, record) {
  const sheet = getSS().getSheetByName(table);
  const headers = SHEETS[table];
  const row = headers.map(h => serializeValue(h, record[h]));
  sheet.appendRow(row);
  return record;
}

function updateRecord(table, record) {
  const sheet = getSS().getSheetByName(table);
  const headers = SHEETS[table];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Empty table');
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
  const idx = ids.findIndex(x => String(x) === String(record.id));
  if (idx === -1) throw new Error('Not found: ' + record.id);
  const row = headers.map(h => serializeValue(h, record[h]));
  sheet.getRange(idx + 2, 1, 1, headers.length).setValues([row]);
  return record;
}

function deleteRecord(table, id) {
  const sheet = getSS().getSheetByName(table);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
  const idx = ids.findIndex(x => String(x) === String(id));
  if (idx === -1) return null;
  sheet.deleteRow(idx + 2);
  return { id, deleted: true };
}

function serializeValue(header, value) {
  if (value === undefined || value === null) return '';
  if (header === 'kids' && Array.isArray(value)) return JSON.stringify(value);
  return value;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
