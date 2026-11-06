import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, shortDate, setLine, workoutCard, weightChart, weightSummary, weightRecent, trainingList } from '../public/views.js';

const summary = { exercises: 1, working_sets: 2, warmup_sets: 0, reps_total: 16, external_load_volume_kg: null };

test('esc: neutralizza HTML; null/undefined diventano un trattino', () => {
  assert.equal(esc('<script>"x"&\'</script>'), '&lt;script&gt;&quot;x&quot;&amp;&#39;&lt;/script&gt;');
  assert.equal(esc(null), '—'); assert.equal(esc(undefined), '—');
});

test('date in italiano e valori non validi', () => {
  assert.equal(shortDate('2026-11-05'), '5 nov'); assert.equal(shortDate(null), '—'); assert.equal(shortDate('boh'), '—');
});

test('serie: carico, ripetizioni, durata, distanza senza unità inventata, RIR e tag', () => {
  assert.match(setLine({ reps: 8, external_load_kg: 42.5, rir: 2, set_type: 'NORMAL', warmup: false, completed: true }), /8 × 42,5 kg · RIR 2/);
  assert.match(setLine({ reps: 10, external_load_kg: 0, set_type: 'NORMAL', warmup: false }), /10 rep/); // zavorra 0 = corpo libero
  assert.match(setLine({ duration_sec: 75, distance: 4, set_type: 'NORMAL', warmup: false }), /1:15 · dist\. 4/);
  assert.match(setLine({ reps: 5, warmup: true, set_type: 'WARMUP' }), /risc\./);
  assert.match(setLine({ reps: 5, set_type: 'FAILURE', warmup: false }), /failure/);
  assert.ok(!/non completata/.test(setLine({ reps: 5, set_type: 'NORMAL', warmup: false, completed: false }))); // flag non affidabile: nessuna etichetta
  assert.match(setLine({ set_type: 'NORMAL', warmup: false }), /<span>dato non registrato<\/span>/);
});

test('scheda allenamento: titolo e nomi escapati, riepilogo senza volume quando è null', () => {
  const html = workoutCard({ date: '2026-11-02', title: '<img src=x onerror=1>', summary, exercises: [{ name: '<b>Squat</b>', sets: [{ reps: 8, external_load_kg: 60, set_type: 'NORMAL', warmup: false }] }] });
  assert.ok(!html.includes('<img') && !html.includes('<b>'));
  assert.match(html, /2 nov/); assert.match(html, /2 serie · 16 rep/); assert.ok(!html.includes('carico esterno'));
  assert.match(trainingList({ workouts: [] }), /Nessun allenamento/);
});

test('grafico peso: SVG con proporzioni mantenute, decimali italiani, messaggio con meno di due giorni', () => {
  assert.match(weightChart([{ date: '2026-11-01', kg: 72 }]), /almeno due giorni/);
  const svg = weightChart([{ date: '2026-10-01', kg: 74.2 }, { date: '2026-10-15', kg: 73.5 }, { date: '2026-11-01', kg: 72.9 }]);
  assert.match(svg, /^<svg viewBox="0 0 360 190"/); assert.ok(!svg.includes('preserveAspectRatio'));
  assert.match(svg, /<path d="M/); assert.match(svg, /1 ott/); assert.match(svg, /1 nov/); assert.match(svg, /73,\d/);
  assert.ok(!/NaN|undefined/.test(svg));
  assert.ok(!/NaN/.test(weightChart([{ date: '2026-10-01', kg: 70 }, { date: '2026-10-02', kg: 70 }]))); // serie piatta: nessuna divisione per zero
});

test('riepilogo peso: segni, dati insufficienti e pesate escluse', () => {
  const base = { latest: { kg: 71.85, local_date: '2026-11-06' }, avg_7d: 72.26, avg_prev_7d: 73.2, delta_7d: -0.94, change_in_window: -2.15, count: 7, min: { kg: 71.85, local_date: '2026-11-06' }, max: { kg: 74, local_date: '2026-10-20' }, excluded_count: 2, recent: [{ local_date: '2026-11-06', kg: 71.85 }] };
  const html = weightSummary(base);
  assert.match(html, /<strong>71,9 kg<\/strong>/); assert.match(html, /<strong>72,3 kg<\/strong>/); // 71,85 e 72,26 arrotondati al decimo
  assert.match(html, /−0,9 kg rispetto ai 7 giorni prima/); assert.match(html, /−2,2 kg/);
  assert.match(weightSummary({ ...base, delta_7d: null }), /dati insufficienti/);
  assert.match(weightSummary({ latest: null }), /Nessuna pesata/);
  assert.match(weightRecent(base), /2 pesate escluse manualmente/); assert.match(weightRecent(base), /71,85 kg/);
  assert.match(weightRecent({ ...base, excluded_count: 1 }), /1 pesata esclusa/);
});
