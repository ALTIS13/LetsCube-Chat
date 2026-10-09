import { expect, test } from '@playwright/test';
import { chat, membership, openFixture, person, requireFixtureServer } from './helpers/messageActionsFixture';

test.use({ screenshot: 'off', trace: 'off', video: 'off', serviceWorkers: 'block' });

const me = person('93111111-1111-4111-8111-000000000001', 'Fictional Reader');
const at = '2026-10-09T09:00:00.000Z';
const ids = Array.from({ length: 32 }, (_, i) => `93222222-2222-4222-8222-${String(i + 1).padStart(12, '0')}`);

test('sidebar search respects reduced motion without losing focus or query', async ({ page, request }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe('0');
  // Keep the wheel scenario scrollable even in the 2160px-tall desktop project.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ ...viewport, height: Math.min(viewport.height, 900) });
  await requireFixtureServer(request);
  let unexpectedRequests = 0;
  let unmockedRequests = 0;
  const appOrigin = new URL(test.info().project.use.baseURL as string).origin;
  page.context().on('request', (request) => {
    const origin = new URL(request.url()).origin;
    if (origin !== appOrigin && origin !== 'http://127.0.0.1:54321') unexpectedRequests++;
  });
  await page.context().routeWebSocket('**', (socket) => socket.close());
  await page.context().route('**/*', (route) => {
    if (new URL(route.request().url()).origin === appOrigin) return route.fallback();
    unmockedRequests++;
    return route.abort('blockedbyclient');
  });
  await openFixture(page, {
    me,
    chats: ids.map((id, i) => chat(id, 'group', `Fictional Chat ${i + 1}`, at)),
    memberships: ids.map((id) => membership(id, me, 'owner', at)),
    messages: [],
    theme: 'dark',
    rpc: (name) => name === 'global_search_v2' ? { body: ids.slice(0, 24).map((id, i) => ({
      result_type: 'chat', id, chat_id: id, title: `Fictional Chat ${i + 1}`,
      subtitle: null, snippet: null, avatar_url: null, created_at: at, rank: 1,
    })) } : undefined,
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('chat-list-item')).toHaveCount(32);
  const field = page.getByTestId('sidebar-search-input');
  const wrapper = field.locator('xpath=../..');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
  const normalDuration = await wrapper.evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(normalDuration).toBe('0.22s');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  // An independent literal control distinguishes a media-emulation failure from a UI regression.
  const controlDuration = await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '#search-motion-control { transition-duration: 200ms; } @media (prefers-reduced-motion: reduce) { #search-motion-control { transition-duration: 1ms; } }';
    const control = document.createElement('span');
    control.id = 'search-motion-control';
    control.hidden = true;
    document.head.append(style);
    document.body.append(control);
    const duration = getComputedStyle(control).transitionDuration;
    control.remove();
    style.remove();
    return duration;
  });
  expect(controlDuration).toBe('0.001s');
  expect(await wrapper.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0.001s');

  await page.getByTestId('chat-list-scroller').evaluate((node) => { node.scrollTop = 160; });
  if (page.viewportSize()!.width < 768) {
    await expect(wrapper).toHaveClass(/max-h-0/);
    await page.getByRole('button', { name: '\u041f\u043e\u0438\u0441\u043a', exact: true }).click();
  } else await field.click();
  await expect(field).toBeFocused();
  await field.fill('Fictional');
  const resultsScroller = page.getByTestId('sidebar-global-search-results').locator('.overflow-y-auto');
  await expect(resultsScroller).toBeVisible();
  await expect(page.getByTestId('sidebar-search-result-chat')).toHaveCount(24);
  await expect.poll(() => resultsScroller.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(200);
  const beforeScroll = await resultsScroller.evaluate((node) => node.scrollTop);
  const bounds = await resultsScroller.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => resultsScroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeScroll);
  await expect(field).toHaveValue('Fictional');
  await expect(field).toBeFocused();
  expect(await wrapper.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(30);
  await field.press('Escape');
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await field.press('Escape');
  await expect(field).not.toBeFocused();
  expect(unexpectedRequests, 'external attempts are counted even when a page mock blocks them').toBe(0);
  expect(unmockedRequests, 'unmocked backend requests must stay blocked').toBe(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);
});
