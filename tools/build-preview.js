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
