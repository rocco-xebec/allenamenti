// Report PDF (jsPDF + autotable caricati come script globali). Grafici rigenerati in tema chiaro per la stampa.

function chartImage(make, w = 900, h = 380) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h; c.style.width = w + 'px'; c.style.height = h + 'px';
  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px`;
  holder.appendChild(c); document.body.appendChild(holder);
  const prevDpr = window.devicePixelRatio;
  const chart = make(c);
  if (!chart) { holder.remove(); return null; }
  chart.options.devicePixelRatio = 2; chart.options.responsive = false; chart.resize(w, h); chart.update('none');
  const out = document.createElement('canvas'); out.width = c.width; out.height = c.height;
  const ctx = out.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height); ctx.drawImage(c, 0, 0);
  const url = out.toDataURL('image/png');
  chart.destroy(); holder.remove();
  void prevDpr;
  return url;
}

export async function exportReportPdf(x) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14;
  const blue = [42, 120, 214], ink = [11, 11, 11], gray = [82, 81, 78];
  const [a, b] = x.range;
  const title = x.kind === 'week'
    ? `Report settimanale · ${x.fmtDate(a, { day: 'numeric', month: 'short' })} – ${x.fmtDate(b.getTime() - 1, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `Report mensile · ${x.fmtDate(a, { month: 'long', year: 'numeric' })}`;
  let y = M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...ink);
  doc.text('Allenamenti', M, y + 4); y += 11;
  doc.setFontSize(12); doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray);
  doc.text(title, M, y); y += 4;
  doc.setDrawColor(221, 220, 214); doc.line(M, y, W - M, y); y += 6;

  // KPI
  const c = x.cur, p = x.prev;
  const delta = (cv, pv) => (pv == null || (cv === 0 && pv === 0) ? '' : pv === 0 ? 'nuovo' : `${cv >= pv ? '+' : '-'}${Math.round(Math.abs(cv - pv) / pv * 100)}%`);
  const kpis = [
    ['Sedute palestra', String(c.sessions.length), delta(c.sessions.length, p.sessions.length)],
    ['Altre attività', String(c.activities.length), delta(c.activities.length, p.activities.length)],
    ['Minuti attivi', x.fmtInt(c.totalMin), delta(c.totalMin, p.totalMin)],
    ['Volume (kg)', x.fmtInt(c.volume), delta(c.volume, p.volume)],
    ['Giorni attivi', String(c.activeDays), delta(c.activeDays, p.activeDays)],
    ['Kcal attive', c.kcal ? x.fmtInt(c.kcal) : '—', c.kcal ? delta(c.kcal, p.kcal) : ''],
  ];
  const bw = (W - 2 * M - 10) / 3;
  kpis.forEach(([l, v, d], i) => {
    const bx = M + (i % 3) * (bw + 5), by = y + Math.floor(i / 3) * 22;
    doc.setFillColor(244, 244, 241); doc.roundedRect(bx, by, bw, 19, 2, 2, 'F');
    doc.setFontSize(8); doc.setTextColor(...gray); doc.text(l.toUpperCase(), bx + 3, by + 5);
    doc.setFontSize(15); doc.setFont('helvetica', 'bold'); doc.setTextColor(...ink); doc.text(v, bx + 3, by + 12.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...gray);
    if (d) doc.text(d + ' vs periodo precedente', bx + 3, by + 17);
  });
  y += 48;

  const section = (t) => {
    if (y > 260) { doc.addPage(); y = M; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...ink); doc.text(t, M, y); y += 3;
    doc.setFont('helvetica', 'normal');
  };
  const table = (head, body, opts = {}) => {
    doc.autoTable({ startY: y, head: [head], body, margin: { left: M, right: M }, theme: 'plain',
      styles: { fontSize: 9, cellPadding: 1.8, textColor: ink, lineColor: [221, 220, 214], lineWidth: { bottom: 0.2 } },
      headStyles: { textColor: gray, fontStyle: 'bold', fontSize: 8 }, columnStyles: opts.cols || {} });
    y = doc.lastAutoTable.finalY + 8;
  };
  const image = (url, h = 70) => {
    if (!url) return;
    if (y + h > 285) { doc.addPage(); y = M; }
    doc.addImage(url, 'PNG', M, y, W - 2 * M, h); y += h + 6;
  };

  section('Attività per tipo');
  const types = Object.entries(c.byType).filter(([, v]) => v.count).sort((q, r) => r[1].minutes - q[1].minutes);
  table(['Tipo', 'Volte', 'Minuti'], types.length ? types.map(([t, v]) => [x.TYPE_LABEL[t] || t, v.count, x.fmtMin(v.minutes)]) : [['Nessuna attività', '', '']], { cols: { 1: { halign: 'right' }, 2: { halign: 'right' } } });

  section('Frequenza settimanale (ultime 12 settimane) · blu = palestra, arancio = altre attività');
  y += 2; image(chartImage((cv) => x.freqChart(cv, x.weekly, true, false)), 62);

  section('Volume per gruppo muscolare');
  const mus = Object.entries(c.muscles).filter(([, v]) => v.sets > 0).sort((q, r) => r[1].volume - q[1].volume);
  table(['Muscolo', 'Volume (kg)', 'Serie effettive'], mus.length ? mus.map(([m, v]) => [m, x.fmtInt(v.volume), x.dec(v.sets)]) : [['Nessuna seduta', '', '']], { cols: { 1: { halign: 'right' }, 2: { halign: 'right' } } });

  section('Volume settimanale (kg)');
  y += 2; image(chartImage((cv) => x.volChart(cv, x.weekly, true, false)), 55);

  section('Sedute in palestra');
  table(['Data', 'Scheda', 'Durata', 'Serie', 'Volume (kg)'], c.sessions.length ? c.sessions.map((s) => [
    x.fmtDate(s.start), s.routineName, x.fmtMin(Math.round((new Date(s.end) - new Date(s.start)) / 60000)), s.sets.filter((q) => q.done).length + '/' + s.sets.length,
    x.fmtInt(s.sets.reduce((acc, q) => acc + (q.done && q.unit !== 'sec' && q.weight ? q.reps * q.weight * (q.perHand ? 2 : 1) * (q.perSide ? 2 : 1) : 0), 0))]) : [['—', '', '', '', '']],
  { cols: { 4: { halign: 'right' } } });

  if (c.activities.length) {
    section('Altre attività');
    table(['Data', 'Attività', 'Durata', 'Kcal', 'Fonte'], c.activities.sort((q, r) => q.start.localeCompare(r.start)).map((q) => [
      x.fmtDate(q.start), q.title || x.TYPE_LABEL[q.type], x.fmtMin(q.durationMin), q.kcal ? x.fmtInt(q.kcal) : '—',
      q.sources.map((s) => ({ calendar: 'Calendario', watch: 'Watch', manual: 'Manuale' }[s] || s)).join(' + ')]));
  }

  const wl = x.state.weightLog.filter((w) => new Date(w.date) >= a && new Date(w.date) < b);
  section('Aumenti di carico nel periodo');
  table(['Data', 'Esercizio', 'Da', 'A'], wl.length ? wl.map((w) => [x.fmtDate(w.date), w.name, x.fmtKg(w.from), x.fmtKg(w.to)]) : [['Nessuna modifica', '', '', '']],
    { cols: { 2: { halign: 'right' }, 3: { halign: 'right' } } });

  section('Progressione da inizio storico');
  table(['Esercizio', 'Scheda', 'Inizio', 'Ora', 'Variazione', 'e1RM migliore'], x.improvements.length ? x.improvements.map((r) => [
    r.name, r.routine, x.fmtKg(r.first), x.fmtKg(r.now), (r.delta > 0 ? '+' : '') + x.dec(r.delta) + (r.pct ? ` (${r.pct > 0 ? '+' : ''}${x.dec(r.pct, 0)}%)` : ''),
    r.e1Best ? x.dec(r.e1Best, 0) + ' kg' : '—']) : [['—', '', '', '', '', '']], { cols: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } });

  // grafici di progressione per gli esercizi con storico
  const withHist = Object.values(x.exIndex).filter((e) => x.state.sessions.some((s) => s.sets.some((q) => q.exerciseId === e.id && q.done)));
  for (const e of withHist.slice(0, 8)) {
    section(`${e.name} · carico (blu) e massimale stimato (arancio)`);
    y += 2; image(chartImage((cv) => x.progChart(cv, e.id, true, false), 900, 300), 48);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...gray);
    doc.text(`Generato il ${new Date().toLocaleDateString('it-IT')} · pagina ${i}/${pages}`, M, 292);
  }
  void blue;
  return doc.output('blob');
}
