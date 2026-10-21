import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fixture, page, chat, peer, owner, topic, asUser, quote, proposal } from './history-cache-page.fixture.mjs';
import { readFile } from 'node:fs/promises';

// Explicit invocation only: no production fallback or pretend WASM timings.
test('isolated PostgreSQL17 conditional-page work and response bytes', { timeout: 150000 }, async t => {
  assert.ok(process.env.LETSCUBE_HISTORY_PG17_DRIVER, 'explicit native driver required');
  assert.ok(process.env.LETSCUBE_HISTORY_METRICS_RECEIPT, 'explicit private receipt path required');
  const source=await readFile(proposal);
  const db=await fixture({sql:source.toString('utf8')}); t.after(()=>db.close());
  const results=[];
  for(const count of [1000,10000,100000]) {
    await db.exec(`truncate public.messages;
      insert into public.messages(id,chat_id,user_id,content,created_at)
        select ('72000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${chat}','${peer}',
          repeat('synthetic-',4),'2026-10-20T00:00:00Z'::timestamptz+n*interval '1 microsecond'
        from generate_series(1,${count}) n;
      analyze public.messages;set plan_cache_mode='force_generic_plan';`);
    const fresh=await page(db), match=await page(db,{digest:fresh.digest});
    assert.equal(JSON.parse(fresh.payload).rows.length,100);assert.equal(match.status,'unchanged');
    const functionPlan=(await asUser(db,`select (select public.message_text_cache_page_v1('${chat}')) as value`))[0];
    assert.equal(functionPlan.value.status,'fresh');
    const measure=async sql=>{
      const rows=await asUser(db,`select * from public.message_text_cache_page_v1('${chat}')`);
      assert.ok(rows.length,'ordinary role must remain admitted');
      // EXPLAIN is a statement, not a subquery. Read only JSON, never row bodies.
      await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`);
      try {return await db.exec(`explain(analyze,buffers,settings,format json) ${sql}`);}
      finally {await db.exec('reset role;');}
    };
    const digest=quote(fresh.digest);
    const explainFresh=JSON.parse(await measure(`select public.message_text_cache_page_v1('${chat}')`));
    const explainMatch=JSON.parse(await measure(`select public.message_text_cache_page_v1('${chat}','all',null,null,null,${digest})`));
    const selector=JSON.parse(await measure(`select m.id,m.content,m.created_at from public.messages m
      where m.chat_id='${chat}' and m.deleted_at is null order by m.created_at desc,m.id desc limit101`.replace('limit101','limit 101')));
    const summary=p=>({executionMs:p[0]['Execution Time'],planningMs:p[0]['Planning Time'],
      sharedHit:p[0].Plan['Shared Hit Blocks'],sharedRead:p[0].Plan['Shared Read Blocks'],
      tempRead:p[0].Plan['Temp Read Blocks'],tempWritten:p[0].Plan['Temp Written Blocks']});
    results.push({rows:count,distribution:'short-text/uniform-microseconds',freshBytes:Buffer.byteLength(JSON.stringify(fresh)),
      matchBytes:Buffer.byteLength(JSON.stringify(match)),fresh:summary(explainFresh),match:summary(explainMatch),selector:summary(selector),
      selectorPlan:selector[0].Plan});
  }
  // Deliberately sparse selected topic demonstrates examined work is not bounded
  // by a100-row response. It is evidence for later query/index decisions only.
  await db.exec(`update public.messages set topic_id='${topic}' where mod(right(id::text,6)::int,1000)=0;analyze public.messages;`);
  const sparse=await page(db,{scope:'topic',topic});
  assert.equal(JSON.parse(sparse.payload).rows.length,100);
  const value={status:'NATIVE_PG17_MINIMAL_SCHEMA_METRICS_PASS',version:(await db.metadata()).version,
    sqlSha256:createHash('sha256').update(source).digest('hex'),results,
    sparseRows:100,at:new Date().toISOString(),productionMutations:false,
    limits:'Warm synthetic minimal RLS fixture, CPU capped. Not full production schema/PostgREST, cold storage, p50/p95 or end-user startup latency. Function EXPLAIN does not expose its inner node plan.'};
  assert.deepEqual(await readFile(proposal),source,'measured source changed during execution');
  await writeFile(process.env.LETSCUBE_HISTORY_METRICS_RECEIPT,JSON.stringify(value),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:value.status,version:value.version,results:results.map(r=>({rows:r.rows,freshBytes:r.freshBytes,matchBytes:r.matchBytes,fresh:r.fresh,match:r.match})),sparseRows:100}));
});
