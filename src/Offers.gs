/**
 * Offers.gs — Offer Management & Comparison.
 *
 * Offers arrive automatically (an investor replies "OFFER - SDI-…" or the inbox scanner reads an
 * offer amount) or are entered by the team. Each offer tracks amount, assignment fee, EMD,
 * inspection period, closing date, financing, proof of funds and contract status.
 *
 * Strength score (0–100) for side-by-side comparison:
 *   your assignment fee / offer price 40 · EMD 15 · proof of funds 15 · reliability 10 ·
 *   closing speed 10 · inspection period 10
 */

var ACTIVE_OFFER = ['Received', 'Countered', 'Accepted', 'Backup', 'Under Contract'];

function offerFee_(o, deal) {
  if (o.assignmentFee !== '' && o.assignmentFee !== null && o.assignmentFee !== undefined && !isNaN(Number(o.assignmentFee))) return Number(o.assignmentFee);
  var cp = Number(deal && deal.contractPrice) || 0;
  return cp && Number(o.amount) ? Number(o.amount) - cp : '';
}

function offerPofLabel_(o, inv) {
  var st = inv ? pofStatus_(inv) : 'None';
  if (st === 'Verified' || st === 'Expiring') return 'Verified';
  if (st === 'Expired') return 'Expired';
  return str_(o.pof) || (st === 'Pending' ? 'Provided' : 'Missing');
}

/** Adds strength score + highlights to a set of offers for one deal. */
function scoreOffers_(offers, deal, invById) {
  var act = offers.filter(function (o) { return ACTIVE_OFFER.indexOf(o.status) > -1; });
  var vals = function (fn) { return act.map(fn).filter(function (v) { return v !== '' && !isNaN(v); }); };
  var fees = vals(function (o) { return Number(offerFee_(o, deal) === '' ? o.amount : offerFee_(o, deal)); });
  var emds = vals(function (o) { return Number(o.emd) || 0; });
  var maxFee = Math.max.apply(null, fees.concat([1])), minFee = Math.min.apply(null, fees.concat([maxFee]));
  var maxEmd = Math.max.apply(null, emds.concat([1]));
  var best = {};
  offers.forEach(function (o) {
    var inv = invById[o.investorId];
    var fee = offerFee_(o, deal);
    var feeVal = fee === '' ? Number(o.amount) || 0 : fee;
    var s = 0;
    s += maxFee === minFee ? 40 : 40 * (feeVal - minFee) / (maxFee - minFee);
    s += 15 * Math.min(1, (Number(o.emd) || 0) / maxEmd);
    var pof = offerPofLabel_(o, inv);
    s += pof === 'Verified' ? 15 : pof === 'Provided' ? 8 : 0;
    var rel = inv ? reliabilityOf_(inv) : '';
    s += rel === '' ? 5 : rel * 2;
    if (inv && Number(inv.defaults) > 0) s -= 10;
    var close = parseDateLoose_(o.closingDate);
    var daysToClose = close ? Math.max(0, Math.round((close.getTime() - Date.now()) / 86400000)) : '';
    s += daysToClose === '' ? 4 : daysToClose <= 14 ? 10 : daysToClose <= 30 ? 7 : 3;
    var insp = o.inspectionDays === '' ? '' : Number(o.inspectionDays);
    s += insp === '' ? 4 : insp <= 3 ? 10 : insp <= 7 ? 7 : insp <= 14 ? 4 : 1;
    o.strength = ACTIVE_OFFER.indexOf(o.status) > -1 ? Math.max(0, Math.min(100, Math.round(s))) : 0;
    o.fee = fee;
    o.pofLabel = pof;
    o.reliability = rel;
    o.buyerDefaults = inv ? Number(inv.defaults) || 0 : 0;
    o.daysToClose = daysToClose;
    o.tier = inv ? str_(inv.tier) : '';
    if (ACTIVE_OFFER.indexOf(o.status) > -1) {
      if (!best.amount || Number(o.amount) > Number(best.amount.amount)) best.amount = o;
      if (Number(o.emd) && (!best.emd || Number(o.emd) > Number(best.emd.emd))) best.emd = o;
      if (daysToClose !== '' && (!best.close || daysToClose < best.close.daysToClose)) best.close = o;
      if (insp !== '' && (!best.insp || insp < Number(best.insp.inspectionDays))) best.insp = o;
      if (!best.strength || o.strength > best.strength.strength) best.strength = o;
    }
  });
  offers.forEach(function (o) {
    o.best = Object.keys(best).filter(function (k) { return best[k] === o; });
  });
  return offers.sort(function (a, b) { return b.strength - a.strength || Number(b.amount) - Number(a.amount); });
}

/** Creates an offer from an inbox / manual response of type Offer. Caller holds the lock. */
function createOfferFromResponse_(resp) {
  if (!resp.dealId || !resp.offerAmount) return null;
  var exists = readTable_(SHEET.OFFERS).rows.some(function (o) { return o.responseId === resp.id; });
  if (exists) return null;
  var deal = findBy_(SHEET.DEALS, 'id', resp.dealId);
  if (!deal) return null;
  var inv = resp.investorId ? findBy_(SHEET.INVESTORS, 'id', resp.investorId) : null;
  var text = str_(resp.message);
  var emd = (text.match(/\bemd\b[^$\d]{0,20}\$?\s?([\d,]+(?:\.\d+)?\s*k?)/i) || [])[1];
  var insp = (text.match(/(\d{1,2})[\s-]*day[s]?\s*(inspection|due diligence|dd)/i) || [])[1];
  var close = (text.match(/clos\w*\s*(in|within)\s*(\d{1,3})\s*days/i) || [])[2];
  var row = {
    id: shortId_('O-'), dealId: deal.id, property: dealTitle_(deal), investorId: inv ? inv.id : '',
    investorName: inv ? investorName_(inv) : str_(resp.investorName), investorEmail: lc_(resp.investorEmail),
    received: new Date(), amount: num_(resp.offerAmount), assignmentFee: '', emd: emd ? num_(emd.replace(/\s/g, '')) : '',
    inspectionDays: insp ? Number(insp) : '', closingDate: close ? fmtDate_(new Date(Date.now() + Number(close) * 86400000)) : '',
    financing: /cash/i.test(text) ? 'Cash' : /hard money|private lend/i.test(text) ? 'Hard money' : '',
    pof: /proof of funds|pof/i.test(text) && !/no pof|without pof/i.test(text) ? 'Provided' : '',
    status: 'Received', counter: '', source: 'Email (auto)', notes: text.slice(0, 300), updated: new Date(), responseId: resp.id
  };
  var fee = offerFee_(row, deal);
  if (fee !== '') row.assignmentFee = fee;
  appendObjects_(SHEET.OFFERS, [row]);
  advanceStage_(deal.id, 'Offer Received');
  return row;
}

// ---------- client API ----------

function listOffers(dealId) {
  var invById = {};
  readTable_(SHEET.INVESTORS).rows.forEach(function (i) { invById[i.id] = i; });
  var deals = {};
  readTable_(SHEET.DEALS).rows.forEach(function (d) { deals[d.id] = d; });
  var rows = readTable_(SHEET.OFFERS).rows.filter(function (o) { return !dealId || o.dealId === dealId; });
  var byDeal = {};
  rows.forEach(function (o) { (byDeal[o.dealId] = byDeal[o.dealId] || []).push(o); });
  var out = [];
  Object.keys(byDeal).forEach(function (id) { out = out.concat(scoreOffers_(byDeal[id], deals[id] || {}, invById)); });
  return toClient_(out);
}

/** Side-by-side comparison for one deal. */
function compareOffers(dealId) {
  var deal = getDeal(dealId);
  return { deal: deal, offers: listOffers(dealId) };
}

/** Create or update an offer. */
function saveOffer(o) {
  return withLock_(function () {
    o = o || {};
    var deal = getDealRow_(o.dealId);
    if (!num_(o.amount)) throw new Error('Enter the offer amount.');
    var inv = o.investorId ? findBy_(SHEET.INVESTORS, 'id', o.investorId) : null;
    if (!inv && !str_(o.investorName)) throw new Error('Choose the buyer or enter a name.');
    if (o.closingDate && !/^\d{4}-\d{2}-\d{2}$/.test(o.closingDate)) throw new Error('Closing date must be a date.');
    var f = {
      dealId: deal.id, property: dealTitle_(deal), investorId: inv ? inv.id : '',
      investorName: inv ? investorName_(inv) : str_(o.investorName), investorEmail: inv ? lc_(inv.email) : lc_(o.investorEmail),
      amount: num_(o.amount), emd: num_(o.emd), inspectionDays: num_(o.inspectionDays), closingDate: str_(o.closingDate),
      financing: str_(o.financing), pof: str_(o.pof), notes: str_(o.notes), updated: new Date()
    };
    f.assignmentFee = o.assignmentFee !== undefined && o.assignmentFee !== '' ? num_(o.assignmentFee) : offerFee_({ amount: f.amount }, deal);
    if (o.id) {
      var ex = findBy_(SHEET.OFFERS, 'id', o.id);
      if (!ex) throw new Error('Offer not found.');
      updateObject_(SHEET.OFFERS, ex._row, f);
      f.id = o.id;
    } else {
      f.id = shortId_('O-');
      f.received = new Date();
      f.status = 'Received';
      f.source = 'Manual';
      appendObjects_(SHEET.OFFERS, [f]);
      advanceStage_(deal.id, 'Offer Received');
    }
    return listOffers(deal.id).filter(function (x) { return x.id === f.id; })[0];
  });
}

/**
 * Changes an offer's contract status.
 *   Accepted → deal moves to Buyer Selected with this buyer; other open offers become Backup.
 *   Under Contract → deal moves to Assignment Signed.
 *   Countered → stores counter amount; deal moves to Negotiating.
 *   Fell Through → records a failed closing for the buyer; deal goes back to Negotiating.
 */
function setOfferStatus(offerId, status, extra) {
  if (OFFER_STATUSES.indexOf(status) === -1) throw new Error('Unknown offer status.');
  extra = extra || {};
  return withLock_(function () {
    var o = findBy_(SHEET.OFFERS, 'id', offerId);
    if (!o) throw new Error('Offer not found.');
    var f = { status: status, updated: new Date() };
    if (status === 'Countered') { f.counter = num_(extra.counter); advanceStage_(o.dealId, 'Negotiating'); }
    updateObject_(SHEET.OFFERS, o._row, f);
    var deal = getDealRow_(o.dealId);
    if (status === 'Accepted') {
      readTable_(SHEET.OFFERS).rows.forEach(function (x) {
        if (x.dealId === o.dealId && x.id !== o.id && ['Received', 'Countered', 'Accepted'].indexOf(x.status) > -1) updateObject_(SHEET.OFFERS, x._row, { status: 'Backup', updated: new Date() });
      });
      var df = { stage: 'Buyer Selected', stageUpdated: new Date(), status: 'Pending', buyerInvestorId: o.investorId || '', buyer: o.investorName, updated: new Date() };
      if (o.emd !== '') df.emdAmount = o.emd;
      if (str_(o.closingDate)) df.closingDate = str_(o.closingDate);
      updateObject_(SHEET.DEALS, deal._row, df);
    } else if (status === 'Under Contract') {
      updateObject_(SHEET.DEALS, deal._row, { stage: 'Assignment Signed', stageUpdated: new Date(), status: 'Pending', assignmentSigned: new Date(), buyerInvestorId: o.investorId || '', buyer: o.investorName, updated: new Date() });
    } else if (status === 'Fell Through') {
      if (o.investorId) recordBuyerOutcome_(o.investorId, 'default', o.dealId, str_(extra.note));
      if (str_(deal.buyerInvestorId) === str_(o.investorId)) {
        updateObject_(SHEET.DEALS, deal._row, { stage: 'Negotiating', stageUpdated: new Date(), status: 'Available', buyerInvestorId: '', buyer: '', updated: new Date() });
      }
    }
    return compareOffers(o.dealId);
  });
}
