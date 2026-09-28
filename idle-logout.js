// ============================================================
// Automatische Abmeldung nach Inaktivität – nur Admin und Team (Klient:innen bleiben angemeldet)
// Gilt über alle offenen Tabs (App + Tool-Seiten): letzte Aktivität liegt gemeinsam im localStorage.
// App: appIdleStart(sb, role) nach dem Laden des Profils; Tool-Seiten: startet selbst, sobald das
// Login-Gate window.appSb + window.appRole gesetzt hat.
// ============================================================
(function () {
  const LIMIT = 30 * 60 * 1000;   // 30 Minuten ohne Aktivität
  const WARN = 60 * 1000;         // 1 Minute vorher warnen
  const KEY = 'gb_last_activity';
  let started = false, client = null, box = null, timer = null, lastWrite = 0;

  const now = () => Date.now();
  const getLast = () => { try { return parseInt(localStorage.getItem(KEY), 10) || 0; } catch (e) { return 0; } };
  const setLast = t => { try { localStorage.setItem(KEY, String(t)); } catch (e) {} };

  function touch() {
    const t = now();
    if (t - lastWrite < 5000) return;
    lastWrite = t; setLast(t);
    if (box) hideWarn();
  }
  function hideWarn() { if (box) { box.remove(); box = null; } }
  function showWarn(sec) {
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('style', 'position:fixed;inset:0;background:rgba(10,14,30,.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;');
      box.innerHTML = '<div style="background:#fff;border-radius:14px;padding:22px 24px;max-width:380px;width:100%;box-shadow:0 20px 50px rgba(0,17,61,.25);text-align:center;">' +
        '<div style="font-size:1.1rem;font-weight:800;margin-bottom:6px;color:#101015;">Noch da?</div>' +
        '<div style="color:#52514e;font-size:.95rem;margin-bottom:16px;">Du wirst wegen Inaktivit&auml;t in <b id="idleSec"></b> Sekunden abgemeldet.</div>' +
        '<button type="button" id="idleStay" style="width:100%;padding:12px;border:0;border-radius:10px;background:#0042fb;color:#fff;font-weight:700;font-size:1rem;cursor:pointer;border-radius:99px;">Angemeldet bleiben</button></div>';
      document.body.appendChild(box);
      box.querySelector('#idleStay').onclick = () => { lastWrite = 0; touch(); hideWarn(); };
    }
    box.querySelector('#idleSec').textContent = sec;
  }
  async function logout() {
    clearInterval(timer);
    try { localStorage.removeItem(KEY); } catch (e) {}
    try { sessionStorage.setItem('gb_idle_logout', '1'); } catch (e) {}
    try { await client.auth.signOut(); } catch (e) {}
    window.location.href = 'index.html';
  }
  function check() {
    const idle = now() - getLast();
    if (idle >= LIMIT) return logout();
    if (idle >= LIMIT - WARN) showWarn(Math.ceil((LIMIT - idle) / 1000));
    else hideWarn();
  }

  window.appIdleStart = function (sb, role) {
    if (started || !sb || (role !== 'admin' && role !== 'team')) return;
    started = true; client = sb;
    const last = getLast();
    if (last && now() - last >= LIMIT) { logout(); return; }   // Fenster lange offen/zugeklappt → sofort abmelden
    lastWrite = 0; touch();
    ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart', 'mousemove'].forEach(ev =>
      window.addEventListener(ev, touch, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    timer = setInterval(check, 5000);
  };
  // frische Anmeldung: alten Zeitstempel verwerfen (sonst sofortige Abmeldung)
  window.appIdleFreshLogin = function () { setLast(now()); };

  // Tool-Seiten: auf das Login-Gate warten
  if (!/\/(index\.html)?$/.test(location.pathname)) {
    let n = 0;
    const wait = setInterval(() => {
      if (window.appSb && window.appRole) { clearInterval(wait); window.appIdleStart(window.appSb, window.appRole); }
      else if (++n > 60) clearInterval(wait);
    }, 250);
  }
})();
