// Pasti stimati da ChatGPT: elenco (separato da FatSecret) e importazione del JSON incollato. Rendering puro + collegamento al DOM.
import { esc, shortDate } from './views.js';

export const FORMAT_HINT = '{"version":1,"meals":[{"id":"2026-11-14-pranzo","date":"2026-11-14","meal":"Lunch","name":"Pasta al pomodoro","calories":650,"protein":22,"carbohydrate":100,"fat":16,"uncertainty_pct":25}]}';
const MEAL_IT = { Breakfast: 'Colazione', Lunch: 'Pranzo', Dinner: 'Cena', Other: 'Altro' };
const n0 = v => (v == null ? '—' : String(Math.round(v)));

export function estimatesBlock(d) {
  const list = d.estimates ?? [];
  const rows = list.length ? `<ul class="rows">${list.map(e => {
    const k = e.nutrients?.calories, u = e.uncertainty_pct, lo = k == null || u == null ? null : k * (1 - u / 100), hi = k == null || u == null ? null : k * (1 + u / 100);
    return `<li><span class="rowmain"><strong>${esc(shortDate(e.date))} · ${esc(MEAL_IT[e.meal] ?? e.meal)}${e.name ? ` · ${esc(e.name)}` : ''}</strong><small>stima${lo == null ? '' : ` ${n0(lo)}–${n0(hi)} kcal (±${u}%)`} · P ${n0(e.nutrients?.protein)} · C ${n0(e.nutrients?.carbohydrate)} · G ${n0(e.nutrients?.fat)}</small></span><strong>${n0(k)}</strong></li>`;
  }).join('')}</ul>` : '<div class="empty">Nessun pasto stimato nel periodo.</div>';
  return `<p class="subtle">Stime di ChatGPT: restano separate dal diario FatSecret e non entrano nei totali né nelle medie sopra.</p>${rows}
<form id="estForm" class="ci-form"><label>Incolla il JSON dei pasti<textarea name="json" rows="5" spellcheck="false" placeholder="${esc(FORMAT_HINT)}" required></textarea></label><div class="prow"><button type="submit" class="pbtn pri">Importa pasti stimati</button> <button type="button" class="pbtn" id="estDrive">Importa dalla cartella Drive</button></div><p class="perr" id="estMsg" role="status"></p></form>`;
}

const ERRORS = { invalid_estimate: 'Il JSON non rispetta il formato (versione 1, pasti con id, data, pasto e calorie).', invalid_day: 'Data non valida (da oggi fino a 30 giorni fa).', invalid_json: 'Il testo non è un JSON valido.', payload_too_large: 'JSON troppo grande.', raw_store_unavailable: 'Archivio dei dati grezzi non disponibile: riprova più tardi.', forbidden: 'Accesso non consentito.' };
export const estimatesError = code => ERRORS[code] ?? 'Importazione non riuscita. Riprova.';
export const importText = r => (r.new_or_changed === 0 ? `Nessuna novità: ${r.meals} pasti già presenti.` : `Importati ${r.new_or_changed} pasti su ${r.meals}.`);

export const driveText = r => (!r.ran ? 'Importazione da Drive non attiva (cartella non collegata).' : !r.ok ? `Importazione non riuscita: ${r.reason}.` : `Drive: ${r.files} file, ${r.imported} pasti nuovi o aggiornati, ${r.rejected} file non validi.`);

export function bindEstimates({ root, reload }) {
  root.addEventListener('click', async ev => {
    const b = ev.target.closest('#estDrive'); if (!b) return; b.disabled = true;
    try { const r = await fetch('/v1/sync/estimates', { method: 'POST', credentials: 'same-origin' }); const j = await r.json().catch(() => ({})); await reload(); const m = root.querySelector('#estMsg'); if (m) m.textContent = r.ok ? driveText(j) : 'Importazione non riuscita.'; }
    catch { const m = root.querySelector('#estMsg'); if (m) m.textContent = 'API non raggiungibile.'; } finally { b.disabled = false; }
  });
  root.addEventListener('submit', async ev => {
    const form = ev.target.closest('#estForm'); if (!form) return; ev.preventDefault();
    const msg = form.querySelector('#estMsg'), btn = form.querySelector('button[type=submit]'); msg.textContent = ''; btn.disabled = true;
    try {
      const text = new FormData(form).get('json'); let body; try { body = JSON.parse(text); } catch { throw new Error(estimatesError('invalid_json')); }
      const r = await fetch('/v1/nutrition/estimates', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(estimatesError(j.error));
      await reload();
      const m = root.querySelector('#estMsg'); if (m) m.textContent = importText(j);
    } catch (e) { msg.textContent = e.message || estimatesError(); } finally { btn.disabled = false; }
  });
}
