// Rendering puro del report di fase (snapshot salvato alla chiusura). Valori mancanti = "—", mai zero. Nessun DOM: testabile in Node.
import { esc, fullDate } from './views.js';
import { fmtRest, rxLine } from './plan.js';

const n = (v, d = 0, unit = '') => (v == null ? '—' : `${d === 0 ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',')}${unit}`);
const sg = (v, d, unit = '') => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${n(Math.abs(v), d, unit)}`);
const dur = m => (m == null ? '—' : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min`);
const kv = (label, value, small = '') => `<div class="kv"><span>${esc(label)}</span><strong>${value}</strong>${small ? `<small>${small}</small>` : ''}</div>`;
const notes = r => [r.weight?.note, r.nutrition?.note].filter(Boolean).map(t => `<p class="subtle">${esc(t)}</p>`).join('');

export function reportView(r) {
  if (!r) return '<div class="empty">Nessun report salvato per questa fase.</div>';
  const w = r.weight, nu = r.nutrition, t = r.training;
  const muscles = Object.entries(t.sets_per_muscle_week ?? {}).sort((a, b) => b[1] - a[1]);
  const prog = (t.progression ?? []).map(p => `<li><span>${esc(p.exercise)}</span><strong>${sg(p.pct, 1, '%')}</strong><small>${esc(p.metric === 'e1rm_kg' ? 'e1RM' : 'ripetizioni')} ${n(p.first, 1)} → ${n(p.last, 1)} · ${p.sessions} sedute · ${esc(p.trend)}</small></li>`).join('');
  const scheda = (r.scheda ?? []).map(d => `<li><strong>${esc(d.label)}</strong><small>${d.exercises.map(e => esc(`${e.exercise}: ${rxLine(e)}`)).join('<br>') || 'Nessun esercizio'}</small></li>`).join('');
  return `<h2>${esc(r.phase.name ?? 'Fase')}</h2><p class="subtle">${esc(fullDate(r.period.start))} → ${esc(fullDate(r.period.last_day))} · ${n(r.period.weeks, 1)} settimane${r.phase.goal ? ` · ${esc(r.phase.goal)}` : ''}${r.phase.method ? ` · ${esc(r.phase.method)}` : ''}</p>
<div class="kvgrid">${kv('Peso', `${n(w.start_kg, 1)} → ${n(w.end_kg, 1)} kg`, `${sg(w.change_kg, 1, ' kg')} · ${w.rate_pct_week == null ? 'ritmo non calcolabile' : `${sg(w.rate_pct_week, 2, ' %/sett.')}`}`)}${kv('Grasso corporeo', `${n(r.body_fat.start_pct, 1)} → ${n(r.body_fat.end_pct, 1)} %`, `${r.body_fat.n} misure`)}${kv('Calorie medie', n(nu.avg_kcal, 0, ' kcal'), `${nu.complete_days} giorni completi su ${nu.calendar_days}`)}${kv('Proteine', n(nu.avg_protein_g, 0, ' g'), nu.protein_g_per_kg == null ? '' : `${n(nu.protein_g_per_kg, 2)} g/kg`)}${kv('Sonno medio', dur(r.sleep.avg_min), `${r.sleep.nights} notti`)}${kv('Passi medi', n(r.steps.avg, 0), `${r.steps.days} giorni`)}${kv('Sedute di forza', `${n(t.strength_per_week, 1)} / sett.`, `${t.sessions_strength} su ${t.sessions_total} allenamenti`)}${kv('Recupero medio', t.avg_rest_sec == null ? '—' : fmtRest(t.avg_rest_sec), 'dalla scheda in Lyfta')}${kv('RIR medio', n(t.avg_rir_logged, 1), `${t.rir_sets_with_value} serie con RIR`)}${kv('Modifiche alla scheda', String(r.scheda_changes), 'versioni oltre la prima')}</div>${notes(r)}
${muscles.length ? `<h3>Serie dirette per muscolo / settimana</h3><ul class="rows">${muscles.map(([m, v]) => `<li><span>${esc(m)}</span><strong>${n(v, 1)}</strong></li>`).join('')}</ul>` : ''}
${prog ? `<h3>Progressione</h3><ul class="rows prog">${prog}</ul>` : ''}
${scheda ? `<h3>Scheda finale</h3><ul class="rows prog">${scheda}</ul>` : ''}
${r.notes?.length ? `<h3>Note del periodo</h3><ul class="rows">${r.notes.map(x => `<li><span>${esc(fullDate(x.date))} · ${esc(x.category)}</span><strong>${esc(x.title)}</strong></li>`).join('')}</ul>` : ''}`;
}
