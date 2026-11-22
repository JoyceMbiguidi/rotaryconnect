/* Jeu de données fictif du mode démo, injecté via l'API réelle (Code.gs). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DemoSeed = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PWD = 'demo1234';
  const MEMBRES = [
    ['Dubois', 'Claire', 'membre', 'claire.dubois', 0.9],
    ['Lefèvre', 'Henri', 'membre', '', 0.85],
    ['Moreau', 'Sophie', 'membre', '', 0.8],
    ['Bernard', 'Luc', 'membre', '', 0.75],
    ['Petit', 'Marie', 'membre', '', 0.7],
    ['Roux', 'Antoine', 'membre', '', 0.6],
    ['Fournier', 'Isabelle', 'membre', '', 0.55],
    ['Girard', 'Marc', 'membre', '', 0.4],
    ['Bonnet', 'Nathalie', 'membre', '', 0.35],
    ['Mercier', 'Olivier', 'membre', '', 0.9],
    ['Faure', 'Camille', 'membre', '', 0.65],
    ['Lambert', 'Pierre', 'membre', '', 0.8]
  ];

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  // Jeudis strictement futurs (k > 0) ou strictement passés (k < 0)
  function thursday(k) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    const day = d.getDay();
    if (k > 0) d.setDate(d.getDate() + (((4 - day + 7) % 7) || 7) + 7 * (k - 1));
    else d.setDate(d.getDate() - (((day - 4 + 7) % 7) || 7) - 7 * (-k - 1));
    return d;
  }

  function seed(rt) {
    const ok = r => { if (!r.ok) throw new Error('Démo : ' + r.error); return r.data; };
    const call = (action, p, token) => ok(rt.call(Object.assign({ action: action, token: token }, p || {})));
    const rand = rng(42);

    const setup = rt.run('setup');
    let sec = call('login', { identifiant: 'secretaire', motDePasse: setup.motDePasseProvisoire });
    sec = call('password.change', { ancien: setup.motDePasseProvisoire, nouveau: PWD }, sec.token);
    const T = sec.token;
    call('config.save', { config: { clubNom: 'Rotary Club de Démo', relancesActives: true, joursRelance: '7,2', heureRelance: 9 } }, T);
    call('profile.update', { email: 'secretaire@example.org', telephone: '' }, T);
    call('member.save', { membre: { id: sec.user.id, nom: 'Roche', prenom: 'Sylvie', identifiant: 'secretaire', role: 'secretaire', email: 'secretaire@example.org' } }, T);

    const mkMember = (nom, prenom, role, identifiant, temp) => call('member.save', {
      membre: { nom: nom, prenom: prenom, role: role, identifiant: identifiant || undefined, email: (prenom + '.' + nom).toLowerCase().normalize('NFD').replace(/[^a-z.]/g, '') + '@example.org', motDePasse: temp }
    }, T).membre;

    const pres = mkMember('Martin', 'Jean', 'president', 'president', 'Temp-demo1');
    call('password.change', { ancien: 'Temp-demo1', nouveau: PWD }, call('login', { identifiant: 'president', motDePasse: 'Temp-demo1' }).token);

    const people = MEMBRES.map((m, i) => {
      const u = mkMember(m[0], m[1], m[2], m[3], i === 0 ? 'Temp-demo1' : PWD);
      return { id: u.id, ident: u.identifiant, p: m[4] };
    });
    call('password.change', { ancien: 'Temp-demo1', nouveau: PWD }, call('login', { identifiant: people[0].ident, motDePasse: 'Temp-demo1' }).token);

    const meeting = (weeks, titre, type, heure, lieu, description) => call('meeting.save', {
      reunion: { titre: titre, type: type, date: fmt(thursday(weeks)), heure: heure, lieu: lieu, description: description || '' }
    }, T).reunion;

    const everyone = [{ id: sec.user.id, p: 0.95 }, { id: pres.id, p: 0.9 }].concat(people);
    const passes = [
      meeting(-8, 'Réunion statutaire', 'Réunion statutaire', '19:30', 'Salle des fêtes', 'Point sur les actions de l\'année.'),
      meeting(-7, 'Visite d\'entreprise', 'Apéro gazon', '18:00', 'Brasserie du port'),
      meeting(-6, 'Réunion statutaire', 'Réunion statutaire', '19:30', 'Salle des fêtes'),
      meeting(-5, 'Conférence : l\'eau potable', 'Conférence', '19:30', 'Médiathèque'),
      meeting(-4, 'Réunion statutaire', 'Réunion statutaire', '19:30', 'Salle des fêtes'),
      meeting(-3, 'Action de service : collecte', 'Action de service', '09:00', 'Place du marché'),
      meeting(-2, 'Réunion statutaire', 'Réunion statutaire', '19:30', 'Salle des fêtes'),
      meeting(-1, 'Comité', 'Comité', '19:00', 'Salle des fêtes')
    ];
    passes.forEach(m => {
      const presences = {};
      everyone.forEach(x => { presences[x.id] = rand() < x.p ? 'oui' : 'non'; });
      call('meeting.attendance', { id: m.id, presences: presences }, T);
    });

    const prochaine = meeting(1, 'Réunion statutaire', 'Réunion statutaire', '19:30', 'Salle des fêtes', 'Invité : le gouverneur du district.');
    const futures = [
      prochaine,
      meeting(2, 'Conférence : cybersécurité', 'Conférence', '19:30', 'Médiathèque', 'Ouvert aux conjoints.'),
      meeting(3, 'Soirée de gala', 'Apéro gazon', '20:00', 'Château de la Tour', 'Tenue de soirée.'),
      meeting(4, 'Réunion statutaire', 'Réunion statutaire', '19:30', 'Salle des fêtes')
    ];
    people.forEach((p, i) => {
      if (i === 0) return; // Claire (compte membre démo) n'a pas encore répondu
      const tok = call('login', { identifiant: p.ident, motDePasse: PWD }).token;
      futures.slice(0, 2).forEach((m, k) => {
        if (rand() < (k === 0 ? 0.65 : 0.4)) {
          call('respond', { reunionId: m.id, reponse: rand() < p.p ? 'oui' : 'non', commentaire: '' }, tok);
        }
      });
    });
  }

  return { seed: seed, PWD: PWD };
});
