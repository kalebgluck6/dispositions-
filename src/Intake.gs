/**
 * Intake.gs — finds new buyers every day and queues them for review.
 *
 * Sources (each can be switched on/off in the app → New Buyers):
 *   1. Signup form   — your branded "VIP Buyers List" Google Form (instant + daily sweep)
 *   2. Sheet sync    — any Google Sheet you or a VA keep adding buyers to
 *   3. Cash buyers   — a public-records export (PropStream, BatchLeads, PropertyRadar, …)
 *                      grouped by owner; the buy box is built from what they actually bought
 *   4. Gmail         — people who email you asking to join your buyers list
 *
 * Every new buyer is added with Status = "Pending Review". Pending buyers never receive
 * deals until you approve them (which requires a valid email address).
 * Everything that happens is recorded in the "Buyer Intake Log" sheet.
 */

var INTAKE_SOURCES = {
  form: { label: 'Signup form', setting: 'INTAKE_FORM_ON' },
  sheet: { label: 'Google Sheet sync', setting: 'INTAKE_SHEET_ON' },
  cash: { label: 'Cash buyer (public records)', setting: 'INTAKE_CASH_ON' },
  gmail: { label: 'Gmail inquiry', setting: 'INTAKE_GMAIL_ON' },
  dealmachine: { label: 'DealMachine (recent sales)', setting: 'INTAKE_DM_ON' },
  county: { label: 'County records (Norfolk)', setting: 'INTAKE_COUNTY_ON' }
};

var BUYER_FORM_Q = {
  first: 'First name',
  last: 'Last name',
  company: 'Company / LLC',
  email: 'Email',
  phone: 'Mobile phone',
  markets: 'Markets you buy in',
  types: 'Property types',
  strategy: 'How do you invest?',
  min: 'Minimum purchase price',
  max: 'Maximum purchase price',
  buybox: 'Describe your buy box',
  funding: 'How do you fund purchases?',
  consent: 'Deal alerts'
};

// ---------- shared helpers ----------

function normKey_(s) { return lc_(s).replace(/[^a-z0-9]/g, ''); }

/** Identity for buyers without an email (public-records owners): name + mailing street. */
function ownerKey_(inv) {
  // Companies / LLCs are identified by name alone (public records often lack their mailing address)
  if (str_(inv.company) && ENTITY_RE.test(inv.company)) return 'co|' + normKey_(inv.company);
  var name = normKey_(str_(inv.company) || (str_(inv.firstName) + ' ' + str_(inv.lastName)));
  var addr = normKey_(String(inv.mailingAddress || '').split(',')[0]);
  return name && addr ? name + '|' + addr : '';
}

function titleCase_(s) {
  s = str_(s);
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); })
    .replace(/\b(Llc|Lp|Llp|Ii|Iii|Iv)\b/g, function (m) { return m.toUpperCase(); });
}

function parseDateLoose_(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = str_(v), m;
  if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/))) {
    var y = Number(m[3]); if (y < 100) y += 2000;
    return new Date(y, Number(m[1]) - 1, Number(m[2]));
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Maps any property-type wording to one of your configured property types. */
function normalizePropType_(raw) {
  var t = lc_(raw);
  if (!t) return '';
  var types = list_(getSettings_().PROPERTY_TYPES);
  var pick = function (re) { return types.filter(function (x) { return re.test(lc_(x)); })[0]; };
  var hit = null;
  if (/condo|town ?h|townhome|townhouse/.test(t)) hit = pick(/condo|town/);
  else if (/mobile|manufactured/.test(t)) hit = pick(/mobile|manufactured/);
  else if (/duplex|triplex|fourplex|quadplex|quad|2-4|2 ?- ?4 units|multi.{0,12}(2|3|4)\b/.test(t)) hit = pick(/2-4|\(2/);
  else if (/apartment|5\+|multi/.test(t)) hit = pick(/5\+|multi/);
  else if (/land|lot|vacant|acre/.test(t)) hit = pick(/land|lot/);
  else if (/mixed/.test(t)) hit = pick(/mixed/);
  else if (/commercial|retail|office|industrial|warehouse/.test(t)) hit = pick(/commercial/);
  else if (/sfr|single|residential|house|home|detached/.test(t)) hit = pick(/single/);
  return hit || titleCase_(raw);
}

/** Pulls a price range out of free text like "under $250k", "$100k-$300k", "up to 1.2M". */
function parsePriceRange_(text) {
  var t = String(text || '');
  var re = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*([km])?\b|\b(\d+(?:\.\d+)?)\s*([km])\b/gi;
  var found = [], m;
  while ((m = re.exec(t))) {
    var n = parseFloat(String(m[1] || m[3]).replace(/,/g, ''));
    var suf = lc_(m[2] || m[4]);
    if (suf === 'k') n *= 1000;
    if (suf === 'm') n *= 1000000;
    if (n >= 10000 && n < 100000000) found.push({ n: n, at: m.index });
  }
  if (!found.length) return { min: '', max: '' };
  if (found.length > 1) {
    var ns = found.map(function (f) { return f.n; });
    return { min: Math.min.apply(null, ns), max: Math.max.apply(null, ns) };
  }
  var before = lc_(t.slice(Math.max(0, found[0].at - 25), found[0].at));
  if (/(over|above|min|at least|starting|from)\s*\$?\s*$/.test(before)) return { min: found[0].n, max: '' };
  return { min: '', max: found[0].n };
}

var STRATEGY_WORDS = [
  [/\bflip|rehab|fix (and|&|n) flip/i, 'Fix & Flip'],
  [/\brental|buy (and|&|n) hold|long[- ]term hold|cash ?flow/i, 'Buy & Hold'],
  [/\bbrrrr?\b/i, 'BRRRR'],
  [/\bcash buyer|all cash|pay cash|cash purchase/i, 'Cash Buyer'],
  [/\bwholesal/i, 'Wholesaler'],
  [/\bdevelop|new construction|build/i, 'Developer'],
  [/\blend(er|ing)\b|private money|hard money lender/i, 'Private Lender'],
  [/\bfund\b|institutional|portfolio/i, 'Hedge Fund / Institutional']
];
var TYPE_WORDS = /\b(sfrs?|single[- ]famil(y|ies)|condos?|townhouses?|townhomes?|(duplex|triplex|fourplex|quadplex)(es)?|multi[- ]?famil(y|ies)|apartments?|mobile homes?|manufactured|land|lots?|commercial|mixed[- ]use)\b/gi;

/** Picks categories mentioned in text, using your own category names where they exist. */
function strategiesIn_(text) {
  var mine = list_(getSettings_().CATEGORIES);
  var out = [];
  STRATEGY_WORDS.forEach(function (w) {
    if (!w[0].test(text)) return;
    var own = mine.filter(function (c) { return lc_(c) === lc_(w[1]); })[0];
    var name = own || w[1];
    if (out.indexOf(name) === -1) out.push(name);
  });
  return out;
}

function typesIn_(text) {
  var out = [];
  (String(text).match(TYPE_WORDS) || []).forEach(function (w) {
    var t = normalizePropType_(w);
    if (t && out.indexOf(t) === -1) out.push(t);
  });
  return out;
}

function marketsIn_(text) {
  var t = lc_(text);
  return list_(getSettings_().MARKETS).filter(function (m) { return t.indexOf(lc_(m)) > -1; });
}

// ---------- intake context ----------

function intakeCtx_() {
  var table = readTable_(SHEET.INVESTORS);
  var ctx = { byEmail: {}, byKey: {}, refs: {}, logs: [], adds: [], updates: {}, cur: null };
  table.rows.forEach(function (r) {
    if (str_(r.email)) ctx.byEmail[lc_(r.email)] = r;
    var k = ownerKey_(r);
    if (k) ctx.byKey[k] = r;
  });
  readTable_(SHEET.INTAKE).rows.forEach(function (l) {
    if (!l.ref) return;
    ctx.refs[l.ref] = true;
    String(l.ref).split(';').forEach(function (r) { if (r) ctx.refs[r] = true; }); // one buyer can cover several sales
  });
  return ctx;
}

/**
 * Adds one buyer (or records why not). Returns 'added' | 'updated' | 'duplicate' | 'skipped' | 'seen'.
 * ref: a stable reference for this record (form response id, message id, …) so nothing is processed twice.
 */
function addLead_(ctx, sourceLabel, lead, ref, details) {
  if (ref && ctx.refs[ref]) return 'seen';
  if (ref) ctx.refs[ref] = true;
  var cur = ctx.cur || (ctx.cur = { added: 0, updated: 0, duplicate: 0, skipped: 0 });
  var email = lc_(lead.email).replace(/^mailto:/, '');
  if (email && !isEmail_(email)) email = '';
  lead.email = email;
  var log = {
    id: shortId_('B-'), received: new Date(), source: sourceLabel, name: investorName_(lead) || '(no name)',
    email: email, phone: str_(lead.phone), result: '', investorId: '', details: str_(details).slice(0, 500), ref: ref || ''
  };
  var key = ownerKey_(lead);
  if (!email && !key) {
    log.result = 'Skipped — no email or mailing address';
    ctx.logs.push(log); cur.skipped++;
    return 'skipped';
  }
  if (!investorName_(lead) || investorName_(lead) === email) {
    if (!str_(lead.firstName) && !str_(lead.company) && email) lead.firstName = titleCase_(email.split('@')[0].split(/[._\-+]/)[0]);
  }
  var existing = (email && ctx.byEmail[email]) || (key && ctx.byKey[key]);
  if (existing) {
    log.investorId = existing.id;
    var f = {};
    if (lead.purchaseCount && Number(lead.purchaseCount) > (Number(existing.purchaseCount) || 0)) {
      f.purchases = lead.purchases; f.purchaseCount = lead.purchaseCount; f.lastPurchase = lead.lastPurchase;
    }
    if (email && !str_(existing.email)) f.email = email;
    if (str_(lead.phone) && !str_(existing.phone)) f.phone = str_(lead.phone);
    if (Object.keys(f).length) {
      f.updated = new Date();
      if (existing._row) {
        var pending = ctx.updates[existing.id] || (ctx.updates[existing.id] = { row: existing._row, fields: {} });
        Object.keys(f).forEach(function (k) { pending.fields[k] = f[k]; });
      }
      // records created earlier in this same run are still in ctx.adds: just update them in place
      Object.keys(f).forEach(function (k) { existing[k] = f[k]; });
      if (f.email) ctx.byEmail[f.email] = existing;
      log.result = 'Updated existing buyer (' + Object.keys(f).filter(function (k) { return k !== 'updated'; }).join(', ') + ')';
      cur.updated++;
      ctx.logs.push(log);
      return 'updated';
    }
    log.result = 'Already in database';
    cur.duplicate++;
    ctx.logs.push(log);
    return 'duplicate';
  }
  var rec = normalizeInvestor_(lead);
  rec.status = PENDING_REVIEW;
  rec.id = nextId_('INVESTOR_SEQ', 'INV-', 5);
  rec.source = sourceLabel;
  rec.dateAdded = new Date();
  rec.updated = new Date();
  rec.dealsReceived = 0;
  rec.optOut = false;
  rec.mailingAddress = str_(lead.mailingAddress);
  rec.purchases = str_(lead.purchases);
  rec.purchaseCount = lead.purchaseCount || '';
  rec.lastPurchase = lead.lastPurchase || '';
  ctx.adds.push(rec);
  if (email) ctx.byEmail[email] = rec;
  if (key) ctx.byKey[key] = rec;
  log.investorId = rec.id;
  log.result = 'Added — pending review';
  cur.added++;
  ctx.logs.push(log);
  return 'added';
}

function flushIntake_(ctx) {
  appendObjects_(SHEET.INVESTORS, ctx.adds);
  Object.keys(ctx.updates).forEach(function (id) {
    updateObject_(SHEET.INVESTORS, ctx.updates[id].row, ctx.updates[id].fields);
  });
  appendObjects_(SHEET.INTAKE, ctx.logs);
}

// ---------- Source 1: signup form ----------

function buyerForm_() {
  var id = str_(getSettings_().BUYER_FORM_ID);
  if (!id) return null;
  try { return FormApp.openById(id); } catch (e) { return null; }
}

function formLeads_(ctx) {
  var form = buyerForm_();
  if (!form) return 'No signup form yet — create one in New Buyers.';
  var Q = BUYER_FORM_Q;
  form.getResponses().forEach(function (resp) {
    var ref = 'FORM:' + resp.getId();
    if (ctx.refs[ref]) return;
    var a = {};
    resp.getItemResponses().forEach(function (ir) {
      var v = ir.getResponse();
      a[ir.getItem().getTitle()] = Array.isArray(v) ? v.join(', ') : str_(v);
    });
    var notes = ['Signed up via VIP buyer form ' + fmtDate_(resp.getTimestamp()) + ' (consented to deal emails).'];
    if (a[Q.funding]) notes.push('Funding: ' + a[Q.funding] + '.');
    addLead_(ctx, INTAKE_SOURCES.form.label, {
      firstName: titleCase_(a[Q.first]), lastName: titleCase_(a[Q.last]), company: a[Q.company], email: a[Q.email],
      phone: a[Q.phone], markets: a[Q.markets], propertyTypes: a[Q.types], categories: a[Q.strategy],
      minPrice: num_(a[Q.min]), maxPrice: num_(a[Q.max]), criteria: a[Q.buybox], notes: notes.join(' ')
    }, ref, 'Form response ' + fmtDate_(resp.getTimestamp(), 'MMM d, yyyy h:mm a'));
  });
  return '';
}

/** Installable trigger: adds a buyer the moment they submit the form. */
function onBuyerFormSubmit() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // the daily run will pick it up
  try {
    _lockDepth = 1; _lock = lock;
    runIntakeSources_(['form'], false);
  } finally {
    _lockDepth = 0;
    lock.releaseLock();
  }
}

function ensureFormTrigger_(form) {
  if (!hasTrigger_('onBuyerFormSubmit')) {
    ScriptApp.newTrigger('onBuyerFormSubmit').forForm(form).onFormSubmit().create();
  }
}

// ---------- Source 2: Google Sheet sync ----------

function leadFromRow_(row, mapping) {
  var get = function (f) { return mapping[f] === undefined || mapping[f] === null || mapping[f] === '' ? '' : str_(row[Number(mapping[f])]); };
  var email = get('email').toLowerCase().replace(/^mailto:/, '');
  if (/[,;]/.test(email)) email = email.split(/[,;]/)[0].trim();
  var first = get('firstName'), last = get('lastName');
  if (!first && !last && get('fullName')) {
    var parts = get('fullName').split(/\s+/);
    first = parts.shift();
    last = parts.join(' ');
  }
  return {
    firstName: titleCase_(first), lastName: titleCase_(last), company: get('company'), email: email, phone: get('phone'),
    tier: get('tier'), categories: get('categories'), markets: get('markets'), propertyTypes: get('propertyTypes'),
    minPrice: num_(get('minPrice')), maxPrice: num_(get('maxPrice')), criteria: get('criteria'), notes: get('notes')
  };
}

function sheetLeads_(ctx) {
  var s = getSettings_();
  if (!str_(s.INTAKE_SHEET_URL)) return 'No buyer sheet linked yet.';
  var src = openImportSource_(s.INTAKE_SHEET_URL, str_(s.INTAKE_SHEET_TAB));
  var values = src.sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return 'The buyer sheet is empty.';
  var h = findHeaderRow_(values);
  var mapping = autoMap_(values[h]);
  if (mapping.email === undefined) throw new Error('No Email column found in "' + src.sheet.getName() + '".');
  values.slice(h + 1).forEach(function (row, i) {
    if (!row.some(function (c) { return str_(c) !== ''; })) return;
    var lead = leadFromRow_(row, mapping);
    var ref = 'SHEET:' + (lead.email || normKey_(investorName_(lead) + lead.phone) || ('row' + (h + 2 + i)));
    addLead_(ctx, INTAKE_SOURCES.sheet.label, lead, ref, src.sheet.getName() + ' row ' + (h + 2 + i));
  });
  return '';
}

// ---------- Source 3: cash buyers from a public-records export ----------

var CASH_FIELDS = [
  ['ownerFirst', ['owner 1 first name', 'owner first name', 'owner first', 'first name']],
  ['ownerLast', ['owner 1 last name', 'owner last name', 'owner last', 'last name']],
  ['ownerName', ['owner 1 full name', 'owner full name', 'owner name', 'owner names', 'owner(s)', 'owner 1 name', 'owner', 'buyer name', 'grantee name', 'grantee', 'full name', 'name']],
  ['email', ['email', 'email 1', 'email1', 'email address', 'owner email', 'primary email', 'email address 1']],
  ['phone', ['mobile', 'mobile 1', 'mobile phone', 'wireless 1', 'cell', 'cell phone', 'phone', 'phone 1', 'phone1', 'phone number', 'owner phone', 'primary phone']],
  ['mailAddr', ['mailing address', 'mail address', 'mailing street', 'mailing street address', 'owner mailing address', 'mail street address', 'owner address']],
  ['mailCity', ['mailing city', 'mail city']],
  ['mailState', ['mailing state', 'mail state']],
  ['mailZip', ['mailing zip', 'mailing zip code', 'mail zip', 'mail zip code']],
  ['propAddr', ['property address', 'address', 'street address', 'site address', 'situs address', 'property street']],
  ['propCity', ['property city', 'city', 'site city', 'situs city']],
  ['propState', ['property state', 'state', 'site state']],
  ['propZip', ['property zip', 'zip', 'zip code', 'site zip', 'postal code']],
  ['saleDate', ['last sale date', 'last sale recording date', 'sale date', 'recording date', 'purchase date', 'sold date', 'last sold date', 'transfer date']],
  ['salePrice', ['last sale amount', 'last sale price', 'sale price', 'sale amount', 'purchase price', 'sold price', 'last sold price', 'transfer amount']],
  ['propType', ['property type', 'land use', 'property use', 'use code', 'property class', 'type']],
  ['cashFlag', ['cash buyer', 'cash purchase', 'cash sale', 'purchase method', 'financing', 'last sale type', 'loan type', 'buyer type']],
  ['mortgage', ['open mortgage balance', 'est. mortgage balance', 'estimated mortgage balance', 'mortgage balance', 'total open loans', 'mortgage amount', 'first mortgage amount', 'loan amount', 'est. open loans']]
];

function cashMap_(headers) {
  var norm = headers.map(function (x) { return lc_(x).replace(/[_*#:]/g, ' ').replace(/\s+/g, ' ').trim(); });
  var map = {}, used = {};
  [true, false].forEach(function (exact) {
    CASH_FIELDS.forEach(function (fd) {
      if (map[fd[0]] !== undefined) return;
      for (var i = 0; i < norm.length; i++) {
        if (used[i] || !norm[i]) continue;
        var hit = fd[1].some(function (syn) { return exact ? norm[i] === syn : (syn.length > 5 && norm[i].indexOf(syn) > -1); });
        if (hit) { map[fd[0]] = i; used[i] = true; break; }
      }
    });
  });
  return map;
}

var ENTITY_RE = /\b(llc|l\.l\.c\.?|inc\.?|corp\.?|corporation|company|trust|trustee|holdings?|properties|investments?|capital|partners|lp|llp|ltd|group|ventures|realty|homes|estates?|fund|reit|enterprises?|solutions|series|builders?|construction|developments?|developers?|land)\b/i;

/** Turns export rows into buyer leads (one per owner), with buy boxes built from their purchases. */
function cashLeadsFrom_(values, settings) {
  if (values.length < 2) return { leads: [], mapping: {}, headers: [], rows: 0, considered: 0 };
  var h = 0;
  for (var r = 0; r < Math.min(values.length, 10); r++) {
    if (/owner|grantee|sale|address/i.test(values[r].join('|'))) { h = r; break; }
  }
  var headers = values[h].map(String);
  var mp = cashMap_(headers);
  var get = function (row, f) { return mp[f] === undefined ? '' : str_(row[mp[f]]); };
  var days = Math.max(1, parseInt(settings.INTAKE_CASH_LOOKBACK_DAYS, 10) || 365);
  var cutoff = Date.now() - days * 86400000;
  var minBuys = Math.max(1, parseInt(settings.INTAKE_CASH_MIN_PURCHASES, 10) || 1);
  var groups = {}, order = [], considered = 0;

  values.slice(h + 1).forEach(function (row) {
    if (!row.some(function (c) { return str_(c) !== ''; })) return;
    var name = get(row, 'ownerName') || (get(row, 'ownerFirst') + ' ' + get(row, 'ownerLast')).trim();
    if (!name) return;
    var date = parseDateLoose_(get(row, 'saleDate'));
    if (date && date.getTime() < cutoff) return;
    var flag = lc_(get(row, 'cashFlag'));
    if (flag) {
      var isCash = /cash|^(y|yes|true|1|x)$/.test(flag);
      if (!isCash && /mortgage|loan|conv|fha|\bva\b|financ|^(n|no|false|0)$/.test(flag)) return;
    }
    if (mp.mortgage !== undefined && Number(num_(get(row, 'mortgage'))) > 0) return;
    considered++;
    var email = lc_(get(row, 'email'));
    if (/[,;]/.test(email)) email = email.split(/[,;]/)[0].trim();
    if (!isEmail_(email)) email = '';
    var mailing = [titleCase_(get(row, 'mailAddr')), titleCase_(get(row, 'mailCity')), [get(row, 'mailState').toUpperCase(), get(row, 'mailZip')].join(' ').trim()].filter(String).join(', ');
    var key = email || (normKey_(name) + '|' + normKey_(get(row, 'mailAddr') || get(row, 'propAddr')));
    if (!groups[key]) {
      groups[key] = { name: name, email: email, phone: get(row, 'phone'), mailing: mailing || [titleCase_(get(row, 'propAddr')), titleCase_(get(row, 'propCity')), get(row, 'propState').toUpperCase()].filter(String).join(', '), buys: [] };
      order.push(key);
    }
    var g = groups[key];
    if (!g.phone) g.phone = get(row, 'phone');
    g.buys.push({
      addr: titleCase_(get(row, 'propAddr')), city: titleCase_(get(row, 'propCity')), state: get(row, 'propState').toUpperCase(),
      date: date, price: num_(get(row, 'salePrice')), type: get(row, 'propType')
    });
  });

  var leads = order.map(function (k) { return groups[k]; }).filter(function (g) { return g.buys.length >= minBuys; }).map(function (g) {
    g.buys.sort(function (a, b) { return (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0); });
    var prices = g.buys.map(function (b) { return Number(b.price) || 0; }).filter(function (p) { return p >= 1000; });
    var cities = [], types = [];
    g.buys.forEach(function (b) {
      if (b.city && cities.indexOf(b.city) === -1) cities.push(b.city);
      var t = normalizePropType_(b.type);
      if (t && types.indexOf(t) === -1) types.push(t);
    });
    var lo = prices.length ? Math.floor(Math.min.apply(null, prices) * 0.8 / 5000) * 5000 : '';
    var hi = prices.length ? Math.ceil(Math.max.apply(null, prices) * 1.2 / 5000) * 5000 : '';
    var entity = ENTITY_RE.test(g.name);
    var first = '', last = '', company = '';
    if (entity) company = titleCase_(g.name);
    else if (g.name.indexOf(',') > -1) { last = titleCase_(g.name.split(',')[0]); first = titleCase_(g.name.split(',')[1].trim().split(/\s+/)[0]); }
    else { var p = titleCase_(g.name).split(/\s+/); first = p.shift(); last = p.join(' '); }
    var summary = g.buys.slice(0, 5).map(function (b) {
      return [b.addr, b.city].filter(String).join(', ') + (b.price ? ' — ' + money_(b.price) : '') + (b.date ? ' (' + fmtDate_(b.date, 'MMM d, yyyy') + ')' : '');
    }).join('; ') + (g.buys.length > 5 ? '; +' + (g.buys.length - 5) + ' more' : '');
    var latest = g.buys[0].date;
    return {
      firstName: first, lastName: last, company: company, email: g.email, phone: g.phone, mailingAddress: g.mailing,
      categories: 'Cash Buyer', markets: cities.join(', '), propertyTypes: types.join(', '), minPrice: lo, maxPrice: hi,
      criteria: 'Bought ' + g.buys.length + ' propert' + (g.buys.length === 1 ? 'y' : 'ies') + ' with cash in the last ' + days + ' days' +
        (prices.length ? ', ' + money_(Math.min.apply(null, prices)) + (prices.length > 1 ? '–' + money_(Math.max.apply(null, prices)) : '') : '') + '.',
      purchases: summary, purchaseCount: g.buys.length, lastPurchase: latest ? fmtDate_(latest) : '',
      notes: g.email ? '' : 'Needs an email address before approval (skip trace this owner).',
      _key: (g.email || normKey_(g.name)) + ':' + g.buys.length + ':' + (latest ? fmtDate_(latest) : '')
    };
  });
  return { leads: leads, mapping: mp, headers: headers, rows: values.length - h - 1, considered: considered };
}

function cashLeads_(ctx) {
  var s = getSettings_();
  if (!str_(s.INTAKE_CASH_URL)) return 'No cash-buyer export sheet linked yet.';
  var src = openImportSource_(s.INTAKE_CASH_URL, str_(s.INTAKE_CASH_TAB));
  var res = cashLeadsFrom_(src.sheet.getDataRange().getDisplayValues(), s);
  if (res.mapping.ownerName === undefined && res.mapping.ownerFirst === undefined) throw new Error('No owner/buyer name column found in the cash-buyer sheet.');
  res.leads.forEach(function (lead) {
    var ref = 'CASH:' + lead._key;
    delete lead._key;
    addLead_(ctx, INTAKE_SOURCES.cash.label, lead, ref, lead.purchases);
  });
  return res.leads.length + ' cash buyers found in ' + res.considered + ' qualifying sales.';
}

// ---------- Source 4: Gmail buyer inquiries ----------

function gmailLeads_(ctx) {
  var s = getSettings_();
  var kws = list_(s.INTAKE_GMAIL_KEYWORDS).map(function (k) { return '"' + k.replace(/"/g, '') + '"'; });
  if (!kws.length) return 'No keywords set.';
  var days = Math.max(1, parseInt(s.INTAKE_GMAIL_DAYS, 10) || 3);
  var q = 'in:inbox newer_than:' + days + 'd -from:me (' + kws.join(' OR ') + ')';
  var mine = myAddresses_();
  GmailApp.search(q, 0, 100).forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var ref = 'GMAIL:' + msg.getId();
      if (ctx.refs[ref]) return;
      var from = parseFrom_(msg.getFrom());
      var subject = str_(msg.getSubject());
      if (!from.email || mine.indexOf(from.email) > -1) return;
      if (DEAL_ID_RE.test(subject) || /^\s*(re:\s*)?unsubscribe/i.test(subject)) return; // deal replies are tracked as Responses
      var body = stripQuoted_(msg.getPlainBody());
      var text = subject + '\n' + body;
      var phone = (body.match(/(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/) || [''])[0];
      var price = parsePriceRange_(text);
      var nameParts = from.name ? from.name.replace(/[<>"]/g, '').split(/\s+/) : [];
      addLead_(ctx, INTAKE_SOURCES.gmail.label, {
        firstName: titleCase_(nameParts.shift() || ''), lastName: titleCase_(nameParts.join(' ')), email: from.email, phone: phone,
        markets: marketsIn_(text).join(', '), propertyTypes: typesIn_(text).join(', '), categories: strategiesIn_(text).join(', '),
        minPrice: price.min, maxPrice: price.max, criteria: body.replace(/\s+/g, ' ').slice(0, 400),
        notes: 'Emailed asking to join the buyers list: "' + subject.slice(0, 120) + '" (' + fmtDate_(msg.getDate()) + ').'
      }, ref, 'Email: ' + subject);
    });
  });
  return '';
}

// ---------- orchestration ----------

/** Resolved at run time so file order in the Apps Script project doesn't matter. */
function intakeRunner_(k) {
  return { form: formLeads_, sheet: sheetLeads_, cash: cashLeads_, gmail: gmailLeads_, dealmachine: dmLeads_, county: countyLeads_ }[k];
}

/** Caller must hold the lock (or use runBuyerIntake). */
function runIntakeSources_(sources, sendSummary) {
  var s = getSettings_();
  var ctx = intakeCtx_();
  var results = {};
  sources.forEach(function (k) {
    var src = INTAKE_SOURCES[k];
    if (!bool_(s[src.setting])) { results[k] = { status: 'off' }; return; }
    ctx.cur = { added: 0, updated: 0, duplicate: 0, skipped: 0 };
    try {
      var note = intakeRunner_(k)(ctx);
      results[k] = { status: 'ok', note: note || '', added: ctx.cur.added, updated: ctx.cur.updated, duplicate: ctx.cur.duplicate, skipped: ctx.cur.skipped };
    } catch (e) {
      results[k] = { status: 'error', note: String(e && e.message || e), added: ctx.cur.added, updated: ctx.cur.updated };
    }
  });
  flushIntake_(ctx);
  var added = ctx.adds.length;
  var stamp = new Date().toISOString();
  setSetting_('LAST_INTAKE_RUN', stamp);
  setSetting_('LAST_INTAKE_RESULT', JSON.stringify(results));
  if (sendSummary && added > 0 && bool_(s.INTAKE_SUMMARY_EMAIL)) {
    try { sendIntakeSummary_(ctx.adds); } catch (e) { /* summary is best-effort */ }
  }
  return { results: results, added: added, ranAt: stamp };
}

/** Daily trigger entry point (also "Run now" in the app). */
function runBuyerIntake() {
  return withLock_(function () { return runIntakeSources_(Object.keys(INTAKE_SOURCES), true); });
}

function sendIntakeSummary_(adds) {
  var s = getSettings_();
  var to = replyTo_();
  if (!isEmail_(to)) return;
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { url = ''; }
  var rows = adds.slice(0, 40).map(function (a) {
    var box = [a.markets, a.propertyTypes, (a.minPrice || a.maxPrice) ? money_(a.minPrice || 0) + '–' + (a.maxPrice ? money_(a.maxPrice) : 'any') : ''].filter(String).join(' · ');
    return '<tr><td style="padding:8px 10px;border-bottom:1px solid #DDE5E0"><b>' + esc_(investorName_(a)) + '</b><br><span style="color:#5F6B65">' + esc_(a.email || 'no email yet') + '</span></td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #DDE5E0;color:#5F6B65">' + esc_(a.source) + '</td><td style="padding:8px 10px;border-bottom:1px solid #DDE5E0">' + esc_(box) + '</td></tr>';
  }).join('');
  var html = '<div style="font-family:Arial,sans-serif;max-width:640px"><div style="background:#0A0A0A;color:#fff;padding:18px 22px;font-family:Georgia,serif;font-size:20px">SameDay<span style="color:#7BC8A0">Investments</span></div>' +
    '<div style="padding:18px 22px;background:#fff"><p style="font-size:16px"><b>' + adds.length + ' new buyer' + (adds.length === 1 ? '' : 's') + '</b> found today and waiting for your review.</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px">' + rows + '</table>' +
    (adds.length > 40 ? '<p>…and ' + (adds.length - 40) + ' more.</p>' : '') +
    (url ? '<p style="margin-top:18px"><a href="' + esc_(url) + '" style="background:#0B2E21;color:#fff;padding:11px 18px;text-decoration:none;display:inline-block">Review new buyers</a></p>' : '') +
    '<p style="color:#5F6B65;font-size:12px">New buyers never receive deals until you approve them.</p></div></div>';
  GmailApp.sendEmail(to, adds.length + ' new buyer' + (adds.length === 1 ? '' : 's') + ' to review — ' + (str_(s.COMPANY_NAME) || APP_NAME),
    adds.length + ' new buyers are waiting for your review in the Deal Distribution app.' + (url ? '\n\n' + url : ''),
    { htmlBody: html, name: str_(s.SENDER_NAME) || APP_NAME });
}

// ---------- client API ----------

function getIntakeStatus() {
  var s = getSettings_();
  var form = buyerForm_();
  var formInfo = null;
  if (form) {
    formInfo = { id: form.getId(), url: str_(s.BUYER_FORM_URL) || form.getPublishedUrl(), editUrl: '', responses: 0 };
    try { formInfo.editUrl = form.getEditUrl(); formInfo.responses = form.getResponses().length; } catch (e) { /* ignore */ }
  }
  var last = null;
  try { last = s.LAST_INTAKE_RESULT ? JSON.parse(s.LAST_INTAKE_RESULT) : null; } catch (e) { last = null; }
  var log = readTable_(SHEET.INTAKE).rows.slice(-80).reverse();
  var pending = readTable_(SHEET.INVESTORS).rows.filter(function (r) { return str_(r.status) === PENDING_REVIEW; }).length;
  return toClient_({
    form: formInfo,
    daily: hasTrigger_('runBuyerIntake'),
    formTrigger: hasTrigger_('onBuyerFormSubmit'),
    lastRun: s.LAST_INTAKE_RUN || '',
    lastResult: last,
    pending: pending,
    log: log,
    sources: Object.keys(INTAKE_SOURCES).map(function (k) { return { key: k, label: INTAKE_SOURCES[k].label, on: bool_(s[INTAKE_SOURCES[k].setting]) }; }),
    dm: { hasKey: !!dmKey_(), keyHint: dmKey_() ? '…' + dmKey_().slice(-4) : '', creditsThisMonth: dmCreditsUsed_(), cap: parseInt(s.INTAKE_DM_MONTHLY_CAP, 10) || 0 },
    areas: DM_AREAS
  });
}

/** Creates (or re-links) the branded VIP buyer signup Google Form. */
function createBuyerSignupForm() {
  return withLock_(function () {
    var existing = buyerForm_();
    if (existing) { ensureFormTrigger_(existing); return getIntakeStatus(); }
    var s = getSettings_();
    var company = str_(s.COMPANY_NAME) || APP_NAME;
    var Q = BUYER_FORM_Q;
    var form = FormApp.create(company + ' — VIP Buyers List');
    form.setDescription('Get our off-market deals before anyone else. Tell us exactly what you buy and we will only send properties that fit your buy box.' +
      (str_(s.CONTACT_PHONE) ? '\n\nQuestions? Call or text ' + s.CONTACT_PHONE + '.' : ''))
      .setConfirmationMessage("You're on the " + company + ' VIP buyers list. Watch your inbox for our next off-market deal.')
      .setAllowResponseEdits(false)
      .setProgressBar(false);
    try { form.setRequireLogin(false); } catch (e) { /* Workspace-only setting */ }
    form.addTextItem().setTitle(Q.first).setRequired(true);
    form.addTextItem().setTitle(Q.last);
    form.addTextItem().setTitle(Q.company);
    form.addTextItem().setTitle(Q.email).setRequired(true)
      .setValidation(FormApp.createTextValidation().setHelpText('Please enter a valid email address.').requireTextIsEmail().build());
    form.addTextItem().setTitle(Q.phone);
    var markets = list_(s.MARKETS);
    if (markets.length) form.addCheckboxItem().setTitle(Q.markets).setChoiceValues(markets).showOtherOption(true);
    else form.addTextItem().setTitle(Q.markets).setHelpText('Cities, counties or zip codes');
    var types = list_(s.PROPERTY_TYPES);
    if (types.length) form.addCheckboxItem().setTitle(Q.types).setChoiceValues(types).showOtherOption(true);
    var cats = list_(s.CATEGORIES);
    if (cats.length) form.addCheckboxItem().setTitle(Q.strategy).setChoiceValues(cats).showOtherOption(true);
    form.addTextItem().setTitle(Q.min).setHelpText('e.g. 75000');
    form.addTextItem().setTitle(Q.max).setHelpText('e.g. 300000');
    form.addParagraphTextItem().setTitle(Q.buybox).setHelpText('Beds/baths, condition, rehab budget, neighborhoods, anything that makes a deal a fit for you.');
    form.addMultipleChoiceItem().setTitle(Q.funding).setChoiceValues(['Cash', 'Hard money / private lender', 'Conventional financing', 'Other']);
    form.addCheckboxItem().setTitle(Q.consent).setRequired(true)
      .setChoiceValues(['Yes, email me off-market deals from ' + company + '. I can unsubscribe at any time.']);
    try { DriveApp.getFileById(form.getId()).moveTo(rootFolder_()); } catch (e) { /* stays in My Drive */ }
    setSetting_('BUYER_FORM_ID', form.getId());
    setSetting_('BUYER_FORM_URL', form.getPublishedUrl());
    setSetting_('INTAKE_FORM_ON', 'TRUE');
    ensureFormTrigger_(form);
    return getIntakeStatus();
  });
}

/** Turns on the automatic intake: every morning and every night at the chosen hours. */
function enableDailyIntake(hourAm, hourPm) {
  return withLock_(function () {
    var s = getSettings_();
    var valid = function (h) { h = parseInt(h, 10); return isNaN(h) || h < 0 || h > 23 ? null : h; };
    var am = valid(hourAm); if (am === null) am = valid(s.INTAKE_HOUR); if (am === null) am = 6;
    var pm = valid(hourPm); if (pm === null) pm = valid(s.INTAKE_HOUR_PM); if (pm === null) pm = 19;
    setSetting_('INTAKE_HOUR', String(am));
    setSetting_('INTAKE_HOUR_PM', String(pm));
    deleteTriggers_('runBuyerIntake');
    ScriptApp.newTrigger('runBuyerIntake').timeBased().everyDays(1).atHour(am).create();
    if (pm !== am) ScriptApp.newTrigger('runBuyerIntake').timeBased().everyDays(1).atHour(pm).create();
    var form = buyerForm_();
    if (form) ensureFormTrigger_(form);
    return getIntakeStatus();
  });
}

function disableDailyIntake() {
  deleteTriggers_('runBuyerIntake');
  return getIntakeStatus();
}

/** Runs all enabled sources now. */
function runBuyerIntakeNow() {
  var r = runBuyerIntake();
  var st = getIntakeStatus();
  st.run = r;
  return st;
}

/** Shows what the system will read from a linked sheet, without adding anyone. */
function previewBuyerSource(kind, urlOrId, tabName) {
  var src = openImportSource_(urlOrId, tabName);
  var values = src.sheet.getDataRange().getDisplayValues();
  if (kind === 'cash') {
    var res = cashLeadsFrom_(values, getSettings_());
    var labels = {};
    Object.keys(res.mapping).forEach(function (f) { labels[f] = res.headers[res.mapping[f]]; });
    return toClient_({
      sheet: src.spreadsheet.getName() + ' / ' + src.sheet.getName(), rows: res.rows, considered: res.considered, columns: labels,
      buyers: res.leads.length, sample: res.leads.slice(0, 6).map(function (l) {
        return { name: investorName_(l), email: l.email, purchases: l.purchaseCount, markets: l.markets, price: (l.minPrice ? money_(l.minPrice) : '') + (l.maxPrice ? '–' + money_(l.maxPrice) : ''), types: l.propertyTypes };
      })
    });
  }
  var p = previewImport(urlOrId, tabName);
  var cols = {};
  Object.keys(p.mapping).forEach(function (f) { cols[f] = p.headers[p.mapping[f]]; });
  return { sheet: p.spreadsheetName + ' / ' + p.tab, rows: p.totalRows, columns: cols, hasEmail: p.mapping.email !== undefined };
}
