import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { chromium, webkit } from '@playwright/test';

process.env.KUB_QA_ALLOW_MUTATIONS = '0';
const origin = 'http://127.0.0.1:19646';
const root = new URL('../../artifacts/kub/src/lib/historyCache/', import.meta.url);
const compile = name => ts.transpileModule(readFileSync(new URL(name, root), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const modules = { '/storage.js': compile('storage.ts'), '/offline.js': compile('offline.ts') };
const identity = { userId: '89000000-0000-4000-8000-000000000001', sessionId: '89000000-0000-4000-8000-000000000002' };
const chatId = '89000000-0000-4000-8000-000000000003';

async function fixture(t, engine) {
  const browser = await engine.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: 'block' }); t.after(() => context.close());
  let external = 0;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || (url.pathname !== '/' && !modules[url.pathname])) { external++; return route.abort(); }
    return route.fulfill({ contentType: url.pathname === '/' ? 'text/html' : 'text/javascript',
      body: url.pathname === '/' ? '<!doctype html><title>Synthetic history clock</title>' : modules[url.pathname] });
  });
  t.after(() => assert.equal(external, 0));
  const first = await context.newPage(), second = await context.newPage();
  await first.goto(origin); await second.goto(origin);
  return { first, second };
}

for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  test(`${name}: a later profile commit cannot discard an earlier admitted history page`, async t => {
    const { first, second } = await fixture(t, engine);
    await first.evaluate(async ({ identity, chatId }) => {
      const { browserHistoryCacheStorage } = await import('/storage.js');
      const { createOfflineHistory } = await import('/offline.js');
      window.clock = 1000;
      const cache = createOfflineHistory({ storage: browserHistoryCacheStorage(), namespace: 'synthetic', now: () => window.clock });
      cache.setIdentity(identity); window.owner = cache.capture();
      const original = crypto.subtle.digest.bind(crypto.subtle); let release, enter, matches = 0;
      window.hashStarted = new Promise(resolve => { enter = resolve; });
      const held = new Promise(resolve => { release = resolve; });
      window.releaseHash = release;
      crypto.subtle.digest = async (...args) => {
        const payload = new TextDecoder().decode(args[1]);
        if (payload.includes('messages:' + chatId + ':') && !payload.includes('default-scope') && ++matches === 2) { enter(); await held; }
        return original(...args);
      };
      window.restoreDigest = () => { crypto.subtle.digest = original; };
      window.pending = owner.writeMessages({ chatId, topicId: undefined, generalTopicIds: [] }, [{
        id: '89000000-0000-4000-8000-000000000004', chat_id: chatId, topic_id: null, user_id: identity.userId,
        type: 'text', content: 'Synthetic received text', created_at: '2026-10-26T00:00:00Z',
      }], { hasMore: false });
      await window.hashStarted;
    }, { identity, chatId });
    const profile = await second.evaluate(async identity => {
      const { browserHistoryCacheStorage } = await import('/storage.js');
      const { createOfflineHistory } = await import('/offline.js');
      const cache = createOfflineHistory({ storage: browserHistoryCacheStorage(), namespace: 'synthetic', now: () => 2000 });
      cache.setIdentity(identity);
      return cache.capture().writeProfile({ id: identity.userId, full_name: 'Synthetic',
        created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z' });
    }, identity);
    assert.equal(profile, true, 'the later other-document profile must actually commit');
    const result = await first.evaluate(async chatId => {
      window.clock = 2000; window.releaseHash();
      try { const written = await pending; return { written, restored: (await owner.readDefaultMessages(chatId))?.messages.length ?? 0 }; }
      finally { window.restoreDigest(); }
    }, chatId);
    assert.deepEqual(result, { written: true, restored: 1 }, 'ordinary concurrent writes are not a clock rollback');
  });

  test(`${name}: actual clock rollback still refuses a new numeric-timestamp write`, async t => {
    const { first } = await fixture(t, engine);
    const result = await first.evaluate(async () => {
      const { browserHistoryCacheStorage } = await import('/storage.js');
      const storage = browserHistoryCacheStorage(), lease = await storage.capture('synthetic', 'owner');
      const value = async payload => ({ payload, digest: [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)))].map(v => v.toString(16).padStart(2, '0')).join('') });
      const first = await storage.write(lease, 'future', await value('synthetic future'), 2000);
      const rollback = await storage.write(lease, 'new', await value('synthetic new'), 1000);
      return { first, rollback, absent: await storage.read(lease, 'new', 2000) === null,
        retained: (await storage.read(lease, 'future', 2000))?.payload === 'synthetic future' };
    });
    assert.deepEqual(result, { first: true, rollback: false, absent: true, retained: true });
  });
}
