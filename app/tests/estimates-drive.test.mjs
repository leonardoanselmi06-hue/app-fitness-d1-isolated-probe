import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveFolderReader } from '../src/storage/drive-folder-reader.js';
import { runEstimatesImport } from '../src/jobs/estimates-job.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = new Date('2026-11-14T12:00:00Z');
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
const SA = JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n` });
const FOLDER = 'FOLDERID1234567890';
const meal = (id, o = {}) => ({ id, date: '2026-11-14', meal: 'Lunch', name: 'x', calories: 600, ...o });
function fakeDrive(files) { // files: { fileId: { name, text } }
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url); calls.push({ url: String(url), method: init.method ?? 'GET' });
    if (u.href.startsWith('https://oauth2.googleapis.com/token')) { const a = new URLSearchParams(init.body).get('assertion'); assert.equal(a.split('.').length, 3); return new Response(JSON.stringify({ access_token: 'T', expires_in: 3600 })); }
    assert.equal(init.headers.authorization, 'Bearer T');
    if (u.pathname === '/drive/v3/files') { assert.match(u.searchParams.get('q'), new RegExp(`'${FOLDER}' in parents`)); return new Response(JSON.stringify({ files: Object.entries(files).map(([id, f]) => ({ id, name: f.name })) })); }
    const id = u.pathname.split('/').pop(); return files[id] ? new Response(files[id].text) : new Response('', { status: 404 });
  };
  return { fetchFn, calls };
}
const env = { DB: null, GOOGLE_SA_KEY: SA, ESTIMATES_FOLDER_ID: FOLDER, GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_REFRESH_TOKEN: 'c' };

test('lettore: JWT firmato RS256, query limitata alla cartella, solo GET (nessuna scrittura)', async () => {
  const f = fakeDrive({ f1: { name: 'a.json', text: '{}' } });
  const rd = new DriveFolderReader({ serviceAccount: SA, folderId: FOLDER, fetchFn: f.fetchFn, now: () => NOW.getTime() });
  assert.equal((await rd.listJson({ since: '2026-10-01T00:00:00Z' })).length, 1); assert.equal(await rd.readText('f1'), '{}');
  assert.ok(f.calls.filter(c => !c.url.includes('oauth2')).every(c => c.method === 'GET'));
  assert.throws(() => new DriveFolderReader({ serviceAccount: SA, folderId: "x' or 1=1" }), e => e.code === 'drive_folder_unconfigured');
  assert.throws(() => new DriveFolderReader({ serviceAccount: 'non json', folderId: FOLDER }), e => e.code === 'drive_folder_unconfigured');
});

test('job: importa, rilancio senza novità, file non valido saltato senza bloccare gli altri', async () => {
  const db = newDb(), raw = new MemoryRawStore();
  const f = fakeDrive({ ok: { name: 'a.json', text: JSON.stringify({ version: 1, meals: [meal('m1'), meal('m2', { meal: 'Dinner' })] }) }, bad: { name: 'b.json', text: '{"version":1,"meals":[{"id":"x"}]}' }, junk: { name: 'c.json', text: 'non json' } });
  const rd = new DriveFolderReader({ serviceAccount: SA, folderId: FOLDER, fetchFn: f.fetchFn, now: () => NOW.getTime() });
  const a = await runEstimatesImport({ ...env, DB: db }, { now: () => NOW, reader: rd, rawStore: raw });
  assert.deepEqual({ ok: a.ok, files: a.files, imported: a.imported, rejected: a.rejected }, { ok: true, files: 3, imported: 2, rejected: 2 });
  const b = await runEstimatesImport({ ...env, DB: db }, { now: () => NOW, reader: rd, rawStore: raw });
  assert.equal(b.imported, 0); assert.equal(b.unchanged, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM current_records WHERE source_system = 'chatgpt_estimate'").first()).n, 2);
});

test('job: spento senza secret; errore di autenticazione dichiarato, nessun dato scritto', async () => {
  assert.deepEqual(await runEstimatesImport({ DB: newDb() }), { ran: false, reason: 'disabled' });
  const db = newDb(), rd = new DriveFolderReader({ serviceAccount: SA, folderId: FOLDER, fetchFn: async () => new Response('', { status: 401 }), now: () => NOW.getTime() });
  const r = await runEstimatesImport({ ...env, DB: db }, { now: () => NOW, reader: rd, rawStore: new MemoryRawStore() });
  assert.deepEqual(r, { ran: true, ok: false, reason: 'drive_folder_auth_failed' });
});
