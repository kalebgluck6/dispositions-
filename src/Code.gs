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
