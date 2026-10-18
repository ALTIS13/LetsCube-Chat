import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const kub = fileURLToPath(new URL("../../artifacts/kub/", import.meta.url));
const req = createRequire(resolve(kub, "package.json"));
const { build } = createRequire(req.resolve("vite"))("esbuild");
const playwright = req("@playwright/test");
const user = "11111111-1111-4111-8111-000000000001";
const session = "22222222-2222-4222-8222-000000000001";
const subscription = "33333333-3333-4333-8333-000000000001";
const ackWorker = `self.addEventListener('message', event => {
  if (event.data?.type === 'LETSCUBE_WEB_PREVIEW_INSTALL') event.ports[0].postMessage({
    type:'LETSCUBE_WEB_PREVIEW_RESULT',ok:true,installed:true,web_push_protocol:1,
    generation:event.data.generation,intent_id:event.data.intent_id
  });
});`;
let server, origin, bundle, buildOptions, ackProtocol = 1;
const browsers = new Map();

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0", "FICTIONAL_BROWSER_QA0_REQUIRED");
  // A real first document and native registration, deliberately without claim().
  server = createServer((request, response) => {
    if (request.url === "/sw.js") {
      response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
      response.end(ackProtocol === 1 ? ackWorker : ackWorker.replace('web_push_protocol:1,', ''));
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<!doctype html><title>Fictional preview first document</title><div id="root"></div>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  buildOptions = { write: false, bundle: true, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": resolve(kub, "src") }, define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "fictional-auth-and-push", setup(plugin) {
      plugin.onLoad({ filter: /store[\\/]app\.store\.ts$/ }, () => ({ loader: "ts", contents: `
        import {create} from 'zustand'; export const useAppStore=create(()=>({currentUser:{id:'${user}'},
          accountEpoch:1,authSessionIdentity:{userId:'${user}',sessionId:'${session}'}}));window.ownerStore=useAppStore;` }));
      plugin.onLoad({ filter: /lib[\\/]supabase[\\/]client\.ts$/ }, () => ({ loader: "ts", contents: `
        export const createClient=()=>window.sdk;export const isSupabaseConfigured=()=>true;
        export const getSupabasePublishableKey=()=> 'sb_publishable_FICTIONAL_ONLY_PUBLIC_KEY';` }));
      plugin.onLoad({ filter: /platform[\\/]capabilities\.ts$/ }, () => ({ loader: "ts", contents: `
        export const isWebBrowser=()=>true;export const supportsBrowserPush=()=>true;` }));
    } }], stdin: { resolveDir: kub, sourcefile: "first-document-preview.tsx", loader: "tsx", contents: `
      import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
      import{useWebMessagePreview}from'./src/hooks/useWebMessagePreview';
      import{webPreviewStore,webPreviewSubscriptionFingerprint}from'./src/lib/platform/webMessagePreviews';
      const root=createRoot(document.getElementById('root'));
      function Probe(){window.view=useWebMessagePreview();return null;}
      window.mount=async()=>{window.fingerprint=await webPreviewSubscriptionFingerprint(window.pushSubscription,'${subscription}','${user}');
        flushSync(()=>root.render(<Probe/>));};
      window.readState=()=>webPreviewStore().read();window.unmount=()=>flushSync(()=>root.unmount());` } };
  bundle = (await build(buildOptions)).outputFiles[0].text;
  for (const engine of ["chromium", "webkit"]) browsers.set(engine, await playwright[engine].launch({ headless: true }));
});
test.after(async () => {
  for (const browser of browsers.values()) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function fixture(engine, { controlled = false, mode = "own", change } = {}) {
  ackProtocol = mode === "old-ack" ? 0 : 1;
  const context = await browsers.get(engine).newContext(), page = await context.newPage(), unknown = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => new URL(route.request().url()).origin === origin
    ? route.continue() : (unknown.push(route.request().url()), route.abort()));
  await page.goto(origin);
  await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js", { scope: "/" }); await navigator.serviceWorker.ready; });
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration("/sw.js"))?.active?.state === "activated");
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller === null), true, "native fresh page must remain uncontrolled");
  if (controlled) { await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller !== null); }
  await page.evaluate(({ user, session, subscription, mode }) => {
    window.matchMedia = () => ({ matches: true });
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
    const endpoint = "https://push.fixture.invalid/fictional", p256dh = "fictional-key", auth = "fictional-auth";
    window.pushSubscription = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh, auth } }) };
    window.granted = false; window.rev = 0; window.level = "none"; window.installLookup = false; window.foreignInstalls = 0; window.protocolWrites = [];
    const getSubscription = async () => {
      if (window.granted && mode === "held-descriptor") await new Promise(resolve => { window.releaseDescriptor = resolve; });
      if (window.granted && mode === "descriptor-change") return { endpoint, toJSON: () => ({ endpoint, keys: { p256dh, auth: "replaced" } }) };
      return window.pushSubscription;
    };
    const lookup = navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker);
    navigator.serviceWorker.getRegistration = async path => {
      const reg = await lookup(path);
      if (window.granted) {
        window.installLookup = true;
        if (mode === "held-owner") await new Promise(resolve => { window.releaseRegistration = resolve; });
        if (mode === "throw") throw new Error("FICTIONAL_REGISTRATION_REFUSED");
        if (["scope", "script", "waiting", "activating"].includes(mode)) return { scope: mode === "scope" ? location.origin + "/other/" : reg.scope,
          pushManager: { getSubscription },
          active: mode === "waiting" ? null : { scriptURL: mode === "script" ? location.origin + "/other.js" : reg.active.scriptURL,
            state: mode === "activating" ? "activating" : "activated", postMessage(message, ports) {
              window.foreignInstalls++;
              ports[0].postMessage({ type: "LETSCUBE_WEB_PREVIEW_RESULT", ok: true, installed: true, web_push_protocol: 1,
                generation: message.generation, intent_id: message.intent_id });
            } },
          waiting: reg.active };
      }
      Object.defineProperty(reg, "pushManager", { configurable: true, value: { getSubscription } });
      return reg;
    };
    window.sdk = {
      from(name) { return {
        update(row) {
          const filters = [], query = { eq(key, value) { filters.push([key, value]); return query; }, select() { return query; },
            async maybeSingle() {
              window.protocolWrites.push({ row, filters });
              if (mode === "held-update") await new Promise(resolve => { window.releaseUpdate = resolve; });
              return mode === "update-failure" ? { data: null, error: { message: "FICTIONAL_UPDATE_FAILURE" } }
                : mode === "update-empty" ? { data: null, error: null } : { data: { id: subscription, web_push_protocol: 1 }, error: null };
            } };
          return query;
        },
        select() { return { eq() {
          if (name === "notification_preview_preferences") return Promise.resolve({ data: [{ user_id: user, preview_level: window.level }], error: null });
          return { eq: () => ({ maybeSingle: async () => ({ data: { id: subscription, user_id: user, endpoint, p256dh, auth, is_active: true }, error: null }) }) };
        } }; },
        upsert(row) { return { select: async () => { window.level = row.preview_level; window.granted = false; return { data: [row], error: null }; } }; },
      }; },
      async rpc(name) {
        if (name === "web_message_preview_enroll") { window.granted = true; window.rev++; }
        const observed = Date.now();
        return { data: [{ preview_v: 1, recipient_id: user, session_id: session, subscription_id: subscription,
          subscription_fingerprint: window.fingerprint, revision: window.rev, preview_level: window.granted ? window.level : "none",
          installation_consent: window.granted, observed_at_epoch_ms: observed, expires_at_epoch_ms: window.granted ? observed + 60000 : null }], error: null };
      },
    };
  }, { user, session, subscription, mode });
  let script = bundle;
  if (change) {
    const original = readFileSync(resolve(kub, "src/hooks/useWebMessagePreview.ts"), "utf8");
    assert.equal(original.split(change[0]).length, 2, "one literal loaded hook mutation");
    script = (await build({ ...buildOptions, plugins: [...buildOptions.plugins, { name: "omit-one-hook-guard", setup(plugin) {
      plugin.onLoad({ filter: /hooks[\\/]useWebMessagePreview\.ts$/ }, () => ({ loader: "ts", contents: original.replace(change[0], change[1]) }));
    } }] })).outputFiles[0].text;
  }
  await page.addScriptTag({ content: script }); await page.evaluate(() => window.mount());
  await page.waitForFunction(() => window.view.status === "ready");
  return { page, async close() {
    try { await page.evaluate(() => window.unmount()); } finally { await context.close(); }
    assert.deepEqual(errors, []); assert.deepEqual(unknown, []);
  } };
}

for (const engine of ["chromium", "webkit"]) {
  test(`${engine}: fresh uncontrolled document installs through its exact active registration`, async () => {
    const f = await fixture(engine);
    try {
      const result = await f.page.evaluate(async () => {
        const accepted = await window.view.setChoice("message"), state = await window.readState();
        return { accepted, state: state?.state, controllerAbsent: navigator.serviceWorker.controller === null, serverGrant: window.granted };
      });
      assert.deepEqual(result, { accepted: true, state: "active", controllerAbsent: true, serverGrant: true });
    } finally { await f.close(); }
  });
  test(`${engine}: controlled navigation keeps the existing controller path`, async () => {
    const f = await fixture(engine, { controlled: true });
    try {
      assert.equal(await f.page.evaluate(() => window.view.setChoice("sender")), true);
      assert.equal(await f.page.evaluate(() => window.protocolWrites.length), 1);
    } finally { await f.close(); }
  });
  test(`${engine}: capability handshake writes literal protocol 1 only for the exact descriptor after new ACK`, async () => {
    const f = await fixture(engine);
    try {
      const result = await f.page.evaluate(async () => ({ accepted: await window.view.setChoice("message"), writes: window.protocolWrites }));
      assert.equal(result.accepted, true);
      assert.deepEqual(result.writes, [{ row: { web_push_protocol: 1 }, filters: [
        ["id", subscription], ["user_id", user], ["endpoint", "https://push.fixture.invalid/fictional"],
        ["p256dh", "fictional-key"], ["auth", "fictional-auth"], ["is_active", true],
      ] }]);
    } finally { await f.close(); }
  });
  for (const mode of ["old-ack", "update-failure", "update-empty", "descriptor-change"]) {
    test(`${engine}: capability handshake fails closed for ${mode}`, async () => {
      const f = await fixture(engine, { mode });
      try {
        const result = await f.page.evaluate(async () => ({ accepted: await window.view.setChoice("message"),
          state: (await window.readState())?.state, writes: window.protocolWrites.length }));
        assert.deepEqual(result, { accepted: false, state: "retired", writes: mode.startsWith("update-") ? 1 : 0 });
      } finally { await f.close(); }
    });
  }
  for (const stage of ["descriptor", "update"]) {
    test(`${engine}: capability handshake retires a stale owner at ${stage} await`, async () => {
      const f = await fixture(engine, { mode: `held-${stage}` });
      try {
        await f.page.evaluate(() => { window.pendingChoice = window.view.setChoice("message"); });
        await f.page.waitForFunction(stage => typeof window[stage === "descriptor" ? "releaseDescriptor" : "releaseUpdate"] === "function", stage);
        const result = await f.page.evaluate(async stage => {
          window.ownerStore.setState({ currentUser: { id: "11111111-1111-4111-8111-000000000002" }, accountEpoch: 2,
            authSessionIdentity: { userId: "11111111-1111-4111-8111-000000000002", sessionId: "22222222-2222-4222-8222-000000000002" } });
          window[stage === "descriptor" ? "releaseDescriptor" : "releaseUpdate"]();
          return { accepted: await window.pendingChoice, state: (await window.readState())?.state, writes: window.protocolWrites.length };
        }, stage);
        assert.deepEqual(result, { accepted: false, state: "retired", writes: stage === "descriptor" ? 0 : 1 });
      } finally { await f.close(); }
    });
  }
  for (const mode of ["scope", "script", "waiting", "activating", "throw"]) {
    test(`${engine}: uncontrolled fallback refuses ${mode} registration and retires the local capability`, async () => {
      const f = await fixture(engine, { mode });
      try {
        const result = await f.page.evaluate(async () => ({ accepted: await window.view.setChoice("message"), state: (await window.readState())?.state,
          foreignInstalls: window.foreignInstalls }));
        assert.deepEqual(result, { accepted: false, state: "retired", foreignInstalls: 0 });
      } finally { await f.close(); }
    });
  }
  test(`${engine}: owner switch during held registration lookup cannot install the old grant`, async () => {
    const f = await fixture(engine, { mode: "held-owner" });
    try {
      await f.page.evaluate(() => { window.pendingChoice = window.view.setChoice("message"); });
      await f.page.waitForFunction(() => !!window.releaseRegistration);
      const result = await f.page.evaluate(async () => {
        window.ownerStore.setState({ accountEpoch: 2, authSessionIdentity: { userId: window.ownerStore.getState().currentUser.id,
          sessionId: "22222222-2222-4222-8222-000000000002" } });
        window.releaseRegistration();
        return { accepted: await window.pendingChoice, state: (await window.readState())?.state };
      });
      assert.deepEqual(result, { accepted: false, state: "retired" });
    } finally { await f.close(); }
  });
  for (const [mode, change] of [
    ["scope", ['registration?.scope !== new URL("/", window.location.origin).href', "false"]],
    ["script", ['active.scriptURL !== new URL("/sw.js", window.location.origin).href', "false"]],
    ["activating", ['active?.state !== "activated"', "!active"]],
  ]) {
    test(`${engine}: compiled ${mode} omission lets a wrong worker ACK violate the ordinary refusal`, async () => {
      const f = await fixture(engine, { mode, change });
      try {
        const result = await f.page.evaluate(async () => ({ accepted: await window.view.setChoice("message"), foreignInstalls: window.foreignInstalls }));
        assert.throws(() => assert.deepEqual(result, { accepted: false, foreignInstalls: 0 }), error => error.code === "ERR_ASSERTION");
        assert.deepEqual(result, { accepted: true, foreignInstalls: 1 });
      } finally { await f.close(); }
    });
  }
}
