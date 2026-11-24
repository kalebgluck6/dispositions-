/**
 * Public-records buyer finder tests (York live sales + owner-change watch), using simulated
 * ArcGIS responses shaped like the real services.   Run:  node tools/test-records.js
 */
const assert = require('assert');
const load = require('./load');
const g = load();
const M = g.__GAS_MOCK__;
let passed = 0;
const step = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e.stack || e)); process.exitCode = 1; }
};
console.log('\nSameDayInvestments — public records tests\n');
g.setup();
g.saveSettings({ INTAKE_FORM_ON: 'FALSE', INTAKE_GMAIL_ON: 'FALSE', INTAKE_COUNTY_ON: 'FALSE', INTAKE_DM_ON: 'FALSE', INTAKE_WATCH_AREAS: 'york, richmond, hr800, nc37139' });

const day = 86400000, now = Date.now();
const york = [
  { PID: 1, ownerName: 'STANLEY MARTIN HOMES LLC', ownerAddress1: '11710 PLAZA AMERICA DR', ownerCity: 'RESTON', ownerState: 'VA', ownerZip: '20190', ADDRESS: '102 MASTERS LN', transferDate: now - 5 * day, consideration: 600000, useDescription: 'Vacant Residential', tablzone_DESC: 'Single Family', currImprovementVal: 0 },
  { PID: 2, ownerName: 'STANLEY MARTIN HOMES LLC', ownerAddress1: '11710 PLAZA AMERICA DR', ownerCity: 'RESTON', ownerState: 'VA', ownerZip: '20190', ADDRESS: '104 MASTERS LN', transferDate: now - 5 * day, consideration: 600000, useDescription: 'Vacant Residential', tablzone_DESC: 'Single Family', currImprovementVal: 0 },
  { PID: 3, ownerName: 'STANLEY MARTIN HOMES LLC', ownerAddress1: '11710 PLAZA AMERICA DR', ownerCity: 'RESTON', ownerState: 'VA', ownerZip: '20190', ADDRESS: '106 MASTERS LN', transferDate: now - 5 * day, consideration: 600000, useDescription: 'Vacant Residential', tablzone_DESC: 'Single Family', currImprovementVal: 0 },
  { PID: 4, ownerName: 'GRISTMILL PLAZA LLC', ownerAddress1: '2110 DULLES TOWN CIR', ownerCity: 'DULLES', ownerState: 'VA', ownerZip: '20166', ADDRESS: '100 GRISTMILL PLZ', transferDate: now - 9 * day, consideration: 2650000, useDescription: 'Commercial', tablzone_DESC: 'General Business', currImprovementVal: 1500000 },
  { PID: 5, ownerName: 'DODGE GRANT & BROOK', ownerAddress1: '219 JETHRO LN', ownerCity: 'YORKTOWN', ownerState: 'VA', ownerZip: '23692', ADDRESS: '214 GREENLAND DR', transferDate: now - 10 * day, consideration: 343000, useDescription: 'Single Family', tablzone_DESC: 'Single Family', currImprovementVal: 250000 },
  { PID: 6, ownerName: 'AKINS SUSAN L TRUSTEE', ownerAddress1: '308 TIMBERLINE LOOP', ownerCity: 'YORKTOWN', ownerState: 'VA', ownerZip: '23692', ADDRESS: '308 TIMBERLINE LOOP', transferDate: now - 12 * day, consideration: 345000, useDescription: 'Townhouse', tablzone_DESC: 'Res', currImprovementVal: 200000 },
  { PID: 7, ownerName: 'COUNTY OF YORK', ownerAddress1: 'PO BOX 532', ownerCity: 'YORKTOWN', ownerState: 'VA', ownerZip: '23690', ADDRESS: '1 MAIN ST', transferDate: now - 3 * day, consideration: 90000, useDescription: 'Exempt', tablzone_DESC: '', currImprovementVal: 0 },
  { PID: 8, ownerName: 'RIVERA JOSE', ownerAddress1: '55 PALM DR', ownerCity: 'MIAMI', ownerState: 'FL', ownerZip: '33101', ADDRESS: '9 OAK ST', transferDate: now - 4 * day, consideration: 210000, useDescription: 'Single Family', tablzone_DESC: 'Res', currImprovementVal: 150000 }
];
// owner-watch datasets: [version, rows]
let rva = { version: now - 10 * day, rows: [] }, hr = { version: now - 200 * day, rows: [] }, nc = { version: now - 100 * day, rows: [] };
for (let i = 1; i <= 2500; i++) rva.rows.push({ OBJECTID: i, ParcelID: i, OwnerName: 'OWNER ' + i, AsrLocationBldgNo: String(i), MailAddress: i + ' MAIN ST', MailCity: 'RICHMOND', MailState: 'VA', MailZip: '23220', LandUse: 'Single Family', DwellingValue: 100000, TotalValue: 150000 });
for (let i = 1; i <= 30; i++) hr.rows.push({ OBJECTID: 1000 + i, PARCELID: 'S' + i, OWNERNME1: 'SUFFOLK OWNER ' + i + ' /', PSTLADDRESS: i + ' ELM ST', PSTLCITY: 'Suffolk', MLADDRESS: i + ' ELM ST', MLCITY: 'SUFFOLK', MLSTATE: 'VA', MLZIP5: '23434', ZONING: 'R-1', IMPVALUE: 100000, TOTVALUE: 150000 });
for (let i = 1; i <= 10; i++) nc.rows.push({ objectid: i, parno: 'P' + i, ownname: 'NC OWNER ' + i, siteadd: '00' + (100 + i) + ' PEARL ST', scity: 'ELIZABETH CITY', mailadd: '00' + (100 + i) + ' PEARL ST', mcity: 'ELIZABETH CITY', mstate: 'NC', mzip: '27909', parusedesc: 'Residential', improvval: 90000, parval: 100000 });

const parse = (url) => { const u = new URL(url); const p = {}; u.searchParams.forEach((v, k) => p[k] = v); return { path: u.origin + u.pathname, p }; };
const page = (rows, oidField, p) => {
  const gt = Number((p.where.match(/>\s*(\d+)/) || [])[1] || 0);
  const all = rows.filter(r => r[oidField] > gt).sort((a, b) => a[oidField] - b[oidField]);
  const n = Number(p.resultRecordCount || 2000);
  return { features: all.slice(0, n).map(a => ({ attributes: a })), exceededTransferLimit: all.length > n };
};
M.fetchHandler = (url) => {
  const { path, p } = parse(url);
  if (path.includes('yorkcounty.gov')) return { code: 200, body: { features: york.map(a => ({ attributes: a })) } };
  if (path.includes('k3vhq11XkBNeeOfM')) {
    if (!path.endsWith('/query')) return { code: 200, body: { editingInfo: { lastEditDate: rva.version, dataLastEditDate: rva.version } } };
    return { code: 200, body: page(rva.rows, 'OBJECTID', p) };
  }
  if (path.includes('geo.hrsd.com')) {
    if (p.outStatistics) return { code: 200, body: { features: [{ attributes: { FIPS: '800', v: hr.version } }, { attributes: { FIPS: '810', v: hr.version } }] } };
    return { code: 200, body: page(hr.rows, 'OBJECTID', p) };
  }
  if (path.includes('nconemap.gov')) {
    if (p.outStatistics) return { code: 200, body: { features: [{ attributes: { v: nc.version } }] } };
    return { code: 200, body: page(nc.rows, 'objectid', p) };
  }
  return { code: 404, body: '{}' };
};
const pending = () => g.listInvestors().filter(i => i.status === 'Pending Review');
const by = (re) => pending().find(i => re.test(i.company || (i.firstName + ' ' + i.lastName)));

step('York live sales: investors kept, homeowners / family trusts / government skipped, bulk deeds split', () => {
  const r = g.runBuyerIntake();
  assert.strictEqual(r.results.watch.status, 'ok', JSON.stringify(r.results.watch));
  const sm = by(/Stanley Martin/);
  assert(sm, 'builder found'); assert.strictEqual(sm.purchaseCount, 3);
  assert(/\$200,000 · land/.test(sm.purchases), 'bulk $600,000 split across 3 lots: ' + sm.purchases);
  assert(/Developer/.test(sm.categories)); assert.strictEqual(sm.propertyTypes, 'Land');
  assert.strictEqual(sm.mailingAddress, '11710 Plaza America Dr, Reston, VA 20190');
  const gp = by(/Gristmill/);
  assert(/Commercial/.test(gp.categories) && gp.propertyTypes === 'Commercial', gp.categories + ' ' + gp.propertyTypes);
  assert(by(/Rivera/), 'out-of-state individual investor kept');
  assert(!by(/Dodge/), 'local homebuyer skipped');
  assert(!by(/Akins/), 'owner-occupied family trust skipped');
  assert(!by(/County Of York/i), 'government skipped');
});

step('owner-change watch: first run saves a private baseline (resumable for big cities), no buyers yet', () => {
  const before = pending().length;
  const st = g.watchStatus_();
  const rv = st.areas.find(a => a.key === 'richmond');
  assert(/baseline saved \(2,500 parcels\)/.test(rv.lastNote) || /scanning/.test(rv.lastNote), rv.lastNote);
  while (g.owState_('richmond').scan) g.runOwnerWatch();
  assert.strictEqual(g.owState_('richmond').parcels, 2500);
  assert(/baseline saved \(30 parcels\)/.test(st.areas.find(a => a.key === 'hr800').lastNote));
  assert(/baseline saved \(10 parcels\)/.test(st.areas.find(a => a.key === 'nc37139').lastNote));
  const snapFile = M.files[g.owState_('hr800').snap];
  assert.strictEqual(snapFile.sharing, 'PRIVATE', 'snapshots never shared');
  assert.strictEqual(pending().length, before);
  assert.strictEqual(g.runBuyerIntake().results.watch.added, 0, 'nothing new while data unchanged');
});

step('when a locality refreshes, new investor owners become buyers (residential, commercial, land)', () => {
  hr.version = now - 2 * day;
  hr.rows[0].OWNERNME1 = 'COASTAL FLIPS LLC'; hr.rows[0].MLADDRESS = '9 BAY DR'; hr.rows[0].MLCITY = 'NORFOLK';
  hr.rows[1].OWNERNME1 = 'NEW FAMILY HOMEOWNERS'; // moved in: mailing = property → skipped
  hr.rows[2].OWNERNME1 = 'BUILDRIGHT DEVELOPMENT LLC'; hr.rows[2].IMPVALUE = 0; hr.rows[2].MLADDRESS = '1 OFFICE PARK';
  hr.rows[3].OWNERNME1 = 'FIRST NATIONAL BANK'; // REO → skipped
  hr.rows[4].OWNERNME1 = 'SUFFOLK OWNER 5 /'; // same owner, cosmetic slash → not a change
  rva.version = now - 1 * day;
  rva.rows[99].OwnerName = 'RVA RENTALS LLC'; rva.rows[99].MailAddress = '500 E MAIN ST';
  rva.rows[199].OwnerName = 'BROAD ST RETAIL LLC'; rva.rows[199].LandUse = 'Commercial Retail'; rva.rows[199].MailAddress = '1 PLAZA';
  rva.rows[299].OwnerName = 'GRACE CHURCH OF RICHMOND';
  nc.version = now - 1 * day;
  nc.rows[2].ownname = 'ALBEMARLE LAND CO LLC'; nc.rows[2].improvval = 0; nc.rows[2].mailadd = 'PO BOX 9';
  const r = g.runBuyerIntake();
  while (g.owState_('richmond').scan) g.runOwnerWatch();
  assert.strictEqual(r.results.watch.status, 'ok', JSON.stringify(r.results.watch));
  const cf = by(/Coastal Flips/);
  assert(cf && cf.markets === 'Suffolk' && cf.mailingAddress === '9 Bay Dr, Norfolk, VA 23434', JSON.stringify(cf));
  assert(/Ownership changed in Suffolk public records/.test(cf.notes));
  const br = by(/Buildright/); assert(br && /Developer/.test(br.categories) && br.propertyTypes === 'Land');
  assert(!by(/New Family/), 'homeowner skipped'); assert(!by(/First National Bank/), 'bank skipped');
  assert(!pending().some(i => /Suffolk Owner 5/i.test(i.company || i.firstName + ' ' + i.lastName)), 'formatting-only change ignored');
  assert(by(/Rva Rentals/)); assert(/Commercial/.test(by(/Broad St Retail/).categories)); assert(!by(/Grace Church/), 'church skipped');
  const al = by(/Albemarle Land/); assert(al && al.markets === 'Elizabeth City' && /Developer/.test(al.categories));
  assert(/103 Pearl St/.test(al.purchases), 'NC zero-padded address cleaned: ' + al.purchases);
  const again = g.runBuyerIntake();
  assert.strictEqual(again.results.watch.added + again.results.watch.updated, 0, 'each change reported once');
});

step('area selection + status for the screen; payload serializable', () => {
  g.saveSettings({ INTAKE_WATCH_AREAS: 'york, nonsense, hr810' });
  assert.strictEqual(g.getSettings().values.INTAKE_WATCH_AREAS, 'york, hr810');
  const st = g.getIntakeStatus().watch;
  assert.strictEqual(st.areas.length, 9);
  assert.strictEqual(st.areas.filter(a => a.on).length, 2);
  assert(/Chesapeake, Hampton, Poquoson and Moyock/.test(st.notAvailable));
  JSON.stringify(st);
  assert(!M.isLocked());
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : '') + '\n');
