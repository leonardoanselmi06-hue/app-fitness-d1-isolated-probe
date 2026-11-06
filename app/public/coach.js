// Rendering puro (stringhe HTML) della scheda Coach. Nessun accesso al DOM: testabile in Node. Tutto il testo del server è escapato.
import { esc, fullDate } from './views.js';

const STATUS = { attenzione: ['Da sistemare', 'warn'], ok: ['In linea', 'ok'], info: ['Nota', 'info'], insufficiente: ['Dati insufficienti', 'muted'] };
const tag = status => { const [label, cls] = STATUS[status] ?? ['—', 'muted']; return `<span class="tag ${cls}">${esc(label)}</span>`; };

export function coachHeader(d) {
  const t = d.targets, v = t.version, wr = t.values?.weight_pct_week, w = wr ? `${String(wr.min).replace('.', ',')} … ${String(wr.max).replace('.', ',')}` : null;
  const plan = v
    ? `<strong>Fase: ${esc(v.phase)}</strong><small>${esc(v.goal)}${v.goal_type ? ` · ${esc(v.goal_type)}` : ''} · target dal ${esc(fullDate(v.valid_from))}${v.source === 'phase' ? ' · definiti nella fase (scheda Piano)' : ''}</small>${w ? `<small>Ritmo del peso previsto: ${esc(w)} %/sett.</small>` : ''}`
    : '<strong>Target generici</strong><small>Non hai ancora impostato i tuoi obiettivi: uso valori generici per la massa muscolare.</small>';
  const s = d.summary;
  return `<div class="coachplan">${plan}</div>
  <div class="kvgrid">
    <div class="kv"><span>Da sistemare</span><strong>${s.attention}</strong></div>
    <div class="kv"><span>In linea</span><strong>${s.ok}</strong></div>
    <div class="kv"><span>Dati insufficienti</span><strong>${s.insufficient}</strong></div>
    <div class="kv"><span>Dati al</span><strong>${esc(fullDate(d.as_of))}</strong></div>
  </div>`;
}

export function coachActions(d) {
  if (!d.actions.length) return '<h2 class="sec">Azioni della settimana</h2><div class="empty">Nessuna azione urgente: sei in linea con gli obiettivi.</div>';
  return `<h2 class="sec">Azioni della settimana</h2><ol class="actions">${d.actions.map(a => `<li><strong>${esc(a.title)}</strong><span>${esc(a.text)}</span></li>`).join('')}</ol>`;
}

export function coachInsights(d) {
  return `<h2 class="sec">Revisione</h2>${d.insights.map(i => `<details class="wcard"${i.status === 'attenzione' ? ' open' : ''}>
    <summary><div class="wmain"><strong>${esc(i.title)}</strong><small>${esc(i.summary)}</small></div>${tag(i.status)}</summary>
    ${i.evidence.length ? `<div class="evidence"><span class="evlabel">Perché</span><ul>${i.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    ${i.action ? `<div class="evidence"><span class="evlabel">Cosa fare</span><p>${esc(i.action)}</p></div>` : ''}
  </details>`).join('')}`;
}

export function coachTests(d) {
  return `<h2 class="sec">Test da fare</h2>${d.tests.map(t => `<details class="wcard"${t.due ? ' open' : ''}>
    <summary><div class="wmain"><strong>${esc(t.title)}</strong><small>${esc(t.reason)}</small></div>${t.due ? '<span class="tag warn">Da fare</span>' : '<span class="tag muted">Non ancora</span>'}</summary>
    <div class="evidence"><ol>${t.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>
  </details>`).join('')}<p class="disclaimer">${esc(d.disclaimer)}</p>`;
}
