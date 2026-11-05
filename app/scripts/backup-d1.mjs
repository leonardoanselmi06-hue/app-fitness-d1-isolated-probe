// Uso: node scripts/backup-d1.mjs dump.sql counts.json
// 1) RESTORE TEST locale: carica il dump in SQLite in memoria, integrity_check, conteggi uguali a quelli di D1.
// 2) Carica il dump (gzip, nome = sha256) su Drive con l'adapter, lo RILEGGE e verifica l'hash. Stampa solo dimensioni e conteggi.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { makeRawStore, DriveRawStore } from '../src/storage/drive-rawstore.js';
import { sha256Hex } from '../src/core/hash.js';

const fail = m => { console.error(`::error::${m}`); process.exit(1); };
const [sqlPath, countsPath] = process.argv.slice(2);
const bytes = new Uint8Array(readFileSync(sqlPath)); const sql = new TextDecoder().decode(bytes);
const expected = Object.fromEntries(JSON.parse(readFileSync(countsPath, 'utf8')).map(r => [r.t, r.n]));

const db = new DatabaseSync(':memory:');
try { db.exec(sql); } catch (e) { fail(`Il dump non si ripristina: ${e.message.slice(0, 120)}`); }
if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') fail('integrity_check del ripristino fallito');
for (const [t, n] of Object.entries(expected)) {
  const got = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  if (got !== n) fail(`Conteggio ${t}: D1=${n}, ripristino=${got}`);
}
console.log(`Ripristino di prova OK: integrity_check ok, tabelle verificate: ${Object.keys(expected).join(', ')}`);

const store = makeRawStore(process.env);
if (!(store instanceof DriveRawStore)) fail('Servono i secret GOOGLE_*');
try {
  const sha = await sha256Hex(bytes);
  const { ref } = await store.put(sha, bytes);
  const back = await store.get(ref);
  if ((await sha256Hex(back)) !== sha) fail('Backup riletto da Drive diverso dall\'originale');
  console.log(`Backup su Drive OK: ${bytes.byteLength} byte, riletto con hash identico (sha256 ${sha.slice(0, 12)}…)`);
} catch (e) { fail(`Backup su Drive non riuscito: ${e.code ?? e.name} (HTTP ${e.status ?? '?'})`); }
