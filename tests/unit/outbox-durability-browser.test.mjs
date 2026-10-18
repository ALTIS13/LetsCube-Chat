import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { chromium, webkit } from "@playwright/test";

const owner = "11111111-1111-4111-8111-000000000001";
const entry = { userId: owner, chatId: "22222222-2222-4222-8222-000000000001", topicId: null,
  clientMessageId: "33333333-3333-4333-8333-000000000001", tempId: "tmp:owned", type: "text", content: null,
  replyToId: null, forwardedFromId: null, mediaBucket: null, mediaPath: null, mediaUrl: null,
  clientSentAt: "2026-10-18T00:00:00Z", attempts: 0, nextAttemptAt: 0 };
const origin = "http://outbox-durability.invalid";
const modules = Object.fromEntries(["outboxStorage", "outboxRules", "outboxRunner", "idbTransaction"].map(name => [
  `/${name}.ts`, ts.transpileModule(readFileSync(new URL(`../../artifacts/kub/src/lib/outbox/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText,
]));
modules["/fault.mjs"] = readFileSync(new URL("../helpers/outbox-idb-fault.mjs", import.meta.url), "utf8");
const helper = readFileSync(new URL("../../artifacts/kub/src/lib/outbox/idbTransaction.ts", import.meta.url), "utf8");
const prematureAck = "request.onsuccess = () => { value = request.result; };";
assert.equal(helper.split(prematureAck).length, 2);
modules["/idbPremature.ts"] = ts.transpileModule(helper.replace(prematureAck,
  "request.onsuccess = () => { value = request.result; resolve(value); };"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const [engine, type] of [["Chromium", chromium], ["WebKit", webkit]]) {
  test(`${engine}: actual IDB commit ACK, delete abort retention and explicit discard retry`, { timeout: 30000 }, async t => {
    const browser = await type.launch({ headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ serviceWorkers: "block" });
    let unexpected = 0;
    try {
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || (url.pathname !== "/" && !modules[url.pathname])) { unexpected += 1; return route.abort(); }
        return route.fulfill({ status: 200, contentType: url.pathname === "/" ? "text/html" : "text/javascript",
          body: url.pathname === "/" ? "<!doctype html><title>Owned durability fixture</title>" : modules[url.pathname] });
      });
      const page = await context.newPage(); await page.goto(origin);
      const observed = await page.evaluate(async entry => {
        const { outboxIdbFault } = await import("/fault.mjs");
        const { browserOutboxStorage } = await import("/outboxStorage.ts");
        const { createOutboxRunner } = await import("/outboxRunner.ts");
        const probe = outboxIdbFault(), storage = browserOutboxStorage(probe.factory);
        let sends = 0;
        const runner = createOutboxRunner({ storage,
          async send() { sends += 1; return { failed: { status: 0 } }; }, onWaiting() {}, onRefused() {}, onSent() {} });
        try {
          await runner.start(entry.userId); await runner.enqueue(entry); await probe.idle();
          const seedCommitted = probe.transactions.filter(tx => tx.operations.includes("put")).every(tx => tx.outcome === "complete");
          probe.arm(); const failed = await runner.discard(entry.clientMessageId); await probe.idle();
          const retainedAfterFailure = runner.has(entry.clientMessageId);
          const sameLifetimeRows = (await storage.list(entry.userId)).length;
          runner.retryNow(); await runner.start(entry.userId); await probe.idle();
          const sendsAfterFailure = sends;
          const retry = await runner.discard(entry.clientMessageId);
          const retryAcknowledgedAfterCommit = probe.transactions.at(-1).outcome === "complete";
          return { seedCommitted, failed: failed?.ok, retainedAfterFailure, sameLifetimeRows, sendsAfterFailure,
            retry: retry?.ok, retryAcknowledgedAfterCommit, remaining: (await storage.list(entry.userId)).length,
            aborts: probe.aborts, events: probe.events };
        } finally { runner.stop(); await probe.idle(); probe.close(); }
      }, entry);
      assert.equal(observed.seedCommitted, true);
      assert.equal(observed.aborts, 1);
      assert.equal(observed.failed, false, "aborted delete cannot ACK discard");
      assert.equal(observed.retainedAfterFailure, true, "failed discard retains the visible entry");
      assert.equal(observed.sameLifetimeRows, 1);
      assert.equal(observed.sendsAfterFailure, 1, "cancel-pending entry cannot auto-send again");
      assert.equal(observed.retry, true);
      assert.equal(observed.retryAcknowledgedAfterCommit, true, "discard success must follow tx.complete");
      assert.equal(observed.remaining, 0);
      assert.ok(observed.events.indexOf("delete:handled") < observed.events.indexOf("delete:abort-called"));
      assert.ok(observed.events.indexOf("delete:abort-called") < observed.events.indexOf("tx:abort"));
      await page.reload();
      const fresh = await page.evaluate(async owner => {
        const { browserOutboxStorage } = await import("/outboxStorage.ts");
        const { createOutboxRunner } = await import("/outboxRunner.ts");
        let sends = 0;
        const runner = createOutboxRunner({ storage: browserOutboxStorage(), async send() { sends++; return { sent: {} }; },
          onWaiting() {}, onRefused() {}, onSent() {} });
        try { return { rows: (await runner.start(owner)).length, sends }; } finally { runner.stop(); }
      }, owner);
      assert.deepEqual(fresh, { rows: 0, sends: 0 });
      assert.equal(unexpected, 0);
    } finally { await context.close(); }
  });
  test(`${engine}: actual IDB put abort rejects without phantom memory row and retries normally`, { timeout: 30000 }, async t => {
    const browser = await type.launch({ headless: true }); t.after(() => browser.close());
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        assert.equal(url.origin, origin);
        assert.ok(url.pathname === "/" || modules[url.pathname]);
        return route.fulfill({ status: 200, contentType: url.pathname === "/" ? "text/html" : "text/javascript",
          body: url.pathname === "/" ? "<!doctype html><title>Owned put fixture</title>" : modules[url.pathname] });
      });
      const page = await context.newPage(); await page.goto(origin);
      const actual = await page.evaluate(async entry => {
        const { outboxIdbFault } = await import("/fault.mjs");
        const { browserOutboxStorage } = await import("/outboxStorage.ts");
        const probe = outboxIdbFault({ operation: "put", armed: true });
        const storage = browserOutboxStorage(probe.factory);
        try {
          let rejected = false; try { await storage.put(entry); } catch { rejected = true; }
          await probe.idle(); const phantomRows = (await storage.list(entry.userId)).length;
          await storage.put(entry); const committedAtAck = probe.transactions.at(-1).outcome === "complete";
          const retriedRows = (await storage.list(entry.userId)).length;
          probe.arm("getAll"); let readRejected = false;
          try { await storage.list(entry.userId); } catch { readRejected = true; }
          const readableAfterAbort = (await storage.list(entry.userId)).length;
          const foreignRows = (await storage.list("11111111-1111-4111-8111-000000000002")).length;
          await storage.remove(entry.clientMessageId); await probe.idle();
          return { rejected, phantomRows, committedAtAck, retriedRows, readRejected, readableAfterAbort, foreignRows, aborts: probe.aborts };
        } finally { probe.close(); }
      }, entry);
      assert.deepEqual(actual, { rejected: true, phantomRows: 0, committedAtAck: true, retriedRows: 1,
        readRejected: true, readableAfterAbort: 1, foreignRows: 0, aborts: 2 });
      if (engine === "Chromium") {
        const omitted = await page.evaluate(async entry => {
          const { outboxIdbFault } = await import("/fault.mjs");
          const { browserOutboxStorage } = await import("/outboxStorage.ts");
          const { idbTransaction } = await import("/idbPremature.ts");
          const probe = outboxIdbFault(), storage = browserOutboxStorage(probe.factory);
          try {
            await storage.put(entry);
            const db = await new Promise((resolve, reject) => {
              const request = probe.factory.open("kub-outbox", 1);
              request.onsuccess = () => resolve(request.result); request.onerror = () => reject(Error("OPEN_FAILED"));
            });
            probe.arm(); let rejected = false;
            try { await idbTransaction(db, "entries", "readwrite", store => store.delete(entry.clientMessageId)); } catch { rejected = true; }
            await probe.idle(); const retained = (await storage.list(entry.userId)).length;
            await storage.remove(entry.clientMessageId);
            return { rejected, retained, aborts: probe.aborts };
          } finally { await probe.idle(); probe.close(); }
        }, entry);
        assert.deepEqual(omitted, { rejected: false, retained: 1, aborts: 1 }, "premature request ACK must reproduce the real aborted-TX failure");
        assert.throws(() => assert.equal(omitted.rejected, true), { code: "ERR_ASSERTION", expected: true, actual: false });
      }
    } finally { await context.close(); }
  });
}
