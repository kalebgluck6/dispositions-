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

console.log('\n' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : '') + '\n');
