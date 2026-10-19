const EXPECTED = 'dd944ef9-d5e9-40dc-b034-5e156f71ef51';
const TABLE = 'af_d1_probe_tx_20261019';
const send = (status, obj) => Response.json(obj, {status, headers: {'cache-control':'no-store','x-content-type-options':'nosniff'}});
const digest = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v => v.toString(16).padStart(2,'0')).join('');
export default {
 async fetch(request,env){
  if(!env.DB || !env.TEST_KEY) return send(503,{ok:false,error:'misconfigured'});
  const auth=request.headers.get('authorization') || '';
  if(auth !== `Bearer ${env.TEST_KEY}`) return send(403,{ok:false,error:'forbidden'});
  const u=new URL(request.url);
  if(request.method !== 'POST') return send(405,{ok:false,error:'method_not_allowed'});
  if((request.headers.get('content-length')||'0')*1 > 2048) return send(413,{ok:false,error:'too_large'});
  let body={}; try{body=await request.json();}catch{return send(400,{ok:false,error:'invalid_json'});}
  const operation_id=body.operation_id;
  if(typeof operation_id!=='string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(operation_id)) return send(422,{ok:false,error:'bad_operation_id'});
  try {
   if(u.pathname==='/check') {
    const r=await env.DB.prepare(`SELECT count(*) AS n FROM ${TABLE}`).first();
    return send(200,{ok:true,rows:r.n});
   }
   if(u.pathname==='/batch-rollback') {
    const before=await env.DB.prepare(`SELECT count(*) AS n FROM ${TABLE} WHERE operation_id=?`).bind(operation_id).first();
    let rejected=false;
    try {
     await env.DB.batch([
      env.DB.prepare(`INSERT INTO ${TABLE}(operation_id,payload_digest,version) VALUES(?,?,1)`).bind(operation_id,'rollback-sentinel'),
      env.DB.prepare(`INSERT INTO ${TABLE}(operation_id,payload_digest,version) VALUES(?,?,1)`).bind(operation_id,'duplicate-key')
     ]);
    } catch(_err) {rejected=true;}
    const after=await env.DB.prepare(`SELECT count(*) AS n FROM ${TABLE} WHERE operation_id=?`).bind(operation_id).first();
    return send(200,{ok:rejected && before.n===after.n, rejected, before:before.n,after:after.n});
   }
   if(u.pathname==='/apply' || u.pathname==='/ack-lost') {
    if(typeof body.payload!=='string'||body.payload.length>120) return send(422,{ok:false,error:'bad_payload'});
    const h=await digest(body.payload);
    await env.DB.prepare(`INSERT INTO ${TABLE}(operation_id,payload_digest,version) VALUES(?,?,1) ON CONFLICT(operation_id) DO NOTHING`).bind(operation_id,h).run();
    const row=await env.DB.prepare(`SELECT payload_digest,version FROM ${TABLE} WHERE operation_id=?`).bind(operation_id).first();
    if(row.payload_digest !==h) return send(409,{ok:false,error:'operation_conflict'});
    if(u.pathname==='/ack-lost') return new Response(null,{status:204}); // synthetic lost application receipt; HTTP still delivered
    return send(200,{ok:true,operation_id,version:row.version,digest:row.payload_digest});
   }
   if(u.pathname==='/read') {
    const row=await env.DB.prepare(`SELECT payload_digest,version FROM ${TABLE} WHERE operation_id=?`).bind(operation_id).first();
    return send(200,{ok:true,exists:!!row,version:row?.version??null,digest:row?.payload_digest??null});
   }
   if(u.pathname==='/cas') {
    if(typeof body.payload!=='string'||body.payload.length>120||!Number.isInteger(body.expected_version)||body.expected_version<1) return send(422,{ok:false,error:'bad_cas'});
    const h=await digest(body.payload);
    const result=await env.DB.prepare(`UPDATE ${TABLE} SET payload_digest=?,version=version+1 WHERE operation_id=? AND version=?`).bind(h,operation_id,body.expected_version).run();
    const row=await env.DB.prepare(`SELECT payload_digest,version FROM ${TABLE} WHERE operation_id=?`).bind(operation_id).first();
    return send(result.meta?.changes===1?200:409,{ok:result.meta?.changes===1,changes:result.meta?.changes??null,version:row?.version??null});
   }
   return send(404,{ok:false,error:'not_found'});
  }catch(error){return send(500,{ok:false,error:'db_error',kind: String(error?.name||'Error')});}
 }
};
