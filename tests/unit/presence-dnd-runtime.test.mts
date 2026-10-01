import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium } = kubRequire("@playwright/test");
const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");
const sourceRoot = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const ORIGIN = "https://dnd-runtime.invalid";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const T0 = 1_700_000_000_000;
let browser: any;
let bundle: string;

async function until(check: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(20);
  }
  assert.equal(await check(), true, message);
}

test.before(async () => {
  const result = await build({
    write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": sourceRoot },
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": JSON.stringify({ DEV: true, VITE_SUPABASE_URL: ORIGIN,
        VITE_SUPABASE_ANON_KEY: "synthetic-anon-fixture", VITE_MEDIA_SIGNED_URLS: "signed-only" }),
    },
    plugins: [{ name: "provider-boundaries", setup(plugin: any) {
      plugin.onLoad({ filter: /lib[\\/]supabase[\\/]client\.ts$/ }, () => ({ loader: "ts", contents: `
        import {createClient as sdkClient} from '@supabase/supabase-js';
        const client = sdkClient('${ORIGIN}', 'synthetic-anon-fixture', {
          auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false}
        });
        client.channel = (name) => {
          const channel = {name, handlers:[], active:true,
            on(_type, filter, callback) {this.handlers.push({filter, callback}); return this;},
            subscribe(callback) {this.status = callback; callback('SUBSCRIBED'); return this;}
          };
          window.channels.push(channel); return channel;
        };
        client.removeChannel = async (channel) => {channel.active = false;};
        export const createClient = () => client;
        export const getRealtimeClient = () => client;
        export const isSupabaseConfigured = () => true;
      ` }));
      plugin.onLoad({ filter: /hooks[\\/]useVoiceCall\.ts$/ }, () => ({ loader: "ts", contents: `
        export const voiceSelfIdSnapshot = () => null;
        export const voiceSpeakersSnapshot = () => [];
      ` }));
      plugin.onLoad({ filter: /hooks[\\/]useVoiceRing\.ts$/ }, () => ({ loader: "ts", contents: `
        import {useSyncExternalStore} from 'react';
        export function useVoiceRingPick() {
          return useSyncExternalStore((fn) => {window.ringListeners.add(fn); return () => window.ringListeners.delete(fn);},
            () => window.offered, () => null);
        }
        export const answerVoiceRing = async () => ({ok:true});
        export const declineVoiceRing = answerVoiceRing;
        export const cancelVoiceRing = answerVoiceRing;
      ` }));
      plugin.onLoad({ filter: /hooks[\\/]useGroupCalls\.ts$/ }, () => ({ loader: "ts", contents: `
        export const useGroupRingPick = () => null;
        export const answerGroupRing = async () => ({ok:true});
        export const declineGroupRing = answerGroupRing;
      ` }));
      plugin.onLoad({ filter: /hooks[\\/]useSessionDevices\.ts$/ }, () => ({ loader: "ts", contents: `
        export const useIncomingRingGate = () => 'show';
      ` }));
      plugin.onLoad({ filter: /hooks[\\/]useNativeVoiceCalls\.ts$/ }, () => ({ loader: "ts", contents: `
        export const useNativeForegroundRing = () => {};
      ` }));
      plugin.onLoad({ filter: /components[\\/]ui[\\/]ChatAvatar\.tsx$/ }, () => ({ loader: "tsx", contents: `
        export function ChatAvatar() {return null;}
      ` }));
      plugin.onLoad({ filter: /(?:useOwnPresence|useCallSound|useNotifications|presenceStatus)\.ts$|VoiceCallRing\.tsx$/ }, (args: any) => {
        if (!process.env.DND_RUNTIME_MUTANT) return undefined;
        let contents = readFileSync(args.path, "utf8").replace(/\r\n/g, "\n");
        const changes: Record<string, [string, string]> = {
          "public-dot": ['return manualStatusInForce(inputs.manual, inputs.until, Date.now()) === "dnd" ? "quiet" : "allow";',
            'return current === "dnd" ? "quiet" : "allow";'],
          "cached-expiry": ['manualStatusInForce(inputs.manual, inputs.until, Date.now())',
            'manualStatusInForce(inputs.manual, inputs.until, 0)'],
          "omit-settled-owner": ['if (!alertReady || !userId || userId !== expectedUserId || alertOwner !== userId) return "wait";',
            'if (!userId || userId !== expectedUserId) return "wait";'],
          "omit-private-transition": ['if (!statusChanged && nextAlertPolicy === currentAlertPolicy) return;',
            'if (!statusChanged) return;'],
          "omit-deadline": ['expiryTimer = window.setTimeout(onAlertExpiry, Math.min(remaining, 2_147_483_647));',
            'expiryTimer = null;'],
          "omit-deadline-cleanup": ['if (expiryTimer !== null) window.clearTimeout(expiryTimer);', ''],
          "omit-notification-policy": ['enabled: getAudioSettings().notificationSoundEnabled && ownAlertPolicySnapshot() === "allow",',
            'enabled: getAudioSettings().notificationSoundEnabled,'],
          "omit-ring-policy": ['enabled: settings.callSoundEnabled && alertPolicy === "allow",',
            'enabled: settings.callSoundEnabled,'],
          "omit-post-await": ['sendNotification: (payload) => mayDeliver() ? bridge.notify(payload) : Promise.resolve(false),',
            'sendNotification: (payload) => bridge.notify(payload),'],
          "omit-quiet-handled": ['if (quiet) handled.add(row.id);', ''],
          "omit-flight-handled": ['if (!delivered && !quiet) handled.delete(row.id);',
            'if (!delivered) handled.delete(row.id);'],
          "omit-refresh-generation": ['generation !== accountGenerationRef.current || ', ''],
          "omit-flight-owner": ['if (handled !== presentedDesktopIdsRef.current) return false;\n      const policy = ownAlertPolicySnapshot(userId);',
            'const policy = ownAlertPolicySnapshot();'],
        };
        const change = changes[process.env.DND_RUNTIME_MUTANT!];
        assert.ok(change, "unknown DND mutant");
        if (contents.includes(change[0])) {
          windowMutations++;
          contents = contents.replace(change[0], change[1]);
        }
        return { contents, loader: args.path.endsWith("tsx") ? "tsx" : "ts" };
      });
    } }],
    stdin: { resolveDir: sourceRoot, sourcefile: "mounted-dnd-runtime.tsx", loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {useAppStore} from './store/app.store';
      import {usePrivacyPreferences, refreshPrivacyPreferences} from './hooks/usePrivacyPreferences';
      import {useOwnPresenceRuntime, useOwnPresence, ownPresenceSnapshot} from './hooks/useOwnPresence';
      import {playNotificationSoundFor} from './hooks/useCallSound';
      import {useNotifications} from './hooks/useNotifications';
      import {VoiceCallRing} from './components/chat/VoiceCallRing';
      import {resetCallSoundsForTest} from './lib/callSoundPlayer';
      function Harness() {
        const userId = useAppStore(s => s.currentUser?.id ?? null);
        useOwnPresenceRuntime(userId);
        const privacy = usePrivacyPreferences();
        const status = useOwnPresence();
        const notices = useNotifications();
        window.notices = notices;
        window.retryPrivacy = privacy.retry;
        return <><output id="state" data-status={status} data-ready={String(privacy.ready)}
          data-loading={String(privacy.loading)} data-count={notices.unreadCount}
          data-items={notices.items.map(row => row.id).join(',')} />
          <VoiceCallRing /></>;
      }
      const root = createRoot(document.getElementById('root'));
      window.account = (id) => flushSync(() => useAppStore.setState({currentUser:id ? {id} : null, selectedChatId:null}));
      window.refreshPrivacy = () => refreshPrivacyPreferences(useAppStore.getState().currentUser?.id ?? null);
      window.ping = () => playNotificationSoundFor({chatId:'other-chat', osToast:false});
      window.publicStatus = ownPresenceSnapshot;
      window.resetSounds = resetCallSoundsForTest;
      window.setRing = (on) => {
        window.offered = on ? {direction:'incoming', ring:{channelId:'ring-channel', chatId:'ring-chat',
          name:'Synthetic ring', caller:'synthetic-caller', startedAt:Date.now(), answeredAt:null, participantCount:1}} : null;
        flushSync(() => {for (const fn of window.ringListeners) fn();});
      };
      window.account('${A}');
      flushSync(() => root.render(<Harness />));
      window.unmount = () => flushSync(() => root.unmount());
    ` },
  });
  if (process.env.DND_RUNTIME_MUTANT) assert.equal(windowMutations, 1, "one in-memory omission must apply");
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true,
    env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" },
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
});
let windowMutations = 0;
test.after(async () => { await browser?.close(); });

function privacy(status = "online", visible = false, until: number | null = null) {
  return { presence_visible: visible, forward_origin_visible: true, manual_status: status,
    manual_status_until: until === null ? null : new Date(until).toISOString(), phone_findable_by: "contacts" };
}

function notice(id: string, owner = A) {
  return { id, user_id: owner, kind: "task_assigned", payload: {task_id:id, title:"Synthetic task"},
    read_at:null, created_at:new Date(T0).toISOString() };
}

async function fixture(desktop = false) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const preferences = new Map([[A, privacy()], [B, privacy()]]);
  let rows: any[] = [];
  let refused: string | null = null;
  let held: string | null = null;
  let release: (() => void) | undefined;
  let holdNotificationRead = false;
  let releaseNotificationRead: (() => void) | undefined;
  const writes: string[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error: Error) => errors.push(error.message));
  await page.route("**/*", async (route: any) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === ORIGIN && url.pathname === "/") {
      return route.fulfill({status:200, contentType:"text/html", body:'<div id="root"></div>'});
    }
    if (request.method() !== "GET") {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({status:403, contentType:"application/json", body:'{"message":"readonly"}'});
    }
    let data: unknown;
    if (url.origin === ORIGIN && url.pathname === "/rest/v1/privacy_preferences") {
      const owner = url.searchParams.get("user_id")?.replace(/^eq\./, "") ?? "";
      if (held === owner) await new Promise<void>(resolve => { release = resolve; });
      if (refused === owner) return route.fulfill({status:403, contentType:"application/json", body:'{"message":"fixture refusal","code":"42501"}'});
      data = preferences.get(owner) ?? null;
    } else if (url.origin === ORIGIN && url.pathname === "/rest/v1/notifications") {
      const owner = url.searchParams.get("user_id")?.replace(/^eq\./, "");
      data = rows.filter(row => row.user_id === owner);
      if (holdNotificationRead) {
        holdNotificationRead = false;
        await new Promise<void>(resolve => {releaseNotificationRead = resolve;});
      }
    } else {
      unexpected.push(url.pathname);
      return route.fulfill({status:404, body:"unexpected provider boundary"});
    }
    return route.fulfill({status:200, contentType:"application/json", body:JSON.stringify(data)});
  });
  await page.clock.install({ time:T0 - 1000 });
  await page.clock.pauseAt(T0);
  await page.goto(ORIGIN);
  await page.evaluate((desktop: boolean) => {
    const w = window as any;
    w.channels = []; w.ringListeners = new Set(); w.offered = null;
    w.toasts = []; w.foregroundChecks = 0; w.holdForeground = false;
    w.expiryTimers = new Map(); w.expiryDelays = [];
    const set = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
    window.setTimeout = ((callback: any, milliseconds: number, ...args: any[]) => {
      if (callback?.name !== "onAlertExpiry") return set(callback, milliseconds, ...args);
      const id = set(() => {w.expiryTimers.delete(id); callback(...args);}, milliseconds);
      w.expiryTimers.set(id, milliseconds); w.expiryDelays.push(milliseconds);
      return id;
    }) as any;
    window.clearTimeout = ((id: number) => {w.expiryTimers.delete(id); clear(id);}) as any;
    if (desktop) w.letscubeDesktop = { platform:"windows",
      async isMainForeground() {
        w.foregroundChecks++;
        if (w.holdForeground) await new Promise(resolve => {w.releaseForeground = resolve;});
        return false;
      },
      async notify(payload: unknown) {w.toasts.push(payload); return true;},
      async removeNotification() {return true;},
    };
  }, desktop);
  await page.addScriptTag({content:bundle});
  await until(async () => await page.locator("#state").getAttribute("data-ready") === "true", "own privacy must settle");
  await until(async () => await page.locator("#state").getAttribute("data-loading") === "false", "own privacy must finish loading");
  await page.evaluate(async () => {await (window as any).notices.refresh();});
  return {
    page, preferences, writes, unexpected, errors,
    rows(next: any[]) {rows = next;},
    refuse(owner: string | null) {refused = owner;},
    hold(owner: string | null) {held = owner;},
    release() {held = null; release?.();},
    async holdNextNotificationRead() {
      holdNotificationRead = true;
      await page.evaluate(() => {void (window as any).notices.refresh({presentNewDesktop:true});});
      await until(async () => Boolean(releaseNotificationRead), "old notification read really suspended");
    },
    releaseNotificationRead() {releaseNotificationRead?.();},
    async change(status: string, visible = false, untilAt: number | null = null, owner = A) {
      preferences.set(owner, privacy(status, visible, untilAt));
      await page.evaluate(async () => {await (window as any).refreshPrivacy();});
      await delay(30);
    },
    async insert(row: any) {
      rows.push(row);
      await page.evaluate((row: any) => {
        for (const ch of (window as any).channels.filter((ch: any) => ch.active)) {
          for (const {filter, callback} of ch.handlers) {
            if (filter.table === "notifications" && filter.event === "INSERT" && filter.filter === 'user_id=eq.'+row.user_id) callback({new:row});
          }
        }
      }, row);
      await until(async () => (await page.locator("#state").getAttribute("data-items") ?? "").split(",").includes(row.id), "insert must remain in app");
    },
    async reconnect() {
      await page.evaluate(() => {for (const ch of (window as any).channels.filter((ch: any) => ch.active)) ch.status('SUBSCRIBED');});
      await delay(60);
    },
    async close() {
      release?.();
      releaseNotificationRead?.();
      await page.evaluate(() => {(window as any).releaseForeground?.(); (window as any).unmount();});
      assert.equal(await page.evaluate(() => (window as any).expiryTimers.size), 0, "unmount removes the owned deadline timer");
      await context.close();
      assert.deepEqual(writes, [], "no backend mutations");
      assert.deepEqual(unexpected, [], "all provider calls accounted for");
      assert.deepEqual(errors, [], "no page errors");
    },
  };
}

async function pings(page: any) {
  return page.evaluate(() => ((window as any).__letscubeCallSounds?.asks ?? [])
    .filter((ask: any) => ask.ask === "once" && ask.sound === "notification" && ask.bursts > 0).length);
}

async function ping(page: any) {
  await page.evaluate(() => (window as any).ping());
  await delay(30);
}

test("hidden presence retains its dot but private DND stops actual notification and active ring sound", async () => {
  const f = await fixture();
  try {
    await ping(f.page);
    assert.equal(await pings(f.page), 1, "online control schedules a real notification burst");
    await f.page.evaluate(() => (window as any).resetSounds());
    await f.page.evaluate(() => (window as any).setRing(true));
    await until(async () => await f.page.evaluate(() => (window as any).__letscubeCallSounds?.playing === "ring"), "incoming ring control sounds");
    assert.ok(await f.page.evaluate(() => (window as any).__letscubeCallSounds.scheduled) > 0, "real oscillators scheduled");
    await f.change("dnd");
    assert.equal(await f.page.locator("#state").getAttribute("data-status"), "invisible", "public dot must not change");
    await until(async () => await f.page.evaluate(() => (window as any).__letscubeCallSounds?.playing === null), "DND must stop an already ringing consumer without waiting for a tick");
    assert.equal(await f.page.evaluate(() => (window as any).__letscubeCallSounds.scheduled), 0, "DND cancels scheduled ring oscillators");
    await ping(f.page);
    assert.equal(await pings(f.page), 1, "hidden presence plus DND must not ping");
    await f.page.evaluate(() => (window as any).setRing(false));
    for (const status of ["idle", "invisible", "online"]) {
      await f.change(status);
      await ping(f.page);
    }
    assert.equal(await pings(f.page), 4, "idle and invisible do not silence notifications");
  } finally {await f.close();}
});

test("callback reads literal DND expiry at current time even before the runtime tick", async () => {
  const f = await fixture();
  try {
    await f.change("dnd", false, T0 + 1000);
    await f.page.clock.setFixedTime(T0 + 999);
    await ping(f.page);
    assert.equal(await pings(f.page), 0, "one millisecond before expiry remains quiet");
    await f.page.clock.setFixedTime(T0 + 1000);
    await ping(f.page);
    assert.equal(await pings(f.page), 1, "at expiry callback sounds without a 30-second tick");
  } finally {await f.close();}
});

test("pending and refused B privacy cannot use A's sound or desktop policy", async () => {
  const f = await fixture(true);
  try {
    await ping(f.page);
    assert.equal(await pings(f.page), 1, "A positive sound control");
    await f.insert(notice("a-control"));
    await until(async () => await f.page.evaluate(() => (window as any).toasts.length === 1), "A bridge control delivered");
    f.hold(B);
    await f.page.evaluate((id: string) => (window as any).account(id), B);
    await ping(f.page);
    assert.equal(await pings(f.page), 1, "pending B must not inherit A online");
    await f.page.evaluate(() => (window as any).setRing(true));
    await f.insert(notice("b-pending", B));
    assert.equal(await f.page.evaluate(() => (window as any).toasts.length), 1, "pending B cannot bridge");
    f.refuse(B); f.release();
    await until(async () => await f.page.locator("#state").getAttribute("data-loading") === "false", "B refusal settled");
    await ping(f.page);
    assert.equal(await pings(f.page), 1, "failed privacy is not an online guess");
    assert.equal(await f.page.evaluate(() => (window as any).__letscubeCallSounds.playing), null, "account switch stops A ring");
    f.refuse(null);
    f.preferences.set(B, privacy("dnd"));
    await f.page.evaluate(async () => {await (window as any).retryPrivacy();});
    await delay(30);
    await ping(f.page);
    assert.equal(await pings(f.page), 1);
    await f.change("online", false, null, B);
    await f.page.evaluate(() => (window as any).setRing(false));
    await until(async () => await f.page.evaluate(() => (window as any).__letscubeCallSounds.playing === null), "positive ping control follows ring cleanup");
    await ping(f.page);
    assert.equal(await pings(f.page), 2, "B settled online does not inherit old DND");
    await f.insert(notice("b-control", B));
    await until(async () => await f.page.evaluate(() => (window as any).toasts.length === 2), "B bridge control delivered");
  } finally {await f.close();}
});

test("DND INSERT and refresh keep unread rows but consume desktop alerts without a reconnect burst", async () => {
  const f = await fixture(true);
  try {
    await f.insert(notice("control"));
    await until(async () => await f.page.evaluate(() => (window as any).toasts.length === 1), "real desktop bridge control");
    await f.change("dnd");
    await f.insert(notice("quiet-insert"));
    f.rows([notice("control"), notice("quiet-insert"), notice("quiet-refresh")]);
    await f.page.evaluate(async () => {await (window as any).notices.refresh({presentNewDesktop:true});});
    await delay(40);
    assert.equal(await f.page.locator("#state").getAttribute("data-count"), "3", "DND does not mark notification items read");
    assert.equal(await f.page.evaluate(() => (window as any).toasts.length), 1, "neither INSERT nor refresh bridges during DND");
    await f.change("online");
    await f.reconnect();
    await f.page.evaluate(async () => {await (window as any).notices.refresh({presentNewDesktop:true});});
    assert.equal(await f.page.evaluate(() => (window as any).toasts.length), 1, "observed quiet ids never replay after DND");
    await f.insert(notice("after-dnd"));
    await until(async () => await f.page.evaluate(() => (window as any).toasts.length === 2), "new eligible alerts resume");
  } finally {await f.close();}
});

test("DND chosen during foreground-await is rechecked at the actual desktop bridge", async () => {
  const f = await fixture(true);
  try {
    await f.insert(notice("control"));
    await until(async () => await f.page.evaluate(() => (window as any).toasts.length === 1), "bridge control delivered");
    await f.page.evaluate(() => {(window as any).holdForeground = true;});
    await f.insert(notice("in-flight"));
    await until(async () => await f.page.evaluate(() => typeof (window as any).releaseForeground === "function"), "foreground check is actually suspended");
    await f.change("dnd");
    await f.page.evaluate(() => {(window as any).holdForeground = false; (window as any).releaseForeground();});
    await delay(60);
    assert.equal(await f.page.evaluate(() => (window as any).toasts.length), 1, "late private DND wins before notify");
    await f.change("online");
    await f.reconnect();
    assert.equal(await f.page.evaluate(() => (window as any).toasts.length), 1, "in-flight DND refusal is handled, not replayed");
    await f.insert(notice("after-flight"));
    await until(async () => await f.page.evaluate(() => (window as any).toasts.length === 2), "bridge resumes for a new row");
  } finally {await f.close();}
});

test("finite DND wakes an active ring on the literal deadline and replaces obsolete deadlines", async () => {
  const f = await fixture();
  try {
    await f.change("dnd", false, T0 + 1000);
    await f.page.evaluate(() => (window as any).setRing(true));
    await f.page.clock.runFor(999);
    assert.equal(await f.page.evaluate(() => (window as any).__letscubeCallSounds?.playing ?? null), null, "no ring before deadline");
    await f.page.clock.runFor(1);
    await until(async () => await f.page.evaluate(() => (window as any).__letscubeCallSounds?.playing === "ring"), "ring resumes at exactly 1000 ms, not the 30-second tick");
    assert.deepEqual(await f.page.evaluate(() => (window as any).expiryDelays), [1000], "one runtime schedules the exact deadline");
    await f.change("dnd", false, T0 + 2000);
    assert.equal(await f.page.evaluate(() => (window as any).expiryTimers.size), 1);
    await f.change("dnd");
    assert.equal(await f.page.evaluate(() => (window as any).expiryTimers.size), 0, "forever choice clears obsolete expiry");
    await f.page.clock.runFor(1000);
    assert.equal(await f.page.evaluate(() => (window as any).__letscubeCallSounds.playing), null, "obsolete deadline cannot restart a forever-quiet ring");
    await f.change("dnd", false, T0 + 3000);
    assert.equal(await f.page.evaluate(() => (window as any).expiryTimers.size), 1, "unmount control holds a live owned deadline");
  } finally {await f.close();}
});

test("A to B to A cannot apply an earlier A notification refresh", async () => {
  const f = await fixture(true);
  try {
    f.rows([notice("stale-a")]);
    await f.holdNextNotificationRead();
    f.rows([]);
    await f.page.evaluate((id: string) => (window as any).account(id), B);
    await until(async () => await f.page.locator("#state").getAttribute("data-ready") === "true", "B privacy settles");
    await f.page.evaluate(async () => {await (window as any).notices.refresh();});
    await f.page.evaluate((id: string) => (window as any).account(id), A);
    await until(async () => await f.page.locator("#state").getAttribute("data-ready") === "true", "new A privacy settles");
    await f.page.evaluate(async () => {await (window as any).notices.refresh();});
    f.releaseNotificationRead();
    await delay(60);
    assert.equal(await f.page.locator("#state").getAttribute("data-count"), "0", "late first-A rows do not enter the new A session");
    assert.equal(await f.page.evaluate(() => (window as any).toasts.length), 0, "late first-A refresh does not alert the new session");
    await f.insert(notice("new-a-control"));
    await until(async () => await f.page.evaluate(() => (window as any).toasts.length === 1), "new A actual bridge control");
  } finally {await f.close();}
});

test("account changes during foreground-await cannot deliver A's toast to settled B", async () => {
  const f = await fixture(true);
  try {
    await f.page.evaluate(() => {(window as any).holdForeground = true;});
    await f.insert(notice("a-in-flight"));
    await until(async () => await f.page.evaluate(() => typeof (window as any).releaseForeground === "function"), "A foreground await is suspended");
    await f.page.evaluate((id: string) => (window as any).account(id), B);
    await until(async () => await f.page.locator("#state").getAttribute("data-ready") === "true", "B privacy is settled online");
    await f.page.evaluate(() => {(window as any).holdForeground = false; (window as any).releaseForeground();});
    await delay(50);
    assert.equal(await f.page.evaluate(() => (window as any).toasts.length), 0, "A's pending bridge is invalidated by the account transition");
    await f.insert(notice("b-after-await", B));
    await until(async () => await f.page.evaluate(() => (window as any).toasts.length === 1), "settled B still delivers new alerts");
  } finally {await f.close();}
});

test("desktop callbacks honor literal expiry and keep idle and invisible alerts enabled", async () => {
  const f = await fixture(true);
  try {
    await f.change("dnd", false, T0 + 1000);
    await f.page.clock.setFixedTime(T0 + 999);
    await f.insert(notice("before-expiry"));
    assert.equal(await f.page.evaluate(() => (window as any).toasts.length), 0);
    await f.page.clock.setFixedTime(T0 + 1000);
    await f.insert(notice("at-expiry"));
    await until(async () => await f.page.evaluate(() => (window as any).toasts.length === 1), "Windows alert at exact expiry before tick");
    for (const status of ["idle", "invisible"]) {
      await f.change(status);
      await f.insert(notice(status));
    }
    await until(async () => await f.page.evaluate(() => (window as any).toasts.length === 3), "idle and invisible Windows controls deliver");
    await f.reconnect();
    assert.equal(await f.page.evaluate(() => (window as any).toasts.length), 3, "pre-expiry quiet id remains handled");
  } finally {await f.close();}
});
