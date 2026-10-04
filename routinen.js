// ============================================================
// Gesundheitsbude-App — Tagebuch-Routinen (SCHICHTWECHSEL-Quick-Wins)
// Praxis: Routinen-Bibliothek je Themenfeld pflegen, Routinen je Klient:in freischalten, Umsetzung sehen
// Klient:in: in „Mein Tagebuch“ die freigeschalteten Routinen je Tag abhaken
// ============================================================
const RT = { list: [], themes: [] };
const RT_FREQ = { taeglich: 'täglich', woche: 'x pro Woche', bedarf: 'bei Bedarf' };
const RT_TOD = { morgens: 'Morgens', mahlzeiten: 'Zu den Mahlzeiten', ganztags: 'Über den Tag', abends: 'Abends' };
const RT_TOD_ICON = { morgens: '&#127749;', mahlzeiten: '&#127869;', ganztags: '&#9728;', abends: '&#127769;' };

async function rtLoad() {
  const [r, c] = await Promise.all([
    sb.from('routines').select('*').order('sort'),
    sb.from('block_categories').select('*').order('sort'),
  ]);
  if (r.error) throw new Error(r.error.message);
  RT.list = r.data || [];
  RT.themes = c.data || [];
}
const rtGet = (id) => RT.list.find(r => r.id === id);
const rtTheme = (id) => RT.themes.find(c => c.id === id) || { name: 'Ohne Themenfeld', color: '#a0a0b8' };
const rtFreqText = (x) => x.frequency === 'woche' ? (x.per_week || 1) + '× pro Woche' : RT_FREQ[x.frequency];
const rtActiveOn = (a, iso) => a.active && a.start_date <= iso && (!a.end_date || a.end_date >= iso);

// Umsetzung im Zeitraum: täglich = Tage abgehakt / aktive Tage; Woche = abgehakt / Soll; bei Bedarf = Anzahl
function rtAdherence(a, logs, days) {
  const act = days.filter(d => rtActiveOn(a, d));
  const done = logs.filter(l => l.routine_id === a.routine_id && act.includes(l.log_date)).length;
  if (a.frequency === 'bedarf') return { done, target: null, pct: null };
  const target = a.frequency === 'woche' ? Math.max(1, Math.round((a.per_week || 1) * act.length / 7)) : act.length;
  return { done, target, pct: target ? Math.min(100, Math.round(done / target * 100)) : null };
}

// ============================================================
// Praxis: Bibliothek (Reiter „Routinen“ im Tagebuch)
// ============================================================
const RTL = { q: '', theme: '' };
async function rtRenderLibrary(profile, tabsHtml) {
  try { await rtLoad(); } catch (e) { renderShell(profile, 'tagebuch', 'Tagebuch', tabsHtml + `<div class="card"><p class="error">${esc(e.message)}</p></div>`); return; }
  const body = `
    <div class="tb-toolbar">
      <input type="search" id="rtSearch" placeholder="Routine suchen &hellip;" value="${esc(RTL.q)}">
      <button type="button" id="rtNew">+ Routine</button>
    </div>
    <div class="tb-filter" id="rtFilter"></div>
    <p class="hint">Die Bibliothek enth&auml;lt alle Routinen, die ihr Klient:innen freischalten k&ouml;nnt. Freigeschaltet wird je Person unter <b>Klient:innen &rarr; &Ouml;ffnen &rarr; Routinen freischalten</b>.</p>
    <div id="rtList"></div>`;
  renderShell(profile, 'tagebuch', 'Tagebuch', tabsHtml + body);
  appEl.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => renderDiaryAdmin(profile, b.dataset.tab); });
  document.getElementById('rtSearch').oninput = (e) => { RTL.q = e.target.value; rtDrawLibrary(profile); };
  document.getElementById('rtNew').onclick = () => rtEditDialog(profile, null);
  rtDrawLibrary(profile);
}

function rtMatch(r, q) {
  q = (q || '').trim().toLowerCase();
  return !q || [r.title, r.why, r.how].some(v => (v || '').toLowerCase().includes(q));
}

function rtDrawLibrary(profile) {
  const chip = (id, name, color, n) => `<button type="button" class="tb-chip${RTL.theme === id ? ' on' : ''}" data-th="${id}" style="--c:${color}">${esc(name)} <span>${n}</span></button>`;
  document.getElementById('rtFilter').innerHTML = chip('', 'Alle', '#ffffff', RT.list.length) +
    RT.themes.map(c => chip(c.id, c.name, c.color, RT.list.filter(r => r.category_id === c.id).length)).join('');
  document.querySelectorAll('#rtFilter [data-th]').forEach(b => { b.onclick = () => { RTL.theme = b.dataset.th; rtDrawLibrary(profile); }; });
  const shown = RT.list.filter(r => (!RTL.theme || r.category_id === RTL.theme) && rtMatch(r, RTL.q));
  const groups = [...RT.themes, { id: null, name: 'Ohne Themenfeld', color: '#a0a0b8' }]
    .map(c => ({ c, items: shown.filter(r => (r.category_id || null) === c.id) })).filter(g => g.items.length);
  document.getElementById('rtList').innerHTML = groups.map(g => `
    <h3 class="tb-group" style="--c:${g.c.color}">${esc(g.c.name)} <span>${g.items.length}</span></h3>
    <div class="tb-grid">${g.items.map(r => `
      <button type="button" class="tb-card${r.active ? '' : ' inactive'}" data-rt="${r.id}" style="--c:${g.c.color}">
        <span class="tb-title">${esc(r.title)}${r.active ? '' : ' <em>(inaktiv)</em>'}</span>
        <span class="tb-badges"><span class="pg-badge">${RT_TOD_ICON[r.time_of_day]} ${RT_TOD[r.time_of_day]}</span><span class="pg-badge">&#128257; ${rtFreqText(r)}</span></span>
        ${r.how ? `<span class="tb-desc">${esc(r.how)}</span>` : ''}
      </button>`).join('')}</div>`).join('') || '<p class="muted">Keine Treffer.</p>';
  document.querySelectorAll('[data-rt]').forEach(b => { b.onclick = () => rtEditDialog(profile, rtGet(b.dataset.rt)); });
}

function rtEditDialog(profile, r) {
  const isNew = !r;
  r = r || { title: '', category_id: RTL.theme || (RT.themes[0] || {}).id, frequency: 'taeglich', per_week: null, time_of_day: 'ganztags', active: true };
  const opts = (obj, cur) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');
  const m = tbModal(`<h2>${isNew ? 'Neue Routine' : 'Routine bearbeiten'}</h2>
    <form id="rtForm" class="modal-form">
      <label class="wide">Titel<input type="text" id="r_title" required value="${esc(r.title)}"></label>
      <label>Themenfeld<select id="r_cat">${RT.themes.map(c => `<option value="${c.id}" ${c.id === r.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label>Tageszeit<select id="r_tod">${opts(RT_TOD, r.time_of_day)}</select></label>
      <label>Standard-H&auml;ufigkeit<select id="r_freq">${opts(RT_FREQ, r.frequency)}</select></label>
      <label>Mal pro Woche<input type="number" id="r_pw" min="1" max="7" value="${r.per_week ?? ''}" placeholder="nur bei „x pro Woche“"></label>
      <label class="wide">Was &amp; warum<textarea id="r_why" rows="2">${esc(r.why || '')}</textarea></label>
      <label class="wide">Umsetzung<textarea id="r_how" rows="3">${esc(r.how || '')}</textarea></label>
      <label class="wide check"><input type="checkbox" id="r_active" ${r.active ? 'checked' : ''}> aktiv (inaktive Routinen k&ouml;nnen nicht mehr neu freigeschaltet werden)</label>
      <div class="modal-actions wide">
        <button type="submit">Speichern</button>
        <button type="button" class="secondary" id="r_cancel">Abbrechen</button>
        ${isNew ? '' : '<span class="spacer"></span><button type="button" class="danger" id="r_del">L&ouml;schen</button>'}
      </div>
      <p class="error wide" id="r_err"></p>
    </form>`);
  const $ = (id) => m.el.querySelector('#' + id);
  $('r_cancel').onclick = m.close;
  $('rtForm').onsubmit = async (e) => {
    e.preventDefault();
    const freq = $('r_freq').value;
    const v = { title: $('r_title').value.trim(), category_id: $('r_cat').value, time_of_day: $('r_tod').value, frequency: freq,
      per_week: freq === 'woche' ? (parseInt($('r_pw').value, 10) || 1) : null,
      why: $('r_why').value.trim() || null, how: $('r_how').value.trim() || null, active: $('r_active').checked };
    if (isNew) v.sort = RT.list.filter(x => x.category_id === v.category_id).reduce((a, x) => Math.max(a, x.sort), 0) + 10;
    const res = isNew ? await sb.from('routines').insert(v) : await sb.from('routines').update(v).eq('id', r.id);
    if (res.error) { $('r_err').textContent = res.error.code === '23505' ? 'Diese Routine gibt es im Themenfeld schon.' : 'Fehler: ' + res.error.message; return; }
    m.close(); toast('Gespeichert.'); renderDiaryAdmin(profile, 'routines');
  };
  if (!isNew) $('r_del').onclick = async () => {
    if (!confirm('Routine „' + r.title + '“ löschen?\n\nSie verschwindet auch bei allen Klient:innen, die sie freigeschaltet haben, samt Häkchen. Tipp: „aktiv“ abwählen blendet sie nur für neue Freischaltungen aus.')) return;
    const { error } = await sb.from('routines').delete().eq('id', r.id);
    if (error) { $('r_err').textContent = 'Fehler: ' + error.message; return; }
    m.close(); toast('Gelöscht.'); renderDiaryAdmin(profile, 'routines');
  };
}

// ============================================================
// Praxis: Routinen einer Klient:in (Karte im Tagebuch der Person)
// ============================================================
async function rtLoadPatient(patientId, days) {
  await rtLoad();
  const [as, lg] = await Promise.all([
    sb.from('routine_assignments').select('*').eq('patient_id', patientId),
    sb.from('routine_logs').select('*').eq('patient_id', patientId).gte('log_date', days[0]),
  ]);
  return { assigns: (as.data || []).filter(a => rtGet(a.routine_id)), logs: lg.data || [] };
}

function rtPatientCardHtml(data, days) {
  const { assigns, logs } = data;
  const rows = assigns.slice().sort((a, b) => (rtTheme(rtGet(a.routine_id).category_id).sort || 0) - (rtTheme(rtGet(b.routine_id).category_id).sort || 0) || rtGet(a.routine_id).sort - rtGet(b.routine_id).sort)
    .map(a => {
      const r = rtGet(a.routine_id), th = rtTheme(r.category_id);
      const ad = rtAdherence(a, logs, days);
      const grid = days.slice(-14).map(d => {
        const on = logs.some(l => l.routine_id === a.routine_id && l.log_date === d);
        return `<i class="${on ? 'on' : ''}${rtActiveOn(a, d) ? '' : ' off'}" title="${diFmt(d)}"></i>`;
      }).join('');
      return `<tr class="${a.active ? '' : 'rt-paused'}" style="--c:${th.color}">
        <td><b>${esc(r.title)}</b><div class="rt-sub">${esc(th.name)} &middot; ${RT_TOD[a.time_of_day]} &middot; ${rtFreqText(a)}${a.active ? '' : ' &middot; pausiert'}${a.end_date ? ' &middot; bis ' + tpFmtDate(a.end_date) : ''}</div>
          ${a.note ? `<div class="rt-sub">&#128204; ${esc(a.note)}</div>` : ''}</td>
        <td><div class="rt-grid">${grid}</div></td>
        <td class="nowrap">${ad.pct == null ? `<b>${ad.done}&times;</b>` : `<b>${ad.pct}&nbsp;%</b> <span class="muted">(${ad.done}/${ad.target})</span>`}</td>
        <td><button type="button" class="link-btn" data-rta="${a.id}">bearbeiten</button></td></tr>`;
    }).join('');
  return `<div class="card">
    <div class="tp-head-row"><h2 style="margin:0;">Routinen</h2><span class="muted">${assigns.filter(a => a.active).length} aktiv</span><span class="spacer"></span>
      <button type="button" class="small-btn" id="rtAssign">+ Routinen freischalten</button></div>
    ${rows ? `<div class="tablewrap"><table class="rt-table"><thead><tr><th>Routine</th><th>letzte 14 Tage</th><th>Umsetzung (${days.length} T.)</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="muted">Noch keine Routinen freigeschaltet.</p>'}
  </div>`;
}

function rtWirePatientCard(patient, data, done) {
  document.getElementById('rtAssign').onclick = () => rtAssignDialog(patient, data.assigns, done);
  appEl.querySelectorAll('[data-rta]').forEach(b => { b.onclick = () => rtAssignEdit(data.assigns.find(a => a.id === b.dataset.rta), done); });
}

// Mehrere Routinen auf einmal freischalten (gruppiert nach Themenfeld)
function rtAssignDialog(patient, assigns, done) {
  const have = new Set(assigns.map(a => a.routine_id));
  const avail = RT.list.filter(r => r.active);
  let q = '';
  const chosen = new Set();
  const m = tbModal(`<h2>Routinen freischalten: ${esc(patient.name)}</h2>
    <input type="search" id="ra_q" placeholder="Suchen &hellip;" style="width:100%;margin-bottom:10px;">
    <div class="bp-list rt-pick" id="ra_list" style="max-height:46vh;"></div>
    <div class="modal-form" style="margin-top:12px;">
      <label>ab<input type="date" id="ra_start" value="${diToday()}"></label>
      <label>bis <span class="muted">(optional)</span><input type="date" id="ra_end"></label>
    </div>
    <p class="hint">H&auml;ufigkeit und Tageszeit werden aus der Bibliothek &uuml;bernommen und lassen sich danach je Routine anpassen.</p>
    <div class="modal-actions" style="margin-top:8px;">
      <button type="button" id="ra_ok" disabled>Freischalten</button>
      <button type="button" class="secondary" id="ra_cancel">Abbrechen</button>
      <span class="spacer"></span><span class="hint" id="ra_n"></span></div>
    <p class="error" id="ra_err"></p>`);
  m.el.querySelector('.modal').classList.add('wide-modal');
  const $ = (id) => m.el.querySelector('#' + id);
  const count = () => { $('ra_n').textContent = chosen.size ? chosen.size + ' ausgewählt' : ''; $('ra_ok').disabled = !chosen.size; };
  const draw = () => {
    $('ra_list').innerHTML = RT.themes.map(c => {
      const items = avail.filter(r => r.category_id === c.id && rtMatch(r, q));
      if (!items.length) return '';
      const free = items.filter(r => !have.has(r.id));
      const allOn = free.length && free.every(r => chosen.has(r.id));
      return `<div class="rt-pgroup" style="--c:${c.color}">
        <div class="rt-pgroup-h"><b>${esc(c.name)}</b>${free.length ? `<button type="button" class="link-btn" data-all="${c.id}">${allOn ? 'keine' : 'alle'}</button>` : ''}</div>
        ${items.map(r => `<label class="bp-item${have.has(r.id) ? ' is-on' : ''}" style="--c:${c.color}">
          <input type="checkbox" value="${r.id}" ${have.has(r.id) ? 'checked disabled' : (chosen.has(r.id) ? 'checked' : '')}>
          <span><b>${esc(r.title)}</b>${have.has(r.id) ? ' <span class="pg-badge pkg all">schon freigeschaltet</span>' : ''}
          <br><small>${RT_TOD[r.time_of_day]} &middot; ${rtFreqText(r)}${r.how ? ' &middot; ' + esc(r.how) : ''}</small></span></label>`).join('')}
      </div>`;
    }).join('') || '<p class="muted">Keine Treffer.</p>';
    $('ra_list').querySelectorAll('input:not(:disabled)').forEach(i => { i.onchange = () => { i.checked ? chosen.add(i.value) : chosen.delete(i.value); draw(); count(); }; });
    $('ra_list').querySelectorAll('[data-all]').forEach(b => {
      b.onclick = () => {
        const free = avail.filter(r => r.category_id === b.dataset.all && rtMatch(r, q) && !have.has(r.id));
        const allOn = free.every(r => chosen.has(r.id));
        free.forEach(r => allOn ? chosen.delete(r.id) : chosen.add(r.id));
        draw(); count();
      };
    });
  };
  $('ra_q').oninput = (e) => { q = e.target.value; draw(); };
  $('ra_cancel').onclick = m.close;
  $('ra_ok').onclick = async () => {
    const start = $('ra_start').value || diToday(), end = $('ra_end').value || null;
    const rows = [...chosen].map(id => { const r = rtGet(id); return { patient_id: patient.id, routine_id: id, frequency: r.frequency, per_week: r.per_week, time_of_day: r.time_of_day, start_date: start, end_date: end }; });
    const { error } = await sb.from('routine_assignments').insert(rows);
    if (error) { $('ra_err').textContent = 'Fehler: ' + error.message; return; }
    m.close(); toast(rows.length + ' Routine(n) freigeschaltet.'); done();
  };
  draw(); count(); $('ra_q').focus();
}

function rtAssignEdit(a, done) {
  const r = rtGet(a.routine_id);
  const opts = (obj, cur) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');
  const m = tbModal(`<h2>${esc(r.title)}</h2>
    <p class="hint" style="margin-top:-6px;">${esc(rtTheme(r.category_id).name)}</p>
    <div class="modal-form">
      <label>H&auml;ufigkeit<select id="ae_freq">${opts(RT_FREQ, a.frequency)}</select></label>
      <label>Mal pro Woche<input type="number" id="ae_pw" min="1" max="7" value="${a.per_week ?? ''}"></label>
      <label>Tageszeit<select id="ae_tod">${opts(RT_TOD, a.time_of_day)}</select></label>
      <label class="check" style="align-self:end;"><input type="checkbox" id="ae_active" ${a.active ? 'checked' : ''}> aktiv</label>
      <label>ab<input type="date" id="ae_start" value="${esc(a.start_date)}"></label>
      <label>bis <span class="muted">(optional)</span><input type="date" id="ae_end" value="${esc(a.end_date || '')}"></label>
      <label class="wide">Pers&ouml;nlicher Hinweis <span class="muted">(sieht die Klient:in)</span><input type="text" id="ae_note" value="${esc(a.note || '')}" placeholder="z. B. Magnesium: 300 mg statt 200 mg"></label>
    </div>
    <div class="modal-actions" style="margin-top:12px;">
      <button type="button" id="ae_ok">Speichern</button>
      <button type="button" class="secondary" id="ae_cancel">Abbrechen</button>
      <span class="spacer"></span><button type="button" class="danger" id="ae_del">Entfernen</button></div>
    <p class="error" id="ae_err"></p>`);
  const $ = (id) => m.el.querySelector('#' + id);
  $('ae_cancel').onclick = m.close;
  $('ae_ok').onclick = async () => {
    const freq = $('ae_freq').value;
    const v = { frequency: freq, per_week: freq === 'woche' ? (parseInt($('ae_pw').value, 10) || 1) : null, time_of_day: $('ae_tod').value,
      active: $('ae_active').checked, start_date: $('ae_start').value || diToday(), end_date: $('ae_end').value || null, note: $('ae_note').value.trim() || null };
    const { error } = await sb.from('routine_assignments').update(v).eq('id', a.id);
    if (error) { $('ae_err').textContent = 'Fehler: ' + error.message; return; }
    m.close(); toast('Gespeichert.'); done();
  };
  $('ae_del').onclick = async () => {
    if (!confirm('Routine bei dieser Person entfernen? Die bisherigen Häkchen bleiben gespeichert. (Zum Pausieren lieber „aktiv“ abwählen.)')) return;
    const { error } = await sb.from('routine_assignments').delete().eq('id', a.id);
    if (error) { $('ae_err').textContent = 'Fehler: ' + error.message; return; }
    m.close(); toast('Entfernt.'); done();
  };
}

// ============================================================
// Klient:in: „Meine Routinen“ in Mein Tagebuch
// ============================================================
async function rtLoadMine(profile, from, to) {
  await rtLoad();
  const [as, lg] = await Promise.all([
    sb.from('routine_assignments').select('*').eq('patient_id', profile.id),
    sb.from('routine_logs').select('*').eq('patient_id', profile.id).gte('log_date', from).lte('log_date', to),
  ]);
  return { assigns: (as.data || []).filter(a => rtGet(a.routine_id)), logs: lg.data || [] };
}

// Für die Wochenleiste: alle täglichen Routinen des Tages erledigt?
function rtDayState(data, d) {
  const daily = data.assigns.filter(a => rtActiveOn(a, d) && a.frequency === 'taeglich');
  if (!daily.length) return null;
  const n = daily.filter(a => data.logs.some(l => l.routine_id === a.routine_id && l.log_date === d)).length;
  return n === daily.length ? 'full' : (n ? 'part' : 'none');
}

function rtMineHtml(data, date, canEdit) {
  const act = data.assigns.filter(a => rtActiveOn(a, date));
  if (!act.length) return '';
  const weekStart = diMonday(date), weekEnd = diAddDays(weekStart, 6);
  const isOn = (a) => data.logs.some(l => l.routine_id === a.routine_id && l.log_date === date);
  const daily = act.filter(a => a.frequency === 'taeglich');
  const doneDaily = daily.filter(isOn).length;
  const row = (a) => {
    const r = rtGet(a.routine_id), th = rtTheme(r.category_id), on = isOn(a);
    let extra = '';
    if (a.frequency === 'woche') {
      const n = data.logs.filter(l => l.routine_id === a.routine_id && l.log_date >= weekStart && l.log_date <= weekEnd).length;
      extra = `<span class="rt-week${n >= (a.per_week || 1) ? ' ok' : ''}">${n} / ${a.per_week || 1} diese Woche</span>`;
    }
    return `<div class="rt-item${on ? ' on' : ''}" style="--c:${th.color}">
      <button type="button" class="rt-check" data-rtc="${a.routine_id}" ${canEdit ? '' : 'disabled'} aria-label="${on ? 'Häkchen entfernen' : 'Abhaken'}">${on ? '&#10003;' : ''}</button>
      <div class="rt-body">
        <div class="rt-title">${esc(r.title)} ${extra}</div>
        <div class="rt-sub">${esc(th.name)}${a.frequency !== 'taeglich' ? ' &middot; ' + rtFreqText(a) : ''}</div>
        ${a.note ? `<div class="rt-note">&#128204; ${esc(a.note)}</div>` : ''}
        <details class="rt-more"><summary>So geht's</summary>
          ${r.how ? `<p><b>Umsetzung:</b> ${esc(r.how)}</p>` : ''}${r.why ? `<p><b>Warum:</b> ${esc(r.why)}</p>` : ''}</details>
      </div></div>`;
  };
  const sections = Object.keys(RT_TOD).map(t => {
    const l = act.filter(a => a.time_of_day === t && a.frequency !== 'bedarf');
    return l.length ? `<div class="rt-tod"><div class="rt-tod-h">${RT_TOD_ICON[t]} ${RT_TOD[t]}</div>${l.map(row).join('')}</div>` : '';
  }).join('');
  const need = act.filter(a => a.frequency === 'bedarf');
  return `<div class="card rt-mine">
    <div class="tp-head-row"><h2 style="margin:0;">Meine Routinen</h2><span class="spacer"></span>
      ${daily.length ? `<span class="rt-count${doneDaily === daily.length ? ' ok' : ''}">${doneDaily} / ${daily.length} heute</span>` : ''}</div>
    ${daily.length ? `<div class="tp-bar" style="margin:10px 0 4px;"><span style="width:${Math.round(doneDaily / daily.length * 100)}%"></span></div>` : ''}
    ${sections}
    ${need.length ? `<div class="rt-tod"><div class="rt-tod-h">&#9889; Bei Bedarf</div>${need.map(row).join('')}</div>` : ''}
  </div>`;
}

function rtWireMine(profile, data, date, again) {
  appEl.querySelectorAll('[data-rtc]').forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      const id = b.dataset.rtc;
      const on = data.logs.some(l => l.routine_id === id && l.log_date === date);
      const { error } = on
        ? await sb.from('routine_logs').delete().eq('patient_id', profile.id).eq('routine_id', id).eq('log_date', date)
        : await sb.from('routine_logs').insert({ patient_id: profile.id, routine_id: id, log_date: date });
      if (error) { b.disabled = false; toast('Fehler: ' + error.message); return; }
      again();
    };
  });
}
