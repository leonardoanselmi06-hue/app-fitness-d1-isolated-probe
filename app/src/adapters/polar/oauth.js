// OAuth2 Polar AccessLink v4 (documentazione ufficiale https://www.polar.com/polar-api-v4/):
//  authorize: https://auth.polar.com/oauth/authorize   token: https://auth.polar.com/oauth/token (Basic client_id:secret)
//  access token valido 12 ore; si rinnova con il refresh token. Durata/rotazione del refresh token NON documentate: si salva sempre quello nuovo se arriva.
// I token stanno in D1 CIFRATI (AES-GCM, chiave derivata dal client secret): un dump/backup del database non li espone.
import { AppError } from '../../core/errors.js';

export const AUTH_URL = 'https://auth.polar.com/oauth/authorize';
export const TOKEN_URL = 'https://auth.polar.com/oauth/token';
export const SCOPES = ['training_sessions:read']; // privilegio minimo; altri scope richiedono un nuovo consenso
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u8 => btoa(String.fromCharCode(...u8)), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function key(secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`af-oauth-token-v1|${secret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(obj, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), enc.encode(JSON.stringify(obj))));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function open(sealed, secret) {
  try { const [iv, ct] = sealed.split('.'); return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(secret), unb64(ct)))); }
  catch { throw new AppError(503, 'polar_token_unreadable'); }
}

export const authorizeUrl = ({ clientId, redirectUri, state }) =>
  `${AUTH_URL}?${new URLSearchParams({ client_id: clientId, response_type: 'code', scope: SCOPES.join(' '), redirect_uri: redirectUri, state })}`;

async function tokenRequest({ clientId, clientSecret, fetchFn, body }) {
  let res;
  try { res = await fetchFn(TOKEN_URL, { method: 'POST', headers: { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(body).toString() }); }
  catch { throw new AppError(502, 'polar_unreachable'); }
  if (res.status === 400 || res.status === 401) throw new AppError(502, 'polar_reauth_required');
  if (!res.ok) throw new AppError(502, 'polar_error', { step: 'token', upstream_status: res.status });
  const j = await res.json();
  if (!j.access_token) throw new AppError(502, 'polar_error', { step: 'token', upstream_status: res.status, reason: 'no_access_token', keys: Object.keys(j) });
  return j;
}

export class PolarTokens {
  constructor({ db, clientId, clientSecret, fetchFn = (...a) => fetch(...a), now = () => Date.now() }) {
    if (!clientId || !clientSecret) throw new AppError(503, 'polar_unconfigured');
    Object.assign(this, { db, clientId, clientSecret, fetchFn, now });
  }
  async save(j, prev = {}) {
    const sealed = await seal({ access_token: j.access_token, refresh_token: j.refresh_token ?? prev.refresh_token ?? null }, this.clientSecret);
    const exp = new Date(this.now() + (Number(j.expires_in) || 43200) * 1000).toISOString();
    await this.db.prepare("INSERT INTO oauth_tokens (provider, sealed, expires_at, scope, updated_at) VALUES ('polar', ?, ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET sealed = excluded.sealed, expires_at = excluded.expires_at, scope = excluded.scope, updated_at = excluded.updated_at")
      .bind(sealed, exp, j.scope ?? SCOPES.join(' '), new Date(this.now()).toISOString()).run();
    return exp;
  }
  async exchangeCode(code, redirectUri) {
    const j = await tokenRequest({ ...this, body: { grant_type: 'authorization_code', code, redirect_uri: redirectUri } });
    return this.save(j);
  }
  async status() {
    const r = await this.db.prepare("SELECT expires_at, scope, updated_at FROM oauth_tokens WHERE provider = 'polar'").first();
    return r ? { connected: true, access_token_expires_at: r.expires_at, scope: r.scope, updated_at: r.updated_at } : { connected: false };
  }
  // Access token valido; lo rinnova se scade entro 5 minuti. Senza connessione: errore chiaro, nessun fallback.
  async accessToken() {
    const r = await this.db.prepare("SELECT sealed, expires_at FROM oauth_tokens WHERE provider = 'polar'").first();
    if (!r) throw new AppError(409, 'polar_not_connected');
    const t = await open(r.sealed, this.clientSecret);
    if (Date.parse(r.expires_at) - this.now() > 5 * 60 * 1000) return t.access_token;
    if (!t.refresh_token) throw new AppError(502, 'polar_reauth_required');
    const j = await tokenRequest({ ...this, body: { grant_type: 'refresh_token', refresh_token: t.refresh_token } });
    await this.save(j, t);
    return j.access_token;
  }
}
