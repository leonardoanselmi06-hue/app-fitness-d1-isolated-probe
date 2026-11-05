// Fixture SINTETICHE (nessun dato personale). Nomi dei campi come da contratto Drive; nome esercizio e paginazione = assunzioni.
export const workout = (id, extra = {}) => ({
  id, title: `Sintetico ${id}`, body_weight: '72.5', workout_perform_date: '2026-10-15 16:12:00', volume: 1200,
  exercises: [
    { exercise_id: 11, exercise_name: 'Pull Up', exercise_rest_time: 18, sets: [
      { id: 900000 + id, weight: '0', reps: 9, rir: 1, set_type_id: 0, is_completed: true },
      { id: 0, weight: 'null', reps: '', rir: null, duration: 60, distance: 'null', set_type_id: 1, is_completed: 'true' },
      { id: 900100 + id, weight: '5', reps: 6, rir: 0, set_type_id: 10, is_completed: true },
    ] },
    { exercise_id: 12, exercise_name: 'Run on Treadmill', exercise_rest_time: null, sets: [
      { id: 0, duration: 1200, distance: 3000, set_type_id: 0, is_completed: true },
    ] },
  ],
  ...extra,
});

export function makePager(total, limit = 20, mutate = id => workout(id)) {
  const all = Array.from({ length: total }, (_, i) => mutate(1000 + i));
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pager = async page => ({ workouts: all.slice((page - 1) * limit, page * limit), pagination: { page, total, total_pages: totalPages } });
  pager.all = all;
  return pager;
}
