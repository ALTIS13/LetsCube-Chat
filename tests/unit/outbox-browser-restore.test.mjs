import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { chromium, webkit } from "@playwright/test";

const root = new URL("../../", import.meta.url);
const prefix = "artifacts/kub/src/lib/outbox/";
const owner = "11111111-1111-4111-8111-000000000001";
const chat = "22222222-2222-4222-8222-000000000001";
const origin = "http://outbox-restore.invalid";

function modules({ baseline = false } = {}) {
  return Object.fromEntries(["outboxRules.ts", "outboxStorage.ts", "outboxRunner.ts"].map(name => {
    const source = baseline && name === "outboxRunner.ts"
      ? execFileSync("git", ["show", "c92e408075f3dc696363c0e4cfcdda11ecf02992:" + prefix + name],
        { cwd: fileURLToPath(root), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      : readFileSync(new URL(prefix + name, root), "utf8");
    return ["/" + name, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText];
  }));
}

async function restoreInBrowser(t, engine, source, discardOlder = false) {
  const browser = await engine.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  const unexpected = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || (url.pathname !== "/" && !source[url.pathname])) {
      unexpected.push(url.origin + url.pathname);
      return route.abort();
    }
    return route.fulfill({ status: 200, contentType: url.pathname === "/" ? "text/html" : "text/javascript",
      body: url.pathname === "/" ? "<!doctype html><title>Fictional outbox restore</title>" : source[url.pathname] });
  });
  const page = await context.newPage();
  await page.goto(origin);
  const older = {
    userId: owner, chatId: chat, topicId: null, type: "text", content: "Fictional queued text",
    clientMessageId: "33333333-3333-4333-8333-000000000001", tempId: "fixture:older",
    clientSentAt: "2026-10-18T00:00:01.000Z", attempts: 1, nextAttemptAt: 0,
    replyToId: null, forwardedFromId: null, mediaBucket: null, mediaPath: null, mediaUrl: null,
  };
  await page.evaluate(async entry => {
    const { browserOutboxStorage } = await import("/outboxStorage.ts");
    await browserOutboxStorage().put(entry);
  }, older);
  // A fresh document has no previous module memory: the older send must come from IndexedDB.
  await page.reload();
  const result = await page.evaluate(async ({ older, discardOlder }) => {
    const { browserOutboxStorage } = await import("/outboxStorage.ts");
    const { createOutboxRunner } = await import("/outboxRunner.ts");
    const storage = browserOutboxStorage(), sends = [];
    let release, entered, written;
    const gate = new Promise(resolve => { release = resolve; });
    const listing = new Promise(resolve => { entered = resolve; });
    const persisted = new Promise(resolve => { written = resolve; });
    const runner = createOutboxRunner({
      storage: { ...storage,
        async put(entry) { await storage.put(entry); written(); },
        async list(userId) { const held = await storage.list(userId); entered(); await gate; return held; },
      },
      async send(entry) { sends.push(entry.clientMessageId); return { sent: { id: entry.clientMessageId } }; },
      onSent() {}, onWaiting() {}, onRefused() {},
    });
    const start = runner.start(older.userId);
    await listing;
    const newer = { ...older, clientMessageId: "33333333-3333-4333-8333-000000000002",
      tempId: "fixture:newer", clientSentAt: "2026-10-18T00:00:02.000Z" };
    const pending = runner.enqueue(newer);
    // Let the actual IDB write and any incorrect eager drain finish before restoring.
    await persisted;
    await new Promise(resolve => setTimeout(resolve, 0));
    if (discardOlder) await runner.discard(older.clientMessageId);
    const beforeRestore = [...sends];
    release();
    await start;
    await pending;
    for (let i = 0; i < 50 && sends.length < (discardOlder ? 1 : 2); i++) await new Promise(resolve => setTimeout(resolve, 10));
    runner.stop();
    return { beforeRestore, sends, retained: (await storage.list(older.userId)).map(entry => entry.clientMessageId) };
  }, { older, discardOlder });
  assert.deepEqual(unexpected, [], "fictional route must never reach any external service");
  return result;
}

for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
  test(`${name}: actual IndexedDB cold restore precedes a newly composed message`, { timeout: 30000 }, async t => {
    const result = await restoreInBrowser(t, engine, modules());
    assert.deepEqual(result.beforeRestore, [], "new send cannot pass an unread persistent queue");
    assert.deepEqual(result.sends, ["33333333-3333-4333-8333-000000000001", "33333333-3333-4333-8333-000000000002"]);
    assert.deepEqual(result.retained, [], "both acknowledged sends leave persistent storage");
  });
  test(`${name}: discard removes an older entry even when the restore already read its snapshot`, { timeout: 30000 }, async t => {
    const result = await restoreInBrowser(t, engine, modules(), true);
    assert.deepEqual(result.beforeRestore, []);
    assert.deepEqual(result.sends, ["33333333-3333-4333-8333-000000000002"], "discarded stored message must never reach send");
    assert.deepEqual(result.retained, []);
  });
}

test("shipped-runner control exposes the actual browser overtaking failure", { timeout: 30000 }, async t => {
  const result = await restoreInBrowser(t, chromium, modules({ baseline: true }));
  assert.deepEqual(result.beforeRestore, ["33333333-3333-4333-8333-000000000002"]);
  assert.deepEqual(result.sends, ["33333333-3333-4333-8333-000000000002", "33333333-3333-4333-8333-000000000001"]);
});
