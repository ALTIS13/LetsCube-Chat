import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const kubRoot = fileURLToPath(new URL("../../artifacts/kub/", import.meta.url));
const sourceRoot = resolve(kubRoot, "src");
const kubRequire = createRequire(resolve(kubRoot, "package.json"));
const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");
const { chromium } = kubRequire("@playwright/test");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CHAT = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";
const TASK = "55555555-5555-4555-8555-555555555555";
const INVITE = "66666666-6666-4666-8666-666666666666";
let browser;
let bundle;

// Real React, NotificationBell, useNotifications, safeOpenChat and invite/read
// helpers; only provider and unrelated presentation/platform ports are fictional.
const stubs = new Map([
  ["components/kub/index.ts", `import React from 'react';
    export function KubIcon() {return <span/>;}
    export function KubTooltip({children}) {return children;}`],
  ["hooks/useMediaObjectUrl.ts", "export function useAvatarMediaUrl() {return null;}"],
  ["hooks/useRole.ts", "export function usePermissionAccess() {return {hasPermission:() => false};}"],
  ["hooks/useCallSound.ts", "export function playNotificationSoundFor() {}"],
  ["hooks/useOwnPresence.ts", "export function ownAlertPolicySnapshot() {return 'wait';}"],
  ["lib/errors.ts", "export function mapPgError() {return 'fictional refusal';}"],
  ["lib/dev/instrumentation.ts", "export function bumpFetch() {} export function registerChannel() {} export function unregisterChannel() {}"],
  ["lib/chatEvents.ts", "export function dispatchChatsRefresh() {window.effects.push({type:'refresh'});}"],
  ["lib/appDialogs.ts", "export function showAppAlert() {window.effects.push({type:'alert'});}"],
  ["lib/platform/capabilities.ts", "export function isNativeAndroid() {return false;}"],
  ["lib/platform/nativePush.ts", "export async function closeNativeChatNotification() {throw Error('unexpected native operation');}"],
  ["store/app.store.ts", `import {useSyncExternalStore} from 'react';
    const listeners=new Set();
    export function useAppStore(selector) {
      return useSyncExternalStore(fn => {listeners.add(fn); return () => listeners.delete(fn);},
        () => selector(window.state));
    }
    useAppStore.getState=() => window.state;
    useAppStore.setState=patch => {window.state={...window.state,...patch}; for(const fn of listeners) fn();};`],
  ["lib/supabase/client.ts", `
    async function held(name) {
      if(!window.holds.delete(name)) return;
      await new Promise(resolve => window.gates.set(name,resolve)); window.gates.delete(name);
    }
    const client={
      from(table) {
        if(!['notifications','chat_members'].includes(table)) throw Error('unexpected fixture table');
        const filters={}; let columns='*'; let ids;
        const query={select(value){columns=value;return this;}, eq(k,v){filters[k]=v;return this;},
          order(){return this;}, in(k,v){if(k!=='id') throw Error('unexpected filter');ids=v;return this;},
          limit(){return execute();}, maybeSingle(){return execute();},
          then(ok,bad){return execute().then(ok,bad);}};
        async function execute() {
          const phase=table==='chat_members' ? 'access' : columns==='*' ? 'refresh' : 'confirm';
          window.calls.push({phase}); await held(phase);
          if(table==='chat_members') return {data:window.denyAccess ? null : {chat_id:filters.chat_id},error:null};
          return {data:window.rows.filter(row => row.user_id===filters.user_id && (!ids || ids.includes(row.id))),error:null};
        }
        return query;
      },
      async rpc(name,args) {
        if(!['notifications_mark_read','notifications_mark_chat_messages_read','notifications_mark_all_read',
          'group_invite_accept','group_invite_decline'].includes(name)) throw Error('unexpected fixture RPC');
        const owner=window.state.currentUser?.id;
        window.calls.push({phase:'rpc-start',name});
        await held(name.startsWith('group_invite_') ? 'invite' : 'read');
        window.calls.push({phase:'rpc-done',name});
        window.lifecycle.push('rpc-finished');
        if(name.startsWith('group_invite_')) return {data:name==='group_invite_accept' ? '${CHAT}' : {status:'declined'},
          error:window.inviteError ? {code:'42501'} : null};
        for(const row of window.rows) if(row.user_id===owner &&
          (name==='notifications_mark_all_read' || row.id===args.p_id || row.payload.chat_id===args.p_chat_id))
          row.read_at='2026-10-11T00:01:00.000Z';
        return {data:null,error:null};
      },
      channel(){return {on(){return this;},subscribe(fn){fn('SUBSCRIBED');return this;}};},
      removeChannel() {},
    };
    export function createClient(){return client;}`],
]);

async function compile(change) {
  let replacements = 0;
  const result = await build({
    write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": sourceRoot }, define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "fictional-boundaries", setup(plugin) {
      plugin.onResolve({ filter: /^wouter$/ }, () => ({path:"wouter",namespace:"fixture"}));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({contents:
        "export function useLocation(){return ['/',path => window.effects.push({type:'route',path})];}"}));
      plugin.onLoad({ filter: /\.[tj]sx?$/ }, args => {
        const relative = args.path.slice(sourceRoot.length + 1).replaceAll("\\", "/");
        if (stubs.has(relative)) return {contents:stubs.get(relative),loader:"tsx",resolveDir:sourceRoot};
        if (relative === "components/sidebar/NotificationBell.tsx") {
          let source = readFileSync(args.path,"utf8").replaceAll("\r\n","\n");
          if(change) {
            assert.equal(source.split(change[0]).length-1,1,"compiled omission must match once");
            replacements++; source=source.replace(change[0],change[1]);
          }
          source=source.replace('mountedRef.current = false;',
            "window.lifecycle.push('bell-retired'); mountedRef.current = false;");
          // Test-only access to the real scheduling helper; no production export.
          source+='\nwindow.probeScheduleNotificationMessageJump= scheduleNotificationMessageJump;';
          return {contents:source,loader:"tsx",resolveDir:resolve(sourceRoot,"components/sidebar")};
        }
      });
    }}],
    stdin: {loader:"tsx",resolveDir:kubRoot,contents:`
      import React, {useEffect, useLayoutEffect, useState} from 'react';
      import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {useAppStore} from './src/store/app.store.ts';
      import {NotificationBell} from './src/components/sidebar/NotificationBell.tsx';
      window.effects=[]; window.calls=[]; window.holds=new Set(); window.gates=new Map(); window.jumps=new Map();
      window.lifecycle=[];
      window.state={currentUser:{id:'${A}'},accountEpoch:1,mutedChatIds:[],selectedChatId:null,
        chats:[{id:'${CHAT}'},{id:'manual-chat'}],
        setSelectedChatId(id){window.effects.push({type:'selected',id});useAppStore.setState({selectedChatId:id});},
        setChats(chats){useAppStore.setState({chats});}};
      const timeout=window.setTimeout.bind(window); let timerId=-1;
      window.setTimeout=(fn,delay,...args) => delay===150 ? (window.jumps.set(timerId,() => fn(...args)),timerId--)
        : timeout(fn,delay,...args);
      window.addEventListener('kub:chat-message-jump',e => window.effects.push({type:'jump',...e.detail}));
      const root=createRoot(document.getElementById('root'));
      function RemovalParent() {
        const [present,setPresent]=useState(true);
        window.removeBell=() => setPresent(false);
        useLayoutEffect(() => {
          if(present) return;
          window.lifecycle.push(document.querySelector('[data-testid="notification-bell-button"]')
            ? 'layout-dom-present' : 'layout-dom-absent');
          window.gates.get(window.removalPhase)?.();
          // Real layout work exceeds React's cooperative task budget; no
          // scheduler/effect mock and no forced passive flush on removal.
          const until=performance.now()+12;
          while(performance.now()<until) {}
        },[present]);
        useEffect(() => {if(!present) window.lifecycle.push('parent-passive');},[present]);
        return present ? <NotificationBell/> : null;
      }
      flushSync(() => root.render(window.parentRemoval ? <RemovalParent/> : <NotificationBell/>));
      window.retire=kind => {
        if(kind==='unmount') {flushSync(() => root.unmount());window.detached=true;return;}
        const patch={currentUser:kind==='logout' ? null : {id:kind==='account' ? '${B}' : '${A}'},
          accountEpoch:window.state.accountEpoch+1};
        if(kind==='epoch-before-render') window.state={...window.state,...patch};
        else flushSync(() => useAppStore.setState(patch));
      };
      window.manualNavigate=() => flushSync(() => useAppStore.setState({selectedChatId:'manual-chat'}));
      window.runJumps=() => {const pending=[...window.jumps.values()];window.jumps.clear();for(const fn of pending) fn();};
      window.unmount=() => {if(!window.detached) root.unmount();};
    `},
  });
  if (change) assert.equal(replacements,1,"changed component actually compiled");
  return result.outputFiles[0].text;
}

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS,"0","offline fixture requires explicit mutation prohibition");
  bundle=await compile(); browser=await chromium.launch({headless:true});
});
test.after(async () => {await browser?.close();});

function row(kind="task_assigned",extra={}) {
  return {id:"fictional-notice",user_id:A,kind,read_at:null,created_at:"2026-10-11T00:00:00.000Z",
    payload:{task_id:TASK,title:"Fictional task",chat_id:CHAT,message_id:MESSAGE,
      sender_id:B,sender_kind:"user",chat_type:"private",sender_name:"Fictional sender",preview:"Fictional preview",
      invite_id:INVITE,status:"pending",chat_name:"Fictional group"},...extra};
}

async function fixture(rows=[row()],code=bundle,parentRemoval=false) {
  const context=await browser.newContext({serviceWorkers:"block"});
  const page=await context.newPage(); const errors=[]; const network=[];
  page.setDefaultTimeout(3000);
  page.on("pageerror",e => errors.push(e.message));
  await page.route("**/*",route => {network.push("blocked request");return route.abort();});
  await page.setContent('<div id="root"></div>');
  await page.evaluate(({rows,parentRemoval}) => {window.rows=rows;window.parentRemoval=parentRemoval;},{rows,parentRemoval});
  await page.addScriptTag({content:code});
  const drain=() => page.evaluate(async () => {
    for(let i=0;i<30;i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve,0));
  });
  await drain();
  await page.getByTestId("notification-bell-button").click(); await drain();
  return {page,drain,
    async hold(phase){await page.evaluate(phase => window.holds.add(phase),phase);},
    async click(kind="task",action){
      if(action) await page.getByRole("button",{name:action==="accept" ? "Принять" : "Отклонить",exact:true}).click();
      else await page.getByTestId(kind==="message" ? "notification-message-group" : "notification-item").first().click();
      await drain();
    },
    async gated(phase){assert.equal(await page.evaluate(phase => window.gates.has(phase),phase),true,"real handler reached held boundary");},
    async release(phase){await page.evaluate(phase => window.gates.get(phase)?.(),phase);await drain();},
    async retire(kind){await page.evaluate(kind => window.retire(kind),kind);await drain();},
    async effects(){return page.evaluate(() => window.effects);},
    async close(){
      await page.evaluate(async () => {window.unmount();for(const release of window.gates.values()) release();
        window.jumps.clear();for(let i=0;i<30;i++) await Promise.resolve();});
      await drain(); await context.close();
      assert.deepEqual(errors,[],"no page errors"); assert.deepEqual(network,[],"no network requests");
    },
  };
}

async function heldRead(kind,retirement,code=bundle) {
  const f=await fixture([row(kind==="message" ? "message" : "task_assigned")],code);
  try {
    await f.hold("read");await f.click(kind);await f.gated("read");await f.retire(retirement);
    await f.release("read");
    assert.deepEqual(await f.effects(),[],"retired read action must not navigate/select/toast/jump");
    assert.equal(await f.page.evaluate(() => window.jumps.size),0,"retired action must not schedule jump");
  } finally {await f.close();}
}

for(const kind of ["task","message"]) for(const retirement of ["logout","account","epoch-before-render","unmount"])
  test(`held ${kind} read retires on ${retirement}`,() => heldRead(kind,retirement));

async function inviteBoundary(action,phase,retirement,error=false,code=bundle) {
  const f=await fixture([row("group_invite")],code);
  try {
    await f.page.evaluate(error => {window.inviteError=error;},error);
    await f.hold(phase);await f.click("invite",action);await f.gated(phase);
    await f.retire(retirement);
    const before=await f.effects();
    const controlsBefore=await f.page.getByRole("button",{name:"Принять",exact:true}).count();
    const callsBefore=await f.page.evaluate(() => window.calls.length);
    await f.release(phase);
    assert.deepEqual(await f.effects(),before,"retired invite must not continue UI/toast/navigation/refresh dispatch");
    assert.equal(await f.page.getByRole("button",{name:"Принять",exact:true}).count(),controlsBefore,
      "retired invite result must not change the displayed invite status");
    const tail=await f.page.evaluate(n => window.calls.slice(n),callsBefore);
    assert.deepEqual(tail.filter(call => call.phase!=="rpc-done"),[],"retired invite must not start another request");
    assert.equal(await f.page.evaluate(action => window.calls.filter(call =>
      call.phase==='rpc-done' && call.name==='group_invite_'+action).length,action),1,"completed invite RPC is retained exactly once");
  } finally {await f.close();}
}

for(const action of ["accept","decline"]) for(const phase of ["invite","read","refresh"])
  test(`held ${action} ${phase} retires on epoch`,() => inviteBoundary(action,phase,"epoch-before-render"));
for(const action of ["accept","decline"]) for(const retirement of ["logout","account","unmount"])
  test(`held ${action} RPC retires on ${retirement}`,() => inviteBoundary(action,"invite",retirement));
for(const action of ["accept","decline"])
  test(`retired ${action} RPC error has no alert`,() => inviteBoundary(action,"invite","epoch-before-render",true));

async function accessRetirement(code=bundle,kind="message") {
  const notice=row(kind==="message" ? "message" : kind==="chat" ? "chat_added" : kind==="single-message" ? "fictional_notice" : "group_invite");
  if(kind==="accepted") notice.payload.status="accepted";
  const f=await fixture([notice],code);
  try {
    await f.hold("access");await f.click(kind);await f.gated("access");
    await f.retire("epoch-before-render");await f.release("access");
    assert.deepEqual(await f.effects(),[],"safeOpenChat must receive the action lifetime during its await");
  } finally {await f.close();}
}
test("same person new session during actual safeOpenChat access",() => accessRetirement());
for(const kind of ["chat","single-message","accepted"])
  test(`same session retirement inside ${kind} safeOpenChat`,() => accessRetirement(bundle,kind));
test("accept retires inside safeOpenChat access",() => inviteBoundary("accept","access","epoch-before-render"));

async function jumpRetirement(retirement,code=bundle) {
  const f=await fixture([row("message")],code);
  try {
    await f.click("message");
    assert.equal(await f.page.evaluate(() => window.jumps.size),1,"current action schedules exactly one jump");
    if(retirement==="manual") await f.page.evaluate(() => window.manualNavigate());
    else await f.retire(retirement);
    await f.page.evaluate(() => window.runJumps());
    assert.deepEqual((await f.effects()).filter(e => e.type==="jump"),[],"retired/manual navigation must suppress stale jump");
  } finally {await f.close();}
}
for(const retirement of ["logout","account","epoch-before-render","unmount","manual"])
  test(`delayed jump retires on ${retirement}`,() => jumpRetirement(retirement));

async function replacedAction(first,code=bundle) {
  const f=await fixture([row(first==="message" ? "message" : first==="task" ? "task_assigned" : "group_invite"),
    row("task_assigned",{id:"replacement-notice",payload:{task_id:"replacement-task",title:"Replacement"}})],code);
  try {
    await f.hold(first==="accept" || first==="decline" ? "invite" : "read");
    await f.click(first,first==="accept" || first==="decline" ? first : undefined);
    const phase=first==="accept" || first==="decline" ? "invite" : "read";await f.gated(phase);
    await f.page.getByTestId("notification-item").filter({hasText:"Replacement"}).click();await f.drain();
    assert.deepEqual((await f.effects()).filter(e => e.type==="route"),[{type:"route",path:"/tasks?task=replacement-task"}],"replacement action positive control");
    const before=await f.effects();await f.release(phase);
    assert.deepEqual(await f.effects(),before,"new notification action retires the previous continuation");
  } finally {await f.close();}
}
for(const first of ["task","message","accept","decline"])
  test(`new notification action replaces held ${first}`,() => replacedAction(first));

test("live task/message/invite actions retain literal positive behavior",async () => {
  for(const kind of ["task","message","accept","decline"]) {
    const f=await fixture([row(kind==="message" ? "message" : kind==="task" ? "task_assigned" : "group_invite")]);
    try {
      await f.click(kind,kind==="accept" || kind==="decline" ? kind : undefined);
      await f.page.evaluate(() => window.runJumps());
      const effects=await f.effects();
      if(kind==="task") assert.deepEqual(effects,[{type:"route",path:"/tasks?task=55555555-5555-4555-8555-555555555555"}]);
      if(kind==="message") assert.deepEqual(effects,[{type:"selected",id:CHAT},
        {type:"route",path:"/chat/33333333-3333-4333-8333-333333333333/m/44444444-4444-4444-8444-444444444444"},
        {type:"jump",chatId:CHAT,messageId:MESSAGE}]);
      if(kind==="accept") assert.deepEqual(effects,[{type:"refresh"},{type:"selected",id:CHAT},
        {type:"route",path:"/chat/33333333-3333-4333-8333-333333333333"}]);
      if(kind==="decline") assert.deepEqual(effects,[]);
      if(kind==="accept" || kind==="decline") assert.equal(await f.page.getByRole("button",{name:"Принять",exact:true}).count(),0,"completed invite updates local status");
    } finally {await f.close();}
  }
});

async function schedulingGuard(reason,code=bundle) {
  const f=await fixture([row("message")],code);
  try {
    await f.page.evaluate(({reason,chat,message}) => {
      window.state.selectedChatId=reason==='selection' ? 'manual-chat' : chat;
      window.probeScheduleNotificationMessageJump(chat,message,() => reason!=='owner');
    },{reason,chat:CHAT,message:MESSAGE});
    assert.equal(await f.page.evaluate(() => window.jumps.size),0,"expired/wrong-selection action must not schedule a jump");
  } finally {await f.close();}
}
for(const reason of ["owner","selection"])
  test(`jump scheduling refuses ${reason}`,() => schedulingGuard(reason));

async function replacedJump(code=bundle) {
  const f=await fixture([row("message"),row("task_assigned",{id:"replacement-notice",payload:{task_id:"replacement-task",title:"Replacement"}})],code);
  try {
    await f.click("message");
    assert.equal(await f.page.evaluate(() => window.jumps.size),1,"original jump actually scheduled");
    await f.page.getByTestId("notification-bell-button").click();await f.drain();
    await f.hold("read");await f.page.getByTestId("notification-item").click();await f.drain();await f.gated("read");
    await f.page.evaluate(() => window.runJumps());
    assert.deepEqual((await f.effects()).filter(e => e.type==="jump"),[],"new pending action retires the old jump immediately");
  } finally {await f.close();}
}
test("new pending action retires an already scheduled jump",() => replacedJump());

test("owner change resets pending invite UI without replaying its RPC",async () => {
  const f=await fixture([row("group_invite")]);
  try {
    await f.hold("invite");await f.click("invite","accept");await f.gated("invite");
    assert.equal(await f.page.getByRole("button",{name:"Принять",exact:true}).isDisabled(),true,"old invite is busy");
    await f.retire("epoch");
    assert.equal(await f.page.getByRole("button",{name:"Принять",exact:true}).isDisabled(),false,"new owner is not blocked by old invite");
    await f.release("invite");
    assert.equal(await f.page.getByRole("button",{name:"Принять",exact:true}).count(),1,"late result cannot set successor status");
    assert.equal(await f.page.evaluate(() => window.calls.filter(c => c.name==='group_invite_accept' && c.phase==='rpc-start').length),1,"no RPC replay");
    assert.deepEqual(await f.effects(),[],"no late invite UI continuation");
  } finally {await f.close();}
});

const omissions = [
  ["session epoch",[" && state.accountEpoch === accountEpoch",""],code => heldRead("task","epoch-before-render",code)],
  ["unmount retirement",["mountedRef.current = false;\n      actionRevisionRef.current++;","mountedRef.current = true;"],code => heldRead("task","unmount",code)],
  ["action revision",["isOwner() && actionRevisionRef.current === revision","isOwner()"],code => replacedAction("task",code)],
  ["single read continuation",["if (!item.read_at) await markRead(item.id);\n    if (!canCommit()) return;","if (!item.read_at) await markRead(item.id);"],code => heldRead("task","epoch-before-render",code)],
  ["group read continuation",["await markMessageNotificationsForChatRead(entry.chatId);\n    if (!canCommit()) return;","await markMessageNotificationsForChatRead(entry.chatId);"],code => {
    return heldGroupPanel(code);
  }],
  ["safeOpenChat canCommit",["safeOpenChat(entry.chatId, { canCommit })","safeOpenChat(entry.chatId)"],code => accessRetirement(code)],
  ["accept RPC continuation",["await acceptGroupInvite(supabase, payload.invite_id);\n    if (!canCommit()) return;","await acceptGroupInvite(supabase, payload.invite_id);"],code => inviteBoundary("accept","invite","epoch-before-render",true,code)],
  ["decline RPC continuation",["await declineGroupInvite(supabase, payload.invite_id);\n    if (!canCommit()) return;","await declineGroupInvite(supabase, payload.invite_id);"],code => inviteBoundary("decline","invite","epoch-before-render",true,code)],
  ["accept read continuation",["await markRead(item.id);\n    if (!canCommit()) return;\n    dispatchChatsRefresh","await markRead(item.id);\n    dispatchChatsRefresh"],code => inviteBoundary("accept","read","epoch-before-render",false,code)],
  ["accept refresh continuation",["await refresh();\n    if (!canCommit()) return;\n    const opened = await safeOpenChat(result.data, { canCommit });\n    if (!canCommit()) return;",
    "await refresh();\n    const opened = await safeOpenChat(result.data);"],code => inviteBoundary("accept","refresh","epoch-before-render",false,code)],
  ["single safeOpenChat canCommit",["safeOpenChat(target.chatId, { canCommit })","safeOpenChat(target.chatId)"],code => accessRetirement(code,"chat")],
  ["accepted invite safeOpenChat canCommit",["safeOpenChat(chatId, { canCommit })","safeOpenChat(chatId)"],code => accessRetirement(code,"accepted")],
  ["accept safeOpenChat canCommit",["safeOpenChat(result.data, { canCommit })","safeOpenChat(result.data)"],code => inviteBoundary("accept","access","epoch-before-render",false,code)],
  ["decline read continuation",["await markRead(item.id);\n    if (!canCommit()) return;\n    await refresh();","await markRead(item.id);\n    await refresh();"],code => replacedInviteRead(code)],
  ["schedule owner guard",["if (!canCommit() || useAppStore.getState().selectedChatId !== chatId) return;","if (useAppStore.getState().selectedChatId !== chatId) return;"],code => schedulingGuard("owner",code)],
  ["schedule selection guard",["if (!canCommit() || useAppStore.getState().selectedChatId !== chatId) return;","if (!canCommit()) return;"],code => schedulingGuard("selection",code)],
  ["jump owner guard",["if (canCommit() && useAppStore.getState().selectedChatId === chatId)","if (useAppStore.getState().selectedChatId === chatId)"],code => jumpRetirement("epoch-before-render",code)],
  ["jump selection guard",["if (canCommit() && useAppStore.getState().selectedChatId === chatId)","if (canCommit())"],code => jumpRetirement("manual",code)],
];

// These oracles observe panel/read boundaries that later safeOpenChat guards
// can otherwise mask; the omission must fail behavior, not mutation setup.
async function heldGroupPanel(code=bundle) {
  const f=await fixture([row("message")],code);
  try {
    await f.hold("read");await f.click("message");await f.gated("read");
    await f.retire("epoch-before-render");await f.release("read");
    assert.equal(await f.page.getByTestId("notification-panel").count(),1,"retired group click must not close the panel");
  } finally {await f.close();}
}
test("retired grouped read leaves panel alone",() => heldGroupPanel());

async function replacedInviteRead(code=bundle) {
  const f=await fixture([row("group_invite"),row("task_assigned",{id:"replacement-notice",payload:{task_id:"replacement-task",title:"Replacement"}})],code);
  try {
    await f.hold("read");await f.click("invite","decline");await f.gated("read");
    await f.page.getByTestId("notification-item").filter({hasText:"Replacement"}).click();await f.drain();
    const before=await f.page.evaluate(() => window.calls.filter(c => c.phase==='refresh').length);
    await f.release("read");
    assert.equal(await f.page.evaluate(() => window.calls.filter(c => c.phase==='refresh').length),before,
      "retired decline must not start refresh after the held read");
  } finally {await f.close();}
}
test("replacement retires decline after held read",() => replacedInviteRead());

for(const [name,change,oracle] of omissions) test(`compiled omission rejected: ${name}`,async () => {
  const code=await compile(change);
  await assert.rejects(() => oracle(code),error => error.code==='ERR_ASSERTION'
    && !error.message.includes('held boundary'),"actual mounted literal oracle must reject the compiled omission");
});

async function parentRemovalBoundary(action,code=bundle) {
  const phase=action==='task' || action==='message' ? 'read' : 'invite';
  const f=await fixture([row(action==='task' ? 'task_assigned' : action==='message' ? 'message' : 'group_invite')],code,true);
  try {
    await f.page.evaluate(phase => {window.removalPhase=phase;window.inviteError=true;},phase);
    await f.hold(phase);await f.click(action,action==='accept' || action==='decline' ? action : undefined);await f.gated(phase);
    await f.page.evaluate(() => {window.lifecycle=[];window.removeBell();});
    await f.page.waitForFunction(() => window.lifecycle.includes('parent-passive'));
    await f.drain();
    const lifecycle=await f.page.evaluate(() => window.lifecycle);
    assert.equal(lifecycle.includes('layout-dom-present'),false,'real removal commit must remove Bell DOM');
    assert.equal(lifecycle.includes('layout-dom-absent'),true,'layout observer must observe actual DOM absence');
    assert.equal(lifecycle.includes('rpc-finished'),true,'held provider completion must really run');
    assert.equal(lifecycle.includes('bell-retired'),true,'actual Bell cleanup must be observed');
    assert.deepEqual(await f.effects(),[],`parent removal must suppress late UI continuation; order=${lifecycle.join(',')}`);
    assert.deepEqual(lifecycle,['bell-retired','layout-dom-absent','rpc-finished','parent-passive'],
      'layout retirement must precede provider continuation without flushing passive effects');
    assert.equal(await f.page.evaluate(() => window.jumps.size),0,'parent removal must not schedule a late jump');
    return lifecycle;
  } finally {await f.close();}
}

for(const action of ['task','message','accept','decline'])
  test(`async parent removal retires held ${action} before passive cleanup`,() => parentRemovalBoundary(action));

test('compiled passive cleanup timing omission reproduces actual removal window',async () => {
  const code=await compile(['useLayoutEffect(() => {\n    mountedRef.current = true;',
    'useEffect(() => {\n    mountedRef.current = true;']);
  await assert.rejects(() => parentRemovalBoundary('task',code),error => error.code==='ERR_ASSERTION'
    && error.message.includes('order=layout-dom-absent,rpc-finished,bell-retired,parent-passive'),
    'real asynchronous removal must reject passive retirement, not mutation setup');
});
