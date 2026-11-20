/* RotaryConnect – application (routeur, vues membre / secrétaire / président). */
(function () {
  'use strict';
  const { esc, icon, toast, modal, confirmDialog, fmtLong, fmtShort, fmtHeure, dateBadge, initials, fmtPct, fmtDateTime } = UI;

  const $app = document.getElementById('app');
  const ROLE_LABEL = { membre: 'Membre', secretaire: 'Secrétaire', president: 'Président' };
  const TYPES = ['Réunion statutaire', 'Conférence', 'Action de service', 'Convivialité', 'Conseil du club', 'Autre'];
  const ALL = ['membre', 'secretaire', 'president'];

  let user = null;
  let config = { clubNom: 'Rotary Club Reims', relancesActives: true, joursRelance: [7, 2], heureRelance: 9 };
  let deferredPrompt = null;
  let renderId = 0;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  const homeFor = role => (role === 'president' ? 'dashboard' : role === 'secretaire' ? 'secretariat' : 'reunions');

  function navFor(role) {
    if (role === 'president') return [['dashboard', 'Tableau de bord', 'grid'], ['stats', 'Statistiques', 'chart'], ['reunions', 'Réunions', 'calendar'], ['profil', 'Profil', 'user']];
    if (role === 'secretaire') return [['reunions', 'Réunions', 'calendar'], ['secretariat', 'Secrétariat', 'clipboard'], ['membres', 'Membres', 'users'], ['profil', 'Profil', 'user']];
    return [['reunions', 'Réunions', 'calendar'], ['profil', 'Profil', 'user']];
  }

  const ROUTES = {
    reunions: { roles: ALL, render: viewReunions },
    profil: { roles: ALL, render: viewProfil },
    secretariat: { roles: ['secretaire'], render: viewSecretariat },
    suivi: { roles: ['secretaire', 'president'], render: viewSuivi, parent: u => (u.role === 'president' ? 'dashboard' : 'secretariat') },
    membres: { roles: ['secretaire'], render: viewMembres },
    dashboard: { roles: ['president'], render: viewDashboard },
    stats: { roles: ['president'], render: viewStats }
  };

  /* ================================================================ */
  /* Utilitaires                                                       */
  /* ================================================================ */

  async function withBusy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } finally { if (btn) btn.disabled = false; }
  }

  const errMsg = e => (e && e.message) || 'Une erreur est survenue.';

  function paint(ctx, html) {
    const demo = API.demo ? '<div class="banner info"><strong>Mode démo</strong> : données fictives stockées sur cet appareil. Renseignez l\'URL de l\'API dans <code>js/config.js</code> pour passer en production.</div>' : '';
    ctx.el.innerHTML = demo + html;
  }

  const skeleton = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

  function pwdField(name, label, autocomplete, ic, placeholder) {
    return '<div class="field"><label for="f-' + name + '">' + (ic ? icon(ic) + ' ' : '') + esc(label) + '</label><div class="pwd"><input id="f-' + name + '" name="' + name + '" type="password"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + ' autocomplete="' + autocomplete + '" required><button type="button" data-toggle-pwd aria-label="Afficher le mot de passe">' + icon('eye') + '</button></div></div>';
  }

  function setUser(u, token) {
    user = u;
    API.setSession(token || null, u);
  }

  /* ================================================================ */
  /* Connexion                                                         */
  /* ================================================================ */

  function installHint() {
    if (isStandalone()) return '';
    if (isIOS) return '<p class="small muted" style="margin-top:1rem">' + icon('smartphone') + ' Pour installer : touchez <strong>Partager</strong> puis <strong>Sur l\'écran d\'accueil</strong>.</p>';
    return '<button type="button" class="btn secondary block" data-install hidden style="margin-top:1rem">' + icon('download') + ' Installer l\'application</button>';
  }

  function showLogin(msg) {
    const club = esc(localStorage.getItem('rc_club') || config.clubNom);
    $app.innerHTML = '<div class="auth"><header class="auth-top"><img class="logo" src="icons/icon-192.png" alt="">' +
      '<div class="who"><strong>RotaryConnect</strong><span>' + club + '</span></div><i class="sep"></i>' +
      '<p class="motto">Servir d\'abord,<br>Agir ensemble</p></header>' +
      '<div class="box">' +
      '<img class="logo" src="icons/icon-192.png" alt="">' +
      '<h1>RotaryConnect</h1><p class="club"><span>' + club + '</span></p>' +
      '<h2 class="welcome">Bienvenue !</h2><p class="intro">Ensemble, faisons rayonner le Rotary<br>et ses valeurs.</p>' +
      '<form id="login-form" novalidate>' +
      (msg ? '<div class="form-error" role="alert">' + esc(msg) + '</div>' : '<div id="login-err"></div>') +
      '<div class="field"><label for="f-id">' + icon('user') + ' Identifiant</label><input id="f-id" name="identifiant" placeholder="Votre identifiant" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></div>' +
      pwdField('motDePasse', 'Mot de passe', 'current-password', 'lock', 'Votre mot de passe') +
      '<button class="btn block" type="submit">' + icon('login') + ' Se connecter</button></form>' +
      installHint() +
      (API.demo ? '<div class="demo-box"><div><strong>Mode démo</strong> – mot de passe : <code>demo1234</code></div><div class="accts">' +
        [['secretaire', 'Secrétaire', 'users'], ['president', 'Président', 'user'], ['claire.dubois', 'Membre', 'users']].map(a => '<button type="button" class="btn sm secondary" data-fill="' + a[0] + '">' + icon(a[2]) + a[1] + '</button>').join('') +
        '</div><button type="button" class="btn sm ghost" data-reset-demo>' + icon('refresh') + ' Réinitialiser les données de démo</button></div>' : '') +
      '</div></div>';
    refreshInstallUI();
    const form = document.getElementById('login-form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      try {
        const d = await withBusy(btn, () => API.call('login', { identifiant: fd.get('identifiant'), motDePasse: fd.get('motDePasse') }));
        user = d.user;
        config = d.config;
        API.setSession(d.token, d.user);
        route();
      } catch (err) {
        document.getElementById('login-err').innerHTML = '<div class="form-error" role="alert">' + esc(errMsg(err)) + '</div>';
      }
    });
    $app.querySelectorAll('[data-fill]').forEach(b => b.addEventListener('click', () => {
      form.identifiant.value = b.dataset.fill;
      form.motDePasse.value = 'demo1234';
    }));
    const reset = $app.querySelector('[data-reset-demo]');
    if (reset) reset.addEventListener('click', () => { API.resetDemo(); location.reload(); });
  }

  function showForcedPassword() {
    $app.innerHTML = '<div class="auth"><div class="box"><img class="logo" src="icons/icon-192.png" alt="">' +
      '<h1>Nouveau mot de passe</h1><p class="tag">Bonjour ' + esc(user.prenom) + ', choisissez votre mot de passe personnel pour continuer.</p>' +
      '<form id="pwd-form"><div id="pwd-err"></div>' +
      pwdField('ancien', 'Mot de passe provisoire', 'current-password') +
      pwdField('nouveau', 'Nouveau mot de passe (8 caractères min.)', 'new-password') +
      pwdField('confirm', 'Confirmer le nouveau mot de passe', 'new-password') +
      '<button class="btn block" type="submit">Enregistrer</button>' +
      '<button class="btn ghost block" type="button" data-act="logout" style="margin-top:.5rem">Se déconnecter</button></form></div></div>';
    const form = document.getElementById('pwd-form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const err = m => { document.getElementById('pwd-err').innerHTML = '<div class="form-error" role="alert">' + esc(m) + '</div>'; };
      if (fd.get('nouveau') !== fd.get('confirm')) return err('La confirmation ne correspond pas.');
      try {
        const d = await withBusy(form.querySelector('button[type=submit]'), () => API.call('password.change', { ancien: fd.get('ancien'), nouveau: fd.get('nouveau') }));
        setUser(d.user, d.token);
        toast('Mot de passe mis à jour', 'ok');
        route();
      } catch (ex) { err(errMsg(ex)); }
    });
  }

  function logout() {
    API.clearSession();
    user = null;
    history.replaceState(null, '', location.pathname + location.search);
    showLogin();
  }

  /* ================================================================ */
  /* Coque + routeur                                                   */
  /* ================================================================ */

  function renderShell() {
    $app.innerHTML = '<header class="topbar"><img class="logo" src="icons/icon-192.png" alt="">' +
      '<div style="min-width:0"><div class="brand">RotaryConnect</div><div class="club" id="club-name"></div></div>' +
      '<div class="who"><button type="button" class="btn install sm" data-install hidden>' + icon('download') + '<span>Installer</span></button>' +
      '<a class="userchip" id="userchip" href="#/profil" aria-label="Mon profil"><span class="avatar"></span><span class="nm"></span></a></div></header>' +
      '<nav class="nav" id="nav" aria-label="Navigation principale"></nav>' +
      '<main id="view" class="view" tabindex="-1"></main>';
    refreshInstallUI();
  }

  function updateChrome(routeName) {
    document.getElementById('club-name').textContent = config.clubNom;
    try { localStorage.setItem('rc_club', config.clubNom); } catch (e) { /* ignore */ }
    document.title = 'RotaryConnect – ' + config.clubNom;
    const chip = document.getElementById('userchip');
    chip.querySelector('.avatar').textContent = initials(user.prenom, user.nom);
    chip.querySelector('.nm').textContent = user.prenom + ' · ' + ROLE_LABEL[user.role];
    const r = ROUTES[routeName];
    const active = r && r.parent ? r.parent(user) : routeName;
    document.getElementById('nav').innerHTML = navFor(user.role).map(n =>
      '<a href="#/' + n[0] + '"' + (n[0] === active ? ' aria-current="page"' : '') + '>' + icon(n[2]) + '<span>' + esc(n[1]) + '</span></a>').join('');
  }

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    return { name: parts[0] || '', arg: decodeURIComponent(parts.slice(1).join('/')) };
  }

  async function route() {
    if (!user) return showLogin();
    if (user.doitChangerMdp) return showForcedPassword();
    const h = parseHash();
    const r = ROUTES[h.name];
    if (!r || r.roles.indexOf(user.role) < 0) {
      location.replace('#/' + homeFor(user.role));
      return;
    }
    if (!document.getElementById('view')) renderShell();
    updateChrome(h.name);
    const el = document.getElementById('view');
    const id = ++renderId;
    const ctx = { el: el, arg: h.arg, stale: () => id !== renderId };
    el.onclick = el.onsubmit = el.oninput = el.onchange = el.onkeydown = null;
    el.innerHTML = skeleton;
    window.scrollTo(0, 0);
    try {
      await r.render(ctx);
    } catch (e) {
      if (ctx.stale()) return;
      el.innerHTML = '<div class="card empty"><p>' + esc(errMsg(e)) + '</p><button class="btn" data-retry>Réessayer</button></div>';
      el.onclick = ev => { if (ev.target.closest('[data-retry]')) route(); };
    }
  }

  /* ================================================================ */
  /* Réunions : cartes                                                 */
  /* ================================================================ */

  function meetingCard(m, mode) {
    const b = dateBadge(m.date);
    const cancelled = m.statut === 'annulee';
    const upcoming = !m.passee && !cancelled;
    const r = m.maReponse;
    const toConfirm = mode === 'member' && upcoming && !r;
    let chips = '<span class="chip">' + esc(m.type) + '</span>';
    if (cancelled) chips += '<span class="chip ko">Annulée</span>';
    else if (m.passee) chips += '<span class="chip grey">Terminée</span>';
    else if (toConfirm) chips += '<span class="chip warn">À confirmer</span>';
    if (mode === 'member' && r && !cancelled) chips += '<span class="chip ' + (r.reponse === 'oui' ? 'ok' : 'ko') + '">' + (r.reponse === 'oui' ? 'Je participe' : 'Je suis absent') + '</span>';

    let actions = '';
    if (mode === 'member' && upcoming) {
      actions = '<div class="answer"><button type="button" class="btn yes ' + (r && r.reponse === 'oui' ? 'on' : '') + '" data-act="answer" data-id="' + esc(m.id) + '" data-r="oui" aria-pressed="' + !!(r && r.reponse === 'oui') + '">' + icon('check') + ' Je viens</button>' +
        '<button type="button" class="btn no ' + (r && r.reponse === 'non' ? 'on' : '') + '" data-act="answer" data-id="' + esc(m.id) + '" data-r="non" aria-pressed="' + !!(r && r.reponse === 'non') + '">' + icon('x') + ' Je ne viens pas</button></div>' +
        (r ? (r.commentaire ? '<div class="remark">« ' + esc(r.commentaire) + ' »</div>' : '') + '<button type="button" class="btn ghost sm" data-act="remark" data-id="' + esc(m.id) + '">' + icon('edit') + (r.commentaire ? ' Modifier la remarque' : ' Ajouter une remarque') + '</button>' : '');
    } else if (mode === 'admin') {
      actions = '<div class="page-head" style="margin:.6rem 0 0"><a class="btn sm" href="#/suivi/' + esc(m.id) + '">' + icon('clipboard') + (m.passee ? ' Pointage' : ' Suivi des réponses') + '</a>' +
        '<button type="button" class="btn sm secondary" data-act="edit" data-id="' + esc(m.id) + '">' + icon('edit') + ' Modifier</button></div>';
    } else if (mode === 'view') {
      actions = '<a class="btn sm secondary" href="#/suivi/' + esc(m.id) + '">' + icon('clipboard') + ' Voir le suivi</a>';
    }

    return '<article class="card meeting' + (cancelled ? ' cancelled' : '') + (toConfirm ? ' tobook' : '') + '">' +
      '<div class="date-badge" aria-hidden="true"><span class="d">' + b.d + '</span><span class="m">' + esc(b.m) + '</span></div>' +
      '<div style="min-width:0"><h3>' + esc(m.titre) + '</h3><div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.4rem">' + chips + '</div>' +
      '<div class="meta"><span>' + icon('calendar') + esc(fmtLong(m.date)) + '</span><span>' + icon('clock') + esc(fmtHeure(m.heure)) + '</span>' + (m.lieu ? '<span>' + icon('pin') + esc(m.lieu) + '</span>' : '') + '</div>' +
      (m.description ? '<p class="desc">' + esc(m.description) + '</p>' : '') +
      (cancelled ? '' : UI.progress(m.oui, m.non, m.attendus)) + actions + '</div></article>';
  }

  /* ================================================================ */
  /* Espace membre                                                     */
  /* ================================================================ */

  async function viewReunions(ctx) {
    let data = await API.call('meetings');
    if (ctx.stale()) return;
    let tab = 'avenir';

    function draw() {
      const list = tab === 'avenir' ? data.aVenir : data.passees;
      const aConfirmer = data.aVenir.filter(m => m.statut !== 'annulee' && !m.maReponse).length;
      paint(ctx,
        '<div class="page-head"><h1>Bonjour ' + esc(user.prenom) + '</h1></div>' +
        (data._offline ? '<div class="banner">Hors ligne : affichage de la dernière version enregistrée.</div>' : '') +
        (tab === 'avenir' && aConfirmer ? '<div class="banner"><strong>' + aConfirmer + ' réunion' + (aConfirmer > 1 ? 's' : '') + '</strong> en attente de votre réponse.</div>' : '') +
        '<div class="tabs" role="tablist"><button class="tab" role="tab" data-tab="avenir" aria-selected="' + (tab === 'avenir') + '">À venir (' + data.aVenir.length + ')</button>' +
        '<button class="tab" role="tab" data-tab="passees" aria-selected="' + (tab === 'passees') + '">Passées</button></div>' +
        (list.length ? list.map(m => meetingCard(m, 'member')).join('') : '<div class="card empty">' + (tab === 'avenir' ? 'Aucune réunion programmée pour le moment.' : 'Aucune réunion passée.') + '</div>'));
    }

    async function answer(id, rep, comment) {
      const m = data.aVenir.find(x => x.id === id);
      const commentaire = comment !== undefined ? comment : (m && m.maReponse ? m.maReponse.commentaire : '');
      const d = await API.call('respond', { reunionId: id, reponse: rep, commentaire: commentaire });
      data.aVenir = data.aVenir.map(x => (x.id === id ? d.reunion : x));
      draw();
      toast('Réponse enregistrée', 'ok');
    }

    ctx.el.onclick = async e => {
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; return draw(); }
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const id = a.dataset.id;
      try {
        if (a.dataset.act === 'answer') await withBusy(a, () => answer(id, a.dataset.r));
        if (a.dataset.act === 'remark') {
          const m = data.aVenir.find(x => x.id === id);
          const mod = modal('Remarque', '<form><div class="field"><label for="f-rem">Un mot pour le secrétariat (facultatif)</label><textarea id="f-rem" maxlength="200">' + esc(m.maReponse ? m.maReponse.commentaire : '') + '</textarea></div><div class="modal-actions"><button type="button" class="btn secondary" data-close>Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>');
          mod.el.querySelector('form').addEventListener('submit', async ev => {
            ev.preventDefault();
            try { await answer(id, m.maReponse.reponse, mod.el.querySelector('textarea').value); mod.close(); } catch (x) { toast(errMsg(x), 'err'); }
          });
        }
      } catch (x) { toast(errMsg(x), 'err'); }
    };
    draw();
  }

  /* ================================================================ */
  /* Profil                                                            */
  /* ================================================================ */

  async function viewProfil(ctx) {
    paint(ctx,
      '<div class="page-head"><h1>Mon profil</h1><div class="actions"><button class="btn secondary" data-act="logout">' + icon('logout') + ' Déconnexion</button></div></div>' +
      '<div class="card"><div style="display:flex;gap:.8rem;align-items:center;margin-bottom:1rem"><div class="avatar" style="width:52px;height:52px;font-size:1.1rem">' + esc(initials(user.prenom, user.nom)) + '</div><div><h2 style="margin:0">' + esc(user.prenom + ' ' + user.nom) + '</h2><span class="chip">' + ROLE_LABEL[user.role] + '</span> <span class="muted small">@' + esc(user.identifiant) + '</span></div></div>' +
      '<form id="profile-form"><div class="row2"><div class="field"><label for="p-email">E-mail (pour les rappels)</label><input id="p-email" name="email" type="email" autocomplete="email" value="' + esc(user.email) + '"></div>' +
      '<div class="field"><label for="p-tel">Téléphone</label><input id="p-tel" name="telephone" type="tel" autocomplete="tel" value="' + esc(user.telephone) + '"></div></div>' +
      '<button class="btn" type="submit">Enregistrer</button></form></div>' +
      '<div class="card"><h2>Changer de mot de passe</h2><form id="pwd-form">' +
      pwdField('ancien', 'Mot de passe actuel', 'current-password') + pwdField('nouveau', 'Nouveau mot de passe (8 caractères min.)', 'new-password') +
      '<button class="btn" type="submit">Modifier le mot de passe</button></form></div>' +
      '<div class="card"><h2>Application</h2>' +
      (isStandalone() ? '<p class="muted">RotaryConnect est installée sur cet appareil.</p>' :
        isIOS ? '<p>Pour l\'ajouter à votre écran d\'accueil : touchez <strong>Partager</strong> dans Safari, puis <strong>Sur l\'écran d\'accueil</strong>.</p>' :
          '<p class="muted">Installez RotaryConnect pour l\'ouvrir comme une application.</p><button class="btn secondary" data-install hidden>' + icon('download') + ' Installer l\'application</button>') +
      (API.demo ? '<p style="margin-top:1rem"><button class="btn danger sm" data-act="reset-demo">Réinitialiser les données de démo</button></p>' : '') + '</div>');
    refreshInstallUI();

    ctx.el.onsubmit = async e => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      try {
        if (form.id === 'profile-form') {
          const d = await withBusy(btn, () => API.call('profile.update', { email: fd.get('email'), telephone: fd.get('telephone') }));
          setUser(d.user);
          toast('Profil mis à jour', 'ok');
        } else {
          const d = await withBusy(btn, () => API.call('password.change', { ancien: fd.get('ancien'), nouveau: fd.get('nouveau') }));
          setUser(d.user, d.token);
          form.reset();
          toast('Mot de passe modifié', 'ok');
        }
      } catch (x) { toast(errMsg(x), 'err'); }
    };
    ctx.el.onclick = e => {
      const a = e.target.closest('[data-act]');
      if (a && a.dataset.act === 'reset-demo') { API.resetDemo(); location.reload(); }
    };
  }

  /* ================================================================ */
  /* Espace secrétaire                                                 */
  /* ================================================================ */

  function addDays(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function meetingForm(m) {
    const v = m || { titre: '', type: TYPES[0], date: addDays(7), heure: '19:30', lieu: '', description: '' };
    return '<form id="meeting-form" novalidate><div id="mf-err"></div>' +
      '<div class="field"><label for="m-titre">Titre</label><input id="m-titre" name="titre" maxlength="120" required value="' + esc(v.titre) + '"></div>' +
      '<div class="field"><label for="m-type">Type</label><select id="m-type" name="type">' + TYPES.map(t => '<option' + (t === v.type ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
      (TYPES.indexOf(v.type) < 0 ? '<option selected>' + esc(v.type) + '</option>' : '') + '</select></div>' +
      '<div class="row2"><div class="field"><label for="m-date">Date</label><input id="m-date" name="date" type="date" required value="' + esc(v.date) + '"></div>' +
      '<div class="field"><label for="m-heure">Heure</label><input id="m-heure" name="heure" type="time" required value="' + esc(v.heure) + '"></div></div>' +
      '<div class="field"><label for="m-lieu">Lieu</label><input id="m-lieu" name="lieu" maxlength="150" value="' + esc(v.lieu) + '"></div>' +
      '<div class="field"><label for="m-desc">Description</label><textarea id="m-desc" name="description" maxlength="1000">' + esc(v.description) + '</textarea></div>' +
      '<label class="check"><input type="checkbox" name="notifier"' + (m ? '' : ' checked') + '> Prévenir les membres par e-mail</label>' +
      '<div class="modal-actions">' +
      (m ? '<button type="button" class="btn danger" data-del>Supprimer</button><button type="button" class="btn secondary" data-cancel-meeting>' + (m.statut === 'annulee' ? 'Rétablir' : 'Annuler la réunion') + '</button>' : '') +
      '<button type="submit" class="btn">Enregistrer</button></div></form>';
  }

  function openMeetingModal(m, onDone) {
    const mod = modal(m ? 'Modifier la réunion' : 'Nouvelle réunion', meetingForm(m));
    const form = mod.el.querySelector('form');
    const save = async (statut, btn) => {
      const fd = new FormData(form);
      const reunion = { id: m ? m.id : undefined, titre: fd.get('titre'), type: fd.get('type'), date: fd.get('date'), heure: fd.get('heure'), lieu: fd.get('lieu'), description: fd.get('description'), statut: statut };
      try {
        const d = await withBusy(btn, () => API.call('meeting.save', { reunion: reunion, notifier: fd.get('notifier') === 'on' }));
        mod.close();
        toast((m ? 'Réunion mise à jour' : 'Réunion créée') + (d.notifies ? ' · ' + d.notifies + ' e-mail' + (d.notifies > 1 ? 's' : '') + ' envoyé' + (d.notifies > 1 ? 's' : '') : ''), 'ok');
        onDone();
      } catch (x) {
        mod.el.querySelector('#mf-err').innerHTML = '<div class="form-error" role="alert">' + esc(errMsg(x)) + '</div>';
      }
    };
    form.addEventListener('submit', e => { e.preventDefault(); save(m ? m.statut : undefined, form.querySelector('[type=submit]')); });
    if (m) {
      form.querySelector('[data-cancel-meeting]').addEventListener('click', ev => {
        if (!form.reportValidity()) return;
        save(m.statut === 'annulee' ? 'planifiee' : 'annulee', ev.currentTarget);
      });
      form.querySelector('[data-del]').addEventListener('click', async () => {
        if (!(await confirmDialog('Supprimer définitivement cette réunion, ses réponses et son pointage ?', { danger: true, okLabel: 'Supprimer' }))) return;
        try { await API.call('meeting.delete', { id: m.id }); mod.close(); toast('Réunion supprimée', 'ok'); onDone(); } catch (x) { toast(errMsg(x), 'err'); }
      });
    }
  }

  function openSettingsModal() {
    const c = config;
    const mod = modal('Réglages du club',
      '<form id="settings-form"><div id="st-err"></div>' +
      '<div class="field"><label for="s-nom">Nom du club</label><input id="s-nom" name="clubNom" required maxlength="80" value="' + esc(c.clubNom) + '"></div>' +
      '<label class="check"><input type="checkbox" name="relancesActives"' + (c.relancesActives ? ' checked' : '') + '> Relances automatiques des membres sans réponse</label>' +
      '<div class="row2"><div class="field"><label for="s-jours">Relancer à J-… (jours)</label><input id="s-jours" name="joursRelance" value="' + esc(c.joursRelance.join(', ')) + '" inputmode="numeric"><span class="hint">Ex. « 7, 2 » : un rappel 7 jours puis 2 jours avant.</span></div>' +
      '<div class="field"><label for="s-heure">Heure d\'envoi</label><input id="s-heure" name="heureRelance" type="number" min="0" max="23" value="' + c.heureRelance + '"><span class="hint">Heure (0–23) du déclencheur quotidien.</span></div></div>' +
      '<div class="modal-actions"><button type="button" class="btn secondary" data-close>Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>' +
      (API.demo ? '<div class="demo-box"><strong>Démo</strong> : en production un déclencheur Apps Script exécute la relance chaque jour.<div class="accts"><button type="button" class="btn sm secondary" data-demo-run>Lancer la relance maintenant</button><button type="button" class="btn sm secondary" data-demo-mails>Voir les e-mails simulés</button></div></div>' : ''));
    const form = mod.el.querySelector('form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        config = await withBusy(form.querySelector('[type=submit]'), () => API.call('config.save', { config: { clubNom: fd.get('clubNom'), relancesActives: fd.get('relancesActives') === 'on', joursRelance: fd.get('joursRelance'), heureRelance: fd.get('heureRelance') } }));
        mod.close();
        toast('Réglages enregistrés', 'ok');
        route();
      } catch (x) { mod.el.querySelector('#st-err').innerHTML = '<div class="form-error" role="alert">' + esc(errMsg(x)) + '</div>'; }
    });
    const run = mod.el.querySelector('[data-demo-run]');
    if (run) {
      run.addEventListener('click', async () => { const r = await API.demoRelances(); toast(r.envoyes + ' relance(s) simulée(s) envoyée(s)', 'ok'); });
      mod.el.querySelector('[data-demo-mails]').addEventListener('click', async () => {
        const mails = await API.demoMails();
        modal('E-mails simulés (' + mails.length + ')', mails.length ? '<div class="list">' + mails.slice(0, 40).map(m => '<div class="item"><div class="main"><div class="name">' + esc(m.subject) + '</div><div class="sub">' + esc(m.to) + ' · ' + esc(fmtDateTime(m.at)) + '</div></div></div>').join('') + '</div>' : '<p class="empty">Aucun e-mail envoyé.</p>');
      });
    }
  }

  async function viewSecretariat(ctx) {
    let data = await API.call('meetings');
    if (ctx.stale()) return;
    let tab = 'avenir';
    const find = id => data.aVenir.concat(data.passees).find(m => m.id === id);
    const refresh = async () => { data = await API.call('meetings'); if (!ctx.stale()) draw(); };

    function draw() {
      const list = tab === 'avenir' ? data.aVenir : data.passees;
      paint(ctx,
        '<div class="page-head"><h1>Secrétariat</h1><div class="actions"><button class="btn secondary" data-act="settings">' + icon('sliders') + ' Réglages</button><button class="btn" data-act="new">' + icon('plus') + ' Nouvelle réunion</button></div></div>' +
        '<div class="banner info">' + icon('bell') + ' ' + (config.relancesActives ? 'Relances automatiques actives : ' + (config.joursRelance.length ? 'rappel à J-' + config.joursRelance.join(', J-') + ' vers ' + config.heureRelance + ' h.' : 'aucun palier défini.') : 'Relances automatiques désactivées.') + '</div>' +
        '<div class="tabs" role="tablist"><button class="tab" role="tab" data-tab="avenir" aria-selected="' + (tab === 'avenir') + '">À venir (' + data.aVenir.length + ')</button><button class="tab" role="tab" data-tab="passees" aria-selected="' + (tab === 'passees') + '">Passées</button></div>' +
        (list.length ? list.map(m => meetingCard(m, 'admin')).join('') : '<div class="card empty">Aucune réunion. Créez la première avec « Nouvelle réunion ».</div>'));
    }

    ctx.el.onclick = e => {
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; return draw(); }
      const a = e.target.closest('[data-act]');
      if (!a) return;
      if (a.dataset.act === 'new') openMeetingModal(null, refresh);
      if (a.dataset.act === 'edit') openMeetingModal(find(a.dataset.id), refresh);
      if (a.dataset.act === 'settings') openSettingsModal();
    };
    draw();
  }

  /* ---------- Suivi des réponses + pointage ---------- */

  async function viewSuivi(ctx) {
    const data = await API.call('meeting.responses', { id: ctx.arg });
    if (ctx.stale()) return;
    const m = data.reunion;
    const canEdit = user.role === 'secretaire';
    const started = m.ts <= Date.now();
    const upcoming = !m.passee && m.statut !== 'annulee';
    const pres = {};
    data.membres.forEach(x => { pres[x.id] = x.presence; });
    let dirty = false;
    let filter = 'tous';
    const rows = data.membres;
    const cnt = { oui: rows.filter(x => x.reponse === 'oui').length, non: rows.filter(x => x.reponse === 'non').length };
    cnt.sans = rows.length - cnt.oui - cnt.non;

    const respChip = x => x.reponse === 'oui' ? '<span class="chip ok">Présent</span>' : x.reponse === 'non' ? '<span class="chip ko">Absent</span>' : '<span class="chip warn">Sans réponse</span>';
    const presChip = v => v === 'oui' ? '<span class="chip ok">Présent</span>' : v === 'non' ? '<span class="chip ko">Absent</span>' : '<span class="chip grey">Non pointé</span>';

    function rowHtml(x) {
      const sub = x.commentaire ? '« ' + esc(x.commentaire) + ' »' : (!x.reponse && x.derniereRelance ? 'Relancé le ' + esc(fmtDateTime(x.derniereRelance)) : (!x.email ? 'Pas d\'e-mail' : ''));
      let right;
      if (started && canEdit && m.statut !== 'annulee') {
        right = '<div style="text-align:right">' + (x.reponse ? '<div class="small muted" style="margin-bottom:.2rem">Avait répondu : ' + (x.reponse === 'oui' ? 'oui' : 'non') + '</div>' : '') +
          '<div class="seg" role="group" aria-label="Présence de ' + esc(x.prenom + ' ' + x.nom) + '"><button type="button" class="yes ' + (pres[x.id] === 'oui' ? 'on' : '') + '" data-act="pres" data-id="' + esc(x.id) + '" data-v="oui">Présent</button><button type="button" class="no ' + (pres[x.id] === 'non' ? 'on' : '') + '" data-act="pres" data-id="' + esc(x.id) + '" data-v="non">Absent</button></div></div>';
      } else if (started) {
        right = presChip(x.presence);
      } else {
        right = respChip(x);
      }
      return '<div class="item"><div class="avatar">' + esc(initials(x.prenom, x.nom)) + '</div><div class="main"><div class="name">' + esc(x.prenom + ' ' + x.nom) + '</div><div class="sub">' + sub + '</div></div>' + right + '</div>';
    }

    function drawList() {
      const list = rows.filter(x => filter === 'tous' || (filter === 'sans' ? !x.reponse : x.reponse === filter));
      document.getElementById('suivi-list').innerHTML = list.length ? list.map(rowHtml).join('') : '<div class="empty">Aucun membre dans cette catégorie.</div>';
      const save = document.getElementById('save-pres');
      if (save) save.disabled = !dirty;
      document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.filter === filter)));
    }

    const presents = rows.filter(x => x.presence === 'oui').length;
    const pointed = rows.filter(x => x.presence === 'oui' || x.presence === 'non').length;
    paint(ctx,
      '<div class="page-head"><a class="btn ghost sm" href="#/' + (user.role === 'president' ? 'dashboard' : 'secretariat') + '">' + icon('back') + ' Retour</a></div>' +
      meetingCard(m, 'none') +
      '<div class="tiles"><div class="tile ok"><div class="v">' + cnt.oui + '</div><div class="l">Confirmés</div></div><div class="tile ko"><div class="v">' + cnt.non + '</div><div class="l">Absents</div></div><div class="tile warn"><div class="v">' + cnt.sans + '</div><div class="l">Sans réponse</div></div>' +
      (pointed ? '<div class="tile"><div class="v">' + presents + '/' + pointed + '</div><div class="l">Présents (pointage)</div></div>' : '<div class="tile"><div class="v">' + UI.fmtPct(rows.length ? Math.round((cnt.oui + cnt.non) / rows.length * 100) : null) + '</div><div class="l">Taux de réponse</div></div>') + '</div>' +
      (canEdit && upcoming && cnt.sans > 0 ? '<div class="card flat" style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:200px"><strong>' + cnt.sans + ' membre' + (cnt.sans > 1 ? 's' : '') + ' sans réponse</strong><div class="small muted">Un rappel est aussi envoyé automatiquement selon vos réglages.</div></div><button class="btn" data-act="relance">' + icon('bell') + ' Relancer maintenant</button></div>' : '') +
      (canEdit && started && m.statut !== 'annulee' ? '<div class="banner info">Pointage : indiquez qui était présent à la réunion. Il alimente les statistiques du président.</div>' : '') +
      '<div class="tabs" role="tablist">' + [['tous', 'Tous'], ['sans', 'Sans réponse'], ['oui', 'Présents'], ['non', 'Absents']].map(f => '<button class="tab" role="tab" data-filter="' + f[0] + '" aria-selected="' + (f[0] === 'tous') + '">' + f[1] + '</button>').join('') + '</div>' +
      '<div class="list" id="suivi-list"></div>' +
      (canEdit && started && m.statut !== 'annulee' ? '<div class="sticky-bar"><button class="btn secondary" data-act="prefill">Pré-remplir</button><button class="btn" id="save-pres" data-act="save-pres" disabled>Enregistrer le pointage</button></div>' : ''));
    drawList();

    ctx.el.onclick = async e => {
      const f = e.target.closest('[data-filter]');
      if (f) { filter = f.dataset.filter; return drawList(); }
      const a = e.target.closest('[data-act]');
      if (!a) return;
      try {
        if (a.dataset.act === 'pres') {
          pres[a.dataset.id] = pres[a.dataset.id] === a.dataset.v ? '' : a.dataset.v;
          dirty = true;
          drawList();
        } else if (a.dataset.act === 'prefill') {
          rows.forEach(x => { if (!pres[x.id]) pres[x.id] = x.reponse === 'oui' ? 'oui' : 'non'; });
          dirty = true;
          drawList();
        } else if (a.dataset.act === 'save-pres') {
          await withBusy(a, () => API.call('meeting.attendance', { id: m.id, presences: pres }));
          toast('Pointage enregistré', 'ok');
          route();
        } else if (a.dataset.act === 'relance') {
          if (!(await confirmDialog('Envoyer un e-mail de rappel aux ' + cnt.sans + ' membres sans réponse ?', { okLabel: 'Envoyer' }))) return;
          const r = await withBusy(a, () => API.call('relance.send', { id: m.id }));
          toast(r.envoyes + ' relance' + (r.envoyes > 1 ? 's' : '') + ' envoyée' + (r.envoyes > 1 ? 's' : '') + (r.sansEmail ? ' · ' + r.sansEmail + ' sans e-mail' : ''), 'ok');
          route();
        }
      } catch (x) { toast(errMsg(x), 'err'); }
    };
  }

  /* ---------- Membres ---------- */

  function secretModal(title, ident, pwd, emailEnvoye) {
    const mod = modal(title,
      '<p>Transmettez ces identifiants au membre. Il devra choisir un nouveau mot de passe à sa première connexion.</p>' +
      '<p class="small muted">Identifiant</p><div class="secret" style="font-size:1.05rem">' + esc(ident) + '</div>' +
      '<p class="small muted" style="margin-top:.6rem">Mot de passe provisoire</p><div class="secret">' + esc(pwd) + '</div>' +
      (emailEnvoye ? '<p class="small" style="margin-top:.6rem">' + icon('mail') + ' Un e-mail lui a été envoyé.</p>' : '') +
      '<div class="modal-actions"><button class="btn secondary" data-copy>Copier</button><button class="btn" data-close>Terminé</button></div>', { noFocus: true });
    mod.el.querySelector('[data-copy]').addEventListener('click', () => {
      const txt = 'Identifiant : ' + ident + '\nMot de passe provisoire : ' + pwd;
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Copié', 'ok'), () => toast('Copie impossible : sélectionnez le texte.', 'err'));
    });
  }

  function openMemberModal(m, onDone) {
    const self = m && m.id === user.id;
    const v = m || { prenom: '', nom: '', identifiant: '', email: '', telephone: '', role: 'membre', actif: true };
    const mod = modal(m ? 'Modifier le membre' : 'Nouveau membre',
      '<form id="member-form" novalidate><div id="mb-err"></div>' +
      '<div class="row2"><div class="field"><label for="b-prenom">Prénom</label><input id="b-prenom" name="prenom" required maxlength="60" value="' + esc(v.prenom) + '"></div>' +
      '<div class="field"><label for="b-nom">Nom</label><input id="b-nom" name="nom" required maxlength="60" value="' + esc(v.nom) + '"></div></div>' +
      '<div class="field"><label for="b-ident">Identifiant</label><input id="b-ident" name="identifiant" maxlength="30" autocapitalize="none" value="' + esc(v.identifiant) + '" placeholder="Généré automatiquement"><span class="hint">3 à 30 caractères : lettres, chiffres, point, tiret.</span></div>' +
      '<div class="row2"><div class="field"><label for="b-email">E-mail</label><input id="b-email" name="email" type="email" maxlength="120" value="' + esc(v.email) + '"></div>' +
      '<div class="field"><label for="b-tel">Téléphone</label><input id="b-tel" name="telephone" type="tel" maxlength="30" value="' + esc(v.telephone) + '"></div></div>' +
      '<div class="field"><label for="b-role">Rôle</label><select id="b-role" name="role"' + (self ? ' disabled' : '') + '>' + Object.keys(ROLE_LABEL).map(r => '<option value="' + r + '"' + (r === v.role ? ' selected' : '') + '>' + ROLE_LABEL[r] + '</option>').join('') + '</select></div>' +
      '<label class="check"><input type="checkbox" name="actif"' + (v.actif ? ' checked' : '') + (self ? ' disabled' : '') + '> Membre actif (reçoit les relances, peut se connecter)</label>' +
      (m ? '' : '<label class="check"><input type="checkbox" name="envoyerEmail" checked> Envoyer les identifiants par e-mail</label>') +
      '<div class="modal-actions">' + (m ? '<button type="button" class="btn secondary" data-reset>' + icon('key') + ' Réinitialiser le mot de passe</button>' : '') +
      '<button type="submit" class="btn">Enregistrer</button></div></form>');
    const form = mod.el.querySelector('form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const membre = { id: m ? m.id : undefined, prenom: fd.get('prenom'), nom: fd.get('nom'), identifiant: fd.get('identifiant'), email: fd.get('email'), telephone: fd.get('telephone'), role: self ? m.role : fd.get('role'), actif: self ? true : fd.get('actif') === 'on', envoyerEmail: fd.get('envoyerEmail') === 'on' };
      try {
        const d = await withBusy(form.querySelector('[type=submit]'), () => API.call('member.save', { membre: membre }));
        mod.close();
        if (d.motDePasseTemporaire) secretModal('Membre créé', d.membre.identifiant, d.motDePasseTemporaire, d.emailEnvoye);
        else toast('Membre mis à jour', 'ok');
        onDone();
      } catch (x) { mod.el.querySelector('#mb-err').innerHTML = '<div class="form-error" role="alert">' + esc(errMsg(x)) + '</div>'; }
    });
    const reset = form.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', async () => {
      if (!(await confirmDialog('Générer un nouveau mot de passe provisoire pour ' + m.prenom + ' ' + m.nom + ' ? L\'ancien ne fonctionnera plus.', { okLabel: 'Réinitialiser' }))) return;
      try {
        const d = await API.call('member.resetPassword', { id: m.id, envoyerEmail: !!m.email });
        mod.close();
        secretModal('Mot de passe réinitialisé', m.identifiant, d.motDePasseTemporaire, d.emailEnvoye);
      } catch (x) { toast(errMsg(x), 'err'); }
    });
  }

  async function viewMembres(ctx) {
    let membres = (await API.call('members.list')).membres;
    if (ctx.stale()) return;
    let q = '';
    const refresh = async () => { membres = (await API.call('members.list')).membres; if (!ctx.stale()) drawList(); };

    function drawList() {
      const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const list = membres.filter(m => !q || norm(m.prenom + ' ' + m.nom + ' ' + m.identifiant + ' ' + m.email).indexOf(norm(q)) >= 0);
      document.getElementById('members-count').textContent = membres.filter(m => m.actif).length + ' actifs · ' + membres.length + ' au total';
      document.getElementById('members-list').innerHTML = list.length ? list.map(m =>
        '<div class="item clickable" data-id="' + esc(m.id) + '" tabindex="0" role="button" aria-label="Modifier ' + esc(m.prenom + ' ' + m.nom) + '"><div class="avatar">' + esc(initials(m.prenom, m.nom)) + '</div><div class="main"><div class="name">' + esc(m.prenom + ' ' + m.nom) + '</div><div class="sub">@' + esc(m.identifiant) + (m.email ? ' · ' + esc(m.email) : ' · pas d\'e-mail') + '</div></div>' +
        (m.role !== 'membre' ? '<span class="chip">' + ROLE_LABEL[m.role] + '</span>' : '') + (m.actif ? '' : '<span class="chip grey">Inactif</span>') + '</div>').join('') : '<div class="empty">Aucun membre trouvé.</div>';
    }

    paint(ctx,
      '<div class="page-head"><h1>Membres</h1><div class="actions"><button class="btn" data-act="new">' + icon('plus') + ' Ajouter un membre</button></div></div>' +
      '<div class="field"><label class="sr-only" for="q">Rechercher</label><input id="q" type="search" placeholder="Rechercher un membre…" autocomplete="off"></div>' +
      '<p class="muted small" id="members-count"></p><div class="list" id="members-list"></div>');
    drawList();

    ctx.el.oninput = e => { if (e.target.id === 'q') { q = e.target.value; drawList(); } };
    const open = el => {
      const it = el.closest('.item[data-id]');
      if (it) openMemberModal(membres.find(m => m.id === it.dataset.id), refresh);
    };
    ctx.el.onclick = e => {
      if (e.target.closest('[data-act=new]')) return openMemberModal(null, refresh);
      open(e.target);
    };
    ctx.el.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.item[data-id]')) { e.preventDefault(); open(e.target); } };
  }

  /* ================================================================ */
  /* Espace président                                                  */
  /* ================================================================ */

  function tile(v, label, cls) {
    return '<div class="tile ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + esc(label) + '</div></div>';
  }

  const rateTile = v => (v === null ? '' : v >= 75 ? 'ok' : v >= 50 ? 'warn' : 'ko');

  async function viewDashboard(ctx) {
    const s = await API.call('stats');
    if (ctx.stale()) return;
    const k = s.kpis;
    const n = s.prochaine;
    const pointees = s.parReunion.filter(r => r.pointee).slice(-8);

    paint(ctx,
      '<div class="page-head"><div><h1>Tableau de bord</h1><div class="muted small">Année rotarienne ' + esc(s.libelle) + '</div></div><div class="actions"><a class="btn secondary" href="#/stats">' + icon('chart') + ' Statistiques détaillées</a></div></div>' +
      '<div class="tiles">' + tile(k.membresActifs, 'Membres actifs') + tile(UI.fmtPct(k.tauxPresence), 'Présence moyenne', rateTile(k.tauxPresence)) + tile(k.reunionsPointees + ' / ' + k.reunions, 'Réunions pointées') + tile(UI.fmtPct(k.tauxReponseProchaine), 'Réponses prochaine réunion', rateTile(k.tauxReponseProchaine)) + '</div>' +
      (s.enRisque ? '<div class="banner"><strong>' + s.enRisque + ' membre' + (s.enRisque > 1 ? 's' : '') + '</strong> sous les 50 % de présence. <a href="#/stats">Voir le détail</a></div>' : '') +
      '<div class="grid cols2">' +
      '<section class="card"><h2>Prochaine réunion</h2>' + (n ?
        '<div class="next-card"><div class="donut" style="--y:' + (n.oui / Math.max(1, k.membresActifs) * 100) + ';--n:' + (n.non / Math.max(1, k.membresActifs) * 100) + '"><span>' + UI.fmtPct(n.tauxReponse).replace(' %', '%') + '</span></div>' +
        '<div style="flex:1;min-width:160px"><strong>' + esc(n.titre) + '</strong><div class="muted small">' + esc(fmtLong(n.date)) + ' · ' + esc(fmtHeure(n.heure)) + '</div>' +
        '<div class="legend" style="margin:.6rem 0"><span><i class="dot y"></i><b>' + n.oui + '</b> présents</span><span><i class="dot n"></i><b>' + n.non + '</b> absents</span><span><i class="dot s"></i><b>' + n.sans + '</b> sans réponse</span></div>' +
        '<a class="btn sm" href="#/suivi/' + esc(n.id) + '">' + icon('clipboard') + ' Voir le suivi</a></div></div>' : '<p class="muted">Aucune réunion à venir.</p>') + '</section>' +
      '<section class="card"><h2>Réunions à venir</h2>' + (s.aVenir.length ? '<div class="list" style="box-shadow:none">' + s.aVenir.map(r =>
        '<a class="item clickable" style="text-decoration:none;color:inherit" href="#/suivi/' + esc(r.id) + '"><div class="main"><div class="name">' + esc(r.titre) + '</div><div class="sub">' + esc(fmtShort(r.date)) + ' · ' + esc(fmtHeure(r.heure)) + ' · ' + r.oui + ' oui / ' + r.non + ' non</div></div><div style="width:70px">' + UI.hbar(r.tauxReponse) + '</div></a>').join('') + '</div>' : '<p class="muted">Rien de programmé.</p>') + '</section></div>' +
      '<section class="card"><h2>Participation aux dernières réunions</h2>' + UI.bars(pointees.map(r => ({ label: fmtShort(r.date), value: r.tauxPresence, title: r.titre + ' : ' + r.presents + '/' + r.pointes })), 'Taux de présence par réunion') + '</section>');
  }

  async function viewStats(ctx) {
    let annee = null;
    let sort = { key: 'tauxPresence', dir: -1 };
    let s = await API.call('stats');
    if (ctx.stale()) return;

    const cols = [['nom', 'Membre'], ['pointees', 'Pointées', 1], ['presents', 'Présences', 1], ['tauxPresence', 'Présence', 1], ['tauxReponse', 'Réponses', 1], ['dernierePresence', 'Dernière présence']];

    function table() {
      const rows = s.parMembre.slice().sort((a, b) => {
        const va = sort.key === 'nom' ? (a.nom + a.prenom).toLowerCase() : a[sort.key];
        const vb = sort.key === 'nom' ? (b.nom + b.prenom).toLowerCase() : b[sort.key];
        if (va === vb) return 0;
        if (va === null || va === '') return 1;
        if (vb === null || vb === '') return -1;
        return (va < vb ? -1 : 1) * sort.dir;
      });
      return '<div class="table-wrap"><table class="t"><thead><tr>' + cols.map(c => '<th class="' + (c[2] ? 'num' : '') + '" data-sort="' + c[0] + '" aria-sort="' + (sort.key === c[0] ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + c[1] + (sort.key === c[0] ? (sort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map(m => '<tr><td>' + esc(m.prenom + ' ' + m.nom) + '</td><td class="num">' + m.pointees + '</td><td class="num">' + m.presents + '</td><td class="num"><div style="display:flex;gap:.5rem;align-items:center;justify-content:flex-end"><div style="width:70px">' + UI.hbar(m.tauxPresence) + '</div>' + UI.fmtPct(m.tauxPresence) + '</div></td><td class="num">' + UI.fmtPct(m.tauxReponse) + '</td><td>' + (m.dernierePresence ? esc(fmtShort(m.dernierePresence)) : '–') + '</td></tr>').join('') + '</tbody></table></div>';
    }

    function draw() {
      const k = s.kpis;
      const pointees = s.parReunion.filter(r => r.pointee);
      paint(ctx,
        '<div class="page-head"><h1>Statistiques de participation</h1><div class="actions"><label class="sr-only" for="annee">Année rotarienne</label><select id="annee" class="btn secondary" style="min-height:44px">' + s.annees.map(a => '<option value="' + a + '"' + (a === s.annee ? ' selected' : '') + '>' + a + '-' + (a + 1) + '</option>').join('') + '</select>' +
        '<button class="btn secondary" data-act="csv">' + icon('download') + ' Export CSV</button></div></div>' +
        '<div class="tiles">' + tile(UI.fmtPct(k.tauxPresence), 'Présence moyenne', rateTile(k.tauxPresence)) + tile(k.reunionsPointees + ' / ' + k.reunions, 'Réunions pointées') + tile(k.membresActifs, 'Membres actifs') + tile(s.enRisque, 'Membres < 50 % présence', s.enRisque ? 'ko' : 'ok') + '</div>' +
        '<section class="card"><h2>Présence par réunion</h2>' + UI.bars(pointees.map(r => ({ label: fmtShort(r.date), value: r.tauxPresence, title: r.titre + ' : ' + r.presents + '/' + r.pointes + ' présents' })), 'Taux de présence par réunion') + '</section>' +
        '<div class="grid cols2"><section class="card"><h2>Évolution mensuelle</h2>' + UI.bars(s.parMois.map(x => ({ label: UI.monthLabel(x.mois), value: x.tauxPresence, cls: 'gold', title: x.mois })), 'Présence par mois') + '</section>' +
        '<section class="card"><h2>Taux de réponse par réunion</h2>' + UI.bars(s.parReunion.filter(r => !r.passee || r.oui + r.non > 0).map(r => ({ label: fmtShort(r.date), value: r.tauxReponse, cls: 'gold', title: r.titre })), 'Taux de réponse') + '</section></div>' +
        '<section class="card"><h2>Participation par membre</h2>' + (s.parMembre.length ? table() : '<p class="empty">Aucun membre actif.</p>') + '</section>');
    }

    function csv() {
      const head = ['Nom', 'Prénom', 'Réunions pointées', 'Présences', 'Taux présence (%)', 'Taux réponse (%)', 'Dernière présence'];
      const lines = s.parMembre.map(m => [m.nom, m.prenom, m.pointees, m.presents, m.tauxPresence === null ? '' : String(m.tauxPresence).replace('.', ','), m.tauxReponse === null ? '' : String(m.tauxReponse).replace('.', ','), m.dernierePresence]);
      const txt = '\ufeff' + [head].concat(lines).map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
      a.download = 'participation-' + s.libelle + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    ctx.el.onchange = async e => {
      if (e.target.id !== 'annee') return;
      try { annee = e.target.value; s = await API.call('stats', { annee: annee }); if (!ctx.stale()) draw(); } catch (x) { toast(errMsg(x), 'err'); }
    };
    ctx.el.onclick = e => {
      const th = e.target.closest('[data-sort]');
      if (th) {
        sort = { key: th.dataset.sort, dir: sort.key === th.dataset.sort ? -sort.dir : (th.dataset.sort === 'nom' ? 1 : -1) };
        return draw();
      }
      if (e.target.closest('[data-act=csv]')) csv();
    };
    draw();
  }

  /* ================================================================ */
  /* Installation PWA, démarrage                                       */
  /* ================================================================ */

  function refreshInstallUI() {
    document.querySelectorAll('[data-install]').forEach(b => { b.hidden = !deferredPrompt || isStandalone(); });
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    refreshInstallUI();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; refreshInstallUI(); toast('Application installée', 'ok'); });

  document.addEventListener('click', async e => {
    const t = e.target;
    const pw = t.closest('[data-toggle-pwd]');
    if (pw) {
      const input = pw.parentElement.querySelector('input');
      input.type = input.type === 'password' ? 'text' : 'password';
    }
    if (t.closest('[data-act=logout]')) logout();
    if (t.closest('[data-install]') && deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      refreshInstallUI();
    }
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('rc:logout', () => {
    user = null;
    showLogin('Votre session a expiré. Veuillez vous reconnecter.');
  });

  async function boot() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* hors ligne indisponible */ });
    }
    user = API.getUser();
    if (user) {
      try {
        const d = await API.call('me');
        setUser(d.user);
        config = d.config;
      } catch (e) {
        if (!e.offline) user = null;
      }
    }
    route();
  }

  boot();
})();
