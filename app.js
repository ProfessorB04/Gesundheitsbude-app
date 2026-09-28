// ============================================================
// Gesundheitsbude-App — Grundgerüst (Struktur wie die Balance-Movement-Trainings-App)
// Login (Benutzername oder E-Mail), Einmalpasswort-Zugänge, Rollen, Nutzerverwaltung, Mein Konto
// ============================================================
const CFG = window.GB_CONFIG;
const CONFIG_MISSING = !CFG || /DEIN-PROJEKT|HIER-DEN/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY);

// Eigene (No-op-)Sperre statt Browser-LockManager: verhindert Hänger, wenn mehrere Tabs offen sind
const sb = CONFIG_MISSING ? null : window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { lock: async (_name, _timeout, fn) => await fn() },
});

const appEl = document.getElementById('app');
const LOGO_SRC = 'logo-gesundheitsbude.png';
const WORDMARK_SRC = 'logo-schriftzug.png';

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// Notfall-Anzeige, falls der Start hängt
function showStartProblem(reason) {
  appEl.innerHTML = `
    <main class="login-page"><div class="login-card">
      <div class="login-logo"><img src="${LOGO_SRC}" alt="Gesundheitsbude"></div>
      <h1>Die App l&auml;dt gerade nicht</h1>
      <p class="sub">${esc(reason)}</p>
      <div class="auth-form">
        <button type="button" id="probReload">Neu laden</button>
        <button type="button" class="secondary" id="probReset">Anmeldung zur&uuml;cksetzen &amp; neu anmelden</button>
      </div>
      <p class="hint" style="text-align:center;">Tipp: Andere offene Tabs der App schlie&szlig;en.</p>
    </div></main>`;
  document.getElementById('probReload').onclick = () => location.reload();
  document.getElementById('probReset').onclick = () => {
    try { Object.keys(localStorage).filter(k => k.startsWith('sb-')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    location.href = location.pathname;
  };
}
setTimeout(() => {
  if (!document.querySelector('.shell, .login-page')) showStartProblem('Der Start hat länger als 10 Sekunden gedauert (Anmeldung oder Verbindung hängt).');
}, 10000);

// ---------------- Rollen ----------------
// admin  = volle Rechte inkl. Nutzerverwaltung
// team   = Mitarbeiter:innen: alle Inhalte, aber keine Nutzerverwaltung
// client = Klient:innen: nur eigene / freigeschaltete Bereiche
const ROLE_LABELS = { admin: 'Admin', team: 'Team', client: 'Klient:in' };
const isAdmin = (profile) => profile.role === 'admin';
const isStaff = (profile) => profile.role === 'admin' || profile.role === 'team';

// Bereichs-Rechte je Klient:in (profiles.permissions, Auswahl in rechte.js); Standard für neue Zugänge:
const PERM_DEFAULT = { therapieplan: 'view', labor: 'none', tagebuch: 'none', videos: 'none' };
const perm = (profile, area) => isStaff(profile) ? 'edit' : ((Object.assign({}, PERM_DEFAULT, profile.permissions || {}))[area] || 'none');
const can = (profile, area) => perm(profile, area) !== 'none';

// ---------------- Navigation ----------------
// Neue Bereiche: hier eintragen (+ Kachel in MENU_TILES + Fall in navigate)
const NAV_ITEMS = [
  { key: 'menu', label: 'Dashboard', icon: '&#127968;', show: () => true },
  { key: 'bausteine', label: 'Therapiebausteine', icon: '&#129513;', show: p => isStaff(p) },
  { key: 'team', label: 'Nutzerverwaltung', icon: '&#128101;', show: p => isAdmin(p) },
  { key: 'konto', label: 'Mein Konto', icon: '&#128100;', show: () => true },
];

const MENU_TILES = [
  { key: 'bausteine', tint: 'tint-sky', icon: '&#129513;', title: 'Therapiebausteine', sub: 'Datenbank: Diagnostik, Labor, Ern&auml;hrung, Bewegung, Therapie, Produkte &mdash; Kategorien, Import/Export Excel' },
  { key: 'team', tint: 'tint-blue', icon: '&#128101;', title: 'Nutzerverwaltung', sub: 'Zug&auml;nge anlegen, Rollen verwalten, Einmalpassw&ouml;rter' },
  { key: 'konto', tint: 'tint-pink', icon: '&#128100;', title: 'Mein Konto', sub: 'Benutzername und Passwort &auml;ndern' },
];

function navigate(profile, key) {
  const item = NAV_ITEMS.find(x => x.key === key);
  if (!item || !item.show(profile)) { renderMenu(profile); return; }
  if (key === 'menu') renderMenu(profile);
  else if (key === 'bausteine') renderBlocksPage(profile);
  else if (key === 'team') renderTeamPage(profile);
  else if (key === 'konto') renderAccountPage(profile);
}

// ---------------- App-Shell (Seitenleiste + Kopfzeile) ----------------
function renderShell(profile, activeKey, title, contentHtml, back) {
  if (!back && activeKey !== 'menu') back = { label: 'Dashboard', go: () => renderMenu(profile) };
  const navHtml = NAV_ITEMS
    .filter(item => item.show(profile))
    .map(item => `<button type="button" class="nav-item${item.key === activeKey ? ' active' : ''}" data-nav="${item.key}" title="${esc(item.label)}">
        <span class="ic">${item.icon}</span><span class="lbl">${esc(item.label)}</span>
      </button>`).join('');

  let collapsed = false;
  try { collapsed = localStorage.getItem('gb_sidebar_collapsed') === '1'; } catch (e) {}

  appEl.innerHTML = `
    <div class="shell${collapsed ? ' collapsed' : ''}" id="shell">
      <div class="sidebar-scrim" id="sidebarScrim"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <img src="${LOGO_SRC}" alt="Gesundheitsbude">
          <div class="org-name">${esc(CFG.APP_NAME)}</div>
          <div class="org-sub">${esc(CFG.APP_SUB)}</div>
        </div>
        <button type="button" class="collapse-btn" id="collapseBtn" title="Menü ein-/ausklappen" aria-label="Menü ein- oder ausklappen">
          <span class="ic">&#171;</span><span class="lbl">Men&uuml; einklappen</span>
        </button>
        <nav class="sidebar-nav">${navHtml}</nav>
        <div class="sidebar-footer">
          <div class="sidebar-user"><b>${esc(profile.name)}</b>${ROLE_LABELS[profile.role] || ''}</div>
          <button type="button" id="logoutBtn" title="Abmelden"><span class="lbl">Abmelden</span><span class="ic-only">&#10162;</span></button>
        </div>
      </aside>
      <div class="main-area">
        <header class="topbar">
          <button class="menu-toggle" id="menuToggle" type="button" aria-label="Men&uuml;">&#9776;</button>
          <div class="topbar-title">
            ${back ? `<button type="button" class="back-btn" id="backBtn">&larr; ${esc(back.label || 'Zurück')}</button>` : ''}
            <h1>${esc(title)}</h1>
          </div>
          <span></span>
        </header>
        <main class="wrap">${contentHtml}</main>
      </div>
    </div>
  `;

  if (back) document.getElementById('backBtn').onclick = back.go;
  document.getElementById('logoutBtn').onclick = async () => {
    try { localStorage.removeItem('gb_last_activity'); } catch (e) {}
    await sb.auth.signOut();
  };
  appEl.querySelectorAll('.nav-item[data-nav]').forEach(btn => {
    btn.onclick = () => navigate(profile, btn.dataset.nav);
  });

  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebarScrim');
  document.documentElement.classList.remove('menu-open');
  // Menü offen (Handy): Seite dahinter sperren, nur das Menü scrollt
  document.getElementById('menuToggle').onclick = () => { sidebar.classList.add('open'); scrim.classList.add('show'); document.documentElement.classList.add('menu-open'); sidebar.scrollTop = 0; };
  scrim.onclick = () => { sidebar.classList.remove('open'); scrim.classList.remove('show'); document.documentElement.classList.remove('menu-open'); };
  // Seitenleiste am Desktop einklappen (nur Symbole) – Zustand bleibt gespeichert
  document.getElementById('collapseBtn').onclick = () => {
    const shell = document.getElementById('shell');
    const now = !shell.classList.contains('collapsed');
    shell.classList.toggle('collapsed', now);
    try { localStorage.setItem('gb_sidebar_collapsed', now ? '1' : '0'); } catch (e) {}
  };
}

// ---------------- Dashboard ----------------
function renderMenu(profile) {
  const tiles = MENU_TILES.filter(t => NAV_ITEMS.find(n => n.key === t.key).show(profile));
  const first = (profile.name || '').split(' ')[0];
  const content = `
    <section class="hero">
      <img src="${WORDMARK_SRC}" alt="Gesundheitsbude – Katrin Berger">
      <p>Hallo ${esc(first)}, sch&ouml;n, dass du da bist.</p>
    </section>
    <div class="menu-grid">
      ${tiles.map(t => `
      <button class="menu-card ${t.tint}" type="button" data-cat="${t.key}">
        <span class="mc-icon">${t.icon}</span>
        <span class="mc-title">${t.title}</span>
        <span class="mc-sub">${t.sub}</span>
      </button>`).join('')}
      ${isStaff(profile) ? `<div class="menu-card soon"><span class="mc-icon">&#10024;</span><span class="mc-title">Weitere Bereiche</span><span class="mc-sub">folgen in K&uuml;rze</span></div>` : ''}
    </div>`;
  renderShell(profile, 'menu', 'Dashboard', content);
  appEl.querySelectorAll('.menu-card[data-cat]').forEach(btn => {
    btn.onclick = () => navigate(profile, btn.dataset.cat);
  });
}

// ---------------- Mein Konto: Benutzername + Passwort ändern ----------------
async function renderAccountPage(profile) {
  let email = '';
  try { const { data: { user } } = await sb.auth.getUser(); email = (user && user.email) || ''; } catch (e) {}
  const { data: pr } = await sb.from('profiles').select('username').eq('id', profile.id).single();
  const uname = (pr && pr.username) || '';
  const noMail = isNoMail(email);
  const content = `
    <div class="card">
      <h2>Anmeldung</h2>
      <div class="cred-grid">
        <span>Name</span><b>${esc(profile.name || '')}</b>
        <span>Benutzername</span><b>${uname ? esc(uname) : '<span class="muted">keiner</span>'}</b>
        <span>E-Mail</span><b>${noMail || !email ? '<span class="muted">ohne E-Mail</span>' : esc(email)}</b>
      </div>
      <p class="hint">Anmelden kannst du dich mit ${uname && !noMail ? 'dem Benutzernamen oder der E-Mail' : (uname ? 'dem Benutzernamen' : 'der E-Mail')}.</p>
    </div>
    <div class="card">
      <h2>Benutzername &auml;ndern</h2>
      <form id="accUnameForm" class="auth-form" style="max-width:420px;">
        <label>Neuer Benutzername<input type="text" id="accUname" value="${esc(uname)}" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="z. B. anna.m"></label>
        <p class="hint" style="margin:0;">3&ndash;30 Zeichen: a&ndash;z, 0&ndash;9, Punkt, Bindestrich, Unterstrich.${noMail ? '' : ' Leer lassen = Anmeldung nur noch mit E-Mail.'}</p>
        <button type="submit">Benutzername speichern</button>
        <p class="error" id="accUnameErr"></p>
      </form>
    </div>
    <div class="card">
      <h2>Passwort &auml;ndern</h2>
      <form id="accPwForm" class="auth-form" style="max-width:420px;">
        <input type="text" name="username" autocomplete="username" value="${esc(uname || email)}" hidden>
        <label>Neues Passwort<input type="password" id="accPw1" required minlength="10" autocomplete="new-password"></label>
        <label>Passwort wiederholen<input type="password" id="accPw2" required minlength="10" autocomplete="new-password"></label>
        <button type="submit">Passwort speichern</button>
        <p class="error" id="accPwErr"></p>
      </form>
    </div>`;
  renderShell(profile, 'konto', 'Mein Konto', content);
  const unIn = document.getElementById('accUname');
  unIn.addEventListener('input', () => { unIn.value = unIn.value.toLowerCase().replace(/\s/g, ''); });
  document.getElementById('accUnameForm').onsubmit = async (e) => {
    e.preventDefault();
    const v = unIn.value.trim().toLowerCase();
    const errEl = document.getElementById('accUnameErr');
    errEl.textContent = '';
    if (v === uname) { toast('Keine Änderung.'); return; }
    const { data, error } = await sb.functions.invoke('invite-user', { body: { action: 'setOwnUsername', username: v } });
    if (error || (data && data.error)) { errEl.textContent = (data && data.error) ? data.error : 'Fehler: ' + error.message; return; }
    toast(data.username ? 'Benutzername „' + data.username + '“ gespeichert.' : 'Benutzername entfernt.');
    renderAccountPage(profile);
  };
  document.getElementById('accPwForm').onsubmit = async (e) => {
    e.preventDefault();
    const p1 = document.getElementById('accPw1').value, p2 = document.getElementById('accPw2').value;
    const errEl = document.getElementById('accPwErr');
    if (p1 !== p2) { errEl.textContent = 'Passwörter stimmen nicht überein.'; return; }
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) { errEl.textContent = 'Fehler: ' + error.message; return; }
    errEl.textContent = '';
    e.target.reset();
    toast('Passwort geändert.');
  };
}

// ---------------- Login ----------------
// Keine Selbstregistrierung — Zugänge vergibt ausschließlich der Admin.
function renderAuth() {
  appEl.innerHTML = `
    <main class="login-page">
      <div class="login-card">
        <div class="login-logo"><img src="${LOGO_SRC}" alt="Gesundheitsbude"></div>
        <h1>${esc(CFG.APP_NAME)}</h1>
        <p class="sub">${esc(CFG.APP_SUB)}</p>
        <form id="loginForm" class="auth-form">
          <label>E-Mail oder Benutzername<input type="text" id="loginEmail" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
          <label>Passwort<input type="password" id="loginPassword" required autocomplete="current-password"></label>
          <button type="submit">Anmelden</button>
          <p class="error" id="loginError">${(() => { try { const f = sessionStorage.getItem('gb_idle_logout'); sessionStorage.removeItem('gb_idle_logout'); return f ? 'Du wurdest nach 30 Minuten Inaktivit&auml;t automatisch abgemeldet.' : ''; } catch (e) { return ''; } })()}</p>
        </form>
        <form id="forgotForm" class="auth-form" hidden>
          <label>E-Mail<input type="email" id="forgotEmail" required autocomplete="username"></label>
          <button type="submit">Link zum Zur&uuml;cksetzen senden</button>
          <p class="hint" style="margin:0;">Nur mit E-Mail m&ouml;glich. Wer sich mit Benutzernamen anmeldet, bekommt ein neues Einmalpasswort von der Praxis.</p>
          <p class="error" id="forgotError"></p>
          <p class="ok" id="forgotOk"></p>
        </form>
        <p class="hint" style="margin-top:16px;text-align:center;"><a href="#" id="forgotToggle">Passwort vergessen?</a></p>
        <p class="hint" style="text-align:center;">Kein Zugang? Zug&auml;nge werden ausschlie&szlig;lich pers&ouml;nlich von der Praxis vergeben.</p>
      </div>
    </main>
  `;

  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const login = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    if (window.appIdleFreshLogin) window.appIdleFreshLogin();
    if (login.includes('@')) {
      const { error } = await sb.auth.signInWithPassword({ email: login, password });
      errEl.textContent = error ? 'E-Mail oder Passwort falsch.' : '';
      return;
    }
    // Benutzername: Prüfung auf dem Server (E-Mail-Adresse wird nie an den Browser gegeben)
    errEl.textContent = '';
    const { data, error } = await sb.functions.invoke('invite-user', { body: { action: 'login', username: login.toLowerCase(), password } });
    if (error || !data || !data.access_token) { errEl.textContent = 'Benutzername oder Passwort falsch.'; return; }
    const { error: sErr } = await sb.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    if (sErr) errEl.textContent = 'Anmeldung fehlgeschlagen: ' + sErr.message;
  };

  const loginForm = document.getElementById('loginForm');
  const forgotForm = document.getElementById('forgotForm');
  const forgotToggle = document.getElementById('forgotToggle');
  forgotToggle.onclick = (e) => {
    e.preventDefault();
    const showingForgot = !forgotForm.hidden;
    loginForm.hidden = !showingForgot;
    forgotForm.hidden = showingForgot;
    forgotToggle.textContent = showingForgot ? 'Passwort vergessen?' : 'Zurück zur Anmeldung';
  };
  forgotForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgotEmail').value.trim();
    const errEl = document.getElementById('forgotError');
    const okEl = document.getElementById('forgotOk');
    errEl.textContent = ''; okEl.textContent = '';
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    if (error) errEl.textContent = 'Fehler: ' + error.message;
    else { okEl.textContent = 'Falls dieses Konto existiert, wurde eine E-Mail zum Zurücksetzen verschickt.'; e.target.reset(); }
  };
}

// ---------------- Neues Passwort setzen (Einmalpasswort oder "Passwort vergessen") ----------------
function mustChangePassword(user) {
  return !!(user && user.user_metadata && user.user_metadata.must_change_password);
}
function isRecoveryOrInviteLink() {
  const hash = window.location.hash || '';
  return hash.includes('type=recovery') || hash.includes('type=invite');
}

async function renderSetPassword() {
  // Konto mit anzeigen: sonst speichert der Passwort-Manager das neue Passwort evtl. beim falschen Konto
  let account = '';
  try {
    const { data: { user } } = await sb.auth.getUser(); account = (user && user.email) || '';
    const { data: pr } = await sb.from('profiles').select('username').eq('id', user.id).single();
    if (pr && pr.username && (isNoMail(account) || !account)) account = pr.username;
  } catch (e) {}
  appEl.innerHTML = `
    <main class="login-page">
      <div class="login-card">
        <div class="login-logo"><img src="${LOGO_SRC}" alt="Gesundheitsbude"></div>
        <h1>Willkommen</h1>
        <p class="sub">Bitte lege jetzt dein eigenes Passwort fest (mind. 10 Zeichen). Das Einmalpasswort ist danach ung&uuml;ltig.</p>
        <form id="setPwForm" class="auth-form">
          <label>Konto<input type="text" name="username" autocomplete="username" value="${esc(account)}" readonly></label>
          <label>Neues Passwort<input type="password" id="newPassword" required minlength="10" autocomplete="new-password"></label>
          <label>Passwort wiederholen<input type="password" id="newPassword2" required minlength="10" autocomplete="new-password"></label>
          <button type="submit">Passwort speichern</button>
          <p class="error" id="setPwError"></p>
        </form>
        <p class="hint" style="text-align:center;margin-top:14px;"><a href="#" id="setPwLogout">Abmelden</a></p>
      </div>
    </main>
  `;
  document.getElementById('setPwForm').onsubmit = async (e) => {
    e.preventDefault();
    const p1 = document.getElementById('newPassword').value;
    const p2 = document.getElementById('newPassword2').value;
    const errEl = document.getElementById('setPwError');
    if (p1 !== p2) { errEl.textContent = 'Passwörter stimmen nicht überein.'; return; }
    const { error } = await sb.auth.updateUser({ password: p1, data: { must_change_password: false } });
    if (error) { errEl.textContent = 'Fehler: ' + error.message; return; }
    history.replaceState(null, '', window.location.pathname);
    toast('Passwort gespeichert.');
    const { data: { user } } = await sb.auth.getUser();
    if (user) { CURRENT_USER_ID = user.id; renderDashboard(user); }
  };
  document.getElementById('setPwLogout').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); };
}

// ---------------- Dashboard-Router ----------------
async function renderDashboard(user) {
  appEl.innerHTML = `<main class="wrap"><p class="muted">Lade&hellip;</p></main>`;
  const { data: profile, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (error || !profile) {
    showStartProblem('Profil konnte nicht geladen werden' + (error ? ': ' + error.message : '.'));
    return;
  }
  if (window.appIdleStart) window.appIdleStart(sb, profile.role);   // Auto-Abmeldung nur Admin/Team
  const hashKey = (window.location.hash || '').slice(1);
  if (hashKey) {
    history.replaceState(null, '', window.location.pathname);
    navigate(profile, hashKey);
    return;
  }
  renderMenu(profile);
}

// ---------------- Nutzerverwaltung (nur Admin) ----------------
const NOMAIL_DOMAIN = '@' + CFG.NOMAIL_DOMAIN;
const isNoMail = (email) => !!email && email.toLowerCase().endsWith(NOMAIL_DOMAIN);
// Vorschlag für Benutzernamen: vorname.n (Umlaute umschreiben)
function suggestUsername(name) {
  const t = String(name || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 .-]/g, '').trim().split(/\s+/).filter(Boolean);
  if (!t.length) return '';
  const u = t.length > 1 ? t[0] + '.' + t[t.length - 1][0] : t[0];
  return u.replace(/^[^a-z0-9]+/, '').slice(0, 30);
}

async function renderTeamPage(profile) {
  if (!isAdmin(profile)) { renderMenu(profile); return; }
  const statusRes = await sb.rpc('admin_user_status');
  const statusById = {};
  (statusRes.data || []).forEach(x => { statusById[x.id] = x; });
  const fmtDT = (iso) => { const d = new Date(iso); return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
  const statusCell = (u) => {
    const st = statusById[u.id];
    if (!st) return '<span class="muted">–</span>';
    const mail = `<div class="status-mail">${isNoMail(st.email) ? '<i>ohne E-Mail</i>' : esc(st.email || '')}</div>`;
    if (!st.last_sign_in_at) return `<span class="status-pill open">Erste Anmeldung ausstehend</span>${mail}`;
    if (st.must_change) return `<span class="status-pill half" title="Mit Einmalpasswort angemeldet, eigenes Passwort noch nicht festgelegt">Eigenes Passwort fehlt</span>${mail}`;
    return `<span class="status-pill ok">Aktiv</span> <span class="status-when">zuletzt ${fmtDT(st.last_sign_in_at)}</span>${mail}`;
  };

  const { data: users } = await sb.from('profiles').select('id, name, role, created_at, username, permissions');
  const roleOrder = { admin: 0, team: 1, client: 2 };
  const sorted = (users || []).slice().sort((a, b) =>
    (roleOrder[a.role] - roleOrder[b.role]) || a.name.localeCompare(b.name, 'de'));

  const userRows = sorted.length
    ? sorted.map(u => {
        const roleCell = u.role === 'admin'
          ? `<span class="pill admin">Admin</span>`
          : `<select class="role-select" data-user="${u.id}">
               <option value="client" ${u.role === 'client' ? 'selected' : ''}>Klient:in</option>
               <option value="team" ${u.role === 'team' ? 'selected' : ''}>Team</option>
             </select>`;
        const actionCell = u.role === 'admin' ? ''
          : `<button type="button" class="secondary small-btn" data-reset="${u.id}">Einmalpasswort</button>
             <button type="button" class="danger small-btn" data-delete="${u.id}">L&ouml;schen</button>`;
        const unameCell = `<div class="uname">${u.username ? '&#128100; ' + esc(u.username) : '<span class="muted">kein Benutzername</span>'}
            <button type="button" class="link-btn" data-uname="${u.id}" title="Benutzername f&uuml;r die Anmeldung festlegen">${u.username ? '&auml;ndern' : 'festlegen'}</button></div>`;
        const permCell = u.role !== 'client' ? '<span class="muted">alles</span>' :
          `<div class="chips">${permSummary(u.permissions)}</div><button type="button" class="secondary small-btn" data-perm="${u.id}" style="margin-top:6px;">Rechte</button>`;
        return `<tr><td><span class="uname-name">${esc(u.name)}</span>${unameCell}</td><td>${statusCell(u)}</td><td>${roleCell}</td><td>${permCell}</td><td>${actionCell}</td></tr>`;
      }).join('')
    : `<tr><td colspan="5" class="muted">Noch keine Nutzer:innen.</td></tr>`;

  const content = `
    <div class="card">
      <h2>Neuen Zugang anlegen</h2>
      <p class="hint">Anmelden geht mit <b>Benutzername oder E-Mail</b>. Ohne E-Mail reicht ein Benutzername &mdash; &bdquo;Passwort vergessen&ldquo; geht dann nicht, stattdessen hier ein neues Einmalpasswort erzeugen.</p>
      <p class="hint">Die App erzeugt ein <b>Einmalpasswort</b>. Du schickst die Zugangsdaten selbst weiter (E-Mail, WhatsApp, ausgedruckt). Bei der ersten Anmeldung legt die Person ihr eigenes Passwort fest.</p>
      <form id="inviteForm" class="inline-form">
        <label>Name<input type="text" id="inviteName" required></label>
        <label>Benutzername<input type="text" id="inviteUsername" placeholder="z. B. anna.m" autocapitalize="none" autocorrect="off" spellcheck="false" title="3–30 Zeichen: a–z, 0–9, Punkt, Bindestrich, Unterstrich"></label>
        <label>Login-E-Mail <span class="muted">(optional)</span><input type="email" id="inviteEmail"></label>
        <label>Rolle
          <select id="inviteRole">
            <option value="client">Klient:in</option>
            <option value="team">Team</option>
          </select>
        </label>
        <div class="invite-perms" id="invitePerms">
          <div class="invite-perms-h">Was darf diese Person sehen?</div>
          ${permTableHtml('inv', PERM_DEFAULT)}
        </div>
        <button type="submit">Zugang anlegen</button>
      </form>
      <p class="role-hint" id="inviteRoleHint">Team-Mitglieder k&ouml;nnen alle Inhalte nutzen, aber keine Zug&auml;nge anlegen oder Rollen &auml;ndern.</p>
      <p class="notice" id="inviteMsg" hidden></p>
    </div>

    <div class="card cred-card" id="credCard" hidden></div>

    <div class="card">
      <h2>Alle Nutzer:innen</h2>
      <div class="tablewrap">
        <table class="user-table">
          <thead><tr><th>Name</th><th>Anmeldestatus</th><th>Rolle</th><th>Rechte</th><th>Zugang</th></tr></thead>
          <tbody>${userRows}</tbody>
        </table>
      </div>
      <p class="hint">Rolle &auml;ndern: im Auswahlfeld umstellen, wird sofort gespeichert. &bdquo;Einmalpasswort&ldquo; erzeugt neue Zugangsdaten &mdash; das alte Passwort gilt dann nicht mehr. &bdquo;L&ouml;schen&ldquo; entfernt den Zugang dauerhaft. &bdquo;Rechte&ldquo; legt fest, welche Bereiche Klient:innen sehen (Admin + Team sehen immer alles). Die Admin-Rolle kann nur direkt in Supabase vergeben werden.</p>
    </div>
  `;

  renderShell(profile, 'team', 'Nutzerverwaltung', content);

  appEl.querySelectorAll('.role-select').forEach(sel => {
    sel.onchange = async () => {
      const { error } = await sb.from('profiles').update({ role: sel.value }).eq('id', sel.dataset.user);
      if (error) { toast('Fehler: ' + error.message); renderTeamPage(profile); }
      else toast('Rolle gespeichert.');
    };
  });

  // Rechte-Auswahl nur bei Klient:innen
  const invRole = document.getElementById('inviteRole');
  const syncPerms = () => { document.getElementById('invitePerms').hidden = invRole.value !== 'client'; };
  invRole.onchange = syncPerms; syncPerms();
  appEl.querySelectorAll('[data-perm]').forEach(btn => {
    btn.onclick = () => openPermissionsDialog(sorted.find(u => u.id === btn.dataset.perm), () => renderTeamPage(profile));
  });

  // Benutzername aus dem Namen vorschlagen, solange nicht selbst geändert
  const unIn = document.getElementById('inviteUsername');
  let unTouched = false;
  document.getElementById('inviteName').addEventListener('input', () => {
    if (!unTouched) unIn.value = suggestUsername(document.getElementById('inviteName').value);
  });
  unIn.addEventListener('input', () => { unTouched = !!unIn.value; unIn.value = unIn.value.toLowerCase().replace(/\s/g, ''); });

  appEl.querySelectorAll('[data-uname]').forEach(btn => {
    btn.onclick = async () => {
      const u = sorted.find(x => x.id === btn.dataset.uname);
      const v = prompt('Benutzername für ' + u.name + ' (3–30 Zeichen: a–z, 0–9, Punkt, Bindestrich, Unterstrich; leer = entfernen):', u.username || suggestUsername(u.name));
      if (v === null) return;
      const { data, error } = await sb.functions.invoke('invite-user', { body: { action: 'setUsername', userId: u.id, username: v.trim().toLowerCase() } });
      if (error || (data && data.error)) { toast('Fehler: ' + (data && data.error ? data.error : error.message)); return; }
      toast(data.username ? 'Benutzername „' + data.username + '“ gespeichert.' : 'Benutzername entfernt.');
      renderTeamPage(profile);
    };
  });

  appEl.querySelectorAll('[data-delete]').forEach(btn => {
    btn.onclick = async () => {
      const u = sorted.find(x => x.id === btn.dataset.delete);
      if (!confirm(u.name + ' wirklich löschen?\n\nDer Zugang und alle zugehörigen Daten werden dauerhaft entfernt.')) return;
      btn.disabled = true;
      const { data, error } = await sb.functions.invoke('invite-user', { body: { action: 'delete', userId: u.id } });
      if (error || (data && data.error)) { btn.disabled = false; toast('Fehler: ' + (data && data.error ? data.error : error.message)); return; }
      toast(u.name + ' gelöscht.');
      renderTeamPage(profile);
    };
  });

  appEl.querySelectorAll('[data-reset]').forEach(btn => {
    btn.onclick = async () => {
      const u = sorted.find(x => x.id === btn.dataset.reset);
      if (!confirm('Neues Einmalpasswort für ' + u.name + ' erzeugen? Das bisherige Passwort gilt dann nicht mehr.')) return;
      btn.disabled = true;
      const { data, error } = await sb.functions.invoke('invite-user', { body: { action: 'reset', userId: u.id } });
      btn.disabled = false;
      if (error || (data && data.error)) { toast('Fehler: ' + (data && data.error ? data.error : error.message)); return; }
      showCredentials(data);
    };
  });

  document.getElementById('inviteForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('inviteName').value.trim();
    const email = document.getElementById('inviteEmail').value.trim();
    const username = unIn.value.trim().toLowerCase();
    const role = document.getElementById('inviteRole').value;
    const msgEl = document.getElementById('inviteMsg');
    msgEl.hidden = false;
    if (!email && !username) { msgEl.textContent = 'Bitte Benutzername und/oder E-Mail angeben.'; return; }
    msgEl.textContent = 'Lege Zugang an…';
    const permissions = role === 'client' ? readPerms(document.getElementById('invitePerms'), 'inv') : undefined;
    const { data, error } = await sb.functions.invoke('invite-user', { body: { name, email, username, role, permissions } });
    if (error || (data && data.error)) { msgEl.textContent = 'Fehler: ' + (data && data.error ? data.error : error.message); return; }
    toast('Zugang für ' + name + ' (' + ROLE_LABELS[role] + ') angelegt.');
    await renderTeamPage(profile);
    showCredentials(data);
  };
}

// Zugangsdaten nach Anlegen / Zurücksetzen anzeigen (nur einmalig sichtbar)
function showCredentials(d) {
  const card = document.getElementById('credCard');
  const appUrl = location.origin + '/';
  const text =
    'Hallo ' + d.name + ',\n\n' +
    'hier sind deine Zugangsdaten für die ' + CFG.APP_NAME + '-App:\n\n' +
    'Adresse: ' + appUrl + '\n' +
    (d.username ? 'Benutzername: ' + d.username + '\n' : '') +
    (d.email ? 'Login-E-Mail: ' + d.email + '\n' : '') +
    'Einmalpasswort: ' + d.password + '\n\n' +
    (d.username && d.email ? 'Anmelden kannst du dich mit dem Benutzernamen oder der E-Mail.\n' : '') +
    'Bei der ersten Anmeldung legst du dein eigenes Passwort fest.\n\n' +
    'Viele Grüße\n' + CFG.SIGNATURE;
  card.hidden = false;
  card.innerHTML = `
    <h2>Zugangsdaten f&uuml;r ${esc(d.name)}</h2>
    <div class="cred-grid">
      <span>Adresse</span><b>${esc(appUrl)}</b>
      ${d.username ? `<span>Benutzername</span><b>${esc(d.username)}</b>` : ''}
      ${d.email ? `<span>Login-E-Mail</span><b>${esc(d.email)}</b>` : ''}
      <span>Einmalpasswort</span><b class="cred-pw">${esc(d.password)}</b>
    </div>
    <form id="sendForm" class="inline-form" style="margin-top:14px;">
      <label>Senden an (beliebige Adresse)<input type="email" id="sendTo" value="${esc(d.email || '')}" required></label>
      <button type="submit" title="&Ouml;ffnet Gmail im Browser mit fertiger Nachricht">&#9993; Mit Gmail senden</button>
      <button type="button" class="secondary" id="sendWhatsApp">WhatsApp</button>
      <button type="button" class="secondary" id="sendMailApp">E-Mail-Programm</button>
      <button type="button" class="secondary" id="copyCred">Kopieren</button>
    </form>
    <div class="qr-box">
      <p class="hint">QR-Code zur Anmeldeseite:</p>
      <canvas id="credQr"></canvas>
    </div>
    <p class="hint">Das Einmalpasswort wird nur jetzt angezeigt.</p>
  `;
  const subject = 'Dein Zugang zur ' + CFG.APP_NAME + '-App';
  document.getElementById('sendForm').onsubmit = (e) => {
    e.preventDefault();
    const to = document.getElementById('sendTo').value.trim();
    window.open('https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to) +
      '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text), '_blank', 'noopener');
  };
  document.getElementById('sendWhatsApp').onclick = () => {
    window.open('https://wa.me/?text=' + encodeURIComponent(subject + '\n\n' + text), '_blank', 'noopener');
  };
  document.getElementById('sendMailApp').onclick = () => {
    const to = document.getElementById('sendTo').value.trim();
    window.location.href = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text);
  };
  document.getElementById('copyCred').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast('Zugangsdaten kopiert.'); }
    catch (_) { toast('Kopieren nicht möglich – bitte markieren und kopieren.'); }
  };
  if (window.QRCode) QRCode.toCanvas(document.getElementById('credQr'), appUrl, { width: 180 });
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------- Start ----------------
// Im Callback selbst keine weiteren Supabase-Aufrufe starten (sonst Deadlock der Auth-Sperre) – per setTimeout entkoppeln.
let CURRENT_USER_ID = null;
if (CONFIG_MISSING) {
  showStartProblem('Die App ist noch nicht mit Supabase verbunden: In config.js fehlen Project URL und anon-Key.');
} else {
  sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (session && (isRecoveryOrInviteLink() || mustChangePassword(session.user))) {
        renderSetPassword();
      } else if (session) {
        // Token-Erneuerung / erneutes SIGNED_IN desselben Kontos: aktuelle Ansicht behalten
        if (CURRENT_USER_ID === session.user.id && event !== 'INITIAL_SESSION') return;
        CURRENT_USER_ID = session.user.id;
        renderDashboard(session.user);
      } else {
        CURRENT_USER_ID = null;
        renderAuth();
      }
    }, 0);
  });
}
