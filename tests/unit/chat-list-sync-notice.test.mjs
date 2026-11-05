import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const src = fileURLToPath(new URL('../../artifacts/kub/src/', import.meta.url));
const component = path.join(src, 'components/sidebar/ChatListSyncNotice.tsx');
const requireKub = createRequire(new URL('../../artifacts/kub/package.json', import.meta.url));
const { chromium } = requireKub('@playwright/test');
const { build } = createRequire(requireKub.resolve('vite'))('esbuild');
let browser, server, origin, bundle;

async function compile(mutation) {
  let applied = 0;
  const result = await build({
    write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'es2022',
    alias: { '@': src }, define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'isolated-notice', setup(plugin) {
      plugin.onLoad({ filter: /components[\\/]kub[\\/]index\.ts$/ }, () => ({
        loader: 'ts', contents: "export {KubIcon} from './KubIcon';",
      }));
      if (mutation) plugin.onLoad({ filter: /ChatListSyncNotice\.tsx$/ }, async args => {
        const text = (await readFile(args.path, 'utf8')).replaceAll('\r\n', '\n');
        assert.equal(text.split(mutation.before).length - 1, 1, 'mutation must match actual shipped component once');
        applied++;
        return { loader: 'tsx', contents: text.replace(mutation.before, mutation.after) };
      });
    } }],
    stdin: { resolveDir: src, sourcefile: 'synthetic-chat-list-sync-notice.tsx', loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {ChatListSyncNotice} from './components/sidebar/ChatListSyncNotice';
      const nativeSet=window.setTimeout.bind(window),nativeClear=window.clearTimeout.bind(window),pending=new Map();
      window.noticeTimers={scheduled:[],cancelled:[],pending:()=>[...pending.values()]};
      window.setTimeout=(callback,delay,...args)=>{const id=nativeSet(()=>{pending.delete(id);callback(...args);},delay);
        pending.set(id,delay);window.noticeTimers.scheduled.push(delay);return id;};
      window.clearTimeout=id=>{if(pending.has(id))window.noticeTimers.cancelled.push(pending.get(id));pending.delete(id);nativeClear(id);};
      let root;window.retryCalls=[];
      window.notice={render(props,tag='first'){
        root??=createRoot(document.getElementById('notice-root'));
        flushSync(()=>root.render(<ChatListSyncNotice {...props} onRetry={()=>window.retryCalls.push(tag)}/>));
      },unmount(){if(root){flushSync(()=>root.unmount());root=null;}}};
    ` },
  });
  if (mutation) assert.equal(applied, 1);
  return result.outputFiles[0].text;
}

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, '0');
  if (!existsSync(component)) return;
  bundle = await compile();
  const { createServer } = await import(pathToFileURL(requireKub.resolve('vite')).href);
  const { default: tailwind } = await import(pathToFileURL(requireKub.resolve('@tailwindcss/vite')).href);
  server = await createServer({
    configFile: false, root: path.dirname(src), appType: 'custom',
    envDir: path.join(tmpdir(), 'letscube-notice-no-env'),
    cacheDir: path.join(tmpdir(), `letscube-sync-notice-${randomUUID()}`),
    plugins: [tailwind()], optimizeDeps: { noDiscovery: true, include: [], entries: [] },
    server: { host: '127.0.0.1', port: 0, strictPort: true }, logLevel: 'error',
  });
  server.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith('/__synthetic-notice')) return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>LETSCUBE Synthetic Chat List Notice</title>
      <link rel="stylesheet" href="/src/index.css?direct"></head>
      <body><main class="p-3"><aside aria-label="Синтетический список чатов" style="width:min(100%,320px)">
      <h1 class="px-3 py-2 text-sm font-semibold text-[color:var(--kub-text)]">Чаты</h1>
      <div id="notice-root"></div><ul class="text-sm text-[color:var(--kub-text)]">
      <li class="h-11 px-3 py-2">Тестовый чат А</li><li class="h-11 px-3 py-2">Тестовый чат Б</li></ul>
      </aside></main></body></html>`);
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  browser = await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: '0' } });
});

test.after(async () => { await browser?.close(); await server?.close(); });

async function fixture(t, { width = 390, theme = 'dark', reducedMotion = 'no-preference', code = bundle } = {}) {
  assert.ok(browser, 'actual component must exist before running browser behavior');
  const context = await browser.newContext({ viewport: { width, height: 360 }, serviceWorkers: 'block', reducedMotion });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async route => {
    assert.equal(new URL(route.request().url()).origin, new URL(origin).origin, 'synthetic fixture must never access Auth or production');
    await route.continue();
  });
  await page.goto(origin + '__synthetic-notice');
  await page.evaluate(theme => {
    document.documentElement.classList.add(theme);
    document.documentElement.classList.remove(theme === 'dark' ? 'light' : 'dark');
  }, theme);
  await page.evaluate(() => document.fonts.ready);
  const at = new Date('2026-11-05T00:00:00Z');
  await page.clock.install({ time: at });
  await page.clock.pauseAt(at);
  await page.addScriptTag({ content: code });
  assert.equal(await page.title(), 'LETSCUBE Synthetic Chat List Notice');
  assert.equal(await page.getByRole('heading', { name: 'Чаты', exact: true }).count(), 1);
  t.after(async () => {
    await page.evaluate(() => window.notice.unmount()).catch(() => {});
    await context.close();
    assert.deepEqual(errors, [], 'no runtime or console errors');
  });
  return {
    page, status: page.getByRole('status', { name: 'Обновление списка чатов', exact: true }),
    render: (stale, ownerKey = 'synthetic-owner-A', tag = 'first') => page.evaluate(
      ({ stale, ownerKey, tag }) => window.notice.render({ stale, ownerKey }, tag), { stale, ownerKey, tag }),
    pending: () => page.evaluate(() => window.noticeTimers.pending()),
  };
}

test('component module exists for the always-mounted Sidebar integration', () => {
  assert.ok(existsSync(component), 'missing ChatListSyncNotice.tsx: persistent chat-list recovery notice is not implemented');
});

test('healthy mounted component stays absent and schedules no timer', async t => {
  const f = await fixture(t); await f.render(false); await f.page.clock.runFor(10_000);
  assert.equal(await f.status.count(), 0); assert.deepEqual(await f.pending(), []);
});

test('persistent stale is invisible at literal1199ms and appears at literal1200ms as a named polite status', async t => {
  const f = await fixture(t); await f.render(true);
  assert.deepEqual(await f.pending(), [1200]);
  await f.page.clock.runFor(1199); assert.equal(await f.status.count(), 0);
  await f.page.clock.runFor(1); assert.equal(await f.status.count(), 1);
  assert.equal(await f.status.getAttribute('aria-live'), 'polite');
  assert.match(await f.status.innerText(), /^Не удалось обновить чаты$/);
  assert.equal(await f.page.getByRole('alert').count(), 0);
});

test('short transient recovery never flashes and the next stale period gets a fresh full delay', async t => {
  const f = await fixture(t); await f.render(true); await f.page.clock.runFor(1199);
  await f.render(false); assert.deepEqual(await f.pending(), []);
  await f.page.clock.runFor(5000); assert.equal(await f.status.count(), 0);
  await f.render(true); await f.page.clock.runFor(1199); assert.equal(await f.status.count(), 0);
  await f.page.clock.runFor(1); assert.equal(await f.status.count(), 1);
  await f.render(false); assert.equal(await f.status.count(), 0);
});

test('owner change while waiting cancels the old timer and grants the new owner no elapsed time', async t => {
  const f = await fixture(t); await f.render(true); await f.page.clock.runFor(1000);
  await f.render(true, 'synthetic-owner-B');
  assert.deepEqual(await f.pending(), [1200]);
  assert.deepEqual(await f.page.evaluate(() => window.noticeTimers.cancelled), [1200]);
  await f.page.clock.runFor(1199); assert.equal(await f.status.count(), 0);
  await f.page.clock.runFor(1); assert.equal(await f.status.count(), 1);
});

test('visible old owner retires immediately, including rapid A to B to A ownership changes', async t => {
  const f = await fixture(t); await f.render(true); await f.page.clock.runFor(1200);
  assert.equal(await f.status.count(), 1);
  await f.render(true, 'synthetic-owner-B'); assert.equal(await f.status.count(), 0);
  await f.render(true, 'synthetic-owner-A'); assert.equal(await f.status.count(), 0);
  await f.page.clock.runFor(1199); assert.equal(await f.status.count(), 0);
  await f.page.clock.runFor(1); assert.equal(await f.status.count(), 1);
});

test('unmount clears the owned timer and a later mount cannot inherit it', async t => {
  const f = await fixture(t); await f.render(true); await f.page.clock.runFor(500);
  await f.page.evaluate(() => window.notice.unmount()); assert.deepEqual(await f.pending(), []);
  await f.page.clock.runFor(5000); assert.equal(await f.status.count(), 0);
  await f.render(true); await f.page.clock.runFor(1199); assert.equal(await f.status.count(), 0);
  await f.page.clock.runFor(1); assert.equal(await f.status.count(), 1);
  await f.page.evaluate(() => window.notice.unmount()); assert.equal(await f.status.count(), 0);
});

test('retry uses its latest callback, is keyboard reachable and does not restart a settled notice', async t => {
  const f = await fixture(t); await f.render(true); await f.page.clock.runFor(1200);
  await f.render(true, 'synthetic-owner-A', 'latest');
  const button = f.page.getByRole('button', { name: 'Повторить обновление чатов', exact: true });
  assert.equal(await button.getAttribute('title'), 'Повторить обновление чатов');
  assert.equal(await button.locator('svg').count(), 1);
  assert.equal(await button.innerText(), '');
  await f.page.keyboard.press('Tab');
  assert.equal(await button.evaluate(node => node === document.activeElement), true);
  assert.equal(await button.evaluate(node => getComputedStyle(node).outlineWidth), '2px');
  await f.page.keyboard.press('Enter');
  assert.deepEqual(await f.page.evaluate(() => window.retryCalls), ['latest']);
  assert.equal(await f.status.count(), 1); assert.deepEqual(await f.pending(), []);
});

for (const width of [320, 390, 1440]) for (const theme of ['dark', 'light']) {
  test(`synthetic ${width} ${theme}: exact neutral inline pixels, no overflow or motion`, async t => {
    const f = await fixture(t, { width, theme, reducedMotion: 'reduce' });
    await f.render(true); await f.page.clock.runFor(1200);
    const styles = await f.status.evaluate(node => {
      const css = getComputedStyle(node), button = node.querySelector('button'), rect = node.getBoundingClientRect();
      return { color: css.color, muted: getComputedStyle(document.documentElement).getPropertyValue('--kub-muted').trim(),
        shadow: css.boxShadow, background: css.backgroundColor, animation: css.animationName, transition: css.transitionDuration,
        buttonShadow: getComputedStyle(button).boxShadow, fits: node.scrollWidth <= node.clientWidth,
        height: rect.height, left: rect.left, right: rect.right, viewport: innerWidth };
    });
    const expectedColor = await f.page.evaluate(color => {
      const node = document.createElement('span'); node.style.color = color; document.body.append(node);
      const result = getComputedStyle(node).color; node.remove(); return result;
    }, styles.muted);
    assert.equal(styles.color, expectedColor);
    assert.equal(styles.shadow, 'none'); assert.equal(styles.buttonShadow, 'none');
    assert.equal(styles.background, 'rgba(0, 0, 0, 0)');
    assert.equal(styles.animation, 'none'); assert.equal(styles.transition, '0s');
    assert.equal(styles.fits, true); assert.ok(styles.height <= 52);
    assert.ok(styles.left >= 0 && styles.right <= styles.viewport);
    assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.KUB_CHAT_LIST_NOTICE_CAPTURE) {
      await mkdir(process.env.KUB_CHAT_LIST_NOTICE_CAPTURE, { recursive: true });
      await f.page.screenshot({ path: path.join(process.env.KUB_CHAT_LIST_NOTICE_CAPTURE, `chat-list-sync-notice-${width}-${theme}.png`) });
    }
  });
}

test('loaded timing, owner-key and cleanup omissions are refused by the same literal behavioral oracles', async t => {
  const mutations = [
    { before: '}, 1200);', after: '}, 0);', oracle: async f => {
      await f.render(true); await f.page.clock.runFor(0); assert.equal(await f.status.count(), 0);
    } },
    { before: 'key={ownerKey}', after: 'key="shared-owner"', oracle: async f => {
      await f.render(true); await f.page.clock.runFor(1200); await f.render(true, 'synthetic-owner-B');
      assert.equal(await f.status.count(), 0);
    } },
    { before: 'return () => clearTimeout(timer);', after: 'return () => {};', oracle: async f => {
      await f.render(true); await f.page.evaluate(() => window.notice.unmount()); assert.deepEqual(await f.pending(), []);
    } },
  ];
  for (const mutation of mutations) {
    const f = await fixture(t, { code: await compile(mutation) });
    await assert.rejects(() => mutation.oracle(f), { name: 'AssertionError' });
  }
});
