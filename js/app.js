import * as db from './db.js';
import { parseRoutinesText, parseActivitiesText, parseSets, typeFromText, uid, norm } from './parse.js';
import { MUSCLES, guessMuscles } from './muscles.js';
import { SEED_TEXT, DEFAULT_SETTINGS, TYPE_LABEL, TYPE_ICON } from './data.js';
import * as S from './stats.js';
import * as gcal from './gcal.js';
import { exportReportPdf } from './pdf.js';

const $app = document.getElementById('app');
let state;
let charts = [];
let restTick = null;
let wakeLock = null;
let audioCtx = null;

// ---------------- helpers ----------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dec = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('it-IT');
export const fmtKg = (v) => (v == null ? '—' : dec(v) + ' kg');
const fmtInt = (v) => Math.round(v || 0).toLocaleString('it-IT');
const fmtMin = (m) => { m = Math.round(m || 0); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
const fmtDate = (d, o = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(d).toLocaleDateString('it-IT', o);
const fmtTime = (d) => new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const dayKey = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
function relDays(d) {
  if (!d) return 'mai';
  const n = Math.round((startOfDay(new Date()) - startOfDay(new Date(d))) / S.DAY);
  return n <= 0 ? 'oggi' : n === 1 ? 'ieri' : n + ' giorni fa';
}
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
const save = () => db.save(state);
function toast(msg, ms = 2200) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
const routine = (id) => state.routines.find((r) => r.id === id);
const exIndex = () => S.exerciseIndex(state);

export function setsText(ex) {
  const parts = [];
  for (const s of ex.sets) {
    const last = parts[parts.length - 1];
    if (last && last.side === s.side && last.reps === s.reps) last.n++;
    else parts.push({ side: s.side, reps: s.reps, n: 1 });
  }
  let t = parts.map((p) => (p.side ? p.side + ' ' : '') + p.n + ' × ' + p.reps + (ex.unit === 'sec' ? ' s' : '')).join(', ');
  if (ex.perSide) t += ' per lato';
  return t || '—';
}
const restText = (s) => (!s ? 'nessuno' : s % 60 === 0 ? s / 60 + ' min' : s > 60 ? dec(s / 60) + ' min' : s + ' s');
const loadText = (ex) => (ex.weight == null ? 'corpo libero' : fmtKg(ex.weight) + (ex.perHand ? ' per mano' : ''));

// ---------------- state ----------------
function freshState() {
  return { version: 1, routines: parseRoutinesText(SEED_TEXT), sessions: [], activities: [], weightLog: [], current: null, settings: structuredClone(DEFAULT_SETTINGS) };
}
async function init() {
  state = (await db.load()) || freshState();
  state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...state.settings };
  for (const k of ['sessions', 'activities', 'weightLog', 'routines']) state[k] = state[k] || [];
  save();
  db.requestPersist();
  window.addEventListener('hashchange', render);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  setupLongPress();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.current) { acquireWake(); render(); } });
  if (!location.hash) location.hash = state.current ? '#/allena' : '#/oggi';
  render();
  if (location.hash === '#/attivita/auto') setTimeout(watchImportSheet, 50);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ---------------- router ----------------
const TABS = [
  ['oggi', '🏠', 'Oggi'], ['schede', '📋', 'Schede'], ['attivita', '📅', 'Attività'], ['report', '📈', 'Report'], ['impostazioni', '⚙️', 'Altro'],
];
function render() {
  charts.forEach((c) => c.destroy()); charts = [];
  const [, route, a, b] = (location.hash || '#/oggi').split('/');
  const views = { oggi: viewToday, allena: viewWorkout, schede: viewRoutines, scheda: viewRoutine, attivita: viewActivities,
    report: viewReport, seduta: viewSession, impostazioni: viewSettings, guida: viewGuide };
  const v = views[route] || viewToday;
  const after = [];
  $app.innerHTML = v(a, b, after) + tabbar(route);
  after.forEach((f) => f());
  renderRestBar();
  window.scrollTo(0, window.__keepScroll ? window.scrollY : 0);
}
function rerender() { const y = window.scrollY; render(); window.scrollTo(0, y); }
function tabbar(route) {
  const active = { allena: 'oggi', scheda: 'schede', seduta: 'attivita', guida: 'impostazioni' }[route] || route;
  return `<nav class="tabbar"><div class="inner">${TABS.map(([k, ic, l]) =>
    `<a href="#/${k}" class="${active === k ? 'on' : ''}"><span class="ic">${ic}</span>${l}</a>`).join('')}</div></nav>`;
}

// ---------------- OGGI ----------------
function viewToday() {
  const now = new Date();
  const wk = S.summarize(state, S.periodRange('week', now));
  const prevWk = S.summarize(state, S.periodRange('week', S.shiftPeriod('week', now, -1)));
  const lastDone = {};
  for (const s of state.sessions) if (!lastDone[s.routineId] || s.start > lastDone[s.routineId]) lastDone[s.routineId] = s.start;
  const next = [...state.routines].sort((a, b) => (lastDone[a.id] || '').localeCompare(lastDone[b.id] || ''))[0];
  const backupDays = state.settings.lastBackup ? (Date.now() - new Date(state.settings.lastBackup)) / S.DAY : Infinity;
  const hasData = state.sessions.length || state.activities.length;
  let h = `<h1>${esc(fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long' }))}</h1>`;
  if (state.current) {
    const r = routine(state.current.routineId);
    h += `<div class="card tap" data-a="go" data-href="#/allena" style="border-color:var(--good)">
      <div class="row between"><div><h3>Allenamento in corso</h3><div class="muted small">${esc(r ? r.name : '')} · iniziato alle ${fmtTime(state.current.start)}</div></div>
      <span class="btn good sm">Riprendi</span></div></div>`;
  }
  if (hasData && backupDays > 7) {
    h += `<div class="banner row between"><span>${state.settings.lastBackup ? 'Ultimo backup ' + relDays(state.settings.lastBackup) : 'Non hai ancora fatto un backup'}. Salvalo su iCloud Drive.</span>
      <button class="btn sm primary" data-a="backup">Backup</button></div>`;
  }
  h += `<h2>Questa settimana</h2>
  <div class="kpis">
    ${kpi('Sedute palestra', wk.sessions.length, prevWk.sessions.length)}
    ${kpi('Minuti attivi', fmtInt(wk.totalMin), prevWk.totalMin, wk.totalMin)}
    ${kpi('Volume', fmtInt(wk.volume) + ' kg', prevWk.volume, wk.volume)}
    ${kpi('Giorni attivi', wk.activeDays + '/7', prevWk.activeDays, wk.activeDays)}
  </div>`;
  h += `<h2>Allenati</h2>`;
  for (const r of state.routines) {
    const isNext = next && r.id === next.id && !state.current;
    h += `<div class="card"><div class="row between">
      <div class="grow"><h3>${esc(r.name)} ${isNext ? '<span class="chip accent">consigliata</span>' : ''}</h3>
      <div class="muted small">${r.exercises.length} esercizi · ultima: ${relDays(lastDone[r.id])}</div></div>
      <button class="btn ${isNext ? 'primary' : ''}" data-a="start" data-id="${r.id}" ${state.current ? 'disabled' : ''}>Inizia</button></div></div>`;
  }
  const items = activityFeed(S.periodRange('week', now));
  h += `<h2>Attività della settimana</h2><div class="card">${items.length ? items.map(feedItem).join('') : '<div class="empty">Nessuna attività registrata</div>'}</div>
  <div class="btn-row"><button class="btn" data-a="gsync">📅 Sincronizza calendario</button><button class="btn" data-a="watch-import">⌚ Importa Watch</button></div>`;
  return h;
}
function kpi(label, value, prev, cur) {
  const c = cur ?? (typeof value === 'number' ? value : null);
  let d = '';
  if (c != null && prev != null) {
    const diff = c - prev;
    d = prev === 0 && c === 0 ? '<div class="d">come la precedente</div>'
      : `<div class="d ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${diff === 0 ? 'uguale' : (prev ? Math.round(Math.abs(diff) / prev * 100) + '%' : 'nuovo')} vs precedente</div>`;
  }
  return `<div class="kpi"><div class="l">${label}</div><div class="v">${value}</div>${d}</div>`;
}
function activityFeed(range) {
  const t0 = range[0].getTime(), t1 = range[1].getTime();
  const inR = (iso) => { const t = new Date(iso).getTime(); return t >= t0 && t < t1; };
  const items = [
    ...state.sessions.filter((s) => inR(s.start)).map((s) => ({ kind: 'gym', start: s.start, s })),
    ...state.activities.filter((a) => inR(a.start)).map((a) => ({ kind: 'act', start: a.start, a })),
  ];
  return items.sort((a, b) => b.start.localeCompare(a.start));
}
function feedItem(it) {
  if (it.kind === 'gym') {
    const s = it.s;
    return `<div class="list-item tap" data-a="go" data-href="#/seduta/${s.id}"><span style="font-size:24px">🏋️</span>
      <div class="grow"><div><b>${esc(s.routineName)}</b></div><div class="small muted">${fmtDate(s.start)} · ${fmtTime(s.start)} · ${fmtMin(S.sessionMinutes(s))} · ${fmtInt(S.sessionVolume(s))} kg</div></div>
      <span class="src">${s.watchLinked ? '⌚ ' : ''}app</span></div>`;
  }
  const a = it.a;
  const extra = [a.kcal ? fmtInt(a.kcal) + ' kcal' : '', a.distanceKm ? dec(a.distanceKm) + ' km' : '', a.avgHr ? Math.round(a.avgHr) + ' bpm' : ''].filter(Boolean).join(' · ');
  return `<div class="list-item tap" data-a="act-edit" data-id="${a.id}"><span style="font-size:24px">${TYPE_ICON[a.type] || '⚡'}</span>
    <div class="grow"><div><b>${esc(a.title || TYPE_LABEL[a.type] || a.type)}</b></div>
    <div class="small muted">${fmtDate(a.start)} · ${fmtTime(a.start)} · ${fmtMin(a.durationMin)}${extra ? ' · ' + extra : ''}</div></div>
    <span class="src">${a.sources.map((x) => (x === 'calendar' ? '📅' : x === 'watch' ? '⌚' : '✍️')).join(' ')}</span></div>`;
}

// ---------------- ALLENAMENTO ----------------
function startWorkout(id) {
  const r = routine(id);
  state.current = {
    routineId: id, start: new Date().toISOString(), warmDone: [], note: '', restUntil: null, restTotal: 0, restLabel: '',
    sets: Object.fromEntries(r.exercises.map((e) => [e.id, e.sets.map((s) => ({ side: s.side, reps: s.reps, done: false, weight: null }))])),
  };
  save(); acquireWake(); unlockAudio();
  location.hash = '#/allena';
}
function viewWorkout() {
  const c = state.current;
  if (!c) return `<div class="empty">Nessun allenamento in corso.<br><br><a class="btn primary" href="#/oggi">Torna a Oggi</a></div>`;
  const r = routine(c.routineId);
  if (!r) { state.current = null; save(); return viewToday(); }
  let total = 0, done = 0;
  for (const e of r.exercises) { const ss = c.sets[e.id] || []; total += ss.length; done += ss.filter((x) => x.done).length; }
  const mins = Math.round((Date.now() - new Date(c.start)) / 60000);
  let h = `<div class="topbar"><button class="back" data-a="go" data-href="#/oggi">‹ Oggi</button><span class="muted small num">${mins} min · ${done}/${total} serie</span></div>
  <h1>${esc(r.name)}</h1>
  <div class="progress"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>`;
  if (r.warmup && r.warmup.length) {
    const allWarm = c.warmDone.length >= r.warmup.length;
    h += `<details class="card" ${allWarm || done ? '' : 'open'}><summary>Riscaldamento ${allWarm ? '✓' : `(${c.warmDone.length}/${r.warmup.length})`}</summary>
      <div style="margin-top:8px">${r.warmup.map((w, i) => `<label class="check"><input type="checkbox" data-c="warm" data-i="${i}" ${c.warmDone.includes(i) ? 'checked' : ''}><span>${esc(w)}</span></label>`).join('')}</div></details>`;
  }
  let lastLetter = null;
  r.exercises.forEach((e, i) => {
    const letter = e.group ? e.group[0] : null;
    const isSuper = e.group && /\d/.test(e.group) && r.exercises.filter((x) => x.group && x.group[0] === letter).length > 1;
    if (isSuper && letter !== lastLetter) h += `<div class="superset-label">Superserie ${letter}</div>`;
    lastLetter = isSuper ? letter : null;
    h += exerciseCard(r, e, i);
  });
  if (r.notes) h += `<div class="card small muted" style="white-space:pre-line">${esc(r.notes)}</div>`;
  h += `<label class="field"><span>Note della seduta</span><textarea data-c="sess-note" style="min-height:70px;font-family:inherit;font-size:15px" placeholder="Come è andata?">${esc(c.note)}</textarea></label>
  <div class="stack"><button class="btn good block" data-a="finish">Termina allenamento</button>
  <button class="btn danger block" data-a="discard">Annulla seduta</button></div>`;
  return h;
}
function exerciseCard(r, e, i) {
  const ss = state.current.sets[e.id] || [];
  const allDone = ss.length && ss.every((x) => x.done);
  const meta = [setsText(e), e.target, 'recupero ' + restText(e.restSec)].filter(Boolean).join(' · ');
  const nextInGroup = e.group && /\d/.test(e.group) && !e.restSec ? r.exercises[i + 1] : null;
  const unitLbl = e.unit === 'sec' ? 's' : '';
  const sets = ss.map((s, k) => `<div class="set ${s.done ? 'on' : ''}" data-a="set" data-lp="reps" data-e="${e.id}" data-k="${k}">
      <span class="r">${s.reps}${unitLbl}</span><span class="s">${s.side || (e.perSide ? 'per lato' : 'serie ' + (k + 1))}</span></div>`).join('');
  return `<div class="card ex ${allDone ? 'done' : ''}" id="ex-${e.id}">
    <div class="head"><div class="badge">${esc(e.group || i + 1)}</div>
      <div class="grow"><div class="name">${esc(e.name)}</div><div class="meta">${esc(meta)}</div></div>
      <button class="btn ghost sm" data-a="ex-edit" data-r="${r.id}" data-e="${e.id}" aria-label="Modifica">✎</button></div>
    ${e.notes ? `<div class="note">${esc(e.notes)}</div>` : ''}
    ${e.weight != null ? `<div class="weight">
      <button class="pm" data-a="w-step" data-e="${e.id}" data-d="-1" aria-label="Diminuisci">−</button>
      <button class="val" data-a="w-set" data-e="${e.id}">${dec(e.weight)} <small>kg${e.perHand ? ' per mano' : ''}</small></button>
      <button class="pm" data-a="w-step" data-e="${e.id}" data-d="1" aria-label="Aumenta">+</button></div>`
      : `<div class="tiny" style="margin-top:8px">Corpo libero · <a href="#" data-a="w-set" data-e="${e.id}">aggiungi carico</a></div>`}
    <div class="sets">${sets}</div>
    ${nextInGroup ? `<div class="tiny" style="margin-top:8px">Senza recupero → passa a ${esc(nextInGroup.group)}. ${esc(nextInGroup.name)}</div>` : ''}
    <div class="tiny" style="margin-top:6px">Tieni premuto una serie per cambiare le ripetizioni fatte.</div>
  </div>`;
}
function findEx(eid) { for (const r of state.routines) { const e = r.exercises.find((x) => x.id === eid); if (e) return [r, e]; } return [null, null]; }

function changeWeight(eid, newW) {
  const [, e] = findEx(eid);
  if (!e) return;
  newW = newW == null || isNaN(newW) ? null : Math.max(0, Math.round(newW * 100) / 100);
  const from = e.weight;
  if (from === newW) return;
  e.weight = newW;
  const today = dayKey(new Date());
  const last = [...state.weightLog].reverse().find((w) => w.exerciseId === eid);
  if (last && dayKey(last.date) === today) {
    last.to = newW; last.date = new Date().toISOString();
    if (last.from === last.to) state.weightLog.splice(state.weightLog.indexOf(last), 1);
  } else state.weightLog.push({ exerciseId: eid, name: e.name, date: new Date().toISOString(), from, to: newW });
  save();
}
function toggleSet(eid, k) {
  const c = state.current; const [r, e] = findEx(eid);
  const s = c.sets[eid][k];
  s.done = !s.done;
  s.weight = s.done ? e.weight : null;
  if (s.done) {
    unlockAudio();
    const ss = c.sets[eid];
    const idx = r.exercises.indexOf(e);
    const groupNext = e.group && /\d/.test(e.group) ? r.exercises[idx + 1] : null;
    if (e.restSec > 0) {
      let nextLbl = ss.find((x) => !x.done) ? e.name : (r.exercises.slice(idx + 1).find((x) => (c.sets[x.id] || []).some((y) => !y.done)) || {}).name;
      if (groupNext && groupNext.group && groupNext.group[0] === e.group[0] && e.group[1] > groupNext.group[1]) nextLbl = groupNext.name;
      const prevGroup = r.exercises.find((x) => x.group && e.group && x.group[0] === e.group[0] && x !== e);
      if (prevGroup && prevGroup.restSec === 0 && (c.sets[prevGroup.id] || []).some((y) => !y.done)) nextLbl = prevGroup.name;
      c.restUntil = Date.now() + e.restSec * 1000; c.restTotal = e.restSec; c.restLabel = nextLbl ? 'Prossimo: ' + nextLbl : 'Ultima serie fatta!'; c.restBeeped = false;
    } else if (groupNext) {
      c.restUntil = null;
      toast('→ ' + groupNext.name);
    }
  }
  save(); rerender();
}
function finishWorkout() {
  const c = state.current; const r = routine(c.routineId);
  const sets = [];
  for (const e of r.exercises) (c.sets[e.id] || []).forEach((s, k) => sets.push({
    exerciseId: e.id, exerciseName: e.name, idx: k, side: s.side, reps: s.reps, weight: s.done ? s.weight : e.weight,
    perHand: !!e.perHand, perSide: !!e.perSide, unit: e.unit || 'reps', done: s.done, muscles: e.muscles,
  }));
  if (!sets.some((s) => s.done)) { if (!confirm('Nessuna serie spuntata. Vuoi annullare la seduta?')) return; state.current = null; save(); releaseWake(); location.hash = '#/oggi'; return; }
  const sess = { id: uid(), routineId: r.id, routineName: r.name, start: c.start, end: new Date().toISOString(), sets, note: c.note, warmDone: c.warmDone.length };
  state.sessions.push(sess);
  // un allenamento Watch o un evento "palestra" già importati e sovrapposti vengono collegati alla seduta
  for (const a of [...state.activities]) if (a.type === 'palestra' && overlapsSess(a, sess)) {
    if (a.sources.includes('watch')) { sess.kcal = a.kcal; sess.avgHr = a.avgHr; sess.watchLinked = true; }
    state.activities.splice(state.activities.indexOf(a), 1);
  }
  state.current = null; save(); releaseWake();
  toast('Seduta salvata 💪');
  location.hash = '#/seduta/' + sess.id;
}
const overlapsSess = (a, s) => new Date(a.start) <= new Date(new Date(s.end).getTime() + 1800000) && new Date(a.end) >= new Date(new Date(s.start).getTime() - 1800000);

// Timer di recupero
function renderRestBar() {
  document.querySelector('.restbar')?.remove();
  clearInterval(restTick);
  const c = state.current;
  if (!c || !c.restUntil) return;
  const bar = document.createElement('div'); bar.className = 'restbar';
  bar.innerHTML = `<div class="in"><span class="t num"></span><span class="lbl">${esc(c.restLabel)}</span>
    <button data-a="rest-add">+15s</button><button data-a="rest-skip">✕</button></div>`;
  document.body.appendChild(bar);
  const tick = () => {
    const left = Math.round((c.restUntil - Date.now()) / 1000);
    const t = bar.querySelector('.t');
    if (left <= 0) {
      bar.classList.add('over'); t.textContent = 'Via!';
      if (!c.restBeeped) { c.restBeeped = true; beep(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
      if (left < -20) { c.restUntil = null; save(); bar.remove(); clearInterval(restTick); }
    } else t.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  };
  tick(); restTick = setInterval(tick, 250);
}
function unlockAudio() {
  try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch {}
}
function beep() {
  try {
    unlockAudio();
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = i === 2 ? 1320 : 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.18);
      o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.2);
    });
  } catch {}
}
async function acquireWake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch {} }
function releaseWake() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

// ---------------- SEDUTA (dettaglio) ----------------
function viewSession(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return `<div class="empty">Seduta non trovata</div>`;
  const byEx = [];
  for (const x of s.sets) { let g = byEx.find((b) => b.id === x.exerciseId); if (!g) byEx.push(g = { id: x.exerciseId, name: x.exerciseName, sets: [] }); g.sets.push(x); }
  let h = `<div class="topbar"><button class="back" data-a="back">‹ Indietro</button></div>
  <h1>${esc(s.routineName)}</h1><p class="muted">${fmtDate(s.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${fmtTime(s.start)}–${fmtTime(s.end)}</p>
  <div class="kpis">${kpi('Durata', fmtMin(S.sessionMinutes(s)))}${kpi('Volume', fmtInt(S.sessionVolume(s)) + ' kg')}
  ${kpi('Serie fatte', s.sets.filter((x) => x.done).length + '/' + s.sets.length)}${kpi(s.kcal ? 'Kcal (Watch)' : 'Kcal', s.kcal ? fmtInt(s.kcal) : '—')}</div>
  <div class="card"><table class="t"><tr><th>Esercizio</th><th>Serie</th><th class="r">Carico</th><th class="r">e1RM</th></tr>`;
  for (const g of byEx) {
    const done = g.sets.filter((x) => x.done);
    const best = Math.max(0, ...done.map((x) => (x.unit === 'sec' ? 0 : S.e1rm(x.weight, x.reps) || 0)));
    h += `<tr><td>${esc(g.name)}</td><td class="num">${g.sets.map((x) => (x.done ? '' : '<s class="muted">') + x.reps + (x.done ? '' : '</s>')).join(' · ')}</td>
      <td class="r">${g.sets[0].weight != null ? fmtKg(g.sets[0].weight) : '—'}</td><td class="r">${best ? dec(best, 0) : '—'}</td></tr>`;
  }
  h += `</table></div>${s.note ? `<div class="card"><b>Note</b><p class="muted" style="white-space:pre-line">${esc(s.note)}</p></div>` : ''}
  <label class="field"><span>Data e ora inizio</span><input type="datetime-local" data-c="sess-start" data-id="${s.id}" value="${toLocalInput(s.start)}"></label>
  <button class="btn danger block" data-a="sess-del" data-id="${s.id}">Elimina seduta</button>`;
  return h;
}
const toLocalInput = (iso) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

// ---------------- SCHEDE ----------------
function viewRoutines() {
  let h = `<h1>Schede</h1>`;
  for (const r of state.routines) {
    h += `<div class="card tap" data-a="go" data-href="#/scheda/${r.id}"><div class="row between"><div class="grow">
      <h3>${esc(r.name)}</h3><div class="small muted">${esc(r.subtitle || '')}${r.subtitle ? ' · ' : ''}${r.exercises.length} esercizi</div>
      <div class="tiny" style="margin-top:4px">${r.exercises.map((e) => esc(e.name)).join(' · ')}</div></div><span class="muted">›</span></div></div>`;
  }
  h += `<div class="stack"><button class="btn primary block" data-a="import-routines">Importa schede</button>
  <button class="btn block" data-a="new-routine">Nuova scheda vuota</button></div>`;
  return h;
}
function viewRoutine(id) {
  const r = routine(id);
  if (!r) return `<div class="empty">Scheda non trovata</div>`;
  let h = `<div class="topbar"><button class="back" data-a="go" data-href="#/schede">‹ Schede</button>
    <button class="btn primary sm" data-a="start" data-id="${r.id}" ${state.current ? 'disabled' : ''}>Inizia</button></div>
  <label class="field"><span>Nome</span><input type="text" data-c="r-name" data-id="${r.id}" value="${esc(r.name)}"></label>
  <label class="field"><span>Sottotitolo</span><input type="text" data-c="r-sub" data-id="${r.id}" value="${esc(r.subtitle || '')}"></label>
  <label class="field"><span>Riscaldamento (una voce per riga)</span><textarea data-c="r-warm" data-id="${r.id}" style="font-family:inherit;font-size:15px;min-height:90px">${esc((r.warmup || []).join('\n'))}</textarea></label>
  <h2>Esercizi</h2>`;
  r.exercises.forEach((e, i) => {
    h += `<div class="card"><div class="row"><div class="badge" style="width:30px;height:30px;border-radius:8px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-weight:700;font-size:13px">${esc(e.group || i + 1)}</div>
      <div class="grow tap" data-a="ex-edit" data-r="${r.id}" data-e="${e.id}"><b>${esc(e.name)}</b>
      <div class="small muted">${esc(setsText(e))}${e.target ? ' · ' + esc(e.target) : ''} · ${esc(loadText(e))} · rec. ${restText(e.restSec)}</div>
      <div class="tiny">${Object.entries(e.muscles || {}).sort((a, b) => b[1] - a[1]).map(([m, f]) => (f >= 1 ? m : m + ' ½')).join(', ') || 'muscoli non impostati'}</div></div>
      <div style="display:flex;flex-direction:column"><button class="btn ghost sm" data-a="ex-move" data-r="${r.id}" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'}>▲</button>
      <button class="btn ghost sm" data-a="ex-move" data-r="${r.id}" data-i="${i}" data-d="1" ${i < r.exercises.length - 1 ? '' : 'disabled'}>▼</button></div></div></div>`;
  });
  h += `<div class="stack"><button class="btn block" data-a="ex-new" data-r="${r.id}">+ Aggiungi esercizio</button>
  <label class="field" style="margin-top:16px"><span>Note della scheda</span><textarea data-c="r-notes" data-id="${r.id}" style="font-family:inherit;font-size:15px;min-height:70px">${esc(r.notes || '')}</textarea></label>
  <button class="btn block" data-a="r-export" data-id="${r.id}">Esporta scheda (testo)</button>
  <button class="btn danger block" data-a="r-del" data-id="${r.id}">Elimina scheda</button></div>`;
  return h;
}
function exerciseSheet(rid, eid) {
  const r = routine(rid);
  const e = r.exercises.find((x) => x.id === eid) || { id: '', name: '', group: '', sets: [{ side: null, reps: 10 }, { side: null, reps: 10 }, { side: null, reps: 10 }], unit: 'reps', perSide: false, target: '', notes: '', restSec: 90, weight: null, perHand: false, muscles: {} };
  const musc = { ...(e.muscles || {}) };
  const setsStr = setsText({ ...e, perSide: false }).replace(/ s(,|$)/g, '$1');
  sheet(`<h2 style="margin-top:0">${e.id ? 'Modifica esercizio' : 'Nuovo esercizio'}</h2>
  <form id="exform">
    <label class="field"><span>Nome</span><input type="text" name="name" value="${esc(e.name)}" required></label>
    <div class="row"><label class="field" style="width:90px"><span>Gruppo</span><input type="text" name="group" value="${esc(e.group)}" placeholder="A1"></label>
    <label class="field grow"><span>Serie × ripetizioni</span><input type="text" name="sets" value="${esc(setsStr)}" placeholder="3 × 10  oppure  SX 4 × 8, DX 2 × 8"></label></div>
    <div class="row"><label class="field grow"><span>Carico (kg, vuoto = corpo libero)</span><input type="number" step="0.5" inputmode="decimal" name="weight" value="${e.weight ?? ''}"></label>
    <label class="field grow"><span>Recupero (secondi)</span><input type="number" inputmode="numeric" name="rest" value="${e.restSec || 0}"></label></div>
    <div class="row wrap" style="margin-bottom:12px;gap:16px">
      <label class="check"><input type="checkbox" name="perHand" ${e.perHand ? 'checked' : ''}><span>Carico per mano</span></label>
      <label class="check"><input type="checkbox" name="perSide" ${e.perSide ? 'checked' : ''}><span>Per lato</span></label>
      <label class="check"><input type="checkbox" name="sec" ${e.unit === 'sec' ? 'checked' : ''}><span>A tempo (secondi)</span></label></div>
    <label class="field"><span>Intensità (es. RIR 2)</span><input type="text" name="target" value="${esc(e.target)}"></label>
    <label class="field"><span>Esecuzione / note</span><textarea name="notes" style="font-family:inherit;font-size:15px;min-height:70px">${esc(e.notes)}</textarea></label>
    <div class="field"><span class="small muted" style="font-weight:600">Muscoli coinvolti: tocca una volta = secondario (½), due volte = primario</span>
      <div class="musclegrid" id="mg" style="margin-top:6px">${MUSCLES.map((m) => `<button type="button" data-m="${m}" class="${musc[m] >= 1 ? 'p1' : musc[m] ? 'p05' : ''}">${m}</button>`).join('')}</div>
      <button type="button" class="btn ghost sm" id="mg-auto">Suggerisci dal nome</button></div>
    <div class="stack"><button class="btn primary block" type="submit">Salva</button>
    ${e.id ? `<button class="btn danger block" type="button" id="ex-del">Elimina esercizio</button>` : ''}</div>
  </form>`, (root, close) => {
    const mg = root.querySelector('#mg');
    const paint = () => mg.querySelectorAll('button').forEach((b) => { const f = musc[b.dataset.m]; b.className = f >= 1 ? 'p1' : f ? 'p05' : ''; });
    mg.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      const m = b.dataset.m; const f = musc[m];
      if (!f) musc[m] = 0.5; else if (f < 1) musc[m] = 1; else delete musc[m];
      paint();
    });
    root.querySelector('#mg-auto').onclick = () => { const g = guessMuscles(root.querySelector('[name=name]').value); for (const k of Object.keys(musc)) delete musc[k]; Object.assign(musc, g); paint(); };
    const del = root.querySelector('#ex-del');
    if (del) del.onclick = () => { if (confirm('Eliminare ' + e.name + '? Lo storico resta nei report.')) { r.exercises = r.exercises.filter((x) => x.id !== e.id); if (state.current && state.current.routineId === r.id) delete state.current.sets[e.id]; save(); close(); rerender(); } };
    root.querySelector('#exform').onsubmit = (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const parsed = parseSets(f.get('sets'));
      if (!parsed.sets.length) { alert('Scrivi le serie come "3 × 10" oppure "SX 4 × 8, DX 2 × 8"'); return; }
      const w = f.get('weight') === '' ? null : parseFloat(String(f.get('weight')).replace(',', '.'));
      const target = e.id ? e : { id: uid() };
      const oldSets = JSON.stringify(e.sets);
      Object.assign(target, {
        name: f.get('name').trim(), group: f.get('group').trim().toUpperCase(), sets: parsed.sets, unit: f.get('sec') ? 'sec' : 'reps',
        perSide: !!f.get('perSide') || parsed.perSide, target: f.get('target').trim() || parsed.target, notes: f.get('notes').trim(),
        restSec: parseInt(f.get('rest'), 10) || 0, perHand: !!f.get('perHand'), muscles: { ...musc },
      });
      if (e.id) changeWeight(e.id, w); else { target.weight = w; r.exercises.push(target); }
      if (state.current && state.current.routineId === r.id && (!e.id || oldSets !== JSON.stringify(target.sets))) {
        const prev = state.current.sets[target.id] || [];
        state.current.sets[target.id] = target.sets.map((s, k) => ({ side: s.side, reps: s.reps, done: prev[k]?.done || false, weight: prev[k]?.weight ?? null }));
      }
      save(); close(); rerender();
    };
  });
}

// ---------------- IMPORT SCHEDE ----------------
function importRoutinesSheet() {
  sheet(`<h2 style="margin-top:0">Importa schede</h2>
  <p class="small muted">Incolla le tabelle copiate dal documento, da Excel/Numbers o in Markdown. Ogni scheda inizia con una riga "Scheda …" seguita da una tabella con le colonne <b>Esercizio · Serie × ripetizioni · Esecuzione/Note · Recupero · Carico</b>. Accetta anche un file .json esportato da questa app.</p>
  <textarea id="imp-text" placeholder="Scheda A&#10;Esercizio	Serie × ripetizioni	Esecuzione	Recupero	Carico&#10;Squat	3 × 6	Bacino centrato	2–3 min	82 kg"></textarea>
  <div class="btn-row" style="margin:10px 0"><button class="btn" id="imp-paste">Incolla</button><label class="btn" style="text-align:center">File…<input type="file" id="imp-file" accept=".txt,.csv,.tsv,.md,.json,text/*,application/json" hidden></label></div>
  <div id="imp-prev"></div>`, (root, close) => {
    const ta = root.querySelector('#imp-text'), prev = root.querySelector('#imp-prev');
    let parsed = [];
    const preview = () => {
      const t = ta.value.trim();
      try {
        if (/^[[{]/.test(t)) { const j = JSON.parse(t); parsed = (Array.isArray(j) ? j : j.routines || [j]).map(normalizeRoutineJson); }
        else parsed = parseRoutinesText(t);
      } catch (e) { parsed = []; }
      if (!parsed.length) { prev.innerHTML = t ? '<p class="small" style="color:var(--danger)">Non riconosco nessuna scheda in questo testo.</p>' : ''; return; }
      prev.innerHTML = parsed.map((r) => `<div class="card"><b>${esc(r.name)}</b> <span class="chip">${routineByName(r.name) ? 'aggiorna esistente' : 'nuova'}</span>
        <div class="tiny">${r.exercises.map((e) => esc(e.name) + ' ' + esc(setsText(e)) + ' ' + esc(loadText(e))).join('<br>')}</div></div>`).join('')
        + `<button class="btn primary block" id="imp-go">Importa ${parsed.length} ${parsed.length === 1 ? 'scheda' : 'schede'}</button>
        <p class="tiny">Le schede con lo stesso nome vengono aggiornate mantenendo lo storico degli esercizi con lo stesso nome.</p>`;
      prev.querySelector('#imp-go').onclick = () => { applyRoutineImport(parsed); close(); location.hash = '#/schede'; rerender(); toast('Schede importate'); };
    };
    ta.addEventListener('input', preview);
    root.querySelector('#imp-paste').onclick = async () => { try { ta.value = await navigator.clipboard.readText(); preview(); } catch { toast('Tieni premuto nel riquadro e scegli Incolla'); } };
    root.querySelector('#imp-file').onchange = async (ev) => { const f = ev.target.files[0]; if (f) { ta.value = await f.text(); preview(); } };
  });
}
function normalizeRoutineJson(r) {
  return { id: uid(), name: r.name || 'Scheda', subtitle: r.subtitle || '', warmup: r.warmup || [], notes: r.notes || '',
    exercises: (r.exercises || []).map((e) => ({ id: uid(), name: e.name, group: e.group || '', sets: e.sets || [], unit: e.unit || 'reps', perSide: !!e.perSide,
      target: e.target || '', notes: e.notes || '', restSec: e.restSec || 0, weight: e.weight ?? null, perHand: !!e.perHand, muscles: e.muscles || guessMuscles(e.name) })) };
}
const routineByName = (n) => state.routines.find((r) => norm(r.name) === norm(n));
function applyRoutineImport(list) {
  for (const nr of list) {
    const old = routineByName(nr.name);
    if (!old) { state.routines.push(nr); continue; }
    for (const ne of nr.exercises) {
      const oe = old.exercises.find((x) => norm(x.name) === norm(ne.name));
      if (oe) {
        const w = ne.weight; ne.id = oe.id; ne.weight = oe.weight;
        if (!Object.keys(ne.muscles || {}).length) ne.muscles = oe.muscles;
        Object.assign(oe, ne);
        changeWeight(oe.id, w);
      }
    }
    old.name = nr.name; old.subtitle = nr.subtitle || old.subtitle; old.warmup = nr.warmup.length ? nr.warmup : old.warmup; old.notes = nr.notes || old.notes;
    old.exercises = nr.exercises.map((ne) => old.exercises.find((x) => x.id === ne.id) || ne);
  }
  save();
}
function routineToText(r) {
  const rows = r.exercises.map((e) => [(e.group ? e.group + '. ' : '') + e.name, setsText(e) + (e.target ? ' a ' + e.target : ''), e.notes, e.restSec ? restText(e.restSec) : '—',
    e.weight == null ? '—' : dec(e.weight) + ' kg' + (e.perHand ? ' per mano' : '')].join('\t'));
  return [r.name + (r.subtitle ? ': ' + r.subtitle : ''), 'Riscaldamento', ...(r.warmup || []).map((w, i) => i + 1 + '. ' + w),
    'Esercizio\tSerie × ripetizioni\tEsecuzione\tRecupero\tCarico', ...rows].join('\n');
}

// ---------------- ATTIVITÀ ----------------
function viewActivities() {
  const to = new Date(); const from = new Date(Date.now() - 90 * S.DAY);
  const items = activityFeed([from, new Date(to.getTime() + S.DAY)]);
  let h = `<h1>Attività</h1>
  <div class="btn-row" style="margin-bottom:12px"><button class="btn primary" data-a="gsync">📅 Calendario</button><button class="btn primary" data-a="watch-import">⌚ Watch</button></div>
  <button class="btn block" data-a="act-new" style="margin-bottom:12px">+ Aggiungi a mano</button>
  ${state.settings.lastSync ? `<p class="tiny">Ultima sincronizzazione calendario: ${relDays(state.settings.lastSync)} alle ${fmtTime(state.settings.lastSync)}</p>` : ''}`;
  if (!items.length) return h + `<div class="card empty">Nessuna attività negli ultimi 90 giorni.<br>Sincronizza il calendario o importa dal Watch.</div>`;
  let curWeek = null, buf = '';
  for (const it of items) {
    const wk = S.startOfWeek(it.start).getTime();
    if (wk !== curWeek) {
      if (buf) h += `<div class="card">${buf}</div>`;
      buf = ''; curWeek = wk;
      h += `<div class="superset-label">Settimana del ${fmtDate(wk, { day: 'numeric', month: 'long' })}</div>`;
    }
    buf += feedItem(it);
  }
  h += `<div class="card">${buf}</div><p class="tiny">📅 = calendario Google · ⌚ = Apple Watch · ✍️ = manuale. Un evento e un allenamento Watch sovrapposti vengono uniti automaticamente.</p>`;
  return h;
}
function activitySheet(id) {
  const a = state.activities.find((x) => x.id === id) || { id: '', type: 'padel', title: '', start: new Date(Date.now() - 3600000).toISOString(), durationMin: 60, kcal: null, distanceKm: null, avgHr: null, sources: ['manual'] };
  sheet(`<h2 style="margin-top:0">${a.id ? 'Attività' : 'Nuova attività'}</h2>
  ${a.id ? `<p class="small muted">Fonti: ${a.sources.map((s) => ({ calendar: '📅 Calendario', watch: '⌚ Apple Watch', manual: '✍️ Manuale' }[s] || s)).join(' + ')}</p>` : ''}
  <form id="actform">
    <label class="field"><span>Tipo</span><select name="type">${Object.keys(TYPE_LABEL).map((t) => `<option value="${t}" ${a.type === t ? 'selected' : ''}>${TYPE_ICON[t]} ${TYPE_LABEL[t]}</option>`).join('')}</select></label>
    <label class="field"><span>Titolo</span><input type="text" name="title" value="${esc(a.title)}"></label>
    <label class="field"><span>Inizio</span><input type="datetime-local" name="start" value="${toLocalInput(a.start)}"></label>
    <div class="row"><label class="field grow"><span>Durata (min)</span><input type="number" inputmode="numeric" name="dur" value="${a.durationMin ?? ''}"></label>
    <label class="field grow"><span>Kcal attive</span><input type="number" inputmode="numeric" name="kcal" value="${a.kcal ?? ''}"></label></div>
    <div class="row"><label class="field grow"><span>Distanza (km)</span><input type="number" step="0.01" inputmode="decimal" name="km" value="${a.distanceKm ?? ''}"></label>
    <label class="field grow"><span>FC media</span><input type="number" inputmode="numeric" name="hr" value="${a.avgHr ?? ''}"></label></div>
    <div class="stack"><button class="btn primary block" type="submit">Salva</button>
    ${a.id ? `<button class="btn danger block" type="button" id="act-del">Elimina</button>` : ''}</div>
  </form>`, (root, close) => {
    root.querySelector('#actform').onsubmit = (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const n = (k) => (f.get(k) === '' ? null : parseFloat(String(f.get(k)).replace(',', '.')));
      const start = new Date(f.get('start'));
      const dur = n('dur') || 60;
      Object.assign(a, { type: f.get('type'), title: f.get('title').trim(), start: start.toISOString(), end: new Date(start.getTime() + dur * 60000).toISOString(),
        durationMin: dur, kcal: n('kcal'), distanceKm: n('km'), avgHr: n('hr') });
      if (!a.id) { a.id = uid(); a.extIds = []; state.activities.push(a); }
      save(); close(); rerender();
    };
    const del = root.querySelector('#act-del');
    if (del) del.onclick = () => {
      if (!confirm('Eliminare questa attività?')) return;
      state.activities = state.activities.filter((x) => x.id !== a.id);
      // ricorda gli eventi eliminati per non reimportarli
      state.settings.ignoredExt = [...(state.settings.ignoredExt || []), ...(a.extIds || [])];
      save(); close(); rerender();
    };
  });
}
function importActivities(list) {
  const ignored = new Set(state.settings.ignoredExt || []);
  const count = { new: 0, merged: 0, updated: 0, dup: 0 };
  // prima il calendario, poi il Watch: così il Watch si aggancia agli eventi
  list.sort((a, b) => (a.source === 'calendar' ? -1 : 1) - (b.source === 'calendar' ? -1 : 1));
  for (const a of list) {
    if (!a.extId) a.extId = a.source + ':' + a.type + ':' + a.start.slice(0, 16);
    if (ignored.has(a.extId)) continue;
    count[S.upsertActivity(state, a, uid)]++;
  }
  save();
  return count;
}
async function googleSync() {
  const st = state.settings;
  if (!st.googleClientId) { toast('Prima configura Google Calendar in Altro → Impostazioni'); location.hash = '#/impostazioni'; return; }
  try {
    toast('Sincronizzo il calendario…', 1500);
    const from = new Date(Date.now() - (st.lastSync ? Math.max(7, (Date.now() - new Date(st.lastSync)) / S.DAY + 2) : st.calendarLookbackDays) * S.DAY);
    const evs = (await gcal.fetchEvents(st, from, new Date(), typeFromText)).filter((e) => new Date(e.end) <= new Date());
    const c = importActivities(evs);
    st.lastSync = new Date().toISOString(); save();
    toast(`Calendario: ${c.new} nuove, ${c.merged} unite al Watch, ${c.updated + c.dup} già presenti`, 3500);
    rerender();
  } catch (e) { alert('Google Calendar: ' + e.message); }
}
function watchImportSheet() {
  sheet(`<h2 style="margin-top:0">Importa da Apple Watch</h2>
  <p class="small muted">Esegui il Comando rapido <b>"Esporta allenamenti"</b> (vedi Altro → Guida): copia gli allenamenti negli appunti. Poi tocca <b>Incolla</b>. Funziona anche con un file JSON di app come Health Auto Export.</p>
  <div class="btn-row" style="margin-bottom:10px"><button class="btn primary" id="wi-paste">Incolla dagli appunti</button><label class="btn" style="text-align:center">File…<input type="file" id="wi-file" accept=".json,.txt,.csv,application/json,text/*" hidden></label></div>
  <textarea id="wi-text" placeholder="W;Padel;14/11/2026 18:30;14/11/2026 20:00;90;650;;142"></textarea>
  <div id="wi-prev" style="margin-top:10px"></div>`, (root, close) => {
    const ta = root.querySelector('#wi-text'), prev = root.querySelector('#wi-prev');
    const preview = () => {
      const list = parseActivitiesText(ta.value);
      if (!list.length) { prev.innerHTML = ta.value.trim() ? '<p class="small" style="color:var(--danger)">Nessun allenamento riconosciuto.</p>' : ''; return; }
      prev.innerHTML = `<div class="card">${list.slice(0, 30).map((a) => `<div class="small">${TYPE_ICON[a.type] || '⚡'} ${esc(a.title || a.type)} · ${fmtDate(a.start)} ${fmtTime(a.start)} · ${fmtMin(a.durationMin)}${a.kcal ? ' · ' + fmtInt(a.kcal) + ' kcal' : ''} <span class="src">${a.source === 'calendar' ? '📅' : '⌚'}</span></div>`).join('')}
        ${list.length > 30 ? `<div class="tiny">…e altre ${list.length - 30}</div>` : ''}</div><button class="btn primary block" id="wi-go">Importa ${list.length}</button>`;
      prev.querySelector('#wi-go').onclick = () => { const c = importActivities(list); close(); rerender(); toast(`Watch: ${c.new} nuove, ${c.merged} unite, ${c.updated + c.dup} già presenti`, 3500); };
    };
    ta.addEventListener('input', preview);
    root.querySelector('#wi-paste').onclick = async () => { try { ta.value = await navigator.clipboard.readText(); preview(); } catch { toast('Tieni premuto nel riquadro e scegli Incolla'); } };
    root.querySelector('#wi-file').onchange = async (ev) => { const f = ev.target.files[0]; if (f) { ta.value = await f.text(); preview(); } };
    // avvio automatico dal Comando: #/attivita?watch
    if (location.hash.includes('auto')) root.querySelector('#wi-paste').click();
  });
}

// ---------------- REPORT ----------------
let rep = { kind: 'week', ref: new Date(), ex: null };
function viewReport(a, b, after) {
  const range = S.periodRange(rep.kind, rep.ref);
  const prevRange = S.periodRange(rep.kind, S.shiftPeriod(rep.kind, rep.ref, -1));
  const cur = S.summarize(state, range), prev = S.summarize(state, prevRange);
  const label = rep.kind === 'week'
    ? `${fmtDate(range[0], { day: 'numeric', month: 'short' })} – ${fmtDate(range[1].getTime() - 1, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : fmtDate(range[0], { month: 'long', year: 'numeric' });
  const isCurrent = range[1] > new Date();
  let h = `<h1>Report</h1>
  <div class="seg" style="margin-bottom:10px"><button class="${rep.kind === 'week' ? 'on' : ''}" data-a="rep-kind" data-k="week">Settimana</button><button class="${rep.kind === 'month' ? 'on' : ''}" data-a="rep-kind" data-k="month">Mese</button></div>
  <div class="row between" style="margin-bottom:12px"><button class="btn sm" data-a="rep-shift" data-d="-1">‹</button><b>${esc(label)}</b><button class="btn sm" data-a="rep-shift" data-d="1" ${isCurrent ? 'disabled' : ''}>›</button></div>
  <div class="kpis">
    ${kpi('Sedute palestra', cur.sessions.length, prev.sessions.length)}
    ${kpi('Altre attività', cur.activities.length, prev.activities.length)}
    ${kpi('Minuti attivi', fmtInt(cur.totalMin), prev.totalMin, cur.totalMin)}
    ${kpi('Volume', fmtInt(cur.volume) + ' kg', prev.volume, cur.volume)}
    ${kpi('Giorni attivi', cur.activeDays, prev.activeDays)}
    ${kpi('Kcal attive', cur.kcal ? fmtInt(cur.kcal) : '—', cur.kcal ? prev.kcal : null, cur.kcal)}
  </div>
  <button class="btn primary block" data-a="pdf" style="margin-bottom:12px">Esporta PDF</button>`;

  // Frequenza settimanale
  h += `<div class="card"><h3>Frequenza settimanale</h3><p class="tiny">Ultime 12 settimane</p>
    <div class="legend"><span><i style="background:var(--s1)"></i>Palestra</span><span><i style="background:var(--s2)"></i>Altre attività</span></div>
    <div class="chart-box"><canvas id="ch-freq" role="img" aria-label="Sedute per settimana"></canvas></div></div>`;
  after.push(() => charts.push(freqChart(document.getElementById('ch-freq'), S.weeklySeries(state, 12, rep.kind === 'week' ? rep.ref : new Date(Math.min(range[1] - 1, Date.now()))))));

  // Minuti per tipo
  const types = Object.entries(cur.byType).filter(([, v]) => v.count).sort((x, y) => y[1].minutes - x[1].minutes);
  const maxMin = Math.max(1, ...types.map(([, v]) => v.minutes));
  h += `<div class="card"><h3>Minuti di attività per tipo</h3>${types.length ? types.map(([t, v]) => `<div class="bar-h"><span class="n">${TYPE_ICON[t] || ''} ${TYPE_LABEL[t] || t}</span><span class="b"><i style="width:${(v.minutes / maxMin) * 100}%"></i></span><span class="v">${fmtMin(v.minutes)} · ${v.count}×</span></div>`).join('') : '<div class="empty">Nessuna attività nel periodo</div>'}</div>`;

  // Volume per muscolo
  const mus = Object.entries(cur.muscles).filter(([, v]) => v.sets > 0).sort((x, y) => y[1].volume - x[1].volume || y[1].sets - x[1].sets);
  const maxV = Math.max(1, ...mus.map(([, v]) => v.volume));
  h += `<div class="card"><h3>Volume per gruppo muscolare</h3><p class="tiny">kg × ripetizioni, con peso ½ per i muscoli secondari · serie effettive</p>
    ${mus.length ? mus.map(([m, v]) => `<div class="bar-h"><span class="n">${m}</span><span class="b"><i style="width:${(v.volume / maxV) * 100}%"></i></span><span class="v">${fmtInt(v.volume)} kg · ${dec(v.sets)} serie</span></div>`).join('') : '<div class="empty">Nessuna seduta in palestra nel periodo</div>'}</div>`;

  // Volume settimanale
  h += `<div class="card"><h3>Volume totale per settimana</h3><p class="tiny">kg sollevati, ultime 12 settimane</p><div class="chart-box"><canvas id="ch-vol" role="img" aria-label="Volume settimanale"></canvas></div></div>`;
  after.push(() => charts.push(volChart(document.getElementById('ch-vol'), S.weeklySeries(state, 12, rep.kind === 'week' ? rep.ref : new Date(Math.min(range[1] - 1, Date.now()))))));

  // Progressione esercizio
  const idx = exIndex();
  const exList = Object.values(idx).filter((e) => e.weight != null || state.sessions.some((s) => s.sets.some((x) => x.exerciseId === e.id)));
  const hasHist = (id) => state.sessions.some((s) => s.sets.some((x) => x.exerciseId === id && x.done)) || state.weightLog.some((w) => w.exerciseId === id);
  exList.sort((x, y) => hasHist(y.id) - hasHist(x.id));
  if (!rep.ex || !idx[rep.ex]) rep.ex = exList[0]?.id;
  h += `<div class="card"><h3>Progressione del carico</h3>
    <select data-c="rep-ex" style="margin:8px 0">${exList.map((e) => `<option value="${e.id}" ${e.id === rep.ex ? 'selected' : ''}>${esc(e.routine)} · ${esc(e.name)}</option>`).join('')}</select>
    <div class="legend"><span><i style="background:var(--s1)"></i>Carico</span><span><i style="background:var(--s2)"></i>Massimale stimato (e1RM)</span></div>
    <div class="chart-box tall"><canvas id="ch-prog" role="img" aria-label="Progressione carico"></canvas></div>
    <div id="prog-table"></div></div>`;
  after.push(() => { const c = progChart(document.getElementById('ch-prog'), rep.ex); if (c) charts.push(c); document.getElementById('prog-table').innerHTML = progTable(rep.ex); });

  // Miglioramenti
  h += `<div class="card"><h3>Miglioramenti da inizio storico</h3>${improvementsTable()}</div>`;
  const wl = state.weightLog.filter((w) => new Date(w.date) >= range[0] && new Date(w.date) < range[1]);
  h += `<div class="card"><h3>Aumenti di carico nel periodo</h3>${wl.length ? `<table class="t"><tr><th>Data</th><th>Esercizio</th><th class="r">Da</th><th class="r">A</th></tr>${wl.map((w) => `<tr><td>${fmtDate(w.date, { day: 'numeric', month: 'short' })}</td><td>${esc(w.name)}</td><td class="r">${fmtKg(w.from)}</td><td class="r"><b>${fmtKg(w.to)}</b></td></tr>`).join('')}</table>` : '<div class="empty">Nessuna modifica di carico</div>'}</div>`;
  return h;
}
export function improvements() {
  const idx = exIndex(); const rows = [];
  for (const e of Object.values(idx)) {
    const logs = state.weightLog.filter((w) => w.exerciseId === e.id);
    const hist = S.exerciseHistory(state, e.id);
    const first = logs.length ? logs[0].from : hist.length ? hist[0].weight : null;
    if (first == null || e.weight == null) continue;
    const e1 = hist.filter((x) => x.e1rm);
    rows.push({ name: e.name, routine: e.routine, first, now: e.weight, delta: e.weight - first, pct: first ? (e.weight - first) / first * 100 : null,
      e1First: e1[0]?.e1rm ?? null, e1Best: e1.length ? Math.max(...e1.map((x) => x.e1rm)) : null, sessions: hist.length });
  }
  return rows.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
}
function improvementsTable() {
  const rows = improvements();
  if (!rows.length || rows.every((r) => !r.delta && !r.sessions)) return '<div class="empty">Allenati qualche volta e qui vedrai i progressi.</div>';
  return `<table class="t"><tr><th>Esercizio</th><th class="r">Inizio</th><th class="r">Ora</th><th class="r">Δ</th></tr>${rows.map((r) => `<tr><td>${esc(r.name)}<div class="tiny">${esc(r.routine)} · ${r.sessions} sedute</div></td><td class="r">${fmtKg(r.first)}</td><td class="r"><b>${fmtKg(r.now)}</b></td><td class="r" style="color:${r.delta > 0 ? 'var(--good)' : r.delta < 0 ? 'var(--danger)' : 'inherit'}">${r.delta > 0 ? '+' : ''}${dec(r.delta)}${r.pct ? ` <span class="tiny">(${r.pct > 0 ? '+' : ''}${dec(r.pct, 0)}%)</span>` : ''}</td></tr>`).join('')}</table>`;
}
function progTable(eid) {
  const hist = S.exerciseHistory(state, eid).slice(-8).reverse();
  const logs = state.weightLog.filter((w) => w.exerciseId === eid).slice(-8).reverse();
  let h = '';
  if (hist.length) h += `<table class="t" style="margin-top:10px"><tr><th>Seduta</th><th class="r">Carico</th><th class="r">e1RM</th><th class="r">Volume</th></tr>${hist.map((x) => `<tr><td>${fmtDate(x.date, { day: 'numeric', month: 'short' })}</td><td class="r">${fmtKg(x.weight)}</td><td class="r">${x.e1rm ? dec(x.e1rm, 0) : '—'}</td><td class="r">${fmtInt(x.volume)}</td></tr>`).join('')}</table>`;
  if (logs.length) h += `<p class="small" style="margin-top:10px"><b>Modifiche di carico</b></p>${logs.map((w) => `<div class="small muted">${fmtDate(w.date, { day: 'numeric', month: 'short', year: '2-digit' })}: ${fmtKg(w.from)} → <b>${fmtKg(w.to)}</b></div>`).join('')}`;
  return h || '<div class="empty">Nessun dato ancora</div>';
}

// ---- Chart.js ----
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
export function chartTheme(light) {
  if (light) return { text: '#52514e', grid: '#e6e5e0', s1: '#2a78d6', s2: '#eb6834', surface: '#ffffff' };
  return { text: cssVar('--text-2'), grid: cssVar('--line'), s1: cssVar('--s1'), s2: cssVar('--s2'), surface: cssVar('--surface') };
}
function baseOpts(th, extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: extra.animation ?? { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0b0b0b', titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 8, displayColors: true, boxPadding: 4 } },
    scales: {
      x: { grid: { display: false }, ticks: { color: th.text, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 8 }, border: { color: th.grid }, stacked: extra.stacked },
      y: { grid: { color: th.grid }, ticks: { color: th.text, font: { size: 11 }, precision: 0 }, border: { display: false }, beginAtZero: extra.zero ?? true, stacked: extra.stacked },
    },
  };
}
export function freqChart(canvas, series, light = false, animation) {
  const th = chartTheme(light);
  return new Chart(canvas, {
    type: 'bar',
    data: { labels: series.map((w) => fmtDate(w.start, { day: 'numeric', month: 'short' })),
      datasets: [
        { label: 'Palestra', data: series.map((w) => w.gym), backgroundColor: th.s1, borderRadius: 4, borderSkipped: 'start', borderColor: th.surface, borderWidth: { top: 2 }, maxBarThickness: 26 },
        { label: 'Altre attività', data: series.map((w) => w.other), backgroundColor: th.s2, borderRadius: 4, borderSkipped: 'start', borderColor: th.surface, borderWidth: { top: 2 }, maxBarThickness: 26 },
      ] },
    options: baseOpts(th, { stacked: true, animation }),
  });
}
export function volChart(canvas, series, light = false, animation) {
  const th = chartTheme(light);
  return new Chart(canvas, {
    type: 'bar',
    data: { labels: series.map((w) => fmtDate(w.start, { day: 'numeric', month: 'short' })),
      datasets: [{ label: 'Volume (kg)', data: series.map((w) => Math.round(w.volume)), backgroundColor: th.s1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 26 }] },
    options: baseOpts(th, { animation }),
  });
}
export function progChart(canvas, eid, light = false, animation) {
  if (!canvas || !eid) return null;
  const th = chartTheme(light);
  let hist = S.exerciseHistory(state, eid);
  const logs = state.weightLog.filter((w) => w.exerciseId === eid);
  let pts = hist.map((x) => ({ t: x.date, w: x.weight, e: x.e1rm }));
  if (!pts.length && logs.length) pts = [{ t: logs[0].date, w: logs[0].from }, ...logs.map((l) => ({ t: l.date, w: l.to }))];
  if (!pts.length) { canvas.parentElement.style.display = 'none'; return null; }
  canvas.parentElement.style.display = '';
  return new Chart(canvas, {
    type: 'line',
    data: { labels: pts.map((p) => fmtDate(p.t, { day: 'numeric', month: 'short' })),
      datasets: [
        { label: 'Carico (kg)', data: pts.map((p) => p.w), borderColor: th.s1, backgroundColor: th.s1, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, stepped: hist.length ? false : 'before', tension: 0 },
        { label: 'e1RM (kg)', data: pts.map((p) => (p.e ? Math.round(p.e) : null)), borderColor: th.s2, backgroundColor: th.s2, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, spanGaps: true, tension: 0 },
      ] },
    options: baseOpts(th, { zero: false, animation }),
  });
}

// ---------------- IMPOSTAZIONI ----------------
function viewSettings() {
  const st = state.settings;
  return `<h1>Altro</h1>
  <div class="card tap" data-a="go" data-href="#/guida"><div class="row between"><div><h3>Guida</h3><div class="small muted">Installazione, Google Calendar, Comando per Apple Watch</div></div><span>›</span></div></div>
  <h2>Backup su iCloud Drive</h2>
  <div class="card"><p class="small muted">I dati sono salvati su questo iPhone. Fai un backup regolare: scegli <b>Salva in File → iCloud Drive</b>. ${st.lastBackup ? 'Ultimo: ' + relDays(st.lastBackup) + '.' : ''}</p>
  <div class="btn-row"><button class="btn primary" data-a="backup">Esporta backup</button><label class="btn" style="text-align:center">Ripristina…<input type="file" data-c="restore" accept=".json,application/json" hidden></label></div></div>
  <h2>Google Calendar</h2>
  <div class="card">
    <label class="field"><span>Client ID OAuth</span><input type="text" data-c="gid" value="${esc(st.googleClientId)}" placeholder="xxxx.apps.googleusercontent.com" autocapitalize="off" autocorrect="off"></label>
    <div class="field"><span class="small muted" style="font-weight:600">Calendari letti</span><div id="cal-list" class="small">${st.calendarIds.map((c) => esc(c === 'primary' ? 'Principale' : c)).join(', ')}</div>
    <button class="btn sm" data-a="cal-load" style="margin-top:6px">Scegli calendari</button></div>
    <p class="small muted" style="font-weight:600;margin-top:12px">Parole chiave nel titolo degli eventi</p>
    ${Object.entries(st.keywords).map(([t, w]) => `<label class="field"><span>${TYPE_ICON[t] || ''} ${TYPE_LABEL[t] || t}</span><input type="text" data-c="kw" data-t="${t}" value="${esc(w.join(', '))}"></label>`).join('')}
    <div class="row"><select data-c="kw-add" class="grow"><option value="">+ Aggiungi un tipo…</option>${Object.keys(TYPE_LABEL).filter((t) => !st.keywords[t]).map((t) => `<option value="${t}">${TYPE_LABEL[t]}</option>`).join('')}</select></div>
  </div>
  <h2>Allenamento</h2>
  <div class="card"><label class="field"><span>Incremento peso con + / − (kg)</span><input type="number" step="0.25" inputmode="decimal" data-c="wstep" value="${st.weightStep}"></label></div>
  <h2>Dati</h2>
  <div class="card stack"><p class="small muted">${state.sessions.length} sedute · ${state.activities.length} attività · ${state.weightLog.length} modifiche di carico</p>
  <button class="btn danger block" data-a="reset">Cancella tutti i dati</button></div>
  <p class="tiny" style="text-align:center;margin-top:20px">Allenamenti · v1.0</p>`;
}
function viewGuide() {
  const url = location.origin + location.pathname;
  return `<div class="topbar"><button class="back" data-a="go" data-href="#/impostazioni">‹ Altro</button></div><h1>Guida</h1>
  <div class="card"><h3>1. Installa sull'iPhone</h3><p class="small">Apri <b>${esc(url)}</b> in Safari → tasto Condividi → <b>Aggiungi alla schermata Home</b>. Usa sempre l'icona sulla Home: i dati della web app installata sono separati da quelli di Safari.</p></div>
  <div class="card"><h3>2. Durante l'allenamento</h3><p class="small">Tocca una serie per spuntarla: parte il timer di recupero. Tieni premuto una serie per cambiare le ripetizioni fatte. Con − / + cambi il carico: la modifica è <b>permanente</b> sulla scheda e finisce nello storico dei carichi.</p></div>
  <div class="card"><h3>3. Google Calendar</h3><ol class="small" style="padding-left:18px;margin:0">
    <li>Vai su <b>console.cloud.google.com</b>, crea un progetto (es. "Allenamenti").</li>
    <li><b>API e servizi → Libreria</b>: abilita <b>Google Calendar API</b>.</li>
    <li><b>Schermata consenso OAuth</b>: tipo Esterno, aggiungi il tuo indirizzo Gmail tra gli <b>utenti di test</b>.</li>
    <li><b>Credenziali → Crea credenziali → ID client OAuth</b> → Applicazione web. In <b>Origini JavaScript autorizzate</b> metti <b>${esc(location.origin)}</b>.</li>
    <li>Copia l'ID client e incollalo in Altro → Google Calendar.</li></ol>
    <p class="small muted" style="margin-top:8px">Vengono importati solo gli eventi passati il cui titolo contiene le parole chiave (padel, tennis, corsa…).</p></div>
  <div class="card"><h3>4. Comando rapido per Apple Watch</h3>
    <p class="small">Nell'app <b>Comandi</b> crea un nuovo comando "Esporta allenamenti":</p>
    <ol class="small" style="padding-left:18px;margin:0">
      <li><b>Trova campioni di salute</b> dove Tipo è <b>Allenamenti</b> e Data inizio è negli ultimi <b>14 giorni</b>. Ordina per Data inizio, più recenti prima.</li>
      <li><b>Ripeti con ciascuno</b> → dentro: azione <b>Testo</b> con: <code>W;</code>[Tipo];[Data inizio];[Data fine];[Durata];[Energia attiva]  (scegli le variabili toccando "Elemento ripetizione" e la proprietà).</li>
      <li>Dopo il ripeti: <b>Combina testo</b> (Risultati ripetizione, con A capo) → <b>Copia negli appunti</b>.</li>
      <li>Ultima azione: <b>Apri URL</b> <code>${esc(url)}#/attivita/auto</code> (facoltativo).</li></ol>
    <p class="small" style="margin-top:8px">Poi in Attività tocca <b>⌚ Watch → Incolla</b>. Gli allenamenti si uniscono da soli agli eventi del calendario e alle sedute in palestra sovrapposti.</p>
    <p class="small muted">Automazione: in Comandi → Automazione → <b>Allenamento Apple Watch</b> → "Termina" → esegui "Esporta allenamenti". Se su iOS 27 l'azione non offre il tipo "Allenamenti", usa un'app esportatrice (es. Health Auto Export) e importa il suo file JSON.</p></div>`;
}

// ---------------- sheet ----------------
function sheet(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet"><div class="grab"></div>${html}<button class="btn ghost block" data-close style="margin-top:8px">Chiudi</button></div>`;
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(bg);
  onMount && onMount(bg, close);
  return close;
}

// ---------------- backup ----------------
async function backup() {
  const d = new Date();
  state.settings.lastBackup = d.toISOString();
  const blob = new Blob([JSON.stringify({ app: 'allenamenti', exported: d.toISOString(), ...state }, null, 1)], { type: 'application/json' });
  const name = `allenamenti-backup-${dayKey(d)}.json`;
  await shareOrDownload(blob, name);
  save(); rerender();
}
export async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
async function restore(file) {
  try {
    const j = JSON.parse(await file.text());
    if (!j.routines || !j.sessions) throw new Error('File non valido');
    if (!confirm(`Ripristinare il backup del ${fmtDate(j.exported || Date.now())}? I dati attuali verranno sostituiti.`)) return;
    delete j.app; delete j.exported;
    state = { ...freshState(), ...j, settings: { ...structuredClone(DEFAULT_SETTINGS), ...j.settings } };
    await db.saveNow(state); toast('Backup ripristinato'); rerender();
  } catch (e) { alert('Ripristino non riuscito: ' + e.message); }
}

// ---------------- events ----------------
function setupLongPress() {
  let t = null, fired = false;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-lp]'); if (!el) return;
    fired = false;
    t = setTimeout(() => {
      fired = true;
      const c = state.current; if (!c) return;
      const s = c.sets[el.dataset.e][+el.dataset.k];
      const v = prompt('Ripetizioni (o secondi) fatte in questa serie:', s.reps);
      if (v != null && !isNaN(parseInt(v, 10))) { s.reps = parseInt(v, 10); save(); rerender(); }
    }, 550);
  });
  const cancel = () => clearTimeout(t);
  document.addEventListener('pointerup', cancel); document.addEventListener('pointercancel', cancel); document.addEventListener('pointermove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancel(); });
  document.addEventListener('click', (e) => { if (fired && e.target.closest('[data-lp]')) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-lp]')) e.preventDefault(); });
}
const actions = {
  go: (el) => (location.hash = el.dataset.href),
  back: () => history.back(),
  start: (el) => startWorkout(el.dataset.id),
  set: (el) => toggleSet(el.dataset.e, +el.dataset.k),
  'w-step': (el) => { const [, e] = findEx(el.dataset.e); changeWeight(e.id, (e.weight || 0) + state.settings.weightStep * +el.dataset.d); rerender(); },
  'w-set': (el, ev) => {
    ev.preventDefault();
    const [, e] = findEx(el.dataset.e);
    const v = prompt(`Nuovo carico per ${e.name} (kg${e.perHand ? ' per mano' : ''}). Vuoto = corpo libero.`, e.weight ?? '');
    if (v == null) return;
    changeWeight(e.id, v.trim() === '' ? null : parseFloat(v.replace(',', '.'))); rerender();
  },
  'ex-edit': (el) => exerciseSheet(el.dataset.r, el.dataset.e),
  'ex-new': (el) => exerciseSheet(el.dataset.r, null),
  'ex-move': (el) => { const r = routine(el.dataset.r); const i = +el.dataset.i, j = i + +el.dataset.d; [r.exercises[i], r.exercises[j]] = [r.exercises[j], r.exercises[i]]; save(); rerender(); },
  'rest-add': () => { state.current.restUntil = Math.max(Date.now(), state.current.restUntil) + 15000; state.current.restBeeped = false; save(); renderRestBar(); },
  'rest-skip': () => { state.current.restUntil = null; save(); renderRestBar(); },
  finish: () => finishWorkout(),
  discard: () => { if (confirm('Annullare la seduta? Le serie spuntate non verranno salvate (i carichi modificati restano).')) { state.current = null; save(); releaseWake(); location.hash = '#/oggi'; } },
  'sess-del': (el) => { if (confirm('Eliminare questa seduta?')) { state.sessions = state.sessions.filter((s) => s.id !== el.dataset.id); save(); history.back(); } },
  'import-routines': () => importRoutinesSheet(),
  'new-routine': () => { const r = { id: uid(), name: 'Nuova scheda', subtitle: '', warmup: [], exercises: [], notes: '' }; state.routines.push(r); save(); location.hash = '#/scheda/' + r.id; },
  'r-del': (el) => { const r = routine(el.dataset.id); if (confirm(`Eliminare ${r.name}? Le sedute passate restano nei report.`)) { state.routines = state.routines.filter((x) => x !== r); save(); location.hash = '#/schede'; } },
  'r-export': async (el) => { const r = routine(el.dataset.id); const t = routineToText(r); try { await navigator.clipboard.writeText(t); toast('Scheda copiata negli appunti'); } catch { await shareOrDownload(new Blob([t], { type: 'text/plain' }), r.name + '.txt'); } },
  gsync: () => googleSync(),
  'watch-import': () => watchImportSheet(),
  'act-edit': (el) => activitySheet(el.dataset.id),
  'act-new': () => activitySheet(null),
  'rep-kind': (el) => { rep.kind = el.dataset.k; rep.ref = new Date(); render(); },
  'rep-shift': (el) => { rep.ref = S.shiftPeriod(rep.kind, rep.ref, +el.dataset.d); rerender(); },
  pdf: async () => {
    try {
      toast('Creo il PDF…', 1200);
      const range = S.periodRange(rep.kind, rep.ref);
      const ctx = { state, kind: rep.kind, range, cur: S.summarize(state, range), prev: S.summarize(state, S.periodRange(rep.kind, S.shiftPeriod(rep.kind, rep.ref, -1))),
        improvements: improvements(), exIndex: exIndex(), freqChart, volChart, progChart, fmtKg, fmtMin, fmtInt, dec, fmtDate, TYPE_LABEL,
        weekly: S.weeklySeries(state, 12, new Date(Math.min(range[1] - 1, Date.now()))) };
      const blob = await exportReportPdf(ctx);
      await shareOrDownload(blob, `report-${rep.kind === 'week' ? 'settimana' : 'mese'}-${dayKey(range[0])}.pdf`);
    } catch (e) { console.error(e); alert('Errore PDF: ' + e.message); }
  },
  backup: () => backup(),
  reset: () => { if (confirm('Cancellare TUTTI i dati? Fai prima un backup.') && confirm('Sicuro? Operazione irreversibile.')) { state = freshState(); db.saveNow(state); location.hash = '#/oggi'; render(); } },
  'cal-load': async () => {
    try {
      const cals = await gcal.listCalendars(state.settings.googleClientId);
      const box = document.getElementById('cal-list');
      box.innerHTML = cals.map((c) => `<label class="check"><input type="checkbox" data-c="cal" value="${esc(c.primary ? 'primary' : c.id)}" ${state.settings.calendarIds.includes(c.primary ? 'primary' : c.id) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('');
    } catch (e) { alert(e.message); }
  },
};
function onClick(e) {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const f = actions[el.dataset.a];
  if (f) f(el, e);
}
function onChange(e) {
  const el = e.target; const c = el.dataset.c; if (!c) return;
  const st = state.settings;
  switch (c) {
    case 'warm': { const i = +el.dataset.i; const w = state.current.warmDone; if (el.checked) { if (!w.includes(i)) w.push(i); } else w.splice(w.indexOf(i), 1); save(); break; }
    case 'sess-note': state.current.note = el.value; save(); break;
    case 'sess-start': { const s = state.sessions.find((x) => x.id === el.dataset.id); const dur = new Date(s.end) - new Date(s.start); s.start = new Date(el.value).toISOString(); s.end = new Date(new Date(s.start).getTime() + dur).toISOString(); save(); rerender(); break; }
    case 'r-name': routine(el.dataset.id).name = el.value.trim() || 'Scheda'; save(); break;
    case 'r-sub': routine(el.dataset.id).subtitle = el.value.trim(); save(); break;
    case 'r-warm': routine(el.dataset.id).warmup = el.value.split('\n').map((x) => x.trim()).filter(Boolean); save(); break;
    case 'r-notes': routine(el.dataset.id).notes = el.value.trim(); save(); break;
    case 'rep-ex': rep.ex = el.value; rerender(); break;
    case 'gid': st.googleClientId = el.value.trim(); save(); break;
    case 'kw': st.keywords[el.dataset.t] = el.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean); save(); break;
    case 'kw-add': if (el.value) { st.keywords[el.value] = [el.value]; save(); rerender(); } break;
    case 'wstep': st.weightStep = parseFloat(el.value.replace(',', '.')) || 2.5; save(); break;
    case 'restore': if (el.files[0]) restore(el.files[0]); break;
    case 'cal': st.calendarIds = [...document.querySelectorAll('[data-c=cal]:checked')].map((x) => x.value); save(); break;
  }
}
// sheet "auto" dal Comando rapido
window.addEventListener('hashchange', () => { if (location.hash === '#/attivita/auto') setTimeout(watchImportSheet, 50); });

init();
