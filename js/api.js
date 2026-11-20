/* Client API : Google Apps Script en production, simulateur local (même Code.gs) en mode démo. */
(function () {
  'use strict';
  const CFG = window.ROTARYCONNECT_CONFIG || {};
  const TOKEN_KEY = 'rc_token';
  const USER_KEY = 'rc_user';
  const CACHE_PREFIX = 'rc_cache_';
  const demo = !CFG.API_URL;

  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage plein ou indisponible */ } },
    del: k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  let runtimePromise = null;
  function demoRuntime() {
    if (!runtimePromise) {
      runtimePromise = fetch('apps-script/Code.gs')
        .then(r => { if (!r.ok) throw new Error('Code.gs introuvable'); return r.text(); })
        .then(src => {
          const rt = GasShim.createRuntime(src, { get: k => store.get('rc_demo_' + k), set: (k, v) => store.set('rc_demo_' + k, v) });
          if (!rt.isInitialised()) DemoSeed.seed(rt);
          return rt;
        });
    }
    return runtimePromise;
  }

  async function callRemote(body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function call(action, params) {
    const body = Object.assign({ action: action, token: store.get(TOKEN_KEY) || '' }, params || {});
    let json;
    try {
      json = demo ? (await demoRuntime()).call(body) : await callRemote(body);
    } catch (e) {
      if (action === 'meetings') {
        const cached = store.get(CACHE_PREFIX + 'meetings');
        if (cached) return Object.assign(JSON.parse(cached), { _offline: true });
      }
      const err = new ApiError('reseau', 'Impossible de joindre le serveur. Vérifiez votre connexion.');
      err.offline = true;
      throw err;
    }
    if (!json || !json.ok) {
      const code = json && json.code;
      if (code === 'session_expiree') {
        clearSession();
        window.dispatchEvent(new Event('rc:logout'));
      }
      throw new ApiError(code || 'erreur', (json && json.error) || 'Erreur inattendue.');
    }
    if (action === 'meetings') store.set(CACHE_PREFIX + 'meetings', JSON.stringify(json.data));
    return json.data;
  }

  function setSession(token, user) {
    if (token) store.set(TOKEN_KEY, token);
    store.set(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    store.del(TOKEN_KEY);
    store.del(USER_KEY);
    store.del(CACHE_PREFIX + 'meetings');
  }

  function getUser() {
    try { return store.get(TOKEN_KEY) ? JSON.parse(store.get(USER_KEY)) : null; } catch (e) { return null; }
  }

  window.API = {
    demo: demo,
    ApiError: ApiError,
    call: call,
    setSession: setSession,
    clearSession: clearSession,
    getUser: getUser,
    async demoMails() { return (await demoRuntime()).mails.slice().reverse(); },
    async demoRelances() { return (await demoRuntime()).run('envoyerRelances'); },
    resetDemo() {
      Object.keys(localStorage).filter(k => k.indexOf('rc_demo_') === 0).forEach(k => localStorage.removeItem(k));
      clearSession();
    }
  };
})();
