import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const src = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const req = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium } = req("@playwright/test");
const { build } = createRequire(req.resolve("vite"))("esbuild");
const origin = "https://cold-offline.invalid";
const A = "10000000-0000-0000-0000-000000000001";
const B = "10000000-0000-0000-0000-000000000002";
const SID = "20000000-0000-0000-0000-000000000001";
const session = (id = A) => ({ user: { id, user_metadata: {} }, expires_at: 1,
  access_token: `fixture.${Buffer.from(JSON.stringify({ sub: id, session_id: SID, exp: 1 })).toString("base64url")}.fixture` });
const profile = (id = A, role = "admin") => ({ id, full_name: "Synthetic owner", username: "fixture", role,
  avatar_url: null, bio: null, online_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
const chat = (id = "cached-chat") => ({ id, type: "group", name: id, updated_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z", members: [], unread_count: 0 });
const noop = "()=>{}";
let browser, bundle;

const fixturePort = `
  const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
  const boot=deferred(),cachedProfile=deferred(),cachedChats=deferred();
  const requests=[],channels=[],authCalls=[],writes=[],identities=[],invalidations=[];
  let listener,identity=null,generation=0;const retirementListeners=new Set();
  export const offlineHistory={setIdentity(next){
    if(JSON.stringify(next)!==JSON.stringify(identity)){identity=next;generation++}identities.push(next);
  },subscribe(fn){retirementListeners.add(fn);return()=>retirementListeners.delete(fn)},capture(){if(!identity)return null;const held=generation,userId=identity.userId;return{userId,
    readProfile:()=>cachedProfile.promise,readChats:()=>cachedChats.promise,
    async writeProfile(value,isCurrent){if(held!==generation||isCurrent&&!isCurrent())return false;writes.push({kind:'profile',value});return true},
    async writeChats(value,isCurrent){if(held!==generation||isCurrent&&!isCurrent())return false;writes.push({kind:'chats',value});return true},
    async invalidate(){invalidations.push('owner');generation++;for(const fn of retirementListeners)fn(null)},
    async invalidateChat(id){invalidations.push(id);generation++;for(const fn of retirementListeners)fn(id)}
  }}};
  const rt={setAuth(value){authCalls.push({kind:'realtime',value})},channel(name){const c={name,bindings:[],
    on(type,filter,callback){c.bindings.push({type,filter,callback});return c},subscribe(callback){c.status=callback;return c}};channels.push(c);return c},
    removeChannel(){return Promise.resolve()}};
  const client={realtime:rt,...rt,auth:{
    getSession(){authCalls.push({kind:'getSession'});return boot.promise},
    onAuthStateChange(fn){listener=fn;return{data:{subscription:{unsubscribe(){listener=null}}}}},
    async getUser(){authCalls.push({kind:'getUser'});return{data:{user:{id:window.fixtureOwner,user_metadata:{}}},error:null}},
    async signOut(){authCalls.push({kind:'signOut'});listener?.('SIGNED_OUT',null)},
    setSession(){throw Error('FORGED_SESSION_NOT_ADMITTED')}
  },from(table){let insert=false;const q={select(){return q},eq(){return q},in(){return q},order(){return q},
    is(){return q},gt(){return q},or(){return q},limit(){return q},maybeSingle(){return q},single(){return q},
    insert(){insert=true;return q},then(done,fail){const gate=deferred();requests.push({table,insert,gate});return gate.promise.then(done,fail)}};return q},
    async rpc(name){if(name==='chat_list_summaries')return{data:window.fixture.summaryRows??[],error:null};return{data:null,error:null}}};
  export const createClient=()=>client;export const getRealtimeClient=()=>rt;
  window.fixture={boot,cachedProfile,cachedChats,requests,channels,authCalls,writes,identities,invalidations,
    retire(chatId){generation++;for(const fn of retirementListeners)fn(chatId,false)},
    emit(event,session){listener?.(event,session)},reply(table,data,error=null,status=error?400:200){const r=requests.find(r=>r.table===table&&!r.done);if(!r)throw Error('missing '+table);r.done=true;r.gate.resolve({data,error,status,count:0})}};
`;

async function buildFixture(mutation) {
  const ports = new Map([
    ["@/lib/supabase/client", fixturePort],
    ["@/lib/historyCache/appOfflineHistory", `export{offlineHistory}from'@/lib/supabase/client';`],
    ["@/lib/outbox/appOutbox", `export const appOutbox={stop(){}};`],
    ["@/lib/platform/capabilities", `export const isWebBrowser=()=>false;`],
    ["@/lib/platform/webMessagePreviews", `export const observeWebMessagePreviewIdentity=${noop};export const retireWebMessagePreviews=async()=>true;`],
    ["@/lib/media/mediaUrl", `export const signedMediaUrls=()=>({setAccount(){}});`],
    ["@/lib/dev/instrumentation", `export const bumpFetch=${noop},registerChannel=${noop},unregisterChannel=${noop};`],
    ["@/lib/chatBotMembership", `export const fetchChatBots=async()=>new Map();`],
    ["@/lib/chatDisplay", `export const isSavedChat=()=>false;`],
    ["@/lib/deliveryReceipts", `export const scheduleMarkChatDelivered=()=>{throw Error('RECEIPT_NOT_ADMITTED')};`],
    ["@/lib/errors", `export const mapPgError=()=>null;`],
    ["@/lib/clearedAtCache", `export const clearedAtCache={beginMembershipRead:()=>1,seedFromMembershipRead(){},evictChat(){},setLive(){}};`],
    ["@/lib/hiddenMessagesLive", `export const hiddenMessagesLive={lost(){},pingReturned(){},heard(){},joined(){}};export const readHideEvent=x=>x;`],
    ["@/lib/channelActivity", `export const emitChannelActivity=${noop};`],
    ["@/lib/channelPreviewCache", `export const channelPreviewCache={evict(){},hearUpdate(){}};`],
  ]);
  const result = await build({ write: false, bundle: true, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": src }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify({ DEV: false, VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED: "1" }) },
    plugins: [{ name: "offline-ports", setup(p) {
      p.onResolve({ filter: /.*/ }, args => ports.has(args.path) ? { path: args.path, namespace: "ports" } : undefined);
      p.onLoad({ filter: /.*/, namespace: "ports" }, args => ({ contents: ports.get(args.path), loader: "ts", resolveDir: src }));
      if (mutation) p.onLoad({ filter: /[/\\](useUser|useChats|app\.store)\.ts$/ }, args => {
        if (!args.path.replaceAll("\\", "/").endsWith(mutation.file)) return;
        const source = readFileSync(args.path, "utf8");
        assert.ok(source.includes(mutation.from), "mutation target exists");
        return { contents: source.replace(mutation.from, mutation.to), loader: "ts", resolveDir: dirname(args.path) };
      });
    } }],
    stdin: { resolveDir: src, loader: "tsx", contents: `
      import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
      import{useUser}from'./hooks/useUser';import{useChats}from'./hooks/useChats';import{useAppStore}from'./store/app.store';
      const root=createRoot(document.getElementById('root'));window.store=useAppStore;
      function User(){window.authView=useUser();return null}function Chats(){window.chatsView=useChats();return null}
      window.mount=mode=>flushSync(()=>root.render(<>{mode!=='chats'&&<User/>}{mode!=='user'&&<Chats/>}</>));
      window.dispose=()=>flushSync(()=>root.unmount());window.patch=value=>flushSync(()=>useAppStore.setState(value));
      window.snapshot=()=>({auth:window.authView&&{id:window.authView.user?.id??null,loading:window.authView.loading,error:window.authView.loadingError},
        state:JSON.parse(JSON.stringify(useAppStore.getState())),list:window.chatsView&&{loading:window.chatsView.loading,view:window.chatsView.view},
        writes:window.fixture.writes,invalidations:window.fixture.invalidations,identities:window.fixture.identities,
        requests:window.fixture.requests.map(({table,insert,done})=>({table,insert,done})),authCalls:window.fixture.authCalls});
    ` } });
  return result.outputFiles[0].text;
}

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  bundle = await buildFixture(); browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); });
async function settle(page) { await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 20))); }
async function fixture({ mode = "user", cached = session(), offline = true, js = bundle, seed } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage(), errors = [], unexpected = [];
  page.on("pageerror", e => errors.push(e.message));
  await context.route("**/*", route => {
    if (route.request().url() === origin + "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    unexpected.push("network-not-admitted"); return route.abort();
  });
  await page.goto(origin); await page.evaluate(({ cached, offline, A }) => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: !offline });
    if (cached) localStorage.setItem("kub-auth", JSON.stringify(cached)); window.fixtureOwner = A;
  }, { cached, offline, A });
  await page.addScriptTag({ content: js });
  if (seed) await page.evaluate(seed => window.patch(seed), seed);
  await page.evaluate(mode => window.mount(mode), mode); await settle(page);
  return { page, async snapshot() { await settle(page); return page.evaluate(() => window.snapshot()); }, async close() {
    try { await page.evaluate(() => window.dispose()); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); }
    finally { await context.close(); }
  } };
}
async function cachedEntry(f) {
  await f.page.evaluate(p => window.fixture.cachedProfile.resolve(p), profile());
  return f.snapshot();
}

test("mounted: expired persisted session enters local cache while SDK refresh is still pending, without auth claims", async () => {
  const f = await fixture(); try {
    const s = await cachedEntry(f);
    assert.equal(s.state.currentUser?.id, A, "cold cache must be visible without waiting for getSession");
    assert.equal(s.state.currentUser.role, "user", "cached admin is display-only ordinary user");
    assert.equal(s.state.authSessionSource, "cache");
    assert.equal(s.auth.loading, false); assert.equal(s.auth.id, A);
    assert.equal(s.requests.length, 0, "cache does not dispatch profile/network requests");
    assert.equal(s.authCalls.some(c => c.kind === "realtime"), false, "cached token never reaches Realtime");
    assert.equal(s.identities.at(-1)?.userId, A, "service owner is set after the store reset");
  } finally { await f.close(); }
});

test("mounted: transient profile refusal never falls through to server profile creation", async () => {
  const f = await fixture({ cached: null, offline: false }); try {
    await f.page.evaluate(s => window.fixture.boot.resolve({ data: { session: s }, error: null }), session());
    for (let i = 0; i < 3; i++) {
      await settle(f.page); await f.page.evaluate(() => window.fixture.reply("profiles", null, { code: "57014" }));
      await f.page.waitForTimeout(800);
    }
    const s = await f.snapshot();
    assert.equal(s.authCalls.some(c => c.kind === "getUser"), false, "transient failure is not a missing row");
    assert.equal(s.requests.some(r => r.insert), false);
    assert.equal(s.auth.loading, false, "three failed reads must settle without a fourth request");
  } finally { await f.close(); }
});

test("mounted: newer SDK account beats a pending persisted-cache profile", async () => {
  const f = await fixture(); try {
    await f.page.evaluate(s => window.fixture.emit("SIGNED_IN", s), session(B));
    await f.page.evaluate(p => window.fixture.reply("profiles", p), profile(B, "member"));
    const s = await cachedEntry(f);
    assert.equal(s.state.currentUser.id, B); assert.equal(s.state.authSessionSource, "sdk");
    assert.equal(s.writes.filter(w => w.kind === "profile").at(-1)?.value.id, B);
  } finally { await f.close(); }
});

test("mounted: fresh server profile is authoritative over late disk profile", async () => {
  const f = await fixture(); try {
    await f.page.evaluate(s => window.fixture.emit("SIGNED_IN", s), session());
    await f.page.evaluate(p => window.fixture.reply("profiles", p), { ...profile(), full_name: "Fresh server" });
    const s = await cachedEntry(f);
    assert.equal(s.state.currentUser.full_name, "Fresh server"); assert.equal(s.state.currentUser.role, "admin");
  } finally { await f.close(); }
});

test("mounted: cache to SDK activates profile RT once, and ordinary token refresh retains the channel", async () => {
  const f = await fixture(); try {
    await cachedEntry(f);
    await f.page.evaluate(s => window.fixture.emit("SIGNED_IN", s), session());
    await settle(f.page);
    const count = () => f.page.evaluate(() => window.fixture.channels.filter(c=>c.name.startsWith('profile-self:')).length);
    assert.equal(await count(), 1);
    await f.page.evaluate(s => window.fixture.emit("TOKEN_REFRESHED", s), session());
    await settle(f.page); assert.equal(await count(), 1, "same-owner token refresh must not churn the profile channel");
  } finally { await f.close(); }
});

test("mounted: permission refusal clears cached and visible profile and cannot be resurrected", async () => {
  const f = await fixture(); try {
    await cachedEntry(f);
    await f.page.evaluate(s => window.fixture.emit("SIGNED_IN", s), session());
    await f.page.evaluate(() => window.fixture.reply("profiles", null, { code: "42501", status: 403 }));
    const s = await f.snapshot();
    assert.equal(s.state.currentUser, null); assert.ok(s.invalidations.includes("owner"));
    assert.equal(s.requests.some(r => r.insert), false);
  } finally { await f.close(); }
});

test("mounted: PostgREST HTTP 403 is a refusal even when its code is not a known SQLSTATE", async () => {
  const f = await fixture(); try {
    await cachedEntry(f); await f.page.evaluate(s => window.fixture.emit("SIGNED_IN", s), session());
    await f.page.evaluate(() => window.fixture.reply("profiles", null, {code:"CUSTOM_DENIAL"}, 403));
    const s = await f.snapshot(); assert.equal(s.state.currentUser, null); assert.ok(s.invalidations.includes("owner"));
  } finally { await f.close(); }
});

test("mounted: signout retires service synchronously and late cache cannot re-enter", async () => {
  const f = await fixture(); try {
    await f.page.evaluate(() => window.fixture.emit("SIGNED_OUT", null));
    const s = await cachedEntry(f);
    assert.equal(s.state.currentUser, null); assert.equal(s.identities.at(-1), null); assert.equal(s.auth.id, null);
  } finally { await f.close(); }
});

test("mounted: SDK initial null after retryable offline recovery keeps only exact unchanged local display", async () => {
  const f = await fixture(); try {
    await cachedEntry(f);
    await f.page.evaluate(() => window.fixture.emit("INITIAL_SESSION", null));
    const s = await f.snapshot(); assert.equal(s.state.currentUser?.id, A, "ambiguous INITIAL_SESSION null must not discard unchanged cold display");
    assert.equal(s.state.authSessionSource, "cache"); assert.equal(s.state.currentUser.role, "user");
    assert.equal(s.requests.length, 0); assert.equal(s.authCalls.some(c=>c.kind==='realtime'), false);
  } finally { await f.close(); }
});

test("mounted: SDK initial null after stored session removal retires local display", async () => {
  const f = await fixture(); try {
    await cachedEntry(f);
    await f.page.evaluate(() => {localStorage.removeItem('kub-auth');window.fixture.emit('INITIAL_SESSION',null)});
    const s = await f.snapshot(); assert.equal(s.state.currentUser, null); assert.equal(s.auth.id, null);
  } finally { await f.close(); }
});

test("mounted: exact SDK storage replacement fences a pending display bootstrap even before its event", async () => {
  const f = await fixture(); try {
    await f.page.evaluate(s => localStorage.setItem("kub-auth", JSON.stringify(s)), session(B));
    const s = await cachedEntry(f);
    assert.equal(s.state.currentUser, null, "changed SDK storage must fence the old cached profile");
    assert.equal(s.auth.id, null);
  } finally { await f.close(); }
});

test("mounted: transient server profile error cannot block already restored offline UI", async () => {
  const f = await fixture(); try {
    await f.page.evaluate(s => window.fixture.emit("INITIAL_SESSION", s), session());
    await cachedEntry(f);
    for (let i = 0; i < 3; i++) {
      await f.page.evaluate(() => window.fixture.reply("profiles", null, { code: "SYNTHETIC_OFFLINE", status: 503 }));
      await f.page.waitForTimeout(800);
    }
    const s = await f.snapshot(); assert.equal(s.state.currentUser.id, A);
    assert.equal(s.auth.loading, false); assert.equal(s.auth.error, null, "transient failure must not replace cache with LoadingScreen");
  } finally { await f.close(); }
});

test("mounted: SDK permission refusal retires the cached profile, unlike transient refresh failure", async () => {
  const f = await fixture(); try {
    await cachedEntry(f);
    await f.page.evaluate(() => window.fixture.boot.resolve({data:{session:null},error:{status:401}}));
    const s = await f.snapshot(); assert.equal(s.state.currentUser, null); assert.equal(s.auth.id, null);
    assert.ok(s.invalidations.includes("owner"));
  } finally { await f.close(); }
});

test("mounted: reconnect revalidates the profile after transient failure without losing cached UI", async () => {
  const f = await fixture(); try {
    await cachedEntry(f);
    await f.page.evaluate(s => window.fixture.boot.resolve({data:{session:s},error:null}), session());
    for (let i = 0; i < 3; i++) {
      await settle(f.page); await f.page.evaluate(() => window.fixture.reply("profiles", null, {status:503}));
      await f.page.waitForTimeout(800);
    }
    await f.page.evaluate(() => window.dispatchEvent(new Event("online")));
    const pending = await f.snapshot();
    assert.equal(pending.auth.loading, false, "reconnect must not block local display");
    assert.equal(pending.requests.filter(r=>r.table==='profiles').length, 4, "reconnect must revalidate server profile");
    await f.page.evaluate(p => window.fixture.reply("profiles", p), { ...profile(), full_name: "Reconnected server" });
    const s = await f.snapshot(); assert.equal(s.state.currentUser.full_name, "Reconnected server");
  } finally { await f.close(); }
});

test("mounted: online during the final failed profile read queues one fresh revalidation", async () => {
  const f = await fixture(); try {
    await cachedEntry(f); await f.page.evaluate(s => window.fixture.boot.resolve({data:{session:s},error:null}), session());
    for (let i = 0; i < 2; i++) {
      await settle(f.page); await f.page.evaluate(() => window.fixture.reply("profiles",null,{status:503}));
      await f.page.waitForTimeout(800);
    }
    await f.page.evaluate(() => window.fixture.reply("profiles",null,{status:503}));
    await f.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await f.page.waitForTimeout(800);
    const pending = await f.snapshot();
    assert.equal(pending.requests.filter(r=>r.table==='profiles').length, 4, "online cannot inherit the last outage failure without a new read");
    await f.page.evaluate(p => window.fixture.reply("profiles",p), {...profile(),full_name:'Fresh after overlapping online'});
    assert.equal((await f.snapshot()).state.currentUser.full_name, 'Fresh after overlapping online');
  } finally { await f.close(); }
});

const seed = { currentUser: profile(A, "member"), authSessionIdentity: { userId: A, sessionId: SID }, authSessionSource: "sdk", accountEpoch: 1 };
test("mounted: list restores concurrently with a blocked server read", async () => {
  const f = await fixture({ mode: "chats", seed, cached: null, offline: false }); try {
    await f.page.evaluate(c => window.fixture.cachedChats.resolve([c]), chat());
    const s = await f.snapshot(); assert.equal(s.state.chats[0]?.id, "cached-chat");
    assert.equal(s.list.loading, false, "disk rows finish cold list loading while server remains pending");
    assert.equal(s.requests[0].table, "chat_members");
  } finally { await f.close(); }
});

for (const chatId of ["cached-chat", null]) test(`mounted: retirement ${chatId ?? "all"} removes an already displayed disk sidebar`, async () => {
  const f = await fixture({ mode: "chats", seed, cached: null, offline: false }); try {
    await f.page.evaluate(c => window.fixture.cachedChats.resolve([c]), { ...chat(), last_message: {id:'retired-preview',content:'Synthetic retired body'} });
    assert.equal((await f.snapshot()).state.chats[0]?.last_message.content, "Synthetic retired body");
    await f.page.evaluate(chatId => window.fixture.retire(chatId), chatId);
    const s = await f.snapshot(); assert.deepEqual(s.state.chats, [], "retirement must remove already-restored cached rows, not just fence future reads");
  } finally { await f.close(); }
});

test("mounted: late list restore cannot replace an authoritative empty server list", async () => {
  const f = await fixture({ mode: "chats", seed, cached: null, offline: false }); try {
    await f.page.evaluate(() => window.fixture.reply("chat_members", []));
    await settle(f.page); await f.page.evaluate(c => window.fixture.cachedChats.resolve([c]), chat());
    const s = await f.snapshot(); assert.deepEqual(s.state.chats, []);
    assert.deepEqual(s.writes.find(w => w.kind === "chats")?.value, [], "authoritative empty is persisted");
    assert.ok(s.invalidations.includes("cached-chat"), "dropped disk-only chat pages must also be purged");
  } finally { await f.close(); }
});

test("mounted: late disk diff cannot retire a chat restored by a newer successful list", async () => {
  const f = await fixture({ mode: "chats", seed, cached: null, offline: false }); try {
    await f.page.evaluate(() => window.fixture.reply("chat_members", [])); await settle(f.page);
    await f.page.evaluate(() => {window.fixture.summaryRows=[{chat_id:'cached-chat',last_message:null,unread_count:0}];void window.chatsView.refetch();});
    await f.page.evaluate(A => window.fixture.reply("chat_members",[{chat_id:'cached-chat',user_id:A,hidden_at:null,cleared_at:null}]), A);
    await settle(f.page); await f.page.evaluate(c => window.fixture.reply("chats",[c]), chat());
    await settle(f.page); await f.page.evaluate(c => window.fixture.cachedChats.resolve([c]), chat());
    const s = await f.snapshot(); assert.equal(s.state.chats[0].id, "cached-chat");
    assert.equal(s.invalidations.includes("cached-chat"), false, "old empty response cannot purge a newly verified chat");
  } finally { await f.close(); }
});

test("mounted: late list restore cannot overwrite RT progress", async () => {
  const f = await fixture({ mode: "chats", seed: { ...seed, chats: [chat("live-chat")] }, cached: null, offline: false }); try {
    await f.page.evaluate(() => {
      const c=window.fixture.channels.find(c=>c.name.endsWith(':messages'));
      c.bindings.find(b=>b.filter.event==='INSERT').callback({new:{id:'rt-message',chat_id:'live-chat',user_id:'peer',bot_id:null,type:'text',content:'Synthetic',created_at:'2026-02-01T00:00:00Z'}});
    });
    await f.page.evaluate(c => window.fixture.cachedChats.resolve([c]), chat());
    const s = await f.snapshot(); assert.equal(s.state.chats[0].id, "live-chat"); assert.equal(s.state.chats[0].last_message.id, "rt-message");
  } finally { await f.close(); }
});

test("mounted: own hidden/deleted membership retires parent chat cache", async () => {
  const f = await fixture({ mode: "chats", seed: { ...seed, chats: [chat()] }, cached: null, offline: false }); try {
    await f.page.evaluate(A => {
      const c=window.fixture.channels.find(c=>c.name.startsWith('chat-members:user:'));
      c.bindings.find(b=>b.filter.event==='UPDATE').callback({new:{chat_id:'cached-chat',user_id:A,hidden_at:'2026-03-01T00:00:00Z'}});
      c.bindings.find(b=>b.filter.event==='DELETE').callback({old:{chat_id:'deleted-chat',user_id:A}});
    }, A);
    const s = await f.snapshot(); assert.ok(s.invalidations.includes("cached-chat")); assert.ok(s.invalidations.includes("deleted-chat"));
  } finally { await f.close(); }
});

test("mounted: inactive chat clear and access retirement purge disk pages without an active message hook", async () => {
  const f = await fixture({ mode: "chats", seed, cached: null, offline: false }); try {
    await f.page.evaluate(A => {
      const c=window.fixture.channels.find(c=>c.name.startsWith('chat-members:user:'));
      c.bindings.find(b=>b.filter.event==='UPDATE').callback({new:{chat_id:'inactive-cleared-chat',user_id:A,cleared_at:'2026-03-01T00:00:00Z'}});
      window.dispatchEvent(new CustomEvent('kub:chats-refresh',{detail:{reason:'media-retired',chatId:'inactive-access-chat',ownerUserId:A,accountEpoch:1,retireChat:'access'}}));
    }, A);
    const s = await f.snapshot(); assert.ok(s.invalidations.includes("inactive-cleared-chat")); assert.ok(s.invalidations.includes("inactive-access-chat"));
  } finally { await f.close(); }
});

test("mounted: cached auth identity restores list without sending forged auth network requests", async () => {
  const f = await fixture({ mode: "both" }); try {
    await cachedEntry(f); await f.page.evaluate(c => window.fixture.cachedChats.resolve([c]), chat());
    const s = await f.snapshot(); assert.equal(s.state.chats[0]?.id, "cached-chat");
    assert.equal(s.requests.length, 0); assert.equal(s.list.loading, false);
  } finally { await f.close(); }
});

test("mounted: broadcast hide and local hidden-message retirement purge inactive cached history", async () => {
  const f = await fixture({ mode: "chats", seed, cached: null, offline: false }); try {
    await f.page.evaluate(A => {
      const c=window.fixture.channels.find(c=>c.name.startsWith('hides:'));
      c.bindings.find(b=>b.filter.event==='hide').callback({payload:{chatId:'broadcast-hidden-chat',messageId:'hidden-message',hidden:true}});
      window.dispatchEvent(new CustomEvent('kub:chats-refresh',{detail:{reason:'media-retired',chatId:'local-hidden-chat',ownerUserId:A,accountEpoch:1,retiredMessageIds:['hidden-message'],retirement:'hidden'}}));
    }, A);
    const s = await f.snapshot(); assert.ok(s.invalidations.includes("broadcast-hidden-chat")); assert.ok(s.invalidations.includes("local-hidden-chat"));
  } finally { await f.close(); }
});

test("mounted: a fresh server list allows latest RT preview persistence, but a hide retires that trust", async () => {
  const f = await fixture({ mode: "chats", seed, cached: null, offline: false }); try {
    await f.page.evaluate(() => { window.fixture.cachedChats.resolve([]);window.fixture.summaryRows=[{chat_id:'live-chat',last_message:null,unread_count:0}]; });
    await f.page.evaluate(A => window.fixture.reply('chat_members',[{chat_id:'live-chat',user_id:A,hidden_at:null,cleared_at:null}]), A);
    await settle(f.page); await f.page.evaluate(c => window.fixture.reply('chats',[c]), chat('live-chat'));
    await settle(f.page);
    await f.page.evaluate(() => {
      const c=window.fixture.channels.find(c=>c.name.endsWith(':messages'));
      c.bindings.find(b=>b.filter.event==='INSERT').callback({new:{id:'rt-message',chat_id:'live-chat',user_id:'peer',bot_id:null,type:'text',content:'Synthetic',created_at:'2026-02-01T00:00:00Z'}});
    });
    await f.page.waitForTimeout(300);
    const fresh = await f.snapshot(); assert.equal(fresh.writes.filter(w=>w.kind==='chats').at(-1)?.value[0]?.last_message?.id, 'rt-message', 'verified list must persist RT progress');
    await f.page.evaluate(() => {
      window.fixture.channels.find(c=>c.name.startsWith('hides:')).bindings.find(b=>b.filter.event==='hide').callback({payload:{chatId:'live-chat',messageId:'rt-message',hidden:true}});
      window.fixture.channels.find(c=>c.name.endsWith(':messages')).bindings.find(b=>b.filter.event==='INSERT').callback({new:{id:'new-unverified-message',chat_id:'live-chat',user_id:'peer',bot_id:null,type:'text',content:'Synthetic next',created_at:'2026-02-02T00:00:00Z'}});
    });
    await f.page.waitForTimeout(300);
    const retired = await f.snapshot(); assert.equal(retired.writes.length, fresh.writes.length, 'retired preview trust cannot repopulate disk before revalidation');
    await f.page.evaluate(() => window.fixture.retire('live-chat'));
    const scrubbed = await f.snapshot(); assert.equal(scrubbed.state.chats[0]?.id, 'live-chat', 'retirement preserves fresh RLS membership');
    assert.equal(scrubbed.state.chats[0].last_message, undefined, 'retirement removes the visible preview body even after restore completed');
  } finally { await f.close(); }
});

for (const [name, mutation, scenario] of [
  ["cached role projection", { file: "hooks/useUser.ts", from: 'role: "user"', to: 'role: "admin"' }, async f => {
    const s = await cachedEntry(f); assert.equal(s.state.currentUser.role, "user", "cache cannot grant admin");
  }],
  ["exact SDK storage fence", { file: "hooks/useUser.ts", from: "readPersistedDisplaySession()?.raw === persisted.raw", to: "true" }, async f => {
    await f.page.evaluate(s => localStorage.setItem("kub-auth", JSON.stringify(s)), session(B));
    const s = await cachedEntry(f); assert.equal(s.state.currentUser, null, "newer SDK bytes fence old display");
  }],
  ["account retirement", { file: "store/app.store.ts", from: "offlineHistory.setIdentity(null);", to: "" }, async f => {
    await cachedEntry(f);
    await f.page.evaluate(() => window.store.getState().setCurrentUser(null));
    const s = await f.snapshot(); assert.equal(s.identities.at(-1), null, "store retirement must retire disk tasks synchronously");
  }],
]) test(`compiled mutation killed by mounted behavior: ${name}`, async () => {
  const js = await buildFixture(mutation), f = await fixture({ js });
  try { await assert.rejects(() => scenario(f), error => error.code === "ERR_ASSERTION"); }
  finally { await f.close(); }
});
