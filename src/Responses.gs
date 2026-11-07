/**
 * Responses.gs — tracks interested buyers and replies.
 *
 * Responses are captured two ways:
 *   1. Automatically: scanInboxForResponses() reads replies in this Gmail inbox whose
 *      subject/body contains a deal ID (e.g. SDI-2026-0001). The email buttons
 *      (I'M INTERESTED / MAKE AN OFFER / Not for me / Unsubscribe) pre-fill subjects
 *      so replies are classified automatically. Runs every 15 min once enabled.
 *   2. Manually: logResponse() from the app (phone calls, texts, etc.).
 */

var DEAL_ID_RE = /SDI-\d{4}-\d{4}/i;
var INVESTOR_REF_RE = /INV-\d{5}/i;

function parseFrom_(from) {
  var s = String(from || '');
  var m = s.match(/<([^>]+)>/);
  var email = (m ? m[1] : s).trim().toLowerCase();
  var name = m ? s.slice(0, s.indexOf('<')).replace(/"/g, '').trim() : '';
  return { email: email, name: name };
}

function stripQuoted_(body) {
  var lines = String(body || '').split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (/^\s*>/.test(l)) break;
    if (/^On .+wrote:\s*$/i.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^From: /i.test(l)) break;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
}

function parseOffer_(text) {
  var m = String(text || '').match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\b/i);
  if (!m) return '';
  var n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2] && /k/i.test(m[2])) n *= 1000;
  if (m[2] && /m/i.test(m[2])) n *= 1000000;
  return n > 0 ? n : '';
}

function classifyReply_(subject, body) {
  var s = String(subject || '').replace(/^(re|fw|fwd)\s*:\s*/ig, '').trim();
  var b = String(body || '').toLowerCase();
  if (/^unsubscribe\b/i.test(s) || /^\s*(unsubscribe|remove me|stop)\b/.test(b)) return 'Unsubscribe';
  if (/^offer\b/i.test(s)) return 'Offer';
  if (/^pass\b/i.test(s)) return 'Not Interested';
  if (/^interested\b/i.test(s)) return 'Interested';
  if (/not interested|pass on (this|it)|no thanks|not for me|i'?ll pass/.test(b)) return 'Not Interested';
  if (/\boffer\b/.test(b) && parseOffer_(body)) return 'Offer';
  if (/interested|i'?ll take it|i want it|send (me )?(the )?(contract|address|info|details)|lock it up|still available|can i see it|schedule a (showing|walk)/.test(b)) return 'Interested';
  if (/\?/.test(b)) return 'Question';
  return 'Reply';
}

/** Recounts the deal's Responses / Interested columns. */
function recountDeal_(dealId) {
  if (!dealId) return;
  var deal = findBy_(SHEET.DEALS, 'id', dealId);
  if (!deal) return;
  var rs = readTable_(SHEET.RESPONSES).rows.filter(function (r) { return r.dealId === dealId; });
  var interested = {};
  rs.forEach(function (r) {
    if (r.type === 'Interested' || r.type === 'Offer') interested[lc_(r.investorEmail) || r.id] = true;
  });
  updateObject_(SHEET.DEALS, deal._row, { responses: rs.length, interested: Object.keys(interested).length });
}

function myAddresses_() {
  var s = getSettings_();
  var mine = [currentUser_(), s.REPLY_TO, s.FROM_ALIAS, s.CONTACT_EMAIL].map(lc_).filter(String);
  try { GmailApp.getAliases().forEach(function (a) { mine.push(lc_(a)); }); } catch (e) { /* ignore */ }
  return mine;
}

// ---------- client API ----------

/** Scans Gmail for investor replies and logs them. Safe to run repeatedly (dedupes by message ID). */
function scanInboxForResponses() {
  return withLock_(function () {
    var settings = getSettings_();
    var days = Math.max(1, parseInt(settings.RESPONSE_LOOKBACK_DAYS, 10) || 14);
    var dealIds = readTable_(SHEET.JOBS).rows.map(function (j) { return j.dealId; })
      .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var deals = {};
    readTable_(SHEET.DEALS).rows.forEach(function (d) { deals[String(d.id).toUpperCase()] = d; });
    var investorsTable = readTable_(SHEET.INVESTORS);
    var byEmail = {}, byId = {};
    investorsTable.rows.forEach(function (i) { byEmail[lc_(i.email)] = i; byId[String(i.id).toUpperCase()] = i; });
    var seen = {};
    readTable_(SHEET.RESPONSES).rows.forEach(function (r) { if (r.messageId) seen[r.messageId] = true; });
    var mine = myAddresses_();

    var queries = [];
    for (var i = 0; i < dealIds.length; i += 15) {
      var chunk = dealIds.slice(i, i + 15).map(function (d) { return 'subject:"' + d + '"'; });
      queries.push('newer_than:' + days + 'd -from:me (' + chunk.join(' OR ') + ')');
    }
    queries.push('newer_than:' + days + 'd -from:me subject:unsubscribe');

    var newRows = [], touchedDeals = {}, optOuts = [];
    queries.forEach(function (q) {
      GmailApp.search(q, 0, 100).forEach(function (thread) {
        thread.getMessages().forEach(function (msg) {
          var mid = msg.getId();
          if (seen[mid]) return;
          var from = parseFrom_(msg.getFrom());
          if (!from.email || mine.indexOf(from.email) > -1) return;
          var subject = msg.getSubject();
          var body = stripQuoted_(msg.getPlainBody());
          var full = subject + '\n' + msg.getPlainBody();
          var dm = full.match(DEAL_ID_RE);
          var dealId = dm ? dm[0].toUpperCase() : '';
          var type = classifyReply_(subject, body);
          if (!dealId && type !== 'Unsubscribe') return;
          var inv = byEmail[from.email];
          if (!inv) {
            var rm = full.match(INVESTOR_REF_RE);
            if (rm) inv = byId[rm[0].toUpperCase()];
          }
          seen[mid] = true;
          var deal = deals[dealId] || null;
          newRows.push({
            id: shortId_('R-'), dealId: dealId, property: deal ? dealTitle_(deal) : '',
            investorId: inv ? inv.id : '', investorName: inv ? investorName_(inv) : (from.name || from.email),
            investorEmail: from.email, received: msg.getDate(), type: type,
            offerAmount: type === 'Offer' ? parseOffer_(body) : '', message: body,
            source: 'Email (auto)', followUp: type === 'Unsubscribe' || type === 'Not Interested' ? 'Closed' : 'New',
            notes: inv ? '' : 'Sender not in investor database', messageId: mid
          });
          if (dealId) touchedDeals[dealId] = true;
          if (type === 'Unsubscribe' && inv) optOuts.push(inv);
        });
      });
    });

    appendObjects_(SHEET.RESPONSES, newRows);
    optOuts.forEach(function (inv) {
      updateObject_(SHEET.INVESTORS, inv._row, { optOut: true, updated: new Date(), notes: (str_(inv.notes) + ' [Unsubscribed by email ' + fmtDate_(new Date()) + ']').trim() });
    });
    Object.keys(touchedDeals).forEach(recountDeal_);
    setSetting_('LAST_INBOX_SCAN', new Date().toISOString());
    return { found: newRows.length, unsubscribed: optOuts.length, scannedAt: new Date().toISOString() };
  });
}

function listResponses() {
  return toClient_(readTable_(SHEET.RESPONSES).rows.reverse());
}

/** Manually log a response (phone call, text, in-person). */
function logResponse(r) {
  return withLock_(function () {
    r = r || {};
    if (!r.dealId) throw new Error('Choose a deal.');
    var deal = getDealRow_(r.dealId);
    var inv = r.investorId ? findBy_(SHEET.INVESTORS, 'id', r.investorId) : null;
    if (!inv && !str_(r.investorName) && !str_(r.investorEmail)) throw new Error('Choose an investor or enter a name.');
    var type = RESPONSE_TYPES.indexOf(r.type) > -1 ? r.type : 'Interested';
    var row = {
      id: shortId_('R-'), dealId: deal.id, property: dealTitle_(deal),
      investorId: inv ? inv.id : '', investorName: inv ? investorName_(inv) : str_(r.investorName),
      investorEmail: inv ? lc_(inv.email) : lc_(r.investorEmail), received: new Date(), type: type,
      offerAmount: num_(r.offerAmount), message: str_(r.message), source: 'Manual',
      followUp: FOLLOW_UP_STATUSES.indexOf(r.followUp) > -1 ? r.followUp : 'New', notes: str_(r.notes), messageId: ''
    };
    appendObjects_(SHEET.RESPONSES, [row]);
    if (type === 'Unsubscribe' && inv) updateObject_(SHEET.INVESTORS, inv._row, { optOut: true, updated: new Date() });
    recountDeal_(deal.id);
    return toClient_(row);
  });
}

function updateResponse(id, fields) {
  return withLock_(function () {
    var r = findBy_(SHEET.RESPONSES, 'id', id);
    if (!r) throw new Error('Response not found.');
    var f = {};
    if (fields.followUp !== undefined) f.followUp = str_(fields.followUp);
    if (fields.notes !== undefined) f.notes = str_(fields.notes);
    if (fields.type !== undefined && RESPONSE_TYPES.indexOf(fields.type) > -1) f.type = fields.type;
    if (fields.offerAmount !== undefined) f.offerAmount = num_(fields.offerAmount);
    updateObject_(SHEET.RESPONSES, r._row, f);
    recountDeal_(r.dealId);
    return toClient_(findBy_(SHEET.RESPONSES, 'id', id));
  });
}

function enableAutoTracking() {
  if (!hasTrigger_('scanInboxForResponses')) {
    ScriptApp.newTrigger('scanInboxForResponses').timeBased().everyMinutes(15).create();
  }
  return getSettings();
}

function disableAutoTracking() {
  deleteTriggers_('scanInboxForResponses');
  return getSettings();
}
