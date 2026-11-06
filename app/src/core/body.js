// Lettura sicura del corpo JSON per le scritture del proprietario: solo application/json (niente richieste cross-site "semplici"),
// Origin uguale all'host se presente, corpo piccolo, oggetto semplice.
import { AppError, insist } from './errors.js';

export async function readOwnerJson(request, url, max = 20 * 1024) {
  insist((request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'), 415, 'unsupported_media_type');
  const origin = request.headers.get('origin'); insist(origin == null || origin === url.origin, 403, 'forbidden_origin');
  const text = await request.text(); insist(text.length <= max, 413, 'payload_too_large');
  let body; try { body = JSON.parse(text); } catch { throw new AppError(400, 'invalid_json'); }
  insist(body && typeof body === 'object' && !Array.isArray(body), 422, 'invalid_body');
  return body;
}
