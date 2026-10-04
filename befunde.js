// ============================================================
// Gesundheitsbude-App — Befunde, Laborwerte, Einnahmen (aus dem Therapieplan), Zyklus
// Praxis: Therapieplan (Word/PDF) importieren → Prüfansicht → Einnahmen + Laborwerte + Plan-Dokument
//         Befunde hochladen/ansehen/löschen (nur über Edge Function „dokumente“, protokolliert)
// Klient:in: „Meine Unterlagen“ (Pläne, Befunde, Werte) · „Meine Einnahmen“ im Tagebuch zum Abhaken
// Datenschutz: Dateien werden im Browser ausgelesen, nichts geht an Dritte. Bibliotheken liegen in /vendor.
// ============================================================
const MD_SLOTS = { morgens: 'Morgens', mittags: 'Mittags', abends: 'Abends', nachts: 'Zur Nacht' };
const MD_SLOT_ICON = { morgens: '&#127749;', mittags: '&#9728;', abends: '&#127769;', nachts: '&#128164;' };
const MD_SCHED = { taeglich: 'täglich', intervall: 'jeden n-ten Tag', wochentage: 'bestimmte Wochentage', zyklus: 'Zyklustage' };
const MD_WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DOC_KIND = { labor: 'Laborbefund', plan: 'Therapieplan', sonstiges: 'Sonstiges' };
const MD_MAX_UPLOAD = 10 * 1024 * 1024;

// ---------- Datum ----------
const mdISO = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const mdAdd = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return mdISO(d); };
const mdDiff = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
const mdFmt = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const mdWeekday = (iso) => ((new Date(iso + 'T12:00:00').getDay() + 6) % 7) + 1; // 1 = Mo

// ---------- Zyklus + Fälligkeit ----------
function mdCycleDay(starts, iso) {
  const s = starts.map(x => x.start_date).filter(d => d <= iso).sort().pop();
  return s ? mdDiff(s, iso) + 1 : null;
}
// true | false | 'unknown' (Zyklustag nicht bekannt)
function mdDue(m, iso, starts) {
  if (!m.active || m.start_date > iso || (m.end_date && m.end_date < iso)) return false;
  if (m.schedule === 'intervall') return mdDiff(m.start_date, iso) % (m.interval_days || 2) === 0;
  if (m.schedule === 'wochentage') return (m.weekdays || []).includes(mdWeekday(iso));
  if (m.schedule === 'zyklus') {
    const cd = mdCycleDay(starts, iso);
    if (cd == null) return 'unknown';
    return cd >= (m.cycle_from || 1) && cd <= (m.cycle_to || 60);
  }
  return true;
}
function mdNextDue(m, iso, starts) {
  for (let i = 1; i <= 60; i++) { const d = mdAdd(iso, i); if (mdDue(m, d, starts) === true) return d; }
  return null;
}
function mdSchedText(m) {
  if (m.schedule === 'intervall') return 'jeden ' + (m.interval_days || 2) + '. Tag';
  if (m.schedule === 'wochentage') return (m.weekdays || []).map(n => MD_WD[n - 1]).join(', ') || 'Wochentage?';
  if (m.schedule === 'zyklus') return 'Zyklustag ' + (m.cycle_from || '?') + '–' + (m.cycle_to || '?');
  return 'täglich';
}
// Umsetzung: fällige Häkchen vs. gesetzte im Zeitraum
function mdAdherence(m, logs, days, starts) {
  let due = 0, done = 0;
  days.forEach(d => {
    if (mdDue(m, d, starts) !== true) return;
    m.slots.forEach(s => { due++; if (logs.some(l => l.med_id === m.id && l.log_date === d && l.slot === s)) done++; });
  });
  return { due, done, pct: due ? Math.round(done / due * 100) : null };
}

// ---------- Bibliotheken (selbst gehostet) ----------
function mdScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = () => ok(window[globalName]); s.onerror = () => fail(new Error('Bibliothek konnte nicht geladen werden: ' + src));
    document.head.appendChild(s);
  });
}

// ============================================================
// Plan auslesen (Word / PDF) → Blöcke: { type:'p', text } | { type:'table', rows:[[zelle…]…] }
// ============================================================
async function mdReadDocx(file) {
  const JSZip = await mdScript('vendor/jszip.min.js', 'JSZip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const ptext = (p) => {
    let t = '';
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.namespaceURI !== W) { if (c.childNodes) walk(c); continue; }
        if (c.localName === 't') t += c.textContent;
        else if (c.localName === 'tab') t += ' ';
        else if (c.localName === 'br') t += ' ';
        else walk(c);
      }
    };
    walk(p);
    return t.replace(/\s+/g, ' ').trim();
  };
  const blocks = [];
  const body = xml.getElementsByTagNameNS(W, 'body')[0];
  for (const el of body.childNodes) {
    if (el.namespaceURI !== W) continue;
    if (el.localName === 'p') { const t = ptext(el); if (t) blocks.push({ type: 'p', text: t }); }
    else if (el.localName === 'tbl') {
      const rows = [];
      for (const tr of el.childNodes) {
        if (tr.localName !== 'tr') continue;
        const cells = [];
        for (const tc of tr.childNodes) if (tc.localName === 'tc') cells.push([...tc.getElementsByTagNameNS(W, 'p')].map(ptext).filter(Boolean).join(' '));
        rows.push(cells);
      }
      blocks.push({ type: 'table', rows });
    }
  }
  return blocks;
}

async function mdReadPdf(file) {
  const pdfjs = await mdScript('vendor/pdf.min.js', 'pdfjsLib');
  pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  // 1) alle Zeilen aller Seiten (y gruppiert, Zellen an großen x-Lücken getrennt)
  const lines = [];
  for (let pn = 1; pn <= pdf.numPages; pn++) {
    const tc = await (await pdf.getPage(pn)).getTextContent();
    const items = tc.items.filter(i => i.str.trim()).map(i => ({ x: i.transform[4], y: Math.round(i.transform[5]), w: i.width, s: i.str }));
    const pl = [];
    items.sort((a, b) => b.y - a.y || a.x - b.x).forEach(it => {
      let ln = pl.find(l => Math.abs(l.y - it.y) <= 2);
      if (!ln) { ln = { y: it.y, page: pn, items: [] }; pl.push(ln); }
      ln.items.push(it);
    });
    pl.sort((a, b) => b.y - a.y).forEach(l => {
      l.items.sort((a, b) => a.x - b.x);
      l.cells = [];
      l.items.forEach(it => {
        const last = l.cells[l.cells.length - 1];
        if (last && it.x - last.x2 < 14) { last.s += (it.x - last.x2 > 1.5 ? ' ' : '') + it.s; last.x2 = it.x + it.w; }
        else l.cells.push({ x: it.x, x2: it.x + it.w, s: it.s });
      });
      l.text = l.cells.map(c => c.s).join(' ').replace(/\s+/g, ' ').trim();
      lines.push(l);
    });
  }
  const colOf = (cols, x) => { let k = 0; cols.forEach((cx, idx) => { if (x >= cx - 6) k = idx; }); return k; };
  // In Tabellen jedes Textstück einzeln seiner Spalte zuordnen (nahe beieinander stehende Zellen nicht verschmelzen)
  const rowOf = (ln, cols) => {
    const row = cols.map(() => ''), end = cols.map(() => null);
    ln.items.forEach(it => {
      const k = colOf(cols, it.x);
      row[k] += (row[k] && (end[k] == null || it.x - end[k] > 1.5) ? ' ' : '') + it.s;
      end[k] = it.x + it.w;
    });
    return row.map(v => v.replace(/\s+/g, ' ').trim());
  };
  const mapped = (hdr) => { const k = mdTableKind(hdr); return k ? Object.keys(mdColMap(hdr, k === 'med' ? MD_MED_COLS : MD_LAB_COLS)).length : 0; };
  const gap = (a, b) => a.page === b.page ? a.y - b.y : null;
  // 2) Tabellen: Kopfzeile (ggf. zweizeilig) mit bekannten Spaltennamen
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const h = lines[i];
    let cols = null, header = null, next = i + 1;
    if (h.cells.length >= 2) {
      cols = h.cells.map(c => c.x);
      header = h.cells.map(c => c.s);
      // zweizeiliger Kopf („Unser / Zielbereich“): zusammenführen, wenn dadurch mehr Spalten erkannt werden
      const h2 = lines[i + 1];
      if (h2 && gap(h, h2) != null && gap(h, h2) < 16 && !/\d/.test(h2.text)) {
        const merged = header.slice();
        h2.cells.forEach(c => { const k = colOf(cols, c.x); merged[k] = (merged[k] + ' ' + c.s).trim(); });
        if (mapped(merged) > mapped(header)) { header = merged; next = i + 2; }
      }
      if (!mdTableKind(header)) header = null;
    }
    if (!header) { blocks.push({ type: 'p', text: h.text }); i++; continue; }
    // Kandidaten-Zeilen sammeln (auch über Seitenwechsel, wenn die Spalten passen)
    const cand = [];
    let j = next, prev = lines[next - 1];
    while (j < lines.length) {
      const ln = lines[j];
      const g = gap(prev, ln);
      if (g == null ? Math.abs(ln.cells[0].x - cols[0]) > 8 : g > 40) break;
      if (/^[•▪●]\s?/.test(ln.text) || ln.cells[0].x < cols[0] - 8) break;
      cand.push(ln); prev = ln; j++;
    }
    // Zeilenabstand innerhalb einer Zelle vs. zwischen Tabellenzeilen
    const gaps = cand.slice(1).map((l, k) => gap(cand[k], l)).filter(g => g != null && g > 0);
    const base = gaps.length ? Math.min(...gaps) : 0, max = gaps.length ? Math.max(...gaps) : 0;
    const wraps = base && max / base >= 1.3;
    const rows = [header];
    let used = 0;
    for (let k = 0; k < cand.length; k++) {
      const ln = cand[k];
      const g = k ? gap(cand[k - 1], ln) : Infinity;
      const newRow = !wraps || g == null || g > base * 1.3 || k === 0;
      if (newRow && ln.cells.length === 1 && cols.length >= 3 && k > 0) break;   // Überschrift nach der Tabelle
      const row = rowOf(ln, cols);
      if (newRow) rows.push(row);
      else rows[rows.length - 1] = rows[rows.length - 1].map((v, idx) => row[idx] ? (v + ' ' + row[idx]).trim() : v);
      used = k + 1;
    }
    blocks.push({ type: 'table', rows });
    i = next + used;
  }
  return blocks;
}

// ---------- Tabellen deuten ----------
const mdNorm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const MD_MED_COLS = {
  name: /^(was|mittel|präparat|praeparat|wirkstoff|produkt|nahrungsergänzung|supplement)/,
  dose: /(wie ?viel|dosis|dosierung|menge|stärke)/,
  when: /(wann|einnahme|tageszeit|zeitpunkt|anwendung)/,
  rhythm: /(rhythmus|häufigkeit|haeufigkeit|intervall)/,
  duration: /(dauer|zeitraum|wie lange)/,
  note: /(hinweis|bemerkung|wichtig|tipp)/,
};
const MD_LAB_COLS = {
  name: /^(wert|parameter|laborwert|analyt|marker)$/,
  value: /(dein ergebnis|ergebnis|messwert|dein wert|befund)/,
  ref: /(referenz|norm)/,
  target: /(ziel|optimal)/,
  rating: /(einordnung|bewertung|beurteilung)/,
};
function mdColMap(header, defs) {
  const map = {};
  header.forEach((h, i) => { const n = mdNorm(h); for (const [k, re] of Object.entries(defs)) if (map[k] == null && re.test(n)) { map[k] = i; break; } });
  return map;
}
function mdTableKind(header) {
  const med = mdColMap(header, MD_MED_COLS);
  if (med.name != null && (med.dose != null || med.when != null || med.rhythm != null)) return 'med';
  const lab = mdColMap(header, MD_LAB_COLS);
  if (lab.name != null && lab.value != null) return 'lab';
  return null;
}

const MD_NUMWORD = { zweiten: 2, dritten: 3, vierten: 4, zwei: 2, drei: 3, vier: 4 };
function mdParseMed(name, dose, when, rhythm, duration, note, ctx) {
  const warn = [];
  const all = mdNorm([dose, when, rhythm].join(' '));
  let schedule = 'taeglich', interval_days = null, weekdays = null, cycle_from = null, cycle_to = null, m;
  if ((m = all.match(/jeden\s+(\d+|zweiten|dritten|vierten)\.?\s*tag|alle\s+(\d+|zwei|drei|vier)\s+tage|(\d+)\s*[x×]\s*(?:pro|in der|\/)\s*woche/))) {
    if (m[3]) { schedule = 'wochentage'; const n = +m[3]; weekdays = n >= 3 ? [1, 3, 5].slice(0, n).concat(n > 3 ? [6, 7].slice(0, n - 3) : []) : (n === 2 ? [1, 4] : [1]); warn.push('Wochentage vorgeschlagen – bitte prüfen'); }
    else { schedule = 'intervall'; const raw = m[1] || m[2]; interval_days = MD_NUMWORD[raw] || parseInt(raw, 10) || 2; }
  } else if ((m = all.match(/(?:zyklustag(?:e|en)?|\bzt)\s*(\d+)\s*(?:[–\-]|bis)\s*(\d+)/))) {
    schedule = 'zyklus'; cycle_from = +m[1]; cycle_to = +m[2];
  } else if ((m = all.match(/\b(mo|di|mi|do|fr|sa|so)(?:\.|ntag|nstag|ttwoch|nnerstag|eitag|mstag|nnabend)?(?:\s*(?:,|\/|\+|und|&)\s*(mo|di|mi|do|fr|sa|so)(?:\.|ntag|nstag|ttwoch|nnerstag|eitag|mstag|nnabend)?)+/))) {
    schedule = 'wochentage';
    const map = { mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 7 };
    weekdays = [...new Set((m[0].match(/\b(mo|di|mi|do|fr|sa|so)/g) || []).map(x => map[x]))].sort();
  } else if (/zyklus/.test(all)) warn.push('Zyklusbezug erkannt, aber keine Zyklustage – bitte eintragen');
  // Tageszeiten
  const slots = [];
  if (/morgens|früh|frueh|frühstück|fruehstueck|nüchtern|nuechtern|nach dem aufstehen/.test(all)) slots.push('morgens');
  if (/mittag/.test(all)) slots.push('mittags');
  if (/abend/.test(all)) slots.push('abends');
  if (/zur nacht|vor dem schlaf|schlafengehen|nachts|vor dem zubettgehen/.test(all)) slots.push('nachts');
  const xn = all.match(/(\d)\s*[x×]\s*(?:täglich|taeglich|pro tag|am tag|\/tag)/);
  if (/\boder\b/.test(all) && slots.length > 1) { slots.splice(1); warn.push('„oder“ bei der Tageszeit – bitte eine wählen'); }
  if (!slots.length) {
    if (xn && +xn[1] === 2) slots.push('morgens', 'abends');
    else if (xn && +xn[1] >= 3) slots.push('morgens', 'mittags', 'abends');
    else { slots.push('morgens'); warn.push('Tageszeit nicht erkannt – bitte prüfen'); }
  }
  // Dauer: eigene Spalte > Phasen-Überschrift
  let weeks = ctx.weeks, offset = ctx.offsetDays || 0, durNote = '';
  const d = mdNorm(duration);
  if (d) {
    if ((m = d.match(/(\d+)\s*woche/))) weeks = +m[1];
    else if ((m = d.match(/(\d+)\s*monat/))) weeks = Math.round(+m[1] * 4.35);
    else if ((m = d.match(/(\d+)\s*zykl/))) { weeks = null; durNote = m[1] + ' Zyklen'; }
    else if (/dauerhaft|fortlaufend|bis auf weiteres/.test(d)) weeks = null;
  }
  const cleanDose = String(dose || '')
    .replace(/(^|\s)\d\s*(?:[x×]\s*)?(?:\/\s*tag|täglich|taeglich|pro tag|am tag)(?=\s|$|[,;.])/gi, ' ')
    .replace(/(^|\s)(?:täglich|taeglich|pro tag|\/\s*tag)(?=\s|$|[,;.])/gi, ' ')
    .replace(/\s{2,}/g, ' ').replace(/[,;]\s*$/, '').trim();
  const noteTxt = [String(when || '').trim(), String(note || '').trim(), durNote].filter(Boolean).join(' · ');
  return {
    include: true, name: String(name || '').trim(), dose: cleanDose, slots: [...new Set(slots)],
    schedule, interval_days, weekdays, cycle_from, cycle_to, weeks, offset, note: noteTxt, warn,
  };
}

function mdParseLab(cells) {
  const vt = String(cells.value || '').trim();
  const m = vt.replace(/\s/g, ' ').match(/^([<>≤≥]?\s*)(-?\d+(?:[.,]\d+)?)\s*(.*)$/);
  return {
    include: true, name: String(cells.name || '').trim(), value_text: vt,
    value: m ? parseFloat(m[2].replace(',', '.')) : null, unit: m ? m[3].trim() : '',
    ref_range: String(cells.ref || '').trim(), target_range: String(cells.target || '').trim(), rating: String(cells.rating || '').trim(),
  };
}

function mdExtract(blocks) {
  const out = { docDate: null, title: '', meds: [], labs: [] };
  let ctx = { weeks: null, offsetDays: 0 };
  blocks.forEach((b, idx) => {
    if (b.type === 'p') {
      if (!out.title && idx < 3) out.title = b.text.slice(0, 120);
      const dm = b.text.match(/Datum:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (dm && !out.docDate) out.docDate = dm[3] + '-' + dm[2].padStart(2, '0') + '-' + dm[1].padStart(2, '0');
      let m;
      if ((m = b.text.match(/woche\s*(\d+)\s*(?:[–\-]|bis)\s*(\d+)/i))) ctx = { weeks: +m[2] - +m[1] + 1, offsetDays: (+m[1] - 1) * 7 };
      else if (/^phase\s*\d/i.test(b.text) && (m = b.text.match(/(\d+)\s*wochen/i))) ctx = { weeks: +m[1], offsetDays: 0 };
      return;
    }
    if (!b.rows.length) return;
    const kind = mdTableKind(b.rows[0]);
    if (kind === 'med') {
      const c = mdColMap(b.rows[0], MD_MED_COLS);
      b.rows.slice(1).forEach(r => {
        const g = (k) => c[k] != null ? r[c[k]] : '';
        if (!g('name')) return;
        out.meds.push(mdParseMed(g('name'), g('dose'), g('when'), g('rhythm'), g('duration'), g('note'), ctx));
      });
    } else if (kind === 'lab') {
      const c = mdColMap(b.rows[0], MD_LAB_COLS);
      b.rows.slice(1).forEach(r => {
        const g = (k) => c[k] != null ? r[c[k]] : '';
        if (g('name') && g('value')) out.labs.push(mdParseLab({ name: g('name'), value: g('value'), ref: g('ref'), target: g('target'), rating: g('rating') }));
      });
    }
  });
  return out;
}

// ============================================================
// Praxis: Übersicht + Akte je Klient:in
// ============================================================
async function renderBefundePage(profile) {
  if (!isStaff(profile)) { renderMenu(profile); return; }
  const [pr, mi, lv, dc] = await Promise.all([
    sb.from('profiles').select('id, name, permissions').eq('role', 'client'),
    sb.from('med_items').select('patient_id, active, end_date'),
    sb.from('lab_values').select('patient_id, taken_on'),
    sb.from('patient_documents').select('patient_id, created_at'),
  ]);
  const today = mdISO(new Date());
  const patients = (pr.data || []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const rows = patients.map(u => {
    const meds = (mi.data || []).filter(m => m.patient_id === u.id && m.active && (!m.end_date || m.end_date >= today)).length;
    const labs = (lv.data || []).filter(l => l.patient_id === u.id);
    const lastLab = labs.reduce((a, l) => l.taken_on > a ? l.taken_on : a, '');
    const docs = (dc.data || []).filter(d => d.patient_id === u.id).length;
    return `<tr><td><span class="uname-name">${esc(u.name)}</span></td>
      <td>${meds ? `<b>${meds}</b> aktiv` : '<span class="muted">&ndash;</span>'}</td>
      <td>${lastLab ? mdFmt(lastLab) : '<span class="muted">&ndash;</span>'}</td>
      <td>${docs || '<span class="muted">&ndash;</span>'}</td>
      <td><button type="button" class="secondary small-btn" data-open="${u.id}">&Ouml;ffnen</button></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="muted">Noch keine Klient:innen.</td></tr>';
  renderShell(profile, 'befunde', 'Befunde & Einnahmen', `
    <div class="card"><div class="tablewrap"><table class="user-table">
      <thead><tr><th>Name</th><th>Einnahmen</th><th>Letzte Laborwerte</th><th>Dokumente</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="hint">In der Akte einer Klient:in: <b>Plan importieren</b> (Word oder PDF) &rarr; Einnahmen und Laborwerte werden erkannt, ihr pr&uuml;ft sie und &uuml;bernehmt sie. Die Datei wird nur in eurem Browser ausgelesen.</p></div>`);
  appEl.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => renderBefundePatient(profile, patients.find(p => p.id === b.dataset.open)); });
}

async function renderBefundePatient(profile, patient) {
  const today = mdISO(new Date());
  const days14 = Array.from({ length: 14 }, (_, i) => mdAdd(today, i - 13));
  const [mi, ml, cs, lv, dc, au] = await Promise.all([
    sb.from('med_items').select('*').eq('patient_id', patient.id).order('sort').order('created_at'),
    sb.from('med_logs').select('*').eq('patient_id', patient.id).gte('log_date', days14[0]),
    sb.from('cycle_starts').select('*').eq('patient_id', patient.id).order('start_date', { ascending: false }),
    sb.from('lab_values').select('*').eq('patient_id', patient.id).order('taken_on', { ascending: false }),
    sb.from('patient_documents').select('*').eq('patient_id', patient.id).order('created_at', { ascending: false }),
    isAdmin(profile) ? sb.from('audit_log').select('*').eq('patient_id', patient.id).order('at', { ascending: false }).limit(15) : Promise.resolve({ data: [] }),
  ]);
  const meds = mi.data || [], logs = ml.data || [], starts = cs.data || [], labs = lv.data || [], docs = dc.data || [];
  const cd = mdCycleDay(starts, today);
  const hasCycleMeds = meds.some(m => m.schedule === 'zyklus' && m.active);
  const first = esc(patient.name.split(' ')[0]);

  const medRows = meds.map(m => {
    const ad = mdAdherence(m, logs, days14, starts);
    const over = m.end_date && m.end_date < today;
    return `<div class="md-row${m.active && !over ? '' : ' off'}">
      <div class="md-main"><b>${esc(m.name)}</b>${m.dose ? ' <span class="md-dose">' + esc(m.dose) + '</span>' : ''}
        <div class="rt-sub">${m.slots.map(s => MD_SLOT_ICON[s] + ' ' + MD_SLOTS[s]).join(' + ')} &middot; ${esc(mdSchedText(m))} &middot; ${mdFmt(m.start_date)}${m.end_date ? ' &ndash; ' + mdFmt(m.end_date) : ' &middot; ohne Enddatum'}${!m.active ? ' &middot; pausiert' : (over ? ' &middot; beendet' : '')}</div>
        ${m.note ? `<div class="rt-sub">&#128221; ${esc(m.note)}</div>` : ''}</div>
      <div class="md-ad">${ad.pct == null ? '<span class="muted">&ndash;</span>' : `<b>${ad.pct}&nbsp;%</b><br><span class="muted">${ad.done}/${ad.due}</span>`}</div>
      <button type="button" class="link-btn" data-med="${m.id}">bearbeiten</button>
    </div>`;
  }).join('') || '<p class="muted">Noch keine Einnahmen. Importiert einen Plan oder legt sie einzeln an.</p>';

  // Laborwerte: je Parameter neuester Wert + Verlauf
  const byName = {};
  labs.forEach(l => { const k = l.name.split(' (')[0].trim().toLowerCase(); (byName[k] = byName[k] || []).push(l); });
  const labRows = Object.values(byName).map(list => {
    const [cur, prev] = list;
    return `<tr><td><b>${esc(cur.name)}</b></td><td class="nowrap"><b>${esc(cur.value_text || (cur.value ?? ''))}</b><div class="rt-sub">${mdFmt(cur.taken_on)}</div></td>
      <td class="nowrap">${prev ? esc(prev.value_text || prev.value) + `<div class="rt-sub">${mdFmt(prev.taken_on)}</div>` : '<span class="muted">&ndash;</span>'}</td>
      <td>${esc(cur.ref_range || '')}</td><td>${esc(cur.target_range || '')}</td><td>${esc(cur.rating || '')}</td>
      <td><button type="button" class="link-btn" data-lab="${cur.id}">${list.length > 1 ? 'Verlauf' : 'bearbeiten'}</button></td></tr>`;
  }).join('');

  const docRows = docs.map(d => `<tr><td><b>${esc(d.title)}</b><div class="rt-sub">${DOC_KIND[d.kind]}${d.doc_date ? ' &middot; ' + mdFmt(d.doc_date) : ''} &middot; hochgeladen ${new Date(d.created_at).toLocaleDateString('de-DE')}${d.uploaded_by_name ? ' von ' + esc(d.uploaded_by_name) : ''}</div></td>
    <td><label class="check md-vis"><input type="checkbox" data-vis="${d.id}" ${d.visible_to_patient ? 'checked' : ''}> f&uuml;r ${first} sichtbar</label></td>
    <td class="nowrap"><button type="button" class="secondary small-btn" data-view="${d.id}">Ansehen</button> <button type="button" class="danger small-btn" data-deldoc="${d.id}">&times;</button></td></tr>`).join('');

  const audit = (au.data || []).map(a => `<tr><td class="nowrap">${new Date(a.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(a.actor_name || '–')}</td><td>${esc(a.action)}</td><td>${esc(a.object || '')}${a.details && (a.details.title || a.details.name) ? ': ' + esc(a.details.title || a.details.name) : ''}</td></tr>`).join('');

  const content = `
    <div class="card">
      <div class="tp-head-row"><div><div class="tp-kicker">Akte</div><h2 style="margin:0;">${esc(patient.name)}</h2></div><span class="spacer"></span>
        <button type="button" id="mdImport">&#128229; Plan importieren</button>
        <button type="button" class="secondary" id="mdUpload">Dokument hochladen</button></div>
      <div class="md-facts">
        <span>${cd ? `&#127800; Zyklustag <b>${cd}</b> (Periode seit ${mdFmt(starts[0].start_date)})` : (hasCycleMeds ? '&#9888; Zyklus-Einnahmen, aber noch kein Periodenbeginn eingetragen' : '&#127800; kein Periodenbeginn eingetragen')}</span>
        ${cd && cd > 35 ? '<span class="pg-badge warn">Zyklus &gt; 35 Tage &ndash; ggf. Zyklus-Einnahmen anpassen</span>' : ''}
        <button type="button" class="link-btn" id="mdCycle">Periodenbeginn eintragen</button>
      </div>
      ${can(patient, 'tagebuch') ? (perm(patient, 'tagebuch') === 'edit' ? '' : `<p class="notice">${first} kann Einnahmen nur ansehen, nicht abhaken (Recht &bdquo;Tagebuch&ldquo; = nur ansehen).</p>`) : `<p class="notice">&#9888; Recht &bdquo;Tagebuch&ldquo; fehlt &mdash; ${first} sieht die Einnahmen nicht. In der Nutzerverwaltung freischalten.</p>`}
    </div>
    <div class="card"><div class="tp-head-row"><h2 style="margin:0;">Einnahmen</h2><span class="spacer"></span>
      <button type="button" class="secondary small-btn" id="mdAdd">+ Einnahme</button></div>
      <div class="md-list">${medRows}</div>
      ${meds.length ? '<p class="hint">Umsetzung = abgehakte von f&auml;lligen Einnahmen der letzten 14 Tage.</p>' : ''}</div>
    <div class="card"><div class="tp-head-row"><h2 style="margin:0;">Laborwerte</h2><span class="spacer"></span>
      <button type="button" class="secondary small-btn" id="mdLabAdd">+ Wert</button></div>
      ${labRows ? `<div class="tablewrap"><table class="md-lab"><thead><tr><th>Wert</th><th>Aktuell</th><th>Vorher</th><th>Referenz</th><th>Ziel</th><th>Einordnung</th><th></th></tr></thead><tbody>${labRows}</tbody></table></div>` : '<p class="muted">Noch keine Laborwerte.</p>'}
      ${can(patient, 'labor') ? '' : `<p class="hint">${first} sieht Laborwerte und Befunde erst mit dem Recht &bdquo;Laborwerte&ldquo;.</p>`}</div>
    <div class="card"><h2>Dokumente</h2>
      ${docRows ? `<div class="tablewrap"><table class="md-docs"><tbody>${docRows}</tbody></table></div>` : '<p class="muted">Noch keine Dokumente.</p>'}
      <p class="hint">Dateien liegen verschl&uuml;sselt in einem privaten Speicher (EU). Links zum Ansehen gelten 2 Minuten; jeder Zugriff wird protokolliert.</p></div>
    ${isAdmin(profile) ? `<div class="card"><h3>Zugriffsprotokoll</h3>${audit ? `<div class="tablewrap"><table class="md-audit"><tbody>${audit}</tbody></table></div>` : '<p class="muted">Noch keine Eintr&auml;ge.</p>'}</div>` : ''}`;
  renderShell(profile, 'befunde', 'Befunde & Einnahmen', content, { label: 'Befunde & Einnahmen', go: () => renderBefundePage(profile) });
  const again = () => renderBefundePatient(profile, patient);
  document.getElementById('mdImport').onclick = () => mdPickFile('.docx,.pdf', f => mdImportFile(profile, patient, f, again));
  document.getElementById('mdUpload').onclick = () => mdUploadDialog(profile, patient, again);
  document.getElementById('mdAdd').onclick = () => mdMedDialog(profile, patient, null, again);
  document.getElementById('mdLabAdd').onclick = () => mdLabDialog(patient, null, [], again);
  document.getElementById('mdCycle').onclick = () => mdCycleDialog(patient, starts, again);
  appEl.querySelectorAll('[data-med]').forEach(b => { b.onclick = () => mdMedDialog(profile, patient, meds.find(m => m.id === b.dataset.med), again); });
  appEl.querySelectorAll('[data-lab]').forEach(b => {
    b.onclick = () => { const l = labs.find(x => x.id === b.dataset.lab); const k = l.name.split(' (')[0].trim().toLowerCase(); mdLabDialog(patient, l, byName[k], again); };
  });
  appEl.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => mdOpenDoc(b.dataset.view); });
  appEl.querySelectorAll('[data-vis]').forEach(c => {
    c.onchange = async () => {
      const { error } = await sb.from('patient_documents').update({ visible_to_patient: c.checked }).eq('id', c.dataset.vis);
      if (!error) await sb.rpc('audit', { p_action: 'update', p_object: 'dokument', p_object_id: c.dataset.vis, p_patient: patient.id, p_details: { sichtbar: c.checked } });
      toast(error ? 'Fehler: ' + error.message : (c.checked ? 'Für ' + patient.name.split(' ')[0] + ' sichtbar.' : 'Verborgen.'));
    };
  });
  appEl.querySelectorAll('[data-deldoc]').forEach(b => {
    b.onclick = async () => {
      const d = docs.find(x => x.id === b.dataset.deldoc);
      if (!confirm('Dokument „' + d.title + '“ endgültig löschen?')) return;
      const { data, error } = await sb.functions.invoke('dokumente', { body: { action: 'delete', docId: d.id } });
      if (error || (data && data.error)) { toast('Fehler: ' + ((data && data.error) || error.message)); return; }
      toast('Gelöscht.'); again();
    };
  });
}

// ---------- Datei wählen / hochladen / ansehen ----------
function mdPickFile(accept, cb) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
  i.onchange = () => { if (i.files[0]) cb(i.files[0]); };
  i.click();
}
const mdMime = (f) => f.type || (/\.docx$/i.test(f.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : (/\.pdf$/i.test(f.name) ? 'application/pdf' : ''));
function mdBase64(file) {
  return new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => fail(r.error); r.readAsDataURL(file); });
}
async function mdUploadFile(patientId, file, meta) {
  if (file.size > MD_MAX_UPLOAD) throw new Error('Datei ist größer als 10 MB.');
  const { data, error } = await sb.functions.invoke('dokumente', { body: { action: 'upload', patientId, mime: mdMime(file), dataBase64: await mdBase64(file), ...meta } });
  if (error || (data && data.error)) throw new Error((data && data.error) || error.message);
  return data.document;
}
async function mdOpenDoc(docId) {
  const w = window.open('', '_blank');   // vor dem await öffnen, sonst blockt Safari das Fenster
  const { data, error } = await sb.functions.invoke('dokumente', { body: { action: 'url', docId } });
  if (error || (data && data.error)) { if (w) w.close(); toast('Fehler: ' + ((data && data.error) || error.message)); return; }
  if (w) w.location = data.url; else location.href = data.url;
}

function mdUploadDialog(profile, patient, done, ownUpload) {
  const m = tbModal(`<h2>Dokument hochladen</h2>
    <form id="upForm" class="modal-form">
      <label class="wide">Datei <span class="muted">(PDF, Word, JPG, PNG &middot; max. 10 MB)</span><input type="file" id="up_file" accept=".pdf,.docx,.jpg,.jpeg,.png" required></label>
      <label class="wide">Titel<input type="text" id="up_title" required placeholder="z. B. Labor 24.09.2026"></label>
      ${ownUpload ? '' : `<label>Art<select id="up_kind">${Object.entries(DOC_KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>`}
      <label>Datum des Befunds<input type="date" id="up_date"></label>
      ${ownUpload ? '' : `<label class="wide check"><input type="checkbox" id="up_vis" checked> f&uuml;r ${esc(patient.name.split(' ')[0])} sichtbar</label>`}
      <div class="modal-actions wide"><button type="submit" id="up_ok">Hochladen</button><button type="button" class="secondary" id="up_cancel">Abbrechen</button></div>
      <p class="error wide" id="up_err"></p>
    </form>`);
  const $ = (id) => m.el.querySelector('#' + id);
  $('up_cancel').onclick = m.close;
  $('up_file').onchange = () => { const f = $('up_file').files[0]; if (f && !$('up_title').value) $('up_title').value = f.name.replace(/\.[^.]+$/, ''); };
  $('upForm').onsubmit = async (e) => {
    e.preventDefault(); $('up_ok').disabled = true; $('up_err').textContent = 'Lade hoch …';
    try {
      await mdUploadFile(patient.id, $('up_file').files[0], { title: $('up_title').value.trim(), kind: ownUpload ? 'labor' : $('up_kind').value, docDate: $('up_date').value || null, visible: ownUpload ? true : $('up_vis').checked });
      m.close(); toast('Hochgeladen.'); done();
    } catch (err) { $('up_err').textContent = 'Fehler: ' + err.message; $('up_ok').disabled = false; }
  };
}

// ---------- Plan importieren: auslesen → Prüfansicht ----------
async function mdImportFile(profile, patient, file, done) {
  let ex;
  try {
    const blocks = /\.pdf$/i.test(file.name) ? await mdReadPdf(file) : await mdReadDocx(file);
    ex = mdExtract(blocks);
  } catch (e) { toast('Datei nicht lesbar: ' + e.message); return; }
  if (!ex.meds.length && !ex.labs.length) {
    toast('Keine Einnahme- oder Laborwert-Tabelle gefunden. Tipp: Tabellenkopf „Was | Wie viel | Wann & wie“ bzw. „Wert | Ergebnis“.');
  }
  mdReviewDialog(profile, patient, file, ex, done);
}

function mdMedFormHtml(x, i) {
  const opt = (obj, cur) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="md-edit" data-i="${i}">
    ${x.warn && x.warn.length ? `<div class="md-warn">&#9888; ${x.warn.map(esc).join(' &middot; ')}</div>` : ''}
    <div class="md-grid">
      ${i != null ? `<label class="check md-inc"><input type="checkbox" class="e_inc" ${x.include !== false ? 'checked' : ''}> &uuml;bernehmen</label>` : ''}
      <label class="w2">Mittel<input type="text" class="e_name" value="${esc(x.name || '')}" required></label>
      <label>Dosis<input type="text" class="e_dose" value="${esc(x.dose || '')}" placeholder="z. B. 100 µg"></label>
      <div class="md-slots w2"><span>Tageszeit</span>${Object.entries(MD_SLOTS).map(([k, l]) => `<label class="check"><input type="checkbox" class="e_slot" value="${k}" ${(x.slots || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <label>Rhythmus<select class="e_sched">${opt(MD_SCHED, x.schedule || 'taeglich')}</select></label>
      <label class="e_p e_p-intervall">alle … Tage<input type="number" class="e_int" min="2" max="31" value="${x.interval_days || 2}"></label>
      <div class="e_p e_p-wochentage md-slots w2"><span>Wochentage</span>${MD_WD.map((w, n) => `<label class="check"><input type="checkbox" class="e_wd" value="${n + 1}" ${(x.weekdays || []).includes(n + 1) ? 'checked' : ''}> ${w}</label>`).join('')}</div>
      <label class="e_p e_p-zyklus">Zyklustag von<input type="number" class="e_cf" min="1" max="60" value="${x.cycle_from || ''}"></label>
      <label class="e_p e_p-zyklus">bis<input type="number" class="e_ct" min="1" max="60" value="${x.cycle_to || ''}"></label>
      <label>ab<input type="date" class="e_start" value="${esc(x.start_date || '')}"></label>
      <label>bis <span class="muted">(leer = offen)</span><input type="date" class="e_end" value="${esc(x.end_date || '')}"></label>
      <label class="w3">Hinweis f&uuml;r die Klient:in<textarea class="e_note" rows="2" placeholder="z. B. nüchtern, mit Vitamin C, 1 Std. Abstand zu Kaffee">${esc(x.note || '')}</textarea></label>
    </div></div>`;
}
function mdWireMedForm(el) {
  const sync = () => { const v = el.querySelector('.e_sched').value; el.querySelectorAll('.e_p').forEach(p => { p.hidden = !p.classList.contains('e_p-' + v); }); };
  el.querySelector('.e_sched').onchange = sync; sync();
}
function mdReadMedForm(el) {
  const sched = el.querySelector('.e_sched').value;
  return {
    name: el.querySelector('.e_name').value.trim(), dose: el.querySelector('.e_dose').value.trim() || null,
    slots: [...el.querySelectorAll('.e_slot:checked')].map(c => c.value),
    schedule: sched,
    interval_days: sched === 'intervall' ? (parseInt(el.querySelector('.e_int').value, 10) || 2) : null,
    weekdays: sched === 'wochentage' ? [...el.querySelectorAll('.e_wd:checked')].map(c => +c.value) : null,
    cycle_from: sched === 'zyklus' ? (parseInt(el.querySelector('.e_cf').value, 10) || null) : null,
    cycle_to: sched === 'zyklus' ? (parseInt(el.querySelector('.e_ct').value, 10) || null) : null,
    start_date: el.querySelector('.e_start').value || mdISO(new Date()),
    end_date: el.querySelector('.e_end').value || null,
    note: el.querySelector('.e_note').value.trim() || null,
  };
}
function mdCheckMed(v) {
  if (!v.name) return 'Bitte einen Namen eingeben.';
  if (!v.slots.length) return '„' + v.name + '“: bitte mindestens eine Tageszeit wählen.';
  if (v.schedule === 'wochentage' && !v.weekdays.length) return '„' + v.name + '“: bitte Wochentage wählen.';
  if (v.schedule === 'zyklus' && (!v.cycle_from || !v.cycle_to || v.cycle_from > v.cycle_to)) return '„' + v.name + '“: bitte Zyklustage von–bis eintragen.';
  if (v.end_date && v.end_date < v.start_date) return '„' + v.name + '“: Enddatum liegt vor dem Start.';
  return null;
}

function mdReviewDialog(profile, patient, file, ex, done) {
  const today = mdISO(new Date());
  const withDates = (start) => ex.meds.forEach(x => {
    x.start_date = mdAdd(start, x.offset || 0);
    x.end_date = x.weeks ? mdAdd(x.start_date, x.weeks * 7 - 1) : '';
  });
  withDates(today);
  const first = esc(patient.name.split(' ')[0]);
  const m = tbModal(`<h2>Plan pr&uuml;fen: ${esc(patient.name)}</h2>
    <p class="hint" style="margin-top:-6px;">${esc(file.name)} &middot; erkannt: ${ex.meds.length} Einnahmen, ${ex.labs.length} Laborwerte. <b>Bitte jede Zeile pr&uuml;fen</b> &mdash; erst mit &bdquo;&Uuml;bernehmen&ldquo; wird gespeichert.</p>
    <div class="modal-form">
      <label>Start der Einnahmen<input type="date" id="rv_start" value="${today}"></label>
      <label>Datum des Plans / der Laborwerte<input type="date" id="rv_date" value="${esc(ex.docDate || today)}"></label>
      <label class="wide check"><input type="checkbox" id="rv_doc" checked> Plan als Dokument ablegen</label>
      <label class="wide check"><input type="checkbox" id="rv_vis" checked> Dokument f&uuml;r ${first} sichtbar (unter &bdquo;Meine Unterlagen&ldquo;)</label>
      <label class="wide">Titel des Dokuments<input type="text" id="rv_title" value="${esc(ex.title || file.name.replace(/\.[^.]+$/, ''))}"></label>
    </div>
    ${ex.meds.length ? `<h3 class="di-fh">Einnahmen</h3><div id="rv_meds">${ex.meds.map((x, i) => mdMedFormHtml(x, i)).join('')}</div>` : ''}
    ${ex.labs.length ? `<h3 class="di-fh">Laborwerte</h3><div class="tablewrap"><table class="md-rvlab"><thead><tr><th></th><th>Wert</th><th>Ergebnis</th><th>Referenz</th><th>Ziel</th><th>Einordnung</th></tr></thead><tbody>
      ${ex.labs.map((l, i) => `<tr data-l="${i}"><td><input type="checkbox" class="l_inc" checked></td><td><input type="text" class="l_name" value="${esc(l.name)}"></td><td><input type="text" class="l_val" value="${esc(l.value_text)}"></td>
        <td><input type="text" class="l_ref" value="${esc(l.ref_range)}"></td><td><input type="text" class="l_tgt" value="${esc(l.target_range)}"></td><td><input type="text" class="l_rat" value="${esc(l.rating)}"></td></tr>`).join('')}
      </tbody></table></div>` : ''}
    <div class="modal-actions" style="margin-top:14px;">
      <button type="button" id="rv_ok">&Uuml;bernehmen</button>
      <button type="button" class="secondary" id="rv_cancel">Abbrechen</button></div>
    <p class="error" id="rv_err"></p>`);
  m.el.querySelector('.modal').classList.add('wide-modal');
  const $ = (id) => m.el.querySelector('#' + id);
  m.el.querySelectorAll('.md-edit').forEach(mdWireMedForm);
  $('rv_start').onchange = () => {
    withDates($('rv_start').value || today);
    m.el.querySelectorAll('.md-edit').forEach(el => { const x = ex.meds[+el.dataset.i]; el.querySelector('.e_start').value = x.start_date; el.querySelector('.e_end').value = x.end_date; });
  };
  $('rv_cancel').onclick = m.close;
  $('rv_ok').onclick = async () => {
    const err = $('rv_err'); err.textContent = '';
    const meds = [...m.el.querySelectorAll('.md-edit')].filter(el => el.querySelector('.e_inc').checked).map(mdReadMedForm);
    for (const v of meds) { const p = mdCheckMed(v); if (p) { err.textContent = p; return; } }
    const date = $('rv_date').value || today;
    const labs = [...m.el.querySelectorAll('[data-l]')].filter(tr => tr.querySelector('.l_inc').checked).map(tr => {
      const p = mdParseLab({ name: tr.querySelector('.l_name').value, value: tr.querySelector('.l_val').value, ref: tr.querySelector('.l_ref').value, target: tr.querySelector('.l_tgt').value, rating: tr.querySelector('.l_rat').value });
      return { patient_id: patient.id, taken_on: date, name: p.name, value: p.value, value_text: p.value_text, unit: p.unit || null, ref_range: p.ref_range || null, target_range: p.target_range || null, rating: p.rating || null, created_by: profile.id };
    }).filter(l => l.name);
    $('rv_ok').disabled = true; err.textContent = 'Speichere …';
    try {
      let docId = null;
      if ($('rv_doc').checked) {
        const doc = await mdUploadFile(patient.id, file, { title: $('rv_title').value.trim() || file.name, kind: 'plan', docDate: date, visible: $('rv_vis').checked });
        docId = doc.id;
      }
      if (meds.length) {
        const { error } = await sb.from('med_items').insert(meds.map((v, i) => ({ ...v, patient_id: patient.id, document_id: docId, sort: (i + 1) * 10, created_by: profile.id })));
        if (error) throw new Error(error.message);
      }
      if (labs.length) {
        const { error } = await sb.from('lab_values').insert(labs.map(l => ({ ...l, document_id: docId })));
        if (error) throw new Error(error.message);
      }
      await sb.rpc('audit', { p_action: 'import', p_object: 'therapieplan', p_object_id: docId, p_patient: patient.id, p_details: { datei: file.name, einnahmen: meds.length, laborwerte: labs.length } });
      m.close(); toast(meds.length + ' Einnahmen, ' + labs.length + ' Laborwerte übernommen.'); done();
    } catch (e) { err.textContent = 'Fehler: ' + e.message; $('rv_ok').disabled = false; }
  };
}

// ---------- Einnahme einzeln ----------
function mdMedDialog(profile, patient, med, done) {
  const isNew = !med;
  const x = med || { name: '', slots: ['morgens'], schedule: 'taeglich', start_date: mdISO(new Date()), active: true };
  const m = tbModal(`<h2>${isNew ? 'Neue Einnahme' : 'Einnahme bearbeiten'}</h2>
    ${mdMedFormHtml(x, null)}
    ${isNew ? '' : `<label class="check" style="display:block;margin-top:10px;"><input type="checkbox" id="me_active" ${x.active ? 'checked' : ''}> aktiv (abw&auml;hlen = pausieren)</label>`}
    <div class="modal-actions" style="margin-top:14px;">
      <button type="button" id="me_ok">Speichern</button>
      <button type="button" class="secondary" id="me_cancel">Abbrechen</button>
      ${isNew ? '' : '<span class="spacer"></span><button type="button" class="danger" id="me_del">L&ouml;schen</button>'}</div>
    <p class="error" id="me_err"></p>`);
  m.el.querySelector('.modal').classList.add('wide-modal');
  const el = m.el.querySelector('.md-edit');
  mdWireMedForm(el);
  const $ = (id) => m.el.querySelector('#' + id);
  $('me_cancel').onclick = m.close;
  $('me_ok').onclick = async () => {
    const v = mdReadMedForm(el);
    const p = mdCheckMed(v); if (p) { $('me_err').textContent = p; return; }
    if (!isNew) v.active = $('me_active').checked;
    const res = isNew ? await sb.from('med_items').insert({ ...v, patient_id: patient.id, created_by: profile.id, sort: 999 }) : await sb.from('med_items').update(v).eq('id', med.id);
    if (res.error) { $('me_err').textContent = 'Fehler: ' + res.error.message; return; }
    m.close(); toast('Gespeichert.'); done();
  };
  if (!isNew) $('me_del').onclick = async () => {
    if (!confirm('„' + med.name + '“ löschen? Die Häkchen dazu werden mitgelöscht. (Zum Beenden lieber ein Enddatum setzen.)')) return;
    const { error } = await sb.from('med_items').delete().eq('id', med.id);
    if (error) { $('me_err').textContent = 'Fehler: ' + error.message; return; }
    m.close(); toast('Gelöscht.'); done();
  };
}

// ---------- Laborwert einzeln / Verlauf ----------
function mdLabDialog(patient, lab, history, done) {
  const isNew = !lab;
  const l = lab || { name: '', value_text: '', taken_on: mdISO(new Date()) };
  const m = tbModal(`<h2>${isNew ? 'Laborwert eintragen' : esc(l.name)}</h2>
    ${history && history.length > 1 ? `<div class="tablewrap"><table class="md-lab"><thead><tr><th>Datum</th><th>Ergebnis</th><th>Einordnung</th></tr></thead><tbody>
      ${history.map(h => `<tr><td>${mdFmt(h.taken_on)}</td><td><b>${esc(h.value_text || h.value)}</b></td><td>${esc(h.rating || '')}</td></tr>`).join('')}</tbody></table></div><h3 class="di-fh">Neuester Wert</h3>` : ''}
    <div class="modal-form">
      <label class="wide">Wert<input type="text" id="lb_name" value="${esc(l.name)}" placeholder="z. B. Ferritin"></label>
      <label>Ergebnis<input type="text" id="lb_val" value="${esc(l.value_text || '')}" placeholder="z. B. 18 µg/l"></label>
      <label>Datum<input type="date" id="lb_date" value="${esc(l.taken_on)}"></label>
      <label>Referenz<input type="text" id="lb_ref" value="${esc(l.ref_range || '')}"></label>
      <label>Zielbereich<input type="text" id="lb_tgt" value="${esc(l.target_range || '')}"></label>
      <label class="wide">Einordnung<input type="text" id="lb_rat" value="${esc(l.rating || '')}"></label>
    </div>
    <div class="modal-actions" style="margin-top:12px;"><button type="button" id="lb_ok">Speichern</button><button type="button" class="secondary" id="lb_cancel">Abbrechen</button>
      ${isNew ? '' : '<span class="spacer"></span><button type="button" class="danger" id="lb_del">L&ouml;schen</button>'}</div>
    <p class="error" id="lb_err"></p>`);
  const $ = (id) => m.el.querySelector('#' + id);
  $('lb_cancel').onclick = m.close;
  $('lb_ok').onclick = async () => {
    const p = mdParseLab({ name: $('lb_name').value, value: $('lb_val').value, ref: $('lb_ref').value, target: $('lb_tgt').value, rating: $('lb_rat').value });
    if (!p.name || !p.value_text) { $('lb_err').textContent = 'Bitte Wert und Ergebnis eintragen.'; return; }
    const v = { name: p.name, value: p.value, value_text: p.value_text, unit: p.unit || null, ref_range: p.ref_range || null, target_range: p.target_range || null, rating: p.rating || null, taken_on: $('lb_date').value || mdISO(new Date()) };
    const res = isNew ? await sb.from('lab_values').insert({ ...v, patient_id: patient.id }) : await sb.from('lab_values').update(v).eq('id', lab.id);
    if (res.error) { $('lb_err').textContent = 'Fehler: ' + res.error.message; return; }
    m.close(); toast('Gespeichert.'); done();
  };
  if (!isNew) $('lb_del').onclick = async () => {
    if (!confirm('Diesen Laborwert löschen?')) return;
    const { error } = await sb.from('lab_values').delete().eq('id', lab.id);
    if (error) { $('lb_err').textContent = 'Fehler: ' + error.message; return; }
    m.close(); toast('Gelöscht.'); done();
  };
}

// ---------- Periodenbeginn (Praxis) ----------
function mdCycleDialog(patient, starts, done) {
  const m = tbModal(`<h2>Periodenbeginn: ${esc(patient.name)}</h2>
    <div class="inline-form"><label>Erster Tag der Periode<input type="date" id="cy_date" value="${mdISO(new Date())}"></label><button type="button" id="cy_add">Eintragen</button></div>
    <div style="margin-top:12px;">${starts.map(s => `<div class="md-cyc"><span>${mdFmt(s.start_date)}</span><button type="button" class="link-btn" data-cydel="${s.id}">entfernen</button></div>`).join('') || '<p class="muted">Noch nichts eingetragen.</p>'}</div>
    <p class="hint">Normalerweise tr&auml;gt die Klient:in das selbst im Tagebuch ein. Zyklus-Einnahmen richten sich nach dem letzten eingetragenen Beginn.</p>
    <div class="modal-actions"><button type="button" class="secondary" id="cy_close">Schlie&szlig;en</button></div>`);
  m.el.querySelector('#cy_close').onclick = () => { m.close(); done(); };
  m.el.querySelector('#cy_add').onclick = async () => {
    const { error } = await sb.from('cycle_starts').insert({ patient_id: patient.id, start_date: m.el.querySelector('#cy_date').value });
    if (error && error.code !== '23505') { toast('Fehler: ' + error.message); return; }
    m.close(); toast('Eingetragen.'); done();
  };
  m.el.querySelectorAll('[data-cydel]').forEach(b => { b.onclick = async () => { await sb.from('cycle_starts').delete().eq('id', b.dataset.cydel); m.close(); done(); }; });
}

// ============================================================
// Klient:in: „Meine Unterlagen“
// ============================================================
async function renderMyDocs(profile) {
  const [dc, lv] = await Promise.all([
    sb.from('patient_documents').select('*').eq('patient_id', profile.id).order('created_at', { ascending: false }),
    can(profile, 'labor') ? sb.from('lab_values').select('*').eq('patient_id', profile.id).order('taken_on', { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const docs = dc.data || [], labs = lv.data || [];
  const byName = {};
  labs.forEach(l => { const k = l.name.split(' (')[0].trim().toLowerCase(); (byName[k] = byName[k] || []).push(l); });
  const doc = (d) => `<div class="md-doc"><span class="md-doc-ic">${d.kind === 'plan' ? '&#128203;' : '&#129514;'}</span>
    <div><b>${esc(d.title)}</b><div class="rt-sub">${DOC_KIND[d.kind]}${d.doc_date ? ' &middot; ' + mdFmt(d.doc_date) : ''}</div></div>
    <span class="spacer"></span><button type="button" class="secondary small-btn" data-view="${d.id}">&Ouml;ffnen</button></div>`;
  const plans = docs.filter(d => d.kind === 'plan'), others = docs.filter(d => d.kind !== 'plan');
  const content = `
    ${can(profile, 'therapieplan') ? `<div class="card"><h2>Meine Therapiepl&auml;ne</h2>${plans.map(doc).join('') || '<p class="muted">Noch kein Plan hinterlegt.</p>'}</div>` : ''}
    ${can(profile, 'labor') ? `<div class="card"><div class="tp-head-row"><h2 style="margin:0;">Meine Befunde</h2><span class="spacer"></span>
        ${perm(profile, 'labor') === 'edit' ? '<button type="button" class="small-btn" id="myUp">+ Befund hochladen</button>' : ''}</div>
        ${others.map(doc).join('') || '<p class="muted">Noch keine Befunde.</p>'}</div>
      ${Object.keys(byName).length ? `<div class="card"><h2>Meine Laborwerte</h2><div class="tablewrap"><table class="md-lab"><thead><tr><th>Wert</th><th>Ergebnis</th><th>Ziel</th><th>Einordnung</th></tr></thead><tbody>
        ${Object.values(byName).map(([c, p]) => `<tr><td><b>${esc(c.name)}</b></td><td class="nowrap"><b>${esc(c.value_text || c.value)}</b><div class="rt-sub">${mdFmt(c.taken_on)}${p ? ' &middot; vorher ' + esc(p.value_text || p.value) : ''}</div></td><td>${esc(c.target_range || '')}</td><td>${esc(c.rating || '')}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}` : ''}
    <p class="hint">Deine Unterlagen liegen in einem gesch&uuml;tzten Speicher in der EU. Nur du und die Praxis k&ouml;nnen sie &ouml;ffnen.</p>`;
  renderShell(profile, 'meinebefunde', 'Meine Unterlagen', content);
  appEl.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => mdOpenDoc(b.dataset.view); });
  const up = document.getElementById('myUp');
  if (up) up.onclick = () => mdUploadDialog(profile, profile, () => renderMyDocs(profile), true);
}

// ============================================================
// Klient:in: „Meine Einnahmen“ im Tagebuch
// ============================================================
async function mdLoadMine(profile, from, to) {
  const [mi, ml, cs] = await Promise.all([
    sb.from('med_items').select('*').eq('patient_id', profile.id).order('sort'),
    sb.from('med_logs').select('*').eq('patient_id', profile.id).gte('log_date', from).lte('log_date', to),
    sb.from('cycle_starts').select('*').eq('patient_id', profile.id).order('start_date', { ascending: false }),
  ]);
  return { items: mi.data || [], logs: ml.data || [], starts: cs.data || [] };
}

function mdDayState(data, d) {
  let due = 0, done = 0;
  data.items.forEach(m => { if (mdDue(m, d, data.starts) !== true) return; m.slots.forEach(s => { due++; if (data.logs.some(l => l.med_id === m.id && l.log_date === d && l.slot === s)) done++; }); });
  return due ? (done === due ? 'full' : (done ? 'part' : 'none')) : null;
}

function mdMineHtml(data, date, canEdit) {
  const running = data.items.filter(m => m.active && m.start_date <= date && (!m.end_date || m.end_date >= date));
  const hasCycle = running.some(m => m.schedule === 'zyklus');
  if (!running.length) return '';
  const cd = mdCycleDay(data.starts, date);
  const isStart = data.starts.some(s => s.start_date === date);
  const unknown = running.filter(m => mdDue(m, date, data.starts) === 'unknown');
  const due = running.filter(m => mdDue(m, date, data.starts) === true);
  const notDue = running.filter(m => mdDue(m, date, data.starts) === false);
  const on = (m, s) => data.logs.some(l => l.med_id === m.id && l.log_date === date && l.slot === s);
  let total = 0, done = 0;
  due.forEach(m => m.slots.forEach(s => { total++; if (on(m, s)) done++; }));
  const sections = Object.keys(MD_SLOTS).map(slot => {
    const list = due.filter(m => m.slots.includes(slot));
    if (!list.length) return '';
    return `<div class="rt-tod"><div class="rt-tod-h">${MD_SLOT_ICON[slot]} ${MD_SLOTS[slot]}</div>
      ${list.map(m => `<div class="rt-item md-item${on(m, slot) ? ' on' : ''}" style="--c:#3ebae6">
        <button type="button" class="rt-check" data-mdc="${m.id}" data-slot="${slot}" ${canEdit ? '' : 'disabled'} aria-label="${on(m, slot) ? 'Häkchen entfernen' : 'Abhaken'}">${on(m, slot) ? '&#10003;' : ''}</button>
        <div class="rt-body"><div class="rt-title">${esc(m.name)}${m.dose ? ' <span class="md-dose">' + esc(m.dose) + '</span>' : ''}</div>
          <div class="rt-sub">${esc(mdSchedText(m))}${m.end_date ? ' &middot; bis ' + mdFmt(m.end_date) : ''}</div>
          ${m.note ? `<div class="rt-note">&#128221; ${esc(m.note)}</div>` : ''}</div></div>`).join('')}</div>`;
  }).join('');
  return `<div class="card rt-mine md-mine">
    <div class="tp-head-row"><h2 style="margin:0;">Meine Einnahmen</h2><span class="spacer"></span>
      ${total ? `<span class="rt-count${done === total ? ' ok' : ''}">${done} / ${total}</span>` : ''}</div>
    ${hasCycle ? `<div class="md-cycle">
      <span>&#127800; ${cd ? 'Zyklustag <b>' + cd + '</b>' : 'Zyklustag unbekannt'}</span>
      ${canEdit ? `<button type="button" class="${isStart ? '' : 'secondary '}small-btn" id="mdPeriod">${isStart ? '&#10003; Periode begann an diesem Tag' : 'Periode hat ' + (date === mdISO(new Date()) ? 'heute' : 'an diesem Tag') + ' begonnen'}</button>` : ''}
    </div>${unknown.length ? '<p class="notice">Trag bitte den ersten Tag deiner letzten Periode ein &mdash; dann zeigt dir die App, wann ' + unknown.map(m => esc(m.name)).join(', ') + ' dran ' + (unknown.length > 1 ? 'sind' : 'ist') + '.</p>' : ''}` : ''}
    ${total ? `<div class="tp-bar" style="margin:10px 0 4px;"><span style="width:${Math.round(done / total * 100)}%"></span></div>` : ''}
    ${sections || (unknown.length ? '' : '<p class="muted" style="margin-top:10px;">Heute ist keine Einnahme dran.</p>')}
    ${notDue.length ? `<div class="md-notdue">Heute nicht dran: ${notDue.map(m => { const n = mdNextDue(m, date, data.starts); return esc(m.name) + (n ? ' <span class="muted">(wieder ' + (mdDiff(date, n) === 1 ? 'morgen' : 'am ' + mdFmt(n).slice(0, 6)) + ')</span>' : ''); }).join(' &middot; ')}</div>` : ''}
  </div>`;
}

function mdWireMine(profile, data, date, again) {
  appEl.querySelectorAll('[data-mdc]').forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      const id = b.dataset.mdc, slot = b.dataset.slot;
      const on = data.logs.some(l => l.med_id === id && l.log_date === date && l.slot === slot);
      const { error } = on
        ? await sb.from('med_logs').delete().eq('patient_id', profile.id).eq('med_id', id).eq('log_date', date).eq('slot', slot)
        : await sb.from('med_logs').insert({ patient_id: profile.id, med_id: id, log_date: date, slot });
      if (error) { b.disabled = false; toast('Fehler: ' + error.message); return; }
      again();
    };
  });
  const p = document.getElementById('mdPeriod');
  if (p) p.onclick = async () => {
    const ex = data.starts.find(s => s.start_date === date);
    const { error } = ex ? await sb.from('cycle_starts').delete().eq('id', ex.id)
      : await sb.from('cycle_starts').insert({ patient_id: profile.id, start_date: date });
    if (error) { toast('Fehler: ' + error.message); return; }
    toast(ex ? 'Eintrag entfernt.' : 'Periodenbeginn gespeichert.'); again();
  };
}
