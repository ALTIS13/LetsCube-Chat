import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as marks from '../../artifacts/kub/src/lib/readMarkWatermark.ts';
import * as delta from '../../artifacts/kub/src/lib/chatListDelta.ts';
const ts=createRequire(import.meta.url)('typescript');
const src=file=>readFileSync(new URL('../../artifacts/kub/src/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
function compile(code,globals={}){
  const module={exports:{}};
  const out=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(out,{module,exports:module.exports,...globals});return module.exports;
}
const A='2026-10-26T00:00:00.123456+00:00',Z='2026-10-26T00:00:00.123456Z',OFFSET='2026-10-26T03:00:00.123456+03:00',NEXT='2026-10-26T00:00:00.123457Z';
const UID='95000000-0000-4000-8000-000000000001',CHAT='95000000-0000-4000-8000-000000000002',OTHER='95000000-0000-4000-8000-000000000003';
const chat=(cleared_at,hidden_at=null)=>({id:CHAT,type:'private',updated_at:A,cleared_at,hidden_at,members:[{user_id:UID}]});
const hook=src('hooks/useChats.ts'),ast=ts.createSourceFile('useChats.ts',hook,ts.ScriptTarget.Latest,true);
const callbacks=[],ifs=[];
function visit(n){
  if(ts.isIfStatement(n))ifs.push(n);
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='on'&&n.arguments.length===3){
    const f=n.arguments[1].getText(ast);if(f.includes('"UPDATE"')&&f.includes('"chat_members"')&&f.includes('user_id=eq.'))callbacks.push(n.arguments[2].getText(ast));
  }ts.forEachChild(n,visit);
}visit(ast);assert.equal(callbacks.length,1,'EXACT_ACTUAL_MEMBERSHIP_CALLBACK_REQUIRED');
function membership(previous,row,active=true,callback=callbacks[0]){
  const retired=[],evicted=[];const chats=[previous];
  const fn=compile('module.exports='+callback,{userId:UID,isCurrent:()=>active,
    sameTimestampInstant:marks.sameTimestampInstant,useAppStore:{getState:()=>({chats})},
    invalidateCachedChat:id=>retired.push(id),clearedAtCache:{evictChat:id=>evicted.push(id)},channelPreviewCache:{evict(){}},
    applyEvent:event=>delta.applyOwnMembershipUpdate(chats,event.row,{currentUserId:UID}).outcome,scheduleRefetch(){},scheduleSummary(){}});
  fn({new:{chat_id:CHAT,user_id:UID,...row}});return{retired:retired.length,evicted:evicted.length};
}
test('known control: actual timestamp parser retains literal microsecond precision',()=>{
  assert.equal(marks.timestampMicros('1970-01-01T00:00:00.000001Z'),1);
  assert.equal(marks.timestampMicros(NEXT)-marks.timestampMicros(A),1);
  assert.equal(marks.timestampMicros(A),marks.timestampMicros(OFFSET));
});
test('shared equality: format/timezone/nullish equivalence, not one-microsecond or distinct malformed strings',()=>{
  assert.equal(typeof marks.sameTimestampInstant,'function');
  for(const[a,b]of [[A,Z],[Z,OFFSET],[null,undefined],[undefined,null],[null,null],['bad-a','bad-a']])assert.equal(marks.sameTimestampInstant(a,b),true);
  for(const[a,b]of [[A,NEXT],['bad-a','bad-b'],['bad-a',null],['',null],[A,'bad-a']])assert.equal(marks.sameTimestampInstant(a,b),false);
});
test('actual delta reducer requests refetch for genuine microsecond clear/hide changes',()=>{
  for(const key of ['cleared_at','hidden_at']){
    const previous={...chat(A),[key]:A};
    assert.equal(delta.applyOwnMembershipUpdate([previous],{chat_id:CHAT,user_id:UID,[key]:Z},{currentUserId:UID}).outcome,'ignored');
    assert.equal(delta.applyOwnMembershipUpdate([previous],{chat_id:CHAT,user_id:UID,[key]:NEXT},{currentUserId:UID}).outcome,'needs-refetch','ONE_MICROSECOND_CLEAR_OR_HIDE_MUST_NOT_BE_PRESERVED');
    assert.equal(delta.applyOwnMembershipUpdate([{...previous,[key]:'bad-a'}],{chat_id:CHAT,user_id:UID,[key]:'bad-b'},{currentUserId:UID}).outcome,'needs-refetch');
  }
});
test('actual membership callback: equal clear/hide no retirement, real clear retires once, foreign/stale ignored',()=>{
  for(const row of [{cleared_at:Z},{cleared_at:OFFSET},{hidden_at:Z}]){
    const r=membership(chat(A,A),row);assert.equal(r.retired,0,'SAME_INSTANT_MEMBERSHIP_MUST_NOT_RETIRE');assert.equal(r.evicted,0);
  }
  assert.equal(membership(chat(undefined),{cleared_at:null}).retired,0);
  assert.equal(membership(chat(A),{cleared_at:NEXT}).retired,1);
  assert.equal(membership(chat(A),{cleared_at:NEXT}).evicted,1);
  assert.equal(membership(chat(A),{cleared_at:NEXT,user_id:OTHER}).retired,0,'FOREIGN_MEMBER_MUST_NOT_RETIRE_OWN_CACHE');
  assert.equal(membership(chat(A),{cleared_at:NEXT},false).retired,0);
});
test('actual saved/list retirement conditions ignore spelling-only clear changes but retain genuine clears',()=>{
  const saved=ifs.filter(n=>n.expression.getText(ast).includes('nextIds.has(chat.id)'));
  const list=ifs.filter(n=>n.expression.getText(ast).includes('previousChats.find')&&n.thenStatement.getText(ast).includes('dropped.push(chat.id)'));
  assert.equal(saved.length,1);assert.equal(list.length,1);
  const evaluate=(n,globals)=>compile('module.exports=('+n.expression.getText(ast)+')',{sameTimestampInstant:marks.sameTimestampInstant,...globals});
  assert.equal(evaluate(saved[0],{nextIds:new Set([CHAT]),chat:chat(A),current:chat(Z)}),false,'SAME_SAVED_CLEAR_MARK_MUST_NOT_RETIRE');
  assert.equal(evaluate(saved[0],{nextIds:new Set([CHAT]),chat:chat(A),current:chat(NEXT)}),true);
  assert.equal(evaluate(saved[0],{nextIds:new Set(),chat:chat(A),current:undefined}),true);
  assert.equal(evaluate(list[0],{previousChats:[chat(A)],chat:chat(Z)}),false,'SAME_LIST_CLEAR_MARK_MUST_NOT_RETIRE');
  assert.equal(evaluate(list[0],{previousChats:[chat(A)],chat:chat(NEXT)}),true);
});
for(const[name,from,to,a,b]of [
  ['millisecond rounding','aMicros === timestampMicros(b)','Math.floor(aMicros / 1000) === Math.floor(timestampMicros(b) / 1000)',A,NEXT],
  ['invalid null collapse','aMicros !== null && aMicros === timestampMicros(b)','aMicros === timestampMicros(b)','bad-a','bad-b'],
])test('literal rule mutation killed: '+name,async()=>{
  const source=src('lib/readMarkWatermark.ts');assert.equal(source.split(from).length,2);
  const code=ts.transpileModule(source.replace(from,to),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  assert.throws(()=>assert.equal(mutant.sameTimestampInstant(a,b),false),{code:'ERR_ASSERTION'});
});
test('actual callback mutation killed: foreign-user guard omitted',()=>{
  const guard='if (payload.new?.user_id && payload.new.user_id !== userId) return;';assert.equal(callbacks[0].split(guard).length,2);
  assert.throws(()=>assert.equal(membership(chat(A),{cleared_at:NEXT,user_id:OTHER},true,callbacks[0].replace(guard,'')).retired,0),{code:'ERR_ASSERTION'});
});
