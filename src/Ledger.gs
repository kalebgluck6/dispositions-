/**
 * Ledger.gs — "serious investors only".
 *
 * Every investor purchase found in public records (Norfolk, York, owner-change watch areas) is logged in
 * the "Purchase Ledger" sheet first. A buyer only graduates to New Buyers once they have bought at least
 * INTAKE_ACTIVE_MIN_BUYS properties within INTAKE_ACTIVE_DAYS (default: 3 in 90 days — more than 1–2
 * properties every couple of months). Their later purchases keep extending their history.
 *
 * Owner-change watch areas only know that ownership changed between two data refreshes (often months
 * apart), so for those the bar is scaled to the refresh period (e.g. 6 purchases over a 6-month refresh).
 */

// LEDGER_MAP / SHEET.LEDGER are defined in Config.gs

function ledgerKey_(name, mailing) {
  return isCompany_(name) ? 'co|' + normKey_(name) : normKey_(name) + '|' + streetKey_(String(mailing || '').split(',')[0]);
}

/** Basic investor screen before logging: no institutions / exempt types; individuals must not live there. */
function ledgerCandidate_(s, allowIndividuals) {
  if (!str_(s.name) || INSTITUTION_RE.test(s.name)) return false;
  if (/government|institution|exempt|non-taxable|ground lease|church|cemetery|utility|right of way|common area/i.test(String(s.type))) return false;
  if (isCompany_(s.name)) return true;
  if (!allowIndividuals) return false;
  if (/land/i.test(String(s.type))) return true;
  var a = streetKey_(s.addr), m = streetKey_(s.mailStreet || s.mailing);
  return !!(a && m && a !== m);
}

/** Logs purchases (each recorded once). Caller holds the lock. */
function ledgerAdd_(ctx, sales, sourceLabel) {
  var allowInd = bool_(getSettings_().INTAKE_WATCH_INDIVIDUALS);
  if (!ctx.ledgerRefs) {
    ctx.ledgerRefs = {};
    readTable_(SHEET.LEDGER).rows.forEach(function (r) { ctx.ledgerRefs[r.ref] = true; });
  }
  var rows = [];
  sales.forEach(function (s) {
    if (!s.saleRef || ctx.ledgerRefs[s.saleRef] || !ledgerCandidate_(s, allowInd)) return;
    ctx.ledgerRefs[s.saleRef] = true;
    rows.push({
      id: shortId_('P-'), ownerKey: ledgerKey_(s.name, s.mailing), owner: titleCase_(s.name), mailing: s.mailing || '', addr: titleCase_(s.addr || ''),
      city: titleCase_(s.city || ''), state: s.state || '', date: s.date || new Date(), periodDays: s.periodDays || '', price: s.price || '',
      type: s.type || '', source: sourceLabel, ref: s.saleRef, promoted: '', added: new Date()
    });
  });
  appendObjects_(SHEET.LEDGER, rows);
  ctx.ledgerLogged = (ctx.ledgerLogged || 0) + rows.length;
  return rows.length;
}

/** Promotes owners who meet the active-investor bar into New Buyers. Caller holds the lock. */
function ledgerPromote_(ctx) {
  var s = getSettings_();
  var minBuys = Math.max(1, parseInt(s.INTAKE_ACTIVE_MIN_BUYS, 10) || 3);
  var windowDays = Math.max(7, parseInt(s.INTAKE_ACTIVE_DAYS, 10) || 90);
  var t = readTable_(SHEET.LEDGER);
  var groups = {};
  t.rows.forEach(function (r) { (groups[r.ownerKey] = groups[r.ownerKey] || []).push(r); });
  var promoted = 0, buyers = 0;
  Object.keys(groups).forEach(function (k) {
    var g = groups[k];
    var fresh = g.filter(function (r) { return !bool_(r.promoted); });
    if (!fresh.length) return;
    var everPromoted = g.length !== fresh.length;
    var qualifies = everPromoted;
    if (!qualifies) {
      // dated purchases: any window of `windowDays` containing ≥ minBuys
      var dated = g.filter(function (r) { return !Number(r.periodDays); }).map(function (r) { return tms_(r.date); }).filter(Boolean).sort();
      for (var i = 0; i + minBuys - 1 < dated.length && !qualifies; i++) {
        if (dated[i + minBuys - 1] - dated[i] <= windowDays * 86400000) qualifies = true;
      }
      // owner-change watch batches: scale the bar to the refresh period
      var batches = {};
      g.forEach(function (r) { if (Number(r.periodDays)) { var bk = r.source + '|' + fmtDate_(asDate_(r.date) || new Date()); (batches[bk] = batches[bk] || []).push(r); } });
      Object.keys(batches).forEach(function (bk) {
        var b = batches[bk], period = Number(b[0].periodDays) || windowDays;
        if (b.length >= Math.max(minBuys, Math.ceil(minBuys * period / windowDays))) qualifies = true;
      });
    }
    if (!qualifies) return;
    var sales = fresh.map(function (r) {
      return { name: r.owner, email: '', phone: '', mailing: r.mailing, addr: r.addr, city: r.city, state: r.state,
        date: Number(r.periodDays) ? null : asDate_(r.date), price: r.price, type: r.type, financing: '', saleRef: 'LEDGER:' + r.ref };
    });
    var lead = groupSales_(sales, windowDays, 'Active investor: ' + g.length + ' purchases found in public records (' + fresh[0].source + ').')[0];
    if (!lead) return;
    lead.criteria = 'Active investor — ' + g.length + ' purchase' + (g.length === 1 ? '' : 's') + ' logged in public records. ' + lead.criteria.replace(/^New-construction \/ land buyer\. /, '');
    if (/land/i.test(lead.propertyTypes)) lead.criteria = 'New-construction / land buyer. ' + lead.criteria;
    lead._total = g.length;
    lead._addrs = fresh.map(function (r) { return r.addr; });
    // a buyer archived earlier for having too few purchases comes back for review once they qualify
    var prior = ctx.byKey[ownerKey_(lead)];
    if (prior && str_(prior.status) === 'Inactive' && /not an active investor yet\]/.test(str_(prior.notes)) && prior._row) {
      var note = str_(prior.notes).replace(/\s*\[Archived [^\]]*not an active investor yet\]/g, '').trim();
      var up = ctx.updates[prior.id] || (ctx.updates[prior.id] = { row: prior._row, fields: {} });
      up.fields.status = PENDING_REVIEW; up.fields.notes = note; up.fields.updated = new Date();
      ['categories', 'propertyTypes', 'markets', 'criteria', 'minPrice', 'maxPrice', 'mailingAddress'].forEach(function (k) {
        if (str_(lead[k]) !== '') { up.fields[k] = lead[k]; prior[k] = lead[k]; }
      });
      prior.status = PENDING_REVIEW; prior.notes = note;
      ctx.reopened = (ctx.reopened || 0) + 1;
    }
    addRecordLeads_(ctx, fresh[0].source, [lead]);
    fresh.forEach(function (r) { r.promoted = true; });
    promoted += fresh.length; buyers++;
  });
  // write the promoted flags back (one column write)
  if (promoted && t.rows.length) {
    var byRow = {};
    t.rows.forEach(function (r) { byRow[r._row] = r; });
    var last = t.rows[t.rows.length - 1]._row, vals = [];
    for (var n = 2; n <= last; n++) vals.push(byRow[n] ? (bool_(byRow[n].promoted) ? 'TRUE' : '') : '');
    writeColumn_(SHEET.LEDGER, 'promoted', 2, vals);
  }
  return { buyers: buyers, purchases: promoted, minBuys: minBuys, windowDays: windowDays };
}

/**
 * One-time cleanup after switching to "serious investors only": buyers that came from public records
 * under the old rules, are still Pending Review, and don't meet the bar are set to Inactive (kept, never deleted).
 */
function ledgerCleanupLegacy_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('LEDGER_MIGRATED')) return 0;
  var s = getSettings_();
  var minBuys = Math.max(1, parseInt(s.INTAKE_ACTIVE_MIN_BUYS, 10) || 3);
  var sources = [INTAKE_SOURCES.county.label, INTAKE_SOURCES.watch.label];
  var n = 0;
  readTable_(SHEET.INVESTORS).rows.forEach(function (i) {
    if (str_(i.status) !== PENDING_REVIEW || sources.indexOf(str_(i.source)) === -1) return;
    if ((Number(i.purchaseCount) || 0) >= minBuys) return;
    updateObject_(SHEET.INVESTORS, i._row, { status: 'Inactive', updated: new Date(), notes: (str_(i.notes) + ' [Archived ' + fmtDate_(new Date()) + ': fewer than ' + minBuys + ' purchases — not an active investor yet]').trim() });
    n++;
  });
  // longer lookbacks so the first ledger run sees a full window
  if (String(s.INTAKE_COUNTY_DAYS) === '30') setSetting_('INTAKE_COUNTY_DAYS', '90');
  if (String(s.INTAKE_WATCH_DAYS) === '45') setSetting_('INTAKE_WATCH_DAYS', '90');
  props.setProperty('LEDGER_MIGRATED', new Date().toISOString());
  return n;
}

function ledgerStatus_() {
  var t = readTable_(SHEET.LEDGER).rows;
  var s = getSettings_();
  var owners = {};
  t.forEach(function (r) { owners[r.ownerKey] = (owners[r.ownerKey] || 0) + 1; });
  var minBuys = Math.max(1, parseInt(s.INTAKE_ACTIVE_MIN_BUYS, 10) || 3);
  return {
    purchases: t.length, owners: Object.keys(owners).length,
    almost: Object.keys(owners).filter(function (k) { return owners[k] === minBuys - 1; }).length,
    minBuys: minBuys, days: Math.max(7, parseInt(s.INTAKE_ACTIVE_DAYS, 10) || 90)
  };
}
