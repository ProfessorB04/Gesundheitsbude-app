// ============================================================
// Gesundheitsbude-App — Verbindung zu Supabase
// Beide Werte stehen in Supabase unter: Project Settings → API
//   (Project URL  +  Project API keys → "anon public")
// Der anon-Key ist öffentlich gedacht (Schutz läuft über Row Level Security).
// NIEMALS hier den "service_role"-Key eintragen!
// ============================================================
window.GB_CONFIG = {
  SUPABASE_URL: 'https://xoqttvhivxbdvewugqqo.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_ECDLUje0TPptmV5wbVeY_A_4KIxXwdj',
  APP_NAME: 'Gesundheitsbude',
  APP_SUB: 'Praxis-App',
  // Absender-Name in den Zugangsdaten-Nachrichten
  SIGNATURE: 'Dein Team der Gesundheitsbude',
  // interne Platzhalter-Domain für Zugänge ohne E-Mail (an sie wird nie gesendet)
  NOMAIL_DOMAIN: 'ohne-email.gesundheitsbude.de',
};
