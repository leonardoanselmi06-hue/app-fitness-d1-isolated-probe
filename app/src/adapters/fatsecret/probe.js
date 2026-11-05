// Struttura (chiavi, tipi, lunghezze) delle risposte FatSecret reali. NESSUN valore. Date come giorni dall'epoca (date_int).
import { shape } from '../polar/probe.js';
const dayInt = d => Math.floor(d.getTime() / 86400000);

async function step(fn) { try { return await fn(); } catch (e) { return { errore: e.code ?? 'errore', step: e.extra?.step ?? null, upstream_status: e.extra?.upstream_status ?? null, reason: e.extra?.reason ?? null }; } }

export async function probeFatSecret(get, now = new Date()) {
  const today = dayInt(now);
  const out = { month_totals: null, day_entries: null, weights: null };
  const month = await step(async () => {
    const m = await get('/food-entries/month/v2', { date: today });
    const days = [m?.month?.day ?? []].flat();
    return { shape: shape(m), days_with_entries: days.length, latest_date_int: days.length ? Math.max(...days.map(d => Number(d.date_int))) : null };
  });
  out.month_totals = month.errore ? month : { shape: month.shape, days_with_entries: month.days_with_entries };
  if (month.latest_date_int != null) out.day_entries = await step(async () => shape(await get('/food-entries/v2', { date: month.latest_date_int }), 6));
  else out.day_entries = 'nessun giorno con voci nel mese corrente';
  out.weights = await step(async () => shape(await get('/weight/month/v2', { date: today })));
  return out;
}

// Autodiagnosi della firma, senza dati utente: chiamata a 2 gambe (solo consumer key/secret) e request_token su entrambi gli host noti.
export async function selfTest(tokens, fetchFn) {
  const one = async (method, url, params, extra) => {
    try {
      const r = await tokens.sign(method, url, params, null, '', extra);
      const res = await fetchFn(r.url, { method, headers: r.headers });
      const t = (await res.text()).replace(/oauth_[a-z_]+=[^&\s"<]*/g, 'oauth_…').slice(0, 140);
      return { status: res.status, ok: res.ok, cloudflare: !!res.headers?.get?.('cf-mitigated'), message: res.ok ? null : t };
    } catch (e) { return { errore: e.code ?? 'errore' }; }
  };
  return {
    key_len: tokens.consumerKey.length, secret_len: tokens.consumerSecret.length,
    api_2legged: await one('GET', 'https://platform.fatsecret.com/rest/foods/search/v1', { search_expression: 'apple', format: 'json', max_results: '1' }),
    request_token_authentication_host: await one('POST', 'https://authentication.fatsecret.com/oauth/request_token', {}, { oauth_callback: 'oob' }),
    request_token_www_host: await one('POST', 'https://www.fatsecret.com/oauth/request_token', {}, { oauth_callback: 'oob' }),
  };
}
