const $ = id => document.getElementById(id);
const esc = s => String(s ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABEL = { training: 'Allenamento', body: 'Composizione', nutrition: 'Alimentazione', activity: 'Attività', sleep: 'Sonno', cardio: 'Cardio', recovery: 'Recupero', program: 'Programma' };

async function refresh() {
  try {
    const h = await fetch('/v1/health');
    if (!h.ok) throw new Error('API non disponibile');
    const s = await fetch('/v1/derived/summary', { credentials: 'same-origin' });
    if (s.status === 401 || s.status === 403) { $('connection').textContent = 'Accesso richiesto'; $('notice').textContent = 'Accedi con il tuo account per vedere i dati.'; return; }
    if (s.status === 503) { $('connection').textContent = 'Non configurato'; $('notice').textContent = 'Autenticazione non ancora configurata: nessun dato esposto.'; return; }
    if (!s.ok) throw new Error('Errore API');
    const d = await s.json();
    $('connection').textContent = 'Connesso'; $('connection').className = 'connection ok'; $('gen').textContent = `Generazione ${d.generation}`;
    $('coverage').innerHTML = Object.entries(d.coverage).map(([k, v]) => `<div class="metric"><span>${esc(LABEL[k] ?? k)}</span><strong>${v}</strong><small>record</small></div>`).join('');
    $('trainingCoverage').textContent = `${d.coverage.training} allenamenti`;
    $('workouts').className = '';
    $('workouts').innerHTML = d.training_sessions.length
      ? d.training_sessions.slice(0, 8).map(w => `<div class="workout"><span class="date">${esc(w.date)}</span><div><strong>${esc(w.title ?? 'Allenamento')}</strong><small>${w.exercises} esercizi · ${esc(w.source)}</small></div></div>`).join('')
      : '<div class="empty">Nessun allenamento acquisito.</div>';
    $('notice').textContent = d.note;
  } catch (e) { $('connection').textContent = 'API non raggiungibile'; $('notice').textContent = e.message; }
}
const SYNC_TEXT = { disabled: 'Il sync Lyfta è spento (LYFTA_SYNC_ENABLED).', lyfta_unconfigured: 'Chiave Lyfta mancante.', raw_store_unconfigured: 'Archivio Drive non configurato.', no_database: 'Database non collegato.', fetch_error: 'Lyfta non ha risposto correttamente: nessun dato modificato.', invalid_page: 'Risposta Lyfta non valida: nessun dato modificato.' };
$('syncLyfta').addEventListener('click', async () => {
  const b = $('syncLyfta'), out = $('syncResult'); b.disabled = true; out.textContent = 'Sincronizzazione in corso…';
  try {
    const r = await fetch('/v1/sync/lyfta', { method: 'POST', credentials: 'same-origin' });
    if (r.status === 401 || r.status === 403) { out.textContent = 'Accesso richiesto.'; return; }
    const d = await r.json();
    if (!d.ran) out.textContent = SYNC_TEXT[d.reason] ?? `Non eseguito (${d.reason ?? r.status}).`;
    else if (!d.ok) out.textContent = `Sync non riuscito: ${SYNC_TEXT[d.reason] ?? d.reason}`;
    else { out.textContent = `Sync ${d.complete ? 'completo' : 'parziale'}: ${d.receipt?.modified ?? 0} aggiornati, ${d.receipt?.deleted ?? 0} rimossi${d.receipt?.replayed ? ' (nessuna novità)' : ''}.`; await refresh(); }
  } catch { out.textContent = 'API non raggiungibile.'; } finally { b.disabled = false; }
});
$('syncPolar').addEventListener('click', async () => {
  const b = $('syncPolar'), out = $('syncResult'); b.disabled = true; out.textContent = 'Sincronizzazione Polar in corso…';
  try {
    const r = await fetch('/v1/sync/polar', { method: 'POST', credentials: 'same-origin' });
    if (r.status === 401 || r.status === 403) { out.textContent = 'Accesso richiesto.'; return; }
    const d = await r.json();
    if (!d.ran) out.textContent = d.reason === 'disabled' ? 'Sync Polar non ancora attivo.' : `Non eseguito (${d.reason ?? r.status}).`;
    else if (!d.ok) out.textContent = `Sync Polar non riuscito: ${d.reason}${d.upstream_status ? ` (${d.upstream_status})` : ''}`;
    else { out.textContent = `Polar: ${d.listed} sessioni nella finestra, ${d.new_sessions} nuove/aggiornate, ${d.detailed} con battito, ${d.remaining} da completare (ripremi il pulsante).`; await refresh(); }
  } catch { out.textContent = 'API non raggiungibile.'; } finally { b.disabled = false; }
});
$('syncFatSecret').addEventListener('click', async () => {
  const b = $('syncFatSecret'), out = $('syncResult'); b.disabled = true; out.textContent = 'Sincronizzazione FatSecret in corso…';
  try {
    const r = await fetch('/v1/sync/fatsecret', { method: 'POST', credentials: 'same-origin' });
    if (r.status === 401 || r.status === 403) { out.textContent = 'Accesso richiesto.'; return; }
    const d = await r.json();
    if (!d.ran) out.textContent = d.reason === 'disabled' ? 'Sync FatSecret non ancora attivo.' : `Non eseguito (${d.reason ?? r.status}).`;
    else if (!d.ok) out.textContent = `Sync FatSecret non riuscito: ${d.reason}${d.upstream_status ? ` (${d.upstream_status})` : ''}`;
    else { out.textContent = `FatSecret: ${d.days_processed} giorni aggiornati (${d.entries} voci), ${d.remaining} da completare${d.remaining ? ' (ripremi il pulsante)' : ''}.`; await refresh(); }
  } catch { out.textContent = 'API non raggiungibile.'; } finally { b.disabled = false; }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
refresh();
