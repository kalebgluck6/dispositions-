/**
 * Data.gs — thin data-access layer over Google Sheets.
 * Rows are converted to plain objects using the FIELD MAPs in Config.gs.
 */

var _ss = null;
var _headerChecked = {};

/** Returns the database spreadsheet (container-bound, or the one linked during setup). */
function ss_() {
  if (_ss) return _ss;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    _ss = SpreadsheetApp.openById(id);
    return _ss;
  }
  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { active = null; }
  if (active) {
    props.setProperty('SPREADSHEET_ID', active.getId());
    _ss = active;
    return _ss;
  }
  throw new Error('No database spreadsheet is linked. Open the Google Sheet, go to Extensions → Apps Script and run setup().');
}

/** Gets a sheet by name, creating it (with headers) if needed. */
function getSheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (SCHEMAS[name]) ensureHeaders_(sh, name);
  return sh;
}

function ensureHeaders_(sh, name) {
  if (_headerChecked[name]) return;
  var wanted = values_(SCHEMAS[name]);
  var lastCol = sh.getLastColumn();
  var existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var hasAny = existing.some(function (h) { return h !== ''; });
  if (!hasAny) {
    sh.getRange(1, 1, 1, wanted.length).setValues([wanted]);
    formatSheet_(sh, name, wanted);
  } else {
    var missing = wanted.filter(function (h) { return existing.indexOf(h) === -1; });
    if (missing.length) {
      sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      formatSheet_(sh, name, existing.concat(missing));
    }
  }
  _headerChecked[name] = true;
}

function formatSheet_(sh, name, headers) {
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setFontColor('#E8F2EC')
    .setBackground('#0B2E21');
  var textCols = TEXT_COLUMNS[name] || [];
  textCols.forEach(function (h) {
    var idx = headers.indexOf(h);
    if (idx > -1) sh.getRange(2, idx + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  });
}

function values_(obj) {
  return Object.keys(obj).map(function (k) { return obj[k]; });
}

function headersOf_(name) {
  var sh = getSheet_(name);
  var lastCol = sh.getLastColumn();
  return { sheet: sh, headers: sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) };
}

/**
 * Reads a whole sheet. Returns { sheet, headers, rows } where every row is an
 * object keyed by the entity's client keys, plus _row (1-based sheet row).
 */
function readTable_(name) {
  var t = headersOf_(name);
  var map = SCHEMAS[name];
  var lastRow = t.sheet.getLastRow();
  var rows = [];
  if (lastRow >= 2) {
    var data = t.sheet.getRange(2, 1, lastRow - 1, t.headers.length).getValues();
    var idx = {};
    Object.keys(map).forEach(function (k) { idx[k] = t.headers.indexOf(map[k]); });
    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      if (row.every(function (c) { return c === '' || c === null; })) continue;
      var o = { _row: r + 2 };
      Object.keys(map).forEach(function (k) { o[k] = idx[k] > -1 ? row[idx[k]] : ''; });
      rows.push(o);
    }
  }
  return { sheet: t.sheet, headers: t.headers, rows: rows, raw: null };
}

/** Converts an object with client keys to a row array in sheet header order. */
function toRowArray_(name, headers, obj, baseRow) {
  var map = SCHEMAS[name];
  var reverse = {};
  Object.keys(map).forEach(function (k) { reverse[map[k]] = k; });
  return headers.map(function (h, i) {
    var key = reverse[h];
    if (key && Object.prototype.hasOwnProperty.call(obj, key)) return cellValue_(obj[key]);
    return baseRow ? cellValue_(baseRow[i]) : '';
  });
}

function appendObjects_(name, objs) {
  if (!objs || !objs.length) return;
  var t = headersOf_(name);
  var data = objs.map(function (o) { return toRowArray_(name, t.headers, o, null); });
  var start = t.sheet.getLastRow() + 1;
  t.sheet.getRange(start, 1, data.length, t.headers.length).setValues(data);
  return start;
}

function updateObject_(name, rowNum, fields) {
  var t = headersOf_(name);
  var range = t.sheet.getRange(rowNum, 1, 1, t.headers.length);
  var current = range.getValues()[0];
  range.setValues([toRowArray_(name, t.headers, fields, current)]);
}

/** Writes one column (by client key) for a contiguous block of rows. */
function writeColumn_(name, key, startRow, values) {
  if (!values.length) return;
  var t = headersOf_(name);
  var col = t.headers.indexOf(SCHEMAS[name][key]);
  if (col < 0) return;
  t.sheet.getRange(startRow, col + 1, values.length, 1)
    .setValues(values.map(function (v) { return [cellValue_(v)]; }));
}

function findBy_(name, key, value) {
  var rows = readTable_(name).rows;
  var want = String(value).trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][key]).trim().toLowerCase() === want) return rows[i];
  }
  return null;
}

/** Sanitizes a value before writing it to a cell (prevents formula injection, keeps leading zeros). */
function cellValue_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  var s = String(v);
  if (/^[=+\-@]/.test(s) || /^0\d+$/.test(s)) return "'" + s;
  return s;
}

/** Converts values to something google.script.run can return (no Date objects). */
function toClient_(o) {
  if (o === null || o === undefined) return o;
  if (o instanceof Date) return isNaN(o.getTime()) ? '' : o.toISOString();
  if (Array.isArray(o)) return o.map(toClient_);
  if (typeof o === 'object') {
    var out = {};
    Object.keys(o).forEach(function (k) { out[k] = toClient_(o[k]); });
    return out;
  }
  return o;
}

// ---------- small utilities ----------

function num_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v;
  var s = String(v).replace(/[$,\s]/g, '');
  var m = s.match(/^(-?\d*\.?\d+)([kKmM]?)$/);
  if (!m) return '';
  var n = parseFloat(m[1]);
  if (/k/i.test(m[2])) n *= 1000;
  if (/m/i.test(m[2])) n *= 1000000;
  return n;
}

function bool_(v) {
  if (typeof v === 'boolean') return v;
  return /^(true|yes|y|1|x|on)$/i.test(String(v).trim());
}

function list_(v) {
  if (Array.isArray(v)) return v.map(function (s) { return String(s).trim(); }).filter(String);
  return String(v || '').split(/[,;|\n]/).map(function (s) { return s.trim(); }).filter(String);
}

function joinList_(v) {
  return list_(v).join(', ');
}

function isEmail_(e) {
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(String(e || '').trim());
}

function str_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function pad_(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function tz_() {
  return Session.getScriptTimeZone() || 'America/New_York';
}

function fmtDate_(d, pattern) {
  if (!d) return '';
  var date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return Utilities.formatDate(date, tz_(), pattern || 'yyyy-MM-dd');
}

/**
 * Sequential, human-friendly IDs (INV-00001, SDI-2026-0001).
 * Callers must already hold the script lock (see withLock_).
 */
function nextId_(counterKey, prefix, width) {
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty(counterKey) || '0', 10) + 1;
  props.setProperty(counterKey, String(n));
  return prefix + pad_(n, width);
}

function shortId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}

function currentUser_() {
  var e = '';
  try { e = Session.getActiveUser().getEmail(); } catch (err) { e = ''; }
  if (!e) { try { e = Session.getEffectiveUser().getEmail(); } catch (err2) { e = ''; } }
  return e;
}

var _lockDepth = 0;
var _lock = null;

/** Runs fn while holding the script lock. Re-entrant within one execution. */
function withLock_(fn) {
  if (_lockDepth > 0) {
    _lockDepth++;
    try { return fn(); } finally { _lockDepth--; }
  }
  _lock = LockService.getScriptLock();
  _lock.waitLock(30000);
  _lockDepth = 1;
  try { return fn(); } finally { _lockDepth = 0; _lock.releaseLock(); }
}
