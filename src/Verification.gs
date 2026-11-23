/**
 * Verification.gs — Buyer Verification Center.
 * Proof of funds (stored privately in Drive), entity, purchase history, completed transactions,
 * contract defaults and an automatic reliability rating. Flags expired / expiring POF and
 * buyers with failed closings.
 */

/** None | Pending (uploaded, not verified) | Verified | Expiring (≤14 days) | Expired */
function pofStatus_(inv) {
  var file = str_(inv.pofFileUrl), verified = inv.pofVerifiedOn;
  if (!file && !verified) return 'None';
  if (!verified) return 'Pending';
  var exp = parseDateLoose_(inv.pofExpires);
  if (exp) {
    var left = exp.getTime() - Date.now();
    if (left < 0) return 'Expired';
    if (left < 14 * 86400000) return 'Expiring';
  }
  return 'Verified';
}

/** 1–5 stars from closings vs defaults; '' when there's no history yet. Manual rating wins if set. */
function reliabilityOf_(inv) {
  var manual = Number(inv.reliability);
  if (manual >= 1 && manual <= 5) return manual;
  var closed = Number(inv.dealsClosed) || 0, defaults = Number(inv.defaults) || 0;
  if (!closed && !defaults) return '';
  return Math.max(1, Math.min(5, Math.round(3 + Math.min(closed, 4) * 0.5 - defaults * 1.5)));
}

function buyerFlags_(inv) {
  var f = [], pof = pofStatus_(inv);
  if (pof === 'Expired') f.push('POF expired');
  if (pof === 'Expiring') f.push('POF expiring soon');
  if (pof === 'Pending') f.push('POF needs verification');
  if (Number(inv.defaults) > 0) f.push(inv.defaults + ' failed closing' + (Number(inv.defaults) > 1 ? 's' : ''));
  return f;
}

function pofFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('POF_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  var folder = rootFolder_().createFolder('Proof of Funds (private)'); // never shared by link
  props.setProperty('POF_FOLDER_ID', folder.getId());
  return folder;
}

// ---------- client API ----------

/** Upload a proof-of-funds document for a buyer (status becomes Pending until verified). */
function uploadPof(investorId, fileName, mimeType, base64, amount, expires) {
  requireRole_('Rep');
  var inv = findBy_(SHEET.INVESTORS, 'id', investorId);
  if (!inv) throw new Error('Buyer not found.');
  var file = pofFolder_().createFile(blobFromBase64_(base64, mimeType, investorId + ' — POF — ' + (fileName || 'document')));
  return withLock_(function () {
    var fresh = findBy_(SHEET.INVESTORS, 'id', investorId);
    var f = { pofFileUrl: file.getUrl(), pofVerifiedOn: '', updated: new Date() };
    if (amount !== undefined && amount !== '') f.pofAmount = num_(amount);
    if (expires) f.pofExpires = str_(expires);
    updateObject_(SHEET.INVESTORS, fresh._row, f);
    return cleanInvestorRow_(findBy_(SHEET.INVESTORS, 'id', investorId));
  });
}

/** Mark POF verified (sets amount / expiry; default expiry = today + POF_VALID_DAYS). */
function verifyPof(investorId, amount, expires) {
  requireRole_('Rep');
  return withLock_(function () {
    var inv = findBy_(SHEET.INVESTORS, 'id', investorId);
    if (!inv) throw new Error('Buyer not found.');
    var days = parseInt(getSettings_().POF_VALID_DAYS, 10) || 90;
    var exp = str_(expires) || fmtDate_(new Date(Date.now() + days * 86400000));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) throw new Error('Expiry must be a date.');
    var f = { pofVerifiedOn: new Date(), pofExpires: exp, updated: new Date() };
    if (amount !== undefined && amount !== '') f.pofAmount = num_(amount);
    updateObject_(SHEET.INVESTORS, inv._row, f);
    return cleanInvestorRow_(findBy_(SHEET.INVESTORS, 'id', investorId));
  });
}

/** outcome: 'closed' | 'default'. Updates counts, reliability and last deal bought. */
function recordBuyerOutcome(investorId, outcome, dealId, note) {
  requireRole_('Rep');
  return withLock_(function () { return recordBuyerOutcome_(investorId, outcome, dealId, note); });
}

function recordBuyerOutcome_(investorId, outcome, dealId, note) {
  var inv = findBy_(SHEET.INVESTORS, 'id', investorId);
  if (!inv) throw new Error('Buyer not found.');
  var f = { updated: new Date() };
  var deal = dealId ? findBy_(SHEET.DEALS, 'id', dealId) : null;
  if (outcome === 'closed') {
    f.dealsClosed = (Number(inv.dealsClosed) || 0) + 1;
    if (deal) f.lastDealBought = deal.id + ' — ' + dealTitle_(deal) + ' (' + fmtDate_(new Date(), 'MMM d, yyyy') + ')';
  } else if (outcome === 'default') {
    f.defaults = (Number(inv.defaults) || 0) + 1;
    f.notes = (str_(inv.notes) + ' [Failed closing' + (deal ? ' on ' + deal.id : '') + ' ' + fmtDate_(new Date()) + (note ? ': ' + note : '') + ']').trim();
  } else throw new Error('Unknown outcome.');
  updateObject_(SHEET.INVESTORS, inv._row, f);
  return cleanInvestorRow_(findBy_(SHEET.INVESTORS, 'id', investorId));
}

function setBuyerRating(investorId, rating) {
  requireRole_('Rep');
  return withLock_(function () {
    var inv = findBy_(SHEET.INVESTORS, 'id', investorId);
    if (!inv) throw new Error('Buyer not found.');
    var r = Number(rating);
    updateObject_(SHEET.INVESTORS, inv._row, { reliability: r >= 1 && r <= 5 ? r : '', updated: new Date() });
    return cleanInvestorRow_(findBy_(SHEET.INVESTORS, 'id', investorId));
  });
}

/** Everything the Verification Center screen needs. */
function getVerificationCenter() {
  requireRole_('Viewer');
  var invs = readTable_(SHEET.INVESTORS).rows.filter(function (i) { return str_(i.status) !== 'Inactive'; });
  var activeOffers = {};
  readTable_(SHEET.OFFERS).rows.forEach(function (o) {
    if (['Received', 'Countered', 'Accepted', 'Backup', 'Under Contract'].indexOf(o.status) > -1) activeOffers[o.investorId] = (activeOffers[o.investorId] || 0) + 1;
  });
  var rows = invs.map(function (i) {
    var c = cleanInvestorRow_(i);
    c.activeOffers = activeOffers[i.id] || 0;
    if (c.activeOffers && c.pofStatus !== 'Verified' && c.pofStatus !== 'Expiring') c.flags.push('Active offer without verified POF');
    return c;
  });
  var count = function (fn) { return rows.filter(fn).length; };
  return {
    buyers: rows,
    summary: {
      verified: count(function (r) { return r.pofStatus === 'Verified'; }),
      expiring: count(function (r) { return r.pofStatus === 'Expiring'; }),
      expired: count(function (r) { return r.pofStatus === 'Expired'; }),
      pending: count(function (r) { return r.pofStatus === 'Pending'; }),
      defaults: count(function (r) { return Number(r.defaults) > 0; }),
      offersNoPof: count(function (r) { return r.activeOffers && ['Verified', 'Expiring'].indexOf(r.pofStatus) === -1; })
    }
  };
}
