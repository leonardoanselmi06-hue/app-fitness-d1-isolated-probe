// Client REST Lyfta (sola lettura). Doc ufficiale: https://my.lyfta.app/community/api
// Auth: `Authorization: Bearer <chiave>`; limiti 60 richieste/min e 5000/giorno (429 oltre). La chiave è un secret, mai nel repo.
import { AppError } from '../../core/errors.js';

export const LYFTA_BASE = 'https://my.lyfta.app';

export function lyftaFetchPage({ apiKey, limit = 100, fetchFn = (...a) => fetch(...a), sleep = ms => new Promise(r => setTimeout(r, ms)), retries = 3 }) {
  if (!apiKey) throw new AppError(503, 'lyfta_unconfigured');
  return async function fetchPage(page) {
    const url = `${LYFTA_BASE}/api/v1/workouts?limit=${limit}&page=${page}`;
    for (let attempt = 0; ; attempt++) {
      let res;
      try { res = await fetchFn(url, { headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' } }); }
      catch { if (attempt >= retries) throw new AppError(502, 'lyfta_unreachable'); await sleep(500 * 2 ** attempt); continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(res.status === 429 ? 5000 * (attempt + 1) : 500 * 2 ** attempt); continue; }
      if (res.status === 401 || res.status === 403) throw new AppError(502, 'lyfta_auth_failed');
      if (!res.ok) throw new AppError(502, 'lyfta_error');
      const body = await res.json();
      if (body?.status === false) throw new AppError(502, 'lyfta_error');
      return body;
    }
  };
}
