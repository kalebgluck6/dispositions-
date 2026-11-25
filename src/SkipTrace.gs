/**
 * Automatic skip tracing (BatchData API, v3 Property Skip Trace).
 *
 * Buyers found in public records usually have no email. After every intake run,
 * buyers missing an email are skip traced automatically: the best email, the best
 * phone and the contact person (for LLCs) are filled in, and the rest are kept in
 * the notes. BatchData only bills for properties it matches, and the app keeps a
 * monthly match limit. The API key is stored privately in script properties.
 *
 * Docs: https://developer.batchdata.com/docs/batchdata/batchdata-v3/operations/create-a-property-skip-trace
 */

var BD_SKIPTRACE_URL = 'https://api.batchdata.com/api/v3/property/skip-trace';
var BD_BATCH = 25;   // properties per request (API allows 100; smaller keeps each call well under the timeout)

function bdKey_() { return PropertiesService.getScriptProperties().getProperty('BD_API_KEY') || ''; }
function bdMonthKey_() { return 'BD_MATCHES_' + fmtDate_(new Date(), 'yyyyMM'); }
function bdMatchesUsed_() { return parseInt(PropertiesService.getScriptProperties().getProperty(bdMonthKey_()) || '0', 10) || 0; }
function bdAddMatches_(n) {
  if (!n) return;
  PropertiesService.getScriptProperties().setProperty(bdMonthKey_(), String(bdMatchesUsed_() + Number(n)));
}

/** POSTs to BatchData. Retries once on rate limit / temporary outage. */
function bdFetch_(body, key) {
  key = key || bdKey_();
  if (!key) throw new Error('Add your BatchData API key first (New Buyers → Automatic Skip Trace).');
  for (var attempt = 0; attempt < 2; attempt++) {
    var res = UrlFetchApp.fetch(BD_SKIPTRACE_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, followRedirects: false,
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }, payload: JSON.stringify(body)
    });
    var code = res.getResponseCode();
    var json = {};
    try { json = JSON.parse(res.getContentText() || '{}'); } catch (e) { json = {}; }
    if (code >= 200 && code < 300) return json;
    if ((code === 429 || code >= 502) && attempt === 0) { Utilities.sleep(8000); continue; }
    var msg = (json.status && (json.status.message || json.status.text)) || res.getContentText().slice(0, 200);
    throw new Error({
      401: 'BatchData rejected the API key (' + msg + '). Copy the key again from app.batchdata.com → Settings → API Tokens.',
      403: 'Your BatchData account can\'t use skip trace (' + msg + '). Check the token\'s permissions or your plan.',
      402: 'Your BatchData account is out of funds. Add funds at app.batchdata.com.',
      429: 'BatchData rate limit reached — it will continue on the next run.'
    }[code] || ('BatchData error ' + code + ': ' + msg));
  }
  throw new Error('BatchData is busy right now — it will try again on the next run.');
}

/** "123 Main St, Norfolk, VA 23510" → { street, city, state, zip } (county names go to `county`). */
function parseAddress_(s) {
  var parts = String(s || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  if (!parts.length || !/\d/.test(parts[0])) return null;
  var out = { street: parts[0] };
  var last = parts.length > 1 ? parts[parts.length - 1] : '';
  var m = last.match(/^([A-Za-z]{2})(?:\s+(\d{5})(?:-\d{4})?)?$/);
  var city = parts.slice(1, m ? -1 : undefined).join(', ');
  if (/\bcounty\b/i.test(city)) out.county = city.replace(/\s*county\b.*$/i, '').trim();
  else if (city) out.city = city;
  if (m) { out.state = m[1].toUpperCase(); if (m[2] && m[2] !== '00000') out.zip = m[2]; }
  return out;
}

/** Buyers that still need contact info, new buyers first. */
function skipTraceCandidates_(ids) {
  var s = getSettings_();
  var activeToo = bool_(s.SKIPTRACE_ACTIVE_TOO);
  var t = readTable_(SHEET.INVESTORS);
  var want = ids ? ids.reduce(function (m, id) { m[id] = true; return m; }, {}) : null;
  var fixed = !!PropertiesService.getScriptProperties().getProperty('ST_OWNER_FIX');
  return t.rows.filter(function (r) {
    if (str_(r.email) || bool_(r.optOut)) return false;
    if (want) return !!want[r.id];
    if (str_(r.skipTraced)) {
      // each buyer is traced automatically once; "previous owner" results retry every 14 days
      // (and once after the owner-name fix), since DealMachine catches up on new sales
      if (!/previous owner/.test(str_(r.skipTraceResult))) return false;
      var when = asDate_(r.skipTraced);
      if (fixed && when && Date.now() - when.getTime() < 14 * 86400000) return false;
    }
    var st = str_(r.status);
    return st === PENDING_REVIEW || (activeToo && st === 'Active');
  }).sort(function (a, b) {
    return (str_(a.status) === PENDING_REVIEW ? 0 : 1) - (str_(b.status) === PENDING_REVIEW ? 0 : 1);
  });
}

/** Property address of the buyer's latest purchase (older rows: read from the purchase history). */
function purchaseAddress_(inv) {
  if (str_(inv.lastPurchaseAddress)) return str_(inv.lastPurchaseAddress);
  var first = str_(inv.purchases).split(';')[0].split(' — ')[0].replace(/\s*\(.*$/, '').trim();
  if (!first || !/\d/.test(first)) return '';
  if (/,\s*[A-Z]{2}(\s+\d{5})?$/.test(first)) return first;
  var nc = /elizabeth city|pasquotank|camden|currituck|moyock|perquimans|hertford|chowan|edenton/i.test(first + ' ' + str_(inv.markets));
  return first + ', ' + (nc ? 'NC' : 'VA');
}

function skipTraceRequest_(inv, useMailingAsProperty) {
  var prop = parseAddress_(purchaseAddress_(inv)), mail = parseAddress_(inv.mailingAddress);
  if (useMailingAsProperty || !prop) { prop = mail; mail = null; }
  if (!prop || (!prop.zip && !prop.city && !prop.county)) return null;
  var req = { requestId: String(inv.id), propertyAddress: prop };
  if (prop.county && !prop.state) prop.state = 'VA';
  if (prop.county) { req.county = prop.county; req.state = prop.state; delete prop.county; }
  if (mail && mail.street) { delete mail.county; req.mailingAddress = mail; }
  var company = str_(inv.company) && ENTITY_RE.test(inv.company);
  if (!company && str_(inv.lastName)) req.name = { first: str_(inv.firstName), last: str_(inv.lastName) };
  return req;
}

/** Picks the best email / phone / contact from a v3 result item. */
function skipTracePick_(item) {
  var persons = (item && item.persons || []).filter(function (p) { return p && p.deceased !== true; });
  persons.sort(function (a, b) { return (b.propertyOwner === true ? 1 : 0) - (a.propertyOwner === true ? 1 : 0); });
  var emails = [], phones = [], contact = null, litigator = false;
  persons.forEach(function (p) {
    if (p.litigator) litigator = true;
    var es = (p.emails || []).slice().sort(function (a, b) { return (b.tested ? 1 : 0) - (a.tested ? 1 : 0) || (a.rank || 99) - (b.rank || 99); });
    es.forEach(function (e) { var v = lc_(e.email); if (isEmail_(v) && emails.indexOf(v) === -1) emails.push(v); });
    var ps = (p.phones || []).filter(function (x) { return x.tcpa !== true; }).sort(function (a, b) {
      var sa = (/mobile/i.test(a.type) ? 0 : 1) + (a.dnc ? 2 : 0) + (a.reachable ? 0 : 1);
      var sb = (/mobile/i.test(b.type) ? 0 : 1) + (b.dnc ? 2 : 0) + (b.reachable ? 0 : 1);
      return sa - sb || (a.rank || 99) - (b.rank || 99);
    });
    ps.forEach(function (x) {
      var n = formatPhone_(x.number);
      if (n && !phones.some(function (q) { return q.n === n; })) phones.push({ n: n, dnc: !!x.dnc, type: x.type || '' });
    });
    if (!contact && p.name && (es.length || ps.length)) contact = p.name;
  });
  return { emails: emails, phones: phones, contact: contact, litigator: litigator };
}

/**
 * Skip traces buyers missing an email and writes what it finds. Caller holds the lock.
 * ids (optional) limits it to specific buyers (manual "Skip trace" buttons).
 */
/** Which service skip traces: DealMachine when connected (you already pay for it), else BatchData. */
function skipProvider_() { return dmKey_() ? 'dealmachine' : bdKey_() ? 'batchdata' : ''; }

/** Picks the best email / phone / contact from DealMachine contacts (Enrich by Address). */
function dmSkipPick_(contacts, inv, requireName) {
  var cs = (contacts || []).filter(function (c) { return c && c.is_likely_renter !== true; });
  var company = str_(inv.company) && ENTITY_RE.test(inv.company);
  if (requireName && !company) {
    var last = lc_(inv.lastName);
    cs = cs.filter(function (c) { return last && lc_(c.last_name) === last; });
  }
  cs.sort(function (a, b) { return (b.is_likely_owner ? 1 : 0) - (a.is_likely_owner ? 1 : 0); });
  var rank = { very_likely_deliverable: 0, likely_deliverable: 1, deliverable: 1, unknown: 2 };
  var emails = [], phones = [], contact = null;
  cs.forEach(function (c) {
    var es = (c.emails || []).filter(function (e) { return e && e.address && !/undeliverable|invalid/i.test(e.verification_status || ''); })
      .sort(function (a, b) { return ((rank[a.verification_status] === undefined ? 2 : rank[a.verification_status]) - (rank[b.verification_status] === undefined ? 2 : rank[b.verification_status])) || ((b.match_confidence || 0) - (a.match_confidence || 0)); });
    es.forEach(function (e) { var v = lc_(e.address); if (isEmail_(v) && emails.indexOf(v) === -1) emails.push(v); });
    var ps = (c.phones || []).filter(function (x) { return x && x.number; }).sort(function (a, b) {
      return ((/wireless|mobile/i.test(a.type || '') ? 0 : 1) + (a.do_not_call ? 2 : 0)) - ((/wireless|mobile/i.test(b.type || '') ? 0 : 1) + (b.do_not_call ? 2 : 0));
    });
    ps.forEach(function (x) { var n = formatPhone_(x.number); if (n && !phones.some(function (q) { return q.n === n; })) phones.push({ n: n, dnc: !!x.do_not_call, type: x.type || '' }); });
    if (!contact && (es.length || ps.length)) contact = { first: c.first_name || '', last: c.last_name || '', full: c.full_name || ((c.first_name || '') + ' ' + (c.last_name || '')).trim() };
  });
  return { emails: emails, phones: phones, contact: contact, litigator: false };
}

/** True when DealMachine's owner of record is this buyer (not the seller, if its data isn't updated yet). */
function sameOwner_(dmOwner, inv) {
  if (!str_(dmOwner)) return true;
  var stop = /^(llc|inc|corp|co|company|the|of|and|lp|llp|ltd|trust|trustee|holdings?|properties|property|group|investments?|homes?|i|ii|iii)$/;
  var words = function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(function (w) { return w.length > 1 && !stop.test(w); }); };
  var mine = words(str_(inv.company) || (str_(inv.firstName) + ' ' + str_(inv.lastName)));
  var theirs = words(dmOwner);
  if (!mine.length) return true;
  return mine.some(function (w) { return theirs.indexOf(w) > -1; });
}

/** DealMachine Enrich by Address item for a skip-trace request. */
function dmAddressItem_(req) {
  var a = req && req.propertyAddress;
  if (!a || !a.street) return null;
  if (a.city && a.state) { var o = { street: a.street, city: a.city, state: a.state }; if (a.zip) o.zip = a.zip; return o; }
  var place = req.county ? req.county + ' County' : a.zip || '';
  return place ? { full_address: [a.street, place, ((req.state || a.state || '') + ' ' + (a.zip || '')).trim()].filter(String).join(', ') } : null;
}

function skipTraceRun_(ids) {
  var s = getSettings_();
  var out = { status: 'ok', traced: 0, found: 0, emails: 0, phones: 0, noMatch: 0, skipped: 0, note: '' };
  var provider = skipProvider_();
  out.provider = provider;
  if (!provider) { out.status = 'off'; out.note = 'Connect DealMachine (or BatchData) to skip trace automatically.'; return out; }
  if (!ids && !bool_(s.SKIPTRACE_ON)) { out.status = 'off'; return out; }
  var cap = parseInt(s.SKIPTRACE_MONTHLY_CAP, 10) || 0;
  var room = cap ? cap - bdMatchesUsed_() : Infinity;
  if (provider === 'dealmachine') {
    var dmCap = Math.max(0, parseInt(s.INTAKE_DM_MONTHLY_CAP, 10) || 0);
    if (dmCap && dmCreditsUsed_() >= dmCap) { out.status = 'capped'; out.note = 'DealMachine monthly credit limit reached (' + dmCap + '). Raise it on the DealMachine card.'; return out; }
  }
  if (room <= 0) { out.status = 'capped'; out.note = 'Monthly skip-trace limit reached (' + cap + ' matches). Raise it on the Skip Trace card.'; return out; }
  var max = Math.max(1, parseInt(s.SKIPTRACE_MAX_PER_RUN, 10) || 100);
  var cands = skipTraceCandidates_(ids).slice(0, Math.min(max, room));
  if (!cands.length) { out.note = 'No buyers missing an email.'; return out; }
  var t = readTable_(SHEET.INVESTORS);
  var rowOf = {};
  t.rows.forEach(function (r) { rowOf[r.id] = r._row; });
  var byId = {}, results = {};
  cands.forEach(function (c) { byId[c.id] = c; });

  PropertiesService.getScriptProperties().setProperty('ST_OWNER_FIX', '1');
  var stale = {};
  var passDm = function (list, mailingAsProperty) {
    var items = [];
    list.forEach(function (inv) {
      var it = dmAddressItem_(skipTraceRequest_(inv, mailingAsProperty));
      if (it) items.push({ id: inv.id, item: it });
    });
    for (var i = 0; i < items.length; i += 50) {
      var chunk = items.slice(i, i + 50);
      var json = dmFetch_('post', '/enrichment/address', { data: chunk.map(function (c) { return c.item; }), anchor: 'people', contact_audience: 'owners', fields: ['owner_1_full_name'] });
      dmAddCredits_((json.credits && Number(json.credits.used)) || 0);
      var found = 0;
      (json.data || []).forEach(function (item, k) {
        var id = chunk[k] && chunk[k].id;
        if (!id || !byId[id] || !item || !item.matched) return;
        // right after a sale DealMachine may still list the seller: skip when its owner isn't this buyer
        if (!mailingAsProperty && !sameOwner_(item.owner_1_full_name, byId[id])) { stale[id] = true; return; }
        // a person must carry the buyer's own last name
        var pick = dmSkipPick_(item.contacts, byId[id], true);
        if (pick.emails.length || pick.phones.length) { results[id] = pick; found++; }
      });
      bdAddMatches_(found);
    }
    return items.length;
  };

  var pass = function (list, mailingAsProperty) {
    if (provider === 'dealmachine') return passDm(list, mailingAsProperty);
    var reqs = [];
    list.forEach(function (inv) { var r = skipTraceRequest_(inv, mailingAsProperty); if (r) reqs.push(r); });
    for (var i = 0; i < reqs.length; i += BD_BATCH) {
      var chunk = reqs.slice(i, i + BD_BATCH);
      var json = bdFetch_({ requests: chunk, options: { includeTCPABlacklistedPhones: false, prioritizeMobilePhones: true } });
      var data = (json.result && json.result.data) || [];
      var meta = (json.result && json.result.meta && json.result.meta.results) || {};
      bdAddMatches_(Number(meta.matchCount) || 0);
      data.forEach(function (item, k) {
        var id = (item.input && item.input.requestId) || (chunk[k] && chunk[k].requestId);
        if (!id || !byId[id]) return;
        var pick = skipTracePick_(item);
        if (pick.emails.length || pick.phones.length) results[id] = pick;
      });
    }
    return reqs.length;
  };

  var sent = pass(cands, false);
  // second chance: an LLC's mailing address is often its principal's home or office
  var retry = cands.filter(function (c) {
    if (results[c.id] || !parseAddress_(c.mailingAddress) || !parseAddress_(purchaseAddress_(c))) return false;
    // DealMachine returns the owner of the building at that address: only useful for people, not company offices
    return provider !== 'dealmachine' || !(str_(c.company) && ENTITY_RE.test(c.company));
  });
  if (retry.length) pass(retry, true);

  var today = fmtDate_(new Date(), 'MMM d, yyyy');
  var via = provider === 'dealmachine' ? ' (DealMachine)' : ' (BatchData)';
  cands.forEach(function (inv) {
    var r = results[inv.id], f = { skipTraced: new Date(), updated: new Date() };
    if (!skipTraceRequest_(inv, false)) {
      out.skipped++;
      f.skipTraceResult = 'No usable address to skip trace';
    } else if (!r) {
      out.noMatch++;
      f.skipTraceResult = stale[inv.id] ? 'No match yet (DealMachine still shows the previous owner)' : 'No match';
    } else {
      out.found++;
      if (r.emails.length) { f.email = r.emails[0]; out.emails++; }
      if (r.phones.length && !str_(inv.phone)) { f.phone = r.phones[0].n; out.phones++; }
      if (r.contact && str_(inv.company) && !str_(inv.firstName) && !str_(inv.lastName)) {
        f.firstName = titleCase_(r.contact.first || ''); f.lastName = titleCase_(r.contact.last || '');
      }
      f.skipTraceResult = (r.emails.length ? 'Email' : 'No email') + (r.phones.length ? ' + phone' : '') + ' found';
      var extra = [];
      if (r.contact && r.contact.full) extra.push('contact ' + titleCase_(r.contact.full));
      if (r.emails.length > 1) extra.push('other emails ' + r.emails.slice(1, 4).join(', '));
      if (r.phones.length) extra.push('phones ' + r.phones.slice(0, 4).map(function (p) { return p.n + (p.type ? ' (' + p.type.toLowerCase() + ')' : '') + (p.dnc ? ' DNC' : ''); }).join(', '));
      if (r.litigator) extra.push('⚠ known TCPA litigator: do not call or text');
      var notes = str_(inv.notes).replace(/\s*Needs an email address before approval \(skip trace this owner\)\.?/, '');
      if (f.email) notes = notes.replace(/\s*Skip traced[^.]*\./g, '');
      f.notes = (notes + ' Skip traced' + via + ' ' + today + ': ' + extra.join('; ') + '.').trim().slice(0, 1500);
    }
    if (rowOf[inv.id]) updateObject_(SHEET.INVESTORS, rowOf[inv.id], f);
    out.traced++;
  });
  out.note = out.traced + ' skip traced' + via + ': ' + out.emails + ' emails, ' + out.phones + ' phones found' + (out.noMatch ? ', ' + out.noMatch + ' no match' : '') +
    (sent < cands.length ? ', ' + (cands.length - sent) + ' without an address' : '');
  setSetting_('LAST_SKIPTRACE', JSON.stringify({ at: new Date().toISOString(), note: out.note }));
  return out;
}

/** Buyers missing an email that a connected service hasn't tried yet. */
function skipTraceWaiting_() {
  var s = getSettings_(), activeToo = bool_(s.SKIPTRACE_ACTIVE_TOO), prov = !!skipProvider_(), px = !!pxKey_();
  return readTable_(SHEET.INVESTORS).rows.filter(function (r) {
    if (str_(r.email) || bool_(r.optOut)) return false;
    var st = str_(r.status);
    if (!(st === PENDING_REVIEW || (activeToo && st === 'Active'))) return false;
    return (prov && !str_(r.skipTraced)) || (px && !str_(r.webSearched));
  }).length;
}

function skipTraceStatus_() {
  var s = getSettings_();
  var last = {};
  try { last = JSON.parse(s.LAST_SKIPTRACE || '{}'); } catch (e) { last = {}; }
  var key = bdKey_();
  return {
    hasKey: !!skipProvider_(), provider: skipProvider_(), bdKey: !!key, keyHint: key ? '…' + key.slice(-4) : '', on: bool_(s.SKIPTRACE_ON),
    matchesThisMonth: bdMatchesUsed_(), cap: parseInt(s.SKIPTRACE_MONTHLY_CAP, 10) || 0,
    waiting: skipTraceWaiting_(), last: last,
    web: { hasKey: !!pxKey_(), keyHint: pxKey_() ? '…' + pxKey_().slice(-4) : '', on: bool_(s.SKIPTRACE_WEB_ON), used: pxUsed_(), cap: parseInt(s.SKIPTRACE_WEB_MONTHLY_CAP, 10) || 0 }
  };
}

// ---------- client API ----------

/** Saves and tests the BatchData API key (stored privately, never in the sheet). */
function saveSkipTraceKey(key) {
  requireRole_('Owner');
  key = str_(key).replace(/^Bearer\s+/i, '');
  var props = PropertiesService.getScriptProperties();
  if (!key) { props.deleteProperty('BD_API_KEY'); return getIntakeStatus(); }
  if (!/^[A-Za-z0-9_\-]{20,}$/.test(key)) throw new Error('That doesn\'t look like a BatchData API token (a long string of letters and numbers).');
  // An empty request is free: a bad key answers 401, a good key answers 400 (no properties).
  try { bdFetch_({ requests: [] }, key); } catch (e) {
    if (/rejected the API key|can't use skip trace|out of funds/.test(e.message)) throw e;
  }
  props.setProperty('BD_API_KEY', key);
  return getIntakeStatus();
}

/** "Skip trace now": all buyers missing an email, or just the given ids. */
function skipTraceNow(ids) {
  requireRole_('Rep');
  return withLock_(function () {
    var list = ids && ids.length ? ids : null;
    if (!skipProvider_() && !pxKey_()) throw new Error('Connect DealMachine, BatchData or Perplexity first (Skip Trace card).');
    var r = skipProvider_() ? skipTraceRun_(list) : { status: 'off', traced: 0, emails: 0, phones: 0, note: '' };
    if (r.status === 'capped' && !pxKey_()) throw new Error(r.note);
    var w = { status: 'off', searched: 0, emails: 0, note: '' };
    if (pxKey_()) w = webTraceRun_(list);
    if (r.status === 'capped' && w.status === 'capped') throw new Error(r.note + ' ' + w.note);
    r.webEmails = w.emails || 0;
    r.emails = (r.emails || 0) + r.webEmails;
    r.note = [r.note, w.note].filter(String).join(' · ');
    return { result: r, status: getIntakeStatus() };
  });
}

/** Saves an email / phone found by hand (free people-search lookup). */
function setInvestorContact(id, email, phone) {
  requireRole_('Rep');
  email = lc_(email).replace(/^mailto:/, '');
  phone = str_(phone);
  if (email && !isEmail_(email)) throw new Error('That email address doesn\'t look right.');
  if (!email && !phone) throw new Error('Enter an email or a phone number.');
  return withLock_(function () {
    var t = readTable_(SHEET.INVESTORS);
    var inv = t.rows.filter(function (r) { return r.id === id; })[0];
    if (!inv) throw new Error('Buyer not found.');
    if (email) {
      var dup = t.rows.filter(function (r) { return r.id !== id && lc_(r.email) === email; })[0];
      if (dup) throw new Error('That email already belongs to ' + investorName_(dup) + ' (' + dup.id + ').');
    }
    var f = { updated: new Date(), skipTraced: new Date(), skipTraceResult: 'Looked up by hand' };
    if (email) f.email = email;
    if (phone) f.phone = formatPhone_(phone) || phone;
    if (email) f.notes = str_(inv.notes).replace(/\s*Needs an email address before approval \(skip trace this owner\)\.?/, '').trim();
    updateObject_(SHEET.INVESTORS, inv._row, f);
    Object.keys(f).forEach(function (k) { inv[k] = f[k]; });
    delete inv._row;
    return toClient_(inv);
  });
}
