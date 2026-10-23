import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { chromium, webkit } from '@playwright/test';

const origin = 'http://127.0.0.1:18765';
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const modules = Object.fromEntries(await Promise.all(['offline', 'storage'].map(async name => [
  '/' + name + '.js', compile(await readFile(new URL(`../../artifacts/kub/src/lib/historyCache/${name}.ts`, import.meta.url), 'utf8')),
])));
for (const [engineName, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  test(`${engineName}: actual IndexedDB cold display, prefix retirement and session separation`, { timeout: 40000 }, async t => {
    const browser = await engine.launch({ headless: true }); t.after(() => browser.close());
    const context = await browser.newContext({ serviceWorkers: 'block' }); t.after(() => context.close());
    let unexpected = 0;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname !== '/' && !modules[url.pathname]) { unexpected++; return route.abort(); }
      return route.fulfill({ contentType: url.pathname === '/' ? 'text/html' : 'text/javascript', body: modules[url.pathname] ?? '<!doctype html><title>Synthetic offline cache</title><div id="content"></div>' });
    });
    const open = async () => {
      const page = await context.newPage(); await page.goto(origin);
      await page.evaluate(async () => {
        const { browserHistoryCacheStorage } = await import('/storage.js');
        const { createOfflineHistory } = await import('/offline.js');
        const id = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        const identity = { userId: id(1), sessionId: id(2) }, scope = { chatId: id(3), topicId: undefined, generalTopicIds: [] };
        const cache = createOfflineHistory({ storage: browserHistoryCacheStorage(), namespace: 'synthetic-backend' }); cache.setIdentity(identity);
        const row = { id: id(4), chat_id: id(3), topic_id: null, user_id: id(1), type: 'text', content: 'Synthetic durable received message', created_at: '2026-10-23T00:00:00.123456Z' };
        Object.assign(globalThis, { cache, identity, scope, row, owner: cache.capture() });
      });
      return page;
    };
    const first = await open();
    assert.equal(await first.evaluate(() => owner.writeMessages(scope, [row], { hasMore: true })), true);
    await first.close();
    const cold = await open();
    await cold.evaluate(async () => { const saved = await owner.readMessages(scope); document.getElementById('content').textContent = saved?.messages[0]?.content ?? ''; });
    assert.equal(await cold.locator('#content').textContent(), 'Synthetic durable received message');
    const other = await open();
    await other.evaluate(() => cache.setIdentity({ ...identity, sessionId: '71000000-0000-4000-8000-000000000099' }));
    assert.equal(await other.evaluate(() => cache.capture().readMessages(scope)), null);
    // Switching away from a session retires its data in every document.
    assert.equal(await cold.evaluate(() => owner.readMessages(scope)), null);
    const writer = await open();
    assert.equal(await writer.evaluate(() => owner.writeMessages(scope, [row], { hasMore: false })), true);
    await writer.evaluate(() => owner.invalidateChat(scope.chatId));
    assert.equal(await writer.evaluate(() => cache.capture().readMessages(scope)), null);
    assert.equal(await writer.evaluate(() => owner.writeMessages(scope, [row], { hasMore: false })), false);
    assert.equal(unexpected, 0);
  });
}
