import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const kubRoot = fileURLToPath(new URL("../../artifacts/kub/", import.meta.url));
const sourceRoot = resolve(kubRoot, "src");
const kubRequire = createRequire(resolve(kubRoot, "package.json"));
const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");
const { chromium } = kubRequire("@playwright/test");
let browser;
let bundle;

// Only provider/irrelevant runtime boundaries are replaced; React, the hook,
// adapter, projection, row merging and native identity calculation stay real.
const stubs = new Map([
  ["hooks/useCallSound.ts", "export function playNotificationSoundFor() {}"],
  ["hooks/useOwnPresence.ts", `
    export function ownAlertPolicySnapshot(expected) {
      return window.state.currentUser?.id === expected ? 'allow' : 'wait';
    }
  `],
  ["lib/supabase/client.ts", `
    const client = {
      from() { return {select() {return this;}, eq() {return this;}, order() {return this;},
        async limit() {return {data:[], error:null};}}; },
      channel() {
        const ch = {handlers:[], on(type, filter, callback) {
          this.handlers.push({filter, callback}); return this;
        }, subscribe(callback) {this.active=true; callback('SUBSCRIBED'); return this;}};
        window.channels.push(ch); return ch;
      },
      removeChannel(ch) {ch.active=false;},
      async rpc() {window.serverWrites++; throw Error('server mutation forbidden');}
    };
    export function createClient() {return client;}
  `],
  ["store/app.store.ts", `
    import {useSyncExternalStore} from 'react';
    const listeners = new Set();
    export function useAppStore(selector) {
      return useSyncExternalStore(fn => {listeners.add(fn); return () => listeners.delete(fn);},
        () => selector(window.state));
    }
    useAppStore.getState = () => window.state;
    useAppStore.setState = patch => {
      window.state={...window.state, ...patch}; for (const fn of listeners) fn();
    };
  `],
  ["lib/errors.ts", "export function mapPgError() {return 'synthetic refusal';}"],
  ["lib/dev/instrumentation.ts", "export function bumpFetch() {} export function registerChannel() {} export function unregisterChannel() {}"],
  ["lib/chatEvents.ts", "export function dispatchChatsRefresh() {}"],
  ["lib/platform/capabilities.ts", "export function isNativeAndroid() {return false;}"],
  ["lib/platform/nativePush.ts", "export async function closeNativeChatNotification() {throw Error('out of scope');}"],
]);

async function compile(change) {
  let replacements = 0;
  const result = await build({
    write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": sourceRoot }, define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "offline-boundaries", setup(plugin) {
      plugin.onLoad({ filter: /\.[tj]s$/ }, (args) => {
        const relative = args.path.slice(sourceRoot.length + 1).replaceAll("\\", "/");
        if (stubs.has(relative)) return { contents: stubs.get(relative), loader: "ts", resolveDir: sourceRoot };
        if (change && relative === "hooks/useNotifications.ts") {
          const source = readFileSync(args.path, "utf8").replaceAll("\r\n", "\n");
          assert.equal(source.split(change[0]).length - 1, 1, "mutation must match exactly once");
          replacements++;
          return { contents: source.replace(change[0], change[1]), loader: "ts" };
        }
      });
    }}],
    stdin: { loader: "tsx", resolveDir: kubRoot, contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {useAppStore} from './src/store/app.store.ts';
      import {useNotifications} from './src/hooks/useNotifications.ts';
      window.state={currentUser:{id:'A'}, accountEpoch:1, mutedChatIds:[]}; window.channels=[];
      window.cards=new Map(); window.events=[]; window.gates=new Map(); window.serverWrites=0;
      window.nextNotify=null; window.nextRemove=null; window.nextForeground=null;
      async function gate(name) {
        if (!name) return;
        await new Promise(resolve => window.gates.set(name, resolve));
        window.gates.delete(name);
      }
      const identity=card => card.kind+':'+card.group+':'+card.id;
      window.letscubeDesktop={platform:'windows',
        async isMainForeground() {
          const held=window.nextForeground; window.nextForeground=null; await gate(held); return false;
        },
        async notify(card) {
          const held=window.nextNotify; window.nextNotify=null;
          window.events.push({type:'notify-start', body:card.body});
          if (window.rejectIcon && card.icon) throw Error("unknown field 'icon'");
          await gate(held);
          window.cards.set(identity(card), card);
          window.events.push({type:'notify-done', body:card.body}); return true;
        },
        async removeNotification(card) {
          const held=window.nextRemove; window.nextRemove=null;
          window.events.push({type:'remove-start'}); await gate(held);
          if (window.refuseRemoval) {
            window.events.push({type:'remove-refused'});
            if (window.refuseRemoval==='throw') throw Error('synthetic removal rejection');
            return false;
          }
          window.cards.delete(identity(card)); window.events.push({type:'remove-done'}); return true;
        }
      };
      function Harness() {
        const notices=useNotifications(); window.notices=notices;
        return <output id="count">{notices.unreadCount}</output>;
      }
      const app=createRoot(document.getElementById('root'));
      flushSync(() => app.render(<Harness/>));
      window.detach=() => flushSync(() => app.render(null));
      window.attach=() => flushSync(() => app.render(<Harness/>));
      const account=id => useAppStore.setState({currentUser:id ? {id} : null,
        accountEpoch:window.state.accountEpoch+(window.state.currentUser?.id!==id ? 1 : 0)});
      window.account=id => flushSync(() => account(id));
      window.accountRoundTrip=() => {account(null); account('A');};
      window.deliver=(event, row) => flushSync(() => {
        for (const ch of window.channels.filter(ch => ch.active)) for (const h of ch.handlers)
          if (h.filter.event===event && h.filter.filter==='user_id=eq.'+row.user_id) h.callback({new:row});
      });
      window.unmount=() => flushSync(() => app.unmount());
    ` },
  });
  if (change) assert.equal(replacements, 1, "the modified hook must actually compile");
  return result.outputFiles[0].text;
}

test.before(async () => {
  bundle = await compile();
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); });

function notice(id, owner = "A", extra = {}) {
  return { id, user_id: owner, kind: "message", read_at: null,
    created_at: "2026-10-05T00:00:00.000Z", payload: {
      chat_id: "synthetic-chat", message_id: id, sender_kind: "user", sender_id: "sender",
      bot_id: null, chat_type: "private", sender_name: "Synthetic sender", preview: owner,
    }, ...extra };
}

async function fixture(code = bundle) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const network = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => { network.push("blocked request"); return route.abort(); });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: code });
  await page.evaluate(async () => { await window.notices.refresh(); });
  return {
    page,
    async insert(row) { await page.evaluate(row => window.deliver("INSERT", row), row); },
    async account(owner) {
      await page.evaluate(async owner => {window.account(owner); await window.notices.refresh();}, owner);
    },
    async drain() { await page.evaluate(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    }); },
    async bodies() { return page.evaluate(() => [...window.cards.values()].map(card => card.body).sort()); },
    async release(name) { await page.evaluate(name => window.gates.get(name)?.(), name); },
    async gated(name) { await page.waitForFunction(name => window.gates.has(name), name); },
    async close() {
      await page.evaluate(async () => {
        for (const release of window.gates.values()) release(); window.unmount();
        for (let i = 0; i < 20; i++) await Promise.resolve();
      });
      assert.equal(await page.evaluate(() => window.serverWrites), 0, "cleanup must not mutate server read state");
      assert.deepEqual(network, [], "fixture must make no network requests");
      assert.deepEqual(errors, [], "fixture must have no page errors");
      await context.close();
    },
  };
}

async function delivered(f, row) {
  const before = await f.page.evaluate(() => window.events.filter(event => event.type === "notify-done").length);
  await f.insert(row);
  await f.page.waitForFunction(before => window.events.filter(event => event.type === "notify-done").length === before + 1, before);
  await f.drain();
}

async function switchCleanup(f) {
  await delivered(f, notice("old"));
  assert.deepEqual(await f.bodies(), ["A"], "positive delivery control");
  await f.account("B"); await delivered(f, notice("new", "B")); await f.drain();
  assert.deepEqual(await f.bodies(), ["B"], "account switch removes A and preserves B");
}

async function lateNotify(f) {
  await f.page.evaluate(() => {window.nextNotify="old-notify";});
  await f.insert(notice("old")); await f.gated("old-notify");
  await f.account("B"); await delivered(f, notice("new", "B"));
  await f.release("old-notify"); await f.drain();
  assert.deepEqual(await f.bodies(), ["B"], "notify finishing after switch must retire A only");
}

async function replacement(f, returnToA = false) {
  await delivered(f, notice("same-row"));
  await f.page.evaluate(() => {window.nextRemove="old-remove";});
  await f.account(returnToA ? null : "B");
  // The assertion below, not a timeout, is the RED oracle on the old source.
  await f.drain();
  assert.equal(await f.page.evaluate(() => window.gates.has("old-remove")), true, "account cleanup reaches the real adapter identity");
  if (returnToA) await f.account("A");
  const replacementRow = notice("same-row", returnToA ? "A" : "B");
  replacementRow.payload.preview = "replacement";
  await f.insert(replacementRow); await f.drain();
  assert.equal(await f.page.evaluate(() => window.events.filter(event => event.type === "notify-start").length), 1,
    "replacement waits behind removal of the identical OS card");
  await f.release("old-remove"); await f.drain();
  assert.deepEqual(await f.bodies(), ["replacement"], "old cleanup cannot delete the replacement");
}

async function refusedCleanup(f, rejection = false) {
  await delivered(f, notice("old"));
  await f.page.evaluate(rejection => {window.refuseRemoval=rejection ? "throw" : true;}, rejection);
  await f.account("B"); await f.drain();
  assert.deepEqual(await f.bodies(), ["A"], "failed removal does not fabricate success");
  assert.equal(await f.page.evaluate(() => window.events.filter(event => event.type === "remove-refused").length), 1,
    "the refused cleanup actually reached the bridge");
  await delivered(f, notice("new", "B"));
  await f.page.evaluate(() => {window.refuseRemoval=false;});
  await f.account("C"); await f.drain();
  assert.deepEqual(await f.bodies(), [], "a later transition retries retained A and removes B");
}

for (const [name, scenario] of [
  ["A to B removes A cards without deleting B", switchCleanup],
  ["in-flight notify completing after switch is cleaned without touching B", lateNotify],
  ["old cleanup cannot remove B's replacement with the same row and tag", f => replacement(f)],
  ["logout and return to A cannot remove the new generation's same-row replacement", f => replacement(f, true)],
  ["a failed cleanup retains native identifiers for the next account transition", refusedCleanup],
  ["a rejected cleanup retains identifiers without blocking the next account", f => refusedCleanup(f, true)],
]) {
  test(name, async () => { const f = await fixture(); try {await scenario(f);} finally {await f.close();} });
}

test("logout removes message, task and system cards without marking them read", async () => {
  const f = await fixture();
  try {
    await delivered(f, notice("message"));
    await delivered(f, notice("task", "A", {kind:"task_assigned", payload:{task_id:"synthetic-task", title:"task control"}}));
    await delivered(f, notice("system", "A", {kind:"system", payload:{tag:"system:synthetic", body:"system control"}}));
    assert.deepEqual(await f.bodies(), ["A", "system control", "task control"]);
    await f.account(null); await f.drain();
    assert.deepEqual(await f.bodies(), [], "logout retires all delivered kinds");
  } finally {await f.close();}
});

async function readCleanup(f) {
  const row = notice("same-row"); await delivered(f, row);
  await f.page.evaluate(() => {window.nextRemove="read-remove";});
  await f.page.evaluate(row => window.deliver("UPDATE", {...row, read_at:"2026-10-05T00:01:00.000Z"}), row);
  await f.gated("read-remove"); await f.account("B");
  await f.insert(notice("same-row", "B")); await f.drain();
  assert.equal(await f.page.evaluate(() => window.events.filter(event => event.type === "notify-start").length), 1,
    "B must wait for A's read cleanup too");
  await f.release("read-remove"); await f.drain();
  assert.deepEqual(await f.bodies(), ["B"]);
}

test("read-sync uses the same serialized identity and cannot delete a new-owner replacement", async () => {
  const f = await fixture(); try {await readCleanup(f);} finally {await f.close();}
});

async function foregroundGuard(f) {
  await f.page.evaluate(() => {window.nextForeground="foreground";});
  await f.insert(notice("old")); await f.gated("foreground");
  await f.account(null); await f.release("foreground"); await f.drain();
  assert.equal(await f.page.evaluate(() => window.events.filter(event => event.type === "notify-start").length), 0,
    "logged-out foreground work must not invoke notify");
  assert.deepEqual(await f.bodies(), []);
}

test("a foreground-await started by A cannot invoke notify after logout", async () => {
  const f = await fixture(); try {await foregroundGuard(f);} finally {await f.close();}
});

async function batchedSessionGuard(f) {
  await f.page.evaluate(() => {window.nextForeground="batched-foreground";});
  await f.insert(notice("old")); await f.gated("batched-foreground");
  await f.page.evaluate(() => window.accountRoundTrip());
  await f.release("batched-foreground"); await f.drain();
  assert.equal(await f.page.evaluate(() => window.state.accountEpoch), 3);
  assert.equal(await f.page.evaluate(() => window.events.filter(event => event.type === "notify-start").length), 0,
    "a batched same-account session replacement must not invoke old notify");
  assert.deepEqual(await f.bodies(), []);
}

test("batched logout and same-account return cancel a foreground wait", async () => {
  const f = await fixture(); try {await batchedSessionGuard(f);} finally {await f.close();}
});

async function batchedCardRetirement(f) {
  await delivered(f, notice("old"));
  await f.page.evaluate(() => window.accountRoundTrip()); await f.drain();
  assert.deepEqual(await f.bodies(), [], "account epoch retires the earlier session's card even if the user id did not render differently");
  await delivered(f, notice("new"));
  assert.deepEqual(await f.bodies(), ["A"]);
}

test("batched same-account replacement retires acknowledged cards without losing a new card", async () => {
  const f = await fixture(); try {await batchedCardRetirement(f);} finally {await f.close();}
});

async function beforeRenderGuard(f) {
  await f.page.evaluate(() => {window.nextForeground="before-render";});
  await f.insert(notice("old")); await f.gated("before-render");
  // Model the authoritative store advancing before the subscriber's React commit.
  await f.page.evaluate(() => {window.state={...window.state, accountEpoch:3};});
  await f.release("before-render"); await f.drain();
  assert.equal(await f.page.evaluate(() => window.events.filter(event => event.type === "notify-start").length), 0,
    "the final delivery boundary must check the authoritative session before React commits");
  assert.deepEqual(await f.bodies(), []);
}

test("the final delivery boundary rejects a session change before the React effect commits", async () => {
  const f = await fixture(); try {await beforeRenderGuard(f);} finally {await f.close();}
});

async function successiveReplacement(f) {
  await delivered(f, notice("same-row"));
  await f.page.evaluate(() => {window.nextRemove="old-remove";});
  await f.account("B"); await f.drain();
  assert.equal(await f.page.evaluate(() => window.gates.has("old-remove")), true);
  await f.page.evaluate(() => {window.nextNotify="b-notify";});
  await f.insert(notice("same-row", "B"));
  await f.release("old-remove"); await f.gated("b-notify");
  await f.account("C"); await f.insert(notice("same-row", "C")); await f.drain();
  assert.equal(await f.page.evaluate(() => window.events.filter(event => event.type === "notify-start").length), 2,
    "old completed cleanup cannot discard B's still-pending identity queue");
  await f.release("b-notify"); await f.drain();
  assert.deepEqual(await f.bodies(), ["C"], "late B is retired before C replaces the same identity");
}

test("A to B to C retains the queue through an in-flight same-identity replacement", async () => {
  const f = await fixture(); try {await successiveReplacement(f);} finally {await f.close();}
});

async function legacyRetry(f) {
  await f.page.evaluate(() => {window.rejectIcon=true;});
  const row = notice("legacy"); row.payload.sender_avatar_url="https://api.letscube.ru/media/bots/synthetic.webp";
  await f.insert(row); await f.drain();
  assert.equal(await f.page.evaluate(() => window.events.filter(event => event.type === "notify-start").length), 2,
    "unknown icon must reach the existing adapter retry");
  assert.deepEqual(await f.bodies(), ["A"]);
  assert.equal(await f.page.evaluate(() => [...window.cards.values()][0].icon), undefined);
  await f.account(null); await f.drain(); assert.deepEqual(await f.bodies(), []);
}

test("queued notification errors still reach the adapter's exact iconless legacy retry", async () => {
  const f = await fixture(); try {await legacyRetry(f);} finally {await f.close();}
});

async function remountReplacement(f, owner = "B") {
  await delivered(f, notice("same-row"));
  await f.page.evaluate(() => {window.nextRemove="unmounted-remove"; window.detach();});
  await f.gated("unmounted-remove");
  await f.page.evaluate(async owner => {window.account(owner); window.attach(); await window.notices.refresh();}, owner);
  const row = notice("same-row", owner); row.payload.preview="remounted";
  await f.insert(row); await f.drain();
  assert.equal(await f.page.evaluate(() => window.events.filter(event => event.type === "notify-start").length), 1,
    "a genuinely new hook instance must share the old pending identity queue");
  await f.release("unmounted-remove"); await f.drain();
  assert.deepEqual(await f.bodies(), ["remounted"], "old unmounted cleanup cannot erase the remounted card");
}

test("true hook unmount/remount keeps same-identity replacement behind held cleanup", async () => {
  const f = await fixture(); try {await remountReplacement(f);} finally {await f.close();}
});

test("public-route unmount/remount of the same account uses a fresh card owner", async () => {
  const f = await fixture(); try {await remountReplacement(f, "A");} finally {await f.close();}
});

test("refused removal identifiers survive unmount and a later remounted account transition", async () => {
  const f = await fixture();
  try {
    await delivered(f, notice("old"));
    await f.page.evaluate(() => {window.refuseRemoval=true; window.detach();}); await f.drain();
    assert.deepEqual(await f.bodies(), ["A"]);
    assert.equal(await f.page.evaluate(() => window.events.filter(event => event.type === "remove-refused").length), 1);
    await f.page.evaluate(async () => {
      window.refuseRemoval=false; window.account('B'); window.attach(); await window.notices.refresh();
    });
    await delivered(f, notice("new", "B"));
    await f.account(null); await f.drain();
    assert.deepEqual(await f.bodies(), [], "retained old identities are not lost with the retired hook");
  } finally {await f.close();}
});

test("an old hook's in-flight notify is retired before a remounted same-identity card", async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => {window.nextNotify="unmounted-notify";});
    await f.insert(notice("same-row")); await f.gated("unmounted-notify");
    await f.page.evaluate(async () => {window.detach(); window.account('B'); window.attach(); await window.notices.refresh();});
    await f.insert(notice("same-row", "B")); await f.drain();
    assert.equal(await f.page.evaluate(() => window.events.filter(event => event.type === "notify-start").length), 1,
      "remount cannot bypass a native ACK still pending in the old hook");
    await f.release("unmounted-notify"); await f.drain();
    assert.deepEqual(await f.bodies(), ["B"]);
  } finally {await f.close();}
});

const mutants = [
  ["ignore batched same-account replacement", [
    "const accountEpoch = useAppStore((s) => s.accountEpoch);",
    "const accountEpoch = useRef(useAppStore.getState().accountEpoch).current;",
  ], batchedCardRetirement, "account epoch retires the earlier session's card even if the user id did not render differently"],
  ["omit the immediate epoch delivery fence", [
    " || useAppStore.getState().accountEpoch !== accountEpoch", "",
  ], beforeRenderGuard, "the final delivery boundary must check the authoritative session before React commits"],
  ["omit account retirement", [
    "if (!current.card || desktopCardOwners.has(current.card.owner)) return false;",
    "return false;",
  ], switchCleanup, "account switch removes A and preserves B"],
  ["forget the successful native ACK", [
    "if (delivered) queue.card = { owner: handled, rowId: row.id };", "",
  ], lateNotify, "notify finishing after switch must retire A only"],
  ["bypass same-identity serialization", [
    "const operation = current.pending.then(() => action(current));",
    "const operation = Promise.resolve().then(() => action(current));",
  ], replacement, "replacement waits behind removal of the identical OS card"],
  ["forget a refused removal", [
    "if (removed) current.card = null;", "current.card = null;",
  ], refusedCleanup, "a later transition retries retained A and removes B"],
  ["drop a queue before its replacement finishes", [
    "if (current.pending === pending && !current.card) queues.delete(key);",
    "if (!current.card) queues.delete(key);",
  ], successiveReplacement, "old completed cleanup cannot discard B's still-pending identity queue"],
  ["use an unrelated queue for read cleanup", [
    "removeNotification: (identity) => queueDesktopCard(desktopCardQueues, identity, async (queue) => {",
    "removeNotification: (identity) => queueDesktopCard(new Map(), identity, async (queue) => {",
  ], readCleanup, "B must wait for A's read cleanup too"],
  ["hide adapter compatibility errors", [
    "const operation = current.pending.then(() => action(current));",
    "const operation = current.pending.then(() => action(current)).catch(() => false);",
  ], legacyRetry, "unknown icon must reach the existing adapter retry"],
  ["omit the last ownership check before notify", [
    "if (!mayDeliver()) return false;", "",
  ], foregroundGuard, "logged-out foreground work must not invoke notify"],
  ["reset serialization on hook remount", [
    "export function useNotifications() {",
    "export function useNotifications() { const desktopCardQueues = useRef(new Map()).current;",
  ], remountReplacement, "a genuinely new hook instance must share the old pending identity queue"],
];

for (const [name, change, scenario, message] of mutants) {
  test(`compiled mutation refused: ${name}`, async () => {
    const f = await fixture(await compile(change));
    try {
      await assert.rejects(() => scenario(f), error => {
        assert.equal(error.code, "ERR_ASSERTION", "a setup error is not a killed mutation");
        assert.equal(error.message.split("\n")[0], message, "the literal behavior oracle must kill this mutation");
        return true;
      });
    } finally {await f.close();}
  });
}
