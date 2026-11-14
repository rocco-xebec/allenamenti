// Import dell'export dell'app Salute (export.zip / esportazione.xml): legge solo gli allenamenti, in streaming,
// così anche file da centinaia di MB non saturano la memoria dell'iPhone.
import { typeFromText } from './parse.js';

const HK_TITLES = {
  TraditionalStrengthTraining: 'Forza tradizionale', FunctionalStrengthTraining: 'Forza funzionale', CoreTraining: 'Core',
  HighIntensityIntervalTraining: 'HIIT', Running: 'Corsa', Walking: 'Camminata', Hiking: 'Escursione', Cycling: 'Bici',
  Swimming: 'Nuoto', Tennis: 'Tennis', Pickleball: 'Pickleball', Racquetball: 'Racquetball', Squash: 'Squash',
  Padel: 'Padel', Other: 'Altro', MixedCardio: 'Cardio misto', Elliptical: 'Ellittica', Rowing: 'Vogatore',
  Yoga: 'Yoga', Pilates: 'Pilates', Flexibility: 'Flessibilità', CrossTraining: 'Cross training', Soccer: 'Calcio',
  StairClimbing: 'Scale', Cooldown: 'Defaticamento', SocialDance: 'Ballo', CardioDance: 'Cardio dance',
};
const HK_TYPE = {
  TraditionalStrengthTraining: 'palestra', FunctionalStrengthTraining: 'palestra', CoreTraining: 'palestra', CrossTraining: 'palestra',
  Running: 'corsa', Walking: 'camminata', Hiking: 'camminata', Cycling: 'bici', Swimming: 'nuoto', Tennis: 'tennis',
  Padel: 'padel', Pickleball: 'padel', Racquetball: 'padel', Squash: 'padel',
};

const attrs = (s) => { const o = {}; for (const m of s.matchAll(/(\w+)="([^"]*)"/g)) o[m[1]] = m[2]; return o; };
const hkDate = (s) => new Date(s.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'));
const num = (v) => (v == null || v === '' ? null : parseFloat(v));

/** Converte un blocco <Workout ...>...</Workout> in un'attività */
export function workoutFromXml(block) {
  const head = block.slice(0, block.indexOf('>') + 1);
  const a = attrs(head);
  const raw = (a.workoutActivityType || '').replace('HKWorkoutActivityType', '');
  const start = hkDate(a.startDate), end = hkDate(a.endDate);
  if (isNaN(start) || isNaN(end)) return null;
  let dur = num(a.duration);
  if (dur != null && a.durationUnit === 's') dur /= 60;
  if (dur != null && a.durationUnit === 'hr') dur *= 60;
  if (dur == null) dur = (end - start) / 60000;
  let kcal = a.totalEnergyBurned ? num(a.totalEnergyBurned) * (a.totalEnergyBurnedUnit === 'kJ' ? 0.239 : 1) : null;
  let km = a.totalDistance ? num(a.totalDistance) * (a.totalDistanceUnit === 'm' ? 0.001 : a.totalDistanceUnit === 'mi' ? 1.609 : 1) : null;
  let hr = null;
  for (const m of block.matchAll(/<WorkoutStatistics\s[^>]*>/g)) {
    const s = attrs(m[0]);
    const t = s.type || '';
    if (/ActiveEnergyBurned/.test(t) && s.sum) kcal = num(s.sum) * (s.unit === 'kJ' ? 0.239 : 1);
    else if (/Distance/.test(t) && s.sum) km = num(s.sum) * (s.unit === 'm' ? 0.001 : s.unit === 'mi' ? 1.609 : 1);
    else if (/HeartRate$/.test(t) && s.average) hr = num(s.average);
  }
  const title = HK_TITLES[raw] || raw.replace(/([a-z])([A-Z])/g, '$1 $2');
  return {
    source: 'watch', title, type: HK_TYPE[raw] || typeFromText(raw), device: a.sourceName || '',
    start: start.toISOString(), end: end.toISOString(), durationMin: Math.round(dur),
    kcal: kcal != null ? Math.round(kcal) : null, distanceKm: km && km > 0.05 ? Math.round(km * 100) / 100 : null,
    avgHr: hr != null ? Math.round(hr) : null,
    extId: 'hk:' + raw + ':' + start.toISOString().slice(0, 16),
  };
}

/** Estrae i workout da un flusso di testo XML a pezzi */
function makeScanner(onWorkout, since) {
  let buf = '';
  return (text, final) => {
    buf += text;
    let i = 0;
    for (;;) {
      const s = buf.indexOf('<Workout ', i);
      if (s < 0) { i = Math.max(i, buf.length - 16); break; }
      const close = buf.indexOf('>', s);
      if (close < 0) { i = s; break; }
      let endIdx;
      if (buf[close - 1] === '/') endIdx = close + 1;
      else { const e = buf.indexOf('</Workout>', close); if (e < 0) { i = s; break; } endIdx = e + 10; }
      const block = buf.slice(s, endIdx);
      const w = workoutFromXml(block);
      if (w && (!since || new Date(w.start) >= since)) onWorkout(w);
      i = endIdx;
    }
    buf = final ? '' : buf.slice(i);
  };
}

/**
 * Legge un File (export.zip oppure il solo .xml). onProgress(frazione 0..1).
 * Ritorna l'elenco degli allenamenti dal giorno `since` in poi.
 */
export async function readHealthExport(file, { since = null, onProgress = () => {} } = {}) {
  const out = [];
  const scan = makeScanner((w) => out.push(w), since);
  const reader = file.stream().getReader();
  let read = 0;
  const isZip = /\.zip$/i.test(file.name) || file.type.includes('zip');
  if (!isZip) {
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.length; onProgress(read / file.size);
      scan(dec.decode(value, { stream: true }), false);
      await idle();
    }
    scan(dec.decode(), true);
    return out;
  }
  const { Unzip, UnzipInflate } = window.fflate;
  let found = false, finished = false, error = null;
  const unzip = new Unzip((f) => {
    // export.xml (inglese) o esportazione.xml (italiano); esclude export_cda.xml e i percorsi GPX
    if (!/(^|\/)(export|esportazione|exportar|exporter)[^/_]*\.xml$/i.test(f.name) || /cda/i.test(f.name)) return;
    found = true;
    const dec = new TextDecoder();
    f.ondata = (err, chunk, final) => {
      if (err) { error = err; return; }
      scan(dec.decode(chunk, { stream: !final }), final);
      if (final) finished = true;
    };
    f.start();
  });
  unzip.register(UnzipInflate);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) { unzip.push(new Uint8Array(0), true); break; }
    read += value.length; onProgress(read / file.size);
    // pezzi piccoli per non bloccare l'interfaccia
    for (let o = 0; o < value.length; o += 1 << 20) unzip.push(value.subarray(o, o + (1 << 20)), false);
    if (error) throw error;
    await idle();
  }
  if (error) throw error;
  if (!found) throw new Error('Nel file non trovo export.xml: è l\'export di Salute?');
  if (!finished) console.warn('export.xml non terminato');
  return out;
}
const idle = () => new Promise((r) => setTimeout(r, 0));
