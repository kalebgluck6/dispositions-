/**
 * SameDayInvestments — Deal Distribution System (single-file bundle)
 * Paste this whole file into Code.gs in the Apps Script editor.
 */

// ================= Config.gs =================
/**
 * SameDayInvestments — Investor Deal Distribution System
 * Config.gs — sheet names, column schemas and default settings.
 *
 * Each entity is described by a FIELD MAP: { clientKey: 'Sheet Column Header' }.
 * The order of the map is the column order used when a sheet is first created.
 * Columns are always looked up by header name, so you can reorder columns
 * in the spreadsheet or add your own extra columns without breaking anything.
 */

var APP_NAME = 'SameDayInvestments';
var APP_VERSION = '1.0.0';

var SHEET = {
  SETTINGS: 'Settings',
  INVESTORS: 'Investors',
  DEALS: 'Deals',
  JOBS: 'Distribution Jobs',
  LOG: 'Distribution Log',
  RESPONSES: 'Responses'
};

var INVESTOR_MAP = {
  id: 'Investor ID',
  firstName: 'First Name',
  lastName: 'Last Name',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  tier: 'Tier',
  categories: 'Categories',
  markets: 'Preferred Markets',
  propertyTypes: 'Property Types',
  minPrice: 'Min Price',
  maxPrice: 'Max Price',
  criteria: 'Buying Criteria',
  status: 'Status',
  optOut: 'Email Opt-Out',
  source: 'Source',
  dateAdded: 'Date Added',
  updated: 'Last Updated',
  lastSent: 'Last Deal Sent',
  dealsReceived: 'Deals Received',
  notes: 'Notes'
};

var DEAL_MAP = {
  id: 'Deal ID',
  status: 'Status',
  address: 'Address',
  city: 'City',
  state: 'State',
  zip: 'Zip',
  market: 'Market',
  propertyType: 'Property Type',
  askingPrice: 'Asking Price',
  assignmentPrice: 'Assignment Price',
  showAssignment: 'Show Assignment Price',
  arv: 'ARV',
  repairs: 'Estimated Repairs',
  sqft: 'Square Feet',
  beds: 'Bedrooms',
  baths: 'Bathrooms',
  lotSize: 'Lot Size',
  yearBuilt: 'Year Built',
  description: 'Description',
  closingDate: 'Closing Date',
  access: 'Access Instructions',
  showAccess: 'Show Access Instructions',
  photoIds: 'Photo IDs',
  folderId: 'Photo Folder ID',
  videoUrl: 'Video URL',
  videoFileId: 'Video File ID',
  created: 'Created',
  updated: 'Updated',
  lastDistributed: 'Last Distributed',
  timesDistributed: 'Times Distributed',
  totalRecipients: 'Total Recipients',
  responses: 'Responses',
  interested: 'Interested',
  buyer: 'Buyer',
  soldPrice: 'Sold Price',
  soldDate: 'Sold Date',
  internalNotes: 'Internal Notes'
};

var JOB_MAP = {
  id: 'Job ID',
  dealId: 'Deal ID',
  property: 'Property',
  mode: 'Mode',
  audience: 'Audience',
  created: 'Created',
  createdBy: 'Created By',
  total: 'Total',
  sent: 'Sent',
  failed: 'Failed',
  simulated: 'Simulated',
  status: 'Status',
  completed: 'Completed',
  notes: 'Notes'
};

// NOTE: Status → Error must stay contiguous (the queue writes them as one block).
var LOG_MAP = {
  id: 'Log ID',
  jobId: 'Job ID',
  dealId: 'Deal ID',
  investorId: 'Investor ID',
  investorName: 'Investor Name',
  investorEmail: 'Investor Email',
  tier: 'Tier',
  mode: 'Mode',
  status: 'Status',
  queuedAt: 'Queued At',
  sentAt: 'Sent At',
  deliveredTo: 'Delivered To',
  error: 'Error'
};

var RESPONSE_MAP = {
  id: 'Response ID',
  dealId: 'Deal ID',
  property: 'Property',
  investorId: 'Investor ID',
  investorName: 'Investor Name',
  investorEmail: 'Investor Email',
  received: 'Received',
  type: 'Type',
  offerAmount: 'Offer Amount',
  message: 'Message',
  source: 'Source',
  followUp: 'Follow-Up Status',
  notes: 'Notes',
  messageId: 'Message ID'
};

var SCHEMAS = {};
SCHEMAS[SHEET.INVESTORS] = INVESTOR_MAP;
SCHEMAS[SHEET.DEALS] = DEAL_MAP;
SCHEMAS[SHEET.JOBS] = JOB_MAP;
SCHEMAS[SHEET.LOG] = LOG_MAP;
SCHEMAS[SHEET.RESPONSES] = RESPONSE_MAP;

/** Columns that must be stored as plain text (zip codes, phones, IDs, dates-as-text). */
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET.INVESTORS] = ['Investor ID', 'Phone'];
TEXT_COLUMNS[SHEET.DEALS] = ['Deal ID', 'Zip', 'Closing Date', 'Photo IDs', 'Lot Size'];
TEXT_COLUMNS[SHEET.LOG] = ['Log ID', 'Job ID', 'Deal ID', 'Investor ID'];
TEXT_COLUMNS[SHEET.RESPONSES] = ['Response ID', 'Deal ID', 'Investor ID', 'Message ID'];

var DEAL_STATUSES = ['Available', 'Pending', 'Sold'];
var INVESTOR_STATUSES = ['Active', 'Inactive'];
var RESPONSE_TYPES = ['Interested', 'Offer', 'Question', 'Not Interested', 'Unsubscribe', 'Reply'];
var FOLLOW_UP_STATUSES = ['New', 'Contacted', 'Showing Scheduled', 'Offer Received', 'Under Contract', 'Closed', 'Dead'];

/** Max milliseconds a single execution spends sending before handing off to a trigger. */
var QUEUE_TIME_BUDGET_MS = 4.5 * 60 * 1000;

/**
 * Default settings: [key, default value, description].
 * These are written to the Settings sheet on setup and are editable there or in the app.
 */
var DEFAULT_SETTINGS = [
  ['COMPANY_NAME', 'SameDayInvestments', 'Company name shown in emails and the app.'],
  ['CONTACT_NAME', '', 'Dispositions contact shown in emails.'],
  ['CONTACT_PHONE', '', 'Phone number shown in emails.'],
  ['CONTACT_EMAIL', '', 'Contact email shown in emails (defaults to Reply-To).'],
  ['WEBSITE', '', 'Website URL shown in emails (optional).'],
  ['COMPANY_ADDRESS', '', 'Physical mailing address — required in commercial email footers (CAN-SPAM).'],
  ['SENDER_NAME', 'SameDayInvestments Dispositions', 'The "From" display name on distribution emails.'],
  ['REPLY_TO', '', 'Where investor replies go. Defaults to the account running the script.'],
  ['FROM_ALIAS', '', 'Optional Gmail "Send mail as" alias to send from (must already be configured in Gmail).'],
  ['LOGO_URL', '', 'Optional public https URL of your logo image for the email header.'],
  ['TEST_MODE', 'TRUE', 'TRUE = every email is redirected to TEST_EMAIL. Set FALSE (Go Live) to email investors.'],
  ['TEST_EMAIL', '', 'Address that receives all emails while TEST_MODE is TRUE.'],
  ['TEST_MODE_MAX_EMAILS', '3', 'In test mode, only this many emails are actually delivered per distribution; the rest are simulated.'],
  ['SUBJECT_TEMPLATE', 'Off-Market Opportunity | {{ADDRESS}}, {{CITY}} {{STATE}} | {{PRICE}} [{{DEAL_ID}}]', 'Email subject. Tokens: {{ADDRESS}} {{CITY}} {{STATE}} {{PRICE}} {{ARV}} {{PROPERTY_TYPE}} {{DEAL_ID}}. Keep {{DEAL_ID}} so replies are auto-tracked.'],
  ['EMAIL_PHOTO_COUNT', '4', 'How many photos to embed in the email (cover photo + gallery).'],
  ['SHARE_MEDIA_LINKS', 'TRUE', 'TRUE = make the deal photo folder / uploaded video viewable by link so investors can open the full gallery.'],
  ['SHOW_ASSIGNMENT_DEFAULT', 'FALSE', 'Default for new deals: show the assignment price in investor emails.'],
  ['DISCLAIMER', 'All information is deemed reliable but not guaranteed. Buyers must perform their own due diligence. Figures for ARV and repairs are estimates only. We are assigning our contract interest in this property; this is not an offer to sell real estate.', 'Legal disclaimer shown at the bottom of every email.'],
  ['TIERS', 'Platinum, Gold, Silver, Bronze', 'Investor tiers (comma separated, highest first).'],
  ['CATEGORIES', 'Fix & Flip, Buy & Hold, Cash Buyer, BRRRR, Wholesaler, Hedge Fund / Institutional, Developer, Private Lender', 'Investor categories (comma separated).'],
  ['PROPERTY_TYPES', 'Single Family, Multi-Family (2-4), Multi-Family (5+), Condo / Townhouse, Mobile Home, Land, Commercial, Mixed Use', 'Property types (comma separated).'],
  ['MARKETS', '', 'Markets you operate in (comma separated, e.g. "Atlanta Metro, Dallas-Fort Worth"). Do not use commas inside a market name.'],
  ['RESPONSE_LOOKBACK_DAYS', '14', 'How many days back the inbox scanner looks for investor replies.'],
  ['DRIVE_FOLDER_ID', '', 'Managed automatically — root Drive folder for deal photos and videos.']
];


// ================= Data.gs =================
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


// ================= Settings.gs =================
/**
 * Settings.gs — key/value settings stored in the "Settings" sheet.
 */

var _settings = null;

function settingsSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET.SETTINGS);
  if (!sh) {
    sh = ss.insertSheet(SHEET.SETTINGS);
    sh.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'Description']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold').setFontColor('#E8F2EC').setBackground('#0B2E21');
    sh.getRange(2, 2, 200, 1).setNumberFormat('@');
  }
  return sh;
}

/** Ensures every default setting exists (never overwrites existing values). */
function ensureSettings_() {
  var sh = settingsSheet_();
  var lastRow = sh.getLastRow();
  var existing = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var toAdd = DEFAULT_SETTINGS.filter(function (d) { return existing.indexOf(d[0]) === -1; });
  if (toAdd.length) {
    var me = currentUser_();
    toAdd = toAdd.map(function (d) {
      if ((d[0] === 'TEST_EMAIL' || d[0] === 'REPLY_TO') && !d[1]) return [d[0], me, d[2]];
      return d;
    });
    sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, 3).setValues(toAdd);
  }
  _settings = null;
}

/** Returns all settings as a { KEY: 'value' } map (cached per execution). */
function getSettings_() {
  if (_settings) return _settings;
  var sh = settingsSheet_();
  var out = {};
  DEFAULT_SETTINGS.forEach(function (d) { out[d[0]] = d[1]; });
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    sh.getRange(2, 1, lastRow - 1, 2).getValues().forEach(function (r) {
      if (r[0] !== '') out[String(r[0]).trim()] = r[1] === null ? '' : String(r[1]);
    });
  }
  _settings = out;
  return out;
}

function setSetting_(key, value) {
  var sh = settingsSheet_();
  var lastRow = sh.getLastRow();
  var keys = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var idx = keys.indexOf(key);
  var desc = '';
  DEFAULT_SETTINGS.forEach(function (d) { if (d[0] === key) desc = d[2]; });
  if (idx === -1) sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[key, cellValue_(value), desc]]);
  else sh.getRange(idx + 2, 2).setValue(cellValue_(value));
  _settings = null;
}

function isTestMode_() {
  // Fail safe: anything other than an explicit FALSE keeps test mode on.
  return !/^(false|no|0|off)$/i.test(String(getSettings_().TEST_MODE).trim());
}

function replyTo_() {
  var s = getSettings_();
  return str_(s.REPLY_TO) || currentUser_();
}

function contactEmail_() {
  var s = getSettings_();
  return str_(s.CONTACT_EMAIL) || replyTo_();
}

function remainingQuota_() {
  try { return MailApp.getRemainingDailyQuota(); } catch (e) { return -1; }
}

// ---------- client API ----------

/** Settings + option lists for the web app. */
function getSettings() {
  var s = getSettings_();
  return {
    values: s,
    descriptions: DEFAULT_SETTINGS.reduce(function (m, d) { m[d[0]] = d[2]; return m; }, {}),
    testMode: isTestMode_(),
    lists: {
      tiers: list_(s.TIERS),
      categories: list_(s.CATEGORIES),
      propertyTypes: list_(s.PROPERTY_TYPES),
      markets: list_(s.MARKETS),
      dealStatuses: DEAL_STATUSES,
      investorStatuses: INVESTOR_STATUSES,
      responseTypes: RESPONSE_TYPES,
      followUpStatuses: FOLLOW_UP_STATUSES
    },
    quota: remainingQuota_(),
    user: currentUser_(),
    autoTracking: hasTrigger_('scanInboxForResponses'),
    spreadsheetUrl: ss_().getUrl(),
    version: APP_VERSION
  };
}

/** Saves editable settings. TEST_MODE can only be changed via setTestMode(). */
function saveSettings(values) {
  return withLock_(function () {
    var allowed = DEFAULT_SETTINGS.map(function (d) { return d[0]; })
      .filter(function (k) { return k !== 'TEST_MODE' && k !== 'DRIVE_FOLDER_ID'; });
    if (values.TEST_EMAIL && !isEmail_(values.TEST_EMAIL)) throw new Error('Test email address is not valid.');
    if (values.REPLY_TO && !isEmail_(values.REPLY_TO)) throw new Error('Reply-To address is not valid.');
    Object.keys(values || {}).forEach(function (k) {
      if (allowed.indexOf(k) > -1) setSetting_(k, str_(values[k]));
    });
    return getSettings();
  });
}

/**
 * Switches between TEST and LIVE mode. Going live requires typing GO LIVE.
 */
function setTestMode(enabled, confirmation) {
  return withLock_(function () {
    if (!enabled) {
      if (String(confirmation || '').trim().toUpperCase() !== 'GO LIVE') {
        throw new Error('Type GO LIVE to switch to live mode.');
      }
      var s = getSettings_();
      if (!str_(s.COMPANY_ADDRESS)) {
        throw new Error('Add your company mailing address in Settings before going live (required in commercial email footers).');
      }
    }
    setSetting_('TEST_MODE', enabled ? 'TRUE' : 'FALSE');
    return getSettings();
  });
}


// ================= Investors.gs =================
/**
 * Investors.gs — investor database: add, edit, deactivate, categorize, history.
 */

function normalizeInvestor_(inv) {
  var out = {
    firstName: str_(inv.firstName),
    lastName: str_(inv.lastName),
    company: str_(inv.company),
    email: str_(inv.email).toLowerCase(),
    phone: str_(inv.phone),
    tier: str_(inv.tier),
    categories: joinList_(inv.categories),
    markets: joinList_(inv.markets),
    propertyTypes: joinList_(inv.propertyTypes),
    minPrice: num_(inv.minPrice),
    maxPrice: num_(inv.maxPrice),
    criteria: str_(inv.criteria),
    status: INVESTOR_STATUSES.indexOf(str_(inv.status)) > -1 ? str_(inv.status) : 'Active',
    optOut: bool_(inv.optOut),
    notes: str_(inv.notes)
  };
  return out;
}

function investorName_(inv) {
  var n = (str_(inv.firstName) + ' ' + str_(inv.lastName)).trim();
  return n || str_(inv.company) || str_(inv.email);
}

function cleanInvestorRow_(r) {
  var o = toClient_(r);
  o.optOut = bool_(r.optOut);
  o.dealsReceived = Number(r.dealsReceived) || 0;
  o.status = str_(r.status) || 'Active';
  return o;
}

// ---------- client API ----------

function listInvestors() {
  return readTable_(SHEET.INVESTORS).rows.map(cleanInvestorRow_);
}

/** Creates or updates an investor. Emails are unique (case-insensitive). */
function saveInvestor(inv) {
  return withLock_(function () {
    var data = normalizeInvestor_(inv || {});
    if (!isEmail_(data.email)) throw new Error('A valid email address is required.');
    if (!data.firstName && !data.lastName && !data.company) throw new Error('Enter a name or company.');
    var table = readTable_(SHEET.INVESTORS);
    var dup = table.rows.filter(function (r) {
      return String(r.email).toLowerCase() === data.email && r.id !== inv.id;
    })[0];
    if (dup) throw new Error('Another investor (' + investorName_(dup) + ', ' + dup.id + ') already uses ' + data.email + '.');
    data.updated = new Date();
    if (inv.id) {
      var existing = table.rows.filter(function (r) { return r.id === inv.id; })[0];
      if (!existing) throw new Error('Investor ' + inv.id + ' not found.');
      updateObject_(SHEET.INVESTORS, existing._row, data);
      data.id = inv.id;
    } else {
      data.id = nextId_('INVESTOR_SEQ', 'INV-', 5);
      data.source = str_(inv.source) || 'Manual';
      data.dateAdded = new Date();
      data.dealsReceived = 0;
      appendObjects_(SHEET.INVESTORS, [data]);
    }
    return cleanInvestorRow_(findBy_(SHEET.INVESTORS, 'id', data.id));
  });
}

/**
 * Bulk update. changes may include:
 *   status ('Active'|'Inactive'), tier, addCategory, removeCategory, optOut (bool)
 */
function updateInvestors(ids, changes) {
  return withLock_(function () {
    ids = ids || [];
    changes = changes || {};
    var table = readTable_(SHEET.INVESTORS);
    var count = 0;
    table.rows.forEach(function (r) {
      if (ids.indexOf(r.id) === -1) return;
      var f = { updated: new Date() };
      if (changes.status && INVESTOR_STATUSES.indexOf(changes.status) > -1) f.status = changes.status;
      if (changes.tier !== undefined && changes.tier !== null) f.tier = str_(changes.tier);
      if (changes.optOut !== undefined) f.optOut = !!changes.optOut;
      var cats = list_(r.categories);
      if (changes.addCategory && cats.indexOf(changes.addCategory) === -1) cats.push(changes.addCategory);
      if (changes.removeCategory) cats = cats.filter(function (c) { return c !== changes.removeCategory; });
      if (changes.addCategory || changes.removeCategory) f.categories = cats.join(', ');
      updateObject_(SHEET.INVESTORS, r._row, f);
      count++;
    });
    return { updated: count, investors: listInvestors() };
  });
}

/** Permanently deletes investors (distribution history is kept in the log). */
function deleteInvestors(ids, confirmation) {
  if (String(confirmation || '').trim().toUpperCase() !== 'DELETE') {
    throw new Error('Type DELETE to permanently remove investors. (Tip: deactivate instead to keep their history.)');
  }
  return withLock_(function () {
    var table = readTable_(SHEET.INVESTORS);
    var rows = table.rows.filter(function (r) { return ids.indexOf(r.id) > -1; })
      .map(function (r) { return r._row; })
      .sort(function (a, b) { return b - a; });
    rows.forEach(function (n) { table.sheet.deleteRow(n); });
    return { deleted: rows.length, investors: listInvestors() };
  });
}

/** Every deal sent to an investor plus their responses. */
function getInvestorHistory(investorId) {
  var deals = {};
  readTable_(SHEET.DEALS).rows.forEach(function (d) { deals[d.id] = dealTitle_(d); });
  var sends = readTable_(SHEET.LOG).rows
    .filter(function (l) { return l.investorId === investorId && l.mode === 'LIVE' && l.status === 'Sent'; })
    .map(function (l) { return { dealId: l.dealId, property: deals[l.dealId] || l.dealId, sentAt: l.sentAt }; });
  var responses = readTable_(SHEET.RESPONSES).rows
    .filter(function (r) { return r.investorId === investorId; });
  return toClient_({ sends: sends.reverse(), responses: responses.reverse() });
}


// ================= Import.gs =================
/**
 * Import.gs — import an existing investor list from any Google Sheet.
 * Columns are auto-mapped by common header names and can be adjusted in the app.
 */

var IMPORT_SYNONYMS = {
  fullName: ['name', 'full name', 'investor', 'investor name', 'contact', 'contact name', 'buyer', 'buyer name'],
  firstName: ['first name', 'first', 'fname', 'given name'],
  lastName: ['last name', 'last', 'lname', 'surname', 'family name'],
  company: ['company', 'company name', 'business', 'llc', 'entity', 'organization', 'firm'],
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'mail'],
  phone: ['phone', 'phone number', 'cell', 'mobile', 'cell phone', 'telephone', 'tel', 'phone #'],
  tier: ['tier', 'level', 'rank', 'priority', 'grade', 'vip'],
  categories: ['category', 'categories', 'type', 'investor type', 'buyer type', 'strategy', 'tags', 'group'],
  markets: ['market', 'markets', 'preferred markets', 'area', 'areas', 'city', 'cities', 'county', 'counties', 'location', 'locations', 'zip codes', 'target markets'],
  propertyTypes: ['property type', 'property types', 'asset type', 'asset class', 'product type'],
  minPrice: ['min price', 'minimum price', 'min', 'price min', 'budget min', 'min budget'],
  maxPrice: ['max price', 'maximum price', 'max', 'price max', 'budget', 'max budget', 'budget max'],
  criteria: ['criteria', 'buying criteria', 'buy box', 'buybox', 'requirements', 'looking for', 'wants'],
  status: ['status', 'active'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks']
};

var IMPORT_FIELDS = ['fullName', 'firstName', 'lastName', 'company', 'email', 'phone', 'tier', 'categories',
  'markets', 'propertyTypes', 'minPrice', 'maxPrice', 'criteria', 'status', 'notes'];

function parseSpreadsheetId_(urlOrId) {
  var s = str_(urlOrId);
  if (!s) return '';
  var m = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : s;
}

function openImportSource_(urlOrId, tabName) {
  var id = parseSpreadsheetId_(urlOrId);
  var src;
  try {
    src = id ? SpreadsheetApp.openById(id) : ss_();
  } catch (e) {
    throw new Error('Could not open that spreadsheet. Check the link and make sure this Google account can view it.');
  }
  var sheets = src.getSheets();
  var sh = tabName ? src.getSheetByName(tabName) : sheets[0];
  if (!sh) throw new Error('Tab "' + tabName + '" not found. Available tabs: ' + sheets.map(function (x) { return x.getName(); }).join(', '));
  if (!id && [SHEET.INVESTORS, SHEET.DEALS, SHEET.LOG, SHEET.JOBS, SHEET.RESPONSES, SHEET.SETTINGS].indexOf(sh.getName()) > -1) {
    throw new Error('Choose the tab that holds your existing list, not a system tab.');
  }
  return { spreadsheet: src, sheet: sh, tabs: sheets.map(function (x) { return x.getName(); }) };
}

/** Finds the header row (first row with an email-like header within the first 10 rows). */
function findHeaderRow_(values) {
  for (var i = 0; i < Math.min(values.length, 10); i++) {
    var joined = values[i].map(function (c) { return String(c).toLowerCase(); }).join('|');
    if (/e-?mail/.test(joined)) return i;
  }
  return 0;
}

function autoMap_(headers) {
  var map = {};
  var used = {};
  var norm = headers.map(function (h) { return String(h).toLowerCase().replace(/[_*#:]/g, ' ').replace(/\s+/g, ' ').trim(); });
  // exact matches first, then "contains" matches
  [true, false].forEach(function (exact) {
    IMPORT_FIELDS.forEach(function (f) {
      if (map[f] !== undefined) return;
      for (var i = 0; i < norm.length; i++) {
        if (used[i] || !norm[i]) continue;
        var hit = IMPORT_SYNONYMS[f].some(function (syn) {
          return exact ? norm[i] === syn : (syn.length > 3 && norm[i].indexOf(syn) > -1);
        });
        if (hit) { map[f] = i; used[i] = true; break; }
      }
    });
  });
  if (map.firstName !== undefined && map.fullName !== undefined) delete map.fullName;
  return map;
}

// ---------- client API ----------

/** Reads the source sheet and proposes a column mapping. */
function previewImport(urlOrId, tabName) {
  var src = openImportSource_(urlOrId, tabName);
  var values = src.sheet.getDataRange().getDisplayValues();
  if (!values.length) throw new Error('That tab is empty.');
  var h = findHeaderRow_(values);
  var headers = values[h].map(String);
  var rows = values.slice(h + 1).filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  return {
    spreadsheetName: src.spreadsheet.getName(),
    tab: src.sheet.getName(),
    tabs: src.tabs,
    headerRow: h + 1,
    headers: headers,
    mapping: autoMap_(headers),
    sample: rows.slice(0, 8),
    totalRows: rows.length,
    fields: IMPORT_FIELDS
  };
}

/**
 * Imports investors.
 * mapping: { field: columnIndex }  options: { defaultTier, defaultCategory, updateExisting, defaultStatus }
 */
function runImport(urlOrId, tabName, mapping, options) {
  options = options || {};
  var src = openImportSource_(urlOrId, tabName);
  var values = src.sheet.getDataRange().getDisplayValues();
  var h = findHeaderRow_(values);
  var rows = values.slice(h + 1);
  var sourceLabel = 'Import: ' + src.spreadsheet.getName() + ' / ' + src.sheet.getName();

  return withLock_(function () {
    var table = readTable_(SHEET.INVESTORS);
    var byEmail = {};
    table.rows.forEach(function (r) { byEmail[String(r.email).toLowerCase()] = r; });
    var result = { added: 0, updated: 0, skipped: 0, invalid: [], duplicatesInFile: 0 };
    var toAppend = [];
    var seen = {};
    var get = function (row, f) { return mapping[f] === undefined || mapping[f] === null || mapping[f] === '' ? '' : str_(row[Number(mapping[f])]); };

    rows.forEach(function (row, i) {
      if (!row.some(function (c) { return String(c).trim() !== ''; })) return;
      var email = get(row, 'email').toLowerCase().replace(/^mailto:/, '');
      if (email.indexOf(',') > -1 || email.indexOf(';') > -1) email = email.split(/[,;]/)[0].trim();
      if (!isEmail_(email)) {
        result.invalid.push({ row: h + 2 + i, value: get(row, 'email') || '(blank)' });
        return;
      }
      if (seen[email]) { result.duplicatesInFile++; return; }
      seen[email] = true;

      var first = get(row, 'firstName'), last = get(row, 'lastName');
      if (!first && !last && get(row, 'fullName')) {
        var parts = get(row, 'fullName').split(/\s+/);
        first = parts.shift();
        last = parts.join(' ');
      }
      var statusRaw = get(row, 'status');
      var status = statusRaw ? (/^(inactive|no|n|false|0|dead|do not.*|unsubscribed|opted out)$/i.test(statusRaw.trim()) ? 'Inactive' : 'Active') : (options.defaultStatus || 'Active');
      var cats = list_(get(row, 'categories'));
      if (options.defaultCategory && cats.indexOf(options.defaultCategory) === -1) cats.push(options.defaultCategory);
      var rec = {
        firstName: first, lastName: last, company: get(row, 'company'), email: email,
        phone: get(row, 'phone'), tier: get(row, 'tier') || options.defaultTier || '',
        categories: cats.join(', '), markets: joinList_(get(row, 'markets')),
        propertyTypes: joinList_(get(row, 'propertyTypes')),
        minPrice: num_(get(row, 'minPrice')), maxPrice: num_(get(row, 'maxPrice')),
        criteria: get(row, 'criteria'), status: status, notes: get(row, 'notes'),
        updated: new Date()
      };
      var existing = byEmail[email];
      if (existing) {
        if (!options.updateExisting) { result.skipped++; return; }
        // only overwrite with non-empty values
        var f = { updated: rec.updated };
        Object.keys(rec).forEach(function (k) { if (rec[k] !== '' && k !== 'status') f[k] = rec[k]; });
        updateObject_(SHEET.INVESTORS, existing._row, f);
        result.updated++;
      } else {
        rec.id = nextId_('INVESTOR_SEQ', 'INV-', 5);
        rec.source = sourceLabel;
        rec.dateAdded = new Date();
        rec.optOut = false;
        rec.dealsReceived = 0;
        toAppend.push(rec);
        result.added++;
      }
    });
    appendObjects_(SHEET.INVESTORS, toAppend);
    result.invalid = result.invalid.slice(0, 50);
    return result;
  });
}


// ================= Deals.gs =================
/**
 * Deals.gs — deal submission, media (photos / video) and status management.
 */

var MAX_PHOTOS = 30;

function dealTitle_(d) {
  var parts = [str_(d.address), str_(d.city)].filter(String);
  var s = parts.join(', ');
  if (str_(d.state)) s += (s ? ', ' : '') + str_(d.state);
  return s || str_(d.id);
}

function photoIds_(d) {
  return list_(d.photoIds);
}

function dealMetrics_(d) {
  var price = Number(d.askingPrice) || 0;
  var arv = Number(d.arv) || 0;
  var repairs = Number(d.repairs) || 0;
  var sqft = Number(d.sqft) || 0;
  var allIn = price + repairs;
  return {
    allIn: price ? allIn : '',
    spread: arv && price ? arv - allIn : '',
    allInPctArv: arv && price ? Math.round((allIn / arv) * 1000) / 10 : '',
    pricePerSqft: price && sqft ? Math.round(price / sqft) : '',
    arvPerSqft: arv && sqft ? Math.round(arv / sqft) : ''
  };
}

function cleanDealRow_(r) {
  var o = toClient_(r);
  o.photoIds = photoIds_(r);
  o.showAssignment = bool_(r.showAssignment);
  o.showAccess = r.showAccess === '' ? true : bool_(r.showAccess);
  o.status = str_(r.status) || 'Available';
  o.timesDistributed = Number(r.timesDistributed) || 0;
  o.totalRecipients = Number(r.totalRecipients) || 0;
  o.responses = Number(r.responses) || 0;
  o.interested = Number(r.interested) || 0;
  o.title = dealTitle_(r);
  o.metrics = dealMetrics_(r);
  o.closingDate = r.closingDate instanceof Date ? fmtDate_(r.closingDate) : str_(r.closingDate);
  return o;
}

function getDealRow_(dealId) {
  var d = findBy_(SHEET.DEALS, 'id', dealId);
  if (!d) throw new Error('Deal ' + dealId + ' not found.');
  return d;
}

function normalizeDeal_(deal) {
  var closing = str_(deal.closingDate);
  if (closing && !/^\d{4}-\d{2}-\d{2}$/.test(closing)) throw new Error('Closing date must be a valid date.');
  var video = str_(deal.videoUrl);
  if (video && !/^https?:\/\//i.test(video)) throw new Error('Video link must start with http:// or https://');
  return {
    address: str_(deal.address),
    city: str_(deal.city),
    state: str_(deal.state).toUpperCase(),
    zip: str_(deal.zip),
    market: str_(deal.market),
    propertyType: str_(deal.propertyType),
    askingPrice: num_(deal.askingPrice),
    assignmentPrice: num_(deal.assignmentPrice),
    showAssignment: bool_(deal.showAssignment),
    arv: num_(deal.arv),
    repairs: num_(deal.repairs),
    sqft: num_(deal.sqft),
    beds: num_(deal.beds),
    baths: num_(deal.baths),
    lotSize: str_(deal.lotSize),
    yearBuilt: num_(deal.yearBuilt),
    description: str_(deal.description),
    closingDate: closing,
    access: str_(deal.access),
    showAccess: deal.showAccess === undefined ? true : bool_(deal.showAccess),
    videoUrl: str_(deal.videoUrl),
    internalNotes: str_(deal.internalNotes)
  };
}

// ---------- Drive media ----------

function rootFolder_() {
  var s = getSettings_();
  if (s.DRIVE_FOLDER_ID) {
    try { return DriveApp.getFolderById(s.DRIVE_FOLDER_ID); } catch (e) { /* recreate below */ }
  }
  var folder = DriveApp.createFolder(APP_NAME + ' — Deal Media');
  setSetting_('DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

function dealFolder_(deal) {
  if (deal.folderId) {
    try { return DriveApp.getFolderById(deal.folderId); } catch (e) { /* recreate */ }
  }
  var folder = rootFolder_().createFolder(deal.id + ' — ' + dealTitle_(deal));
  if (bool_(getSettings_().SHARE_MEDIA_LINKS)) shareByLink_(folder);
  updateObject_(SHEET.DEALS, deal._row, { folderId: folder.getId() });
  deal.folderId = folder.getId();
  return folder;
}

function shareByLink_(item) {
  try {
    item.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return true;
  } catch (e) {
    // Some Google Workspace domains block link sharing; the email still embeds photos.
    return false;
  }
}

function blobFromBase64_(base64, mimeType, fileName) {
  var data = String(base64 || '');
  var comma = data.indexOf(',');
  if (data.indexOf('data:') === 0 && comma > -1) data = data.slice(comma + 1);
  return Utilities.newBlob(Utilities.base64Decode(data), mimeType || 'application/octet-stream', fileName || 'file');
}

// ---------- client API ----------

function listDeals() {
  return readTable_(SHEET.DEALS).rows.map(cleanDealRow_).reverse();
}

function getDeal(dealId) {
  return cleanDealRow_(getDealRow_(dealId));
}

/** Creates or updates a deal. Returns the saved deal. */
function saveDeal(deal) {
  return withLock_(function () {
    deal = deal || {};
    var data = normalizeDeal_(deal);
    if (!data.address) throw new Error('Property address is required.');
    if (!data.askingPrice) throw new Error('Asking / purchase price is required.');
    data.updated = new Date();
    if (deal.id) {
      var existing = getDealRow_(deal.id);
      updateObject_(SHEET.DEALS, existing._row, data);
      data.id = deal.id;
    } else {
      data.id = nextId_('DEAL_SEQ_' + new Date().getFullYear(), 'SDI-' + new Date().getFullYear() + '-', 4);
      data.status = 'Available';
      data.created = new Date();
      data.timesDistributed = 0;
      data.totalRecipients = 0;
      data.responses = 0;
      data.interested = 0;
      data.photoIds = '';
      appendObjects_(SHEET.DEALS, [data]);
    }
    return getDeal(data.id);
  });
}

/** Marks a deal Available / Pending / Sold. extra: { buyer, soldPrice } */
function setDealStatus(dealId, status, extra) {
  if (DEAL_STATUSES.indexOf(status) === -1) throw new Error('Unknown status ' + status);
  return withLock_(function () {
    var d = getDealRow_(dealId);
    var f = { status: status, updated: new Date() };
    extra = extra || {};
    if (status === 'Sold') {
      f.soldDate = new Date();
      if (extra.buyer !== undefined) f.buyer = str_(extra.buyer);
      if (extra.soldPrice !== undefined) f.soldPrice = num_(extra.soldPrice);
    } else if (status === 'Pending') {
      if (extra.buyer !== undefined) f.buyer = str_(extra.buyer);
    } else {
      f.soldDate = '';
    }
    updateObject_(SHEET.DEALS, d._row, f);
    return getDeal(dealId);
  });
}

/** Uploads one photo (base64, already resized in the browser). */
function uploadDealPhoto(dealId, fileName, mimeType, base64) {
  if (!/^image\//.test(mimeType || '')) throw new Error('Only image files can be uploaded as photos.');
  var deal = getDealRow_(dealId);
  var ids = photoIds_(deal);
  if (ids.length >= MAX_PHOTOS) throw new Error('A deal can have at most ' + MAX_PHOTOS + ' photos.');
  var folder = dealFolder_(deal);
  var file = folder.createFile(blobFromBase64_(base64, mimeType, fileName));
  if (bool_(getSettings_().SHARE_MEDIA_LINKS)) shareByLink_(file);
  return withLock_(function () {
    var fresh = getDealRow_(dealId);
    var list = photoIds_(fresh);
    list.push(file.getId());
    updateObject_(SHEET.DEALS, fresh._row, { photoIds: list.join(','), updated: new Date() });
    return { id: file.getId(), photoIds: list };
  });
}

function removeDealPhoto(dealId, fileId) {
  return withLock_(function () {
    var d = getDealRow_(dealId);
    var list = photoIds_(d).filter(function (id) { return id !== fileId; });
    updateObject_(SHEET.DEALS, d._row, { photoIds: list.join(','), updated: new Date() });
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* already gone */ }
    return list;
  });
}

/** Moves a photo to the front so it becomes the cover image. */
function setCoverPhoto(dealId, fileId) {
  return withLock_(function () {
    var d = getDealRow_(dealId);
    var list = photoIds_(d).filter(function (id) { return id !== fileId; });
    list.unshift(fileId);
    updateObject_(SHEET.DEALS, d._row, { photoIds: list.join(','), updated: new Date() });
    return list;
  });
}

/** Small previews of a deal's photos for the web app. */
function getDealPhotoPreviews(dealId) {
  var d = getDealRow_(dealId);
  return photoIds_(d).map(function (id) {
    try {
      var f = DriveApp.getFileById(id);
      var blob = null;
      try { blob = f.getThumbnail(); } catch (e) { blob = null; }
      if (!blob && f.getSize() < 2.5 * 1024 * 1024) blob = f.getBlob();
      return {
        id: id,
        name: f.getName(),
        url: f.getUrl(),
        dataUrl: blob ? 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) : ''
      };
    } catch (err) {
      return { id: id, name: '(missing file)', url: '', dataUrl: '' };
    }
  });
}

/** Uploads a walkthrough video file to Drive and links it to the deal. */
function uploadDealVideo(dealId, fileName, mimeType, base64) {
  if (!/^video\//.test(mimeType || '')) throw new Error('Please choose a video file.');
  var deal = getDealRow_(dealId);
  var folder = dealFolder_(deal);
  var file = folder.createFile(blobFromBase64_(base64, mimeType, fileName));
  shareByLink_(file);
  return withLock_(function () {
    var fresh = getDealRow_(dealId);
    updateObject_(SHEET.DEALS, fresh._row, { videoFileId: file.getId(), videoUrl: file.getUrl(), updated: new Date() });
    return getDeal(dealId);
  });
}

/** Full tracking picture for a deal: recipients, jobs, responses. */
function getDealTracking(dealId) {
  var deal = getDeal(dealId);
  var log = readTable_(SHEET.LOG).rows.filter(function (l) { return l.dealId === dealId; });
  var jobs = readTable_(SHEET.JOBS).rows.filter(function (j) { return j.dealId === dealId; });
  var responses = readTable_(SHEET.RESPONSES).rows.filter(function (r) { return r.dealId === dealId; });
  return toClient_({
    deal: deal,
    recipients: log.reverse(),
    jobs: jobs.reverse(),
    responses: responses.reverse()
  });
}


// ================= Email.gs =================
/**
 * Email.gs — builds the branded investment-opportunity email.
 * Table-based, inline-styled HTML for compatibility with Gmail, Outlook and Apple Mail.
 * Photos are embedded inline (cid:) so they display without any public hosting.
 */

var BRAND = {
  black: '#0A0A0A',
  ink: '#111412',
  green: '#0B2E21',
  greenMid: '#14472F',
  accent: '#2E9A63',
  accentSoft: '#7BC8A0',
  paper: '#F4F6F4',
  line: '#DDE5E0',
  text: '#1B1F1D',
  muted: '#5F6B65',
  serif: "Georgia,'Times New Roman',serif",
  sans: "'Helvetica Neue',Helvetica,Arial,sans-serif"
};

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money_(n) {
  if (n === '' || n === null || n === undefined || isNaN(Number(n))) return '';
  var v = Math.round(Number(n));
  var s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-$' : '$') + s;
}

function numFmt_(n) {
  if (n === '' || n === null || n === undefined || isNaN(Number(n))) return '';
  return String(Number(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function paragraphs_(text) {
  return esc_(text).split(/\n{2,}/).map(function (p) {
    return '<p style="margin:0 0 14px 0;">' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

function fillTokens_(template, deal) {
  var map = {
    ADDRESS: str_(deal.address), CITY: str_(deal.city), STATE: str_(deal.state), ZIP: str_(deal.zip),
    PRICE: money_(deal.askingPrice), ARV: money_(deal.arv), PROPERTY_TYPE: str_(deal.propertyType),
    DEAL_ID: str_(deal.id), MARKET: str_(deal.market)
  };
  return String(template).replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, function (m, k) {
    return map[k] !== undefined ? map[k] : m;
  }).replace(/\s+\|\s+\|/g, ' |').replace(/\s{2,}/g, ' ').trim();
}

function dealSubject_(deal, settings) {
  var subj = fillTokens_(settings.SUBJECT_TEMPLATE || 'New Deal: {{ADDRESS}} [{{DEAL_ID}}]', deal);
  if (subj.indexOf(deal.id) === -1) subj += ' [' + deal.id + ']'; // always keep the ID so replies can be tracked
  return subj;
}

function videoLink_(deal) {
  return str_(deal.videoUrl);
}

function mailto_(to, subject, body) {
  return 'mailto:' + encodeURIComponent(to).replace(/%40/g, '@') +
    '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

/**
 * Builds the email. Placeholders replaced per recipient by personalize_():
 *   {{FIRST_NAME}}  {{INVESTOR_REF}}  {{TEST_BANNER}}
 * opts.imageSrc(i) returns the src for photo i (cid:photoN for sending, data: URLs for preview).
 * opts.photoCount = number of photos available.
 */
function buildDealEmail_(deal, settings, opts) {
  opts = opts || {};
  var B = BRAND;
  var m = dealMetrics_(deal);
  var company = str_(settings.COMPANY_NAME) || APP_NAME;
  var reply = replyTo_();
  var contactEmail = contactEmail_();
  var subject = dealSubject_(deal, settings);
  var title = dealTitle_(deal);
  var cityLine = [str_(deal.city), [str_(deal.state), str_(deal.zip)].filter(String).join(' ')].filter(String).join(', ');
  var photoCount = opts.photoCount || 0;
  var src = opts.imageSrc || function (i) { return 'cid:photo' + i; };
  var ref = 'Deal: ' + deal.id + ' | Investor ref: {{INVESTOR_REF}}';

  var interestedLink = mailto_(reply, 'INTERESTED - ' + deal.id + ' - ' + str_(deal.address),
    "Hi, I'm interested in " + title + '. Please send me next steps.\n\nBest number to reach me: \n\n' + ref);
  var offerLink = mailto_(reply, 'OFFER - ' + deal.id + ' - ' + str_(deal.address),
    'My offer for ' + title + ' is: $\n\nProof of funds attached: Yes / No\nClosing timeline: \n\n' + ref);
  var passLink = mailto_(reply, 'PASS - ' + deal.id + ' - ' + str_(deal.address),
    'Not for me this time.\n\n' + ref);
  var unsubLink = mailto_(reply, 'UNSUBSCRIBE', 'Please remove me from the ' + company + ' investor list.\n\nInvestor ref: {{INVESTOR_REF}}');

  var galleryUrl = '';
  if (deal.folderId && bool_(settings.SHARE_MEDIA_LINKS)) galleryUrl = 'https://drive.google.com/drive/folders/' + deal.folderId;
  var video = videoLink_(deal);

  var h = [];
  h.push('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light only"><title>', esc_(subject), '</title></head>',
    '<body style="margin:0;padding:0;background:#E9EDEA;">',
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">',
    esc_(str_(deal.propertyType) + ' · ' + money_(deal.askingPrice) + (deal.arv ? ' · ARV ' + money_(deal.arv) : '') + ' · ' + cityLine),
    '</div>',
    '{{TEST_BANNER}}',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#E9EDEA;"><tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#FFFFFF;border-collapse:collapse;">');

  // Header
  h.push('<tr><td style="background:', B.black, ';padding:26px 32px 22px 32px;border-bottom:3px solid ', B.accent, ';">');
  if (str_(settings.LOGO_URL)) {
    h.push('<img src="', esc_(settings.LOGO_URL), '" alt="', esc_(company), '" height="44" style="display:block;height:44px;border:0;">');
  } else {
    h.push('<div style="font-family:', B.serif, ';font-size:26px;letter-spacing:1px;color:#FFFFFF;line-height:1;">SameDay<span style="color:', B.accentSoft, ';">Investments</span></div>');
  }
  h.push('<div style="font-family:', B.sans, ';font-size:11px;letter-spacing:3px;text-transform:uppercase;color:', B.accentSoft, ';padding-top:10px;">Exclusive Off-Market Opportunity</div>',
    '</td></tr>');

  // Hero image
  if (photoCount > 0) {
    h.push('<tr><td style="padding:0;background:', B.black, ';"><img src="', src(0), '" width="640" alt="', esc_(title),
      '" style="display:block;width:100%;max-width:640px;height:auto;border:0;"></td></tr>');
  }

  // Title block
  h.push('<tr><td style="background:', B.green, ';padding:26px 32px;">',
    '<div style="font-family:', B.sans, ';font-size:11px;letter-spacing:2px;text-transform:uppercase;color:', B.accentSoft, ';">',
    esc_(deal.id), (deal.propertyType ? ' &nbsp;·&nbsp; ' + esc_(deal.propertyType) : ''), (deal.market ? ' &nbsp;·&nbsp; ' + esc_(deal.market) : ''), '</div>',
    '<div style="font-family:', B.serif, ';font-size:28px;line-height:1.25;color:#FFFFFF;padding-top:8px;">', esc_(deal.address), '</div>',
    '<div style="font-family:', B.sans, ';font-size:15px;color:#CFE3D7;padding-top:4px;">', esc_(cityLine), '</div>',
    '</td></tr>');

  // Key numbers
  var keyNums = [['Price', money_(deal.askingPrice)], ['ARV', money_(deal.arv)], ['Est. Repairs', money_(deal.repairs)], ['Potential Spread', money_(m.spread)]]
    .filter(function (k) { return k[1]; });
  if (keyNums.length) {
    var w = Math.floor(100 / keyNums.length);
    h.push('<tr><td style="padding:0;background:', B.ink, ';"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>');
    keyNums.forEach(function (k, i) {
      h.push('<td width="', w, '%" align="center" style="padding:20px 6px;', i ? 'border-left:1px solid #26302B;' : '', '">',
        '<div style="font-family:', B.sans, ';font-size:10px;letter-spacing:2px;text-transform:uppercase;color:', B.accentSoft, ';">', esc_(k[0]), '</div>',
        '<div style="font-family:', B.serif, ';font-size:22px;color:#FFFFFF;padding-top:6px;">', esc_(k[1]), '</div></td>');
    });
    h.push('</tr></table></td></tr>');
  }

  // Greeting + description
  h.push('<tr><td style="padding:28px 32px 6px 32px;font-family:', B.sans, ';font-size:15px;line-height:1.65;color:', B.text, ';">',
    '<p style="margin:0 0 14px 0;">Hi {{FIRST_NAME}},</p>',
    '<p style="margin:0 0 14px 0;">We just locked up a new property and you are among the first in our investor network to see it. Details are below — these move quickly.</p>');
  if (str_(deal.description)) h.push(paragraphs_(deal.description));
  h.push('</td></tr>');

  // Property details
  var details = [];
  if (deal.beds !== '' || deal.baths !== '') details.push(['Bedrooms / Baths', (deal.beds !== '' ? deal.beds : '–') + ' bd / ' + (deal.baths !== '' ? deal.baths : '–') + ' ba']);
  if (deal.sqft) details.push(['Living Area', numFmt_(deal.sqft) + ' sq ft']);
  if (str_(deal.lotSize)) details.push(['Lot Size', str_(deal.lotSize)]);
  if (deal.yearBuilt) details.push(['Year Built', String(deal.yearBuilt)]);
  if (deal.propertyType) details.push(['Property Type', str_(deal.propertyType)]);
  details.push(['Asking Price', money_(deal.askingPrice)]);
  if (bool_(deal.showAssignment) && deal.assignmentPrice !== '') details.push(['Assignment Price', money_(deal.assignmentPrice)]);
  if (deal.arv) details.push(['After Repair Value', money_(deal.arv)]);
  if (deal.repairs !== '') details.push(['Estimated Repairs', money_(deal.repairs)]);
  if (m.allIn) details.push(['All-In (Price + Repairs)', money_(m.allIn) + (m.allInPctArv ? ' &nbsp;(' + m.allInPctArv + '% of ARV)' : '')]);
  if (m.pricePerSqft) details.push(['Price / Sq Ft', '$' + m.pricePerSqft]);
  var closing = deal.closingDate instanceof Date ? fmtDate_(deal.closingDate, 'MMMM d, yyyy') : prettyDate_(deal.closingDate);
  if (closing) details.push(['Closing Date', closing]);

  h.push('<tr><td style="padding:10px 32px 8px 32px;">',
    '<div style="font-family:', B.sans, ';font-size:11px;letter-spacing:2px;text-transform:uppercase;color:', B.accent, ';padding-bottom:10px;border-bottom:1px solid ', B.line, ';">Property &amp; Deal Numbers</div>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:', B.sans, ';font-size:14px;color:', B.text, ';">');
  details.forEach(function (d, i) {
    // values that contain our own &nbsp; markup are pre-escaped
    var val = d[1].indexOf('&nbsp;') > -1 ? d[1].replace(/[<>"]/g, '') : esc_(d[1]);
    h.push('<tr style="background:', i % 2 ? '#FFFFFF' : B.paper, ';"><td style="padding:10px 12px;color:', B.muted, ';width:48%;">', esc_(d[0]),
      '</td><td style="padding:10px 12px;font-weight:bold;text-align:right;">', val, '</td></tr>');
  });
  h.push('</table></td></tr>');

  // Gallery
  if (photoCount > 1) {
    h.push('<tr><td style="padding:22px 32px 4px 32px;"><div style="font-family:', B.sans, ';font-size:11px;letter-spacing:2px;text-transform:uppercase;color:', B.accent, ';padding-bottom:10px;border-bottom:1px solid ', B.line, ';">Photos</div></td></tr>',
      '<tr><td style="padding:10px 26px 0 26px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">');
    for (var i = 1; i < photoCount; i += 2) {
      h.push('<tr>');
      for (var j = i; j < i + 2; j++) {
        h.push('<td width="50%" style="padding:6px;" valign="top">');
        if (j < photoCount) h.push('<img src="', src(j), '" width="282" alt="Photo ', j + 1, '" style="display:block;width:100%;height:auto;border:0;">');
        h.push('</td>');
      }
      h.push('</tr>');
    }
    h.push('</table></td></tr>');
  }

  // Media links
  if (video || galleryUrl) {
    h.push('<tr><td style="padding:16px 32px 0 32px;font-family:', B.sans, ';font-size:14px;">');
    if (video) h.push(button_(video, '▶&nbsp; Watch Video Walkthrough', B.black, '#FFFFFF', B.black), '&nbsp; ');
    if (galleryUrl) h.push(button_(galleryUrl, 'View Full Photo Gallery', '#FFFFFF', B.green, B.green));
    h.push('</td></tr>');
  }

  // Access instructions
  var showAccess = deal.showAccess === '' || deal.showAccess === undefined ? true : bool_(deal.showAccess);
  if (str_(deal.access) && showAccess) {
    h.push('<tr><td style="padding:24px 32px 0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
      '<td style="border-left:3px solid ', B.accent, ';background:', B.paper, ';padding:14px 16px;font-family:', B.sans, ';font-size:14px;line-height:1.6;color:', B.text, ';">',
      '<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:', B.accent, ';padding-bottom:6px;">Access &amp; Showings</div>',
      esc_(deal.access).replace(/\n/g, '<br>'), '</td></tr></table></td></tr>');
  }

  // CTA
  h.push('<tr><td align="center" style="padding:30px 32px 10px 32px;">',
    '<div style="font-family:', B.serif, ';font-size:20px;color:', B.text, ';padding-bottom:14px;">Want this one?</div>',
    button_(interestedLink, "I'M INTERESTED", B.accent, '#FFFFFF', B.accent, true), '&nbsp; ',
    button_(offerLink, 'MAKE AN OFFER', '#FFFFFF', B.green, B.green, true),
    '<div style="font-family:', B.sans, ';font-size:12px;color:', B.muted, ';padding-top:12px;">Or simply reply to this email. First come, first served — proof of funds required. ',
    '<a href="', passLink, '" style="color:', B.muted, ';">Not for me</a></div>',
    '</td></tr>');

  // Contact card
  var contactBits = [];
  if (str_(settings.CONTACT_NAME)) contactBits.push('<div style="font-family:' + B.serif + ';font-size:18px;color:#FFFFFF;">' + esc_(settings.CONTACT_NAME) + '</div>');
  contactBits.push('<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:' + B.accentSoft + ';padding:4px 0 10px 0;">' + esc_(company) + ' · Dispositions</div>');
  if (str_(settings.CONTACT_PHONE)) contactBits.push('<div style="padding:2px 0;"><a href="tel:' + esc_(String(settings.CONTACT_PHONE).replace(/[^\d+]/g, '')) + '" style="color:#FFFFFF;text-decoration:none;">' + esc_(settings.CONTACT_PHONE) + '</a></div>');
  if (contactEmail) contactBits.push('<div style="padding:2px 0;"><a href="mailto:' + esc_(contactEmail) + '" style="color:#FFFFFF;text-decoration:none;">' + esc_(contactEmail) + '</a></div>');
  if (str_(settings.WEBSITE)) contactBits.push('<div style="padding:2px 0;"><a href="' + esc_(websiteUrl_(settings.WEBSITE)) + '" style="color:' + B.accentSoft + ';text-decoration:none;">' + esc_(String(settings.WEBSITE).replace(/^https?:\/\//, '')) + '</a></div>');
  h.push('<tr><td style="padding:26px 32px 32px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    '<td style="background:', B.green, ';padding:20px 22px;font-family:', B.sans, ';font-size:14px;line-height:1.5;color:#FFFFFF;">',
    contactBits.join(''), '</td></tr></table></td></tr>');

  // Footer
  h.push('<tr><td style="background:', B.black, ';padding:22px 32px;font-family:', B.sans, ';font-size:11px;line-height:1.6;color:#8E9A94;">');
  if (str_(settings.DISCLAIMER)) h.push('<p style="margin:0 0 10px 0;">', esc_(settings.DISCLAIMER), '</p>');
  h.push('<p style="margin:0 0 10px 0;">You are receiving this because you are a member of the ', esc_(company),
    ' investor network. Each email is sent individually — your address is never shared with other investors.</p>');
  if (str_(settings.COMPANY_ADDRESS)) h.push('<p style="margin:0 0 10px 0;">', esc_(company), ' · ', esc_(settings.COMPANY_ADDRESS), '</p>');
  h.push('<p style="margin:0;"><a href="', unsubLink, '" style="color:', B.accentSoft, ';">Unsubscribe</a> &nbsp;·&nbsp; Ref ', esc_(deal.id), '</p>',
    '</td></tr>');

  h.push('</table></td></tr></table></body></html>');

  // Plain-text alternative
  var t = [];
  t.push(company.toUpperCase() + ' — EXCLUSIVE OFF-MARKET OPPORTUNITY', '', 'Hi {{FIRST_NAME}},', '',
    title + (deal.zip ? ' ' + deal.zip : ''), deal.id + (deal.propertyType ? ' · ' + deal.propertyType : ''), '');
  details.forEach(function (d) { t.push(d[0] + ': ' + String(d[1]).replace(/&nbsp;/g, ' ')); });
  if (m.spread) t.push('Potential Spread: ' + money_(m.spread));
  if (str_(deal.description)) t.push('', deal.description);
  if (str_(deal.access) && showAccess) t.push('', 'ACCESS & SHOWINGS', deal.access);
  if (video) t.push('', 'Video walkthrough: ' + video);
  if (galleryUrl) t.push('Photo gallery: ' + galleryUrl);
  t.push('', 'Interested? Reply to this email with "INTERESTED" or your offer. Reference ' + deal.id + '.', '');
  if (str_(settings.CONTACT_NAME)) t.push(settings.CONTACT_NAME);
  if (str_(settings.CONTACT_PHONE)) t.push(settings.CONTACT_PHONE);
  if (contactEmail) t.push(contactEmail);
  t.push('', str_(settings.DISCLAIMER), str_(settings.COMPANY_ADDRESS), 'To unsubscribe, reply with UNSUBSCRIBE.');

  return { subject: subject, html: h.join(''), text: t.join('\n') };
}

function websiteUrl_(w) {
  w = str_(w);
  return /^https?:\/\//i.test(w) ? w : 'https://' + w;
}

function prettyDate_(ymd) {
  var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return str_(ymd);
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}

function button_(href, label, bg, color, border, bold) {
  return '<a href="' + esc_(href) + '" style="display:inline-block;margin:4px 0;padding:13px 22px;background:' + bg +
    ';color:' + color + ';border:2px solid ' + border + ';font-family:' + BRAND.sans + ';font-size:13px;letter-spacing:1.5px;' +
    (bold ? 'font-weight:bold;' : '') + 'text-decoration:none;">' + label + '</a>';
}

/** Fills per-recipient placeholders. */
function personalize_(content, investor, testBannerHtml, isHtml) {
  var first = str_(investor && investor.firstName) || 'there';
  return content
    .replace(/\{\{FIRST_NAME\}\}/g, isHtml ? esc_(first) : first)
    .replace(/\{\{INVESTOR_REF\}\}/g, encodeURIComponent(str_(investor && investor.id) || 'N/A'))
    .replace(/\{\{TEST_BANNER\}\}/g, testBannerHtml || '');
}

function testBanner_(investor, isHtml) {
  var who = investor ? investorName_(investor) + ' <' + str_(investor.email) + '>' : 'a sample investor';
  if (!isHtml) return '*** TEST MODE — in live mode this email would go to: ' + who + ' ***\n\n';
  return '<div style="background:#F6C343;color:#1B1F1D;font-family:Arial,sans-serif;font-size:13px;padding:12px;text-align:center;">' +
    '<b>TEST MODE</b> — in live mode this email would be delivered to: ' + esc_(who) + '</div>';
}

/** Loads up to n photo blobs for inline embedding. */
function loadInlineImages_(deal, n) {
  var blobs = {};
  var count = 0;
  photoIds_(deal).slice(0, n).forEach(function (id) {
    try {
      var f = DriveApp.getFileById(id);
      var blob = f.getBlob();
      if (f.getSize() > 3 * 1024 * 1024) {
        var thumb = f.getThumbnail();
        if (thumb) blob = thumb;
      }
      blob.setName('photo' + count + '.' + (/png/.test(blob.getContentType()) ? 'png' : 'jpg'));
      blobs['photo' + count] = blob;
      count++;
    } catch (e) {
      // missing/unreadable file — skip it
    }
  });
  return { count: count, blobs: blobs };
}

// ---------- client API ----------

/** HTML preview of the email exactly as an investor will see it. */
function getEmailPreview(dealId) {
  var deal = getDealRow_(dealId);
  var settings = getSettings_();
  var imgs = loadInlineImages_(deal, Number(settings.EMAIL_PHOTO_COUNT) || 4);
  var dataUrls = [];
  for (var i = 0; i < imgs.count; i++) {
    var b = imgs.blobs['photo' + i];
    dataUrls.push('data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()));
  }
  var email = buildDealEmail_(deal, settings, { photoCount: imgs.count, imageSrc: function (k) { return dataUrls[k]; } });
  var sample = { firstName: 'Alex', id: 'INV-PREVIEW' };
  return { subject: email.subject, html: personalize_(email.html, sample, '', true) };
}


// ================= Distribution.gs =================
/**
 * Distribution.gs — the SEND TO INVESTOR NETWORK engine.
 *
 * Flow:
 *   1. previewAudience(dealId, audience)     → who will receive it (live counts in the UI)
 *   2. prepareDistribution(dealId, audience) → locks the recipient list, returns a one-time token
 *   3. confirmDistribution(token, typed)     → LIVE mode requires typing SEND; queues + sends
 *   4. runQueuedDistributions()              → trigger that continues large sends
 *                                              (6-min execution limit, daily Gmail quota)
 *
 * Every investor gets their OWN email (one recipient in the To field, no CC/BCC),
 * so investor addresses are never exposed to each other.
 *
 * audience = {
 *   mode: 'all' | 'segments' | 'selected',
 *   tiers: [], categories: [], markets: [],   // used when mode = 'segments' (OR within a group, AND across groups)
 *   investorIds: [],                          // used when mode = 'selected'
 *   matchCriteria: bool,                      // only investors whose buy box fits the deal
 *   excludeAlreadySent: bool                  // skip investors who already received this deal live
 * }
 */

function lc_(s) { return str_(s).toLowerCase(); }

function overlap_(a, b) {
  var bl = b.map(lc_);
  return a.some(function (x) { return bl.indexOf(lc_(x)) > -1; });
}

/** Does the investor's buy box fit this deal? Empty criteria = no restriction. */
function matchesCriteria_(inv, deal) {
  var types = list_(inv.propertyTypes);
  if (types.length && str_(deal.propertyType) && !overlap_(types, [deal.propertyType])) return false;
  var price = Number(deal.askingPrice) || 0;
  if (price) {
    if (Number(inv.minPrice) && price < Number(inv.minPrice)) return false;
    if (Number(inv.maxPrice) && price > Number(inv.maxPrice)) return false;
  }
  var markets = list_(inv.markets);
  if (markets.length) {
    var dealPlaces = [deal.market, deal.city, deal.state, deal.zip].map(lc_).filter(String);
    if (dealPlaces.length) {
      var hit = markets.some(function (mk) {
        var x = lc_(mk);
        return dealPlaces.some(function (p) { return p === x || (p.length > 2 && x.indexOf(p) > -1) || (x.length > 2 && p.indexOf(x) > -1); });
      });
      if (!hit) return false;
    }
  }
  return true;
}

function resolveAudience_(deal, audience, investors, logRows) {
  audience = audience || { mode: 'all' };
  var mode = audience.mode || 'all';
  var tiers = list_(audience.tiers), cats = list_(audience.categories), mkts = list_(audience.markets);
  var picked = audience.investorIds || [];
  var already = {};
  if (audience.excludeAlreadySent) {
    logRows.forEach(function (l) {
      if (l.dealId === deal.id && l.mode === 'LIVE' && l.status === 'Sent') already[l.investorId] = true;
    });
  }
  var ex = { inactive: 0, optedOut: 0, invalidEmail: 0, duplicate: 0, notInSegment: 0, criteria: 0, alreadySent: 0 };
  var seen = {};
  var included = [];
  investors.forEach(function (inv) {
    if (mode === 'selected' && picked.indexOf(inv.id) === -1) return; // not part of the hand-picked list at all
    if ((str_(inv.status) || 'Active') !== 'Active') { ex.inactive++; return; }
    if (bool_(inv.optOut)) { ex.optedOut++; return; }
    var email = lc_(inv.email);
    if (!isEmail_(email)) { ex.invalidEmail++; return; }
    if (seen[email]) { ex.duplicate++; return; }
    if (mode === 'segments') {
      if (tiers.length && !overlap_([inv.tier], tiers)) { ex.notInSegment++; return; }
      if (cats.length && !overlap_(list_(inv.categories), cats)) { ex.notInSegment++; return; }
      if (mkts.length && !overlap_(list_(inv.markets), mkts)) { ex.notInSegment++; return; }
    }
    if (audience.matchCriteria && !matchesCriteria_(inv, deal)) { ex.criteria++; return; }
    if (already[inv.id]) { ex.alreadySent++; return; }
    seen[email] = true;
    included.push(inv);
  });
  return { included: included, excluded: ex };
}

function describeAudience_(a) {
  a = a || {};
  var parts = [];
  if (a.mode === 'selected') parts.push('Hand-picked (' + (a.investorIds || []).length + ')');
  else if (a.mode === 'segments') {
    if (list_(a.tiers).length) parts.push('Tiers: ' + list_(a.tiers).join('/'));
    if (list_(a.categories).length) parts.push('Categories: ' + list_(a.categories).join('/'));
    if (list_(a.markets).length) parts.push('Markets: ' + list_(a.markets).join('/'));
    if (!parts.length) parts.push('All active investors');
  } else parts.push('All active investors');
  if (a.matchCriteria) parts.push('buy-box match');
  if (a.excludeAlreadySent) parts.push('excluding previous recipients');
  return parts.join('; ');
}

function maskEmail_(e) {
  var p = String(e).split('@');
  if (p.length !== 2) return e;
  return p[0].slice(0, 2) + '•••@' + p[1];
}

// ---------- client API ----------

function previewAudience(dealId, audience) {
  var deal = getDealRow_(dealId);
  var res = resolveAudience_(deal, audience, readTable_(SHEET.INVESTORS).rows, readTable_(SHEET.LOG).rows);
  return {
    count: res.included.length,
    excluded: res.excluded,
    recipients: res.included.map(function (i) {
      return { id: i.id, name: investorName_(i), email: str_(i.email), tier: str_(i.tier), categories: str_(i.categories) };
    }),
    testMode: isTestMode_(),
    quota: remainingQuota_()
  };
}

/** Sends a single preview of the deal email to one address (defaults to TEST_EMAIL). */
function sendTestEmail(dealId, toEmail) {
  var settings = getSettings_();
  var to = str_(toEmail) || str_(settings.TEST_EMAIL) || currentUser_();
  if (!isEmail_(to)) throw new Error('Enter a valid email address for the test.');
  var deal = getDealRow_(dealId);
  var imgs = loadInlineImages_(deal, Number(settings.EMAIL_PHOTO_COUNT) || 4);
  var email = buildDealEmail_(deal, settings, { photoCount: imgs.count });
  var sample = { firstName: 'there', id: 'TEST' };
  sendOne_(to, '[TEST] ' + email.subject,
    personalize_(email.text, sample, testBanner_(null, false), false),
    personalize_(email.html, sample, testBanner_(null, true), true),
    imgs.blobs, settings);
  return { sentTo: to, quota: remainingQuota_() };
}

/**
 * Locks in the recipient list and returns a one-time confirmation token (valid 15 minutes).
 */
function prepareDistribution(dealId, audience) {
  var deal = getDealRow_(dealId);
  if (str_(deal.status) === 'Sold') throw new Error('This deal is marked SOLD. Change its status before distributing.');
  var settings = getSettings_();
  var res = resolveAudience_(deal, audience, readTable_(SHEET.INVESTORS).rows, readTable_(SHEET.LOG).rows);
  if (!res.included.length) throw new Error('No investors match this audience.');
  var testMode = isTestMode_();
  var token = Utilities.getUuid();
  var payload = {
    dealId: dealId,
    audience: audience || { mode: 'all' },
    ids: res.included.map(function (i) { return i.id; }),
    mode: testMode ? 'TEST' : 'LIVE',
    user: currentUser_()
  };
  CacheService.getScriptCache().put('dist_' + token, JSON.stringify(payload), 900);
  var testMax = Math.max(0, parseInt(settings.TEST_MODE_MAX_EMAILS, 10) || 0);
  return {
    token: token,
    mode: payload.mode,
    dealId: dealId,
    dealTitle: dealTitle_(deal),
    dealStatus: str_(deal.status) || 'Available',
    recipientCount: res.included.length,
    excluded: res.excluded,
    audienceLabel: describeAudience_(audience),
    testEmail: str_(settings.TEST_EMAIL),
    testDeliveries: testMode ? Math.min(testMax, res.included.length) : 0,
    quota: remainingQuota_(),
    previouslySent: Number(deal.timesDistributed) || 0
  };
}

/**
 * Executes a prepared distribution. In LIVE mode `typed` must be exactly "SEND".
 */
function confirmDistribution(token, typed) {
  var raw = CacheService.getScriptCache().get('dist_' + token);
  if (!raw) throw new Error('This confirmation has expired. Please review the distribution again.');
  var p = JSON.parse(raw);
  var nowMode = isTestMode_() ? 'TEST' : 'LIVE';
  if (nowMode !== p.mode) throw new Error('Test/Live mode changed since this was prepared. Please review again.');
  if (p.mode === 'LIVE' && String(typed || '').trim().toUpperCase() !== 'SEND') {
    throw new Error('Type SEND to confirm a live distribution.');
  }
  CacheService.getScriptCache().remove('dist_' + token); // one-time use

  var jobId = withLock_(function () {
    var deal = getDealRow_(p.dealId);
    if (str_(deal.status) === 'Sold') throw new Error('This deal is marked SOLD.');
    var settings = getSettings_();
    var investors = readTable_(SHEET.INVESTORS).rows;
    var byId = {};
    investors.forEach(function (i) { byId[i.id] = i; });
    var testMax = Math.max(0, parseInt(settings.TEST_MODE_MAX_EMAILS, 10) || 0);
    var id = 'JOB-' + fmtDate_(new Date(), 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
    var now = new Date();
    var rows = [];
    p.ids.forEach(function (invId, n) {
      var inv = byId[invId];
      if (!inv) return;
      var status = 'Queued';
      if (p.mode === 'TEST' && n >= testMax) status = 'Simulated';
      rows.push({
        id: shortId_('L-'), jobId: id, dealId: p.dealId, investorId: inv.id, investorName: investorName_(inv),
        investorEmail: lc_(inv.email), tier: str_(inv.tier), mode: p.mode, status: status, queuedAt: now,
        sentAt: '', deliveredTo: '', error: ''
      });
    });
    appendObjects_(SHEET.JOBS, [{
      id: id, dealId: p.dealId, property: dealTitle_(deal), mode: p.mode, audience: describeAudience_(p.audience),
      created: now, createdBy: p.user || currentUser_(), total: rows.length, sent: 0, failed: 0,
      simulated: rows.filter(function (r) { return r.status === 'Simulated'; }).length,
      status: 'Sending', completed: '', notes: ''
    }]);
    appendObjects_(SHEET.LOG, rows);
    return id;
  });

  processQueueSafely_(jobId);
  return getJobStatus(jobId);
}

function getJobStatus(jobId) {
  var job = findBy_(SHEET.JOBS, 'id', jobId);
  if (!job) throw new Error('Job ' + jobId + ' not found.');
  var queued = readTable_(SHEET.LOG).rows.filter(function (l) { return l.jobId === jobId && l.status === 'Queued'; }).length;
  var o = toClient_(job);
  o.queued = queued;
  o.quota = remainingQuota_();
  return o;
}

function listJobs() {
  return toClient_(readTable_(SHEET.JOBS).rows.reverse());
}

/** Cancels the not-yet-sent part of a job. */
function cancelJob(jobId) {
  return withLock_(function () {
    var t = readTable_(SHEET.LOG);
    t.rows.forEach(function (l) {
      if (l.jobId === jobId && l.status === 'Queued') updateObject_(SHEET.LOG, l._row, { status: 'Cancelled' });
    });
    refreshJob_(jobId);
    return getJobStatus(jobId);
  });
}

/** Trigger entry point — continues any queued sends. Safe to run any time. */
function runQueuedDistributions() {
  deleteTriggers_('runQueuedDistributions');
  processQueueSafely_(null);
}

// ---------- queue internals ----------

function processQueueSafely_(jobId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { scheduleQueue_(60 * 1000); return; }
  var res;
  try {
    _lockDepth = 1; _lock = lock;
    res = processQueue_(jobId, QUEUE_TIME_BUDGET_MS);
  } finally {
    _lockDepth = 0;
    lock.releaseLock();
  }
  if (res && res.remaining > 0) scheduleQueue_(res.quotaExhausted ? 60 * 60 * 1000 : 60 * 1000);
}

function scheduleQueue_(ms) {
  if (hasTrigger_('runQueuedDistributions')) return;
  ScriptApp.newTrigger('runQueuedDistributions').timeBased().after(ms).create();
}

/**
 * Sends queued emails until done, out of time, or out of daily quota.
 * Caller must hold the script lock.
 */
function processQueue_(onlyJobId, budgetMs) {
  var started = Date.now();
  var settings = getSettings_();
  var log = readTable_(SHEET.LOG);
  var queued = log.rows.filter(function (l) { return l.status === 'Queued' && (!onlyJobId || l.jobId === onlyJobId); });
  if (!queued.length) {
    if (onlyJobId) refreshJob_(onlyJobId);
    return { remaining: 0, sent: 0 };
  }
  var quota = remainingQuota_();
  if (quota < 0) quota = 1e9; // quota unavailable — let Gmail enforce it
  var cache = {};       // dealId+mode → { email, imgs }
  var investorsById = {};
  readTable_(SHEET.INVESTORS).rows.forEach(function (i) { investorsById[i.id] = i; });
  var sentLive = [];    // investor ids sent live in this run
  var touched = {};     // row numbers changed
  var quotaExhausted = false;
  var processed = 0;
  var testTo = str_(settings.TEST_EMAIL) || currentUser_();

  for (var i = 0; i < queued.length; i++) {
    if (Date.now() - started > budgetMs) break;
    if (quota <= 0) { quotaExhausted = true; break; }
    var row = queued[i];
    var key = row.dealId + '|' + row.mode;
    try {
      if (!cache[key]) {
        var deal = getDealRow_(row.dealId);
        var imgs = loadInlineImages_(deal, Number(settings.EMAIL_PHOTO_COUNT) || 4);
        cache[key] = { email: buildDealEmail_(deal, settings, { photoCount: imgs.count }), imgs: imgs };
      }
      var c = cache[key];
      var inv = investorsById[row.investorId] || { id: row.investorId, firstName: String(row.investorName).split(' ')[0], email: row.investorEmail };
      var isTest = row.mode !== 'LIVE';
      // Re-check opt-out at send time (they may have unsubscribed after queueing)
      if (!isTest && (bool_(inv.optOut) || (str_(inv.status) || 'Active') !== 'Active')) {
        row.status = 'Skipped'; row.error = 'Opted out or deactivated before send';
      } else {
        var to = isTest ? testTo : lc_(row.investorEmail);
        sendOne_(to,
          (isTest ? '[TEST] ' : '') + c.email.subject,
          personalize_(c.email.text, inv, isTest ? testBanner_(inv, false) : '', false),
          personalize_(c.email.html, inv, isTest ? testBanner_(inv, true) : '', true),
          c.imgs.blobs, settings);
        row.status = 'Sent'; row.sentAt = new Date(); row.deliveredTo = to; row.error = '';
        quota--;
        if (!isTest) sentLive.push(row);
      }
    } catch (err) {
      var msg = String(err && err.message || err);
      if (/limit|quota|too many/i.test(msg)) { quotaExhausted = true; break; }
      row.status = 'Failed'; row.error = msg.slice(0, 300);
    }
    touched[row._row] = row;
    processed++;
    if (processed % 25 === 0) flushLog_(log, touched);
  }
  flushLog_(log, touched);
  if (sentLive.length) recordInvestorSends_(sentLive);

  var jobIds = {};
  queued.forEach(function (q) { jobIds[q.jobId] = true; });
  Object.keys(jobIds).forEach(function (j) { refreshJob_(j, quotaExhausted); });

  var remaining = queued.filter(function (q) { return q.status === 'Queued'; }).length;
  return { remaining: remaining, sent: processed, quotaExhausted: quotaExhausted };
}

function flushLog_(log, touched) {
  var rowsNums = Object.keys(touched).map(Number).sort(function (a, b) { return a - b; });
  if (!rowsNums.length) return;
  var headers = log.headers;
  var sc = headers.indexOf(LOG_MAP.status);
  var ec = headers.indexOf(LOG_MAP.error);
  var keys = ['status', 'queuedAt', 'sentAt', 'deliveredTo', 'error'];
  var contiguous = ec - sc === 4 && keys.every(function (k, i) { return headers.indexOf(LOG_MAP[k]) === sc + i; });
  // group consecutive rows into blocks for fewer writes
  var blocks = [];
  rowsNums.forEach(function (n) {
    var last = blocks[blocks.length - 1];
    if (last && n === last.end + 1) last.end = n; else blocks.push({ start: n, end: n });
  });
  blocks.forEach(function (b) {
    if (contiguous) {
      var vals = [];
      for (var n = b.start; n <= b.end; n++) {
        var r = touched[n];
        vals.push(keys.map(function (k) { return cellValue_(r[k]); }));
      }
      log.sheet.getRange(b.start, sc + 1, vals.length, 5).setValues(vals);
    } else {
      for (var m = b.start; m <= b.end; m++) {
        var t = touched[m];
        updateObject_(SHEET.LOG, m, { status: t.status, sentAt: t.sentAt, deliveredTo: t.deliveredTo, error: t.error });
      }
    }
  });
  Object.keys(touched).forEach(function (k) { delete touched[k]; });
}

/** Updates "Last Deal Sent" and "Deals Received" for investors who just received a live deal. */
function recordInvestorSends_(rows) {
  var t = readTable_(SHEET.INVESTORS);
  if (!t.rows.length) return;
  var counts = {};
  rows.forEach(function (r) { counts[r.investorId] = (counts[r.investorId] || 0) + 1; });
  var first = t.rows[0]._row, last = t.rows[t.rows.length - 1]._row;
  var lastSent = [], received = [];
  var byRow = {};
  t.rows.forEach(function (r) { byRow[r._row] = r; });
  var sh = t.sheet;
  var lsCol = t.headers.indexOf(INVESTOR_MAP.lastSent) + 1;
  var drCol = t.headers.indexOf(INVESTOR_MAP.dealsReceived) + 1;
  var curLs = sh.getRange(first, lsCol, last - first + 1, 1).getValues();
  var curDr = sh.getRange(first, drCol, last - first + 1, 1).getValues();
  for (var n = first; n <= last; n++) {
    var r = byRow[n];
    var idx = n - first;
    if (r && counts[r.id]) {
      lastSent.push([new Date()]);
      received.push([(Number(curDr[idx][0]) || 0) + counts[r.id]]);
    } else {
      lastSent.push([curLs[idx][0]]);
      received.push([curDr[idx][0]]);
    }
  }
  sh.getRange(first, lsCol, lastSent.length, 1).setValues(lastSent);
  sh.getRange(first, drCol, received.length, 1).setValues(received);
}

/** Recomputes a job's counters/status and, for live jobs, the deal's distribution stats. */
function refreshJob_(jobId, quotaExhausted) {
  var job = findBy_(SHEET.JOBS, 'id', jobId);
  if (!job) return;
  var log = readTable_(SHEET.LOG).rows;
  var rows = log.filter(function (l) { return l.jobId === jobId; });
  var c = { Sent: 0, Failed: 0, Simulated: 0, Queued: 0, Skipped: 0, Cancelled: 0 };
  rows.forEach(function (r) { c[r.status] = (c[r.status] || 0) + 1; });
  var status;
  if (c.Queued > 0) status = quotaExhausted ? 'Paused — daily email limit (resumes automatically)' : 'Sending';
  else if (c.Cancelled > 0) status = 'Cancelled';
  else if (c.Failed > 0) status = 'Completed with errors';
  else status = 'Completed';
  var wasDone = /^Completed|^Cancelled/.test(str_(job.status));
  var f = { sent: c.Sent, failed: c.Failed, simulated: c.Simulated, status: status };
  if (c.Queued === 0 && !job.completed) f.completed = new Date();
  if (c.Skipped) f.notes = c.Skipped + ' skipped (opted out / deactivated before send)';
  updateObject_(SHEET.JOBS, job._row, f);

  if (job.mode === 'LIVE') {
    var deal = findBy_(SHEET.DEALS, 'id', job.dealId);
    if (deal) {
      var uniq = {};
      log.forEach(function (l) { if (l.dealId === job.dealId && l.mode === 'LIVE' && l.status === 'Sent') uniq[l.investorId] = true; });
      var df = { totalRecipients: Object.keys(uniq).length };
      if (c.Sent > 0) df.lastDistributed = new Date();
      if (c.Queued === 0 && !wasDone && c.Sent > 0) df.timesDistributed = (Number(deal.timesDistributed) || 0) + 1;
      updateObject_(SHEET.DEALS, deal._row, df);
    }
  }
}

/** Sends exactly one email to exactly one recipient. */
function sendOne_(to, subject, text, html, inlineImages, settings) {
  var opts = {
    htmlBody: html,
    name: str_(settings.SENDER_NAME) || APP_NAME,
    replyTo: replyTo_()
  };
  if (inlineImages && Object.keys(inlineImages).length) opts.inlineImages = inlineImages;
  if (str_(settings.FROM_ALIAS)) opts.from = str_(settings.FROM_ALIAS);
  GmailApp.sendEmail(to, subject, text, opts);
}

// ---------- trigger helpers ----------

function hasTrigger_(fn) {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === fn; });
}

function deleteTriggers_(fn) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  });
}


// ================= Responses.gs =================
/**
 * Responses.gs — tracks interested buyers and replies.
 *
 * Responses are captured two ways:
 *   1. Automatically: scanInboxForResponses() reads replies in this Gmail inbox whose
 *      subject/body contains a deal ID (e.g. SDI-2026-0001). The email buttons
 *      (I'M INTERESTED / MAKE AN OFFER / Not for me / Unsubscribe) pre-fill subjects
 *      so replies are classified automatically. Runs every 15 min once enabled.
 *   2. Manually: logResponse() from the app (phone calls, texts, etc.).
 */

var DEAL_ID_RE = /SDI-\d{4}-\d{4}/i;
var INVESTOR_REF_RE = /INV-\d{5}/i;

function parseFrom_(from) {
  var s = String(from || '');
  var m = s.match(/<([^>]+)>/);
  var email = (m ? m[1] : s).trim().toLowerCase();
  var name = m ? s.slice(0, s.indexOf('<')).replace(/"/g, '').trim() : '';
  return { email: email, name: name };
}

function stripQuoted_(body) {
  var lines = String(body || '').split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (/^\s*>/.test(l)) break;
    if (/^On .+wrote:\s*$/i.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^From: /i.test(l)) break;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
}

function parseOffer_(text) {
  var m = String(text || '').match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\b/i);
  if (!m) return '';
  var n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2] && /k/i.test(m[2])) n *= 1000;
  if (m[2] && /m/i.test(m[2])) n *= 1000000;
  return n > 0 ? n : '';
}

function classifyReply_(subject, body) {
  var s = String(subject || '').replace(/^(re|fw|fwd)\s*:\s*/ig, '').trim();
  var b = String(body || '').toLowerCase();
  if (/^unsubscribe\b/i.test(s) || /^\s*(unsubscribe|remove me|stop)\b/.test(b)) return 'Unsubscribe';
  if (/^offer\b/i.test(s)) return 'Offer';
  if (/^pass\b/i.test(s)) return 'Not Interested';
  if (/^interested\b/i.test(s)) return 'Interested';
  if (/not interested|pass on (this|it)|no thanks|not for me|i'?ll pass/.test(b)) return 'Not Interested';
  if (/\boffer\b/.test(b) && parseOffer_(body)) return 'Offer';
  if (/interested|i'?ll take it|i want it|send (me )?(the )?(contract|address|info|details)|lock it up|still available|can i see it|schedule a (showing|walk)/.test(b)) return 'Interested';
  if (/\?/.test(b)) return 'Question';
  return 'Reply';
}

/** Recounts the deal's Responses / Interested columns. */
function recountDeal_(dealId) {
  if (!dealId) return;
  var deal = findBy_(SHEET.DEALS, 'id', dealId);
  if (!deal) return;
  var rs = readTable_(SHEET.RESPONSES).rows.filter(function (r) { return r.dealId === dealId; });
  var interested = {};
  rs.forEach(function (r) {
    if (r.type === 'Interested' || r.type === 'Offer') interested[lc_(r.investorEmail) || r.id] = true;
  });
  updateObject_(SHEET.DEALS, deal._row, { responses: rs.length, interested: Object.keys(interested).length });
}

function myAddresses_() {
  var s = getSettings_();
  var mine = [currentUser_(), s.REPLY_TO, s.FROM_ALIAS, s.CONTACT_EMAIL].map(lc_).filter(String);
  try { GmailApp.getAliases().forEach(function (a) { mine.push(lc_(a)); }); } catch (e) { /* ignore */ }
  return mine;
}

// ---------- client API ----------

/** Scans Gmail for investor replies and logs them. Safe to run repeatedly (dedupes by message ID). */
function scanInboxForResponses() {
  return withLock_(function () {
    var settings = getSettings_();
    var days = Math.max(1, parseInt(settings.RESPONSE_LOOKBACK_DAYS, 10) || 14);
    var dealIds = readTable_(SHEET.JOBS).rows.map(function (j) { return j.dealId; })
      .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var deals = {};
    readTable_(SHEET.DEALS).rows.forEach(function (d) { deals[String(d.id).toUpperCase()] = d; });
    var investorsTable = readTable_(SHEET.INVESTORS);
    var byEmail = {}, byId = {};
    investorsTable.rows.forEach(function (i) { byEmail[lc_(i.email)] = i; byId[String(i.id).toUpperCase()] = i; });
    var seen = {};
    readTable_(SHEET.RESPONSES).rows.forEach(function (r) { if (r.messageId) seen[r.messageId] = true; });
    var mine = myAddresses_();

    var queries = [];
    for (var i = 0; i < dealIds.length; i += 15) {
      var chunk = dealIds.slice(i, i + 15).map(function (d) { return 'subject:"' + d + '"'; });
      queries.push('newer_than:' + days + 'd -from:me (' + chunk.join(' OR ') + ')');
    }
    queries.push('newer_than:' + days + 'd -from:me subject:unsubscribe');

    var newRows = [], touchedDeals = {}, optOuts = [];
    queries.forEach(function (q) {
      GmailApp.search(q, 0, 100).forEach(function (thread) {
        thread.getMessages().forEach(function (msg) {
          var mid = msg.getId();
          if (seen[mid]) return;
          var from = parseFrom_(msg.getFrom());
          if (!from.email || mine.indexOf(from.email) > -1) return;
          var subject = msg.getSubject();
          var body = stripQuoted_(msg.getPlainBody());
          var full = subject + '\n' + msg.getPlainBody();
          var dm = full.match(DEAL_ID_RE);
          var dealId = dm ? dm[0].toUpperCase() : '';
          var type = classifyReply_(subject, body);
          if (!dealId && type !== 'Unsubscribe') return;
          var inv = byEmail[from.email];
          if (!inv) {
            var rm = full.match(INVESTOR_REF_RE);
            if (rm) inv = byId[rm[0].toUpperCase()];
          }
          seen[mid] = true;
          var deal = deals[dealId] || null;
          newRows.push({
            id: shortId_('R-'), dealId: dealId, property: deal ? dealTitle_(deal) : '',
            investorId: inv ? inv.id : '', investorName: inv ? investorName_(inv) : (from.name || from.email),
            investorEmail: from.email, received: msg.getDate(), type: type,
            offerAmount: type === 'Offer' ? parseOffer_(body) : '', message: body,
            source: 'Email (auto)', followUp: type === 'Unsubscribe' || type === 'Not Interested' ? 'Closed' : 'New',
            notes: inv ? '' : 'Sender not in investor database', messageId: mid
          });
          if (dealId) touchedDeals[dealId] = true;
          if (type === 'Unsubscribe' && inv) optOuts.push(inv);
        });
      });
    });

    appendObjects_(SHEET.RESPONSES, newRows);
    optOuts.forEach(function (inv) {
      updateObject_(SHEET.INVESTORS, inv._row, { optOut: true, updated: new Date(), notes: (str_(inv.notes) + ' [Unsubscribed by email ' + fmtDate_(new Date()) + ']').trim() });
    });
    Object.keys(touchedDeals).forEach(recountDeal_);
    setSetting_('LAST_INBOX_SCAN', new Date().toISOString());
    return { found: newRows.length, unsubscribed: optOuts.length, scannedAt: new Date().toISOString() };
  });
}

function listResponses() {
  return toClient_(readTable_(SHEET.RESPONSES).rows.reverse());
}

/** Manually log a response (phone call, text, in-person). */
function logResponse(r) {
  return withLock_(function () {
    r = r || {};
    if (!r.dealId) throw new Error('Choose a deal.');
    var deal = getDealRow_(r.dealId);
    var inv = r.investorId ? findBy_(SHEET.INVESTORS, 'id', r.investorId) : null;
    if (!inv && !str_(r.investorName) && !str_(r.investorEmail)) throw new Error('Choose an investor or enter a name.');
    var type = RESPONSE_TYPES.indexOf(r.type) > -1 ? r.type : 'Interested';
    var row = {
      id: shortId_('R-'), dealId: deal.id, property: dealTitle_(deal),
      investorId: inv ? inv.id : '', investorName: inv ? investorName_(inv) : str_(r.investorName),
      investorEmail: inv ? lc_(inv.email) : lc_(r.investorEmail), received: new Date(), type: type,
      offerAmount: num_(r.offerAmount), message: str_(r.message), source: 'Manual',
      followUp: FOLLOW_UP_STATUSES.indexOf(r.followUp) > -1 ? r.followUp : 'New', notes: str_(r.notes), messageId: ''
    };
    appendObjects_(SHEET.RESPONSES, [row]);
    if (type === 'Unsubscribe' && inv) updateObject_(SHEET.INVESTORS, inv._row, { optOut: true, updated: new Date() });
    recountDeal_(deal.id);
    return toClient_(row);
  });
}

function updateResponse(id, fields) {
  return withLock_(function () {
    var r = findBy_(SHEET.RESPONSES, 'id', id);
    if (!r) throw new Error('Response not found.');
    var f = {};
    if (fields.followUp !== undefined) f.followUp = str_(fields.followUp);
    if (fields.notes !== undefined) f.notes = str_(fields.notes);
    if (fields.type !== undefined && RESPONSE_TYPES.indexOf(fields.type) > -1) f.type = fields.type;
    if (fields.offerAmount !== undefined) f.offerAmount = num_(fields.offerAmount);
    updateObject_(SHEET.RESPONSES, r._row, f);
    recountDeal_(r.dealId);
    return toClient_(findBy_(SHEET.RESPONSES, 'id', id));
  });
}

function enableAutoTracking() {
  if (!hasTrigger_('scanInboxForResponses')) {
    ScriptApp.newTrigger('scanInboxForResponses').timeBased().everyMinutes(15).create();
  }
  return getSettings();
}

function disableAutoTracking() {
  deleteTriggers_('scanInboxForResponses');
  return getSettings();
}


// ================= Code.gs =================
/**
 * Code.gs — web app entry point, spreadsheet menu, setup and dashboard.
 */

/** Serves the web app. */
function doGet() {
  ensureSettings_();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('SameDayInvestments · Deal Distribution')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Used by templates: <?!= include('Styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Adds the SameDayInvestments menu to the spreadsheet. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SameDayInvestments')
    .addItem('Open Deal Distribution App', 'showAppLink')
    .addSeparator()
    .addItem('Run / repair setup', 'setup')
    .addItem('Scan inbox for investor replies now', 'scanInboxForResponses')
    .addItem('Resume queued distributions', 'runQueuedDistributions')
    .addToUi();
}

function showAppLink() {
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { url = ''; }
  var html = url
    ? '<div style="font-family:Arial;padding:8px"><p>Open the SameDayInvestments Deal Distribution app:</p><p><a href="' + url + '" target="_blank" style="background:#0B2E21;color:#fff;padding:10px 16px;text-decoration:none;display:inline-block">Open App</a></p></div>'
    : '<div style="font-family:Arial;padding:8px"><p>The web app is not deployed yet.</p><p>In the Apps Script editor choose <b>Deploy → New deployment → Web app</b> (Execute as: <i>Me</i>, Who has access: <i>Only myself</i>), then use this menu again.</p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(380).setHeight(170), 'SameDayInvestments');
}

/**
 * One-time setup. Run from the Apps Script editor (or the sheet menu).
 * Creates all tabs, headers and default settings, and authorizes the script.
 * Safe to run again — it never deletes data.
 */
function setup() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  var props = PropertiesService.getScriptProperties();
  if (!ss && !props.getProperty('SPREADSHEET_ID')) {
    ss = SpreadsheetApp.create('SameDayInvestments — Deal Distribution Database');
  }
  if (ss) props.setProperty('SPREADSHEET_ID', ss.getId());
  _ss = null;
  ensureSettings_();
  [SHEET.INVESTORS, SHEET.DEALS, SHEET.JOBS, SHEET.LOG, SHEET.RESPONSES].forEach(function (n) { getSheet_(n); });
  var book = ss_();
  var blank = book.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && book.getSheets().length > 1) book.deleteSheet(blank);
  rootFolder_();
  Logger.log('SameDayInvestments setup complete. Database: ' + book.getUrl());
  return book.getUrl();
}

/** Everything the app needs on first load, in one round-trip. */
function getBootstrap() {
  ensureSettings_();
  return {
    settings: getSettings(),
    investors: listInvestors(),
    deals: listDeals(),
    dashboard: getDashboard()
  };
}

function getDashboard() {
  var investors = readTable_(SHEET.INVESTORS).rows;
  var deals = readTable_(SHEET.DEALS).rows;
  var jobs = readTable_(SHEET.JOBS).rows;
  var log = readTable_(SHEET.LOG).rows;
  var responses = readTable_(SHEET.RESPONSES).rows;
  var since = Date.now() - 30 * 24 * 3600 * 1000;
  var t = function (d) { var x = d instanceof Date ? d : new Date(d); return isNaN(x.getTime()) ? 0 : x.getTime(); };
  var dealCounts = { Available: 0, Pending: 0, Sold: 0 };
  deals.forEach(function (d) { var s = str_(d.status) || 'Available'; dealCounts[s] = (dealCounts[s] || 0) + 1; });
  var activity = [];
  jobs.slice(-8).forEach(function (j) {
    activity.push({ when: j.created, kind: 'distribution', text: (j.mode === 'TEST' ? 'Test distribution' : 'Distributed') + ' ' + j.property + ' → ' + j.total + ' investors', status: j.status });
  });
  responses.slice(-10).forEach(function (r) {
    activity.push({ when: r.received, kind: 'response', text: r.investorName + ' — ' + r.type + (r.property ? ' on ' + r.property : ''), status: r.followUp });
  });
  activity.sort(function (a, b) { return t(b.when) - t(a.when); });
  return toClient_({
    investors: {
      total: investors.length,
      active: investors.filter(function (i) { return (str_(i.status) || 'Active') === 'Active' && !bool_(i.optOut); }).length,
      optedOut: investors.filter(function (i) { return bool_(i.optOut); }).length
    },
    deals: dealCounts,
    emails30d: log.filter(function (l) { return l.mode === 'LIVE' && l.status === 'Sent' && t(l.sentAt) > since; }).length,
    responses30d: responses.filter(function (r) { return t(r.received) > since; }).length,
    interested30d: responses.filter(function (r) { return (r.type === 'Interested' || r.type === 'Offer') && t(r.received) > since; }).length,
    queued: log.filter(function (l) { return l.status === 'Queued'; }).length,
    activity: activity.slice(0, 12),
    testMode: isTestMode_(),
    quota: remainingQuota_(),
    lastScan: getSettings_().LAST_INBOX_SCAN || ''
  });
}
