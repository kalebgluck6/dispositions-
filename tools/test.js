/**
 * End-to-end test of the server code against the in-memory Apps Script mock.
 * Run:  node tools/test.js
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
const throwsMsg = (fn, re) => assert.throws(fn, err => re.test(err.message), 'expected error ' + re);
const noDates = (o, p) => {
  if (o instanceof Date) throw new Error('Date object leaked to client at ' + p);
  if (o && typeof o === 'object') Object.keys(o).forEach(k => noDates(o[k], p + '.' + k));
};
const resetGlobals = () => { g._settings = null; };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

console.log('\nSameDayInvestments — server tests\n');

step('setup creates all tabs, headers and settings', () => {
  g.setup();
  const names = M.activeSpreadsheet.getSheets().map(s => s.getName());
  ['Settings', 'Investors', 'Deals', 'Distribution Jobs', 'Distribution Log', 'Responses'].forEach(n => assert(names.includes(n), n));
  assert(!names.includes('Sheet1'));
  const s = g.getSettings();
  assert.strictEqual(s.testMode, true, 'test mode on by default');
  assert.strictEqual(s.values.TEST_EMAIL, M.user);
  g.setup(); // idempotent
  assert.strictEqual(M.activeSpreadsheet.getSheetByName('Settings').getLastRow(), g.DEFAULT_SETTINGS.length + 1);
});

// --- import ---
const src = new M.Spreadsheet('Our Buyers List');
const tab = src.insertSheet('Buyers');
tab.data = [
  ['SameDay Buyers List — exported', '', '', '', '', '', ''],
  ['Full Name', 'E-mail Address', 'Cell', 'Buyer Type', 'Areas', 'Max Budget', 'Notes'],
  ['Marcus Reed', 'marcus@reedcapital.com', '+1 (404) 555-0101', 'Fix & Flip, Cash Buyer', 'Atlanta Metro', '$250,000', 'Closes in 10 days'],
  ['Danielle Ortiz', 'DOrtiz@Example.com', '678-555-0144', 'Buy & Hold', 'Atlanta Metro; Macon', '180k', ''],
  ['Kevin Park', 'kevin@parkholdings.co', '470-555-0188', 'Hedge Fund / Institutional', 'Dallas-Fort Worth', '1.2M', ''],
  ['Bad Row', 'not-an-email', '', '', '', '', ''],
  ['Dupe Danielle', 'dortiz@example.com', '', '', '', '', ''],
  ['Sasha Grant', 'sasha@grantre.com', '404-555-0199', 'BRRRR', 'Atlanta Metro', '', 'Prefers 3/2'],
  ['', '', '', '', '', '', '']
];

step('previewImport auto-detects header row and maps messy columns', () => {
  const p = g.previewImport(src.getUrl(), 'Buyers');
  assert.strictEqual(p.headerRow, 2);
  assert.strictEqual(p.totalRows, 6);
  assert.strictEqual(p.mapping.fullName, 0);
  assert.strictEqual(p.mapping.email, 1);
  assert.strictEqual(p.mapping.phone, 2);
  assert.strictEqual(p.mapping.categories, 3);
  assert.strictEqual(p.mapping.markets, 4);
  assert.strictEqual(p.mapping.maxPrice, 5);
  assert.strictEqual(p.mapping.notes, 6);
});

step('runImport adds investors, rejects invalid + duplicate emails, splits names, parses prices', () => {
  const p = g.previewImport(src.getId(), 'Buyers');
  const r = g.runImport(src.getId(), 'Buyers', p.mapping, { defaultTier: 'Gold', updateExisting: true });
  assert.strictEqual(r.added, 4);
  assert.strictEqual(r.invalid.length, 1);
  assert.strictEqual(r.duplicatesInFile, 1);
  const inv = g.listInvestors();
  const marcus = inv.find(i => i.email === 'marcus@reedcapital.com');
  assert.strictEqual(marcus.firstName, 'Marcus');
  assert.strictEqual(marcus.lastName, 'Reed');
  assert.strictEqual(marcus.maxPrice, 250000);
  assert.strictEqual(marcus.phone, '+1 (404) 555-0101', 'phone with leading + survives (no formula)');
  assert.strictEqual(marcus.tier, 'Gold');
  assert.strictEqual(inv.find(i => i.email === 'kevin@parkholdings.co').maxPrice, 1200000);
  assert.strictEqual(inv.find(i => i.email === 'dortiz@example.com').markets, 'Atlanta Metro, Macon');
  const again = g.runImport(src.getId(), 'Buyers', p.mapping, { updateExisting: false });
  assert.strictEqual(again.added, 0);
  assert.strictEqual(again.skipped, 4);
});

let platinumId;
step('saveInvestor creates, validates, dedupes and blocks formula injection', () => {
  const v = g.saveInvestor({ firstName: '=HYPERLINK("http://evil")', lastName: 'Vance', email: 'Victoria@VanceCap.com', tier: 'Platinum', categories: ['Fix & Flip', 'Private Lender'], propertyTypes: 'Single Family', minPrice: '100000', maxPrice: '400,000', markets: 'Atlanta Metro' });
  platinumId = v.id;
  assert(/^INV-\d{5}$/.test(v.id));
  assert.strictEqual(v.email, 'victoria@vancecap.com');
  assert.strictEqual(v.firstName, '=HYPERLINK("http://evil")', 'stored as text, not a formula');
  throwsMsg(() => g.saveInvestor({ firstName: 'X', email: 'VICTORIA@vancecap.com' }), /already uses/);
  throwsMsg(() => g.saveInvestor({ firstName: 'X', email: 'nope' }), /valid email/);
  const upd = g.saveInvestor(Object.assign({}, v, { firstName: 'Victoria' }));
  assert.strictEqual(upd.firstName, 'Victoria');
  assert.strictEqual(g.listInvestors().length, 5);
});

step('bulk categorize + deactivate investors', () => {
  const ids = g.listInvestors().filter(i => i.email === 'kevin@parkholdings.co' || i.email === 'sasha@grantre.com').map(i => i.id);
  g.updateInvestors(ids, { tier: 'Silver', addCategory: 'Cash Buyer' });
  let inv = g.listInvestors();
  assert(inv.filter(i => ids.includes(i.id)).every(i => i.tier === 'Silver' && i.categories.includes('Cash Buyer')));
  const kevin = inv.find(i => i.email === 'kevin@parkholdings.co');
  g.updateInvestors([kevin.id], { status: 'Inactive' });
  inv = g.listInvestors();
  assert.strictEqual(inv.find(i => i.id === kevin.id).status, 'Inactive');
});

// --- deals ---
let deal;
step('saveDeal creates a deal with all submission fields', () => {
  deal = g.saveDeal({
    address: '1847 Magnolia Ridge Dr', city: 'Decatur', state: 'ga', zip: '03030', market: 'Atlanta Metro', propertyType: 'Single Family',
    askingPrice: '$185,000', assignmentPrice: '15000', showAssignment: false, arv: '310000', repairs: '45,000', sqft: '1640', beds: '3', baths: '2',
    lotSize: '0.31 acres', yearBuilt: '1978', description: 'Brick ranch on a quiet cul-de-sac.\n\nNeeds kitchen, baths, HVAC.', closingDate: '2026-12-15',
    access: 'Open house Saturday 10am-12pm', showAccess: true, videoUrl: 'https://youtu.be/abc123', internalNotes: 'Lockbox 4471'
  });
  assert(/^SDI-\d{4}-0001$/.test(deal.id), deal.id);
  assert.strictEqual(deal.state, 'GA');
  assert.strictEqual(deal.zip, '03030', 'leading zero kept');
  assert.strictEqual(deal.askingPrice, 185000);
  assert.strictEqual(deal.metrics.spread, 80000);
  assert.strictEqual(deal.status, 'Available');
  throwsMsg(() => g.saveDeal({ address: 'x', askingPrice: 1, videoUrl: 'javascript:alert(1)' }), /http/);
  throwsMsg(() => g.saveDeal({ city: 'x' }), /address/);
});

step('photo upload, cover, previews', () => {
  const r1 = g.uploadDealPhoto(deal.id, 'front.jpg', 'image/png', 'data:image/png;base64,' + PNG);
  const r2 = g.uploadDealPhoto(deal.id, 'kitchen.jpg', 'image/png', PNG);
  assert.strictEqual(r2.photoIds.length, 2);
  g.setCoverPhoto(deal.id, r2.id);
  assert.strictEqual(g.getDeal(deal.id).photoIds[0], r2.id);
  const prev = g.getDealPhotoPreviews(deal.id);
  assert(prev[0].dataUrl.startsWith('data:image/png;base64,'));
  throwsMsg(() => g.uploadDealPhoto(deal.id, 'x.pdf', 'application/pdf', PNG), /image/);
  const folder = M.folders[g.getDeal(deal.id).folderId];
  assert.strictEqual(folder.sharing, 'ANYONE_WITH_LINK');
});

step('email preview renders branded email with all deal details', () => {
  const p = g.getEmailPreview(deal.id);
  assert(p.subject.includes('1847 Magnolia Ridge Dr') && p.subject.includes(deal.id) && p.subject.includes('$185,000'), p.subject);
  ['$185,000', '$310,000', '$45,000', '$80,000', '1,640 sq ft', '0.31 acres', 'December 15, 2026', 'Open house Saturday', 'youtu.be/abc123', "I'M INTERESTED", 'Hi Alex', 'Brick ranch', 'data:image/png;base64']
    .forEach(s => assert(p.html.includes(s), 'missing ' + s));
  assert(!p.html.includes('$15,000'), 'assignment price hidden when unchecked');
  assert(!p.html.includes('Lockbox'), 'internal notes never emailed');
  assert(!/\{\{[A-Z_]+\}\}/.test(p.html), 'all placeholders filled');
});

// --- audience ---
step('audience: all / segments / buy-box match / hand-picked', () => {
  const all = g.previewAudience(deal.id, { mode: 'all' });
  assert.strictEqual(all.count, 4, 'Kevin inactive is excluded');
  assert.strictEqual(all.excluded.inactive, 1);
  const seg = g.previewAudience(deal.id, { mode: 'segments', tiers: ['Platinum', 'Gold'] });
  assert.strictEqual(seg.count, 3);
  const cat = g.previewAudience(deal.id, { mode: 'segments', categories: ['BRRRR'] });
  assert.strictEqual(cat.count, 1);
  const match = g.previewAudience(deal.id, { mode: 'all', matchCriteria: true });
  // Danielle max 180k < 185k → excluded; Marcus 250k ok; Sasha no limit; Victoria 100-400k SFR ok
  assert.strictEqual(match.count, 3);
  assert.strictEqual(match.excluded.criteria, 1);
  const pick = g.previewAudience(deal.id, { mode: 'selected', investorIds: [platinumId] });
  assert.strictEqual(pick.count, 1);
});

// --- test mode distribution ---
step('TEST mode: full run, only N delivered to test address, investors untouched', () => {
  M.sent = [];
  const prep = g.prepareDistribution(deal.id, { mode: 'all' });
  assert.strictEqual(prep.mode, 'TEST');
  assert.strictEqual(prep.recipientCount, 4);
  assert.strictEqual(prep.testDeliveries, 3);
  const job = g.confirmDistribution(prep.token, '');
  assert.strictEqual(M.sent.length, 3);
  assert(M.sent.every(m => m.to === M.user), 'all test mail to test address');
  assert(M.sent.every(m => m.subject.startsWith('[TEST] ')));
  assert(M.sent[0].opts.htmlBody.includes('TEST MODE'), 'test banner');
  assert(M.sent[0].opts.inlineImages && M.sent[0].opts.inlineImages.photo0, 'photos embedded inline');
  assert.strictEqual(job.status, 'Completed');
  assert.strictEqual(Number(job.sent), 3);
  assert.strictEqual(Number(job.simulated), 1);
  assert(g.listInvestors().every(i => i.dealsReceived === 0), 'test sends do not count as deals received');
  assert.strictEqual(g.getDeal(deal.id).timesDistributed, 0);
  throwsMsg(() => g.confirmDistribution(prep.token, ''), /expired/);
});

step('sendTestEmail sends one preview', () => {
  M.sent = [];
  g.sendTestEmail(deal.id, 'boss@samedayinvestments.com');
  assert.strictEqual(M.sent.length, 1);
  assert.strictEqual(M.sent[0].to, 'boss@samedayinvestments.com');
});

// --- go live ---
step('going live requires GO LIVE + a mailing address', () => {
  throwsMsg(() => g.setTestMode(false, 'yes'), /GO LIVE/);
  throwsMsg(() => g.setTestMode(false, 'GO LIVE'), /mailing address/);
  g.saveSettings({ COMPANY_ADDRESS: '100 Peachtree St NW, Atlanta, GA 30303', CONTACT_NAME: 'Jordan Hale', CONTACT_PHONE: '(404) 555-0100', TEST_MODE: 'FALSE' });
  assert.strictEqual(g.getSettings().testMode, true, 'saveSettings cannot flip TEST_MODE');
  const s = g.setTestMode(false, 'go live');
  assert.strictEqual(s.testMode, false);
});

let liveSent;
step('LIVE: requires typed SEND; one individual email per investor; nobody sees another address', () => {
  M.sent = [];
  const prep = g.prepareDistribution(deal.id, { mode: 'all' });
  assert.strictEqual(prep.mode, 'LIVE');
  throwsMsg(() => g.confirmDistribution(prep.token, 'yes'), /Type SEND/);
  const job = g.confirmDistribution(prep.token, 'SEND');
  liveSent = M.sent.slice();
  const emails = g.listInvestors().filter(i => i.status === 'Active').map(i => i.email);
  assert.strictEqual(liveSent.length, 4);
  assert.strictEqual(JSON.stringify(liveSent.map(m => m.to).sort()), JSON.stringify(emails.slice().sort()));
  liveSent.forEach(m => {
    emails.filter(e => e !== m.to).forEach(other => {
      assert(!m.opts.htmlBody.includes(other) && !m.body.includes(other), 'leaked ' + other + ' to ' + m.to);
    });
    assert(!m.subject.startsWith('[TEST]'));
    assert(!m.opts.htmlBody.includes('TEST MODE'));
    assert(m.opts.htmlBody.includes('100 Peachtree St NW'), 'CAN-SPAM address');
    assert(m.opts.htmlBody.includes('Unsubscribe'));
  });
  const marcusMail = liveSent.find(m => m.to === 'marcus@reedcapital.com');
  assert(marcusMail.opts.htmlBody.includes('Hi Marcus,'), 'personalized');
  assert.strictEqual(job.status, 'Completed');
  const d = g.getDeal(deal.id);
  assert.strictEqual(d.timesDistributed, 1);
  assert.strictEqual(d.totalRecipients, 4);
  assert(d.lastDistributed);
  const inv = g.listInvestors().filter(i => i.status === 'Active');
  assert(inv.every(i => i.dealsReceived === 1 && i.lastSent), 'investor tracking updated');
});

step('re-distribution can skip investors who already received the deal', () => {
  const p = g.previewAudience(deal.id, { mode: 'all', excludeAlreadySent: true });
  assert.strictEqual(p.count, 0);
  assert.strictEqual(p.excluded.alreadySent, 4);
  throwsMsg(() => g.prepareDistribution(deal.id, { mode: 'all', excludeAlreadySent: true }), /No investors/);
});

let deal2;
step('daily quota: sends what fits, queues the rest, resumes via trigger', () => {
  deal2 = g.saveDeal({ address: '22 Oak Hollow Ln', city: 'Marietta', state: 'GA', askingPrice: 142000, arv: 240000, repairs: 38000, propertyType: 'Single Family', market: 'Atlanta Metro' });
  M.sent = []; M.quota = 2; M.triggers = [];
  const prep = g.prepareDistribution(deal2.id, { mode: 'all' });
  const job = g.confirmDistribution(prep.token, 'SEND');
  assert.strictEqual(M.sent.length, 2);
  assert.strictEqual(job.queued, 2);
  assert(/Paused/.test(job.status), job.status);
  assert(M.triggers.some(t => t.getHandlerFunction() === 'runQueuedDistributions'), 'continuation trigger scheduled');
  assert.strictEqual(g.getDeal(deal2.id).timesDistributed, 0, 'not counted until complete');
  M.quota = 100;
  g.runQueuedDistributions();
  assert.strictEqual(M.sent.length, 4);
  assert.strictEqual(new Set(M.sent.map(m => m.to)).size, 4, 'no investor emailed twice');
  const done = g.getJobStatus(job.id);
  assert.strictEqual(done.status, 'Completed');
  assert.strictEqual(g.getDeal(deal2.id).timesDistributed, 1);
  assert(!M.triggers.some(t => t.getHandlerFunction() === 'runQueuedDistributions'), 'trigger cleaned up');
  assert(!M.isLocked(), 'lock released');
});

// --- responses ---
step('inbox scan logs interested / offer / unsubscribe replies and dedupes', () => {
  const victoria = g.listInvestors().find(i => i.id === platinumId);
  M.inbox = [
    { id: 'm1', from: 'Marcus Reed <marcus@reedcapital.com>', subject: 'INTERESTED - ' + deal.id + ' - 1847 Magnolia Ridge Dr', body: "Hi, I'm interested. Call me.\n\nDeal: " + deal.id },
    { id: 'm2', from: 'victoria@vancecap.com', subject: 'Re: Off-Market Opportunity | 1847 Magnolia Ridge Dr [' + deal.id + ']', body: 'We can do an offer of $172,500 cash, close in 14 days.\n\nOn Tue, someone wrote:\n> old stuff' },
    { id: 'm3', from: 'Sasha Grant <sasha@grantre.com>', subject: 'UNSUBSCRIBE', body: 'Please remove me.\n\nInvestor ref: INV-00004' },
    { id: 'm4', from: 'random@spam.com', subject: 'Hello', body: 'no deal id' }
  ];
  const r = g.scanInboxForResponses();
  assert.strictEqual(r.found, 3);
  assert.strictEqual(r.unsubscribed, 1);
  const resp = g.listResponses();
  const offer = resp.find(x => x.investorEmail === 'victoria@vancecap.com');
  assert.strictEqual(offer.type, 'Offer');
  assert.strictEqual(offer.offerAmount, 172500);
  assert.strictEqual(offer.investorId, victoria.id);
  assert(!offer.message.includes('old stuff'), 'quoted text stripped');
  assert.strictEqual(resp.find(x => x.investorEmail === 'marcus@reedcapital.com').type, 'Interested');
  assert(g.listInvestors().find(i => i.email === 'sasha@grantre.com').optOut, 'unsubscribed investor opted out');
  const d = g.getDeal(deal.id);
  assert.strictEqual(d.interested, 2);
  assert.strictEqual(d.responses, 2);
  assert.strictEqual(g.scanInboxForResponses().found, 0, 'dedupe by message id');
});

step('opted-out investors are excluded from future distributions', () => {
  const p = g.previewAudience(deal2.id, { mode: 'all' });
  assert.strictEqual(p.count, 3);
  assert.strictEqual(p.excluded.optedOut, 1);
});

step('manual response logging + follow-up updates', () => {
  const r = g.logResponse({ dealId: deal2.id, investorName: 'Walk-in Buyer', investorEmail: 'walkin@x.com', type: 'Interested', message: 'Called the office' });
  const u = g.updateResponse(r.id, { followUp: 'Showing Scheduled', notes: 'Thu 3pm' });
  assert.strictEqual(u.followUp, 'Showing Scheduled');
  assert.strictEqual(g.getDeal(deal2.id).interested, 1);
});

step('deal status: pending / sold; sold deals cannot be distributed', () => {
  assert.strictEqual(g.setDealStatus(deal.id, 'Pending', { buyer: 'Marcus Reed' }).status, 'Pending');
  const sold = g.setDealStatus(deal.id, 'Sold', { buyer: 'Marcus Reed', soldPrice: '$190,000' });
  assert.strictEqual(sold.status, 'Sold');
  assert.strictEqual(sold.soldPrice, 190000);
  throwsMsg(() => g.prepareDistribution(deal.id, { mode: 'all' }), /SOLD/);
  assert.strictEqual(g.setDealStatus(deal.id, 'Available').status, 'Available');
});

step('tracking + bootstrap payloads are serializable (no Date objects)', () => {
  const t = g.getDealTracking(deal.id);
  assert(t.recipients.length >= 8 && t.jobs.length === 2 && t.responses.length === 2);
  noDates(t, 'tracking');
  const b = g.getBootstrap();
  noDates(b, 'bootstrap');
  assert.strictEqual(b.dashboard.emails30d, 8);
  assert.strictEqual(b.dashboard.deals.Available, 2);
  noDates(g.listJobs(), 'jobs');
});

step('cancelJob stops queued sends', () => {
  const d3 = g.saveDeal({ address: '9 Pine St', askingPrice: 99000 });
  M.quota = 1; M.sent = [];
  const prep = g.prepareDistribution(d3.id, { mode: 'all' });
  const job = g.confirmDistribution(prep.token, 'SEND');
  assert.strictEqual(job.queued, 2);
  const c = g.cancelJob(job.id);
  assert.strictEqual(c.queued, 0);
  assert.strictEqual(c.status, 'Cancelled');
  M.quota = 100;
  g.runQueuedDistributions();
  assert.strictEqual(M.sent.length, 1);
});

step('deleteInvestors requires DELETE', () => {
  const kevin = g.listInvestors().find(i => i.email === 'kevin@parkholdings.co');
  throwsMsg(() => g.deleteInvestors([kevin.id], 'ok'), /DELETE/);
  assert.strictEqual(g.deleteInvestors([kevin.id], 'DELETE').deleted, 1);
  assert(!g.listInvestors().some(i => i.id === kevin.id));
});


// ---------------- New buyer intake ----------------
step('signup form: created with buy-box questions + instant trigger', () => {
  g.saveSettings({ MARKETS: 'Atlanta Metro, Macon, Savannah' });
  const st = g.createBuyerSignupForm();
  assert(st.form && st.form.url.includes('viewform'));
  assert(M.triggers.some(t => t.getHandlerFunction() === 'onBuyerFormSubmit'), 'form submit trigger');
  const form = M.forms[st.form.id];
  const titles = form.items.map(i => i.title);
  ['First name', 'Email', 'Markets you buy in', 'Property types', 'How do you invest?', 'Maximum purchase price', 'Describe your buy box', 'Deal alerts'].forEach(t => assert(titles.includes(t), t));
  assert.strictEqual(form.items.find(i => i.title === 'Markets you buy in').choices.length, 3);
  assert(form.items.find(i => i.title === 'Deal alerts').required, 'consent required');
  assert.strictEqual(g.createBuyerSignupForm().form.id, st.form.id, 'idempotent');
});

step('form submissions land in the review queue, never active', () => {
  const st = g.getIntakeStatus();
  const form = M.forms[st.form.id];
  form._submit({ 'First name': 'jamal', 'Last name': 'BROOKS', 'Email': 'Jamal@BrooksBuys.com', 'Mobile phone': '404-555-0111',
    'Markets you buy in': ['Atlanta Metro', 'Macon'], 'Property types': ['Single Family'], 'How do you invest?': ['Fix & Flip'],
    'Minimum purchase price': '$90,000', 'Maximum purchase price': '220k', 'Describe your buy box': '3/2, light rehab', 'How do you fund purchases?': 'Cash',
    'Deal alerts': ['Yes'] });
  g.onBuyerFormSubmit();
  const j = g.listInvestors().find(i => i.email === 'jamal@brooksbuys.com');
  assert(j, 'added');
  assert.strictEqual(j.status, 'Pending Review');
  assert.strictEqual(j.firstName, 'jamal');
  assert.strictEqual(j.lastName, 'Brooks');
  assert.strictEqual(j.maxPrice, 220000);
  assert.strictEqual(j.markets, 'Atlanta Metro, Macon');
  assert(/Funding: Cash/.test(j.notes));
  assert.strictEqual(j.source, 'Signup form');
  g.onBuyerFormSubmit();
  assert.strictEqual(g.listInvestors().filter(i => i.email === 'jamal@brooksbuys.com').length, 1, 'not added twice');
  const d = g.listDeals().find(x => x.status === 'Available');
  assert(!g.previewAudience(d.id, { mode: 'all' }).recipients.some(r => r.email === 'jamal@brooksbuys.com'), 'pending buyers never get deals');
});

let cashSrc;
step('cash-buyer export: grouped by owner, financed + old sales excluded, buy box from purchases', () => {
  cashSrc = new M.Spreadsheet('PropStream Export');
  const t = cashSrc.insertSheet('Recent Cash Sales');
  const recent = (d) => { const x = new Date(Date.now() - d * 86400000); return (x.getMonth() + 1) + '/' + x.getDate() + '/' + x.getFullYear(); };
  t.data = [
    ['Address', 'City', 'State', 'Zip', 'Property Type', 'Owner 1 Full Name', 'Mailing Address', 'Mailing City', 'Mailing State', 'Mailing Zip', 'Last Sale Date', 'Last Sale Amount', 'Open Mortgage Balance', 'Email 1', 'Phone 1'],
    ['12 ELM ST', 'DECATUR', 'GA', '30030', 'SFR', 'PEACH STATE HOMES LLC', '500 MAIN ST', 'ATLANTA', 'GA', '30303', recent(20), '$150,000', '0', '', ''],
    ['88 PINE AVE', 'MACON', 'GA', '31204', 'Single Family Residential', 'PEACH STATE HOMES LLC', '500 MAIN ST', 'ATLANTA', 'GA', '30303', recent(60), '$95,000', '0', '', ''],
    ['4 OAK CT', 'TUCKER', 'GA', '30084', 'Duplex', 'CARTER, DENISE', '9 RIVER RD', 'TUCKER', 'GA', '30084', recent(10), '$210,000', '', 'denise.carter@gmail.com', '(770) 555-0123'],
    ['77 FINANCED LN', 'DECATUR', 'GA', '30030', 'SFR', 'MORTGAGE MIKE', '1 BANK ST', 'DECATUR', 'GA', '30030', recent(5), '$300,000', '240000', 'mike@x.com', ''],
    ['3 OLD RD', 'DECATUR', 'GA', '30030', 'SFR', 'OLD SALE OWNER', '3 OLD RD', 'DECATUR', 'GA', '30030', recent(800), '$80,000', '0', 'old@x.com', '']
  ];
  const prev = g.previewBuyerSource('cash', cashSrc.getId(), 'Recent Cash Sales');
  assert.strictEqual(prev.buyers, 2, JSON.stringify(prev));
  assert.strictEqual(prev.columns.ownerName, 'Owner 1 Full Name');
  assert.strictEqual(prev.columns.mailAddr, 'Mailing Address');
  g.saveSettings({ INTAKE_CASH_ON: 'TRUE', INTAKE_CASH_URL: cashSrc.getUrl(), INTAKE_CASH_TAB: 'Recent Cash Sales' });
  M.sent = [];
  const r = g.runBuyerIntake();
  assert.strictEqual(r.results.cash.status, 'ok', JSON.stringify(r.results.cash));
  assert.strictEqual(r.results.cash.added, 2);
  const inv = g.listInvestors();
  const llc = inv.find(i => i.company === 'Peach State Homes LLC');
  assert(llc, 'entity owner kept as company');
  assert.strictEqual(llc.status, 'Pending Review');
  assert.strictEqual(llc.email, '');
  assert.strictEqual(llc.purchaseCount, 2);
  assert.strictEqual(llc.markets, 'Decatur, Macon');
  assert.strictEqual(llc.propertyTypes, 'Single Family');
  assert.strictEqual(llc.minPrice, 75000);
  assert.strictEqual(llc.maxPrice, 180000);
  assert(/12 Elm St, Decatur — \$150,000/.test(llc.purchases), llc.purchases);
  assert.strictEqual(llc.mailingAddress, '500 Main St, Atlanta, GA 30303');
  const denise = inv.find(i => i.email === 'denise.carter@gmail.com');
  assert.strictEqual(denise.firstName, 'Denise'); assert.strictEqual(denise.lastName, 'Carter');
  assert.strictEqual(denise.propertyTypes, 'Multi-Family (2-4)');
  assert(!inv.some(i => i.email === 'mike@x.com' || i.email === 'old@x.com'), 'financed / old sales excluded');
  assert(M.sent.some(m => /new buyers? to review/.test(m.subject)), 'daily summary email');
  // a new purchase by the same LLC updates its history instead of duplicating
  t.data.push(['9 NEW ST', 'DECATUR', 'GA', '30030', 'SFR', 'PEACH STATE HOMES LLC', '500 MAIN ST', 'ATLANTA', 'GA', '30303', recent(1), '$160,000', '0', '', '']);
  const r2 = g.runBuyerIntake();
  assert.strictEqual(r2.results.cash.added, 0);
  assert.strictEqual(r2.results.cash.updated, 1);
  assert.strictEqual(g.listInvestors().filter(i => i.company === 'Peach State Homes LLC').length, 1);
  assert.strictEqual(g.listInvestors().find(i => i.company === 'Peach State Homes LLC').purchaseCount, 3);
});

step('approving requires an email; approved buyers start receiving deals', () => {
  const inv = g.listInvestors();
  const llc = inv.find(i => i.company === 'Peach State Homes LLC');
  const denise = inv.find(i => i.email === 'denise.carter@gmail.com');
  const r = g.updateInvestors([llc.id, denise.id], { status: 'Active' });
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(r.skippedNoEmail.length, 1);
  throwsMsg(() => g.saveInvestor(Object.assign({}, llc, { status: 'Active' })), /email address is required/);
  const saved = g.saveInvestor(Object.assign({}, llc, { email: 'acq@peachstatehomes.com' }));
  assert.strictEqual(saved.status, 'Pending Review');
  assert.strictEqual(saved.purchaseCount, 3, 'editing keeps purchase history');
  const d = g.listDeals().find(x => x.status === 'Available');
  assert(g.previewAudience(d.id, { mode: 'all' }).recipients.some(x => x.email === 'denise.carter@gmail.com'));
});

step('Google Sheet sync adds only new buyers each day', () => {
  const vs = new M.Spreadsheet('VA Buyer Adds');
  const t = vs.insertSheet('New');
  t.data = [['Name', 'Email', 'Phone', 'Buyer Type', 'Areas', 'Budget'],
    ['Omar Haddad', 'omar@haddadhomes.com', '404-555-0190', 'Buy & Hold', 'Atlanta Metro', '$175k'],
    ['Marcus Reed', 'marcus@reedcapital.com', '', '', '', ''],
    ['No Email Guy', '', '555-0000', '', '', '']];
  g.saveSettings({ INTAKE_SHEET_ON: 'TRUE', INTAKE_SHEET_URL: vs.getUrl(), INTAKE_SHEET_TAB: 'New' });
  const r = g.runBuyerIntake();
  assert.strictEqual(r.results.sheet.added, 1, JSON.stringify(r.results.sheet));
  assert.strictEqual(r.results.sheet.duplicate, 1);
  assert.strictEqual(r.results.sheet.skipped, 1);
  const omar = g.listInvestors().find(i => i.email === 'omar@haddadhomes.com');
  assert.strictEqual(omar.status, 'Pending Review'); assert.strictEqual(omar.maxPrice, 175000);
  const r2 = g.runBuyerIntake();
  assert.strictEqual(r2.results.sheet.added + r2.results.sheet.duplicate + r2.results.sheet.skipped, 0, 'rows only processed once');
});

step('Gmail: buyer inquiries become leads with parsed buy box; deal replies ignored', () => {
  M.inbox = [
    { id: 'g1', from: 'Lisa Nguyen <lisa@nguyenventures.com>', subject: 'Please add me to your buyers list', body: 'Hi! I buy single family and duplexes in Atlanta Metro and Macon, $80k-$250k, light rehab flips. Cash buyer. Cell 678-555-0142.\n\nOn Mon, X wrote:\n> old' },
    { id: 'g2', from: 'marcus@reedcapital.com', subject: 'Re: deal [SDI-2026-0001]', body: 'Send me deals like this, cash buyer here' },
    { id: 'g3', from: 'spam@ads.com', subject: 'Grow your business', body: 'Buy our SEO' }
  ];
  const r = g.runBuyerIntake();
  assert.strictEqual(r.results.gmail.added, 1, JSON.stringify(r.results.gmail));
  const lisa = g.listInvestors().find(i => i.email === 'lisa@nguyenventures.com');
  assert.strictEqual(lisa.firstName, 'Lisa'); assert.strictEqual(lisa.lastName, 'Nguyen');
  assert.strictEqual(lisa.phone, '678-555-0142');
  assert.strictEqual(lisa.minPrice, 80000); assert.strictEqual(lisa.maxPrice, 250000);
  assert.strictEqual(lisa.markets, 'Atlanta Metro, Macon');
  assert(/Single Family/.test(lisa.propertyTypes) && /Multi-Family \(2-4\)/.test(lisa.propertyTypes), lisa.propertyTypes);
  assert(/Fix & Flip/.test(lisa.categories) && /Cash Buyer/.test(lisa.categories), lisa.categories);
  assert.strictEqual(lisa.status, 'Pending Review');
  assert.strictEqual(g.runBuyerIntake().results.gmail.added, 0, 'same email not processed twice');
});

step('daily schedule + intake status + log are serializable', () => {
  g.enableDailyIntake(7);
  assert(M.triggers.some(t => t.getHandlerFunction() === 'runBuyerIntake' && /1d @7/.test(t.kind)));
  const st = g.getIntakeStatus();
  noDates(st, 'intake');
  assert.strictEqual(st.daily, true);
  assert(st.pending >= 3);
  assert(st.log.length >= 6);
  assert.strictEqual(g.getDashboard().investors.pending, st.pending);
  g.disableDailyIntake();
  assert(!g.getIntakeStatus().daily);
  assert(!M.isLocked());
});


// ---------------- Public records: DealMachine + Norfolk ----------------
const daysAgo = (d) => { const x = new Date(Date.now() - d * 86400000); return x.toISOString().slice(0, 10); };
const dmFilters = { data: [
  { filter_id: 'property_type', options: [{ option_id: 1, label: 'Single Family' }, { option_id: 9, label: 'Vacant Land' }, { option_id: 10, label: 'Development Site' }] },
  { filter_id: 'additional_property_types', options: [{ option_id: 101, label: 'Residential Vacant Land' }, { option_id: 102, label: 'Commercial Vacant Land' }, { option_id: 103, label: 'Single Family Residential' }] }
], pagination: { has_next_page: false } };
const prop = (id, addr, city, owner, date, price, typeId, contacts, mailing) => ({
  dm_property_id: id, full_address: addr + ', ' + city + ', VA', address: addr, city, state: 'VA', zip: '23500',
  owner_1_full_name: owner, owner_mailing_address_full: mailing || '100 OFFICE PARK DR, NORFOLK, VA 23502',
  last_sale_date: date, last_sale_price: price, property_type: [typeId], contacts: contacts || []
});
const contact = (first, last, phones, emails) => ({ dm_person_id: 'per_' + first, first_name: first, last_name: last, full_name: first + ' ' + last, is_likely_owner: true, phones, emails });
let dmSearchBodies = [];
let dmData = {};
function dmHandler(url, opts) {
  const auth = (opts.headers || {}).Authorization || '';
  if (url.indexOf('api.v2.dealmachine.com/v1') === -1) return null;
  if (auth !== 'Bearer dm_sk_live_TESTKEY1234567890') return { code: 401, body: { error: { code: 'unauthorized', message: 'bad key' } } };
  if (url.endsWith('/account')) return { code: 200, body: { data: { id: 1 } } };
  if (url.indexOf('/filters?') > -1) return { code: 200, body: dmFilters };
  const body = JSON.parse(opts.payload || '{}');
  const f = (id) => body.filters.find(x => x.filter_id === id);
  const kind = f('additional_property_types') ? 'land' : f('is_mortgage_1_private_lender') ? 'hard' : 'cash';
  if (url.endsWith('/properties/search/count')) return { code: 200, body: { total_properties: { cash: 40, hard: 12, land: 7 }[kind] * body.locations.length, total_people: 0, total_results: 0 } };
  dmSearchBodies.push(body);
  const all = (dmData[kind] || []).filter(p => body.locations.some(l => l.code === p._fips));
  const start = (body.page - 1) * body.per_page, rows = all.slice(start, start + body.per_page);
  return { code: 200, body: { data: rows, pagination: { page: body.page, per_page: body.per_page, has_next_page: start + body.per_page < all.length }, credits: { used: rows.length * 2 } } };
}

step('DealMachine key: format checked, verified against the API, stored privately', () => {
  M.fetchHandler = dmHandler;
  throwsMsg(() => g.saveDealMachineKey('abc123'), /dm_sk_live_/);
  throwsMsg(() => g.saveDealMachineKey('dm_sk_live_WRONGKEY99999999'), /rejected the API key/);
  assert(!M.props.DM_API_KEY, 'bad key not stored');
  const st = g.saveDealMachineKey('dm_sk_live_TESTKEY1234567890');
  assert.strictEqual(st.dm.hasKey, true);
  assert.strictEqual(st.dm.keyHint, '…7890');
  assert(!JSON.stringify(g.getSettings()).includes('TESTKEY'), 'key never in settings/sheet');
  assert(!JSON.stringify(st).includes('TESTKEY1234'), 'key never sent to the browser');
});

step('DealMachine: cash, hard-money and new-construction land buyers become grouped buyer leads', () => {
  dmData = {
    cash: [
      Object.assign(prop('p1', '12 Elm St', 'Norfolk', 'TIDEWATER HOME BUYERS LLC', daysAgo(3), 155000, 1, [contact('Ray', 'Coles', [{ number: '7575550101', type: 'wireless', do_not_call: false }], [{ address: 'Ray@TidewaterHB.com', verification_status: 'very_likely_deliverable' }])]), { _fips: '51710' }),
      Object.assign(prop('p2', '40 Bay Ave', 'Hampton', 'TIDEWATER HOME BUYERS LLC', daysAgo(9), 129000, 1, []), { _fips: '51650' }),
      Object.assign(prop('p3', '9 River Rd', 'Richmond', 'SMITH, KAREN', daysAgo(5), 210000, 1, [contact('Karen', 'Smith', [{ number: '8045550199', type: 'landline', do_not_call: true }], [])], '9 MAIN ST, RICHMOND, VA 23220'), { _fips: '51760' })
    ],
    hard: [Object.assign(prop('p4', '77 Oak Ct', 'Chesapeake', 'FLIPRIGHT VENTURES LLC', daysAgo(4), 98000, 1, [contact('Dana', 'Reyes', [{ number: '7575550177', type: 'wireless', do_not_call: false }], [{ address: 'dana@flipright.co' }])]), { _fips: '51550' })],
    land: [
      Object.assign(prop('p5', 'Lot 4 Shore Dr', 'Elizabeth City', 'COASTAL NEW HOMES BUILDERS INC', daysAgo(6), 45000, 9, [contact('Lee', 'Park', [], [{ address: 'lee@coastalnewhomes.com' }])]), { _fips: '37139' }),
      Object.assign(prop('p6', 'Lot 5 Shore Dr', 'Elizabeth City', 'COASTAL NEW HOMES BUILDERS INC', daysAgo(6), 47000, 9, []), { _fips: '37139' })
    ]
  };
  dmSearchBodies = [];
  g.saveSettings({ INTAKE_DM_ON: 'TRUE', INTAKE_COUNTY_ON: 'FALSE', INTAKE_CASH_ON: 'FALSE', INTAKE_SHEET_ON: 'FALSE', INTAKE_GMAIL_ON: 'FALSE', INTAKE_FORM_ON: 'FALSE' });
  const r = g.runBuyerIntake();
  assert.strictEqual(r.results.dealmachine.status, 'ok', JSON.stringify(r.results.dealmachine));
  assert.strictEqual(r.results.dealmachine.added, 4, JSON.stringify(r.results.dealmachine));
  // request shape
  const b0 = dmSearchBodies[0];
  assert.strictEqual(b0.anchor, 'properties'); assert.strictEqual(b0.contact_audience, 'owners');
  assert.strictEqual(b0.locations.length, 15, 'max 15 locations per request');
  assert(dmSearchBodies.some(b => b.locations.length === 7), '22 counties split 15 + 7');
  const lsd = b0.filters.find(x => x.filter_id === 'last_sale_date');
  assert.strictEqual(JSON.stringify(lsd.value), JSON.stringify({ value: 14, unit: 'days', direction: 'ago', comparison: 'less_than' }));
  assert(b0.filters.some(x => x.filter_id === 'num_mortgages' && x.value === 0 && x.operator === 'equals'));
  assert(b0.filters.some(x => x.filter_id === 'has_absentee_owners' && x.value === true));
  const land = dmSearchBodies.find(b => b.filters.some(x => x.filter_id === 'additional_property_types'));
  assert.strictEqual(JSON.stringify(land.filters.find(x => x.filter_id === 'additional_property_types').value), '[101]', 'residential land only');
  assert(land.filters.some(x => x.filter_id === 'ppm_num_properties_owned_by_owner' && x.operator === 'greater_than_or_equal' && x.value === 2));
  assert(!land.filters.some(x => x.filter_id === 'has_absentee_owners'));
  // leads
  const inv = g.listInvestors();
  const tw = inv.find(i => i.company === 'Tidewater Home Buyers LLC');
  assert(tw, 'LLC grouped'); assert.strictEqual(tw.purchaseCount, 2);
  assert.strictEqual(tw.firstName, 'Ray'); assert.strictEqual(tw.email, 'ray@tidewaterhb.com'); assert.strictEqual(tw.phone, '(757) 555-0101');
  assert.strictEqual(tw.markets, 'Norfolk, Hampton'); assert(/Cash Buyer/.test(tw.categories)); assert.strictEqual(tw.status, 'Pending Review');
  assert(/with cash/.test(tw.criteria));
  const karen = inv.find(i => i.lastName === 'Smith' && i.firstName === 'Karen');
  assert.strictEqual(karen.phone, '', 'Do-Not-Call phone not stored as the contact number');
  assert(/Do-Not-Call/.test(karen.notes));
  const fr = inv.find(i => i.company === 'Flipright Ventures LLC');
  assert(/with hard money/.test(fr.criteria), fr.criteria);
  const coastal = inv.find(i => i.company === 'Coastal New Homes Builders Inc');
  assert(coastal, 'land buyer added'); assert.strictEqual(coastal.purchaseCount, 2);
  assert(/Developer/.test(coastal.categories) && /Cash Buyer/.test(coastal.categories), coastal.categories);
  assert.strictEqual(coastal.propertyTypes, 'Land');
  assert(/^New-construction \/ land buyer\. Bought 2 properties \(2 land\/lots\)/.test(coastal.criteria), coastal.criteria);
  assert.strictEqual(g.getIntakeStatus().dm.creditsThisMonth, 12, 'credits tracked from API response');
});

step('DealMachine: twice-a-day runs never re-add the same sale; a new purchase extends history', () => {
  const r = g.runBuyerIntake();
  assert.strictEqual(r.results.dealmachine.added + r.results.dealmachine.updated + r.results.dealmachine.duplicate, 0, JSON.stringify(r.results.dealmachine));
  dmData.cash.push(Object.assign(prop('p9', '5 Pine St', 'Portsmouth', 'TIDEWATER HOME BUYERS LLC', daysAgo(0), 140000, 1, []), { _fips: '51740' }));
  const r2 = g.runBuyerIntake();
  assert.strictEqual(r2.results.dealmachine.updated, 1, JSON.stringify(r2.results.dealmachine));
  const tw = g.listInvestors().filter(i => i.company === 'Tidewater Home Buyers LLC');
  assert.strictEqual(tw.length, 1); assert.strictEqual(tw[0].purchaseCount, 3);
  assert(/^5 Pine St, Portsmouth/.test(tw[0].purchases), tw[0].purchases);
});

step('DealMachine: per-run limit is shared fairly so land buyers still get searched; monthly cap stops pulls', () => {
  dmSearchBodies = [];
  g.saveSettings({ INTAKE_DM_MAX_PER_RUN: '3' });
  g.runBuyerIntake();
  const kinds = dmSearchBodies.map(b => b.filters.some(x => x.filter_id === 'additional_property_types') ? 'land' : b.filters.some(x => x.filter_id === 'is_mortgage_1_private_lender') ? 'hard' : 'cash');
  assert(kinds.includes('land') && kinds.includes('hard') && kinds.includes('cash'), kinds.join());
  assert(dmSearchBodies.every(b => b.per_page <= 1), 'per-kind share of 3');
  g.saveSettings({ INTAKE_DM_MAX_PER_RUN: '100', INTAKE_DM_MONTHLY_CAP: '5' });
  dmSearchBodies = [];
  const r = g.runBuyerIntake();
  assert.strictEqual(dmSearchBodies.length, 0, 'over the monthly cap: no paid searches');
  assert(/Monthly credit limit/.test(r.results.dealmachine.note), r.results.dealmachine.note);
  g.saveSettings({ INTAKE_DM_MONTHLY_CAP: '1500' });
});

step('DealMachine: free preview counts + friendly errors', () => {
  const pv = g.previewDealMachine();
  assert.strictEqual(pv.cash, 40 * 22); assert.strictEqual(pv.land, 7 * 22); assert.strictEqual(pv.counties, 22);
  const keep = M.fetchHandler;
  M.fetchHandler = (url, o) => url.indexOf('/properties/search') > -1 ? { code: 402, body: { error: { code: 'insufficient_credits' } } } : keep(url, o);
  const r = g.runBuyerIntake();
  assert.strictEqual(r.results.dealmachine.status, 'error');
  assert(/out of data credits/.test(r.results.dealmachine.note));
  M.fetchHandler = keep;
});

step('Norfolk county records (free): newest dataset found, company buyers kept, land buyers tagged Developer', () => {
  const nf = [
    { parcel_id: '1', grantee: 'Red Property Llc', transfer_date: daysAgo(4) + 'T00:00:00.000', consideration: '146901', property_street_number: '316', property_street_name: 'Poplar', property_street_type: 'AVE', property_city: 'Norfolk', property_use: 'Single Family - Detached' },
    { parcel_id: '2', grantee: 'New Beginnings Development Llc', transfer_date: daysAgo(6) + 'T00:00:00.000', consideration: '42000', property_street_number: '139', property_street_name: 'Filbert', property_street_type: 'ST', property_city: 'Norfolk', property_use: 'Vacant Land' },
    { parcel_id: '3', grantee: 'Jones Mary', transfer_date: daysAgo(2) + 'T00:00:00.000', consideration: '300000', property_street_number: '1', property_street_name: 'Main', property_city: 'Norfolk', property_use: 'Single Family - Detached' },
    { parcel_id: '4', grantee: 'Tidewater Home Buyers LLC', transfer_date: daysAgo(1) + 'T00:00:00.000', consideration: '99000', property_street_number: '8', property_street_name: 'Lee', property_city: 'Norfolk', property_use: 'Duplex' }
  ];
  let queried = '';
  M.fetchHandler = (url, o) => {
    if (url.indexOf('data.norfolk.gov/api/views/metadata') > -1) return { code: 200, body: [{ id: 'old1-fy26', name: 'Property Assessment and Sales - FY26' }, { id: 'qva7-tzrf', name: 'Property Assessment and Sales - FY27' }, { id: 'x', name: 'Delinquent Property Taxes' }] };
    if (url.indexOf('data.norfolk.gov/resource/') > -1) { queried = url; return { code: 200, body: nf }; }
    return dmHandler(url, o);
  };
  g.saveSettings({ INTAKE_COUNTY_ON: 'TRUE', INTAKE_DM_ON: 'FALSE' });
  const r = g.runBuyerIntake();
  assert.strictEqual(r.results.county.status, 'ok', JSON.stringify(r.results.county));
  assert(queried.indexOf('/resource/qva7-tzrf.json') > -1, 'uses newest fiscal-year dataset');
  assert(decodeURIComponent(queried).indexOf("transfer_date >= '") > -1);
  assert.strictEqual(r.results.county.added, 2, JSON.stringify(r.results.county));
  assert.strictEqual(r.results.county.updated, 1, 'known LLC gets the new purchase added');
  const inv = g.listInvestors();
  assert(!inv.some(i => i.lastName === 'Mary' || i.firstName === 'Jones'), 'individual homebuyers skipped by default');
  const nb = inv.find(i => i.company === 'New Beginnings Development Llc');
  assert(/Developer/.test(nb.categories)); assert.strictEqual(nb.propertyTypes, 'Land');
  assert.strictEqual(nb.status, 'Pending Review'); assert.strictEqual(nb.email, '');
  assert.strictEqual(g.listInvestors().filter(i => i.company === 'Tidewater Home Buyers LLC').length, 1, 'same company across sources = one buyer');
  assert.strictEqual(g.runBuyerIntake().results.county.added, 0, 'each recorded sale processed once');
});

step('morning + night schedule', () => {
  g.enableDailyIntake(6, 19);
  const t = M.triggers.filter(x => x.getHandlerFunction() === 'runBuyerIntake');
  assert.strictEqual(t.length, 2);
  assert(t.some(x => /@6$/.test(x.kind)) && t.some(x => /@19$/.test(x.kind)), t.map(x => x.kind).join());
  g.disableDailyIntake();
  assert.strictEqual(M.triggers.filter(x => x.getHandlerFunction() === 'runBuyerIntake').length, 0);
  assert(!M.isLocked());
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : '') + '\n');
