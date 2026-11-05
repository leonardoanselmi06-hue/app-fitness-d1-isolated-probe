// Riconciliazione D1↔Drive (DEC-STORAGE-005, requisito aperto). SOLA LETTURA: non cancella né corregge nulla.
//  - missing:      riferimento in D1 senza file su Drive            -> CRITICO (dato perso)
//  - sha_mismatch: hash in D1 diverso da quello registrato su Drive -> CRITICO
//  - corrupt:      il file non si decomprime o l'hash non coincide    -> CRITICO
//  - orphans:      file su Drive che D1 non referenzia               -> informativo (es. scrittura Drive riuscita ma commit D1 fallito; i RAW sono immutabili e non si cancellano)
export async function reconcile({ refs, store, verify = true }) {
  const onDrive = new Map((await store.listAll()).map(f => [f.ref, f]));
  const wanted = new Map(refs.filter(r => r.artifact_ref).map(r => [r.artifact_ref, r.artifact_sha256]));
  const missing = [], sha_mismatch = [], corrupt = [];
  for (const [ref, sha] of wanted) {
    const f = onDrive.get(ref);
    if (!f) { missing.push(ref); continue; }
    if (f.sha256 !== sha) { sha_mismatch.push(ref); continue; }
    if (verify) { try { await store.get(ref); } catch { corrupt.push(ref); } }
  }
  const orphans = [...onDrive.keys()].filter(r => !wanted.has(r));
  return { referenced: wanted.size, on_drive: onDrive.size, missing, sha_mismatch, corrupt, orphans, ok: !missing.length && !sha_mismatch.length && !corrupt.length };
}
