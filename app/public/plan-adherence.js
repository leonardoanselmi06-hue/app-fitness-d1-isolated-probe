// Rendering puro dell'aderenza alla scheda (prescritto vs eseguito). Valori mancanti = "—", mai zero. Nessun DOM: testabile in Node.
import { esc, shortDate } from './views.js';
import { fmtRest } from './plan.js';

const P = v => (v == null ? '—' : `${v} %`);
const sg = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${String(Math.abs(Math.round(v * 10 ** d) / 10 ** d)).replace('.', ',')}`);
const kv = (label, value, small = '') => `<div class="kv"><span>${esc(label)}</span><strong>${value}</strong>${small ? `<small>${esc(small)}</small>` : ''}</div>`;
const STATUS = { completo: 'ok', parziale: 'warn', saltato: 'bad', sostituito: 'info' };

function exLine(r) {
  if (r.kind === 'cardio') return [r.minutes_done == null ? 'durata non registrata' : `${String(r.minutes_done).replace('.', ',')} min`, r.minutes_prescribed != null ? `previsti ${r.minutes_prescribed} min` : null].filter(Boolean).join(' · ');
  const bits = [`${r.sets_done}/${r.sets_prescribed} serie`];
  if (r.reps) bits.push(`ripetizioni: ${r.reps.in} nel range${r.reps.below ? `, ${r.reps.below} sotto` : ''}${r.reps.above ? `, ${r.reps.above} sopra` : ''}`);
  if (r.rir_diff != null) bits.push(`RIR ${String(r.rir_logged).replace('.', ',')} (previsto ${String(r.rir_target).replace('.', ',')})`);
  if (r.rest_match === false) bits.push(`recupero ${fmtRest(r.rest_logged)} (previsto ${fmtRest(r.rest_prescribed)})`);
  if (r.replaced_by) bits.push(`al posto di: ${r.replaced_by}`);
  return bits.join(' · ');
}
const session = m => `<li class="adh-s"><div><strong>${esc(m.day)}</strong> ${m.secondary ? '<span class="tag info">secondaria</span> ' : ''}<small>${esc(shortDate(m.date))} · ${P(m.completion_pct)} ${m.secondary ? 'dei minuti' : 'delle serie'}</small></div><ul class="adh-ex">${m.exercises.map(r => `<li><span class="tag ${STATUS[r.status]}">${esc(r.status)}</span> <strong>${esc(r.exercise)}</strong><small>${esc(exLine(r))}</small></li>`).join('')}${m.extras.map(e => `<li><span class="tag info">extra</span> <strong>${esc(e.exercise)}</strong><small>${e.sets} serie fuori scheda</small></li>`).join('')}</ul></li>`;

export function adherenceView(a) {
  if (!a) return '';
  const head = '<h2 class="sec">Aderenza alla scheda</h2>';
  if (!a.sessions.matched) return `${head}<div class="empty">Nessuna seduta di Lyfta corrisponde ai giorni della scheda${a.sessions.unmatched_strength ? ` (${a.sessions.unmatched_strength} sedute di forza con titoli non in scheda)` : ''}. I titoli devono coincidere con i nomi dei giorni.</div>`;
  const cardio = a.cardio?.sessions ? `<h3>Cardio e attività secondarie</h3><div class="kvgrid">${kv('Sedute di cardio', String(a.cardio.sessions), `${String(a.cardio.sessions_per_week).replace('.', ',')} a settimana`)}${kv('Minuti totali', String(a.cardio.minutes), `${a.cardio.minutes_per_week} min a settimana`)}${a.secondary?.sessions ? kv('Minuti come da piano', P(a.secondary.completion_pct), `${a.secondary.minutes_done} su ${a.secondary.minutes_prescribed ?? '—'} min`) : ''}</div><p class="subtle">Il cardio non conta come lavoro di forza. Minuti = durate registrate in Lyfta.</p>` : '';
  const weak = a.per_exercise.filter(e => e.completion_pct != null && e.completion_pct < 100).slice(0, 6);
  return `${head}<div class="kvgrid">${kv('Serie fatte', P(a.sets.completion_pct), `${a.sets.done} su ${a.sets.prescribed} prescritte`)}${kv('Ripetizioni nel range', P(a.reps_in_range_pct), 'sulle serie con range in scheda')}${kv('RIR registrato − previsto', sg(a.rir_diff_avg), a.rir_diff_avg == null ? 'nessun RIR confrontabile' : a.rir_diff_avg > 0 ? 'più margine del previsto' : a.rir_diff_avg < 0 ? 'più vicino al cedimento' : 'in linea')}${kv('Recupero come da scheda', P(a.rest_match_pct), `${a.rest_compared} confronti`)}${kv('Esercizi saltati', String(a.exercises.skipped), `${a.exercises.partial} parziali · ${a.exercises.substituted} sostituiti`)}${kv('Sedute confrontate', String(a.sessions.matched), a.sessions.unmatched_strength ? `${a.sessions.unmatched_strength} di forza fuori scheda` : 'tutte quelle di forza')}</div>
${a.note ? `<p class="subtle">${esc(a.note)}</p>` : ''}
${a.days_never_done.length ? `<p class="subtle">Giorni mai svolti nel periodo: ${a.days_never_done.map(esc).join(', ')}</p>` : ''}
${a.unmatched_titles.length ? `<p class="subtle">Sedute di forza con titolo non in scheda: ${a.unmatched_titles.map(t => `${esc(t.title)} (${t.sessions})`).join(', ')}</p>` : ''}
${cardio}
<h3>Per giorno</h3><ul class="rows">${a.per_day.map(d => `<li><span>${esc(d.day)}</span><strong>${P(d.completion_pct)}</strong><small>${d.sessions} ${d.sessions === 1 ? 'seduta' : 'sedute'} · ultima ${esc(shortDate(d.last_date))}</small></li>`).join('')}</ul>
${weak.length ? `<h3>Dove si perde di più</h3><ul class="rows prog">${weak.map(e => `<li><span>${esc(e.exercise)}</span><strong>${P(e.completion_pct)}</strong><small>${esc(e.day)} · ${e.exposures} sedute${e.skipped ? ` · saltato ${e.skipped}×` : ''}</small></li>`).join('')}</ul>` : ''}
<h3>Ultime sedute</h3><ul class="adh">${a.recent.map(session).join('')}</ul>
<p class="subtle">Ogni seduta è confrontata con la scheda in vigore quel giorno. "Sostituito" = esercizio saltato e uno fuori scheda sullo stesso muscolo (ipotesi, non certezza).</p>`;
}

/** Riquadro compatto per il report di fase (snapshot). */
export function adherenceSummaryView(a) {
  if (!a || !a.sessions?.matched) return '';
  return `<h3>Aderenza alla scheda</h3><div class="kvgrid">${kv('Serie fatte', P(a.sets.completion_pct), `${a.sets.done} su ${a.sets.prescribed}`)}${kv('Ripetizioni nel range', P(a.reps_in_range_pct))}${kv('RIR registrato − previsto', sg(a.rir_diff_avg))}${kv('Esercizi saltati', String(a.exercises.skipped), `${a.exercises.partial} parziali · ${a.exercises.substituted} sostituiti`)}</div>`
    + (a.worst_exercises?.length ? `<ul class="rows prog">${a.worst_exercises.map(e => `<li><span>${esc(e.exercise)}</span><strong>${P(e.completion_pct)}</strong><small>${esc(e.day)} · ${e.exposures} sedute</small></li>`).join('')}</ul>` : '');
}
