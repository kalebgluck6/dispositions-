/**
 * Automatic skip trace tests (BatchData v3 Property Skip Trace, simulated with the documented
 * request / response shapes).   Run:  node tools/test-skiptrace.js
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
console.log('\nSameDayInvestments — skip trace tests\n');
g.setup();
g.saveSettings({ INTAKE_FORM_ON: 'FALSE', INTAKE_GMAIL_ON: 'FALSE', INTAKE_COUNTY_ON: 'FALSE', INTAKE_DM_ON: 'FALSE', INTAKE_WATCH_ON: 'FALSE' });

const KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const calls = [];
// BatchData's directory, keyed by street
const people = {
  '102 Masters Ln': { persons: [{ propertyOwner: true, name: { first: 'Dana', last: 'Reyes', full: 'Dana Reyes' }, litigator: false,
    emails: [{ rank: 2, email: 'dana.old@yahoo.com', tested: false }, { rank: 1, email: 'Dana@StanleyBuilds.com', tested: true }],
    phones: [{ rank: 1, number: '7575550101', type: 'Land Line', dnc: false, tcpa: false, reachable: true },
      { rank: 2, number: '7575550102', type: 'Mobile', dnc: false, tcpa: false, reachable: true },
      { rank: 3, number: '7575550103', type: 'Mobile', dnc: false, tcpa: true, reachable: true }] }] },
  '500 E Main St': { persons: [{ propertyOwner: false, name: { first: 'Sam', last: 'Ortiz', full: 'Sam Ortiz' }, litigator: true,
    emails: [{ rank: 1, email: 'sam@rvarentals.com', tested: true }], phones: [] }] },     // only found at the LLC's mailing address
  '9 Oak St': { persons: [{ propertyOwner: true, deceased: true, name: { first: 'Old', last: 'Owner' }, emails: [{ rank: 1, email: 'gone@x.com', tested: true }], phones: [] },
    { propertyOwner: true, name: { first: 'Jose', last: 'Rivera', full: 'Jose Rivera' }, emails: [], phones: [{ rank: 1, number: '3055550199', type: 'Mobile', dnc: true, tcpa: false }] }] }
};
M.fetchHandler = (url, opts) => {
  if (url !== 'https://api.batchdata.com/api/v3/property/skip-trace') return { code: 404, body: '{}' };
  calls.push(opts);
  if (opts.headers.Authorization !== 'Bearer ' + KEY) return { code: 401, body: { status: { code: 401, text: 'Unauthorized', message: 'Invalid token.' } } };
  const body = JSON.parse(opts.payload);
  if (!body.requests.length) return { code: 400, body: { status: { code: 400, text: 'Bad Request', message: 'requests is required' } } };
  let matched = 0;
  const data = body.requests.map(r => {
    const hit = people[r.propertyAddress.street];
    if (hit) matched++;
    return { input: r, persons: hit ? hit.persons : [], meta: { matched: !!hit, error: false } };
  });
  return { code: 200, body: { status: { code: 200, text: 'OK' }, result: { data, meta: { results: { requestCount: data.length, matchCount: matched, noMatchCount: data.length - matched, errorCount: 0 } } } } };
};

const add = (o) => g.withLock_(() => { const ctx = g.intakeCtx_(); g.addLead_(ctx, 'Public records', o, '', ''); g.flushIntake_(ctx); });
add({ company: 'Stanley Martin Homes LLC', mailingAddress: '11710 Plaza America Dr, Reston, VA 20190', lastPurchaseAddress: '102 Masters Ln, York County, VA',
  purchases: '102 Masters Ln, York County — $200,000 · land', purchaseCount: 3, notes: 'Needs an email address before approval (skip trace this owner).' });
add({ company: 'RVA Rentals LLC', mailingAddress: '500 E Main St, Richmond, VA 23219', lastPurchaseAddress: '12 Broad St, Richmond, VA', purchaseCount: 3 });
add({ firstName: 'Jose', lastName: 'Rivera', mailingAddress: '55 Palm Dr, Miami, FL 33101', purchases: '9 Oak St, Norfolk — $205,000 (Nov 1, 2026); 11 Oak St, Norfolk — $195,000', purchaseCount: 3 });
add({ company: 'Nowhere Holdings LLC', mailingAddress: '1 Unknown Rd, Suffolk, VA 23434', lastPurchaseAddress: '77 Lost Ln, Suffolk, VA', purchaseCount: 3 });
add({ company: 'No Address LLC', purchaseCount: 3 });
const inv = (re) => g.listInvestors().find(i => re.test(i.company || (i.firstName + ' ' + i.lastName)));

step('nothing happens without an API key; a bad key is rejected and not saved', () => {
  assert.strictEqual(g.runBuyerIntake().results.skiptrace.status, 'off');
  assert.strictEqual(calls.length, 0);
  assert.throws(() => g.saveSkipTraceKey('b'.repeat(40)), /rejected the API key/);
  assert.strictEqual(g.bdKey_(), '');
  assert.throws(() => g.saveSkipTraceKey('short'), /doesn't look like/);
  const st = g.saveSkipTraceKey('Bearer ' + KEY);
  assert(st.skipTrace.hasKey && st.skipTrace.keyHint === '…a1b2');
  assert.strictEqual(st.skipTrace.waiting, 5);
  assert(!JSON.stringify(g.getSettings()).includes(KEY), 'key never stored in the spreadsheet');
});

step('every run skip traces new buyers missing an email and fills in the best contact', () => {
  calls.length = 0;
  const r = g.runBuyerIntake().results.skiptrace;
  assert.strictEqual(r.status, 'ok', JSON.stringify(r));
  const req = JSON.parse(calls[0].payload);
  assert.strictEqual(JSON.stringify(req.options), JSON.stringify({ includeTCPABlacklistedPhones: false, prioritizeMobilePhones: true }));
  const sm = req.requests.find(x => x.propertyAddress.street === '102 Masters Ln');
  assert.strictEqual(JSON.stringify(sm.propertyAddress), JSON.stringify({ street: '102 Masters Ln', state: 'VA' }));
  assert.strictEqual(sm.county, 'York'); assert.strictEqual(sm.state, 'VA');
  assert.strictEqual(JSON.stringify(sm.mailingAddress), JSON.stringify({ street: '11710 Plaza America Dr', city: 'Reston', state: 'VA', zip: '20190' }));
  assert(!sm.name, 'LLCs are traced by property, not by a person\'s name');
  const jr = req.requests.find(x => x.propertyAddress.street === '9 Oak St');
  assert.deepStrictEqual(jr.name, { first: 'Jose', last: 'Rivera' }); assert.strictEqual(jr.propertyAddress.city, 'Norfolk');

  const a = inv(/Stanley Martin/);
  assert.strictEqual(a.email, 'dana@stanleybuilds.com', 'tested email preferred');
  assert.strictEqual(a.phone, '(757) 555-0102', 'mobile preferred');
  assert.strictEqual(a.firstName + ' ' + a.lastName, 'Dana Reyes', 'contact person behind the LLC');
  assert(/other emails dana\.old@yahoo\.com/.test(a.notes) && !/0103/.test(a.notes), 'TCPA-flagged numbers dropped: ' + a.notes);
  assert(!/Needs an email/.test(a.notes));
  assert.strictEqual(a.skipTraceResult, 'Email + phone found');

  const b = inv(/RVA Rentals/);
  assert.strictEqual(b.email, 'sam@rvarentals.com', 'second pass at the LLC\'s mailing address');
  assert(/TCPA litigator/.test(b.notes));

  const c = inv(/Rivera/);
  assert.strictEqual(c.email, '', 'deceased person\'s email ignored');
  assert.strictEqual(c.phone, '(305) 555-0199'); assert(/DNC/.test(c.notes));
  assert.strictEqual(c.skipTraceResult, 'No email + phone found');

  assert.strictEqual(inv(/Nowhere/).skipTraceResult, 'No match');
  assert.strictEqual(inv(/No Address/).skipTraceResult, 'No usable address to skip trace');
  assert.strictEqual(r.emails, 2); assert.strictEqual(r.phones, 2);
  assert.strictEqual(g.bdMatchesUsed_(), 3, 'only matches are billed');
});

step('each buyer is traced automatically once; "Skip trace" retries one on demand', () => {
  calls.length = 0;
  g.runBuyerIntake();
  assert.strictEqual(calls.length, 0, 'no repeat charges');
  people['77 Lost Ln'] = { persons: [{ propertyOwner: true, name: { first: 'Kim', last: 'Lee', full: 'Kim Lee' }, emails: [{ rank: 1, email: 'kim@nowhere.com', tested: true }], phones: [] }] };
  const r = g.skipTraceNow([inv(/Nowhere/).id]);
  assert.strictEqual(r.result.emails, 1);
  assert.strictEqual(inv(/Nowhere/).email, 'kim@nowhere.com');
  assert.strictEqual(r.status.skipTrace.matchesThisMonth, 4);
});

step('monthly match limit and per-run limit are respected', () => {
  add({ company: 'Capped LLC', mailingAddress: '1 Cap St, Norfolk, VA 23510', lastPurchaseAddress: '102 Masters Ln, Norfolk, VA', purchaseCount: 3 });
  g.saveSettings({ SKIPTRACE_MONTHLY_CAP: '4' });
  calls.length = 0;
  assert.strictEqual(g.runBuyerIntake().results.skiptrace.status, 'capped');
  assert.strictEqual(calls.length, 0);
  assert.throws(() => g.skipTraceNow([]), /Monthly skip-trace limit/);
  g.saveSettings({ SKIPTRACE_MONTHLY_CAP: '0', SKIPTRACE_ON: 'FALSE' });
  assert.strictEqual(g.runBuyerIntake().results.skiptrace.status, 'off', 'switch turns automatic tracing off');
  g.saveSettings({ SKIPTRACE_ON: 'TRUE' });
  assert.strictEqual(g.runBuyerIntake().results.skiptrace.emails, 1);
  assert(!M.isLocked());
});

step('address parsing', () => {
  assert.strictEqual(JSON.stringify(g.parseAddress_('00103 Pearl St, Elizabeth City, NC 27909-1234')), JSON.stringify({ street: '00103 Pearl St', city: 'Elizabeth City', state: 'NC', zip: '27909' }));
  assert.strictEqual(JSON.stringify(g.parseAddress_('5 Elm St, Isle Of Wight County, VA')), JSON.stringify({ street: '5 Elm St', county: 'Isle Of Wight', state: 'VA' }));
  assert.strictEqual(g.parseAddress_('PO Box'), null);
  assert.strictEqual(g.purchaseAddress_({ purchases: '00105 Pearl St, Elizabeth City — $90,000', markets: 'Elizabeth City' }), '00105 Pearl St, Elizabeth City, NC');
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : '') + '\n');
