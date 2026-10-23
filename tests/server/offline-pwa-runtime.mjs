// Explicit built-artifact acceptance, not part of ordinary source unit tests.
// No browser route mocks: service-worker-owned requests use real loopback HTTP.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { person, chat, membership, message } from '../e2e/helpers/messageActionsFixture.ts';

const root = path.resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'explicit built fixture directory required');
const origin = 'http://127.0.0.1:18766';
const ME = person('75000000-0000-4000-8000-000000000001', 'Synthetic offline owner');
const PEER = person('75000000-0000-4000-8000-000000000002', 'Synthetic offline peer');
const CHAT = '75000000-0000-4000-8000-000000000010';
const SID = '75000000-0000-4000-8000-000000000020';
const ID = '75000000-0000-4000-8000-000000000030';
const ROW = message(ID, CHAT, PEER, 'Synthetic built offline history', new Date(Date.now() - 60000).toISOString());
const members = [membership(CHAT, ME, 'member', null), membership(CHAT, PEER, 'member', null)];
let changed = false, calls = 0, refreshes = 0;
const session = () => ({ access_token: `fixture.${Buffer.from(JSON.stringify({ sub: ME.id, session_id: SID, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'synthetic-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  token_type: 'bearer', user: { ...ME, user_metadata: {}, app_metadata: {} } });
const resources = new Map();
const runtimeErrors = [];
const failedRequests = [];
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = createServer(async (req, res) => {
  try {
    // Keep the real browser/SW cache semantics. Playwright routing disables
    // Chromium's HTTP cache and turns subrequests into cache:"reload".
    // CSP provides the outbound fixture boundary without intercepting requests.
    res.setHeader('content-security-policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:18766");
    const url = new URL(req.url, origin);
    const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/auth/v1/')) {
      calls++;
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const resource = url.pathname.slice('/rest/v1/'.length);
      resources.set(resource, (resources.get(resource) ?? 0) + 1);
      const single = (req.headers.accept ?? '').includes('application/vnd.pgrst.object');
      const one = rows => single ? rows[0] ?? null : rows;
      if (url.pathname === '/auth/v1/user') return json({ ...ME, user_metadata: {}, app_metadata: {} });
      if (url.pathname === '/auth/v1/token') { refreshes++; return json(session()); }
      if (resource === 'profiles') {
        const selected = url.searchParams.get('id');
        return json(one([ME, PEER].filter(row => !selected || selected === 'eq.' + row.id || selected.startsWith('in.(') && selected.includes(row.id))));
      }
      if (resource === 'chat_members') return json(one(members.filter(row => !url.searchParams.has('user_id') || url.searchParams.get('user_id') === 'eq.' + row.user_id)));
      if (resource === 'chats') return json(one([{ ...chat(CHAT, 'private', null, ROW.created_at), members }]));
      if (resource === 'messages') return json(one(url.searchParams.get('pinned') === 'eq.true' ? [] : [{ ...ROW, content: changed ? 'Synthetic built reconciled history' : ROW.content }]));
      if (resource === 'rpc/chat_list_summaries') return json({ code: 'PGRST202', message: 'Synthetic unavailable optional summaries' }, 404);
      if (resource.startsWith('rpc/')) return json(null);
      return json(one([]));
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let target = path.resolve(root, relative || 'index.html');
    if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    let bytes;
    try { bytes = await readFile(target); } catch {
      if (path.extname(target)) { res.writeHead(404); return res.end(); }
      target = path.join(root, 'index.html'); bytes = await readFile(target);
    }
    res.writeHead(200, { 'content-type': mime[path.extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(bytes);
  } catch { res.writeHead(500); res.end(); }
});
const profileDir = await mkdtemp(path.join(tmpdir(), 'letscube-offline-pwa-'));
let context;
const launch = async () => {
  context = await chromium.launchPersistentContext(profileDir, { headless: true, serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
  context.on('page', page => page.on('pageerror', error => runtimeErrors.push(error.message)));
  context.on('requestfailed', request => {
    const url = new URL(request.url());
    if (url.origin === origin) failedRequests.push({ path: url.pathname, failure: request.failure()?.errorText });
  });
  context.on('serviceworker', worker => worker.evaluate(() => {
    self.fixtureFetches = [];
    self.addEventListener('fetch', event => self.fixtureFetches.push({
      path: new URL(event.request.url).pathname, mode: event.request.mode, cache: event.request.cache,
    }));
  }).catch(() => {}));
  return context;
};
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(18766, '127.0.0.1', resolve); });
  await launch();
  const first = await context.newPage();
  await first.addInitScript(({ me, sid }) => {
    const claims = btoa(JSON.stringify({ sub: me.id, session_id: sid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }));
    localStorage.setItem('kub-auth', JSON.stringify({ access_token: `fixture.${claims}.fixture`, refresh_token: 'synthetic-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { ...me, user_metadata: {}, app_metadata: {} } }));
  }, { me: ME, sid: SID });
  await first.goto(origin);
  await first.getByTestId('chat-list-item').filter({ hasText: PEER.full_name }).click();
  await first.locator(`[data-message-id="${ID}"]`).getByText(ROW.content, { exact: true }).waitFor();
  await first.waitForFunction(async () => {
    if (!navigator.serviceWorker.controller) return false;
    const names = await caches.keys();
    const complete = await Promise.all(names.map(async name => { const cache = await caches.open(name); return !!await cache.match('/'); }));
    return complete.some(Boolean);
  });
  await first.waitForFunction(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('kub-history-cache'); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    try { return await new Promise(resolve => { const r = db.transaction('records').objectStore('records').getAll(); r.onsuccess = () => resolve(r.result.some(row => row.scope?.startsWith('messages:'))); }); } finally { db.close(); }
  });
  await context.close(); context = null;
  await launch(); await context.setOffline(true);
  const cold = await context.newPage();
  const beforeOffline = calls;
  await cold.goto(`${origin}/chat/${CHAT}`, { waitUntil: 'domcontentloaded' });
  await cold.locator(`[data-message-id="${ID}"]`).getByText(ROW.content, { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(calls, beforeOffline, 'cold process restore must use local shell/history, not HTTP');
  assert.equal(await cold.getByTestId('offline-history-status').count(), 1);
  changed = true; await context.setOffline(false);
  await cold.evaluate(() => window.dispatchEvent(new Event('online')));
  await cold.locator(`[data-message-id="${ID}"]`).getByText('Synthetic built reconciled history', { exact: true }).waitFor({ timeout: 20000 });
  assert.ok(calls > beforeOffline);
  // An expired SDK token must not prevent last-known display from mounting.
  // The cached session is never given to the SDK as a new authenticated session.
  await cold.evaluate(async () => {
    const value = JSON.parse(localStorage.getItem('kub-auth'));
    const claims = JSON.parse(atob(value.access_token.split('.')[1]));
    claims.exp = Math.floor(Date.now() / 1000) - 3600;
    value.access_token = `fixture.${btoa(JSON.stringify(claims))}.fixture`;
    value.expires_at = claims.exp;
    localStorage.setItem('kub-auth', JSON.stringify(value));
  });
  await context.close(); context = null;
  await launch(); await context.setOffline(true);
  const expired = await context.newPage(), beforeExpired = calls;
  await expired.goto(`${origin}/chat/${CHAT}`, { waitUntil: 'domcontentloaded' });
  await expired.locator(`[data-message-id="${ID}"]`).getByText('Synthetic built reconciled history', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(calls, beforeExpired);
  const beforeRefresh = refreshes;
  await context.setOffline(false);
  await expired.evaluate(() => window.dispatchEvent(new Event('online')));
  await expired.getByTestId('offline-history-status').waitFor({ state: 'hidden', timeout: 20000 });
  assert.ok(refreshes > beforeRefresh, 'the real SDK must refresh on reconnection');
  console.log(JSON.stringify({ status: 'PASS_BUILT_PWA_OFFLINE', coldBrowserProcess: true, actualServiceWorker: true,
    offlineHttpCalls: 0, historyRestored: true, changedHistoryReconciled: true, expiredTokenOfflineRestored: true, sdkRefreshAfterReconnect: true, captures: false }));
} catch (error) {
  const page = context?.pages().at(-1);
  console.log(JSON.stringify({ status: 'BUILT_PWA_REFUSED', resources: Object.fromEntries(resources), runtimeErrors, failedRequests,
    worker: await Promise.all((context?.serviceWorkers() ?? []).map(worker => worker.evaluate(() => self.fixtureFetches))),
    page: page ? { path: new URL(page.url()).pathname, headings: await page.getByRole('heading').allTextContents(),
      listRows: await page.getByTestId('chat-list-item').count(),
      controlled: await page.evaluate(() => ({ controlled: !!navigator.serviceWorker.controller, navigation: performance.getEntriesByType('navigation').map(row => ({ workerStart: row.workerStart, type: row.type })) })),
      cache: await page.evaluate(async () => Promise.all((await caches.keys()).map(async name => ({
        name, paths: (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname),
      })))) } : null }));
  throw error;
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  // Exact synthetic profile created above; never a user's browser profile.
  assert.equal(path.dirname(profileDir), tmpdir());
  assert.ok(path.basename(profileDir).startsWith('letscube-offline-pwa-'));
  await rm(profileDir, { recursive: true, force: true });
}
