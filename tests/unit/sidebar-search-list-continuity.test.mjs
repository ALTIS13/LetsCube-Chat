import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const src = join(root, "artifacts/kub/src");
const req = createRequire(join(root, "artifacts/kub/package.json"));
const { chromium } = req("@playwright/test");
const { build } = createRequire(req.resolve("vite"))("esbuild");
const tw = createRequire(req.resolve("@tailwindcss/vite"));
const { compile, optimize } = tw("@tailwindcss/node");
const { Scanner } = tw("@tailwindcss/oxide");
const output = mkdtempSync(join(tmpdir(), "letscube-search-continuity-"));
const origin = "https://search-continuity.invalid";
const sidebar = readFileSync(join(src, "components/sidebar/Sidebar.tsx"), "utf8");
const chatList = readFileSync(join(src, "components/sidebar/ChatList.tsx"), "utf8");
const chatListItem = readFileSync(join(src, "components/sidebar/ChatListItem.tsx"), "utf8");
const results = [];
let browser, bundle, css;

// Reuse the synthetic search-motion fixture's read ports, not Auth/session replay.
// All UI under test is real; only data hooks and unrelated closed surfaces differ.
const ports = new Map([
  ["@/store/app.store", `import {create} from 'zustand';
    const no=()=>{throw Error('ACTION_NOT_ADMITTED')};
    export const useAppStore=create(set=>({currentUser:{id:'synthetic-owner',username:'synthetic',full_name:'Synthetic owner'},accountEpoch:1,
      chats:[],messages:{},selectedTopicId:null,selectedChatId:null,mobileSection:'chats',searchQuery:'',mutedChatIds:[],chatSearch:null,settingsOpen:false,
      setSearchQuery:searchQuery=>set({searchQuery}),setSelectedChatId:selectedChatId=>set({selectedChatId}),
      setMobileSection:mobileSection=>set({mobileSection}),closeChatSearch:()=>set({chatSearch:null}),
      setChats:no,setMessages:no,setChatMute:no,requestChatPanel:no,openUserProfile:no,markChatRead:no,openSettings:no,closeSettings:no}));`],
  ["@/hooks/useChats", `import{useAppStore}from'@/store/app.store';export const useChats=()=>{
    const state=useAppStore();return{chats:state.chats,loading:state.fixtureLoading??false,error:'Synthetic read refusal',view:state.fixtureView??'ready',refetch(){}};};`],
  ["@/hooks/useFolders", `const value={folders:[{id:'synthetic-folder',name:'QA folder',scope:'personal'}],folderChats:{'synthetic-folder':new Set(['synthetic-chat-3'])},
    createFolder(){},updateFolder(){},deleteFolder(){},setChatsForFolder(){},canManageFolder(){return false}};export const useFolders=()=>value;`],
  ["@/hooks/useUser", `export const useSignOut=()=>()=>{throw Error('AUTH_NOT_ADMITTED')};`],
  ["@/hooks/useTheme", `export const useTheme=()=>({resolvedTheme:document.documentElement.classList.contains('light')?'light':'dark'});`],
  ["@/hooks/useRole", `const gate={checking:false,hasPermission:()=>false};export const useIsManagerOrAdmin=()=>false;
    export const usePermissionAccess=()=>gate;export const useRoleAccess=()=>({isStaff:false,isAdmin:false,checking:false});`],
  ["@/hooks/useTaskAccess", `export const useTaskAccessGate=()=>({canAccessTasks:false});`],
  ["@/hooks/useTasksInWork", `export const useTasksInWork=()=>0;`],
  ["@/hooks/useHint", `const hint={visible:false,dismiss(){}};export const useHint=()=>hint;`],
  ["@/hooks/useVoicePresence", `export const useVoicePresenceReader=()=>{};export const useChatVoicePresence=()=>null;`],
  ["@/hooks/useVoiceElsewhere", `export const useVoiceElsewhereReader=()=>{};`],
  ["@/hooks/useVoiceCall", `export const voiceCallSnapshot=()=>({channelId:null});`],
  ["@/hooks/useVoiceRing", `export const voiceRingsSnapshot=()=>[];export const startVoiceRing=()=>{throw Error('VOICE_NOT_ADMITTED')};`],
  ["@/hooks/useChatMute", `const value={prefs:{},source:'server',userId:'synthetic-owner',error:null};export const useChatMutes=()=>value;`],
  ["@/hooks/usePersonalModeration", `const value={ids:new Set(),block(){throw Error('ACTION_NOT_ADMITTED')},unblock(){throw Error('ACTION_NOT_ADMITTED')}};export const usePersonalBlocks=()=>value;`],
  ["@/hooks/usePresenceNow", `export const usePresenceNow=()=>0;`],
  ["@/hooks/useMediaVariants", `const settled={variant:{},settled:true},empty={};export const useAvatarVariantUrls=()=>empty;export const useAvatarVariant=()=>settled;export const useChatAvatarVariant=()=>settled;`],
  ["@/hooks/useMediaObjectUrl", `export const useAvatarMediaUrl=url=>url??null;`],
  ["@/hooks/useConnectionState", `export const useConnectionState=()=> 'online';`],
  ["@/hooks/useNotifications", `const value={items:[],loading:false,error:null,markRead(){},markReadIds(){},markMessageNotificationsForChatRead(){},markAllRead(){},refresh(){}};export const useNotifications=()=>value;`],
  ["@/hooks/useGlobalSearch", `import{useMemo}from'react';export{getLocalChatSearchResults}from'./hooks/useGlobalSearch';
    export const useGlobalSearch=({query})=>useMemo(()=>({results:query?[{resultType:'chat',id:'fresh-'+query,chatId:'synthetic-chat-7',title:'Fresh '+query,subtitle:'Synthetic result',score:1}]:[],
      loading:false,error:null,migrationMissing:false,filtersLimited:false,phoneLimited:false}),[query]);`],
  ["@/hooks/useChatMessageSearch", `import{useState}from'react';import{parseAdvancedSearchQuery}from'./lib/searchQuery';
    export function useChatMessageSearch(){const[query,setQuery]=useState('');const[allTopics,setAllTopics]=useState(false);
      return{query,setQuery,parsed:parseAdvancedSearchQuery(query,'message'),canSearch:!!query,results:[],total:0,idx:0,jumpTo(){},loading:false,rpcMissing:false,allTopics,setAllTopics};}`],
  ["@/lib/supabase/client", `const client=new Proxy({}, {get(){throw Error('NETWORK_NOT_ADMITTED')}});export const createClient=()=>client;export const isSupabaseConfigured=()=>false;`],
  ["@/lib/dev/instrumentation", `export const bumpMount=name=>window.mounts[name]=(window.mounts[name]??0)+1;export const bumpUnmount=name=>window.unmounts[name]=(window.unmounts[name]??0)+1;`],
]);
const closedLeaves = new Map([
  ["PwaPushNudge", ["PwaPushNudge"]], ["VoiceElsewhereBar", ["VoiceElsewhereBar"]], ["SideMenuLayer", ["SideMenuLayer"]],
  ["NewChatModal", ["NewChatModal"]], ["NewGroupModal", ["NewGroupModal"]], ["FolderEditModal", ["FolderEditModal"]],
  ["UserPanel", ["UserPanel"]], ["SettingsSurface", ["SettingsSurface"]], ["ChatMediaPlayback", ["ListPlaybackBar"]],
]);

async function buildFixture(source = sidebar, listSource = chatList, itemSource = chatListItem) {
  const built = await build({ write: false, bundle: true, format: "iife", platform: "browser", jsx: "automatic", outdir: join(output, "bundle"), alias: { "@": src },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify({ DEV: false, VITE_KUB_QA_ALLOW_MUTATIONS: "0", VITE_SUPABASE_URL: origin, VITE_SUPABASE_ANON_KEY: "synthetic-unused" }) },
    plugins: [{ name: "synthetic-read-ports", setup(p) {
      p.onResolve({ filter: /.*/ }, args => {
        if (ports.has(args.path)) return { path: args.path, namespace: "ports" };
        const leaf = args.path.split("/").at(-1)?.replace(/\.tsx$/, "");
        if (closedLeaves.has(leaf) || leaf === "VoiceCallBar" || leaf === "ContactsPanel") return { path: leaf, namespace: "closed" };
      });
      p.onLoad({ filter: /.*/, namespace: "ports" }, args => ({ contents: ports.get(args.path), loader: "tsx", resolveDir: src }));
      p.onLoad({ filter: /.*/, namespace: "closed" }, args => ({ loader: "tsx", resolveDir: src, contents:
        args.path === "VoiceCallBar" ? `export const VoiceCallBar=()=> <button data-testid="synthetic-call">Synthetic ongoing call</button>;`
          : args.path === "ContactsPanel" ? `export const ContactsPanel=()=> <div data-testid="synthetic-contacts">Synthetic contacts</div>;`
            : closedLeaves.get(args.path).map(name => `export const ${name}=()=>null;`).join("\n") }));
      p.onLoad({ filter: /[/\\]Sidebar\.tsx$/ }, args => ({ contents: source, loader: "tsx", resolveDir: dirname(args.path) }));
      p.onLoad({ filter: /[/\\]ChatList\.tsx$/ }, args => ({ contents: listSource, loader: "tsx", resolveDir: dirname(args.path) }));
      p.onLoad({ filter: /[/\\]ChatListItem\.tsx$/ }, args => ({ contents: itemSource, loader: "tsx", resolveDir: dirname(args.path) }));
    } }],
    stdin: { resolveDir: src, sourcefile: "search-continuity-fixture.tsx", loader: "tsx", contents: `
      import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
      import{Sidebar}from'./components/sidebar/Sidebar';import{useAppStore}from'@/store/app.store';import{TooltipProvider}from'./components/ui/tooltip';
      const root=createRoot(document.getElementById('root'));window.mounts={};window.unmounts={};window.store=useAppStore;
      window.patch=value=>flushSync(()=>useAppStore.setState(value));
      window.mount=()=>{window.patch({chats:Array.from({length:32},(_,i)=>({id:'synthetic-chat-'+i,type:'group',name:'Synthetic chat '+String(i+1).padStart(2,'0'),
        avatar_url:null,created_by:'synthetic-owner',created_at:'2026-10-19T00:00:00Z',updated_at:'2026-10-19T00:00:00Z',is_forum:false,
        invite_policy:'owner_admin_only',members:[],last_message:null,unread_count:i===0?1:0,is_pinned:false}))});
        flushSync(()=>root.render(<TooltipProvider><Sidebar/></TooltipProvider>));};
      window.remember=()=>{window.originalScroller=document.querySelector('[data-testid=chat-list-scroller]');
        window.originalRow=window.originalScroller.querySelectorAll('[data-testid=chat-list-item]')[7];};
      window.measure=()=>{const scroller=document.querySelector('[data-testid=chat-list-scroller]');const r=scroller?.getBoundingClientRect();
        return{same:scroller===window.originalScroller,rowSame:!!scroller&&scroller.contains(window.originalRow),top:scroller?.scrollTop,
          y:r?.top,height:r?.height,anchor:window.originalRow?.getBoundingClientRect().top,mounts:window.mounts.ChatList??0,unmounts:window.unmounts.ChatList??0};};
      window.dispose=()=>flushSync(()=>root.unmount());
    ` },
  });
  return built.outputFiles.find(file => file.path.endsWith(".js")).text;
}

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  bundle = await buildFixture();
  const compiler = await compile(readFileSync(join(src, "index.css"), "utf8"), { base: src, onDependency() {} });
  css = optimize(compiler.build(new Scanner({}).scanFiles([{ content: bundle, extension: "js" }, { content: "h-screen w-full md:w-[432px] invisible pointer-events-none hidden", extension: "html" }]))).code;
  browser = await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
});
test.after(async () => {
  await browser?.close();
  writeFileSync(join(output, "metadata.json"), JSON.stringify({ syntheticOnly: true, auth: false, network: "fictional-origin exact local assets only; client API throws", browserFallback: "Browser plugin not available",
    sourceSha256: createHash("sha256").update(sidebar).digest("hex"), chatListSha256: createHash("sha256").update(chatList).digest("hex"),
    chatListItemSha256: createHash("sha256").update(chatListItem).digest("hex"), results }, null, 2));
  console.log(`Search continuity evidence: ${output}`);
});

async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.waitForTimeout(80); }
async function fixture(width = 1440, theme = "light", js = bundle) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: "block" });
  const page = await context.newPage(), errors = [], unexpected = [];
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && route.request().method() === "GET") {
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html class="${theme}" lang="ru"><head><meta charset="utf-8"><title>Synthetic search continuity</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="frame" class="h-screen w-full md:w-[432px]"><div id="root" class="h-screen"></div></div><script src="/fixture.js"></script></body></html>` });
      if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: js });
      if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
      if (/^\/fonts\/inter\/inter-(latin|latin-ext|cyrillic|cyrillic-ext)\.woff2$/.test(url.pathname) || /^\/brand\/[a-zA-Z0-9._/-]+\.(svg|png|webp)$/.test(url.pathname)) {
        const publicRoot = resolve(root, "artifacts/kub/public"), file = resolve(publicRoot, "." + url.pathname);
        assert.ok(file.replaceAll("\\", "/").startsWith(publicRoot.replaceAll("\\", "/") + "/"));
        return route.fulfill({ contentType: url.pathname.endsWith("woff2") ? "font/woff2" : url.pathname.endsWith("svg") ? "image/svg+xml" : "image/png", body: readFileSync(file) });
      }
    }
    unexpected.push("unlisted-request"); return route.abort();
  });
  await page.goto(origin); await page.evaluate(() => window.mount());
  await page.getByTestId("chat-list-item").nth(31).waitFor(); await page.evaluate(() => document.fonts.ready); await settle(page);
  return { page, context, errors, unexpected, width, theme };
}
async function dispose(f) {
  try { await f.page.evaluate(() => window.dispose()); assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []); }
  finally { await f.context.close(); }
}
async function prepare(f, top = 160) {
  const field = f.page.getByTestId("sidebar-search-input");
  // Untuck before the reference measurement: equal final chrome means equal scrollTop.
  if (f.width < 768) { await field.focus(); await field.press("Escape"); }
  await f.page.getByTestId("chat-list-scroller").evaluate((n, top) => { n.scrollTop = top; }, top); await settle(f.page);
  if (f.width < 768 && await f.page.getByRole("button", { name: "Поиск", exact: true }).count()) {
    await f.page.getByRole("button", { name: "Поиск", exact: true }).click(); await field.press("Escape"); await settle(f.page);
  }
  await f.page.evaluate(() => window.remember());
  return f.page.evaluate(() => window.measure());
}
async function hiddenList(f) {
  const measure = await f.page.evaluate(() => window.measure());
  assert.equal(measure.same, true, "search must retain the original ChatList scroller DOM");
  assert.equal(measure.rowSame, true, "search must retain original row DOM");
  assert.ok(measure.height > 100 && measure.y > 0, "hidden list must retain real geometry, not display:none");
  const layer = f.page.locator("[data-sidebar-main-list]");
  assert.equal(await layer.getAttribute("aria-hidden"), "true");
  assert.equal(await layer.evaluate(n => n.inert), true);
  assert.equal(await layer.evaluate(n => getComputedStyle(n).visibility), "hidden");
  assert.equal(await f.page.getByTestId("synthetic-call").isVisible(), true, "search does not hide ongoing calls");
  await f.page.getByTestId("chat-list-scroller").getByTestId("chat-list-item").first().evaluate(n => n.focus());
  assert.equal(await layer.evaluate(n => n.contains(document.activeElement)), false, "inert rows cannot take focus");
  assert.equal(await f.page.getByRole("button", { name: /Synthetic chat 02/ }).count(), 0, "hidden rows are absent from accessibility navigation");
  const hit = await f.page.evaluate(() => {
    const n = document.querySelector('[data-testid="chat-list-scroller"]'), r = n.getBoundingClientRect();
    return n.contains(document.elementFromPoint(r.x + 20, r.y + 20));
  });
  assert.equal(hit, false, "hidden rows cannot intercept pointer hits");
  return measure;
}
function continuity(before, after) {
  assert.equal(after.same, true, "same scroller after search exit"); assert.equal(after.rowSame, true);
  assert.equal(after.mounts, 1, "no extra ChatList mount"); assert.equal(after.unmounts, 0);
  assert.ok(Math.abs(after.y - before.y) < 1, "compare scroll only under the same final chrome geometry");
  assert.ok(Math.abs(after.top - before.top) < 1, `scroll reset/drift: ${before.top} -> ${after.top}`);
  assert.ok(Math.abs(after.anchor - before.anchor) < 1, "visible row anchor remains in place");
}

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) test(`${width} ${theme}: unread QuickSwitch and global query clear retain list DOM and anchor`, async () => {
  const f = await fixture(width, theme);
  try {
    const before = await prepare(f), field = f.page.getByTestId("sidebar-search-input");
    await field.focus(); await f.page.getByTestId("quick-switch").waitFor(); await settle(f.page);
    const during = await hiddenList(f);
    assert.ok(Math.abs(during.anchor - before.anchor) < 1, "opening empty search must not shift the retained anchor");
    await field.press("Tab");
    assert.equal(await f.page.locator("[data-sidebar-main-list]").evaluate(n => n.contains(document.activeElement)), false, "Tab cannot enter inactive list");
    await field.focus(); await field.press("Escape"); await settle(f.page);
    const afterQuick = await f.page.evaluate(() => window.measure()); continuity(before, afterQuick);
    await field.focus(); await field.fill("remote-first");
    await f.page.getByText("Fresh remote-first", { exact: true }).waitFor(); await settle(f.page); await hiddenList(f);
    await field.fill("remote-second"); await f.page.getByText("Fresh remote-second", { exact: true }).waitFor();
    assert.equal(await f.page.getByText("Fresh remote-first", { exact: true }).count(), 0, "fresh query results replace earlier results");
    await field.press("Escape"); await field.press("Escape"); await settle(f.page);
    const afterGlobal = await f.page.evaluate(() => window.measure()); continuity(before, afterGlobal);
    await f.page.screenshot({ path: join(output, `${width}-${theme}-restored.png`) });
    await field.focus(); await settle(f.page); await f.page.waitForTimeout(160);
    await f.page.screenshot({ path: join(output, `${width}-${theme}-quick.png`) });
    assert.equal(await f.page.title(), "Synthetic search continuity");
    results.push({ width, theme, before, during, afterQuick, afterGlobal, errors: f.errors, unexpected: f.unexpected });
  } finally { await dispose(f); }
});

for (const top of [0, 60]) test(`phone at ${top}px: query clear preserves position without false observer deltas`, async () => {
  const f = await fixture(390, "light"); try {
    const before = await prepare(f, top), field = f.page.getByTestId("sidebar-search-input");
    for (const query of ["remote-first", "remote-second"]) {
      await field.focus(); await field.fill(query); await settle(f.page);
      const during = await hiddenList(f);
      if (top > 0) assert.ok(Math.abs(during.anchor - before.anchor) < 1, "FolderTabs height change must compensate the pixel anchor");
      else assert.equal(during.top, 0, "at the top the natural scroll floor applies");
      await field.press("Escape"); await field.press("Escape"); await settle(f.page);
      continuity(before, await f.page.evaluate(() => window.measure()));
    }
  } finally { await dispose(f); }
});

test("desktop in-chat search yields to a global query and restores the same main list", async () => {
  const f = await fixture(); try {
    const before = await prepare(f);
    await f.page.evaluate(() => window.patch({ selectedChatId: "synthetic-chat-5", chatSearch: { chatId: "synthetic-chat-5" } }));
    await f.page.getByTestId("sidebar-chat-search").waitFor(); await hiddenList(f);
    await f.page.getByTestId("sidebar-search-input").fill("remote-first"); await f.page.getByText("Fresh remote-first", { exact: true }).waitFor();
    assert.equal(await f.page.getByTestId("sidebar-chat-search").count(), 0);
    await f.page.getByTestId("sidebar-search-input").press("Escape");
    await f.page.getByTestId("sidebar-search-input").press("Escape");
    await f.page.getByTestId("sidebar-chat-search").waitFor(); await hiddenList(f);
    await f.page.getByTestId("chat-search-close").click(); await settle(f.page);
    continuity(before, await f.page.evaluate(() => window.measure()));
  } finally { await dispose(f); }
});

test("QuickSwitch keyboard/click selection works while the hidden list menu cannot intercept search", async () => {
  const f = await fixture(); try {
    await prepare(f);
    const row = f.page.getByTestId("chat-list-scroller").getByTestId("chat-list-item").nth(7);
    await row.click({ button: "right" }); await f.page.locator('[data-chat-context-menu="desktop"]').waitFor();
    // A menu normally covers the field: focus programmatically models another ordinary search opener.
    const field = f.page.getByTestId("sidebar-search-input"); await field.focus(); await f.page.getByTestId("quick-switch").waitFor();
    await hiddenList(f);
    assert.equal(await f.page.locator("[data-chat-context-menu]").count(), 0, "inactive list retires its fixed menu descendants");
    await f.page.evaluate(() => window.addEventListener("keydown", e => { window.hiddenMenuPreventedEscape = e.defaultPrevented; }, { once: true }));
    await field.press("Escape");
    assert.equal(await f.page.evaluate(() => window.hiddenMenuPreventedEscape), false, "inactive menu has no global Escape interception");
    assert.equal(await f.page.locator("[data-chat-context-menu]").count(), 0, "Escape must not resurrect the menu");
    await field.focus();
    await field.press("ArrowDown"); await field.press("Enter"); await settle(f.page);
    assert.equal(await f.page.evaluate(() => window.store.getState().selectedChatId), "synthetic-chat-0");
    assert.equal(await f.page.locator("[data-chat-context-menu]").count(), 0, "search exit must not resurrect the old menu");
    await f.page.evaluate(() => window.patch({ selectedChatId: null }));
    await field.focus(); await f.page.getByTestId("quick-switch").getByTestId("chat-list-item").first().click();
    assert.equal(await f.page.getByTestId("quick-switch").count(), 0);
  } finally { await dispose(f); }
});

test("UID and same-UID epoch retirement discard retained menu/row state", async () => {
  const f = await fixture(); try {
    for (const sameUid of [true, false]) {
      await f.page.getByTestId("chat-list-scroller").getByTestId("chat-list-item").first().click({ button: "right" });
      await f.page.locator("[data-chat-context-menu]").waitFor();
      const prior = await f.page.getByTestId("chat-list-scroller").elementHandle();
      await f.page.evaluate(sameUid => { const s = window.store.getState(); window.patch({ accountEpoch: s.accountEpoch + 1,
        currentUser: { ...s.currentUser, id: sameUid ? s.currentUser.id : "synthetic-next-owner" } }); }, sameUid);
      await settle(f.page);
      assert.equal(await prior.evaluate(n => n.isConnected), false, "retirement must remove the old owner DOM, even if IDs are reused");
      assert.equal(await f.page.locator("[data-chat-context-menu]").count(), 0, "old menu/mute/invite state is retired");
    }
  } finally { await dispose(f); }
});

test("loading/unavailable/stale, folder and contacts policies remain effective", async () => {
  const f = await fixture(); try {
    await f.page.evaluate(() => window.patch({ fixtureLoading: true }));
    assert.equal(await f.page.getByTestId("chat-list-scroller").count(), 0);
    await f.page.evaluate(() => window.patch({ fixtureLoading: false, fixtureView: "unavailable" }));
    await f.page.getByTestId("chat-list-unavailable").waitFor(); assert.equal(await f.page.getByTestId("chat-list-scroller").count(), 0);
    await f.page.evaluate(() => window.patch({ fixtureView: "stale" })); await f.page.getByTestId("chat-list-stale").waitFor();
    assert.equal(await f.page.getByTestId("chat-list-scroller").getByTestId("chat-list-item").count(), 32);
    await f.page.getByRole("button", { name: /QA folder/ }).click();
    assert.equal(await f.page.getByTestId("chat-list-scroller").getByTestId("chat-list-item").count(), 1);
    await f.page.evaluate(() => window.patch({ mobileSection: "contacts" })); await f.page.getByTestId("synthetic-contacts").waitFor();
    assert.equal(await f.page.getByTestId("chat-list-scroller").count(), 0);
  } finally { await dispose(f); }
});

function omit(source, from, to) {
  assert.equal(source.split(from).length, 2, "omission must alter exactly one real source site");
  return source.replace(from, to);
}
for (const [name, replacement, message] of [
  ["visible inactive layer", "", /visibility|hidden/],
  ["display:none inactive layer", " hidden", /retain real geometry/],
]) test(`loaded omission refuses ${name}`, async () => {
  const js = await buildFixture(omit(sidebar, ' invisible pointer-events-none', replacement));
  const f = await fixture(390, "light", js); try {
    await prepare(f); await f.page.getByTestId("sidebar-search-input").focus(); await settle(f.page);
    await assert.rejects(() => hiddenList(f), message);
  } finally { await dispose(f); }
});

test("loaded omission catches menu resurrection when the retained list never becomes inactive", async () => {
  const js = await buildFixture(omit(sidebar, "active={!listReplaced}", ""));
  const f = await fixture(1440, "light", js); try {
    await f.page.getByTestId("chat-list-scroller").getByTestId("chat-list-item").first().click({ button: "right" });
    await f.page.locator("[data-chat-context-menu]").waitFor(); await f.page.getByTestId("sidebar-search-input").focus(); await settle(f.page);
    await assert.rejects(async () => assert.equal(await f.page.locator("[data-chat-context-menu]").count(), 0, "retire inactive context menu"), /retire inactive context menu/);
  } finally { await dispose(f); }
});

test("loaded omission catches old owner menu/DOM surviving an epoch retirement", async () => {
  const js = await buildFixture(omit(sidebar, "key={`${userId}:${accountEpoch}`}", 'key="unowned-list"'));
  const f = await fixture(1440, "light", js); try {
    const prior = await f.page.getByTestId("chat-list-scroller").elementHandle();
    await f.page.evaluate(() => window.patch({ accountEpoch: 2 })); await settle(f.page);
    await assert.rejects(async () => assert.equal(await prior.evaluate(n => n.isConnected), false, "old owner DOM must retire"), /old owner DOM must retire/);
  } finally { await dispose(f); }
});

test("loaded omission catches a clipped negative chrome delta returning as invented scroll", async () => {
  const js = await buildFixture(sidebar, omit(chatList, "clippedChromeDeltaRef.current = Math.min(0, targetTop)", "clippedChromeDeltaRef.current = 0"));
  const f = await fixture(390, "light", js); try {
    const before = await prepare(f, 0), field = f.page.getByTestId("sidebar-search-input");
    await field.fill("remote-first"); await settle(f.page); await field.press("Escape"); await field.press("Escape"); await settle(f.page);
    await assert.rejects(async () => continuity(before, await f.page.evaluate(() => window.measure())), /scroll reset\/drift/);
  } finally { await dispose(f); }
});

async function touchClock(f) {
  const time = new Date("2030-01-01T00:00:00Z");
  await f.page.clock.install({ time }); await f.page.clock.pauseAt(time);
  // Observe the actual row's literal520ms timer without replacing its callback.
  await f.page.evaluate(() => {
    const schedule = window.setTimeout.bind(window), cancel = window.clearTimeout.bind(window);
    window.touchProbe = { pending: new Set(), delivered: 0 };
    window.setTimeout = (callback, delay, ...args) => {
      const id = schedule(() => {
        if (delay === 520) { window.touchProbe.pending.delete(id); window.touchProbe.delivered++; }
        callback(...args);
      }, delay);
      if (delay === 520) window.touchProbe.pending.add(id);
      return id;
    };
    window.clearTimeout = id => { window.touchProbe.pending.delete(id); cancel(id); };
  });
}
async function startTouch(f) {
  await f.page.getByTestId("chat-list-scroller").getByTestId("chat-list-item").first().dispatchEvent("pointerdown", {
    pointerType: "touch", pointerId: 1, isPrimary: true, clientX: 100, clientY: 140, buttons: 1,
  });
  assert.equal(await f.page.evaluate(() => window.touchProbe.pending.size), 1, "a real row long-press timer was scheduled");
}
async function retireTouchThroughSearch(f, returnBeforeDeadline) {
  await touchClock(f); await startTouch(f); await f.page.clock.runFor(100);
  await f.page.keyboard.press("Control+k"); await f.page.clock.runFor(1);
  assert.equal(await f.page.getByTestId("quick-switch").count(), 1, "actual Ctrl+K made the main list inactive");
  const field = f.page.getByTestId("sidebar-search-input");
  if (returnBeforeDeadline) await field.press("Escape");
  await f.page.clock.runFor(600);
  if (!returnBeforeDeadline) await field.evaluate(n => n.blur());
  assert.equal(await f.page.locator("[data-chat-context-menu]").count(), 0, "retired touch timer must not resurrect a mobile sheet");
  assert.equal(await f.page.evaluate(() => window.touchProbe.delivered), 0, "retired callback must not set click suppression either");
  assert.equal(await f.page.evaluate(() => window.touchProbe.pending.size), 0);
}
async function freshTouchAndClick(f) {
  const row = f.page.getByTestId("chat-list-scroller").getByTestId("chat-list-item").nth(7);
  await row.click();
  assert.equal(await f.page.evaluate(() => window.store.getState().selectedChatId), "synthetic-chat-7", "fresh normal click is not suppressed by a retired timer");
  const before = await f.page.evaluate(() => window.touchProbe.delivered);
  await startTouch(f); await f.page.clock.runFor(521);
  assert.equal(await f.page.locator('[data-chat-context-menu="mobile"]').count(), 1, "a fresh long-press still opens its sheet");
  assert.equal(await f.page.evaluate(() => window.touchProbe.delivered), before + 1);
  await f.page.keyboard.press("Escape");
}

test("pending touch: search remains inactive past520ms and cannot resurrect the old sheet", async () => {
  const f = await fixture(); try {
    await retireTouchThroughSearch(f, false); await freshTouchAndClick(f);
    results.push({ pendingTouch: "deadline while inactive", oldCallbacksDelivered: 0, freshTouchAndClick: true });
  } finally { await dispose(f); }
});

test("pending touch: inactive-active before520ms, account retirement and unmount retire the original timer", async () => {
  const f = await fixture(); try {
    await retireTouchThroughSearch(f, true);
    for (const retirement of ["epoch", "uid", "unmount"]) {
      await startTouch(f); await f.page.clock.runFor(100);
      await f.page.evaluate(retirement => {
        const s = window.store.getState();
        window.patch(retirement === "unmount" ? { mobileSection: "contacts" } : {
          accountEpoch: s.accountEpoch + 1, currentUser: { ...s.currentUser, id: retirement === "uid" ? "synthetic-next-owner" : s.currentUser.id },
        });
      }, retirement);
      await f.page.clock.runFor(600);
      assert.equal(await f.page.evaluate(() => window.touchProbe.delivered), 0, `${retirement}: no callback after old row retirement`);
      assert.equal(await f.page.evaluate(() => window.touchProbe.pending.size), 0);
      assert.equal(await f.page.locator("[data-chat-context-menu]").count(), 0);
      if (retirement === "unmount") await f.page.evaluate(() => window.patch({ mobileSection: "chats" }));
    }
    await freshTouchAndClick(f);
    results.push({ pendingTouch: "return before deadline + epoch/uid/unmount", oldCallbacksDelivered: 0, freshTouchAndClick: true });
  } finally { await dispose(f); }
});

test("pending touch omission: pointerdown active checks alone cannot retire an earlier timer", async () => {
  const lifecycle = `  useLayoutEffect(() => {
    if (!interactionActive) {
      clearLongPressTimer();
      suppressClickRef.current = false;
    }
    return clearLongPressTimer;
  }, [interactionActive, clearLongPressTimer]);`;
  const js = await buildFixture(sidebar, chatList, omit(chatListItem, lifecycle, ""));
  const f = await fixture(1440, "light", js); try {
    await assert.rejects(() => retireTouchThroughSearch(f, true), /retired touch timer must not resurrect a mobile sheet/);
  } finally { await dispose(f); }
});
