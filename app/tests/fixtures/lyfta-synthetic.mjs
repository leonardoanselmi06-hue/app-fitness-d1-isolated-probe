// Fixture SINTETICHE (nessun dato personale). Campi come da contratto Drive e documentazione ufficiale Lyfta (excercise_name, total_records/total_pages/current_page).
export const workout = (id, extra = {}) => ({
  id, title: `Sintetico ${id}`, body_weight: '72.5', workout_perform_date: '2026-10-15 16:12:00', volume: 1200,
  exercises: [
    { exercise_id: 11, excercise_name: 'Pull Up', exercise_rest_time: 18, sets: [
      { id: 900000 + id, weight: '0', reps: 9, rir: 1, set_type_id: 0, is_completed: true },
      { id: 0, weight: 'null', reps: '', rir: null, duration: 60, distance: 'null', set_type_id: 1, is_completed: 'true' },
      { id: 900100 + id, weight: '5', reps: 6, rir: 0, set_type_id: 10, is_completed: true },
    ] },
    { exercise_id: 12, excercise_name: 'Run on Treadmill', exercise_rest_time: null, sets: [
      { id: 0, duration: 1200, distance: 3000, set_type_id: 0, is_completed: true },
    ] },
  ],
  ...extra,
});

export function makePager(total, limit = 20, mutate = id => workout(id)) {
  const all = Array.from({ length: total }, (_, i) => mutate(1000 + i));
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pager = async page => ({ workouts: all.slice((page - 1) * limit, page * limit), status: true, count: Math.min(limit, Math.max(0, total - (page - 1) * limit)), total_records: total, total_pages: totalPages, current_page: page, limit });
  pager.all = all;
  return pager;
}
