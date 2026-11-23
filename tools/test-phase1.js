/**
 * Phase 1 tests: buy boxes, smart matching + priority waves, pipeline, offers & comparison,
 * buyer verification, automatic follow-ups.   Run:  node tools/test-phase1.js
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
const ymd = (days) => { const d = new Date(Date.now() + days * 86400000); return d.toISOString().slice(0, 10); };
const setRow = (sheet, key, val, fields) => { const r = g.findBy_(sheet, key, val); g.updateObject_(sheet, r._row, fields); };
const inv = (email) => g.listInvestors().find(i => i.email === email);

console.log('\nSameDayInvestments — phase 1 tests\n');
g.setup();
g.saveSettings({ COMPANY_ADDRESS: '100 Main St, Norfolk, VA 23510', TIERS: 'Tier 1, Tier 2, Tier 3', CATEGORIES: 'Fix & Flip, Buy & Hold, Cash Buyer, Developer, Builder', REPLY_TO: 'dispo@samedayinvestments.com' });
g.setTestMode(false, 'GO LIVE');

const people = {};
step('buy box profiles save every field', () => {
  const add = (k, o) => { people[k] = g.saveInvestor(Object.assign({ status: 'Active' }, o)); };
  add('A', { firstName: 'Alan', lastName: 'Dev', company: 'Tidewater Builders LLC', email: 'alan@tidewaterbuilders.com', tier: 'Tier 1', markets: 'Suffolk, Chesapeake', zips: '23434, 23435', propertyTypes: 'Land', categories: 'Developer, Builder', minAcres: 1, maxAcres: 10, maxPrice: 150000, funding: 'Cash', closeDays: 14 });
  add('B', { firstName: 'Bea', lastName: 'Lots', email: 'bea@lotsrus.com', tier: 'Tier 2', markets: 'Suffolk', propertyTypes: 'Land', maxPrice: 120000 });
  add('C', { firstName: 'Carl', lastName: 'Flip', email: 'carl@flips.com', tier: 'Tier 1', markets: 'Suffolk', propertyTypes: 'Single Family', maxPrice: 200000, condition: 'Rehab', minRoi: 20 });
  add('D', { firstName: 'Dee', lastName: 'Open', email: 'dee@open.com', tier: 'Tier 3' });
  add('E', { firstName: 'Ed', lastName: 'Rva', email: 'ed@rvaland.com', tier: 'Tier 1', markets: 'Richmond', propertyTypes: 'Land' });
  add('F', { firstName: 'Fay', lastName: 'Small', email: 'fay@smalllots.com', tier: 'Tier 2', markets: 'Suffolk', propertyTypes: 'Land', maxAcres: 1 });
  add('G', { firstName: 'Gus', lastName: 'Builds', company: 'Gus Homes LLC', email: 'gus@gushomes.com', tier: 'Tier 2', categories: 'Builder', status: 'Active' });
  g.updateObject_('Investors', g.findBy_('Investors', 'id', people.G.id)._row, { purchases: '0 Kings Hwy, Suffolk — $70,000, cash (Oct 1, 2026)' });
  const a = inv('alan@tidewaterbuilders.com');
  assert.strictEqual(a.zips, '23434, 23435'); assert.strictEqual(a.minAcres, 1); assert.strictEqual(a.maxAcres, 10);
  assert.strictEqual(a.funding, 'Cash'); assert.strictEqual(a.closeDays, 14);
  assert.strictEqual(inv('carl@flips.com').condition, 'Rehab'); assert.strictEqual(inv('carl@flips.com').minRoi, 20);
});

let deal;
step('2-acre Suffolk parcel matches land buyers in Suffolk; Tier 1 first; irrelevant buyers excluded', () => {
  deal = g.saveDeal({ address: '0 Pruden Blvd', city: 'Suffolk', state: 'VA', zip: '23434', market: 'Suffolk', propertyType: 'Land', acres: 2, askingPrice: 85000, contractPrice: 60000, parcelId: '34-12A', zoning: 'R-1', lotSize: '2 acres' });
  assert.strictEqual(deal.stage, 'Ready for Disposition');
  assert.strictEqual(deal.isLand, true); assert.strictEqual(deal.acresNum, 2);
  const m = g.matchBuyers(deal.id);
  const by = {}; m.matches.forEach(x => by[x.email] = x);
  assert.strictEqual(m.matches[0].email, 'alan@tidewaterbuilders.com', 'Tier 1 Suffolk land developer ranks first');
  assert.strictEqual(by['alan@tidewaterbuilders.com'].fit, 'strong');
  assert(by['alan@tidewaterbuilders.com'].reasons.some(r => /23434/.test(r)));
  assert(['strong', 'good'].includes(by['bea@lotsrus.com'].fit), JSON.stringify(by['bea@lotsrus.com']));
  assert(['strong', 'good'].includes(by['gus@gushomes.com'].fit), 'builder who bought in Suffolk matches: ' + JSON.stringify(by['gus@gushomes.com']));
  assert(by['gus@gushomes.com'].reasons.some(r => /bought in Suffolk/.test(r)));
  assert.strictEqual(by['carl@flips.com'].fit, 'no'); assert(/land/.test(by['carl@flips.com'].blockers[0]));
  assert.strictEqual(by['ed@rvaland.com'].fit, 'no'); assert(/areas/.test(by['ed@rvaland.com'].blockers[0]));
  assert.strictEqual(by['fay@smalllots.com'].fit, 'no'); assert(/Acreage/.test(by['fay@smalllots.com'].blockers[0]));
  assert.strictEqual(by['dee@open.com'].fit, 'weak');
});

let job;
step('smart distribution sends Wave 1 (top tier) now and schedules Wave 2', () => {
  M.sent = []; M.triggers = [];
  const pv = g.previewAudience(deal.id, { mode: 'smart' });
  assert.strictEqual(pv.count, 3); assert.strictEqual(pv.excluded.notMatched, 4);
  assert.deepStrictEqual(Array.from(pv.waves), [1, 2, 0]);
  assert.strictEqual(pv.recipients[0].email, 'alan@tidewaterbuilders.com');
  const pv2 = g.previewAudience(deal.id, { mode: 'smart', includeOthers: true });
  assert.strictEqual(pv2.waves[2], 4, 'everyone else goes last when included');
  const prep = g.prepareDistribution(deal.id, { mode: 'smart' });
  job = g.confirmDistribution(prep.token, 'SEND');
  assert.strictEqual(M.sent.length, 1); assert.strictEqual(M.sent[0].to, 'alan@tidewaterbuilders.com');
  assert(/^Wave 2 scheduled — 2 buyers/.test(job.status), job.status);
  assert(M.triggers.some(t => t.getHandlerFunction() === 'runQueuedDistributions'));
  assert.strictEqual(g.getDeal(deal.id).stage, 'Distributed', 'pipeline advanced automatically');
  // time passes: wave 2 becomes due
  g.readTable_('Distribution Log').rows.filter(r => r.jobId === job.id && r.status === 'Queued').forEach(r => g.updateObject_('Distribution Log', r._row, { sendAfter: ago(1) }));
  g.runQueuedDistributions();
  assert.strictEqual(M.sent.length, 3);
  assert.deepStrictEqual(M.sent.map(x => x.to).slice(1).sort(), ['bea@lotsrus.com', 'gus@gushomes.com']);
  assert.strictEqual(g.getJobStatus(job.id).status, 'Completed');
});

let gOffer, aOffer;
step('interest + emailed offer are organized automatically; pipeline advances', () => {
  g.logResponse({ dealId: deal.id, investorId: people.B.id, type: 'Interested', message: 'Send me the survey' });
  assert.strictEqual(g.getDeal(deal.id).stage, 'Buyer Interested');
  M.inbox = [{ id: 'm1', from: 'Gus Builds <gus@gushomes.com>', subject: 'OFFER - ' + deal.id + ' - 0 Pruden Blvd', body: 'My offer is $80,000 cash. EMD $5,000, 7 day inspection, can close in 21 days. Proof of funds attached.\n\nDeal: ' + deal.id }];
  const r = g.scanInboxForResponses();
  assert.strictEqual(r.offers, 1);
  gOffer = g.listOffers(deal.id)[0];
  assert.strictEqual(gOffer.amount, 80000); assert.strictEqual(gOffer.emd, 5000); assert.strictEqual(gOffer.inspectionDays, 7);
  assert.strictEqual(gOffer.financing, 'Cash'); assert.strictEqual(gOffer.pof, 'Provided');
  assert.strictEqual(gOffer.assignmentFee, 20000, 'fee = offer − contract price');
  assert.strictEqual(gOffer.status, 'Received'); assert.strictEqual(gOffer.source, 'Email (auto)');
  assert.strictEqual(g.getDeal(deal.id).stage, 'Offer Received');
});

step('verification: POF upload → pending, verify → verified, expired flagged', () => {
  const g1 = g.uploadPof(people.G.id, 'bank.pdf', 'application/pdf', 'JVBERi0xLjQ=', 250000, '');
  assert.strictEqual(g1.pofStatus, 'Pending');
  assert(g1.flags.includes('POF needs verification'));
  const pofFile = Object.values(M.files).find(f => /POF/.test(f.getName()));
  assert.strictEqual(pofFile.sharing, 'PRIVATE', 'POF never shared by link');
  const a1 = g.verifyPof(people.A.id, 500000);
  assert.strictEqual(a1.pofStatus, 'Verified'); assert.strictEqual(a1.pofAmount, 500000);
  const b1 = g.verifyPof(people.B.id, 100000, ymd(-1));
  assert.strictEqual(b1.pofStatus, 'Expired'); assert(b1.flags.includes('POF expired'));
  assert.strictEqual(g.verifyPof(people.D.id, '', ymd(7)).pofStatus, 'Expiring');
  const vc = g.getVerificationCenter();
  assert.strictEqual(vc.summary.expired, 1); assert.strictEqual(vc.summary.offersNoPof, 1);
  assert(vc.buyers.find(x => x.id === people.G.id).flags.includes('Active offer without verified POF'));
});

step('offer comparison ranks the strongest offer side by side', () => {
  aOffer = g.saveOffer({ dealId: deal.id, investorId: people.A.id, amount: 90000, emd: 10000, inspectionDays: 3, closingDate: ymd(14), financing: 'Cash' });
  assert.strictEqual(aOffer.assignmentFee, 30000);
  const c = g.compareOffers(deal.id);
  assert.strictEqual(c.offers.length, 2);
  assert.strictEqual(c.offers[0].id, aOffer.id, 'higher fee, bigger EMD, verified POF, faster close wins');
  assert(c.offers[0].best.includes('amount') && c.offers[0].best.includes('emd') && c.offers[0].best.includes('strength'));
  assert.strictEqual(c.offers[0].pofLabel, 'Verified'); assert.strictEqual(c.offers[1].pofLabel, 'Provided');
  assert(c.offers[0].strength > c.offers[1].strength);
  throwsMsg(() => g.saveOffer({ dealId: deal.id, investorId: people.A.id }), /amount/);
});

step('follow-ups: offer reminder, POF chase, quiet-buyer rep alert — each sent once', () => {
  // let time pass
  g.readTable_('Responses').rows.forEach(r => g.updateObject_('Responses', r._row, { received: ago(30) }));
  setRow('Offers', 'id', gOffer.id, { received: ago(30), updated: ago(30) });
  setRow('Offers', 'id', aOffer.id, { received: ago(30), updated: ago(30) });
  g.readTable_('Distribution Log').rows.forEach(r => g.updateObject_('Distribution Log', r._row, { sentAt: ago(60) }));
  g.saveSettings({ FU_QUIET_DAYS: '1' });
  const center = g.getFollowUpCenter();
  const types = center.due.map(d => d.type + ':' + (d.investorName || '')).sort();
  assert(types.includes('offer:Bea Lots'), types.join());
  assert(types.includes('pof:Gus Builds'), 'POF chase for unverified offer: ' + types.join());
  assert(types.includes('quiet:Bea Lots') && types.includes('quiet:Gus Builds'), types.join());
  assert(!types.some(t => t.startsWith('noresp')), 'everyone matched has responded');
  assert(!types.includes('pof:Alan Dev'), 'verified POF is not chased');
  M.sent = [];
  const r = g.runFollowUpsNow();
  assert.strictEqual(r.run.sent, 2, JSON.stringify(r.run));
  const bea = M.sent.find(x => x.to === 'bea@lotsrus.com');
  assert(/Ready to make an offer/.test(bea.subject) && bea.subject.includes(deal.id));
  assert(M.sent.find(x => x.to === 'gus@gushomes.com' && /Proof of funds/.test(x.subject)));
  const digest = M.sent.find(x => x.to === 'dispo@samedayinvestments.com');
  assert(digest && /Follow-up alerts/.test(digest.subject), 'rep digest');
  assert.strictEqual(g.getFollowUpCenter().due.length, 0, 'nothing due twice');
  assert.strictEqual(g.runFollowUpsNow().run.sent, 0);
});

step('accepting an offer selects the buyer, backs up the rest, moves the pipeline', () => {
  const c = g.setOfferStatus(aOffer.id, 'Accepted');
  assert.strictEqual(c.deal.stage, 'Buyer Selected'); assert.strictEqual(c.deal.status, 'Pending');
  assert.strictEqual(c.deal.buyerInvestorId, people.A.id); assert.strictEqual(c.deal.emdAmount, 10000);
  assert.strictEqual(c.deal.closingDate, aOffer.closingDate);
  assert.strictEqual(c.offers.find(o => o.id === gOffer.id).status, 'Backup');
  assert.strictEqual(g.prepareDistribution(deal.id, { mode: 'all' }).dealStatus, 'Pending', 'backup-buyer sends allowed, shown as Pending');
});

step('EMD + closing reminders to the selected buyer and the rep', () => {
  setRow('Deals', 'id', deal.id, { stageUpdated: ago(72), closingDate: ymd(2) });
  M.sent = [];
  const r = g.runFollowUpsNow();
  const toAlan = M.sent.filter(x => x.to === 'alan@tidewaterbuilders.com').map(x => x.subject);
  assert(toAlan.some(s => /EMD reminder/.test(s)), toAlan.join());
  assert(toAlan.some(s => /Closing reminder/.test(s)), toAlan.join());
  assert(r.history.some(h => h.channel === 'Alert to rep' && /EMD/.test(h.type)));
});

step('pipeline: EMD received → closing → closed records the transaction for the buyer', () => {
  g.setDealStage(deal.id, 'EMD Received');
  g.setDealStage(deal.id, 'Closing Scheduled');
  const d = g.setDealStage(deal.id, 'Closed');
  assert.strictEqual(d.status, 'Sold'); assert.strictEqual(d.soldPrice, 90000);
  const a = inv('alan@tidewaterbuilders.com');
  assert.strictEqual(a.dealsClosed, 1); assert.strictEqual(a.reliabilityScore, 4);
  assert(new RegExp(deal.id).test(a.lastDealBought));
  assert.strictEqual(g.listOffers(deal.id).find(o => o.id === aOffer.id).status, 'Closed');
  const p = g.getPipeline();
  assert.strictEqual(p.stages.length, 11);
  assert.strictEqual(p.deals.find(x => x.id === deal.id).stage, 'Closed');
});

step('failed closing: default recorded, buyer flagged and ranked lower next time', () => {
  const d2 = g.saveDeal({ address: '5 Lake Dr', city: 'Suffolk', state: 'VA', zip: '23434', market: 'Suffolk', propertyType: 'Land', acres: 3, askingPrice: 95000 });
  const before = g.matchBuyers(d2.id).matches.find(x => x.email === 'gus@gushomes.com').score;
  const o = g.saveOffer({ dealId: d2.id, investorId: people.G.id, amount: 90000 });
  g.setOfferStatus(o.id, 'Accepted');
  const c = g.setOfferStatus(o.id, 'Fell Through', { note: 'Did not fund' });
  assert.strictEqual(c.deal.stage, 'Negotiating'); assert.strictEqual(c.deal.status, 'Available'); assert.strictEqual(c.deal.buyerInvestorId, '');
  const gus = inv('gus@gushomes.com');
  assert.strictEqual(gus.defaults, 1); assert(gus.flags.includes('1 failed closing'));
  assert(g.matchBuyers(d2.id).matches.find(x => x.email === 'gus@gushomes.com').score < before);
  const dead = g.setDealStage(d2.id, 'Dead Deal');
  assert.strictEqual(dead.status, 'Dead');
  throwsMsg(() => g.prepareDistribution(d2.id, { mode: 'all' }), /DEAD/);
});

step('stuck deals flagged for the rep; payloads serializable', () => {
  const d3 = g.saveDeal({ address: '9 Elm', city: 'Norfolk', askingPrice: 100000 });
  setRow('Deals', 'id', d3.id, { stageUpdated: ago(24 * 10) });
  const c = g.getFollowUpCenter();
  assert(c.stuck.some(d => d.id === d3.id));
  assert(c.due.some(x => x.type === 'stuck' && x.dealId === d3.id));
  const noDates = (o, p) => { if (o instanceof Date) throw new Error('Date at ' + p); if (o && typeof o === 'object') Object.keys(o).forEach(k => noDates(o[k], p + '.' + k)); };
  noDates(c, 'fu'); noDates(g.getPipeline(), 'pipe'); noDates(g.getVerificationCenter(), 'ver'); noDates(g.listOffers(), 'offers'); noDates(g.matchBuyers(d3.id), 'match');
  g.enableFollowUps();
  assert(M.triggers.some(t => t.getHandlerFunction() === 'runFollowUps' && /2h/.test(t.kind)));
  assert(!M.isLocked());
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : '') + '\n');
