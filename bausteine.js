// ============================================================
// Gesundheitsbude-App — Therapiebausteine-Datenbank (nur Admin + Team)
// Kategorien frei anlegbar, Bausteine suchen/filtern/bearbeiten, Import/Export Excel
// ============================================================
const TB = { cats: [], blocks: [], phases: [], q: '', cat: '', phase: '', pkg: '', showInactive: false };

async function tbLoad() {
  const [c, b, ph] = await Promise.all([
    sb.from('block_categories').select('*').order('sort').order('name'),
    sb.from('therapy_blocks').select('*').order('title'),
    sb.from('plan_phases').select('*').order('no'),
    pgLoadPackages(),
  ]);
  if (c.error || b.error || ph.error) throw new Error((c.error || b.error || ph.error).message);
  TB.cats = c.data || [];
  TB.blocks = b.data || [];
  TB.phases = ph.data || [];
}

const tbCat = (id) => TB.cats.find(c => c.id === id);
const tbPhase = (id) => TB.phases.find(p => p.id === id);

async function renderBlocksPage(profile) {
  if (!isStaff(profile)) { renderMenu(profile); return; }
  TB.profile = profile;
  try { await tbLoad(); }
  catch (e) { renderShell(profile, 'bausteine', 'Therapiebausteine', `<div class="card"><p class="error">Laden fehlgeschlagen: ${esc(e.message)}</p></div>`); return; }

  const content = `
    <div class="tb-toolbar">
      <input type="search" id="tbSearch" placeholder="Suchen: Titel, Text, Produkt, Schlagwort &hellip;" value="${esc(TB.q)}">
      <button type="button" id="tbNew">+ Baustein</button>
      <button type="button" class="secondary" id="tbCats">Themenfelder</button>
      <button type="button" class="secondary" id="tbMatrix">&Uuml;bersicht</button>
      <button type="button" class="secondary" id="tbImport">Import</button>
      <button type="button" class="secondary" id="tbExport">Export</button>
      <input type="file" id="tbFile" accept=".xlsx,.xls,.csv,.json" hidden>
    </div>
    <div class="tb-filter" id="tbFilter"></div>
    <div class="tb-filter tb-filter2" id="tbFilter2"></div>
    <label class="tb-inactive"><input type="checkbox" id="tbInactive" ${TB.showInactive ? 'checked' : ''}> auch inaktive Bausteine zeigen</label>
    <div id="tbList"></div>`;
  renderShell(profile, 'bausteine', 'Therapiebausteine', content);

  const redraw = () => { tbDrawFilter(); tbDrawList(profile); };
  document.getElementById('tbSearch').oninput = (e) => { TB.q = e.target.value; tbDrawList(profile); };
  document.getElementById('tbInactive').onchange = (e) => { TB.showInactive = e.target.checked; redraw(); };
  document.getElementById('tbNew').onclick = () => tbEditDialog(profile, null);
  document.getElementById('tbCats').onclick = () => tbCatsDialog(profile);
  document.getElementById('tbMatrix').onclick = () => tbMatrixDialog();
  document.getElementById('tbExport').onclick = () => tbExport();
  document.getElementById('tbImport').onclick = () => tbImportInfo(profile);
  document.getElementById('tbFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) tbImportFile(profile, f); };
  redraw();
}

function tbDrawFilter() {
  const counts = {};
  TB.blocks.forEach(b => { if ((b.active || TB.showInactive) && tbMatchesPhasePkg(b)) counts[b.category_id || ''] = (counts[b.category_id || ''] || 0) + 1; });
  const chip = (id, name, color, n) => `<button type="button" class="tb-chip${TB.cat === id ? ' on' : ''}" data-cat="${id}" style="--c:${color}">${esc(name)} <span>${n}</span></button>`;
  document.getElementById('tbFilter').innerHTML =
    chip('', 'Alle', '#ffffff', Object.values(counts).reduce((a, b) => a + b, 0)) +
    TB.cats.map(c => chip(c.id, c.name, c.color, counts[c.id] || 0)).join('');
  document.querySelectorAll('#tbFilter .tb-chip').forEach(btn => {
    btn.onclick = () => { TB.cat = btn.dataset.cat; tbDrawFilter(); tbDrawList(TB.profile); };
  });
  const pchip = (id, name, color) => `<button type="button" class="tb-chip${TB.phase === id ? ' on' : ''}" data-ph="${id}" style="--c:${color}">${esc(name)}</button>`;
  document.getElementById('tbFilter2').innerHTML =
    '<span class="tb-flabel">Phase</span>' + pchip('', 'alle', '#ffffff') +
    TB.phases.map(p => pchip(p.id, p.no + '. ' + p.name, p.color)).join('') + pchip('none', 'ohne Phase', '#a0a0b8') +
    `<select id="tbPkg" class="tb-pkgsel"><option value="">alle Pakete</option>${PG.packages.map(p => `<option value="${p.key}" ${TB.pkg === p.key ? 'selected' : ''}>sichtbar in: ${esc(p.name)}</option>`).join('')}</select>`;
  document.querySelectorAll('#tbFilter2 [data-ph]').forEach(btn => {
    btn.onclick = () => { TB.phase = btn.dataset.ph; tbDrawFilter(); tbDrawList(TB.profile); };
  });
  document.getElementById('tbPkg').onchange = (e) => { TB.pkg = e.target.value; tbDrawFilter(); tbDrawList(TB.profile); };
}

function tbMatchesPhasePkg(b) {
  if (TB.phase === 'none' && b.phase_id) return false;
  if (TB.phase && TB.phase !== 'none' && b.phase_id !== TB.phase) return false;
  if (TB.pkg && !pgBlockFits(b, pgPkg(TB.pkg), TB.phases)) return false;
  return true;
}

function tbMatches(b) {
  if (!b.active && !TB.showInactive) return false;
  if (TB.cat && b.category_id !== TB.cat) return false;
  if (!tbMatchesPhasePkg(b)) return false;
  const q = TB.q.trim().toLowerCase();
  if (!q) return true;
  return [b.title, b.description, b.patient_text, b.application, b.product, b.duration, (b.tags || []).join(' ')]
    .some(v => (v || '').toLowerCase().includes(q));
}

function tbDrawList(profile) {
  const list = document.getElementById('tbList');
  const shown = TB.blocks.filter(tbMatches);
  if (!TB.blocks.length) {
    list.innerHTML = `<div class="card"><h2>Noch keine Bausteine</h2><p class="hint">Lege Bausteine einzeln mit <b>+ Baustein</b> an oder importiere deine Liste aus Excel (<b>Import</b> &rarr; Vorlage herunterladen, ausf&uuml;llen, hochladen).</p></div>`;
    return;
  }
  if (!shown.length) { list.innerHTML = `<p class="muted">Keine Treffer.</p>`; return; }
  // nach Kategorie gruppieren (Reihenfolge wie Kategorien)
  const groups = [...TB.cats, { id: null, name: 'Ohne Themenfeld', color: '#a0a0b8' }]
    .map(c => ({ c, items: shown.filter(b => (b.category_id || null) === c.id) }))
    .filter(g => g.items.length);
  list.innerHTML = groups.map(g => `
    <h3 class="tb-group" style="--c:${g.c.color}">${esc(g.c.name)} <span>${g.items.length}</span></h3>
    <div class="tb-grid">
      ${g.items.map(b => `
        <button type="button" class="tb-card${b.active ? '' : ' inactive'}" data-id="${b.id}" style="--c:${g.c.color}">
          <span class="tb-title">${esc(b.title)}${b.active ? '' : ' <em>(inaktiv)</em>'}</span>
          <span class="tb-badges">${(() => { const ph = tbPhase(b.phase_id); return ph ? `<span class="pg-badge phase" style="--c:${ph.color}">${ph.no}. ${esc(ph.name)}</span>` : '<span class="pg-badge warn">ohne Phase</span>'; })()}${pgPkgBadges(b.packages)}${pgMeta(b)}</span>
          ${b.application ? `<span class="tb-line">&#128138; ${esc(b.application)}</span>` : ''}
          ${b.product ? `<span class="tb-line">&#127991; ${esc(b.product)}</span>` : ''}
          ${b.duration ? `<span class="tb-line">&#128197; ${esc(b.duration)}</span>` : ''}
          ${b.patient_text ? `<span class="tb-desc">${esc(b.patient_text)}</span>` : (b.description ? `<span class="tb-desc">${esc(b.description)}</span>` : '')}
          ${(b.tags || []).length ? `<span class="tb-tags">${b.tags.map(t => `<i>#${esc(t)}</i>`).join(' ')}</span>` : ''}
        </button>`).join('')}
    </div>`).join('');
  list.querySelectorAll('.tb-card').forEach(el => {
    el.onclick = () => tbEditDialog(profile, TB.blocks.find(b => b.id === el.dataset.id));
  });
}

// ---------------- Dialog-Hilfen ----------------
function tbModal(html) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(scrim);
  document.documentElement.classList.add('menu-open');
  const close = () => { scrim.remove(); document.documentElement.classList.remove('menu-open'); };
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  return { el: scrim, close };
}

// ---------------- Baustein anlegen / bearbeiten ----------------
function tbEditDialog(profile, b) {
  const isNew = !b;
  b = b || { title: '', category_id: TB.cat || (TB.cats[0] && TB.cats[0].id) || null, active: true, tags: [],
    phase_id: TB.phase && TB.phase !== 'none' ? TB.phase : null, packages: PG_ALL_PKGS.slice(), task_type: 'quickwin', frequency: 'einmalig', tracking_type: 'keins' };
  const opts = (obj, cur) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');
  const m = tbModal(`
    <h2>${isNew ? 'Neuer Baustein' : 'Baustein bearbeiten'}</h2>
    <form id="tbForm" class="modal-form">
      <label class="wide">Titel<input type="text" id="f_title" required value="${esc(b.title)}" placeholder="z. B. Darmsanierung Phase 1"></label>
      <label>Themenfeld
        <select id="f_cat">
          <option value="">– ohne –</option>
          ${TB.cats.map(c => `<option value="${c.id}" ${c.id === b.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      <label>Phase
        <select id="f_phase">
          <option value="">– keine (nur manuell) –</option>
          ${TB.phases.map(p => `<option value="${p.id}" ${p.id === b.phase_id ? 'selected' : ''}>${p.no}. ${esc(p.name)}</option>`).join('')}
        </select>
      </label>
      <div class="wide pg-pkgs"><span>Sichtbar in Paket</span>
        ${PG.packages.map(p => `<label class="check"><input type="checkbox" class="f_pkg" value="${p.key}" ${(b.packages || []).includes(p.key) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}
      </div>
      <label>Typ<select id="f_type">${opts(Object.fromEntries(Object.entries(PG_TYPES).map(([k, v]) => [k, v.label])), b.task_type)}</select></label>
      <label>Zeitaufwand (Min.)<input type="number" id="f_min" min="0" max="600" value="${b.est_minutes ?? ''}" placeholder="z. B. 10"></label>
      <label>Frequenz<select id="f_freq">${opts(PG_FREQ, b.frequency)}</select></label>
      <label>Eintrag der Klient:in<select id="f_track">${opts(PG_TRACK, b.tracking_type)}</select></label>
      <label class="wide">Tracking-Frage <span class="muted">(erscheint &uuml;ber dem Eintrag, z. B. &bdquo;Wie erholt bist du aufgewacht?&ldquo;)</span><input type="text" id="f_tq" value="${esc(b.tracking_question || '')}"></label>
      <label>Zeitraum<input type="text" id="f_dur" value="${esc(b.duration || '')}" placeholder="z. B. 4 Wochen"></label>
      <label class="wide">Anwendung / Dosierung<input type="text" id="f_app" value="${esc(b.application || '')}" placeholder="z. B. 2× täglich 1 Kapsel zum Essen"></label>
      <label>Produkt / Hersteller<input type="text" id="f_prod" value="${esc(b.product || '')}"></label>
      <label>Link<input type="url" id="f_link" value="${esc(b.link_url || '')}" placeholder="https://…"></label>
      <label class="wide">Text f&uuml;r Patient:innen <span class="muted">(erscheint sp&auml;ter im Therapieplan)</span>
        <textarea id="f_pat" rows="4">${esc(b.patient_text || '')}</textarea></label>
      <label class="wide">Interne Notiz <span class="muted">(nur Praxis: Indikation, Hintergrund, Hinweise)</span>
        <textarea id="f_desc" rows="3">${esc(b.description || '')}</textarea></label>
      <label class="wide">Schlagworte <span class="muted">(mit Komma trennen)</span><input type="text" id="f_tags" value="${esc((b.tags || []).join(', '))}" placeholder="z. B. Darm, Histamin, Frauengesundheit"></label>
      <label class="wide check"><input type="checkbox" id="f_active" ${b.active ? 'checked' : ''}> aktiv (inaktive Bausteine bleiben gespeichert, werden aber ausgeblendet)</label>
      <div class="modal-actions wide">
        <button type="submit">Speichern</button>
        <button type="button" class="secondary" id="f_cancel">Abbrechen</button>
        ${isNew ? '' : '<span class="spacer"></span><button type="button" class="secondary" id="f_copy">Duplizieren</button><button type="button" class="danger" id="f_del">L&ouml;schen</button>'}
      </div>
      <p class="error wide" id="f_err"></p>
    </form>`);
  const $ = (id) => m.el.querySelector('#' + id);
  $('f_cancel').onclick = m.close;
  $('f_type').onchange = () => { const d = PG_TYPE_DEFAULTS[$('f_type').value]; $('f_freq').value = d.frequency; $('f_track').value = d.tracking_type; };
  const values = () => ({
    phase_id: $('f_phase').value || null,
    packages: [...m.el.querySelectorAll('.f_pkg:checked')].map(i => i.value),
    task_type: $('f_type').value,
    est_minutes: $('f_min').value ? parseInt($('f_min').value, 10) : null,
    frequency: $('f_freq').value,
    tracking_type: $('f_track').value,
    tracking_question: $('f_tq').value.trim() || null,
    title: $('f_title').value.trim(),
    category_id: $('f_cat').value || null,
    duration: $('f_dur').value.trim() || null,
    application: $('f_app').value.trim() || null,
    product: $('f_prod').value.trim() || null,
    link_url: $('f_link').value.trim() || null,
    patient_text: $('f_pat').value.trim() || null,
    description: $('f_desc').value.trim() || null,
    tags: $('f_tags').value.split(',').map(t => t.trim()).filter(Boolean),
    active: $('f_active').checked,
  });
  $('tbForm').onsubmit = async (e) => {
    e.preventDefault();
    const v = values();
    const res = isNew
      ? await sb.from('therapy_blocks').insert({ ...v, created_by: profile.id })
      : await sb.from('therapy_blocks').update(v).eq('id', b.id);
    if (res.error) { $('f_err').textContent = 'Fehler: ' + res.error.message; return; }
    m.close(); toast(isNew ? 'Baustein angelegt.' : 'Gespeichert.');
    renderBlocksPage(profile);
  };
  if (!isNew) {
    $('f_copy').onclick = async () => {
      const v = values(); v.title = v.title + ' (Kopie)';
      const { error } = await sb.from('therapy_blocks').insert({ ...v, created_by: profile.id });
      if (error) { $('f_err').textContent = 'Fehler: ' + error.message; return; }
      m.close(); toast('Kopie angelegt.'); renderBlocksPage(profile);
    };
    $('f_del').onclick = async () => {
      if (!confirm('„' + b.title + '“ endgültig löschen?\n\nTipp: „aktiv“ abwählen blendet den Baustein nur aus.')) return;
      const { error } = await sb.from('therapy_blocks').delete().eq('id', b.id);
      if (error) { $('f_err').textContent = 'Fehler: ' + error.message; return; }
      m.close(); toast('Gelöscht.'); renderBlocksPage(profile);
    };
  }
  $('f_title').focus();
}

// ---------------- Kategorien verwalten ----------------
function tbCatsDialog(profile) {
  const row = (c) => `
    <tr data-id="${c.id}">
      <td><input type="color" class="c_color" value="${esc(c.color)}"></td>
      <td><input type="text" class="c_name" value="${esc(c.name)}"></td>
      <td class="nowrap">
        <button type="button" class="secondary small-btn c_up" title="nach oben">&uarr;</button>
        <button type="button" class="secondary small-btn c_down" title="nach unten">&darr;</button>
        <button type="button" class="danger small-btn c_del">L&ouml;schen</button>
      </td>
    </tr>`;
  const m = tbModal(`
    <h2>Themenfelder</h2>
    <table class="tb-cattable"><tbody>${TB.cats.map(row).join('')}</tbody></table>
    <form id="c_new" class="inline-form" style="margin-top:14px;">
      <label>Neues Themenfeld<input type="text" id="c_newname" required placeholder="z. B. Haut"></label>
      <label>Farbe<input type="color" id="c_newcolor" value="#3ebae6"></label>
      <button type="submit">Hinzuf&uuml;gen</button>
    </form>
    <div class="modal-actions" style="margin-top:16px;">
      <button type="button" id="c_save">&Auml;nderungen speichern</button>
      <button type="button" class="secondary" id="c_close">Schlie&szlig;en</button>
    </div>
    <p class="hint">L&ouml;schen eines Themenfelds l&ouml;scht keine Bausteine &mdash; sie stehen danach unter &bdquo;Ohne Themenfeld&ldquo;.</p>
    <p class="error" id="c_err"></p>`);
  const $ = (s) => m.el.querySelector(s);
  const reopen = async () => { m.close(); await tbLoad(); tbCatsDialog(profile); };
  $('#c_close').onclick = () => { m.close(); renderBlocksPage(profile); };
  $('#c_new').onsubmit = async (e) => {
    e.preventDefault();
    const sort = (TB.cats.reduce((a, c) => Math.max(a, c.sort), 0) || 0) + 10;
    const { error } = await sb.from('block_categories').insert({ name: $('#c_newname').value.trim(), color: $('#c_newcolor').value, sort });
    if (error) { $('#c_err').textContent = error.code === '23505' ? 'Dieses Themenfeld gibt es schon.' : 'Fehler: ' + error.message; return; }
    reopen();
  };
  $('#c_save').onclick = async () => {
    const rows = [...m.el.querySelectorAll('tbody tr')];
    for (let i = 0; i < rows.length; i++) {
      const tr = rows[i];
      const { error } = await sb.from('block_categories').update({
        name: tr.querySelector('.c_name').value.trim(), color: tr.querySelector('.c_color').value, sort: (i + 1) * 10,
      }).eq('id', tr.dataset.id);
      if (error) { $('#c_err').textContent = 'Fehler: ' + error.message; return; }
    }
    toast('Themenfelder gespeichert.'); m.close(); renderBlocksPage(profile);
  };
  m.el.querySelectorAll('.c_up, .c_down').forEach(btn => {
    btn.onclick = () => {
      const tr = btn.closest('tr');
      if (btn.classList.contains('c_up') && tr.previousElementSibling) tr.parentNode.insertBefore(tr, tr.previousElementSibling);
      if (btn.classList.contains('c_down') && tr.nextElementSibling) tr.parentNode.insertBefore(tr.nextElementSibling, tr);
    };
  });
  m.el.querySelectorAll('.c_del').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.closest('tr').dataset.id;
      const c = tbCat(id);
      const n = TB.blocks.filter(b => b.category_id === id).length;
      if (!confirm('Themenfeld „' + c.name + '“ löschen?' + (n ? '\n\n' + n + ' Baustein(e) stehen danach unter „Ohne Themenfeld“.' : ''))) return;
      const { error } = await sb.from('block_categories').delete().eq('id', id);
      if (error) { $('#c_err').textContent = 'Fehler: ' + error.message; return; }
      reopen();
    };
  });
}

// ---------------- Übersicht: Anzahl Bausteine je Themenfeld × Phase (für ein Paket) ----------------
function tbMatrixDialog() {
  let pkgKey = TB.pkg || 'schichtwechsel';
  const m = tbModal(`<h2>&Uuml;bersicht Inhalte</h2>
    <label class="inline-label">Paket <select id="mx_pkg">${PG.packages.map(p => `<option value="${p.key}">${esc(p.name)}</option>`).join('')}</select></label>
    <div id="mx_tab" class="tablewrap" style="margin-top:12px;"></div>
    <p class="hint">Gez&auml;hlt werden aktive Bausteine mit Phase, die im Paket sichtbar sind. Die Zahlen in Klammern sind Wissen / Quick Win. Leere Felder sind grau, rot hei&szlig;t: es fehlt noch Wissen oder Quick Win.</p>
    <div class="modal-actions"><button type="button" id="mx_close">Schlie&szlig;en</button></div>`);
  m.el.querySelector('.modal').classList.add('wide-modal');
  const draw = () => {
    const pkg = pgPkg(pkgKey);
    const phases = TB.phases.filter(ph => (pkg.phases || []).includes(ph.no));
    const fit = TB.blocks.filter(b => pgBlockFits(b, pkg, TB.phases));
    const cell = (cat, ph) => {
      const l = fit.filter(b => b.category_id === cat && b.phase_id === ph);
      if (!l.length) return '<td class="mx-cell empty">&ndash;</td>';
      const w = l.filter(b => b.task_type === 'wissen').length, q = l.filter(b => b.task_type === 'quickwin').length;
      return `<td class="mx-cell${w && q ? '' : ' gap'}"><b>${l.length}</b> <small>(${w}/${q})</small></td>`;
    };
    m.el.querySelector('#mx_tab').innerHTML = `<table class="mx-table"><thead><tr><th>Themenfeld</th>${phases.map(ph => `<th>${ph.no}. ${esc(ph.name)}</th>`).join('')}</tr></thead>
      <tbody>${TB.cats.map(c => `<tr><td style="color:${c.color}">${esc(c.name)}</td>${phases.map(ph => cell(c.id, ph.id)).join('')}</tr>`).join('')}
      <tr class="mx-sum"><td>Summe</td>${phases.map(ph => `<td><b>${fit.filter(b => b.phase_id === ph.id).length}</b></td>`).join('')}</tr></tbody></table>
      <p class="muted" style="margin-top:8px;">Insgesamt ${fit.length} Aufgaben f&uuml;r ${esc(pkg.name)}${pkg.group_call ? ' &middot; inkl. Gruppencall' : ''}.</p>`;
  };
  const sel = m.el.querySelector('#mx_pkg'); sel.value = pkgKey;
  sel.onchange = () => { pkgKey = sel.value; draw(); };
  m.el.querySelector('#mx_close').onclick = m.close;
  draw();
}

// ---------------- Import / Export (Excel + JSON) ----------------
const tbPhaseLabel = (b) => { const p = tbPhase(b.phase_id); return p ? String(p.no) : ''; };
const TB_COLS = [
  ['Themenfeld', b => (tbCat(b.category_id) || {}).name || ''],
  ['Phase (1-4)', tbPhaseLabel],
  ['Pakete (P1, P2, P3)', b => (b.packages || []).map(k => PG_PKG_SHORT[k]).join(', ')],
  ['Typ', b => b.task_type],
  ['Titel', b => b.title],
  ['Text für Patient:innen', b => b.patient_text || ''],
  ['Anwendung / Dosierung', b => b.application || ''],
  ['Zeitaufwand (Min.)', b => b.est_minutes ?? ''],
  ['Frequenz', b => b.frequency],
  ['Tracking', b => b.tracking_type],
  ['Tracking-Frage', b => b.tracking_question || ''],
  ['Produkt / Hersteller', b => b.product || ''],
  ['Zeitraum', b => b.duration || ''],
  ['Interne Notiz', b => b.description || ''],
  ['Link', b => b.link_url || ''],
  ['Schlagworte', b => (b.tags || []).join(', ')],
  ['Aktiv', b => b.active ? 'ja' : 'nein'],
];

function tbXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => ok(window.XLSX); s.onerror = () => fail(new Error('Excel-Bibliothek konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
}

async function tbExport(templateOnly) {
  const X = await tbXlsx();
  const rows = templateOnly
    ? [['Schlaf', '2', 'P1, P2, P3', 'quickwin', 'Morgens 10 Minuten Tageslicht', 'Geh innerhalb der ersten Stunde nach dem Aufstehen für 10 Minuten nach draußen. Das Tageslicht stellt deine innere Uhr.', '', 10, 'taeglich', 'check', 'Warst du heute morgens draußen?', '', '4 Wochen', '', '', 'Schlaf, Licht', 'ja']]
    : TB.blocks.map(b => TB_COLS.map(([, f]) => f(b)));
  const ws = X.utils.aoa_to_sheet([TB_COLS.map(([h]) => h), ...rows]);
  ws['!cols'] = [24, 10, 16, 11, 34, 50, 28, 10, 12, 14, 30, 22, 12, 30, 24, 20, 8].map(w => ({ wch: w }));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Therapiebausteine');
  if (templateOnly) {
    const leg = [['Themenfelder'], ...TB.cats.map(c => [c.name]), [],
      ['Phasen'], ...TB.phases.map(p => [p.no + ' = ' + p.name]), [],
      ['Pakete'], ...PG.packages.map(p => [PG_PKG_SHORT[p.key] + ' = ' + p.name]), [],
      ['Typ'], ...Object.keys(PG_TYPES).map(k => [k]), [],
      ['Frequenz'], ...Object.keys(PG_FREQ).map(k => [k]), [],
      ['Tracking'], ...Object.keys(PG_TRACK).map(k => [k])];
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(leg), 'Werte');
  }
  X.writeFile(wb, templateOnly ? 'Therapiebausteine_Vorlage.xlsx' : 'Therapiebausteine_' + new Date().toISOString().slice(0, 10) + '.xlsx');
}

function tbImportInfo(profile) {
  const m = tbModal(`
    <h2>Bausteine importieren</h2>
    <p>So geht's:</p>
    <ol class="tb-steps">
      <li><b>Vorlage herunterladen</b> (Excel) &mdash; eine Zeile pro Baustein. Erlaubte Werte stehen im Blatt &bdquo;Werte&ldquo;.</li>
      <li>Ausf&uuml;llen. Pflicht ist nur <b>Titel</b>. Unbekannte Themenfelder werden automatisch neu angelegt.</li>
      <li><b>Datei hochladen</b> (.xlsx, .csv oder <b>.json</b>) &rarr; Vorschau pr&uuml;fen &rarr; &uuml;bernehmen.</li>
    </ol>
    <p class="hint"><b>JSON:</b> Aufgaben im Format des Struktur-Dokuments (Befehle AUFGABE_GENERIEREN / PAKET_INHALT_VOLLSTAENDIG / APP_EXPORT_JSON) k&ouml;nnen direkt hochgeladen werden &mdash; einzeln, als Liste oder gruppiert nach Paket &rarr; Phase &rarr; Themenfeld.</p>
    <p class="hint">Gibt es einen Baustein mit gleichem Titel im selben Themenfeld schon, wird er aktualisiert statt doppelt angelegt.</p>
    <div class="modal-actions">
      <button type="button" class="secondary" id="i_tpl">Vorlage herunterladen</button>
      <button type="button" id="i_up">Datei hochladen</button>
      <button type="button" class="secondary" id="i_close">Abbrechen</button>
    </div>`);
  m.el.querySelector('#i_close').onclick = m.close;
  m.el.querySelector('#i_tpl').onclick = () => tbExport(true).catch(e => toast(e.message));
  m.el.querySelector('#i_up').onclick = () => { m.close(); document.getElementById('tbFile').click(); };
}

// Excel-Zeilen → Bausteine
function tbRowsToItems(rows) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß0-9]/g, '');
  const pick = (r, ...names) => {
    const k = Object.keys(r).find(k => names.some(n => norm(k).startsWith(norm(n))));
    return k ? String(r[k]).trim() : '';
  };
  const lc = (v) => v.toLowerCase().replace('ä', 'ae').replace('ö', 'oe').replace(/[^a-z_]/g, '');
  return rows.map(r => {
    const type = lc(pick(r, 'Typ'));
    const t = PG_TYPES[type] ? type : 'quickwin';
    const freq = lc(pick(r, 'Frequenz'));
    const tr = lc(pick(r, 'Tracking-Feld', 'Tracking ', 'Trackingtyp')) || lc((() => { const k = Object.keys(r).find(k => norm(k) === 'tracking'); return k ? String(r[k]) : ''; })());
    const phNo = parseInt(pick(r, 'Phase'), 10);
    const pk = pick(r, 'Paket').toUpperCase();
    const min = parseInt(pick(r, 'Zeitaufwand', 'Minuten'), 10);
    return {
      cat: pick(r, 'Themenfeld', 'Kategorie'),
      title: pick(r, 'Titel', 'Name', 'Baustein'),
      phase_id: (TB.phases.find(p => p.no === phNo) || {}).id || null,
      packages: pk ? PG_ALL_PKGS.filter(k => pk.includes(PG_PKG_SHORT[k]) || pk.includes(k.toUpperCase())) : PG_ALL_PKGS.slice(),
      task_type: t,
      frequency: PG_FREQ[freq] ? freq : PG_TYPE_DEFAULTS[t].frequency,
      tracking_type: PG_TRACK[tr] ? tr : (PG_TRACK_IN[tr] || PG_TYPE_DEFAULTS[t].tracking_type),
      tracking_question: pick(r, 'Tracking-Frage', 'Trackingfrage') || null,
      est_minutes: isNaN(min) ? null : min,
      application: pick(r, 'Anwendung', 'Dosierung'),
      product: pick(r, 'Produkt', 'Hersteller'),
      duration: pick(r, 'Zeitraum', 'Dauer'),
      patient_text: pick(r, 'Text für Patient', 'Patiententext', 'Beschreibung', 'Text'),
      description: pick(r, 'Interne', 'Notiz'),
      link_url: pick(r, 'Link', 'URL'),
      tags: pick(r, 'Schlagwort', 'Tags').split(',').map(t => t.trim()).filter(Boolean),
      active: !/^(nein|no|0|false)$/i.test(pick(r, 'Aktiv')),
    };
  }).filter(x => x.title);
}

async function tbImportFile(profile, file) {
  let items;
  try {
    if (/\.json$/i.test(file.name)) {
      const tasks = pgCollectTasks(JSON.parse(await file.text()));
      items = tasks.map(o => {
        const t = pgTaskFromJson(o, TB.phases, TB.cats);
        return { ...t, cat: t._catOk ? tbCat(t.category_id).name : t._cat, tags: [], link_url: null, product: null, duration: null };
      }).filter(x => x.title);
    } else {
      const X = await tbXlsx();
      const wb = X.read(await file.arrayBuffer(), { type: 'array' });
      items = tbRowsToItems(X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
    }
  } catch (e) { toast('Datei nicht lesbar: ' + e.message); return; }
  if (!items.length) { toast('Keine Aufgaben mit Titel gefunden.'); return; }
  const newCats = [...new Set(items.map(i => i.cat).filter(c => c && !TB.cats.some(x => x.name.toLowerCase() === c.toLowerCase())))];
  const noPhase = items.filter(i => !i.phase_id).length;
  const m = tbModal(`
    <h2>Vorschau: ${items.length} Bausteine</h2>
    ${newCats.length ? `<p class="notice">Neue Themenfelder werden angelegt: ${newCats.map(esc).join(', ')}</p>` : ''}
    ${noPhase ? `<p class="notice">&#9888; ${noPhase} Baustein(e) ohne erkennbare Phase &mdash; sie werden nicht automatisch in Pl&auml;ne &uuml;bernommen (Phase sp&auml;ter im Baustein setzen).</p>` : ''}
    <div class="tablewrap" style="max-height:50vh;overflow:auto;">
      <table><thead><tr><th>Themenfeld</th><th>Phase</th><th>Pakete</th><th>Typ</th><th>Titel</th></tr></thead>
      <tbody>${items.map(i => `<tr><td>${esc(i.cat || '–')}</td><td>${(tbPhase(i.phase_id) || {}).no || '<span class="error">?</span>'}</td><td>${i.packages.map(k => PG_PKG_SHORT[k]).join(' ')}</td><td>${PG_TYPES[i.task_type].label}</td><td>${esc(i.title)}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="modal-actions" style="margin-top:14px;">
      <button type="button" id="p_ok">&Uuml;bernehmen</button>
      <button type="button" class="secondary" id="p_cancel">Abbrechen</button>
    </div>
    <p class="error" id="p_err"></p>`);
  m.el.querySelector('.modal').classList.add('wide-modal');
  m.el.querySelector('#p_cancel').onclick = m.close;
  m.el.querySelector('#p_ok').onclick = async (e) => {
    e.target.disabled = true;
    const err = m.el.querySelector('#p_err');
    let sort = TB.cats.reduce((a, c) => Math.max(a, c.sort), 0);
    for (const name of newCats) {
      sort += 10;
      const { error } = await sb.from('block_categories').insert({ name, sort });
      if (error && error.code !== '23505') { err.textContent = 'Fehler: ' + error.message; e.target.disabled = false; return; }
    }
    await tbLoad();
    const catId = (name) => { const c = TB.cats.find(x => x.name.toLowerCase() === (name || '').toLowerCase()); return c ? c.id : null; };
    let added = 0, updated = 0;
    for (const it of items) {
      const v = { title: it.title, category_id: catId(it.cat), application: it.application || null, product: it.product || null,
        duration: it.duration || null, patient_text: it.patient_text || null, description: it.description || null,
        link_url: it.link_url || null, tags: it.tags || [], active: it.active,
        phase_id: it.phase_id, packages: it.packages, task_type: it.task_type, est_minutes: it.est_minutes,
        frequency: it.frequency, tracking_type: it.tracking_type, tracking_question: it.tracking_question };
      const ex = TB.blocks.find(b => b.title.toLowerCase() === it.title.toLowerCase() && b.category_id === v.category_id);
      const { error } = ex ? await sb.from('therapy_blocks').update(v).eq('id', ex.id)
                           : await sb.from('therapy_blocks').insert({ ...v, created_by: profile.id });
      if (error) { err.textContent = 'Fehler bei „' + it.title + '“: ' + error.message; e.target.disabled = false; return; }
      ex ? updated++ : added++;
    }
    m.close();
    toast(added + ' neu, ' + updated + ' aktualisiert.');
    renderBlocksPage(profile);
  };
}
