// ============================================================
// Gesundheitsbude-App — Tagebuch
// Praxis: Kategorien mit eigenen Feldern bauen, je Klient:in zuweisen, Einträge + Verlauf ansehen
// Klient:in: „Mein Tagebuch“ — Tag wählen, je zugewiesener Kategorie eintragen
// ============================================================
const DI = { cats: [], fields: {} };
const DI_TYPES = {
  scale: 'Skala', yesno: 'Ja / Nein', number: 'Zahl', text: 'Freitext', choice: 'Auswahl', time: 'Uhrzeit',
};
const DI_FREQ = { daily: 'täglich', weekly: 'wöchentlich', free: 'bei Bedarf' };

async function diLoad() {
  const [c, f] = await Promise.all([
    sb.from('diary_categories').select('*').order('sort').order('name'),
    sb.from('diary_fields').select('*').order('sort'),
  ]);
  if (c.error) throw new Error(c.error.message);
  DI.cats = c.data || [];
  DI.fields = {};
  (f.data || []).forEach(x => { (DI.fields[x.category_id] = DI.fields[x.category_id] || []).push(x); });
}
const diCat = (id) => DI.cats.find(c => c.id === id);
const diIso = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const diToday = () => diIso(new Date());
const diAddDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return diIso(d); };
const diFmt = (iso, long) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: '2-digit', month: '2-digit' });
const diMonday = (iso) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return diIso(d); };

// ---------- Werte anzeigen / eingeben ----------
function diValueText(f, v) {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '';
  const o = f.options || {};
  if (f.type === 'yesno') return v ? 'ja' : 'nein';
  if (f.type === 'scale') return `${Number(v).toLocaleString('de-DE')} / ${o.max ?? 10}`;
  if (f.type === 'number') return `${Number(v).toLocaleString('de-DE')}${o.unit ? ' ' + o.unit : ''}`;
  if (f.type === 'choice') return Array.isArray(v) ? v.join(', ') : String(v);
  return String(v);
}

function diEntrySummary(e) {
  const fs = DI.fields[e.category_id] || [];
  const parts = fs.map(f => {
    const t = diValueText(f, (e.values || {})[f.id]);
    return t ? `<span class="di-val"><i>${esc(f.label)}:</i> ${esc(t)}</span>` : '';
  }).filter(Boolean);
  return `${e.entry_time ? `<span class="di-time">${e.entry_time.slice(0, 5)}</span>` : ''}${parts.join('') || '<span class="muted">leer</span>'}${e.note ? `<div class="di-note">&#128172; ${esc(e.note)}</div>` : ''}`;
}

function diFieldInput(f, v) {
  const o = f.options || {};
  const name = 'f_' + f.id;
  const req = f.required ? ' <span class="di-req">*</span>' : '';
  let ctl = '';
  if (f.type === 'scale') {
    const min = o.min ?? 1, max = o.max ?? 10;
    let btns = '';
    for (let i = min; i <= max; i++) btns += `<button type="button" class="di-scale-btn${String(v) === String(i) ? ' on' : ''}" data-v="${i}">${i}</button>`;
    ctl = `<div class="di-scale" data-name="${name}" data-val="${v ?? ''}" style="grid-template-columns:repeat(${max - min + 1}, 1fr)">${btns}</div>
      ${o.minLabel || o.maxLabel ? `<div class="di-scale-lbl"><span>${esc(o.minLabel || '')}</span><span>${esc(o.maxLabel || '')}</span></div>` : ''}`;
  } else if (f.type === 'yesno') {
    ctl = `<div class="di-choice yesno" data-name="${name}" data-val="${v === true ? 'true' : v === false ? 'false' : ''}">
      <button type="button" class="di-opt${v === true ? ' on' : ''}" data-v="true">Ja</button>
      <button type="button" class="di-opt${v === false ? ' on' : ''}" data-v="false">Nein</button></div>`;
  } else if (f.type === 'choice') {
    const sel = Array.isArray(v) ? v : (v ? [v] : []);
    ctl = `<div class="di-choice${o.multi ? ' multi' : ''}" data-name="${name}" data-val='${esc(JSON.stringify(sel)).replace(/'/g, '&#39;')}'>
      ${(o.choices || []).map(c => `<button type="button" class="di-opt${sel.includes(c) ? ' on' : ''}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      ${o.multi ? '<div class="hint" style="margin-top:4px;">Mehrfachauswahl m&ouml;glich</div>' : ''}`;
  } else if (f.type === 'number') {
    ctl = `<div class="di-num"><input type="number" inputmode="decimal" step="any" name="${name}" value="${esc(v ?? '')}">${o.unit ? `<span>${esc(o.unit)}</span>` : ''}</div>`;
  } else if (f.type === 'time') {
    ctl = `<input type="time" name="${name}" value="${esc(v ?? '')}">`;
  } else {
    ctl = `<textarea name="${name}" rows="2">${esc(v ?? '')}</textarea>`;
  }
  return `<div class="di-field" data-field="${f.id}"><div class="di-flabel">${esc(f.label)}${req}</div>${ctl}</div>`;
}

function diWireInputs(host) {
  host.querySelectorAll('.di-scale').forEach(box => {
    box.querySelectorAll('button').forEach(b => { b.onclick = () => {
      const same = box.dataset.val === b.dataset.v;
      box.dataset.val = same ? '' : b.dataset.v;
      box.querySelectorAll('button').forEach(x => x.classList.toggle('on', !same && x === b));
    }; });
  });
  host.querySelectorAll('.di-choice').forEach(box => {
    const multi = box.classList.contains('multi');
    const isYes = box.classList.contains('yesno');
    box.querySelectorAll('button').forEach(b => { b.onclick = () => {
      if (isYes) {
        const same = box.dataset.val === b.dataset.v;
        box.dataset.val = same ? '' : b.dataset.v;
        box.querySelectorAll('button').forEach(x => x.classList.toggle('on', !same && x === b));
        return;
      }
      let sel = []; try { sel = JSON.parse(box.dataset.val || '[]'); } catch (e) {}
      if (multi) sel = sel.includes(b.dataset.v) ? sel.filter(x => x !== b.dataset.v) : [...sel, b.dataset.v];
      else sel = sel[0] === b.dataset.v ? [] : [b.dataset.v];
      box.dataset.val = JSON.stringify(sel);
      box.querySelectorAll('button').forEach(x => x.classList.toggle('on', sel.includes(x.dataset.v)));
    }; });
  });
}

function diReadValues(host, fields) {
  const vals = {}; const missing = [];
  fields.forEach(f => {
    const wrap = host.querySelector(`[data-field="${f.id}"]`);
    let v = null;
    if (f.type === 'scale') { const d = wrap.querySelector('.di-scale').dataset.val; v = d === '' ? null : Number(d); }
    else if (f.type === 'yesno') { const d = wrap.querySelector('.di-choice').dataset.val; v = d === '' ? null : d === 'true'; }
    else if (f.type === 'choice') { let s = []; try { s = JSON.parse(wrap.querySelector('.di-choice').dataset.val || '[]'); } catch (e) {} v = s.length ? ((f.options || {}).multi ? s : s[0]) : null; }
    else if (f.type === 'number') { const d = wrap.querySelector('input').value; v = d === '' ? null : Number(d); }
    else { const d = wrap.querySelector('input, textarea').value.trim(); v = d || null; }
    if (v !== null) vals[f.id] = v;
    else if (f.required) missing.push(f.label);
  });
  return { vals, missing };
}

// Eintrag anlegen / bearbeiten (Klient:in oder Praxis)
function diEntryDialog(patientId, cat, date, entry, done) {
  const fields = DI.fields[cat.id] || [];
  const nowT = new Date().toTimeString().slice(0, 5);
  const m = tbModal(`
    <h2>${cat.icon} ${esc(cat.name)}</h2>
    <p class="hint" style="margin-top:-6px;">${diFmt(entry ? entry.entry_date : date, true)}${cat.description ? ' &middot; ' + esc(cat.description) : ''}</p>
    <form id="deForm" class="di-form">
      ${fields.map(f => diFieldInput(f, entry ? (entry.values || {})[f.id] : undefined)).join('')}
      <div class="di-field"><div class="di-flabel">Uhrzeit <span class="muted">(optional)</span></div><input type="time" id="de_time" value="${esc(entry ? (entry.entry_time || '').slice(0, 5) : nowT)}"></div>
      <div class="di-field"><div class="di-flabel">Notiz <span class="muted">(optional)</span></div><textarea id="de_note" rows="2">${esc(entry ? entry.note || '' : '')}</textarea></div>
      <div class="modal-actions">
        <button type="submit">Speichern</button>
        <button type="button" class="secondary" id="de_cancel">Abbrechen</button>
        ${entry ? '<span class="spacer"></span><button type="button" class="danger" id="de_del">L&ouml;schen</button>' : ''}
      </div>
      <p class="error" id="de_err"></p>
    </form>`);
  const $ = (id) => m.el.querySelector('#' + id);
  diWireInputs(m.el);
  $('de_cancel').onclick = m.close;
  $('deForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const { vals, missing } = diReadValues(m.el, fields);
    if (missing.length) { $('de_err').textContent = 'Bitte ausfüllen: ' + missing.join(', '); return; }
    const row = { values: vals, entry_time: $('de_time').value || null, note: $('de_note').value.trim() || null };
    const res = entry
      ? await sb.from('diary_entries').update(row).eq('id', entry.id)
      : await sb.from('diary_entries').insert({ ...row, patient_id: patientId, category_id: cat.id, entry_date: date });
    if (res.error) { $('de_err').textContent = 'Fehler: ' + res.error.message; return; }
    m.close(); toast('Eintrag gespeichert.'); done();
  };
  if (entry) $('de_del').onclick = async () => {
    if (!confirm('Eintrag löschen?')) return;
    const { error } = await sb.from('diary_entries').delete().eq('id', entry.id);
    if (error) { $('de_err').textContent = 'Fehler: ' + error.message; return; }
    m.close(); toast('Gelöscht.'); done();
  };
}

// Ist die Zuweisung an einem Tag aktiv (Zeitraum)?
const diActiveOn = (a, iso) => a.active && a.start_date <= iso && (!a.end_date || a.end_date >= iso);

// ============================================================
// Klient:in: Mein Tagebuch
// ============================================================
async function renderMyDiary(profile, date) {
  date = date || diToday();
  await diLoad();
  const weekStart = diMonday(date);
  const from = diAddDays(date, -6) < weekStart ? diAddDays(date, -6) : weekStart;
  const [as, en, rt, md] = await Promise.all([
    sb.from('diary_assignments').select('*').eq('patient_id', profile.id),
    sb.from('diary_entries').select('*').eq('patient_id', profile.id).gte('entry_date', from).lte('entry_date', diAddDays(weekStart, 6)).order('entry_time'),
    rtLoadMine(profile, from, diAddDays(weekStart, 6)),
    mdLoadMine(profile, from, diAddDays(weekStart, 6)),
  ]);
  const assigns = (as.data || []).filter(a => diCat(a.category_id) && diCat(a.category_id).active);
  const entries = en.data || [];
  const canEdit = perm(profile, 'tagebuch') === 'edit';
  const today = diToday();
  const activeToday = assigns.filter(a => diActiveOn(a, date));

  // Wochenleiste (Mo–So) mit Punkten je Kategorie
  const week = Array.from({ length: 7 }, (_, i) => diAddDays(weekStart, i));
  const strip = week.map(d => {
    const dots = assigns.filter(a => diActiveOn(a, d)).map(a => {
      const c = diCat(a.category_id);
      const has = entries.some(e => e.entry_date === d && e.category_id === a.category_id);
      return `<i class="${has ? 'on' : ''}" style="--c:${c.color}"></i>`;
    }).join('') + (() => { const st = rtDayState(rt, d); return st ? `<i class="rt-dot ${st}" title="Routinen"></i>` : ''; })()
      + (() => { const st = mdDayState(md, d); return st ? `<i class="md-dot ${st}" title="Einnahmen"></i>` : ''; })();
    return `<button type="button" class="di-day${d === date ? ' sel' : ''}${d === today ? ' today' : ''}" data-day="${d}" ${d > today ? 'disabled' : ''}>
      <span>${new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short' })}</span><b>${d.slice(8)}</b><div class="di-dots">${dots}</div></button>`;
  }).join('');

  const cards = activeToday.map(a => {
    const c = diCat(a.category_id);
    const list = entries.filter(e => e.entry_date === date && e.category_id === c.id);
    const weekDone = a.frequency === 'weekly' && entries.some(e => e.category_id === c.id && e.entry_date >= weekStart && e.entry_date <= diAddDays(weekStart, 6));
    const state = list.length ? '<span class="status-pill ok">&#10003; eingetragen</span>'
      : (a.frequency === 'weekly' && weekDone ? '<span class="status-pill ok">&#10003; diese Woche erledigt</span>'
      : (a.frequency === 'free' ? '' : '<span class="status-pill half">noch offen</span>'));
    return `<div class="di-card" style="--c:${c.color}">
      <div class="di-card-head">
        <div class="di-icon">${c.icon}</div>
        <div style="flex:1;min-width:0;"><div class="di-card-title">${esc(c.name)}</div>
          <div class="di-card-sub">${DI_FREQ[a.frequency]}${c.description ? ' &middot; ' + esc(c.description) : ''}</div></div>
        ${state}
      </div>
      ${a.note ? `<div class="di-pnote">&#128204; ${esc(a.note)}</div>` : ''}
      <div class="di-entries">${list.map(e => `<div class="di-entry${canEdit ? ' click' : ''}" data-entry="${e.id}">${diEntrySummary(e)}</div>`).join('')}</div>
      ${canEdit ? `<button type="button" class="${list.length ? 'secondary ' : ''}di-add" data-add="${c.id}">+ ${list.length ? 'weiterer Eintrag' : 'Eintrag'}</button>` : ''}
    </div>`;
  }).join('');

  const content = `
    <div class="di-nav">
      <button type="button" class="secondary small-btn" id="diPrev">&larr;</button>
      <div class="di-date">${date === today ? 'Heute' : diFmt(date, true)}</div>
      <button type="button" class="secondary small-btn" id="diNext" ${date >= today ? 'disabled' : ''}>&rarr;</button>
      ${date !== today ? '<button type="button" class="secondary small-btn" id="diToday">Heute</button>' : ''}
    </div>
    <div class="di-week">${strip}</div>
    ${mdMineHtml(md, date, canEdit)}
    ${rtMineHtml(rt, date, canEdit)}
    ${!assigns.length ? (rt.assigns.length || md.items.length ? '' : '<div class="card"><h2>Noch nichts zugewiesen</h2><p class="muted">Die Praxis legt fest, was du in dein Tagebuch eintr&auml;gst. Sobald das passiert ist, erscheint es hier.</p></div>')
      : (cards || (rt.assigns.some(a => rtActiveOn(a, date)) || md.items.length ? '' : '<div class="card"><p class="muted">F&uuml;r diesen Tag ist nichts vorgesehen.</p></div>'))}
    ${canEdit ? '' : '<p class="hint">Du kannst dein Tagebuch ansehen. Eintragen ist f&uuml;r dich gerade nicht freigeschaltet.</p>'}`;
  renderShell(profile, 'meintagebuch', 'Mein Tagebuch', content);
  const again = () => renderMyDiary(profile, date);
  document.getElementById('diPrev').onclick = () => renderMyDiary(profile, diAddDays(date, -1));
  document.getElementById('diNext').onclick = () => { if (date < today) renderMyDiary(profile, diAddDays(date, 1)); };
  const t = document.getElementById('diToday'); if (t) t.onclick = () => renderMyDiary(profile, today);
  appEl.querySelectorAll('[data-day]').forEach(b => { b.onclick = () => renderMyDiary(profile, b.dataset.day); });
  appEl.querySelectorAll('[data-add]').forEach(b => { b.onclick = () => diEntryDialog(profile.id, diCat(b.dataset.add), date, null, again); });
  if (canEdit) { rtWireMine(profile, rt, date, again); mdWireMine(profile, md, date, again); }
  if (canEdit) appEl.querySelectorAll('[data-entry]').forEach(el => {
    el.onclick = () => { const e = entries.find(x => x.id === el.dataset.entry); diEntryDialog(profile.id, diCat(e.category_id), e.entry_date, e, again); };
  });
}

// ============================================================
// Praxis: Tagebuch-Übersicht (Klient:innen | Kategorien)
// ============================================================
let DI_TAB = 'patients';
async function renderDiaryAdmin(profile, tab) {
  if (!isStaff(profile)) { renderMenu(profile); return; }
  DI_TAB = tab || DI_TAB;
  await diLoad();
  const tabs = `<div class="di-tabs">
    <button type="button" class="${DI_TAB === 'patients' ? 'on' : ''}" data-tab="patients">Klient:innen</button>
    <button type="button" class="${DI_TAB === 'routines' ? 'on' : ''}" data-tab="routines">Routinen</button>
    <button type="button" class="${DI_TAB === 'cats' ? 'on' : ''}" data-tab="cats">Kategorien &amp; Felder</button></div>`;
  let body = '';
  if (DI_TAB === 'routines') { rtRenderLibrary(profile, tabs); return; }
  if (DI_TAB === 'cats') {
    body = `<div class="modal-actions" style="margin-bottom:14px;"><button type="button" id="diNewCat">+ Kategorie</button>
      <span class="hint">Kategorien sind Vorlagen. Du weist sie danach einzelnen Klient:innen zu.</span></div>
      <div class="di-catgrid">${DI.cats.map(c => `
        <button type="button" class="di-catcard${c.active ? '' : ' inactive'}" data-cat="${c.id}" style="--c:${c.color}">
          <div class="di-card-head"><div class="di-icon">${c.icon}</div><div><div class="di-card-title">${esc(c.name)}${c.active ? '' : ' <em>(inaktiv)</em>'}</div>
          ${c.description ? `<div class="di-card-sub">${esc(c.description)}</div>` : ''}</div></div>
          <ul>${(DI.fields[c.id] || []).map(f => `<li>${esc(f.label)} <span>${DI_TYPES[f.type]}${f.required ? ' · Pflicht' : ''}</span></li>`).join('') || '<li class="muted">noch keine Felder</li>'}</ul>
        </button>`).join('')}</div>`;
  } else {
    const since = diAddDays(diToday(), -6);
    const [pr, as, en, ra, rl] = await Promise.all([
      sb.from('profiles').select('id, name, permissions').eq('role', 'client'),
      sb.from('diary_assignments').select('*'),
      sb.from('diary_entries').select('patient_id, entry_date').gte('entry_date', diAddDays(diToday(), -60)),
      sb.from('routine_assignments').select('*'),
      sb.from('routine_logs').select('patient_id, routine_id, log_date').gte('log_date', since),
    ]);
    const days7Arr = Array.from({ length: 7 }, (_, i) => diAddDays(since, i));
    const patients = (pr.data || []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const rows = patients.map(u => {
      const my = (as.data || []).filter(a => a.patient_id === u.id && a.active);
      const e = (en.data || []).filter(x => x.patient_id === u.id);
      const last = e.reduce((m, x) => x.entry_date > m ? x.entry_date : m, '');
      const days7 = new Set(e.filter(x => x.entry_date >= since).map(x => x.entry_date)).size;
      const myR = (ra.data || []).filter(a => a.patient_id === u.id && a.active && a.frequency !== 'bedarf');
      const rlogs = (rl.data || []).filter(l => l.patient_id === u.id);
      const rsum = myR.reduce((acc, a) => { const x = rtAdherence(a, rlogs, days7Arr); acc.d += Math.min(x.done, x.target || 0); acc.t += x.target || 0; return acc; }, { d: 0, t: 0 });
      return `<tr>
        <td><span class="uname-name">${esc(u.name)}</span>${can(u, 'tagebuch') ? '' : '<div class="status-mail">&#9888; Recht &bdquo;Tagebuch&ldquo; fehlt</div>'}</td>
        <td><div class="chips">${my.map(a => { const c = diCat(a.category_id); return c ? `<span class="chip" style="background:color-mix(in srgb, ${c.color} 22%, transparent);color:#fff;">${c.icon} ${esc(c.name)}</span>` : ''; }).join('') || '<span class="muted">nichts zugewiesen</span>'}</div></td>
        <td>${myR.length ? `${myR.length} aktiv${rsum.t ? ` &middot; <b>${Math.round(rsum.d / rsum.t * 100)}&nbsp;%</b>` : ''}` : '<span class="muted">&ndash;</span>'}</td>
        <td>${days7 ? `<b>${days7}</b> / 7 Tage` : '<span class="muted">&ndash;</span>'}</td>
        <td>${last ? diFmt(last) : '<span class="muted">&ndash;</span>'}</td>
        <td><button type="button" class="secondary small-btn" data-open="${u.id}">&Ouml;ffnen</button></td></tr>`;
    }).join('') || `<tr><td colspan="6" class="muted">Noch keine Klient:innen.</td></tr>`;
    body = `<div class="card"><div class="tablewrap"><table class="user-table">
      <thead><tr><th>Name</th><th>Kategorien</th><th>Routinen (7 Tage)</th><th>Eintr&auml;ge 7 Tage</th><th>Letzter Eintrag</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
    renderShell(profile, 'tagebuch', 'Tagebuch', tabs + body);
    appEl.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => renderDiaryPatient(profile, patients.find(p => p.id === b.dataset.open)); });
    appEl.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => renderDiaryAdmin(profile, b.dataset.tab); });
    return;
  }
  renderShell(profile, 'tagebuch', 'Tagebuch', tabs + body);
  appEl.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => renderDiaryAdmin(profile, b.dataset.tab); });
  document.getElementById('diNewCat').onclick = () => diCatDialog(profile, null);
  appEl.querySelectorAll('[data-cat]').forEach(b => { b.onclick = () => diCatDialog(profile, diCat(b.dataset.cat)); });
}

// ---------- Kategorie + Felder bearbeiten ----------
function diCatDialog(profile, c) {
  const isNew = !c;
  c = c || { name: '', icon: '📝', color: '#3ebae6', description: '', active: true };
  let fields = (isNew ? [] : (DI.fields[c.id] || [])).map(f => ({ ...f, options: { ...(f.options || {}) } }));
  const m = tbModal(`<h2>${isNew ? 'Neue Kategorie' : 'Kategorie bearbeiten'}</h2>
    <div class="modal-form">
      <label>Name<input type="text" id="c_name" value="${esc(c.name)}" placeholder="z. B. Zyklus"></label>
      <label>Symbol <span class="muted">(Emoji)</span><input type="text" id="c_icon" value="${esc(c.icon)}" maxlength="4"></label>
      <label class="wide">Hinweis f&uuml;r Klient:innen<input type="text" id="c_desc" value="${esc(c.description || '')}" placeholder="z. B. Bitte abends ausfüllen"></label>
      <label>Farbe<input type="color" id="c_color" value="${esc(c.color)}"></label>
      <label class="check" style="align-self:end;"><input type="checkbox" id="c_active" ${c.active ? 'checked' : ''}> aktiv</label>
    </div>
    <h3 class="di-fh">Felder</h3>
    <div id="c_fields"></div>
    <button type="button" class="secondary small-btn" id="c_addf">+ Feld</button>
    <div class="modal-actions" style="margin-top:16px;">
      <button type="button" id="c_save">Speichern</button>
      <button type="button" class="secondary" id="c_cancel">Abbrechen</button>
      ${isNew ? '' : '<span class="spacer"></span><button type="button" class="danger" id="c_del">Kategorie l&ouml;schen</button>'}
    </div><p class="error" id="c_err"></p>`);
  const $ = (id) => m.el.querySelector('#' + id);
  const readRows = () => {
    m.el.querySelectorAll('.di-frow').forEach((row, i) => {
      const f = fields[i];
      f.label = row.querySelector('.f_label').value;
      f.required = row.querySelector('.f_req').checked;
      // Optionen nach dem Typ lesen, der gerade angezeigt wird (nicht nach dem neu gewählten)
      const shown = row.dataset.type;
      const o = {};
      if (shown === 'scale') {
        o.min = Number(row.querySelector('.o_min').value || 1); o.max = Number(row.querySelector('.o_max').value || 10);
        o.minLabel = row.querySelector('.o_minl').value.trim(); o.maxLabel = row.querySelector('.o_maxl').value.trim();
      } else if (shown === 'number') o.unit = row.querySelector('.o_unit').value.trim();
      else if (shown === 'choice') {
        o.choices = row.querySelector('.o_choices').value.split(',').map(x => x.trim()).filter(Boolean);
        o.multi = row.querySelector('.o_multi').checked;
      }
      f.options = o;
      f.type = row.querySelector('.f_type').value;
      if (f.type !== shown) f.options = f.type === 'scale' ? { min: 1, max: 10 } : {};
    });
  };
  const optHtml = (f) => {
    const o = f.options || {};
    if (f.type === 'scale') return `<input type="number" class="o_min" value="${o.min ?? 1}" title="von"> bis <input type="number" class="o_max" value="${o.max ?? 10}" title="bis">
      <input type="text" class="o_minl" value="${esc(o.minLabel || '')}" placeholder="Text links (z. B. gar nicht)">
      <input type="text" class="o_maxl" value="${esc(o.maxLabel || '')}" placeholder="Text rechts (z. B. sehr stark)">`;
    if (f.type === 'number') return `<input type="text" class="o_unit" value="${esc(o.unit || '')}" placeholder="Einheit, z. B. ml, Minuten, kg">`;
    if (f.type === 'choice') return `<input type="text" class="o_choices wide-in" value="${esc((o.choices || []).join(', '))}" placeholder="Auswahl mit Komma trennen: Frühstück, Mittag, Abend">
      <label class="check"><input type="checkbox" class="o_multi" ${o.multi ? 'checked' : ''}> Mehrfachauswahl</label>`;
    return '';
  };
  const draw = () => {
    $('c_fields').innerHTML = fields.map((f, i) => `
      <div class="di-frow" data-type="${f.type}">
        <div class="di-frow-main">
          <input type="text" class="f_label" value="${esc(f.label)}" placeholder="Frage / Feldname">
          <select class="f_type">${Object.entries(DI_TYPES).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <label class="check"><input type="checkbox" class="f_req" ${f.required ? 'checked' : ''}> Pflicht</label>
          <button type="button" class="secondary small-btn" data-up="${i}">&uarr;</button>
          <button type="button" class="secondary small-btn" data-down="${i}">&darr;</button>
          <button type="button" class="danger small-btn" data-rm="${i}">&times;</button>
        </div>
        <div class="di-frow-opts">${optHtml(f)}</div>
      </div>`).join('') || '<p class="muted">Noch keine Felder &mdash; mit &bdquo;+ Feld&ldquo; hinzuf&uuml;gen.</p>';
    m.el.querySelectorAll('.f_type').forEach(s => { s.onchange = () => { readRows(); draw(); }; });
    m.el.querySelectorAll('[data-up]').forEach(b => { b.onclick = () => { readRows(); const i = +b.dataset.up; if (i > 0) [fields[i - 1], fields[i]] = [fields[i], fields[i - 1]]; draw(); }; });
    m.el.querySelectorAll('[data-down]').forEach(b => { b.onclick = () => { readRows(); const i = +b.dataset.down; if (i < fields.length - 1) [fields[i + 1], fields[i]] = [fields[i], fields[i + 1]]; draw(); }; });
    m.el.querySelectorAll('[data-rm]').forEach(b => { b.onclick = () => { readRows(); fields.splice(+b.dataset.rm, 1); draw(); }; });
  };
  $('c_addf').onclick = () => { readRows(); fields.push({ label: '', type: 'scale', options: { min: 1, max: 10 }, required: false }); draw(); };
  $('c_cancel').onclick = m.close;
  $('c_save').onclick = async () => {
    readRows();
    const err = $('c_err');
    const name = $('c_name').value.trim();
    if (!name) { err.textContent = 'Bitte einen Namen eingeben.'; return; }
    if (fields.some(f => !f.label.trim())) { err.textContent = 'Jedes Feld braucht einen Namen.'; return; }
    if (fields.some(f => f.type === 'choice' && !(f.options.choices || []).length)) { err.textContent = 'Auswahl-Felder brauchen mindestens eine Option.'; return; }
    const row = { name, icon: $('c_icon').value.trim() || '📝', color: $('c_color').value, description: $('c_desc').value.trim() || null, active: $('c_active').checked };
    let catId = c.id;
    if (isNew) {
      row.sort = DI.cats.reduce((a, x) => Math.max(a, x.sort), 0) + 10;
      const { data, error } = await sb.from('diary_categories').insert(row).select().single();
      if (error) { err.textContent = 'Fehler: ' + error.message; return; }
      catId = data.id;
    } else {
      const { error } = await sb.from('diary_categories').update(row).eq('id', catId);
      if (error) { err.textContent = 'Fehler: ' + error.message; return; }
    }
    // Felder abgleichen: entfernte löschen, bestehende ändern, neue anlegen
    const keep = fields.filter(f => f.id).map(f => f.id);
    const old = (DI.fields[catId] || []).map(f => f.id).filter(id => !keep.includes(id));
    if (old.length) { const { error } = await sb.from('diary_fields').delete().in('id', old); if (error) { err.textContent = 'Fehler: ' + error.message; return; } }
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const v = { label: f.label.trim(), type: f.type, options: f.options, required: !!f.required, sort: (i + 1) * 10 };
      const res = f.id ? await sb.from('diary_fields').update(v).eq('id', f.id) : await sb.from('diary_fields').insert({ ...v, category_id: catId });
      if (res.error) { err.textContent = 'Fehler: ' + res.error.message; return; }
    }
    m.close(); toast('Kategorie gespeichert.'); renderDiaryAdmin(profile, 'cats');
  };
  if (!isNew) $('c_del').onclick = async () => {
    if (!confirm('Kategorie „' + c.name + '“ löschen?\n\nAlle Zuweisungen UND alle Einträge dieser Kategorie werden gelöscht. Tipp: „aktiv“ abwählen blendet sie nur aus.')) return;
    const { error } = await sb.from('diary_categories').delete().eq('id', c.id);
    if (error) { $('c_err').textContent = 'Fehler: ' + error.message; return; }
    m.close(); toast('Gelöscht.'); renderDiaryAdmin(profile, 'cats');
  };
  draw();
}

// ---------- Praxis: Tagebuch einer Klient:in ----------
let DI_RANGE = 14;
async function renderDiaryPatient(profile, patient, catFilter) {
  await diLoad();
  const from = diAddDays(diToday(), -(DI_RANGE - 1));
  const days = Array.from({ length: DI_RANGE }, (_, i) => diAddDays(diToday(), -(DI_RANGE - 1 - i)));
  const [as, en, rt] = await Promise.all([
    sb.from('diary_assignments').select('*').eq('patient_id', patient.id),
    sb.from('diary_entries').select('*').eq('patient_id', patient.id).gte('entry_date', from).order('entry_date', { ascending: false }).order('entry_time', { ascending: false }),
    rtLoadPatient(patient.id, days),
  ]);
  const assigns = as.data || [];
  const entries = (en.data || []).filter(e => !catFilter || e.category_id === catFilter);

  // Verlauf der Skalen-Felder (Tagesmittel) als kleine Linien
  const spark = (vals, min, max, color) => {
    const w = 220, h = 36, n = vals.length;
    const pts = vals.map((v, i) => v == null ? null : [i * (w / (n - 1 || 1)), h - 3 - ((v - min) / ((max - min) || 1)) * (h - 6)]);
    let d = '', pen = false;
    pts.forEach(p => { if (!p) { pen = false; return; } d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); pen = true; });
    const dots = pts.filter(Boolean).map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="${color}"/>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="di-spark"><path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>${dots}</svg>`;
  };
  const trends = assigns.map(a => diCat(a.category_id)).filter(Boolean).filter(c => !catFilter || c.id === catFilter).map(c => {
    const sf = (DI.fields[c.id] || []).filter(f => f.type === 'scale');
    if (!sf.length) return '';
    return sf.map(f => {
      const o = f.options || {};
      const vals = days.map(d => {
        const vs = (en.data || []).filter(e => e.entry_date === d && e.category_id === c.id).map(e => (e.values || {})[f.id]).filter(v => typeof v === 'number');
        return vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : null;
      });
      const have = vals.filter(v => v != null);
      const avg = have.length ? (have.reduce((x, y) => x + y, 0) / have.length).toFixed(1) : '–';
      return `<tr><td>${c.icon} ${esc(f.label)}</td><td>${spark(vals, o.min ?? 1, o.max ?? 10, c.color)}</td><td class="nowrap">&Oslash; <b>${avg}</b> / ${o.max ?? 10}</td></tr>`;
    }).join('');
  }).join('');

  // Einträge nach Tag gruppiert
  const byDay = {};
  entries.forEach(e => { (byDay[e.entry_date] = byDay[e.entry_date] || []).push(e); });
  const list = Object.keys(byDay).sort().reverse().map(d => `
    <div class="di-daygroup"><div class="di-dayhead">${diFmt(d, true)}</div>
      ${byDay[d].map(e => { const c = diCat(e.category_id) || { name: '?', icon: '', color: '#888' };
        return `<div class="di-entry click" data-entry="${e.id}" style="--c:${c.color}"><span class="di-ecat">${c.icon} ${esc(c.name)}</span>${diEntrySummary(e)}</div>`; }).join('')}
    </div>`).join('') || '<p class="muted">Keine Eintr&auml;ge in diesem Zeitraum.</p>';

  const content = `
    <div class="card">
      <div class="tp-head-row"><div><div class="tp-kicker">Tagebuch von</div><h2 style="margin:0;">${esc(patient.name)}</h2></div>
        <span class="spacer"></span><button type="button" class="secondary small-btn" id="daAssign">+ Kategorien zuweisen</button></div>
      ${can(patient, 'tagebuch') ? (perm(patient, 'tagebuch') === 'view' ? '<p class="notice">Recht &bdquo;Tagebuch&ldquo; steht auf <b>nur ansehen</b> &mdash; zum Eintragen in der Nutzerverwaltung auf &bdquo;eintragen&ldquo; stellen.</p>' : '')
        : '<p class="notice">&#9888; Das Recht &bdquo;Tagebuch&ldquo; fehlt &mdash; in der Nutzerverwaltung unter &bdquo;Rechte&ldquo; freischalten.</p>'}
      <div class="di-assigns">${assigns.map(a => { const c = diCat(a.category_id); if (!c) return '';
        return `<div class="di-assign${a.active ? '' : ' inactive'}" style="--c:${c.color}">
          <b>${c.icon} ${esc(c.name)}</b>
          <span>${DI_FREQ[a.frequency]} &middot; ab ${tpFmtDate(a.start_date)}${a.end_date ? ' bis ' + tpFmtDate(a.end_date) : ''}${a.active ? '' : ' &middot; pausiert'}</span>
          ${a.note ? `<span class="di-card-sub">&#128204; ${esc(a.note)}</span>` : ''}
          <button type="button" class="link-btn" data-edit-assign="${a.id}">bearbeiten</button></div>`; }).join('') || '<p class="muted">Noch nichts zugewiesen.</p>'}</div>
    </div>
    ${rtPatientCardHtml(rt, days)}
    <div class="di-filter">
      <select id="daRange">${[7, 14, 30, 90].map(n => `<option value="${n}" ${DI_RANGE === n ? 'selected' : ''}>letzte ${n} Tage</option>`).join('')}</select>
      <select id="daCat"><option value="">alle Kategorien</option>${assigns.map(a => diCat(a.category_id)).filter(Boolean).map(c => `<option value="${c.id}" ${catFilter === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select>
    </div>
    ${trends ? `<div class="card"><h2>Verlauf</h2><table class="di-trend"><tbody>${trends}</tbody></table><p class="hint">Tagesmittel der Skalen im gew&auml;hlten Zeitraum.</p></div>` : ''}
    <div class="card"><h2>Eintr&auml;ge</h2>${list}</div>`;
  renderShell(profile, 'tagebuch', 'Tagebuch', content, { label: 'Tagebuch', go: () => renderDiaryAdmin(profile, 'patients') });
  const again = () => renderDiaryPatient(profile, patient, catFilter);
  document.getElementById('daRange').onchange = (e) => { DI_RANGE = +e.target.value; again(); };
  document.getElementById('daCat').onchange = (e) => renderDiaryPatient(profile, patient, e.target.value || null);
  document.getElementById('daAssign').onclick = () => diAssignDialog(patient, assigns, null, again);
  rtWirePatientCard(patient, rt, again);
  appEl.querySelectorAll('[data-edit-assign]').forEach(b => { b.onclick = () => diAssignDialog(patient, assigns, assigns.find(a => a.id === b.dataset.editAssign), again); });
  appEl.querySelectorAll('[data-entry]').forEach(el => {
    el.onclick = () => { const e = entries.find(x => x.id === el.dataset.entry); diEntryDialog(patient.id, diCat(e.category_id), e.entry_date, e, again); };
  });
}

function diAssignDialog(patient, assigns, a, done) {
  const isNew = !a;
  const free = DI.cats.filter(c => c.active && !assigns.some(x => x.category_id === c.id));
  if (isNew && !free.length) { toast('Alle aktiven Kategorien sind schon zugewiesen.'); return; }
  const m = tbModal(`<h2>${isNew ? 'Kategorien zuweisen' : 'Zuweisung bearbeiten'}</h2>
    ${isNew ? `<div class="bp-list" style="max-height:32vh;">${free.map(c => `<label class="bp-item" style="--c:${c.color}"><input type="checkbox" value="${c.id}">
      <span><b>${c.icon} ${esc(c.name)}</b><br><small>${(DI.fields[c.id] || []).map(f => esc(f.label)).join(' · ') || 'keine Felder'}</small></span></label>`).join('')}</div>`
      : `<p><b>${diCat(a.category_id).icon} ${esc(diCat(a.category_id).name)}</b></p>`}
    <div class="modal-form" style="margin-top:12px;">
      <label>H&auml;ufigkeit<select id="as_freq">${Object.entries(DI_FREQ).map(([k, v]) => `<option value="${k}" ${(a ? a.frequency : 'daily') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="check" style="align-self:end;"><input type="checkbox" id="as_active" ${!a || a.active ? 'checked' : ''}> aktiv</label>
      <label>ab<input type="date" id="as_start" value="${esc(a ? a.start_date : diToday())}"></label>
      <label>bis <span class="muted">(optional)</span><input type="date" id="as_end" value="${esc(a && a.end_date ? a.end_date : '')}"></label>
      <label class="wide">Pers&ouml;nlicher Hinweis <span class="muted">(optional)</span><input type="text" id="as_note" value="${esc(a && a.note ? a.note : '')}" placeholder="z. B. Bitte besonders auf Reaktionen nach Milchprodukten achten"></label>
    </div>
    <div class="modal-actions" style="margin-top:12px;">
      <button type="button" id="as_ok">${isNew ? 'Zuweisen' : 'Speichern'}</button>
      <button type="button" class="secondary" id="as_cancel">Abbrechen</button>
      ${isNew ? '' : '<span class="spacer"></span><button type="button" class="danger" id="as_del">Zuweisung entfernen</button>'}
    </div><p class="error" id="as_err"></p>`);
  const $ = (id) => m.el.querySelector('#' + id);
  $('as_cancel').onclick = m.close;
  $('as_ok').onclick = async () => {
    const v = { frequency: $('as_freq').value, active: $('as_active').checked, start_date: $('as_start').value || diToday(), end_date: $('as_end').value || null, note: $('as_note').value.trim() || null };
    let res;
    if (isNew) {
      const ids = [...m.el.querySelectorAll('.bp-item input:checked')].map(i => i.value);
      if (!ids.length) { $('as_err').textContent = 'Bitte mindestens eine Kategorie wählen.'; return; }
      res = await sb.from('diary_assignments').insert(ids.map(id => ({ ...v, patient_id: patient.id, category_id: id })));
    } else res = await sb.from('diary_assignments').update(v).eq('id', a.id);
    if (res.error) { $('as_err').textContent = 'Fehler: ' + res.error.message; return; }
    m.close(); toast('Gespeichert.'); done();
  };
  if (!isNew) $('as_del').onclick = async () => {
    if (!confirm('Zuweisung entfernen? Die bisherigen Einträge bleiben erhalten. (Zum Pausieren lieber „aktiv“ abwählen.)')) return;
    const { error } = await sb.from('diary_assignments').delete().eq('id', a.id);
    if (error) { $('as_err').textContent = 'Fehler: ' + error.message; return; }
    m.close(); toast('Entfernt.'); done();
  };
}
