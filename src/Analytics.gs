/**
 * Analytics.gs — buyer intelligence, performance reporting and automation.
 *
 *  Buyer Heat Score (0–100): responsiveness 35 · interest 15 · offers 20 · closings + public purchases 30 ·
 *    recent activity 10 · minus 15 per failed closing.
 *  Closing Performance: interested deals → offers → accepted → closed / fell through.
 *  CEO dashboard, Distribution analytics, Pass-reason feedback, Market report, Land buyers & builder activity.
 *  Automatic tier upgrades, Dead-deal recovery and Investor reactivation (nightly + on demand).
 */

function loadAll_() {
  return {
    invs: readTable_(SHEET.INVESTORS).rows,
    deals: readTable_(SHEET.DEALS).rows,
    log: readTable_(SHEET.LOG).rows,
    jobs: readTable_(SHEET.JOBS).rows,
    resp: readTable_(SHEET.RESPONSES).rows,
    offers: readTable_(SHEET.OFFERS).rows,
    fus: readTable_(SHEET.FOLLOWUPS).rows
  };
}

function tms_(v) { var d = asDate_(v) || parseDateLoose_(v); return d ? d.getTime() : 0; }
function pct_(a, b) { return b ? Math.round((a / b) * 1000) / 10 : 0; }
function avg_(arr) { return arr.length ? arr.reduce(function (t, x) { return t + x; }, 0) / arr.length : 0; }

/** Your realized assignment fee on a closed deal. */
function dealFee_(d) {
  var sold = Number(d.soldPrice) || 0, cp = Number(d.contractPrice) || 0;
  if (sold && cp) return sold - cp;
  return Number(d.assignmentPrice) || 0;
}

/** Per-investor behavior: heat score + closing performance. */
function buyerStats_(A) {
  var st = {};
  var get = function (id) {
    return st[id] || (st[id] = { received: 0, dealsReceived: {}, responded: {}, interested: {}, passes: 0, offers: 0, accepted: 0, fellThrough: 0, last: 0 });
  };
  A.log.forEach(function (l) {
    if (l.mode !== 'LIVE' || l.status !== 'Sent' || !l.investorId) return;
    var s = get(l.investorId); s.received++; s.dealsReceived[l.dealId] = true;
  });
  A.resp.forEach(function (r) {
    if (!r.investorId) return;
    var s = get(r.investorId), t = tms_(r.received);
    if (r.dealId) s.responded[r.dealId] = true;
    if ((r.type === 'Interested' || r.type === 'Offer') && r.dealId) s.interested[r.dealId] = true;
    if (r.type === 'Not Interested') s.passes++;
    if (r.type !== 'Unsubscribe') s.last = Math.max(s.last, t);
  });
  A.offers.forEach(function (o) {
    if (!o.investorId) return;
    var s = get(o.investorId);
    s.offers++; s.interested[o.dealId] = true; s.responded[o.dealId] = true;
    if (['Accepted', 'Under Contract', 'Closed'].indexOf(o.status) > -1) s.accepted++;
    if (o.status === 'Fell Through') s.fellThrough++;
    s.last = Math.max(s.last, tms_(o.received), tms_(o.updated));
  });
  var out = {};
  A.invs.forEach(function (inv) {
    var s = get(inv.id);
    var dealsRecv = Object.keys(s.dealsReceived).length, respondedN = Object.keys(s.responded).length, interestedN = Object.keys(s.interested).length;
    var closed = Number(inv.dealsClosed) || 0, defaults = Number(inv.defaults) || 0, publicBuys = Number(inv.purchaseCount) || 0;
    var heat = 0;
    if (dealsRecv) heat += 35 * Math.min(1, respondedN / dealsRecv);
    heat += Math.min(15, interestedN * 5);
    heat += Math.min(20, s.offers * 7);
    heat += Math.min(20, closed * 10) + Math.min(10, publicBuys * 2);
    var days = s.last ? (Date.now() - s.last) / 86400000 : Infinity;
    heat += days <= 30 ? 10 : days <= 90 ? 5 : 0;
    heat -= defaults * 15;
    out[inv.id] = {
      heat: Math.max(0, Math.min(100, Math.round(heat))),
      dealsReceived: dealsRecv, responded: respondedN, responseRate: pct_(respondedN, dealsRecv),
      interested: interestedN, offers: s.offers, accepted: s.accepted, closed: closed, fellThrough: s.fellThrough || defaults,
      passes: s.passes, closeRate: Math.min(100, pct_(closed, Math.max(interestedN, closed))), lastActivity: s.last ? new Date(s.last) : ''
    };
  });
  return out;
}

/** Distinct buyers actively competing for each deal (interested or open offer). */
function competitionMap_(A) {
  var m = {};
  A.resp.forEach(function (r) { if (r.dealId && (r.type === 'Interested' || r.type === 'Offer')) (m[r.dealId] = m[r.dealId] || {})[r.investorId || r.investorEmail] = true; });
  A.offers.forEach(function (o) { if (ACTIVE_OFFER.indexOf(o.status) > -1) (m[o.dealId] = m[o.dealId] || {})[o.investorId || o.investorEmail] = true; });
  var out = {};
  Object.keys(m).forEach(function (k) { out[k] = Object.keys(m[k]).length; });
  return out;
}

function dealLastActivity_(d, A) {
  var t = Math.max(tms_(d.stageUpdated), tms_(d.lastDistributed), tms_(d.created));
  A.resp.forEach(function (r) { if (r.dealId === d.id) t = Math.max(t, tms_(r.received)); });
  A.offers.forEach(function (o) { if (o.dealId === d.id) t = Math.max(t, tms_(o.updated), tms_(o.received)); });
  return t;
}

function marketOf_(d) { return titleCase_(str_(d.market) || str_(d.city) || 'Unassigned'); }

// ---------- automatic tiers ----------

function tierPlan_(A, stats) {
  var s = getSettings_(), tiers = list_(s.TIERS);
  if (tiers.length < 2) return [];
  var n = function (k, d) { var v = Number(s[k]); return isNaN(v) || s[k] === '' ? d : v; };
  var plan = [];
  A.invs.forEach(function (inv) {
    if ((str_(inv.status) || 'Active') !== 'Active') return;
    var cur = tiers.map(lc_).indexOf(lc_(inv.tier));
    var st = stats[inv.id] || { heat: 0 }, closed = Number(inv.dealsClosed) || 0, defaults = Number(inv.defaults) || 0;
    var rel = reliabilityOf_(inv), pof = pofStatus_(inv);
    var target = cur, reason = '';
    var recentlyChanged = tms_(inv.tierChanged) > Date.now() - 90 * 86400000;
    if (defaults >= n('TIER_DOWN_DEFAULTS', 2)) {
      // demote once per 90 days, never promote a buyer with repeated failed closings
      if (!recentlyChanged && cur > -1 && cur < tiers.length - 1) { target = cur + 1; reason = defaults + ' failed closings'; }
    }
    else if (closed >= n('TIER_TOP_MIN_CLOSED', 2) && st.heat >= n('TIER_TOP_MIN_HEAT', 60) && (rel === '' || rel >= 4) && (cur === -1 || cur > 0)) { target = 0; reason = closed + ' closed, heat ' + st.heat; }
    else if ((closed >= n('TIER_SECOND_MIN_CLOSED', 1) || (st.heat >= n('TIER_SECOND_MIN_HEAT', 45) && (pof === 'Verified' || pof === 'Expiring'))) && (cur === -1 || cur > 1)) {
      target = 1; reason = closed ? closed + ' closed with us' : 'heat ' + st.heat + ' + verified funds';
    }
    if (target !== cur && target > -1) plan.push({ id: inv.id, name: investorName_(inv), from: str_(inv.tier) || '—', to: tiers[target], reason: reason, up: cur === -1 || target < cur, _row: inv._row, notes: inv.notes });
  });
  return plan;
}

function applyTierPlan_(plan) {
  plan.forEach(function (p) {
    updateObject_(SHEET.INVESTORS, p._row, {
      tier: p.to, tierChanged: new Date(), updated: new Date(),
      notes: (str_(p.notes) + ' [Tier ' + p.from + ' → ' + p.to + ' ' + fmtDate_(new Date()) + ': ' + p.reason + ']').trim()
    });
  });
  return plan.length;
}

function writeHeatColumn_(A, stats) {
  if (!A.invs.length) return;
  var last = A.invs[A.invs.length - 1]._row;
  var vals = [];
  var byRow = {};
  A.invs.forEach(function (i) { byRow[i._row] = i; });
  for (var r = 2; r <= last; r++) vals.push(byRow[r] && stats[byRow[r].id] ? stats[byRow[r].id].heat : '');
  writeColumn_(SHEET.INVESTORS, 'heat', 2, vals);
}

// ---------- dead-deal recovery ----------

function acceptableOffer_(o, d) {
  if (ACTIVE_OFFER.indexOf(o.status) === -1) return false;
  var fee = offerFee_(o, d), min = Number(getSettings_().MIN_ACCEPTABLE_FEE) || 0;
  if (fee !== '' && Number(fee) >= min) return true;
  return Number(o.amount) >= (Number(d.askingPrice) || Infinity) * 0.95;
}

function recoveryCandidates_(A) {
  var days = Number(getSettings_().RECOVERY_DAYS) || 5;
  var out = [];
  A.deals.forEach(function (d) {
    var c = cleanDealRow_(d);
    if (c.status !== 'Available' || c.stageIndex < 1 || c.stageIndex > 4) return;
    var since = tms_(d.lastDistributed) || tms_(d.firstDistributed);
    if (!since || Date.now() - since < days * 86400000) return;
    var offers = A.offers.filter(function (o) { return o.dealId === d.id; });
    if (offers.some(function (o) { return acceptableOffer_(o, d); })) return;
    var recent = A.jobs.some(function (j) { return j.dealId === d.id && str_(j.kind) === 'recovery' && Date.now() - tms_(j.created) < days * 86400000; });
    if (recent) return;
    out.push({ dealId: d.id, title: dealTitle_(d), days: Math.floor((Date.now() - since) / 86400000), offers: offers.length,
      bestOffer: Math.max.apply(null, offers.map(function (o) { return Number(o.amount) || 0; }).concat([0])), askingPrice: Number(d.askingPrice) || 0, rep: str_(d.rep) });
  });
  return out;
}

/** Queues a distribution without the interactive confirmation (used by automatic recovery). */
function autoDistribute_(dealId, audience, kind, who) {
  var deal = getDealRow_(dealId);
  var res = resolveAudience_(deal, audience, readTable_(SHEET.INVESTORS).rows, readTable_(SHEET.LOG).rows);
  if (!res.included.length) return null;
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('dist_' + token, JSON.stringify({
    kind: kind, dealId: dealId, audience: audience, ids: res.included.map(function (i) { return i.id; }),
    waves: res.included.map(function (i) { return i._wave || 1; }), scores: res.included.map(function (i) { return i._score === undefined ? '' : i._score; }),
    mode: isTestMode_() ? 'TEST' : 'LIVE', user: who
  }), 900);
  return confirmDistribution_(token, 'SEND', true);
}

// ---------- investor reactivation ----------

function reactivationCandidates_(A, stats) {
  var days = Number(getSettings_().REACTIVATE_DAYS) || 90;
  var contacted = {};
  A.fus.forEach(function (f) { if (str_(f.key).indexOf('reactivate|') === 0 && Date.now() - tms_(f.sentAt) < days * 86400000) contacted[f.investorId] = true; });
  return A.invs.filter(function (inv) {
    if ((str_(inv.status) || 'Active') !== 'Active' || bool_(inv.optOut) || !isEmail_(inv.email) || contacted[inv.id]) return false;
    var s = stats[inv.id] || {};
    if ((s.dealsReceived || 0) < 2) return false;
    if (Date.now() - tms_(inv.dateAdded) < 30 * 86400000) return false;
    return !s.lastActivity || Date.now() - tms_(s.lastActivity) > days * 86400000;
  }).map(function (inv) {
    var s = stats[inv.id];
    return { id: inv.id, name: investorName_(inv), email: lc_(inv.email), tier: str_(inv.tier), dealsReceived: s.dealsReceived, lastActivity: s.lastActivity || '', markets: str_(inv.markets) };
  });
}

function reactivationEmail_(inv, settings) {
  var B = BRAND, company = str_(settings.COMPANY_NAME) || APP_NAME, reply = replyTo_();
  var mk = list_(inv.markets).slice(0, 3).join(', ');
  var form = str_(settings.BUYER_FORM_URL);
  var yes = mailto_(reply, 'STILL BUYING - ' + (inv.id || ''), 'Yes, keep sending me deals.\n\nMy current buy box (areas, property types, price range):\n\n');
  var pause = mailto_(reply, 'UNSUBSCRIBE', 'Please pause my deal emails. Investor ref: ' + (inv.id || ''));
  var subject = 'Still buying' + (mk ? ' in ' + mk : '') + '? Update your buy box';
  var html = '<!DOCTYPE html><html><body style="margin:0;background:#E9EDEA;">{{TEST_BANNER}}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;">' +
    '<tr><td style="background:' + B.black + ';padding:20px 28px;border-bottom:3px solid ' + B.accent + ';font-family:' + B.serif + ';font-size:22px;color:#fff;">SameDay<span style="color:' + B.accentSoft + ';">Investments</span></td></tr>' +
    '<tr><td style="padding:26px 28px;font-family:' + B.sans + ';font-size:15px;line-height:1.65;color:' + B.text + ';"><p style="margin:0 0 14px;">Hi {{FIRST_NAME}},</p>' +
    '<p style="margin:0 0 14px;">We\'ve been sending you off-market deals and want to make sure they\'re the right ones. Are you still buying' + (mk ? ' in ' + esc_(mk) : '') + '?</p>' +
    '<p style="margin:0 0 18px;">Update your buy box and we\'ll only send properties that fit — and you\'ll see them before our wider list.</p>' +
    '<p style="margin:0 0 8px;">' + (form ? button_(form, 'UPDATE MY BUY BOX', B.accent, '#FFFFFF', B.accent, true) + '&nbsp; ' : '') + button_(yes, "YES, I'M STILL BUYING", form ? '#FFFFFF' : B.accent, form ? B.green : '#FFFFFF', form ? B.green : B.accent, true) + '</p>' +
    '<p style="margin:14px 0 0;font-size:13px;color:' + B.muted + ';">Not buying right now? <a href="' + pause + '" style="color:' + B.muted + ';">Pause my deal emails</a>.</p></td></tr>' +
    '<tr><td style="background:' + B.black + ';padding:16px 28px;font-family:' + B.sans + ';font-size:11px;color:#8E9A94;">' + esc_(company) + (settings.COMPANY_ADDRESS ? ' · ' + esc_(settings.COMPANY_ADDRESS) : '') + '</td></tr></table></td></tr></table></body></html>';
  var text = 'Hi {{FIRST_NAME}},\n\nAre you still buying' + (mk ? ' in ' + mk : '') + '? Reply with your current buy box (areas, property types, price range)' + (form ? ' or update it here: ' + form : '') + '.\n\nNot buying right now? Reply UNSUBSCRIBE.\n\n' + company + (settings.COMPANY_ADDRESS ? '\n' + settings.COMPANY_ADDRESS : '');
  return { subject: subject, html: html, text: text };
}

// ---------- nightly automation ----------

/** Trigger entry (2 AM): heat scores, automatic tier changes, automatic dead-deal recovery. */
function runNightly() {
  return withLock_(function () {
    var s = getSettings_(), A = loadAll_(), stats = buyerStats_(A), out = { tiers: 0, recovered: 0 };
    writeHeatColumn_(A, stats);
    if (bool_(s.AUTO_TIER_ON)) out.tiers = applyTierPlan_(tierPlan_(A, stats));
    if (bool_(s.RECOVERY_AUTO)) {
      recoveryCandidates_(A).forEach(function (c) {
        try { if (autoDistribute_(c.dealId, { mode: 'recovery' }, 'recovery', 'Automatic recovery')) out.recovered++; } catch (e) { /* skip deal */ }
      });
    }
    setSetting_('LAST_NIGHTLY_RUN', new Date().toISOString());
    return out;
  });
}

// ---------- client API ----------

function getCeoDashboard(days) {
  requireRole_('Viewer');
  days = Number(days) || 90;
  var A = loadAll_(), since = Date.now() - days * 86400000, stats = buyerStats_(A);
  var deals = A.deals.map(function (d) { var c = cleanDealRow_(d); c._raw = d; return c; });
  var inRange = function (v) { return tms_(v) >= since; };
  var distributed = deals.filter(function (d) { return inRange(d._raw.firstDistributed || d._raw.lastDistributed); });
  var closed = deals.filter(function (d) { return d.stage === 'Closed' && inRange(d._raw.soldDate); });
  var contracted = distributed.filter(function (d) { return d.stageIndex >= 5 && d.stage !== 'Dead Deal'; });
  var distIds = {}; distributed.forEach(function (d) { distIds[d.id] = true; });
  var offersOnDist = A.offers.filter(function (o) { return distIds[o.dealId]; });
  var daysToBuyer = deals.filter(function (d) { return d._raw.buyerSelectedOn && inRange(d._raw.buyerSelectedOn); }).map(function (d) {
    return (tms_(d._raw.buyerSelectedOn) - (tms_(d._raw.firstDistributed) || tms_(d._raw.created))) / 86400000;
  }).filter(function (x) { return x >= 0; });
  var fees = closed.map(function (d) { return dealFee_(d._raw); }).filter(function (x) { return x > 0; });
  var sentPairs = {}, respPairs = {}, interestPairs = {};
  A.log.forEach(function (l) { if (l.mode === 'LIVE' && l.status === 'Sent' && inRange(l.sentAt)) sentPairs[l.dealId + '|' + l.investorId] = true; });
  A.resp.forEach(function (r) {
    var k = r.dealId + '|' + r.investorId;
    if (sentPairs[k]) respPairs[k] = true;
    if ((r.type === 'Interested' || r.type === 'Offer') && inRange(r.received)) interestPairs[k] = true;
  });
  A.offers.forEach(function (o) { if (inRange(o.received)) interestPairs[o.dealId + '|' + o.investorId] = true; });
  var byKey = function (fn) {
    var m = {};
    closed.forEach(function (d) { var k = fn(d) || 'Unassigned'; m[k] = m[k] || { name: k, deals: 0, revenue: 0 }; m[k].deals++; m[k].revenue += dealFee_(d._raw); });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.revenue - a.revenue; });
  };
  var months = [];
  for (var i = 5; i >= 0; i--) {
    var dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i);
    var key = fmtDate_(dt, 'yyyy-MM');
    var md = deals.filter(function (d) { return d.stage === 'Closed' && fmtDate_(asDate_(d._raw.soldDate) || new Date(0), 'yyyy-MM') === key; });
    months.push({ name: fmtDate_(dt, 'MMM yyyy'), deals: md.length, revenue: md.reduce(function (t, d) { return t + dealFee_(d._raw); }, 0) });
  }
  var stuckDays = Number(getSettings_().FU_STUCK_DAYS) || 7;
  var stale = deals.filter(function (d) { return ['Closed', 'Dead Deal'].indexOf(d.stage) === -1; }).map(function (d) {
    return { id: d.id, title: d.title, stage: d.stage, rep: d.rep, days: Math.floor((Date.now() - dealLastActivity_(d._raw, A)) / 86400000) };
  }).filter(function (x) { return x.days >= stuckDays; }).sort(function (a, b) { return b.days - a.days; });
  var top = A.invs.map(function (inv) { var s = stats[inv.id]; return { id: inv.id, name: investorName_(inv), tier: str_(inv.tier), heat: s.heat, closed: s.closed, offers: s.offers, responseRate: s.responseRate, closeRate: s.closeRate }; })
    .filter(function (x) { return x.heat > 0 || x.closed > 0; }).sort(function (a, b) { return b.closed - a.closed || b.heat - a.heat; }).slice(0, 10);
  var stages = {};
  deals.forEach(function (d) { stages[d.stage] = (stages[d.stage] || 0) + 1; });
  return toClient_({
    days: days,
    kpi: {
      dealsDistributed: distributed.length,
      avgOffersPerDeal: distributed.length ? Math.round((offersOnDist.length / distributed.length) * 10) / 10 : 0,
      avgDaysToBuyer: daysToBuyer.length ? Math.round(avg_(daysToBuyer) * 10) / 10 : null,
      avgFee: fees.length ? Math.round(avg_(fees)) : null,
      revenue: fees.reduce(function (t, x) { return t + x; }, 0),
      closedDeals: closed.length,
      distToContract: pct_(contracted.length, distributed.length),
      responseRate: pct_(Object.keys(respPairs).length, Object.keys(sentPairs).length),
      buyerToClosing: pct_(closed.length, Object.keys(interestPairs).length),
      activeDeals: deals.filter(function (d) { return d.status === 'Available'; }).length,
      underContract: deals.filter(function (d) { return d.stageIndex >= 5 && d.stageIndex <= 8; }).length
    },
    byMarket: byKey(function (d) { return marketOf_(d._raw); }),
    byRep: byKey(function (d) { return str_(d.rep).replace(/\s*<[^>]+>/, ''); }),
    months: months,
    topInvestors: top,
    stale: stale.slice(0, 15),
    stages: PIPELINE_STAGES.map(function (st) { return { stage: st, count: stages[st] || 0 }; })
  });
}

function getDistributionAnalytics() {
  requireRole_('Viewer');
  var A = loadAll_(), comp = competitionMap_(A);
  var rows = A.deals.filter(function (d) { return tms_(d.firstDistributed) || Number(d.timesDistributed); }).map(function (d) {
    var sent = A.log.filter(function (l) { return l.dealId === d.id && l.mode === 'LIVE' && l.status === 'Sent'; });
    var recv = {}, firstSent = Infinity;
    sent.forEach(function (l) { recv[l.investorId] = true; firstSent = Math.min(firstSent, tms_(l.sentAt) || Infinity); });
    var rs = A.resp.filter(function (r) { return r.dealId === d.id; });
    var responded = {}, interested = {}, passes = {}, firstResp = Infinity;
    rs.forEach(function (r) {
      responded[r.investorId || r.investorEmail] = true;
      firstResp = Math.min(firstResp, tms_(r.received) || Infinity);
      if (r.type === 'Interested' || r.type === 'Offer') interested[r.investorId || r.investorEmail] = true;
      if (r.type === 'Not Interested') { var why = str_(r.passReason) || 'Other'; passes[why] = (passes[why] || 0) + 1; }
    });
    var offers = A.offers.filter(function (o) { return o.dealId === d.id; });
    var waves = {};
    sent.forEach(function (l) { var w = Number(l.wave) || 1; waves[w] = (waves[w] || 0) + 1; });
    var c = cleanDealRow_(d);
    return {
      id: d.id, title: dealTitle_(d), stage: c.stage, market: marketOf_(d), received: Object.keys(recv).length, responded: Object.keys(responded).length,
      responseRate: pct_(Object.keys(responded).length, Object.keys(recv).length), interested: Object.keys(interested).length, offers: offers.length,
      bestOffer: Math.max.apply(null, offers.map(function (o) { return Number(o.amount) || 0; }).concat([0])), competition: comp[d.id] || 0,
      passes: passes, passTotal: Object.keys(passes).reduce(function (t, k) { return t + passes[k]; }, 0),
      hoursToFirstResponse: firstSent < Infinity && firstResp < Infinity && firstResp >= firstSent ? Math.round((firstResp - firstSent) / 3600000) : null,
      waves: waves, lastDistributed: d.lastDistributed
    };
  }).sort(function (a, b) { return tms_(b.lastDistributed) - tms_(a.lastDistributed); });
  var reasons = {};
  A.resp.forEach(function (r) { if (r.type === 'Not Interested') { var k = str_(r.passReason) || 'Other'; reasons[k] = (reasons[k] || 0) + 1; } });
  var tot = function (k) { return rows.reduce(function (t, r) { return t + r[k]; }, 0); };
  return toClient_({
    deals: rows,
    totals: { received: tot('received'), responded: tot('responded'), interested: tot('interested'), offers: tot('offers'), passes: tot('passTotal'), responseRate: pct_(tot('responded'), tot('received')) },
    passReasons: PASS_REASONS.map(function (k) { return { reason: k, count: reasons[k] || 0 }; }),
    note: 'Opens and clicks are not tracked: the app is private to your Google account, so it cannot host the public tracking link those require. Received, responded, interested, offers and passes are exact.'
  });
}

/** One buyer's full picture: heat, closing performance and every deal sent + how they responded. */
function getInvestorProfile(investorId) {
  requireRole_('Viewer');
  var A = loadAll_(), stats = buyerStats_(A);
  var inv = A.invs.filter(function (i) { return i.id === investorId; })[0];
  if (!inv) throw new Error('Buyer not found.');
  var deals = {};
  A.deals.forEach(function (d) { deals[d.id] = d; });
  var hist = {};
  var row = function (id) { return hist[id] || (hist[id] = { dealId: id, property: deals[id] ? dealTitle_(deals[id]) : id, sentAt: '', responses: [], offers: [], outcome: '' }); };
  A.log.forEach(function (l) { if (l.investorId === investorId && l.mode === 'LIVE' && l.status === 'Sent') row(l.dealId).sentAt = l.sentAt; });
  A.resp.forEach(function (r) { if (r.investorId === investorId && r.dealId) row(r.dealId).responses.push({ type: r.type, received: r.received, passReason: r.passReason, offerAmount: r.offerAmount }); });
  A.offers.forEach(function (o) { if (o.investorId === investorId) row(o.dealId).offers.push({ amount: o.amount, status: o.status, received: o.received }); });
  Object.keys(hist).forEach(function (id) {
    var d = deals[id], h = hist[id];
    if (d && str_(d.buyerInvestorId) === investorId) h.outcome = cleanDealRow_(d).stage === 'Closed' ? 'Bought it' : 'Selected buyer';
    else if (h.offers.length) h.outcome = 'Made offer';
    else if (h.responses.some(function (r) { return r.type === 'Not Interested'; })) h.outcome = 'Passed';
    else if (h.responses.length) h.outcome = 'Responded';
    else h.outcome = 'No response';
  });
  return toClient_({ investor: cleanInvestorRow_(inv), stats: stats[investorId], history: Object.keys(hist).map(function (k) { return hist[k]; }).sort(function (a, b) { return tms_(b.sentAt) - tms_(a.sentAt); }) });
}

function getTierCenter() {
  requireRole_('Viewer');
  var A = loadAll_(), stats = buyerStats_(A), s = getSettings_(), tiers = list_(s.TIERS);
  var active = A.invs.filter(function (i) { return (str_(i.status) || 'Active') === 'Active'; });
  var byTier = tiers.concat(['Unassigned']).map(function (t) {
    var members = active.filter(function (i) { return t === 'Unassigned' ? tiers.map(lc_).indexOf(lc_(i.tier)) === -1 : lc_(i.tier) === lc_(t); });
    return { tier: t, count: members.length, avgHeat: Math.round(avg_(members.map(function (i) { return stats[i.id].heat; }))),
      buyers: members.map(function (i) { return { id: i.id, name: investorName_(i), heat: stats[i.id].heat, closed: stats[i.id].closed, pof: pofStatus_(i), responseRate: stats[i.id].responseRate }; }).sort(function (a, b) { return b.heat - a.heat; }) };
  });
  var recent = A.invs.filter(function (i) { return tms_(i.tierChanged) > Date.now() - 60 * 86400000; }).map(function (i) { return { id: i.id, name: investorName_(i), tier: str_(i.tier), changed: i.tierChanged }; });
  var plan = tierPlan_(A, stats).map(function (p) { return { id: p.id, name: p.name, from: p.from, to: p.to, reason: p.reason, up: p.up }; });
  return toClient_({ tiers: byTier, plan: plan, recent: recent, auto: bool_(s.AUTO_TIER_ON), nightly: hasTrigger_('runNightly'), lastNightly: s.LAST_NIGHTLY_RUN || '',
    reactivation: reactivationCandidates_(A, stats), recovery: recoveryCandidates_(A) });
}

function runTierUpgradesNow() {
  requireRole_('Rep');
  return withLock_(function () {
    var A = loadAll_(), stats = buyerStats_(A);
    writeHeatColumn_(A, stats);
    var n = applyTierPlan_(tierPlan_(A, stats));
    var c = getTierCenter(); c.applied = n;
    return c;
  });
}

/** Sends the re-engagement email to selected inactive buyers (LIVE needs typed SEND). */
function launchReactivation(ids, typed) {
  requireRole_('Rep');
  var test = isTestMode_();
  if (!test && String(typed || '').trim().toUpperCase() !== 'SEND') throw new Error('Type SEND to email these buyers.');
  return withLock_(function () {
    var s = getSettings_(), testTo = str_(s.TEST_EMAIL) || currentUser_(), maxTest = parseInt(s.TEST_MODE_MAX_EMAILS, 10) || 3;
    var A = loadAll_(), stats = buyerStats_(A);
    var allowed = {};
    reactivationCandidates_(A, stats).forEach(function (c) { allowed[c.id] = true; });
    var log = [], sent = 0, quota = remainingQuota_(); if (quota < 0) quota = 1e9;
    A.invs.forEach(function (inv) {
      if (ids.indexOf(inv.id) === -1 || !allowed[inv.id] || quota <= 0) return;
      var e = reactivationEmail_(inv, s);
      var to = test ? testTo : lc_(inv.email);
      var row = { id: shortId_('F-'), key: 'reactivate|' + inv.id + '|' + fmtDate_(new Date(), 'yyyyMMdd'), type: 'Reactivation', dealId: '', property: '', investorId: inv.id, investorName: investorName_(inv), to: to, channel: 'Email to buyer', subject: e.subject, sentAt: new Date(), status: test ? 'Test' : 'Sent', mode: test ? 'TEST' : 'LIVE' };
      if (test && sent >= maxTest) { row.status = 'Simulated'; log.push(row); return; }
      try {
        sendOne_(to, (test ? '[TEST] ' : '') + e.subject, personalize_(e.text, inv, test ? testBanner_(inv, false) : '', false), personalize_(e.html, inv, test ? testBanner_(inv, true) : '', true), null, s);
        sent++; quota--;
      } catch (err) { row.status = 'Failed: ' + String(err.message || err).slice(0, 120); }
      log.push(row);
    });
    appendObjects_(SHEET.FOLLOWUPS, log);
    var c = getTierCenter(); c.reactivated = log.length; c.sent = sent;
    return c;
  });
}

function getMarketReport() {
  requireRole_('Viewer');
  var A = loadAll_(), stats = buyerStats_(A), s = getSettings_();
  var names = list_(s.MARKETS);
  A.deals.forEach(function (d) { var m = marketOf_(d); if (m !== 'Unassigned' && names.map(lc_).indexOf(lc_(m)) === -1) names.push(m); });
  var active = A.invs.filter(function (i) { return (str_(i.status) || 'Active') === 'Active' && !bool_(i.optOut); });
  var rows = names.map(function (m) {
    var lm = lc_(m);
    var buyers = active.filter(function (i) { return list_(i.markets).some(function (x) { return lc_(x) === lm || lc_(x).indexOf(lm) > -1 || lm.indexOf(lc_(x)) > -1; }) || lc_(i.purchases).indexOf(lm) > -1; });
    var deals = A.deals.filter(function (d) { return lc_(marketOf_(d)) === lm || lc_(d.city) === lm; }).map(function (d) { var c = cleanDealRow_(d); c._raw = d; return c; });
    var closed = deals.filter(function (d) { return d.stage === 'Closed'; });
    var fees = closed.map(function (d) { return dealFee_(d._raw); }).filter(function (x) { return x > 0; });
    var land = buyers.filter(function (i) { return /develop|builder/i.test(i.categories) || /land|lot/i.test(i.propertyTypes); });
    return {
      market: m, buyers: buyers.length, landBuyers: land.length, verified: buyers.filter(function (i) { return pofStatus_(i) === 'Verified'; }).length,
      activeDeals: deals.filter(function (d) { return d.status === 'Available'; }).length, underContract: deals.filter(function (d) { return d.stageIndex >= 5 && d.stageIndex <= 8; }).length,
      closed: closed.length, revenue: fees.reduce(function (t, x) { return t + x; }, 0), avgFee: fees.length ? Math.round(avg_(fees)) : null,
      topBuyers: buyers.map(function (i) { return { id: i.id, name: investorName_(i), heat: stats[i.id].heat }; }).sort(function (a, b) { return b.heat - a.heat; }).slice(0, 5)
    };
  });
  return toClient_({ markets: rows });
}

/** Builders, developers and land buyers, ranked by land purchases — and who's buying where. */
function getLandBuyers() {
  requireRole_('Viewer');
  var A = loadAll_(), stats = buyerStats_(A);
  var landClosed = {};
  A.deals.forEach(function (d) { if (isLandDeal_(d) && cleanDealRow_(d).stage === 'Closed' && d.buyerInvestorId) landClosed[d.buyerInvestorId] = (landClosed[d.buyerInvestorId] || 0) + 1; });
  var activity = {};
  var buyers = A.invs.filter(function (i) { return str_(i.status) !== 'Inactive'; }).map(function (inv) {
    var entries = String(inv.purchases || '').split(/;\s*/).filter(function (x) { return /\blots?\b|\bland\b|acre|vacant|parcel|· land/i.test(x); });
    var cities = {};
    entries.forEach(function (e) { var m = e.match(/,\s*([^,—]+?)\s*—/); var c = m ? titleCase_(m[1]) : ''; if (c) { cities[c] = (cities[c] || 0) + 1; (activity[c] = activity[c] || {})[inv.id] = ((activity[c] || {})[inv.id] || 0) + 1; } });
    var isDev = /develop|builder|construction/i.test(inv.categories) || /land|lot/i.test(inv.propertyTypes);
    var landBuys = entries.length + (landClosed[inv.id] || 0);
    return { id: inv.id, name: investorName_(inv), company: str_(inv.company), email: str_(inv.email), status: str_(inv.status), tier: str_(inv.tier), categories: str_(inv.categories),
      markets: str_(inv.markets), acres: (inv.minAcres || inv.maxAcres) ? (Number(inv.minAcres) || 0) + '–' + (Number(inv.maxAcres) || 'any') + ' ac' : '', landBuys: landBuys,
      boughtFromUs: landClosed[inv.id] || 0, cities: cities, heat: stats[inv.id].heat, isDev: isDev };
  }).filter(function (b) { return b.isDev || b.landBuys > 0; }).sort(function (a, b) { return b.landBuys - a.landBuys || b.heat - a.heat; });
  var byId = {};
  buyers.forEach(function (b) { byId[b.id] = b; });
  var builderActivity = Object.keys(activity).map(function (city) {
    var list = Object.keys(activity[city]).map(function (id) { return { id: id, name: byId[id] ? byId[id].name : id, lots: activity[city][id] }; }).sort(function (a, b) { return b.lots - a.lots; });
    return { market: city, lots: list.reduce(function (t, x) { return t + x.lots; }, 0), builders: list };
  }).sort(function (a, b) { return b.lots - a.lots; });
  return toClient_({ buyers: buyers, builderActivity: builderActivity });
}

function enableNightly() {
  requireRole_('Owner');
  deleteTriggers_('runNightly');
  ScriptApp.newTrigger('runNightly').timeBased().everyDays(1).atHour(2).create();
  return getTierCenter();
}

function disableNightly() {
  requireRole_('Owner');
  deleteTriggers_('runNightly');
  return getTierCenter();
}
