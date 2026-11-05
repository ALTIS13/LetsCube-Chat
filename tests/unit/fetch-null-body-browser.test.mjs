import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(new URL('../../artifacts/kub/package.json', import.meta.url));
const { chromium, webkit } = require('@playwright/test');
const source = new URL('../../artifacts/kub/src/lib/supabase/', import.meta.url);
const modules = new Map(['deadlineFetch.ts', 'requestDeadline.ts'].map(name => [
  '/' + name,
  ts.transpileModule(readFileSync(new URL(name, source), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText,
]));

test('native browser fetch preserves bodyless responses and retires their deadline', async t => {
  const routes = new Map([
    ['/auth/v1/logout?scope=local', ['POST', 204]],
    ['/rest/v1/fixture?case=reset', ['GET', 205]],
    ['/rest/v1/fixture?case=not-modified', ['GET', 304]],
  ]);
  const server = createServer((request, response) => {
    if (request.url === '/') return response.writeHead(200, { 'content-type': 'text/html' }).end('Fixture');
    if (modules.has(request.url)) {
      return response.writeHead(200, { 'content-type': 'text/javascript' }).end(modules.get(request.url));
    }
    const route = routes.get(request.url);
    if (route && route[0] === request.method) {
      return response.writeHead(route[1], { 'cache-control': 'no-store', 'x-fixture': 'bodyless' }).end();
    }
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  for (const engine of [chromium, webkit]) await t.test(engine.name(), async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const receipts = await page.evaluate(async routes => {
        const { createDeadlineFetch } = await import('/deadlineFetch.ts');
        const observe = async (path, method, transport) => {
          let original;
          const bounded = createDeadlineFetch(async (input, init) => (original = await transport(input, init)));
          const result = await bounded(new URL(path, location.href), { method, cache: 'no-store' });
          return { same: result === original, status: result.status, marker: result.headers.get('x-fixture'),
            bodyUsed: result.bodyUsed, waiting: bounded.waiting() };
        };
        const receipts = [];
        for (const [path, [method, status]] of routes) {
          receipts.push(await observe(path, method, (input, init) => fetch(input, init)));
          // Keep the observed WebView shape covered even when an engine fixes its fetch implementation.
          receipts.push(await observe(path, method, () => Object.defineProperty(new Response(null, {
            status, headers: { 'x-fixture': 'bodyless' },
          }), 'body', { value: new ReadableStream({ start(controller) { controller.close(); } }) })));
        }
        return receipts;
      }, [...routes]);
      assert.deepEqual(receipts, [204, 204, 205, 205, 304, 304].map(status => ({
        same: true, status, marker: 'bodyless', bodyUsed: false, waiting: 0,
      })));
    } finally {
      await browser.close();
    }
  });
});
