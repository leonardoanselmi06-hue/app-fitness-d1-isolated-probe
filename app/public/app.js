import { esc, trainingList, weightSummary, weightChart, weightRecent, bodyFatBlock } from '/views.js';
import { nutritionSummary, nutritionDays, sleepSummary, sleepChart, sleepList, stepsSummary, stepsChart, stepsList } from '/views-daily.js';
import { coachHeader, coachActions, coachInsights, coachTests } from '/coach.js';
import { planHeader, planScheda, planNotes, planPhases } from '/plan.js';
import { setPlan, bindPlan } from '/plan-ui.js';
import { adherenceView } from '/plan-adherence.js';
import { compareView, bindCompare } from '/compare.js';
import { aiView, bindAi } from '/ai.js';
import { bindWeights } from '/weights-ui.js';
import { checkinForm, checkinSummary, checkinList, bindCheckin } from '/checkin.js';
const $ = id => document.getElementById(id);
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
// ---- Allenamenti e Peso ----
const authMsg = r => (r.status === 401 || r.status === 403 ? 'Accesso richiesto: accedi con il tuo account.' : r.status === 503 ? 'Autenticazione non ancora configurata.' : 'Errore nel caricamento dei dati.');
const getJson = async path => { const r = await fetch(path, { credentials: 'same-origin' }); if (!r.ok) throw new Error(authMsg(r)); return r.json(); };

const train = { loaded: 0, total: 0, busy: false };
async function loadTraining(reset = false) {
  if (train.busy) return; train.busy = true;
  const list = $('trainList'), more = $('trainMore');
  try {
    if (reset) { train.loaded = 0; list.innerHTML = '<div class="empty">Caricamento…</div>'; }
    const d = await getJson(`/v1/derived/training?limit=20&offset=${train.loaded}`);
    const html = trainingList(d);
    if (train.loaded === 0) list.innerHTML = html; else list.insertAdjacentHTML('beforeend', html);
    train.loaded += d.workouts.length; train.total = d.total;
    $('trainTotal').textContent = `${d.total} allenamenti`;
    more.hidden = !d.has_more;
  } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; more.hidden = true; } finally { train.busy = false; }
}
$('trainMore').addEventListener('click', () => loadTraining());

// Viste a periodo (peso, alimentazione, sonno, passi): stessa meccanica, cambiano percorso API e rendering.
const VIEWS = {
  peso: { days: 90, path: '/v1/derived/weight', chips: 'weightRange', ids: ['weightSummary', 'weightChart', 'bodyFat', 'weightRecent'],
    render: d => [weightSummary(d), weightChart(d.daily), bodyFatBlock(d), weightRecent(d)] },
  alimentazione: { days: 7, path: '/v1/derived/nutrition', chips: 'nutritionRange', ids: ['nutritionSummary', 'nutritionList'],
    render: d => [nutritionSummary(d), nutritionDays(d)] },
  sonno: { days: 30, path: '/v1/derived/sleep', chips: 'sleepRange', ids: ['sleepSummary', 'sleepChart', 'sleepList'],
    render: d => [sleepSummary(d), sleepChart(d), sleepList(d)] },
  passi: { days: 30, path: '/v1/derived/steps', chips: 'stepsRange', ids: ['stepsSummary', 'stepsChart', 'stepsList'],
    render: d => [stepsSummary(d), stepsChart(d), stepsList(d)] },
  coach: { path: '/v1/coach/review', ids: ['coachHeader', 'coachActions', 'coachInsights', 'coachTests'],
    render: d => [coachHeader(d), coachActions(d), coachInsights(d), coachTests(d)] },
  recupero: { path: '/v1/checkin?days=30', ids: ['ciFormBox', 'ciSummary', 'ciList'],
    render: d => [checkinForm(d), checkinSummary(d), checkinList(d)] },
  piano: { path: '/v1/plan', ids: ['planHeader', 'planScheda', 'planAdherence', 'planNotes', 'planPhases'],
    render: d => { setPlan(d); return [planHeader(d), planScheda(d), '', planNotes(d), planPhases(d)]; } },
};
let cmpDays = 14;
async function loadCompare(days = cmpDays) {
  cmpDays = days;
  try { $('compareBox').innerHTML = compareView(await getJson(`/v1/compare?days=${days}`)); } catch { $('compareBox').innerHTML = ''; } // sezione accessoria
}
async function loadAi() {
  try { $('aiBox').innerHTML = aiView(await getJson('/v1/ai/status')); } catch { $('aiBox').innerHTML = ''; } // sezione accessoria
}
async function loadAdherence() {
  try { const d = await getJson('/v1/plan/adherence'); $('planAdherence').innerHTML = adherenceView(d.adherence); } catch { $('planAdherence').innerHTML = ''; } // sezione accessoria: se manca, il resto del Piano funziona
}
async function loadView(name) {
  const v = VIEWS[name];
  try {
    const html = v.render(await getJson(v.days ? `${v.path}?days=${v.days}` : v.path));
    v.ids.forEach((id, i) => { $(id).innerHTML = html[i]; });
    if (name === 'piano') loadAdherence();
    if (name === 'coach') { loadCompare(); loadAi(); }
  } catch (e) { v.ids.forEach((id, i) => { $(id).innerHTML = i === 0 ? `<div class="empty">${esc(e.message)}</div>` : ''; }); }
}
for (const [name, v] of Object.entries(VIEWS).filter(([, x]) => x.chips)) {
  $(v.chips).addEventListener('click', ev => {
    const b = ev.target.closest('button[data-days]'); if (!b) return;
    v.days = Number(b.dataset.days);
    for (const c of $(v.chips).querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(c === b));
    loadView(name);
  });
}

bindCompare({ root: $('view-coach'), load: loadCompare });
bindAi({ root: $('aiBox'), reload: loadAi });
bindWeights({ root: $('view-peso'), reload: () => loadView('peso') });
bindCheckin({ root: $('view-recupero'), reload: () => loadView('recupero') });
bindPlan({ root: $('view-piano'), dialog: $('planDialog'), reload: () => loadView('piano') });

// ---- Navigazione a schede (hash) ----
const TABS = ['recupero', 'coach', 'piano', 'home', 'allenamenti', 'peso', 'alimentazione', 'sonno', 'passi'], loadedTabs = new Set();
function route() {
  const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'recupero'; // Recupero = schermata di apertura
  for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== tab;
  for (const a of document.querySelectorAll('.tabs a')) { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  if (tab !== 'home' && !loadedTabs.has(tab)) { loadedTabs.add(tab); if (tab === 'allenamenti') loadTraining(true); else loadView(tab); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
refresh();
route();
