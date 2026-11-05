// RawStore su Google Drive (DEC-STORAGE-005, FROZEN): RAW immutabili, content-addressed, compressi gzip.
// - Auth: OAuth refresh token (scope `drive.file`) lato Worker; client_id/secret/refresh_token sono secret, mai nel repo.
//   Con `drive.file` l'app vede SOLO i file che ha creato: la cartella radice è creata dall'adapter (o indicata da folderId se già creata da lui).
// - Chiave = sha256 dei byte ORIGINALI (non compressi); salvata anche in appProperties per il lookup e la verifica in lettura.
// - put() verifica l'hash PRIMA di scrivere; get() decomprime e RIVERIFICA l'hash. I byte non vengono mai alterati (il BOM si toglie solo al parse, altrove).
// - Immutabilità: nessun update/delete di file RAW. Duplicati da race: vince il più vecchio (createdTime), gli altri restano come orfani da riconciliare.
// - Retry con backoff su 429/5xx/errori di rete. `fetchFn` e `sleep` sono iniettabili per i test.
import { sha256Hex, toBytes } from '../core/hash.js';
import { AppError } from '../core/errors.js';
import { UnconfiguredRawStore } from './rawstore.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_BYTES = 5 * 1024 * 1024; // upload multipart semplice; oltre serve upload resumable (non necessario per i RAW attuali)
const ref = id => `drive://${id}`;
const idOf = r => { const m = /^drive:\/\/([A-Za-z0-9_-]+)$/.exec(r || ''); if (!m) throw new AppError(400, 'raw_ref_invalid'); return m[1]; };
const q = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function stream(bytes, Ctor) {
  const s = new Blob([bytes]).stream().pipeThrough(new Ctor('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const gzip = b => stream(b, CompressionStream);
const gunzip = b => stream(b, DecompressionStream);

export class DriveRawStore {
  constructor({ clientId, clientSecret, refreshToken, folderId, folderName = 'AppFitness-RAW', fetchFn = (...a) => fetch(...a), sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now(), retries = 3 }) {
    if (!clientId || !clientSecret || !refreshToken) throw new AppError(503, 'raw_store_unconfigured');
    Object.assign(this, { clientId, clientSecret, refreshToken, folderId, folderName, fetchFn, sleep, now, retries });
    this.token = null; this.tokenExp = 0;
  }

  async accessToken() {
    if (this.token && this.now() < this.tokenExp - 60_000) return this.token;
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: this.refreshToken, grant_type: 'refresh_token' }).toString(),
    });
    if (!res.ok) throw new AppError(503, res.status === 400 || res.status === 401 ? 'raw_store_auth_failed' : 'raw_store_unavailable');
    const j = await res.json();
    if (!j.access_token) throw new AppError(503, 'raw_store_auth_failed');
    this.token = j.access_token; this.tokenExp = this.now() + (j.expires_in || 3600) * 1000;
    return this.token;
  }

  // Richiesta autenticata con retry; su 401 rinnova il token una volta.
  async call(url, init = {}) {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this.fetchFn(url, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${await this.accessToken()}` } });
      } catch (e) {
        if (e instanceof AppError) throw e;
        if (attempt >= this.retries) throw new AppError(503, 'raw_store_unavailable');
        await this.sleep(200 * 2 ** attempt); continue;
      }
      if (res.status === 401 && !refreshed) { refreshed = true; this.token = null; continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < this.retries) { await this.sleep(200 * 2 ** attempt); continue; }
      if (!res.ok) throw new AppError(res.status === 404 ? 404 : 503, res.status === 404 ? 'raw_missing' : 'raw_store_unavailable');
      return res;
    }
  }

  async list(query, fields = 'files(id,createdTime,appProperties)') {
    const u = `${API}/files?${new URLSearchParams({ q: query, fields, pageSize: '10', orderBy: 'createdTime' })}`;
    return (await (await this.call(u)).json()).files || [];
  }

  async upload(metadata, bytes, mime) {
    const b = '----af' + Math.random().toString(36).slice(2);
    const head = `--${b}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${b}\r\ncontent-type: ${mime}\r\n\r\n`;
    const body = new Blob([head, bytes, `\r\n--${b}--`]);
    const res = await this.call(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${b}` }, body });
    return (await res.json()).id;
  }

  async root() {
    if (this.folderId) return this.folderId;
    const found = await this.list(`name='${q(this.folderName)}' and mimeType='${FOLDER_MIME}' and trashed=false`);
    if (found.length) return (this.folderId = found[0].id);
    const res = await this.call(`${API}/files?fields=id`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: this.folderName, mimeType: FOLDER_MIME }) });
    return (this.folderId = (await res.json()).id);
  }

  async find(sha256, parent) {
    return this.list(`'${q(parent)}' in parents and appProperties has { key='sha256' and value='${sha256}' } and trashed=false`);
  }

  async put(sha256, data) {
    const bytes = toBytes(data);
    if (!/^[0-9a-f]{64}$/.test(sha256) || (await sha256Hex(bytes)) !== sha256) throw new AppError(422, 'raw_hash_mismatch');
    if (bytes.byteLength > MAX_BYTES) throw new AppError(413, 'raw_too_large');
    const parent = await this.root();
    let files = await this.find(sha256, parent);
    if (!files.length) {
      const packed = await gzip(bytes);
      await this.upload({ name: `${sha256}.gz`, parents: [parent], appProperties: { sha256, enc: 'gzip', size: String(bytes.byteLength) } }, packed, 'application/gzip');
      files = await this.find(sha256, parent); // rilegge: se due scrittori hanno creato un duplicato, tutti convergono sul più vecchio
      if (!files.length) throw new AppError(503, 'raw_store_unavailable');
    }
    return { ref: ref(files[0].id), bytes: bytes.byteLength };
  }

  // Elenco completo dei file RAW nella cartella (per la riconciliazione D1↔Drive). Solo lettura.
  async listAll() {
    const parent = await this.root(); const out = []; let pageToken;
    do {
      const p = new URLSearchParams({ q: `'${q(parent)}' in parents and trashed=false`, fields: 'nextPageToken,files(id,appProperties)', pageSize: '1000' });
      if (pageToken) p.set('pageToken', pageToken);
      const j = await (await this.call(`${API}/files?${p}`)).json();
      for (const f of j.files || []) out.push({ ref: ref(f.id), sha256: f.appProperties?.sha256 ?? null });
      pageToken = j.nextPageToken;
    } while (pageToken);
    return out;
  }

  async get(r) {
    const id = idOf(r);
    const meta = await (await this.call(`${API}/files/${id}?fields=appProperties`)).json();
    const expected = meta.appProperties?.sha256;
    if (!expected) throw new AppError(502, 'raw_corrupt');
    const packed = new Uint8Array(await (await this.call(`${API}/files/${id}?alt=media`)).arrayBuffer());
    let out;
    try { out = await gunzip(packed); } catch { throw new AppError(502, 'raw_corrupt'); }
    if ((await sha256Hex(out)) !== expected) throw new AppError(502, 'raw_corrupt');
    return out;
  }
}

// Fail-closed: senza le tre credenziali l'archivio non è configurato (503), nessun fallback silenzioso.
export function makeRawStore(env, extra = {}) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) return new UnconfiguredRawStore();
  return new DriveRawStore({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken: env.GOOGLE_REFRESH_TOKEN, folderId: env.DRIVE_FOLDER_ID, ...extra });
}
