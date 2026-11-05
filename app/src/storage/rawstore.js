// Contratto RawStore (DEC-STORAGE-005: RAW immutabili su Google Drive).
// put() è idempotente per contenuto e VERIFICA l'hash prima di restituire il riferimento.
// L'adapter Drive reale richiede credenziali OAuth lato server: NON ancora implementato (blocco aperto).
import { sha256Hex, toBytes } from '../core/hash.js';
import { AppError } from '../core/errors.js';

export class MemoryRawStore {
  constructor() { this.objects = new Map(); this.puts = 0; }
  async put(sha256, data) {
    const bytes = toBytes(data);
    if ((await sha256Hex(bytes)) !== sha256) throw new AppError(422, 'raw_hash_mismatch');
    const ref = `mem://raw/${sha256}`;
    if (!this.objects.has(ref)) this.objects.set(ref, bytes.slice());
    this.puts++;
    return { ref, bytes: bytes.byteLength };
  }
  async get(ref) {
    const b = this.objects.get(ref);
    if (!b) throw new AppError(404, 'raw_missing');
    return b.slice();
  }
}

// Fallisce chiuso: nessuna ingestione senza archivio RAW configurato.
export class UnconfiguredRawStore {
  async put() { throw new AppError(503, 'raw_store_unconfigured'); }
  async get() { throw new AppError(503, 'raw_store_unconfigured'); }
}
