/**
 * Deals.gs — deal submission, media (photos / video) and status management.
 */

var MAX_PHOTOS = 30;

function dealTitle_(d) {
  var parts = [str_(d.address), str_(d.city)].filter(String);
  var s = parts.join(', ');
  if (str_(d.state)) s += (s ? ', ' : '') + str_(d.state);
  return s || str_(d.id);
}

function photoIds_(d) {
  return list_(d.photoIds);
}

function dealMetrics_(d) {
  var price = Number(d.askingPrice) || 0;
  var arv = Number(d.arv) || 0;
  var repairs = Number(d.repairs) || 0;
  var sqft = Number(d.sqft) || 0;
  var allIn = price + repairs;
  return {
    allIn: price ? allIn : '',
    spread: arv && price ? arv - allIn : '',
    allInPctArv: arv && price ? Math.round((allIn / arv) * 1000) / 10 : '',
    pricePerSqft: price && sqft ? Math.round(price / sqft) : '',
    arvPerSqft: arv && sqft ? Math.round(arv / sqft) : ''
  };
}

function cleanDealRow_(r) {
  var o = toClient_(r);
  o.photoIds = photoIds_(r);
  o.showAssignment = bool_(r.showAssignment);
  o.showAccess = r.showAccess === '' ? true : bool_(r.showAccess);
  o.status = str_(r.status) || 'Available';
  o.timesDistributed = Number(r.timesDistributed) || 0;
  o.totalRecipients = Number(r.totalRecipients) || 0;
  o.responses = Number(r.responses) || 0;
  o.interested = Number(r.interested) || 0;
  o.title = dealTitle_(r);
  o.metrics = dealMetrics_(r);
  o.closingDate = r.closingDate instanceof Date ? fmtDate_(r.closingDate) : str_(r.closingDate);
  o.offerDeadline = r.offerDeadline instanceof Date ? fmtDate_(r.offerDeadline, "yyyy-MM-dd'T'HH:mm") : str_(r.offerDeadline);
  o.stage = stageOf_(r);
  o.stageIndex = PIPELINE_STAGES.indexOf(o.stage);
  var since = parseDateLoose_(r.stageUpdated) || parseDateLoose_(r.updated) || parseDateLoose_(r.created);
  o.daysInStage = since ? Math.floor((Date.now() - since.getTime()) / 86400000) : 0;
  o.stuck = ['Closed', 'Dead Deal'].indexOf(o.stage) === -1 && o.daysInStage >= (parseInt(getSettings_().FU_STUCK_DAYS, 10) || 7);
  o.acresNum = dealAcres_(r);
  o.isLand = isLandDeal_(r);
  return o;
}

/** The deal's pipeline stage (derived for deals created before the pipeline existed). */
function stageOf_(d) {
  var st = str_(d.stage);
  if (PIPELINE_STAGES.indexOf(st) > -1) return st;
  var status = str_(d.status);
  if (status === 'Sold') return 'Closed';
  if (status === 'Dead') return 'Dead Deal';
  if (status === 'Pending') return 'Buyer Selected';
  return Number(d.timesDistributed) > 0 ? 'Distributed' : 'Ready for Disposition';
}

function statusForStage_(stage) {
  var p = PIPELINE.filter(function (x) { return x.stage === stage; })[0];
  return p ? p.status : 'Available';
}

/** Moves a deal forward to `stage` only if it's currently at an earlier (active) stage. Caller holds the lock. */
function advanceStage_(dealId, stage) {
  var d = findBy_(SHEET.DEALS, 'id', dealId);
  if (!d) return;
  var cur = stageOf_(d);
  if (['Closed', 'Dead Deal'].indexOf(cur) > -1) return;
  if (PIPELINE_STAGES.indexOf(stage) <= PIPELINE_STAGES.indexOf(cur)) return;
  updateObject_(SHEET.DEALS, d._row, { stage: stage, stageUpdated: new Date(), status: statusForStage_(stage), updated: new Date() });
}

function getDealRow_(dealId) {
  var d = findBy_(SHEET.DEALS, 'id', dealId);
  if (!d) throw new Error('Deal ' + dealId + ' not found.');
  return d;
}

function normalizeDeal_(deal) {
  var closing = str_(deal.closingDate);
  if (closing && !/^\d{4}-\d{2}-\d{2}$/.test(closing)) throw new Error('Closing date must be a valid date.');
  var video = str_(deal.videoUrl);
  if (video && !/^https?:\/\//i.test(video)) throw new Error('Video link must start with http:// or https://');
  return {
    address: str_(deal.address),
    city: str_(deal.city),
    state: str_(deal.state).toUpperCase(),
    zip: str_(deal.zip),
    market: str_(deal.market),
    propertyType: str_(deal.propertyType),
    askingPrice: num_(deal.askingPrice),
    assignmentPrice: num_(deal.assignmentPrice),
    showAssignment: bool_(deal.showAssignment),
    arv: num_(deal.arv),
    repairs: num_(deal.repairs),
    sqft: num_(deal.sqft),
    beds: num_(deal.beds),
    baths: num_(deal.baths),
    lotSize: str_(deal.lotSize),
    yearBuilt: num_(deal.yearBuilt),
    description: str_(deal.description),
    closingDate: closing,
    access: str_(deal.access),
    showAccess: deal.showAccess === undefined ? true : bool_(deal.showAccess),
    videoUrl: str_(deal.videoUrl),
    internalNotes: str_(deal.internalNotes),
    acres: num_(deal.acres),
    parcelId: str_(deal.parcelId),
    zoning: str_(deal.zoning),
    contractPrice: num_(deal.contractPrice),
    offerDeadline: str_(deal.offerDeadline).replace('T', ' '),
    rep: str_(deal.rep)
  };
}

// ---------- Drive media ----------

function rootFolder_() {
  var s = getSettings_();
  if (s.DRIVE_FOLDER_ID) {
    try { return DriveApp.getFolderById(s.DRIVE_FOLDER_ID); } catch (e) { /* recreate below */ }
  }
  var folder = DriveApp.createFolder(APP_NAME + ' — Deal Media');
  setSetting_('DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

function dealFolder_(deal) {
  if (deal.folderId) {
    try { return DriveApp.getFolderById(deal.folderId); } catch (e) { /* recreate */ }
  }
  var folder = rootFolder_().createFolder(deal.id + ' — ' + dealTitle_(deal));
  if (bool_(getSettings_().SHARE_MEDIA_LINKS)) shareByLink_(folder);
  updateObject_(SHEET.DEALS, deal._row, { folderId: folder.getId() });
  deal.folderId = folder.getId();
  return folder;
}

function shareByLink_(item) {
  try {
    item.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return true;
  } catch (e) {
    // Some Google Workspace domains block link sharing; the email still embeds photos.
    return false;
  }
}

function blobFromBase64_(base64, mimeType, fileName) {
  var data = String(base64 || '');
  var comma = data.indexOf(',');
  if (data.indexOf('data:') === 0 && comma > -1) data = data.slice(comma + 1);
  return Utilities.newBlob(Utilities.base64Decode(data), mimeType || 'application/octet-stream', fileName || 'file');
}

// ---------- client API ----------

function listDeals() {
  return readTable_(SHEET.DEALS).rows.map(cleanDealRow_).reverse();
}

function getDeal(dealId) {
  return cleanDealRow_(getDealRow_(dealId));
}

/** Creates or updates a deal. Returns the saved deal. */
function saveDeal(deal) {
  return withLock_(function () {
    deal = deal || {};
    var data = normalizeDeal_(deal);
    if (!data.address) throw new Error('Property address is required.');
    if (!data.askingPrice) throw new Error('Asking / purchase price is required.');
    data.updated = new Date();
    if (deal.id) {
      var existing = getDealRow_(deal.id);
      updateObject_(SHEET.DEALS, existing._row, data);
      data.id = deal.id;
    } else {
      data.id = nextId_('DEAL_SEQ_' + new Date().getFullYear(), 'SDI-' + new Date().getFullYear() + '-', 4);
      data.status = 'Available';
      data.stage = 'Ready for Disposition';
      data.stageUpdated = new Date();
      data.created = new Date();
      data.timesDistributed = 0;
      data.totalRecipients = 0;
      data.responses = 0;
      data.interested = 0;
      data.photoIds = '';
      appendObjects_(SHEET.DEALS, [data]);
    }
    return getDeal(data.id);
  });
}

/** Marks a deal Available / Pending / Sold. extra: { buyer, soldPrice } */
function setDealStatus(dealId, status, extra) {
  if (DEAL_STATUSES.indexOf(status) === -1) throw new Error('Unknown status ' + status);
  return withLock_(function () {
    var d = getDealRow_(dealId);
    var f = { status: status, updated: new Date() };
    extra = extra || {};
    if (status === 'Sold') {
      f.soldDate = new Date();
      if (extra.buyer !== undefined) f.buyer = str_(extra.buyer);
      if (extra.soldPrice !== undefined) f.soldPrice = num_(extra.soldPrice);
    } else if (status === 'Pending') {
      if (extra.buyer !== undefined) f.buyer = str_(extra.buyer);
    } else {
      f.soldDate = '';
    }
    var cur = stageOf_(d);
    var target = { Sold: 'Closed', Dead: 'Dead Deal', Pending: PIPELINE_STAGES.indexOf(cur) >= 5 && PIPELINE_STAGES.indexOf(cur) <= 8 ? cur : 'Buyer Selected' }[status];
    if (status === 'Available') target = PIPELINE_STAGES.indexOf(cur) <= 4 ? cur : (Number(d.timesDistributed) > 0 ? 'Negotiating' : 'Ready for Disposition');
    if (target !== cur) { f.stage = target; f.stageUpdated = new Date(); }
    updateObject_(SHEET.DEALS, d._row, f);
    return getDeal(dealId);
  });
}

/**
 * Sets the pipeline stage. extra: { buyerInvestorId, buyer, soldPrice, emdAmount, closingDate }
 * Closed records a completed transaction for the buyer; Dead Deal stops distribution.
 */
function setDealStage(dealId, stage, extra) {
  if (PIPELINE_STAGES.indexOf(stage) === -1) throw new Error('Unknown stage ' + stage);
  extra = extra || {};
  return withLock_(function () {
    var d = getDealRow_(dealId);
    var f = { stage: stage, stageUpdated: new Date(), status: statusForStage_(stage), updated: new Date() };
    if (extra.buyerInvestorId !== undefined) {
      f.buyerInvestorId = str_(extra.buyerInvestorId);
      var inv = f.buyerInvestorId ? findBy_(SHEET.INVESTORS, 'id', f.buyerInvestorId) : null;
      if (inv) f.buyer = investorName_(inv) + (inv.company && investorName_(inv) !== inv.company ? ' (' + inv.company + ')' : '');
    }
    if (extra.buyer !== undefined && !f.buyer) f.buyer = str_(extra.buyer);
    if (extra.emdAmount !== undefined) f.emdAmount = num_(extra.emdAmount);
    if (extra.closingDate) f.closingDate = str_(extra.closingDate);
    if (stage === 'Assignment Signed' && !d.assignmentSigned) f.assignmentSigned = new Date();
    if (stage === 'EMD Received' && !d.emdReceived) f.emdReceived = new Date();
    if (stage === 'Closed') {
      f.soldDate = new Date();
      if (extra.soldPrice !== undefined) f.soldPrice = num_(extra.soldPrice);
      var buyerId = f.buyerInvestorId || str_(d.buyerInvestorId);
      if (buyerId && stageOf_(d) !== 'Closed') {
        recordBuyerOutcome_(buyerId, 'closed', dealId);
        readTable_(SHEET.OFFERS).rows.forEach(function (o) {
          if (o.dealId === dealId && o.investorId === buyerId && ['Accepted', 'Under Contract'].indexOf(o.status) > -1) {
            updateObject_(SHEET.OFFERS, o._row, { status: 'Closed', updated: new Date() });
            if (!f.soldPrice && !d.soldPrice) f.soldPrice = num_(o.amount);
          }
        });
      }
    }
    updateObject_(SHEET.DEALS, d._row, f);
    return getDeal(dealId);
  });
}

/** Board data: every deal with stage, days in stage, offers and the selected buyer. */
function getPipeline() {
  var offers = {};
  readTable_(SHEET.OFFERS).rows.forEach(function (o) {
    var x = offers[o.dealId] || (offers[o.dealId] = { count: 0, best: 0, active: 0 });
    x.count++;
    if (['Rejected', 'Withdrawn', 'Fell Through'].indexOf(o.status) === -1) { x.active++; x.best = Math.max(x.best, Number(o.amount) || 0); }
  });
  return {
    stages: PIPELINE,
    deals: listDeals().map(function (d) { d.offers = offers[d.id] || { count: 0, best: 0, active: 0 }; return d; })
  };
}

/** Uploads one photo (base64, already resized in the browser). */
function uploadDealPhoto(dealId, fileName, mimeType, base64) {
  if (!/^image\//.test(mimeType || '')) throw new Error('Only image files can be uploaded as photos.');
  var deal = getDealRow_(dealId);
  var ids = photoIds_(deal);
  if (ids.length >= MAX_PHOTOS) throw new Error('A deal can have at most ' + MAX_PHOTOS + ' photos.');
  var folder = dealFolder_(deal);
  var file = folder.createFile(blobFromBase64_(base64, mimeType, fileName));
  if (bool_(getSettings_().SHARE_MEDIA_LINKS)) shareByLink_(file);
  return withLock_(function () {
    var fresh = getDealRow_(dealId);
    var list = photoIds_(fresh);
    list.push(file.getId());
    updateObject_(SHEET.DEALS, fresh._row, { photoIds: list.join(','), updated: new Date() });
    return { id: file.getId(), photoIds: list };
  });
}

function removeDealPhoto(dealId, fileId) {
  return withLock_(function () {
    var d = getDealRow_(dealId);
    var list = photoIds_(d).filter(function (id) { return id !== fileId; });
    updateObject_(SHEET.DEALS, d._row, { photoIds: list.join(','), updated: new Date() });
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* already gone */ }
    return list;
  });
}

/** Moves a photo to the front so it becomes the cover image. */
function setCoverPhoto(dealId, fileId) {
  return withLock_(function () {
    var d = getDealRow_(dealId);
    var list = photoIds_(d).filter(function (id) { return id !== fileId; });
    list.unshift(fileId);
    updateObject_(SHEET.DEALS, d._row, { photoIds: list.join(','), updated: new Date() });
    return list;
  });
}

/** Small previews of a deal's photos for the web app. */
function getDealPhotoPreviews(dealId) {
  var d = getDealRow_(dealId);
  return photoIds_(d).map(function (id) {
    try {
      var f = DriveApp.getFileById(id);
      var blob = null;
      try { blob = f.getThumbnail(); } catch (e) { blob = null; }
      if (!blob && f.getSize() < 2.5 * 1024 * 1024) blob = f.getBlob();
      return {
        id: id,
        name: f.getName(),
        url: f.getUrl(),
        dataUrl: blob ? 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) : ''
      };
    } catch (err) {
      return { id: id, name: '(missing file)', url: '', dataUrl: '' };
    }
  });
}

/** Uploads a walkthrough video file to Drive and links it to the deal. */
function uploadDealVideo(dealId, fileName, mimeType, base64) {
  if (!/^video\//.test(mimeType || '')) throw new Error('Please choose a video file.');
  var deal = getDealRow_(dealId);
  var folder = dealFolder_(deal);
  var file = folder.createFile(blobFromBase64_(base64, mimeType, fileName));
  shareByLink_(file);
  return withLock_(function () {
    var fresh = getDealRow_(dealId);
    updateObject_(SHEET.DEALS, fresh._row, { videoFileId: file.getId(), videoUrl: file.getUrl(), updated: new Date() });
    return getDeal(dealId);
  });
}

/** Full tracking picture for a deal: recipients, jobs, responses. */
function getDealTracking(dealId) {
  var deal = getDeal(dealId);
  var log = readTable_(SHEET.LOG).rows.filter(function (l) { return l.dealId === dealId; });
  var jobs = readTable_(SHEET.JOBS).rows.filter(function (j) { return j.dealId === dealId; });
  var responses = readTable_(SHEET.RESPONSES).rows.filter(function (r) { return r.dealId === dealId; });
  return toClient_({
    deal: deal,
    recipients: log.reverse(),
    jobs: jobs.reverse(),
    responses: responses.reverse()
  });
}
