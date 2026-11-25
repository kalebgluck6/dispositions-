/**
 * Public-records buyer finder tests: York live sales + owner-change watch + the
 * "serious investors only" purchase ledger (3+ purchases in 90 days by default).
 * Simulated ArcGIS responses shaped like the real services.   Run:  node tools/test-records.js
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
// default is now 2 purchases in 90 days; a spreadsheet still on the old default of 3 moves to 2 once
assert.strictEqual(g.getSettings().values.INTAKE_ACTIVE_MIN_BUYS, '2');
g.PropertiesService.getScriptProperties().deleteProperty('ACTIVE_MIN_2');
g.saveSettings({ INTAKE_ACTIVE_MIN_BUYS: '3' });
g.ledgerMinBuysUpdate_();
assert.strictEqual(g.getSettings().values.INTAKE_ACTIVE_MIN_BUYS, '2', 'old default of 3 moved to 2');
g.saveSettings({ INTAKE_ACTIVE_MIN_BUYS: '3' });   // the scenarios below were written for 3; a value you choose is kept
g.ledgerMinBuysUpdate_();
assert.strictEqual(g.getSettings().values.INTAKE_ACTIVE_MIN_BUYS, '3', 'only changed once');
g.saveSettings({ INTAKE_FORM_ON: 'FALSE', INTAKE_GMAIL_ON: 'FALSE', INTAKE_COUNTY_ON: 'FALSE', INTAKE_DM_ON: 'FALSE', INTAKE_WATCH_AREAS: 'york, richmond, hr800, nc37139' });

const day = 86400000, now = Date.now();
const Y = (pid, owner, mail, city, st, addr, daysAgo, price, use, imp) => ({ PID: pid, ownerName: owner, ownerAddress1: mail, ownerCity: city, ownerState: st, ownerZip: '00000', ADDRESS: addr, transferDate: now - daysAgo * day, consideration: price, useDescription: use, tablzone_DESC: '', currImprovementVal: imp });
const york = [
  Y(1, 'STANLEY MARTIN HOMES LLC', '11710 PLAZA AMERICA DR', 'RESTON', 'VA', '102 MASTERS LN', 5, 600000, 'Vacant Residential', 0),
  Y(2, 'STANLEY MARTIN HOMES LLC', '11710 PLAZA AMERICA DR', 'RESTON', 'VA', '104 MASTERS LN', 5, 600000, 'Vacant Residential', 0),
  Y(3, 'STANLEY MARTIN HOMES LLC', '11710 PLAZA AMERICA DR', 'RESTON', 'VA', '106 MASTERS LN', 5, 600000, 'Vacant Residential', 0),
  Y(4, 'GRISTMILL PLAZA LLC', '2110 DULLES TOWN CIR', 'DULLES', 'VA', '100 GRISTMILL PLZ', 9, 2650000, 'Commercial', 1500000),
  Y(5, 'DODGE GRANT & BROOK', '214 GREENLAND DR', 'YORKTOWN', 'VA', '214 GREENLAND DR', 10, 343000, 'Single Family', 250000),
  Y(6, 'AKINS SUSAN L TRUSTEE', '308 TIMBERLINE LOOP', 'YORKTOWN', 'VA', '308 TIMBERLINE LOOP', 12, 345000, 'Townhouse', 200000),
  Y(7, 'COUNTY OF YORK', 'PO BOX 532', 'YORKTOWN', 'VA', '1 MAIN ST', 3, 90000, 'Exempt', 0),
  Y(8, 'RIVERA JOSE', '55 PALM DR', 'MIAMI', 'FL', '9 OAK ST', 4, 210000, 'Single Family', 150000),
  Y(9, 'RIVERA JOSE', '55 PALM DR', 'MIAMI', 'FL', '11 OAK ST', 40, 195000, 'Single Family', 150000),
  Y(10, 'TIDEWATER FLIPS LLC', '9 BAY DR', 'NORFOLK', 'VA', '1 ELM ST', 200, 150000, 'Single Family', 100000), // older purchases: far apart
  Y(11, 'TIDEWATER FLIPS LLC', '9 BAY DR', 'NORFOLK', 'VA', '2 ELM ST', 20, 150000, 'Single Family', 100000)
];
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
  if (path.includes('yorkcounty.gov')) return { code: 200, body: { features: york.filter(a => a.transferDate >= Date.parse((p.where.match(/DATE '([\d-]+)'/) || [])[1])).map(a => ({ attributes: a })) } };
  if (path.includes('k3vhq11XkBNeeOfM')) {
    if (!path.endsWith('/query')) return { code: 200, body: { editingInfo: { lastEditDate: rva.version, dataLastEditDate: rva.version } } };
    return { code: 200, body: page(rva.rows, 'OBJECTID', p) };
  }
  if (path.includes('geo.hrsd.com')) {
    if (p.outStatistics) return { code: 200, body: { features: [{ attributes: { FIPS: '800', v: hr.version } }] } };
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
const ledger = () => g.readTable_('Purchase Ledger').rows;

// Upgrading from the version before the ledger: every York sale was already seen by an earlier run,
// and Stanley Martin was archived by the one-time cleanup with a single purchase.
g.appendObjects_('Buyer Intake Log', york.map(y => ({ id: 'B-old' + y.PID, received: new Date(now - 2 * day), source: 'old run', name: y.ownerName, result: 'Added — pending review', ref: 'YRK:' + y.PID + ':' + g.fmtDate_(new Date(y.transferDate)) })));
g.appendObjects_('Investors', [{ id: 'INV-00900', company: 'Stanley Martin Homes LLC', status: 'Inactive', source: 'Public records (Hampton Roads, Richmond, NC)', purchaseCount: 1, purchases: '102 Masters Ln, Yorktown — $200,000 · land (Nov 20, 2026)', notes: 'Bought 1 property. [Archived Nov 20, 2026: fewer than 3 purchases — not an active investor yet]' }]);
g.PropertiesService.getScriptProperties().setProperty('LEDGER_MIGRATED', 'x');

step('serious investors only: York buyer with 3 lots in 90 days is added; one-off buyers are only logged', () => {
  const r = g.runBuyerIntake();
  assert.strictEqual(r.results.watch.status, 'ok', JSON.stringify(r.results.watch));
  assert(ledger().length >= 7, 'sales seen by earlier runs still count toward the 3-purchase rule: ' + ledger().length);
  assert(/3\+ purchases in 90 days/.test(r.results.active.note), r.results.active.note);
  const sm = by(/Stanley Martin/);
  assert(sm, 'builder with 3 purchases added'); assert.strictEqual(sm.purchaseCount, 3);
  assert(/\$200,000 · land/.test(sm.purchases), 'bulk $600,000 deed split across 3 lots: ' + sm.purchases);
  assert(/Developer/.test(sm.categories)); assert.strictEqual(sm.propertyTypes, 'Land');
  assert(/^New-construction \/ land buyer\. Active investor — 3 purchases/.test(sm.criteria), sm.criteria);
  assert(!/Archived/.test(sm.notes), 'archived buyer reopened for review: ' + sm.notes);
  assert.strictEqual(g.listInvestors().filter(i => /Stanley Martin/.test(i.company)).length, 1, 'reopened, not duplicated');
  assert(/1 archived buyers reopened/.test(r.results.active.note) && r.results.active.added >= 1, JSON.stringify(r.results.active));
  assert.strictEqual(sm.mailingAddress, '11710 Plaza America Dr, Reston, VA 00000');
  assert(/^10[246] Masters Ln, Yorktown, VA$/.test(sm.lastPurchaseAddress), 'property address kept for skip tracing: ' + sm.lastPurchaseAddress);
  ['Gristmill', 'Rivera', 'Tidewater'].forEach(n => assert(!by(new RegExp(n)), n + ' not active enough yet'));
  const owners = ledger().map(x => x.owner);
  assert(owners.includes('Gristmill Plaza LLC') && owners.includes('Rivera Jose'), 'investor purchases logged for later');
  ['Dodge', 'Akins', 'County Of York'].forEach(n => assert(!owners.some(o => o.includes(n)), n + ' never logged (homeowner / family trust / government)'));
  assert.strictEqual(ledger().filter(x => x.owner === 'Tidewater Flips LLC').length, 1, '200-day-old sale outside the 90-day lookback');
});

step('a logged buyer graduates once they make enough purchases; history keeps growing after', () => {
  york.push(Y(12, 'RIVERA JOSE', '55 PALM DR', 'MIAMI', 'FL', '15 OAK ST', 1, 205000, 'Single Family', 150000));
  g.runBuyerIntake();
  const rv = by(/Rivera/);
  assert(rv, 'third purchase within 90 days → added'); assert.strictEqual(rv.purchaseCount, 3);
  assert.strictEqual(rv.mailingAddress, '55 Palm Dr, Miami, FL 00000');
  york.push(Y(13, 'STANLEY MARTIN HOMES LLC', '11710 PLAZA AMERICA DR', 'RESTON', 'VA', '108 MASTERS LN', 0, 210000, 'Vacant Residential', 0));
  const r = g.runBuyerIntake();
  assert.strictEqual(r.results.active.updated, 1, JSON.stringify(r.results.active));
  assert.strictEqual(by(/Stanley Martin/).purchaseCount, 4);
  assert.strictEqual(g.runBuyerIntake().results.active.added + g.runBuyerIntake().results.active.updated, 0, 'nothing re-processed');
});

step('owner-change watch: baseline first, then buyers with enough purchases for the refresh period', () => {
  while (g.owState_('richmond').scan) g.runOwnerWatch();
  assert.strictEqual(g.owState_('richmond').parcels, 2500);
  assert.strictEqual(M.files[g.owState_('hr800').snap].sharing, 'PRIVATE', 'snapshots never shared');
  // Suffolk refresh after ~198 days → needs ceil(3 × 198 / 90) = 7 purchases
  hr.version = now - 2 * day;
  for (let i = 0; i < 7; i++) { hr.rows[i].OWNERNME1 = 'COASTAL FLIPS LLC'; hr.rows[i].MLADDRESS = '9 BAY DR'; hr.rows[i].MLCITY = 'NORFOLK'; }
  hr.rows[10].OWNERNME1 = 'BUILDRIGHT DEVELOPMENT LLC'; hr.rows[10].IMPVALUE = 0;   // 1 lot → only logged
  hr.rows[11].OWNERNME1 = 'FIRST NATIONAL BANK';                                    // REO → never logged
  hr.rows[12].OWNERNME1 = 'SUFFOLK OWNER 13 /';                                     // formatting only → not a change
  // Richmond refresh after 9 days → needs 3
  rva.version = now - 1 * day;
  [99, 199, 299].forEach(i => { rva.rows[i].OwnerName = 'RVA RENTALS LLC'; rva.rows[i].MailAddress = '500 E MAIN ST'; });
  rva.rows[399].OwnerName = 'BROAD ST RETAIL LLC'; rva.rows[399].LandUse = 'Commercial Retail';
  rva.rows[499].OwnerName = 'GRACE CHURCH OF RICHMOND';
  // Elizabeth City refresh after 99 days → needs 4
  nc.version = now - 1 * day;
  [2, 3, 4, 5].forEach(i => { nc.rows[i].ownname = 'ALBEMARLE LAND CO LLC'; nc.rows[i].improvval = 0; nc.rows[i].mailadd = 'PO BOX 9'; });
  g.runBuyerIntake();
  while (g.owState_('richmond').scan) g.runOwnerWatch();
  const cf = by(/Coastal Flips/);
  assert(cf && cf.purchaseCount === 7 && cf.markets === 'Suffolk' && cf.mailingAddress === '9 Bay Dr, Norfolk, VA 23434', JSON.stringify(cf && [cf.purchaseCount, cf.markets, cf.mailingAddress]));
  assert(by(/Rva Rentals/), 'Richmond LLC with 3 purchases'); assert.strictEqual(by(/Rva Rentals/).purchaseCount, 3);
  const al = by(/Albemarle Land/); assert(al && al.markets === 'Elizabeth City' && /Developer/.test(al.categories));
  assert(/103 Pearl St/.test(al.purchases), 'NC zero-padded address cleaned: ' + al.purchases);
  assert(/Pearl St, Elizabeth City, NC$/.test(al.lastPurchaseAddress), al.lastPurchaseAddress);
  ['Buildright', 'Broad St Retail', 'First National', 'Grace Church', 'Suffolk Owner 13'].forEach(n => assert(!by(new RegExp(n, 'i')), n));
  assert(ledger().some(x => /Buildright/.test(x.owner)) && ledger().some(x => /Broad St Retail/.test(x.owner)), 'one-offs logged for later');
  assert(!ledger().some(x => /Bank|Church/.test(x.owner)));
});

step('lowering the bar promotes logged buyers; legacy one-off buyers were archived once', () => {
  g.saveSettings({ INTAKE_ACTIVE_MIN_BUYS: '1' });
  g.runBuyerIntake();
  assert(by(/Gristmill/) && /Commercial/.test(by(/Gristmill/).categories));
  assert(by(/Broad St Retail/), 'Richmond 9-day refresh: 1 purchase now enough');
  assert(!by(/Buildright/), 'Suffolk 198-day batch still needs ceil(1×198/90)=3 lots');
  assert(g.ledgerStatus_().purchases > 20);
  g.saveSettings({ INTAKE_ACTIVE_MIN_BUYS: '3' });
});

step('area list (15 areas) + status payload', () => {
  g.saveSettings({ INTAKE_WATCH_AREAS: 'york, nonsense, hr830, nc37041' });
  assert.strictEqual(g.getSettings().values.INTAKE_WATCH_AREAS, 'york, hr830, nc37041');
  const st = g.getIntakeStatus();
  assert.strictEqual(st.watch.areas.length, 15);
  ['Williamsburg', 'James City County', 'Gloucester County', 'Currituck County (Moyock)', 'Perquimans County, NC', 'Chowan County, NC'].forEach(l => assert(st.watch.areas.some(a => a.label === l), l));
  assert(/Henrico, Chesterfield and Hanover/.test(st.watch.notAvailable));
  assert.strictEqual(st.ledger.minBuys, 3);
  JSON.stringify(st);
  assert(!M.isLocked());
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : '') + '\n');
