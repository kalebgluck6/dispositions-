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
