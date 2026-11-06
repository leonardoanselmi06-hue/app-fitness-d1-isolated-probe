// Sezione "Consigli dell'IA" nella scheda Coach. Rendering puro (testabile in Node) + collegamento al DOM.
import { esc, shortDate } from './views.js';

const FB = [['seguito', 'Seguito'], ['parziale', 'In parte'], ['non_seguito', 'Non seguito'], ['non_utile', 'Non utile']];
const CONF = { alta: 'fiducia alta', media: 'fiducia media', bassa: 'fiducia bassa' };

const priority = (p, i, id, fb) => `<li class="ai-p"><div><span class="tag info">${esc(p.area)}</span> <strong>${esc(p.title)}</strong> <small>${esc(CONF[p.confidence] ?? '')}${p.check_in_days ? ` · verifica tra ${p.check_in_days} gg` : ''}</small></div>
<p>${esc(p.why)}</p>
${p.evidence?.length ? `<ul class="ai-ev">${p.evidence.map(e => `<li>${e.verified === false ? '<span title="Numero non trovato nei dati inviati: verificalo">⚠</span> ' : ''}${esc(e.label)}: <strong>${esc(e.value)}</strong></li>`).join('')}</ul>` : ''}
<ol class="ai-act">${p.actions.map(a => `<li>${esc(a)}</li>`).join('')}</ol>
${id != null ? `<div class="chips" data-ai-fb="${id}:${i}">${FB.map(([k, l]) => `<button class="chip" type="button" data-ai-status="${k}" aria-pressed="${fb?.[i] === k}">${l}</button>`).join('')}</div>` : ''}</li>`;

export function adviceBody(r, feedback = null) {
  const a = r.advice; if (!a) return '';
  return `<p class="subtle">${esc(shortDate(r.created_at.slice(0, 10)))} · ${esc(r.model ?? '')}${r.cached ? ' · risultato recente riutilizzato' : ''}${r.unverified ? ` · ⚠ ${r.unverified} numeri da verificare` : ''}</p>
<p>${esc(a.summary)}</p><ul class="ai-list">${a.priorities.map((p, i) => priority(p, i, r.id, feedback)).join('')}</ul>
${a.watch?.length ? `<h3>Da tenere d'occhio</h3><ul>${a.watch.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
${a.questions?.length ? `<h3>Cosa mi manca</h3><ul>${a.questions.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
}

export function aiView(st) {
  const head = '<h2 class="sec">Consigli dell\'IA</h2>';
  const note = '<p class="subtle">Analisi automatica dei tuoi dati: non è consulenza medica. Per dolore, sintomi o dubbi sulla salute rivolgiti a un medico.</p>';
  if (!st.configured) return `${head}<div class="empty">IA non configurata. Imposta su Cloudflare le variabili AI_PROVIDER, AI_MODEL e il segreto AI_API_KEY (per un servizio compatibile OpenAI anche AI_BASE_URL).</div>${note}`;
  return `${head}<div class="ai-bar"><input id="aiFocus" type="text" maxlength="300" placeholder="Domanda o tema (facoltativo)" aria-label="Tema"><button class="btn" type="button" id="aiRun">Analizza ora</button></div>
<label class="subtle"><input type="checkbox" id="aiNotes" ${st.send_notes ? 'checked' : ''}> Invia anche il testo delle note</label>
<p class="subtle" id="aiMsg">${esc(st.provider)} · ${esc(st.model)} · oggi ${st.used_today}/${st.daily_limit} analisi</p>
<div id="aiOut">${st.latest ? adviceBody(st.latest, st.latest.feedback) : '<div class="empty">Nessuna analisi ancora.</div>'}</div>
${st.history.length ? `<h3>Precedenti</h3><ul class="rows">${st.history.map(h => `<li><span>${esc(shortDate(h.created_at.slice(0, 10)))}</span><small>${esc(h.priorities.join(' · '))}</small></li>`).join('')}</ul>` : ''}${note}`;
}

const ERR = { ai_not_configured: 'IA non configurata.', ai_daily_limit: 'Limite giornaliero raggiunto.', ai_rate_limited: 'Il servizio IA è saturo: riprova tra poco.', ai_unreachable: 'Servizio IA non raggiungibile.', ai_provider_error: 'Errore del servizio IA (controlla modello e chiave).', ai_invalid_response: 'Risposta dell\'IA non valida: riprova.', ai_empty_response: 'Risposta vuota: riprova.' };
async function send(path, body) {
  const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(ERR[j.error] ?? j.error ?? 'Errore'); return j;
}
export function bindAi({ root, reload }) {
  root.addEventListener('click', async ev => {
    const run = ev.target.closest('#aiRun'), fb = ev.target.closest('button[data-ai-status]'), msg = root.querySelector('#aiMsg');
    try {
      if (run) { run.disabled = true; if (msg) msg.textContent = 'Analisi in corso… può richiedere fino a un minuto.'; const focus = root.querySelector('#aiFocus').value.trim(); await send('/v1/ai/advice', focus ? { focus } : { force: true }); reload(); }
      else if (fb) { const [id, index] = fb.parentElement.dataset.aiFb.split(':').map(Number); await send('/v1/ai/feedback', { advice_id: id, index, status: fb.dataset.aiStatus }); for (const c of fb.parentElement.children) c.setAttribute('aria-pressed', String(c === fb)); }
    } catch (e) { if (msg) msg.textContent = e.message; if (run) run.disabled = false; }
  });
  root.addEventListener('change', async ev => { if (ev.target.id !== 'aiNotes') return; try { await send('/v1/ai/settings', { send_notes: ev.target.checked }); } catch { ev.target.checked = !ev.target.checked; } });
}
