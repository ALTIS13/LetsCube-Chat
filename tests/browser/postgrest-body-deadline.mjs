import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(root + '/artifacts/kub/package.json');
const esbuild = createRequire(require.resolve('vite'))('esbuild');
assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, '0');
const file = 'artifacts/kub/src/lib/supabase/deadlineFetch.ts';
const compile = contents => esbuild.buildSync({ stdin: { contents, sourcefile: 'deadlineFetch.ts',
  resolveDir: root + '/artifacts/kub/src/lib/supabase', loader: 'ts' },
  bundle: true, write: false, format: 'iife', globalName: 'DeadlineFixture', platform: 'browser', target: 'es2020',
}).outputFiles[0].text;
const source = readFileSync(root + '/' + file, 'utf8');
const gate = 'if (isPostgrest(input) && response.body && response.status !== 0)';
assert.equal(source.split(gate).length, 2, 'one calibrated body-admission mutation');
const baseline = compile(source.replace(gate, 'if (false && response.body && response.status !== 0)'));
const current = compile(source);
const held = new Map(), results = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/') { response.end('<!doctype html><title>Fictional HTTP fixture</title>'); return; }
  if (url.pathname === '/rest/v1/redirect') {
    response.writeHead(302, { location: '/rest/v1/messages' + url.search }); response.end(); return;
  }
  if (url.pathname !== '/rest/v1/messages') { response.writeHead(404); response.end(); return; }
  const id = url.searchParams.get('id'); assert.match(id, /^\d+$/);
  response.writeHead(200, { 'content-type': 'application/json', 'x-fixture': 'native-body' });
  response.write('{"ok":'); held.set(id, response);
  response.on('close', () => { held.delete(id); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let nextId = 0;
try {
  for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await browserType.launch({ headless: true });
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      const selected = process.argv[2]?.startsWith('--case=') ? process.argv[2].slice(7) : null;
      const scenarios = [...(engine === 'chromium' ? ['baseline'] : []), 'deadline', 'network-change', 'caller', 'complete-clone', 'redirect-clone', 'cancel'];
      if (selected) assert.ok(['baseline', ...scenarios].includes(selected));
      for (const scenario of scenarios.filter(value => !selected || value === selected)) {
        const page = await context.newPage();
        let pageErrors = 0; page.on('pageerror', () => { pageErrors++; });
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: scenario === 'baseline' ? baseline : current });
        const id = String(++nextId), url = origin + (scenario === 'redirect-clone' ? '/rest/v1/redirect' : '/rest/v1/messages') + '?id=' + id;
        await page.evaluate(({ url, scenario }) => {
          let now = 0, next = 0;
          const timers = new Map();
          const state = { headers: false, status: 'pending', bodies: [], metadata: null };
          const caller = new AbortController();
          const fetcher = DeadlineFixture.createDeadlineFetch((input, init) => {
            window.fixture.signal = init.signal;
            return window.fetch(input, init).then(response => { window.fixture.original = response; return response; });
          }, () => now, {
            set(run, delay) { const id = ++next; timers.set(id, { run, at: now + delay }); return id; },
            clear(id) { timers.delete(id); },
          });
          const observe = promise => promise.then(value => {
            state.bodies.push(value); state.status = 'fulfilled';
          }, error => { Object.assign(state, { status: 'rejected', errorName: error?.name, errorMessage: error?.message, cut: error?.kubCut,
            callerOwned: error === window.fixture.reason }); });
          window.fixture = { state, fetcher, caller, timers,
            advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run(); } },
          };
          void fetcher(url, { signal: caller.signal }).then(response => {
            state.headers = true;
            state.wrapped = response !== window.fixture.original;
            state.metadata = { url: response.url, status: response.status, redirected: response.redirected,
              type: response.type, fixtureHeader: response.headers.get('x-fixture') };
            if (scenario === 'cancel') {
              window.fixture.cancel = () => response.body.cancel('fixture cancel').then(() => { state.status = 'cancelled'; });
              return;
            }
            if (scenario.endsWith('clone')) {
              const clone = response.clone();
              state.cloneMetadata = { url: clone.url, redirected: clone.redirected, type: clone.type };
              void observe(Promise.all([response.text(), clone.text()]));
            } else void observe(response.text());
          }).catch(error => { Object.assign(state, { status: 'rejected-before-headers', errorName: error?.name }); });
        }, { url, scenario });
        await page.waitForFunction(() => window.fixture.state.headers, null, { timeout: 10000 });
        if (scenario.endsWith('clone')) {
          assert.ok(held.has(id)); held.get(id).end('true}');
          await page.waitForFunction(() => window.fixture.state.status === 'fulfilled', null, { timeout: 5000 });
        } else if (scenario === 'cancel') {
          await page.evaluate(() => window.fixture.cancel());
        } else {
          await page.evaluate(scenario => {
            if (scenario === 'caller') {
              fixture.reason = new DOMException('fixture caller', 'AbortError'); fixture.caller.abort(fixture.reason);
            } else {
              fixture.advance(scenario === 'network-change' ? 3000 : 30000);
              if (scenario === 'network-change') fixture.cuts = fixture.fetcher.cutStrandedReads();
            }
          }, scenario);
          if (scenario !== 'baseline') await page.waitForFunction(() => window.fixture.state.status === 'rejected', null, { timeout: 5000 });
        }
        const fact = await page.evaluate(() => ({ ...fixture.state, waiting: fixture.fetcher.waiting(), timers: fixture.timers.size, cuts: fixture.cuts,
          reasonName: fixture.signal?.reason?.name, reasonMessage: fixture.signal?.reason?.message, reasonOwned: fixture.signal?.reason === fixture.reason }));
        assert.equal(fact.headers, true); assert.equal(fact.metadata.status, 200);
        assert.equal(fact.metadata.url, origin + '/rest/v1/messages?id=' + id);
        assert.equal(fact.metadata.fixtureHeader, 'native-body');
        if (scenario === 'baseline') {
          assert.equal(fact.status, 'pending'); assert.equal(fact.waiting, 0); assert.equal(fact.timers, 0);
        } else {
          assert.equal(fact.waiting, 0); assert.equal(fact.timers, 0);
          if (scenario.endsWith('clone')) {
            assert.deepEqual(fact.bodies, [['{"ok":true}', '{"ok":true}']]);
            assert.equal(fact.metadata.redirected, scenario === 'redirect-clone');
            assert.equal(fact.cloneMetadata.url, fact.metadata.url);
            assert.equal(fact.cloneMetadata.redirected, fact.metadata.redirected);
            assert.equal(fact.cloneMetadata.type, fact.metadata.type);
          } else if (scenario === 'cancel') assert.equal(fact.status, 'cancelled');
          else if (scenario === 'caller') { assert.equal(fact.errorName, 'AbortError'); assert.equal(fact.callerOwned, true); }
          else {
            assert.equal(fact.errorName, 'TypeError'); assert.equal(fact.errorMessage, 'Failed to fetch');
            if (fact.cut !== undefined) assert.equal(fact.cut, scenario);
          }
          if (scenario === 'network-change') assert.equal(fact.cuts, 1);
        }
        assert.equal(pageErrors, 0);
        results.push({ engine, scenario, status: 'PASS', pageErrors, requestsToProduction: 0 });
        await page.close();
      }
      await context.close();
    } finally { await browser.close(); }
  }
  const receipt = { checkedAt: new Date().toISOString(), results, installedDeviceAcceptance: false,
    serviceWorkers: false, captures: false, personalSession: false, productionMutations: 0 };
  console.log(JSON.stringify(receipt));
} finally {
  for (const response of held.values()) response.destroy();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
