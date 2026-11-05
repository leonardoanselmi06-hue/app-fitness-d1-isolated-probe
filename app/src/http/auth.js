// Autenticazione single-user con Cloudflare Access (JWT RS256 nell'header Cf-Access-Jwt-Assertion).
// Fail-closed: senza configurazione completa nessuna richiesta /v1 (tranne /v1/health) è autorizzata.
// Il soggetto NON viene mai letto dal body: è derivato dal JWT verificato (DEC-API-001).
import { AppError } from '../core/errors.js';

const b64uToBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const b64uJson = s => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

/** @param {{teamDomain:string, aud:string, ownerEmail:string, fetchJwks?:Function, now?:()=>number}} cfg */
export function createAuth(cfg) {
  const { teamDomain, aud, ownerEmail } = cfg ?? {};
  const now = cfg?.now ?? (() => Math.floor(Date.now() / 1000));
  const configured = [teamDomain, aud, ownerEmail].every(v => typeof v === 'string' && v.length > 0);
  const issuer = `https://${teamDomain}`;
  const fetchJwks = cfg?.fetchJwks ?? (async () => (await fetch(`${issuer}/cdn-cgi/access/certs`)).json());
  let cache = { keys: null, at: 0 };

  async function keyFor(kid, force = false) {
    if (force || !cache.keys || now() - cache.at > 3600) cache = { keys: (await fetchJwks()).keys ?? [], at: now() };
    const jwk = cache.keys.find(k => k.kid === kid && k.kty === 'RSA');
    return jwk ? crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']) : null;
  }

  return {
    configured,
    /** @returns {Promise<{subject:string}>} oppure lancia AppError 401/503 */
    async authenticate(request) {
      if (!configured) throw new AppError(503, 'auth_unconfigured');
      const token = request.headers.get('cf-access-jwt-assertion');
      const parts = token?.split('.');
      if (!parts || parts.length !== 3) throw new AppError(401, 'unauthenticated');
      let header, claims, key;
      try {
        header = b64uJson(parts[0]); claims = b64uJson(parts[1]);
        if (header.alg !== 'RS256') throw new Error('alg');
        key = (await keyFor(header.kid)) ?? (await keyFor(header.kid, true)); // rotazione chiavi: un solo refresh
      } catch { throw new AppError(401, 'unauthenticated'); }
      if (!key) throw new AppError(401, 'unauthenticated');
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
      const audOk = Array.isArray(claims.aud) ? claims.aud.includes(aud) : claims.aud === aud;
      const t = now();
      const valid = ok && claims.iss === issuer && audOk && typeof claims.exp === 'number' && claims.exp > t && (claims.nbf == null || claims.nbf <= t + 30);
      if (!valid) throw new AppError(401, 'unauthenticated');
      if (typeof claims.email === 'string' && claims.email.length > 0) {
        if (claims.email.toLowerCase() !== ownerEmail.toLowerCase()) throw new AppError(403, 'forbidden');
        return { subject: 'owner', principal: 'owner' };
      }
      // Service token di Cloudflare Access (nessuna email, `common_name` = client id): principal 'device', ammesso SOLO su POST /v1/ingest/device
      // (lo impone il router). Chi può presentarlo lo decide la policy "Service Auth" configurata dal proprietario in Cloudflare Access.
      if (typeof claims.common_name === 'string' && claims.common_name.length > 0) return { subject: 'owner', principal: 'device' };
      // Diagnostica: SOLO i nomi dei claim (mai i valori) per capire la forma del token
      throw new AppError(403, 'forbidden', { claim_names: Object.keys(claims).sort() });
    },
  };
}
