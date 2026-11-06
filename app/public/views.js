// Rendering puro (stringhe HTML/SVG) per le viste Allenamenti e Peso. Nessun accesso al DOM: testabile in Node.
// Tutto ciò che arriva dall'API passa da esc() prima di entrare nell'HTML.
export const esc = s => String(s ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '—';
}
export const fullDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ''); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '—'; };

// Arrotondamento "metà verso l'alto" sul valore decimale (toFixed sbaglia su 71.85 -> "71.8" per la rappresentazione binaria).
const fix = (v, d) => { const r = Math.round(Number(`${v}e${d}`)); return Number.isFinite(r) ? (r / 10 ** d).toFixed(d) : v.toFixed(d); };
const fmtKg = (v, d = 1) => (v == null ? '—' : `${fix(v, d).replace('.', ',')} kg`);
const fmtSigned = (v, d = 1) => (v == null ? null : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fix(Math.abs(v), d).replace('.', ',')} kg`);
const fmtNum = v => String(Math.round(v * 100) / 100).replace('.', ',');
const mmss = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

// ---- Allenamenti ----
export function setLine(s) {
  const parts = [];
  if (s.reps != null && s.external_load_kg != null && s.external_load_kg > 0) parts.push(`${fmtNum(s.reps)} × ${fmtNum(s.external_load_kg)} kg`);
  else if (s.reps != null) parts.push(`${fmtNum(s.reps)} rep`);
  if (s.duration_sec != null) parts.push(mmss(s.duration_sec));
  if (s.distance != null) parts.push(`dist. ${fmtNum(s.distance)}`); // unità non documentata: nessuna inventata
  if (s.rir != null) parts.push(`RIR ${fmtNum(s.rir)}`);
  const body = parts.length ? parts.join(' · ') : 'dato non registrato';
  const tag = s.warmup ? '<span class="tag">risc.</span>' : s.set_type && s.set_type !== 'NORMAL' ? `<span class="tag">${esc(s.set_type.toLowerCase())}</span>` : '';
  return `<li>${tag}<span>${esc(body)}</span></li>`;
}

export function workoutCard(w) {
  const s = w.summary;
  const bits = [`${s.exercises} esercizi`, `${s.working_sets} serie`];
  if (s.reps_total != null) bits.push(`${fmtNum(s.reps_total)} rep`);
  if (s.external_load_volume_kg != null) bits.push(`${fmtNum(s.external_load_volume_kg)} kg di carico esterno`);
  const exercises = w.exercises.map(e => `<div class="ex"><strong>${esc(e.name ?? 'Esercizio')}</strong><ul class="sets">${e.sets.map(setLine).join('')}</ul></div>`).join('');
  return `<details class="wcard"><summary><span class="date">${esc(shortDate(w.date))}</span><span class="wmain"><strong>${esc(w.title ?? 'Allenamento')}</strong><small>${esc(bits.join(' · '))}</small></span></summary>${exercises || '<p class="subtle">Nessun esercizio registrato.</p>'}</details>`;
}

export function trainingList(d) {
  if (!d.workouts.length) return '<div class="empty">Nessun allenamento acquisito.</div>';
  return d.workouts.map(workoutCard).join('');
}

// ---- Peso ----
const W = 360, H = 190, PADL = 38, PADR = 12, PADT = 12, PADB = 26;

/** Grafico a linea sul peso giornaliero. viewBox fisso e proporzioni mantenute (niente deformazione del testo). */
export function weightChart(daily, { label = 'peso', empty = 'Servono almeno due giorni di pesate per il grafico.', dec = 1 } = {}) {
  if (!daily || daily.length < 2) return `<div class="empty">${esc(empty)}</div>`;
  const kgs = daily.map(d => d.kg), lo = Math.min(...kgs), hi = Math.max(...kgs);
  const pad = Math.max((hi - lo) * 0.15, 0.3), yMin = lo - pad, yMax = hi + pad;
  const t0 = Date.parse(daily[0].date), t1 = Date.parse(daily.at(-1).date), span = Math.max(t1 - t0, 1);
  const x = d => PADL + ((Date.parse(d) - t0) / span) * (W - PADL - PADR);
  const y = k => PADT + (1 - (k - yMin) / (yMax - yMin)) * (H - PADT - PADB);
  const path = daily.map((d, i) => `${i ? 'L' : 'M'}${x(d.date).toFixed(1)} ${y(d.kg).toFixed(1)}`).join(' ');
  const ticks = [yMin + pad * 0.5, (yMin + yMax) / 2, yMax - pad * 0.5];
  const grid = ticks.map(v => `<line x1="${PADL}" x2="${W - PADR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/><text x="${PADL - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" class="axis">${v.toFixed(dec).replace('.', ',')}</text>`).join('');
  const last = daily.at(-1);
  const dots = daily.length <= 60 ? daily.map(d => `<circle cx="${x(d.date).toFixed(1)}" cy="${y(d.kg).toFixed(1)}" r="2.4" class="dot"/>`).join('') : '';
  const xl = [daily[0], daily[Math.floor(daily.length / 2)], last];
  const xlabels = xl.map((d, i) => `<text x="${x(d.date).toFixed(1)}" y="${H - 7}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}" class="axis">${esc(shortDate(d.date))}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento del ${esc(label)} dal ${esc(fullDate(daily[0].date))} al ${esc(fullDate(last.date))}">${grid}<path d="${path}" class="line"/>${dots}<circle cx="${x(last.date).toFixed(1)}" cy="${y(last.kg).toFixed(1)}" r="4.2" class="dot last"/>${xlabels}</svg>`;
}

export function weightSummary(d) {
  if (!d.latest) return '<div class="empty">Nessuna pesata nel periodo.</div>';
  const delta = fmtSigned(d.delta_7d);
  const trend = d.avg_7d == null ? '' : `<div class="kv"><span>Media ultimi 7 giorni</span><strong>${fmtKg(d.avg_7d)}</strong><small>${delta ? `${delta} rispetto ai 7 giorni prima` : 'dati insufficienti per il confronto'}</small></div>`;
  const win = fmtSigned(d.change_in_window);
  return `<div class="bigweight"><strong>${fmtKg(d.latest.kg)}</strong><small>ultima pesata · ${esc(fullDate(d.latest.local_date))}</small></div>
<div class="kvgrid">${trend}
<div class="kv"><span>Nel periodo</span><strong>${win ?? '—'}</strong><small>${d.count} pesate</small></div>
<div class="kv"><span>Minimo</span><strong>${fmtKg(d.min?.kg)}</strong><small>${esc(shortDate(d.min?.local_date))}</small></div>
<div class="kv"><span>Massimo</span><strong>${fmtKg(d.max?.kg)}</strong><small>${esc(shortDate(d.max?.local_date))}</small></div></div>`;
}

export function weightRecent(d) {
  const note = d.excluded_count > 0 ? `<p class="subtle">${d.excluded_count} ${d.excluded_count === 1 ? 'pesata esclusa' : 'pesate escluse'} manualmente (non mostrate).</p>` : '';
  const excluded = (d.excluded ?? []).length ? `<h3 class="sec">Pesate escluse</h3><ul class="rows">${d.excluded.map(x => `<li><span class="rowmain"><strong>${x.kg == null ? '—' : fmtKg(x.kg, 2)}</strong><small>${esc(fullDate(String(x.time).slice(0, 10)))}${x.reason ? ` · ${esc(x.reason)}` : ''}</small></span><button type="button" class="pbtn sec" data-wact="restore" data-time="${esc(x.time)}">Ripristina</button></li>`).join('')}</ul>` : '';
  if (!d.recent.length) return note + excluded;
  return `<ul class="rows">${d.recent.map(p => `<li><span>${esc(fullDate(p.local_date))}</span><strong>${fmtKg(p.kg, 2)}</strong>${p.time ? `<button type="button" class="pbtn sec" data-wact="exclude" data-time="${esc(p.time)}" aria-label="Escludi la pesata del ${esc(p.local_date)}">Escludi</button>` : ''}</li>`).join('')}</ul>${note}${excluded}`;
}

/** Grasso corporeo (scritto da Renpho in Health Connect). Vuoto se non ci sono misure: mai un valore inventato. */
export function bodyFatBlock(d) {
  const f = d.body_fat;
  if (!f || !f.count) return '';
  const pc = (v, dec = 1) => (v == null ? '—' : `${fix(v, dec).replace('.', ',')}%`);
  const sg = v => (v == null ? null : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fix(Math.abs(v), 1).replace('.', ',')} punti`);
  const delta = sg(f.delta_7d), win = sg(f.change_in_window);
  const chart = weightChart(f.daily.map(x => ({ date: x.date, kg: x.pct })), { label: 'grasso corporeo', empty: 'Servono almeno due giorni di misure per il grafico.' });
  return `<h2 class="sec">Grasso corporeo</h2><div class="bigweight"><strong>${pc(f.latest.pct)}</strong><small>ultima misura · ${esc(fullDate(f.latest.local_date))}</small></div>
<div class="kvgrid"><div class="kv"><span>Media ultimi 7 giorni</span><strong>${pc(f.avg_7d)}</strong><small>${delta ? `${delta} rispetto ai 7 giorni prima` : 'dati insufficienti per il confronto'}</small></div>
<div class="kv"><span>Nel periodo</span><strong>${win ?? '—'}</strong><small>${f.count} misure</small></div></div>
<p class="subtle">La bilancia è un'impedenziometria: il valore varia con idratazione e orario, conta il trend, non la singola misura.</p><div class="chartbox">${chart}</div>`;
}
