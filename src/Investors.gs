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
