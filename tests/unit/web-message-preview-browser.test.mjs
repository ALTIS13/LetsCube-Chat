import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const kub = fileURLToPath(new URL("../../artifacts/kub/", import.meta.url));
const req = createRequire(resolve(kub, "package.json"));
const { build } = createRequire(req.resolve("vite"))("esbuild");
const playwright = req("@playwright/test");
const ids = {
  user: "11111111-1111-4111-8111-000000000001",
  session: "22222222-2222-4222-8222-000000000001",
  subscription: "33333333-3333-4333-8333-000000000001",
  notification: "44444444-4444-4444-8444-000000000001",
  chat: "55555555-5555-4555-8555-000000000001",
  message: "66666666-6666-4666-8666-000000000001",
};
const rpcLiteral = 'const WEB_PREVIEW_RPC = "https://core.letscube.ru/rest/v1/rpc/web_message_preview_content";';
const source = readFileSync(resolve(kub, "public/sw.js"), "utf8");

// Only the local served copy is instrumented. IDB, fetch, Response and its
// reader remain native; notification publication is the OS leaf under test.
const workerProbe = `
const fixturePublished = [], fixtureTrace = [];
const fixtureFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url, self.location.origin);
  if (url.origin !== self.location.origin) throw new Error('FIXTURE_EXTERNAL_FETCH_REFUSED');
  return fixtureFetch(input, init);
};
Object.defineProperties(self.registration, {
  showNotification: { value: async (title, options) => {
    fixturePublished.push(structuredClone({title, ...options}));
  } },
  getNotifications: { value: async () => [] },
});
for (const [name, original] of [['lookup', lookupWebPreview], ['current', currentWebPreview]]) {
  const traced = async (...args) => {
    const result = await original(...args);
    fixtureTrace.push({stage:name, accepted:!!result});
    return result;
  };
  if (name === 'lookup') lookupWebPreview = traced; else currentWebPreview = traced;
}
const fixtureContent = previewContent;
previewContent = (...args) => {
  const accepted = fixtureContent(...args);
  fixtureTrace.push({stage:'content', accepted, keys:Object.keys(args[0]),
    epochTypes:[typeof args[0].observed_at_epoch_ms, typeof args[0].expires_at_epoch_ms]});
  return accepted;
};
self.addEventListener('message', event => {
  if (event.data?.type !== 'FICTIONAL_BROWSER_PUSH') return;
  event.waitUntil((async () => {
    try {
      const pending = [], push = new Event('push');
      Object.defineProperties(push, {
        data: {value:null}, notification: {value:{data:event.data.payload}},
        waitUntil: {value:value => pending.push(Promise.resolve(value))},
      });
      self.dispatchEvent(push);
      await Promise.all(pending);
      const stored = await previewRecord();
      event.ports[0].postMessage({published:fixturePublished, trace:fixtureTrace,
        state:{active:stored.record?.state === 'active', usable:usablePreviewState(stored),
          apiPresent:!!stored.api, blocked:previewBlocked, storageFailed:previewStorageFailed}});
    } catch (error) { event.ports[0].postMessage({error:String(error), trace:fixtureTrace}); }
  })());
});
`;

let bundle;
test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0", "FICTIONAL_BROWSER_QA0_REQUIRED");
  assert.equal(source.split(rpcLiteral).length, 2, "exactly one pinned production RPC literal");
  bundle = (await build({ write: false, bundle: true, format: "iife", platform: "browser",
    stdin: { resolveDir: kub, sourcefile: "fictional-preview-browser.ts", loader: "ts", contents: `
      import {createWebPreviewStore, createWebMessagePreviewClient, installWebMessagePreview,
        webPreviewSubscriptionFingerprint} from './src/lib/platform/webMessagePreviews';
      window.fixtureAPI = {createWebPreviewStore, createWebMessagePreviewClient,
        installWebMessagePreview, webPreviewSubscriptionFingerprint};
    ` },
  })).outputFiles[0].text;
});

for (const engine of ["chromium", "webkit"]) {
  test(`${engine}: real SW INSTALL, native IDB and streamed mutable push publish rich content first`, { timeout: 45000 }, async t => {
    let grantContext, server, browser;
    const calls = [], errors = [], external = [];
    let responseBytes = 0;
    server = createServer((request, response) => {
      if (request.url === "/sw.js") {
        response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
        response.end(source.replace(rpcLiteral, 'const WEB_PREVIEW_RPC = self.location.origin + "/content";') + workerProbe);
      } else if (request.url === "/content") {
        let body = "";
        request.on("data", chunk => { body += chunk; });
        request.on("end", () => {
          const input = JSON.parse(body);
          calls.push({ method: request.method, notification: input.p_notification_id,
            grantFormat: /^wpg1_[a-f0-9]{64}$/.test(input.p_grant_secret),
            publicKey: request.headers.apikey === "sb_publishable_FICTIONAL_ONLY_PUBLIC_KEY" });
          const observed = Date.now();
          const row = { preview_v: 1, recipient_id: ids.user, session_id: ids.session,
            subscription_id: ids.subscription, subscription_fingerprint: grantContext.subscription_fingerprint,
            revision: grantContext.revision, notification_id: ids.notification, chat_id: ids.chat,
            message_id: ids.message, preview_level: "message", sender_name: "Fictional sender",
            title: "Fictional sender", body: "Fictional streamed message 123",
            observed_at_epoch_ms: observed, expires_at_epoch_ms: observed + 15000 };
          const bytes = Buffer.from(JSON.stringify([row]));
          responseBytes = bytes.length;
          response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          response.flushHeaders();
          response.write(bytes.subarray(0, 101));
          setTimeout(() => { response.write(bytes.subarray(101, 307)); response.end(bytes.subarray(307)); }, 20);
        });
      } else {
        response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
        response.end("<!doctype html><title>Fictional native worker preview</title>");
      }
    });
    t.after(async () => {
      if (browser) await browser.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await playwright[engine].launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "allow" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin
      ? route.continue() : (external.push(route.request().url()), route.abort()));
    const installer = await context.newPage();
    installer.on("pageerror", error => errors.push(error.message));
    await installer.goto(origin);
    await installer.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    });
    await installer.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated");
    await installer.addScriptTag({ content: bundle });
    const install = await installer.evaluate(async ids => {
      const api = window.fixtureAPI, store = api.createWebPreviewStore(indexedDB);
      const owner = { userId: ids.user, sessionId: ids.session, accountEpoch: 1 };
      const endpoint = location.origin + "/fictional-push-endpoint";
      const descriptor = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "fictional-key", auth: "fictional-auth" } }) };
      const fingerprint = await api.webPreviewSubscriptionFingerprint(descriptor, ids.subscription, ids.user);
      const registration = await navigator.serviceWorker.getRegistration();
      let level = "none", enrolled = false, revision = 0, grant;
      const ports = { owner: () => owner, foreground: () => document.visibilityState === "visible", store, crypto,
        now: () => Date.now(), subscription: async () => ({ subscriptionId: ids.subscription, fingerprint }),
        preference: async choice => { if (choice !== undefined) level = choice;
          return { data: [{ user_id: ids.user, preview_level: level }], error: null }; },
        rpc: async name => {
          if (name === "web_message_preview_enroll") { enrolled = true; revision++; }
          const observed = Date.now();
          grant = { preview_v: 1, recipient_id: ids.user, session_id: ids.session, subscription_id: ids.subscription,
            subscription_fingerprint: fingerprint, revision, preview_level: enrolled ? level : "none",
            installation_consent: enrolled, observed_at_epoch_ms: observed, expires_at_epoch_ms: enrolled ? observed + 60000 : null };
          return { data: [grant], error: null };
        },
        install: (token, value, current) => api.installWebMessagePreview(registration.active, token, value,
          "sb_publishable_FICTIONAL_ONLY_PUBLIC_KEY", current),
      };
      const client = api.createWebMessagePreviewClient(ports);
      const accepted = await client.setChoice("message"), stored = await store.read();
      return { accepted, state: stored?.state, installed: client.view().installed, context: stored?.envelope?.context,
        controllerAbsent: navigator.serviceWorker.controller === null, visibility: document.visibilityState };
    }, ids);
    t.diagnostic(JSON.stringify({ engine, stage: "INSTALL", accepted: install.accepted, state: install.state,
      installed: install.installed, controllerAbsent: install.controllerAbsent, visibility: install.visibility }));
    assert.equal(install.accepted, true, "native worker must ACK the actual client INSTALL");
    assert.equal(install.installed, true);
    assert.equal(install.state, "active");
    grantContext = install.context;

    // Remove the installer document completely. A fresh non-app driver sends
    // only a test message; no page lifecycle shim fabricates worker IDB state.
    const driver = await context.newPage();
    await driver.goto(origin + "/push-driver");
    await installer.close();
    const result = await driver.evaluate(async ids => {
      const registration = await navigator.serviceWorker.getRegistration();
      const channel = new MessageChannel();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("FICTIONAL_PUSH_TIMEOUT")), 10000);
        channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
        registration.active.postMessage({ type: "FICTIONAL_BROWSER_PUSH", payload: {
          kind: "message", url: "/?chat=" + ids.chat + "&message=" + ids.message,
          tag: "message:chat:" + ids.chat, chatId: ids.chat, messageId: ids.message, renotify: true,
          web_preview: { preview_v: 1, subscription_id: ids.subscription, notification_id: ids.notification },
        } }, [channel.port2]);
      });
    }, ids);
    t.diagnostic(JSON.stringify({ engine, stage: "PUSH", responseBytes, calls, ...result }));
    assert.equal(responseBytes, 647, "literal-size HTTP 200 reproduction, not a VM Response shim");
    assert.deepEqual(calls, [{ method: "POST", notification: ids.notification, grantFormat: true, publicKey: true }]);
    assert.equal(result.error, undefined);
    assert.equal(result.published.length, 1, "first-and-only publication, no generic then rich update");
    assert.equal(result.published[0].title, "Fictional sender", "fresh streamed lookup must authorize the first rich title");
    assert.equal(result.published[0].body, "Fictional streamed message 123");
    assert.equal(result.published[0].tag, "message:chat:" + ids.chat);
    assert.deepEqual(result.published[0].data, { url: "/?chat=" + ids.chat + "&message=" + ids.message,
      kind: "message", tag: "message:chat:" + ids.chat, chatId: ids.chat, messageId: ids.message });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  });
}
