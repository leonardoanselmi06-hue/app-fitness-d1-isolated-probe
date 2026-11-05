// Preflight STATICO: il Worker di prova deve avere un solo binding (D1 di test), nessuna route, nessuna variabile.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
assert.equal(cfg.main, 'worker.js');
assert.equal(cfg.workers_dev, true);
assert.deepEqual(cfg.routes, []);
assert.equal(cfg.d1_databases.length, 1);
assert.deepEqual(cfg.d1_databases[0], { binding: 'DB', database_name: 'app-fitness-d1-test', database_id: 'dd944ef9-d5e9-40dc-b034-5e156f71ef51' });
assert.deepEqual(Object.keys(cfg).sort(), ['compatibility_date', 'd1_databases', 'main', 'name', 'routes', 'workers_dev']);
console.log('Preflight statico OK: un solo binding D1 (test), nessuna route, nessuna variabile o altro binding.');
