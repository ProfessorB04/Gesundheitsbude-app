// ============================================================
// Gesundheitsbude-App — Therapiebausteine-Datenbank (nur Admin + Team)
// Kategorien frei anlegbar, Bausteine suchen/filtern/bearbeiten, Import/Export Excel
// ============================================================
const TB = { cats: [], blocks: [], q: '', cat: '', showInactive: false };

async function tbLoad() {
  const [c, b] = await Promise.all([
    sb.from('block_categories').select('*').order('sort').order('name'),
    sb.from('therapy_blocks').select('*').order('title'),
  ]);
  if (c.error || b.error) throw new Error((c.error || b.error).message);
  TB.cats = c.data || [];
  TB.blocks = b.data || [];
}

const tbCat = (id) => TB.cats.find(c => c.id === id);

async function renderBlocksPage(profile) {
  if (!isStaff(profile)) { renderMenu(profile); return; }
  TB.profile = profile;
  try { await tbLoad(); }
  catch (e) { renderShell(profile, 'bausteine', 'Therapiebausteine', `<div class="card"><p class="error">Laden fehlgeschlagen: ${esc(e.message)}</p></div>`); return; }

  const content = `
    <div class="tb-toolbar">
      <input type="search" id="tbSearch" placeholder="Suchen: Titel, Text, Produkt, Schlagwort &hellip;" value="${esc(TB.q)}">
      <button type="button" id="tbNew">+ Baustein</button>
      <button type="button" class="secondary" id="tbCats">Kategorien</button>
      <button type="button" class="secondary" id="tbImport">Import</button>
      <button type="button" class="secondary" id="tbExport">Export</button>
      <input type="file" id="tbFile" accept=".xlsx,.xls,.csv" hidden>
    </div>
    <div class="tb-filter" id="tbFilter"></div>
    <label class="tb-inactive"><input type="checkbox" id="tbInactive" ${TB.showInactive ? 'checked' : ''}> auch inaktive Bausteine zeigen</label>
    <div id="tbList"></div>`;
  renderShell(profile, 'bausteine', 'Therapiebausteine', content);

  const redraw = () => { tbDrawFilter(); tbDrawList(profile); };
  document.getElementById('tbSearch').oninput = (e) => { TB.q = e.target.value; tbDrawList(profile); };
  document.getElementById('tbInactive').onchange = (e) => { TB.showInactive = e.target.checked; redraw(); };
  document.getElementById('tbNew').onclick = () => tbEditDialog(profile, null);
  document.getElementById('tbCats').onclick = () => tbCatsDialog(profile);
  document.getElementById('tbExport').onclick = () => tbExport();
  document.getElementById('tbImport').onclick = () => tbImportInfo(profile);
  document.getElementById('tbFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) tbImportFile(profile, f); };
  redraw();
}

function tbDrawFilter() {
  const counts = {};
  TB.blocks.forEach(b => { if (b.active || TB.showInactive) counts[b.category_id || ''] = (counts[b.category_id || ''] || 0) + 1; });
  const chip = (id, name, color, n) => `<button type="button" class="tb-chip${TB.cat === id ? ' on' : ''}" data-cat="${id}" style="--c:${color}">${esc(name)} <span>${n}</span></button>`;
  document.getElementById('tbFilter').innerHTML =
    chip('', 'Alle', '#ffffff', Object.values(counts).reduce((a, b) => a + b, 0)) +
    TB.cats.map(c => chip(c.id, c.name, c.color, counts[c.id] || 0)).join('');
  document.querySelectorAll('.tb-chip').forEach(btn => {
    btn.onclick = () => { TB.cat = btn.dataset.cat; tbDrawFilter(); tbDrawList(TB.profile); };
  });
}

function tbMatches(b) {
  if (!b.active && !TB.showInactive) return false;
  if (TB.cat && b.category_id !== TB.cat) return false;
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
  const groups = [...TB.cats, { id: null, name: 'Ohne Kategorie', color: '#a0a0b8' }]
    .map(c => ({ c, items: shown.filter(b => (b.category_id || null) === c.id) }))
    .filter(g => g.items.length);
  list.innerHTML = groups.map(g => `
    <h3 class="tb-group" style="--c:${g.c.color}">${esc(g.c.name)} <span>${g.items.length}</span></h3>
    <div class="tb-grid">
      ${g.items.map(b => `
        <button type="button" class="tb-card${b.active ? '' : ' inactive'}" data-id="${b.id}" style="--c:${g.c.color}">
          <span class="tb-title">${esc(b.title)}${b.active ? '' : ' <em>(inaktiv)</em>'}</span>
          ${b.application ? `<span class="tb-line">&#128138; ${esc(b.application)}</span>` : ''}
          ${b.product ? `<span class="tb-line">&#127991; ${esc(b.product)}</span>` : ''}
          ${b.duration ? `<span class="tb-line">&#9201; ${esc(b.duration)}</span>` : ''}
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
  b = b || { title: '', category_id: TB.cat || (TB.cats[0] && TB.cats[0].id) || null, active: true, tags: [] };
  const m = tbModal(`
    <h2>${isNew ? 'Neuer Baustein' : 'Baustein bearbeiten'}</h2>
    <form id="tbForm" class="modal-form">
      <label class="wide">Titel<input type="text" id="f_title" required value="${esc(b.title)}" placeholder="z. B. Darmsanierung Phase 1"></label>
      <label>Kategorie
        <select id="f_cat">
          <option value="">– ohne –</option>
          ${TB.cats.map(c => `<option value="${c.id}" ${c.id === b.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      <label>Dauer<input type="text" id="f_dur" value="${esc(b.duration || '')}" placeholder="z. B. 4 Wochen"></label>
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
  const values = () => ({
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
    <h2>Kategorien</h2>
    <table class="tb-cattable"><tbody>${TB.cats.map(row).join('')}</tbody></table>
    <form id="c_new" class="inline-form" style="margin-top:14px;">
      <label>Neue Kategorie<input type="text" id="c_newname" required placeholder="z. B. Hormone"></label>
      <label>Farbe<input type="color" id="c_newcolor" value="#3ebae6"></label>
      <button type="submit">Hinzuf&uuml;gen</button>
    </form>
    <div class="modal-actions" style="margin-top:16px;">
      <button type="button" id="c_save">&Auml;nderungen speichern</button>
      <button type="button" class="secondary" id="c_close">Schlie&szlig;en</button>
    </div>
    <p class="hint">L&ouml;schen einer Kategorie l&ouml;scht keine Bausteine &mdash; sie stehen danach unter &bdquo;Ohne Kategorie&ldquo;.</p>
    <p class="error" id="c_err"></p>`);
  const $ = (s) => m.el.querySelector(s);
  const reopen = async () => { m.close(); await tbLoad(); tbCatsDialog(profile); };
  $('#c_close').onclick = () => { m.close(); renderBlocksPage(profile); };
  $('#c_new').onsubmit = async (e) => {
    e.preventDefault();
    const sort = (TB.cats.reduce((a, c) => Math.max(a, c.sort), 0) || 0) + 10;
    const { error } = await sb.from('block_categories').insert({ name: $('#c_newname').value.trim(), color: $('#c_newcolor').value, sort });
    if (error) { $('#c_err').textContent = error.code === '23505' ? 'Diese Kategorie gibt es schon.' : 'Fehler: ' + error.message; return; }
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
    toast('Kategorien gespeichert.'); m.close(); renderBlocksPage(profile);
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
      if (!confirm('Kategorie „' + c.name + '“ löschen?' + (n ? '\n\n' + n + ' Baustein(e) stehen danach unter „Ohne Kategorie“.' : ''))) return;
      const { error } = await sb.from('block_categories').delete().eq('id', id);
      if (error) { $('#c_err').textContent = 'Fehler: ' + error.message; return; }
      reopen();
    };
  });
}

// ---------------- Import / Export (Excel) ----------------
const TB_COLS = [
  ['Kategorie', b => (tbCat(b.category_id) || {}).name || ''],
  ['Titel', b => b.title],
  ['Anwendung / Dosierung', b => b.application || ''],
  ['Produkt / Hersteller', b => b.product || ''],
  ['Dauer', b => b.duration || ''],
  ['Text für Patient:innen', b => b.patient_text || ''],
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
    ? [['Ernährung', 'Beispiel: Anti-entzündliche Ernährung', '', '', '6 Wochen', 'Was die Patientin dazu lesen soll …', 'Hinweise für die Praxis …', '', 'Entzündung, Darm', 'ja']]
    : TB.blocks.map(b => TB_COLS.map(([, f]) => f(b)));
  const ws = X.utils.aoa_to_sheet([TB_COLS.map(([h]) => h), ...rows]);
  ws['!cols'] = [18, 34, 30, 24, 12, 50, 40, 30, 24, 8].map(w => ({ wch: w }));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Therapiebausteine');
  if (templateOnly) {
    const cats = X.utils.aoa_to_sheet([['Vorhandene Kategorien'], ...TB.cats.map(c => [c.name])]);
    X.utils.book_append_sheet(wb, cats, 'Kategorien');
  }
  X.writeFile(wb, templateOnly ? 'Therapiebausteine_Vorlage.xlsx' : 'Therapiebausteine_' + new Date().toISOString().slice(0, 10) + '.xlsx');
}

function tbImportInfo(profile) {
  const m = tbModal(`
    <h2>Bausteine importieren</h2>
    <p>So geht's:</p>
    <ol class="tb-steps">
      <li><b>Vorlage herunterladen</b> (Excel) &mdash; eine Zeile pro Baustein.</li>
      <li>Ausf&uuml;llen. Pflicht ist nur <b>Titel</b>. Unbekannte Kategorien werden automatisch neu angelegt.</li>
      <li><b>Datei hochladen</b> (.xlsx oder .csv) &rarr; Vorschau pr&uuml;fen &rarr; &uuml;bernehmen.</li>
    </ol>
    <p class="hint">Gibt es einen Baustein mit gleichem Titel in derselben Kategorie schon, wird er aktualisiert statt doppelt angelegt.</p>
    <div class="modal-actions">
      <button type="button" class="secondary" id="i_tpl">Vorlage herunterladen</button>
      <button type="button" id="i_up">Datei hochladen</button>
      <button type="button" class="secondary" id="i_close">Abbrechen</button>
    </div>`);
  m.el.querySelector('#i_close').onclick = m.close;
  m.el.querySelector('#i_tpl').onclick = () => tbExport(true).catch(e => toast(e.message));
  m.el.querySelector('#i_up').onclick = () => { m.close(); document.getElementById('tbFile').click(); };
}

async function tbImportFile(profile, file) {
  let rows;
  try {
    const X = await tbXlsx();
    const wb = X.read(await file.arrayBuffer(), { type: 'array' });
    rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } catch (e) { toast('Datei nicht lesbar: ' + e.message); return; }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß]/g, '');
  const pick = (r, ...names) => {
    const k = Object.keys(r).find(k => names.some(n => norm(k).startsWith(norm(n))));
    return k ? String(r[k]).trim() : '';
  };
  const items = rows.map(r => ({
    cat: pick(r, 'Kategorie'),
    title: pick(r, 'Titel', 'Name', 'Baustein'),
    application: pick(r, 'Anwendung', 'Dosierung'),
    product: pick(r, 'Produkt', 'Hersteller'),
    duration: pick(r, 'Dauer'),
    patient_text: pick(r, 'Text für Patient', 'Patiententext', 'Text'),
    description: pick(r, 'Interne', 'Notiz', 'Beschreibung'),
    link_url: pick(r, 'Link', 'URL'),
    tags: pick(r, 'Schlagwort', 'Tags').split(',').map(t => t.trim()).filter(Boolean),
    active: !/^(nein|no|0|false)$/i.test(pick(r, 'Aktiv')),
  })).filter(x => x.title);
  if (!items.length) { toast('Keine Zeilen mit Titel gefunden.'); return; }
  const newCats = [...new Set(items.map(i => i.cat).filter(c => c && !TB.cats.some(x => x.name.toLowerCase() === c.toLowerCase())))];
  const m = tbModal(`
    <h2>Vorschau: ${items.length} Bausteine</h2>
    ${newCats.length ? `<p class="notice">Neue Kategorien werden angelegt: ${newCats.map(esc).join(', ')}</p>` : ''}
    <div class="tablewrap" style="max-height:50vh;overflow:auto;">
      <table><thead><tr><th>Kategorie</th><th>Titel</th><th>Anwendung</th><th>Produkt</th></tr></thead>
      <tbody>${items.map(i => `<tr><td>${esc(i.cat || '–')}</td><td>${esc(i.title)}</td><td>${esc(i.application)}</td><td>${esc(i.product)}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="modal-actions" style="margin-top:14px;">
      <button type="button" id="p_ok">&Uuml;bernehmen</button>
      <button type="button" class="secondary" id="p_cancel">Abbrechen</button>
    </div>
    <p class="error" id="p_err"></p>`);
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
        link_url: it.link_url || null, tags: it.tags, active: it.active };
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
