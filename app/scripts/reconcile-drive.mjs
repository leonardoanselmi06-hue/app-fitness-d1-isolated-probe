// Uso: node scripts/reconcile-drive.mjs refs.json   (refs.json = righe {artifact_ref, artifact_sha256} da D1). Stampa SOLO conteggi.
import { readFileSync } from 'node:fs';
import { makeRawStore, DriveRawStore } from '../src/storage/drive-rawstore.js';
import { reconcile } from '../src/jobs/reconcile.js';

const store = makeRawStore(process.env);
if (!(store instanceof DriveRawStore)) { console.error('::error::Servono i secret GOOGLE_*'); process.exit(1); }
const refs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const r = await reconcile({ refs, store });
console.log(`Riconciliazione D1↔Drive: riferimenti D1=${r.referenced}, file su Drive=${r.on_drive}, mancanti=${r.missing.length}, hash diversi=${r.sha_mismatch.length}, corrotti=${r.corrupt.length}, orfani=${r.orphans.length}`);
if (r.orphans.length) console.log('Nota: gli orfani sono file RAW immutabili non referenziati (es. commit D1 non riuscito dopo la scrittura): non vengono cancellati.');
if (!r.ok) { console.error('::error::Riconciliazione FALLITA: dati mancanti o corrotti'); process.exit(1); }
