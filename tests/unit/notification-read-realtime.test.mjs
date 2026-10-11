import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const hookPath=new URL('../../artifacts/kub/src/hooks/useNotifications.ts',import.meta.url);
const source=readFileSync(hookPath,'utf8');
const mergeSource=readFileSync(new URL('../../artifacts/kub/src/lib/notificationRows.ts',import.meta.url),'utf8');
const READ_AT='2026-10-12T12:00:00.000Z';
const plain=v=>JSON.parse(JSON.stringify(v));
function javascript(text) {
  const result=ts.transpileModule(text,{reportDiagnostics:true,compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }});
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
  return result.outputText;
}
const module={exports:{}};
vm.runInNewContext(javascript(mergeSource),{module,exports:module.exports});
const {mergeNotificationRows}=module.exports;
function actualCallbacks(text) {
  const tree=ts.createSourceFile('useNotifications.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  assert.equal(tree.parseDiagnostics.length,0);
  const reads=[],updates=[];
  function visit(node) {
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='markReadIds'
      &&node.initializer&&ts.isCallExpression(node.initializer))reads.push(node.initializer.arguments[0]);
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='on'
      &&node.arguments.length===3&&ts.isObjectLiteralExpression(node.arguments[1])) {
      const event=node.arguments[1].properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(tree)==='event');
      if(event&&ts.isStringLiteral(event.initializer)&&event.initializer.text==='UPDATE')updates.push(node.arguments[2]);
    }
    ts.forEachChild(node,visit);
  }
  visit(tree);assert.equal(reads.length,1);assert.equal(updates.length,1);
  return {read:reads[0].getText(tree),update:updates[0].getText(tree)};
}
function notice(id='fictional-notice',createdAt='2026-10-12T11:00:00.000Z',readAt=null) {
  return {id,user_id:'fictional-owner',kind:'message',created_at:createdAt,read_at:readAt,
    title:'fictional old metadata',payload:{chat_id:'fictional-chat',message_id:'fictional-message'}};
}
function consumer(rows=[notice()],text=source) {
  const callbacks=actualCallbacks(text),pending=[],rpcCalls=[];
  let items=rows,current=true,held;
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[READ_AT]));}}
  const scope={mergeNotificationRows,Date:FixedDate,accountGenerationRef:{current:1},
    readOwner:{userId:'fictional-owner',pending:new Set()},current:()=>current,isCurrentReadOwner:()=>current,
    setItems:update=>pending.push(update),setError(){throw Error('UNEXPECTED_ERROR_PUBLICATION');},
    mapPgError(){throw Error('UNEXPECTED_ERROR_MAPPING');},supabase:{rpc(fn,args){rpcCalls.push({fn,args});return new Promise(resolve=>{held=resolve;});}}};
  const compile=text=>vm.runInNewContext('(function(){'+javascript('const callback='+text+';')+'\nreturn callback;})()',scope);
  const read=compile(callbacks.read),update=compile(callbacks.update);
  const flush=()=>{while(pending.length)items=pending.shift()(items);};
  return {read,update,flush,rpcCalls,get items(){return plain(items);},retire(){current=false;},ack(){held({error:null});}};
}
async function acknowledgedThenUpdate(text=source) {
  const c=consumer(undefined,text),read=c.read(['fictional-notice']);
  assert.deepEqual(plain(c.rpcCalls),[{fn:'notifications_mark_read',args:{p_id:'fictional-notice'}}]);
  assert.equal(c.items[0].read_at,null,'RPC pending is not read confirmation');
  c.ack();await read;c.flush();assert.equal(c.items[0].read_at,READ_AT,'actual read ACK positive control');
  c.update({new:{...notice(),title:'fictional changed metadata'}});c.flush();
  assert.equal(c.items[0].read_at,READ_AT,'STALE_REALTIME_MUST_NOT_REOPEN_READ');
  assert.equal(c.items[0].title,'fictional changed metadata');
  assert.equal(c.items.filter(n=>!n.read_at).length,0,'read row cannot inflate bell unread count');
}
test('stale realtime UPDATE after actual read ACK preserves confirmed read',()=>acknowledgedThenUpdate());

test('newer known UPDATE replaces metadata and accepts a real server read timestamp',()=>{
  const c=consumer();const newer={...notice(undefined,'2026-10-12T11:01:00.000Z',READ_AT),title:'fictional newer metadata'};
  c.update({new:newer});c.flush();assert.deepEqual(c.items,[newer]);
  c.update({new:{...notice(),title:'fictional older metadata'}});c.flush();assert.deepEqual(c.items,[newer]);
});

test('unknown UPDATE cannot insert overflow or reorder the existing bounded page',()=>{
  const rows=Array.from({length:30},(_,i)=>notice('fictional-'+i));const c=consumer(rows);
  c.update({new:notice('fictional-unknown')});c.flush();assert.deepEqual(c.items,rows);
  c.update({new:{...notice('fictional-15','2026-10-12T13:00:00.000Z'),title:'fictional replacement'}});c.flush();
  assert.equal(c.items.length,30);assert.deepEqual(c.items.map(n=>n.id),rows.map(n=>n.id));
  assert.equal(c.items[15].title,'fictional replacement');
});

test('retired UPDATE and queued state updater both remain inert',()=>{
  const first=consumer();first.retire();first.update({new:notice(undefined,undefined,READ_AT)});first.flush();
  assert.equal(first.items[0].read_at,null);
  const queued=consumer();queued.update({new:notice(undefined,undefined,READ_AT)});queued.retire();queued.flush();
  assert.equal(queued.items[0].read_at,null);
});

test('compiled omission of the actual UPDATE merge fails the literal read oracle',async()=>{
  const anchor='n.id === row.id ? mergeNotificationRows([n], [row], 1)[0] : n';
  assert.equal(source.split(anchor).length-1,1);
  await assert.rejects(acknowledgedThenUpdate(source.replace(anchor,'n.id === row.id ? row : n')),
    e=>e.code==='ERR_ASSERTION'&&e.message.includes('STALE_REALTIME_MUST_NOT_REOPEN_READ'));
});
test.after(()=>assert.equal(readFileSync(hookPath,'utf8'),source,'hook unchanged during focused validation'));
