// Rendering puro (stringhe HTML/SVG) per Alimentazione, Sonno e Passi. Nessun accesso al DOM: testabile in Node.
// Un giorno senza dati è un VUOTO nel grafico (mai una barra a zero); i valori mancanti sono "—".
import { esc, shortDate, fullDate } from './views.js';

const fmtInt = n => (n == null ? '—' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
const fmtG = n => (n == null ? '—' : `${String(Math.round(n * 10) / 10).replace('.', ',')} g`);
const fmtDur = m => (m == null ? '—' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min`);
const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '');
const MEAL_IT = { Breakfast: 'Colazione', Lunch: 'Pranzo', Dinner: 'Cena', Other: 'Altro' };
const kv = (label, value, small = '') => `<div class="kv"><span>${esc(label)}</span><strong>${value}</strong>${small ? `<small>${small}</small>` : ''}</div>`;

// ---- Grafico a barre su asse temporale reale (i giorni mancanti restano vuoti) ----
const W = 360, H = 190, PADL = 40, PADR = 10, PADT = 12, PADB = 26;
/** @param {{date:string, value:number, cls?:string}[]} items ordinati per data crescente */
export function barChart(items, { yMax, tickFmt, label }) {
  if (!items.length) return '<div class="empty">Nessun dato nel periodo.</div>';
  const DAY = 86400000, t0 = Date.parse(items[0].date), t1 = Date.parse(items.at(-1).date);
  const nDays = Math.round((t1 - t0) / DAY) + 1, slot = (W - PADL - PADR) / nDays, bw = Math.max(slot * 0.72, 1.2);
  const x = d => PADL + Math.round((Date.parse(d) - t0) / DAY) * slot + (slot - bw) / 2;
  const y = v => PADT + (1 - Math.min(v, yMax) / yMax) * (H - PADT - PADB);
  const base = y(0);
  const grid = [0, yMax / 2, yMax].map(v => `<line x1="${PADL}" x2="${W - PADR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/><text x="${PADL - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" class="axis">${esc(tickFmt(v))}</text>`).join('');
  const bars = items.map(i => `<rect x="${x(i.date).toFixed(1)}" y="${Math.min(y(i.value), base - 1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(base - y(i.value), 1).toFixed(1)}" rx="1.5" class="bar ${i.cls ?? ''}"/>`).join('');
  const marks = [items[0], items[Math.floor(items.length / 2)], items.at(-1)];
  const xl = marks.map((m, k) => `<text x="${(x(m.date) + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}" class="axis">${esc(shortDate(m.date))}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}${bars}${xl}</svg>`;
}

// ---- Alimentazione ----
export function nutritionSummary(d) {
  const a = d.averages, n = a.calories.n;
  const small = k => (a[k].n ? `media su ${a[k].n} ${a[k].n === 1 ? 'giorno' : 'giorni'}` : 'nessun giorno completo');
  const note = [`Medie sui giorni completi con voci: la giornata in corso non è inclusa.`, d.empty_days > 0 ? `${d.empty_days} ${d.empty_days === 1 ? 'giorno' : 'giorni'} senza alcuna voce nel periodo (non conteggiati, non sono zero).` : ''].filter(Boolean).join(' ');
  return `<div class="kvgrid">${kv('Calorie', a.calories.value == null ? '—' : `${fmtInt(a.calories.value)} kcal`, n ? small('calories') : 'nessun giorno completo')}${kv('Proteine', fmtG(a.protein.value), small('protein'))}${kv('Carboidrati', fmtG(a.carbohydrate.value), small('carbohydrate'))}${kv('Grassi', fmtG(a.fat.value), small('fat'))}</div><p class="subtle">${esc(note)}</p>`;
}

function mealBlock(m) {
  const rows = m.entries.map(e => `<li><span class="eName"><strong>${esc(e.name ?? 'Voce')}</strong><small>${esc(e.description ?? '')}</small></span><span class="eKcal">${e.calories == null ? '—' : `${fmtInt(e.calories)} kcal`}</span></li>`).join('');
  return `<div class="meal"><div class="mealHead"><strong>${esc(MEAL_IT[m.meal] ?? m.meal)}</strong><span>${m.calories == null ? '—' : `${fmtInt(m.calories)} kcal`}</span></div><ul class="entries">${rows}</ul></div>`;
}

export function nutritionDays(d) {
  if (!d.by_day.length) return '<div class="empty">Nessuna voce di diario nel periodo.</div>';
  return d.by_day.map(day => {
    const t = day.totals;
    const macro = `P ${fmtG(t.protein)} · C ${fmtG(t.carbohydrate)} · G ${fmtG(t.fat)}`;
    const warn = day.incomplete_entries > 0 ? `<p class="subtle">${day.incomplete_entries} ${day.incomplete_entries === 1 ? 'voce senza calorie' : 'voci senza calorie'}: il totale è parziale.</p>` : '';
    return `<details class="wcard"><summary><span class="date">${esc(shortDate(day.date))}</span><span class="wmain"><strong>${t.calories == null ? '—' : `${fmtInt(t.calories)} kcal`}${day.partial ? ' <span class="tag">in corso</span>' : ''}</strong><small>${esc(macro)}</small></span></summary>${day.meals.map(mealBlock).join('')}${warn}</details>`;
  }).join('');
}

// ---- Sonno ----
export function sleepSummary(d) {
  if (!d.count) return '<div class="empty">Nessuna notte nel periodo.</div>';
  let delta = 'dati insufficienti per il confronto';
  if (d.delta_min_7 != null) delta = d.delta_min_7 === 0 ? 'in linea con le 7 notti prima' : `${sign(d.delta_min_7)}${Math.abs(d.delta_min_7)} min rispetto alle 7 notti prima`;
  const big = d.avg_min_7 == null ? '—' : fmtDur(d.avg_min_7);
  const shortNote = d.short_count ? `${d.short_count} ${d.short_count === 1 ? 'notte breve' : 'notti brevi'} (sotto 3 h) non ${d.short_count === 1 ? 'incide' : 'incidono'} sulle medie.` : '';
  return `<div class="bigweight"><strong>${big}</strong><small>media delle ultime ${d.n_7} notti · ${esc(delta)}</small></div>
<div class="kvgrid">${kv('Media del periodo', fmtDur(d.avg_min_window), `${d.count - d.short_count} notti regolari`)}${kv('Notte più lunga', fmtDur(d.longest?.duration_min), esc(shortDate(d.longest?.date)))}${kv('Notte più corta', fmtDur(d.shortest?.duration_min), esc(shortDate(d.shortest?.date)))}${kv('Notti brevi', String(d.short_count), 'escluse dalle medie')}</div>${shortNote ? `<p class="subtle">${esc(shortNote)}</p>` : ''}`;
}

export function sleepChart(d) {
  const items = d.nights.filter(n => n.date).map(n => ({ date: n.date, value: n.duration_min, cls: n.short ? 'short' : '' }));
  const max = Math.max(0, ...items.map(i => i.value));
  const yMax = Math.max(Math.ceil(max / 120) * 120, 480);
  return barChart(items, { yMax, tickFmt: v => `${Math.round(v / 60)} h`, label: 'Durata del sonno per notte' });
}

export function sleepList(d) {
  const rows = [...d.nights].reverse().slice(0, 14).map(n => {
    const tags = [n.short ? '<span class="tag warn">breve</span>' : '', n.quality_pct != null ? `<span class="tag">qualità ${n.quality_pct}%</span>` : '', n.cycles != null ? `<span class="tag">${n.cycles} cicli</span>` : ''].join('');
    return `<li><span class="rowmain"><strong>${esc(shortDate(n.date))}</strong><small>${esc(n.start_local ?? '—')} → ${esc(n.end_local ?? '—')}</small></span><span class="rowtags">${tags}</span><strong>${fmtDur(n.duration_min)}</strong></li>`;
  }).join('');
  return rows ? `<ul class="rows sleeprows">${rows}</ul>` : '';
}

// ---- Passi ----
export function stepsSummary(d) {
  const today = d.today_count == null ? '—' : fmtInt(d.today_count);
  const todayNote = d.today_count == null ? 'nessun dato di oggi' : 'passi oggi · giornata in corso';
  let delta = 'dati insufficienti per il confronto';
  if (d.delta_7 != null) delta = d.delta_7 === 0 ? 'in linea con i 7 giorni prima' : `${sign(d.delta_7)}${fmtInt(Math.abs(d.delta_7))} rispetto ai 7 giorni prima`;
  return `<div class="bigweight"><strong>${today}</strong><small>${todayNote}</small></div>
<div class="kvgrid">${kv('Media 7 giorni', d.avg_7 == null ? '—' : fmtInt(d.avg_7), `${esc(delta)} · ${d.n_7} giorni con dati`)}${kv('Media del periodo', d.avg_window == null ? '—' : fmtInt(d.avg_window), `${d.n_window} giorni completi`)}${kv('Giorno migliore', d.best ? fmtInt(d.best.count) : '—', esc(shortDate(d.best?.date)))}${kv('Giorni senza dati', String(d.missing_days), 'non contati come zero')}</div>`;
}

export function stepsChart(d) {
  const items = d.series.map(s => ({ date: s.date, value: s.count, cls: s.date === d.today ? 'partial' : '' }));
  const max = Math.max(0, ...items.map(i => i.value));
  const yMax = Math.max(Math.ceil(max / 2000) * 2000, 2000);
  return barChart(items, { yMax, tickFmt: v => fmtInt(v), label: 'Passi per giorno' });
}

export function stepsList(d) {
  const rows = [...d.series].reverse().slice(0, 10).map(s => `<li><span>${esc(fullDate(s.date))}${s.date === d.today ? ' <span class="tag">in corso</span>' : ''}</span><strong>${fmtInt(s.count)}</strong></li>`).join('');
  return rows ? `<ul class="rows">${rows}</ul>` : '';
}
