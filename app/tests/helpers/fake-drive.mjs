// Drive finto (REST minimo) per testare DriveRawStore senza rete: token, list, create folder, upload multipart, get meta/media.
export function fakeDrive({ failures = [], authOk = true } = {}) {
  const files = new Map(); let seq = 0; let tokens = 0; const log = [];
  const queue = [...failures]; // es. [503, 429]: risposte d'errore consumate alle prime chiamate Drive
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url); log.push(`${init.method || 'GET'} ${u.pathname}`);
    if (u.host === 'oauth2.googleapis.com') { if (!authOk) return json({ error: 'invalid_grant' }, 400); tokens++; return json({ access_token: `tok${tokens}`, expires_in: 3600 }); }
    if (!(init.headers?.authorization || '').startsWith('Bearer tok')) return json({}, 401);
    if (queue.length) return json({}, queue.shift());
    if (u.pathname === '/drive/v3/files' && !init.method) {
      const q = u.searchParams.get('q');
      let out = [...files.values()].filter(f => !f.trashed);
      const name = /name='([^']*)'/.exec(q); if (name) out = out.filter(f => f.name === name[1]);
      const sha = /value='([0-9a-f]+)'/.exec(q); if (sha) out = out.filter(f => f.appProperties?.sha256 === sha[1]);
      const par = /'([^']+)' in parents/.exec(q); if (par) out = out.filter(f => f.parents?.includes(par[1]));
      return json({ files: out.sort((a, b) => a.createdTime - b.createdTime).map(({ id, createdTime, appProperties }) => ({ id, createdTime, appProperties })) });
    }
    if (u.pathname === '/drive/v3/files' && init.method === 'POST') { const m = JSON.parse(init.body); const id = `f${++seq}`; files.set(id, { id, createdTime: seq, ...m }); return json({ id }); }
    if (u.pathname === '/upload/drive/v3/files') {
      const buf = new Uint8Array(await new Response(init.body).arrayBuffer()); const txt = new TextDecoder('latin1').decode(buf);
      const b = /boundary=(.+)$/.exec(init.headers['content-type'])[1];
      const parts = txt.split(`--${b}`); const meta = JSON.parse(parts[1].split('\r\n\r\n')[1].replace(/\r\n$/, ''));
      const second = txt.indexOf(`--${b}`, txt.indexOf(`--${b}`) + 1); const start = txt.indexOf('\r\n\r\n', second) + 4; const end = buf.length - (`\r\n--${b}--`).length;
      const id = `f${++seq}`; files.set(id, { id, createdTime: seq, ...meta, data: buf.slice(start, end) }); return json({ id });
    }
    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const f = files.get(m[1]); if (!f) return json({}, 404);
      return u.searchParams.get('alt') === 'media' ? new Response(f.data) : json({ appProperties: f.appProperties });
    }
    return json({}, 400);
  };
  return { fetchFn, files, log, tokens: () => tokens };
}
