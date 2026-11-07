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
