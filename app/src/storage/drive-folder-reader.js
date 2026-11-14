// Lettura SOLA di una cartella Drive condivisa con un account di servizio (pasti stimati da ChatGPT).
// Perché un account di servizio: gli scope OAuth di Drive non si limitano a una cartella (drive.readonly = tutto il Drive). Un account di servizio
// vede SOLO ciò che gli viene condiviso: condividendo con lui (Visualizzatore) la sola cartella "pasti", il resto del Drive resta invisibile.
// Nessuna scrittura, nessuna cancellazione, nessuno spostamento. Auth: JWT RS256 (WebCrypto) scambiato per un token di accesso. `fetchFn` iniettabile per i test.
import { AppError } from '../core/errors.js';

const API = 'https://www.googleapis.com/drive/v3', TOKEN_URL = 'https://oauth2.googleapis.com/token', SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = s => new TextEncoder().encode(s);
const pemToDer = pem => Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
export const MAX_FILE_BYTES = 64 * 1024;

export function parseServiceAccount(raw) {
  let j; try { j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new AppError(503, 'drive_folder_unconfigured'); }
  if (!j?.client_email || !j?.private_key) throw new AppError(503, 'drive_folder_unconfigured');
  return { email: j.client_email, key: j.private_key };
}

export class DriveFolderReader {
  constructor({ serviceAccount, folderId, fetchFn = (...a) => fetch(...a), now = () => Date.now() }) {
    if (!serviceAccount || !folderId || !/^[A-Za-z0-9_-]{10,100}$/.test(folderId)) throw new AppError(503, 'drive_folder_unconfigured');
    Object.assign(this, { sa: parseServiceAccount(serviceAccount), folderId, fetchFn, now }); this.token = null; this.exp = 0;
  }
  async accessToken() {
    if (this.token && this.now() < this.exp - 60_000) return this.token;
    const iat = Math.floor(this.now() / 1000), head = b64u(enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))), claims = b64u(enc(JSON.stringify({ iss: this.sa.email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })));
    let sig; try { const k = await crypto.subtle.importKey('pkcs8', pemToDer(this.sa.key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, enc(`${head}.${claims}`)); } catch { throw new AppError(503, 'drive_folder_auth_failed'); }
    const res = await this.fetchFn(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64u(sig)}` }).toString() });
    if (!res.ok) throw new AppError(503, res.status === 400 || res.status === 401 ? 'drive_folder_auth_failed' : 'drive_folder_unavailable');
    const j = await res.json(); if (!j.access_token) throw new AppError(503, 'drive_folder_auth_failed');
    this.token = j.access_token; this.exp = this.now() + (j.expires_in || 3600) * 1000; return this.token;
  }
  async get(url) {
    let res; try { res = await this.fetchFn(url, { headers: { authorization: `Bearer ${await this.accessToken()}` } }); } catch (e) { if (e instanceof AppError) throw e; throw new AppError(503, 'drive_folder_unavailable'); }
    if (!res.ok) throw new AppError(res.status === 404 ? 404 : 503, res.status === 404 ? 'drive_folder_not_found' : 'drive_folder_unavailable');
    return res;
  }
  /** File .json (non cestinati) direttamente nella cartella, modificati da `since` (ISO), i più vecchi prima. */
  async listJson({ since, limit = 30 }) {
    const q = `'${this.folderId}' in parents and trashed = false and name contains '.json' and modifiedTime > '${since}'`;
    const u = `${API}/files?${new URLSearchParams({ q, fields: 'files(id,name,modifiedTime,size)', pageSize: String(limit), orderBy: 'modifiedTime' })}`;
    return (await (await this.get(u)).json()).files ?? [];
  }
  async readText(id) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new AppError(400, 'drive_file_invalid');
    const text = await (await this.get(`${API}/files/${id}?alt=media`)).text();
    if (text.length > MAX_FILE_BYTES) throw new AppError(413, 'payload_too_large');
    return text;
  }
}
