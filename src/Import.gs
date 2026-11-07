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
