// Confronto tra periodi (scheda Coach): ultimi N giorni contro gli N precedenti. Rendering puro + collegamento al DOM.
import { esc, shortDate } from './views.js';

const num = (v, d = 0) => (v == null ? '—' : (d === 0 ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : v.toFixed(d).replace('.', ',')));
const DEC = { weight: 2, fat: 1, kcal: 0, protein: 0, sleep: 0, steps: 0, recovery: 0 };
const val = (m, v) => (v == null ? '—' : m.key === 'sleep' ? `${Math.floor(v / 60)} h ${String(Math.round(v % 60)).padStart(2, '0')}` : `${num(v, DEC[m.key] ?? 0)} ${m.unit}`);
const dlt = (m) => {
  if (m.delta == null) return '<span class="cmp-d muted">confronto non disponibile</span>';
  const s = m.delta > 0 ? '▲' : m.delta < 0 ? '▼' : '=';
  const amount = m.key === 'sleep' ? `${Math.abs(Math.round(m.delta))} min` : `${num(Math.abs(m.delta), DEC[m.key] ?? 0)} ${m.unit}`;
  return `<span class="cmp-d">${s} ${m.delta === 0 ? 'invariato' : amount}${m.delta_pct != null && m.delta !== 0 ? ` (${m.delta_pct > 0 ? '+' : '−'}${num(Math.abs(m.delta_pct), 1)}%)` : ''}</span>`;
};

export function compareView(d) {
  const chips = d.periods.map(p => `<button class="chip" type="button" data-cmp="${p}" aria-pressed="${p === d.days}">${p} gg</button>`).join('');
  const rows = d.metrics.map(m => `<li><span class="rowmain"><strong>${esc(m.label)}</strong><small>prima: ${esc(val(m, m.previous.value))} · ${m.previous.n} ${m.previous.n === 1 ? 'dato' : 'dati'}</small></span><span class="cmp-r"><strong>${esc(val(m, m.current.value))}</strong>${dlt(m)}<small>${m.current.n} ${m.current.n === 1 ? 'dato' : 'dati'}</small></span></li>`).join('');
  const t = d.training;
  const tr = t ? `<h3 class="sec">Allenamento</h3><ul class="rows"><li><span class="rowmain"><strong>Sedute di forza</strong><small>prima: ${t.sessions.previous}</small></span><span class="cmp-r"><strong>${t.sessions.current}</strong><span class="cmp-d">${t.sessions.delta > 0 ? '▲ +' : t.sessions.delta < 0 ? '▼ −' : '= '}${t.sessions.delta === 0 ? 'invariato' : Math.abs(t.sessions.delta)}</span></span></li><li><span class="rowmain"><strong>Serie dirette a settimana</strong><small>prima: ${num(t.sets_total_per_week.previous, 1)}</small></span><span class="cmp-r"><strong>${num(t.sets_total_per_week.current, 1)}</strong></span></li>${t.muscles.slice(0, 6).map(x => `<li><span class="rowmain"><strong>${esc(x.label)}</strong><small>prima: ${num(x.previous, 1)} serie/sett.</small></span><span class="cmp-r"><strong>${num(x.current, 1)}</strong><span class="cmp-d">${x.delta > 0 ? '▲ +' : x.delta < 0 ? '▼ −' : '= '}${x.delta === 0 ? 'invariato' : num(Math.abs(x.delta), 1)}</span></span></li>`).join('')}</ul>` : '<p class="subtle">Nessun allenamento registrato nei due periodi.</p>';
  return `<h2 class="sec">Confronto tra periodi</h2><div class="chips" id="cmpChips">${chips}</div><p class="subtle">Dal ${esc(shortDate(d.current.from))} al ${esc(shortDate(d.current.to))} contro dal ${esc(shortDate(d.previous.from))} al ${esc(shortDate(d.previous.to))}.</p><ul class="rows cmp">${rows}</ul>${tr}<p class="subtle">${esc(d.note)}</p>`;
}

export function bindCompare({ root, load }) {
  root.addEventListener('click', ev => { const b = ev.target.closest('button[data-cmp]'); if (b) load(Number(b.dataset.cmp)); });
}
