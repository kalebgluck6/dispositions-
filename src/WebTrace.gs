/**
 * Web search for buyers still missing an email (Perplexity Search API).
 *
 * Uses Perplexity's Search API, which returns real web pages with their text (no AI-written
 * answer), so an email is only used when it is printed on a real page that also names the buyer:
 * the company's website, a business directory, an investor profile. Nothing is guessed.
 * Cost: one request per buyer (up to 3 queries in it), $5 per 1,000 requests.
 *
 * Docs: https://docs.perplexity.ai/api-reference/search-post
 */

var PX_SEARCH_URL = 'https://api.perplexity.ai/search';

function pxKey_() { return PropertiesService.getScriptProperties().getProperty('PX_API_KEY') || ''; }
function pxMonthKey_() { return 'PX_REQ_' + fmtDate_(new Date(), 'yyyyMM'); }
function pxUsed_() { return parseInt(PropertiesService.getScriptProperties().getProperty(pxMonthKey_()) || '0', 10) || 0; }
function pxAddUsed_(n) { PropertiesService.getScriptProperties().setProperty(pxMonthKey_(), String(pxUsed_() + n)); }

function pxFetch_(body, key) {
  key = key || pxKey_();
  if (!key) throw new Error('Add your Perplexity API key first (New Buyers → Skip Trace).');
  for (var attempt = 0; attempt < 2; attempt++) {
    var res = UrlFetchApp.fetch(PX_SEARCH_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }, payload: JSON.stringify(body)
    });
    var code = res.getResponseCode(), json = {};
    try { json = JSON.parse(res.getContentText() || '{}'); } catch (e) { json = {}; }
    if (code >= 200 && code < 300) return json;
    if ((code === 429 || code >= 500) && attempt === 0) { Utilities.sleep(5000); continue; }
    var msg = (json.error && (json.error.message || json.error.type)) || res.getContentText().slice(0, 200);
    throw new Error({
      401: 'Perplexity rejected the API key (' + msg + '). Create a key at console.perplexity.ai → API Keys.',
      402: 'Your Perplexity API account is out of credits. Add credits at console.perplexity.ai → Billing.',
      403: 'Perplexity refused this request (' + msg + '). Check that the key is an API key with Search access.',
      429: 'Perplexity rate limit reached — it will continue on the next run.'
    }[code] || ('Perplexity error ' + code + ': ' + msg));
  }
  throw new Error('Perplexity is busy right now — it will try again on the next run.');
}

/** Lower-case words separated by single spaces. */
function wordsOf_(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

var WEB_SKIP_DOMAINS = /(^|\.)(example\.com|sentry\.io|wixpress\.com|zillow\.com|realtor\.com|redfin\.com|trulia\.com|homes\.com|loopnet\.com|bizapedia\.com|opencorporates\.com|corporationwiki\.com|buzzfile\.com|dnb\.com|bbb\.org|yelp\.com|facebook\.com|linkedin\.com|truepeoplesearch\.com|cyberbackgroundchecks\.com|fastpeoplesearch\.com|whitepages\.com|spokeo\.com|beenverified\.com|godaddy\.com|domainsbyproxy\.com|squarespace\.com|wordpress\.com|[a-z0-9-]+\.gov|[a-z0-9-]+\.va\.us|[a-z0-9-]+\.nc\.us)$/i;
var WEB_SKIP_LOCAL = /^(no-?reply|donotreply|privacy|abuse|support|webmaster|postmaster|dmca|legal|press|media|careers|jobs|hr|billing|unsubscribe|example|email|name|user|you|your)$/i;

/** Words that identify the buyer on a page (company core words, or first + last name). */
function buyerWords_(inv) {
  var stop = /^(llc|inc|corp|co|company|the|of|and|lp|llp|ltd|trust|trustee|holdings?|properties|property|group|investments?|homes?|real|estate|realty|capital|ventures|enterprises?|solutions|services|i|ii|iii|iv|va|nc)$/;
  var isCo = str_(inv.company) && ENTITY_RE.test(inv.company);
  var src = isCo ? inv.company : (str_(inv.firstName) + ' ' + str_(inv.lastName));
  var w = wordsOf_(src).split(' ').filter(function (x) { return x.length > 1 && !stop.test(x); });
  return { words: w, all: !isCo, isCo: isCo };
}

/** Does this text name the buyer? Companies: every core word; people: first and last name. */
function namesBuyer_(text, bw) {
  if (!bw.words.length) return false;
  var t = ' ' + wordsOf_(text) + ' ';
  return bw.words.every(function (w) { return t.indexOf(' ' + w + ' ') > -1; });
}

/**
 * Picks an email printed on a page that names the buyer. The email must sit near the buyer's name
 * on that page, or use a domain built from the company name, or match the page's own website.
 */
function webPickEmail_(results, inv) {
  var bw = buyerWords_(inv);
  var cands = {};
  (results || []).forEach(function (r) {
    var text = String(r.title || '') + '\n' + String(r.snippet || '');
    if (!namesBuyer_(text, bw)) return;
    var host = String(r.url || '').replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].replace(/^www\./i, '').toLowerCase();
    var re = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi, m;
    while ((m = re.exec(text))) {
      var email = lc_(m[0]).replace(/[.\-]+$/, '');
      var parts = email.split('@'), dom = parts[1] || '';
      if (!isEmail_(email) || WEB_SKIP_LOCAL.test(parts[0]) || WEB_SKIP_DOMAINS.test(dom) || /\.(png|jpe?g|gif|webp|svg)$/.test(dom)) continue;
      var domWords = dom.split('.')[0].replace(/[^a-z0-9]/g, '');
      var domainMatch = bw.words.length && bw.words.every(function (w) { return domWords.indexOf(w) > -1; });
      var siteMatch = host && (dom === host || host.slice(-dom.length - 1) === '.' + dom);
      // within ~250 characters of the buyer's name on the page
      var at = text.toLowerCase().indexOf(email), near = false;
      if (at > -1) {
        var win = text.slice(Math.max(0, at - 250), at + email.length + 250);
        near = namesBuyer_(win, bw);
      }
      if (!(domainMatch || siteMatch || near)) continue;
      var score = (domainMatch ? 3 : 0) + (siteMatch ? 2 : 0) + (near ? 1 : 0);
      var c = cands[email] || (cands[email] = { email: email, score: 0, urls: [] });
      c.score += score;
      if (c.urls.indexOf(r.url) === -1) c.urls.push(r.url);
    }
  });
  var list = Object.keys(cands).map(function (k) { return cands[k]; }).sort(function (a, b) { return b.score - a.score || b.urls.length - a.urls.length; });
  return list;
}

function webQueries_(inv) {
  var isCo = str_(inv.company) && ENTITY_RE.test(inv.company);
  var name = isCo ? str_(inv.company) : (str_(inv.firstName) + ' ' + str_(inv.lastName)).trim();
  var mail = parseAddress_(inv.mailingAddress) || {};
  var place = [mail.city || str_(inv.markets).split(',')[0], mail.state || (/elizabeth city|camden|currituck|perquimans|chowan/i.test(str_(inv.markets)) ? 'NC' : 'VA')].filter(String).join(' ');
  var q = ['"' + name + '" ' + place + ' email', '"' + name + '" contact'];
  if (isCo && (str_(inv.firstName) || str_(inv.lastName))) q.push('"' + (str_(inv.firstName) + ' ' + str_(inv.lastName)).trim() + '" "' + name + '"');
  else if (!isCo) q.push('"' + name + '" real estate investor ' + place);
  return q.slice(0, 3);
}

/** Web-searches buyers still missing an email. Caller holds the lock. ids limits it to specific buyers. */
function webTraceRun_(ids) {
  var s = getSettings_();
  var out = { status: 'ok', searched: 0, emails: 0, note: '' };
  if (!pxKey_()) { out.status = 'off'; return out; }
  if (!ids && !bool_(s.SKIPTRACE_WEB_ON)) { out.status = 'off'; return out; }
  var cap = parseInt(s.SKIPTRACE_WEB_MONTHLY_CAP, 10) || 0;
  var room = cap ? cap - pxUsed_() : Infinity;
  if (room <= 0) { out.status = 'capped'; out.note = 'Monthly web-search limit reached (' + cap + ').'; return out; }
  var max = Math.max(1, parseInt(s.SKIPTRACE_MAX_PER_RUN, 10) || 100);
  var activeToo = bool_(s.SKIPTRACE_ACTIVE_TOO);
  var want = ids ? ids.reduce(function (m, id) { m[id] = true; return m; }, {}) : null;
  var t = readTable_(SHEET.INVESTORS);
  var cands = t.rows.filter(function (r) {
    if (str_(r.email) || bool_(r.optOut)) return false;
    if (want) return !!want[r.id];
    if (str_(r.webSearched)) return false;
    var st = str_(r.status);
    return st === PENDING_REVIEW || (activeToo && st === 'Active');
  }).slice(0, Math.min(max, room));
  var today = fmtDate_(new Date(), 'MMM d, yyyy');
  var started = Date.now();
  for (var i = 0; i < cands.length; i++) {
    if (Date.now() - started > 240000) { out.note = 'Time limit — the rest continue on the next run. '; break; }
    var inv = cands[i];
    var json = pxFetch_({ query: webQueries_(inv), max_results: 10, country: 'US' });
    pxAddUsed_(1);
    out.searched++;
    var found = webPickEmail_(json.results, inv);
    var f = { webSearched: new Date(), updated: new Date() };
    if (found.length) {
      var dup = t.rows.filter(function (r) { return r.id !== inv.id && lc_(r.email) === found[0].email; })[0];
      if (!dup) {
        f.email = found[0].email;
        out.emails++;
        f.skipTraceResult = 'Email found on the web';
        var notes = str_(inv.notes).replace(/\s*Needs an email address before approval \(skip trace this owner\)\.?/, '');
        f.notes = (notes + ' Web search ' + today + ': ' + found[0].email + ' listed on ' + found[0].urls.slice(0, 2).join(', ') +
          (found.length > 1 ? '; other emails seen: ' + found.slice(1, 3).map(function (x) { return x.email; }).join(', ') : '') + '. Check the page before approving.').trim().slice(0, 1500);
      }
    } else if (!str_(inv.skipTraceResult) || /^No /.test(str_(inv.skipTraceResult))) {
      f.skipTraceResult = (str_(inv.skipTraceResult) ? str_(inv.skipTraceResult) + '; ' : '') + 'no email on the web';
    }
    updateObject_(SHEET.INVESTORS, inv._row, f);
  }
  out.note += out.searched + ' searched on the web: ' + out.emails + ' emails found';
  return out;
}

// ---------- client API ----------

/** Saves and tests the Perplexity API key (stored privately, never in the sheet). */
function savePerplexityKey(key) {
  requireRole_('Owner');
  key = str_(key).replace(/^Bearer\s+/i, '');
  var props = PropertiesService.getScriptProperties();
  if (!key) { props.deleteProperty('PX_API_KEY'); return getIntakeStatus(); }
  if (!/^[A-Za-z0-9_\-]{20,}$/.test(key)) throw new Error('That doesn\'t look like a Perplexity API key (it starts with pplx-).');
  // An empty query list is rejected as invalid (400, not billed) when the key is good, 401 when it isn't.
  try { pxFetch_({ query: [] }, key); } catch (e) {
    if (/rejected the API key|refused this request|out of credits/.test(e.message)) throw e;
  }
  props.setProperty('PX_API_KEY', key);
  return getIntakeStatus();
}
