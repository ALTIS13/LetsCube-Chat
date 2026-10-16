import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const kubRoot = fileURLToPath(new URL("../../artifacts/kub/", import.meta.url));
const sourceRoot = resolve(kubRoot, "src");
const path = resolve(sourceRoot, "components/chat/TopicNotificationControl.tsx");
const original = existsSync(path) ? readFileSync(path, "utf8").replaceAll("\r\n", "\n") : null;
const requireKub = createRequire(resolve(kubRoot, "package.json"));
const { build } = createRequire(requireKub.resolve("vite"))("esbuild");
const { chromium } = requireKub("@playwright/test");
const UID = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000002";
const CHAT = "30000000-0000-4000-8000-000000000001", CHAT2 = "30000000-0000-4000-8000-000000000002";
const TOPIC = "40000000-0000-4000-8000-000000000001", GENERAL = "40000000-0000-4000-8000-000000000002";
let browser, bundle;

async function compile(change) {
  let changed = 0;
  const result = await build({ write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": sourceRoot }, define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "fictional-sdk-only", setup(plugin) {
      plugin.onLoad({ filter: /store[\\/]app\.store\.ts$/ }, () => ({ loader: "ts", contents: `
        import {create} from 'zustand';
        export const useAppStore=create(()=>({currentUser:{id:'${UID}'},accountEpoch:1,topicNotificationPreferences:{}}));
        window.store=useAppStore;
      ` }));
      plugin.onLoad({ filter: /lib[\\/]supabase[\\/]client\.ts$/ }, () => ({ loader: "ts", contents: `
        const client={rpc(name,args){
          if(!['topic_notification_preferences_read','topic_notification_preference_set'].includes(name))throw Error('unknown fixture RPC');
          const request={name,args,aborted:false};
          const promise=new Promise((resolve,reject)=>{request.resolve=resolve;request.reject=reject;});
          promise.abortSignal=signal=>{signal.addEventListener('abort',()=>{request.aborted=true;});return promise;};
          window.requests.push(request);return promise;
        },channel(name){const ch={name,active:true,on(){return ch;},subscribe(status){ch.status=status;return ch;}};window.channels.push(ch);return ch;},
          removeChannel(ch){ch.active=false;return Promise.resolve('ok');}};
        export const createClient=()=>client;
      ` }));
      plugin.onLoad({ filter: /TopicNotificationControl\.tsx$/ }, () => {
        if (original === null) return { loader: "tsx", contents: "export const TopicNotificationControl=undefined;" };
        let text = original;
        if (change) {
          assert.equal(text.split(change[0]).length - 1, 1, "mutation selects one actual component boundary");
          text = text.replace(change[0], change[1]); changed++;
        }
        return { loader: "tsx", contents: text, resolveDir: resolve(sourceRoot, "components/chat") };
      });
      // Resolve the missing feature into an absent export for initial runtime
      // RED, never an alternate component or alternate hook implementation.
      if (original === null) plugin.onResolve({ filter: /TopicNotificationControl\.tsx$/ }, () => ({ path, namespace: "file" }));
    } }],
    stdin: { resolveDir: kubRoot, sourcefile: "fictional-topic-control.tsx", loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {TopicNotificationControl} from './src/components/chat/TopicNotificationControl.tsx';
      window.Control=TopicNotificationControl;window.requests=[];window.channels=[];window.backCount=0;
      let props={chatId:'${CHAT}',topicId:'${TOPIC}',canonicalScopeKey:'${TOPIC}',title:'Тема',parentMuted:false,onBack:()=>{window.backCount++;}};
      const root=createRoot(document.getElementById('root'));
      window.render=patch=>{props={...props,...patch};flushSync(()=>root.render(<TopicNotificationControl {...props}/>));};
      window.owner=(id='${UID}',epoch=2)=>window.store.setState({currentUser:id?{id}:null,accountEpoch:epoch});
      window.unmount=()=>flushSync(()=>root.unmount());
    ` },
  });
  if (change) assert.equal(changed, 1);
  return result.outputFiles[0].text;
}
test.before(async () => {
  bundle = await compile();
  browser = await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
});
test.after(async () => {
  await browser?.close();
  if (original !== null) assert.equal(readFileSync(path, "utf8").replaceAll("\r\n", "\n"), original, "component frozen during controls");
});
async function fixture(t, { code = bundle, props = {}, mount = true, viewport, theme, css } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block", ...(viewport ? { viewport } : {}) });
  const page = await context.newPage(), network = [], errors = [];
  page.setDefaultTimeout(3000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => { network.push("blocked request"); return route.abort(); });
  await page.setContent(`<html${theme ? ` class="${theme}" style="color-scheme:${theme}"` : ""}><body><div id="root"></div></body></html>`);
  if (css) {
    await page.addStyleTag({ content: css });
    await page.evaluate(() => {
      document.body.style.minHeight = "100vh";
      document.getElementById("root").className = "kub-glass-strong fixed inset-x-3 bottom-[calc(0.75rem+var(--kub-safe-bottom))] z-50 max-h-[min(70vh,480px)] overflow-y-auto rounded-xl border border-[color:var(--kub-border-color)] py-1 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-12 sm:w-60";
    });
  }
  await page.addScriptTag({ content: code });
  if (mount) await page.evaluate(props => window.render(props), props);
  t.after(async () => { await page.evaluate(() => window.unmount()); await context.close();
    assert.deepEqual(network, []); assert.deepEqual(errors, []); });
  const requests = name => page.evaluate(name => window.requests.filter(r => r.name === name).map(r => ({ name:r.name,args:r.args,aborted:r.aborted })), name);
  async function answer(name, data, error = null) {
    await page.evaluate(({name,data,error}) => window.requests.findLast(r => r.name === name).resolve({data,error}), {name,data,error});
    await page.waitForTimeout(0);
  }
  return { page, requests, answer,
    reads: () => requests("topic_notification_preferences_read"), writes: () => requests("topic_notification_preference_set"),
    async ready(rows = [{scope_key:TOPIC,mode:"disabled",revision:7}]) {
      await page.evaluate(() => window.channels.at(-1).status("SUBSCRIBED"));
      await page.waitForFunction(() => window.requests.some(r => r.name === "topic_notification_preferences_read"));
      await answer("topic_notification_preferences_read", rows);
      await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);
    },
    // Controlled radios deliberately remain at the confirmed value while the
    // CAS is pending, so Playwright's optimistic check() postcondition is wrong.
    async choose(mode) { await page.locator(`input[value="${mode}"]`).click(); },
    async selected() { return page.locator('input[type="radio"]:checked').evaluateAll(nodes => nodes.map(node => node.value)); },
  };
}

test("actual compiled component exists, not a fake preference implementation", async t => {
  const f = await fixture(t, { mount: false });
  assert.equal(await f.page.evaluate(() => typeof window.Control), "function", "TOPIC_NOTIFICATION_CONTROL_MISSING");
});
test("three native radios show only confirmed choice, with back command and no modal", async t => {
  const f = await fixture(t); assert.deepEqual(await f.selected(), []);
  assert.equal(await f.page.locator('input[type="radio"]').count(), 3);
  assert.equal(await f.page.locator('input[type="radio"]:disabled').count(), 3);
  await f.ready(); assert.deepEqual(await f.selected(), ["disabled"]);
  assert.equal(await f.page.getByRole("dialog").count(), 0);
  await f.page.getByRole("button", {name:"Назад",exact:true}).click();
  assert.equal(await f.page.evaluate(() => window.backCount), 1);
});
test("pending keeps confirmed radio selected, disables all choices and sends exact server CAS once", async t => {
  const f = await fixture(t); await f.ready(); await f.choose("enabled");
  assert.deepEqual(await f.writes(), [{name:"topic_notification_preference_set",args:{p_chat_id:CHAT,p_topic_id:TOPIC,p_mode:"enabled",p_expected_revision:7},aborted:false}]);
  assert.deepEqual(await f.selected(), ["disabled"]); assert.equal(await f.page.locator('input:disabled').count(), 3);
  await f.answer("topic_notification_preference_set", {status:"applied",scope_key:TOPIC,mode:"enabled",revision:8});
  assert.deepEqual(await f.selected(), ["enabled"]); assert.equal((await f.writes()).length, 1);
});
for (const topicId of [null, GENERAL]) test(`verified general ${topicId === null ? "null" : "alias"} shares literal null CAS scope and revision0 inherit`, async t => {
  const f = await fixture(t, {props:{topicId,canonicalScopeKey:"general"}}); await f.ready([]);
  assert.deepEqual(await f.selected(), ["inherit"]); await f.choose("disabled");
  assert.deepEqual((await f.writes())[0].args,{p_chat_id:CHAT,p_topic_id:null,p_mode:"disabled",p_expected_revision:0});
});
test("conflict shows server choice and requires a new explicit click with its revision, never auto-overwrite", async t => {
  const f = await fixture(t); await f.ready(); await f.choose("enabled");
  await f.answer("topic_notification_preference_set", {status:"conflict",scope_key:TOPIC,mode:"inherit",revision:9});
  assert.deepEqual(await f.selected(), ["inherit"]); assert.equal((await f.writes()).length, 1);
  assert.match(await f.page.getByRole("status").innerText(), /другом устройстве/);
  await f.choose("enabled"); assert.equal((await f.writes())[1].args.p_expected_revision, 9);
});
for (const failure of ["read", "write", "channel"]) test(`${failure} failure disables choice; retry only rereads and never replays a write`, async t => {
  const f = await fixture(t);
  if (failure === "read") {
    await f.page.evaluate(() => window.channels[0].status("SUBSCRIBED"));
    await f.answer("topic_notification_preferences_read", null, {code:"42501"});
  } else {
    await f.ready();
    if (failure === "write") { await f.choose("enabled"); await f.answer("topic_notification_preference_set", null, {code:"42501"}); }
    else await f.page.evaluate(() => window.channels[0].status("CHANNEL_ERROR"));
  }
  const writes = (await f.writes()).length, reads = (await f.reads()).length;
  assert.equal(await f.page.locator('input:disabled').count(), 3);
  if (failure === "channel") await f.page.evaluate(() => window.channels[0].status("SUBSCRIBED"));
  else await f.page.getByRole("button", {name:"Повторить",exact:true}).click();
  assert.equal((await f.reads()).length, reads + 1); assert.equal((await f.writes()).length, writes);
  await f.answer("topic_notification_preferences_read", [{scope_key:TOPIC,mode:"disabled",revision:12}]);
  assert.deepEqual(await f.selected(), ["disabled"]);
});
for (const parentMuted of [true,false,null]) test(`inherit describes parent ${parentMuted} without changing confirmed override or writing`, async t => {
  const f = await fixture(t, {props:{parentMuted}}); await f.ready([]);
  assert.deepEqual(await f.selected(), ["inherit"]); assert.equal((await f.writes()).length, 0);
  const text = await f.page.locator("fieldset").innerText();
  assert.ok(text.includes(parentMuted === null ? "Статус чата недоступен" : parentMuted ? "Уведомления отключены" : "Уведомления включены"));
});
for (const change of ["owner","epoch"]) test(`captured native change before React commit refuses retired ${change} identity`, async t => {
  const f = await fixture(t); await f.ready();
  await f.page.evaluate(({change,OTHER}) => {
    const input=document.querySelector('input[value="enabled"]');
    const key=Object.keys(input).find(key=>key.startsWith('__reactProps'));
    const callback=input[key].onChange;
    window.owner(change==='owner'?OTHER:undefined,2);
    callback({target:{value:'enabled',checked:true}});
  }, {change,OTHER});
  assert.equal((await f.writes()).length, 0);
});
test("scope switch cannot reuse another topic's revision and same selected choice never writes", async t => {
  const f = await fixture(t); await f.ready(); await f.choose("disabled"); assert.equal((await f.writes()).length, 0);
  await f.page.evaluate(({GENERAL})=>window.render({topicId:GENERAL,canonicalScopeKey:GENERAL}),{GENERAL});
  assert.deepEqual(await f.selected(), ["inherit"]); await f.choose("enabled");
  assert.deepEqual((await f.writes())[0].args,{p_chat_id:CHAT,p_topic_id:GENERAL,p_mode:"enabled",p_expected_revision:0});
});
test("invalid or mismatched scope does not acquire a preference read or offer controls", async t => {
  const f = await fixture(t,{props:{topicId:null,canonicalScopeKey:TOPIC}});
  assert.equal(await f.page.locator('input[type="radio"]').count(),0); assert.equal((await f.reads()).length,0);
});

test("captured old-topic callback cannot write after a same-chat scope change", async t => {
  const f = await fixture(t); await f.ready();
  await f.page.evaluate(({GENERAL}) => {
    const input=document.querySelector('input[value="enabled"]');
    const key=Object.keys(input).find(key=>key.startsWith('__reactProps'));
    const callback=input[key].onChange;
    window.render({topicId:GENERAL,canonicalScopeKey:GENERAL});
    callback({target:{value:'enabled',checked:true}});
  }, {GENERAL});
  assert.equal((await f.writes()).length,0);
});

test("late old-chat CAS cannot replace the newly confirmed menu scope", async t => {
  const f=await fixture(t);await f.ready();await f.choose("enabled");
  await f.page.evaluate(({CHAT2})=>window.render({chatId:CHAT2}),{CHAT2});
  await f.ready([{scope_key:TOPIC,mode:"inherit",revision:3}]);
  await f.answer("topic_notification_preference_set",{status:"applied",scope_key:TOPIC,mode:"enabled",revision:8});
  assert.deepEqual(await f.selected(),["inherit"]);
  await f.choose("disabled");
  assert.deepEqual((await f.writes())[1].args,{p_chat_id:CHAT2,p_topic_id:TOPIC,p_mode:"disabled",p_expected_revision:3});
});

async function mutation(t,needle,replacement,proof) {
  assert.equal(original.split(needle).length-1,1);
  const control=await fixture(t);await proof(control);
  const mutant=await fixture(t,{code:await compile([needle,replacement])});
  await assert.rejects(()=>proof(mutant),error=>error.code==='ERR_ASSERTION',
    'literal behavioral assertion, not a build/setup error, must reject omission');
}
test("compiled omission: fixed CAS revision comes from this confirmed scope",t=>mutation(t,
  'mode, row?.revision ?? 0','mode, 0',async f=>{
    await f.ready();await f.choose('enabled');
    assert.deepEqual((await f.writes())[0].args,{p_chat_id:CHAT,p_topic_id:TOPIC,p_mode:'enabled',p_expected_revision:7});
  }));
test("compiled omission: general alias never becomes a second independent scope",t=>mutation(t,
  'canonicalScopeKey === "general" ? null : topicId','topicId',async f=>{
    await f.page.evaluate(({GENERAL})=>window.render({topicId:GENERAL,canonicalScopeKey:'general'}),{GENERAL});
    await f.ready([]);await f.choose('disabled');assert.equal((await f.writes())[0].args.p_topic_id,null);
  }));
test("compiled omission: selected radio never displays unconfirmed pending intent",t=>mutation(t,
  'row?.mode ?? "inherit"','view.pending?.mode ?? row?.mode ?? "inherit"',async f=>{
    await f.ready();await f.choose('enabled');assert.deepEqual(await f.selected(),['disabled']);
  }));
test("compiled omission: all native options are disabled while CAS is in flight",t=>mutation(t,
  'const canChoose = owned && !view.loading && !view.unavailable && !view.pending;',
  'const canChoose = owned && !view.loading && !view.unavailable;',async f=>{
    await f.ready();await f.choose('enabled');assert.equal(await f.page.locator('input:disabled').count(),3);
  }));
test("compiled omission: a different topic cannot donate its confirmed mode or revision",t=>mutation(t,
  'row.scope_key === canonicalScopeKey','true',async f=>{
    await f.ready();await f.page.evaluate(({GENERAL})=>window.render({topicId:GENERAL,canonicalScopeKey:GENERAL}),{GENERAL});
    assert.deepEqual(await f.selected(),['inherit']);
  }));
test("compiled omission: stale same-chat topic callbacks retain no write admission",t=>mutation(t,
  'scopeRef.current === scope && ','',async f=>{
    await f.ready();await f.page.evaluate(({GENERAL})=>{
      const input=document.querySelector('input[value="enabled"]'),key=Object.keys(input).find(key=>key.startsWith('__reactProps'));
      const callback=input[key].onChange;window.render({topicId:GENERAL,canonicalScopeKey:GENERAL});callback({target:{value:'enabled',checked:true}});
    },{GENERAL});assert.equal((await f.writes()).length,0);
  }));
test("compiled omission: retry must perform a fresh read rather than another write",t=>mutation(t,
  'void view.refresh()','void view.setMode(topicId, "enabled", row?.revision ?? 0)',async f=>{
    await f.page.evaluate(()=>window.channels.at(-1).status('SUBSCRIBED'));
    await f.answer('topic_notification_preferences_read',null,{code:'42501'});
    await f.page.getByRole('button',{name:'Повторить',exact:true}).click();
    assert.equal((await f.reads()).length,2);assert.equal((await f.writes()).length,0);
  }));

if (process.env.KUB_TOPIC_CONTROL_VISUAL === "1") test("visual batch: final CSS, 1440/390 light/dark, fit/keyboard/targets and all five actual-hook states", async t => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0", "fixture-only QA0 is mandatory");
  const cssPath = resolve(kubRoot, "dist/public/assets/index-C-bcI_MV.css");
  let css = readFileSync(cssPath, "utf8");
  // Embed the exact bundled local fonts; keep the compiled CSS rules intact
  // without letting a file/about:blank fixture issue font requests.
  const fonts = [...css.matchAll(/url\(([^)]+)\)/g)].filter(match => match[1].replaceAll(/["']/g, "").startsWith("/fonts/"));
  assert.ok(fonts.length > 0, "actual bundled Inter declarations must be present");
  for (const match of fonts) {
    const url = match[1].replaceAll(/["']/g, "");
    const bytes = readFileSync(resolve(kubRoot, "dist/public", url.slice(1)));
    css = css.replaceAll(match[0], `url(data:font/woff2;base64,${bytes.toString("base64")})`);
  }
  const title = "Обновления и обсуждение Сверхдлинноеназваниетемыбезпробеловдляпроверкипереносов";
  const captured = [], signatures = new Map();
  async function fit(f, width, state) {
    await f.page.evaluate(() => document.fonts.ready);
    const metrics = await f.page.evaluate(() => {
      const root = document.getElementById("root"), box = root.getBoundingClientRect();
      const targets = [...root.querySelectorAll("button,label")].map(node => ({ text: node.textContent.trim(), height: node.getBoundingClientRect().height }));
      const textOverflow = [...root.querySelectorAll("span,div")].filter(node => node.childElementCount === 0 && node.textContent.trim()
        && !node.classList.contains("sr-only")).filter(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        return [...range.getClientRects()].some(rect => rect.left < box.left - 1 || rect.right > box.right + 1);
      }).map(node => node.textContent);
      const label = root.querySelector("label"), style = getComputedStyle(label);
      return { x: box.x, right: box.right, width: box.width, height: box.height, scroll: root.scrollHeight, client: root.clientHeight,
        documentWidth: document.documentElement.scrollWidth, targets, textOverflow,
        font: style.fontFamily, signature: [getComputedStyle(document.body).backgroundColor, style.color, getComputedStyle(root).backgroundColor].join("|") };
    });
    assert.equal(metrics.width, width === 390 ? 366 : 240, `${state}: exact existing popup width`);
    assert.ok(metrics.x >= (width === 390 ? 12 : 0) && metrics.right <= width - (width === 390 ? 12 : 0));
    assert.equal(metrics.documentWidth, width, `${state}: no horizontal page overflow`);
    assert.ok(metrics.scroll <= metrics.client + 1, `${state}: no clipped or hidden control row`);
    assert.deepEqual(metrics.textOverflow, [], `${state}: all labels/title wrap within the popup`);
    assert.ok(metrics.targets.every(target => target.height >= 44), `${state}: every label/button is a >=44px target`);
    assert.ok(metrics.targets.filter(target => target.text.includes("уведомления") || target.text.includes("Как в чате"))
      .every(target => target.height <= 64), `${state}: compact rows, not cards`);
    assert.match(metrics.font, /Inter/);
    return metrics;
  }
  for (const width of [1440,390]) for (const theme of ["light","dark"]) {
    const f = await fixture(t, { viewport: {width,height:900}, theme, css, props: {title,parentMuted:true} });
    await f.ready([{scope_key:TOPIC,mode:"enabled",revision:7}]);
    const screenshot = async state => {
      const metrics = await fit(f,width,state);
      signatures.set(`${width}-${theme}`,metrics.signature);
      const file = resolve(kubRoot,"../../output",`topic-notification-control-${width}-${theme}-${state}.png`);
      const buffer = await f.page.locator("#root").screenshot({path:file,animations:"disabled"});
      captured.push({width,theme,state,file,buffer,height:metrics.height});
    };
    await screenshot("enabled-parent-muted");
    await f.page.keyboard.press("Tab");
    assert.equal(await f.page.evaluate(()=>document.activeElement.textContent.trim()),"Назад");
    await f.page.keyboard.press("Tab");
    assert.equal(await f.page.evaluate(()=>document.activeElement.value),"enabled","Tab enters confirmed native radio");
    await f.page.keyboard.press("ArrowDown");
    assert.deepEqual((await f.writes())[0].args,{p_chat_id:CHAT,p_topic_id:TOPIC,p_mode:"disabled",p_expected_revision:7});
    assert.deepEqual(await f.selected(),["enabled"],"native keyboard does not create optimistic selection");
    await screenshot("pending");
    await f.answer("topic_notification_preference_set",{status:"applied",scope_key:TOPIC,mode:"disabled",revision:8});
    await f.page.evaluate(()=>window.render({parentMuted:false}));
    await screenshot("disabled-parent-unmuted");
    await f.choose("enabled");
    await f.answer("topic_notification_preference_set",{status:"conflict",scope_key:TOPIC,mode:"inherit",revision:9});
    assert.deepEqual(await f.selected(),["inherit"]);
    await screenshot("conflict");
    await f.choose("enabled"); await f.answer("topic_notification_preference_set",null,{code:"42501"});
    const retry = f.page.getByRole("button",{name:"Повторить",exact:true});
    assert.equal(await retry.locator("svg").count(),1,"actual KubIcon retry must render");
    assert.ok(await retry.locator("svg path").count() > 0,"retry icon has actual vector geometry");
    const iconBox=await retry.locator("svg").boundingBox();assert.equal(iconBox.width,16);assert.equal(iconBox.height,16);
    await screenshot("error-retry");
    await f.page.getByRole("button",{name:"Назад",exact:true}).focus(); await f.page.keyboard.press("Tab");
    assert.equal(await f.page.evaluate(()=>document.activeElement.getAttribute("aria-label")),"Повторить","disabled radio group is skipped by Tab");
    await f.page.keyboard.press("Enter"); assert.equal((await f.reads()).length,2,"keyboard retry performs actual hook read");
    await f.answer("topic_notification_preferences_read",[{scope_key:TOPIC,mode:"disabled",revision:12}]);
  }
  for(const width of [1440,390]) assert.notEqual(signatures.get(`${width}-light`),signatures.get(`${width}-dark`),"actual CSS theme tokens must differ");
  // One contact sheet for a bounded pixel inspection, using only PNG buffers
  // just captured from this strict fictional actual-hook fixture.
  const context=await browser.newContext({viewport:{width:1640,height:2600},serviceWorkers:"block"});
  try {
    const page=await context.newPage();await page.route("**/*",route=>route.abort());
    const states=["enabled-parent-muted","disabled-parent-unmuted","pending","conflict","error-retry"];
    const cells=states.flatMap(state=>captured.filter(item=>item.state===state));
    await page.setContent(`<html><body style="margin:0;background:#ddd;color:#111;font:14px Arial;display:grid;grid-template-columns:repeat(4,410px)">${cells.map(item=>
      `<div style="padding:12px;box-sizing:border-box;height:520px"><p>${item.width} / ${item.theme} / ${item.state}</p><img style="display:block;max-width:386px" src="data:image/png;base64,${item.buffer.toString("base64")}"></div>`).join("")}</body></html>`);
    await page.locator("img").evaluateAll(nodes=>Promise.all(nodes.map(node=>node.decode())));
    await page.screenshot({path:resolve(kubRoot,"../../output/topic-notification-control-contact-sheet.png"),animations:"disabled"});
  } finally {await context.close();}
  t.diagnostic(`20 fixture-only PNGs + contact sheet; CSS index-C-bcI_MV.css; zero external requests. ${JSON.stringify(captured.map(({width,theme,state,height})=>({width,theme,state,height})))}`);
});
