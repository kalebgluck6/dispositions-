/**
 * FollowUps.gs — Automatic Buyer Follow-Ups.
 *
 * Runs every 2 hours during business hours (8 AM–8 PM). Each rule fires once per buyer/deal
 * (tracked in the "Follow-Ups" sheet) so nobody gets spammed:
 *   Buyer emails
 *     noresp   — matched buyer received the deal, no response after FU_NORESP_HOURS
 *     offer    — buyer said Interested, no offer after FU_OFFER_HOURS
 *     pof      — offer without verified proof of funds (up to 3 reminders, 48h apart)
 *     deadline — offer deadline within 24h, interested buyers without an offer
 *     emd      — buyer selected 2+ days ago, EMD not received
 *     closing  — closing within FU_CLOSING_DAYS
 *   Rep alerts (one digest email per rep)
 *     quiet    — interested buyer / selected buyer silent FU_QUIET_DAYS
 *     stuck    — deal unchanged in its stage FU_STUCK_DAYS
 *     closing / emd — heads-up for the rep
 * Opted-out buyers are never emailed. In TEST mode buyer emails go to TEST_EMAIL.
 */

var FU_TYPES = {
  noresp: 'No response',
  offer: 'Offer reminder',
  pof: 'Proof of funds',
  deadline: 'Offer deadline',
  emd: 'EMD reminder',
  closing: 'Closing reminder',
  quiet: 'Buyer went quiet',
  stuck: 'Deal stuck'
};

function hoursSince_(v) { var d = asDate_(v); return d ? (Date.now() - d.getTime()) / 3600000 : Infinity; }

function repEmail_(deal) {
  var r = str_(deal && deal.rep);
  var m = r.match(/<([^>]+)>/);
  var e = m ? m[1] : r;
  if (isEmail_(e)) return lc_(e);
  var reps = list_(getSettings_().REPS);
  var hit = reps.filter(function (x) { return lc_(x).indexOf(lc_(r)) === 0 && r; })[0];
  if (hit) { var mm = hit.match(/<([^>]+)>/); if (mm && isEmail_(mm[1])) return lc_(mm[1]); }
  return replyTo_();
}

/** Works out every follow-up that is due right now (nothing is sent here). */
function planFollowUps_() {
  var s = getSettings_();
  var H = function (k, d) { var n = Number(s[k]); return isNaN(n) || s[k] === '' ? d : n; };
  var sent = {};
  readTable_(SHEET.FOLLOWUPS).rows.forEach(function (f) {
    if (f.status === 'Sent' || f.status === 'Test') sent[f.key] = f;
  });
  var invById = {};
  readTable_(SHEET.INVESTORS).rows.forEach(function (i) { invById[i.id] = i; });
  var deals = readTable_(SHEET.DEALS).rows.map(function (d) { var c = cleanDealRow_(d); c._raw = d; return c; });
  var respBy = {}, offerBy = {}, sentBy = {};
  readTable_(SHEET.RESPONSES).rows.forEach(function (r) { if (r.dealId && r.investorId) (respBy[r.dealId + '|' + r.investorId] = respBy[r.dealId + '|' + r.investorId] || []).push(r); });
  var offers = readTable_(SHEET.OFFERS).rows;
  offers.forEach(function (o) { if (o.investorId) (offerBy[o.dealId + '|' + o.investorId] = offerBy[o.dealId + '|' + o.investorId] || []).push(o); });
  readTable_(SHEET.LOG).rows.forEach(function (l) { if (l.mode === 'LIVE' && l.status === 'Sent') sentBy[l.dealId + '|' + l.investorId] = l; });
  var minScore = parseInt(s.MATCH_MIN_SCORE, 10) || 50;
  var plan = [];
  var canEmail = function (inv) { return inv && (str_(inv.status) || 'Active') === 'Active' && !bool_(inv.optOut) && isEmail_(inv.email); };
  var add = function (key, type, deal, inv, kind, detail) {
    if (sent[key]) return;
    plan.push({ key: key, type: type, kind: kind, dealId: deal.id, property: deal.title, investorId: inv ? inv.id : '', investorName: inv ? investorName_(inv) : '', to: kind === 'buyer' ? lc_(inv.email) : repEmail_(deal), detail: detail || '' });
  };

  deals.forEach(function (d) {
    if (['Closed', 'Dead Deal'].indexOf(d.stage) > -1) return;
    var idx = d.stageIndex;
    var ctxM = null;

    // noresp — matched buyers who got it but never responded
    if (d.status === 'Available' && idx >= 1 && idx <= 4) {
      Object.keys(sentBy).forEach(function (k) {
        if (k.indexOf(d.id + '|') !== 0) return;
        var l = sentBy[k], inv = invById[l.investorId];
        if (!canEmail(inv) || respBy[k] || offerBy[k]) return;
        if (hoursSince_(l.sentAt) < H('FU_NORESP_HOURS', 48)) return;
        ctxM = ctxM || matchContext_(d.id);
        var m = matchInvestor_(inv, d._raw, ctxM);
        if (m.blockers.length || m.score < minScore) return;
        add('noresp|' + d.id + '|' + inv.id, 'noresp', d, inv, 'buyer', 'Match ' + m.score + ' · sent ' + fmtDate_(asDate_(l.sentAt), 'MMM d'));
      });
    }

    // offer reminders + offer deadline
    var deadline = asDate_(d.offerDeadline);
    Object.keys(respBy).forEach(function (k) {
      if (k.indexOf(d.id + '|') !== 0 || d.status !== 'Available') return;
      var inv = invById[k.split('|')[1]];
      var interested = respBy[k].filter(function (r) { return r.type === 'Interested'; });
      if (!interested.length || offerBy[k] || !canEmail(inv)) return;
      if (hoursSince_(interested[interested.length - 1].received) >= H('FU_OFFER_HOURS', 24)) add('offer|' + d.id + '|' + inv.id, 'offer', d, inv, 'buyer', 'Interested ' + fmtDate_(asDate_(interested[0].received), 'MMM d'));
      if (deadline && deadline.getTime() > Date.now() && deadline.getTime() - Date.now() <= 24 * 3600000) add('deadline|' + d.id + '|' + inv.id, 'deadline', d, inv, 'buyer', 'Deadline ' + fmtDate_(deadline, 'MMM d h:mm a'));
    });

    // quiet buyers → rep alert
    var engaged = {};
    Object.keys(respBy).forEach(function (k) { if (k.indexOf(d.id + '|') === 0 && respBy[k].some(function (r) { return r.type === 'Interested' || r.type === 'Offer'; })) engaged[k] = true; });
    Object.keys(offerBy).forEach(function (k) { if (k.indexOf(d.id + '|') === 0 && offerBy[k].some(function (o) { return ACTIVE_OFFER.indexOf(o.status) > -1; })) engaged[k] = true; });
    if (d.buyerInvestorId) engaged[d.id + '|' + d.buyerInvestorId] = true;
    Object.keys(engaged).forEach(function (k) {
      var inv = invById[k.split('|')[1]];
      if (!inv) return;
      var last = 0;
      (respBy[k] || []).forEach(function (r) { var t = asDate_(r.received); if (t) last = Math.max(last, t.getTime()); });
      (offerBy[k] || []).forEach(function (o) { [o.received, o.updated].forEach(function (v) { var t = asDate_(v); if (t) last = Math.max(last, t.getTime()); }); });
      if (!last) return;
      var days = (Date.now() - last) / 86400000;
      if (days >= H('FU_QUIET_DAYS', 3)) add('quiet|' + d.id + '|' + inv.id + '|' + fmtDate_(new Date(last)), 'quiet', d, inv, 'rep', investorName_(inv) + ' silent ' + Math.floor(days) + ' days');
    });

    // EMD + closing
    if (idx >= 5 && idx <= 8) {
      var buyer = invById[str_(d.buyerInvestorId)];
      if (idx <= 6 && !d.emdReceived && hoursSince_(d._raw.stageUpdated) >= 48) {
        if (canEmail(buyer)) add('emd|' + d.id, 'emd', d, buyer, 'buyer', 'EMD ' + (d.emdAmount ? money_(d.emdAmount) : '') + ' not received');
        add('emdrep|' + d.id, 'emd', d, buyer, 'rep', 'EMD not received from ' + (buyer ? investorName_(buyer) : d.buyer || 'buyer'));
      }
      var close = parseDateLoose_(d.closingDate);
      if (close) {
        var daysTo = (close.getTime() - Date.now()) / 86400000;
        if (daysTo >= -1 && daysTo <= H('FU_CLOSING_DAYS', 3)) {
          if (canEmail(buyer)) add('closing|' + d.id + '|' + d.closingDate, 'closing', d, buyer, 'buyer', 'Closing ' + prettyDate_(d.closingDate));
          add('closingrep|' + d.id + '|' + d.closingDate, 'closing', d, buyer, 'rep', 'Closing ' + prettyDate_(d.closingDate) + (buyer ? ' with ' + investorName_(buyer) : ''));
        }
      }
    }

    // stuck deals → rep
    if (d.stuck) add('stuck|' + d.id + '|' + fmtDate_(asDate_(d._raw.stageUpdated) || asDate_(d._raw.updated) || new Date()), 'stuck', d, null, 'rep', d.stage + ' for ' + d.daysInStage + ' days');
  });

  // proof of funds (per offer, up to 3 reminders 48h apart)
  offers.forEach(function (o) {
    if (['Received', 'Countered', 'Accepted', 'Under Contract'].indexOf(o.status) === -1) return;
    var inv = invById[o.investorId];
    if (!canEmail(inv)) return;
    var pof = pofStatus_(inv);
    if (pof === 'Verified' || pof === 'Expiring') return;
    if (hoursSince_(o.received) < H('FU_POF_HOURS', 24)) return;
    var prior = Object.keys(sent).filter(function (k) { return k.indexOf('pof|' + o.id + '|') === 0; }).map(function (k) { return sent[k]; });
    if (prior.length >= 3) return;
    if (prior.some(function (p) { return hoursSince_(p.sentAt) < 48; })) return;
    var d = deals.filter(function (x) { return x.id === o.dealId; })[0];
    if (!d || ['Closed', 'Dead Deal'].indexOf(d.stage) > -1) return;
    add('pof|' + o.id + '|' + (prior.length + 1), 'pof', d, inv, 'buyer', 'Offer ' + money_(o.amount) + ' · POF ' + pof);
  });
  return plan;
}

function fuEmail_(type, deal, inv, settings) {
  var B = BRAND, company = str_(settings.COMPANY_NAME) || APP_NAME, reply = replyTo_();
  var first = str_(inv && inv.firstName) || 'there';
  var title = deal.title || dealTitle_(deal);
  var price = money_(deal.askingPrice);
  var deadline = asDate_(deal.offerDeadline);
  var copy = {
    noresp: ['Still available: ' + title, 'Checking in on ' + title + ' (' + price + (deal.arv ? ', ARV ' + money_(deal.arv) : '') + '). It fits what you buy and it\'s still available. Want to take a look or make an offer?'],
    offer: ['Ready to make an offer on ' + title + '?', 'Thanks for your interest in ' + title + '. If it works for you, send your offer and we\'ll lock it up.' + (deadline ? ' Offers are due ' + fmtDate_(deadline, 'EEEE, MMM d \'at\' h:mm a') + '.' : '')],
    deadline: ['Offer deadline approaching: ' + title, 'Offers on ' + title + ' are due ' + (deadline ? fmtDate_(deadline, 'EEEE, MMM d \'at\' h:mm a') : 'soon') + '. If you want it, get your offer in now.'],
    pof: ['Proof of funds needed: ' + title, 'We received your offer on ' + title + ' — thank you. To keep it in consideration, please reply with proof of funds (bank statement or lender letter dated within the last 30 days).'],
    emd: ['EMD reminder: ' + title, 'Quick reminder to submit your earnest money deposit' + (deal.emdAmount ? ' of ' + money_(deal.emdAmount) : '') + ' for ' + title + ' so we can keep closing on track.'],
    closing: ['Closing reminder: ' + title + ' — ' + prettyDate_(deal.closingDate), 'Your closing on ' + title + ' is scheduled for ' + prettyDate_(deal.closingDate) + '. Please confirm funds and reach out with any questions.']
  }[type];
  var subject = copy[0] + ' [' + deal.id + ']';
  var ref = 'Deal: ' + deal.id + ' | Investor ref: ' + (inv ? inv.id : '');
  var offerLink = mailto_(reply, 'OFFER - ' + deal.id + ' - ' + str_(deal.address), 'My offer for ' + title + ' is: $\n\nProof of funds attached: Yes / No\n\n' + ref);
  var replyLink = mailto_(reply, 'Re: ' + deal.id + ' - ' + str_(deal.address), '\n\n' + ref);
  var cta = (type === 'noresp' || type === 'offer' || type === 'deadline') ? button_(offerLink, 'MAKE AN OFFER', B.accent, '#FFFFFF', B.accent, true) + '&nbsp; ' + button_(replyLink, 'REPLY', '#FFFFFF', B.green, B.green, true)
    : button_(replyLink, 'REPLY', B.accent, '#FFFFFF', B.accent, true);
  var html = '<!DOCTYPE html><html><body style="margin:0;background:#E9EDEA;">{{TEST_BANNER}}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;">' +
    '<tr><td style="background:' + B.black + ';padding:20px 28px;border-bottom:3px solid ' + B.accent + ';font-family:' + B.serif + ';font-size:22px;color:#fff;">SameDay<span style="color:' + B.accentSoft + ';">Investments</span></td></tr>' +
    '<tr><td style="padding:26px 28px;font-family:' + B.sans + ';font-size:15px;line-height:1.65;color:' + B.text + ';">' +
    '<p style="margin:0 0 14px;">Hi ' + esc_(first) + ',</p><p style="margin:0 0 18px;">' + esc_(copy[1]) + '</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + B.paper + ';border-left:3px solid ' + B.accent + ';"><tr><td style="padding:14px 16px;font-size:14px;">' +
    '<b>' + esc_(title) + '</b><br><span style="color:' + B.muted + ';">' + esc_(deal.id) + (deal.propertyType ? ' · ' + esc_(deal.propertyType) : '') + ' · ' + esc_(price) + (deal.arv ? ' · ARV ' + esc_(money_(deal.arv)) : '') + '</span></td></tr></table>' +
    '<p style="margin:22px 0 6px;">' + cta + '</p>' +
    '<p style="margin:18px 0 0;color:' + B.muted + ';font-size:13px;">' + esc_(str_(settings.CONTACT_NAME) || company) + (settings.CONTACT_PHONE ? ' · ' + esc_(settings.CONTACT_PHONE) : '') + '</p></td></tr>' +
    '<tr><td style="background:' + B.black + ';padding:16px 28px;font-family:' + B.sans + ';font-size:11px;color:#8E9A94;">' + esc_(company) + (settings.COMPANY_ADDRESS ? ' · ' + esc_(settings.COMPANY_ADDRESS) : '') +
    ' &nbsp;·&nbsp; <a href="' + mailto_(reply, 'UNSUBSCRIBE', 'Please remove me. Investor ref: ' + (inv ? inv.id : '')) + '" style="color:' + B.accentSoft + ';">Unsubscribe</a></td></tr></table></td></tr></table></body></html>';
  var text = 'Hi ' + first + ',\n\n' + copy[1] + '\n\n' + title + ' — ' + deal.id + ' — ' + price + '\n\nReply to this email to respond.\n\n' + company + (settings.COMPANY_ADDRESS ? '\n' + settings.COMPANY_ADDRESS : '') + '\nTo unsubscribe, reply UNSUBSCRIBE.';
  return { subject: subject, html: html, text: text };
}

function sendRepDigest_(to, items, settings) {
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { url = ''; }
  var rows = items.map(function (i) {
    return '<tr><td style="padding:8px 10px;border-bottom:1px solid #DDE5E0;"><b>' + esc_(FU_TYPES[i.type]) + '</b></td><td style="padding:8px 10px;border-bottom:1px solid #DDE5E0;">' + esc_(i.property) + ' <span style="color:#5F6B65">' + esc_(i.dealId) + '</span></td><td style="padding:8px 10px;border-bottom:1px solid #DDE5E0;">' + esc_(i.detail) + '</td></tr>';
  }).join('');
  var html = '<div style="font-family:Arial,sans-serif;max-width:680px"><div style="background:#0A0A0A;color:#fff;padding:16px 20px;font-family:Georgia,serif;font-size:19px">SameDay<span style="color:#7BC8A0">Investments</span> · Follow-up alerts</div>' +
    '<div style="padding:16px 20px;background:#fff"><p><b>' + items.length + ' item' + (items.length === 1 ? '' : 's') + '</b> need attention so no buyer slips through the cracks:</p><table style="width:100%;border-collapse:collapse;font-size:13px">' + rows + '</table>' +
    (url ? '<p style="margin-top:16px"><a href="' + esc_(url) + '" style="background:#0B2E21;color:#fff;padding:10px 16px;text-decoration:none;display:inline-block">Open Follow-Up Center</a></p>' : '') + '</div></div>';
  GmailApp.sendEmail(to, 'Follow-up alerts: ' + items.length + ' item' + (items.length === 1 ? '' : 's') + ' need attention', items.map(function (i) { return FU_TYPES[i.type] + ' — ' + i.property + ' — ' + i.detail; }).join('\n'),
    { htmlBody: html, name: str_(settings.SENDER_NAME) || APP_NAME });
}

/** Sends everything that's due. Caller holds the lock. */
function runFollowUps_(force) {
  var s = getSettings_();
  if (!bool_(s.FU_ON) && !force) return { sent: 0, alerts: 0, skipped: 'Follow-ups are turned off.' };
  var hour = Number(fmtDate_(new Date(), 'H'));
  if (!force && (hour < 8 || hour >= 20)) return { sent: 0, alerts: 0, skipped: 'Outside business hours.' };
  var plan = planFollowUps_();
  var test = isTestMode_(), testTo = str_(s.TEST_EMAIL) || currentUser_();
  var invById = {}, dealById = {};
  readTable_(SHEET.INVESTORS).rows.forEach(function (i) { invById[i.id] = i; });
  readTable_(SHEET.DEALS).rows.forEach(function (d) { var c = cleanDealRow_(d); dealById[c.id] = c; });
  var log = [], sentCount = 0, quota = remainingQuota_();
  if (quota < 0) quota = 1e9;
  var digests = {};
  plan.forEach(function (p) {
    if (p.kind === 'rep') { (digests[p.to] = digests[p.to] || []).push(p); return; }
    if (sentCount >= 40 || quota <= 1) return; // keep the rest for the next run
    var inv = invById[p.investorId], deal = dealById[p.dealId];
    var e = fuEmail_(p.type, deal, inv, s);
    var to = test ? testTo : p.to;
    var row = { id: shortId_('F-'), key: p.key, type: FU_TYPES[p.type], dealId: p.dealId, property: p.property, investorId: p.investorId, investorName: p.investorName, to: to, channel: 'Email to buyer', subject: e.subject, sentAt: new Date(), status: test ? 'Test' : 'Sent', mode: test ? 'TEST' : 'LIVE' };
    try {
      sendOne_(to, (test ? '[TEST] ' : '') + e.subject, personalize_(e.text, inv, test ? testBanner_(inv, false) : '', false), personalize_(e.html, inv, test ? testBanner_(inv, true) : '', true), null, s);
      sentCount++; quota--;
    } catch (err) { row.status = 'Failed: ' + String(err.message || err).slice(0, 120); }
    log.push(row);
  });
  var alerts = 0;
  Object.keys(digests).forEach(function (to) {
    var items = digests[to];
    var status = 'Sent';
    try { if (quota > 0) { sendRepDigest_(to, items, s); quota--; } else status = 'Failed: quota'; } catch (err) { status = 'Failed: ' + String(err.message || err).slice(0, 120); }
    items.forEach(function (p) {
      log.push({ id: shortId_('F-'), key: p.key, type: FU_TYPES[p.type], dealId: p.dealId, property: p.property, investorId: p.investorId, investorName: p.investorName, to: to, channel: 'Alert to rep', subject: p.detail, sentAt: new Date(), status: status, mode: test ? 'TEST' : 'LIVE' });
      alerts++;
    });
  });
  appendObjects_(SHEET.FOLLOWUPS, log);
  setSetting_('LAST_FOLLOWUP_RUN', new Date().toISOString());
  return { sent: sentCount, alerts: alerts, due: plan.length };
}

/** Trigger entry point (every 2 hours). */
function runFollowUps() {
  return withLock_(function () { return runFollowUps_(false); });
}

// ---------- client API ----------

function runFollowUpsNow() {
  var r = withLock_(function () { return runFollowUps_(true); });
  var c = getFollowUpCenter();
  c.run = r;
  return c;
}

function getFollowUpCenter() {
  var s = getSettings_();
  var plan = planFollowUps_();
  var deals = listDeals();
  return toClient_({
    due: plan.map(function (p) { p.typeLabel = FU_TYPES[p.type]; return p; }),
    history: readTable_(SHEET.FOLLOWUPS).rows.slice(-150).reverse(),
    stuck: deals.filter(function (d) { return d.stuck; }),
    on: bool_(s.FU_ON),
    scheduled: hasTrigger_('runFollowUps'),
    lastRun: s.LAST_FOLLOWUP_RUN || ''
  });
}

function enableFollowUps() {
  deleteTriggers_('runFollowUps');
  ScriptApp.newTrigger('runFollowUps').timeBased().everyHours(2).create();
  setSetting_('FU_ON', 'TRUE');
  return getFollowUpCenter();
}

function disableFollowUps() {
  deleteTriggers_('runFollowUps');
  setSetting_('FU_ON', 'FALSE');
  return getFollowUpCenter();
}
