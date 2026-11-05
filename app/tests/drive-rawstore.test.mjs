import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveRawStore, makeRawStore } from '../src/storage/drive-rawstore.js';
import { UnconfiguredRawStore } from '../src/storage/rawstore.js';
import { sha256Hex } from '../src/core/hash.js';
import { fakeDrive } from './helpers/fake-drive.mjs';

const creds = { clientId: 'c', clientSecret: 's', refreshToken: 'r', sleep: async () => {} };
const mk = (opts, extra = {}) => { const d = fakeDrive(opts); return { d, s: new DriveRawStore({ ...creds, fetchFn: d.fetchFn, ...extra }) }; };
const payload = '﻿{"hr":[' + '60,61,62,'.repeat(500) + '63]}'; // con BOM: i byte RAW non vanno alterati
const bytes = new TextEncoder().encode(payload);

test('put/get: round-trip byte-identico (BOM incluso), file compresso gzip, nome = sha256', async () => {
  const { d, s } = mk(); const sha = await sha256Hex(bytes);
  const r = await s.put(sha, bytes);
  assert.match(r.ref, /^drive:\/\/f\d+$/); assert.equal(r.bytes, bytes.byteLength);
  const stored = [...d.files.values()].find(f => f.appProperties?.sha256 === sha);
  assert.equal(stored.name, `${sha}.gz`); assert.ok(stored.data.byteLength < bytes.byteLength / 4);
  assert.deepEqual(await s.get(r.ref), bytes);
});

test('put idempotente: stesso contenuto = nessun secondo file, stesso ref', async () => {
  const { d, s } = mk(); const sha = await sha256Hex(bytes);
  const a = await s.put(sha, bytes); const b = await s.put(sha, bytes);
  assert.equal(a.ref, b.ref);
  assert.equal([...d.files.values()].filter(f => f.appProperties).length, 1);
});

test('hash errato: 422 e nessuna scrittura su Drive', async () => {
  const { d, s } = mk();
  await assert.rejects(s.put('0'.repeat(64), bytes), e => e.status === 422 && e.code === 'raw_hash_mismatch');
  await assert.rejects(s.put('non-un-hash', bytes), e => e.status === 422);
  assert.equal(d.files.size, 0); assert.equal(d.log.length, 0);
});

test('cartella radice creata una sola volta e riusata (drive.file vede solo i file dell\'app)', async () => {
  const { d, s } = mk();
  await s.put(await sha256Hex('a'), 'a'); await s.put(await sha256Hex('b'), 'b');
  assert.equal([...d.files.values()].filter(f => f.mimeType?.includes('folder')).length, 1);
  const s2 = new DriveRawStore({ ...creds, fetchFn: d.fetchFn }); // nuova istanza: ritrova la cartella per nome
  await s2.put(await sha256Hex('c'), 'c');
  assert.equal([...d.files.values()].filter(f => f.mimeType?.includes('folder')).length, 1);
});

test('retry con backoff su 503/429, poi riesce; token riusato', async () => {
  const { d, s } = mk({ failures: [503, 429] }); const sha = await sha256Hex(bytes);
  await s.put(sha, bytes); assert.equal(d.tokens(), 1);
});

test('errori persistenti: 503 raw_store_unavailable dopo i tentativi', async () => {
  const { s } = mk({ failures: [503, 503, 503, 503, 503] });
  await assert.rejects(s.put(await sha256Hex('x'), 'x'), e => e.status === 503 && e.code === 'raw_store_unavailable');
});

test('refresh token rifiutato: 503 raw_store_auth_failed (fail-closed)', async () => {
  const { s } = mk({ authOk: false });
  await assert.rejects(s.put(await sha256Hex('x'), 'x'), e => e.status === 503 && e.code === 'raw_store_auth_failed');
});

test('get rileva corruzione: contenuto alterato su Drive => 502 raw_corrupt, mai dati sbagliati', async () => {
  const { d, s } = mk(); const sha = await sha256Hex(bytes); const { ref } = await s.put(sha, bytes);
  const f = [...d.files.values()].find(x => x.appProperties?.sha256 === sha);
  f.appProperties.sha256 = await sha256Hex('altro');
  await assert.rejects(s.get(ref), e => e.status === 502 && e.code === 'raw_corrupt');
  f.data = new Uint8Array([1, 2, 3]);
  await assert.rejects(s.get(ref), e => e.status === 502);
  await assert.rejects(s.get('http://evil/x'), e => e.status === 400);
});

test('duplicato da race: put concorrenti convergono sullo stesso ref (il più vecchio)', async () => {
  const { s } = mk(); const sha = await sha256Hex(bytes);
  const [a, b, c] = await Promise.all([s.put(sha, bytes), s.put(sha, bytes), s.put(sha, bytes)]);
  assert.equal(a.ref, b.ref); assert.equal(b.ref, c.ref);
});

test('makeRawStore: senza credenziali => UnconfiguredRawStore (503), con credenziali => Drive', async () => {
  assert.ok(makeRawStore({}) instanceof UnconfiguredRawStore);
  await assert.rejects(makeRawStore({ GOOGLE_CLIENT_ID: 'x' }).put(), e => e.status === 503);
  assert.ok(makeRawStore({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_REFRESH_TOKEN: 'c' }) instanceof DriveRawStore);
});
