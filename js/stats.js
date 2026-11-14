// Calcoli: volume, massimale stimato, aggregazioni per periodo, abbinamento calendario <-> Watch.
import { MUSCLES } from './muscles.js';

export const DAY = 86400000;

/** Moltiplicatore di carico: manubri "per mano" = x2, esercizi "per lato" = x2 ripetizioni */
export function setVolume(s) {
  if (!s.done || s.unit === 'sec' || !s.weight) return 0;
  return s.reps * s.weight * (s.perHand ? 2 : 1) * (s.perSide ? 2 : 1);
}

/** Massimale stimato (Epley), affidabile fino a ~12 ripetizioni */
export function e1rm(weight, reps) {
  if (!weight || !reps || reps > 15) return null;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

export function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const wd = (x.getDay() + 6) % 7; // lunedì = 0
  return new Date(x.getTime() - wd * DAY);
}
export const startOfMonth = (d) => new Date(new Date(d).getFullYear(), new Date(d).getMonth(), 1);
export function periodRange(kind, ref) {
  if (kind === 'week') { const s = startOfWeek(ref); return [s, new Date(s.getTime() + 7 * DAY)]; }
  const s = startOfMonth(ref); return [s, new Date(s.getFullYear(), s.getMonth() + 1, 1)];
}
export function shiftPeriod(kind, ref, n) {
  const d = new Date(ref);
  if (kind === 'week') return new Date(d.getTime() + n * 7 * DAY);
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
const inRange = (iso, [a, b]) => { const t = new Date(iso).getTime(); return t >= a.getTime() && t < b.getTime(); };

export function sessionVolume(sess) { return sess.sets.reduce((a, s) => a + setVolume(s), 0); }
export const sessionMinutes = (sess) => Math.max(1, Math.round((new Date(sess.end) - new Date(sess.start)) / 60000));

/** Riepilogo per un intervallo [a,b) */
export function summarize(state, range) {
  const sessions = state.sessions.filter((s) => inRange(s.start, range));
  const activities = state.activities.filter((a) => inRange(a.start, range) && !a.gymSessionId);
  const volume = sessions.reduce((a, s) => a + sessionVolume(s), 0);
  const gymMin = sessions.reduce((a, s) => a + sessionMinutes(s), 0);
  const actMin = activities.reduce((a, x) => a + (x.durationMin || 0), 0);
  const byType = { palestra: { count: sessions.length, minutes: gymMin } };
  for (const a of activities) {
    const t = a.type || 'altro';
    byType[t] = byType[t] || { count: 0, minutes: 0 };
    byType[t].count++; byType[t].minutes += a.durationMin || 0;
  }
  const kcal = activities.reduce((a, x) => a + (x.kcal || 0), 0)
    + sessions.reduce((a, s) => a + (s.kcal || 0), 0);
  const days = new Set([...sessions.map((s) => s.start.slice(0, 10)), ...activities.map((a) => a.start.slice(0, 10))]);
  const muscles = muscleBreakdown(state, sessions);
  const doneSets = sessions.reduce((a, s) => a + s.sets.filter((x) => x.done).length, 0);
  return { sessions, activities, volume, gymMin, actMin, totalMin: gymMin + actMin, byType, kcal, activeDays: days.size, muscles, doneSets };
}

/** Volume (kg) e serie per gruppo muscolare. Le serie contano 1 per primario, 0.5 per secondario. */
export function muscleBreakdown(state, sessions) {
  const exById = exerciseIndex(state);
  const res = Object.fromEntries(MUSCLES.map((m) => [m, { volume: 0, sets: 0 }]));
  for (const sess of sessions) for (const s of sess.sets) {
    if (!s.done) continue;
    const m = (exById[s.exerciseId] && exById[s.exerciseId].muscles) || s.muscles || {};
    const v = setVolume(s);
    for (const [k, f] of Object.entries(m)) {
      if (!res[k]) res[k] = { volume: 0, sets: 0 };
      res[k].volume += v * f; res[k].sets += f;
    }
  }
  return res;
}

export function exerciseIndex(state) {
  const idx = {};
  for (const r of state.routines) for (const e of r.exercises) idx[e.id] = { ...e, routine: r.name };
  return idx;
}

/** Storico di un esercizio: per ogni sessione peso usato, miglior e1RM, volume */
export function exerciseHistory(state, exerciseId) {
  const rows = [];
  for (const sess of [...state.sessions].sort((a, b) => a.start.localeCompare(b.start))) {
    const sets = sess.sets.filter((s) => s.exerciseId === exerciseId && s.done);
    if (!sets.length) continue;
    const weight = Math.max(...sets.map((s) => s.weight || 0));
    const best = Math.max(0, ...sets.map((s) => (s.unit === 'sec' ? 0 : e1rm(s.weight, s.reps) || 0)));
    rows.push({ date: sess.start, weight, e1rm: best || null, volume: sets.reduce((a, s) => a + setVolume(s), 0), sets: sets.length });
  }
  return rows;
}

/** Sessioni a settimana per le ultime n settimane (per il grafico frequenza) */
export function weeklySeries(state, n, ref = new Date()) {
  const out = [];
  let s = startOfWeek(ref);
  s = new Date(s.getTime() - (n - 1) * 7 * DAY);
  for (let i = 0; i < n; i++) {
    const r = [new Date(s.getTime() + i * 7 * DAY), new Date(s.getTime() + (i + 1) * 7 * DAY)];
    const sum = summarize(state, r);
    out.push({ start: r[0], gym: sum.sessions.length, other: sum.activities.length, minutes: sum.totalMin, volume: sum.volume });
  }
  return out;
}

// ---------- Abbinamento calendario <-> Apple Watch ----------
const FAMILY = { padel: 'racchetta', tennis: 'racchetta', corsa: 'piedi', camminata: 'piedi' };
const COMPAT = (a, b) => a === b || a === 'altro' || b === 'altro' || (FAMILY[a] && FAMILY[a] === FAMILY[b]);
const TOL = 30 * 60000;
function overlaps(a, b) {
  const as = new Date(a.start).getTime(), ae = new Date(a.end).getTime();
  const bs = new Date(b.start).getTime(), be = new Date(b.end).getTime();
  return as <= be + TOL && bs <= ae + TOL && Math.abs(as - bs) < 3 * 3600000;
}

/**
 * Inserisce/aggiorna un'attività importata. Regole:
 * - stesso extId => aggiorna
 * - un allenamento Watch si fonde con un evento del calendario (o una seduta in palestra)
 *   se si sovrappone (±30 min) e il tipo è compatibile: titolo dal calendario, numeri dal Watch.
 * Ritorna 'new' | 'merged' | 'updated' | 'dup'
 */
export function upsertActivity(state, incoming, uidFn) {
  const acts = state.activities;
  if (incoming.extId) {
    const same = acts.find((a) => a.extIds && a.extIds.includes(incoming.extId));
    if (same) { mergeInto(same, incoming); return 'updated'; }
  }
  // Watch "forza" durante una seduta registrata in app -> arricchisce la seduta
  if (incoming.type === 'palestra') {
    const sess = state.sessions.find((s) => overlaps(s, incoming));
    if (sess) {
      if (incoming.source === 'watch') { sess.kcal = incoming.kcal ?? sess.kcal; sess.avgHr = incoming.avgHr ?? sess.avgHr; sess.watchLinked = true; }
      else sess.calendarLinked = true;
      return 'merged';
    }
  }
  const partner = acts.find((a) => !a.sources.includes(incoming.source) && COMPAT(a.type, incoming.type) && overlaps(a, incoming));
  if (partner) { mergeInto(partner, incoming); return 'merged'; }
  const dup = acts.find((a) => a.sources.includes(incoming.source) && a.type === incoming.type
    && Math.abs(new Date(a.start) - new Date(incoming.start)) < 5 * 60000);
  if (dup) { mergeInto(dup, incoming); return 'dup'; }
  acts.push({ id: uidFn(), ...incoming, sources: [incoming.source], extIds: incoming.extId ? [incoming.extId] : [] });
  return 'new';
}

function mergeInto(a, inc) {
  if (!a.sources.includes(inc.source)) a.sources.push(inc.source);
  if (inc.extId && !a.extIds.includes(inc.extId)) a.extIds.push(inc.extId);
  if (inc.source === 'calendar') {
    a.title = inc.title || a.title;
    a.type = inc.type !== 'altro' ? inc.type : a.type; // il calendario dice cosa hai fatto davvero (es. Padel registrato come Tennis)
    if (!a.sources.includes('watch')) { a.start = inc.start; a.end = inc.end; a.durationMin = inc.durationMin; }
  } else {
    // il Watch ha la misura reale
    a.start = inc.start; a.end = inc.end; a.durationMin = inc.durationMin;
    for (const k of ['kcal', 'distanceKm', 'avgHr']) if (inc[k] != null) a[k] = inc[k];
    if (a.type === 'altro') a.type = inc.type;
    if (!a.title) a.title = inc.title;
  }
}
