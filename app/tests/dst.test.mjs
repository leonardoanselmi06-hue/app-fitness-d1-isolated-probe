import test from 'node:test';
import assert from 'node:assert/strict';
import { localDate, utcNaiveToInstant } from '../src/core/time.js';
import { normalizeWorkout } from '../src/adapters/lyfta/normalize.js';
import { workout } from './fixtures/lyfta-synthetic.mjs';

// Cambio ora legale Europe/Rome: 29 marzo 2026 (01:00 UTC, CET->CEST) e 25 ottobre 2026 (01:00 UTC, CEST->CET).
// Valori attesi calcolati A MANO dalle regole UE (CET=UTC+1, CEST=UTC+2), non dall'implementazione.
// Questi test verificano la NOSTRA conversione (UTC -> giorno locale). NON dimostrano che Lyfta usi UTC al cambio ora (resta PENDING).
const day = s => normalizeWorkout(workout(1, { workout_perform_date: s })).payload.local_date;

test('autunno 2026 (25/10, CEST->CET): bordi di mezzanotte locale', () => {
  assert.equal(day('2026-10-24 21:59:59'), '2026-10-24'); // 23:59:59 CEST del 24
  assert.equal(day('2026-10-24 22:00:00'), '2026-10-25'); // 00:00 CEST del 25
  assert.equal(day('2026-10-25 22:59:59'), '2026-10-25'); // 23:59:59 CET del 25 (giornata di 25 ore)
  assert.equal(day('2026-10-25 23:00:00'), '2026-10-26'); // 00:00 CET del 26
});

test('primavera 2026 (29/03, CET->CEST): bordi di mezzanotte locale', () => {
  assert.equal(day('2026-03-28 22:59:59'), '2026-03-28'); // 23:59:59 CET del 28
  assert.equal(day('2026-03-28 23:00:00'), '2026-03-29'); // 00:00 CET del 29
  assert.equal(day('2026-03-29 21:59:59'), '2026-03-29'); // 23:59:59 CEST del 29 (giornata di 23 ore)
  assert.equal(day('2026-03-29 22:00:00'), '2026-03-30'); // 00:00 CEST del 30
});

test('istante UTC e giorno locale restano coerenti attorno al salto (nessun buco né doppione di giorno)', () => {
  for (const [from, to] of [['2026-03-28T20:00:00Z', '2026-03-30T02:00:00Z'], ['2026-10-24T20:00:00Z', '2026-10-26T02:00:00Z']]) {
    let prev = null; const seen = [];
    for (let t = Date.parse(from); t <= Date.parse(to); t += 30 * 60 * 1000) {
      const d = localDate(new Date(t).toISOString());
      if (d !== prev) seen.push(d); if (prev && d < prev) assert.fail(`il giorno locale torna indietro a ${new Date(t).toISOString()}`);
      prev = d;
    }
    assert.equal(new Set(seen).size, seen.length, 'ogni giorno locale compare una sola volta in sequenza');
    assert.equal(seen.length, 3, `tre giorni locali consecutivi nell'intervallo ${from}..${to}`);
  }
});

test('l\'istante conservato è sempre UTC con millisecondi, anche attorno al salto', () => {
  for (const s of ['2026-03-29 00:59:59', '2026-03-29 01:00:00', '2026-10-25 00:59:59', '2026-10-25 01:00:00']) {
    assert.equal(utcNaiveToInstant(s), s.replace(' ', 'T') + '.000Z');
  }
});
