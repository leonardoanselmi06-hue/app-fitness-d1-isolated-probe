// Moduli del Piano (HTML puro) e costruzione delle richieste per l'API. Nessun DOM: testabile in Node.
import { esc } from './views.js';
import { fmtRest } from './plan.js';

const f = (label, input, hint = '') => `<label>${esc(label)}${input}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
const inp = (name, v = '', extra = '') => `<input name="${name}" value="${esc(v === null ? '' : v)}" ${extra}>`;
const dateF = (label, name, v, min = '') => f(label, `<input type="date" name="${name}" value="${esc(v)}" ${min ? `min="${esc(min)}"` : ''} required>`);
const RIRS = ['', '0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6'];
export const CATEGORIES = ['evento', 'malattia', 'infortunio', 'viaggio', 'stress', 'sonno', 'alimentazione', 'allenamento', 'altro'];
const actions = (extra = '') => `<div class="prow"><button type="submit" class="pbtn pri">Salva</button><button type="button" class="pbtn sec" data-act="close">Annulla</button>${extra}</div><p class="perr" id="planErr" role="alert"></p>`;
const wrap = (title, body, attrs) => `<form id="planForm" ${attrs}><h2>${esc(title)}</h2>${body}</form>`;

export function rxForm({ mode, day, e, today, phaseStart, phaseId }) {
  const body = f('Esercizio', inp('exercise', e?.exercise ?? '', `required maxlength="80" ${mode === 'edit' ? 'readonly' : ''}`), mode === 'edit' ? '' : 'Usa lo stesso nome di Lyfta')
    + `<div class="pgrid">${f('Serie', inp('sets', e?.sets ?? '', 'type="number" min="1" max="20" required inputmode="numeric"'))}${f('Rip. min', inp('reps_min', e?.reps_min ?? '', 'type="number" min="1" max="100" inputmode="numeric"'))}${f('Rip. max', inp('reps_max', e?.reps_max ?? '', 'type="number" min="1" max="100" inputmode="numeric"'))}`
    + f('RIR', `<select name="rir">${RIRS.map(v => `<option value="${v}"${String(e?.rir ?? '') === v ? ' selected' : ''}>${v === '' ? '—' : v.replace('.', ',')}</option>`).join('')}</select>`)
    + `${f('Recupero', inp('rest', e?.rest_sec == null ? '' : fmtRest(e.rest_sec), 'inputmode="numeric" pattern="\\d{1,2}:\\d{2}" placeholder="2:30"'), 'min:sec')}</div>`
    + f('Metodo', inp('method', e?.method ?? '', 'maxlength="60"')) + f('Nota', inp('note', e?.note ?? '', 'maxlength="200"'))
    + dateF('Valido dal', 'valid_from', today, phaseStart) + (mode === 'edit' ? f('Motivo del cambio', inp('reason', '', 'maxlength="200"')) : '')
    + actions(mode === 'edit' ? '<button type="button" class="pbtn danger" data-act="rx-remove">Rimuovi</button>' : '');
  return wrap(mode === 'edit' ? `Modifica ${e.exercise}` : `Nuovo esercizio · ${day}`, body, `data-submit="rx-${mode}" data-phase-id="${phaseId}" data-day="${esc(day)}" ${e ? `data-version="${e.version_id}"` : ''}`);
}
export const dayForm = ({ mode, day, today, phaseStart, phaseId }) => wrap(mode === 'edit' ? `Modifica ${day.label}` : 'Nuovo giorno',
  f('Nome', inp('label', day?.label ?? '', `required maxlength="40" ${mode === 'edit' ? 'readonly' : ''}`), 'es. 6.UPPER') + f('Ordine', inp('order', day?.order ?? 0, 'type="number" min="0" max="20"')) + f('Focus', inp('focus', day?.focus ?? '', 'maxlength="60"'))
  + dateF('Valido dal', 'valid_from', today, phaseStart) + actions(mode === 'edit' ? '<button type="button" class="pbtn danger" data-act="day-remove">Rimuovi giorno</button>' : ''),
  `data-submit="day-${mode}" data-phase-id="${phaseId}" ${day ? `data-version="${day.version_id}" data-day="${esc(day.label)}"` : ''}`);
export const noteForm = ({ n, today }) => wrap(n ? 'Modifica nota' : 'Nuova nota',
  dateF('Data dell\'evento', 'date', n?.date ?? today) + f('Categoria', `<select name="category">${CATEGORIES.map(c => `<option${(n?.category ?? 'evento') === c ? ' selected' : ''}>${c}</option>`).join('')}</select>`)
  + f('Titolo', inp('title', n?.title ?? '', 'required maxlength="80"')) + f('Testo', `<textarea name="text" rows="4" maxlength="5000">${esc(n?.text ?? '')}</textarea>`)
  + actions(n ? '<button type="button" class="pbtn danger" data-act="note-remove">Elimina</button>' : ''), `data-submit="${n ? 'note-edit' : 'note-new'}" ${n ? `data-version="${n.version_id}" data-id="${esc(n.note_id)}"` : ''}`);
const GOALS = [['', '—'], ['massa', 'Massa'], ['forza', 'Forza'], ['mantenimento', 'Mantenimento'], ['definizione', 'Definizione']];
const tv = (t, a, b) => (t?.[a]?.[b] ?? '');
const numIn = (name, v, ph = '', step = '0.05') => `<input name="${name}" type="text" inputmode="decimal" value="${esc(v === '' || v == null ? '' : String(v).replace('.', ','))}" placeholder="${esc(ph)}" autocomplete="off">`;
const targetsFields = t => `<details class="ptargets"${t ? ' open' : ''}><summary>Target personalizzati (facoltativi)</summary><p class="subtle">Lasciati vuoti valgono i valori predefiniti del tipo di obiettivo (massa +0,25…+0,5 %/sett.; mantenimento −0,1…+0,1; definizione −0,7…−0,3). Sono indicazioni generali, non consulenza medica.</p>
<div class="pgrid">${f('Peso %/sett. min', numIn('w_min', tv(t, 'weight_pct_week', 'min'), '0,25'))}${f('Peso %/sett. max', numIn('w_max', tv(t, 'weight_pct_week', 'max'), '0,5'))}</div>
<div class="pgrid">${f('Proteine g/kg min', numIn('p_min', tv(t, 'protein_g_per_kg', 'min'), '1,6'))}${f('Proteine g/kg max', numIn('p_max', tv(t, 'protein_g_per_kg', 'max'), '2,2'))}</div>
<div class="pgrid">${f('Serie/muscolo/sett. min', numIn('s_min', tv(t, 'sets_per_muscle_week', 'min'), '10'))}${f('Serie/muscolo/sett. max', numIn('s_max', tv(t, 'sets_per_muscle_week', 'max'), '20'))}</div>
<div class="pgrid">${f('Sedute di forza/sett.', numIn('sessions', t?.strength_sessions_per_week ?? '', '4'))}${f('Frequenza min./muscolo', numIn('freq', t?.min_weekly_frequency_per_muscle ?? '', '2'))}${f('Sonno min. (ore)', numIn('sleep_h', t?.sleep_min_hours ?? '', '7'))}</div></details>`;
export const phaseForm = ({ mode, a, today, closed = [] }) => wrap(mode === 'edit' ? 'Modifica fase' : 'Nuova fase',
  f('Nome', inp('name', a?.name ?? '', 'required maxlength="60"'), 'es. Massa 2') + f('Obiettivo', inp('goal', a?.goal ?? '', 'maxlength="200"'))
  + f('Tipo di obiettivo', `<select name="goal_type">${GOALS.map(([v, l]) => `<option value="${v}"${(a?.goal_type ?? '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`, 'Decide i target del Coach (ritmo del peso, proteine) per questa fase')
  + targetsFields(a?.targets) + f('Metodologia', inp('method', a?.method ?? '', 'maxlength="300"'), 'es. Upper/Lower, top set + back-off')
  + (mode === 'edit' ? dateF('Valido dal', 'valid_from', today, a.start_date) + f('Motivo del cambio', inp('reason', '', 'maxlength="200"')) : dateF('Inizio', 'start_date', today)
    + (closed.length ? f('Parti dalla scheda di', `<select name="copy_from"><option value="">Scheda vuota</option>${closed.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>`) : '')) + actions(),
  `data-submit="${mode === 'edit' ? 'phase-edit' : 'phase-new'}" ${a ? `data-version="${a.phase_version_id}" data-phase="${a.id}"` : ''}`);
export const closeForm = ({ a, today }) => wrap(`Chiudi ${a.name}`, `<p class="subtle">La fase viene congelata: scheda e storico restano consultabili, non più modificabili.</p>` + dateF('Ultimo giorno della fase', 'last_day', today, a.start_date) + actions(), `data-submit="phase-close" data-phase="${a.id}"`);

const dec = (v, label) => { if (v == null || String(v).trim() === '') return null; const n = Number(String(v).trim().replace(',', '.')); if (!Number.isFinite(n)) throw new Error(`${label}: inserisci un numero.`); return n; };
const pairOf = (v, a, b, label) => { const x = dec(v[a], label), y = dec(v[b], label); if (x == null && y == null) return null; if (x == null || y == null) throw new Error(`${label}: inserisci sia il minimo sia il massimo.`); if (y < x) throw new Error(`${label}: il massimo non può essere minore del minimo.`); return { min: x, max: y }; };
/** Target personalizzati dai campi del modulo (null se vuoti). */
export function targetsFrom(v) {
  const t = { weight_pct_week: pairOf(v, 'w_min', 'w_max', 'Peso'), protein_g_per_kg: pairOf(v, 'p_min', 'p_max', 'Proteine'), sets_per_muscle_week: pairOf(v, 's_min', 's_max', 'Serie per muscolo'),
    strength_sessions_per_week: dec(v.sessions, 'Sedute'), min_weekly_frequency_per_muscle: dec(v.freq, 'Frequenza'), sleep_min_hours: dec(v.sleep_h, 'Sonno') };
  for (const k of Object.keys(t)) if (t[k] == null) delete t[k];
  return Object.keys(t).length ? t : null;
}
const toInt = v => (v === '' || v == null ? null : Number(v));
const text = v => (v == null || String(v).trim() === '' ? null : String(v).trim());
export const parseRest = s => { if (!s || !s.trim()) return null; const m = /^(\d{1,2}):([0-5]\d)$/.exec(s.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

/** Da {submit, values, dataset} a {path, body}. Lancia Error con testo italiano per input non valido lato client. */
export function buildRequest(submit, v, ds) {
  const version = ds.version ? Number(ds.version) : null;
  if (submit === 'rx-new' || submit === 'rx-edit' || submit === 'rx-remove') {
    const base = { kind: 'rx', phase_id: Number(ds.phaseId), day: ds.day, exercise: v.exercise, valid_from: v.valid_from, expected_version_id: version, reason: text(v.reason) };
    if (submit === 'rx-remove') return { path: '/v1/plan/version', body: { ...base, data: { removed: true } } };
    const rest = parseRest(v.rest); if (Number.isNaN(rest)) throw new Error('Recupero: usa il formato m:ss (es. 2:30).');
    return { path: '/v1/plan/version', body: { ...base, data: { order: 0, sets: toInt(v.sets), reps_min: toInt(v.reps_min), reps_max: toInt(v.reps_max), rir: v.rir === '' ? null : Number(v.rir), rest_sec: rest, method: text(v.method), note: text(v.note) } } };
  }
  if (submit === 'day-new' || submit === 'day-edit' || submit === 'day-remove') {
    const base = { kind: 'day', phase_id: Number(ds.phaseId), day: v.label ?? ds.day, valid_from: v.valid_from, expected_version_id: version };
    return { path: '/v1/plan/version', body: { ...base, data: submit === 'day-remove' ? { removed: true } : { order: toInt(v.order) ?? 0, focus: text(v.focus) } } };
  }
  if (submit === 'note-new' || submit === 'note-edit' || submit === 'note-remove') {
    const body = { kind: 'note', expected_version_id: version, ...(ds.id ? { note_id: ds.id } : {}), data: submit === 'note-remove' ? { removed: true } : { date: v.date, category: v.category, title: v.title, text: text(v.text) } };
    return { path: '/v1/plan/version', body };
  }
  if (submit === 'import') return { path: '/v1/plan/import-lyfta', body: { phase_id: Number(ds.phaseId), from: v.from, to: v.to, titles: Object.entries(v).filter(([k]) => /^t\d+$/.test(k)).map(([, x]) => x) } };
  if (submit === 'phase-edit') return { path: '/v1/plan/version', body: { kind: 'phase', phase_id: Number(ds.phase), expected_version_id: version, valid_from: v.valid_from, reason: text(v.reason), data: { name: v.name, goal: text(v.goal), method: text(v.method), goal_type: v.goal_type || null, targets: targetsFrom(v) } } };
  if (submit === 'phase-new') return { path: '/v1/plan/phase/start', body: { name: v.name, goal: text(v.goal), method: text(v.method), goal_type: v.goal_type || null, targets: targetsFrom(v), start_date: v.start_date, copy_from: v.copy_from ? Number(v.copy_from) : null } };
  if (submit === 'phase-close') return { path: '/v1/plan/phase/close', body: { phase_id: Number(ds.phase), last_day: v.last_day } };
  throw new Error('Azione sconosciuta.');
}

const ERR = { stale: 'Questo elemento è cambiato nel frattempo: ricarico i dati, poi riprova.', exists: 'Esiste già.', no_change: 'Nessuna modifica da salvare.', valid_from_before_previous: 'La data è precedente all\'ultima modifica di questo elemento.', before_phase_start: 'La data è prima dell\'inizio della fase.', invalid_valid_from: 'Data non valida (massimo 60 giorni nel futuro).', phase_closed: 'La fase è chiusa e non si può modificare.', day_not_found: 'Il giorno non esiste: crealo prima.', active_phase_exists: 'C\'è già una fase attiva: chiudila prima.', overlaps_previous_phase: 'La data inizia prima della fine della fase precedente.', invalid_last_day: 'Ultimo giorno non valido (tra l\'inizio della fase e oggi).', forbidden_origin: 'Richiesta non consentita.', nothing_to_remove: 'Niente da rimuovere.' };
export const errorText = code => ERR[code] ?? (String(code).startsWith('invalid_') ? 'Valori non validi: controlla i campi.' : 'Operazione non riuscita. Riprova.');

/** Proposta da Lyfta: periodo + elenco di giorni con casella (nome tN = titolo del giorno). */
export const importForm = ({ sug, phase }) => wrap('Importa la scheda da Lyfta',
  `<p class="subtle">Prendo l'ultima seduta di ogni titolo nel periodo. Poi puoi correggere tutto dalla scheda.</p><div class="pgrid">${dateF('Dal', 'from', sug.from)}${dateF('Al', 'to', sug.to)}</div><button type="button" class="pbtn sec" data-act="import-refresh">Aggiorna proposta</button>`
  + (sug.days.length ? `<ul class="rows pimport">${sug.days.map((d, i) => `<li><label><input type="checkbox" name="t${i}" value="${esc(d.title)}"${d.sessions >= 2 ? ' checked' : ''}> <span><strong>${esc(d.title)}</strong><small>${d.sessions} ${d.sessions === 1 ? 'seduta' : 'sedute'} · ultima ${esc(d.last_date)} · ${d.exercises.length} esercizi: ${esc(d.exercises.map(e => e.exercise).join(', '))}</small></span></label></li>`).join('')}</ul>` : '<div class="empty">Nessun allenamento di forza trovato nel periodo.</div>')
  + `<div class="prow"><button type="submit" class="pbtn pri"${sug.days.length ? '' : ' disabled'}>Importa selezionati</button><button type="button" class="pbtn sec" data-act="close">Annulla</button></div><p class="perr" id="planErr" role="alert"></p>`,
  `data-submit="import" data-phase-id="${phase.id}"`);
