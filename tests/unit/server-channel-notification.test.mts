import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const kub = fileURLToPath(new URL("../../artifacts/kub/", import.meta.url));
const src = resolve(kub, "src"), requireKub = createRequire(resolve(kub, "package.json"));
const { build } = createRequire(requireKub.resolve("vite"))("esbuild"), ts = requireKub("typescript");
const U = "10000000-0000-4000-8000-000000000001", C = "30000000-0000-4000-8000-000000000001";
const A = "40000000-0000-4000-8000-000000000001", B = "40000000-0000-4000-8000-000000000002";
let browser: any, bundle: string, css: string;

async function compile(change?: { file: string; before: string; after: string }) {
  const text = readFileSync(resolve(src, "components/chat/ChatWindow.tsx"), "utf8");
  const tree = ts.createSourceFile("ChatWindow.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map<string, string>();
  let producer = "", dialog = "function ChannelNotificationDialog(){return null;}", dialogElement = "null", railAction = "undefined";
  function visit(node: any) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "currentTopicNotificationScope") producer = node.getText(tree).replace(/^export /, "");
    if (ts.isFunctionDeclaration(node) && node.name?.text === "ChannelNotificationDialog") dialog = node.getText(tree).replace(/^export /, "");
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      const name = declaration.name.getText(tree);
      for (const target of ["railNotification", "railNotificationScope", "openChannelNotifications"]) {
        if (name === target || (target === "railNotification" && name === "[railNotification, setRailNotification]")) declarations.set(target, node.getText(tree));
      }
      if (name === "railProps" && ts.isObjectLiteralExpression(declaration.initializer)) {
        const property = declaration.initializer.properties.find((p: any) => p.name?.getText(tree) === "onNotifications");
        if (property) railAction = property.initializer.getText(tree);
      }
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "ChannelNotificationDialog") dialogElement = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(producer, "actual canonical scope producer must be extracted");
  const boundary = [declarations.get("railNotification") ?? "const [railNotification, setRailNotification] = useState(null);",
    declarations.get("railNotificationScope") ?? "const railNotificationScope = null;",
    declarations.get("openChannelNotifications") ?? "const openChannelNotifications = undefined;"].join("\n");
  const boundaries = new Map([
    ["store/app.store.ts", `import{create}from'zustand';export const useAppStore=create(()=>({
      currentUser:{id:'${U}'},accountEpoch:1,selectedChatId:'${C}',selectedTopicId:'${A}',topicNotificationPreferences:{},
      chatMutes:{userId:'${U}',source:'server',error:null,prefs:{}},parentMuted:true}));window.store=useAppStore;`],
    ["lib/supabase/client.ts", `const client={rpc(name,args){
      if(!['topic_notification_preferences_read','topic_notification_preference_set'].includes(name))throw Error('unexpected fixture RPC');
      window.requests.push({name,args});
      const data=name==='topic_notification_preferences_read'?[{scope_key:'${B}',mode:'inherit',revision:7}]:
        {status:'applied',scope_key:args.p_topic_id??'general',mode:args.p_mode,revision:args.p_expected_revision+1};
      const result=Promise.resolve({data,error:null});result.abortSignal=()=>result;return result;
    },channel(name){const ch={name,on(){return ch;},subscribe(status){queueMicrotask(()=>status('SUBSCRIBED'));return ch;}};return ch;},removeChannel:async()=> 'ok'};
    export const createClient=()=>client;export const isSupabaseConfigured=()=>false;`],
    ["hooks/useChatMute.ts", `import{useAppStore}from'@/store/app.store';export function useChatMute(){return{state:{muted:useAppStore(s=>s.parentMuted)}};}`],
    ["components/chat/VoiceOccupantMenu.tsx", "export const useVoiceOccupantMenu=()=>({element:null}); export const voiceOccupantOffer=()=>({offers:false}); export const LocalMuteMark=()=>null;"],
    ["components/chat/MessageReactions.tsx", "export const TinyUserAvatar=()=>null;"],
    ["components/chat/VoiceSpeakingAvatar.tsx", "export const VoiceSpeakingAvatar=({children})=>children;"],
  ]);
  const result = await build({ write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic", metafile: true,
    alias: { "@": src }, define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false", "import.meta.env.BASE_URL": '"/"' },
    plugins: [{ name: "fictional-channel-notification-ports", setup(plugin: any) {
      plugin.onLoad({ filter: /\.[tj]sx?$/ }, (args: any) => {
        const relative = args.path.slice(src.length + 1).replaceAll("\\", "/");
        if (boundaries.has(relative)) return { contents: boundaries.get(relative), loader: "tsx", resolveDir: dirname(args.path) };
        if (change?.file === relative) {
          const source = readFileSync(args.path, "utf8").replaceAll("\r\n", "\n");
          assert.equal(source.split(change.before).length - 1, 1, "mutation must select the actual production branch once");
          return { contents: source.replace(change.before, change.after), loader: "tsx", resolveDir: dirname(args.path) };
        }
      });
    } }], stdin: { resolveDir: kub, loader: "tsx", contents: `
      import React,{useState,useCallback,useRef,useEffect} from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
      import{ChannelRail,ChannelRailSheet}from'./src/components/chat/ChannelRail';
      import{TopicNotificationControl}from'./src/components/chat/TopicNotificationControl';
      import{KubModal}from'./src/components/kub/KubModal';import{useChatMute}from'./src/hooks/useChatMute';
      import{useAppStore}from'./src/store/app.store';import{canonicalTopicNotificationScope}from'./src/lib/topicNotificationPreferences';
      import{GENERAL_CHANNEL_NAME,topicIdForChannel,textChannelFromTopic,withGeneralChannel}from'./src/lib/channelRail';
      import{buildChannelTree}from'./src/lib/serverChannels';
      ${producer}\n${dialog}
      window.requests=[];window.navigation=[];
      let input={topics:[{id:'${A}',chat_id:'${C}',name:'Обсуждения',is_general:false,archived:false},
        {id:'${B}',chat_id:'${C}',name:'Обновления проекта',is_general:false,archived:false}]};
      function Boundary(){const [railOpen,setRailOpen]=useState(true);const s=useAppStore(),userId=s.currentUser?.id??null,accountEpoch=s.accountEpoch,
        chatId='${C}',chat={id:chatId,type:'group',is_forum:true,name:'Fictional server'},
        topicsEnabled=true,topicSnapshot={userId:input.snapshotUserId??'${U}',accountEpoch:input.snapshotEpoch??1,chatId,topics:input.topics};
        ${boundary}
        window.openNotifications=${railAction};
        const channels=withGeneralChannel(input.topics.map(textChannelFromTopic));
        const props={groups:buildChannelTree({channels,categories:[]}),currentTextChannelId:'${A}',occupantsOf:()=>[],selfId:userId,role:'member',
          callChannelId:null,elsewhereChannelId:null,joining:false,onSelectText:channel=>{window.navigation.push(channel.id);},onJoinVoice:()=>{throw Error('no voice effects');},
          onNotifications:${railAction}};
        return <><div className="kub-chat-screen flex h-screen">{window.innerWidth<640?(railOpen&&<ChannelRailSheet {...props} onClose={()=>setRailOpen(false)}/>):<ChannelRail {...props}/>}</div>
          {railNotificationScope && ${dialogElement}}</>;
      }
      const root=createRoot(document.getElementById('root'));window.render=patch=>{input={...input,...patch};flushSync(()=>root.render(<Boundary/>));};
      window.unmount=()=>flushSync(()=>root.unmount());window.render();
    ` } });
  const { compile } = createRequire(requireKub.resolve("@tailwindcss/vite"))("@tailwindcss/node");
  const compiler = await compile(readFileSync(resolve(src, "index.css"), "utf8"), { base: src, onDependency() {} });
  const candidates = new Set<string>();
  for (const path of Object.keys(result.metafile.inputs)) {
    const absolute = resolve(path);
    if (absolute.startsWith(src)) for (const token of readFileSync(absolute, "utf8").match(/[^\s"'`]+/g) ?? []) candidates.add(token);
  }
  for (const token of ["flex", "h-screen"]) candidates.add(token);
  css = compiler.build([...candidates]);
  return result.outputFiles[0].text;
}

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  bundle = await compile(); browser = await requireKub("@playwright/test").chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); });
async function fixture(width = 1440, theme = "dark", code = bundle) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage(), network: string[] = [], faults: string[] = [];
  page.setDefaultTimeout(2000);
  page.on("pageerror", (error: any) => faults.push(error.message));
  await page.route("**/*", (route: any) => {
    const url = new URL(route.request().url());
    if (url.origin === "https://channel-notifications.invalid" && url.pathname === "/") return route.fulfill({ contentType: "text/html",
      body: `<html class="${theme}" style="color-scheme:${theme}"><body><div id="root"></div></body></html>` });
    if (url.pathname.startsWith("/fonts/inter/")) return route.fulfill({ contentType: "font/woff2", body: readFileSync(resolve(kub, "public" + url.pathname)) });
    network.push("unexpected request"); return route.abort();
  });
  await page.goto("https://channel-notifications.invalid/");
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: code });
  await page.evaluate(() => document.fonts.ready);
  const writes = () => page.evaluate(() => (window as any).requests.filter((r: any) => r.name === "topic_notification_preference_set").map((r: any) => r.args));
  return { page, writes, async close() {
    try { await page.evaluate(() => (window as any).unmount()); assert.deepEqual(network, []); assert.deepEqual(faults, []); }
    finally { await context.close(); }
  } };
}

async function chosenRow(f: any) {
    const bell = f.page.getByRole("button", { name: "Уведомления канала «Обновления проекта»", exact: true });
    assert.equal(await bell.count(), 1, "each text channel needs an independent notification affordance");
    await bell.click();
    assert.equal(await f.page.getByRole("dialog", { name: "Уведомления канала", exact: true }).count(), 1);
    await f.page.waitForFunction(() => document.querySelector("fieldset")?.disabled === false);
    await f.page.locator('input[value="disabled"]').click();
    assert.deepEqual(await f.writes(), [{ p_chat_id: C, p_topic_id: B, p_mode: "disabled", p_expected_revision: 7 }]);
    assert.deepEqual(await f.page.evaluate(() => (window as any).navigation), []);
}

test("a row bell opens the chosen channel without selecting it and sends only its existing CAS", async () => {
  const f = await fixture();
  try { await chosenRow(f); } finally { await f.close(); }
});

test("desktop row context menu opens notifications for that exact row", async () => {
  const f = await fixture();
  try {
    await f.page.locator(`[data-testid="channel-rail-text"][data-channel-id="${B}"]`).click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Уведомления канала", exact: true }).click();
    assert.equal(await f.page.getByRole("dialog", { name: "Уведомления канала", exact: true }).count(), 1);
    assert.deepEqual(await f.page.evaluate(() => (window as any).navigation), []);
  } finally { await f.close(); }
});

test("mobile Escape closes only the notification modal and retains its channel list", async () => {
  const f = await fixture(390);
  try {
    await f.page.getByRole("button", { name: "Уведомления канала «Общие»", exact: true }).click();
    const modal = f.page.getByRole("dialog", { name: "Уведомления канала", exact: true });
    assert.equal(await modal.count(), 1);
    await f.page.keyboard.press("Escape");
    assert.equal(await modal.count(), 0);
    assert.equal(await f.page.getByTestId("channel-rail-sheet").count(), 1,
      "one Escape must not dismiss the underlying channel list as well");
    await f.page.keyboard.press("Escape");
    assert.equal(await f.page.getByTestId("channel-rail-sheet").count(), 0);
    assert.deepEqual(await f.writes(), []);
  } finally { await f.close(); }
});

test("notification modal owns keyboard focus instead of the covered rail", async () => {
  const f = await fixture(390);
  try {
    await f.page.getByRole("button", { name: "Уведомления канала «Общие»", exact: true }).click();
    const modal = f.page.getByRole("dialog", { name: "Уведомления канала", exact: true });
    assert.equal(await modal.evaluate((node: Element) => node.contains(document.activeElement)), true,
      "focus must enter the portalled modal when the row bell opens it");
    await f.page.waitForFunction(() => document.querySelector("fieldset")?.disabled === false);
    for (const key of ["Tab", "Shift+Tab"]) for (let tab = 0; tab < 6; tab++) {
      await f.page.keyboard.press(key);
      assert.equal(await modal.evaluate((node: Element) => node.contains(document.activeElement)), true);
    }
    await modal.getByRole("button", { name: "Назад", exact: true }).click();
    assert.equal(await f.page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Уведомления канала «Общие»");
  } finally { await f.close(); }
});

test("general row retains the literal null topic CAS rather than a new mute scope", async () => {
  const f = await fixture();
  try {
    await f.page.getByRole("button", { name: "Уведомления канала «Общие»", exact: true }).click();
    await f.page.waitForFunction(() => document.querySelector("fieldset")?.disabled === false);
    await f.page.locator('input[value="disabled"]').click();
    assert.deepEqual(await f.writes(), [{ p_chat_id: C, p_topic_id: null, p_mode: "disabled", p_expected_revision: 0 }]);
  } finally { await f.close(); }
});

for (const transition of ["account", "epoch", "archive"]) test("the open dialog retires on " + transition, async () => {
  const f = await fixture();
  try {
    await f.page.getByRole("button", { name: "Уведомления канала «Обновления проекта»", exact: true }).click();
    assert.equal(await f.page.getByRole("dialog", { name: "Уведомления канала", exact: true }).count(), 1);
    await f.page.evaluate(({ transition, B, C }) => {
      const w = window as any;
      if (transition === "account") w.store.setState({ currentUser: { id: "other-user" }, accountEpoch: 2 });
      else if (transition === "epoch") w.store.setState({ accountEpoch: 2 });
      else w.render({ topics: [{ id: B, chat_id: C, name: "Archived", is_general: false, archived: true }] });
    }, { transition, B, C });
    await f.page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    assert.equal(await f.page.getByRole("dialog", { name: "Уведомления канала", exact: true }).count(), 0);
    assert.deepEqual(await f.writes(), []);
  } finally { await f.close(); }
});

test("captured row action refuses an account change before React commits", async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(B => {
      const w = window as any, callback = w.openNotifications;
      if (!callback) throw Error("row action absent");
      w.store.setState({ accountEpoch: 2 }); callback({ id: B, kind: "text", name: "Old" });
    }, B);
    assert.deepEqual(await f.writes(), []);
    assert.equal(await f.page.getByRole("dialog", { name: "Уведомления канала", exact: true }).count(), 0);
  } finally { await f.close(); }
});

test("actual row and portalled modal pixels at 390/1440, both themes", async () => {
  for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
    const f = await fixture(width, theme);
    try {
      const bell = f.page.getByRole("button", { name: "Уведомления канала «Обновления проекта»", exact: true });
      assert.equal(await bell.count(), 1);
      const box = await bell.boundingBox();
      assert.ok(box && box.width >= (width === 390 ? 44 : 32) && box.height >= (width === 390 ? 44 : 32));
      await f.page.screenshot({ path: resolve(kub, `../../output/server-channel-notification-${width}-${theme}-rail.png`), animations: "disabled" });
      await bell.click();
      const modal = f.page.getByRole("dialog", { name: "Уведомления канала", exact: true });
      await f.page.waitForFunction(() => document.querySelector("fieldset")?.disabled === false);
      assert.equal(await modal.locator('input[type="radio"]').count(), 3);
      assert.match(await modal.innerText(), /Уведомления отключены/);
      assert.equal(await modal.evaluate((node: Element) => node.closest('[data-testid="channel-rail"]') === null), true);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth), width);
      await f.page.screenshot({ path: resolve(kub, `../../output/server-channel-notification-${width}-${theme}-dialog.png`), animations: "disabled" });
      assert.deepEqual(await f.writes(), []);
    } finally { await f.close(); }
  }
});

test("compiled bell-navigation substitution fails the actual chosen-row assertion", async () => {
  const code = await compile({ file: "components/chat/ChannelRail.tsx",
    before: "event.stopPropagation(); onNotifications(channel);", after: "event.stopPropagation(); onSelect(channel);" });
  const f = await fixture(1440, "dark", code);
  try { await assert.rejects(() => chosenRow(f), { code: "ERR_ASSERTION" }); }
  finally { await f.close(); }
});

test("compiled archived-scope omission keeps the real dialog open and fails retirement", async () => {
  const code = await compile({ file: "lib/topicNotificationPreferences.ts", before: "topic.archived === false &&", after: "" });
  const f = await fixture(1440, "dark", code);
  try {
    await f.page.getByRole("button", { name: "Уведомления канала «Обновления проекта»", exact: true }).click();
    await f.page.evaluate(({ B, C }) => (window as any).render({ topics: [{ id: B, chat_id: C, name: "Archived", is_general: false, archived: true }] }), { B, C });
    await assert.rejects(async () => assert.equal(await f.page.getByRole("dialog", { name: "Уведомления канала", exact: true }).count(), 0), { code: "ERR_ASSERTION" });
  } finally { await f.close(); }
});
