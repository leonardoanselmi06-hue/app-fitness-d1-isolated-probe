# App Fitness D1 isolated probe — staging bundle

**Non-production diagnostic only.** There is **no automatic deployment**. Workflow triggers only by `workflow_dispatch`; `deploy-test` is intentionally blocked. Never add a pull_request or push trigger to a workflow that accesses Cloudflare secrets.

Verified target database: `app-fitness-d1-test` / `dd944ef9-d5e9-40dc-b034-5e156f71ef51`. Contains only synthetic data. The source Worker has ONE declared D1 binding, no routes, no other provider bindings. Worker name: `af-d1-probe-20261019` (must first verify the name does not already exist in the actual account).

## Steps
1. Create a **new empty public repository** in GitHub; do not use an existing production or AI Architect repository. Public means the entire code is visible: inspect files first.
2. Upload bundle contents (including `.github/workflows/d1-validation.yml`), never credentials.
3. Run manual workflow `phase=preflight`. That phase compiles static preflight and does not deploy anything. The Cloudflare identity step runs only if optional token secret is present.
4. For full remote preflight, create Cloudflare scoped token with minimal Workers Script edit, D1 edit permissions and account scope; note such tokens may have broader account permission than a single D1 database. Keep token only in GitHub Actions secret and account id only in another secret, never in repository or logs. Reconfirm the Worker name does not exist and target database UUID; confirm Workers Free and allowed route/service isolation.
5. **Before any deployment** the workflow must be extended by a reviewer to verify remote Worker existence and account, configure temporary `TEST_KEY` via `wrangler secret put`, and ensure no production bindings or routes. Only then can `npx wrangler deploy` be invoked. A key should not be embedded in committed source or printed. Deploy only once.
6. The test client supports HTTP batch rollback, replay, synthetic receipt loss, concurrent inserts and CAS. **Important:** `/ack-lost` returns HTTP 204 (no application receipt), but this is **not** a real network-disconnect simulation. A separate test harness for physical lost ACK remains needed before claiming full recovery verified.
7. Cleanup: remove the temporary Worker via Wrangler; drop only tables prefixed `af_d1_probe_` created for this run, after collecting evidence. Verify `sqlite_schema` and remote Worker absence. Failure to cleanup requires explicit reporting, not 'PASS'.

## Boundaries
- No production database, secrets, Workers, routes or other resources.
- No health data, no passwords/tokens in source or output.
- No unrestricted SQL endpoint in the Worker.
- `src/index.js` only implements controlled operations on a single synthetic table. Table creation is separately controlled; Worker lacks schema-creation endpoint.
- Worker API requires a temporary `TEST_KEY` secret; never send real health data.
- This does not implement the App Fitness application and does not prove D1+Drive atomicity.

## Status
Source bundle and static preflight prepared. Not deployed; actual Cloudflare batch / concurrency / ACK tests NOT RUN.
