// Emulatore MINIMO dell'interfaccia D1 (prepare/bind/run/all/first/batch) sopra node:sqlite.
// SOLO per test locali: NON è evidenza di comportamento di Cloudflare D1 (il test su D1 reale resta in CI).
// batch() è atomico (BEGIN/COMMIT/ROLLBACK) come db.batch() di D1.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

class Stmt {
  constructor(shim, sql) { this.shim = shim; this.sql = sql; this.params = []; }
  bind(...p) { const s = new Stmt(this.shim, this.sql); s.params = p; return s; }
  _exec() {
    const st = this.shim.raw.prepare(this.sql);
    if (/^\s*select/i.test(this.sql)) return { results: st.all(...this.params), success: true, meta: {} };
    const r = st.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
  async run() { this.shim._tick(); return this._exec(); }
  async all() { this.shim._tick(); return this._exec(); }
  async first(col) { const r = (await this.all()).results[0] ?? null; return r && col ? r[col] : r; }
}

export class D1Shim {
  constructor(file = ':memory:', { failBatchAt = null } = {}) {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.failBatchAt = failBatchAt; // indice di istruzione che deve fallire (fault injection)
    this.batches = 0;
    this.beforeBatch = null; // hook async per simulare writer concorrenti
  }
  migrate(path) { this.raw.exec(readFileSync(path, 'utf8')); return this; }
  prepare(sql) { return new Stmt(this, sql); }
  _tick() {}
  async batch(stmts) {
    if (this.beforeBatch) await this.beforeBatch();
    this.batches++;
    this.raw.exec('BEGIN');
    try {
      const out = [];
      for (let i = 0; i < stmts.length; i++) {
        if (this.failBatchAt === i) throw new Error('injected_fault');
        out.push(stmts[i]._exec());
      }
      this.raw.exec('COMMIT');
      return out;
    } catch (e) { this.raw.exec('ROLLBACK'); throw e; }
  }
  close() { this.raw.close(); }
}

export const MIGRATION = new URL('../../migrations/0001_ledger.sql', import.meta.url).pathname;
const MIGRATIONS = ['0001_ledger.sql', '0002_oauth_tokens.sql', '0003_targets.sql', '0004_plan.sql', '0005_checkins.sql'].map(f => new URL(`../../migrations/${f}`, import.meta.url).pathname);
export const newDb = opts => MIGRATIONS.reduce((d, m) => d.migrate(m), new D1Shim(':memory:', opts));
