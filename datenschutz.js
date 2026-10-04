// ============================================================
// Gesundheitsbude-App — Datenschutz
// 2-Faktor-Anmeldung (TOTP) · Einwilligung der Klient:innen · Datenexport (Art. 15/20 DSGVO) · Datenschutzerklärung
// Die eigentliche Absicherung passiert in der Datenbank (my_role / my_perm) und in den Edge Functions;
// diese Datei liefert die Oberfläche dazu.
// ============================================================
const DS = { settings: null };
const DS_CONSENT_VERSION = 'v1-2026-10';

async function dsLoadSettings() {
  const { data } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle();
  DS.settings = data || { mfa_required: false, consent_required: false, consent_version: DS_CONSENT_VERSION };
  return DS.settings;
}

// ---------- Texte (ENTWURF – vor dem Einsatz rechtlich prüfen lassen) ----------
const DS_PRAXIS = 'Gesundheitsbude · Katrin Berger, Heilpraktikerin &amp; Physiotherapeutin · [Straße Hausnummer] · [PLZ] Gelsenkirchen · [E-Mail] · [Telefon]';
const DS_CONSENT_HTML = `
  <p>Damit wir dich mit der SCHICHTWECHSEL-App begleiten k&ouml;nnen, speichern und verarbeiten wir <b>Gesundheitsdaten</b> von dir. Das sind besonders gesch&uuml;tzte Daten (Art. 9 DSGVO). Deshalb brauchen wir deine ausdr&uuml;ckliche Einwilligung.</p>
  <p><b>Welche Daten?</b> Laborbefunde und Laborwerte, dein Therapieplan mit Einnahmen und Dosierungen, deine Eintr&auml;ge (Tagebuch, Routinen, Einnahmen, Zyklus), Termine sowie Name und Anmeldedaten.</p>
  <p><b>Wof&uuml;r?</b> Ausschlie&szlig;lich f&uuml;r deine Begleitung durch die Praxis: Auswertung, Therapieempfehlung, Verlaufskontrolle und Erinnerung an deine Schritte. Keine Werbung, keine Weitergabe an Dritte zu eigenen Zwecken.</p>
  <p><b>Wer sieht sie?</b> Nur du und das Praxisteam der Gesundheitsbude. Die Daten liegen verschl&uuml;sselt bei unserem Auftragsverarbeiter Supabase auf Servern in der EU (Irland). Jeder Zugriff auf Befunde wird protokolliert.</p>
  <p><b>Freiwillig und widerruflich.</b> Die Einwilligung ist freiwillig. Ohne sie kannst du die App nicht nutzen; deine Behandlung in der Praxis bleibt davon unber&uuml;hrt. Du kannst sie jederzeit unter &bdquo;Mein Konto&ldquo; f&uuml;r die Zukunft widerrufen. Du kannst jederzeit eine Kopie deiner Daten herunterladen.</p>
  <p class="hint">Verantwortlich: ${DS_PRAXIS}. Einzelheiten in der <a href="#" data-privacy>Datenschutzerkl&auml;rung</a>.</p>`;

const DS_PRIVACY_HTML = `
  <p class="notice">Entwurf &mdash; vor dem Einsatz bitte rechtlich pr&uuml;fen lassen und Platzhalter [&hellip;] ausf&uuml;llen.</p>
  <h3>1. Verantwortliche</h3><p>${DS_PRAXIS}</p>
  <h3>2. Zweck der App</h3><p>Die SCHICHTWECHSEL-App dient der Begleitung von Klient:innen der Gesundheitsbude: Therapiepl&auml;ne, Laborbefunde, Einnahmen, Routinen, Tagebuch und Termine. Zug&auml;nge werden ausschlie&szlig;lich pers&ouml;nlich von der Praxis vergeben.</p>
  <h3>3. Verarbeitete Daten</h3><ul>
    <li>Stammdaten und Anmeldung: Name, Benutzername, ggf. E-Mail, Passwort (nur verschl&uuml;sselt gespeichert), Anmeldezeitpunkte</li>
    <li>Gesundheitsdaten: Laborbefunde und -werte, Therapiepl&auml;ne, Einnahmen und Dosierungen, Tagebuch-, Routinen-, Einnahme- und Zyklus-Eintr&auml;ge, Termine</li>
    <li>Protokolldaten: wer wann Befunde hochgeladen, angesehen oder gel&ouml;scht hat</li></ul>
  <h3>4. Rechtsgrundlagen</h3><p>Art. 9 Abs. 2 lit. a i. V. m. Art. 6 Abs. 1 lit. a DSGVO (ausdr&uuml;ckliche Einwilligung) f&uuml;r Gesundheitsdaten; Art. 6 Abs. 1 lit. b DSGVO (Behandlungsvertrag) f&uuml;r Stamm- und Termindaten; Art. 6 Abs. 1 lit. c DSGVO f&uuml;r gesetzliche Aufbewahrungspflichten; Art. 6 Abs. 1 lit. f DSGVO f&uuml;r die Sicherheitsprotokollierung.</p>
  <h3>5. Empf&auml;nger / Auftragsverarbeiter</h3><ul>
    <li><b>Supabase Inc.</b> (Datenbank, Anmeldung, Dateispeicher) &mdash; Server in der EU (Irland), Auftragsverarbeitungsvertrag nach Art. 28 DSGVO, Standardvertragsklauseln.</li>
    <li><b>GitHub Inc.</b> (Bereitstellung des App-Programmcodes, GitHub Pages) &mdash; verarbeitet beim Aufruf technisch die IP-Adresse; es werden dort keine Gesundheitsdaten gespeichert. [Pr&uuml;fen: Hosting ggf. zu einem EU-Anbieter verlegen.]</li></ul>
  <p>Die App l&auml;dt keine Schriften, Skripte oder Tracker von Drittanbietern. Es werden keine Cookies zu Analyse- oder Werbezwecken gesetzt; im Browser wird nur die Anmeldung gespeichert.</p>
  <h3>6. Speicherdauer</h3><p>Gesundheitsdaten werden gespeichert, solange die Begleitung l&auml;uft, und anschlie&szlig;end entsprechend der beruflichen Dokumentationspflichten [Frist pr&uuml;fen, z. B. 10 Jahre nach Abschluss der Behandlung] aufbewahrt und danach gel&ouml;scht. Nach einem Widerruf der Einwilligung werden die Daten in der App gesperrt und gel&ouml;scht, soweit keine Aufbewahrungspflicht entgegensteht.</p>
  <h3>7. Sicherheit</h3><p>Verschl&uuml;sselte &Uuml;bertragung (HTTPS) und Speicherung, Zugriff nur nach Anmeldung, Rechte je Person, Zwei-Faktor-Anmeldung f&uuml;r das Praxisteam, Dateien in einem privaten Speicher mit kurzlebigen Zugriffslinks, Zugriffsprotokoll, automatische Abmeldung des Praxisteams nach 30 Minuten.</p>
  <h3>8. Deine Rechte</h3><p>Auskunft (Art. 15), Berichtigung (Art. 16), L&ouml;schung (Art. 17), Einschr&auml;nkung (Art. 18), Daten&uuml;bertragbarkeit (Art. 20 &mdash; Download unter &bdquo;Mein Konto&ldquo;), Widerruf der Einwilligung jederzeit mit Wirkung f&uuml;r die Zukunft (Art. 7 Abs. 3), Beschwerde bei einer Aufsichtsbeh&ouml;rde, z. B. der Landesbeauftragten f&uuml;r Datenschutz und Informationsfreiheit NRW.</p>
  <p class="hint">Stand: Oktober 2026 &middot; Fassung ${DS_CONSENT_VERSION}</p>`;

function dsShowPrivacy() {
  const m = tbModal(`<h2>Datenschutzerkl&auml;rung</h2><div class="ds-text">${DS_PRIVACY_HTML}</div>
    <div class="modal-actions" style="margin-top:12px;"><button type="button" id="dp_close">Schlie&szlig;en</button></div>`);
  m.el.querySelector('.modal').classList.add('wide-modal');
  m.el.querySelector('#dp_close').onclick = m.close;
}
document.addEventListener('click', (e) => { const a = e.target.closest('[data-privacy]'); if (a) { e.preventDefault(); dsShowPrivacy(); } });

// ============================================================
// Tor nach dem Login: 2. Faktor bzw. Einwilligung, bevor die App startet
// ============================================================
async function dsGate(profile, user) {
  await dsLoadSettings();
  const staff = profile.role === 'admin' || profile.role === 'team';
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') { dsMfaVerifyScreen(user); return false; }
  if (staff && DS.settings.mfa_required && (!aal || aal.nextLevel !== 'aal2')) { dsMfaEnrollScreen(user, true); return false; }
  if (!staff && DS.settings.consent_required) {
    const { data: c } = await sb.from('consents').select('id').eq('user_id', profile.id).eq('version', DS.settings.consent_version).is('revoked_at', null).maybeSingle();
    if (!c) { dsConsentScreen(profile, user); return false; }
  }
  return true;
}

function dsCard(inner) {
  appEl.innerHTML = `<main class="login-page"><div class="login-card ds-card">
    <div class="login-logo"><img src="${LOGO_SRC}" alt="Gesundheitsbude"></div>${inner}
    <p class="hint" style="text-align:center;margin-top:14px;"><a href="#" id="dsLogout">Abmelden</a> &middot; <a href="#" data-privacy>Datenschutz</a></p></div></main>`;
  document.getElementById('dsLogout').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); };
}

async function dsTotpFactor() {
  const { data } = await sb.auth.mfa.listFactors();
  return ((data && data.totp) || []).find(f => f.status === 'verified');
}

function dsMfaVerifyScreen(user) {
  dsCard(`<h1>Sicherheitscode</h1>
    <p class="sub">Gib den 6-stelligen Code aus deiner Authenticator-App ein.</p>
    <form id="mfaForm" class="auth-form">
      <label>Code<input type="text" id="mfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></label>
      <button type="submit">Best&auml;tigen</button>
      <p class="error" id="mfaErr"></p>
    </form>
    <p class="hint" style="text-align:center;">Handy verloren? Eine Admin kann deinen 2. Faktor in der Nutzerverwaltung zur&uuml;cksetzen.</p>`);
  document.getElementById('mfaForm').onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('mfaErr');
    const f = await dsTotpFactor();
    if (!f) { err.textContent = 'Kein 2. Faktor gefunden.'; return; }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code: document.getElementById('mfaCode').value.trim() });
    if (error) { err.textContent = 'Code falsch oder abgelaufen. Bitte den aktuellen Code eingeben.'; return; }
    toast('Angemeldet.'); renderDashboard(user);
  };
}

// Einrichtung: QR-Code scannen, Code bestätigen. forced = Pflicht (Praxis), sonst aus „Mein Konto“
async function dsMfaEnrollScreen(user, forced, done) {
  // nicht abgeschlossene Versuche aufräumen
  const { data: fl } = await sb.auth.mfa.listFactors();
  for (const f of ((fl && fl.all) || []).filter(x => x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator ' + new Date().toISOString().slice(0, 16) });
  if (error) { toast('2-Faktor konnte nicht gestartet werden: ' + error.message); if (!forced && done) done(); return; }
  const html = `<h1>2-Faktor-Anmeldung einrichten</h1>
    ${forced ? '<p class="sub">F&uuml;r Praxis-Zug&auml;nge ist die 2-Faktor-Anmeldung Pflicht &mdash; sie sch&uuml;tzt die Gesundheitsdaten eurer Klient:innen.</p>' : ''}
    <ol class="ds-steps">
      <li>Authenticator-App &ouml;ffnen (z. B. Google Authenticator, Microsoft Authenticator, 1Password, Apple Passw&ouml;rter).</li>
      <li>Diesen QR-Code scannen:<div class="ds-qr"><canvas id="dsQr" width="180" height="180"></canvas></div>
        <details><summary>QR-Code geht nicht? Schl&uuml;ssel von Hand eingeben</summary><code class="ds-secret">${esc(data.totp.secret)}</code></details></li>
      <li>Den 6-stelligen Code aus der App hier eingeben:</li></ol>
    <form id="enForm" class="auth-form">
      <label>Code<input type="text" id="enCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
      <button type="submit">Aktivieren</button>
      ${forced ? '' : '<button type="button" class="secondary" id="enCancel">Abbrechen</button>'}
      <p class="error" id="enErr"></p>
    </form>`;
  let m = null;
  if (forced) dsCard(html);
  else { m = tbModal(`<div class="ds-card">${html}</div>`); }
  const root = forced ? appEl : m.el;
  if (window.QRCode) QRCode.toCanvas(root.querySelector('#dsQr'), data.totp.uri, { width: 180, margin: 1 });
  if (!forced) root.querySelector('#enCancel').onclick = async () => { await sb.auth.mfa.unenroll({ factorId: data.id }); m.close(); if (done) done(); };
  root.querySelector('#enForm').onsubmit = async (e) => {
    e.preventDefault();
    const { error: ve } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: root.querySelector('#enCode').value.trim() });
    if (ve) { root.querySelector('#enErr').textContent = 'Code falsch. Bitte den aktuellen Code aus der App eingeben.'; return; }
    // ältere Faktoren entfernen (neu eingerichtet = alter Faktor ersetzt)
    const { data: all } = await sb.auth.mfa.listFactors();
    for (const f of ((all && all.totp) || []).filter(x => x.id !== data.id)) await sb.auth.mfa.unenroll({ factorId: f.id });
    toast('2-Faktor-Anmeldung ist aktiv.');
    if (forced) renderDashboard(user); else { m.close(); if (done) done(); }
  };
}

function dsConsentScreen(profile, user) {
  dsCard(`<h1>Einwilligung</h1>
    <p class="sub">Bevor es losgeht: Bitte lies, wie wir mit deinen Daten umgehen.</p>
    <div class="ds-text ds-consent">${DS_CONSENT_HTML}</div>
    <form id="coForm" class="auth-form">
      <label class="check ds-check"><input type="checkbox" id="co1" required> Ich willige ausdr&uuml;cklich ein, dass die Gesundheitsbude meine Gesundheitsdaten wie beschrieben f&uuml;r meine Begleitung in der App verarbeitet (Art. 9 Abs. 2 lit. a DSGVO).</label>
      <label class="check ds-check"><input type="checkbox" id="co2" required> Ich habe die Datenschutzerkl&auml;rung zur Kenntnis genommen.</label>
      <button type="submit">Zustimmen und weiter</button>
      <button type="button" class="secondary" id="coNo">Nicht zustimmen</button>
      <p class="error" id="coErr"></p>
    </form>`);
  document.getElementById('coNo').onclick = async () => {
    if (!confirm('Ohne Einwilligung kannst du die App nicht nutzen. Deine Behandlung in der Praxis bleibt davon unberührt.\n\nAbmelden?')) return;
    await sb.auth.signOut();
  };
  document.getElementById('coForm').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc('give_consent', { p_version: DS.settings.consent_version });
    if (error) { document.getElementById('coErr').textContent = 'Fehler: ' + error.message; return; }
    toast('Danke! Deine Einwilligung ist gespeichert.'); renderDashboard(user);
  };
}

// ============================================================
// Mein Konto: 2-Faktor, Einwilligung, Datenexport
// ============================================================
async function dsAccountCardsHtml(profile) {
  await dsLoadSettings();
  const staff = isStaff(profile);
  const f = await dsTotpFactor();
  let consent = null;
  if (!staff) {
    const { data } = await sb.from('consents').select('*').eq('user_id', profile.id).eq('version', DS.settings.consent_version).maybeSingle();
    consent = data;
  }
  return `
    <div class="card"><h2>2-Faktor-Anmeldung</h2>
      ${f ? `<p><span class="status-pill ok">aktiv</span> seit ${new Date(f.created_at).toLocaleDateString('de-DE')}</p>` : `<p><span class="status-pill ${staff && DS.settings.mfa_required ? 'open' : 'half'}">nicht eingerichtet</span></p>`}
      <p class="hint">Zus&auml;tzlich zum Passwort wird bei der Anmeldung ein Code aus einer Authenticator-App abgefragt.${staff ? ' F&uuml;r Praxis-Zug&auml;nge dringend empfohlen' + (DS.settings.mfa_required ? ' und Pflicht' : '') + '.' : ''}</p>
      <div class="modal-actions"><button type="button" class="${f ? 'secondary ' : ''}small-btn" id="dsMfaSetup">${f ? 'Neues Ger&auml;t einrichten' : 'Jetzt einrichten'}</button>
        ${f && !(staff && DS.settings.mfa_required) ? '<button type="button" class="danger small-btn" id="dsMfaOff">Ausschalten</button>' : ''}</div>
    </div>
    ${staff ? '' : `<div class="card"><h2>Meine Daten</h2>
      <p>${consent && !consent.revoked_at ? `Einwilligung erteilt am ${new Date(consent.accepted_at).toLocaleDateString('de-DE')}.` : 'Keine g&uuml;ltige Einwilligung.'}</p>
      <div class="modal-actions">
        <button type="button" class="secondary small-btn" id="dsExportMe">&#11015; Meine Daten herunterladen</button>
        <button type="button" class="secondary small-btn" data-privacy>Datenschutzerkl&auml;rung</button>
        ${consent && !consent.revoked_at ? '<button type="button" class="danger small-btn" id="dsRevoke">Einwilligung widerrufen</button>' : ''}</div>
      <p class="hint">Der Download enth&auml;lt alle Daten, die du in der App sehen kannst, als Datei (ZIP mit JSON und deinen Dokumenten).</p></div>`}
    ${staff ? '<div class="card"><h2>Datenschutz</h2><button type="button" class="secondary small-btn" data-privacy>Datenschutzerkl&auml;rung ansehen</button></div>' : ''}`;
}

function dsWireAccount(profile, again) {
  const setup = document.getElementById('dsMfaSetup');
  if (setup) setup.onclick = async () => {
    const { data: { user } } = await sb.auth.getUser();
    const f = await dsTotpFactor();
    if (f) {   // Ändern nur mit aktueller 2-Faktor-Sitzung
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal.currentLevel !== 'aal2') { toast('Bitte erst ab- und mit Code neu anmelden.'); return; }
    }
    dsMfaEnrollScreen(user, false, again);
  };
  const off = document.getElementById('dsMfaOff');
  if (off) off.onclick = async () => {
    if (!confirm('2-Faktor-Anmeldung ausschalten? Dein Konto ist dann nur noch durch das Passwort geschützt.')) return;
    const f = await dsTotpFactor();
    const { error } = await sb.auth.mfa.unenroll({ factorId: f.id });
    if (error) { toast('Fehler: ' + error.message + (/aal2/i.test(error.message) ? ' – bitte mit Code neu anmelden.' : '')); return; }
    await sb.auth.refreshSession(); toast('Ausgeschaltet.'); again();
  };
  const ex = document.getElementById('dsExportMe');
  if (ex) ex.onclick = () => dsExport(profile.id, profile.name, true);
  const rv = document.getElementById('dsRevoke');
  if (rv) rv.onclick = async () => {
    if (!confirm('Einwilligung widerrufen?\n\nDu kannst die App danach nicht mehr nutzen; deine Daten werden gesperrt. Lade sie vorher bei Bedarf herunter. Die Praxis wird informiert und löscht die Daten, soweit keine Aufbewahrungspflicht besteht.')) return;
    const { error } = await sb.rpc('revoke_consent');
    if (error) { toast('Fehler: ' + error.message); return; }
    alert('Deine Einwilligung wurde widerrufen. Du wirst jetzt abgemeldet.');
    await sb.auth.signOut();
  };
}

// ============================================================
// Datenexport je Klient:in (Praxis) bzw. eigene Daten (Klient:in)
// ============================================================
async function dsExport(patientId, name, self) {
  toast('Export wird erstellt …');
  try {
    const q = async (table, build) => { const { data, error } = await build(sb.from(table).select('*')); return error ? { fehler: error.message } : (data || []); };
    const out = { erstellt: new Date().toISOString(), hinweis: 'Datenexport aus der SCHICHTWECHSEL-App der Gesundheitsbude (Art. 15/20 DSGVO).' };
    out.profil = await q('profiles', b => b.eq('id', patientId));
    out.einwilligungen = await q('consents', b => b.eq('user_id', patientId));
    out.therapieplaene = await q('care_plans', b => b.eq('patient_id', patientId));
    const planIds = Array.isArray(out.therapieplaene) ? out.therapieplaene.map(p => p.id) : [];
    out.plan_schritte = planIds.length ? await q('plan_steps', b => b.in('plan_id', planIds)) : [];
    out.schritt_eintraege = await q('step_logs', b => b.eq('patient_id', patientId));
    out.termine = await q('appointments', b => b.eq('patient_id', patientId));
    out.tagebuch_zuweisungen = await q('diary_assignments', b => b.eq('patient_id', patientId));
    out.tagebuch_eintraege = await q('diary_entries', b => b.eq('patient_id', patientId));
    out.tagebuch_kategorien = await q('diary_categories', b => b);
    out.tagebuch_felder = await q('diary_fields', b => b);
    out.routinen_freigaben = await q('routine_assignments', b => b.eq('patient_id', patientId));
    const rIds = Array.isArray(out.routinen_freigaben) ? out.routinen_freigaben.map(r => r.routine_id) : [];
    out.routinen = rIds.length ? await q('routines', b => b.in('id', rIds)) : [];
    out.routinen_haekchen = await q('routine_logs', b => b.eq('patient_id', patientId));
    out.einnahmen = await q('med_items', b => b.eq('patient_id', patientId));
    out.einnahmen_haekchen = await q('med_logs', b => b.eq('patient_id', patientId));
    out.zyklus = await q('cycle_starts', b => b.eq('patient_id', patientId));
    out.laborwerte = await q('lab_values', b => b.eq('patient_id', patientId));
    out.dokumente = await q('patient_documents', b => b.eq('patient_id', patientId));
    const JSZip = await mdScript('vendor/jszip.min.js', 'JSZip');
    const zip = new JSZip();
    zip.file('daten.json', JSON.stringify(out, null, 2));
    const lines = ['DATENEXPORT – ' + name, 'erstellt am ' + new Date().toLocaleString('de-DE'), '',
      'EINNAHMEN', ...(Array.isArray(out.einnahmen) ? out.einnahmen.map(m => `- ${m.name} ${m.dose || ''} · ${mdSchedText(m)} · ${m.slots.join('+')} · ${m.start_date}${m.end_date ? ' bis ' + m.end_date : ''}`) : []), '',
      'LABORWERTE', ...(Array.isArray(out.laborwerte) ? out.laborwerte.map(l => `- ${l.taken_on} ${l.name}: ${l.value_text || l.value} (Ziel ${l.target_range || '–'})`) : []), '',
      'Vollständige Daten: daten.json · Dokumente: Ordner „dokumente“'];
    zip.file('Uebersicht.txt', lines.join('\n'));
    let n = 0;
    for (const d of (Array.isArray(out.dokumente) ? out.dokumente : [])) {
      const { data } = await sb.functions.invoke('dokumente', { body: { action: 'url', docId: d.id } });
      if (!data || !data.url) continue;
      const blob = await (await fetch(data.url)).blob();
      const ext = (d.storage_path.split('.').pop() || 'pdf');
      zip.file('dokumente/' + (++n) + '_' + d.title.replace(/[^\wäöüÄÖÜß .-]/g, '_').slice(0, 80) + '.' + ext, blob);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Datenexport_' + name.replace(/[^\wäöüÄÖÜß-]/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    await sb.rpc('audit', { p_action: 'export', p_object: 'datenexport', p_object_id: null, p_patient: patientId, p_details: { dokumente: n } });
    toast('Export heruntergeladen.');
  } catch (e) { toast('Export fehlgeschlagen: ' + e.message); }
}

// ============================================================
// Nutzerverwaltung: Sicherheit (Admin)
// ============================================================
function dsTeamCardHtml(profile, users, statusById) {
  const staff = users.filter(u => u.role !== 'client');
  const missing = staff.filter(u => !(statusById[u.id] || {}).mfa);
  const on = DS.settings && DS.settings.mfa_required;
  const cons = DS.settings && DS.settings.consent_required;
  return `<div class="card"><h2>Sicherheit &amp; Datenschutz</h2>
    <div class="ds-sec">
      <div><b>2-Faktor-Pflicht f&uuml;r Admin + Team</b>
        <div class="rt-sub">${on ? 'eingeschaltet' : 'aus'} &middot; ${staff.length - missing.length} von ${staff.length} Praxis-Zug&auml;ngen haben 2-Faktor${missing.length ? ' &middot; fehlt: ' + missing.map(u => esc(u.name)).join(', ') : ''}</div></div>
      <button type="button" class="${on ? 'secondary' : ''} small-btn" id="dsMfaToggle">${on ? 'Ausschalten' : 'Einschalten'}</button>
    </div>
    <div class="ds-sec">
      <div><b>Einwilligung der Klient:innen</b>
        <div class="rt-sub">${cons ? 'Pflicht &mdash; ohne Einwilligung sehen Klient:innen keine Daten' : 'noch nicht verpflichtend'} &middot; Fassung ${esc((DS.settings || {}).consent_version || '')}</div></div>
      <button type="button" class="secondary small-btn" data-privacy>Text ansehen</button>
    </div>
    <p class="hint">Einschalten der 2-Faktor-Pflicht geht nur, wenn du selbst gerade mit Code angemeldet bist. Danach sehen Praxis-Zug&auml;nge ohne 2. Faktor keine Patientendaten mehr.</p>
  </div>`;
}

function dsWireTeam(profile, users, statusById, again) {
  const t = document.getElementById('dsMfaToggle');
  if (t) t.onclick = async () => {
    const on = !DS.settings.mfa_required;
    const staff = users.filter(u => u.role !== 'client');
    const missing = staff.filter(u => !(statusById[u.id] || {}).mfa);
    if (on && missing.length && !confirm('Noch ohne 2-Faktor: ' + missing.map(u => u.name).join(', ') + '.\nDiese Personen müssen ihn beim nächsten Login einrichten.\n\nTrotzdem einschalten?')) return;
    if (!on && !confirm('2-Faktor-Pflicht ausschalten? Praxis-Zugänge sind dann nur noch per Passwort geschützt.')) return;
    const { error } = await sb.rpc('set_mfa_required', { p_on: on });
    if (error) { toast(error.message); return; }
    toast(on ? '2-Faktor-Pflicht ist an.' : '2-Faktor-Pflicht ist aus.'); again();
  };
  appEl.querySelectorAll('[data-mfareset]').forEach(b => {
    b.onclick = async () => {
      const u = users.find(x => x.id === b.dataset.mfareset);
      if (!confirm('2-Faktor von ' + u.name + ' zurücksetzen?\n\nNur tun, wenn die Person ihr Handy verloren hat. Sie richtet beim nächsten Login einen neuen ein.')) return;
      const { data, error } = await sb.functions.invoke('invite-user', { body: { action: 'resetMfa', userId: u.id } });
      if (error || (data && data.error)) { toast('Fehler: ' + ((data && data.error) || error.message)); return; }
      toast('Zurückgesetzt.'); again();
    };
  });
}
