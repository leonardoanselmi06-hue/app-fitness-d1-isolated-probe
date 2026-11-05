// FatSecret Platform API: OAuth 1.0 a 3 gambe (documentazione ufficiale platform.fatsecret.com/docs/guides/authentication/oauth1).
// Firma HMAC-SHA1 con WebCrypto. I token utente stanno in D1 CIFRATI (stesso schema dei token Polar, chiave derivata dal consumer secret).
import { AppError } from '../../core/errors.js';
import { seal, open } from '../polar/oauth.js';

export const REQUEST_TOKEN_URL = 'https://authentication.fatsecret.com/oauth/request_token';
export const AUTHORIZE_URL = 'https://authentication.fatsecret.com/oauth/authorize';
export const ACCESS_TOKEN_URL = 'https://authentication.fatsecret.com/oauth/access_token';
export const API = 'https://platform.fatsecret.com/rest';
const enc = new TextEncoder();
const pct = s => encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export async function signedRequest({ method, url, params = {}, consumerKey, consumerSecret, token, tokenSecret = '', extraOauth = {}, nonce = crypto.randomUUID().replaceAll('-', ''), timestamp = Math.floor(Date.now() / 1000) }) {
  const oauth = { oauth_consumer_key: consumerKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(timestamp), oauth_version: '1.0', ...(token ? { oauth_token: token } : {}), ...extraOauth };
  const all = Object.entries({ ...params, ...oauth }).map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const base = `${method.toUpperCase()}&${pct(url)}&${pct(all.map(([k, v]) => `${k}=${v}`).join('&'))}`;
  const k = await crypto.subtle.importKey('raw', enc.encode(`${pct(consumerSecret)}&${pct(tokenSecret)}`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(base)))));
  // Parametri OAuth nella query string (forma usata negli esempi FatSecret); nessun header Authorization.
  const qs = Object.entries({ ...params, ...oauth, oauth_signature: sig }).map(([a, v]) => `${pct(a)}=${pct(v)}`).join('&');
  return { url: `${url}?${qs}`, qs, headers: { accept: 'application/json' } };
}

const form = async res => Object.fromEntries(new URLSearchParams(await res.text()));
// Il rifiuto di Cloudflare (sfida JS) è riconoscibile dall'header cf-mitigated: lo segnaliamo come causa distinta.
async function fail(res, step) {
  const cf = res.headers?.get?.('cf-mitigated');
  // Solo per i passi di autenticazione: primo tratto del messaggio d'errore di FatSecret (non contiene dati dell'utente né i nostri segreti).
  let msg; if (!cf && step !== 'data') { try { msg = (await res.text()).replace(/oauth_[a-z_]+=[^&\s"<]*/g, 'oauth_…').slice(0, 160); } catch {} }
  return new AppError(502, 'fatsecret_error', { step, upstream_status: res.status, ...(cf ? { reason: 'cloudflare_challenge' } : {}), ...(msg ? { upstream_message: msg } : {}) });
}

export class FatSecretTokens {
  constructor({ db, consumerKey, consumerSecret, fetchFn = (...a) => fetch(...a), now = () => Date.now() }) {
    if (!consumerKey || !consumerSecret) throw new AppError(503, 'fatsecret_unconfigured');
    // spazi/a capo incollati insieme al secret farebbero fallire la firma
    Object.assign(this, { db, consumerKey: String(consumerKey).trim(), consumerSecret: String(consumerSecret).trim(), fetchFn, now });
  }
  async sign(method, url, params, token, tokenSecret, extraOauth) { return signedRequest({ method, url, params, consumerKey: this.consumerKey, consumerSecret: this.consumerSecret, token, tokenSecret, extraOauth }); }
  // 1) request token (il secret temporaneo resta in D1 cifrato, legato al token; scade dopo 15 minuti)
  async begin(callback) {
    const r = await this.sign('POST', REQUEST_TOKEN_URL, {}, null, '', { oauth_callback: callback });
    let res; try { res = await this.fetchFn(r.url, { method: 'POST', headers: r.headers }); } catch { throw new AppError(502, 'fatsecret_unreachable'); }
    if (!res.ok) throw await fail(res, 'request_token');
    const j = await form(res);
    if (!j.oauth_token || !j.oauth_token_secret) throw new AppError(502, 'fatsecret_error', { step: 'request_token', reason: 'no_token' });
    await this.db.prepare("INSERT INTO oauth_tokens (provider, sealed, expires_at, scope, updated_at) VALUES (?, ?, ?, 'request', ?) ON CONFLICT(provider) DO UPDATE SET sealed = excluded.sealed, expires_at = excluded.expires_at, updated_at = excluded.updated_at")
      .bind(`fatsecret_req:${j.oauth_token}`, await seal({ secret: j.oauth_token_secret }, this.consumerSecret), new Date(this.now() + 15 * 60000).toISOString(), new Date(this.now()).toISOString()).run();
    return `${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(j.oauth_token)}`;
  }
  // 3) access token dopo il consenso dell'utente
  async finish(requestToken, verifier) {
    const row = await this.db.prepare('SELECT sealed, expires_at FROM oauth_tokens WHERE provider = ?').bind(`fatsecret_req:${requestToken}`).first();
    if (!row || Date.parse(row.expires_at) < this.now()) throw new AppError(400, 'fatsecret_request_expired');
    const { secret } = await open(row.sealed, this.consumerSecret);
    await this.db.prepare('DELETE FROM oauth_tokens WHERE provider = ?').bind(`fatsecret_req:${requestToken}`).run();
    const r = await this.sign('GET', ACCESS_TOKEN_URL, {}, requestToken, secret, { oauth_verifier: verifier });
    let res; try { res = await this.fetchFn(r.url, { headers: r.headers }); } catch { throw new AppError(502, 'fatsecret_unreachable'); }
    if (!res.ok) throw await fail(res, 'access_token');
    const j = await form(res);
    if (!j.oauth_token || !j.oauth_token_secret) throw new AppError(502, 'fatsecret_error', { step: 'access_token', reason: 'no_token' });
    await this.db.prepare("INSERT INTO oauth_tokens (provider, sealed, expires_at, scope, updated_at) VALUES ('fatsecret', ?, '9999-12-31T00:00:00.000Z', 'diary', ?) ON CONFLICT(provider) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at")
      .bind(await seal({ token: j.oauth_token, secret: j.oauth_token_secret }, this.consumerSecret), new Date(this.now()).toISOString()).run();
  }
  async status() {
    const r = await this.db.prepare("SELECT updated_at FROM oauth_tokens WHERE provider = 'fatsecret'").first();
    return r ? { connected: true, updated_at: r.updated_at } : { connected: false };
  }
  async credentials() {
    const r = await this.db.prepare("SELECT sealed FROM oauth_tokens WHERE provider = 'fatsecret'").first();
    if (!r) throw new AppError(409, 'fatsecret_not_connected');
    return open(r.sealed, this.consumerSecret);
  }
}

/** Client dati (sola lettura, JSON). Ritenta su 429/5xx. */
export function fatsecretGet({ tokens, fetchFn = (...a) => fetch(...a), sleep = ms => new Promise(r => setTimeout(r, ms)), retries = 2 }) {
  return async function get(path, params = {}) {
    for (let attempt = 0; ; attempt++) {
      const c = await tokens.credentials();
      const r = await tokens.sign('GET', `${API}${path}`, { format: 'json', ...params }, c.token, c.secret);
      let res; try { res = await fetchFn(r.url, { headers: r.headers }); } catch { if (attempt >= retries) throw new AppError(502, 'fatsecret_unreachable'); await sleep(500 * 2 ** attempt); continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
      if (res.status === 401 || res.status === 403) throw new AppError(502, 'fatsecret_error', { step: 'data', upstream_status: res.status, path, ...(res.headers?.get?.('cf-mitigated') ? { reason: 'cloudflare_challenge' } : {}) });
      if (!res.ok) throw await fail(res, 'data');
      return res.json();
    }
  };
}
