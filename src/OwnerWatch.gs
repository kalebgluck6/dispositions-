/**
 * OwnerWatch.gs — free public-records buyer finder for Hampton Roads, Richmond and NE North Carolina.
 *
 * Two kinds of sources:
 *  • "sales"  — live recorded-sale feeds with the buyer, date and price (York County / Yorktown).
 *  • "owners" — public parcel layers with the CURRENT owner but no sale date. We keep a private
 *               snapshot of every parcel's owner; when the locality refreshes its data, every parcel
 *               whose owner changed is a purchase, and the new owner is the buyer.
 *               (Richmond ≈ weekly · Hampton Roads regional parcels ≈ twice a year · NC OneMap ≈ periodically)
 *
 * Investor filter (every source): companies / LLCs / trusts, or individuals whose mailing address is
 * not the property (absentee = investor). Homeowners, governments, banks, churches and HOAs are skipped.
 * Purchases are tagged Residential / Commercial / Land; repeat buyers are grouped and ranked.
 * Free records never show whether a purchase was cash or financed.
 */

var HRGEO_URL = 'https://geo.hrsd.com/hrgeo/rest/services/regionalgis/HRGeo_Parcels_Public/MapServer/0';
var NCONEMAP_URL = 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1';
var OW_PAGE = 2000;

var WATCH_SOURCES = [
  { key: 'york', label: 'York County (Yorktown)', kind: 'sales', url: 'https://maps.yorkcounty.gov/arcgis/rest/services/AGOservices/Landrecords_Service/FeatureServer/7', market: 'Yorktown' },
  { key: 'richmond', label: 'Richmond', kind: 'owners', provider: 'richmond', url: 'https://services1.arcgis.com/k3vhq11XkBNeeOfM/ArcGIS/rest/services/Parcels/FeatureServer/0', market: 'Richmond', cadence: 'about weekly' },
  { key: 'hr810', label: 'Virginia Beach', kind: 'owners', provider: 'hrgeo', fips: '810', market: 'Virginia Beach', cadence: 'about twice a year' },
  { key: 'hr740', label: 'Portsmouth', kind: 'owners', provider: 'hrgeo', fips: '740', market: 'Portsmouth', cadence: 'about twice a year' },
  { key: 'hr800', label: 'Suffolk', kind: 'owners', provider: 'hrgeo', fips: '800', market: 'Suffolk', cadence: 'about twice a year' },
  { key: 'hr700', label: 'Newport News', kind: 'owners', provider: 'hrgeo', fips: '700', market: 'Newport News', cadence: 'about twice a year' },
  { key: 'hr093', label: 'Isle of Wight (Smithfield)', kind: 'owners', provider: 'hrgeo', fips: '093', market: 'Smithfield', cadence: 'about twice a year' },
  { key: 'hr830', label: 'Williamsburg', kind: 'owners', provider: 'hrgeo', fips: '830', market: 'Williamsburg', cadence: 'about twice a year' },
  { key: 'hr095', label: 'James City County', kind: 'owners', provider: 'hrgeo', fips: '095', market: 'James City County', cadence: 'about twice a year' },
  { key: 'hr073', label: 'Gloucester County', kind: 'owners', provider: 'hrgeo', fips: '073', market: 'Gloucester', cadence: 'about twice a year' },
  { key: 'nc37139', label: 'Elizabeth City (Pasquotank Co.)', kind: 'owners', provider: 'nc', fips: '37139', market: 'Elizabeth City', cadence: 'when the state refreshes' },
  { key: 'nc37029', label: 'Camden County, NC', kind: 'owners', provider: 'nc', fips: '37029', market: 'Camden', cadence: 'when the state refreshes' },
  { key: 'nc37053', label: 'Currituck County (Moyock)', kind: 'owners', provider: 'nc', fips: '37053', market: 'Moyock', cadence: 'when the state refreshes' },
  { key: 'nc37143', label: 'Perquimans County, NC', kind: 'owners', provider: 'nc', fips: '37143', market: 'Hertford', cadence: 'when the state refreshes' },
  { key: 'nc37041', label: 'Chowan County, NC', kind: 'owners', provider: 'nc', fips: '37041', market: 'Edenton', cadence: 'when the state refreshes' }
];
var WATCH_NOT_AVAILABLE = 'Not available from free public feeds: Chesapeake, Hampton and Poquoson (owner names withheld), Henrico, Chesterfield and Hanover (no public owner/sales feed). Cover those with a cash-buyer export sheet (PropStream, BatchLeads, county records) or DealMachine.';

// ---------- shared helpers ----------

var INSTITUTION_RE = /\b(city of|county of|town of|commonwealth|united states|state of|housing authority|redevelopment|association|assn|church|ministr\w*|baptist|methodist|school board|bank|mortgage|federal national|federal home|fannie|freddie|secretary of|hud|veterans|dept of|department of|electric|dominion|railroad|utilit\w*|habitat for humanity|cemetery|condominium|iglesia|mission|temple|mosque|synagogue|tabernacle|fellowship|diocese|university|college|hospital|land trust|community land)\b/i;

function streetKey_(s) { return lc_(s).replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|circle|cir|way|place|pl)\b/g, '').replace(/[^a-z0-9]/g, '').slice(0, 14); }

/** A real company (LLC, Inc, partners…) — family / living trusts don't count on their own. */
function isCompany_(name) {
  return ENTITY_RE.test(String(name || '').replace(/\b(trusts?|trustees?|revocable|irrevocable|living|family|estate of|life estate)\b/gi, ' '));
}

/**
 * Keeps only investor buyers.
 *   Companies / LLCs: always (unless government, bank, church, HOA…).
 *   Individuals and family trusts (if allowed): not living at the property AND at least one strong signal —
 *     2+ purchases, land / commercial / multi-family, or an out-of-state mailing address.
 *   (A new homeowner's mailing address often still shows their previous home, so "absentee" alone isn't enough.)
 */
function investorFilter_(sales, allowIndividuals, homeState) {
  var groups = {};
  sales.forEach(function (s) {
    if (!str_(s.name) || INSTITUTION_RE.test(s.name)) return;
    if (/government|institution|exempt|non-taxable|ground lease|church|cemetery|utility|right of way|common area/i.test(String(s.type))) return;
    var k = normKey_(s.name);
    (groups[k] = groups[k] || []).push(s);
  });
  var keep = [];
  Object.keys(groups).forEach(function (k) {
    var g = groups[k], name = g[0].name;
    if (isCompany_(name)) { keep = keep.concat(g); return; }
    if (!allowIndividuals) return;
    var absentee = g.every(function (s) {
      if (/land/i.test(String(s.type))) return true; // nobody lives on a vacant lot
      var a = streetKey_(s.addr), m = streetKey_(s.mailStreet || s.mailing);
      return a && m && a !== m;
    });
    if (!absentee) return;
    var mailState = (String(g[0].mailing || '').toUpperCase().match(/,\s*([A-Z]{2})\s*[\d-]*\s*$/) || [])[1];
    var strong = g.length >= 2 || g.some(function (s) { return /land|commercial|multi|apartment|duplex|triplex/i.test(String(s.type)); }) ||
      (mailState && homeState && mailState !== homeState);
    if (strong) keep = keep.concat(g);
  });
  return keep;
}

/** Residential / Commercial / Land from use, zoning and improvement value. */
function propKind_(use, zoning, impValue) {
  var u = lc_(use), z = str_(zoning).toUpperCase();
  if (/vacant|land|\blots?\b|unimproved|acreage|agric|farm|timber/.test(u) || impValue === 0) return 'Vacant Land';
  if (/commerc|business|office|retail|industr|warehouse|apartment|hotel|motel|mixed|shopping|restaurant/.test(u) || /^(B|C|M|I|O|LI|HI|GC|CBD)[-\d]/.test(z)) return 'Commercial';
  return use ? titleCase_(use) : 'Residential';
}

function arcQuery_(url, params) {
  var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  var res = UrlFetchApp.fetch(url + '/query?' + q + '&f=json', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Public records server unavailable (' + res.getResponseCode() + ').');
  var j = JSON.parse(res.getContentText());
  if (j.error) throw new Error('Public records query failed: ' + (j.error.message || JSON.stringify(j.error)));
  return j;
}

function mailing_(street, city, state, zip) {
  return [titleCase_(str_(street)), titleCase_(str_(city)), [str_(state).toUpperCase(), str_(zip)].filter(String).join(' ')].filter(String).join(', ');
}

function hash_(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---------- snapshot storage (private Drive folder) ----------

function owFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('OW_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  var f = rootFolder_().createFolder('Owner snapshots (private)');
  props.setProperty('OW_FOLDER_ID', f.getId());
  return f;
}
function owState_(key) { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('OW_' + key) || '{}'); } catch (e) { return {}; } }
function owSave_(key, st) { PropertiesService.getScriptProperties().setProperty('OW_' + key, JSON.stringify(st)); }
function readJsonFile_(id) { if (!id) return null; try { return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString()); } catch (e) { return null; } }
function writeJsonFile_(id, name, obj) {
  var s = JSON.stringify(obj);
  if (id) { try { DriveApp.getFileById(id).setContent(s); return id; } catch (e) { /* recreate */ } }
  return owFolder_().createFile(name, s, 'application/json').getId();
}

// ---------- provider adapters ----------

var _hrVersions = null;
function owVersion_(src) {
  if (src.provider === 'hrgeo') {
    if (!_hrVersions) {
      _hrVersions = {};
      arcQuery_(HRGEO_URL, { where: '1=1', groupByFieldsForStatistics: 'FIPS', outStatistics: JSON.stringify([{ statisticType: 'max', onStatisticField: 'LASTUPDATE', outStatisticFieldName: 'v' }]) })
        .features.forEach(function (f) { var a = {}; Object.keys(f.attributes).forEach(function (k) { a[k.toLowerCase()] = f.attributes[k]; }); _hrVersions[a.fips] = a.v; });
    }
    return _hrVersions[src.fips] || null;
  }
  if (src.provider === 'nc') {
    var r = arcQuery_(NCONEMAP_URL, { where: "stcntyfips='" + src.fips + "'", outStatistics: JSON.stringify([{ statisticType: 'max', onStatisticField: 'transfdate', outStatisticFieldName: 'v' }]) });
    return r.features && r.features[0] ? r.features[0].attributes.v : null;
  }
  if (src.provider === 'richmond') {
    var res = UrlFetchApp.fetch(src.url + '?f=json', { muteHttpExceptions: true });
    var j = JSON.parse(res.getContentText() || '{}');
    return j.editingInfo ? (j.editingInfo.dataLastEditDate || j.editingInfo.lastEditDate) : null;
  }
  return null;
}

/** One page of parcels after `lastOid`, normalized. */
function owPage_(src, lastOid) {
  var url, where, oid, fields, map;
  if (src.provider === 'hrgeo') {
    url = HRGEO_URL; oid = 'OBJECTID'; where = "FIPS='" + src.fips + "'";
    fields = 'OBJECTID,PARCELID,OWNERNME1,PSTLADDRESS,PSTLCITY,MLADDRESS,MLCITY,MLSTATE,MLZIP5,ZONING,IMPVALUE,TOTVALUE,CALCAREA';
    map = function (a) { return { id: a.PARCELID || a.OBJECTID, owner: a.OWNERNME1, addr: a.PSTLADDRESS, city: a.PSTLCITY || src.market, mail: mailing_(a.MLADDRESS, a.MLCITY, a.MLSTATE, a.MLZIP5), mailStreet: a.MLADDRESS, use: '', zoning: a.ZONING, imp: a.IMPVALUE, value: a.TOTVALUE, acres: a.CALCAREA }; };
  } else if (src.provider === 'nc') {
    url = NCONEMAP_URL; oid = 'objectid'; where = "stcntyfips='" + src.fips + "'";
    fields = 'objectid,parno,ownname,siteadd,scity,mailadd,mcity,mstate,mzip,parusedesc,improvval,parval,gisacres';
    map = function (a) { return { id: a.parno || a.objectid, owner: a.ownname, addr: a.siteadd, city: a.scity || src.market, mail: mailing_(a.mailadd, a.mcity, a.mstate, a.mzip), mailStreet: a.mailadd, use: a.parusedesc, zoning: '', imp: a.improvval, value: a.parval, acres: a.gisacres }; };
  } else {
    url = src.url; oid = 'OBJECTID'; where = '1=1';
    fields = 'OBJECTID,ParcelID,OwnerName,AsrLocationBldgNo,MailAddress,MailCity,MailState,MailZip,PropertyClass,LandUse,LandSqFt,DwellingValue,TotalValue';
    map = function (a) { return { id: a.ParcelID || a.OBJECTID, owner: a.OwnerName, addr: a.AsrLocationBldgNo, city: 'Richmond', mail: mailing_(a.MailAddress, a.MailCity, a.MailState, a.MailZip), mailStreet: a.MailAddress, use: a.LandUse || a.PropertyClass, zoning: '', imp: a.DwellingValue, value: a.TotalValue, acres: a.LandSqFt ? a.LandSqFt / 43560 : '' }; };
  }
  var r = arcQuery_(url, { where: where + ' AND ' + oid + ' > ' + Number(lastOid || 0), outFields: fields, orderByFields: oid + ' ASC', resultRecordCount: OW_PAGE, returnGeometry: 'false' });
  var feats = r.features || [];
  return {
    rows: feats.map(function (f) {
      var x = map(f.attributes);
      x.oid = f.attributes[oid];
      x.owner = str_(x.owner).replace(/\s*[\/&]\s*$/, '').replace(/\s+\/\s*/g, ' & ').trim();
      x.addr = str_(x.addr).replace(/^0+\s+/, '').replace(/^0+(\d)/, '$1');
      if (!/[a-z]/i.test(x.addr)) x.addr = '';
      if (!/[a-z]/i.test(str_(x.city))) x.city = src.market;
      return x;
    }),
    more: feats.length >= OW_PAGE || !!r.exceededTransferLimit,
    lastOid: feats.length ? feats[feats.length - 1].attributes[oid] : lastOid
  };
}

// ---------- sources ----------

/** York County live sales: buyer, mailing address, date, price, use, acreage. */
function yorkSales_(src, ctx, s) {
  var days = Math.max(1, parseInt(s.INTAKE_WATCH_DAYS, 10) || 45);
  var minPrice = Number(num_(s.INTAKE_WATCH_MIN_PRICE)) || 0;
  var since = fmtDate_(new Date(Date.now() - days * 86400000), 'yyyy-MM-dd');
  var r = arcQuery_(src.url, {
    where: "transferDate >= DATE '" + since + "' AND consideration >= " + minPrice,
    outFields: 'PID,GPIN,ownerName,ownerAddress1,ownerCity,ownerState,ownerZip,ADDRESS,transferDate,consideration,useDescription,classType,tablzone_DESC,currImprovementVal,legalAcres,GISacres',
    orderByFields: 'transferDate DESC', resultRecordCount: 2000, returnGeometry: 'false'
  });
  var allowInd = bool_(s.INTAKE_WATCH_INDIVIDUALS), sales = [], seen = 0;
  // Bulk deeds repeat the TOTAL price on every parcel: split it evenly across the parcels in that deed.
  var bulk = {};
  (r.features || []).forEach(function (f) { var a = f.attributes; var k = normKey_(a.ownerName) + '|' + a.transferDate + '|' + a.consideration; bulk[k] = (bulk[k] || 0) + 1; });
  (r.features || []).forEach(function (f) {
    var a = f.attributes;
    seen++;
    var nParcels = bulk[normKey_(a.ownerName) + '|' + a.transferDate + '|' + a.consideration] || 1;
    var d = a.transferDate ? new Date(a.transferDate) : null;
    var ref = 'YRK:' + (a.PID || a.GPIN) + ':' + (d ? fmtDate_(d) : '');
    if (ctx.refs[ref]) return;
    sales.push({
      name: a.ownerName, email: '', phone: '', mailing: mailing_(a.ownerAddress1, a.ownerCity, a.ownerState, a.ownerZip),
      addr: a.ADDRESS, mailStreet: a.ownerAddress1, city: src.market, state: 'VA', date: d, price: Number(a.consideration) ? Math.round(Number(a.consideration) / nParcels) : '',
      type: propKind_(a.useDescription || a.classType, a.tablzone_DESC, a.currImprovementVal), financing: '', saleRef: ref
    });
  });
  var logged = ledgerAdd_(ctx, sales, INTAKE_SOURCES.watch.label);
  return { note: seen + ' recorded sales in ' + days + ' days · ' + logged + ' new investor purchases logged', done: true };
}

/** Owner-change watch for one locality (resumable across runs). */
function ownerWatchStep_(src, ctx, s, deadline) {
  var st = owState_(src.key);
  var v = owVersion_(src);
  if (!v) return { note: 'no data version available', done: true };
  if (!st.scan) {
    if (st.version === v) return { note: 'up to date (data from ' + fmtDate_(new Date(v), 'MMM d, yyyy') + ')', done: true };
    st.scan = { version: v, lastOid: 0, tmp: '', found: 0 };
  }
  var old = st.snap ? readJsonFile_(st.snap) : null; // null → first time: build a baseline only
  var next = st.scan.tmp ? (readJsonFile_(st.scan.tmp) || {}) : {};
  var allowInd = bool_(s.INTAKE_WATCH_INDIVIDUALS), sales = [];
  var more = true, pages = 0;
  while (more && (pages === 0 || Date.now() < deadline)) {
    var pg = owPage_(src, st.scan.lastOid);
    pages++;
    pg.rows.forEach(function (row) {
      var key = row.owner ? hash_(normKey_(row.owner)) : '';
      var prev = old ? old[row.id] : undefined;
      next[row.id] = key;
      if (!old || prev === undefined || !key || prev === key) return;
      var ref = 'OW:' + src.key + ':' + row.id + ':' + st.scan.version;
      if (ctx.refs[ref]) return;
      sales.push({
        name: row.owner, email: '', phone: '', mailing: row.mail, mailStreet: row.mailStreet, addr: row.addr, city: row.city, state: src.provider === 'nc' ? 'NC' : 'VA',
        date: null, price: '', type: propKind_(row.use, row.zoning, row.imp), financing: '', saleRef: ref,
        acres: row.acres, value: row.value
      });
    });
    st.scan.lastOid = pg.lastOid;
    more = pg.more;
  }
  var periodDays = st.version ? Math.max(1, Math.round((Number(st.scan.version) - Number(st.version)) / 86400000)) : 0;
  if (sales.length) {
    sales.forEach(function (x) { x.periodDays = periodDays; x.date = new Date(Number(st.scan.version)); });
    st.scan.found += ledgerAdd_(ctx, sales, INTAKE_SOURCES.watch.label);
  }
  if (more) {
    st.scan.tmp = writeJsonFile_(st.scan.tmp, 'scan-' + src.key + '.json', next);
    owSave_(src.key, st);
    return { note: 'scanning… (' + Object.keys(next).length.toLocaleString() + ' parcels so far)', done: false };
  }
  var baseline = !old;
  st.snap = writeJsonFile_(st.snap, 'snapshot-' + src.key + '.json', next);
  if (st.scan.tmp) { try { DriveApp.getFileById(st.scan.tmp).setTrashed(true); } catch (e) { /* ignore */ } }
  st.lastChanges = baseline ? 0 : st.scan.found;
  st.version = st.scan.version;
  st.parcels = Object.keys(next).length;
  st.lastScan = new Date().toISOString();
  if (baseline) st.baselineAt = st.lastScan;
  st.scan = null;
  owSave_(src.key, st);
  return { note: baseline ? 'baseline saved (' + st.parcels.toLocaleString() + ' parcels) — buyers appear when the data next updates' : st.lastChanges + ' investor purchases logged (data ' + fmtDate_(new Date(Number(st.version)), 'MMM d, yyyy') + ')', done: true };
}

function watchAreas_() {
  var chosen = list_(getSettings_().INTAKE_WATCH_AREAS);
  return WATCH_SOURCES.filter(function (w) { return !chosen.length || chosen.indexOf(w.key) > -1; });
}

/** Intake runner: works through every chosen area within a time budget; continues later if needed. */
function watchLeads_(ctx, budgetMs) {
  var s = getSettings_(), deadline = Date.now() + (budgetMs || 150000), notes = [], pending = false;
  _hrVersions = null;
  watchAreas_().forEach(function (src) {
    if (Date.now() > deadline) { pending = true; return; }
    try {
      var r = src.kind === 'sales' ? yorkSales_(src, ctx, s) : ownerWatchStep_(src, ctx, s, deadline);
      if (!r.done) pending = true;
      notes.push(src.label + ': ' + r.note);
      var st = owState_(src.key); st.lastNote = r.note; st.lastChecked = new Date().toISOString(); owSave_(src.key, st);
    } catch (e) {
      notes.push(src.label + ': ' + String(e.message || e));
      var st2 = owState_(src.key); st2.lastNote = 'error — ' + String(e.message || e).slice(0, 140); st2.lastChecked = new Date().toISOString(); owSave_(src.key, st2);
    }
  });
  if (pending) scheduleOwnerWatch_();
  return notes.join(' · ');
}

function scheduleOwnerWatch_() {
  if (!hasTrigger_('runOwnerWatch')) ScriptApp.newTrigger('runOwnerWatch').timeBased().after(60 * 1000).create();
}

/** Trigger: continues long first-time scans (large cities take a few runs). */
function runOwnerWatch() {
  deleteTriggers_('runOwnerWatch');
  return withLock_(function () {
    var ctx = intakeCtx_();
    ctx.cur = { added: 0, updated: 0, duplicate: 0, skipped: 0 };
    var note = watchLeads_(ctx, 270000);
    ledgerPromote_(ctx);
    flushIntake_(ctx);
    return { note: note, added: ctx.adds.length };
  });
}

function watchStatus_() {
  var chosen = list_(getSettings_().INTAKE_WATCH_AREAS);
  return {
    areas: WATCH_SOURCES.map(function (w) {
      var st = owState_(w.key);
      return {
        key: w.key, label: w.label, kind: w.kind, cadence: w.cadence || 'daily', on: !chosen.length || chosen.indexOf(w.key) > -1,
        dataDate: st.version ? fmtDate_(new Date(Number(st.version)), 'MMM d, yyyy') : '', baselineAt: st.baselineAt || '', scanning: !!st.scan,
        lastNote: st.lastNote || '', lastChecked: st.lastChecked || '', parcels: st.parcels || 0
      };
    }),
    notAvailable: WATCH_NOT_AVAILABLE
  };
}
