import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

const kub = fileURLToPath(new URL("../../artifacts/kub/", import.meta.url));
const src = resolve(kub, "src"), requireKub = createRequire(resolve(kub, "package.json"));
const { build } = createRequire(requireKub.resolve("vite"))("esbuild"), ts = requireKub("typescript");
const U="10000000-0000-4000-8000-000000000001", OTHER="10000000-0000-4000-8000-000000000002";
const C="30000000-0000-4000-8000-000000000001", C2="30000000-0000-4000-8000-000000000002";
const T="40000000-0000-4000-8000-000000000001", G="40000000-0000-4000-8000-000000000002";
let browser, bundle;

function windowBoundary(change) {
  let text=readFileSync(resolve(src,"components/chat/ChatWindow.tsx"),"utf8");
  if(change){assert.equal(text.split(change[0]).length,2);text=text.replace(change[0],change[1]);}
  const file=ts.createSourceFile("ChatWindow.tsx",text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let producer="const currentTopicNotificationScope=undefined;",header;
  function visit(n){
    if(ts.isFunctionDeclaration(n)&&n.name?.text==="currentTopicNotificationScope")producer=n.getText(file).replace(/^export /,"");
    if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(file)==="ChatHeader")header=n.getText(file);
    ts.forEachChild(n,visit);
  }visit(file);assert.ok(header,"actual Window-to-Header boundary exists");
  return {producer,header};
}
async function compile(change) {
  const boundary=windowBoundary(change?.window);
  const result=await build({write:false,bundle:true,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":src},
    define:{"process.env.NODE_ENV":'"development"',"import.meta.env.DEV":"false","import.meta.env.BASE_URL":'"/"'},
    plugins:[{name:"fictional-topic-menu-ports",setup(p){
      p.onLoad({filter:/store[\\/]app\.store\.ts$/},()=>({loader:"ts",contents:`import{create}from'zustand';
        export const useAppStore=create(()=>({currentUser:{id:'${U}'},accountEpoch:1,chats:[],topicNotificationPreferences:{},
          chatMutes:{userId:'${U}',source:'server',error:null,prefs:{}},setChats(){},setSelectedChatId(){},setMessages(){}}));window.store=useAppStore;`}));
      p.onLoad({filter:/lib[\\/]supabase[\\/]client\.ts$/},()=>({loader:"ts",contents:`
        const client={rpc(name,args){if(!['topic_notification_preferences_read','topic_notification_preference_set'].includes(name))throw Error('UNEXPECTED_FIXTURE_RPC');
          const r={name,args};const result=new Promise((resolve,reject)=>{r.resolve=resolve;r.reject=reject;});result.abortSignal=signal=>{signal.addEventListener('abort',()=>{r.aborted=true;});return result;};window.requests.push(r);return result;},
          channel(name){const ch={name,on(){return ch;},subscribe(status){ch.status=status;return ch;}};window.channels.push(ch);return ch;},removeChannel:async()=> 'ok'};
        export const createClient=()=>client;export const isSupabaseConfigured=()=>false;`}));
      p.onLoad({filter:/hooks[\\/]useChatMute\.ts$/},()=>({loader:"ts",contents:`import{useAppStore}from'@/store/app.store';
        export function useChatMute(){const s=useAppStore();return{state:{muted:s.parentMuted??false,until:null},setMute:async option=>{window.parentWrites.push(option);return{ok:true,error:null};}};}`}));
      p.onLoad({filter:/hooks[\\/]usePersonalModeration\.ts$/},()=>({loader:"ts",contents:"export const usePersonalBlocks=()=>({ids:new Set()});"}));
      p.onLoad({filter:/hooks[\\/]usePresenceNow\.ts$/},()=>({loader:"ts",contents:"export const usePresenceNow=()=>10000;"}));
      p.onLoad({filter:/hooks[\\/]useVoiceCall\.ts$/},()=>({loader:"ts",contents:"export const useVoiceCall=()=>({channelId:null});"}));
      p.onLoad({filter:/hooks[\\/]useVoiceRing\.ts$/},()=>({loader:"ts",contents:"export const useVoiceRings=()=>[];export const startVoiceRing=()=>{throw Error('NO_CALL');};"}));
      p.onLoad({filter:/hooks[\\/]useGroupCalls\.ts$/},()=>({loader:"ts",contents:"export const useGroupCallForChat=()=>null;export const startGroupCall=()=>{throw Error('NO_CALL');};"}));
      p.onLoad({filter:/hooks[\\/]useMediaVariants\.ts$/},()=>({loader:"ts",contents:"export const useAvatarVariantUrls=()=>({});"}));
      p.onLoad({filter:/ui[\\/]ChatAvatar\.tsx$/},()=>({loader:"tsx",contents:"export const ChatAvatar=()=> <span aria-hidden='true'/>;"}));
      p.onLoad({filter:/chat[\\/]ReportDialog\.tsx$/},()=>({loader:"ts",contents:"export const requestContentReport=()=>{throw Error('NO_REPORT');};"}));
      p.onLoad({filter:/chat[\\/]MicroGroupPeopleModal\.tsx$/},()=>({loader:"tsx",contents:"export const MicroGroupPeopleModal=()=>null;"}));
      if(change?.header)p.onLoad({filter:/chat[\\/]ChatHeader\.tsx$/},()=>{
        const text=readFileSync(resolve(src,"components/chat/ChatHeader.tsx"),"utf8");assert.equal(text.split(change.header[0]).length,2);
        return {loader:"tsx",contents:text.replace(change.header[0],change.header[1]),resolveDir:resolve(src,"components/chat")};
      });
    }}],stdin:{resolveDir:kub,sourcefile:"fictional-topic-menu.tsx",loader:"tsx",contents:`
      import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
      import{ChatHeader}from'./src/components/chat/ChatHeader';import{useAppStore}from'@/store/app.store';
      import{canonicalTopicNotificationScope}from'@/lib/topicNotificationPreferences';import{GENERAL_CHANNEL_NAME}from'@/lib/channelRail';
      ${boundary.producer}
      window.requests=[];window.channels=[];window.parentWrites=[];
      let input={chatId:'${C}',chat:{id:'${C}',type:'group',name:'Fictional group',is_forum:true,members:[{user_id:'${U}',role:'member'}]},userId:'${U}',accountEpoch:1,
        selectedTopicId:'${T}',scopeKnown:true,topics:[{id:'${G}',chat_id:'${C}',name:'Общие',is_general:true,archived:false},{id:'${T}',chat_id:'${C}',name:'Дизайн',is_general:false,archived:false}]};
      function Boundary(){const s=useAppStore();const args={...input,userId:s.currentUser?.id??null,accountEpoch:s.accountEpoch,
        snapshot:input.scopeKnown?{userId:input.snapshotUserId??'${U}',accountEpoch:input.snapshotEpoch??1,chatId:input.snapshotChatId??'${C}',topics:input.topics}:null};
        const chatId=args.chatId,chat=args.chat,topicNotificationScope=input.heldScope??currentTopicNotificationScope?.(args)??null;
        const openChatSearch=()=>{},setShowInfo=()=>{},clearChatForMe=undefined,phoneServer=false,setRailOpen=()=>{};
        window.scope=topicNotificationScope;return ${boundary.header};}
      const root=createRoot(document.getElementById('root'));window.render=patch=>{input={...input,...patch};flushSync(()=>root.render(<Boundary/>));};
      window.owner=(id='${OTHER}',epoch=2)=>flushSync(()=>useAppStore.setState({currentUser:id?{id}:null,accountEpoch:epoch}));
      window.unmount=()=>flushSync(()=>root.unmount());`}});
  return result.outputFiles[0].text;
}
test.before(async()=>{assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS,"0","FICTIONAL_QA0_REQUIRED");bundle=await compile();browser=await requireKub("@playwright/test").chromium.launch({headless:true,env:{...process.env,KUB_QA_ALLOW_MUTATIONS:"0"}});});
test.after(async()=>{await browser?.close();});
async function fixture(t,{code=bundle,input={}}={}){
  const context=await browser.newContext({serviceWorkers:"block"}),page=await context.newPage(),errors=[],requests=[];
  page.setDefaultTimeout(1500);page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",r=>{requests.push("UNKNOWN_REQUEST");return r.abort();});
  await page.setContent('<!doctype html><div id="root"></div>');await page.addScriptTag({content:code});await page.evaluate(input=>window.render(input),input);
  t.after(async()=>{await page.evaluate(()=>window.unmount());await context.close();assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);});
  return{page,async menu(){await page.getByRole("button",{name:"Ещё",exact:true}).click();},async topic(){await page.getByRole("button",{name:"Уведомления темы",exact:true}).click();},
    async answer(name,data,error=null){await page.evaluate(({name,data,error})=>window.requests.findLast(r=>r.name===name).resolve({data,error}),{name,data,error});},
    async writes(){return page.evaluate(()=>window.requests.filter(r=>r.name==='topic_notification_preference_set').map(r=>r.args));},
    async ready(rows=[{scope_key:T,mode:"disabled",revision:7}]){await page.evaluate(()=>window.channels.at(-1).status("SUBSCRIBED"));
      await page.waitForFunction(()=>window.requests.some(r=>r.name==='topic_notification_preferences_read'));
      await page.evaluate(data=>window.requests.findLast(r=>r.name==='topic_notification_preferences_read').resolve({data,error:null}),rows);
      await page.waitForFunction(()=>document.querySelector('fieldset')?.disabled===false);}};
}
test("current canonical topic control is reachable through the actual Window Header menu",async t=>{
  const f=await fixture(t);await f.menu();
  assert.equal(await f.page.getByRole("button",{name:"Уведомления темы",exact:true}).count(),1,"CURRENT_TOPIC_MENU_MOUNT_REQUIRED");
  await f.topic();assert.equal(await f.page.locator('input[type=radio]').count(),3);await f.ready();
  assert.deepEqual(await f.page.locator('input:checked').evaluateAll(nodes=>nodes.map(n=>n.value)),["disabled"]);
});

test("parent chat mute remains separate and topic hook is mounted only on explicit submenu entry",async t=>{
  const f=await fixture(t);await f.page.evaluate(()=>window.store.setState({parentMuted:true}));await f.menu();
  assert.equal(await f.page.evaluate(()=>window.requests.length),0);
  assert.equal(await f.page.getByRole('menu').locator('[data-chat-menu-item="Включить уведомления"]').count(),1);
  await f.topic();await f.ready([{scope_key:T,mode:'enabled',revision:4}]);
  assert.match(await f.page.locator('fieldset').innerText(),/Уведомления отключены/);
  assert.equal(await f.page.locator('input[value=enabled]').isChecked(),true);
  await f.page.locator('input[value=disabled]').click();
  assert.deepEqual(await f.writes(),[{p_chat_id:C,p_topic_id:T,p_mode:'disabled',p_expected_revision:4}]);
  assert.deepEqual(await f.page.evaluate(()=>window.parentWrites),[]);
});

test('an owned successful raw snapshot without a general row still offers implicit general',async t=>{
  const f=await fixture(t,{input:{selectedTopicId:null,topics:[]}});await f.menu();
  assert.equal(await f.page.getByRole('button',{name:'Уведомления темы',exact:true}).count(),1);
  await f.topic();await f.ready([]);await f.page.locator('input[value=disabled]').click();
  assert.deepEqual(await f.writes(),[{p_chat_id:C,p_topic_id:null,p_mode:'disabled',p_expected_revision:0}]);
});

for(const selectedTopicId of [null,G])test(`Window canonical general ${selectedTopicId===null?'null':'alias'} mounts one literal null CAS scope`,async t=>{
  const f=await fixture(t,{input:{selectedTopicId}});await f.menu();await f.topic();await f.ready([]);
  assert.deepEqual(await f.page.evaluate(()=>({topic:window.scope.topicId,key:window.scope.canonicalScopeKey})),{topic:null,key:'general'});
  assert.equal(await f.page.locator('input[value=inherit]').isChecked(),true);
  await f.page.locator('input[value=disabled]').click();
  assert.deepEqual(await f.writes(),[{p_chat_id:C,p_topic_id:null,p_mode:'disabled',p_expected_revision:0}]);
});

for(const [name,input] of [
  ['unknown read',{scopeKnown:false}],['foreign snapshot',{snapshotUserId:OTHER}],['old-epoch snapshot',{snapshotEpoch:0}],
  ['foreign-chat snapshot',{snapshotChatId:C2}],['unknown selection',{selectedTopicId:'40000000-0000-4000-8000-999999999999'}],
  ['foreign topic',{topics:[{id:T,chat_id:C2,name:'Foreign',is_general:false,archived:false}]}],
  ['archived topic',{topics:[{id:T,chat_id:C,name:'Archived',is_general:false,archived:true}]}],
  ['archived general',{selectedTopicId:null,topics:[{id:G,chat_id:C,name:'Archived',is_general:true,archived:true}]}],
  ['foreign chat',{chat:{id:C2,type:'group',is_forum:true,name:'Other'}}],
  ['private chat',{chat:{id:C,type:'private',is_forum:false,name:'Private'}}],
])test(`menu refuses ${name} without acquiring preference reads`,async t=>{
  const f=await fixture(t,{input});await f.menu();
  assert.equal(await f.page.getByRole('button',{name:'Уведомления темы',exact:true}).count(),0);
  assert.equal(await f.page.evaluate(()=>window.requests.length),0);
});

test("confirmed CAS conflict and retry remain reachable without overwriting server state",async t=>{
  const f=await fixture(t);await f.menu();await f.topic();await f.ready();
  await f.page.locator('input[value=enabled]').click();assert.equal(await f.page.locator('input[value=disabled]').isChecked(),true);
  assert.equal(await f.page.locator('input[value=enabled]').isDisabled(),true);
  await f.answer('topic_notification_preference_set',{status:'conflict',scope_key:T,mode:'inherit',revision:9});
  await f.page.waitForFunction(()=>document.querySelector('input[value=inherit]')?.checked);
  assert.equal((await f.writes()).length,1);assert.match(await f.page.getByRole('status').innerText(),/другом устройстве/);
  await f.page.locator('input[value=enabled]').click();assert.equal((await f.writes())[1].p_expected_revision,9);
  await f.answer('topic_notification_preference_set',null,{code:'42501',message:'PRIVATE_ERROR_CANARY'});
  await f.page.getByRole('button',{name:'Повторить',exact:true}).click();
  assert.equal((await f.writes()).length,2);
  await f.answer('topic_notification_preferences_read',[{scope_key:T,mode:'disabled',revision:10}]);
  await f.page.waitForFunction(()=>document.querySelector('input[value=disabled]')?.checked);
  assert.equal((await f.page.locator('body').innerText()).includes('PRIVATE_ERROR_CANARY'),false);
  await f.page.getByRole('menu').getByRole('button',{name:'Назад',exact:true}).click();
  assert.equal(await f.page.locator('input[type=radio]').count(),0);
  assert.equal(await f.page.getByRole('button',{name:'Уведомления темы',exact:true}).count(),1);
  await f.page.keyboard.press('Escape');assert.equal(await f.page.getByRole('menu').count(),0);
});

for(const actor of [OTHER,U])test(`account/epoch replacement closes menu and captured callback for ${actor===U?'same UID':'other UID'}`,async t=>{
  const f=await fixture(t);await f.menu();await f.topic();await f.ready();
  await f.page.evaluate(({actor})=>{
    const input=document.querySelector('input[value=enabled]'),key=Object.keys(input).find(k=>k.startsWith('__reactProps'));
    const callback=input[key].onChange;window.owner(actor,2);callback({target:{checked:true,value:'enabled'}});
  },{actor});
  assert.equal((await f.writes()).length,0);assert.equal(await f.page.getByRole('menu').count(),0);
});

test("scope change retires held topic ACK and reopening targets only the new canonical scope",async t=>{
  const f=await fixture(t);await f.menu();await f.topic();await f.ready();await f.page.locator('input[value=enabled]').click();
  await f.page.evaluate(()=>window.render({selectedTopicId:null}));assert.equal(await f.page.getByRole('menu').count(),0);
  await f.answer('topic_notification_preference_set',{status:'applied',scope_key:T,mode:'enabled',revision:8});
  await f.menu();await f.topic();await f.ready([{scope_key:'general',mode:'disabled',revision:3}]);
  assert.equal(await f.page.locator('input[value=disabled]').isChecked(),true);await f.page.locator('input[value=enabled]').click();
  assert.deepEqual((await f.writes())[1],{p_chat_id:C,p_topic_id:null,p_mode:'enabled',p_expected_revision:3});
});

test("Header rejects stale caller owner even if current chat ID still matches",async t=>{
  const f=await fixture(t,{input:{heldScope:{userId:OTHER,accountEpoch:1,chatId:C,topicId:T,canonicalScopeKey:T,title:'Stale'}}});
  await f.menu();assert.equal(await f.page.getByRole('button',{name:'Уведомления темы',exact:true}).count(),0);
});

test('diagnostic actual menu pixels fit both themes at 1440 and 390 without launch acceptance',async t=>{
  const assets=resolve(kub,'dist/public/assets'),names=readdirSync(assets).filter(n=>/^index-.*\.css$/.test(n));
  assert.equal(names.length,1,'BUILD_THE_CURRENT_WEB_CSS_FIRST');
  let css=readFileSync(join(assets,names[0]),'utf8');
  const fontDir=resolve(kub,'public/fonts/inter');
  for(const file of readdirSync(fontDir).filter(n=>n.endsWith('.woff2'))){
    const url='/fonts/inter/'+file;assert.ok(css.includes(url),'ACTUAL_FONT_RESOURCE_REQUIRED');
    css=css.replaceAll(url,'data:font/woff2;base64,'+readFileSync(join(fontDir,file)).toString('base64'));
  }
  for(const width of [390,1440])for(const theme of ['light','dark']){
    const f=await fixture(t,{input:{selectedTopicId:null,topics:[]}});
    await f.page.setViewportSize({width,height:width===390?844:900});
    await f.page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
    await f.page.evaluate(({theme,width})=>{document.documentElement.className=theme;document.documentElement.style.setProperty('--kub-safe-bottom',width===390?'34px':'0px');},{theme,width});
    await f.page.addStyleTag({content:css});
    const widths=await f.page.evaluate(async()=>{await document.fonts.load('14px Inter','Уведомления темы');await document.fonts.ready;
      const c=document.createElement('canvas').getContext('2d');c.font='14px Inter, monospace';const loaded=c.measureText('Уведомления темы 123').width;
      c.font='14px monospace';return[loaded,c.measureText('Уведомления темы 123').width];});
    assert.notEqual(widths[0],widths[1],'REAL_INTER_MUST_DIFFER_FROM_ITS_FALLBACK');
    await f.page.evaluate(()=>window.store.setState({parentMuted:true}));
    await f.menu();await f.topic();await f.ready([{scope_key:'general',mode:'enabled',revision:4}]);
    if(theme==='dark')await f.page.locator('input[value=disabled]').click();
    await f.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const boxes=await f.page.getByRole('menu').locator('fieldset label').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,overflow:n.scrollWidth>n.clientWidth+1})));
    assert.equal(boxes.length,3);assert.ok(boxes.every(b=>b.height>=44&&b.width>100&&!b.overflow));
    const menu=await f.page.getByRole('menu').boundingBox();assert.ok(menu&&menu.x>=0&&menu.x+menu.width<=width+1&&menu.y>=0&&menu.y+menu.height<=(width===390?844:900));
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.KUB_QA_VISUAL_OUT){mkdirSync(process.env.KUB_QA_VISUAL_OUT,{recursive:true});await f.page.screenshot({path:join(process.env.KUB_QA_VISUAL_OUT,`${width}-${theme}.png`)});}
  }
});

for(const control of [
  {name:'Window verified-read guard',change:{window:['    snapshot);','    snapshot ?? {userId, accountEpoch, chatId, topics: []});']},input:{scopeKnown:false,selectedTopicId:null},expected:0},
  {name:'Window Header scope wiring',change:{window:['topicNotificationScope={topicNotificationScope}','']},input:{},expected:1},
  {name:'Header owner fence',change:{header:['topicNotificationScope?.userId === currentUser?.id && topicNotificationScope?.accountEpoch === accountEpoch','true']},
    input:{heldScope:{userId:OTHER,accountEpoch:1,chatId:C,topicId:T,canonicalScopeKey:T,title:'Stale'}},expected:0},
])test(`literal compiled omission exposes ${control.name}`,async t=>{
  const normal=await fixture(t,{input:control.input});await normal.menu();assert.equal(await normal.page.getByRole('button',{name:'Уведомления темы',exact:true}).count(),control.expected);
  const mutant=await fixture(t,{input:control.input,code:await compile(control.change)});await mutant.menu();
  const actual=await mutant.page.getByRole('button',{name:'Уведомления темы',exact:true}).count();
  assert.throws(()=>assert.equal(actual,control.expected),assert.AssertionError);
});
