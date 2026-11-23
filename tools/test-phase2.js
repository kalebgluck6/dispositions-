/**
 * Phase 2 tests: CEO dashboard, distribution analytics, heat scores, closing performance,
 * automatic tiers, price-reduction alerts, dead-deal recovery, reactivation, pass reasons,
 * competition, offer deadlines, land intelligence, markets, permissions.
 * Run:  node tools/test-phase2.js
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
const ago = (h) => new Date(Date.now() - h * 3600000);
const ymd = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const setRow = (sheet, key, val, fields) => { const r = g.findBy_(sheet, key, val); g.updateObject_(sheet, r._row, fields); };
const byEmail = (e) => g.listInvestors().find(i => i.email === e);

console.log('\nSameDayInvestments — phase 2 tests\n');
g.setup();
g.saveSettings({ COMPANY_ADDRESS: '100 Main St, Norfolk, VA 23510', TIERS: 'Tier 1, Tier 2, Tier 3', CATEGORIES: 'Fix & Flip, Cash Buyer, Developer, Builder', REPLY_TO: 'dispo@sdi.com', MARKETS: 'Suffolk, Norfolk', REPS: 'Jordan Hale <jordan@sdi.com>' });
g.setTestMode(false, 'GO LIVE');
const P = {};
const add = (k, o) => { P[k] = g.saveInvestor(Object.assign({ status: 'Active' }, o)); };
add('builder', { firstName: 'Bo', lastName: 'Build', company: 'Coastal Builders LLC', email: 'bo@coastal.com', tier: 'Tier 2', markets: 'Suffolk', propertyTypes: 'Land', categories: 'Builder', maxPrice: 200000 });
add('dev', { firstName: 'Di', lastName: 'Dev', email: 'di@dev.com', tier: 'Tier 3', markets: 'Suffolk', propertyTypes: 'Land', categories: 'Developer' });
add('quiet', { firstName: 'Quinn', lastName: 'Quiet', email: 'quinn@quiet.com', tier: 'Tier 3', markets: 'Suffolk', propertyTypes: 'Land' });
add('flaky', { firstName: 'Flo', lastName: 'Flake', email: 'flo@flake.com', tier: 'Tier 1', markets: 'Suffolk', propertyTypes: 'Land' });
add('weak', { firstName: 'Wes', lastName: 'Weak', email: 'wes@weak.com', tier: 'Tier 3' });
g.updateObject_('Investors', g.findBy_('Investors', 'id', P.builder.id)._row, { purchases: 'Lot 4 Shore Dr, Suffolk — $45,000, cash · land (Oct 1, 2026); Lot 5 Shore Dr, Suffolk — $47,000, cash · land (Oct 1, 2026); 9 Elm St, Norfolk — $150,000, cash (Sep 2, 2026)', purchaseCount: 3 });

let land;
step('land deal: parcel, buildability and development details reach the email with the offer deadline', () => {
  land = g.saveDeal({ address: '0 Pruden Blvd', city: 'Suffolk', state: 'VA', zip: '23434', market: 'Suffolk', propertyType: 'Land', acres: 2.5, askingPrice: 90000, contractPrice: 60000,
    parcelId: '34-12A', zoning: 'R-1', zoningNotes: 'Min lot 20,000 sf', potentialLots: 4, density: '1.6 units/ac', roadFrontage: 320, roadAccess: 'Paved state road',
    utilities: 'Public water, septic', floodZone: 'X (minimal)', wetlands: 'None mapped', soilSeptic: 'Perc approved 2025', offerDeadline: ymd(3) + 'T17:00', rep: 'Jordan Hale <jordan@sdi.com>' });
  const p = g.getEmailPreview(land.id);
  ['Acreage', '2.5 acres', 'Parcel ID', '34-12A', 'Zoning Restrictions', 'Potential Lots', 'Road Frontage', '320 ft', 'Flood Zone', 'X (minimal)', 'Wetlands', 'Soil / Septic', 'Perc approved', 'Offers due by']
    .forEach(t => assert(p.html.includes(t), 'missing ' + t));
  assert(p.html.includes('Main%20reason'), 'pass link asks for a reason');
});

let job;
step('distribution + responses: pass reasons captured, competition counted', () => {
  const prep = g.prepareDistribution(land.id, { mode: 'smart', waves: false });
  job = g.confirmDistribution(prep.token, 'SEND');
  assert.strictEqual(Number(job.sent), 4, job.status);
  g.logResponse({ dealId: land.id, investorId: P.builder.id, type: 'Interested', message: 'Looks good' });
  g.logResponse({ dealId: land.id, investorId: P.dev.id, type: 'Interested', message: 'Send survey' });
  M.inbox = [{ id: 'x1', from: 'Flo Flake <flo@flake.com>', subject: 'PASS - ' + land.id + ' - 0 Pruden Blvd', body: 'Not for me this time. Main reason (keep one): Price\n\nDeal: ' + land.id }];
  g.scanInboxForResponses();
  const pass = g.listResponses().find(r => r.investorEmail === 'flo@flake.com');
  assert.strictEqual(pass.type, 'Not Interested'); assert.strictEqual(pass.passReason, 'Price');
  const da = g.getDistributionAnalytics();
  const row = da.deals.find(d => d.id === land.id);
  assert.strictEqual(row.received, 4); assert.strictEqual(row.responded, 3); assert.strictEqual(row.responseRate, 75);
  assert.strictEqual(row.interested, 2); assert.strictEqual(row.competition, 2); assert.strictEqual(row.passes.Price, 1);
  assert(da.passReasons.find(r => r.reason === 'Price').count === 1);
  assert(/Opens and clicks/.test(da.note));
});

step('follow-ups: competition shown to buyers, deadline-passed alert for the rep', () => {
  g.readTable_('Distribution Log').rows.forEach(r => g.updateObject_('Distribution Log', r._row, { sentAt: ago(60) }));
  g.readTable_('Responses').rows.forEach(r => g.updateObject_('Responses', r._row, { received: ago(30) }));
  M.sent = [];
  g.runFollowUpsNow();
  const reminder = M.sent.find(m => m.to === 'bo@coastal.com');
  assert(reminder && /2 buyers are actively reviewing/.test(reminder.body), 'competition line');
  setRow('Deals', 'id', land.id, { offerDeadline: ago(2) });
  const due = g.getFollowUpCenter().due;
  assert(due.some(d => d.type === 'deadlinepassed' && d.dealId === land.id), due.map(d => d.type).join());
});

step('price reduction: alert goes to previous recipients + matches with a PRICE REDUCED subject', () => {
  const d = g.saveDeal(Object.assign({}, g.getDeal(land.id), { askingPrice: 80000 }));
  assert.strictEqual(d.previousPrice, 90000); assert.strictEqual(d.priceReduced, true);
  M.sent = [];
  const prep = g.prepareDistribution(land.id, { mode: 'priceDrop' });
  assert(/Price-reduction/.test(prep.audienceLabel));
  assert(prep.recipientCount >= 3, 'includes earlier recipients: ' + prep.recipientCount);
  g.confirmDistribution(prep.token, 'SEND');
  assert(M.sent.length >= 3);
  assert(M.sent.every(m => /^PRICE REDUCED \$90,000 → \$80,000/.test(m.subject)), M.sent[0].subject);
  assert(M.sent[0].opts.htmlBody.includes('PRICE REDUCED'));
  assert.strictEqual(g.listJobs()[0].kind, 'price_drop');
});

let other;
step('offers → close: revenue, days-to-buyer and conversion on the CEO dashboard', () => {
  const o = g.saveOffer({ dealId: land.id, investorId: P.builder.id, amount: 85000, emd: 5000, closingDate: ymd(10) });
  g.saveOffer({ dealId: land.id, investorId: P.dev.id, amount: 78000 });
  g.setOfferStatus(o.id, 'Accepted');
  g.setDealStage(land.id, 'Closed');
  other = g.saveDeal({ address: '12 Bay St', city: 'Norfolk', market: 'Norfolk', askingPrice: 150000, contractPrice: 130000, rep: 'Kim Ortiz' });
  const c = g.getCeoDashboard(90);
  assert.strictEqual(c.kpi.dealsDistributed, 1);
  assert.strictEqual(c.kpi.closedDeals, 1);
  assert.strictEqual(c.kpi.revenue, 25000, 'fee = sold 85,000 − contract 60,000');
  assert.strictEqual(c.kpi.avgFee, 25000);
  assert.strictEqual(c.kpi.avgOffersPerDeal, 2);
  assert(c.kpi.avgDaysToBuyer !== null && c.kpi.avgDaysToBuyer >= 0);
  assert.strictEqual(c.kpi.distToContract, 100);
  assert.strictEqual(c.kpi.responseRate, 75);
  assert(c.kpi.buyerToClosing > 0);
  assert.strictEqual(c.byMarket[0].name, 'Suffolk'); assert.strictEqual(c.byMarket[0].revenue, 25000);
  assert.strictEqual(c.byRep[0].name, 'Jordan Hale');
  assert.strictEqual(c.months[5].revenue, 25000);
  assert(c.topInvestors[0].name === 'Bo Build');
  assert.strictEqual(c.stages.find(s => s.stage === 'Closed').count, 1);
});

step('heat scores + buyer activity history + closing performance', () => {
  const prof = g.getInvestorProfile(P.builder.id);
  assert(prof.stats.heat >= 50, 'active closer is hot: ' + prof.stats.heat);
  assert.strictEqual(prof.stats.closed, 1); assert.strictEqual(prof.stats.closeRate, 100);
  assert.strictEqual(prof.history[0].outcome, 'Bought it');
  const quiet = g.getInvestorProfile(P.quiet.id);
  assert(quiet.stats.heat < prof.stats.heat);
  assert.strictEqual(quiet.history[0].outcome, 'No response');
  assert.strictEqual(g.getInvestorProfile(P.flaky.id).history[0].outcome, 'Passed');
  const bm = g.matchBuyers(other.id);
  assert(bm.matches.every(m => typeof m.likelihood === 'number'), 'best-buyer likelihood present');
});

step('automatic tier upgrades and downgrades', () => {
  g.recordBuyerOutcome(P.builder.id, 'closed', '');
  g.recordBuyerOutcome(P.flaky.id, 'default', '', 'no funds');
  g.recordBuyerOutcome(P.flaky.id, 'default', '', 'no funds');
  const tc = g.getTierCenter();
  const up = tc.plan.find(p => p.id === P.builder.id);
  assert(up && up.to === 'Tier 1' && up.up, JSON.stringify(tc.plan));
  const down = tc.plan.find(p => p.id === P.flaky.id);
  assert(down && down.to === 'Tier 2' && !down.up);
  const r = g.runTierUpgradesNow();
  assert.strictEqual(r.applied, 2);
  assert.strictEqual(byEmail('bo@coastal.com').tier, 'Tier 1');
  assert(/Tier Tier 2 → Tier 1/.test(byEmail('bo@coastal.com').notes));
  assert.strictEqual(byEmail('flo@flake.com').tier, 'Tier 2');
  assert(byEmail('bo@coastal.com').heat > 0, 'heat column written');
  assert.strictEqual(g.getTierCenter().plan.length, 0, 'stable after applying');
});

step('dead-deal recovery: stalled deal flagged, then re-sent to the next ring automatically', () => {
  const d = g.saveDeal({ address: '7 Lake Rd', city: 'Suffolk', market: 'Suffolk', propertyType: 'Land', acres: 1.5, askingPrice: 70000, contractPrice: 60000 });
  const prep = g.prepareDistribution(d.id, { mode: 'smart', waves: false, minScore: 70 });
  const firstRing = prep.recipientCount;
  g.confirmDistribution(prep.token, 'SEND');
  setRow('Deals', 'id', d.id, { lastDistributed: ago(24 * 6), firstDistributed: ago(24 * 6) });
  g.saveOffer({ dealId: d.id, investorId: P.dev.id, amount: 61000 }); // fee 1,000 < 5,000 → not acceptable
  const cands = g.getTierCenter().recovery;
  assert(cands.some(c => c.dealId === d.id), JSON.stringify(cands));
  assert(g.getFollowUpCenter().due.some(x => x.type === 'recovery' && x.dealId === d.id), 'rep alerted');
  g.saveSettings({ RECOVERY_AUTO: 'TRUE' });
  M.sent = [];
  const n = g.runNightly();
  assert.strictEqual(n.recovered, 1);
  assert(M.sent.length > 0 && M.sent.length <= 5 - firstRing, 'only buyers not yet sent: ' + M.sent.length);
  assert(g.listJobs().some(j => j.dealId === d.id && j.kind === 'recovery'));
  assert(!g.getTierCenter().recovery.some(c => c.dealId === d.id), 'not recovered twice in a row');
  g.saveSettings({ RECOVERY_AUTO: 'FALSE' });
});

step('investor reactivation campaign', () => {
  const w = g.findBy_('Investors', 'id', P.weak.id);
  g.updateObject_('Investors', w._row, { dateAdded: ago(24 * 60) });
  // weak buyer has now received 2+ deals and never responded
  const d2 = g.saveDeal({ address: '1 Any St', city: 'Norfolk', askingPrice: 100000 });
  g.confirmDistribution(g.prepareDistribution(d2.id, { mode: 'selected', investorIds: [P.weak.id] }).token, 'SEND');
  g.confirmDistribution(g.prepareDistribution(other.id, { mode: 'selected', investorIds: [P.weak.id] }).token, 'SEND');
  const tc = g.getTierCenter();
  assert(tc.reactivation.some(r => r.id === P.weak.id), JSON.stringify(tc.reactivation));
  throwsMsg(() => g.launchReactivation([P.weak.id], 'nope'), /Type SEND/);
  M.sent = [];
  const r = g.launchReactivation([P.weak.id], 'SEND');
  assert.strictEqual(r.sent, 1);
  assert(/^Still buying/.test(M.sent[0].subject)); assert.strictEqual(M.sent[0].to, 'wes@weak.com');
  assert(!g.getTierCenter().reactivation.some(x => x.id === P.weak.id), 'not re-contacted for 90 days');
});

step('land buyers & builder activity; market report', () => {
  const lb = g.getLandBuyers();
  const bo = lb.buyers.find(b => b.id === P.builder.id);
  assert.strictEqual(bo.landBuys, 3, '2 public lots + 1 land deal bought from us');
  assert.strictEqual(bo.boughtFromUs, 1);
  assert.strictEqual(lb.buyers[0].id, P.builder.id, 'most active land buyer first');
  const suffolk = lb.builderActivity.find(x => x.market === 'Suffolk');
  assert.strictEqual(suffolk.builders[0].name, 'Bo Build'); assert.strictEqual(suffolk.lots, 2);
  const mr = g.getMarketReport();
  const s = mr.markets.find(m => m.market === 'Suffolk');
  assert(s.buyers >= 4 && s.landBuyers >= 3); assert.strictEqual(s.closed, 1); assert.strictEqual(s.revenue, 25000);
  assert(mr.markets.some(m => m.market === 'Norfolk'));
});

step('permissions: owner / rep / viewer / outsider', () => {
  g.saveSettings({ TEAM_MEMBERS: 'kim@sdi.com: Rep\nvic@sdi.com: Viewer' });
  try {
    M.activeUser = 'vic@sdi.com';
    assert.strictEqual(g.whoAmI().role, 'Viewer');
    assert(g.getCeoDashboard(30).kpi);
    throwsMsg(() => g.saveDeal({ address: 'x', askingPrice: 1 }), /Viewer/);
    M.activeUser = 'kim@sdi.com';
    assert(g.saveDeal({ address: 'Rep deal', askingPrice: 1000 }).id);
    throwsMsg(() => g.saveSettings({ COMPANY_NAME: 'Hacked' }), /needs Owner/);
    throwsMsg(() => g.setTestMode(true, ''), /needs Owner/);
    M.activeUser = 'stranger@gmail.com';
    throwsMsg(() => g.getBootstrap(), /isn't on the SameDayInvestments team/);
    M.activeUser = '';
    throwsMsg(() => g.listDeals(), /isn't on the SameDayInvestments team/);
    M.activeUser = undefined; // the deploying owner
    assert.strictEqual(g.whoAmI().role, 'Owner');
    assert(g.runNightly(), 'background jobs unaffected by roles');
  } finally { M.activeUser = undefined; g.saveSettings({ TEAM_MEMBERS: '' }); }
  const noDates = (o, p) => { if (o instanceof Date) throw new Error('Date at ' + p); if (o && typeof o === 'object') Object.keys(o).forEach(k => noDates(o[k], p + '.' + k)); };
  ['getCeoDashboard', 'getDistributionAnalytics', 'getTierCenter', 'getMarketReport', 'getLandBuyers'].forEach(f => noDates(g[f](), f));
  noDates(g.getInvestorProfile(P.builder.id), 'profile');
  g.enableNightly();
  assert(M.triggers.some(t => t.getHandlerFunction() === 'runNightly' && /@2$/.test(t.kind)));
  assert(!M.isLocked());
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : '') + '\n');
