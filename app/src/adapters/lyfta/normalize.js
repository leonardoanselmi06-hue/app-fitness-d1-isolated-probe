// Normalizzatore Lyfta -> record canonici 'training'. Contratto: Decision Register DEC-TRAIN-001/002/003 e doc 03.
// ATTENZIONE: i nomi dei campi sono quelli documentati in Drive (workout id/title/body_weight/workout_perform_date/volume;
// exercise_id/exercise_rest_time; set id/weight/reps/rir/duration/distance/set_type_id/is_completed).
// Il campo del NOME esercizio NON è documentato: viene letto da candidati e marcato name_source;
// va confermato su un payload reale (richiede approvazione: nessun dato personale nei test).
import { utcNaiveToInstant, localDate } from '../../core/time.js';

export const ADAPTER_VERSION = 'lyfta-normalizer/0.1.0';
export const SET_TYPES = Object.freeze({ 0: 'NORMAL', 1: 'WARMUP', 2: 'RIGHT', 3: 'LEFT', 4: 'FAILURE', 8: 'MYO_REPS', 9: 'FEEDER', 10: 'TOP' });

// L'API usa null JSON, la stringa "null" e la stringa vuota per l'assenza: normalizzazione deterministica.
export const absent = v => v === undefined || v === null || v === '' || (typeof v === 'string' && v.trim().toLowerCase() === 'null');
export function num(v) {
  if (absent(v)) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function normalizeSet(s, ex, wi, ei, si) {
  const typeId = num(s.set_type_id);
  const nativeId = num(s.id);
  return {
    // set.id può essere 0 (duration/cardio): chiave posizionale sempre presente, id nativo solo se > 0
    key: `${wi}:${ei}:${si}`,
    native_set_id: nativeId && nativeId > 0 ? nativeId : null,
    set_type_id: typeId,
    set_type: typeId == null ? null : (SET_TYPES[typeId] ?? `UNKNOWN_${typeId}`),
    // DEC-TRAIN-001: il peso è SOLO zavorra esterna; il peso corporeo non viene mai sommato
    external_load_kg: num(s.weight),
    reps: num(s.reps),
    rir: num(s.rir),
    duration_sec: num(s.duration),
    distance: num(s.distance),
    completed: absent(s.is_completed) ? null : (s.is_completed === true || s.is_completed === 1 || s.is_completed === '1' || s.is_completed === 'true'),
    warmup: typeId === 1,
  };
}

export function normalizeExercise(ex, wi, ei) {
  const restRaw = num(ex.exercise_rest_time);
  const nameKey = ['exercise_name', 'name', 'title'].find(k => !absent(ex[k]));
  return {
    exercise_id: num(ex.exercise_id),
    name: nameKey ? String(ex[nameKey]) : null,
    name_source: nameKey ?? null, // UNVERIFIED: vedi nota in testa al file
    type: absent(ex.exercise_type ?? ex.type) ? null : String(ex.exercise_type ?? ex.type),
    // exercise_rest_time è recupero CONFIGURATO, non eseguito: ×5 secondi (handoff §4)
    configured_rest_sec: restRaw == null ? null : restRaw * 5,
    sets: (ex.sets ?? []).map((s, si) => normalizeSet(s, ex, wi, ei, si)),
  };
}

/** @returns {{id:string, domain:'training', observed_at:string|null, payload:object}} oppure lancia su workout senza id */
export function normalizeWorkout(w, wi = 0) {
  const id = num(w.id);
  if (id == null) throw new Error('lyfta_workout_without_id');
  const startAt = utcNaiveToInstant(w.workout_perform_date);
  return {
    id: `workout:${id}`,
    domain: 'training',
    observed_at: startAt,
    payload: {
      adapter_version: ADAPTER_VERSION,
      native_workout_id: id,
      title: absent(w.title) ? null : String(w.title),
      start_at: startAt,
      local_date: startAt ? localDate(startAt) : null,
      time_semantics: 'utc_naive_assumed', // VERIFIED_FOR_OBSERVED_CEST_DATES; DST PENDING
      // peso corporeo registrato da Lyfta: campo SEPARATO, mai fuso col carico delle serie
      user_body_weight_kg: num(w.body_weight),
      source_volume: num(w.volume),
      exercises: (w.exercises ?? []).map((ex, ei) => normalizeExercise(ex, wi, ei)),
    },
  };
}
