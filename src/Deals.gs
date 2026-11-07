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
  return o;
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
    internalNotes: str_(deal.internalNotes)
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
    updateObject_(SHEET.DEALS, d._row, f);
    return getDeal(dealId);
  });
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
