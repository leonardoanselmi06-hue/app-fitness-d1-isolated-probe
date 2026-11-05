// Client dati Polar AccessLink v4 (sola lettura). Limiti: 3000 richieste/15 min e 100000/giorno per client (429 oltre).
import { AppError } from '../../core/errors.js';

export const POLAR_DATA = 'https://www.polaraccesslink.com/v4/data';

export function polarGet({ tokens, fetchFn = (...a) => fetch(...a), sleep = ms => new Promise(r => setTimeout(r, ms)), retries = 3 }) {
  return async function get(path, params = {}) {
    const qs = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    const url = `${POLAR_DATA}${path}${qs.size ? `?${qs}` : ''}`;
    for (let attempt = 0; ; attempt++) {
      let res;
      try { res = await fetchFn(url, { headers: { authorization: `Bearer ${await tokens.accessToken()}`, accept: 'application/json' } }); }
      catch (e) { if (e instanceof AppError) throw e; if (attempt >= retries) throw new AppError(502, 'polar_unreachable'); await sleep(500 * 2 ** attempt); continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(res.status === 429 ? 5000 * (attempt + 1) : 500 * 2 ** attempt); continue; }
      if (res.status === 401 || res.status === 403) throw new AppError(502, 'polar_reauth_required');
      if (!res.ok) throw new AppError(502, 'polar_error');
      return res.json();
    }
  };
}
