// ============================================================
// Gesundheitsbude-App — Bereichs-Rechte je Klient:in (wie Tool-Rechte in der BM-App)
// Gespeichert in profiles.permissions; Admin + Team haben immer vollen Zugriff.
// Neue Bereiche: hier in PERM_AREAS eintragen (+ Standardwert in PERM_DEFAULT und in der DB-Spalte).
// ============================================================
const PERM_AREAS = [
  { key: 'therapieplan', label: 'Mein Therapieplan', sub: 'Zeitplan, n&auml;chste Schritte, Empfehlungen',
    levels: [['none', 'kein Zugriff'], ['view', 'nur ansehen'], ['edit', 'Schritte abhaken']] },
  { key: 'labor', label: 'Laborwerte & Befunde', sub: 'Befunde, Laborwerte und Verlauf',
    levels: [['none', 'kein Zugriff'], ['view', 'nur ansehen'], ['edit', 'selbst hochladen']] },
  { key: 'tagebuch', label: 'Tagebuch', sub: 'Einnahmen, Routinen und Kategorien abhaken / eintragen',
    levels: [['none', 'kein Zugriff'], ['view', 'nur ansehen'], ['edit', 'eintragen']] },
  { key: 'videos', label: 'Videos / Zoom-Aufzeichnungen', sub: 'Aufzeichnungen der eigenen Termine',
    levels: [['none', 'kein Zugriff'], ['view', 'ansehen']] },
];
// Bereiche, die in der App schon fertig sind (die anderen sind vorbereitet und erscheinen, sobald sie gebaut sind)
const PERM_READY = ['therapieplan', 'tagebuch', 'labor'];

function permOf(perms) { return Object.assign({}, PERM_DEFAULT, perms || {}); }

function permSummary(perms) {
  const p = permOf(perms);
  return PERM_AREAS.filter(a => p[a.key] !== 'none')
    .map(a => `<span class="chip">${esc(a.label)}${p[a.key] === 'view' && a.levels.length > 2 ? ' (ansehen)' : ''}</span>`).join('')
    || '<span class="muted">nichts freigeschaltet</span>';
}

// Tabelle mit Auswahl je Bereich (für Dialog und Anlege-Formular)
function permTableHtml(prefix, perms) {
  const p = permOf(perms);
  return `<table class="perm-table"><tbody>
    ${PERM_AREAS.map(a => `<tr>
      <td><b>${esc(a.label)}</b>${PERM_READY.includes(a.key) ? '' : ' <span class="soon-tag">folgt</span>'}<div class="perm-sub">${a.sub}</div></td>
      <td>${a.levels.map(([v, l]) => `<label class="perm-opt"><input type="radio" name="${prefix}_${a.key}" value="${v}" ${p[a.key] === v ? 'checked' : ''}> ${l}</label>`).join('')}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

function readPerms(host, prefix) {
  const perms = {};
  PERM_AREAS.forEach(a => { perms[a.key] = (host.querySelector(`input[name="${prefix}_${a.key}"]:checked`) || {}).value || 'none'; });
  return perms;
}

function openPermissionsDialog(user, done) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `<div class="modal">
      <h2>Rechte: ${esc(user.name)}</h2>
      <p class="hint" style="margin-top:0;">Was diese Person in der App sieht und ver&auml;ndern darf. Wird zus&auml;tzlich in der Datenbank gepr&uuml;ft; &auml;ndern darf das nur ein Admin.</p>
      ${permTableHtml('dlg', user.permissions)}
      <div class="modal-actions" style="margin-top:14px;"><span class="spacer"></span>
        <button type="button" class="secondary" id="permCancel">Abbrechen</button>
        <button type="button" id="permSave">Speichern</button></div>
    </div>`;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  scrim.querySelector('#permCancel').onclick = close;
  scrim.querySelector('#permSave').onclick = async () => {
    const { error } = await sb.from('profiles').update({ permissions: readPerms(scrim, 'dlg') }).eq('id', user.id);
    if (error) { toast('Fehler: ' + error.message); return; }
    toast('Rechte gespeichert.');
    close(); done();
  };
}
