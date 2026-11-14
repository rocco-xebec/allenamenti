// Parser per importare schede (testo/tabelle incollate o JSON) e attività (Comandi / JSON).
import { guessMuscles } from './muscles.js';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/^[a-z]\d?\.\s*/, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const num = (s) => parseFloat(String(s).replace(',', '.'));

/** "2–3 min" -> 150, "90 s" -> 90, "75s" -> 75, "2,5 min" -> 150, "—" -> 0 */
export function parseRest(txt) {
  const t = (txt || '').trim().toLowerCase();
  if (!t || /^[-—–]+$/.test(t)) return 0;
  const nums = (t.match(/\d+(?:[.,]\d+)?/g) || []).map(num);
  if (!nums.length) return 0;
  const v = nums.length > 1 ? (nums[0] + nums[1]) / 2 : nums[0];
  return Math.round(/min|'/.test(t) ? v * 60 : v);
}

/** "16 kg per mano" -> {weight:16, perHand:true}; "10 + 10 kg" -> {10, perHand}; "—" -> {null} */
export function parseLoad(txt) {
  const t = (txt || '').trim().toLowerCase();
  if (!t || /^[-—–]+$/.test(t)) return { weight: null, perHand: false };
  const plus = t.match(/(\d+(?:[.,]\d+)?)\s*\+\s*(\d+(?:[.,]\d+)?)/);
  if (plus) return { weight: num(plus[1]), perHand: true };
  const m = t.match(/\d+(?:[.,]\d+)?/);
  return { weight: m ? num(m[0]) : null, perHand: /per mano|manubri|cad/.test(t) };
}

/**
 * "SX 4 × 8 a RIR 2, DX 2 × 8" -> sets [{side:'SX',reps:8}x4, {side:'DX',reps:8}x2], target 'RIR 2'
 * "3 × 10 per lato" -> perSide; "3 × 40 s" -> unit 'sec'
 */
export function parseSets(txt) {
  const t = (txt || '').replace(/(\d)\s*[×xX*]\s*(?=\d)/g, '$1 × ');
  const out = { sets: [], target: '', perSide: /per lato/i.test(t), unit: 'reps' };
  const rir = t.match(/(RIR|RPE)\s*\d+(?:[.,]\d)?/i);
  if (rir) out.target = rir[0].toUpperCase().replace(/\s+/, ' ');
  for (const part of t.split(/[,;]/)) {
    const m = part.match(/(?:\b(SX|DX)\b\s*)?(\d+)\s*×\s*(\d+)\s*(s|sec|secondi|")?/i);
    if (!m) continue;
    const side = m[1] ? m[1].toUpperCase() : null;
    const n = parseInt(m[2], 10), reps = parseInt(m[3], 10);
    if (m[4]) out.unit = 'sec';
    for (let i = 0; i < n; i++) out.sets.push({ side, reps });
  }
  return out;
}

function splitRow(line) {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (line.includes('|')) return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  if (line.includes(';')) return line.split(';').map((c) => c.trim());
  return null;
}

export function exerciseFromCells(cells, headerMap) {
  const get = (k, i) => (headerMap && headerMap[k] != null ? cells[headerMap[k]] : cells[i]) || '';
  const rawName = get('name', 0);
  const g = rawName.match(/^\s*([A-Z]\d?)\.\s*/);
  const name = rawName.replace(/^\s*[A-Z]\d?\.\s*/, '').trim();
  const s = parseSets(get('sets', 1));
  const load = parseLoad(get('load', 4));
  let notes = get('notes', 2).trim();
  if (/^[-—–]$/.test(notes)) notes = '';
  return {
    id: uid(), name, group: g ? g[1] : '', sets: s.sets, unit: s.unit, perSide: s.perSide, target: s.target,
    notes, restSec: parseRest(get('rest', 3)), weight: load.weight, perHand: load.perHand,
    muscles: guessMuscles(name),
  };
}

const HEADERS = { name: /esercizio/, sets: /serie|set/, notes: /esecuzione|note/, rest: /recupero|rest/, load: /carico|peso/ };

/** Testo incollato (da doc, Excel, Numbers, Markdown) -> [routine] */
export function parseRoutinesText(text) {
  const routines = [];
  let cur = null, headerMap = null, mode = 'none', sharedWarmup = [];
  const lines = text.replace(/\r/g, '').split('\n');
  for (let raw of lines) {
    const line = raw.trim();
    if (!line || /^\|?\s*:?-{3,}/.test(line)) continue;
    const cells = splitRow(line);
    const head = line.replace(/^#+\s*/, '');
    if (!cells && /^scheda\b/i.test(head)) {
      cur = { id: uid(), name: head.replace(/\s*[:—-].*$/, '').trim(), subtitle: (head.match(/[:—-]\s*(.*)$/) || [])[1] || '', warmup: [], exercises: [], notes: '' };
      routines.push(cur); headerMap = null; mode = 'none'; continue;
    }
    if (!cells && /^\**riscaldamento/i.test(head)) { mode = 'warmup'; continue; }
    if (!cells && /^\**organizzazione/i.test(head)) { mode = 'ignore'; continue; }
    if (!cells && /^\**(finisher|note)/i.test(head)) {
      mode = 'notes';
      if (cur && /finisher/i.test(head)) cur.notes += (cur.notes ? '\n' : '') + head.replace(/\*\*/g, '');
      continue;
    }
    if (cells && cells.length >= 3) {
      const low = cells.map((c) => c.toLowerCase());
      if (low.some((c) => HEADERS.name.test(c))) {
        headerMap = {};
        for (const [k, re] of Object.entries(HEADERS)) { const i = low.findIndex((c) => re.test(c)); if (i >= 0) headerMap[k] = i; }
        continue;
      }
      if (!cur) { cur = { id: uid(), name: 'Scheda importata', subtitle: '', warmup: [], exercises: [], notes: '' }; routines.push(cur); }
      cur.exercises.push(exerciseFromCells(cells, headerMap));
      mode = 'table';
      continue;
    }
    if (mode === 'warmup') {
      const item = line.replace(/^(\d+[.)]|[-*•])\s*/, '').trim();
      if (cur) cur.warmup.push(item); else sharedWarmup.push(item);
    } else if (mode === 'notes' && cur) {
      cur.notes += (cur.notes ? '\n' : '') + line;
    }
  }
  for (const r of routines) if (!r.warmup.length && sharedWarmup.length) r.warmup = [...sharedWarmup];
  return routines.filter((r) => r.exercises.length);
}

// ---------- Attività (Apple Watch via Comandi / JSON di app esportatrici / calendario) ----------

const TYPE_WORDS = [
  ['padel', /padel/], ['tennis', /tennis/], ['corsa', /corsa|running|run\b|jog/],
  ['camminata', /cammin|walk|hiking|escurs/], ['bici', /bici|cycl|bike|cicl/], ['nuoto', /nuoto|swim/],
  ['palestra', /palestra|gym|forza|strength|pesi|weight|functional|funzional|core/],
];
export function typeFromText(t, keywords) {
  const s = norm(t);
  if (keywords) for (const [type, words] of Object.entries(keywords)) if (words.some((w) => w && s.includes(norm(w)))) return type;
  for (const [type, re] of TYPE_WORDS) if (re.test(s)) return type;
  return 'altro';
}

function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
  let s = String(v).trim();
  // "14 nov 2026, 18:30" / "14/11/2026 18:30"
  const it = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})[ ,T]+(\d{1,2})[:.](\d{2})/);
  if (it) return new Date(+(it[3].length === 2 ? '20' + it[3] : it[3]), +it[2] - 1, +it[1], +it[4], +it[5]);
  const mesi = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const tm = s.toLowerCase().match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})[, ]+(?:alle\s+|ore\s+)?(\d{1,2})[:.](\d{2})/);
  if (tm && mesi.indexOf(tm[2]) >= 0) return new Date(+tm[3], mesi.indexOf(tm[2]), +tm[1], +tm[4], +tm[5]);
  s = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
const numOrNull = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object') v = v.qty ?? v.value ?? v.quantity;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : n;
};
const pick = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return null; };

function durationMin(v) {
  if (v == null) return null;
  if (typeof v === 'object') v = v.qty ?? v.value;
  const s = String(v);
  const hms = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (hms) return hms[3] != null ? +hms[1] * 60 + +hms[2] + +hms[3] / 60 : +hms[1] + +hms[2] / 60;
  const n = numOrNull(s);
  if (n == null) return null;
  if (/h|ora/.test(s) && !/min/.test(s)) return n * 60;
  if (/min/.test(s)) return n;
  return n > 600 ? n / 60 : n; // secondi oppure minuti
}

function normalizeActivity(o, defaultSource) {
  const source = /cal/i.test(o.source || o.fonte || '') ? 'calendar' : (defaultSource || 'watch');
  const title = pick(o, ['title', 'titolo', 'name', 'nome', 'workoutActivityType', 'activityType', 'type', 'tipo']) || '';
  const start = parseDate(pick(o, ['start', 'startDate', 'inizio', 'start_date', 'startTime']));
  let end = parseDate(pick(o, ['end', 'endDate', 'fine', 'end_date', 'endTime']));
  let dur = durationMin(pick(o, ['duration', 'durata', 'durationMin', 'duration_min']));
  if (!start) return null;
  if (!end && dur) end = new Date(start.getTime() + dur * 60000);
  if (!dur && end) dur = (end - start) / 60000;
  if (!end) end = new Date(start.getTime() + 60 * 60000), dur = 60;
  let km = numOrNull(pick(o, ['distance', 'distanza', 'km', 'distanceKm', 'totalDistance']));
  if (km != null && km > 300) km = km / 1000; // metri
  return {
    source, title: String(title).replace(/^HKWorkoutActivityType/, ''),
    type: typeFromText(pick(o, ['tipo', 'type', 'workoutActivityType', 'name', 'title']) || title),
    start: start.toISOString(), end: end.toISOString(), durationMin: Math.round(dur),
    kcal: numOrNull(pick(o, ['kcal', 'calories', 'activeEnergy', 'activeEnergyBurned', 'energia', 'energy', 'totalEnergyBurned'])),
    distanceKm: km, avgHr: numOrNull(pick(o, ['avgHr', 'heartRate', 'fc', 'avgHeartRate', 'heartRateAvg', 'hr'])),
  };
}

/**
 * Accetta:
 *  - JSON: array di oggetti, oppure {workouts:[...]} / {data:{workouts:[...]}}
 *  - Testo dal Comando: una riga per attività, campi separati da ";" o "|":
 *      fonte;tipo;inizio;fine;durata_min;kcal;km;fc   (fonte = W per Watch, C per calendario)
 */
export function parseActivitiesText(text) {
  const t = text.trim();
  if (/^[[{]/.test(t)) {
    try {
      let data = JSON.parse(t);
      if (!Array.isArray(data)) data = data.workouts || data.data?.workouts || data.attivita || data.activities || [data];
      return data.map((o) => normalizeActivity(o)).filter(Boolean);
    } catch (e) { /* passa al formato riga */ }
  }
  const out = [];
  for (const line of t.split(/\r?\n/)) {
    const c = line.split(/[;|]/).map((x) => x.trim());
    if (c.length < 3 || /^fonte$/i.test(c[0])) continue;
    let [src, tipo, inizio, fine, durata, kcal, km, fc] = c;
    if (!/^(w|c|watch|cal|calendario)$/i.test(src)) { [tipo, inizio, fine, durata, kcal, km, fc] = c; src = 'W'; }
    const a = normalizeActivity({ source: /^c/i.test(src) ? 'calendar' : 'watch', tipo, inizio, fine, durata, kcal, km, fc }, /^c/i.test(src) ? 'calendar' : 'watch');
    if (a) out.push(a);
  }
  return out;
}
