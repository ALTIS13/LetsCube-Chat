import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {closeBrowserNotification, notificationPresentationTag} from '../../artifacts/kub/src/lib/browserNotificationPresentation.ts';
import * as projection from '../../artifacts/kub/src/lib/messageNotificationProjection.ts';

const hookUrl=new URL('../../artifacts/kub/src/hooks/useNotifications.ts',import.meta.url);
const hookSource=readFileSync(hookUrl,'utf8');
const tree=ts.createSourceFile('useNotifications.ts',hookSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const matches=[];
function visit(node){
  if(ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect'&&node.arguments[0]
    &&node.arguments[0].getText(tree).includes('const previousUnread = unreadPresentationTagsRef.current;'))matches.push(node.arguments[0]);
  ts.forEachChild(node,visit);
}
visit(tree);assert.equal(matches.length,1,'ACTUAL_PRESENTATION_EFFECT_REQUIRED');
const effectText=matches[0].getText(tree);
const compileEffect=text=>ts.transpileModule('export const effect='+text+';',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const effectJs=compileEffect(effectText);
const helperSource=readFileSync(new URL('../../artifacts/kub/src/lib/browserNotificationPresentation.ts',import.meta.url),'utf8');
function compileHelper(text){
  const module={exports:{}},context={module,exports:module.exports,require(name){assert.equal(name,'./messageNotificationProjection.ts');return projection;}};
  Object.defineProperty(context,'navigator',{get:()=>globalThis.navigator});
  vm.runInNewContext(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return module.exports.closeBrowserNotification;
}
const OWNER='10000000-0000-4000-8000-000000000001';
const CHAT='20000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const notice=(id,chat=CHAT,read=false)=>({id,user_id:OWNER,kind:'message',read_at:read?'2026-10-28T12:00:00Z':null,payload:{chat_id:chat}});

async function fixture(run,{close=closeBrowserNotification,effect=effectJs}={}){
  let release,current=true;const messages=[],pending=[];
  const ready=new Promise(resolve=>{release=resolve;});
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{ready}}});
  const module={exports:{}},owner={};
  const context={module,exports:module.exports,userId:OWNER,readOwner:owner,items:[],unreadCount:0,
    unreadPresentationTagsRef:{current:new Map()},alertRowsRef:{current:{owner,rows:new Map()}},
    isCurrentReadOwner:()=>current,isNativeAndroid:()=>false,isDesktopApp:()=>false,
    notificationPresentationTag,updateBrowserAppBadge:async()=>{},
    closeBrowserNotification(...args){const p=close(...args);pending.push(p);return p;}};
  vm.runInNewContext(effect,context);
  const render=(rows,paint=true)=>{
    context.alertRowsRef.current.rows=new Map(rows.map(row=>[row.id,row]));
    if(paint){context.items=rows;context.unreadCount=rows.filter(row=>!row.read_at).length;module.exports.effect();}
  };
  const f={messages,render,retire(){current=false;},async settle(){release({active:{postMessage:value=>messages.push(value)}});await Promise.all(pending);}};
  try{await run(f);}finally{
    release({active:{postMessage:value=>messages.push(value)}});await Promise.all(pending);
    if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;
  }
}

test('actual effect closes the confirmed read tag when no replacement arrived',()=>fixture(async f=>{
  f.render([notice('old')]);f.render([notice('old',CHAT,true)]);await f.settle();
  assert.deepEqual(f.messages,[{type:'KUB_CLOSE_NOTIFICATION',tag:'message:chat:'+CHAT}]);
}));

test('pending service-worker readiness cannot close a newer unread same-chat card, even before repaint',()=>fixture(async f=>{
  f.render([notice('old')]);f.render([notice('old',CHAT,true)]);
  f.render([notice('old',CHAT,true),notice('new')],false);await f.settle();
  assert.equal(f.messages.length,0,'NEW_UNREAD_REPLACEMENT_MUST_SURVIVE');
}));

test('retiring the read owner while worker readiness is pending prevents stale dispatch',()=>fixture(async f=>{
  f.render([notice('old')]);f.render([notice('old',CHAT,true)]);f.retire();await f.settle();
  assert.equal(f.messages.length,0,'RETIRED_READ_OWNER_MUST_NOT_CLOSE');
}));

test('another chat unread card does not block the confirmed tag cleanup',()=>fixture(async f=>{
  f.render([notice('old')]);f.render([notice('old',CHAT,true)]);
  f.render([notice('old',CHAT,true),notice('other',OTHER)],false);await f.settle();
  assert.equal(f.messages.length,1);assert.equal(f.messages[0].tag,'message:chat:'+CHAT);
}));

test('a replacement that is itself confirmed read does not leave an unread veto',()=>fixture(async f=>{
  f.render([notice('old')]);f.render([notice('old',CHAT,true)]);
  f.render([notice('old',CHAT,true),notice('new',CHAT,true)],false);await f.settle();assert.equal(f.messages.length,1);
}));

async function replacementSurvives(options){return fixture(async f=>{
  f.render([notice('old')]);f.render([notice('old',CHAT,true)]);
  f.render([notice('old',CHAT,true),notice('new')],false);await f.settle();
  assert.equal(f.messages.length,0,'NEW_UNREAD_REPLACEMENT_MUST_SURVIVE');
},options);}

test('compiled omission of the post-ready recheck restores the actual stale close',async()=>{
  const guard='    if (!isCurrent()) return;';assert.equal(helperSource.split(guard).length,2);
  await assert.rejects(replacementSurvives({close:compileHelper(helperSource.replace(guard,''))}),
    e=>e.code==='ERR_ASSERTION'&&e.message.includes('NEW_UNREAD_REPLACEMENT_MUST_SURVIVE'));
});

test('compiled omission of read-owner guard cannot pass retired-owner oracle',async()=>{
  const guard='() => isCurrentReadOwner()\n          && ![...alertRowsRef.current.rows.values()]';assert.equal(effectText.split(guard).length,2);
  const effect=compileEffect(effectText.replace(guard,'() => true\n          && ![...alertRowsRef.current.rows.values()]'));
  await assert.rejects(fixture(async f=>{
    f.render([notice('old')]);f.render([notice('old',CHAT,true)]);f.retire();await f.settle();
    assert.equal(f.messages.length,0,'RETIRED_READ_OWNER_MUST_NOT_CLOSE');
  },{effect}),e=>e.code==='ERR_ASSERTION'&&e.message.includes('RETIRED_READ_OWNER_MUST_NOT_CLOSE'));
});

test('compiled replacement with render-lagged tag map fails confirmed-read cleanup',async()=>{
  const guard='[...alertRowsRef.current.rows.values()].some(row => row.user_id === userId\n            && !row.read_at && notificationPresentationTag(row) === previousTag)';
  assert.equal(effectText.split(guard).length,2);
  const effect=compileEffect(effectText.replace(guard,'[...unreadPresentationTagsRef.current.values()].includes(previousTag)'));
  await assert.rejects(fixture(async f=>{
    f.render([notice('old')]);f.render([notice('old',CHAT,true)]);await f.settle();
    assert.equal(f.messages.length,1,'CONFIRMED_READ_TAG_MUST_CLOSE');
  },{effect}),e=>e.code==='ERR_ASSERTION'&&e.message.includes('CONFIRMED_READ_TAG_MUST_CLOSE'));
});
