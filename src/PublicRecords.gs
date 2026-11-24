/**
 * PublicRecords.gs — finds ACTIVE investor buyers from recent recorded sales, automatically.
 *
 *  • DealMachine (paid, all your areas): properties that SOLD in the last N days where the buyer
 *    used no mortgage (cash) — and optionally a private / hard-money lender — and the new owner
 *    doesn't live there. Returns the owner's name, mailing address and (optionally) phone + email.
 *    API: https://api.docs.dealmachine.com  (key from dealmachine.com/settings/developer)
 *
 *    Also finds NEW-CONSTRUCTION / LAND buyers: owners paying cash for residential vacant land or
 *    development lots who own several properties (builders and developers, not one-time lot buyers).
 *
 *  • County records (free): City of Norfolk "Property Assessment and Sales" open data —
 *    every recorded transfer with buyer (grantee), date and price. Free data has no mortgage info,
 *    so by default only company / LLC / trust buyers are kept (the likely investors).
 *
 * Each sale is processed once (tracked in the Buyer Intake Log). Sales by the same owner are grouped
 * into one buyer whose buy box is built from what they bought. Everyone lands in New Buyers as
 * Pending Review — nobody receives deals until you approve them.
 */

var DM_BASE = 'https://api.v2.dealmachine.com/v1';

/** Your markets as county FIPS codes (Virginia independent cities are their own "county"). */
var DM_AREAS = [
  { fips: '51810', name: 'Virginia Beach', region: 'Hampton Roads' },
  { fips: '51710', name: 'Norfolk', region: 'Hampton Roads' },
  { fips: '51550', name: 'Chesapeake', region: 'Hampton Roads' },
  { fips: '51740', name: 'Portsmouth', region: 'Hampton Roads' },
  { fips: '51800', name: 'Suffolk', region: 'Hampton Roads' },
  { fips: '51650', name: 'Hampton', region: 'Hampton Roads' },
  { fips: '51700', name: 'Newport News', region: 'Hampton Roads' },
  { fips: '51735', name: 'Poquoson', region: 'Hampton Roads' },
  { fips: '51199', name: 'York County', region: 'Hampton Roads' },
  { fips: '51830', name: 'Williamsburg', region: 'Hampton Roads' },
  { fips: '51095', name: 'James City County', region: 'Hampton Roads' },
  { fips: '51093', name: 'Isle of Wight County', region: 'Hampton Roads' },
  { fips: '51073', name: 'Gloucester County', region: 'Hampton Roads' },
  { fips: '51760', name: 'Richmond City', region: 'Richmond' },
  { fips: '51087', name: 'Henrico County', region: 'Richmond' },
  { fips: '51041', name: 'Chesterfield County', region: 'Richmond' },
  { fips: '51085', name: 'Hanover County', region: 'Richmond' },
  { fips: '37139', name: 'Pasquotank County (Elizabeth City)', region: 'Elizabeth City, NC' },
  { fips: '37029', name: 'Camden County', region: 'Elizabeth City, NC' },
  { fips: '37053', name: 'Currituck County', region: 'Elizabeth City, NC' },
  { fips: '37143', name: 'Perquimans County', region: 'Elizabeth City, NC' },
  { fips: '37041', name: 'Chowan County', region: 'Elizabeth City, NC' }
];

// ---------- shared: turn individual sales into grouped buyer leads ----------

/**
 * sales: [{ name, contactFirst, contactLast, email, phone, phoneNote, mailing, addr, city, state,
 *           date (Date), price, type, financing ('cash'|'hard money'|''), saleRef }]
 */
function groupSales_(sales, days, sourceNote) {
  var groups = {}, order = [];
  sales.forEach(function (s) {
    if (!str_(s.name)) return;
    var entity = ENTITY_RE.test(s.name);
    // companies group by name (their sales often carry different contacts); people by email or name + address
    var key = entity ? 'co|' + normKey_(s.name) : (s.email || normKey_(s.name) + '|' + normKey_(String(s.mailing || s.addr).split(',')[0]));
    if (!groups[key]) { groups[key] = { s: s, buys: [] }; order.push(key); }
    var g = groups[key];
    if (!g.s.email && s.email) g.s.email = s.email;
    if (!g.s.phone && s.phone) g.s.phone = s.phone;
    if (!g.s.contactFirst && s.contactFirst) { g.s.contactFirst = s.contactFirst; g.s.contactLast = s.contactLast; }
    g.buys.push(s);
  });
  return order.map(function (k) {
    var g = groups[k], s = g.s;
    g.buys.sort(function (a, b) { return (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0); });
    var prices = g.buys.map(function (b) { return Number(b.price) || 0; }).filter(function (p) { return p >= 1000; });
    var cities = [], types = [], fin = [];
    g.buys.forEach(function (b) {
      var c = titleCase_(b.city);
      if (c && cities.indexOf(c) === -1) cities.push(c);
      var t = normalizePropType_(b.type);
      if (t && types.indexOf(t) === -1) types.push(t);
      if (b.financing && fin.indexOf(b.financing) === -1) fin.push(b.financing);
    });
    var entity = ENTITY_RE.test(s.name);
    var first = '', last = '', company = '';
    if (entity) { company = titleCase_(s.name); first = titleCase_(s.contactFirst || ''); last = titleCase_(s.contactLast || ''); }
    else if (s.contactFirst) { first = titleCase_(s.contactFirst); last = titleCase_(s.contactLast || ''); }
    else if (s.name.indexOf(',') > -1) { last = titleCase_(s.name.split(',')[0]); first = titleCase_(s.name.split(',')[1].trim().split(/\s+/)[0]); }
    else { var p = titleCase_(s.name).split(/\s+/); first = p.shift(); last = p.join(' '); }
    var summary = g.buys.slice(0, 5).map(function (b) {
      return [titleCase_(b.addr), titleCase_(b.city)].filter(String).join(', ') + (b.price ? ' — ' + money_(b.price) : '') +
        (b.financing ? ', ' + b.financing : '') + (/land|lot|development|acre/i.test(String(b.type)) ? ' · land' : '') + (b.date ? ' (' + fmtDate_(b.date, 'MMM d, yyyy') + ')' : '');
    }).join('; ') + (g.buys.length > 5 ? '; +' + (g.buys.length - 5) + ' more' : '');
    var how = fin.length === 1 ? ' with ' + fin[0] : fin.length ? ' (cash / hard money)' : '';
    var landBuys = g.buys.filter(function (b) { return /land|lot|development|acre/i.test(String(b.type)); }).length;
    var cats = [];
    if (fin.indexOf('cash') > -1) cats.push('Cash Buyer');
    if (g.buys.some(function (b) { return /commercial/i.test(String(b.type)); })) {
      cats.push(list_(getSettings_().CATEGORIES).filter(function (c) { return /commercial/i.test(c); })[0] || 'Commercial Buyer');
    }
    if (landBuys) {
      var dev = list_(getSettings_().CATEGORIES).filter(function (c) { return /develop|builder|construction/i.test(c); })[0] || 'Developer';
      cats.push(dev);
    }
    var notes = [];
    if (sourceNote) notes.push(sourceNote);
    if (s.phoneNote) notes.push(s.phoneNote);
    if (!s.email) notes.push('Needs an email address before approval (skip trace this owner).');
    return {
      firstName: first, lastName: last, company: company, email: s.email || '', phone: s.phone || '',
      mailingAddress: s.mailing || '', categories: cats.join(', '),
      markets: cities.join(', '), propertyTypes: types.join(', '),
      minPrice: prices.length ? Math.floor(Math.min.apply(null, prices) * 0.8 / 5000) * 5000 : '',
      maxPrice: prices.length ? Math.ceil(Math.max.apply(null, prices) * 1.2 / 5000) * 5000 : '',
      criteria: (landBuys ? 'New-construction / land buyer. ' : '') + 'Bought ' + g.buys.length + ' propert' + (g.buys.length === 1 ? 'y' : 'ies') +
        (landBuys ? ' (' + landBuys + ' land/lot' + (landBuys === 1 ? '' : 's') + ')' : '') + how + ' in the last ' + days + ' days' +
        (prices.length ? ', ' + money_(Math.min.apply(null, prices)) + (prices.length > 1 ? '–' + money_(Math.max.apply(null, prices)) : '') : '') + '.',
      purchases: summary, purchaseCount: g.buys.length, lastPurchase: g.buys[0].date ? fmtDate_(g.buys[0].date) : '',
      notes: notes.join(' '),
      _refs: g.buys.map(function (b) { return b.saleRef; })
    };
  });
}

/** Adds grouped leads; if the buyer already exists, their purchase history is extended. */
function addRecordLeads_(ctx, sourceLabel, leads) {
  leads.forEach(function (lead) {
    var refs = lead._refs; delete lead._refs;
    var existing = (lead.email && ctx.byEmail[lc_(lead.email)]) || ctx.byKey[ownerKey_(lead)];
    if (existing) {
      lead.purchaseCount = (Number(existing.purchaseCount) || 0) + lead.purchaseCount;
      if (str_(existing.purchases)) lead.purchases = (lead.purchases + '; ' + existing.purchases).slice(0, 900);
    }
    addLead_(ctx, sourceLabel, lead, refs.join(';'), lead.purchases);
    refs.forEach(function (r) { ctx.refs[r] = true; });
  });
}

// ---------- DealMachine ----------

function dmKey_() {
  return PropertiesService.getScriptProperties().getProperty('DM_API_KEY') || '';
}

function dmMonthKey_() { return 'DM_CREDITS_' + fmtDate_(new Date(), 'yyyyMM'); }
function dmCreditsUsed_() { return parseInt(PropertiesService.getScriptProperties().getProperty(dmMonthKey_()) || '0', 10) || 0; }
function dmAddCredits_(n) {
  if (!n) return;
  PropertiesService.getScriptProperties().setProperty(dmMonthKey_(), String(dmCreditsUsed_() + Number(n)));
}

/** Calls the DealMachine API. Retries once on rate limit / temporary outage. */
function dmFetch_(method, path, body) {
  var key = dmKey_();
  if (!key) throw new Error('Add your DealMachine API key first (New Buyers → DealMachine).');
  for (var attempt = 0; attempt < 2; attempt++) {
    var opts = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + key } };
    if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
    var res = UrlFetchApp.fetch(DM_BASE + path, opts);
    var code = res.getResponseCode();
    var json = {};
    try { json = JSON.parse(res.getContentText() || '{}'); } catch (e) { json = {}; }
    if (code >= 200 && code < 300) return json;
    var err = json.error || {};
    if ((code === 429 || code === 503) && attempt === 0) {
      var wait = Number((err.details && err.details.retry_after) || res.getHeaders()['Retry-After'] || 5);
      if (code === 429 && err.details && err.details.limit_type === 'day') break;
      Utilities.sleep(Math.min(Math.max(wait, 1), 25) * 1000);
      continue;
    }
    var msg = {
      401: 'DealMachine rejected the API key (invalid or revoked). Create a new key at dealmachine.com/settings/developer.',
      402: 'Your DealMachine account is out of data credits for this month.',
      403: err.code === 'subscription_required' ? 'Your DealMachine plan does not include API data access. Upgrade your DealMachine plan to use this source.' : 'DealMachine refused this request (permissions).',
      429: 'DealMachine daily request limit reached — it will continue on the next run.'
    }[code] || ('DealMachine error ' + code + ': ' + (err.message || res.getContentText().slice(0, 200)));
    throw new Error(msg);
  }
  throw new Error('DealMachine is busy right now — it will try again on the next run.');
}

function dmAreas_() {
  var chosen = list_(getSettings_().INTAKE_DM_COUNTIES);
  return DM_AREAS.filter(function (a) { return !chosen.length || chosen.indexOf(a.fips) > -1; });
}

/** One search body. kind: 'cash' (no mortgage) or 'hard money' (private-lender first mortgage). */
function dmQuery_(kind, fipsList, s, landIds) {
  var days = Math.max(1, parseInt(s.INTAKE_DM_DAYS, 10) || 14);
  var filters = [
    { filter_id: 'last_sale_date', operator: 'relative_time', value: { value: days, unit: 'days', direction: 'ago', comparison: 'less_than' } },
    { filter_id: 'is_bank_owned', value: false },
    { filter_id: 'is_intra_family_transfer', value: false }
  ];
  if (kind === 'land') {
    // Builders / developers: cash purchases of residential land or lots by owners with several properties
    filters.push({ filter_id: 'num_mortgages', operator: 'equals', value: 0 });
    if (landIds && landIds.additional.length) filters.push({ filter_id: 'additional_property_types', operator: 'contains_any', value: landIds.additional });
    else filters.push({ filter_id: 'property_type', operator: 'contains_any', value: landIds ? landIds.primary : [] });
    var minOwned = Math.max(1, parseInt(s.INTAKE_DM_LAND_MIN_OWNED, 10) || 2);
    filters.push({ filter_id: 'ppm_num_properties_owned_by_owner', operator: 'greater_than_or_equal', value: minOwned });
  } else {
    if (kind === 'cash') filters.push({ filter_id: 'num_mortgages', operator: 'equals', value: 0 });
    else filters.push({ filter_id: 'is_mortgage_1_private_lender', value: true });
    if (bool_(s.INTAKE_DM_ABSENTEE)) filters.push({ filter_id: 'has_absentee_owners', value: true });
  }
  var minPrice = Number(num_(kind === 'land' ? s.INTAKE_DM_LAND_MIN_PRICE : s.INTAKE_DM_MIN_PRICE)) || 0;
  if (minPrice > 0) filters.push({ filter_id: 'last_sale_price', operator: 'greater_than_or_equal', value: minPrice });
  return {
    locations: fipsList.map(function (f) { return { type: 'county', code: f }; }),
    anchor: 'properties',
    contact_audience: bool_(s.INTAKE_DM_CONTACTS) ? 'owners' : 'none',
    filters: filters,
    fields: ['owner_1_full_name', 'owner_mailing_address_full', 'last_sale_date', 'last_sale_price', 'property_type'],
    sort: [{ field_id: 'last_sale_date', direction: 'desc' }]
  };
}

/** Option-ID → label map for property_type (cached; free endpoint). */
function dmTypeLabels_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('dm_type_labels');
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* refetch */ } }
  var map = {};
  try {
    var res = dmFetch_('get', '/filters?source_type=properties&search=' + encodeURIComponent('Property Type') + '&per_page=50');
    (res.data || []).forEach(function (f) {
      if (f.filter_id === 'property_type') (f.options || []).forEach(function (o) { map[String(o.option_id)] = o.label; });
    });
    cache.put('dm_type_labels', JSON.stringify(map), 21600);
  } catch (e) { /* labels are optional */ }
  return map;
}

/**
 * Option IDs for residential land: property_type "Vacant Land" / "Development Site", and the granular
 * additional_property_types whose label is residential land or lots (looked up live; cached).
 */
function dmLandTypeIds_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('dm_land_ids');
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* refetch */ } }
  var out = { primary: [], additional: [] };
  var page = 1;
  while (page <= 4) {
    var res = dmFetch_('get', '/filters?source_type=properties&search=' + encodeURIComponent('Property Type') + '&per_page=50&page=' + page);
    (res.data || []).forEach(function (f) {
      (f.options || []).forEach(function (o) {
        var l = String(o.label || '');
        if (f.filter_id === 'property_type' && /vacant land|development site/i.test(l)) out.primary.push(o.option_id);
        if (f.filter_id === 'additional_property_types' && /resid|single|sfr|subdivi|townhouse|duplex|multi/i.test(l) && /vacant|land|lot|acre/i.test(l)) out.additional.push(o.option_id);
      });
    });
    if (!res.pagination || !res.pagination.has_next_page) break;
    page++;
  }
  cache.put('dm_land_ids', JSON.stringify(out), 21600);
  return out;
}

/** Picks the best contact: likely owner, mobile not on Do-Not-Call, deliverable email. */
function dmBestContact_(contacts) {
  var cs = (contacts || []).slice().sort(function (a, b) { return (b.is_likely_owner ? 1 : 0) - (a.is_likely_owner ? 1 : 0); });
  var out = { first: '', last: '', email: '', phone: '', phoneNote: '' };
  cs.some(function (c) {
    if (!out.first && (c.first_name || c.last_name)) { out.first = c.first_name || ''; out.last = c.last_name || ''; }
    if (!out.email) {
      var em = (c.emails || []).filter(function (e) { return e && e.address && !/undeliverable|invalid/i.test(e.verification_status || ''); })[0];
      if (em) out.email = lc_(em.address);
    }
    if (!out.phone) {
      var ph = (c.phones || []).filter(function (p) { return p && p.number; });
      var ok = ph.filter(function (p) { return !p.do_not_call; });
      var best = ok.filter(function (p) { return /wireless|mobile/i.test(p.type || ''); })[0] || ok[0];
      if (best) out.phone = formatPhone_(best.number);
      else if (ph.length && !out.phoneNote) out.phoneNote = 'Phone ' + formatPhone_(ph[0].number) + ' is on the Do-Not-Call list.';
    }
    return out.email && out.phone;
  });
  return out;
}

function formatPhone_(n) {
  var d = String(n || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : String(n || '');
}

function dmLeads_(ctx) {
  var s = getSettings_();
  if (!dmKey_()) return 'Add your DealMachine API key to turn this on.';
  var areas = dmAreas_();
  if (!areas.length) return 'Pick at least one county.';
  var sales = [], fetched = 0, creditsUsed = 0, notes = [];
  var maxRun = Math.max(1, parseInt(s.INTAKE_DM_MAX_PER_RUN, 10) || 100);
  var cap = Math.max(0, parseInt(s.INTAKE_DM_MONTHLY_CAP, 10) || 0);
  var kinds = ['cash'];
  if (bool_(s.INTAKE_DM_HARD_MONEY)) kinds.push('hard money');
  var landIds = null;
  if (bool_(s.INTAKE_DM_LAND)) {
    landIds = dmLandTypeIds_();
    if (landIds.primary.length || landIds.additional.length) kinds.push('land');
    else notes.push('Land search skipped: DealMachine did not return land property types.');
  }
  var labels = dmTypeLabels_();

  var chunks = [];
  for (var i = 0; i < areas.length; i += 15) chunks.push(areas.slice(i, i + 15).map(function (a) { return a.fips; }));

  var perKind = Math.ceil(maxRun / kinds.length); // share the per-run limit fairly between searches
  var counts = { cash: 0, 'hard money': 0, land: 0 };
  outer:
  for (var k = 0; k < kinds.length; k++) {
    var kindFetched = 0;
    for (var c = 0; c < chunks.length; c++) {
      var page = 1;
      while (true) {
        var room = Math.min(perKind - kindFetched, maxRun - fetched);
        if (cap) room = Math.min(room, cap - dmCreditsUsed_());
        if (cap && dmCreditsUsed_() >= cap) { notes.push('Monthly credit limit reached (' + cap + ').'); break outer; }
        if (room <= 0) { if (fetched >= maxRun) { notes.push('Per-run limit reached (' + maxRun + ').'); break outer; } break; }
        var body = dmQuery_(kinds[k], chunks[c], s, landIds);
        body.page = page;
        body.per_page = Math.min(100, room);
        var res = dmFetch_('post', '/properties/search', body);
        var used = (res.credits && Number(res.credits.used)) || 0;
        creditsUsed += used; dmAddCredits_(used);
        (res.data || []).forEach(function (p) {
          fetched++; kindFetched++; counts[kinds[k]]++;
          var ref = 'DM:' + p.dm_property_id + ':' + (p.last_sale_date || '');
          if (ctx.refs[ref]) return;
          var who = dmBestContact_(p.contacts);
          var type = Array.isArray(p.property_type) ? p.property_type.map(function (id) { return labels[String(id)] || ''; }).filter(String)[0] : p.property_type;
          sales.push({
            name: str_(p.owner_1_full_name) || (who.first + ' ' + who.last).trim(), contactFirst: who.first, contactLast: who.last,
            email: who.email, phone: who.phone, phoneNote: who.phoneNote, mailing: titleCase_(p.owner_mailing_address_full || ''),
            addr: p.address, city: p.city, state: p.state, date: parseDateLoose_(p.last_sale_date), price: p.last_sale_price,
            type: type || (kinds[k] === 'land' ? 'Vacant Land' : ''), financing: kinds[k] === 'land' ? 'cash' : kinds[k], saleRef: ref
          });
        });
        var pg = res.pagination || {};
        if (!pg.has_next_page || !(res.data || []).length) break;
        page++;
      }
    }
  }
  var days = Math.max(1, parseInt(s.INTAKE_DM_DAYS, 10) || 14);
  addRecordLeads_(ctx, INTAKE_SOURCES.dealmachine.label, groupSales_(sales, days, 'Found by DealMachine from recorded sales.'));
  return fetched + ' recent sales checked (' + kinds.map(function (x) { return counts[x] + ' ' + x; }).join(', ') + ') · ' + creditsUsed + ' credits used (' + dmCreditsUsed_() + (cap ? ' of ' + cap : '') + ' this month).' + (notes.length ? ' ' + notes.join(' ') : '');
}

// ---------- Free county records: Norfolk open data ----------

var NORFOLK_HOST = 'https://data.norfolk.gov';

/** Finds the newest "Property Assessment and Sales - FYxx" dataset (it rolls over every July). */
function norfolkDataset_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('norfolk_sales_ds');
  if (hit) return hit;
  var res = UrlFetchApp.fetch(NORFOLK_HOST + '/api/views/metadata/v1?limit=500', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Norfolk open data is unavailable right now (' + res.getResponseCode() + ').');
  var best = null;
  JSON.parse(res.getContentText()).forEach(function (d) {
    var m = String(d.name || '').match(/^Property Assessment and Sales - FY\s?(\d+)$/i);
    if (m && (!best || Number(m[1]) > best.fy)) best = { fy: Number(m[1]), id: d.id };
  });
  if (!best) throw new Error('Could not find Norfolk\'s property sales dataset.');
  cache.put('norfolk_sales_ds', best.id, 43200);
  return best.id;
}

function countyLeads_(ctx) {
  var s = getSettings_();
  var days = Math.max(1, parseInt(s.INTAKE_COUNTY_DAYS, 10) || 30);
  var minPrice = Number(num_(s.INTAKE_COUNTY_MIN_PRICE)) || 0;
  var since = fmtDate_(new Date(Date.now() - days * 86400000), "yyyy-MM-dd'T'00:00:00");
  var ds = norfolkDataset_();
  var url = NORFOLK_HOST + '/resource/' + ds + '.json?' + [
    '$where=' + encodeURIComponent("transfer_date >= '" + since + "' AND consideration >= " + minPrice),
    '$order=' + encodeURIComponent('transfer_date DESC'),
    '$limit=5000',
    '$select=' + encodeURIComponent('parcel_id,owner,grantee,transfer_date,consideration,property_street_number,property_street_direction,property_street_name,property_street_type,unit_number,property_city,property_zip,property_use')
  ].join('&');
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Norfolk open data query failed (' + res.getResponseCode() + ').');
  var rows = JSON.parse(res.getContentText());
  var entitiesOnly = bool_(s.INTAKE_COUNTY_ENTITIES_ONLY);
  var sales = [], kept = 0;
  rows.forEach(function (r) {
    var buyer = str_(r.grantee) || str_(r.owner);
    if (!buyer) return;
    if (entitiesOnly && !ENTITY_RE.test(buyer)) return;
    if (INSTITUTION_RE.test(buyer)) return;
    var ref = 'NFK:' + r.parcel_id + ':' + String(r.transfer_date || '').slice(0, 10);
    kept++;
    if (ctx.refs[ref]) return;
    var addr = [r.property_street_number, r.property_street_direction, r.property_street_name, r.property_street_type].filter(Boolean).join(' ') + (r.unit_number ? ' #' + r.unit_number : '');
    sales.push({
      name: buyer, email: '', phone: '', mailing: '', addr: addr, city: r.property_city || 'Norfolk', state: 'VA',
      date: parseDateLoose_(String(r.transfer_date || '').slice(0, 10)), price: Number(r.consideration) || '', type: propKind_(r.property_use, '', undefined),
      financing: '', saleRef: ref
    });
  });
  addRecordLeads_(ctx, INTAKE_SOURCES.county.label, groupSales_(sales, days, 'Found in City of Norfolk recorded sales (public record).'));
  return rows.length + ' Norfolk sales in the last ' + days + ' days, ' + kept + (entitiesOnly ? ' to companies / LLCs' : ' kept') + '.';
}

// ---------- client API ----------

/** Saves (and tests) the DealMachine API key. The key is stored privately, never in the sheet. */
function saveDealMachineKey(key) {
  requireRole_('Owner');
  key = str_(key);
  var props = PropertiesService.getScriptProperties();
  if (!key) { props.deleteProperty('DM_API_KEY'); return getIntakeStatus(); }
  if (!/^dm_[a-z]{2}_live_[A-Za-z0-9_\-]{8,}$/.test(key)) throw new Error('That doesn\'t look like a DealMachine API key (it starts with dm_sk_live_).');
  var old = props.getProperty('DM_API_KEY');
  props.setProperty('DM_API_KEY', key);
  try {
    dmFetch_('get', '/account');
  } catch (e) {
    if (old) props.setProperty('DM_API_KEY', old); else props.deleteProperty('DM_API_KEY');
    throw e;
  }
  return getIntakeStatus();
}

/** Free preview: how many recent cash / hard-money sales match right now (count endpoints cost no credits). */
function previewDealMachine() {
  requireRole_('Rep');
  var s = getSettings_();
  var fips = dmAreas_().map(function (a) { return a.fips; });
  var out = {};
  var landIds = dmLandTypeIds_();
  ['cash', 'hard money', 'land'].forEach(function (kind) {
    var total = 0;
    if (kind === 'land' && !landIds.primary.length && !landIds.additional.length) { out[kind] = 0; return; }
    for (var i = 0; i < fips.length; i += 15) {
      var res = dmFetch_('post', '/properties/search/count', dmQuery_(kind, fips.slice(i, i + 15), s, landIds));
      total += Number(res.total_properties) || 0;
    }
    out[kind] = total;
  });
  return { cash: out.cash, hardMoney: out['hard money'], land: out.land, days: parseInt(s.INTAKE_DM_DAYS, 10) || 14, counties: fips.length };
}
