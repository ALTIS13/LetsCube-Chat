import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {listReadSucceeded,listReadRefused,listReadEnded} from '../../artifacts/kub/src/lib/listReadState.ts';
const requireKub=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url));
const ts=requireKub('typescript');
const text=readFileSync(new URL('../../artifacts/kub/src/hooks/useChats.ts',import.meta.url),'utf8');
const tree=ts.createSourceFile('useChats.ts',text,ts.ScriptTarget.Latest,true);
const effects=[];
function visit(node){
 if(ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect'&&node.arguments[0]?.getText(tree).includes('cachedChatsReadRef.current = pending'))effects.push(node.arguments[0].getText(tree));
 ts.forEachChild(node,visit);
}
visit(tree);assert.equal(effects.length,1);
const code=ts.transpile('('+effects[0]+')',{target:ts.ScriptTarget.ES2022});
function fixture(){
 let resolve,read,writes=0,current=true;
 const promise=new Promise(r=>{resolve=r;});const before=[];
 const state={chats:before};const display={current:null};
 const env={userId:'fixture-owner',captureOwner:()=>()=>current,
  offlineHistory:{capture:()=>({userId:'fixture-owner',readChats:()=>promise})},
  useAppStore:{getState:()=>state},listProgressRef:{current:0},cachedChatsReadRef:{current:null},
  listDisplaySourceRef:display,setChats:rows=>{state.chats=rows;writes++;},setRead:next=>{read=next;},
  listReadSucceeded,listReadRefused,CHATS_UNAVAILABLE:'Не удалось загрузить чаты.'};
 new Function(...Object.keys(env),'return '+code)(...Object.values(env))();
 return {env,resolve,retire:()=>{current=false;},get read(){return read;},get writes(){return writes;},get rows(){return state.chats;}};
}

test('actual cache restoration effect does not manufacture a failed server request',async()=>{
 const f=fixture();const rows=[{id:'fixture-chat'}];f.resolve(rows);await Promise.resolve();await Promise.resolve();
 assert.equal(f.read.error,null);
 assert.equal(f.read.fromCache,true);
 assert.equal(f.env.listDisplaySourceRef.current,'cache');
 assert.equal(f.rows,rows);assert.equal(f.writes,1);
 const failure=listReadRefused(f.read,{subject:'fixture-owner',message:'Не удалось обновить чаты.'});
 assert.equal(failure.error,'Не удалось обновить чаты.');assert.equal(failure.fromCache,undefined);
 assert.equal(listReadEnded(f.read).fromCache,true);
 assert.equal(listReadSucceeded('fixture-owner').fromCache,undefined);
});

test('retired owners and newer list reads still refuse a late restored snapshot',async()=>{
 for(const change of ['owner','progress','rows']){
  const f=fixture();if(change==='owner')f.retire();else if(change==='progress')f.env.listProgressRef.current++;else f.env.useAppStore.getState().chats=[];
  f.resolve([{id:'retired-fixture-chat'}]);await Promise.resolve();await Promise.resolve();assert.equal(f.writes,0);assert.equal(f.read,undefined);
 }
});
