// Riepilogo derivato (on demand, DEC-ANA-001): solo copertura e ultimi allenamenti. I dati mancanti sono null, mai zero.
import { DOMAINS } from '../ingest/envelope.js';
import { getGeneration, listCanonical } from '../ingest/ledger.js';

export async function summarize(db, subject) {
  const generation = await getGeneration(db);
  const coverage = {};
  for (const d of DOMAINS) coverage[d] = (await db.prepare('SELECT COUNT(*) AS n FROM current_records WHERE subject_id = ? AND domain = ? AND deleted = 0').bind(subject, d).first()).n;
  const training = (await listCanonical(db, subject, 'training')).slice(-30).reverse().map(r => ({
    date: r.payload.local_date ?? null, title: r.payload.title ?? null, exercises: (r.payload.exercises ?? []).length, source: r.source_system,
  }));
  return { generation, timezone: 'Europe/Rome', coverage, training_sessions: training, note: 'Dati mancanti = null (mai zero). Nessuna inferenza AI.' };
}
