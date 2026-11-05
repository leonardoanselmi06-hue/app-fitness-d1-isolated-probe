// Prova l'adapter Drive su Drive REALE con un file SINTETICO (nessun dato personale). Stampa solo esito e dimensioni, mai i token.
import { makeRawStore, DriveRawStore } from '../src/storage/drive-rawstore.js';
import { sha256Hex } from '../src/core/hash.js';

const store = makeRawStore(process.env);
if (!(store instanceof DriveRawStore)) { console.error('::error::Servono i secret GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN'); process.exit(1); }
const fail = m => { console.error(`::error::${m}`); process.exit(1); };
try {
  const payload = new TextEncoder().encode('﻿' + JSON.stringify({ synthetic: true, probe: 'drive-probe', samples: Array.from({ length: 2000 }, (_, i) => 60 + (i % 7)) }));
  const sha = await sha256Hex(payload);
  const a = await store.put(sha, payload);
  const b = await store.put(sha, payload);
  if (a.ref !== b.ref) fail('put non idempotente: ref diversi per lo stesso contenuto');
  const back = await store.get(a.ref);
  if ((await sha256Hex(back)) !== sha || back.byteLength !== payload.byteLength) fail('round-trip non identico');
  console.log(`Drive OK: scritto, riletto e verificato (${payload.byteLength} byte), put ripetuto idempotente. Cartella radice: ${store.folderName}`);
} catch (e) { fail(`Drive non utilizzabile: ${e.code ?? e.name} (HTTP ${e.status ?? '?'})`); }
