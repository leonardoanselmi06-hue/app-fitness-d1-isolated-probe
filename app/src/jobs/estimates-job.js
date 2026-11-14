// Importazione automatica dei pasti stimati da ChatGPT dalla cartella Drive condivisa (cron + POST /v1/sync/estimates).
// Attiva solo con GOOGLE_SA_KEY (account di servizio con accesso alla sola cartella) e ESTIMATES_FOLDER_ID. Sola lettura: i file non vengono toccati.
// Un file non valido viene saltato e contato (mai blocca gli altri); i pasti già importati sono un NO-OP (id del pasto = chiave).
import { DriveFolderReader } from '../storage/drive-folder-reader.js';
import { makeRawStore } from '../storage/drive-rawstore.js';
import { UnconfiguredRawStore } from '../storage/rawstore.js';
import { importEstimates, BACKFILL_DAYS } from '../nutrition/estimates.js';
import { AppError } from '../core/errors.js';
import { localDate } from '../core/time.js';

export const MAX_FILES = 10;
export async function runEstimatesImport(env, { now = () => new Date(), reader, rawStore } = {}) {
  if (!env.GOOGLE_SA_KEY || !env.ESTIMATES_FOLDER_ID) return { ran: false, reason: 'disabled' };
  if (!env.DB) return { ran: false, reason: 'no_database' };
  const raw = rawStore ?? makeRawStore(env); if (raw instanceof UnconfiguredRawStore) return { ran: false, reason: 'raw_store_unconfigured' };
  const nowIso = now().toISOString(), today = localDate(nowIso, 'Europe/Rome');
  try {
    const rd = reader ?? new DriveFolderReader({ serviceAccount: env.GOOGLE_SA_KEY, folderId: env.ESTIMATES_FOLDER_ID });
    const since = new Date(now().getTime() - (BACKFILL_DAYS + 5) * 86_400_000).toISOString();
    const files = (await rd.listJson({ since })).slice(0, MAX_FILES);
    let imported = 0, unchanged = 0, rejected = 0;
    for (const f of files) {
      try {
        const body = JSON.parse(await rd.readText(f.id));
        const r = await importEstimates(env.DB, raw, 'owner', body, { today, nowIso });
        if (r.new_or_changed > 0) imported += r.new_or_changed; else unchanged++;
      } catch (e) { if (e instanceof AppError && e.status === 503) throw e; rejected++; } // file non valido/troppo grande/JSON errato: saltato
    }
    return { ran: true, ok: true, files: files.length, imported, unchanged, rejected };
  } catch (e) {
    return { ran: true, ok: false, reason: e instanceof AppError ? e.code : 'internal_error' };
  }
}
