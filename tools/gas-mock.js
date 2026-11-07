/**
 * In-memory mock of the Google Apps Script services used by this project.
 * Works in Node (tests) and in the browser (preview/index.html).
 * It is NOT shipped to Apps Script — it only exists for local testing and demos.
 */
(function (root) {
  'use strict';

  const MOCK = root.__GAS_MOCK__ = {
    user: 'dispo@samedayinvestments.com',
    quota: 100,
    sent: [],
    inbox: [],          // [{ id, from, subject, body, date }]
    triggers: [],
    props: {},
    cache: {},
    spreadsheets: {},
    files: {},
    folders: {}
  };

  let seq = 0;
  const id = (p) => (p || 'id') + '_' + (++seq).toString(36) + Math.random().toString(36).slice(2, 8);

  // ---------- Range / Sheet / Spreadsheet ----------
  function chainable(target) {
    const p = new Proxy(target, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop === 'symbol') return undefined;
        return function () { return p; };
      }
    });
    return p;
  }

  function makeRange(sheet, r, c, nr, nc) {
    nr = nr || 1; nc = nc || 1;
    const t = {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = [];
          for (let j = 0; j < nc; j++) {
            const v = (sheet.data[r - 1 + i] || [])[c - 1 + j];
            row.push(v === undefined || v === null ? '' : v);
          }
          out.push(row);
        }
        return out;
      },
      getDisplayValues() {
        return t.getValues().map(row => row.map(v => v instanceof Date ? v.toLocaleDateString('en-US') : String(v)));
      },
      setValues(vals) {
        if (vals.length !== nr || vals.some(row => row.length !== nc)) {
          throw new Error('The number of rows/columns in the data does not match the range. Expected ' + nr + 'x' + nc + ', got ' + vals.length + 'x' + (vals[0] || []).length);
        }
        for (let i = 0; i < nr; i++) {
          const ri = r - 1 + i;
          while (sheet.data.length <= ri) sheet.data.push([]);
          for (let j = 0; j < nc; j++) {
            let v = vals[i][j];
            if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
            else if (typeof v === 'string' && /^=/.test(v)) throw new Error('Formula written to sheet: ' + v);
            sheet.data[ri][c - 1 + j] = v;
          }
        }
        return proxy;
      },
      setValue(v) { return t.setValues([[v]]); },
      getValue() { return t.getValues()[0][0]; }
    };
    const proxy = new Proxy(t, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'symbol') return undefined;
        return function () { return proxy; };
      }
    });
    return proxy;
  }

  function Sheet(name) {
    this.name = name;
    this.data = [];
  }
  Sheet.prototype = {
    getName() { return this.name; },
    getLastRow() {
      for (let i = this.data.length - 1; i >= 0; i--) {
        if ((this.data[i] || []).some(v => v !== '' && v !== undefined && v !== null)) return i + 1;
      }
      return 0;
    },
    getLastColumn() {
      let m = 0;
      this.data.forEach(row => { for (let j = (row || []).length - 1; j >= 0; j--) { if (row[j] !== '' && row[j] !== undefined && row[j] !== null) { m = Math.max(m, j + 1); break; } } });
      return m;
    },
    getMaxRows() { return Math.max(1000, this.data.length); },
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') throw new Error('A1 notation not supported in mock');
      return makeRange(this, r, c, nr, nc);
    },
    getDataRange() { return makeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); },
    setFrozenRows() { return this; },
    deleteRow(n) { this.data.splice(n - 1, 1); return this; },
    autoResizeColumns() { return this; }
  };

  function Spreadsheet(name) {
    this._id = id('ss');
    this._name = name;
    this._sheets = [new Sheet('Sheet1')];
    MOCK.spreadsheets[this._id] = this;
  }
  Spreadsheet.prototype = {
    getId() { return this._id; },
    getName() { return this._name; },
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this._id + '/edit'; },
    getSheets() { return this._sheets.slice(); },
    getSheetByName(n) { return this._sheets.find(s => s.name === n) || null; },
    insertSheet(n) { const s = new Sheet(n); this._sheets.push(s); return s; },
    deleteSheet(s) { this._sheets = this._sheets.filter(x => x !== s); }
  };

  const active = new Spreadsheet('SameDayInvestments — Deal Distribution Database');
  MOCK.activeSpreadsheet = active;

  root.SpreadsheetApp = {
    getActiveSpreadsheet: () => MOCK.activeSpreadsheet,
    openById: (sid) => { const s = MOCK.spreadsheets[sid]; if (!s) throw new Error('Spreadsheet not found'); return s; },
    create: (n) => new Spreadsheet(n),
    getUi: () => chainable({})
  };
  MOCK.Spreadsheet = Spreadsheet;

  // ---------- Properties / Cache / Lock / Session ----------
  root.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: k => (k in MOCK.props ? MOCK.props[k] : null),
      setProperty: (k, v) => { MOCK.props[k] = String(v); },
      deleteProperty: k => { delete MOCK.props[k]; }
    })
  };
  root.CacheService = {
    getScriptCache: () => ({
      get: k => (k in MOCK.cache ? MOCK.cache[k] : null),
      put: (k, v) => { if (String(v).length > 100000) throw new Error('Cache value too large'); MOCK.cache[k] = String(v); },
      remove: k => { delete MOCK.cache[k]; }
    })
  };
  let lockHeld = false;
  root.LockService = {
    getScriptLock: () => {
      let mine = false;
      return {
        waitLock: () => { if (lockHeld) throw new Error('Lock timeout (mock: lock already held — nested lock?)'); lockHeld = true; mine = true; },
        tryLock: () => { if (lockHeld) return false; lockHeld = true; mine = true; return true; },
        releaseLock: () => { if (mine) { lockHeld = false; mine = false; } },
        hasLock: () => mine
      };
    }
  };
  MOCK.isLocked = () => lockHeld;
  root.Session = {
    getActiveUser: () => ({ getEmail: () => MOCK.user }),
    getEffectiveUser: () => ({ getEmail: () => MOCK.user }),
    getScriptTimeZone: () => 'America/New_York'
  };

  // ---------- Utilities / Blob ----------
  const b64enc = (bytes) => {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 255); return btoa(s);
  };
  const b64dec = (str) => {
    if (typeof Buffer !== 'undefined') return Array.from(Buffer.from(str, 'base64'));
    const s = atob(str); const out = new Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out;
  };
  function Blob(bytes, mime, name) { this._b = bytes || []; this._m = mime || 'application/octet-stream'; this._n = name || 'blob'; }
  Blob.prototype = {
    getBytes() { return this._b; }, getContentType() { return this._m; }, getName() { return this._n; },
    setName(n) { this._n = n; return this; }, copyBlob() { return new Blob(this._b.slice(), this._m, this._n); }
  };
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  root.Utilities = {
    getUuid: () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); })),
    formatDate: (d, tz, f) => f
      .replace(/yyyy/g, d.getFullYear()).replace(/MMMM/g, '\u0001').replace(/MM/g, pad(d.getMonth() + 1)).replace(/dd/g, pad(d.getDate()))
      .replace(/HH/g, pad(d.getHours())).replace(/mm/g, pad(d.getMinutes())).replace(/ss/g, pad(d.getSeconds()))
      .replace(/\bd\b/g, d.getDate()).replace(/\u0001/g, MONTHS[d.getMonth()]),
    base64Encode: b64enc,
    base64Decode: b64dec,
    newBlob: (bytes, mime, name) => new Blob(bytes, mime, name),
    sleep: () => {}
  };

  // ---------- Mail ----------
  root.MailApp = { getRemainingDailyQuota: () => MOCK.quota };
  root.GmailApp = {
    sendEmail(to, subject, body, opts) {
      if (MOCK.quota <= 0) throw new Error('Service invoked too many times for one day: email.');
      if (/[,;]/.test(to)) throw new Error('Mock guard: multiple recipients in one email: ' + to);
      if (opts && (opts.cc || opts.bcc)) throw new Error('Mock guard: cc/bcc used');
      MOCK.quota--;
      MOCK.sent.push({ to, subject, body, opts: opts || {}, at: new Date() });
    },
    search(q) {
      return MOCK.inbox.filter(m => !m._threaded).map(m => ({
        getMessages: () => [{
          getId: () => m.id, getFrom: () => m.from, getSubject: () => m.subject,
          getPlainBody: () => m.body, getDate: () => m.date || new Date()
        }]
      })).filter((th) => {
        const m = th.getMessages()[0];
        if (/subject:unsubscribe/i.test(q)) return /unsubscribe/i.test(m.getSubject());
        const ids = (q.match(/subject:"([^"]+)"/g) || []).map(s => s.slice(9, -1));
        return ids.some(x => m.getSubject().indexOf(x) > -1);
      });
    },
    getAliases: () => []
  };

  // ---------- Drive ----------
  function File(blob, folder) {
    this._id = id('file'); this._blob = blob; this._folder = folder; this._trashed = false; this.sharing = 'PRIVATE';
    MOCK.files[this._id] = this;
  }
  File.prototype = {
    getId() { return this._id; }, getName() { return this._blob.getName(); }, getBlob() { return this._blob.copyBlob(); },
    getSize() { return this._blob.getBytes().length; }, getThumbnail() { return this._blob.copyBlob(); },
    getUrl() { return 'https://drive.google.com/file/d/' + this._id + '/view'; },
    setTrashed(v) { this._trashed = v; return this; }, setSharing(a) { this.sharing = a; return this; }
  };
  function Folder(name) { this._id = id('folder'); this._name = name; this.sharing = 'PRIVATE'; MOCK.folders[this._id] = this; }
  Folder.prototype = {
    getId() { return this._id; }, getName() { return this._name; },
    createFolder(n) { return new Folder(n); }, createFile(blob) { return new File(blob, this); },
    setSharing(a) { this.sharing = a; return this; }, getUrl() { return 'https://drive.google.com/drive/folders/' + this._id; }
  };
  root.DriveApp = {
    createFolder: (n) => new Folder(n),
    getFolderById: (fid) => { if (!MOCK.folders[fid]) throw new Error('No folder'); return MOCK.folders[fid]; },
    getFileById: (fid) => { if (!MOCK.files[fid]) throw new Error('No file'); return MOCK.files[fid]; },
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
    Permission: { VIEW: 'VIEW' }
  };

  // ---------- Script / Html / Logger ----------
  root.ScriptApp = {
    newTrigger(fn) {
      const t = { fn, kind: '' };
      const b = {
        timeBased: () => b, after: (ms) => { t.kind = 'after ' + ms; return b; }, everyMinutes: (n) => { t.kind = 'every ' + n + 'm'; return b; },
        create: () => { const tr = { getHandlerFunction: () => fn, kind: t.kind }; MOCK.triggers.push(tr); return tr; }
      };
      return b;
    },
    getProjectTriggers: () => MOCK.triggers.slice(),
    deleteTrigger: (tr) => { MOCK.triggers = MOCK.triggers.filter(x => x !== tr); },
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/MOCK/exec' })
  };
  root.HtmlService = {
    createTemplateFromFile: () => chainable({ evaluate: () => chainable({}) }),
    createHtmlOutputFromFile: () => ({ getContent: () => '' }),
    createHtmlOutput: () => chainable({}),
    XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' }
  };
  root.Logger = { log: function () { if (root.__GAS_VERBOSE__) console.log.apply(console, arguments); } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
