import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import path from "node:path";

const require = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const { build } = createRequire(require.resolve("vite"))("esbuild");
const root = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const playerFile = root + "/components/chat/ChatMediaPlayback.tsx";
const source = readFileSync(playerFile, "utf8");
const producerSource = readFileSync(root + "/hooks/useChats.ts", "utf8");
const tree = ts.createSourceFile("useChats.ts", producerSource, ts.ScriptTarget.Latest, true);
let producer;
let membershipProducer;
let membershipGrant;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "handleMessageUpdate") producer = node.initializer.getText(tree);
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "on" && node.arguments.length >= 3) {
    const filter = node.arguments[1].getText(tree);
    if (filter.includes('event: "DELETE"') && filter.includes('table: "chat_members"') && filter.includes('user_id=eq.${userId}')) membershipProducer = node.arguments[2].getText(tree);
    if (filter.includes('event: "INSERT"') && filter.includes('table: "chat_members"') && filter.includes('user_id=eq.${userId}')) membershipGrant = node.arguments[2].getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(producer, "actual closed-chat update producer found");
assert.ok(membershipProducer, "actual own membership DELETE producer found");
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function mounted(changed = source) {
  const bundle = await build({ write: false, bundle: true, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": root }, plugins: [{ name: "controlled-boundaries", setup(plugin) {
      plugin.onLoad({ filter: /ChatMediaPlayback\.tsx$/ }, () => ({ contents: changed.replace(
        'const value = useMemo<ChatMediaPlaybackContextValue>',
        '(window as any).__retiredCount = () => retiredItemsRef.current.size;\n  (window as any).__registeredIds = (chatId: string) => (registeredRef.current.playlists[chatId] ?? []).map(item => item.id);\n  (window as any).__revokedCount = () => accessRevokedChatsRef.current.size;\n  const value = useMemo<ChatMediaPlaybackContextValue>'), loader: "tsx" }));
      plugin.onResolve({ filter: /^@\/store\/app.store$/ }, () => ({ path: "store", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
        import {useSyncExternalStore} from 'react';
        let state={currentUser:{id:'owner-a'},accountEpoch:1,selectedChatId:'other',chats:[],messages:{}};
        const listeners=new Set();
        export const useAppStore=Object.assign(selector=>useSyncExternalStore(useAppStore.subscribe,()=>selector(state)),{
          getState:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}});
        export function patch(delta){const previous=state;state={...state,...delta};for(const fn of [...listeners])fn(state,previous)}
        state.setMessages=(chatId,rows)=>patch({messages:{...state.messages,[chatId]:rows}});
      `, loader: "js", resolveDir: root }));
      for (const name of ["@/components/kub", "@/lib/audioOutput", "@/lib/monitoring", "@/hooks/useAudioSettings", "@/lib/utils", "@/lib/safeOpenChat", "@/lib/chatJumpEvents"]) {
        plugin.onResolve({ filter: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: name, namespace: "stub" }));
      }
      plugin.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: `export const KubGlassLayer=()=>null,KubIcon=()=>null;
        export const applyAudioOutputDevice=async()=>{},reportError=()=>{},cn=()=>'',safeOpenChat=()=>{},requestChatMessageJump=()=>{};
        export const useAudioSettings=()=>({settings:{selectedOutputDeviceId:null}});`, loader: "js" }));
    } }], stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {AppMediaPlaybackProvider,useChatMediaPlayback} from './components/chat/ChatMediaPlayback';
      import {useAppStore,patch} from '@/store/app.store';
      import {patchHeldMessage} from './lib/messageMerge';
      import {hiddenMessagesLive} from './lib/hiddenMessagesLive';import {dispatchChatsRefresh} from './lib/chatEvents';
      const userId='owner-a',accountEpoch=1;
      const channelPreviewCache={hearUpdate(){}},isCurrent=()=>useAppStore.getState().currentUser?.id===userId&&useAppStore.getState().accountEpoch===accountEpoch,applyEvent=()=>'',scheduleSummary=()=>{};
      const clearedAtCache={evictChat(){}},scheduleRefetch=()=>{};
      const produce=${producer};
      const membership=${membershipProducer};
      const grant=${membershipGrant};
      let api;function Probe(){api=useChatMediaPlayback();return null}
      const app=createRoot(document.getElementById('root'));
      let paused=true,media;
      function controlledMedia(kind){media=document.createElement(kind==='video'?'video':'audio');
        Object.defineProperties(media,{paused:{get:()=>paused},ended:{get:()=>false},duration:{get:()=>60}});
        media.play=()=>{paused=false;return Promise.resolve()};media.pause=()=>{paused=true};media.load=()=>{};}
      function isolatedMedia(){const element=document.createElement('audio'),state={paused:true,pauses:0};
        Object.defineProperties(element,{paused:{get:()=>state.paused},ended:{get:()=>false},duration:{get:()=>60}});
        element.play=()=>{state.paused=false;return Promise.resolve()};element.pause=()=>{state.paused=true;state.pauses++};element.load=()=>{};
        return {element,state};}
      const row={id:'message-a',chat_id:'chat-a',type:'audio',content:'fixture',created_at:'2026-10-15T00:00:00Z',deleted_at:null};
      const item={id:row.id,chatId:row.chat_id,kind:'voice',url:'https://media.invalid/fixture',title:'fixture'};
      const act=fn=>flushSync(fn);
      act(()=>app.render(<AppMediaPlaybackProvider><Probe/></AppMediaPlaybackProvider>));
      window.fixture={start(kind='voice'){controlledMedia(kind);act(()=>{patch({messages:{'chat-a':[row]}});api.registerChat('chat-a',[{...item,kind}]);api.play({...item,kind},media)})},
        tombstone(id='message-a',chat='chat-a'){act(()=>produce({new:{...row,id,chat_id:chat,deleted_at:'2026-10-15T00:01:00Z'}}))},
        leave(){act(()=>api.leaveChat('chat-a'))},partial(){act(()=>api.registerChat('chat-a',[]))},
        retire(){act(()=>patch({accountEpoch:2}))},retireOwner(){act(()=>patch({currentUser:{id:'owner-b'}}))},hide(){act(()=>hiddenMessagesLive.heard({chatId:'chat-a',messageId:'message-a',hidden:true}))},
        replayAfterDeleted(){this.tombstone();act(()=>api.play(item,media))},
        activateAfterDeleted(){this.tombstone();act(()=>{paused=false;api.activate(item,media)})},
        rejectedNative(shared){this.start();this.tombstone();
          const b={...item,id:'message-b',chatId:'chat-b',url:'https://media.invalid/fixture-b'},transport=isolatedMedia();
          act(()=>{api.registerChat('chat-b',[b]);api.play(b,transport.element)});
          const before={id:api.currentItem?.id,paused:transport.state.paused};
          const rejected=shared?transport:isolatedMedia();
          if(!shared){rejected.element.src=item.url;rejected.element.play()}
          act(()=>api.activate(item,rejected.element));
          return {before,id:api.currentItem?.id,bPaused:transport.state.paused,bSrc:transport.element.getAttribute('src'),bPauses:transport.state.pauses,
            aPaused:rejected.state.paused,aSrc:rejected.element.getAttribute('src'),aPauses:rejected.state.pauses};},
        revokedLateItem(restore){this.start();this.membership();const retired=this.snapshot();
          const b={...item,id:'late-b',url:'https://media.invalid/late-b'};
          act(()=>{api.registerChat('chat-a',[b]);api.play(b,media)});const blocked=this.snapshot();
          if(restore==='owner-reset')this.retire();
          else if(restore==='wrong-owner'||restore==='wrong-epoch')this.deliver([{reason:'media-retired',chatId:'chat-a',
            ownerUserId:restore==='wrong-owner'?'wrong-owner':'owner-a',accountEpoch:restore==='wrong-epoch'?0:1,retireChat:'access-restored'}]);
          else this.grant();
          act(()=>{api.registerChat('chat-a',[b]);api.play(b,media)});const restored=this.snapshot();
          return {retired,blocked,restored};},
        deletedAfterLeave(){this.leave();this.tombstone()},
        switchChat(){act(()=>api.registerChat('chat-b',[]))},
        staleOwnerReplay(){const retained=api.play;this.retire();act(()=>retained(item,media))},
        hideOtherChat(){act(()=>hiddenMessagesLive.heard({chatId:'chat-b',messageId:'message-a',hidden:true}))},
        confirmedLocalHide(){act(()=>dispatchChatsRefresh({reason:'message-hidden',chatId:'chat-a',messageId:'message-a'}))},
        membership(){act(()=>membership({old:{chat_id:'chat-a',user_id:'owner-a'}}))},
        grant(){act(()=>grant({new:{chat_id:'chat-a',user_id:'owner-a'}}))},
        rejoin(){this.membership();this.grant();this.replay()},
        accessThenHidden(){this.membership();this.hide();this.grant();this.replay()},
        accessThenDeleted(){this.membership();this.tombstone();this.grant();this.forgetCache();this.replay()},
        accessThenCleared(){this.membership();this.deliver([{reason:'media-retired',chatId:'chat-a',ownerUserId:'owner-a',accountEpoch:1,retireChat:'clear'}]);this.grant();this.forgetCache();this.replay()},
        wrongOwnerEvent(){this.deliver([{reason:'media-retired',chatId:'chat-a',ownerUserId:'wrong-owner',accountEpoch:1,retireChat:'access'}])},
        hiddenRejoin(){this.hide();this.membership();this.grant();this.replay()},
        deletedRejoin(){this.tombstone();this.grant();this.forgetCache();this.replay()},
        clearedRejoin(){this.deliver([{reason:'media-retired',chatId:'chat-a',ownerUserId:'owner-a',accountEpoch:1,retireChat:'clear'}]);this.grant();this.replay()},
        futureAfterClear(){this.clearedRejoin();act(()=>api.play({...item,id:'future'},media))},
        unhideDeleted(){this.tombstone();this.forgetCache();act(()=>hiddenMessagesLive.heard({chatId:'chat-a',messageId:'message-a',hidden:false}));this.replay()},
        lateMembership(){this.retire();this.start();act(()=>membership({old:{chat_id:'chat-a',user_id:'owner-a'}}))},
        deliver(events){act(()=>{for(const detail of events)dispatchChatsRefresh(detail)})},
        unrelated(){act(()=>patch({messages:{...useAppStore.getState().messages,'unrelated':Array.from({length:1000},(_,i)=>({...row,id:'foreign-'+i,chat_id:'unrelated',deleted_at:'2026-10-15T00:01:00Z'}))}}))},
        forgetCache(){act(()=>patch({messages:{}}))},
        replay(){act(()=>api.play(item,media))},close(){act(()=>api.closeIfCurrent('message-a'))},
        snapshot:()=>({id:api.currentItem?.id??null,paused,src:media.getAttribute('src'),next:api.canNext,retired:window.__retiredCount(),registered:window.__registeredIds('chat-a'),revoked:window.__revokedCount()}),
        destroy(){act(()=>app.unmount())}};
    ` } });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  return { page, close: () => context.close() };
}

async function scenario(action, wantClosed, kind = "voice", changed) {
  const f = await mounted(changed);
  try {
    const result = await f.page.evaluate(({ action, kind }) => {
      const f = window.fixture;f.start(kind);const before=f.snapshot();
      if(action==='other-item')f.tombstone('message-b');
      else if(action==='other-chat')f.tombstone('message-a','chat-b');
      else if(action==='deleted')f.tombstone();else f[action]();
      return {before,after:f.snapshot()};
    }, { action, kind });
    assert.equal(result.before.id, "message-a", "mounted player starts exact item");
    assert.equal(result.before.paused, false, "controlled media really playing");
    assert.equal(result.after.id, wantClosed ? null : action === "futureAfterClear" ? "future" : "message-a", "authority controls exact current playback");
    assert.equal(result.after.paused, wantClosed, "retirement pauses media, ordinary navigation does not");
    if (wantClosed) assert.equal(result.after.src, null, "retirement clears transport source");
  } finally { await f.close(); }
}
for (const kind of ["voice", "video"]) test(`actual producer tombstone retires ${kind}`, () => scenario("deleted", true, kind));
for (const action of ["leave", "partial", "other-item", "other-chat"]) test(`control: ${action} preserves voice`, () => scenario(action, false));
test("owner epoch retirement closes playback", () => scenario("retire", true));
test("confirmed hide retires exact playback", () => scenario("hide", true));
test("existing explicit close clears transport", () => scenario("close", true));
test("owner UID retirement closes playback", () => scenario("retireOwner", true));
test("deleted item cannot be replayed", () => scenario("replayAfterDeleted", true));
test("native play admission cannot revive a deleted item", () => scenario("activateAfterDeleted", true));
test("producer tombstone retires detached cross-chat voice", () => scenario("deletedAfterLeave", true));
test("hide in another chat cannot retire current item", () => scenario("hideOtherChat", false));
test("existing confirmed local-hide event retires exact item", () => scenario("confirmedLocalHide", true));
test("ordinary switch to another chat preserves voice", () => scenario("switchChat", false));
test("retired owner callback cannot restart playback", () => scenario("staleOwnerReplay", true));
test("actual membership DELETE retires retained chat", () => scenario("membership", true));
test("old owner membership callback cannot retire new epoch playback", () => scenario("lateMembership", false));
test("confirmed own membership grant restores only access retirement",()=>scenario("rejoin",false));
test("membership grant cannot restore hidden item",()=>scenario("hiddenRejoin",true));
test("membership grant cannot restore deleted item",()=>scenario("deletedRejoin",true));
test("membership grant cannot restore cleared item",()=>scenario("clearedRejoin",true));
test("clear-history never blocks future messages",()=>scenario("futureAfterClear",false));
test("unhide cannot undo authoritative deletion",()=>scenario("unhideDeleted",true));
test("rejoin cannot undo hide arriving during access retirement",()=>scenario("accessThenHidden",true));
test("rejoin cannot undo deletion arriving during access retirement",()=>scenario("accessThenDeleted",true));
test("rejoin cannot undo clear arriving during access retirement",()=>scenario("accessThenCleared",true));

async function rejectedNativeContract(shared, changed = source) {
  const f=await mounted(changed);try {
    const result=await f.page.evaluate(shared=>window.fixture.rejectedNative(shared),shared);
    assert.equal(result.before.id,"message-b");assert.equal(result.before.paused,false,"B starts playing control");
    assert.equal(result.id,"message-b","B remains selected after rejecting A");
    assert.equal(result.bPaused,false,"rejecting A cannot stop B's active transport");
    assert.equal(result.bSrc,"https://media.invalid/fixture-b","B keeps its own source");
    assert.equal(result.bPauses,0,"B transport must not be paused");
    if(!shared){assert.equal(result.aPaused,true,"separate rejected A transport must stop");
      assert.equal(result.aSrc,null,"separate rejected A transport must lose source");assert.equal(result.aPauses,1);}
  }finally{await f.close();}
}
test("P2 regression: separate rejected native A stops while current B continues",()=>rejectedNativeContract(false));
test("P2 control: reused current B transport survives stale A native callback",()=>rejectedNativeContract(true));

async function revokedChatContract(restore, changed = source) {
  const f=await mounted(changed);try {
    const result=await f.page.evaluate(restore=>window.fixture.revokedLateItem(restore),restore);
    assert.equal(result.retired.id,null,"confirmed membership DELETE retires A control");
    assert.equal(result.blocked.id,null,"revoked chat must reject previously unretained B before grant");
    assert.equal(result.blocked.paused,true,"revoked chat cannot start B transport");
    assert.deepEqual(result.blocked.registered,[],"revoked chat cannot register late B playlist");
    assert.equal(result.blocked.revoked,1,"one pending explicit chat revocation, not one marker per message");
    const shouldRestore=restore==='grant'||restore==='owner-reset';
    assert.equal(result.restored.id,shouldRestore?'late-b':null,"only confirmed grant or owner reset restores chat admission");
    assert.equal(result.restored.paused,!shouldRestore);
    assert.equal(result.restored.revoked,shouldRestore?0:1,"grant/reset removes the chat lease, invalid grant does not");
  }finally{await f.close();}
}
test("P2 regression: revoked chat blocks new IDs until confirmed regrant",()=>revokedChatContract("grant"));
test("P2 control: owner reset retires the revoked-chat lease",()=>revokedChatContract("owner-reset"));
test("P2 control: wrong owner grant cannot restore revoked chat",()=>revokedChatContract("wrong-owner"));
test("P2 control: old epoch grant cannot restore revoked chat",()=>revokedChatContract("wrong-epoch"));

for(const [name,needle,replacement,contract,oracle] of [
  ["old item-only refusal guard", "if (!sharedWithOther) {", "if (!current || current.id === item.id) {",
    text=>rejectedNativeContract(false,text),"separate rejected A transport must stop"],
  ["rejected native pauses reused B transport", "if (!sharedWithOther) {", "if (true) {",
    text=>rejectedNativeContract(true,text),"rejecting A cannot stop B"],
  ["revoked chat admission omitted", "!accessRevokedChatsRef.current.has(item.chatId) &&", "",
    text=>revokedChatContract("grant",text),"revoked chat must reject"],
  ["revoked chat registration omitted", "if (accessRevokedChatsRef.current.has(openChatId)) return;", "",
    text=>revokedChatContract("grant",text),"revoked chat cannot register"],
  ["grant does not clear chat lease", "accessRevokedChatsRef.current.delete(detail.chatId);", "",
    text=>revokedChatContract("grant",text),"only confirmed grant or owner reset restores"],
  ["owner reset does not clear chat lease", "accessRevokedChatsRef.current.clear();", "",
    text=>revokedChatContract("owner-reset",text),"only confirmed grant or owner reset restores"],
]) test(`P2 compiled omission rejected: ${name}`,async()=>{
  await assert.rejects(()=>contract(mutate(needle,replacement)),error=>{
    assert.equal(error.code,"ERR_ASSERTION","only a named behavioral assertion kills the mutant");
    assert.ok(error.message.includes(oracle),oracle);return true;
  });
});

const read = name => readFileSync(root + "/" + name, "utf8").replaceAll("\r\n", "\n");
const hookSource = read("hooks/useMessages.ts");
const harnessText = readFileSync(new URL("message-producer-lifecycle.test.mjs", import.meta.url), "utf8");
const harnessTree = ts.createSourceFile("harness.mjs", harnessText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let declarations = ["compile", "deferred", "fixture"].map(name => {
  const node = harnessTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node);return node.getText(harnessTree);
}).join("\n");
declarations = declarations.replace('currentUser: { id: "fictional-owner" }', 'currentUser: { id: "owner-a" }');
const fixtures = new Set();
const row = (n = 1) => ({ id: n === 1 ? "message-a" : "message-b", chat_id: "chat-a", user_id: "peer", bot_id: null,
  type: "audio", topic_id: null, content: null, created_at: `2026-10-15T00:00:0${n}Z`, deleted_at: null,
  sender: { id: "peer" }, reactions: [], reply_to_id: null });
const producerFixture = new Function("assert", "path", "vm", "ts", "read", "source", "row", "CHAT", "fixtures",
  `${declarations}\nreturn fixture;`)(assert, path, vm, ts, read, hookSource, row, "chat-a", fixtures);
const retirementEvents = f => f.publications.filter(entry => entry.kind === "kub:chats-refresh" && entry.detail.reason === "media-retired").map(entry => entry.detail);

async function actualProducer(kind) {
  const rows = [row()];const f = producerFixture({ historyRows: rows });
  try {
    await f.drain();f.clear();
    if (kind.startsWith("hide")) {
      const first = f.hold("hide_message_for_me"),second = f.hold("hide_message_for_me");
      const pending = f.view.hideMessagesForMe(["message-a", "message-b"]);await f.drain();
      if (kind === "hide-late") f.changeEpoch(false);
      first.resolve({ error: kind === "hide-fail" ? {code:"fixture"} : null });await f.drain();
      second.resolve({ error: kind === "hide-all" ? null : {code:"fixture"} });await pending;await f.drain();
    } else if (kind.startsWith("clear")) {
      const ack=f.hold("clear_chat_for_me");const pending=f.view.clearChatForMe();await f.drain();
      if(kind==='clear-late')f.changeEpoch(false);
      ack.resolve({error:kind==='clear-fail'?{code:'fixture'}:null});await pending;await f.drain();
    } else if(kind==='topic-window') {
      rows.length=0;const history=f.hold('history');f.switchTopic('another-topic');await f.drain();
      history.resolve({data:[],error:null});await f.drain();
    } else {
      if(kind==='partial-window')rows.splice(0,1,row(2));else rows.length=0;
      const held=f.hold(kind==='network-fail'?'history':'hidden');
      const pending=f.view.refetch({background:true});await f.drain();
      if(kind==='gone-late')f.changeEpoch(false);
      held.resolve(kind==='network-fail'?{data:null,error:{code:'fixture'}}:
        {data:[],error:kind==='privacy-fail'?{code:'fixture'}:null});
      await pending;await f.drain();
    }
    return retirementEvents(f);
  } finally {await f.close();fixtures.delete(f);}
}

async function deliverContract(kind, expectedIds, retireChat) {
  const events=await actualProducer(kind);
  if(!expectedIds&&!retireChat){assert.equal(events.length,0,"unconfirmed/retired producer emits no retirement");return;}
  assert.equal(events.length,1,"one typed batch retirement, not per-ID events");
  assert.equal(events[0].ownerUserId,"owner-a");assert.equal(events[0].accountEpoch,1);
  if(expectedIds)assert.deepEqual(Array.from(events[0].retiredMessageIds),expectedIds,"only successful/verified IDs retire");
  else assert.equal(events[0].retireChat,retireChat);
  const f=await mounted();try{
    const after=await f.page.evaluate(events=>{const f=window.fixture;f.start();f.deliver(events);return f.snapshot()},events);
    assert.equal(after.id,null,"actual producer event closes exact mounted playback");assert.equal(after.src,null);
  }finally{await f.close();}
}
test("partial bulk ACK retires only confirmed successful IDs",()=>deliverContract("hide-partial",["message-a"]));
test("successful bulk hide emits one batch",()=>deliverContract("hide-all",["message-a","message-b"]));
test("confirmed clear ACK retires retained chat",()=>deliverContract("clear-ok",null,"clear"));
test("verified gone-window result retires the held target",()=>deliverContract("gone",["message-a"]));
for(const kind of ["hide-fail","hide-late","clear-fail","clear-late","network-fail","privacy-fail","gone-late","partial-window","topic-window"])
  test(`privacy control: ${kind} emits no retirement`,()=>deliverContract(kind));

test("delayed event with wrong UID or epoch cannot retire playback",async()=>{
  const f=await mounted();try{
    const result=await f.page.evaluate(()=>{const f=window.fixture;f.start();
      f.deliver([{reason:'media-retired',chatId:'chat-a',ownerUserId:'old-owner',accountEpoch:1,retiredMessageIds:['message-a']},
        {reason:'media-retired',chatId:'chat-a',ownerUserId:'owner-a',accountEpoch:0,retireChat:'access'}]);return f.snapshot()});
    assert.equal(result.id,'message-a');assert.equal(result.paused,false);
  }finally{await f.close();}
});
async function boundedRetirement(changed = source) {
  const f=await mounted(changed);try{
    const result=await f.page.evaluate(()=>{const f=window.fixture;f.start();f.unrelated();f.hideOtherChat();const unrelated=f.snapshot();
      f.tombstone();f.unrelated();f.forgetCache();f.replay();return {unrelated,retired:f.snapshot()}});
    assert.equal(result.unrelated.retired,0,"unretained cached tombstones must not grow retirement state");
    assert.equal(result.retired.retired,1,"known retired target remains fenced");assert.equal(result.retired.id,null);
  }finally{await f.close();}
}
test("unrelated cached tombstones do not accumulate; known retirement is not evicted",()=>boundedRetirement());

function mutate(needle, replacement, count = 1) {
  const current = readFileSync(playerFile, "utf8").replaceAll("\r\n", "\n");
  assert.equal(current.split(needle).length - 1, count, "exact compiled mutation sites");
  return current.replaceAll(needle, replacement);
}
for (const [name, needle, replacement, action, wantClosed, oracle, count] of [
  ["omit tombstone retirement", "closeIfCurrent(item.id, item.chatId, true);", "", "deleted", true, "authority controls"],
  ["omit owner close", "close();\n        retiredItemsRef.current.clear();", "retiredItemsRef.current.clear();", "retire", true, "authority controls"],
  ["omit source clearing", 'element.pause();\n      element.removeAttribute("src");', "element.pause();", "close", true, "clears transport"],
  ["omit exact chat fence", "item?.id === itemId && item.chatId === targetChatId", "item?.id === itemId", "hideOtherChat", false, "authority controls", 2],
  ["omit replay admission", "if (!canAdmitItem(item)) return;", "", "replayAfterDeleted", true, "retirement pauses"],
  ["omit event owner fence", "if (state.currentUser?.id !== detail.ownerUserId || state.accountEpoch !== detail.accountEpoch) return;", "", "wrongOwnerEvent", false, "authority controls"],
  ["grant wrongly removes hidden retirement", "if (!permanentRetiredItemsRef.current.has(key) && !hiddenRetiredItemsRef.current.has(key)) retiredItemsRef.current.delete(key);", "retiredItemsRef.current.delete(key);", "accessThenHidden", true, "authority controls"],
]) test(`compiled omission rejected: ${name}`, async () => {
  await assert.rejects(() => scenario(action, wantClosed, "voice", mutate(needle, replacement, count)), error => {
    assert.equal(error.code, "ERR_ASSERTION", "setup/compiler errors are not mutation kills");
    assert.ok(error.message.includes(oracle));return true;
  });
});
test("compiled omission rejected: omit retained-only bound",async()=>{
  await assert.rejects(()=>boundedRetirement(mutate("if (!retained) return;","")), error=>{
    assert.equal(error.code,"ERR_ASSERTION");assert.ok(error.message.includes("unretained cached tombstones"));return true;
  });
});
