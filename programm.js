// ============================================================
// Gesundheitsbude-App — SCHICHTWECHSEL-Programm: gemeinsame Bausteine
// Pakete (Basics / Schichtwechsel / Deluxe), Aufgaben-Typen, Frequenz, Tracking, Freischalt-Logik
// Genutzt von bausteine.js (Vorlagen) und therapieplan.js (Plan je Klient:in)
// ============================================================
const PG_TYPES = {
  wissen: { label: 'Wissen', icon: '&#128214;' },
  quickwin: { label: 'Quick Win', icon: '&#9889;' },
  tracking: { label: 'Tracking', icon: '&#128200;' },
  reflexion: { label: 'Reflexion', icon: '&#128173;' },
};
const PG_FREQ = { einmalig: 'einmalig', taeglich: 't&auml;glich', woechentlich: 'w&ouml;chentlich' };
const PG_TRACK = {
  keins: 'kein Eintrag',
  check: 'Ja/Nein (erledigt)',
  skala: 'Skala 1&ndash;10',
  freitext: 'Freitext',
  skala_freitext: 'Skala 1&ndash;10 + Freitext',
};
// Vorschlag, wenn der Typ gewählt wird
const PG_TYPE_DEFAULTS = {
  wissen: { frequency: 'einmalig', tracking_type: 'keins' },
  quickwin: { frequency: 'einmalig', tracking_type: 'keins' },
  tracking: { frequency: 'taeglich', tracking_type: 'skala' },
  reflexion: { frequency: 'woechentlich', tracking_type: 'skala_freitext' },
};
const PG_ALL_PKGS = ['basics', 'schichtwechsel', 'deluxe'];
const PG_PKG_SHORT = { basics: 'P1', schichtwechsel: 'P2', deluxe: 'P3' };

const PG = { packages: [] };
async function pgLoadPackages() {
  const { data, error } = await sb.from('packages').select('*').order('sort');
  if (error) throw new Error(error.message);
  PG.packages = data || [];
}
const pgPkg = (key) => PG.packages.find(p => p.key === key);

function pgPkgBadges(keys) {
  keys = keys || [];
  if (PG_ALL_PKGS.every(k => keys.includes(k))) return '<span class="pg-badge pkg all">alle Pakete</span>';
  return keys.map(k => `<span class="pg-badge pkg" title="${esc((pgPkg(k) || {}).name || k)}">${PG_PKG_SHORT[k] || esc(k)}</span>`).join('');
}

function pgMeta(x) {
  const t = PG_TYPES[x.task_type] || PG_TYPES.quickwin;
  return [
    `<span class="pg-badge type t-${x.task_type}">${t.icon} ${t.label}</span>`,
    x.frequency && x.frequency !== 'einmalig' ? `<span class="pg-badge">&#128257; ${PG_FREQ[x.frequency]}</span>` : '',
    x.est_minutes ? `<span class="pg-badge">&#9201; ${x.est_minutes} Min.</span>` : '',
    x.tracking_type && x.tracking_type !== 'keins' ? `<span class="pg-badge">&#9998; ${PG_TRACK[x.tracking_type]}</span>` : '',
  ].join('');
}

// Freischalt-Logik: Baustein passt zu Paket, wenn aktiv, einer Phase zugeordnet,
// Phase im Paket freigeschaltet und Paket im Baustein angehakt ist
function pgBlockFits(b, pkg, phases) {
  if (!b.active || !b.phase_id || !pkg) return false;
  const ph = phases.find(p => p.id === b.phase_id);
  return !!ph && (pkg.phases || []).includes(ph.no) && (b.packages || []).includes(pkg.key);
}

// Baustein → Plan-Schritt (Inhalte werden kopiert, danach je Person anpassbar)
function pgStepFromBlock(b, planId, phaseId, sort) {
  return {
    plan_id: planId, phase_id: phaseId || b.phase_id, sort, block_id: b.id, category_id: b.category_id,
    title: b.title, patient_text: b.patient_text, application: b.application, product: b.product,
    duration: b.duration, link_url: b.link_url,
    task_type: b.task_type || 'quickwin', est_minutes: b.est_minutes, frequency: b.frequency || 'einmalig',
    tracking_type: b.tracking_type || 'keins', tracking_question: b.tracking_question,
  };
}

// Lokales Datum als YYYY-MM-DD (nicht UTC)
function pgISO(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// Zeitraum-Schlüssel eines Eintrags: Tag bzw. Montag der Woche
function pgPeriod(freq, d) {
  d = d ? new Date(d) : new Date();
  if (freq === 'woechentlich') { const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); }
  return pgISO(d);
}

// Fortschritt je Themenfeld (Kategorie)
function pgThemeProgress(steps, cats) {
  return cats.map(c => {
    const s = steps.filter(x => x.category_id === c.id);
    return { c, total: s.length, done: s.filter(x => x.status === 'done').length };
  }).filter(x => x.total);
}
function pgThemeBars(steps, cats) {
  const rows = pgThemeProgress(steps, cats);
  if (!rows.length) return '';
  return `<div class="card pg-themes"><h3>Fortschritt je Themenfeld</h3>
    ${rows.map(r => `<div class="pg-theme" style="--c:${r.c.color}">
      <span class="pg-theme-name">${esc(r.c.name)}</span>
      <span class="pg-theme-bar"><span style="width:${Math.round(r.done / r.total * 100)}%"></span></span>
      <span class="pg-theme-n">${r.done}/${r.total}</span></div>`).join('')}
  </div>`;
}

// ---------- Import im JSON-Format des Struktur-Dokuments (Abschnitt 2 „aufgabe“) ----------
// Akzeptiert ein Array, ein einzelnes Objekt oder beliebig verschachtelt (Paket → Phase → Themenfeld)
function pgCollectTasks(node, out) {
  out = out || [];
  if (Array.isArray(node)) node.forEach(n => pgCollectTasks(n, out));
  else if (node && typeof node === 'object') {
    if (typeof node.titel === 'string' || typeof node.title === 'string') out.push(node);
    else Object.values(node).forEach(n => pgCollectTasks(n, out));
  }
  return out;
}
const PG_MIN_TO_PKGS = { basics: PG_ALL_PKGS, schichtwechsel: ['schichtwechsel', 'deluxe'], deluxe: ['deluxe'] };
const PG_TRACK_IN = { boolean: 'check', true: 'check', skala_1_10: 'skala', skala: 'skala', freitext: 'freitext', upload: 'freitext',
  skala_freitext: 'skala_freitext', check: 'check', keins: 'keins', false: 'keins', none: 'keins' };
function pgTaskFromJson(o, phases, cats) {
  const s = (v) => (v == null ? '' : String(v)).trim();
  const phRef = s(o.phase_id || o.phase).toLowerCase();
  const ph = phases.find(p => p.key === phRef || ('phase_' + p.no) === phRef || String(p.no) === phRef || phRef.startsWith('phase_' + p.no + '_') || p.name.toLowerCase() === phRef);
  const tfRef = s(o.themenfeld_id || o.themenfeld).toLowerCase();
  const cat = cats.find(c => c.key === tfRef || c.name.toLowerCase() === tfRef);
  const type = PG_TYPES[s(o.typ || o.task_type)] ? s(o.typ || o.task_type) : 'quickwin';
  const freq = PG_FREQ[s(o.frequenz || o.frequency)] ? s(o.frequenz || o.frequency) : PG_TYPE_DEFAULTS[type].frequency;
  const trRaw = s(o.tracking_feld != null ? o.tracking_feld : o.tracking_type).toLowerCase();
  let pk = o.pakete || o.packages;
  if (!Array.isArray(pk)) pk = PG_MIN_TO_PKGS[s(o.paket_mindeststufe).toLowerCase()] || PG_ALL_PKGS;
  const min = parseInt(o.geschaetzte_dauer_min || o.est_minutes, 10);
  return {
    title: s(o.titel || o.title),
    phase_id: ph ? ph.id : null, _phase: phRef, _phaseOk: !!ph,
    category_id: cat ? cat.id : null, _cat: tfRef, _catOk: !!cat,
    task_type: type, frequency: freq,
    tracking_type: PG_TRACK_IN[trRaw] || PG_TYPE_DEFAULTS[type].tracking_type,
    tracking_question: s(o.tracking_frage || o.tracking_question) || null,
    est_minutes: isNaN(min) ? null : min,
    packages: pk.filter(k => PG_ALL_PKGS.includes(k)),
    patient_text: s(o.beschreibung || o.patient_text) || null,
    application: s(o.handlungsanweisung || o.anwendung || o.application) || null,
    description: s(o.interne_notiz || o.description) || null,
    active: true,
  };
}
