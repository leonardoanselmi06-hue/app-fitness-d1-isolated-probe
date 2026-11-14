// Scheda Recupero: check-in giornaliero (5 valori 1–5) e andamento. Rendering puro (stringhe HTML, testabile in Node) + collegamento al DOM.
import { esc, shortDate, fullDate } from './views.js';

export const ITEMS = [
  ['sleep_quality', 'Sonno percepito', 'pessimo', 'ottimo'], ['readiness', 'Prontezza ad allenarti', 'per niente', 'al massimo'],
  ['fatigue', 'Stanchezza', 'nessuna', 'estrema'], ['soreness', 'Indolenzimento muscolare', 'nessuno', 'forte'], ['stress', 'Stress', 'basso', 'alto'],
];
// Verso: true = più alto è peggio (il calcolo dell'indice li inverte).
export const WORSE_HIGH = new Set(['fatigue', 'soreness', 'stress']);
const SHORT = { sleep_quality: 'Sonno', readiness: 'Prontezza', fatigue: 'Stanch.', soreness: 'Indol.', stress: 'Stress' };
const num = (v, d = 1) => (v == null ? '—' : String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ','));
const kv = (label, value, small = '') => `<div class="kv"><span>${esc(label)}</span><strong>${value}</strong>${small ? `<small>${esc(small)}</small>` : ''}</div>`;
const dayBefore = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

export function checkinForm(d) {
  const cur = d.today_entry ?? {};
  const rows = ITEMS.map(([k, label, lo, hi]) => `<fieldset class="ci-row"><legend>${esc(label)}</legend><div class="ci-scale">${[1, 2, 3, 4, 5].map(v => `<label><input type="radio" name="${k}" value="${v}"${cur[k] === v ? ' checked' : ''}><span>${v}</span></label>`).join('')}</div><small>1 = ${esc(lo)} · 5 = ${esc(hi)}</small></fieldset>`).join('');
  return `<form id="ciForm" class="ci-form"><label class="ci-date">Giorno <input type="date" name="day" value="${esc(d.today)}" min="${esc(dayBefore(d.today, 14))}" max="${esc(d.today)}" required></label>${rows}
<div class="prow"><button type="submit" class="pbtn pri">${d.today_entry ? 'Aggiorna il check-in di oggi' : 'Salva il check-in'}</button></div><p class="perr" id="ciErr" role="alert"></p>
<p class="subtle">Prendi nota di come ti senti ora. Si può correggere: lo storico delle versioni resta. Stanchezza, indolenzimento e stress: più alto = peggio.</p></form>`;
}

export function checkinSummary(d) {
  const a = d.last7, p = d.prev7;
  if (a.n < 3) return `<div class="empty">Servono almeno 3 check-in negli ultimi 7 giorni per le medie (ne ho ${a.n}).</div>`;
  const delta = a.index != null && p.index != null ? a.index - p.index : null;
  return `<div class="kvgrid">${kv('Indice di recupero', a.index == null ? '—' : `${a.index}/100`, delta == null ? `${a.n} check-in · confronto non disponibile · più alto = meglio` : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)} rispetto ai 7 giorni prima · più alto = meglio`)}${ITEMS.map(([k, label]) => kv(label, `${num(a[k])}/5`, `${WORSE_HIGH.has(k) ? 'più basso = meglio' : 'più alto = meglio'}${p[k] == null ? '' : ` · prima ${num(p[k])}`}`)).join('')}</div>`;
}

export function checkinList(d) {
  if (!d.entries.length) return '<div class="empty">Nessun check-in nel periodo.</div>';
  return `<ul class="rows ci-list">${d.entries.map(e => `<li><span class="rowmain"><strong>${esc(fullDate(e.day))}</strong><small>${ITEMS.map(([k]) => `${SHORT[k]} ${e[k] ?? '—'}`).join(' · ')}${e.versions > 1 ? ` · ${e.versions} versioni` : ''}</small></span><strong>${e.index == null ? '—' : `${e.index}`}</strong></li>`).join('')}</ul>`;
}

const ERRORS = { no_change: 'Nessuna modifica rispetto all\'ultimo salvataggio.', empty_checkin: 'Seleziona almeno un valore.', invalid_day: 'Giorno non valido (da oggi fino a 14 giorni fa).', invalid_checkin: 'Valori non validi.', forbidden: 'Accesso non consentito.' };
export const errorText = code => ERRORS[code] ?? 'Salvataggio non riuscito. Riprova.';

/** `get(name)` → stringa o null (come FormData.get). Ritorna il corpo della richiesta. */
export function buildCheckinRequest(get) {
  const body = { day: get('day') };
  for (const [k] of ITEMS) { const v = get(k); body[k] = v == null || v === '' ? null : Number(v); }
  return body;
}

export function bindCheckin({ root, reload }) {
  root.addEventListener('submit', async ev => {
    const form = ev.target.closest('#ciForm'); if (!form) return; ev.preventDefault();
    const err = form.querySelector('#ciErr'), btn = form.querySelector('button[type=submit]'); err.textContent = ''; btn.disabled = true;
    try {
      const fd = new FormData(form), r = await fetch('/v1/checkin', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildCheckinRequest(k => fd.get(k))) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(errorText(j.error));
      await reload();
    } catch (e) { err.textContent = e.message || errorText(); } finally { btn.disabled = false; }
  });
}
