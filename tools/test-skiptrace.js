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

step('free lookup: email and phone pasted by hand are saved', () => {
  const id = inv(/No Address/).id;
  assert.throws(() => g.setInvestorContact(id, 'not-an-email', ''), /doesn't look right/);
  assert.throws(() => g.setInvestorContact(id, 'kim@nowhere.com', ''), /already belongs to/);
  const u = g.setInvestorContact(id, ' Owner@NoAddress.com ', '757-555-0100');
  assert.strictEqual(u.email, 'owner@noaddress.com'); assert.strictEqual(u.phone, '(757) 555-0100');
  assert.strictEqual(inv(/No Address/).skipTraceResult, 'Looked up by hand');
});

step('DealMachine connected: buyers missing an email are skip traced with Enrich by Address', () => {
  const dmCalls = [];
  const keep = M.fetchHandler;
  const dir = {
    '300 Harbor Dr': [{ first_name: 'Rita', last_name: 'Vance', full_name: 'Rita Vance', is_likely_owner: true,
      emails: [{ address: 'rita.old@aol.com', verification_status: 'unknown', match_confidence: 60 }, { address: 'Rita@HarborFlips.com', verification_status: 'very_likely_deliverable', match_confidence: 90 }],
      phones: [{ number: '7575550300', type: 'landline', do_not_call: false }, { number: '7575550301', type: 'wireless', do_not_call: false }] },
      { first_name: 'Tom', last_name: 'Tenant', is_likely_renter: true, emails: [{ address: 'tenant@x.com', verification_status: 'very_likely_deliverable' }], phones: [] }],
    '40 Main St': [{ first_name: 'Someone', last_name: 'Else', is_likely_owner: true, emails: [{ address: 'else@x.com', verification_status: 'very_likely_deliverable' }], phones: [] }],
    '7 Stale Way': [{ first_name: 'John', last_name: 'Seller', is_likely_owner: true, emails: [{ address: 'seller@x.com', verification_status: 'very_likely_deliverable' }], phones: [] }],
    '12 Pine Ct': [{ first_name: 'Lena', last_name: 'Park', is_likely_owner: true, emails: [{ address: 'lena@parkhomes.com', verification_status: 'likely_deliverable' }], phones: [] }]
  };
  M.fetchHandler = (url, opts) => {
    if (url === 'https://api.v2.dealmachine.com/v1/enrichment/address') {
      const body = JSON.parse(opts.payload); dmCalls.push(body);
      const owners = { '300 Harbor Dr': 'HARBOR FLIPS LLC', '40 Main St': 'ELSE SOMEONE', '12 Pine Ct': 'PARK LENA', '7 Stale Way': 'OLD SELLER JOHN' };
      const data = body.data.map(it => { const st = it.street || String(it.full_address).split(',')[0]; const c = dir[st]; return c ? { input: it, matched: true, owner_1_full_name: owners[st], contacts: c } : { input: it, matched: false, match_failure: { code: 'not_found' } }; });
      return { code: 200, body: { data, totals: { submitted: data.length, matched: data.filter(d => d.matched).length }, credits: { used: data.filter(d => d.matched).length, properties: 0, people: data.filter(d => d.matched).length } } };
    }
    return keep(url, opts);
  };
  g.PropertiesService.getScriptProperties().setProperty('DM_API_KEY', 'dm_sk_live_testkey1234');
  add({ company: 'Harbor Flips LLC', mailingAddress: '9 Office Park, Norfolk, VA 23510', lastPurchaseAddress: '300 Harbor Dr, Norfolk, VA', purchaseCount: 2 });
  add({ firstName: 'Lena', lastName: 'Park', mailingAddress: '12 Pine Ct, Chesapeake, VA 23320', lastPurchaseAddress: '40 Main St, Suffolk, VA', purchaseCount: 2 });
  add({ company: 'Fresh Buy LLC', lastPurchaseAddress: '7 Stale Way, Norfolk, VA', purchaseCount: 2 });
  add({ company: 'Office Only LLC', mailingAddress: '300 Harbor Dr, Norfolk, VA 23510', lastPurchaseAddress: '1 Nowhere Rd, Suffolk, VA', purchaseCount: 2 });
  const before = g.dmCreditsUsed_();
  const r = g.runBuyerIntake().results.skiptrace;
  assert.strictEqual(r.provider, 'dealmachine', JSON.stringify(r));
  assert.strictEqual(dmCalls[0].anchor, 'people'); assert.strictEqual(dmCalls[0].contact_audience, 'owners');
  assert(dmCalls[0].data.some(d => d.street === '300 Harbor Dr' && d.city === 'Norfolk' && d.state === 'VA'));
  assert.strictEqual(JSON.stringify(dmCalls[0].fields), JSON.stringify(['owner_1_full_name']));
  const hf = inv(/Harbor Flips/);
  assert.strictEqual(hf.email, 'rita@harborflips.com', 'deliverable email preferred');
  assert.strictEqual(hf.phone, '(757) 555-0301', 'mobile preferred');
  assert.strictEqual(hf.firstName + ' ' + hf.lastName, 'Rita Vance');
  assert(!/tenant/.test(hf.notes), 'renters ignored'); assert(/DealMachine/.test(hf.notes));
  const lp = inv(/Park/);
  assert.strictEqual(lp.email, 'lena@parkhomes.com', 'person found at their mailing address (same last name)');
  assert.strictEqual(inv(/Office Only/).email, '', 'company never matched to whoever owns its mailing address');
  assert(!dmCalls.some((c, i) => i > 0 && c.data.some(d => d.street === '300 Harbor Dr')), 'no mailing retry for companies');
  assert.strictEqual(inv(/Fresh Buy/).email, '', 'seller\'s email never saved');
  assert(/previous owner/.test(inv(/Fresh Buy/).skipTraceResult));
  assert.strictEqual(g.dmCreditsUsed_() - before, 4, 'DealMachine credits counted');
  assert(/1 Nowhere Rd/.test(JSON.stringify(dmCalls[0])));
  M.fetchHandler = keep;
});

step('Perplexity web search: only emails printed on a real page that names the buyer', () => {
  g.PropertiesService.getScriptProperties().deleteProperty('DM_API_KEY');
  const keep = M.fetchHandler, pxCalls = [];
  const PX = 'pplx-' + 'k'.repeat(40);
  const far = ' lorem ipsum'.repeat(40);
  const pages = {
    'Cash Cow Properties LLC': [{ url: 'https://www.cashcowva.com/contact', title: 'Contact | Cash Cow Properties LLC', snippet: 'We buy houses in Norfolk. Reach the team: deals@cashcowva.com or (757) 555-0199.' }],
    'Naqua Capital LLC': [{ url: 'https://www.zillow.com/profile/x', title: 'Naqua Capital LLC listings', snippet: 'Naqua Capital LLC sold 2 homes. Questions? info@zillow.com' + far + ' random person: john.random@gmail.com' }],
    'Ursula Investments LLC': [{ url: 'https://someblog.com/post', title: 'Top Norfolk flippers', snippet: 'Great flipper, email bob@flipsrus.com' }],
    'Marco Diaz': [{ url: 'https://biggerpockets.example/u/marco', title: 'Marco Diaz — Investor', snippet: 'Marco Diaz is a real estate investor in Norfolk VA. Contact Marco at marco@diazbuys.com for off-market deals.' }]
  };
  M.fetchHandler = (url, opts) => {
    if (url === 'https://api.perplexity.ai/search') {
      if (opts.headers.Authorization !== 'Bearer ' + PX) return { code: 401, body: { error: { message: 'Invalid API key', type: 'invalid_api_key', code: 401 } } };
      const b = JSON.parse(opts.payload);
      if (!b.query.length) return { code: 400, body: { error: { message: 'empty query array', type: 'invalid_request', code: 400 } } };
      pxCalls.push(b);
      const who = Object.keys(pages).find(k => b.query[0].includes('"' + k + '"'));
      return { code: 200, body: { id: 'r1', results: who ? pages[who] : [] } };
    }
    return keep(url, opts);
  };
  assert.throws(() => g.savePerplexityKey('pplx-' + 'x'.repeat(40)), /rejected the API key/);
  g.savePerplexityKey(PX);
  assert.strictEqual(pxCalls.length, 0, 'key test is free (rejected empty request)');
  add({ company: 'Cash Cow Properties LLC', mailingAddress: '5 Bay St, Norfolk, VA 23510', purchaseCount: 2 });
  add({ company: 'Naqua Capital LLC', mailingAddress: '6 Bay St, Norfolk, VA 23510', purchaseCount: 2 });
  add({ company: 'Ursula Investments LLC', mailingAddress: '7 Bay St, Norfolk, VA 23510', purchaseCount: 2 });
  add({ firstName: 'Marco', lastName: 'Diaz', mailingAddress: '8 Bay St, Norfolk, VA 23510', purchaseCount: 2 });
  const r = g.runBuyerIntake().results.websearch;
  assert.strictEqual(r.status, 'ok', JSON.stringify(r));
  const cc = pxCalls.find(c => /Cash Cow/.test(c.query[0]));
  assert(cc && cc.query.length <= 3 && /^"Cash Cow Properties LLC" Norfolk VA email$/.test(cc.query[0]), JSON.stringify(cc));
  assert(pxCalls.every(c => c.query.length <= 3), 'one request per buyer, up to 3 queries');
  assert.strictEqual(inv(/Cash Cow/).email, 'deals@cashcowva.com', 'email on the company\'s own website');
  assert(/cashcowva\.com\/contact/.test(inv(/Cash Cow/).notes), 'source page saved in notes');
  assert.strictEqual(inv(/Naqua/).email, '', 'listing-site email and far-away emails rejected');
  assert.strictEqual(inv(/Ursula/).email, '', 'page that never names the buyer is ignored');
  assert.strictEqual(inv(/Diaz/).email, 'marco@diazbuys.com', 'email right next to the person\'s name');
  assert(/no email on the web/.test(inv(/Naqua/).skipTraceResult), inv(/Naqua/).skipTraceResult);
  const used = g.pxUsed_();
  assert(used >= 4);
  g.runBuyerIntake();
  assert.strictEqual(g.pxUsed_(), used, 'each buyer searched automatically once');
  const st = g.getIntakeStatus().skipTrace.web;
  assert(st.hasKey && st.used === used);
  g.saveSettings({ SKIPTRACE_WEB_MONTHLY_CAP: String(used) });
  assert.strictEqual(g.runBuyerIntake().results.websearch.status, 'capped');
  g.saveSettings({ SKIPTRACE_WEB_MONTHLY_CAP: '1000' });
  M.fetchHandler = keep;
  assert(!M.isLocked());
});

step('address parsing', () => {
  assert.strictEqual(JSON.stringify(g.parseAddress_('00103 Pearl St, Elizabeth City, NC 27909-1234')), JSON.stringify({ street: '00103 Pearl St', city: 'Elizabeth City', state: 'NC', zip: '27909' }));
  assert.strictEqual(JSON.stringify(g.parseAddress_('5 Elm St, Isle Of Wight County, VA')), JSON.stringify({ street: '5 Elm St', county: 'Isle Of Wight', state: 'VA' }));
  assert.strictEqual(g.parseAddress_('PO Box'), null);
  assert.strictEqual(g.purchaseAddress_({ purchases: '00105 Pearl St, Elizabeth City — $90,000', markets: 'Elizabeth City' }), '00105 Pearl St, Elizabeth City, NC');
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : '') + '\n');
