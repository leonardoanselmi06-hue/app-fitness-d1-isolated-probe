// Rendering puro (stringhe HTML) della scheda Piano: fase, scheda in vigore, note, fasi passate, storico. Nessun DOM: testabile in Node.
import { esc, shortDate, fullDate } from './views.js';

export const fmtRest = s => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const fmtRir = r => (r == null ? '—' : String(r).replace('.', ','));
const reps = e => (e.reps_min == null && e.reps_max == null ? null : e.reps_min === e.reps_max || e.reps_max == null ? `${e.reps_min}` : e.reps_min == null ? `${e.reps_max}` : `${e.reps_min}–${e.reps_max}`);
export const rxLine = e => [e.duration_min != null ? `${e.sets > 1 ? `${e.sets} × ` : ''}${e.duration_min} min` : e.hold_sec != null ? `${e.sets} serie${e.per_side ? ' per lato' : ''} × ${fmtRest(e.hold_sec)} tenuta` : `${e.sets} serie${reps(e) ? ` × ${reps(e)}` : ''}`, e.rir == null ? null : `RIR ${fmtRir(e.rir)}`, e.rest_sec == null ? null : `rec ${fmtRest(e.rest_sec)}`, e.method].filter(Boolean).join(' · ');
const dayBefore = iso => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const btn = (act, label, attrs = '', cls = 'sec') => `<button type="button" class="pbtn ${cls}" data-act="${act}" ${attrs}>${esc(label)}</button>`;

// Differenze tra due versioni (per lo storico): "recupero 2:30 → 3:00".
const FIELDS = {
  rx: [['order', 'posizione', v => v + 1], ['sets', 'serie', v => v], ['reps', 'ripetizioni', (_, d) => reps(d)], ['rir', 'RIR', fmtRir], ['rest_sec', 'recupero', fmtRest], ['duration_min', 'durata (min)', v => v], ['hold_sec', 'tenuta per serie', fmtRest], ['per_side', 'per lato', v => (v ? 'sì' : 'no')],['method', 'metodo', v => v], ['note', 'nota', v => v]],
  phase: [['name', 'nome', v => v], ['goal', 'obiettivo', v => v], ['goal_type', 'tipo di obiettivo', v => v], ['targets', 'target', v => targetsLine(v)], ['method', 'metodologia', v => v]],
  note: [['date', 'data', v => v], ['category', 'categoria', v => v], ['title', 'titolo', v => v], ['text', 'testo', v => v]],
};
const pr = (t, k, d = 2) => (t?.[k] ? `${String(t[k].min).replace('.', ',')}–${String(t[k].max).replace('.', ',')}` : null);
/** Riassunto dei target personalizzati di una fase, es. "peso 0,25–0,5 %/sett. · proteine 1,8–2,4 g/kg". */
export const targetsLine = t => (!t ? '—' : [pr(t, 'weight_pct_week') && `peso ${pr(t, 'weight_pct_week')} %/sett.`, pr(t, 'protein_g_per_kg') && `proteine ${pr(t, 'protein_g_per_kg')} g/kg`, pr(t, 'sets_per_muscle_week') && `serie ${pr(t, 'sets_per_muscle_week')}/muscolo`, t.strength_sessions_per_week != null && `${t.strength_sessions_per_week} sedute/sett.`, t.min_weekly_frequency_per_muscle != null && `frequenza ≥${t.min_weekly_frequency_per_muscle}`, t.sleep_min_hours != null && `sonno ≥${String(t.sleep_min_hours).replace('.', ',')} h`].filter(Boolean).join(' · '));
const same = (a, b) => (a && typeof a === 'object' ? JSON.stringify(a) === JSON.stringify(b) : (a ?? null) === (b ?? null));
export function diffLines(kind, prev, next) {
  const out = []; if (next.removed) return ['rimosso'];
  for (const [k, label, f] of FIELDS[kind] ?? []) {
    const a = k === 'reps' ? reps(prev) : prev[k], b = k === 'reps' ? reps(next) : next[k];
    if (!same(a, b)) out.push(`${label} ${a == null || prev.removed ? '—' : esc(k === 'reps' ? a : f(a, prev))} → ${b == null ? '—' : esc(k === 'reps' ? b : f(b, next))}`);
  }
  return out;
}
const stateLine = (kind, d) => (d.removed ? 'rimosso' : kind === 'rx' ? esc(rxLine(d)) : kind === 'phase' ? esc([d.name, d.goal, d.goal_type, d.targets ? targetsLine(d.targets) : null, d.method].filter(Boolean).join(' · ')) : esc([d.title, d.category].filter(Boolean).join(' · ')));
/** Storico di un'entità: versioni in ordine di data, ognuna con intervallo (valid_to è ESCLUSO: si mostra il giorno prima) e cosa è cambiato. */
export function historyList(kind, versions) {
  if (!versions.length) return '<div class="empty">Nessuna versione.</div>';
  const items = versions.map((v, i) => {
    const replaced = v.valid_to != null && v.valid_to <= v.valid_from;
    const range = replaced ? `${esc(fullDate(v.valid_from))} · sostituita lo stesso giorno` : v.valid_to == null ? `dal ${esc(fullDate(v.valid_from))} · in vigore` : `dal ${esc(fullDate(v.valid_from))} al ${esc(fullDate(dayBefore(v.valid_to)))}`;
    const what = i === 0 ? stateLine(kind, v.data) : (diffLines(kind, versions[i - 1].data, v.data).join(' · ') || 'nessuna differenza nei campi');
    return `<li><strong>${range}</strong><span>${i === 0 ? 'Versione iniziale: ' : ''}${what}</span>${v.reason ? `<small>Motivo: ${esc(v.reason)}</small>` : ''}</li>`;
  });
  return `<ol class="phist">${items.reverse().join('')}</ol>`;
}

export function planHeader(d) {
  const a = d.active;
  if (!a) return `<div class="coachplan"><strong>Nessuna fase attiva</strong><small>Una fase raggruppa scheda, metodologia e risultati di un periodo di allenamento.</small></div>${btn('phase-new', 'Inizia una fase', '', 'pri')}`;
  const exN = a.days.reduce((n, x) => n + x.exercises.length, 0);
  return `<div class="coachplan"><strong>${esc(a.name)}</strong><small>${esc(a.goal ?? 'Obiettivo non impostato')}${a.goal_type ? ` · ${esc(a.goal_type)}` : ''}${a.method ? ` · ${esc(a.method)}` : ''}</small>${a.targets ? `<small>Target: ${esc(targetsLine(a.targets))}</small>` : ''}</div>
<div class="kvgrid"><div class="kv"><span>Dal</span><strong>${esc(shortDate(a.start_date))}</strong><small>${esc(fullDate(a.start_date))}</small></div><div class="kv"><span>Scheda</span><strong>${a.days.length} gg</strong><small>${exN} ${exN === 1 ? 'esercizio' : 'esercizi'}</small></div></div>
<div class="prow">${btn('phase-edit', 'Modifica fase')}${btn('phase-close', 'Chiudi fase', '', 'danger')}</div>`;
}

const pending = e => (e.pending ? `<span class="tag warn">dal ${esc(shortDate(e.pending.valid_from))}: ${diffLines('rx', e, e.pending).join(' · ') || 'modifica programmata'}</span>` : '');
export function planScheda(d) {
  const a = d.active; if (!a) return '';
  if (!a.days.length) return `<h2 class="sec">Scheda</h2><div class="empty">Scheda vuota: importala dalle tue sedute Lyfta, oppure aggiungi un giorno a mano (es. "6.UPPER").</div><div class="prow">${btn('import', 'Importa da Lyfta', '', 'pri')}${btn('day-new', '+ Giorno')}</div>`;
  const days = a.days.map(day => `<section class="pday"><div class="pdayhead"><div><strong>${esc(day.label)}</strong>${day.focus ? `<small>${esc(day.focus)}</small>` : ''}</div><div class="prow tight">${btn('day-edit', 'Modifica', `data-key="${esc(day.key)}"`)}${btn('rx-new', '+ Esercizio', `data-day="${esc(day.label)}"`, 'pri')}</div></div>
${day.exercises.length ? `<ul class="rows prx">${day.exercises.map(e => `<li><span class="rowmain"><strong>${esc(e.exercise)}</strong><small>${esc(rxLine(e))}${e.note ? ` · ${esc(e.note)}` : ''}</small>${pending(e)}${e.versions > 1 ? `<small class="muted">${e.versions} versioni</small>` : ''}</span><span class="prow tight">${btn('rx-edit', 'Modifica', `data-key="${esc(e.key)}"`)}${btn('hist', 'Storico', `data-kind="rx" data-entity="${esc(e.key)}"`)}</span></li>`).join('')}</ul>` : '<div class="empty small">Nessun esercizio.</div>'}</section>`).join('');
  return `<h2 class="sec">Scheda in vigore</h2>${days}<div class="prow">${btn('day-new', '+ Giorno')}${btn('import', 'Importa da Lyfta')}</div>`;
}

export function planNotes(d) {
  const items = d.notes.map(n => `<li class="pnote"><div><span class="tag info">${esc(n.category)}</span> <strong>${esc(n.title)}</strong><small>${esc(fullDate(n.date))}${n.versions > 1 ? ` · ${n.versions} versioni` : ''}</small>${n.text ? `<p>${esc(n.text)}</p>` : ''}</div><div class="prow tight">${btn('note-edit', 'Modifica', `data-id="${esc(n.note_id)}"`)}${n.versions > 1 ? btn('hist', 'Storico', `data-kind="note" data-entity="note:${esc(n.note_id)}"`) : ''}</div></li>`).join('');
  return `<h2 class="sec">Note</h2>${items ? `<ul class="pnotes">${items}</ul>` : '<div class="empty">Nessuna nota. Segna qui eventi particolari (malattia, viaggio, stress…).</div>'}<div class="prow">${btn('note-new', '+ Nota', '', 'pri')}</div>`;
}

export function planPhases(d) {
  const past = d.phases.filter(p => p.status === 'closed'); if (!past.length) return '';
  return `<h2 class="sec">Fasi passate</h2><ul class="rows">${past.map(p => `<li><span class="rowmain"><strong>${esc(p.name)}</strong><small>${esc(shortDate(p.start_date))} → ${esc(fullDate(dayBefore(p.end_date)))}${p.goal ? ` · ${esc(p.goal)}` : ''}</small></span><span class="prow tight">${p.has_report ? btn('report', 'Report', `data-id="${p.id}"`) : ''}${btn('phase-hist', 'Scheda', `data-id="${p.id}"`)}</span></li>`).join('')}</ul>`;
}
