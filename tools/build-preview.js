/**
 * Builds preview/index.html — a fully clickable, offline demo of the web app.
 * It runs the REAL server code (src/*.gs) and the REAL UI (src/*.html) in the browser
 * against the in-memory Apps Script mock, seeded with sample data. Nothing is emailed.
 *
 * Run:  node tools/build-preview.js   then open preview/index.html
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const gs = fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.gs')).sort()
  .map(f => '// ---- ' + f + ' ----\n' + read('src/' + f)).join('\n');

const shim = `
window.google = { script: { get run() {
  let ok = function () {}, bad = function (e) { console.error(e); };
  const r = new Proxy({}, { get(_, prop) {
    if (prop === 'withSuccessHandler') return f => { ok = f; return r; };
    if (prop === 'withFailureHandler') return f => { bad = f; return r; };
    return (...args) => setTimeout(() => {
      try {
        if (typeof window[prop] !== 'function' || /_$/.test(prop)) throw new Error('Script function not found: ' + prop);
        const res = window[prop].apply(null, JSON.parse(JSON.stringify(args)));
        ok(res === undefined ? null : JSON.parse(JSON.stringify(res)));
      } catch (e) { bad(e); }
    }, 150);
  } });
  return r;
} } };`;

const seed = `
(function seed() {
  const M = window.__GAS_MOCK__;
  M.quota = 1500;
  setup();
  saveSettings({ CONTACT_NAME: 'Jordan Hale', CONTACT_PHONE: '(404) 555-0100', CONTACT_EMAIL: 'deals@samedayinvestments.com',
    WEBSITE: 'samedayinvestments.com', COMPANY_ADDRESS: '100 Peachtree St NW, Suite 400, Atlanta, GA 30303',
    REPLY_TO: 'deals@samedayinvestments.com', TEST_EMAIL: 'dispo@samedayinvestments.com', MARKETS: 'Atlanta Metro, Macon, Savannah, Dallas-Fort Worth' });

  function photo(label, hue, seedN) {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 800); g.addColorStop(0, 'hsl(' + hue + ',35%,72%)'); g.addColorStop(1, 'hsl(' + hue + ',25%,40%)');
    x.fillStyle = g; x.fillRect(0, 0, 1200, 800);
    x.fillStyle = '#2f3b33'; x.fillRect(0, 600, 1200, 200);
    x.fillStyle = 'hsl(' + (hue + 20) + ',20%,' + (55 + seedN * 4) + '%)'; x.fillRect(300, 330, 600, 300);
    x.fillStyle = '#3b2a24'; x.beginPath(); x.moveTo(260, 340); x.lineTo(600, 150); x.lineTo(940, 340); x.closePath(); x.fill();
    x.fillStyle = '#1d2a22'; x.fillRect(560, 470, 80, 160);
    x.fillStyle = '#e9f1ec'; [360, 720].forEach(px => x.fillRect(px, 400, 120, 90));
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 720, 1200, 80);
    x.fillStyle = '#fff'; x.font = '600 36px Georgia'; x.fillText(label, 40, 772);
    return c.toDataURL('image/jpeg', 0.8);
  }

  const people = [
    ['Marcus', 'Reed', 'Reed Capital LLC', 'marcus@reedcapital.com', '(404) 555-0101', 'Platinum', 'Fix & Flip, Cash Buyer', 'Atlanta Metro', 'Single Family', 80000, 300000, '3/2 SFR, light-to-medium rehab, closes in 10 days'],
    ['Danielle', 'Ortiz', 'Ortiz Rentals', 'dortiz@ortizrentals.com', '(678) 555-0144', 'Gold', 'Buy & Hold, BRRRR', 'Atlanta Metro, Macon', 'Single Family, Multi-Family (2-4)', 60000, 180000, 'Rentals that cash flow $300+/door'],
    ['Kevin', 'Park', 'Park Holdings', 'kevin@parkholdings.co', '(470) 555-0188', 'Platinum', 'Hedge Fund / Institutional', 'Atlanta Metro, Dallas-Fort Worth', '', 100000, 1500000, 'Portfolio buyer, 1990+ builds'],
    ['Sasha', 'Grant', 'Grant Real Estate', 'sasha@grantre.com', '(404) 555-0199', 'Silver', 'BRRRR', 'Atlanta Metro', 'Single Family', '', '', 'Prefers 3/2 brick ranch'],
    ['Victoria', 'Vance', 'Vance Capital Partners', 'victoria@vancecap.com', '(404) 555-0122', 'Platinum', 'Fix & Flip, Private Lender', 'Atlanta Metro, Savannah', 'Single Family', 100000, 400000, 'Will fund or buy'],
    ['Andre', 'Wallace', '', 'andre.wallace@gmail.com', '(912) 555-0170', 'Bronze', 'Wholesaler', 'Savannah', '', '', '', ''],
    ['Priya', 'Natarajan', 'Northside Homes', 'priya@northsidehomes.com', '(770) 555-0133', 'Gold', 'Fix & Flip', 'Atlanta Metro', 'Single Family, Condo / Townhouse', 120000, 350000, 'Cosmetic flips in Decatur / Tucker'],
    ['Tom', 'Becker', 'Becker Builders', 'tom@beckerbuilders.com', '(214) 555-0155', 'Silver', 'Developer', 'Dallas-Fort Worth', 'Land, Multi-Family (5+)', 200000, 2000000, 'Infill lots & small multifamily'],
    ['Leah', 'Kim', '', 'leah.kim@outlook.com', '(478) 555-0102', 'Bronze', 'Buy & Hold', 'Macon', 'Single Family', 40000, 120000, ''],
    ['Robert', 'Ellis', 'Ellis Equity', 'rob@ellisequity.com', '(404) 555-0177', 'Gold', 'Cash Buyer, Fix & Flip', 'Atlanta Metro', 'Single Family', 90000, 260000, 'Needs 70% rule']
  ];
  people.forEach(p => saveInvestor({ firstName: p[0], lastName: p[1], company: p[2], email: p[3], phone: p[4], tier: p[5], categories: p[6], markets: p[7], propertyTypes: p[8], minPrice: p[9], maxPrice: p[10], criteria: p[11], source: 'Import: Buyers List' }));
  const inv = listInvestors();
  updateInvestors([inv[5].id], { status: 'Inactive' });

  const d1 = saveDeal({ address: '1847 Magnolia Ridge Dr', city: 'Decatur', state: 'GA', zip: '30030', market: 'Atlanta Metro', propertyType: 'Single Family',
    askingPrice: 185000, assignmentPrice: 15000, showAssignment: false, arv: 310000, repairs: 45000, sqft: 1640, beds: 3, baths: 2, lotSize: '0.31 acres', yearBuilt: 1978,
    description: 'Brick ranch on a quiet cul-de-sac two miles from downtown Decatur. Solid bones, new roof (2021), full unfinished basement.\\n\\nNeeds kitchen, both baths, HVAC and cosmetics. Comps on the street at $305K–$325K within the last 90 days.',
    closingDate: '2026-12-15', access: 'Open house Saturday 10am–12pm. Call Jordan to schedule a private walkthrough.', showAccess: true, videoUrl: 'https://youtu.be/samedaywalkthrough', internalNotes: 'Lockbox 4471 · seller Mrs. Hall' });
  ['Front Elevation', 'Living Room', 'Kitchen', 'Primary Bedroom', 'Backyard'].forEach((l, i) => uploadDealPhoto(d1.id, l + '.jpg', 'image/jpeg', photo(l, 150 + i * 12, i)));

  const d2 = saveDeal({ address: '22 Oak Hollow Ln', city: 'Marietta', state: 'GA', zip: '30064', market: 'Atlanta Metro', propertyType: 'Single Family',
    askingPrice: 142000, assignmentPrice: 12000, arv: 240000, repairs: 38000, sqft: 1320, beds: 3, baths: 1.5, lotSize: '0.22 acres', yearBuilt: 1969,
    description: 'Split-level in an established neighborhood. Tenant-occupied at $1,450/mo, month-to-month.', closingDate: '2026-12-05', access: 'Drive-by only — do not disturb tenant.' });
  ['Front', 'Kitchen'].forEach((l, i) => uploadDealPhoto(d2.id, l + '.jpg', 'image/jpeg', photo(l, 100 + i * 20, i)));

  const d3 = saveDeal({ address: '410 Bay View Ct', city: 'Savannah', state: 'GA', zip: '31404', market: 'Savannah', propertyType: 'Multi-Family (2-4)',
    askingPrice: 265000, arv: 420000, repairs: 70000, sqft: 2800, beds: 6, baths: 4, lotSize: '0.18 acres', yearBuilt: 1952, description: 'Fourplex, 2 units occupied.', closingDate: '2026-11-30' });
  uploadDealPhoto(d3.id, 'Front.jpg', 'image/jpeg', photo('Front', 30, 2));

  const d4 = saveDeal({ address: '7 Willow Bend', city: 'Macon', state: 'GA', zip: '31204', market: 'Macon', propertyType: 'Single Family', askingPrice: 68000, arv: 135000, repairs: 30000, sqft: 1100, beds: 2, baths: 1 });

  // A test run, then live sends for d2 and d3 (in the mock) to populate tracking
  confirmDistribution(prepareDistribution(d1.id, { mode: 'all' }).token, '');
  setTestMode(false, 'GO LIVE');
  confirmDistribution(prepareDistribution(d2.id, { mode: 'all' }).token, 'SEND');
  confirmDistribution(prepareDistribution(d3.id, { mode: 'segments', tiers: ['Platinum', 'Gold'] }).token, 'SEND');
  setTestMode(true, '');
  M.inbox = [
    { id: 'm1', from: 'Marcus Reed <marcus@reedcapital.com>', subject: 'INTERESTED - ' + d2.id + ' - 22 Oak Hollow Ln', body: "I'm interested. Can I see it Thursday?\\n\\nDeal: " + d2.id },
    { id: 'm2', from: 'victoria@vancecap.com', subject: 'Re: Off-Market Opportunity | 22 Oak Hollow Ln [' + d2.id + ']', body: 'We can do an offer of $138,000 cash, close in 14 days.' },
    { id: 'm3', from: 'Kevin Park <kevin@parkholdings.co>', subject: 'OFFER - ' + d3.id + ' - 410 Bay View Ct', body: 'My offer for 410 Bay View Ct is: $255,000\\n\\nProof of funds attached: Yes' },
    { id: 'm4', from: 'Leah Kim <leah.kim@outlook.com>', subject: 'PASS - ' + d2.id, body: 'Not for me this time.' }
  ];
  scanInboxForResponses();
  setDealStatus(d4.id, 'Sold', { buyer: 'Robert Ellis', soldPrice: 72000 });
  setDealStatus(d3.id, 'Pending', { buyer: 'Kevin Park' });
  // ---- new buyer intake demo ----
  const st = createBuyerSignupForm();
  const form = M.forms[st.form.id];
  form._submit({ 'First name': 'Jamal', 'Last name': 'Brooks', 'Company / LLC': 'Brooks Buys LLC', 'Email': 'jamal@brooksbuys.com', 'Mobile phone': '(404) 555-0111',
    'Markets you buy in': ['Atlanta Metro'], 'Property types': ['Single Family'], 'How do you invest?': ['Fix & Flip', 'Cash Buyer'],
    'Minimum purchase price': '90000', 'Maximum purchase price': '220000', 'Describe your buy box': '3/2 brick ranch, light-to-medium rehab, inside I-285', 'How do you fund purchases?': 'Cash', 'Deal alerts': ['Yes'] });
  const ex = new M.Spreadsheet('PropStream Export — Cash Buyers');
  const t = ex.insertSheet('Cash Sales');
  const ago = (d) => { const x = new Date(Date.now() - d * 86400000); return (x.getMonth() + 1) + '/' + x.getDate() + '/' + x.getFullYear(); };
  t.data = [['Address', 'City', 'State', 'Zip', 'Property Type', 'Owner 1 Full Name', 'Mailing Address', 'Mailing City', 'Mailing State', 'Mailing Zip', 'Last Sale Date', 'Last Sale Amount', 'Open Mortgage Balance', 'Email 1', 'Phone 1'],
    ['12 ELM ST', 'DECATUR', 'GA', '30030', 'SFR', 'PEACH STATE HOMES LLC', '500 MAIN ST', 'ATLANTA', 'GA', '30303', ago(20), '$150,000', '0', '', ''],
    ['88 PINE AVE', 'TUCKER', 'GA', '30084', 'SFR', 'PEACH STATE HOMES LLC', '500 MAIN ST', 'ATLANTA', 'GA', '30303', ago(64), '$118,000', '0', '', ''],
    ['31 BIRCH LN', 'DECATUR', 'GA', '30032', 'SFR', 'PEACH STATE HOMES LLC', '500 MAIN ST', 'ATLANTA', 'GA', '30303', ago(130), '$172,000', '0', '', ''],
    ['4 OAK CT', 'TUCKER', 'GA', '30084', 'Duplex', 'CARTER, DENISE', '9 RIVER RD', 'TUCKER', 'GA', '30084', ago(10), '$210,000', '', 'denise.carter@gmail.com', '(770) 555-0123'],
    ['19 MILL RD', 'MACON', 'GA', '31204', 'Single Family Residential', 'MIDSTATE RENTALS LLC', 'PO BOX 88', 'MACON', 'GA', '31201', ago(33), '$64,000', '0', 'info@midstaterentals.com', '(478) 555-0190']];
  saveSettings({ INTAKE_CASH_ON: 'TRUE', INTAKE_CASH_URL: ex.getUrl(), INTAKE_CASH_TAB: 'Cash Sales' });
  M.inbox.push({ id: 'g1', from: 'Lisa Nguyen <lisa@nguyenventures.com>', subject: 'Please add me to your buyers list', body: 'Hi Jordan! I buy single family and duplexes in Atlanta Metro and Macon, $80k-$250k, light rehab flips. Cash buyer. Cell 678-555-0142.' });
  // ---- DealMachine + Norfolk demo (simulated API responses in the documented formats) ----
  const dAgo = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const P = (id, a, c, o, d, pr, t, ct, f) => ({ dm_property_id: id, address: a, city: c, state: f.startsWith('37') ? 'NC' : 'VA', owner_1_full_name: o, owner_mailing_address_full: '2101 Executive Dr, Hampton, VA 23666', last_sale_date: dAgo(d), last_sale_price: pr, property_type: [t], contacts: ct || [], _f: f });
  const C = (f, l, ph, em, dnc) => ({ first_name: f, last_name: l, is_likely_owner: true, phones: ph ? [{ number: ph, type: 'wireless', do_not_call: !!dnc }] : [], emails: em ? [{ address: em, verification_status: 'very_likely_deliverable' }] : [] });
  const DM = {
    cash: [P('a1', '1218 W 39th St', 'Norfolk', 'TIDEWATER HOME BUYERS LLC', 2, 168000, 1, [C('Ray', 'Coles', '7575550101', 'ray@tidewaterhomebuyers.com')], '51710'),
      P('a2', '44 Seldendale Dr', 'Hampton', 'TIDEWATER HOME BUYERS LLC', 9, 139000, 1, [], '51650'),
      P('a3', '3307 Griffin St', 'Richmond', 'RIVER CITY REHAB GROUP LLC', 4, 182000, 1, [C('Tasha', 'Mims', '8045550133', 'tasha@rivercityrehab.com')], '51760'),
      P('a4', '17 Poquoson Ave', 'Poquoson', 'HARRIS, DEREK', 6, 245000, 1, [C('Derek', 'Harris', '7575550160', null, true)], '51735')],
    hard: [P('a5', '905 Bolling Ave', 'Norfolk', 'FLIPRIGHT VENTURES LLC', 3, 121000, 1, [C('Dana', 'Reyes', '7575550177', 'dana@flipright.co')], '51710')],
    land: [P('a6', 'Lot 12 Riverside Dr', 'Elizabeth City', 'COASTAL NEW HOMES BUILDERS INC', 5, 48000, 9, [C('Lee', 'Park', '2525550112', 'lee@coastalnewhomes.com')], '37139'),
      P('a7', 'Lot 13 Riverside Dr', 'Elizabeth City', 'COASTAL NEW HOMES BUILDERS INC', 5, 49500, 9, [], '37139'),
      P('a8', '0 Nansemond Pkwy', 'Suffolk', 'SEABOARD DEVELOPMENT PARTNERS LLC', 11, 95000, 9, [C('Marcus', 'Bell', '7575550188', 'mbell@seaboarddev.com')], '51800')]
  };
  M.fetchHandler = (url, o) => {
    if (url.indexOf('data.norfolk.gov/api/views/metadata') > -1) return { code: 200, body: [{ id: 'qva7-tzrf', name: 'Property Assessment and Sales - FY27' }] };
    if (url.indexOf('data.norfolk.gov/resource/') > -1) return { code: 200, body: [
      { parcel_id: '1', grantee: 'Red Property Llc', transfer_date: dAgo(5) + 'T00:00:00.000', consideration: '146901', property_street_number: '316', property_street_name: 'Poplar', property_street_type: 'AVE', property_city: 'Norfolk', property_use: 'Single Family - Detached' },
      { parcel_id: '2', grantee: 'New Beginnings Development Llc', transfer_date: dAgo(7) + 'T00:00:00.000', consideration: '42000', property_street_number: '139', property_street_name: 'Filbert', property_street_type: 'ST', property_city: 'Norfolk', property_use: 'Vacant Land' }] };
    if (url.indexOf('api.v2.dealmachine.com') === -1) return { code: 404, body: '{}' };
    if (url.endsWith('/account')) return { code: 200, body: { data: {} } };
    if (url.indexOf('/filters?') > -1) return { code: 200, body: { data: [{ filter_id: 'property_type', options: [{ option_id: 1, label: 'Single Family' }, { option_id: 9, label: 'Vacant Land' }] }, { filter_id: 'additional_property_types', options: [{ option_id: 101, label: 'Residential Vacant Land' }] }], pagination: {} } };
    const b = JSON.parse(o.payload), has = (id) => b.filters.some(x => x.filter_id === id);
    const k = has('additional_property_types') ? 'land' : has('is_mortgage_1_private_lender') ? 'hard' : 'cash';
    if (url.endsWith('/count')) return { code: 200, body: { total_properties: { cash: 9, hard: 3, land: 2 }[k] * b.locations.length } };
    const rows = DM[k].filter(p => b.locations.some(l => l.code === p._f));
    return { code: 200, body: { data: rows, pagination: { has_next_page: false }, credits: { used: rows.length * 2 } } };
  };
  saveDealMachineKey('dm_sk_live_DEMOKEY000000000000');
  saveSettings({ INTAKE_DM_ON: 'TRUE' });
  runBuyerIntake();
  enableDailyIntake(6, 19);

  // ---- phase 1 demo: buy boxes, land deal, offers, verification, pipeline ----
  saveSettings({ REPS: 'Jordan Hale <jordan@samedayinvestments.com>, Kim Ortiz <kim@samedayinvestments.com>', CATEGORIES: 'Fix & Flip, Buy & Hold, Cash Buyer, BRRRR, Wholesaler, Hedge Fund / Institutional, Developer, Builder, Private Lender' });
  const byEmail = (e) => readTable_('Investors').rows.find(r => r.email === e);
  const upd = (e, f) => { const r = byEmail(e); if (r) updateObject_('Investors', r._row, f); };
  upd('marcus@reedcapital.com', { zips: '30030, 30032', condition: 'Rehab', funding: 'Cash', minRoi: 20, closeDays: 10 });
  upd('tom@beckerbuilders.com', { markets: 'Suffolk, Chesapeake, Dallas-Fort Worth', zips: '23434, 23435', propertyTypes: 'Land, Multi-Family (5+)', categories: 'Developer, Builder', minAcres: 1, maxAcres: 25, funding: 'Cash', closeDays: 21, tier: 'Platinum' });
  upd('priya@northsidehomes.com', { condition: 'Turnkey', funding: 'Hard money', closeDays: 14 });
  ['info@midstaterentals.com', 'lee@coastalnewhomes.com', 'mbell@seaboarddev.com', 'ray@tidewaterhomebuyers.com'].forEach(e => upd(e, { status: 'Active' }));
  upd('lee@coastalnewhomes.com', { markets: 'Elizabeth City, Suffolk', tier: 'Gold', minAcres: 0.25, maxAcres: 5 });
  upd('mbell@seaboarddev.com', { tier: 'Platinum', markets: 'Suffolk, Chesapeake', minAcres: 1 });
  const land = saveDeal({ address: '0 Pruden Blvd', city: 'Suffolk', state: 'VA', zip: '23434', market: 'Suffolk', propertyType: 'Land', acres: 2, lotSize: '2 acres', zoning: 'R-1', parcelId: '34-12A',
    askingPrice: 85000, contractPrice: 60000, arv: '', description: '2-acre residential parcel off Pruden Blvd. R-1 zoning, public water at the road, perc test on file. Room for 2 homes.', closingDate: '', rep: 'Jordan Hale <jordan@samedayinvestments.com>' });
  const oak = listDeals().find(d => d.address === '22 Oak Hollow Ln');
  updateObject_('Deals', findBy_('Deals', 'id', oak.id)._row, { contractPrice: 118000, offerDeadline: new Date(Date.now() + 20 * 3600000), rep: 'Kim Ortiz <kim@samedayinvestments.com>' });
  const invOf = (e) => byEmail(e);
  verifyPof(invOf('marcus@reedcapital.com').id, 400000);
  uploadPof(invOf('victoria@vancecap.com').id, 'statement.pdf', 'application/pdf', 'JVBERi0xLjQ=', 250000, '');
  verifyPof(invOf('kevin@parkholdings.co').id, 2000000);
  verifyPof(invOf('rob@ellisequity.com').id, 180000, new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  saveOffer({ dealId: oak.id, investorId: invOf('marcus@reedcapital.com').id, amount: 141000, emd: 5000, inspectionDays: 5, closingDate: new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10), financing: 'Cash' });
  saveOffer({ dealId: oak.id, investorId: invOf('rob@ellisequity.com').id, amount: 136500, emd: 2500, inspectionDays: 10, closingDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), financing: 'Cash' });
  recordBuyerOutcome(invOf('kevin@parkholdings.co').id, 'closed', '');
  recordBuyerOutcome(invOf('kevin@parkholdings.co').id, 'closed', '');
  recordBuyerOutcome(invOf('rob@ellisequity.com').id, 'default', '', 'Could not fund');
  const bay = listDeals().find(d => d.address === '410 Bay View Ct');
  setDealStage(bay.id, 'EMD Received', { buyerInvestorId: invOf('kevin@parkholdings.co').id, emdAmount: 10000, closingDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });
  const mag = listDeals().find(d => d.address === '1847 Magnolia Ridge Dr');
  updateObject_('Deals', findBy_('Deals', 'id', mag.id)._row, { stageUpdated: new Date(Date.now() - 9 * 86400000) });
  readTable_('Responses').rows.forEach(r => updateObject_('Responses', r._row, { received: new Date(Date.now() - 4 * 86400000) }));
  M.sent = [];
  M.sent = [];
  window.__SEEDED__ = true;
})();`;

const index = read('src/Index.html')
  .replace("<?!= include('Styles') ?>", () => read('src/Styles.html'))
  .replace("<?!= include('App') ?>", () =>
    '<script>' + read('tools/gas-mock.js') + '</script>\n<script>' + shim + '</script>\n<script>\n' + gs + '\n</script>\n<script>' + seed + '</script>\n' + read('src/App.html'));

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
fs.writeFileSync(path.join(root, 'preview', 'index.html'), index);
console.log('Wrote preview/index.html (' + Math.round(index.length / 1024) + ' KB)');
