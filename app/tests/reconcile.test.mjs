import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveRawStore } from '../src/storage/drive-rawstore.js';
import { reconcile } from '../src/jobs/reconcile.js';
import { sha256Hex } from '../src/core/hash.js';
import { fakeDrive } from './helpers/fake-drive.mjs';

const mk = () => { const d = fakeDrive(); return { d, s: new DriveRawStore({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetchFn: d.fetchFn, sleep: async () => {} }) }; };
const put = async (s, txt) => { const sha = await sha256Hex(txt); return { ...(await s.put(sha, txt)), sha }; };

test('riconciliazione: tutto coerente = ok, nessun orfano', async () => {
  const { s } = mk(); const a = await put(s, 'a'), b = await put(s, 'b');
  const r = await reconcile({ store: s, refs: [{ artifact_ref: a.ref, artifact_sha256: a.sha }, { artifact_ref: b.ref, artifact_sha256: b.sha }] });
  assert.equal(r.ok, true); assert.equal(r.referenced, 2); assert.equal(r.on_drive, 2); assert.deepEqual(r.orphans, []);
});
test('riconciliazione: orfani segnalati ma non bloccanti, mancanti e hash diversi bloccanti', async () => {
  const { s } = mk(); const a = await put(s, 'a'), orphan = await put(s, 'orfano'), c = await put(s, 'c');
  const r = await reconcile({ store: s, refs: [{ artifact_ref: a.ref, artifact_sha256: a.sha }, { artifact_ref: c.ref, artifact_sha256: 'f'.repeat(64) }, { artifact_ref: 'drive://sparito', artifact_sha256: 'e'.repeat(64) }] });
  assert.deepEqual(r.orphans, [orphan.ref]); assert.deepEqual(r.missing, ['drive://sparito']); assert.deepEqual(r.sha_mismatch, [c.ref]); assert.equal(r.ok, false);
  const onlyOrphan = await reconcile({ store: s, refs: [{ artifact_ref: a.ref, artifact_sha256: a.sha }] });
  assert.equal(onlyOrphan.ok, true); assert.equal(onlyOrphan.orphans.length, 2);
});
test('riconciliazione: contenuto corrotto su Drive rilevato', async () => {
  const { d, s } = mk(); const a = await put(s, 'a');
  [...d.files.values()].find(f => f.appProperties?.sha256 === a.sha).data = new Uint8Array([9, 9, 9]);
  const r = await reconcile({ store: s, refs: [{ artifact_ref: a.ref, artifact_sha256: a.sha }] });
  assert.deepEqual(r.corrupt, [a.ref]); assert.equal(r.ok, false);
});

test('riconciliazione: backup e file di prova (kind) non sono orfani', async () => {
  const { s } = mk(); const a = await put(s, 'a'); const sha = await sha256Hex('dump');
  await s.put(sha, 'dump', { kind: 'backup' }); await s.put(await sha256Hex('prova'), 'prova', { kind: 'test' }); const o = await put(s, 'orfano vero');
  const r = await reconcile({ store: s, refs: [{ artifact_ref: a.ref, artifact_sha256: a.sha }] });
  assert.deepEqual(r.orphans, [o.ref]); assert.equal(r.expected_unreferenced, 2); assert.equal(r.ok, true);
});
