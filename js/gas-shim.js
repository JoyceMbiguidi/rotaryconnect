/**
 * Simulateur minimal de l'environnement Google Apps Script.
 * Exécute le vrai fichier apps-script/Code.gs dans le navigateur (mode démo, données en localStorage)
 * ou sous Node (tests). Ne sert jamais en production : en production, l'API est le script déployé.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GasShim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- SHA-256 / HMAC synchrones ---------- */
  const K = [];
  const H0 = [];
  (function init() {
    const frac = x => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
    let n = 2;
    while (K.length < 64) {
      let prime = true;
      for (let i = 2; i * i <= n; i++) if (n % i === 0) { prime = false; break; }
      if (prime) {
        if (H0.length < 8) H0.push(frac(Math.sqrt(n)));
        K.push(frac(Math.cbrt(n)));
      }
      n++;
    }
  })();

  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  function sha256(msg) {
    const l = msg.length;
    const buf = new Uint8Array(((l + 9 + 63) >> 6) << 6);
    buf.set(msg);
    buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 8, Math.floor((l * 8) / 4294967296));
    dv.setUint32(buf.length - 4, (l * 8) >>> 0);
    const h = H0.slice();
    const w = new Array(64);
    for (let off = 0; off < buf.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    h.forEach((v, i) => odv.setUint32(i * 4, v >>> 0));
    return out;
  }

  function hmacSha256(key, msg) {
    if (key.length > 64) key = sha256(key);
    const k = new Uint8Array(64);
    k.set(key);
    const ipad = new Uint8Array(64 + msg.length);
    const opad = new Uint8Array(64 + 32);
    for (let i = 0; i < 64; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
    ipad.set(msg, 64);
    opad.set(sha256(ipad), 64);
    return sha256(opad);
  }

  const enc = s => new TextEncoder().encode(String(s));
  const toBytes = v => (typeof v === 'string' ? enc(v) : Uint8Array.from(v.map(b => b & 255)));
  const signed = u8 => Array.from(u8, b => (b > 127 ? b - 256 : b));

  function b64encode(u8) {
    let s = '';
    u8.forEach(b => { s += String.fromCharCode(b); });
    return btoa(s);
  }

  function b64decode(str) {
    const s = atob(str);
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }

  function formatDate(date, tz, fmt) {
    const p2 = n => (n < 10 ? '0' : '') + n;
    const map = {
      yyyy: date.getFullYear(), MM: p2(date.getMonth() + 1), dd: p2(date.getDate()),
      HH: p2(date.getHours()), mm: p2(date.getMinutes()), ss: p2(date.getSeconds())
    };
    return fmt.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (m, lit) => (lit !== undefined ? lit : map[m]));
  }

  /* ---------- Feuilles ---------- */
  function makeSheet(data) {
    const sheet = {
      getLastRow() {
        let n = data.length;
        while (n > 0 && data[n - 1].every(v => v === '' || v === null || v === undefined)) n--;
        return n;
      },
      getMaxRows: () => Math.max(1000, data.length),
      insertRowsAfter() {},
      setFrozenRows() { return sheet; },
      getRange(r, c, nr, nc) {
        nr = nr || 1;
        nc = nc || 1;
        const range = {
          getValues() {
            const out = [];
            for (let i = 0; i < nr; i++) {
              const row = data[r - 1 + i] || [];
              const o = [];
              for (let j = 0; j < nc; j++) {
                const v = row[c - 1 + j];
                o.push(v === undefined || v === null ? '' : v);
              }
              out.push(o);
            }
            return out;
          },
          setValues(vals) {
            for (let i = 0; i < nr; i++) {
              while (data.length < r + i) data.push([]);
              const row = data[r - 1 + i];
              for (let j = 0; j < nc; j++) row[c - 1 + j] = vals[i][j];
            }
            return range;
          },
          clearContent() {
            for (let i = 0; i < nr; i++) {
              const row = data[r - 1 + i];
              if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = '';
            }
            return range;
          },
          setNumberFormat() { return range; },
          setFontWeight() { return range; }
        };
        return range;
      }
    };
    return sheet;
  }

  /**
   * @param {string} source  contenu de Code.gs
   * @param {{get:Function,set:Function}} [store]  persistance (clé/valeur texte)
   */
  function createRuntime(source, store) {
    const KEY = 'rc_gas_state';
    const mem = {};
    store = store || { get: k => (k in mem ? mem[k] : null), set: (k, v) => { mem[k] = v; } };
    let state;
    try { state = JSON.parse(store.get(KEY)); } catch (e) { state = null; }
    if (!state) state = { sheets: {}, props: {}, mails: [], triggers: [] };
    const cache = {};

    const save = () => store.set(KEY, JSON.stringify(state));

    const spreadsheet = {
      getSheetByName: name => (state.sheets[name] ? makeSheet(state.sheets[name]) : null),
      insertSheet: name => { state.sheets[name] = []; return makeSheet(state.sheets[name]); }
    };

    const env = {
      SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: k => (k in state.props ? state.props[k] : null),
          setProperty: (k, v) => { state.props[k] = String(v); }
        })
      },
      CacheService: {
        getScriptCache: () => ({
          get: k => (cache[k] && cache[k].exp > Date.now() ? cache[k].v : null),
          put: (k, v, ttl) => { cache[k] = { v: v, exp: Date.now() + (ttl || 600) * 1000 }; },
          remove: k => { delete cache[k]; }
        })
      },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      MailApp: {
        sendEmail: m => { state.mails.push({ to: m.to, subject: m.subject, body: m.body, at: new Date().toISOString() }); if (state.mails.length > 300) state.mails.shift(); },
        getRemainingDailyQuota: () => 100
      },
      ScriptApp: {
        getProjectTriggers: () => state.triggers.map(fn => ({ getHandlerFunction: () => fn })),
        deleteTrigger: t => { state.triggers = state.triggers.filter(fn => fn !== t.getHandlerFunction()); },
        newTrigger: fn => {
          const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, create: () => { state.triggers.push(fn); } };
          return b;
        }
      },
      Session: { getScriptTimeZone: () => 'Europe/Paris' },
      ContentService: {
        MimeType: { JSON: 'JSON' },
        createTextOutput: s => ({ getContent: () => s, setMimeType() { return this; } })
      },
      Utilities: {
        DigestAlgorithm: { SHA_256: 'SHA_256' },
        computeDigest: (alg, v) => signed(sha256(toBytes(v))),
        computeHmacSha256Signature: (v, k) => signed(hmacSha256(toBytes(k), toBytes(v))),
        base64EncodeWebSafe: v => b64encode(toBytes(v)).replace(/\+/g, '-').replace(/\//g, '_'),
        base64DecodeWebSafe: s => {
          let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
          while (t.length % 4) t += '=';
          return signed(b64decode(t));
        },
        newBlob: bytes => ({ getDataAsString: () => new TextDecoder().decode(toBytes(bytes)) }),
        getUuid: () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); })),
        formatDate: formatDate
      }
    };

    const names = Object.keys(env);
    const factory = new Function(...names, source + '\nreturn { doPost, doGet, setup, envoyerRelances, installerDeclencheurs };');
    const api = factory(...names.map(n => env[n]));

    return {
      api: api,
      get mails() { return state.mails; },
      isInitialised: () => !!state.sheets.Membres,
      call(req) {
        const out = api.doPost({ postData: { contents: JSON.stringify(req) } });
        save();
        return JSON.parse(out.getContent());
      },
      run(fn, ...args) {
        const r = api[fn](...args);
        save();
        return r;
      },
      reset() { state = { sheets: {}, props: {}, mails: [], triggers: [] }; save(); }
    };
  }

  return { createRuntime: createRuntime, sha256: sha256 };
});
