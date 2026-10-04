// ============================================================
// Gesundheitsbude-App — Therapieplan (SCHICHTWECHSEL-Programm)
// Praxis: Paket je Klient:in wählen → Plan wird aus passenden Bausteinen befüllt, individuell anpassen,
//         Termine pflegen, Einträge der Klient:in sehen
// Klient:in: „Mein Therapieplan“ — Termine, Phasen, Aufgaben, Einträge (täglich/wöchentlich), Fortschritt
// ============================================================
const TP_STATUS = {
  open: { label: 'Offen', icon: '&#9675;' },
  doing: { label: 'In Arbeit', icon: '&#9680;' },
  done: { label: 'Erledigt', icon: '&#10003;' },
};
const TP_APPT_TYPES = {
  anamnese: 'Anamnese',
  diagnostik: 'Diagnostik',
  ergebnis: 'Ergebnis & Empfehlung',
  followup: 'Follow-up (nach 10–12 Wochen)',
  sonstiges: 'Termin',
};
const TP_APPT_STATUS = { offen: 'noch nicht vereinbart', geplant: 'geplant', erfolgt: 'erfolgt', abgesagt: 'abgesagt' };
const TP = { phases: [], cats: [] };

async function tpLoadBase() {
  const [ph, ca] = await Promise.all([
    sb.from('plan_phases').select('*').order('no'),
    sb.from('block_categories').select('*').order('sort'),
    pgLoadPackages(),
  ]);
  if (ph.error) throw new Error(ph.error.message);
  TP.phases = ph.data || [];
  TP.cats = ca.data || [];
}
const tpCat = (id) => TP.cats.find(c => c.id === id);
const tpFmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const tpFmtShort = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '';
const tpFmtDT = (iso) => { const d = new Date(iso); return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'; };
const tpInPkg = (ph, pkg) => !pkg || (pkg.phases || []).includes(ph.no);
// Wiederkehrende Aufgabe ohne eigenes Tracking → einfaches Abhaken pro Tag/Woche
const tpTrack = (s) => s.tracking_type && s.tracking_type !== 'keins' ? s.tracking_type : (s.frequency !== 'einmalig' ? 'check' : 'keins');

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

function tpTimeline(steps, pkg, hideLocked) {
  const pr = tpProgress(steps);
  return `<div class="tp-timeline">
    ${pr.per.filter(p => !hideLocked || tpInPkg(p.ph, pkg)).map(p => {
      const locked = !tpInPkg(p.ph, pkg);
      const state = locked ? 'locked' : !p.total ? 'empty' : (p.done === p.total ? 'done' : (p.ph.id === pr.current ? 'current' : 'todo'));
      return `<div class="tp-tl-step ${state}" style="--c:${p.ph.color}">
        <div class="tp-tl-dot">${state === 'done' ? '&#10003;' : (locked ? '&#128274;' : p.ph.no)}</div>
        <div class="tp-tl-name">${esc(p.ph.name)}</div>
        <div class="tp-tl-sub">${locked ? 'nicht im Paket' : (p.total ? p.done + ' / ' + p.total : '&ndash;')}</div>
      </div>`;
    }).join('<div class="tp-tl-line"></div>')}
  </div>
  <div class="tp-bar"><span style="width:${pr.total ? Math.round(pr.done / pr.total * 100) : 0}%"></span></div>`;
}

// ---------- Einträge (Tracking) ----------
function tpLogValue(l, tt) {
  const parts = [];
  if (l.done) parts.push('&#10003;');
  if (l.scale != null) parts.push('<b>' + l.scale + '</b>/10');
  if (l.text) parts.push('&bdquo;' + esc(l.text) + '&ldquo;');
  return parts.join(' ') || (tt === 'check' ? '&ndash;' : '');
}

function tpLogSummary(s, logs) {
  if (!logs.length) return tpTrack(s) !== 'keins' ? '<div class="tp-logsum muted">&#128200; noch keine Eintr&auml;ge</div>' : '';
  const sc = logs.filter(l => l.scale != null);
  const avg = sc.length ? (sc.reduce((a, l) => a + l.scale, 0) / sc.length).toFixed(1).replace('.', ',') : null;
  return `<div class="tp-logsum">&#128200; ${logs.length} Eintr&auml;ge &middot; zuletzt ${tpFmtShort(logs[0].log_date)}${avg ? ' &middot; &Oslash; ' + avg + '/10' : ''}
    <button type="button" class="link-btn" data-logs="${s.id}">ansehen</button></div>`;
}

// Verlauf als Punkte: letzte 7 Tage bzw. 6 Wochen
function tpHistory(s, logs) {
  const weekly = s.frequency === 'woechentlich';
  const n = weekly ? 6 : 7;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - (weekly ? 7 * i : i));
    const key = pgPeriod(s.frequency, d);
    const l = logs.find(x => x.log_date === key);
    const lbl = weekly ? 'KW ab ' + tpFmtShort(key) : d.toLocaleDateString('de-DE', { weekday: 'short' });
    out.push(`<span class="pg-hist${l ? ' on' : ''}" title="${esc(lbl)}${l ? ': ' + (l.scale != null ? l.scale + '/10 ' : '') + (l.text || '') : ''}">
      <i>${l ? (l.scale != null ? l.scale : '&#10003;') : ''}</i><small>${weekly ? tpFmtShort(key) : esc(lbl.slice(0, 2))}</small></span>`);
  }
  return `<div class="pg-histrow">${out.join('')}</div>`;
}

function tpTrackBox(s, logs) {
  const tt = tpTrack(s);
  const period = s.frequency === 'einmalig' ? pgISO() : pgPeriod(s.frequency);
  const cur = logs.find(l => l.log_date === (s.frequency === 'einmalig' ? (logs[0] || {}).log_date : period)) || {};
  const label = s.frequency === 'woechentlich' ? 'Diese Woche' : (s.frequency === 'taeglich' ? 'Heute' : 'Dein Eintrag');
  const q = s.tracking_question || (tt === 'check' ? (s.frequency === 'woechentlich' ? 'Diese Woche umgesetzt?' : 'Heute umgesetzt?') : (tt === 'freitext' ? 'Was hast du beobachtet?' : 'Wie war es?'));
  const hasScale = tt === 'skala' || tt === 'skala_freitext', hasText = tt === 'freitext' || tt === 'skala_freitext';
  return `<div class="pg-track" data-track="${s.id}" data-period="${cur.log_date || period}">
    <div class="pg-track-h"><span class="pg-track-when">${label}</span> <span class="pg-track-q">${esc(q)}</span></div>
    ${tt === 'check' ? `<button type="button" class="pg-check${cur.done ? ' on' : ''}" data-act="check">${cur.done ? '&#10003; erledigt' : '&#9675; abhaken'}</button>` : ''}
    ${hasScale ? `<div class="pg-scale">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => `<button type="button" class="${cur.scale === v ? 'on' : ''}" data-act="scale" data-v="${v}">${v}</button>`).join('')}</div>` : ''}
    ${hasText ? `<textarea class="pg-text" rows="2" placeholder="Deine Notiz &hellip;">${esc(cur.text || '')}</textarea>
      <div><button type="button" class="secondary small-btn" data-act="save">Speichern</button></div>` : ''}
    ${s.frequency !== 'einmalig' ? tpHistory(s, logs) : ''}
  </div>`;
}

// Schritt-Karte (gemeinsam für Praxis und Klient:in); mode: staff | edit | view
function tpStepCard(s, mode, ctx) {
  const cat = tpCat(s.category_id);
  const st = TP_STATUS[s.status] || TP_STATUS.open;
  const logs = ((ctx && ctx.logs) || {})[s.id] || [];
  const tt = tpTrack(s);
  const meta = [
    s.due_date ? `<span class="pg-badge">&#128197; bis ${tpFmtDate(s.due_date)}</span>` : '',
    s.duration ? `<span class="pg-badge">&#128198; ${esc(s.duration)}</span>` : '',
  ].join('');
  let ctl;
  if (mode === 'view') ctl = `<span class="tp-status s-${s.status}">${st.icon} ${st.label}</span>`;
  else if (mode === 'staff') ctl = `<div class="tp-status-btns">${Object.entries(TP_STATUS).map(([k, v]) =>
      `<button type="button" class="tp-sbtn s-${k}${s.status === k ? ' on' : ''}" data-status="${k}" data-step="${s.id}">${v.icon} ${v.label}</button>`).join('')}</div>` + tpLogSummary(s, logs);
  else if (tt !== 'keins') ctl = tpTrackBox(s, logs) + (s.status === 'done' ? '<span class="tp-status s-done">&#10003; Erledigt</span>' : '');
  else if (s.task_type === 'wissen') ctl = `<button type="button" class="tp-sbtn s-done${s.status === 'done' ? ' on' : ''}" data-status="${s.status === 'done' ? 'open' : 'done'}" data-step="${s.id}">${s.status === 'done' ? '&#10003; gelesen' : '&#128214; als gelesen markieren'}</button>`;
  else ctl = `<div class="tp-status-btns">${Object.entries(TP_STATUS).map(([k, v]) =>
      `<button type="button" class="tp-sbtn s-${k}${s.status === k ? ' on' : ''}" data-status="${k}" data-step="${s.id}">${v.icon} ${v.label}</button>`).join('')}</div>`;
  return `<div class="tp-step s-${s.status}" style="--c:${cat ? cat.color : '#a0a0b8'}" data-id="${s.id}">
    <div class="tp-step-head">
      <div>
        ${cat ? `<span class="tp-cat">${esc(cat.name)}</span>` : ''}
        <div class="tp-step-title">${esc(s.title)}</div>
        <div class="tp-meta pg-badges">${pgMeta(s)}${meta}</div>
      </div>
      ${mode === 'staff' ? `<div class="tp-step-tools">
        <button type="button" class="secondary small-btn" data-move="-1" title="nach oben">&uarr;</button>
        <button type="button" class="secondary small-btn" data-move="1" title="nach unten">&darr;</button>
        <button type="button" class="secondary small-btn" data-edit>Bearbeiten</button></div>` : ''}
    </div>
    ${s.patient_text ? `<div class="tp-text">${esc(s.patient_text).replace(/\n/g, '<br>')}</div>` : ''}
    ${s.application ? `<div class="tp-line">&#128073; <b>So geht's:</b> ${esc(s.application)}</div>` : ''}
    ${s.product ? `<div class="tp-line">&#127991; <b>Produkt:</b> ${esc(s.product)}</div>` : ''}
    ${s.link_url ? `<div class="tp-line">&#128279; <a href="${esc(s.link_url)}" target="_blank" rel="noopener">Mehr dazu</a></div>` : ''}
    ${ctl}
    ${mode === 'edit' ? `<textarea class="tp-note" data-note="${s.id}" rows="2" placeholder="Notiz an die Praxis (optional) …">${esc(s.patient_note || '')}</textarea>`
      : (s.patient_note ? `<div class="tp-pnote">&#128172; ${esc(s.patient_note)}</div>` : '')}
    ${s.status_at && s.status !== 'open' ? `<div class="tp-when">${TP_STATUS[s.status].label} seit ${new Date(s.status_at).toLocaleDateString('de-DE')}</div>` : ''}
  </div>`;
}

function tpPhaseSections(steps, mode, ctx) {
  const pr = tpProgress(steps);
  const pkg = ctx && ctx.pkg;
  return TP.phases.map(ph => {
    const list = steps.filter(s => s.phase_id === ph.id).sort((a, b) => a.sort - b.sort);
    const locked = !tpInPkg(ph, pkg);
    if (mode !== 'staff' && (!list.length || locked)) return '';
    // Themenfeld-Reihenfolge innerhalb der Phase für Klient:innen beibehalten (Praxis sortiert selbst)
    return `<section class="tp-phase${ph.id === pr.current ? ' current' : ''}${locked ? ' locked' : ''}" style="--c:${ph.color}" data-phase="${ph.id}">
      <h2 class="tp-phase-h"><span class="tp-phase-no">${ph.no}</span> ${esc(ph.name)}
        ${ph.id === pr.current ? '<span class="tp-now">aktuell</span>' : ''}${locked ? '<span class="tp-locked">nicht im Paket</span>' : ''}</h2>
      ${ph.description ? `<p class="tp-phase-desc">${esc(ph.description)}</p>` : ''}
      <div class="tp-steps">${list.map(s => tpStepCard(s, mode, ctx)).join('') || '<p class="muted">Noch keine Schritte in dieser Phase.</p>'}</div>
      ${mode === 'staff' ? `<div class="tp-add">
        <button type="button" class="secondary small-btn" data-addblocks="${ph.id}">+ aus Therapiebausteinen</button>
        <button type="button" class="secondary small-btn" data-addfree="${ph.id}">+ freier Schritt</button></div>` : ''}
    </section>`;
  }).join('');
}

function tpGroupByStep(logs) {
  const by = {};
  (logs || []).slice().sort((a, b) => b.log_date.localeCompare(a.log_date)).forEach(l => { (by[l.step_id] = by[l.step_id] || []).push(l); });
  return by;
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
    let status = '<span class="muted">kein Plan</span>', prog = '', phase = '', pkgCell = '<span class="muted">&ndash;</span>';
    if (plan) {
      const steps = stepsBy[plan.id] || [];
      const p = tpProgress(steps);
      const pkg = pgPkg(plan.package);
      pkgCell = pkg ? `<span class="pg-badge pkg">${PG_PKG_SHORT[pkg.key]}</span> ${esc(pkg.name)}` : '<span class="status-pill half">kein Paket</span>';
      status = plan.visible ? '<span class="status-pill ok">freigegeben</span>' : '<span class="status-pill half">Entwurf</span>';
      prog = steps.length ? `<div class="tp-mini"><span style="width:${Math.round(p.done / p.total * 100)}%"></span></div><span class="status-when">${p.done} / ${p.total} erledigt</span>` : '<span class="muted">leer</span>';
      const ph = TP.phases.find(x => x.id === p.current);
      phase = ph ? `<span class="tp-cat" style="--c:${ph.color}">${ph.no}. ${esc(ph.name)}</span>` : (steps.length ? '<span class="status-pill ok">abgeschlossen</span>' : '');
    }
    const permOk = can(u, 'therapieplan');
    return `<tr>
      <td><span class="uname-name">${esc(u.name)}</span>${permOk ? '' : '<div class="status-mail">&#9888; Recht &bdquo;Mein Therapieplan&ldquo; fehlt</div>'}</td>
      <td>${pkgCell}</td><td>${status}</td><td>${phase}</td><td>${prog}</td>
      <td><button type="button" class="${plan ? 'secondary ' : ''}small-btn" data-open="${u.id}">${plan ? 'Plan &ouml;ffnen' : 'Plan anlegen'}</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">Noch keine Klient:innen. Zug&auml;nge legst du in der Nutzerverwaltung an (Rolle Klient:in).</td></tr>`;

  const content = `
    <div class="card">
      <div class="tp-head-row"><h2>Klient:innen</h2><span class="spacer"></span>
        ${isAdmin(profile) ? '<button type="button" class="secondary small-btn" id="tpPkgs">Pakete</button>' : ''}
        <button type="button" class="secondary small-btn" id="tpPhases">Phasen bearbeiten</button></div>
      <div class="tablewrap"><table class="user-table">
        <thead><tr><th>Name</th><th>Paket</th><th>Plan</th><th>Aktuelle Phase</th><th>Fortschritt</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="hint">Im Plan w&auml;hlst du das <b>Paket</b> &mdash; die App &uuml;bernimmt dann alle passenden Therapiebausteine (Phase + Paket). Danach kannst du den Plan individuell anpassen. Sichtbar ist er erst, wenn er <b>freigegeben</b> ist und die Klient:in das Recht &bdquo;Mein Therapieplan&ldquo; hat.</p>
    </div>
    <div class="card"><h3>Pakete</h3>
      <div class="pg-pkgcards">${PG.packages.map(p => `<div class="pg-pkgcard"><b>${PG_PKG_SHORT[p.key]} &middot; ${esc(p.name)}</b>
        <span>${p.price != null ? Number(p.price).toLocaleString('de-DE') + ' &euro; zzgl. Labor' : ''}</span>
        <span>Phasen ${(p.phases || []).join(', ')}${p.group_call ? ' &middot; Gruppencall' : ''}</span>
        ${p.description ? `<small>${esc(p.description)}</small>` : ''}</div>`).join('')}</div>
    </div>`;
  renderShell(profile, 'plaene', 'Therapiepläne', content);
  document.getElementById('tpPhases').onclick = () => tpPhasesDialog(profile);
  if (isAdmin(profile)) document.getElementById('tpPkgs').onclick = () => tpPackagesDialog(profile);
  appEl.querySelectorAll('[data-open]').forEach(btn => {
    btn.onclick = async () => {
      const u = patients.find(x => x.id === btn.dataset.open);
      let plan = planBy[u.id];
      if (!plan) {
        const { data, error } = await sb.from('care_plans').insert({ patient_id: u.id, title: 'Dein SCHICHTWECHSEL', created_by: profile.id }).select().single();
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
    <p class="hint" style="margin-top:0;">Die 4 Programmphasen gelten f&uuml;r alle Pl&auml;ne. Namen, Beschreibung und Farbe kannst du anpassen; welche Phase in welchem Paket steckt, legst du unter &bdquo;Pakete&ldquo; fest.</p>
    <table class="tb-cattable"><tbody>${TP.phases.map(p => `
      <tr data-id="${p.id}"><td>${p.no}.</td>
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

function tpPackagesDialog(profile) {
  const m = tbModal(`
    <h2>Pakete</h2>
    <p class="hint" style="margin-top:0;">Welche Phasen ein Paket freischaltet und ob der Gruppencall dazugeh&ouml;rt. Welche Aufgaben in welchem Paket erscheinen, stellst du zus&auml;tzlich je Baustein ein.</p>
    ${PG.packages.map(p => `<div class="pg-pkgedit" data-key="${p.key}">
      <div class="modal-form">
        <label>Name (${PG_PKG_SHORT[p.key]})<input type="text" class="k_name" value="${esc(p.name)}"></label>
        <label>Preis (&euro;)<input type="number" class="k_price" value="${p.price ?? ''}"></label>
        <div class="wide pg-pkgs"><span>Phasen</span>${TP.phases.map(ph => `<label class="check"><input type="checkbox" class="k_ph" value="${ph.no}" ${(p.phases || []).includes(ph.no) ? 'checked' : ''}> ${ph.no}. ${esc(ph.name)}</label>`).join('')}</div>
        <label class="wide check"><input type="checkbox" class="k_gc" ${p.group_call ? 'checked' : ''}> w&ouml;chentlicher Gruppencall inklusive</label>
        <label class="wide">Beschreibung<input type="text" class="k_desc" value="${esc(p.description || '')}"></label>
      </div></div>`).join('')}
    <div class="modal-actions" style="margin-top:14px;">
      <button type="button" id="k_save">Speichern</button>
      <button type="button" class="secondary" id="k_close">Abbrechen</button></div>
    <p class="error" id="k_err"></p>`);
  m.el.querySelector('#k_close').onclick = m.close;
  m.el.querySelector('#k_save').onclick = async () => {
    for (const box of m.el.querySelectorAll('.pg-pkgedit')) {
      const price = box.querySelector('.k_price').value;
      const { error } = await sb.from('packages').update({
        name: box.querySelector('.k_name').value.trim() || box.dataset.key,
        price: price === '' ? null : Number(price),
        phases: [...box.querySelectorAll('.k_ph:checked')].map(i => parseInt(i.value, 10)),
        group_call: box.querySelector('.k_gc').checked,
        description: box.querySelector('.k_desc').value.trim() || null,
      }).eq('key', box.dataset.key);
      if (error) { m.el.querySelector('#k_err').textContent = 'Fehler: ' + error.message; return; }
    }
    m.close(); toast('Pakete gespeichert.'); renderPlansPage(profile);
  };
}

// ============================================================
// Praxis: Plan einer Klient:in bearbeiten
// ============================================================
async function renderPlanEditor(profile, patient, planId) {
  await tpLoadBase();
  const [pl, st, lg, ap] = await Promise.all([
    sb.from('care_plans').select('*').eq('id', planId).single(),
    sb.from('plan_steps').select('*').eq('plan_id', planId).order('sort'),
    sb.from('step_logs').select('*').eq('patient_id', patient.id),
    sb.from('appointments').select('*').eq('patient_id', patient.id).order('sort'),
  ]);
  if (pl.error) { toast('Fehler: ' + pl.error.message); return; }
  const plan = pl.data, steps = st.data || [], appts = ap.data || [];
  const pkg = pgPkg(plan.package);
  const ctx = { logs: tpGroupByStep(lg.data), pkg, appts };
  const first = esc(patient.name.split(' ')[0]);
  const back = { label: 'Therapiepläne', go: () => renderPlansPage(profile) };
  const permOk = can(patient, 'therapieplan');
  const content = `
    <div class="card tp-plan-head">
      <div class="tp-head-row">
        <div><div class="tp-kicker">Therapieplan f&uuml;r</div><h2 style="margin:0;">${esc(patient.name)}</h2></div>
        <span class="spacer"></span>
        <label class="tp-switch"><input type="checkbox" id="tpVisible" ${plan.visible ? 'checked' : ''}> <span>f&uuml;r ${first} freigegeben</span></label>
      </div>
      ${permOk ? '' : `<p class="notice">&#9888; ${esc(patient.name)} hat das Recht &bdquo;Mein Therapieplan&ldquo; nicht &mdash; in der Nutzerverwaltung unter &bdquo;Rechte&ldquo; freischalten.</p>`}
      <div class="pg-pkgrow">
        <label>Paket
          <select id="tpPkg"><option value="">– noch kein Paket –</option>
            ${PG.packages.map(p => `<option value="${p.key}" ${p.key === plan.package ? 'selected' : ''}>${PG_PKG_SHORT[p.key]} · ${esc(p.name)}</option>`).join('')}</select></label>
        ${pkg ? `<span class="hint">Phasen ${(pkg.phases || []).join(', ')}${pkg.group_call ? ' &middot; Gruppencall' : ''}${plan.package_since ? ' &middot; seit ' + new Date(plan.package_since).toLocaleDateString('de-DE') : ''}</span>` : ''}
        <span class="spacer"></span>
        ${pkg ? '<button type="button" class="secondary small-btn" id="tpSync">Neue Bausteine erg&auml;nzen</button>' : ''}
      </div>
      <div class="modal-form" style="margin-top:12px;">
        <label class="wide">Titel<input type="text" id="tpTitle" value="${esc(plan.title)}"></label>
        <label class="wide">Einleitung f&uuml;r ${first} <span class="muted">(optional, steht oben im Plan)</span>
          <textarea id="tpIntro" rows="2">${esc(plan.intro || '')}</textarea></label>
      </div>
      <div class="modal-actions" style="margin-top:10px;">
        <button type="button" class="secondary small-btn" id="tpSaveHead">Titel &amp; Einleitung speichern</button>
        <span class="spacer"></span>
        <button type="button" class="secondary small-btn" id="tpPreview">Vorschau wie ${first}</button>
        <button type="button" class="danger small-btn" id="tpArchive">Plan archivieren</button>
      </div>
    </div>
    ${tpApptCardStaff(appts)}
    ${tpTimeline(steps, pkg)}
    ${pgThemeBars(steps, TP.cats)}
    ${tpPhaseSections(steps, 'staff', ctx)}`;
  renderShell(profile, 'plaene', 'Therapieplan', content, back);
  const reload = () => renderPlanEditor(profile, patient, planId);

  document.getElementById('tpVisible').onchange = async (e) => {
    const { error } = await sb.from('care_plans').update({ visible: e.target.checked }).eq('id', planId);
    toast(error ? 'Fehler: ' + error.message : (e.target.checked ? 'Plan freigegeben.' : 'Plan wieder verborgen.'));
  };
  document.getElementById('tpPkg').onchange = (e) => tpChangePackage(profile, patient, plan, steps, appts, e.target.value, reload);
  if (pkg) document.getElementById('tpSync').onclick = () => tpSyncBlocks(plan, pkg, steps, reload, true);
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
    const m = tbModal(`<h2>Vorschau: so sieht ${first} den Plan</h2>
      <div class="tp-preview">${tpPatientHtml(plan, steps, perm(patient, 'therapieplan') === 'edit' ? 'edit' : 'view', patient, ctx)}</div>
      <div class="modal-actions" style="margin-top:12px;"><button type="button" id="pv_close">Schlie&szlig;en</button></div>`);
    m.el.querySelector('.modal').classList.add('wide-modal');
    m.el.querySelectorAll('.tp-preview button, .tp-preview textarea').forEach(el => { el.disabled = true; });
    m.el.querySelector('#pv_close').onclick = m.close;
  };
  const apEdit = document.getElementById('tpApptEdit');
  if (apEdit) apEdit.onclick = () => tpApptDialog(profile, patient, appts, reload);

  // Status (Praxis darf immer)
  appEl.querySelectorAll('.tp-sbtn').forEach(btn => {
    btn.onclick = async () => {
      const { error } = await sb.from('plan_steps').update({ status: btn.dataset.status, status_at: new Date().toISOString(), status_by: profile.id }).eq('id', btn.dataset.step);
      if (error) { toast('Fehler: ' + error.message); return; }
      reload();
    };
  });
  appEl.querySelectorAll('[data-logs]').forEach(btn => {
    btn.onclick = () => tpLogsDialog(steps.find(s => s.id === btn.dataset.logs), ctx.logs[btn.dataset.logs] || []);
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

// Paket wählen / wechseln (Upgrade jederzeit; vorhandene Schritte + Fortschritt bleiben erhalten)
async function tpChangePackage(profile, patient, plan, steps, appts, key, reload) {
  const old = pgPkg(plan.package), pkg = pgPkg(key);
  if (!pkg) {
    if (!confirm('Paket entfernen? Die vorhandenen Schritte bleiben im Plan.')) { reload(); return; }
    await sb.from('care_plans').update({ package: null }).eq('id', plan.id);
    reload(); return;
  }
  const { data: blocks, error } = await sb.from('therapy_blocks').select('*').eq('active', true);
  if (error) { toast('Fehler: ' + error.message); reload(); return; }
  const have = new Set(steps.map(s => s.block_id).filter(Boolean));
  const add = blocks.filter(b => pgBlockFits(b, pkg, TP.phases) && !have.has(b.id));
  const lost = old ? TP.phases.filter(ph => (old.phases || []).includes(ph.no) && !(pkg.phases || []).includes(ph.no)) : [];
  let msg = (old ? 'Paket wechseln: ' + old.name + ' → ' + pkg.name : 'Paket „' + pkg.name + '“ zuweisen') + '\n\n' +
    add.length + ' passende Aufgabe(n) werden in den Plan übernommen.';
  if (old) msg += '\nBereits vorhandene Schritte und Fortschritt bleiben erhalten.';
  if (lost.length) msg += '\n\nAchtung: Phase ' + lost.map(p => p.no).join(', ') + ' ist im neuen Paket nicht enthalten und wird für ' + patient.name.split(' ')[0] + ' ausgeblendet (Schritte bleiben gespeichert).';
  if (!appts.length) msg += '\n\nDie 4 Programmtermine (Anamnese, Diagnostik, Ergebnis, Follow-up) werden angelegt.';
  if (!confirm(msg)) { reload(); return; }
  const up = await sb.from('care_plans').update({ package: pkg.key, package_since: new Date().toISOString() }).eq('id', plan.id);
  if (up.error) { toast('Fehler: ' + up.error.message); reload(); return; }
  if (add.length) {
    const err = await tpInsertBlocks(plan.id, add, steps);
    if (err) { toast('Fehler: ' + err.message); reload(); return; }
  }
  if (!appts.length) {
    const rows = ['anamnese', 'diagnostik', 'ergebnis', 'followup'].map((t, i) => ({
      patient_id: patient.id, type: t, title: TP_APPT_TYPES[t], status: 'offen', sort: (i + 1) * 10, created_by: profile.id }));
    await sb.from('appointments').insert(rows);
  }
  toast(pkg.name + ' zugewiesen' + (add.length ? ', ' + add.length + ' Aufgaben übernommen.' : '.'));
  reload();
}

// Neue/zusätzliche Bausteine des Pakets ergänzen (z. B. nachdem Katrin neue Bausteine angelegt hat)
async function tpSyncBlocks(plan, pkg, steps, reload) {
  const { data: blocks, error } = await sb.from('therapy_blocks').select('*').eq('active', true);
  if (error) { toast('Fehler: ' + error.message); return; }
  const have = new Set(steps.map(s => s.block_id).filter(Boolean));
  const add = blocks.filter(b => pgBlockFits(b, pkg, TP.phases) && !have.has(b.id));
  if (!add.length) { toast('Alle passenden Bausteine sind schon im Plan.'); return; }
  if (!confirm(add.length + ' neue Aufgabe(n) aus den Therapiebausteinen ergänzen?\n\n' + add.slice(0, 12).map(b => '• ' + b.title).join('\n') + (add.length > 12 ? '\n…' : ''))) return;
  const err = await tpInsertBlocks(plan.id, add, steps);
  if (err) { toast('Fehler: ' + err.message); return; }
  toast(add.length + ' Aufgabe(n) ergänzt.'); reload();
}

// Reihenfolge: Phase → Themenfeld → Typ (Wissen vor Quick Win vor Tracking vor Reflexion) → Titel
async function tpInsertBlocks(planId, blocks, steps) {
  const typeOrder = Object.keys(PG_TYPES);
  const catSort = (id) => (tpCat(id) || { sort: 9999 }).sort;
  const sorted = blocks.slice().sort((a, b) =>
    catSort(a.category_id) - catSort(b.category_id) || typeOrder.indexOf(a.task_type) - typeOrder.indexOf(b.task_type) || a.title.localeCompare(b.title, 'de'));
  const next = {};
  const rows = sorted.map(b => {
    if (next[b.phase_id] == null) next[b.phase_id] = tpNextSort(steps, b.phase_id);
    const r = pgStepFromBlock(b, planId, b.phase_id, next[b.phase_id]);
    next[b.phase_id] += 10;
    return r;
  });
  const { error } = await sb.from('plan_steps').insert(rows);
  return error;
}

function tpLogsDialog(s, logs) {
  const tt = tpTrack(s);
  const m = tbModal(`<h2>Eintr&auml;ge: ${esc(s.title)}</h2>
    ${s.tracking_question ? `<p class="hint" style="margin-top:0;">Frage: ${esc(s.tracking_question)}</p>` : ''}
    <div class="tablewrap" style="max-height:60vh;overflow:auto;"><table>
      <thead><tr><th>${s.frequency === 'woechentlich' ? 'Woche ab' : 'Datum'}</th><th>Eintrag</th></tr></thead>
      <tbody>${logs.map(l => `<tr><td class="nowrap">${tpFmtDate(l.log_date)}</td><td>${tpLogValue(l, tt)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">keine</td></tr>'}</tbody>
    </table></div>
    <div class="modal-actions" style="margin-top:12px;"><button type="button" id="lg_close">Schlie&szlig;en</button></div>`);
  m.el.querySelector('#lg_close').onclick = m.close;
}

// ---------- Termine ----------
function tpApptList(appts) {
  if (!appts.length) return '<p class="muted">Noch keine Termine.</p>';
  return `<div class="pg-appts">${appts.map(a => `
    <div class="pg-appt st-${a.status}">
      <span class="pg-appt-dot">${a.status === 'erfolgt' ? '&#10003;' : (a.status === 'abgesagt' ? '&times;' : '&#128197;')}</span>
      <div><b>${esc(a.title)}</b>
        <div class="pg-appt-when">${a.starts_at ? tpFmtDT(a.starts_at) : 'wird noch vereinbart'}${a.status === 'erfolgt' || a.status === 'abgesagt' ? ' &middot; ' + TP_APPT_STATUS[a.status] : ''}</div>
        ${a.note ? `<div class="pg-appt-note">${esc(a.note)}</div>` : ''}</div>
    </div>`).join('')}</div>`;
}
function tpApptCardStaff(appts) {
  return `<div class="card"><div class="tp-head-row"><h3 style="margin:0;">Termine</h3><span class="spacer"></span>
    <button type="button" class="secondary small-btn" id="tpApptEdit">Termine bearbeiten</button></div>
    ${tpApptList(appts)}</div>`;
}
const tpLocalDT = (iso) => { if (!iso) return ''; const d = new Date(iso); return pgISO(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

function tpApptDialog(profile, patient, appts, done) {
  const row = (a) => `<tr data-id="${a.id || ''}">
    <td><input type="text" class="a_title" value="${esc(a.title)}"><select class="a_type">${Object.entries(TP_APPT_TYPES).map(([k, l]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
    <td><input type="datetime-local" class="a_when" value="${tpLocalDT(a.starts_at)}"></td>
    <td><select class="a_status">${Object.entries(TP_APPT_STATUS).map(([k, l]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td><input type="text" class="a_note" value="${esc(a.note || '')}" placeholder="Ort / Hinweis (sieht die Klient:in)"></td>
    <td><button type="button" class="danger small-btn a_del">&times;</button></td></tr>`;
  const m = tbModal(`<h2>Termine: ${esc(patient.name)}</h2>
    <div class="tablewrap"><table class="pg-appt-table"><thead><tr><th>Termin</th><th>Datum &amp; Uhrzeit</th><th>Status</th><th>Hinweis</th><th></th></tr></thead>
      <tbody>${appts.map(row).join('')}</tbody></table></div>
    <div class="modal-actions" style="margin-top:12px;">
      <button type="button" class="secondary small-btn" id="a_add">+ Termin</button><span class="spacer"></span>
      <button type="button" id="a_save">Speichern</button>
      <button type="button" class="secondary" id="a_close">Abbrechen</button></div>
    <p class="hint">Datum eintragen setzt den Status automatisch auf &bdquo;geplant&ldquo;.</p>
    <p class="error" id="a_err"></p>`);
  m.el.querySelector('.modal').classList.add('wide-modal');
  const tbody = m.el.querySelector('tbody');
  const removed = [];
  const wire = () => {
    tbody.querySelectorAll('.a_del').forEach(b => { b.onclick = () => { const tr = b.closest('tr'); if (tr.dataset.id) removed.push(tr.dataset.id); tr.remove(); }; });
    tbody.querySelectorAll('.a_when').forEach(i => { i.onchange = () => { const s = i.closest('tr').querySelector('.a_status'); if (i.value && s.value === 'offen') s.value = 'geplant'; }; });
    tbody.querySelectorAll('.a_type').forEach(sel => { sel.onchange = () => { const t = sel.closest('tr').querySelector('.a_title'); if (!t.value.trim() || Object.values(TP_APPT_TYPES).includes(t.value)) t.value = TP_APPT_TYPES[sel.value]; }; });
  };
  m.el.querySelector('#a_add').onclick = () => { tbody.insertAdjacentHTML('beforeend', row({ title: 'Termin', type: 'sonstiges', status: 'offen' })); wire(); };
  m.el.querySelector('#a_close').onclick = m.close;
  m.el.querySelector('#a_save').onclick = async () => {
    const err = m.el.querySelector('#a_err');
    for (const id of removed) { const { error } = await sb.from('appointments').delete().eq('id', id); if (error) { err.textContent = 'Fehler: ' + error.message; return; } }
    const trs = [...tbody.querySelectorAll('tr')];
    for (let i = 0; i < trs.length; i++) {
      const tr = trs[i], when = tr.querySelector('.a_when').value;
      const v = { title: tr.querySelector('.a_title').value.trim() || 'Termin', type: tr.querySelector('.a_type').value,
        starts_at: when ? new Date(when).toISOString() : null, status: tr.querySelector('.a_status').value,
        note: tr.querySelector('.a_note').value.trim() || null, sort: (i + 1) * 10 };
      const { error } = tr.dataset.id ? await sb.from('appointments').update(v).eq('id', tr.dataset.id)
        : await sb.from('appointments').insert({ ...v, patient_id: patient.id, created_by: profile.id });
      if (error) { err.textContent = 'Fehler: ' + error.message; return; }
    }
    m.close(); toast('Termine gespeichert.'); done();
  };
  wire();
}

function tpNextSort(steps, phaseId) {
  return steps.filter(s => s.phase_id === phaseId).reduce((a, s) => Math.max(a, s.sort), 0) + 10;
}

function tpStepDialog(profile, planId, s, phaseId, done, steps) {
  const isNew = !s;
  s = s || { title: '', phase_id: phaseId, status: 'open', task_type: 'quickwin', frequency: 'einmalig', tracking_type: 'keins' };
  const opts = (obj, cur) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');
  const m = tbModal(`
    <h2>${isNew ? 'Neuer Schritt' : 'Schritt bearbeiten'}</h2>
    <form id="sForm" class="modal-form">
      <label class="wide">Titel<input type="text" id="s_title" required value="${esc(s.title)}"></label>
      <label>Phase<select id="s_phase">${TP.phases.map(p => `<option value="${p.id}" ${p.id === s.phase_id ? 'selected' : ''}>${p.no}. ${esc(p.name)}</option>`).join('')}</select></label>
      <label>Themenfeld<select id="s_cat"><option value="">– ohne –</option>${TP.cats.map(c => `<option value="${c.id}" ${c.id === s.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label>Typ<select id="s_type">${opts(Object.fromEntries(Object.entries(PG_TYPES).map(([k, v]) => [k, v.label])), s.task_type)}</select></label>
      <label>Zeitaufwand (Min.)<input type="number" id="s_min" min="0" max="600" value="${s.est_minutes ?? ''}"></label>
      <label>Frequenz<select id="s_freq">${opts(PG_FREQ, s.frequency)}</select></label>
      <label>Eintrag der Klient:in<select id="s_track">${opts(PG_TRACK, s.tracking_type)}</select></label>
      <label class="wide">Tracking-Frage<input type="text" id="s_tq" value="${esc(s.tracking_question || '')}"></label>
      <label>Erledigen bis <span class="muted">(optional)</span><input type="date" id="s_due" value="${esc(s.due_date || '')}"></label>
      <label>Zeitraum<input type="text" id="s_dur" value="${esc(s.duration || '')}"></label>
      <label class="wide">Anwendung / So geht's<input type="text" id="s_app" value="${esc(s.application || '')}"></label>
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
  $('s_type').onchange = () => { const d = PG_TYPE_DEFAULTS[$('s_type').value]; $('s_freq').value = d.frequency; $('s_track').value = d.tracking_type; };
  $('sForm').onsubmit = async (e) => {
    e.preventDefault();
    const v = {
      title: $('s_title').value.trim(), phase_id: $('s_phase').value, category_id: $('s_cat').value || null,
      task_type: $('s_type').value, est_minutes: $('s_min').value ? parseInt($('s_min').value, 10) : null,
      frequency: $('s_freq').value, tracking_type: $('s_track').value, tracking_question: $('s_tq').value.trim() || null,
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
    if (!confirm('Schritt „' + s.title + '“ löschen?' + ' Einträge der Klient:in zu diesem Schritt werden mitgelöscht.')) return;
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
  const inPlan = new Set(steps.map(s => s.block_id).filter(Boolean));
  let q = '', cat = '', onlyPhase = blocks.some(b => b.phase_id === phaseId);
  const chosen = new Set();
  const m = tbModal(`
    <h2>Bausteine &rarr; ${esc(phase.name)}</h2>
    <input type="search" id="bp_q" placeholder="Suchen …" style="width:100%;margin-bottom:10px;">
    <label class="check" style="display:block;margin-bottom:8px;"><input type="checkbox" id="bp_ph" ${onlyPhase ? 'checked' : ''}> nur Bausteine dieser Phase</label>
    <div class="tb-filter" id="bp_cats"></div>
    <div class="bp-list" id="bp_list"></div>
    <div class="modal-actions" style="margin-top:12px;">
      <button type="button" id="bp_ok" disabled>&Uuml;bernehmen</button>
      <button type="button" class="secondary" id="bp_cancel">Abbrechen</button>
      <span class="spacer"></span><span class="hint" id="bp_n"></span></div>`);
  const $ = (id) => m.el.querySelector('#' + id);
  const draw = () => {
    const pool = blocks.filter(b => !onlyPhase || b.phase_id === phaseId);
    $('bp_cats').innerHTML = [{ id: '', name: 'Alle', color: '#ffffff' }, ...TP.cats.filter(c => pool.some(b => b.category_id === c.id))]
      .map(c => `<button type="button" class="tb-chip${cat === c.id ? ' on' : ''}" data-c="${c.id}" style="--c:${c.color}">${esc(c.name)}</button>`).join('');
    $('bp_cats').querySelectorAll('[data-c]').forEach(b => { b.onclick = () => { cat = b.dataset.c; draw(); }; });
    const ql = q.toLowerCase();
    const list = pool.filter(b => (!cat || b.category_id === cat) &&
      (!ql || [b.title, b.patient_text, b.product, (b.tags || []).join(' ')].some(v => (v || '').toLowerCase().includes(ql))));
    $('bp_list').innerHTML = list.map(b => {
      const c = tpCat(b.category_id);
      return `<label class="bp-item" style="--c:${c ? c.color : '#a0a0b8'}"><input type="checkbox" value="${b.id}" ${chosen.has(b.id) ? 'checked' : ''}>
        <span><b>${esc(b.title)}</b>${c ? ` <span class="tp-cat">${esc(c.name)}</span>` : ''}${inPlan.has(b.id) ? ' <span class="pg-badge warn">schon im Plan</span>' : ''}
        <br><span class="pg-badges">${pgMeta(b)}${pgPkgBadges(b.packages)}</span></span></label>`;
    }).join('') || '<p class="muted">Keine Treffer.</p>';
    $('bp_list').querySelectorAll('input').forEach(i => { i.onchange = () => { i.checked ? chosen.add(i.value) : chosen.delete(i.value); count(); }; });
  };
  const count = () => { $('bp_n').textContent = chosen.size ? chosen.size + ' ausgewählt' : ''; $('bp_ok').disabled = !chosen.size; };
  $('bp_q').oninput = (e) => { q = e.target.value; draw(); };
  $('bp_ph').onchange = (e) => { onlyPhase = e.target.checked; cat = ''; draw(); };
  $('bp_cancel').onclick = m.close;
  $('bp_ok').onclick = async () => {
    let sort = tpNextSort(steps, phaseId);
    const rows = blocks.filter(b => chosen.has(b.id)).map(b => pgStepFromBlock(b, planId, phaseId, (sort += 10)));
    const { error } = await sb.from('plan_steps').insert(rows);
    if (error) { toast('Fehler: ' + error.message); return; }
    m.close(); toast(rows.length + ' Schritt(e) übernommen.'); done();
  };
  draw(); count(); $('bp_q').focus();
}

// ============================================================
// Klient:in: Mein Therapieplan
// ============================================================
function tpPatientHtml(plan, steps, mode, who, ctx) {
  ctx = ctx || {};
  const pkg = ctx.pkg;
  const shown = steps.filter(s => { const ph = TP.phases.find(p => p.id === s.phase_id); return !ph || tpInPkg(ph, pkg); });
  const pr = tpProgress(shown);
  const first = (who && who.name || '').split(' ')[0];
  const upcoming = (ctx.appts || []).filter(a => a.status !== 'abgesagt');
  return `
    <div class="card tp-hero">
      <div class="tp-kicker">${esc(first ? 'Hallo ' + first : '')}${pkg ? ' &middot; ' + esc(pkg.name) : ''}</div>
      <h2 style="margin:2px 0 6px;">${esc(plan.title)}</h2>
      ${plan.intro ? `<p class="tp-intro">${esc(plan.intro).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="tp-hero-stat"><b>${pr.done}</b> von <b>${pr.total}</b> Schritten erledigt</div>
    </div>
    ${upcoming.length ? `<div class="card"><h3>Deine Termine</h3>${tpApptList(upcoming)}</div>` : ''}
    ${pkg && pkg.group_call ? `<div class="card pg-groupcall"><h3>&#128101; W&ouml;chentlicher Gruppencall</h3><p>Jeden Mittwoch um 18:30 Uhr. Den Zugangslink bekommst du von der Praxis.</p></div>` : ''}
    ${tpTimeline(shown, pkg, true)}
    ${pgThemeBars(shown, TP.cats)}
    ${shown.length ? tpPhaseSections(shown, mode, ctx) : '<div class="card"><p class="muted">Dein Plan wird gerade vorbereitet.</p></div>'}
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
  const since = new Date(); since.setDate(since.getDate() - 70);
  const [st, lg, ap] = await Promise.all([
    sb.from('plan_steps').select('*').eq('plan_id', plan.id).order('sort'),
    sb.from('step_logs').select('*').eq('patient_id', profile.id).gte('log_date', pgISO(since)),
    sb.from('appointments').select('*').eq('patient_id', profile.id).order('sort'),
  ]);
  const steps = st.data || [];
  const ctx = { logs: tpGroupByStep(lg.data), pkg: pgPkg(plan.package), appts: ap.data || [] };
  const mode = perm(profile, 'therapieplan') === 'edit' ? 'edit' : 'view';
  const y = window.scrollY;
  renderShell(profile, 'meinplan', 'Mein Therapieplan', tpPatientHtml(plan, steps, mode, profile, ctx));
  window.scrollTo(0, y);
  const again = () => renderMyPlan(profile);
  appEl.querySelectorAll('.tp-sbtn').forEach(btn => {
    btn.onclick = async () => {
      const { error } = await sb.rpc('set_step_status', { p_step: btn.dataset.step, p_status: btn.dataset.status });
      if (error) { toast('Fehler: ' + error.message); return; }
      toast(btn.dataset.status === 'done' ? 'Super, erledigt!' : 'Status gespeichert.');
      again();
    };
  });
  // Einträge: abhaken / Skala / Text
  appEl.querySelectorAll('.pg-track').forEach(box => {
    const s = steps.find(x => x.id === box.dataset.track);
    const cur = ((ctx.logs[s.id] || []).find(l => l.log_date === box.dataset.period)) || {};
    const ta = box.querySelector('.pg-text');
    const send = async (patch) => {
      const v = { done: cur.done ?? null, scale: cur.scale ?? null, text: ta ? ta.value.trim() : (cur.text || null), ...patch };
      const { error } = await sb.rpc('log_step', { p_step: s.id, p_date: box.dataset.period, p_done: v.done, p_scale: v.scale, p_text: v.text || null });
      if (error) { toast('Fehler: ' + error.message); return; }
      toast(s.frequency === 'einmalig' ? 'Gespeichert – erledigt!' : 'Eintrag gespeichert.');
      again();
    };
    box.querySelectorAll('[data-act]').forEach(b => {
      b.onclick = () => {
        if (b.dataset.act === 'check') send({ done: cur.done ? null : true });
        else if (b.dataset.act === 'scale') { const v = parseInt(b.dataset.v, 10); send({ scale: cur.scale === v ? null : v }); }
        else send({});
      };
    });
  });
  appEl.querySelectorAll('.tp-note').forEach(ta => {
    const orig = ta.value;
    ta.onblur = async () => {
      if (ta.value === orig) return;
      const s = steps.find(x => x.id === ta.dataset.note);
      const { error } = await sb.rpc('set_step_status', { p_step: s.id, p_status: s.status, p_note: ta.value.trim() });
      toast(error ? 'Fehler: ' + error.message : 'Notiz gespeichert.');
    };
  });
}
