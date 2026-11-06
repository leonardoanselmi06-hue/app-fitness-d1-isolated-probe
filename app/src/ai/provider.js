// Adattatori per il modello: Gemini (generateContent) e qualsiasi gateway compatibile OpenAI (/chat/completions: xKiro, OpenRouter, ecc.).
// Configurazione SOLO da variabili d'ambiente del Worker (la chiave è un secret Cloudflare, mai nel repo né nell'app):
//   AI_PROVIDER = gemini | openai, AI_MODEL, AI_API_KEY, AI_BASE_URL (solo openai, es. https://api.xkiro.com/v1).
// Gli errori non riportano mai corpo della risposta, chiave o prompt: solo un codice.
import { AppError } from '../core/errors.js';

export const PROVIDERS = ['gemini', 'openai'];
export function aiConfig(env = {}) {
  const provider = String(env.AI_PROVIDER ?? '').toLowerCase(), model = String(env.AI_MODEL ?? '').trim(), apiKey = String(env.AI_API_KEY ?? '').trim(), baseUrl = String(env.AI_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const urlOk = provider !== 'openai' || /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(baseUrl);
  return { provider, model, apiKey, baseUrl, configured: PROVIDERS.includes(provider) && !!model && !!apiKey && urlOk };
}

const fail = (status, tag) => { throw new AppError(status === 429 ? 429 : 502, status === 429 ? 'ai_rate_limited' : tag); };
async function post(fetchFn, url, headers, body, timeoutMs) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
  try { return await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal }); }
  catch { throw new AppError(502, 'ai_unreachable'); } finally { clearTimeout(timer); }
}

export async function callModel(cfg, { system, user, maxTokens = 3000, timeoutMs = 45_000 }, fetchFn = fetch) {
  if (!cfg.configured) throw new AppError(503, 'ai_not_configured');
  if (cfg.provider === 'gemini') {
    const r = await post(fetchFn, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, { 'x-goog-api-key': cfg.apiKey },
      { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens, responseMimeType: 'application/json' } }, timeoutMs);
    if (!r.ok) fail(r.status, 'ai_provider_error');
    const j = await r.json().catch(() => null), text = (j?.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('');
    if (!text) throw new AppError(502, 'ai_empty_response');
    return { text, tokens_in: j?.usageMetadata?.promptTokenCount ?? null, tokens_out: j?.usageMetadata?.candidatesTokenCount ?? null };
  }
  const body = { model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.3, max_tokens: maxTokens };
  const headers = { authorization: `Bearer ${cfg.apiKey}` }, url = `${cfg.baseUrl}/chat/completions`;
  let r = await post(fetchFn, url, headers, { ...body, response_format: { type: 'json_object' } }, timeoutMs);
  if (r.status === 400 || r.status === 422) r = await post(fetchFn, url, headers, body, timeoutMs); // alcuni gateway non accettano response_format
  if (!r.ok) fail(r.status, 'ai_provider_error');
  const j = await r.json().catch(() => null), text = j?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new AppError(502, 'ai_empty_response');
  return { text, tokens_in: j?.usage?.prompt_tokens ?? null, tokens_out: j?.usage?.completion_tokens ?? null };
}

/** Estrae il primo oggetto JSON da un testo (i modelli a volte aggiungono ```json o commenti). */
export function extractJson(text) {
  const t = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* cerca l'oggetto */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; } }
  return null;
}
