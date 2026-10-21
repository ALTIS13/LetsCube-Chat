import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { chromium, webkit } from '@playwright/test';
import { historyCacheCodecModules } from '../helpers/history-cache-codec.mjs';
import { fixture, page as serverPage, seed, owner, chat } from '../server/history-cache-page.fixture.mjs';

process.env.KUB_QA_ALLOW_MUTATIONS='0';
const origin='http://127.0.0.1:18764';
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const codecUrl=await historyCacheCodecModules();
const loader=compile((await readFile(new URL('../../artifacts/kub/src/lib/historyCache/load.ts',import.meta.url),'utf8'))
  .replace('"./codec.ts"',JSON.stringify(codecUrl)));
const storage=compile(await readFile(new URL('../../artifacts/kub/src/lib/historyCache/storage.ts',import.meta.url),'utf8'));

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
  test(`${name}: two-document cache waits for actual SQL admission and retires held unchanged response`,{timeout:45000},async t=>{
    const db=await fixture();t.after(()=>db.close());await seed(db,3);
    const browser=await engine.launch({headless:true});t.after(()=>browser.close());
    const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());
    let unexpected=0,held=null,holdNext=false;
    const replies=[];
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin){unexpected++;return route.abort();}
      if(url.pathname==='/rpc'&&route.request().method()==='POST') {
        const {scope,digest}=route.request().postDataJSON();
        assert.equal(scope.chatId,chat);
        const response=await serverPage(db,{scope:scope.mode,topic:scope.topicId,
          beforeAt:scope.before?.createdAt,beforeId:scope.before?.id,digest});
        replies.push({status:response.status,hasBody:typeof response.payload==='string'});
        if(holdNext) {
          holdNext=false;
          await new Promise(resolve=>{held=resolve;});held=null;
        }
        return route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
      }
      const modules={'/load.js':loader,'/storage.js':storage};
      if(url.pathname!=='/'&&!modules[url.pathname]){unexpected++;return route.abort();}
      return route.fulfill({contentType:url.pathname==='/'?'text/html':'text/javascript',
        body:url.pathname==='/'?'<!doctype html><title>Synthetic cache admission</title><main id="result">waiting</main>':modules[url.pathname]});
    });
    const open=async()=>{
      const document=await context.newPage();await document.goto(origin);
      await document.evaluate(async({owner,chat})=>{
        const {loadHistoryCachePage}=await import('/load.js');
        const {browserHistoryCacheStorage}=await import('/storage.js');
        const storage=browserHistoryCacheStorage();
        Object.assign(globalThis,{storage,owner,active:true,done:false,result:null,
          start(before=null){
            globalThis.done=false;document.getElementById('result').textContent='waiting';
            globalThis.pending=loadHistoryCachePage({storage,namespace:'synthetic-backend',ownerId:owner,
              scope:{chatId:chat,mode:'all',topicId:null,before},isCurrent:()=>globalThis.active,now:()=>2000,
              request:async(scope,digest)=>{const response=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope,digest})});return response.json();},
            }).then(result=>{globalThis.result=result;globalThis.done=true;
              document.getElementById('result').textContent=result?.page.rows[0]?.content??'no admitted text';});
          }});
      },{owner,chat});return document;
    };
    try {
      const first=await open();await first.evaluate(()=>start());
      await first.waitForFunction(()=>done);
      assert.equal(await first.locator('#result').textContent(),'synthetic 3');
      assert.deepEqual(replies,[{status:'fresh',hasBody:true}]);
      await first.close();
      const second=await open();holdNext=true;await second.evaluate(()=>start());
      await second.waitForFunction(()=>!done&&!!pending);
      await assertEventually(()=>held!==null);
      assert.equal(await second.locator('#result').textContent(),'waiting','disk text cannot publish before fresh server reply');
      held();await second.waitForFunction(()=>done);
      assert.equal(await second.locator('#result').textContent(),'synthetic 3');
      assert.deepEqual(replies.at(-1),{status:'unchanged',hasBody:false});

      holdNext=true;await second.evaluate(()=>start());await assertEventually(()=>held!==null);
      const third=await open();
      await third.evaluate(()=>storage.invalidate('synthetic-backend',owner));
      await db.exec(`update public.chat_members set cleared_at='2026-10-21T00:00:00Z' where user_id='${owner}'`);
      held();await second.waitForFunction(()=>done);
      assert.equal(await second.evaluate(()=>result),null,'held old unchanged answer cannot cross durable owner invalidation');
      assert.equal(await second.locator('#result').textContent(),'no admitted text');
      await second.evaluate(()=>start());await second.waitForFunction(()=>done);
      assert.equal(await second.evaluate(()=>result?.page.rows.length),0,'new admission obeys current server clear');

      await db.exec('update public.chat_members set cleared_at=null;update public.messages set type=\'photo\'');
      await second.evaluate(()=>start());await second.waitForFunction(()=>done);
      assert.equal(await second.evaluate(()=>result),null,'mixed media page must use normal history');
      assert.deepEqual(replies.at(-1),{status:'unsupported',hasBody:false});

      await db.exec('truncate public.message_hidden_for_users,public.messages');
      await seed(db,101);
      await db.exec(`insert into public.message_hidden_for_users select id,'${owner}' from public.messages
        where id<>'71000000-0000-4000-8000-000000001001'`);
      await second.evaluate(()=>start());await second.waitForFunction(()=>done);
      const continuation=await second.evaluate(()=>({
        count:result?.page.rows.length,hasMore:result?.page.has_more,
        before:{createdAt:result?.page.next_before_created_at,id:result?.page.next_before_id},
      }));
      assert.equal(continuation.count,0);assert.equal(continuation.hasMore,true);
      assert.deepEqual(continuation.before,{createdAt:'2026-10-20T00:00:00.123456Z',id:'71000000-0000-4000-8000-000000001002'});
      await second.evaluate(before=>start(before),continuation.before);await second.waitForFunction(()=>done);
      assert.equal(await second.locator('#result').textContent(),'synthetic 1','hidden head must not trap older visible text');
      assert.equal(unexpected,0);
    } finally {held?.();await context.close();}
  });
}

async function assertEventually(predicate) {
  const deadline=Date.now()+10000;
  while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(predicate(),'controlled SQL response did not reach the hold');
}
