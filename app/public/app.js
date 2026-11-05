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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
refresh();
