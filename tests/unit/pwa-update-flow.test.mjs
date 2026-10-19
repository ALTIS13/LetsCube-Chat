import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium } = requireKub("@playwright/test");
const { build } = createRequire(requireKub.resolve("vite"))("esbuild");
const tw = createRequire(requireKub.resolve("@tailwindcss/vite"));
const { compile, optimize } = tw("@tailwindcss/node");
const { Scanner } = tw("@tailwindcss/oxide");
const src = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const output = mkdtempSync(join(tmpdir(), "letscube-pwa-update-"));
const origin = "https://pwa-update.invalid";
let browser, bundle, css;

async function buildFixture(omission) {
  const control = existsSync(join(src, "components/PwaUpdateStatusControl.tsx"));
  const leaves = {
    "@/hooks/useVoiceCall": `import {useSyncExternalStore} from 'react';
      const listeners=new Set();window.callChanged=()=>listeners.forEach(fn=>fn());
      export const voiceCallSnapshot=()=>window.callState;
      export const useVoiceCall=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},voiceCallSnapshot);`,
    "@/hooks/useVoiceRing": "export const voiceRingsSnapshot=()=>window.rings;",
    "@/lib/voiceResumeStorage": "export const markVoiceResumeInterrupted=()=>window.proof.resume++;",
    "@/lib/platform/capabilities": `export const isNativeApp=()=>window.native;
      export const supportsPwaInstall=()=>!window.native;export const getCurrentDistributionTarget=()=>window.native?'android':'web';`,
    "@/lib/platform/desktop": "export const isDesktopApp=()=>window.desktop;",
    "@/lib/monitoring": "export const reportError=()=>{};",
    "@/components/kub": `export {KubButton} from '${src.replaceAll("\\", "/")}components/kub/KubButton';
      export {KubIcon} from '${src.replaceAll("\\", "/")}components/kub/KubIcon';`,
  };
  const built = await build({
    write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": src },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify({ BASE_URL: "/", DEV: false }) },
    plugins: [{ name: "external-leaves", setup(b) {
      if (omission) b.onLoad({ filter: /(?:usePwaUpdate\.ts|pwaUpdateState\.ts|PwaUpdateStatusControl\.tsx)$/ }, args => {
        const source = readFileSync(args.path, 'utf8');
        const changed = omission === 'call-identity' ? source.replace('confirmedCall !== call', '!confirmedCall')
          : omission === 'intent' ? source.replace('if (mine === intent.current) update.apply({ confirmedCall });', 'update.apply({ confirmedCall });')
          : source.replace('const lateRefusal = ports.guard(confirmedCall);', 'const lateRefusal = null;');
        return { contents: changed, resolveDir: dirname(args.path), loader: args.path.endsWith('tsx') ? 'tsx' : 'ts' };
      });
      b.onResolve({ filter: /^@\// }, args => args.path in leaves ? { path: args.path, namespace: "leaf" } : undefined);
      b.onResolve({ filter: /appOutgoingMedia(?:\.ts)?$/ }, () => ({ path: "outbox", namespace: "leaf" }));
      b.onLoad({ filter: /.*/, namespace: "leaf" }, args => ({ contents: args.path === "outbox"
        ? "export const outgoingMediaPersistenceWouldLose=()=>window.outgoingUnsafe;" : leaves[args.path], resolveDir: src }));
    } }],
    stdin: { resolveDir: src, sourcefile: "pwa-update-fixture.tsx", loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {AppUpdateBanner} from './components/AppUpdateBanner';
      import {usePwaServiceWorker} from './hooks/usePwa';
      import {guardAgainstReload} from './lib/reloadGuard';
      import {currentWebUpdateOffer} from './lib/pwa/webUpdateOffer';
      ${control ? "import {PwaUpdateStatusControl} from './components/PwaUpdateStatusControl';" : "const PwaUpdateStatusControl=()=>null;"}
      window.proof={resume:0,posts:0,checks:0,skips:0};window.callState={phase:'idle'};window.rings=[];
      window.outgoingUnsafe=false;window.native=window.native??false;window.desktop=window.desktop??false;window.releaseHold=()=>{};
      const root=createRoot(document.getElementById('root'));
      function Registration(){usePwaServiceWorker();return null;}
      window.offer=currentWebUpdateOffer;
      window.mount=()=>flushSync(()=>root.render(<>{window.fakeWorker===false&&<Registration/>}<AppUpdateBanner/><section id="settings" className="mx-auto mt-72 max-w-lg px-4">
        <PwaUpdateStatusControl onBeforeApply={window.beforeApply?()=>window.beforeApply():undefined}/></section></>));
      window.unmount=()=>flushSync(()=>root.render(null));
      window.hold=loss=>{window.releaseHold();window.releaseHold=guardAgainstReload(loss);};
      const sw=new EventTarget();sw.controller={};sw.getRegistration=async()=>window.registration;
      const waiting={postMessage(message,ports){window.proof.posts++;
        if(message.type==='KUB_SKIP_WAITING')window.proof.skips++;
        if(window.throwPost)throw Error('synthetic-post-refusal');
        if(message.type==='KUB_SW_HANDOFF')ports[0].postMessage({type:'KUB_SW_HANDOFF_RESULT',build:'next',current:false,activated:false});}};
      window.registration={waiting:null,update:async()=>{window.proof.checks++;},scope:location.origin+'/'};
      if(window.fakeWorker!==false)Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:sw});
      window.announce=()=>{window.registration.waiting=waiting;window.dispatchEvent(new CustomEvent('kub:sw-update-ready',{detail:{registration:window.registration}}));};
      window.mount();
    ` },
  });
  return built.outputFiles[0].text;
}
test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  bundle = await buildFixture();
  const compiler = await compile(readFileSync(join(src, "index.css"), "utf8"), { base: src, onDependency() {} });
  css = optimize(compiler.build(new Scanner({}).scanFiles([{ content: bundle, extension: "js" }]))).code;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => {
  await browser?.close();
  writeFileSync(join(output, 'metadata.json'), JSON.stringify({ qa0: true, syntheticOnly: true, auth: false,
    rendered: 'actual React components + source CSS; controlled voice/platform/outbox leaves',
    worker: 'actual public/sw.js with synthetic BUILD records on owned loopback server', captures: 'synthetic PNG only' }, null, 2));
  console.log(`PWA update evidence: ${output}`);
});

async function fixture({ width = 390, theme = "dark", native = false, desktop = false, throttled = false, receipt, source = bundle } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [], refused = [];
  let indexStatus = 200, indexReads = 0;
  await page.addInitScript(({ native, desktop, throttled, receipt }) => {
    window.native = native; window.desktop = desktop;
    if (throttled) localStorage.setItem('letscube:app-update:last-shown', String(Date.now()));
    if (receipt) sessionStorage.setItem('letscube:pwa-update:restart', JSON.stringify(receipt));
  }, { native, desktop, throttled, receipt });
  page.on("pageerror", e => errors.push(e.message));
  await context.route("**/*", route => {
    const u = new URL(route.request().url());
    if (u.origin === origin && route.request().method() === "GET") {
      if (u.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html class="${theme}" lang="ru"><head><meta charset="utf-8"><title>Synthetic PWA update</title><link rel="stylesheet" href="/fixture.css"></head><body class="bg-[color:var(--kub-bg)]"><div id="root"></div><script type="module" src="/assets/index-old.js"></script></body></html>` });
      if (u.pathname === "/assets/index-old.js") return route.fulfill({ contentType: "text/javascript", body: source });
      if (u.pathname === "/index.html") { indexReads++; return route.fulfill({ status: indexStatus, contentType: "text/html", body: '<script type="module" src="/assets/index-old.js"></script>' }); }
      if (u.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
      if (/^\/fonts\/inter\/inter-(latin|latin-ext|cyrillic|cyrillic-ext)\.woff2$/.test(u.pathname)) return route.fulfill({ contentType: "font/woff2", body: readFileSync(new URL(`../../artifacts/kub/public${u.pathname}`, import.meta.url)) });
    }
    refused.push("unlisted-request"); return route.abort();
  });
  await page.goto(origin);
  await page.clock.install();
  await page.evaluate(() => document.fonts.ready);
  return { page, context, errors, refused, setStatus: value => { indexStatus = value; }, indexReads: () => indexReads };
}

async function confirmedSettingsClose(f) {
  await f.page.evaluate(() => {
    window.beforeApply = () => new Promise(resolve => {
      window.finishClose = () => { window.releaseHold(); resolve(); };
    });
    window.hold('dialog');
    window.callState = { phase: 'connected', channelId: 'synthetic-a' };
    window.callChanged(); window.mount(); window.announce();
  });
  await f.page.getByTestId('pwa-update-action').click();
  await f.page.getByTestId('pwa-update-action').click();
  await f.page.waitForFunction(() => typeof window.finishClose === 'function');
}

for (const replacement of ['none', 'different-channel', 'same-channel', 'a-null-a']) test(`call identity after held Settings close: ${replacement}`, async () => {
  const f = await fixture();
  try {
    await confirmedSettingsClose(f);
    await f.page.evaluate(replacement => {
      if (replacement === 'a-null-a') {
        window.callState = { phase: 'idle', channelId: null }; window.callChanged();
      }
      if (replacement !== 'none') {
        window.callState = { phase: 'connected', channelId: replacement === 'different-channel' ? 'synthetic-b' : 'synthetic-a' };
        window.callChanged();
      }
      window.finishClose();
    }, replacement);
    await f.page.clock.runFor(1);
    assert.equal(await f.page.evaluate(() => window.proof.skips), replacement === 'none' ? 1 : 0,
      'CHANGED_CALL_NEEDS_FRESH_CONFIRMATION');
    assert.equal(await f.page.getByTestId('pwa-update-status').getAttribute('data-phase'), replacement === 'none' ? 'updating' : 'failed');
    assert.deepEqual(f.errors, []); assert.deepEqual(f.refused, []);
  } finally { await f.context.close(); }
});

test('late controllerchange rechecks the exact confirmed call, not its channel', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => {
      window.callState = { phase: 'connected', channelId: 'synthetic-a' };
      window.callChanged(); window.announce();
    });
    await f.page.getByTestId('pwa-update-action').click();
    await f.page.getByTestId('pwa-update-action').click();
    assert.equal(await f.page.getByTestId('pwa-update-status').getAttribute('data-phase'), 'updating');
    const result = await f.page.evaluate(() => {
      window.callState = { phase: 'connected', channelId: 'synthetic-a' }; window.callChanged();
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
      return { resumes: window.proof.resume, receipt: sessionStorage.getItem('letscube:pwa-update:restart') };
    });
    assert.deepEqual(result, { resumes: 0, receipt: null }, 'LATE_CALL_IDENTITY_MUST_VETO_RELOAD');
    assert.equal(await f.page.getByTestId('pwa-update-status').getAttribute('data-phase'), 'failed');
    assert.deepEqual(f.errors, []); assert.deepEqual(f.refused, []);
  } finally { await f.context.close(); }
});

test('loaded truthiness omission restores the actual stale-call restart after held close', async () => {
  const f = await fixture({ source: await buildFixture('call-identity') });
  try {
    await confirmedSettingsClose(f);
    await f.page.evaluate(() => {
      window.callState = { phase: 'connected', channelId: 'synthetic-a' }; window.callChanged(); window.finishClose();
    });
    await f.page.clock.runFor(1);
    assert.equal(await f.page.evaluate(() => window.proof.skips), 1);
    assert.equal(await f.page.getByTestId('pwa-update-status').getAttribute('data-phase'), 'updating');
  } finally { await f.context.close(); }
});

test('loaded late-guard omission writes a receipt and resumes despite a replaced same-channel call', async () => {
  const f = await fixture({ source: await buildFixture('late-guard') });
  try {
    await f.page.evaluate(() => {
      window.callState = { phase: 'connected', channelId: 'synthetic-a' }; window.callChanged(); window.announce();
    });
    await f.page.getByTestId('pwa-update-action').click();await f.page.getByTestId('pwa-update-action').click();
    const result = await f.page.evaluate(() => {
      window.callState = { phase: 'connected', channelId: 'synthetic-a' }; window.callChanged();
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
      return { resumes: window.proof.resume, receipt: sessionStorage.getItem('letscube:pwa-update:restart') !== null };
    });
    assert.deepEqual(result, { resumes: 1, receipt: true });
  } finally { await f.context.close(); }
});

test('Cancel retires an already held call confirmation; loaded intent omission dispatches once', async () => {
  for (const omitted of [false, true]) {
    const f = await fixture({ source: omitted ? await buildFixture('intent') : bundle });
    try {
      await confirmedSettingsClose(f);
      await f.page.getByTestId('pwa-update-status').getByRole('button', { name: 'Отменить перезапуск' }).click();
      await f.page.evaluate(() => window.finishClose());await f.page.clock.runFor(1);
      assert.equal(await f.page.evaluate(() => window.proof.skips), omitted ? 1 : 0, 'CANCELLED_CONFIRMATION_CANNOT_RESTART');
    } finally { await f.context.close(); }
  }
});

test("a real mounted banner shows updating immediately after Apply, before worker activation", async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => window.announce());
    await f.page.getByTestId("app-update-restart").click();
    assert.equal(await f.page.getByTestId("app-update-notice").getAttribute("data-phase"), "updating");
    assert.equal(await f.page.getByTestId("app-update-restart").isDisabled(), true);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.refused, []);
  } finally { await f.context.close(); }
});

test("Settings can apply despite a throttled banner; postMessage refusal offers a working Retry", async () => {
  const f = await fixture({ throttled: true });
  try {
    await f.page.evaluate(() => { window.throwPost = true; window.announce(); });
    assert.equal(await f.page.getByTestId("app-update-notice").count(), 0);
    await f.page.getByTestId("pwa-update-action").click();
    assert.equal(await f.page.getByTestId("pwa-update-status").getAttribute("data-phase"), "failed");
    assert.equal(await f.page.getByTestId("pwa-update-action").textContent(), "Повторить");
    assert.equal(await f.page.getByTestId("pwa-update-action").isEnabled(), true);
    await f.page.evaluate(() => { window.throwPost = false; });
    await f.page.getByTestId("pwa-update-action").click();
    assert.equal(await f.page.getByTestId("pwa-update-status").getAttribute("data-phase"), "updating");
    assert.equal(await f.page.evaluate(() => window.proof.skips), 2);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.refused, []);
  } finally { await f.context.close(); }
});

test("a late staged attachment vetoes actual controllerchange; release permits explicit retry", async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => window.announce()); await f.page.getByTestId("pwa-update-action").click();
    await f.page.evaluate(() => { window.hold('staged-attachments'); navigator.serviceWorker.dispatchEvent(new Event('controllerchange')); });
    assert.equal(await f.page.getByTestId("pwa-update-status").getAttribute("data-phase"), "failed");
    assert.match(await f.page.getByTestId("pwa-update-status").textContent(), /Завершите текущие действия/);
    assert.equal(await f.page.evaluate(() => window.proof.resume), 0);
    assert.equal(await f.page.evaluate(() => sessionStorage.getItem('letscube:pwa-update:restart')), null);
    await f.page.evaluate(() => window.releaseHold()); await f.page.getByTestId("pwa-update-action").click();
    assert.equal(await f.page.getByTestId("pwa-update-status").getAttribute("data-phase"), "updating");
    assert.deepEqual(f.errors, []); assert.deepEqual(f.refused, []);
  } finally { await f.context.close(); }
});

test("call confirmation is explicit and cancellable; incoming ring cannot be overridden", async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => { window.callState = {phase:'connected',channelId:'synthetic-channel'}; window.callChanged(); window.announce(); });
    const settings = f.page.getByTestId('pwa-update-status');
    await f.page.getByTestId('pwa-update-action').click();
    assert.match(await settings.textContent(), /Звонок прервётся/); assert.equal(await f.page.evaluate(() => window.proof.skips), 0);
    await settings.getByRole('button', { name: 'Отменить перезапуск' }).click();
    assert.equal(await settings.getByRole('button', { name: 'Отменить перезапуск' }).count(), 0);
    await f.page.getByTestId('pwa-update-action').click(); await f.page.getByTestId('pwa-update-action').click();
    assert.equal(await settings.getAttribute('data-phase'), 'updating');
    await f.page.evaluate(() => { window.rings=[{}]; navigator.serviceWorker.dispatchEvent(new Event('controllerchange')); });
    assert.equal(await settings.getAttribute('data-phase'), 'failed'); assert.equal(await f.page.evaluate(() => window.proof.resume), 0);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.refused, []);
  } finally { await f.context.close(); }
});

test("Settings beforeApply uses its own close guard; refusal never bypasses dialog or outbox holds", async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => { window.hold('dialog'); window.beforeApply=()=>false; window.mount(); window.announce(); });
    await f.page.getByTestId('pwa-update-action').click(); assert.equal(await f.page.evaluate(() => window.proof.skips), 0);
    await f.page.evaluate(() => { window.beforeApply=()=>window.releaseHold(); window.mount(); });
    await f.page.getByTestId('pwa-update-action').click(); await f.page.clock.runFor(1);
    await f.page.waitForFunction(() => document.querySelector('[data-testid="pwa-update-status"]').dataset.phase === 'updating');
    await f.page.evaluate(() => { window.outgoingUnsafe=true; navigator.serviceWorker.dispatchEvent(new Event('controllerchange')); });
    assert.equal(await f.page.getByTestId('pwa-update-status').getAttribute('data-phase'), 'failed');
    assert.equal(await f.page.evaluate(() => window.proof.resume), 0);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.refused, []);
  } finally { await f.context.close(); }
});

test("a synthetic HTTP503 check is finite, retryable and does not falsely claim the current version", async () => {
  const f = await fixture();
  try {
    await f.page.waitForFunction(() => document.querySelector('[data-testid="pwa-update-status"]').dataset.phase === 'current');
    f.setStatus(503); await f.page.getByTestId('pwa-update-action').click();
    await f.page.waitForFunction(() => document.querySelector('[data-testid="pwa-update-status"]').dataset.phase === 'failed');
    f.setStatus(200); await f.page.getByTestId('pwa-update-action').click();
    await f.page.waitForFunction(() => document.querySelector('[data-testid="pwa-update-status"]').dataset.phase === 'current');
    assert.equal(await f.page.evaluate(() => window.proof.skips), 0); assert.deepEqual(f.errors, []); assert.deepEqual(f.refused, []);
  } finally { await f.context.close(); }
});

test("Android native has no web update detector/control; Windows still hands the offer to its caption store", async () => {
  const native = await fixture({ native: true });
  try {
    await native.page.evaluate(() => window.announce()); await native.page.clock.runFor(300_001);
    assert.equal(native.indexReads(), 0); assert.equal(await native.page.locator('[data-phase]').count(), 0);
    assert.equal(await native.page.evaluate(() => window.proof.posts), 0); assert.deepEqual(native.errors, []);
  } finally { await native.context.close(); }
  const desktop = await fixture({ desktop: true });
  try {
    await desktop.page.evaluate(() => window.announce());
    assert.equal(await desktop.page.getByTestId('pwa-update-status').count(), 0);
    assert.equal(await desktop.page.getByTestId('app-update-notice').count(), 0);
    assert.equal(await desktop.page.evaluate(() => window.offer()?.registration === window.registration), true);
    assert.ok(desktop.indexReads() > 0); assert.deepEqual(desktop.errors, []); assert.deepEqual(desktop.refused, []);
  } finally { await desktop.context.close(); }
});

test("quiet path keeps its existing call/recording veto and starts the minute after the last veto clears", async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => {
      window.hold('recording'); window.callState={phase:'connected'}; window.callChanged(); window.announce();
      Object.defineProperty(document, 'visibilityState', {configurable:true,get:()=> 'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await f.page.clock.runFor(90_000); assert.equal(await f.page.evaluate(() => window.proof.skips), 0);
    await f.page.evaluate(() => { window.releaseHold(); window.callState={phase:'idle'}; window.callChanged(); });
    await f.page.clock.runFor(59_999); assert.equal(await f.page.evaluate(() => window.proof.skips), 0);
    await f.page.clock.runFor(1); assert.equal(await f.page.evaluate(() => window.proof.skips), 1);
    assert.equal(await f.page.getByTestId('pwa-update-status').getAttribute('data-phase'), 'updating');
    assert.ok(await f.page.evaluate(() => sessionStorage.getItem('letscube:app-update:quiet-restart')));
    assert.deepEqual(f.errors, []); assert.deepEqual(f.refused, []);
  } finally { await f.context.close(); }
});

test("actual compiled PWA + production worker: old controller -> real waiting worker -> new document -> verified success", async () => {
  let release = 'old';
  const sw = readFileSync(new URL('../../artifacts/kub/public/sw.js', import.meta.url), 'utf8');
  const requests = [], unexpected = [], errors = [];
  const html = () => `<!doctype html><html class="dark" lang="ru"><head><meta charset="utf-8"><title>Synthetic built PWA update</title><link rel="stylesheet" href="/fixture.css"></head><body class="bg-[color:var(--kub-bg)]"><div id="root"></div><script>window.fakeWorker=false;</script><script type="module" src="/assets/index-${release}.js"></script></body></html>`;
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/' || req.url === '/index.html') { res.setHeader('Content-Type','text/html'); res.end(html()); }
    else if (/^\/assets\/index-(old|new)\.js$/.test(req.url)) { res.setHeader('Content-Type','text/javascript'); res.end(bundle); }
    else if (req.url === '/sw.js') {
      res.setHeader('Content-Type','text/javascript');
      res.end(sw.replace(/^const BUILD = .*; \/\/ @kub-sw-build$/m,
        'const BUILD = '+JSON.stringify({id:'synthetic-'+release,entry:'/assets/index-'+release+'.js',precache:['/assets/index-'+release+'.js','/fixture.css']})+'; // @kub-sw-build'));
    } else if (req.url === '/fixture.css') { res.setHeader('Content-Type','text/css'); res.end(css); }
    else if (/^\/fonts\/inter\/inter-(latin|latin-ext|cyrillic|cyrillic-ext)\.woff2$/.test(req.url)) {
      res.setHeader('Content-Type','font/woff2'); res.end(readFileSync(new URL('../../artifacts/kub/public'+req.url,import.meta.url)));
    } else if (['/manifest.json','/offline.html','/favicon.svg','/icons/apple-touch-icon.png','/icons/icon-192.png','/icons/icon-512.png','/icons/icon-maskable-512.png'].includes(req.url)) res.end('synthetic-shell-resource');
    else { unexpected.push('unlisted-loopback-request'); res.writeHead(404); res.end(); }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url='http://127.0.0.1:'+server.address().port;
  assert.notEqual(server.address().port,5188);
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).origin!==url)unexpected.push('non-loopback-request');});
  try {
    await page.goto(url);
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload(); await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    assert.equal(await page.getByTestId('pwa-update-status').getAttribute('data-phase'),'current');
    release='new';
    await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('/');await reg.update();});
    await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration('/'))?.waiting);
    await page.waitForFunction(()=>document.querySelector('[data-testid="pwa-update-status"]')?.dataset.phase==='ready');
    assert.ok(await page.evaluate(()=>!!navigator.serviceWorker.controller));
    await page.getByTestId('pwa-update-action').click();
    await page.waitForFunction(()=>document.querySelector('script[src="/assets/index-new.js"]')!==null);
    await page.waitForFunction(()=>document.querySelector('[data-testid="pwa-update-status"]')?.dataset.phase==='updated');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('letscube:pwa-update:restart')),null);
    assert.equal(await page.evaluate(async()=>!(await navigator.serviceWorker.getRegistration('/'))?.waiting),true);
    await settleEntrance(page); await page.screenshot({path:join(output,'actual-worker-new-document-success.png')});
    writeFileSync(join(output,'actual-worker.json'),JSON.stringify({controllerBefore:true,realWaitingWorker:true,
      oldEntry:'/assets/index-old.js',loadedEntry:'/assets/index-new.js',success:true,receiptConsumed:true,waitingAfter:false,
      requests:requests.length,networkOrigins:1,errors,unexpected,qa0:true},null,2));
    assert.deepEqual(errors,[]); assert.deepEqual(unexpected,[]);
  } finally {
    await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration('/');await r?.unregister();}).catch(()=>{});
    await context.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  }
});

const settleEntrance = page => page.evaluate(() => {
  for (const animation of document.getAnimations()) if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
});
for (const width of [390, 1440]) for (const theme of ['light', 'dark']) test(`${width} ${theme}: compact ready/updating/failed/success pixels fit existing material`, async () => {
  const f = await fixture({ width, theme });
  try {
    await f.page.evaluate(() => window.announce());
    await settleEntrance(f.page);
    await f.page.screenshot({ path: join(output, `${width}-${theme}-ready.png`) });
    const checkGeometry = async (icons = 2) => {
      const geometry = await f.page.getByTestId('app-update-notice').evaluate(node => {
        const box = node.getBoundingClientRect(), buttons = [...node.querySelectorAll('button')].map(b => b.getBoundingClientRect());
        const text = node.querySelector('span.min-w-0').getBoundingClientRect();
        return { fits: box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && node.scrollWidth <= node.clientWidth,
          hit: buttons.every(b => b.height >= 44), overlap: buttons.some(b => b.left < text.right - .5), svg: node.querySelectorAll('svg').length };
      });
      assert.deepEqual(geometry, { fits: true, hit: true, overlap: false, svg: icons });
    };
    await checkGeometry();
    await f.page.evaluate(() => { window.callState={phase:'connected'}; window.callChanged(); });
    await f.page.getByTestId('app-update-restart').click(); await settleEntrance(f.page);
    await f.page.screenshot({ path: join(output, `${width}-${theme}-confirm.png`) }); await checkGeometry(3);
    await f.page.getByTestId('app-update-notice').getByRole('button', {name:'Отменить перезапуск'}).click();
    await f.page.evaluate(() => { window.callState={phase:'idle'}; window.callChanged(); });
    await f.page.getByTestId('app-update-restart').click(); await settleEntrance(f.page);
    await f.page.screenshot({ path: join(output, `${width}-${theme}-updating.png`) }); await checkGeometry();
    await f.page.evaluate(() => { window.hold('recording'); navigator.serviceWorker.dispatchEvent(new Event('controllerchange')); });
    await settleEntrance(f.page);
    await f.page.screenshot({ path: join(output, `${width}-${theme}-failed.png`) }); await checkGeometry();
    assert.deepEqual(f.errors, []); assert.deepEqual(f.refused, []);
  } finally { await f.context.close(); }
  const success = await fixture({ width, theme, receipt: { from: '/assets/index-earlier.js', target: '/assets/index-old.js', at: Date.now() } });
  try {
    await success.page.waitForFunction(() => document.querySelector('[data-testid="app-update-notice"]')?.dataset.phase === 'updated');
    await settleEntrance(success.page);
    await success.page.screenshot({ path: join(output, `${width}-${theme}-success.png`) });
    assert.match(await success.page.getByTestId('app-update-notice').textContent(), /Приложение обновлено/);
    assert.deepEqual(success.errors, []); assert.deepEqual(success.refused, []);
  } finally { await success.context.close(); }
});
