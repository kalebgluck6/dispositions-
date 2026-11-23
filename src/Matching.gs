/**
 * Matching.gs — Smart Buyer Matching.
 *
 * Scores every buyer 0–100 against a deal using their buy box and real behavior:
 *   location (zip 30 / city-market 25 / has bought there 20) · property type 20 · price 15 ·
 *   acreage 10 (land) · rehab vs turnkey 5 · ROI 5 · tier 10 · engagement 5 · verified funds 3 ·
 *   closed deals with us (+) · contract defaults (−)
 * Hard "blockers" (deal is outside what they told you they buy) exclude a buyer entirely.
 * Fit: strong ≥ 70 · good ≥ MATCH_MIN_SCORE · weak below · no = blocked.
 */

function isLandDeal_(d) {
  return /land|lot|acre|parcel/i.test(str_(d.propertyType)) || (dealAcres_(d) > 0 && !Number(d.sqft) && !Number(d.beds));
}

function dealAcres_(d) {
  if (Number(d.acres) > 0) return Number(d.acres);
  var t = lc_(d.lotSize), m;
  if ((m = t.match(/([\d.]+)\s*(ac|acre)/))) return parseFloat(m[1]);
  if ((m = t.match(/([\d,]+)\s*(sq|sf)/))) return parseFloat(m[1].replace(/,/g, '')) / 43560;
  return 0;
}

function tierRank_(tier) {
  var tiers = list_(getSettings_().TIERS).map(lc_);
  var i = tiers.indexOf(lc_(tier));
  return i < 0 ? 99 : i; // 0 = top tier
}

function isRehabDeal_(d) {
  var price = Number(d.askingPrice) || 0, rep = Number(d.repairs) || 0;
  return rep >= 15000 || (price && rep / price >= 0.1);
}

function dealRoi_(d) {
  var m = dealMetrics_(d);
  return m.allIn && m.spread !== '' ? Math.round((m.spread / m.allIn) * 1000) / 10 : '';
}

/** Behavior lookups for many investors at once. */
function matchContext_(dealId) {
  var resp = {}, offers = {};
  readTable_(SHEET.RESPONSES).rows.forEach(function (r) {
    if (!r.investorId) return;
    var k = r.investorId;
    resp[k] = resp[k] || { interested: 0, total: 0 };
    resp[k].total++;
    if (r.type === 'Interested' || r.type === 'Offer') resp[k].interested++;
  });
  readTable_(SHEET.OFFERS).rows.forEach(function (o) { if (o.investorId) offers[o.investorId] = (offers[o.investorId] || 0) + 1; });
  return { resp: resp, offers: offers, dealId: dealId };
}

function matchInvestor_(inv, deal, ctx) {
  var reasons = [], blockers = [], score = 0;
  var city = lc_(deal.city), market = lc_(deal.market), zip = str_(deal.zip).slice(0, 5);
  var land = isLandDeal_(deal);

  // Location (30)
  var zips = list_(inv.zips).map(function (z) { return z.slice(0, 5); });
  var mkts = list_(inv.markets).map(lc_);
  var boughtHere = city && lc_(inv.purchases).indexOf(city) > -1;
  var mktHit = mkts.some(function (m) { return (market && (m === market || m.indexOf(market) > -1 || market.indexOf(m) > -1)) || (city && (m === city || m.indexOf(city) > -1)); });
  if (zip && zips.indexOf(zip) > -1) { score += 30; reasons.push('Buys in ' + zip); }
  else if (mktHit) { score += 25; reasons.push('Buys in ' + (deal.market || deal.city)); }
  else if (boughtHere) { score += 20; reasons.push('Has bought in ' + titleCase_(deal.city)); }
  else if (!zips.length && !mkts.length) { score += 10; }
  else blockers.push('Outside their areas');
  if (boughtHere && (mktHit || zips.indexOf(zip) > -1)) { score += 5; reasons.push('Recent purchases nearby'); }

  // Property type (20)
  var types = list_(inv.propertyTypes).map(lc_);
  var dType = lc_(normalizePropType_(deal.propertyType));
  var dev = /develop|builder|construction/i.test(inv.categories);
  if (land) {
    if (types.some(function (t) { return /land|lot/.test(t); }) || dev) { score += 20; reasons.push(dev ? 'Builder / developer' : 'Buys land'); }
    else if (!types.length) score += 4;
    else blockers.push('Doesn\'t buy land');
  } else if (!types.length) score += 8;
  else if (dType && types.some(function (t) { return t === dType || t.indexOf(dType) > -1 || dType.indexOf(t) > -1; })) { score += 20; reasons.push('Buys ' + normalizePropType_(deal.propertyType)); }
  else if (dType) blockers.push('Doesn\'t buy ' + normalizePropType_(deal.propertyType));

  // Price (15)
  var price = Number(deal.askingPrice) || 0, max = Number(inv.maxPrice) || 0, min = Number(inv.minPrice) || 0;
  if (price && max && price > max * 1.05) blockers.push('Above their max ' + money_(max));
  else if (price && (max || min)) {
    if (min && price < min * 0.8) { score += 5; reasons.push('Below their usual range'); }
    else { score += 15; reasons.push('Within budget'); }
  } else score += 6;

  // Acreage (10, land)
  var acres = dealAcres_(deal);
  var minA = Number(inv.minAcres) || 0, maxA = Number(inv.maxAcres) || 0;
  if (acres && (minA || maxA)) {
    if ((minA && acres < minA) || (maxA && acres > maxA)) blockers.push('Acreage outside ' + (minA || 0) + '–' + (maxA || 'any') + ' ac');
    else { score += 10; reasons.push(acres + ' ac fits'); }
  } else if (land) score += 4;

  // Rehab vs turnkey (5)
  var cond = lc_(inv.condition);
  if (!land && cond) {
    var rehab = isRehabDeal_(deal);
    if (cond === 'either') score += 3;
    else if ((cond === 'rehab') === rehab) { score += 5; reasons.push(rehab ? 'Wants rehabs' : 'Wants turnkey'); }
    else { score -= 5; reasons.push('Prefers ' + (rehab ? 'turnkey' : 'rehab')); }
  }

  // ROI (5)
  var roi = dealRoi_(deal), minRoi = Number(inv.minRoi) || 0;
  if (!land && minRoi && roi !== '') {
    if (roi >= minRoi) { score += 5; reasons.push('ROI ' + roi + '% ≥ their ' + minRoi + '%'); }
    else { score -= 5; reasons.push('ROI ' + roi + '% below their ' + minRoi + '%'); }
  }

  // Tier (10)
  var rank = tierRank_(inv.tier);
  score += rank === 0 ? 10 : rank === 1 ? 6 : rank === 2 ? 3 : 0;
  if (rank === 0) reasons.push(inv.tier + ' buyer');

  // Behavior
  var r = (ctx && ctx.resp[inv.id]) || { interested: 0 };
  if (r.interested) { score += Math.min(5, r.interested * 2); reasons.push('Responsive (' + r.interested + ' interested)'); }
  if (pofStatus_(inv) === 'Verified') { score += 3; reasons.push('POF verified'); }
  var closed = Number(inv.dealsClosed) || 0, defaults = Number(inv.defaults) || 0;
  if (closed) { score += Math.min(8, closed * 2); reasons.push(closed + ' closed with us'); }
  if (defaults) { score -= defaults * 10; reasons.push(defaults + ' contract default' + (defaults > 1 ? 's' : '')); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  var minScore = parseInt(getSettings_().MATCH_MIN_SCORE, 10) || 50;
  var fit = blockers.length ? 'no' : score >= 70 ? 'strong' : score >= minScore ? 'good' : 'weak';
  return { score: blockers.length ? 0 : score, rawScore: score, fit: fit, reasons: reasons, blockers: blockers, tierRank: rank };
}

/** Ranks every active buyer for a deal. */
function rankBuyers_(deal, investors) {
  var ctx = matchContext_(deal.id);
  return investors.map(function (inv) {
    var m = matchInvestor_(inv, deal, ctx);
    m.investor = inv;
    return m;
  }).sort(function (a, b) { return (b.score - a.score) || (a.tierRank - b.tierRank); });
}

// ---------- client API ----------

function matchBuyers(dealId) {
  requireRole_('Viewer');
  var deal = getDealRow_(dealId);
  var all = readTable_(SHEET.INVESTORS).rows;
  var active = all.filter(function (i) { return (str_(i.status) || 'Active') === 'Active' && !bool_(i.optOut) && isEmail_(i.email); });
  var ranked = rankBuyers_(deal, active);
  var stats = buyerStats_(loadAll_());
  var counts = { strong: 0, good: 0, weak: 0, no: 0 };
  ranked.forEach(function (m) { counts[m.fit]++; });
  return toClient_({
    deal: cleanDealRow_(deal),
    land: isLandDeal_(deal),
    acres: dealAcres_(deal),
    counts: counts,
    pendingReview: all.filter(function (i) { return str_(i.status) === PENDING_REVIEW; }).length,
    matches: ranked.map(function (m) {
      var i = m.investor;
      return {
        id: i.id, name: investorName_(i), company: str_(i.company), email: str_(i.email), tier: str_(i.tier),
        score: m.score, fit: m.fit, reasons: m.reasons, blockers: m.blockers, pofStatus: pofStatus_(i),
        reliability: reliabilityOf_(i), markets: str_(i.markets), maxPrice: i.maxPrice, dealsReceived: Number(i.dealsReceived) || 0,
        heat: stats[i.id] ? stats[i.id].heat : 0,
        // Best Buyer Predictor: fit (60%) blended with real behavior (heat, 40%)
        likelihood: m.fit === 'no' ? 0 : Math.round(0.6 * m.score + 0.4 * (stats[i.id] ? stats[i.id].heat : 0))
      };
    })
  });
}
