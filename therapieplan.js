// ============================================================
// Gesundheitsbude-App — Therapieplan mit festen Phasen
// Praxis: Pläne je Klient:in aus Therapiebausteinen zusammenstellen, freigeben, Status sehen
// Klient:in: „Mein Therapieplan“ — Zeitstrahl der Phasen, Schritte, Status selbst setzen (Recht 'edit')
// ============================================================
const TP_STATUS = {
  open: { label: 'Offen', icon: '&#9675;' },
  doing: { label: 'In Arbeit', icon: '&#9680;' },
  done: { label: 'Erledigt', icon: '&#10003;' },
};
const TP = { phases: [], cats: [] };

async function tpLoadBase() {
  const [ph, ca] = await Promise.all([
    sb.from('plan_phases').select('*').order('sort'),
    sb.from('block_categories').select('*').order('sort'),
  ]);
  if (ph.error) throw new Error(ph.error.message);
  TP.phases = ph.data || [];
  TP.cats = ca.data || [];
}
const tpCat = (id) => TP.cats.find(c => c.id === id);
const tpFmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

// Fortschritt je Phase + aktuelle Phase (erste mit offenen Schritten)
function tpProgress(steps) {
  const per = TP.phases.map(ph => {
    const s = steps.filter(x => x.phase_id === ph.id);
    return { ph, total: s.length, done: s.filter(x => x.status === 'done').length };
  });
  const cur = per.find(p => p.total && p.done < p.total);
  const total = steps.length, done = steps.filter(x => x.status === 'done').length;
  return { per, current: cur ? cur.ph.id : null, total, done };
}

function tpTimeline(steps) {
  const pr = tpProgress(steps);
  return `<div class="tp-timeline">
    ${pr.per.map((p, i) => {
      const state = !p.total ? 'empty' : (p.done === p.total ? 'done' : (p.ph.id === pr.current ? 'current' : 'todo'));
      return `<div class="tp-tl-step ${state}" style="--c:${p.ph.color}">
        <div class="tp-tl-dot">${state === 'done' ? '&#10003;' : i + 1}</div>
        <div class="tp-tl-name">${esc(p.ph.name)}</div>
        <div class="tp-tl-sub">${p.total ? p.done + ' / ' + p.total : '&ndash;'}</div>
      </div>`;
    }).join('<div class="tp-tl-line"></div>')}
  </div>
  <div class="tp-bar"><span style="width:${pr.total ? Math.round(pr.done / pr.total * 100) : 0}%"></span></div>`;
}

// Schritt-Karte (gemeinsam für Praxis und Klient:in)
function tpStepCard(s, mode) {
  const cat = tpCat(s.category_id);
  const st = TP_STATUS[s.status] || TP_STATUS.open;
  const meta = [
    s.due_date ? `&#128197; bis ${tpFmtDate(s.due_date)}` : '',
    s.duration ? `&#9201; ${esc(s.duration)}` : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');
  const statusCtl = mode === 'view'
    ? `<span class="tp-status s-${s.status}">${st.icon} ${st.label}</span>`
    : `<div class="tp-status-btns">${Object.entries(TP_STATUS).map(([k, v]) =>
        `<button type="button" class="tp-sbtn s-${k}${s.status === k ? ' on' : ''}" data-status="${k}" data-step="${s.id}">${v.icon} ${v.label}</button>`).join('')}</div>`;
  return `<div class="tp-step s-${s.status}" style="--c:${cat ? cat.color : '#a0a0b8'}" data-id="${s.id}">
    <div class="tp-step-head">
      <div>
        ${cat ? `<span class="tp-cat">${esc(cat.name)}</span>` : ''}
        <div class="tp-step-title">${esc(s.title)}</div>
        ${meta ? `<div class="tp-meta">${meta}</div>` : ''}
      </div>
      ${mode === 'staff' ? `<div class="tp-step-tools">
        <button type="button" class="secondary small-btn" data-move="-1" title="nach oben">&uarr;</button>
        <button type="button" class="secondary small-btn" data-move="1" title="nach unten">&darr;</button>
        <button type="button" class="secondary small-btn" data-edit>Bearbeiten</button></div>` : ''}
    </div>
    ${s.patient_text ? `<div class="tp-text">${esc(s.patient_text).replace(/\n/g, '<br>')}</div>` : ''}
    ${s.application ? `<div class="tp-line">&#128138; <b>Anwendung:</b> ${esc(s.application)}</div>` : ''}
    ${s.product ? `<div class="tp-line">&#127991; <b>Produkt:</b> ${esc(s.product)}</div>` : ''}
    ${s.link_url ? `<div class="tp-line">&#128279; <a href="${esc(s.link_url)}" target="_blank" rel="noopener">Mehr dazu</a></div>` : ''}
    ${statusCtl}
    ${mode === 'edit' ? `<textarea class="tp-note" data-note="${s.id}" rows="2" placeholder="Notiz an die Praxis (optional) …">${esc(s.patient_note || '')}</textarea>`
      : (s.patient_note ? `<div class="tp-pnote">&#128172; ${esc(s.patient_note)}</div>` : '')}
    ${s.status_at && s.status !== 'open' ? `<div class="tp-when">${TP_STATUS[s.status].label} seit ${new Date(s.status_at).toLocaleDateString('de-DE')}</div>` : ''}
  </div>`;
}

function tpPhaseSections(steps, mode) {
  const pr = tpProgress(steps);
  return TP.phases.map((ph, i) => {
    const list = steps.filter(s => s.phase_id === ph.id).sort((a, b) => a.sort - b.sort);
    if (!list.length && mode !== 'staff') return '';
    return `<section class="tp-phase${ph.id === pr.current ? ' current' : ''}" style="--c:${ph.color}" data-phase="${ph.id}">
      <h2 class="tp-phase-h"><span class="tp-phase-no">${i + 1}</span> ${esc(ph.name)}
        ${ph.id === pr.current ? '<span class="tp-now">aktuell</span>' : ''}</h2>
      ${ph.description ? `<p class="tp-phase-desc">${esc(ph.description)}</p>` : ''}
      <div class="tp-steps">${list.map(s => tpStepCard(s, mode)).join('') || '<p class="muted">Noch keine Schritte in dieser Phase.</p>'}</div>
      ${mode === 'staff' ? `<div class="tp-add">
        <button type="button" class="secondary small-btn" data-addblocks="${ph.id}">+ aus Therapiebausteinen</button>
        <button type="button" class="secondary small-btn" data-addfree="${ph.id}">+ freier Schritt</button></div>` : ''}
    </section>`;
  }).join('');
}

// ============================================================
// Praxis: Übersicht aller Klient:innen
// ============================================================
async function renderPlansPage(profile) {
  if (!isStaff(profile)) { renderMenu(profile); return; }
  try { await tpLoadBase(); } catch (e) { renderShell(profile, 'plaene', 'Therapiepläne', `<div class="card"><p class="error">${esc(e.message)}</p></div>`); return; }
  const [pr, pl, st] = await Promise.all([
    sb.from('profiles').select('id, name, username, permissions').eq('role', 'client'),
    sb.from('care_plans').select('*').eq('archived', false),
    sb.from('plan_steps').select('plan_id, phase_id, status'),
  ]);
  const patients = (pr.data || []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const planBy = {}; (pl.data || []).forEach(p => { planBy[p.patient_id] = p; });
  const stepsBy = {}; (st.data || []).forEach(s => { (stepsBy[s.plan_id] = stepsBy[s.plan_id] || []).push(s); });

  const rows = patients.map(u => {
    const plan = planBy[u.id];
    let status = '<span class="muted">kein Plan</span>', prog = '', phase = '';
    if (plan) {
      const steps = stepsBy[plan.id] || [];
      const p = tpProgress(steps);
      status = plan.visible ? '<span class="status-pill ok">freigegeben</span>' : '<span class="status-pill half">Entwurf</span>';
      prog = steps.length ? `<div class="tp-mini"><span style="width:${Math.round(p.done / p.total * 100)}%"></span></div><span class="status-when">${p.done} / ${p.total} erledigt</span>` : '<span class="muted">leer</span>';
      const ph = TP.phases.find(x => x.id === p.current);
      phase = ph ? `<span class="tp-cat" style="--c:${ph.color}">${esc(ph.name)}</span>` : (steps.length ? '<span class="status-pill ok">abgeschlossen</span>' : '');
    }
    const permOk = can(u, 'therapieplan');
    return `<tr>
      <td><span class="uname-name">${esc(u.name)}</span>${permOk ? '' : '<div class="status-mail">&#9888; Recht &bdquo;Mein Therapieplan&ldquo; fehlt</div>'}</td>
      <td>${status}</td><td>${phase}</td><td>${prog}</td>
      <td><button type="button" class="${plan ? 'secondary ' : ''}small-btn" data-open="${u.id}">${plan ? 'Plan &ouml;ffnen' : 'Plan anlegen'}</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="muted">Noch keine Klient:innen. Zug&auml;nge legst du in der Nutzerverwaltung an (Rolle Klient:in).</td></tr>`;

  const content = `
    <div class="card">
      <div class="tp-head-row"><h2>Klient:innen</h2><span class="spacer"></span>
        <button type="button" class="secondary small-btn" id="tpPhases">Phasen bearbeiten</button></div>
      <div class="tablewrap"><table class="user-table">
        <thead><tr><th>Name</th><th>Plan</th><th>Aktuelle Phase</th><th>Fortschritt</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="hint">Ein Plan ist f&uuml;r die Klient:in erst sichtbar, wenn er <b>freigegeben</b> ist und sie das Recht &bdquo;Mein Therapieplan&ldquo; hat.</p>
    </div>`;
  renderShell(profile, 'plaene', 'Therapiepläne', content);
  document.getElementById('tpPhases').onclick = () => tpPhasesDialog(profile);
  appEl.querySelectorAll('[data-open]').forEach(btn => {
    btn.onclick = async () => {
      const u = patients.find(x => x.id === btn.dataset.open);
      let plan = planBy[u.id];
      if (!plan) {
        const { data, error } = await sb.from('care_plans').insert({ patient_id: u.id, created_by: profile.id }).select().single();
        if (error) { toast('Fehler: ' + error.message); return; }
        plan = data;
      }
      renderPlanEditor(profile, u, plan.id);
    };
  });
}

function tpPhasesDialog(profile) {
  const m = tbModal(`
    <h2>Phasen</h2>
    <p class="hint" style="margin-top:0;">Die Phasen gelten f&uuml;r alle Therapiepl&auml;ne. Namen, Beschreibung und Farbe kannst du anpassen.</p>
    <table class="tb-cattable"><tbody>${TP.phases.map((p, i) => `
      <tr data-id="${p.id}"><td>${i + 1}.</td>
        <td><input type="color" class="p_color" value="${esc(p.color)}"></td>
        <td><input type="text" class="p_name" value="${esc(p.name)}"></td>
        <td><input type="text" class="p_desc" value="${esc(p.description || '')}" placeholder="Beschreibung"></td></tr>`).join('')}
    </tbody></table>
    <div class="modal-actions" style="margin-top:14px;">
      <button type="button" id="p_save">Speichern</button>
      <button type="button" class="secondary" id="p_close">Abbrechen</button></div>
    <p class="error" id="p_err"></p>`);
  m.el.querySelector('#p_close').onclick = m.close;
  m.el.querySelector('#p_save').onclick = async () => {
    for (const tr of m.el.querySelectorAll('tbody tr')) {
      const { error } = await sb.from('plan_phases').update({
        name: tr.querySelector('.p_name').value.trim() || 'Phase', color: tr.querySelector('.p_color').value,
        description: tr.querySelector('.p_desc').value.trim() || null,
      }).eq('id', tr.dataset.id);
      if (error) { m.el.querySelector('#p_err').textContent = 'Fehler: ' + error.message; return; }
    }
    m.close(); toast('Phasen gespeichert.'); renderPlansPage(profile);
  };
}

// ============================================================
// Praxis: Plan einer Klient:in bearbeiten
// ============================================================
async function renderPlanEditor(profile, patient, planId) {
  await tpLoadBase();
  const [pl, st] = await Promise.all([
    sb.from('care_plans').select('*').eq('id', planId).single(),
    sb.from('plan_steps').select('*').eq('plan_id', planId).order('sort'),
  ]);
  if (pl.error) { toast('Fehler: ' + pl.error.message); return; }
  const plan = pl.data, steps = st.data || [];
  const back = { label: 'Therapiepläne', go: () => renderPlansPage(profile) };
  const permOk = can(patient, 'therapieplan');
  const content = `
    <div class="card tp-plan-head">
      <div class="tp-head-row">
        <div><div class="tp-kicker">Therapieplan f&uuml;r</div><h2 style="margin:0;">${esc(patient.name)}</h2></div>
        <span class="spacer"></span>
        <label class="tp-switch"><input type="checkbox" id="tpVisible" ${plan.visible ? 'checked' : ''}> <span>f&uuml;r ${esc(patient.name.split(' ')[0])} freigegeben</span></label>
      </div>
      ${permOk ? '' : `<p class="notice">&#9888; ${esc(patient.name)} hat das Recht &bdquo;Mein Therapieplan&ldquo; nicht &mdash; in der Nutzerverwaltung unter &bdquo;Rechte&ldquo; freischalten.</p>`}
      <div class="modal-form" style="margin-top:12px;">
        <label class="wide">Titel<input type="text" id="tpTitle" value="${esc(plan.title)}"></label>
        <label class="wide">Einleitung f&uuml;r ${esc(patient.name.split(' ')[0])} <span class="muted">(optional, steht oben im Plan)</span>
          <textarea id="tpIntro" rows="2">${esc(plan.intro || '')}</textarea></label>
      </div>
      <div class="modal-actions" style="margin-top:10px;">
        <button type="button" class="secondary small-btn" id="tpSaveHead">Titel &amp; Einleitung speichern</button>
        <span class="spacer"></span>
        <button type="button" class="secondary small-btn" id="tpPreview">Vorschau wie ${esc(patient.name.split(' ')[0])}</button>
        <button type="button" class="danger small-btn" id="tpArchive">Plan archivieren</button>
      </div>
    </div>
    ${tpTimeline(steps)}
    ${tpPhaseSections(steps, 'staff')}`;
  renderShell(profile, 'plaene', 'Therapieplan', content, back);
  const reload = () => renderPlanEditor(profile, patient, planId);

  document.getElementById('tpVisible').onchange = async (e) => {
    const { error } = await sb.from('care_plans').update({ visible: e.target.checked }).eq('id', planId);
    toast(error ? 'Fehler: ' + error.message : (e.target.checked ? 'Plan freigegeben.' : 'Plan wieder verborgen.'));
  };
  document.getElementById('tpSaveHead').onclick = async () => {
    const { error } = await sb.from('care_plans').update({ title: document.getElementById('tpTitle').value.trim() || 'Mein Therapieplan', intro: document.getElementById('tpIntro').value.trim() || null }).eq('id', planId);
    toast(error ? 'Fehler: ' + error.message : 'Gespeichert.');
  };
  document.getElementById('tpArchive').onclick = async () => {
    if (!confirm('Plan archivieren? Er ist dann für ' + patient.name + ' nicht mehr sichtbar. Danach kann ein neuer Plan angelegt werden.')) return;
    const { error } = await sb.from('care_plans').update({ archived: true, visible: false }).eq('id', planId);
    if (error) { toast('Fehler: ' + error.message); return; }
    toast('Plan archiviert.'); renderPlansPage(profile);
  };
  document.getElementById('tpPreview').onclick = () => {
    const m = tbModal(`<h2>Vorschau: so sieht ${esc(patient.name.split(' ')[0])} den Plan</h2>
      <div class="tp-preview">${tpPatientHtml(plan, steps, perm(patient, 'therapieplan') === 'edit' ? 'edit' : 'view', patient)}</div>
      <div class="modal-actions" style="margin-top:12px;"><button type="button" id="pv_close">Schlie&szlig;en</button></div>`);
    m.el.querySelector('.modal').classList.add('wide-modal');
    m.el.querySelectorAll('.tp-preview button, .tp-preview textarea').forEach(el => { el.disabled = true; });
    m.el.querySelector('#pv_close').onclick = m.close;
  };

  // Status (Praxis darf immer)
  appEl.querySelectorAll('.tp-sbtn').forEach(btn => {
    btn.onclick = async () => {
      const { error } = await sb.from('plan_steps').update({ status: btn.dataset.status, status_at: new Date().toISOString(), status_by: profile.id }).eq('id', btn.dataset.step);
      if (error) { toast('Fehler: ' + error.message); return; }
      reload();
    };
  });
  appEl.querySelectorAll('[data-move]').forEach(btn => {
    btn.onclick = async () => {
      const card = btn.closest('.tp-step');
      const s = steps.find(x => x.id === card.dataset.id);
      const list = steps.filter(x => x.phase_id === s.phase_id).sort((a, b) => a.sort - b.sort);
      const i = list.indexOf(s), j = i + parseInt(btn.dataset.move, 10);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      for (let k = 0; k < list.length; k++) await sb.from('plan_steps').update({ sort: (k + 1) * 10 }).eq('id', list[k].id);
      reload();
    };
  });
  appEl.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => tpStepDialog(profile, planId, steps.find(x => x.id === btn.closest('.tp-step').dataset.id), null, reload);
  });
  appEl.querySelectorAll('[data-addfree]').forEach(btn => {
    btn.onclick = () => tpStepDialog(profile, planId, null, btn.dataset.addfree, reload, steps);
  });
  appEl.querySelectorAll('[data-addblocks]').forEach(btn => {
    btn.onclick = () => tpBlockPicker(planId, btn.dataset.addblocks, steps, reload);
  });
}

function tpNextSort(steps, phaseId) {
  return steps.filter(s => s.phase_id === phaseId).reduce((a, s) => Math.max(a, s.sort), 0) + 10;
}

function tpStepDialog(profile, planId, s, phaseId, done, steps) {
  const isNew = !s;
  s = s || { title: '', phase_id: phaseId, status: 'open' };
  const m = tbModal(`
    <h2>${isNew ? 'Neuer Schritt' : 'Schritt bearbeiten'}</h2>
    <form id="sForm" class="modal-form">
      <label class="wide">Titel<input type="text" id="s_title" required value="${esc(s.title)}"></label>
      <label>Phase<select id="s_phase">${TP.phases.map(p => `<option value="${p.id}" ${p.id === s.phase_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>Kategorie<select id="s_cat"><option value="">– ohne –</option>${TP.cats.map(c => `<option value="${c.id}" ${c.id === s.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label>Erledigen bis <span class="muted">(optional)</span><input type="date" id="s_due" value="${esc(s.due_date || '')}"></label>
      <label>Dauer<input type="text" id="s_dur" value="${esc(s.duration || '')}"></label>
      <label class="wide">Anwendung / Dosierung<input type="text" id="s_app" value="${esc(s.application || '')}"></label>
      <label>Produkt / Hersteller<input type="text" id="s_prod" value="${esc(s.product || '')}"></label>
      <label>Link<input type="url" id="s_link" value="${esc(s.link_url || '')}"></label>
      <label class="wide">Text f&uuml;r die Klient:in<textarea id="s_text" rows="4">${esc(s.patient_text || '')}</textarea></label>
      <div class="modal-actions wide">
        <button type="submit">Speichern</button>
        <button type="button" class="secondary" id="s_cancel">Abbrechen</button>
        ${isNew ? '' : '<span class="spacer"></span><button type="button" class="danger" id="s_del">Schritt l&ouml;schen</button>'}
      </div>
      <p class="error wide" id="s_err"></p>
    </form>`);
  const $ = (id) => m.el.querySelector('#' + id);
  $('s_cancel').onclick = m.close;
  $('sForm').onsubmit = async (e) => {
    e.preventDefault();
    const v = {
      title: $('s_title').value.trim(), phase_id: $('s_phase').value, category_id: $('s_cat').value || null,
      due_date: $('s_due').value || null, duration: $('s_dur').value.trim() || null, application: $('s_app').value.trim() || null,
      product: $('s_prod').value.trim() || null, link_url: $('s_link').value.trim() || null, patient_text: $('s_text').value.trim() || null,
    };
    const res = isNew
      ? await sb.from('plan_steps').insert({ ...v, plan_id: planId, sort: tpNextSort(steps || [], v.phase_id) })
      : await sb.from('plan_steps').update(v).eq('id', s.id);
    if (res.error) { $('s_err').textContent = 'Fehler: ' + res.error.message; return; }
    m.close(); toast('Gespeichert.'); done();
  };
  if (!isNew) $('s_del').onclick = async () => {
    if (!confirm('Schritt „' + s.title + '“ löschen?')) return;
    const { error } = await sb.from('plan_steps').delete().eq('id', s.id);
    if (error) { $('s_err').textContent = 'Fehler: ' + error.message; return; }
    m.close(); toast('Gelöscht.'); done();
  };
}

// Bausteine auswählen und als Schritte übernehmen (Inhalte werden kopiert → danach je Person anpassbar)
async function tpBlockPicker(planId, phaseId, steps, done) {
  const { data: blocks, error } = await sb.from('therapy_blocks').select('*').eq('active', true).order('title');
  if (error) { toast('Fehler: ' + error.message); return; }
  if (!blocks.length) { toast('Noch keine Therapiebausteine angelegt.'); return; }
  const phase = TP.phases.find(p => p.id === phaseId);
  let q = '', cat = '';
  const chosen = new Set();
  const m = tbModal(`
    <h2>Bausteine &rarr; ${esc(phase.name)}</h2>
    <input type="search" id="bp_q" placeholder="Suchen …" style="width:100%;margin-bottom:10px;">
    <div class="tb-filter" id="bp_cats"></div>
    <div class="bp-list" id="bp_list"></div>
    <div class="modal-actions" style="margin-top:12px;">
      <button type="button" id="bp_ok" disabled>&Uuml;bernehmen</button>
      <button type="button" class="secondary" id="bp_cancel">Abbrechen</button>
      <span class="spacer"></span><span class="hint" id="bp_n"></span></div>`);
  const $ = (id) => m.el.querySelector('#' + id);
  const draw = () => {
    $('bp_cats').innerHTML = [{ id: '', name: 'Alle', color: '#ffffff' }, ...TP.cats.filter(c => blocks.some(b => b.category_id === c.id))]
      .map(c => `<button type="button" class="tb-chip${cat === c.id ? ' on' : ''}" data-c="${c.id}" style="--c:${c.color}">${esc(c.name)}</button>`).join('');
    $('bp_cats').querySelectorAll('[data-c]').forEach(b => { b.onclick = () => { cat = b.dataset.c; draw(); }; });
    const ql = q.toLowerCase();
    const list = blocks.filter(b => (!cat || b.category_id === cat) &&
      (!ql || [b.title, b.patient_text, b.product, (b.tags || []).join(' ')].some(v => (v || '').toLowerCase().includes(ql))));
    $('bp_list').innerHTML = list.map(b => {
      const c = tpCat(b.category_id);
      return `<label class="bp-item" style="--c:${c ? c.color : '#a0a0b8'}"><input type="checkbox" value="${b.id}" ${chosen.has(b.id) ? 'checked' : ''}>
        <span><b>${esc(b.title)}</b>${c ? ` <span class="tp-cat">${esc(c.name)}</span>` : ''}
        ${b.application ? `<br><small>${esc(b.application)}</small>` : ''}</span></label>`;
    }).join('') || '<p class="muted">Keine Treffer.</p>';
    $('bp_list').querySelectorAll('input').forEach(i => { i.onchange = () => { i.checked ? chosen.add(i.value) : chosen.delete(i.value); count(); }; });
  };
  const count = () => { $('bp_n').textContent = chosen.size ? chosen.size + ' ausgewählt' : ''; $('bp_ok').disabled = !chosen.size; };
  $('bp_q').oninput = (e) => { q = e.target.value; draw(); };
  $('bp_cancel').onclick = m.close;
  $('bp_ok').onclick = async () => {
    let sort = tpNextSort(steps, phaseId);
    const rows = blocks.filter(b => chosen.has(b.id)).map(b => ({
      plan_id: planId, phase_id: phaseId, sort: (sort += 10), block_id: b.id, category_id: b.category_id,
      title: b.title, patient_text: b.patient_text, application: b.application, product: b.product,
      duration: b.duration, link_url: b.link_url,
    }));
    const { error } = await sb.from('plan_steps').insert(rows);
    if (error) { toast('Fehler: ' + error.message); return; }
    m.close(); toast(rows.length + ' Schritt(e) übernommen.'); done();
  };
  draw(); count(); $('bp_q').focus();
}

// ============================================================
// Klient:in: Mein Therapieplan
// ============================================================
function tpPatientHtml(plan, steps, mode, who) {
  const pr = tpProgress(steps);
  const first = (who && who.name || '').split(' ')[0];
  return `
    <div class="card tp-hero">
      <div class="tp-kicker">${esc(first ? 'Hallo ' + first : '')}</div>
      <h2 style="margin:2px 0 6px;">${esc(plan.title)}</h2>
      ${plan.intro ? `<p class="tp-intro">${esc(plan.intro).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="tp-hero-stat"><b>${pr.done}</b> von <b>${pr.total}</b> Schritten erledigt</div>
    </div>
    ${tpTimeline(steps)}
    ${steps.length ? tpPhaseSections(steps, mode) : '<div class="card"><p class="muted">Dein Plan wird gerade vorbereitet.</p></div>'}
    ${mode === 'view' ? '<p class="hint">Den Status deiner Schritte setzt die Praxis.</p>' : ''}`;
}

async function renderMyPlan(profile) {
  await tpLoadBase();
  const { data: plans } = await sb.from('care_plans').select('*').eq('patient_id', profile.id).order('created_at', { ascending: false }).limit(1);
  const plan = plans && plans[0];
  if (!plan) {
    renderShell(profile, 'meinplan', 'Mein Therapieplan', `<div class="card"><h2>Noch kein Plan</h2><p class="muted">Dein Therapieplan wird von der Praxis erstellt und erscheint hier, sobald er freigegeben ist.</p></div>`);
    return;
  }
  const { data: steps } = await sb.from('plan_steps').select('*').eq('plan_id', plan.id).order('sort');
  const mode = perm(profile, 'therapieplan') === 'edit' ? 'edit' : 'view';
  renderShell(profile, 'meinplan', 'Mein Therapieplan', tpPatientHtml(plan, steps || [], mode, profile));
  appEl.querySelectorAll('.tp-sbtn').forEach(btn => {
    btn.onclick = async () => {
      const { error } = await sb.rpc('set_step_status', { p_step: btn.dataset.step, p_status: btn.dataset.status });
      if (error) { toast('Fehler: ' + error.message); return; }
      toast(btn.dataset.status === 'done' ? 'Super, erledigt!' : 'Status gespeichert.');
      renderMyPlan(profile);
    };
  });
  appEl.querySelectorAll('.tp-note').forEach(ta => {
    const orig = ta.value;
    ta.onblur = async () => {
      if (ta.value === orig) return;
      const s = (steps || []).find(x => x.id === ta.dataset.note);
      const { error } = await sb.rpc('set_step_status', { p_step: s.id, p_status: s.status, p_note: ta.value.trim() });
      toast(error ? 'Fehler: ' + error.message : 'Notiz gespeichert.');
    };
  });
}
