// Interazione del tab Piano (DOM): apre i moduli, invia le modifiche all'API (solo proprietario) e ricarica la vista.
import { esc } from './views.js';
import { historyList, rxLine } from './plan.js';
import { rxForm, dayForm, noteForm, phaseForm, closeForm, importForm, buildRequest, errorText } from './plan-forms.js';
import { reportView } from './plan-report.js';

let plan = null;
export const setPlan = d => { plan = d; };
const today = () => plan?.today ?? new Date().toISOString().slice(0, 10);
const findEx = key => plan?.active?.days.flatMap(d => d.exercises).find(e => e.key === key);
const findDay = key => plan?.active?.days.find(d => d.key === key);

async function api(path, body) {
  const r = await fetch(path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(errorText(j.error)); e.code = j.error; throw e; }
  return j;
}

export function bindPlan({ root, dialog, reload }) {
  const show = html => { dialog.innerHTML = html; if (!dialog.open) dialog.showModal(); };
  const close = () => { if (dialog.open) dialog.close(); };
  const phaseStart = () => plan.active?.start_date, phaseId = () => plan.active?.id;
  async function history(kind, entity) {
    try { const { versions } = await api(`/v1/plan/history?entity=${encodeURIComponent(entity)}`); show(`<h2>Storico</h2>${historyList(kind, versions)}<div class="prow"><button type="button" class="pbtn sec" data-act="close">Chiudi</button></div>`); }
    catch (e) { show(`<p class="perr">${esc(e.message)}</p><button type="button" class="pbtn sec" data-act="close">Chiudi</button>`); }
  }
  async function showReport(id) {
    try { const { report } = await api(`/v1/plan/report?phase_id=${id}`); show(`${reportView(report)}<div class="prow"><button type="button" class="pbtn sec" data-act="close">Chiudi</button></div>`); }
    catch (e) { show(`<p class="perr">${esc(e.message)}</p>`); }
  }
  async function openImport(from, to) {
    try { const sug = await api(`/v1/plan/suggest?from=${from}&to=${to}`); show(importForm({ sug, phase: plan.active })); }
    catch (e) { show(`<p class="perr">${esc(e.message)}</p><button type="button" class="pbtn sec" data-act="close">Chiudi</button>`); }
  }
  async function phaseScheda(id) {
    try {
      const { versions } = await api(`/v1/plan/history?phase_id=${id}`); const last = new Map(); for (const v of versions) last.set(v.entity_key, v);
      const rows = [...last.values()].filter(v => v.kind === 'rx' && !v.data.removed).map(v => `<li><strong>${esc(v.data.day)} · ${esc(v.data.exercise)}</strong><span>${esc(rxLine(v.data))}</span><small>${versions.filter(x => x.entity_key === v.entity_key).length} versioni</small></li>`);
      show(`<h2>Scheda finale</h2>${rows.length ? `<ol class="phist">${rows.join('')}</ol>` : '<div class="empty">Scheda vuota.</div>'}<div class="prow"><button type="button" class="pbtn sec" data-act="close">Chiudi</button></div>`);
    } catch (e) { show(`<p class="perr">${esc(e.message)}</p>`); }
  }
  root.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-act]'); if (!b || !plan) return;
    const { act, key, day, id, kind, entity } = b.dataset, a = plan.active, t = today();
    if (act === 'rx-new') show(rxForm({ mode: 'new', day, today: t, phaseStart: phaseStart(), phaseId: phaseId() }));
    else if (act === 'rx-edit') { const e = findEx(key); if (e) show(rxForm({ mode: 'edit', day: e.day, e, today: t, phaseStart: phaseStart(), phaseId: phaseId() })); }
    else if (act === 'day-new') show(dayForm({ mode: 'new', today: t, phaseStart: phaseStart(), phaseId: phaseId() }));
    else if (act === 'day-edit') { const d = findDay(key); if (d) show(dayForm({ mode: 'edit', day: d, today: t, phaseStart: phaseStart(), phaseId: phaseId() })); }
    else if (act === 'note-new') show(noteForm({ today: t }));
    else if (act === 'note-edit') { const n = plan.notes.find(x => x.note_id === id); if (n) show(noteForm({ n, today: t })); }
    else if (act === 'phase-new') show(phaseForm({ mode: 'new', today: t, closed: plan.phases.filter(p => p.status === 'closed') }));
    else if (act === 'phase-edit' && a) show(phaseForm({ mode: 'edit', a, today: t }));
    else if (act === 'phase-close' && a) show(closeForm({ a, today: t }));
    else if (act === 'import' && a) openImport(a.start_date, t);
    else if (act === 'hist') history(kind, entity);
    else if (act === 'report') showReport(id);
    else if (act === 'phase-hist') phaseScheda(id);
  });
  dialog.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    if (b.dataset.act === 'close') return close();
    if (b.dataset.act === 'import-refresh') { const f = dialog.querySelector('#planForm'); return openImport(f.elements.from.value, f.elements.to.value); }
    const form = dialog.querySelector('#planForm'); if (!form) return;
    if (['rx-remove', 'day-remove', 'note-remove'].includes(b.dataset.act) && form.reportValidity()) submit(form, b.dataset.act);
  });
  dialog.addEventListener('submit', ev => { ev.preventDefault(); submit(ev.target, ev.target.dataset.submit); });
  async function submit(form, action) {
    const err = form.querySelector('#planErr'); err.textContent = '';
    if (action.endsWith('-remove') && !confirm('Confermi? Lo storico resta consultabile.')) return;
    const buttons = form.querySelectorAll('button'); buttons.forEach(x => { x.disabled = true; });
    try {
      const v = Object.fromEntries(new FormData(form)); const { path, body } = buildRequest(action, v, form.dataset);
      await api(path, body); close(); await reload();
    } catch (e) { err.textContent = e.message; buttons.forEach(x => { x.disabled = false; }); if (e.code === 'stale') { close(); await reload(); } }
  }
}
