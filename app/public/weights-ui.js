// Esclusione/ripristino di una pesata dalla scheda Peso (solo proprietario). Il server tiene il registro; qui solo conferma e invio.
const MSG = { already_excluded: 'Pesata già esclusa.', weight_not_found: 'Pesata non trovata.', not_excluded: 'Questa pesata non è esclusa.', invalid_time: 'Pesata non valida.', raw_store_unavailable: 'Archivio dei dati grezzi non disponibile: l\'esclusione sarà applicata alla prossima sincronizzazione.' };
export const weightErrorText = code => MSG[code] ?? 'Operazione non riuscita. Riprova.';
export function weightRequest(act, time, reason = null) { return { path: act === 'restore' ? '/v1/weights/restore' : '/v1/weights/exclude', body: reason ? { time, reason } : { time } }; }

export function bindWeights({ root, reload }) {
  root.addEventListener('click', async ev => {
    const b = ev.target.closest('button[data-wact]'); if (!b) return;
    const { wact, time } = b.dataset;
    if (!confirm(wact === 'exclude' ? 'Escludere questa pesata? Sparisce da grafici e analisi; si può ripristinare.' : 'Ripristinare la pesata?')) return;
    b.disabled = true;
    try {
      const { path, body } = weightRequest(wact, time), r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(weightErrorText(j.error));
      await reload();
    } catch (e) { b.disabled = false; alert(e.message); }
  });
}
