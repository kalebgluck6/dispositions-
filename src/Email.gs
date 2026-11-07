/**
 * Email.gs — builds the branded investment-opportunity email.
 * Table-based, inline-styled HTML for compatibility with Gmail, Outlook and Apple Mail.
 * Photos are embedded inline (cid:) so they display without any public hosting.
 */

var BRAND = {
  black: '#0A0A0A',
  ink: '#111412',
  green: '#0B2E21',
  greenMid: '#14472F',
  accent: '#2E9A63',
  accentSoft: '#7BC8A0',
  paper: '#F4F6F4',
  line: '#DDE5E0',
  text: '#1B1F1D',
  muted: '#5F6B65',
  serif: "Georgia,'Times New Roman',serif",
  sans: "'Helvetica Neue',Helvetica,Arial,sans-serif"
};

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money_(n) {
  if (n === '' || n === null || n === undefined || isNaN(Number(n))) return '';
  var v = Math.round(Number(n));
  var s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-$' : '$') + s;
}

function numFmt_(n) {
  if (n === '' || n === null || n === undefined || isNaN(Number(n))) return '';
  return String(Number(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function paragraphs_(text) {
  return esc_(text).split(/\n{2,}/).map(function (p) {
    return '<p style="margin:0 0 14px 0;">' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

function fillTokens_(template, deal) {
  var map = {
    ADDRESS: str_(deal.address), CITY: str_(deal.city), STATE: str_(deal.state), ZIP: str_(deal.zip),
    PRICE: money_(deal.askingPrice), ARV: money_(deal.arv), PROPERTY_TYPE: str_(deal.propertyType),
    DEAL_ID: str_(deal.id), MARKET: str_(deal.market)
  };
  return String(template).replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, function (m, k) {
    return map[k] !== undefined ? map[k] : m;
  }).replace(/\s+\|\s+\|/g, ' |').replace(/\s{2,}/g, ' ').trim();
}

function dealSubject_(deal, settings) {
  var subj = fillTokens_(settings.SUBJECT_TEMPLATE || 'New Deal: {{ADDRESS}} [{{DEAL_ID}}]', deal);
  if (subj.indexOf(deal.id) === -1) subj += ' [' + deal.id + ']'; // always keep the ID so replies can be tracked
  return subj;
}

function videoLink_(deal) {
  return str_(deal.videoUrl);
}

function mailto_(to, subject, body) {
  return 'mailto:' + encodeURIComponent(to).replace(/%40/g, '@') +
    '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

/**
 * Builds the email. Placeholders replaced per recipient by personalize_():
 *   {{FIRST_NAME}}  {{INVESTOR_REF}}  {{TEST_BANNER}}
 * opts.imageSrc(i) returns the src for photo i (cid:photoN for sending, data: URLs for preview).
 * opts.photoCount = number of photos available.
 */
function buildDealEmail_(deal, settings, opts) {
  opts = opts || {};
  var B = BRAND;
  var m = dealMetrics_(deal);
  var company = str_(settings.COMPANY_NAME) || APP_NAME;
  var reply = replyTo_();
  var contactEmail = contactEmail_();
  var subject = dealSubject_(deal, settings);
  var title = dealTitle_(deal);
  var cityLine = [str_(deal.city), [str_(deal.state), str_(deal.zip)].filter(String).join(' ')].filter(String).join(', ');
  var photoCount = opts.photoCount || 0;
  var src = opts.imageSrc || function (i) { return 'cid:photo' + i; };
  var ref = 'Deal: ' + deal.id + ' | Investor ref: {{INVESTOR_REF}}';

  var interestedLink = mailto_(reply, 'INTERESTED - ' + deal.id + ' - ' + str_(deal.address),
    "Hi, I'm interested in " + title + '. Please send me next steps.\n\nBest number to reach me: \n\n' + ref);
  var offerLink = mailto_(reply, 'OFFER - ' + deal.id + ' - ' + str_(deal.address),
    'My offer for ' + title + ' is: $\n\nProof of funds attached: Yes / No\nClosing timeline: \n\n' + ref);
  var passLink = mailto_(reply, 'PASS - ' + deal.id + ' - ' + str_(deal.address),
    'Not for me this time.\n\n' + ref);
  var unsubLink = mailto_(reply, 'UNSUBSCRIBE', 'Please remove me from the ' + company + ' investor list.\n\nInvestor ref: {{INVESTOR_REF}}');

  var galleryUrl = '';
  if (deal.folderId && bool_(settings.SHARE_MEDIA_LINKS)) galleryUrl = 'https://drive.google.com/drive/folders/' + deal.folderId;
  var video = videoLink_(deal);

  var h = [];
  h.push('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light only"><title>', esc_(subject), '</title></head>',
    '<body style="margin:0;padding:0;background:#E9EDEA;">',
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">',
    esc_(str_(deal.propertyType) + ' · ' + money_(deal.askingPrice) + (deal.arv ? ' · ARV ' + money_(deal.arv) : '') + ' · ' + cityLine),
    '</div>',
    '{{TEST_BANNER}}',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#E9EDEA;"><tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#FFFFFF;border-collapse:collapse;">');

  // Header
  h.push('<tr><td style="background:', B.black, ';padding:26px 32px 22px 32px;border-bottom:3px solid ', B.accent, ';">');
  if (str_(settings.LOGO_URL)) {
    h.push('<img src="', esc_(settings.LOGO_URL), '" alt="', esc_(company), '" height="44" style="display:block;height:44px;border:0;">');
  } else {
    h.push('<div style="font-family:', B.serif, ';font-size:26px;letter-spacing:1px;color:#FFFFFF;line-height:1;">SameDay<span style="color:', B.accentSoft, ';">Investments</span></div>');
  }
  h.push('<div style="font-family:', B.sans, ';font-size:11px;letter-spacing:3px;text-transform:uppercase;color:', B.accentSoft, ';padding-top:10px;">Exclusive Off-Market Opportunity</div>',
    '</td></tr>');

  // Hero image
  if (photoCount > 0) {
    h.push('<tr><td style="padding:0;background:', B.black, ';"><img src="', src(0), '" width="640" alt="', esc_(title),
      '" style="display:block;width:100%;max-width:640px;height:auto;border:0;"></td></tr>');
  }

  // Title block
  h.push('<tr><td style="background:', B.green, ';padding:26px 32px;">',
    '<div style="font-family:', B.sans, ';font-size:11px;letter-spacing:2px;text-transform:uppercase;color:', B.accentSoft, ';">',
    esc_(deal.id), (deal.propertyType ? ' &nbsp;·&nbsp; ' + esc_(deal.propertyType) : ''), (deal.market ? ' &nbsp;·&nbsp; ' + esc_(deal.market) : ''), '</div>',
    '<div style="font-family:', B.serif, ';font-size:28px;line-height:1.25;color:#FFFFFF;padding-top:8px;">', esc_(deal.address), '</div>',
    '<div style="font-family:', B.sans, ';font-size:15px;color:#CFE3D7;padding-top:4px;">', esc_(cityLine), '</div>',
    '</td></tr>');

  // Key numbers
  var keyNums = [['Price', money_(deal.askingPrice)], ['ARV', money_(deal.arv)], ['Est. Repairs', money_(deal.repairs)], ['Potential Spread', money_(m.spread)]]
    .filter(function (k) { return k[1]; });
  if (keyNums.length) {
    var w = Math.floor(100 / keyNums.length);
    h.push('<tr><td style="padding:0;background:', B.ink, ';"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>');
    keyNums.forEach(function (k, i) {
      h.push('<td width="', w, '%" align="center" style="padding:20px 6px;', i ? 'border-left:1px solid #26302B;' : '', '">',
        '<div style="font-family:', B.sans, ';font-size:10px;letter-spacing:2px;text-transform:uppercase;color:', B.accentSoft, ';">', esc_(k[0]), '</div>',
        '<div style="font-family:', B.serif, ';font-size:22px;color:#FFFFFF;padding-top:6px;">', esc_(k[1]), '</div></td>');
    });
    h.push('</tr></table></td></tr>');
  }

  // Greeting + description
  h.push('<tr><td style="padding:28px 32px 6px 32px;font-family:', B.sans, ';font-size:15px;line-height:1.65;color:', B.text, ';">',
    '<p style="margin:0 0 14px 0;">Hi {{FIRST_NAME}},</p>',
    '<p style="margin:0 0 14px 0;">We just locked up a new property and you are among the first in our investor network to see it. Details are below — these move quickly.</p>');
  if (str_(deal.description)) h.push(paragraphs_(deal.description));
  h.push('</td></tr>');

  // Property details
  var details = [];
  if (deal.beds !== '' || deal.baths !== '') details.push(['Bedrooms / Baths', (deal.beds !== '' ? deal.beds : '–') + ' bd / ' + (deal.baths !== '' ? deal.baths : '–') + ' ba']);
  if (deal.sqft) details.push(['Living Area', numFmt_(deal.sqft) + ' sq ft']);
  if (str_(deal.lotSize)) details.push(['Lot Size', str_(deal.lotSize)]);
  if (deal.yearBuilt) details.push(['Year Built', String(deal.yearBuilt)]);
  if (deal.propertyType) details.push(['Property Type', str_(deal.propertyType)]);
  details.push(['Asking Price', money_(deal.askingPrice)]);
  if (bool_(deal.showAssignment) && deal.assignmentPrice !== '') details.push(['Assignment Price', money_(deal.assignmentPrice)]);
  if (deal.arv) details.push(['After Repair Value', money_(deal.arv)]);
  if (deal.repairs !== '') details.push(['Estimated Repairs', money_(deal.repairs)]);
  if (m.allIn) details.push(['All-In (Price + Repairs)', money_(m.allIn) + (m.allInPctArv ? ' &nbsp;(' + m.allInPctArv + '% of ARV)' : '')]);
  if (m.pricePerSqft) details.push(['Price / Sq Ft', '$' + m.pricePerSqft]);
  var closing = deal.closingDate instanceof Date ? fmtDate_(deal.closingDate, 'MMMM d, yyyy') : prettyDate_(deal.closingDate);
  if (closing) details.push(['Closing Date', closing]);

  h.push('<tr><td style="padding:10px 32px 8px 32px;">',
    '<div style="font-family:', B.sans, ';font-size:11px;letter-spacing:2px;text-transform:uppercase;color:', B.accent, ';padding-bottom:10px;border-bottom:1px solid ', B.line, ';">Property &amp; Deal Numbers</div>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:', B.sans, ';font-size:14px;color:', B.text, ';">');
  details.forEach(function (d, i) {
    // values that contain our own &nbsp; markup are pre-escaped
    var val = d[1].indexOf('&nbsp;') > -1 ? d[1].replace(/[<>"]/g, '') : esc_(d[1]);
    h.push('<tr style="background:', i % 2 ? '#FFFFFF' : B.paper, ';"><td style="padding:10px 12px;color:', B.muted, ';width:48%;">', esc_(d[0]),
      '</td><td style="padding:10px 12px;font-weight:bold;text-align:right;">', val, '</td></tr>');
  });
  h.push('</table></td></tr>');

  // Gallery
  if (photoCount > 1) {
    h.push('<tr><td style="padding:22px 32px 4px 32px;"><div style="font-family:', B.sans, ';font-size:11px;letter-spacing:2px;text-transform:uppercase;color:', B.accent, ';padding-bottom:10px;border-bottom:1px solid ', B.line, ';">Photos</div></td></tr>',
      '<tr><td style="padding:10px 26px 0 26px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">');
    for (var i = 1; i < photoCount; i += 2) {
      h.push('<tr>');
      for (var j = i; j < i + 2; j++) {
        h.push('<td width="50%" style="padding:6px;" valign="top">');
        if (j < photoCount) h.push('<img src="', src(j), '" width="282" alt="Photo ', j + 1, '" style="display:block;width:100%;height:auto;border:0;">');
        h.push('</td>');
      }
      h.push('</tr>');
    }
    h.push('</table></td></tr>');
  }

  // Media links
  if (video || galleryUrl) {
    h.push('<tr><td style="padding:16px 32px 0 32px;font-family:', B.sans, ';font-size:14px;">');
    if (video) h.push(button_(video, '▶&nbsp; Watch Video Walkthrough', B.black, '#FFFFFF', B.black), '&nbsp; ');
    if (galleryUrl) h.push(button_(galleryUrl, 'View Full Photo Gallery', '#FFFFFF', B.green, B.green));
    h.push('</td></tr>');
  }

  // Access instructions
  var showAccess = deal.showAccess === '' || deal.showAccess === undefined ? true : bool_(deal.showAccess);
  if (str_(deal.access) && showAccess) {
    h.push('<tr><td style="padding:24px 32px 0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
      '<td style="border-left:3px solid ', B.accent, ';background:', B.paper, ';padding:14px 16px;font-family:', B.sans, ';font-size:14px;line-height:1.6;color:', B.text, ';">',
      '<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:', B.accent, ';padding-bottom:6px;">Access &amp; Showings</div>',
      esc_(deal.access).replace(/\n/g, '<br>'), '</td></tr></table></td></tr>');
  }

  // CTA
  h.push('<tr><td align="center" style="padding:30px 32px 10px 32px;">',
    '<div style="font-family:', B.serif, ';font-size:20px;color:', B.text, ';padding-bottom:14px;">Want this one?</div>',
    button_(interestedLink, "I'M INTERESTED", B.accent, '#FFFFFF', B.accent, true), '&nbsp; ',
    button_(offerLink, 'MAKE AN OFFER', '#FFFFFF', B.green, B.green, true),
    '<div style="font-family:', B.sans, ';font-size:12px;color:', B.muted, ';padding-top:12px;">Or simply reply to this email. First come, first served — proof of funds required. ',
    '<a href="', passLink, '" style="color:', B.muted, ';">Not for me</a></div>',
    '</td></tr>');

  // Contact card
  var contactBits = [];
  if (str_(settings.CONTACT_NAME)) contactBits.push('<div style="font-family:' + B.serif + ';font-size:18px;color:#FFFFFF;">' + esc_(settings.CONTACT_NAME) + '</div>');
  contactBits.push('<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:' + B.accentSoft + ';padding:4px 0 10px 0;">' + esc_(company) + ' · Dispositions</div>');
  if (str_(settings.CONTACT_PHONE)) contactBits.push('<div style="padding:2px 0;"><a href="tel:' + esc_(String(settings.CONTACT_PHONE).replace(/[^\d+]/g, '')) + '" style="color:#FFFFFF;text-decoration:none;">' + esc_(settings.CONTACT_PHONE) + '</a></div>');
  if (contactEmail) contactBits.push('<div style="padding:2px 0;"><a href="mailto:' + esc_(contactEmail) + '" style="color:#FFFFFF;text-decoration:none;">' + esc_(contactEmail) + '</a></div>');
  if (str_(settings.WEBSITE)) contactBits.push('<div style="padding:2px 0;"><a href="' + esc_(websiteUrl_(settings.WEBSITE)) + '" style="color:' + B.accentSoft + ';text-decoration:none;">' + esc_(String(settings.WEBSITE).replace(/^https?:\/\//, '')) + '</a></div>');
  h.push('<tr><td style="padding:26px 32px 32px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    '<td style="background:', B.green, ';padding:20px 22px;font-family:', B.sans, ';font-size:14px;line-height:1.5;color:#FFFFFF;">',
    contactBits.join(''), '</td></tr></table></td></tr>');

  // Footer
  h.push('<tr><td style="background:', B.black, ';padding:22px 32px;font-family:', B.sans, ';font-size:11px;line-height:1.6;color:#8E9A94;">');
  if (str_(settings.DISCLAIMER)) h.push('<p style="margin:0 0 10px 0;">', esc_(settings.DISCLAIMER), '</p>');
  h.push('<p style="margin:0 0 10px 0;">You are receiving this because you are a member of the ', esc_(company),
    ' investor network. Each email is sent individually — your address is never shared with other investors.</p>');
  if (str_(settings.COMPANY_ADDRESS)) h.push('<p style="margin:0 0 10px 0;">', esc_(company), ' · ', esc_(settings.COMPANY_ADDRESS), '</p>');
  h.push('<p style="margin:0;"><a href="', unsubLink, '" style="color:', B.accentSoft, ';">Unsubscribe</a> &nbsp;·&nbsp; Ref ', esc_(deal.id), '</p>',
    '</td></tr>');

  h.push('</table></td></tr></table></body></html>');

  // Plain-text alternative
  var t = [];
  t.push(company.toUpperCase() + ' — EXCLUSIVE OFF-MARKET OPPORTUNITY', '', 'Hi {{FIRST_NAME}},', '',
    title + (deal.zip ? ' ' + deal.zip : ''), deal.id + (deal.propertyType ? ' · ' + deal.propertyType : ''), '');
  details.forEach(function (d) { t.push(d[0] + ': ' + String(d[1]).replace(/&nbsp;/g, ' ')); });
  if (m.spread) t.push('Potential Spread: ' + money_(m.spread));
  if (str_(deal.description)) t.push('', deal.description);
  if (str_(deal.access) && showAccess) t.push('', 'ACCESS & SHOWINGS', deal.access);
  if (video) t.push('', 'Video walkthrough: ' + video);
  if (galleryUrl) t.push('Photo gallery: ' + galleryUrl);
  t.push('', 'Interested? Reply to this email with "INTERESTED" or your offer. Reference ' + deal.id + '.', '');
  if (str_(settings.CONTACT_NAME)) t.push(settings.CONTACT_NAME);
  if (str_(settings.CONTACT_PHONE)) t.push(settings.CONTACT_PHONE);
  if (contactEmail) t.push(contactEmail);
  t.push('', str_(settings.DISCLAIMER), str_(settings.COMPANY_ADDRESS), 'To unsubscribe, reply with UNSUBSCRIBE.');

  return { subject: subject, html: h.join(''), text: t.join('\n') };
}

function websiteUrl_(w) {
  w = str_(w);
  return /^https?:\/\//i.test(w) ? w : 'https://' + w;
}

function prettyDate_(ymd) {
  var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return str_(ymd);
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}

function button_(href, label, bg, color, border, bold) {
  return '<a href="' + esc_(href) + '" style="display:inline-block;margin:4px 0;padding:13px 22px;background:' + bg +
    ';color:' + color + ';border:2px solid ' + border + ';font-family:' + BRAND.sans + ';font-size:13px;letter-spacing:1.5px;' +
    (bold ? 'font-weight:bold;' : '') + 'text-decoration:none;">' + label + '</a>';
}

/** Fills per-recipient placeholders. */
function personalize_(content, investor, testBannerHtml, isHtml) {
  var first = str_(investor && investor.firstName) || 'there';
  return content
    .replace(/\{\{FIRST_NAME\}\}/g, isHtml ? esc_(first) : first)
    .replace(/\{\{INVESTOR_REF\}\}/g, encodeURIComponent(str_(investor && investor.id) || 'N/A'))
    .replace(/\{\{TEST_BANNER\}\}/g, testBannerHtml || '');
}

function testBanner_(investor, isHtml) {
  var who = investor ? investorName_(investor) + ' <' + str_(investor.email) + '>' : 'a sample investor';
  if (!isHtml) return '*** TEST MODE — in live mode this email would go to: ' + who + ' ***\n\n';
  return '<div style="background:#F6C343;color:#1B1F1D;font-family:Arial,sans-serif;font-size:13px;padding:12px;text-align:center;">' +
    '<b>TEST MODE</b> — in live mode this email would be delivered to: ' + esc_(who) + '</div>';
}

/** Loads up to n photo blobs for inline embedding. */
function loadInlineImages_(deal, n) {
  var blobs = {};
  var count = 0;
  photoIds_(deal).slice(0, n).forEach(function (id) {
    try {
      var f = DriveApp.getFileById(id);
      var blob = f.getBlob();
      if (f.getSize() > 3 * 1024 * 1024) {
        var thumb = f.getThumbnail();
        if (thumb) blob = thumb;
      }
      blob.setName('photo' + count + '.' + (/png/.test(blob.getContentType()) ? 'png' : 'jpg'));
      blobs['photo' + count] = blob;
      count++;
    } catch (e) {
      // missing/unreadable file — skip it
    }
  });
  return { count: count, blobs: blobs };
}

// ---------- client API ----------

/** HTML preview of the email exactly as an investor will see it. */
function getEmailPreview(dealId) {
  var deal = getDealRow_(dealId);
  var settings = getSettings_();
  var imgs = loadInlineImages_(deal, Number(settings.EMAIL_PHOTO_COUNT) || 4);
  var dataUrls = [];
  for (var i = 0; i < imgs.count; i++) {
    var b = imgs.blobs['photo' + i];
    dataUrls.push('data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()));
  }
  var email = buildDealEmail_(deal, settings, { photoCount: imgs.count, imageSrc: function (k) { return dataUrls[k]; } });
  var sample = { firstName: 'Alex', id: 'INV-PREVIEW' };
  return { subject: email.subject, html: personalize_(email.html, sample, '', true) };
}
