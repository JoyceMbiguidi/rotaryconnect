/**
 * RotaryConnect – API Google Apps Script (runtime V8)
 *
 * Déploiement : Extensions > Apps Script dans le Google Sheet, coller ce fichier,
 * exécuter setup() une fois, puis Déployer > Application Web
 * (Exécuter en tant que : moi / Accès : tout le monde).
 * Toutes les requêtes sont des POST JSON (Content-Type: text/plain pour éviter le préflight CORS).
 */

const VERSION = '1.0.0';
const TOKEN_TTL_S = 7 * 24 * 3600;
const HASH_ITER = 300;
const MAX_ECHECS = 5;
const BLOCAGE_S = 900;
const DUREE_REUNION_MS = 2 * 3600 * 1000;
const ROLES = ['membre', 'secretaire', 'president'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDENT_RE = /^[a-z0-9._-]{3,30}$/;

const SHEETS = {
  MEMBRES: { name: 'Membres', headers: ['id', 'identifiant', 'nom', 'prenom', 'email', 'telephone', 'role', 'actif', 'hash', 'salt', 'doitChangerMdp', 'creeLe'] },
  REUNIONS: { name: 'Reunions', headers: ['id', 'titre', 'type', 'date', 'heure', 'lieu', 'description', 'statut', 'creeLe', 'creePar'] },
  REPONSES: { name: 'Reponses', headers: ['reunionId', 'membreId', 'reponse', 'commentaire', 'repondueLe', 'presence'] },
  RELANCES: { name: 'Relances', headers: ['reunionId', 'membreId', 'etape', 'envoyeLe', 'email'] },
  CONFIG: { name: 'Config', headers: ['cle', 'valeur'] }
};

const DEFAULT_CONFIG = {
  CLUB_NOM: 'Rotary Club Reims',
  URL_APP: '',
  RELANCES_ACTIVES: 'oui',
  JOURS_RELANCE: '7,2',
  HEURE_RELANCE: '9'
};

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail_(code, message) {
  throw new ApiError(code, message);
}

/* ------------------------------------------------------------------ */
/* Point d'entrée HTTP                                                  */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, data: { name: 'RotaryConnect API', version: VERSION } });
}

function doPost(e) {
  let res;
  try {
    let req;
    try {
      req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (x) {
      fail_('requete_invalide', 'Requête invalide.');
    }
    res = { ok: true, data: dispatch_(req) };
  } catch (err) {
    if (err instanceof ApiError) {
      res = { ok: false, code: err.code, error: err.message };
    } else {
      console.error(err && err.stack ? err.stack : err);
      res = { ok: false, code: 'erreur_serveur', error: 'Erreur serveur.' };
    }
  }
  return json_(res);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

const ALL = ROLES;
const SEC = ['secretaire'];
const SEC_PRES = ['secretaire', 'president'];
const PRES = ['president'];

const ACTIONS = {
  'login': { fn: actLogin_ },
  'me': { roles: ALL, fn: (req, u) => ({ user: memberDto_(u), config: publicConfig_() }) },
  'config.get': { roles: ALL, fn: () => publicConfig_() },
  'config.save': { roles: SEC, write: true, fn: actConfigSave_ },
  'password.change': { roles: ALL, write: true, fn: actPasswordChange_ },
  'profile.update': { roles: ALL, write: true, fn: actProfileUpdate_ },
  'meetings': { roles: ALL, fn: actMeetings_ },
  'respond': { roles: ALL, write: true, fn: actRespond_ },
  'meeting.save': { roles: SEC, write: true, fn: actMeetingSave_ },
  'meeting.delete': { roles: SEC, write: true, fn: actMeetingDelete_ },
  'meeting.responses': { roles: SEC_PRES, fn: actMeetingResponses_ },
  'meeting.attendance': { roles: SEC, write: true, fn: actMeetingAttendance_ },
  'relance.send': { roles: SEC, write: true, fn: actRelanceSend_ },
  'members.list': { roles: SEC, fn: actMembersList_ },
  'member.save': { roles: SEC, write: true, fn: actMemberSave_ },
  'member.resetPassword': { roles: SEC, write: true, fn: actMemberReset_ },
  'stats': { roles: PRES, fn: actStats_ }
};

function dispatch_(req) {
  const a = ACTIONS[req.action];
  if (!a) fail_('action_inconnue', 'Action inconnue.');
  let user = null;
  if (a.roles) {
    user = authenticate_(req.token);
    if (a.roles.indexOf(user.role) < 0) fail_('interdit', 'Accès refusé.');
  }
  if (!a.write) return a.fn(req, user);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return a.fn(req, user);
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Accès au classeur                                                    */
/* ------------------------------------------------------------------ */

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(def) {
  const s = ss_().getSheetByName(def.name);
  if (!s) fail_('non_initialise', 'Base non initialisée : exécutez setup() dans Apps Script.');
  return s;
}

function norm_(h, v) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone();
    if (h === 'date') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    if (h === 'heure') return Utilities.formatDate(v, tz, 'HH:mm');
    return Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (typeof v === 'number') return String(v);
  return v;
}

function readTable_(def) {
  const s = sheet_(def);
  const last = s.getLastRow();
  if (last < 2) return [];
  const vals = s.getRange(2, 1, last - 1, def.headers.length).getValues();
  const out = [];
  vals.forEach((row, i) => {
    if (row[0] === '' || row[0] === null) return;
    const o = { _row: i + 2 };
    def.headers.forEach((h, j) => { o[h] = norm_(h, row[j]); });
    out.push(o);
  });
  return out;
}

function toRow_(def, obj) {
  return def.headers.map(h => (obj[h] === undefined || obj[h] === null ? '' : obj[h]));
}

function ensureRows_(s, def, needed) {
  const max = s.getMaxRows();
  if (needed <= max) return;
  const extra = needed - max + 200;
  s.insertRowsAfter(max, extra);
  s.getRange(max + 1, 1, extra, def.headers.length).setNumberFormat('@');
}

function appendRows_(def, objs) {
  if (!objs.length) return;
  const s = sheet_(def);
  const start = s.getLastRow() + 1;
  ensureRows_(s, def, start + objs.length - 1);
  s.getRange(start, 1, objs.length, def.headers.length).setValues(objs.map(o => toRow_(def, o)));
}

function writeRow_(def, rowIndex, obj) {
  sheet_(def).getRange(rowIndex, 1, 1, def.headers.length).setValues([toRow_(def, obj)]);
}

function rewriteTable_(def, objs) {
  const s = sheet_(def);
  const last = s.getLastRow();
  if (last >= 2) s.getRange(2, 1, last - 1, def.headers.length).clearContent();
  appendRows_(def, objs);
}

function upsertReponses_(changes) {
  const def = SHEETS.REPONSES;
  const s = sheet_(def);
  const n = def.headers.length;
  const last = s.getLastRow();
  const rows = last >= 2 ? s.getRange(2, 1, last - 1, n).getValues() : [];
  const idx = {};
  rows.forEach((r, i) => { idx[r[0] + '|' + r[1]] = i; });
  changes.forEach(c => {
    const k = c.reunionId + '|' + c.membreId;
    let r;
    if (k in idx) {
      r = rows[idx[k]];
    } else {
      r = [c.reunionId, c.membreId, '', '', '', ''];
      idx[k] = rows.length;
      rows.push(r);
    }
    def.headers.forEach((h, j) => { if (h in c.fields) r[j] = c.fields[h]; });
  });
  if (rows.length) {
    ensureRows_(s, def, rows.length + 1);
    s.getRange(2, 1, rows.length, n).setValues(rows);
  }
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                          */
/* ------------------------------------------------------------------ */

function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function clean_(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);
}

function isTrue_(v) {
  return v === true || /^(oui|true|1|vrai|yes)$/i.test(String(v).trim());
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toHex_(bytes) {
  return bytes.map(b => ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2)).join('');
}

function safeEq_(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function dateStr_(d) {
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}

function dayNum_(s) {
  const p = s.split('-').map(Number);
  return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
}

function meetingTs_(date, heure) {
  const d = String(date).split('-').map(Number);
  const h = String(heure || '00:00').split(':').map(Number);
  return new Date(d[0], d[1] - 1, d[2], h[0] || 0, h[1] || 0).getTime();
}

function dateFr_(date) {
  const p = date.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return JOURS[d.getDay()] + ' ' + p[2] + (p[2] === 1 ? 'er ' : ' ') + MOIS[p[1] - 1] + ' ' + p[0];
}

function heureFr_(h) {
  return String(h).replace(':', 'h');
}

function randomPwd_() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  let out = '';
  for (let i = 0; i < 10; i++) out += alpha.charAt(parseInt(hex.substr(i * 2, 2), 16) % alpha.length);
  return out;
}

function nowIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

/* ------------------------------------------------------------------ */
/* Configuration                                                        */
/* ------------------------------------------------------------------ */

function getConfig_() {
  const cfg = Object.assign({}, DEFAULT_CONFIG);
  readTable_(SHEETS.CONFIG).forEach(r => { cfg[r.cle] = String(r.valeur); });
  return cfg;
}

function parseEtapes_(s) {
  const set = {};
  String(s || '').split(/[,;\s]+/).forEach(x => {
    const n = parseInt(x, 10);
    if (n >= 0 && n <= 60) set[n] = true;
  });
  return Object.keys(set).map(Number).sort((a, b) => a - b);
}

function publicConfig_() {
  const c = getConfig_();
  return {
    clubNom: c.CLUB_NOM,
    relancesActives: c.RELANCES_ACTIVES !== 'non',
    joursRelance: parseEtapes_(c.JOURS_RELANCE),
    heureRelance: Number(c.HEURE_RELANCE) || 9
  };
}

function setConfigValue_(cle, valeur) {
  const rows = readTable_(SHEETS.CONFIG);
  const r = rows.find(x => x.cle === cle);
  if (r) writeRow_(SHEETS.CONFIG, r._row, { cle: cle, valeur: String(valeur) });
  else appendRows_(SHEETS.CONFIG, [{ cle: cle, valeur: String(valeur) }]);
}

function actConfigSave_(req) {
  const d = req.config || {};
  const etapes = parseEtapes_(Array.isArray(d.joursRelance) ? d.joursRelance.join(',') : d.joursRelance);
  const nom = clean_(d.clubNom, 80);
  const heure = Math.min(23, Math.max(0, parseInt(d.heureRelance, 10) || 9));
  if (!nom) fail_('donnees_invalides', 'Le nom du club est obligatoire.');
  const ancienne = Number(getConfig_().HEURE_RELANCE);
  setConfigValue_('CLUB_NOM', nom);
  setConfigValue_('RELANCES_ACTIVES', d.relancesActives === false ? 'non' : 'oui');
  setConfigValue_('JOURS_RELANCE', etapes.join(','));
  setConfigValue_('HEURE_RELANCE', heure);
  if (ancienne !== heure) installerDeclencheurs();
  return publicConfig_();
}

/* ------------------------------------------------------------------ */
/* Authentification                                                     */
/* ------------------------------------------------------------------ */

function hashPwd_(pwd, salt) {
  let h = salt + ':' + pwd;
  for (let i = 0; i < HASH_ITER; i++) {
    h = toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  }
  return h;
}

function secret_() {
  const s = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!s) fail_('non_initialise', 'Base non initialisée : exécutez setup() dans Apps Script.');
  return s;
}

function sign_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_()));
}

function makeToken_(m) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({
    u: m.id,
    e: Math.floor(Date.now() / 1000) + TOKEN_TTL_S,
    v: String(m.hash).slice(0, 8)
  }));
  return payload + '.' + sign_(payload);
}

function authenticate_(token) {
  const expired = () => fail_('session_expiree', 'Session expirée, veuillez vous reconnecter.');
  const parts = String(token || '').split('.');
  if (parts.length !== 2) expired();
  if (!safeEq_(sign_(parts[0]), parts[1])) expired();
  let p;
  try {
    p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (x) {
    expired();
  }
  if (!p || p.e < Date.now() / 1000) expired();
  const m = readTable_(SHEETS.MEMBRES).find(x => x.id === p.u);
  if (!m || !isTrue_(m.actif) || String(m.hash).slice(0, 8) !== p.v) expired();
  return m;
}

function actLogin_(req) {
  const ident = String(req.identifiant || '').trim().toLowerCase();
  const pwd = String(req.motDePasse || '');
  const bad = () => fail_('identifiants_invalides', 'Identifiant ou mot de passe incorrect.');
  if (!ident || !pwd || ident.length > 60 || pwd.length > 200) bad();
  const cache = CacheService.getScriptCache();
  const key = 'fail_' + ident.replace(/[^a-z0-9._-]/g, '_');
  const nb = Number(cache.get(key) || 0);
  if (nb >= MAX_ECHECS) fail_('trop_de_tentatives', 'Trop de tentatives. Réessayez dans 15 minutes.');
  const m = readTable_(SHEETS.MEMBRES).find(x => String(x.identifiant).toLowerCase() === ident);
  const ok = m && isTrue_(m.actif) && safeEq_(hashPwd_(pwd, m.salt), m.hash);
  if (!ok) {
    cache.put(key, String(nb + 1), BLOCAGE_S);
    bad();
  }
  cache.remove(key);
  return { token: makeToken_(m), user: memberDto_(m), config: publicConfig_() };
}

function setPassword_(m, pwd, doitChanger) {
  m.salt = Utilities.getUuid();
  m.hash = hashPwd_(pwd, m.salt);
  m.doitChangerMdp = doitChanger ? 'oui' : 'non';
  writeRow_(SHEETS.MEMBRES, m._row, m);
}

function actPasswordChange_(req, user) {
  const ancien = String(req.ancien || '');
  const nouveau = String(req.nouveau || '');
  if (!safeEq_(hashPwd_(ancien, user.salt), user.hash)) fail_('identifiants_invalides', 'Mot de passe actuel incorrect.');
  if (nouveau.length < 8 || nouveau.length > 100) fail_('donnees_invalides', 'Le nouveau mot de passe doit contenir au moins 8 caractères.');
  if (nouveau === ancien) fail_('donnees_invalides', 'Le nouveau mot de passe doit être différent de l\'ancien.');
  setPassword_(user, nouveau, false);
  return { token: makeToken_(user), user: memberDto_(user) };
}

function actProfileUpdate_(req, user) {
  const email = clean_(req.email, 120).toLowerCase();
  const tel = clean_(req.telephone, 30);
  if (email && !EMAIL_RE.test(email)) fail_('donnees_invalides', 'Adresse e-mail invalide.');
  user.email = email;
  user.telephone = tel;
  writeRow_(SHEETS.MEMBRES, user._row, user);
  return { user: memberDto_(user) };
}

/* ------------------------------------------------------------------ */
/* DTO                                                                  */
/* ------------------------------------------------------------------ */

function memberDto_(m) {
  return {
    id: m.id,
    identifiant: m.identifiant,
    nom: m.nom,
    prenom: m.prenom,
    email: m.email,
    telephone: m.telephone,
    role: m.role,
    actif: isTrue_(m.actif),
    doitChangerMdp: isTrue_(m.doitChangerMdp)
  };
}

function meetingDto_(m, reps, nbActifs, userId) {
  const ts = meetingTs_(m.date, m.heure);
  const mine = userId ? reps.find(r => r.membreId === userId) : null;
  return {
    id: m.id,
    titre: m.titre,
    type: m.type,
    date: m.date,
    heure: m.heure,
    lieu: m.lieu,
    description: m.description,
    statut: m.statut,
    ts: ts,
    passee: ts + DUREE_REUNION_MS < Date.now(),
    oui: reps.filter(r => r.reponse === 'oui').length,
    non: reps.filter(r => r.reponse === 'non').length,
    attendus: nbActifs,
    maReponse: mine && mine.reponse ? { reponse: mine.reponse, commentaire: mine.commentaire } : null
  };
}

function groupReponses_() {
  const g = {};
  readTable_(SHEETS.REPONSES).forEach(r => { (g[r.reunionId] = g[r.reunionId] || []).push(r); });
  return g;
}

function findMeeting_(id) {
  const m = readTable_(SHEETS.REUNIONS).find(x => x.id === id);
  if (!m) fail_('introuvable', 'Réunion introuvable.');
  return m;
}

function countActifs_() {
  return readTable_(SHEETS.MEMBRES).filter(m => isTrue_(m.actif)).length;
}

/* ------------------------------------------------------------------ */
/* Réunions : espace membre                                             */
/* ------------------------------------------------------------------ */

function actMeetings_(req, user) {
  const g = groupReponses_();
  const nb = countActifs_();
  const all = readTable_(SHEETS.REUNIONS)
    .map(m => meetingDto_(m, g[m.id] || [], nb, user.id))
    .sort((a, b) => a.ts - b.ts);
  return {
    aVenir: all.filter(m => !m.passee),
    passees: all.filter(m => m.passee).reverse().slice(0, 20)
  };
}

function actRespond_(req, user) {
  const reponse = String(req.reponse || '');
  if (reponse !== 'oui' && reponse !== 'non') fail_('donnees_invalides', 'Réponse invalide.');
  const m = findMeeting_(req.reunionId);
  if (m.statut === 'annulee') fail_('reunion_annulee', 'Cette réunion est annulée.');
  if (meetingTs_(m.date, m.heure) + DUREE_REUNION_MS < Date.now()) fail_('reunion_passee', 'Cette réunion est passée.');
  upsertReponses_([{
    reunionId: m.id,
    membreId: user.id,
    fields: { reponse: reponse, commentaire: clean_(req.commentaire, 200), repondueLe: nowIso_() }
  }]);
  const g = groupReponses_();
  return { reunion: meetingDto_(m, g[m.id] || [], countActifs_(), user.id) };
}

/* ------------------------------------------------------------------ */
/* Réunions : espace secrétaire                                         */
/* ------------------------------------------------------------------ */

function actMeetingSave_(req, user) {
  const d = req.reunion || {};
  const titre = clean_(d.titre, 120);
  const date = clean_(d.date, 10);
  const heure = clean_(d.heure, 5);
  if (!titre) fail_('donnees_invalides', 'Le titre est obligatoire.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dateStr_(new Date(meetingTs_(date, '00:00'))) !== date) fail_('donnees_invalides', 'Date invalide.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(heure)) fail_('donnees_invalides', 'Heure invalide.');
  const fields = {
    titre: titre,
    type: clean_(d.type, 40) || 'Réunion statutaire',
    date: date,
    heure: heure,
    lieu: clean_(d.lieu, 150),
    description: clean_(d.description, 1000)
  };
  let m;
  let kind = 'nouvelle';
  if (d.id) {
    m = findMeeting_(d.id);
    const avant = m.date + m.heure + m.lieu + m.statut;
    Object.assign(m, fields);
    if (d.statut === 'annulee' || d.statut === 'planifiee') m.statut = d.statut;
    writeRow_(SHEETS.REUNIONS, m._row, m);
    kind = m.statut === 'annulee' ? 'annulee' : 'modifiee';
    if (avant === m.date + m.heure + m.lieu + m.statut) kind = null;
  } else {
    m = Object.assign({ id: newId_('R'), statut: 'planifiee', creeLe: nowIso_(), creePar: user.id }, fields);
    appendRows_(SHEETS.REUNIONS, [m]);
  }
  let notifies = 0;
  if (req.notifier && kind && meetingTs_(m.date, m.heure) > Date.now()) notifies = mailMeeting_(m, kind);
  const g = groupReponses_();
  return { reunion: meetingDto_(m, g[m.id] || [], countActifs_(), null), notifies: notifies };
}

function actMeetingDelete_(req) {
  const m = findMeeting_(req.id);
  rewriteTable_(SHEETS.REPONSES, readTable_(SHEETS.REPONSES).filter(r => r.reunionId !== m.id));
  rewriteTable_(SHEETS.RELANCES, readTable_(SHEETS.RELANCES).filter(r => r.reunionId !== m.id));
  rewriteTable_(SHEETS.REUNIONS, readTable_(SHEETS.REUNIONS).filter(x => x.id !== m.id));
  return { supprimee: true };
}

function actMeetingResponses_(req) {
  const m = findMeeting_(req.id);
  const reps = readTable_(SHEETS.REPONSES).filter(r => r.reunionId === m.id);
  const relances = readTable_(SHEETS.RELANCES).filter(r => r.reunionId === m.id);
  const membres = readTable_(SHEETS.MEMBRES)
    .filter(x => isTrue_(x.actif))
    .sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom));
  const rows = membres.map(x => {
    const r = reps.find(y => y.membreId === x.id);
    const rel = relances.filter(y => y.membreId === x.id).map(y => y.envoyeLe).sort().pop();
    return {
      id: x.id,
      nom: x.nom,
      prenom: x.prenom,
      email: x.email,
      reponse: r ? r.reponse : '',
      commentaire: r ? r.commentaire : '',
      repondueLe: r ? r.repondueLe : '',
      presence: r ? r.presence : '',
      derniereRelance: rel || ''
    };
  });
  return { reunion: meetingDto_(m, reps, membres.length, null), membres: rows };
}

function actMeetingAttendance_(req) {
  const m = findMeeting_(req.id);
  if (meetingTs_(m.date, m.heure) > Date.now()) fail_('reunion_a_venir', 'Le pointage est possible une fois la réunion commencée.');
  const presences = req.presences || {};
  const actifs = {};
  readTable_(SHEETS.MEMBRES).forEach(x => { actifs[x.id] = true; });
  const changes = [];
  Object.keys(presences).forEach(id => {
    const v = presences[id];
    if (!actifs[id] || (v !== 'oui' && v !== 'non' && v !== '')) return;
    changes.push({ reunionId: m.id, membreId: id, fields: { presence: v } });
  });
  upsertReponses_(changes);
  return { enregistres: changes.length };
}

/* ------------------------------------------------------------------ */
/* Membres                                                              */
/* ------------------------------------------------------------------ */

function actMembersList_() {
  return {
    membres: readTable_(SHEETS.MEMBRES)
      .sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom))
      .map(memberDto_)
  };
}

function slug_(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function actMemberSave_(req, user) {
  const d = req.membre || {};
  const nom = clean_(d.nom, 60);
  const prenom = clean_(d.prenom, 60);
  const email = clean_(d.email, 120).toLowerCase();
  if (!nom || !prenom) fail_('donnees_invalides', 'Nom et prénom obligatoires.');
  if (email && !EMAIL_RE.test(email)) fail_('donnees_invalides', 'Adresse e-mail invalide.');
  const role = ROLES.indexOf(d.role) >= 0 ? d.role : 'membre';
  const actif = d.actif === false ? 'non' : 'oui';
  const all = readTable_(SHEETS.MEMBRES);
  let m = null;
  if (d.id) {
    m = all.find(x => x.id === d.id);
    if (!m) fail_('introuvable', 'Membre introuvable.');
    if (m.id === user.id && (role !== m.role || actif === 'non')) {
      fail_('interdit', 'Vous ne pouvez pas modifier votre propre rôle ni vous désactiver.');
    }
  }
  let ident = clean_(d.identifiant, 30).toLowerCase();
  if (!ident) {
    const base = (slug_(prenom) + '.' + slug_(nom)).slice(0, 26);
    ident = base;
    for (let i = 2; all.some(x => String(x.identifiant).toLowerCase() === ident); i++) ident = base + i;
  }
  if (!IDENT_RE.test(ident)) fail_('donnees_invalides', 'Identifiant invalide (3 à 30 caractères : lettres, chiffres, . _ -).');
  if (all.some(x => (!m || x.id !== m.id) && String(x.identifiant).toLowerCase() === ident)) {
    fail_('identifiant_pris', 'Cet identifiant est déjà utilisé.');
  }
  let temp = null;
  if (m) {
    Object.assign(m, { identifiant: ident, nom: nom, prenom: prenom, email: email, telephone: clean_(d.telephone, 30), role: role, actif: actif });
    writeRow_(SHEETS.MEMBRES, m._row, m);
  } else {
    temp = d.motDePasse ? String(d.motDePasse) : randomPwd_();
    if (temp.length < 8) fail_('donnees_invalides', 'Le mot de passe doit contenir au moins 8 caractères.');
    m = {
      id: newId_('M'),
      identifiant: ident,
      nom: nom,
      prenom: prenom,
      email: email,
      telephone: clean_(d.telephone, 30),
      role: role,
      actif: actif,
      creeLe: nowIso_()
    };
    m.salt = Utilities.getUuid();
    m.hash = hashPwd_(temp, m.salt);
    m.doitChangerMdp = 'oui';
    appendRows_(SHEETS.MEMBRES, [m]);
  }
  const emailEnvoye = temp && d.envoyerEmail && m.email ? mailCredentials_(m, temp) : false;
  return { membre: memberDto_(m), motDePasseTemporaire: temp, emailEnvoye: emailEnvoye };
}

function actMemberReset_(req) {
  const m = readTable_(SHEETS.MEMBRES).find(x => x.id === req.id);
  if (!m) fail_('introuvable', 'Membre introuvable.');
  const temp = randomPwd_();
  setPassword_(m, temp, true);
  const emailEnvoye = req.envoyerEmail && m.email ? mailCredentials_(m, temp) : false;
  return { motDePasseTemporaire: temp, emailEnvoye: emailEnvoye };
}

/* ------------------------------------------------------------------ */
/* Statistiques (président)                                             */
/* ------------------------------------------------------------------ */

// Année rotarienne : du 1er juillet au 30 juin.
function anneeRotarienne_(d) {
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
}

function pct_(a, b) {
  return b > 0 ? Math.round((a / b) * 1000) / 10 : null;
}

function actStats_(req) {
  const now = new Date();
  const courante = anneeRotarienne_(now);
  const annee = parseInt(req.annee, 10) || courante;
  const debut = annee + '-07-01';
  const fin = (annee + 1) + '-06-30';

  const toutes = readTable_(SHEETS.REUNIONS).filter(m => m.statut !== 'annulee');
  const annees = {};
  annees[courante] = true;
  toutes.forEach(m => { annees[anneeRotarienne_(new Date(meetingTs_(m.date, '12:00')))] = true; });

  const membres = readTable_(SHEETS.MEMBRES).filter(m => isTrue_(m.actif));
  const g = groupReponses_();
  const reunions = toutes
    .filter(m => m.date >= debut && m.date <= fin)
    .map(m => Object.assign({ ts: meetingTs_(m.date, m.heure) }, m))
    .sort((a, b) => a.ts - b.ts);

  const parReunion = reunions.map(m => {
    const reps = g[m.id] || [];
    const oui = reps.filter(r => r.reponse === 'oui').length;
    const non = reps.filter(r => r.reponse === 'non').length;
    const pointes = reps.filter(r => r.presence === 'oui' || r.presence === 'non');
    const presents = pointes.filter(r => r.presence === 'oui').length;
    return {
      id: m.id,
      titre: m.titre,
      date: m.date,
      heure: m.heure,
      passee: m.ts + DUREE_REUNION_MS < now.getTime(),
      oui: oui,
      non: non,
      sans: Math.max(0, membres.length - oui - non),
      pointee: pointes.length > 0,
      presents: presents,
      pointes: pointes.length,
      tauxPresence: pct_(presents, pointes.length),
      tauxReponse: pct_(oui + non, membres.length)
    };
  });

  const parMembre = membres.map(x => {
    let pointees = 0, presents = 0, repondues = 0, derniere = '';
    reunions.forEach(m => {
      const r = (g[m.id] || []).find(y => y.membreId === x.id);
      if (!r) return;
      if (r.reponse) repondues++;
      if (r.presence === 'oui' || r.presence === 'non') {
        pointees++;
        if (r.presence === 'oui') {
          presents++;
          if (m.date > derniere) derniere = m.date;
        }
      }
    });
    return {
      id: x.id,
      nom: x.nom,
      prenom: x.prenom,
      pointees: pointees,
      presents: presents,
      tauxPresence: pct_(presents, pointees),
      tauxReponse: pct_(repondues, reunions.length),
      dernierePresence: derniere
    };
  }).sort((a, b) => (b.tauxPresence === null ? -1 : b.tauxPresence) - (a.tauxPresence === null ? -1 : a.tauxPresence));

  const mois = {};
  parReunion.filter(r => r.pointee).forEach(r => {
    const k = r.date.slice(0, 7);
    mois[k] = mois[k] || { presents: 0, pointes: 0 };
    mois[k].presents += r.presents;
    mois[k].pointes += r.pointes;
  });
  const parMois = Object.keys(mois).sort().map(k => ({ mois: k, tauxPresence: pct_(mois[k].presents, mois[k].pointes) }));

  const pointees = parReunion.filter(r => r.pointee);
  const sommeP = pointees.reduce((s, r) => s + r.presents, 0);
  const sommeT = pointees.reduce((s, r) => s + r.pointes, 0);
  const aVenir = parReunion.filter(r => !r.passee);
  const prochaine = aVenir.length ? aVenir[0] : null;

  return {
    annee: annee,
    libelle: annee + '-' + (annee + 1),
    annees: Object.keys(annees).map(Number).sort((a, b) => b - a),
    kpis: {
      membresActifs: membres.length,
      reunions: reunions.length,
      reunionsPointees: pointees.length,
      tauxPresence: pct_(sommeP, sommeT),
      tauxReponseProchaine: prochaine ? prochaine.tauxReponse : null
    },
    prochaine: prochaine,
    aVenir: aVenir.slice(0, 5),
    parReunion: parReunion,
    parMois: parMois,
    parMembre: parMembre,
    enRisque: parMembre.filter(m => m.pointees >= 3 && m.tauxPresence !== null && m.tauxPresence < 50).length
  };
}

/* ------------------------------------------------------------------ */
/* E-mails                                                              */
/* ------------------------------------------------------------------ */

function sendMail_(to, subject, html, text) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) return false;
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, body: text, name: getConfig_().CLUB_NOM });
    return true;
  } catch (e) {
    console.error('Envoi e-mail impossible : ' + e);
    return false;
  }
}

function mailLayout_(cfg, intro, details, cta) {
  const lien = cfg.URL_APP
    ? '<p style="margin:24px 0"><a href="' + esc_(cfg.URL_APP) + '" style="background:#17458f;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">' + esc_(cta) + '</a></p>'
    : '';
  return '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c2536">' +
    '<div style="background:#17458f;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;font-size:18px;font-weight:700">' + esc_(cfg.CLUB_NOM) + '</div>' +
    '<div style="border:1px solid #dde3ee;border-top:0;padding:20px;border-radius:0 0 10px 10px">' + intro + details + lien +
    '<p style="color:#6b778c;font-size:12px;margin-top:24px">Message automatique de RotaryConnect.</p></div></div>';
}

function meetingDetails_(m) {
  return '<div style="background:#f4f7fc;border-left:4px solid #f7a81b;padding:12px 16px;margin:16px 0;border-radius:4px">' +
    '<strong>' + esc_(m.titre) + '</strong><br>' +
    esc_(dateFr_(m.date)) + ' à ' + esc_(heureFr_(m.heure)) +
    (m.lieu ? '<br>' + esc_(m.lieu) : '') + '</div>';
}

function activeMembersWithEmail_() {
  return readTable_(SHEETS.MEMBRES).filter(m => isTrue_(m.actif) && m.email);
}

function mailMeeting_(m, kind) {
  const cfg = getConfig_();
  const titres = { nouvelle: 'Nouvelle réunion', modifiee: 'Réunion modifiée', annulee: 'Réunion annulée' };
  const phrases = {
    nouvelle: 'Une nouvelle réunion vient d\'être programmée. Merci de confirmer votre présence.',
    modifiee: 'Les informations de cette réunion ont changé. Merci de vérifier votre réponse.',
    annulee: 'Cette réunion est annulée.'
  };
  let n = 0;
  activeMembersWithEmail_().forEach(x => {
    const intro = '<p>Bonjour ' + esc_(x.prenom) + ',</p><p>' + phrases[kind] + '</p>';
    const subject = '[' + cfg.CLUB_NOM + '] ' + titres[kind] + ' : ' + m.titre + ' – ' + dateFr_(m.date);
    const text = 'Bonjour ' + x.prenom + ',\n' + phrases[kind] + '\n' + m.titre + ' – ' + dateFr_(m.date) + ' à ' + heureFr_(m.heure) + (cfg.URL_APP ? '\n' + cfg.URL_APP : '');
    if (sendMail_(x.email, subject, mailLayout_(cfg, intro, meetingDetails_(m), kind === 'annulee' ? 'Ouvrir RotaryConnect' : 'Répondre'), text)) n++;
  });
  return n;
}

function mailCredentials_(m, temp) {
  const cfg = getConfig_();
  const intro = '<p>Bonjour ' + esc_(m.prenom) + ',</p><p>Votre accès à RotaryConnect est prêt.</p>' +
    '<p>Identifiant : <strong>' + esc_(m.identifiant) + '</strong><br>Mot de passe provisoire : <strong>' + esc_(temp) + '</strong></p>' +
    '<p>Vous devrez le changer à la première connexion.</p>';
  const text = 'Identifiant : ' + m.identifiant + '\nMot de passe provisoire : ' + temp + (cfg.URL_APP ? '\n' + cfg.URL_APP : '');
  return sendMail_(m.email, '[' + cfg.CLUB_NOM + '] Votre accès RotaryConnect', mailLayout_(cfg, intro, '', 'Ouvrir RotaryConnect'), text);
}

function libelleDelai_(jours) {
  if (jours <= 0) return 'aujourd\'hui';
  if (jours === 1) return 'demain';
  return 'dans ' + jours + ' jours';
}

function mailRelance_(x, m, jours, cfg) {
  const intro = '<p>Bonjour ' + esc_(x.prenom) + ',</p><p>Vous n\'avez pas encore indiqué si vous serez présent(e) à la réunion ' +
    esc_(libelleDelai_(jours)) + '. Merci de répondre en un clic :</p>';
  const text = 'Bonjour ' + x.prenom + ',\nMerci de confirmer votre présence : ' + m.titre + ' – ' + dateFr_(m.date) + ' à ' + heureFr_(m.heure) + (cfg.URL_APP ? '\n' + cfg.URL_APP : '');
  return sendMail_(x.email, '[' + cfg.CLUB_NOM + '] Rappel : confirmez votre présence – ' + m.titre, mailLayout_(cfg, intro, meetingDetails_(m), 'Confirmer ma présence'), text);
}

/* ------------------------------------------------------------------ */
/* Relances                                                             */
/* ------------------------------------------------------------------ */

/** Relance automatique (déclencheur quotidien) : un rappel par palier (ex. J-7, J-2) et par membre sans réponse. */
function envoyerRelances() {
  const cfg = getConfig_();
  if (cfg.RELANCES_ACTIVES === 'non') return { envoyes: 0, echecs: 0 };
  const etapes = parseEtapes_(cfg.JOURS_RELANCE);
  if (!etapes.length) return { envoyes: 0, echecs: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = Date.now();
    const today = dateStr_(new Date(now));
    const membres = activeMembersWithEmail_();
    const reps = groupReponses_();
    const dejaEnvoyes = {};
    readTable_(SHEETS.RELANCES).forEach(r => { dejaEnvoyes[r.reunionId + '|' + r.membreId + '|' + r.etape] = true; });
    const nouveaux = [];
    let echecs = 0;
    readTable_(SHEETS.REUNIONS)
      .filter(m => m.statut !== 'annulee' && meetingTs_(m.date, m.heure) > now)
      .forEach(m => {
        const jours = dayNum_(m.date) - dayNum_(today);
        const etape = etapes.find(j => jours <= j);
        if (etape === undefined) return;
        const repondus = {};
        (reps[m.id] || []).forEach(r => { if (r.reponse) repondus[r.membreId] = true; });
        membres.forEach(x => {
          const key = m.id + '|' + x.id + '|J-' + etape;
          if (repondus[x.id] || dejaEnvoyes[key]) return;
          if (mailRelance_(x, m, jours, cfg)) {
            nouveaux.push({ reunionId: m.id, membreId: x.id, etape: 'J-' + etape, envoyeLe: nowIso_(), email: x.email });
          } else {
            echecs++;
          }
        });
      });
    appendRows_(SHEETS.RELANCES, nouveaux);
    return { envoyes: nouveaux.length, echecs: echecs };
  } finally {
    lock.releaseLock();
  }
}

/** Relance manuelle d'une réunion par la secrétaire (limitée à une fois par heure). */
function actRelanceSend_(req) {
  const m = findMeeting_(req.id);
  if (m.statut === 'annulee') fail_('reunion_annulee', 'Cette réunion est annulée.');
  if (meetingTs_(m.date, m.heure) < Date.now()) fail_('reunion_passee', 'Cette réunion est passée.');
  const cfg = getConfig_();
  const il_y_a_1h = Utilities.formatDate(new Date(Date.now() - 3600000), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  const recent = readTable_(SHEETS.RELANCES).some(r => r.reunionId === m.id && r.etape === 'manuel' && String(r.envoyeLe) > il_y_a_1h);
  if (recent) fail_('relance_recente', 'Une relance a déjà été envoyée il y a moins d\'une heure.');
  const repondus = {};
  readTable_(SHEETS.REPONSES).forEach(r => { if (r.reunionId === m.id && r.reponse) repondus[r.membreId] = true; });
  const jours = dayNum_(m.date) - dayNum_(dateStr_(new Date()));
  const nouveaux = [];
  let sansEmail = 0;
  let echecs = 0;
  readTable_(SHEETS.MEMBRES).filter(x => isTrue_(x.actif) && !repondus[x.id]).forEach(x => {
    if (!x.email) { sansEmail++; return; }
    if (mailRelance_(x, m, jours, cfg)) nouveaux.push({ reunionId: m.id, membreId: x.id, etape: 'manuel', envoyeLe: nowIso_(), email: x.email });
    else echecs++;
  });
  appendRows_(SHEETS.RELANCES, nouveaux);
  return { envoyes: nouveaux.length, sansEmail: sansEmail, echecs: echecs };
}

/* ------------------------------------------------------------------ */
/* Installation                                                         */
/* ------------------------------------------------------------------ */

function installerDeclencheurs() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'envoyerRelances') ScriptApp.deleteTrigger(t);
  });
  const heure = Number(getConfig_().HEURE_RELANCE) || 9;
  ScriptApp.newTrigger('envoyerRelances').timeBased().everyDays(1).atHour(heure).create();
}

/**
 * À exécuter une seule fois depuis l'éditeur Apps Script.
 * Crée les onglets, la configuration, le secret de session, le compte « secretaire »
 * (mot de passe provisoire affiché dans le journal d'exécution) et le déclencheur quotidien.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN_SECRET')) {
    props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  const ss = ss_();
  Object.keys(SHEETS).forEach(k => {
    const def = SHEETS[k];
    let s = ss.getSheetByName(def.name);
    if (!s) s = ss.insertSheet(def.name);
    s.getRange(1, 1, s.getMaxRows(), def.headers.length).setNumberFormat('@');
    s.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    s.setFrozenRows(1);
  });
  const cfgRows = readTable_(SHEETS.CONFIG);
  Object.keys(DEFAULT_CONFIG).forEach(k => {
    if (!cfgRows.some(r => r.cle === k)) appendRows_(SHEETS.CONFIG, [{ cle: k, valeur: DEFAULT_CONFIG[k] }]);
  });
  let result = { message: 'Base déjà initialisée.' };
  if (!readTable_(SHEETS.MEMBRES).length) {
    const temp = randomPwd_();
    const m = {
      id: newId_('M'), identifiant: 'secretaire', nom: 'Secrétaire', prenom: 'Compte', email: '', telephone: '',
      role: 'secretaire', actif: 'oui', creeLe: nowIso_()
    };
    m.salt = Utilities.getUuid();
    m.hash = hashPwd_(temp, m.salt);
    m.doitChangerMdp = 'oui';
    appendRows_(SHEETS.MEMBRES, [m]);
    result = { identifiant: 'secretaire', motDePasseProvisoire: temp };
    console.log('Compte créé -> identifiant : secretaire | mot de passe provisoire : ' + temp);
  }
  installerDeclencheurs();
  return result;
}
