import { expect, test as base, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { FIXTURE_HOST, chat, membership, message, openFixture, person, type Row } from './helpers/messageActionsFixture';
import { RealtimeFixture } from './helpers/realtime-fixture';

// Run only this file, with QA0 and the 1440 Chromium project. It owns its server;
// no dotenv, existing server, credentials, screenshots or product writes are used.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
const root = process.cwd();
const kubRequire = createRequire(path.join(root, 'artifacts/kub/package.json'));
const bootDiagnosis = process.env.KUB_QA_WARM_BOOT_DIAG === '1';
type StaticIdentity = { basename: string; pathnameSha256: string; sourceClass: string;
  graphHit: boolean; resolvedStaticFile: boolean; resolvedBasename: string; importerBasenames: string[] };
const benignBasename = (value: string) => {
  const name = path.posix.basename(value.replaceAll('\\', '/').split('?')[0]);
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,159}$/.test(name) ? name : 'non-exportable';
};
let inspectOwnedStatic: ((pathname: string) => Promise<StaticIdentity>) | undefined;
type DevSocketBinding = { origin: string; pathname: string; token: string };
let ownedDevSocket: DevSocketBinding | undefined;
function socketClass(url: URL, binding: DevSocketBinding | undefined): 'supabase-fixture' | 'closed-vite-dev' | 'unknown' {
  if (url.username || url.password || url.hash) return 'unknown';
  if (url.origin === 'ws://127.0.0.1:54321' && url.pathname === '/realtime/v1/websocket') return 'supabase-fixture';
  if (binding && url.origin === binding.origin && url.pathname === binding.pathname &&
      [...url.searchParams.keys()].length === 1 && url.searchParams.has('token') &&
      /^[A-Za-z0-9_-]{12}$/.test(binding.token) && url.searchParams.get('token') === binding.token) return 'closed-vite-dev';
  return 'unknown';
}
const test = base.extend<{}, { fixtureOrigin: string }>({
  fixtureOrigin: [async ({}, use, worker) => {
    if (process.env.KUB_QA_ALLOW_MUTATIONS !== '0') throw new Error('QA0 required');
    const previous = { PORT: process.env.PORT, BASE_PATH: process.env.BASE_PATH };
    process.env.PORT = '5299';
    process.env.BASE_PATH = '/';
    const vite = await import(pathToFileURL(kubRequire.resolve('vite')).href);
    const server = await vite.createServer({
      configFile: path.join(root, 'artifacts/kub/vite.config.ts'),
      configLoader: 'runner',
      envDir: false,
      envPrefix: [],
      cacheDir: path.join(worker.project.outputDir, 'fixture-vite-cache'),
      mode: 'development',
      logLevel: 'silent',
      define: {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(FIXTURE_HOST),
        'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('playwright-public-fixture'),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('playwright-public-fixture'),
      },
      server: { host: '127.0.0.1', port: 5299, strictPort: true, hmr: false, open: false },
    });
    try {
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
        throw new Error('Fixture server must bind IPv4 loopback');
      }
      if (server.config.base !== '/' || server.config.server.hmr !== false ||
          !/^[A-Za-z0-9_-]{12}$/.test(server.config.webSocketToken)) throw new Error('Unexpected owned Vite dev binding');
      ownedDevSocket = { origin: `ws://127.0.0.1:${address.port}`, pathname: server.config.base,
        token: server.config.webSocketToken };
      inspectOwnedStatic = async (pathname) => {
        const environment = server.environments.client;
        const graph = environment.moduleGraph;
        const existing = [...graph.urlToModuleMap.entries()].find(([url]) => url.split('?')[0] === pathname)?.[1];
        const module = existing ?? await graph.getModuleByUrl(pathname);
        const resolved = module?.id ? { id: module.id } : await environment.pluginContainer.resolveId(pathname);
        const file = (module?.file ?? resolved?.id ?? '').split('?')[0];
        let physical: string | null = null;
        if (/\.(?:[cm]?js|tsx?|jsx|json)$/.test(file) && path.isAbsolute(file)) {
          try { if ((await stat(file)).isFile()) physical = await realpath(file); } catch { /* Not a resolved static file. */ }
        }
        const normalized = physical?.replaceAll('\\', '/') ?? '';
        const cache = path.join(worker.project.outputDir, 'fixture-vite-cache').replaceAll('\\', '/') + '/';
        const app = path.join(root, 'artifacts/kub').replaceAll('\\', '/') + '/';
        const sourceClass = normalized === app + 'package.json' ? 'app-package-json-module' :
          normalized.startsWith(cache) ? 'vite-optimized-dependency' :
          normalized.startsWith(app + 'src/') ? 'app-source' :
          normalized.includes('/node_modules/vite/dist/client/') ? 'vite-dev-client' :
          normalized.includes('/node_modules/') ? 'installed-static-dependency' :
          normalized.startsWith(app + 'public/') ? 'app-static' :
          physical ? 'resolved-static-other' : resolved?.id?.startsWith('\0') ? 'vite-virtual-module' : 'unresolved-static';
        return { basename: benignBasename(pathname), pathnameSha256: createHash('sha256').update(pathname).digest('hex'),
          sourceClass, graphHit: Boolean(module), resolvedStaticFile: Boolean(physical), resolvedBasename: benignBasename(file),
          importerBasenames: [...(module?.importers ?? [])].map((entry) => benignBasename(entry.file ?? entry.id ?? '')).sort() };
      };
      await use(`http://127.0.0.1:${address.port}`);
    } finally {
      inspectOwnedStatic = undefined;
      ownedDevSocket = undefined;
      await server.close();
      for (const key of ['PORT', 'BASE_PATH'] as const) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  }, { scope: 'worker', timeout: 60_000 }],
});

test.use({ screenshot: 'off', trace: 'off', video: 'off', serviceWorkers: 'block' });
test.describe.configure({ retries: 0, timeout: 60_000 });

const ME = person('87111111-1111-4111-8111-000000000001', 'Fixture Reader');
const OTHER = person('87111111-1111-4111-8111-000000000002', 'Fixture Sender');
const A = '87222222-2222-4222-8222-000000000001';
const B = '87222222-2222-4222-8222-000000000002';
const rowId = (n: number) => `87333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH3sAAAAASUVORK5CYII=', 'base64');
const MEDIA_PATH = '/storage/v1/object/public/chat-media/fixture-pixel.png';
type Kind = 'history' | 'hidden' | 'membership' | 'signing' | 'media' | 'variants' | 'other';
type Counts = Record<Kind, number>;
const counts = (): Counts => ({ history: 0, hidden: 0, membership: 0, signing: 0, media: 0, variants: 0, other: 0 });

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { entered: 0, pending: 0, release, promise };
}

const TABLES = new Set([
  'profiles', 'user_blocks', 'chat_members', 'chats', 'messages', 'reactions',
  'message_hidden_for_users', 'privacy_preferences', 'folders', 'folder_chats',
  'chat_notification_preferences', 'notifications', 'media_variants', 'chat_topics',
  'user_contacts', 'user_roles', 'roles', 'role_permissions', 'permissions',
]);
const RPCS = new Set([
  'chat_list_summaries', 'hides_live_ping', 'current_user_access_snapshot',
  'presence_beat', 'profile_badges', 'channel_unread_counts',
  'mark_chat_read', 'mark_chat_delivered', 'has_permission', 'has_location_permission', 'has_global_role',
]);

function createEmptyFixtureWorld(me: string, chats: readonly string[], now = Date.now,
  receipts: { memberships: readonly Row[]; messages: readonly Row[] } = { memberships: [], messages: [] }) {
  const relations = { bans: [], mutes: [], locations: [], location_members: [], voice_channels: [],
    voice_participants: [], chat_bot_members: [], topics: [], chat_roles: [], chat_member_roles: [], chat_channel_categories: [] };
  const notifications: readonly Row[] = [];
  let boundClient: string | null = null;
  let lease: { client: string; chat: string | null; lastSeenAt: number; expiresAt: number } | null = null;
  let tableReads = 0;
  let panelReads = 0;
  let leaseTouches = 0;
  let chatReceiptAcks = 0;
  let channelReceiptAcks = 0;
  let notificationReadAcks = 0;
  const ownMemberships = new Map(receipts.memberships.filter((member) => member.user_id === me && chats.includes(String(member.chat_id)))
    .map((member) => [String(member.chat_id), member]));
  const generalReadMarks = new Map<string, string>();
  const plain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const keys = (value: Record<string, unknown>, wanted: string[]) => Object.keys(value).sort().join(',') === [...wanted].sort().join(',');
  const isChat = (value: unknown): value is string => typeof value === 'string' && chats.includes(value);
  const listChatFilter = (filter: string | null) => {
    if (!filter?.startsWith('in.(') || !filter.endsWith(')')) return false;
    const ids = filter.slice(4, -1).split(',');
    return ids.length > 0 && new Set(ids).size === ids.length && ids.every(isChat);
  };
  return {
    respond(call: { url: URL; method: string; body: unknown; accept: string; prefer: string; range: string }) {
      if (!call.url.pathname.startsWith('/rest/v1/')) return undefined;
      const resource = call.url.pathname.slice('/rest/v1/'.length);
      const query = call.url.searchParams;
      const match = (expected: Record<string, string>) => [...query].length === Object.keys(expected).length &&
        Object.entries(expected).every(([key, value]) => query.getAll(key).length === 1 &&
          (key === 'select' ? query.get(key)?.replace(/\s+/g, '') === value.replace(/\s+/g, '') : query.get(key) === value));
      if (resource === 'rpc/notifications_mark_chat_messages_read') {
        const body = call.body;
        if (call.method !== 'POST' || [...query].length || call.prefer || call.range || call.accept.includes('vnd.pgrst.object') ||
            !plain(body) || !keys(body, ['p_chat_id', 'p_read_until']) || !isChat(body.p_chat_id) || !ownMemberships.has(body.p_chat_id)) return null;
        if (body.p_read_until !== null && (typeof body.p_read_until !== 'string' || !Number.isFinite(Date.parse(body.p_read_until)) ||
            !(ownMemberships.get(body.p_chat_id)?.last_read_at === body.p_read_until || receipts.messages.some((row) =>
              row.chat_id === body.p_chat_id && row.created_at === body.p_read_until)))) return null;
        notificationReadAcks++;
        return { status: 200, body: null };
      }
      if (resource === 'rpc/mark_chat_read_through' || resource === 'rpc/mark_channel_read') {
        const channel = resource === 'rpc/mark_channel_read';
        const body = call.body;
        if (call.method !== 'POST' || [...query].length || call.prefer || call.range || call.accept.includes('vnd.pgrst.object') ||
            !plain(body) || !keys(body, channel ? ['p_chat_id', 'p_channel', 'p_read_through'] : ['p_chat_id', 'p_read_through']) ||
            !isChat(body.p_chat_id) || !ownMemberships.has(body.p_chat_id) ||
            (channel && body.p_channel !== 'general') || typeof body.p_read_through !== 'string' ||
            !Number.isFinite(Date.parse(body.p_read_through)) || !receipts.messages.some((row) =>
              row.chat_id === body.p_chat_id && row.created_at === body.p_read_through)) return null;
        const chatId = body.p_chat_id;
        const through = Math.min(Date.parse(body.p_read_through), now());
        if (channel) {
          const previous = generalReadMarks.get(chatId);
          if (!previous || Date.parse(previous) < through) generalReadMarks.set(chatId, new Date(through).toISOString());
          channelReceiptAcks++;
          return { status: 200, body: null };
        }
        const member = ownMemberships.get(chatId)!;
        for (const key of ['last_read_at', 'last_delivered_at']) {
          const previous = member[key];
          if (typeof previous !== 'string' || Date.parse(previous) < through) member[key] = new Date(through).toISOString();
        }
        chatReceiptAcks++;
        return { status: 200, body: member.last_read_at as string | null };
      }
      if (Object.hasOwn(relations, resource)) {
        if (call.method !== 'GET' || call.body !== null || call.accept.includes('vnd.pgrst.object') || call.prefer || call.range) return null;
        let allowed = false;
        switch (resource) {
          case 'bans': allowed = match({ select: '*,issuer:profiles!bans_issued_by_fkey(full_name,username)', user_id: `eq.${me}`, order: 'created_at.desc' }); break;
          case 'locations': allowed = match({ select: '*', order: 'is_active.desc,name.asc' }); break;
          case 'location_members': allowed = match({ select: '*,profile:profiles!location_members_user_id_fkey(*),primary_admin:profiles!location_members_primary_admin_id_fkey(*)', order: 'created_at.desc' }) || match({ select: '*', user_id: `eq.${me}` }); break;
          case 'voice_channels': allowed = match({ select: 'id,chat_id,name,participant_count,archived,ring_started_at,ring_caller,ring_answered_at,call_started_at,call_started_by,call_message_id,call_ringing,call_moved_to,call_moved_at', archived: 'eq.false', or: '(participant_count.gt.0,ring_started_at.not.is.null,call_started_at.not.is.null,call_moved_to.not.is.null)' }) || chats.some((chat) => match({ select: 'id,name,position,max_participants,speak_role,participant_count,archived,category_id,created_at', chat_id: `eq.${chat}`, archived: 'eq.false' })); break;
          case 'voice_participants': allowed = match({ select: 'channel_id,user_id', user_id: `eq.${me}` }); break;
          case 'chat_bot_members': allowed = (listChatFilter(query.get('chat_id')) && match({ select: 'chat_id,privacy_mode,bot:bots(id,username,display_name,description,avatar_url,state)', chat_id: query.get('chat_id')!, removed_at: 'is.null', limit: '500' })) || chats.some((chat) => match({ select: 'bot_id,joined_at,bot:bots(username,state)', chat_id: `eq.${chat}`, removed_at: 'is.null', limit: '16' })); break;
          case 'mutes': allowed = match({ select: '*', user_id: `eq.${me}`, chat_id: 'is.null' }) || chats.some((chat) => match({ select: '*', user_id: `eq.${me}`, or: `(chat_id.is.null,chat_id.eq.${chat})` })); break;
          case 'topics': allowed = chats.some((chat) => match({ select: '*', chat_id: `eq.${chat}`, order: 'is_general.desc,position.asc' })); break;
          case 'chat_roles': allowed = chats.some((chat) => match({ select: 'id,chat_id,name,colour,icon,priority,created_at', chat_id: `eq.${chat}` })); break;
          case 'chat_member_roles': allowed = chats.some((chat) => match({ select: 'chat_id,user_id,role_id', chat_id: `eq.${chat}` })); break;
          case 'chat_channel_categories': allowed = chats.some((chat) => match({ select: 'id,name,position,created_at', chat_id: `eq.${chat}` })); break;
        }
        if (!allowed) return null;
        tableReads++;
        return { status: 200, body: relations[resource as keyof typeof relations] };
      }
      if (resource === 'rpc/bot_viewer_interfaces_for_actor') {
        if (call.method !== 'POST' || [...query].length || call.prefer || call.range || call.accept.includes('vnd.pgrst.object') ||
            !plain(call.body) || !keys(call.body, ['p_chat_id']) || !isChat(call.body.p_chat_id)) return null;
        panelReads++;
        return { status: 200, body: [] };
      }
      if (resource === 'rpc/push_foreground_session_touch') {
        if (call.method !== 'POST' || [...query].length || call.prefer || call.range || call.accept.includes('vnd.pgrst.object') ||
            !plain(call.body) || !keys(call.body, ['p_client_id', 'p_current_chat_id']) ||
            typeof call.body.p_client_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(call.body.p_client_id) ||
            (call.body.p_current_chat_id !== null && !isChat(call.body.p_current_chat_id)) ||
            (boundClient !== null && boundClient !== call.body.p_client_id)) return null;
        const at = now();
        if (lease && lease.expiresAt <= at) lease = null;
        boundClient ??= call.body.p_client_id;
        lease = { client: boundClient, chat: call.body.p_current_chat_id as string | null, lastSeenAt: at, expiresAt: at + 20_000 };
        leaseTouches++;
        return { status: 200, body: null };
      }
      return undefined;
    },
    receiptPointers: (chatId: string) => ({ chat: ownMemberships.get(chatId)?.last_read_at ?? null, general: generalReadMarks.get(chatId) ?? null }),
    snapshot: () => ({ tableReads, panelReads, leaseTouches, activeLeases: lease && lease.expiresAt > now() ? 1 : 0,
      chatReceiptAcks, channelReceiptAcks, generalReadMarkCount: generalReadMarks.size,
      notificationReadAcks, notificationRows: notifications.length }),
  };
}

function kind(url: URL, method: string): Kind {
  const resource = url.pathname.replace('/rest/v1/', '');
  if (url.pathname === MEDIA_PATH) return 'media';
  if (url.pathname.startsWith('/storage/v1/object/sign/')) return 'signing';
  if (resource === 'message_hidden_for_users') return 'hidden';
  if (resource === 'chat_members') return 'membership';
  if (resource === 'media_variants') return 'variants';
  if (resource === 'messages' && method === 'GET' && url.searchParams.has('chat_id') &&
      !['id', 'pinned', 'type', 'media_url', 'offset'].some((key) => url.searchParams.has(key)) &&
      !url.searchParams.getAll('created_at').some((filter) => filter.startsWith('lt.')) &&
      url.searchParams.get('order')?.startsWith('created_at.desc') &&
      url.searchParams.get('limit') === '101') return 'history';
  return 'other';
}

type Sample = { ms: number; rows: number; text: number; control: number; visibleText: number; duplicate: boolean; height: number; client: number; imageReady: boolean };
function firstVisibleRetainedSample(samples: Sample[], events: { phase: string; ms: number }[]) {
  const intent = events.find((event) => event.phase === 'open-A-intent');
  const sample = intent && samples.find((frame) => frame.ms >= intent.ms && frame.text > 0 && frame.visibleText > 0);
  return sample && intent ? { ...sample, afterOpenIntentMs: sample.ms - intent.ms,
    meaning: 'first-sampled-late-layout-opportunity-not-physical-paint' } : null;
}
type Probe = { start: number; frames: Sample[]; events: { phase: string; ms: number }[]; mark: (phase: string) => void; reset: () => void;
  visibleText: (row: HTMLElement, container: HTMLElement) => boolean };
declare global { interface Window { __warmOpenProbe: Probe } }

function installSampler({ textIds, controlId }: { textIds: string[]; controlId: string }) {
  const ids = new Set(textIds);
  const visibleText = (row: HTMLElement, container: HTMLElement): boolean => {
    const text = row.querySelector<HTMLElement>('[data-message-text-content="true"]');
    if (!row.isConnected || !container.contains(row) || !text?.textContent?.trim()) return false;
    const r = text.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const viewport = window.visualViewport;
    let left = Math.max(0, viewport?.offsetLeft ?? 0, c.left, r.left);
    let top = Math.max(0, viewport?.offsetTop ?? 0, c.top, r.top);
    let right = Math.min(document.documentElement.clientWidth, window.innerWidth,
      (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth), c.right, r.right);
    let bottom = Math.min(document.documentElement.clientHeight, window.innerHeight,
      (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight), c.bottom, r.bottom);
    for (let node: HTMLElement | null = text; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
          Number(style.opacity) === 0 || style.contentVisibility === 'hidden') return false;
      const box = node.getBoundingClientRect();
      if (/^(hidden|clip|scroll|auto)$/.test(style.overflowX)) {
        left = Math.max(left, box.left); right = Math.min(right, box.right);
      }
      if (/^(hidden|clip|scroll|auto)$/.test(style.overflowY)) {
        top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);
      }
    }
    return r.width > 0 && r.height > 0 && right > left && bottom > top;
  };
  const p: Probe = {
    start: performance.now(), frames: [], events: [],
    visibleText,
    mark(phase) { this.events.push({ phase, ms: performance.now() - this.start }); },
    reset() { this.start = performance.now(); this.frames = []; this.events = []; pending = null; committed = false; },
  };
  window.__warmOpenProbe = p;
  const read = (): Sample | null => {
    const container = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
    if (!container) return null;
    const rows = [...container.querySelectorAll<HTMLElement>('[data-message-id]')];
    const text = rows.filter((row) => ids.has(row.dataset.messageId ?? ''));
    const image = container.querySelector<HTMLImageElement>('img[src*="fixture-pixel.png"]');
    return { ms: performance.now() - p.start, rows: rows.length, text: text.length,
      control: rows.filter((row) => row.dataset.messageId === controlId).length,
      visibleText: text.filter((row) => visibleText(row, container)).length,
      duplicate: new Set(rows.map((row) => row.dataset.messageId)).size !== rows.length,
      height: container.scrollHeight, client: container.clientHeight,
      imageReady: Boolean(image?.complete && image.naturalWidth > 0),
    };
  };
  let pending: Sample | null = null;
  let committed = false;
  let observed: Element | null = null;
  let observer: ResizeObserver | null = null;
  new MutationObserver(() => {
    const sample = read();
    if (sample?.text && !committed) { committed = true; p.mark('retained-row-dom-commit'); }
  }).observe(document, { childList: true, subtree: true });
  const tick = () => {
    // RO overwrites the rAF sample; only publish it at the next frame boundary.
    if (pending) p.frames.push(pending);
    pending = read();
    const container = document.querySelector('[data-testid="message-scroll-container"]');
    if (container && container !== observed) {
      observed = container;
      const target = container;
      setTimeout(() => {
        if (!target.isConnected || observed !== target) return;
        observer?.disconnect();
        observer = new ResizeObserver(() => { pending = read(); });
        observer.observe(target);
        if (target.firstElementChild) observer.observe(target.firstElementChild);
      }, 0);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function frames(page: Page, n = 3) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, n);
}

async function trust(page: Page, ids: string[]) {
  return page.evaluate(async ({ chatId, userId, ids }) => {
    const hiddenPath = '/src/lib/hiddenMessagesLive.ts';
    const clearedPath = '/src/lib/clearedAtCache.ts';
    const hidden = await import(hiddenPath);
    const cleared = await import(clearedPath);
    return { live: hidden.hiddenMessagesLive.isLive(), verified: hidden.hiddenMessagesLive.canSkip(chatId, ids),
      membership: cleared.clearedAtCache.hasFresh(chatId, userId) };
  }, { chatId: A, userId: ME.id, ids });
}

for (const width of (bootDiagnosis ? [1440] : [1440, 390])) for (const theme of (bootDiagnosis ? ['light'] as const : ['light', 'dark'] as const)) {
  test.describe(`${width}-${theme}`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme });
    test('fixture-only per-open retained history measurement', async ({ page, fixtureOrigin }, info) => {
      test.setTimeout(25_000);
      expect(process.env.KUB_QA_ALLOW_MUTATIONS, 'QA0 required').toBe('0');
      const at = new Date(Date.now() - 3_600_000);
      const stamp = (i: number) => new Date(at.getTime() + i * 1000).toISOString();
      const rows: Row[] = Array.from({ length: 48 }, (_, i) => message(rowId(i + 1), A, OTHER,
        `Fixture retained line ${i + 1}`, stamp(i)));
      rows.push(message(rowId(49), A, OTHER, '', stamp(49), {
        type: 'image', media_bucket: 'chat-media', media_path: 'fixture-pixel.png',
        media_url: FIXTURE_HOST + MEDIA_PATH, media_metadata: { width: 1, height: 1 },
      }));
      rows.push(message(rowId(50), B, OTHER, 'Fixture unverified control', stamp(50)));
      const rt = new RealtimeFixture();
      const memberships = [A, B].flatMap((id) => [membership(id, ME, 'owner', stamp(60)), membership(id, OTHER, 'member', stamp(60))]);
      const emptyWorld = createEmptyFixtureWorld(ME.id, [A, B], Date.now, { memberships, messages: rows });
      let pings = 0;
      const fixture = await openFixture(page, {
        me: ME, people: [OTHER], theme, messages: rows,
        chats: [chat(A, 'group', 'Fixture A', stamp(49)), chat(B, 'group', 'Fixture B', stamp(50))],
        memberships,
        rpc(name) {
          if (name === 'hides_live_ping') pings += rt.broadcast('hides:', 'ping', {});
          return undefined;
        },
      });
      await page.addInitScript(installSampler, { textIds: Array.from({ length: 48 }, (_, i) => rowId(i + 1)), controlId: rowId(50) });
      await rt.install(page);
      let blockedHttp = 0;
      let blockedSockets = 0;
      let closedDevSockets = 0;
      const denied = new Set<string>();
      let firstScriptClaimed = false;
      let resolveFirstScript!: (identity: StaticIdentity) => void;
      const firstScript = new Promise<StaticIdentity>((resolve) => { resolveFirstScript = resolve; });
      const bootErrors: string[] = [];
      page.on('pageerror', (error) => {
        const undefinedName = error.message.match(/^([A-Za-z_$][\w$]*) is not defined$/)?.[1];
        bootErrors.push(error.name + (undefinedName ? `:${undefinedName}` : ''));
      });
      await page.routeWebSocket((url) => socketClass(url, ownedDevSocket) !== 'supabase-fixture',
        async (socket) => {
          if (socketClass(new URL(socket.url()), ownedDevSocket) === 'closed-vite-dev') closedDevSockets++;
          else blockedSockets++;
          await socket.close();
        });
      const privacy = gate();
      const history = gate();
      const media = gate();
      let warm = false;
      let control = false;
      const total = counts();
      const warmCounts = counts();
      const phase = (name: string) => page.evaluate((value) => window.__warmOpenProbe?.mark(value), name).catch(() => undefined);
      await page.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === fixtureOrigin && (url.pathname === '/' ||
            (url.pathname === '/package.json' && request.method() === 'GET' && request.resourceType() === 'script') ||
            (url.pathname === '/brand/letscube/letscube-mark.svg' && request.method() === 'GET' && request.resourceType() === 'image') ||
            /^\/(?:src\/|node_modules\/|@|fonts\/|favicon\.|manifest\.|icons\/)/.test(url.pathname))) {
          return route.fallback();
        }
        if (url.origin !== FIXTURE_HOST) {
          blockedHttp++; denied.add(url.origin === fixtureOrigin ? `app-unknown:${request.resourceType()}` : 'origin-unknown');
          if (url.origin === fixtureOrigin && request.resourceType() === 'script') {
            const file = url.pathname.split('/').at(-1) ?? '';
            if (/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*\.(?:[cm]?js|tsx?|jsx)$/.test(file)) denied.add(`module:${file}`);
            denied.add(url.pathname.startsWith('/.vite/') ? 'vite-cache' : /^\/[a-z]:/i.test(url.pathname) ? 'drive-path' : url.pathname.startsWith('/__') ? 'dev-plugin' : 'other-app-module');
            if (bootDiagnosis && !firstScriptClaimed) {
              firstScriptClaimed = true;
              await route.abort('blockedbyclient');
              if (!inspectOwnedStatic) throw new Error('Owned fixture module inspector missing');
              resolveFirstScript(await inspectOwnedStatic(url.pathname));
              return;
            }
          }
          return route.abort('blockedbyclient');
        }
        const method = request.method();
        const resource = url.pathname.replace('/rest/v1/', '');
        let body: unknown = null;
        if (method !== 'GET' && method !== 'HEAD') {
          try { body = request.postDataJSON(); } catch { body = undefined; }
        }
        const headers = request.headers();
        const modeled = emptyWorld.respond({ url, method, body, accept: headers.accept ?? '', prefer: headers.prefer ?? '',
          range: headers.range || headers['range-unit'] || '' });
        if (modeled !== undefined) {
          if (modeled === null) {
            blockedHttp++; denied.add(`model-contract:${resource}`);
            return route.abort('blockedbyclient');
          }
          total.other++;
          if (warm) { warmCounts.other++; await phase('other-request'); }
          return route.fulfill({ status: modeled.status, contentType: 'application/json', body: JSON.stringify(modeled.body) });
        }
        const known = url.pathname === '/auth/v1/user' || url.pathname === MEDIA_PATH ||
          (url.pathname.startsWith('/rest/v1/') && (TABLES.has(resource) || (resource.startsWith('rpc/') && RPCS.has(resource.slice(4)))));
        if (!known || !['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'].includes(method)) {
          blockedHttp++; denied.add(TABLES.has(resource) ? 'method-unknown' :
            /^[a-z_]+$/.test(resource) ? `table:${resource}` : resource.startsWith('rpc/') && /^[a-z_]+$/.test(resource.slice(4)) ? resource : 'backend-unknown');
          return route.abort('blockedbyclient');
        }
        const category = kind(url, method);
        total[category]++;
        if (warm) { warmCounts[category]++; await phase(`${category}-request`); }
        const held = control && category === 'hidden' && url.search.includes(rowId(50)) ? privacy :
          warm && category === 'history' && url.searchParams.get('chat_id') === `eq.${A}` ? history :
          warm && category === 'media' ? media : null;
        if (held) {
          held.entered++; held.pending++;
          try { await held.promise; } finally { held.pending--; }
          if (warm) await phase(`${category}-provider-release`);
        }
        if (url.pathname === MEDIA_PATH) return route.fulfill({ status: 200, contentType: 'image/png',
          headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' }, body: PNG });
        return route.fallback();
      });
      const aRows = page.locator(`[data-message-id^="87333333-"]`);
      const controlRow = page.locator(`[data-message-id="${rowId(50)}"]`);
      const open = async (name: 'A' | 'B') => {
        if (width === 390 && await page.getByRole('button', { name: '\u041d\u0430\u0437\u0430\u0434', exact: true }).isVisible()) {
          await page.getByRole('button', { name: '\u041d\u0430\u0437\u0430\u0434', exact: true }).click();
        }
        await phase(`open-${name}-intent`);
        await page.getByTestId('chat-list-item').filter({ hasText: `Fixture ${name}` }).click();
        await expect(page.getByTestId('chat-header-info-button')).toContainText(`Fixture ${name}`);
        await phase(`open-${name}-selected`);
      };
      let stage = 'fake-config-preflight';
      let receipt: Record<string, unknown> = { stratum: `${width}-${theme}`, result: 'not-calibrated', firstSampledVisibleRetainedText: null };
      try {
        const client = await page.request.get(fixtureOrigin + '/src/lib/supabase/client.ts');
        const source = await client.text();
        const fakeConfig = source.includes(FIXTURE_HOST) && source.includes('playwright-public-fixture');
        expect(fakeConfig, 'transformed client must carry only the explicit fixture config').toBe(true);
        if (bootDiagnosis) {
          stage = 'boot-first-rejected-local-script';
          let timer!: ReturnType<typeof setTimeout>;
          const deadline = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 8_000); });
          const navigation = page.goto(fixtureOrigin, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
          const identity = await Promise.race([firstScript, deadline]);
          clearTimeout(timer);
          await page.close();
          await navigation;
          receipt = { ...receipt, result: 'fixture-gate-failed', fakeConfig, firstRejectedStatic: identity };
          expect(identity, 'bounded observer must obtain the first rejected local script identity').not.toBeNull();
          throw new Error('Fixture local-static-script guard failed; diagnostic identity retained');
        }
        await page.goto(fixtureOrigin, { waitUntil: 'domcontentloaded' });
        receipt = { ...receipt, fakeConfig, bootStructure: await page.evaluate(() => ({
          rootChildren: document.getElementById('root')?.childElementCount ?? 0,
          moduleScripts: document.querySelectorAll('script[type="module"]').length,
          missingConfig: document.body.textContent?.includes('Supabase runtime configuration is missing') ?? false,
        })) };
        stage = 'cold-sidebar-list';
        await expect(page.getByTestId('chat-list-item')).toHaveCount(2);
        stage = 'privacy-live-calibration';
        expect(await page.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);
        await expect.poll(() => pings, { message: 'returned hide ping control' }).toBeGreaterThan(0);
        await expect.poll(async () => (await trust(page, [])).live).toBe(true);
        expect(rt.isJoined('chat-members:user:')).toBe(true);
        stage = 'cold-history-frame-calibration';
        await open('A');
        await expect(aRows).toHaveCount(49);
        await expect.poll(async () => (await trust(page, rows.filter((row) => row.chat_id === A).map((row) => String(row.id)))).verified).toBe(true);
        await expect.poll(async () => page.evaluate(() => window.__warmOpenProbe.frames.some((f) => f.text === 48 && f.visibleText > 0 && f.height > f.client && f.imageReady))).toBe(true);
        expect(total.history, 'cold actual history control').toBeGreaterThan(0);
        expect(total.hidden, 'cold actual hidden read control').toBeGreaterThan(0);
        expect(total.membership, 'cold membership read control').toBeGreaterThan(0);
        expect(total.media, 'cold image byte control').toBeGreaterThan(0);
        receipt = { ...receipt, coldCalibration: { returnedPings: pings,
          trust: await trust(page, rows.filter((row) => row.chat_id === A).map((row) => String(row.id))),
          frame: await page.evaluate(() => window.__warmOpenProbe.frames.find((f) => f.text === 48 && f.visibleText > 0 && f.height > f.client && f.imageReady)) } };
        stage = 'fixture-isolation';
        expect(blockedHttp, 'unknown HTTP operations remain refused; fixture calibration is incomplete').toBe(0);
        expect(blockedSockets, 'unknown sockets remain refused; fixture calibration is incomplete').toBe(0);
        // Let the joined cold reconcile finish, outside the measured reopen.
        await page.waitForTimeout(800);
        control = true;
        stage = 'new-id-privacy-control';
        await page.evaluate(() => window.__warmOpenProbe.reset());
        await open('B');
        await expect.poll(() => privacy.entered, { message: 'new-ID privacy gate must be reached' }).toBeGreaterThan(0);
        await frames(page);
        expect(await controlRow.count(), 'unverified row must not be admitted while hidden read waits').toBe(0);
        expect(await page.evaluate(() => window.__warmOpenProbe.frames.every((f) => f.control === 0))).toBe(true);
        privacy.release();
        await expect(controlRow).toBeVisible();
        control = false;
        await page.waitForTimeout(800);
        const admitted = await trust(page, rows.filter((row) => row.chat_id === A).map((row) => String(row.id)));
        expect(admitted).toEqual({ live: true, verified: true, membership: true });
        const before = { ...total };
        stage = 'warm-held-history-frame';
        await page.evaluate(() => window.__warmOpenProbe.reset());
        warm = true;
        await open('A');
        await expect.poll(() => history.entered, { message: 'warm background history gate' }).toBeGreaterThan(0);
        await frames(page, 5);
        const pendingFrames = await page.evaluate(() => window.__warmOpenProbe.frames);
        const events = await page.evaluate(() => window.__warmOpenProbe.events);
        const firstSampledVisibleRetainedText = firstVisibleRetainedSample(pendingFrames, events);
        const gateTime = Math.max(...events.filter((event) => event.phase === 'history-request' || event.phase === 'media-request').map((event) => event.ms));
        const retained = pendingFrames.find((f) => f.ms >= gateTime && f.text === 48 && f.visibleText > 0 && !f.duplicate && f.height > f.client);
        receipt = { stratum: `${width}-${theme}`, result: 'measured', coldCounts: before,
          returnedPings: pings, privacyGateEntered: privacy.entered, unverifiedWithheld: true,
          warmCounts: { ...warmCounts }, historyPendingAtFrame: history.pending,
          media: media.entered ? 'pending-gate-entered' : 'cached-or-not-requested', mediaPendingAtFrame: media.pending,
          firstSampledVisibleRetainedText, retainedFrame: retained ?? null,
          retainedFrameMeaning: 'retention-proof-after-background-gate-entry-not-first-visible-latency', framesSampled: pendingFrames.length,
          events, blockedHttp, blockedSockets };
        expect(history.pending, 'history remains held at sampled frame').toBeGreaterThan(0);
        expect(retained, '48 retained text rows need a visible late-layout frame before history release').toBeTruthy();
        expect(warmCounts.hidden, 'continuous trusted same-ID reopen needs no hidden HTTP read').toBe(0);
        expect(warmCounts.membership, 'live seeded mark needs no membership HTTP read').toBe(0);
        expect(warmCounts.signing, 'default public fixture is not a signing latency probe').toBe(0);
        if (media.entered) expect(media.pending).toBeGreaterThan(0);
        stage = 'provider-release-and-reconcile';
        const historyDone = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.origin === FIXTURE_HOST && kind(url, response.request().method()) === 'history' &&
            url.searchParams.get('chat_id') === `eq.${A}`;
        });
        history.release(); media.release();
        const response = await historyDone;
        expect(response.status()).toBe(200);
        expect(await response.finished()).toBeNull();
        await phase('history-browser-finished');
        await expect(aRows).toHaveCount(49);
        await expect.poll(() => history.pending + media.pending).toBe(0);
        await expect.poll(async () => page.evaluate(() => window.__warmOpenProbe.frames.at(-1)?.imageReady)).toBe(true);
        await frames(page);
        const final = await page.evaluate(() => window.__warmOpenProbe.frames.at(-1));
        expect(final?.duplicate).toBe(false);
        expect(final?.text).toBe(48);
        stage = 'final-fixture-isolation';
        receipt = { ...receipt, result: 'measured-unaccepted', finalCounts: { ...warmCounts }, finalFrame: final,
          pendingGates: history.pending + media.pending + privacy.pending };
        expect(blockedHttp, 'unknown HTTP requests must not be silently accepted').toBe(0);
        expect(blockedSockets, 'unknown sockets must not be silently accepted').toBe(0);
        receipt = { ...receipt, result: 'passed', finalCounts: warmCounts, finalFrame: final,
          pendingGates: history.pending + media.pending + privacy.pending, mockedCalls: fixture.requests.length };
        stage = 'complete';
      } catch (error) {
        receipt = { ...receipt, result: 'failed' };
        throw error;
      } finally {
        privacy.release(); history.release(); media.release();
        // Only closed structural metadata is printed. No request/session/row dump.
        console.log('WARM_OPEN_RECEIPT ' + JSON.stringify({ ...receipt, stage, bootErrors, denied: [...denied], total, blockedHttp, blockedSockets, closedDevSockets, emptyModel: emptyWorld.snapshot() }));
        info.annotations.push({ type: 'isolation', description: 'QA0; loopback fake config; dotenv/captures/SW off; no live backend' });
      }
    });
  });
}
