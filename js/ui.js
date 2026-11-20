/* Composants d'interface partagés : échappement, icônes, modales, toasts, graphiques, dates. */
(function () {
  'use strict';

  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONS = {
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 14l2 2 4-4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    chart: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M22 6l-10 7L2 6"/>',
    key: '<path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
    refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
    smartphone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>'
  };

  const icon = name => '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';

  /* ---------- Dates ---------- */
  const parseDate = s => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const fmtLong = s => parseDate(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = s => parseDate(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const fmtHeure = h => String(h || '').replace(':', 'h');
  const monthLabel = ym => { const p = ym.split('-').map(Number); return new Date(p[0], p[1] - 1, 1).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''); };
  const dateBadge = s => { const d = parseDate(s); return { d: d.getDate(), m: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') }; };
  const fmtDateTime = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };
  const initials = (prenom, nom) => ((prenom || '?').charAt(0) + (nom || '').charAt(0)).toUpperCase();
  const fmtPct = v => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toString().replace('.', ',') + ' %');

  /* ---------- Toasts ---------- */
  function toast(msg, type) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), type === 'err' ? 6000 : 3500);
  }

  /* ---------- Modales ---------- */
  function modal(title, bodyHtml, opts) {
    opts = opts || {};
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = '<div class="modal-head"><h2>' + esc(title) + '</h2><button type="button" class="btn ghost sm" data-close aria-label="Fermer">' + icon('x') + '</button></div><div class="modal-body">' + bodyHtml + '</div>';
    document.body.appendChild(dlg);
    const handle = { el: dlg, close: () => { if (dlg.open) dlg.close(); } };
    dlg.addEventListener('click', e => {
      if (e.target.closest('[data-close]') || e.target === dlg) handle.close();
    });
    dlg.addEventListener('close', () => { dlg.remove(); if (opts.onClose) opts.onClose(); });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    const first = dlg.querySelector('input:not([type=hidden]), select, textarea');
    if (first && !opts.noFocus) first.focus({ preventScroll: true });
    return handle;
  }

  function confirmDialog(message, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      let answer = false;
      const m = modal(opts.title || 'Confirmation',
        '<p>' + esc(message) + '</p><div class="modal-actions"><button type="button" class="btn secondary" data-close>Annuler</button><button type="button" class="btn ' + (opts.danger ? 'danger' : '') + '" data-ok>' + esc(opts.okLabel || 'Confirmer') + '</button></div>',
        { noFocus: true, onClose: () => resolve(answer) });
      m.el.querySelector('[data-ok]').addEventListener('click', () => { answer = true; m.close(); });
    });
  }

  /* ---------- Graphiques ---------- */
  function bars(items, label) {
    if (!items.length) return '<p class="empty">Pas encore de données.</p>';
    return '<div class="chart" role="img" aria-label="' + esc(label) + '">' + items.map(it => {
      const v = it.value;
      const h = v === null || v === undefined ? 0 : Math.max(0, Math.min(100, v));
      return '<div class="col" title="' + esc(it.title || '') + '"><div class="bar ' + (it.cls || '') + (v === null || v === undefined ? ' empty' : '') + '" style="height:' + h + '%"><span class="val">' + (v === null || v === undefined ? '–' : Math.round(v)) + '</span></div><span class="lab">' + esc(it.label) + '</span></div>';
    }).join('') + '</div>';
  }

  const rateClass = v => (v === null || v === undefined ? '' : v >= 75 ? 'high' : v >= 50 ? 'mid' : 'low');

  function hbar(v) {
    return '<div class="hbar" aria-hidden="true"><i class="' + rateClass(v) + '" style="width:' + (v === null || v === undefined ? 0 : v) + '%"></i></div>';
  }

  function progress(oui, non, total) {
    const t = Math.max(total, oui + non, 1);
    return '<div class="progress" role="img" aria-label="' + oui + ' présents, ' + non + ' absents sur ' + total + '"><i class="y" style="width:' + (oui / t * 100) + '%"></i><i class="n" style="width:' + (non / t * 100) + '%"></i></div>' +
      '<div class="legend"><span><i class="dot y"></i><b>' + oui + '</b> présent' + (oui > 1 ? 's' : '') + '</span><span><i class="dot n"></i><b>' + non + '</b> absent' + (non > 1 ? 's' : '') + '</span><span><i class="dot s"></i><b>' + Math.max(0, total - oui - non) + '</b> sans réponse</span></div>';
  }

  window.UI = {
    esc: esc, icon: icon, toast: toast, modal: modal, confirmDialog: confirmDialog,
    parseDate: parseDate, fmtLong: fmtLong, fmtShort: fmtShort, fmtHeure: fmtHeure, monthLabel: monthLabel,
    dateBadge: dateBadge, fmtDateTime: fmtDateTime, initials: initials, fmtPct: fmtPct,
    bars: bars, hbar: hbar, rateClass: rateClass, progress: progress
  };
})();
