// Scheda Cardio: solo monitoraggio (tempo per fascia a settimana, frequenza media). Rendering puro (stringhe HTML).
import { esc, shortDate } from './views.js';
const n1 = v => (v == null ? '—' : String(Math.round(v * 10) / 10).replace('.', ','));
const kv = (label, value, small = '') => `<div class="kv"><span>${esc(label)}</span><strong>${value}</strong>${small ? `<small>${esc(small)}</small>` : ''}</div>`;
const zlabel = b => `Z${b.zone} ${b.lower}–${b.upper}`;

export function cardioSummary(d) {
  const z2 = d.bands?.[1];
  return `<div class="kvgrid">${kv('Zona 2 a settimana', d.z2_avg_4w == null ? '—' : `${n1(d.z2_avg_4w)} min`, d.z2_avg_4w == null ? 'servono 4 settimane complete con dettaglio' : `media delle ultime 4 settimane complete${z2 ? ` · ${z2.lower}–${z2.upper} bpm` : ''}`)}</div>
<p class="subtle">${esc(d.zone_note)}</p><p class="subtle">${esc(d.pace_note)}</p>`;
}

export function cardioWeeks(d) {
  if (!d.weeks_list.some(w => w.sessions)) return '<div class="empty">Nessuna seduta cardio nel periodo.</div>';
  return `<ul class="rows">${d.weeks_list.map(w => {
    const dist = w.zone_min[0] == null ? '' : ` · ${w.zone_min.map((m, i) => `Z${i + 1} ${n1(m)}`).join(' · ')} min`;
    const warn = w.sessions_without_detail ? ` · ${w.sessions_without_detail} senza dettaglio` : '';
    return `<li><span class="rowmain"><strong>Settimana dal ${esc(shortDate(w.week_start))}${w.partial ? ' <span class="tag">in corso</span>' : ''}</strong><small>${w.sessions ? `${w.sessions} ${w.sessions === 1 ? 'seduta' : 'sedute'}${w.hr_avg != null ? ` · FC media ${w.hr_avg}` : ''}${dist}${warn}` : 'nessuna seduta registrata'}</small></span><strong>${w.z2_min == null ? '—' : `${n1(w.z2_min)}`}</strong></li>`;
  }).join('')}</ul><p class="subtle">A destra: minuti in zona 2. “—” = dettaglio non disponibile (non è zero).</p>`;
}

export function cardioSessions(d) {
  if (!d.sessions.length) return '';
  return `<ul class="rows">${d.sessions.map(s => `<li><span class="rowmain"><strong>${esc(shortDate(s.date))}${s.sport ? ` · ${esc(s.sport)}` : ''}</strong><small>${s.duration_min == null ? '—' : `${n1(s.duration_min)} min`} · FC media ${s.hr_avg ?? '—'} · max ${s.hr_max ?? '—'}${s.bands ? ` · ${s.bands.map(b => `${zlabel(b)}: ${n1(b.min)}`).join(' · ')} min` : ' · senza dettaglio delle fasce'}</small></span></li>`).join('')}</ul>`;
}
