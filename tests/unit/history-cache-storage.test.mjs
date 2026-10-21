import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { chromium, webkit } from "@playwright/test";

process.env.KUB_QA_ALLOW_MUTATIONS = "0";
const file = new URL("../../artifacts/kub/src/lib/historyCache/storage.ts", import.meta.url);
const source = existsSync(file) ? readFileSync(file, "utf8") : "export {};";
const compile = text => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const origin = "http://127.0.0.1:18763";
const helper = readFileSync(new URL("../helpers/history-cache-idb.mjs", import.meta.url), "utf8");
const replaceOne = (from, to) => text => {
  assert.equal(text.split(from).length, 2, "mutation must change exactly one loaded source location");
  return text.replace(from, to);
};

function assertPrimaryOwnership(observed, mode) {
  assert.deepEqual(observed, { seedOwned: 1, seedForeign: 6, unreadable: null, allWrites: true,
    ownedCount: { purge: 0, count: 10, bytes: 1 }[mode], bytesWithin: true, hiddenGone: true, foreignPreserved: true });
}

async function fixture(t, engine, body, mutation) {
  const browser = await engine.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  t.after(() => context.close());
  const code = mutation ? mutation(source) : source;
  let unexpected = 0;
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    const modules = { "/storage.js": compile(code), "/helper.js": helper };
    if (url.origin !== origin || (url.pathname !== "/" && !modules[url.pathname])) {
      unexpected++; return route.abort();
    }
    return route.fulfill({ contentType: url.pathname === "/" ? "text/html" : "text/javascript",
      body: url.pathname === "/" ? "<!doctype html><title>Synthetic history storage</title>" : modules[url.pathname] });
  });
  const page = await context.newPage();
  await page.goto(origin);
  // Missing feature is an assertion failure, never an import-resolution error.
  assert.equal(await page.evaluate(async () => typeof (await import("/storage.js")).browserHistoryCacheStorage),
    "function", "received-history IndexedDB storage API is missing");
  await page.evaluate(async () => {
    const { browserHistoryCacheStorage } = await import("/storage.js");
    const { digest, rawRows, holdDigest, historyCacheIdbProbe } = await import("/helper.js");
    Object.assign(globalThis, { make: browserHistoryCacheStorage, digest, rawRows, holdDigest, historyCacheIdbProbe });
  });
  await body(page, context);
  assert.equal(unexpected, 0, "no request may leave the synthetic loopback origin");
}

for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
  test(`${name}: immutable leases, opaque UTF8 persistence across documents and reload`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async (page, context) => {
      const seeded = await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice");
        const payload = "opaque, not JSON: \u041f\u0440\u0438\u0432\u0435\u0442 \ud83d\ude00";
        return { frozen: Object.isFrozen(lease), lease, ok: await storage.write(lease, "chat", { payload, digest: await digest(payload) }, 1000) };
      });
      assert.equal(seeded.frozen, true); assert.equal(seeded.ok, true);
      assert.equal(seeded.lease.namespace, "ns"); assert.equal(seeded.lease.ownerId, "alice");
      assert.match(seeded.lease.generation, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const second = await context.newPage(); await second.goto(origin);
      const read = p => p.evaluate(async () => {
        const { browserHistoryCacheStorage } = await import("/storage.js");
        const storage = browserHistoryCacheStorage();
        return storage.read(await storage.capture("ns", "alice"), "chat", 1001);
      });
      const result = await read(second);
      assert.equal(result.payload, "opaque, not JSON: \u041f\u0440\u0438\u0432\u0435\u0442 \ud83d\ude00");
      assert.match(result.digest, /^[0-9a-f]{64}$/); assert.equal(result.verifiedAt, 1000);
      await page.reload(); assert.deepEqual(await read(page), result);
      assert.equal(await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === "kub-outbox")), false);
    });
  });

  test(`${name}: namespace/owner isolation and delimiter collision-proof keys`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), tuples = [["a:b", "c", "d"], ["a", "b:c", "d"], ["a", "b", "c:d"], ["a", "b", "d"]];
        for (const [i, [ns, owner, scope]] of tuples.entries()) {
          const payload = `synthetic-${i}`;
          await storage.write(await storage.capture(ns, owner), scope, { payload, digest: await digest(payload) }, 1000);
        }
        return { values: await Promise.all(tuples.map(async ([ns, owner, scope]) =>
          (await storage.read(await storage.capture(ns, owner), scope, 1001))?.payload)),
          other: await storage.read(await storage.capture("a", "foreign"), "d", 1001) };
      }), { values: ["synthetic-0", "synthetic-1", "synthetic-2", "synthetic-3"], other: null });
    });
  });

  test(`${name}: second-document invalidate fences held writer and stale reader, retains other scopes`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async (page, context) => {
      await page.evaluate(async () => {
        globalThis.storage = make(); globalThis.lease = await storage.capture("ns", "alice");
        globalThis.value = { payload: "synthetic", digest: await digest("synthetic") };
        await storage.write(lease, "clear", value, 1000); await storage.write(lease, "keep", value, 1000);
        globalThis.hold = await holdDigest(); globalThis.pending = storage.write(lease, "clear", value, 1001);
        await hold.started;
      });
      const second = await context.newPage(); await second.goto(origin);
      await second.evaluate(async () => (await import("/storage.js")).browserHistoryCacheStorage().invalidate("ns", "alice", "clear"));
      assert.deepEqual(await page.evaluate(async () => {
        hold.release(); const written = await pending, fresh = await storage.capture("ns", "alice");
        return { written, advanced: fresh.generation !== lease.generation,
          stale: await storage.read(lease, "keep", 1002), cleared: await storage.read(fresh, "clear", 1002),
          kept: (await storage.read(fresh, "keep", 1002))?.payload };
      }), { written: false, advanced: true, stale: null, cleared: null, kept: "synthetic" });
    });
  });

  test(`${name}: owner clearing includes absent scope invalidation and cannot clear foreign rows`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), v = { payload: "synthetic", digest: await digest("synthetic") };
        const a = await storage.capture("ns", "alice"), b = await storage.capture("ns", "bob"), c = await storage.capture("other", "alice");
        for (const lease of [a, b, c]) for (const scope of ["x", "y"]) await storage.write(lease, scope, v, 1000);
        await storage.invalidate("ns", "alice", "absent");
        const stale = await storage.write(a, "new", v, 1000);
        await storage.invalidate("ns", "alice");
        const fresh = await storage.capture("ns", "alice");
        return { stale, x: await storage.read(fresh, "x", 1001), y: await storage.read(fresh, "y", 1001),
          bob: (await storage.read(b, "x", 1001))?.payload, other: (await storage.read(c, "x", 1001))?.payload };
      }), { stale: false, x: null, y: null, bob: "synthetic", other: "synthetic" });
    });
  });

  test(`${name}: literal ten-scope bound, oldest-write eviction and scope tie break`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice"), v = { payload: "x", digest: await digest("x") };
        for (const scope of ["j", "i", "h", "g", "f", "e", "d", "c", "b", "a"]) await storage.write(lease, scope, v, 1000);
        await storage.read(lease, "a", 1001);
        await storage.write(lease, "k", v, 1001);
        const rows = (await rawRows()).filter(row => typeof row.payload === "string");
        return { count: rows.length, evicted: await storage.read(lease, "a", 1002),
          b: (await storage.read(lease, "b", 1002))?.payload, k: (await storage.read(lease, "k", 1002))?.payload };
      }), { count: 10, evicted: null, b: "x", k: "x" });
    });
  });

  test(`${name}: literal 8MiB UTF8/metadata budget and individual refusal`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice");
        const payload = "\u00e9".repeat(2 * 1024 * 1024), v = { payload, digest: await digest(payload) };
        const first = await storage.write(lease, "a", v, 1000), second = await storage.write(lease, "b", v, 1001);
        const rows = (await rawRows()).filter(row => typeof row.payload === "string");
        const huge = "x".repeat(8 * 1024 * 1024);
        const refused = await storage.write(lease, "huge", { payload: huge, digest: await digest(huge) }, 1002);
        return { first, second, refused, count: rows.length,
          bytesBounded: rows.reduce((sum, row) => sum + new TextEncoder().encode(JSON.stringify(row)).length, 0) <= 8 * 1024 * 1024,
          a: await storage.read(lease, "a", 1003), b: (await storage.read(lease, "b", 1003))?.payload.length };
      }), { first: true, second: true, refused: false, count: 1, bytesBounded: true, a: null, b: 2097152 });
    });
  });

  test(`${name}: literal seven-day WRITE TTL, reads never refresh, expired rows pruned`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice"), v = { payload: "x", digest: await digest("x") };
        await storage.write(lease, "old", v, 1000);
        const before = await storage.read(lease, "old", 604800999);
        const boundary = await storage.read(lease, "old", 604801000);
        await storage.write(lease, "new", v, 604801000);
        return { before: before?.verifiedAt, boundary, count: (await rawRows()).filter(row => typeof row.payload === "string").length };
      }), { before: 1000, boundary: null, count: 1 });
    });
  });

  test(`${name}: clock rollback refuses future rows and writes without refreshing TTL`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice"), v = { payload: "x", digest: await digest("x") };
        await storage.write(lease, "x", v, 2000);
        return { future: await storage.read(lease, "x", 1999), rollback: await storage.write(lease, "x", v, 1999),
          kept: (await storage.read(lease, "x", 2001))?.verifiedAt };
      }), { future: null, rollback: false, kept: 2000 });
    });
  });

  test(`${name}: SHA256 write verification, stored corruption and unavailable crypto refuse`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice"), v = { payload: "abc", digest: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" };
        const wrong = await storage.write(lease, "bad", { ...v, digest: "0".repeat(64) }, 1000);
        const good = await storage.write(lease, "x", v, 1000);
        await rawRows(row => { if (row.payload === "abc") { row.payload = "abd"; return true; } });
        const corrupt = await storage.read(lease, "x", 1001);
        await storage.write(lease, "good", v, 1000);
        const original = crypto.subtle.digest;
        crypto.subtle.digest = () => Promise.reject(Error("synthetic sensitive crypto detail"));
        try { return { wrong, good, corrupt, failedWrite: await storage.write(lease, "fail", v, 1001),
          failedRead: await storage.read(lease, "good", 1001) }; }
        finally { crypto.subtle.digest = original; }
      }), { wrong: false, good: true, corrupt: null, failedWrite: false, failedRead: null });
    });
  });

  test(`${name}: bounded nonempty identifiers, invalid leases/times and no content errors`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      const result = await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice"), v = { payload: "abc", digest: await digest("abc") };
        const bad = ["", " ", "x".repeat(1025), null, 42], outcomes = [];
        for (const input of bad) for (const fn of [() => storage.capture(input, "alice"), () => storage.capture("ns", input),
          () => storage.read(lease, input), () => storage.write(lease, input, v, 1000), () => storage.invalidate("ns", "alice", input)]) {
          try { await fn(); outcomes.push(false); } catch (e) { outcomes.push(/^HISTORY_CACHE_[A-Z_]+$/.test(e.message)); }
        }
        for (const now of [NaN, Infinity, -1, 1.5]) { try { await storage.write(lease, "x", v, now); outcomes.push(false); } catch { outcomes.push(true); } }
        try { await storage.read({ ...lease, generation: -1 }, "x"); outcomes.push(false); } catch { outcomes.push(true); }
        return outcomes;
      });
      assert.equal(result.length, 30); assert.ok(result.every(Boolean));
    });
  });

  test(`${name}: actual request-success abort rejects capture/write/read/invalidate, ACK follows complete`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const probe = historyCacheIdbProbe(), storage = make(probe.factory), v = { payload: "abc", digest: await digest("abc") };
        const errors = [];
        const rejected = async fn => { try { await fn(); return false; } catch (e) { errors.push(e.message); return true; } };
        try {
          probe.arm("put"); const captureAbort = await rejected(() => storage.capture("ns", "alice"));
          const lease = await storage.capture("ns", "alice");
          probe.arm("put"); const writeAbort = await rejected(() => storage.write(lease, "x", v, 1000));
          const phantom = await storage.read(lease, "x", 1001);
          await storage.write(lease, "x", v, 1000); const committed = probe.transactions.at(-1).outcome === "complete";
          probe.arm("get"); const readAbort = await rejected(() => storage.read(lease, "x", 1001));
          probe.arm("delete"); const invalidateAbort = await rejected(() => storage.invalidate("ns", "alice"));
          const retained = (await storage.read(lease, "x", 1001))?.payload;
          await storage.invalidate("ns", "alice"); const invalidationCommitted = probe.transactions.at(-1).outcome === "complete";
          return { captureAbort, writeAbort, phantom, committed, readAbort, invalidateAbort, retained, invalidationCommitted,
            cleanErrors: errors.length === 4 && errors.every(e => /^HISTORY_CACHE_[A-Z_]+$/.test(e)) };
        } finally { await probe.idle(); probe.close(); }
      }), { captureAbort: true, writeAbort: true, phantom: null, committed: true, readAbort: true,
        invalidateAbort: true, retained: "abc", invalidationCommitted: true, cleanErrors: true });
    });
  });

  test(`${name}: unavailable/open failure rejects and never falls back to memory`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const results = [];
        for (const factory of [null, { open() { throw Error("sensitive synthetic detail"); } }]) {
          const storage = make(factory);
          for (const action of [() => storage.capture("ns", "alice"), () => storage.invalidate("ns", "alice"),
            () => storage.read({ namespace: "ns", ownerId: "alice", generation: "11111111-1111-4111-8111-111111111111" }, "x", 1000),
            () => storage.write({ namespace: "ns", ownerId: "alice", generation: "11111111-1111-4111-8111-111111111111" }, "x", { payload: "abc", digest: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" }, 1000)]) {
            try { await action(); results.push(false); } catch (e) { results.push(e.message === "HISTORY_CACHE_STORAGE_UNAVAILABLE"); }
          }
        }
        return results;
      }), Array(8).fill(true));
    });
  });

  test(`${name}: real blocked open rejects, late unblock cannot acknowledge capture`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const blocker = await new Promise(resolve => { const r = indexedDB.open("kub-history-cache", 1); r.onsuccess = () => resolve(r.result); });
        let refused = false;
        const storage = make({ open: name => indexedDB.open(name, 2) });
        try { await storage.capture("ns", "alice"); } catch (e) { refused = /^HISTORY_CACHE_[A-Z_]+$/.test(e.message); }
        finally { blocker.close(); }
        return { refused };
      }), { refused: true });
    });
  });

  test(`${name}: simultaneous documents serialize writes under the ten-row budget`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async (page, context) => {
      const second = await context.newPage(); await second.goto(origin);
      const write = (p, prefix) => p.evaluate(async prefix => {
        const { browserHistoryCacheStorage } = await import("/storage.js");
        const { digest } = await import("/helper.js");
        const storage = browserHistoryCacheStorage(), lease = await storage.capture("ns", "alice");
        const v = { payload: "x", digest: await digest("x") };
        return Promise.all(Array.from({ length: 10 }, (_, i) => storage.write(lease, `${prefix}${i}`, v, 1000)));
      }, prefix);
      await Promise.all([write(page, "a"), write(second, "b")]);
      assert.deepEqual(await page.evaluate(async () => (await rawRows()).filter(row => typeof row.payload === "string")
        .map(row => row.scope).sort()), ["b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9"]);
    });
  });

  test(`${name}: invalidate during read hash refuses the already-read row`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async (page, context) => {
      await page.evaluate(async () => {
        globalThis.storage = make(); globalThis.lease = await storage.capture("ns", "alice");
        await storage.write(lease, "x", { payload: "x", digest: await digest("x") }, 1000);
        globalThis.hold = await holdDigest(); globalThis.pending = storage.read(lease, "x", 1001); await hold.started;
      });
      const second = await context.newPage(); await second.goto(origin);
      await second.evaluate(async () => (await import("/storage.js")).browserHistoryCacheStorage().invalidate("ns", "alice"));
      assert.equal(await page.evaluate(async () => { hold.release(); return pending; }), null);
    });
  });

  test(`${name}: quota throws abort the whole write and scrub errors, retry remains possible`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const probe = historyCacheIdbProbe(), storage = make(probe.factory);
        try {
          const lease = await storage.capture("ns", "alice"), v = { payload: "x", digest: await digest("x") };
          await storage.write(lease, "x", v, 1000);
          probe.quotaOnce(); let error;
          try { await storage.write(lease, "y", v, 1001); } catch (e) { error = e.message; }
          const absent = await storage.read(lease, "y", 1002), retained = (await storage.read(lease, "x", 1002))?.payload;
          return { error, absent, retained, retry: await storage.write(lease, "y", v, 1002) };
        } finally { await probe.idle(); probe.close(); }
      }), { error: "HISTORY_CACHE_STORAGE_UNAVAILABLE", absent: null, retained: "x", retry: true });
    });
  });

  test(`${name}: corrupt row metadata refuses rather than returning invalid timestamps/digests`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice"), v = { payload: "abc", digest: await digest("abc") };
        const values = [];
        for (const patch of [{ verifiedAt: -1 }, { verifiedAt: "1000" }, { verifiedAt: 2000 }, { digest: "bad" }, { payload: null }]) {
          await storage.write(lease, "x", v, 3000);
          await rawRows(row => { if (row.scope === "x") { Object.assign(row, { verifiedAt: 1000 }, patch); return true; } });
          values.push(await storage.read(lease, "x", 1001));
        }
        return values;
      }), [null, null, null, null, null]);
    });
  });

  for (const corruption of ["missing", "wrong"]) for (const mode of ["purge", "count", "bytes"]) {
    test(`${name}: primary-key ownership ${mode} with ${corruption} ownerKey preserves all foreign keys`, { timeout: 30000 }, async t => {
      await fixture(t, engine, async page => {
        const observed = await page.evaluate(async args => (await import("/helper.js")).historyCacheOwnershipProbe(args), { corruption, mode });
        assertPrimaryOwnership(observed, mode);
      });
    });
  }

  test(`${name}: primary-key ownership prunes malformed own rows but never foreign primary keys`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice");
        const value = { payload: "synthetic", digest: await digest("synthetic") };
        await storage.write(lease, "template", value, 1000);
        const template = (await rawRows()).find(row => row.scope === "template");
        const malformed = [
          { key: '["scope","ns","alice",null]', scope: "null" },
          { key: '["scope","ns","alice","extra","tail"]', scope: "extra" },
          { key: '["scope","ns","alice","invalid-json"', scope: "invalid-json" },
          { key: '["scope","ns","alice","\\u0061lias"]', scope: "alias" },
          { key: '["scope","ns","alice","mismatch"]', scope: "mismatch-body" },
        ];
        const malformedKeys = malformed.map(row => row.key);
        const foreignKeys = ['["scope","ns","alice2",null]', '["scope","ns2","alice",null]', '["owner","foreign","owner"]'];
        await rawRows(null, [
          ...malformed.map(row => ({ ...template, ...row, verifiedAt: 9000 })),
          ...foreignKeys.map(key => ({ ...template, key, scope: "foreign-body", verifiedAt: 9000 })),
        ]);
        const before = await rawRows(), written = await storage.write(lease, "new", value, 1001), afterWrite = await rawRows();
        await storage.invalidate("ns", "alice"); const afterPurge = await rawRows();
        return { seededMalformed: before.filter(row => malformedKeys.includes(row.key)).length,
          seededForeign: before.filter(row => foreignKeys.includes(row.key)).length, written,
          remainingMalformed: afterWrite.filter(row => malformedKeys.includes(row.key)).length,
          ownRemaining: afterPurge.filter(row => row.key === template.key || row.scope === "new").length,
          foreignPreserved: JSON.stringify(before.filter(row => foreignKeys.includes(row.key))) === JSON.stringify(afterPurge.filter(row => foreignKeys.includes(row.key))) };
      }), { seededMalformed: 5, seededForeign: 3, written: true, remainingMalformed: 0, ownRemaining: 0, foreignPreserved: true });
    });
  });

  test(`${name}: primary-key ownership index-only negative control fails the positive-calibrated guard`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      const observed = await page.evaluate(async () => (await import("/helper.js")).historyCacheOwnershipProbe({ corruption: "missing", mode: "count" }));
      assert.equal(observed.seedOwned, 1); assert.equal(observed.seedForeign, 6);
      assert.equal(observed.unreadable, null); assert.equal(observed.allWrites, true);
      assert.equal(observed.ownedCount, 11, "loaded index-only enumeration must reproduce the physical leak");
      assert.equal(observed.hiddenGone, false); assert.equal(observed.foreignPreserved, false);
      assert.throws(() => assertPrimaryOwnership(observed, "count"), { code: "ERR_ASSERTION" });
    }, replaceOne("return store.getAll(range) as IDBRequest<ScopeRow[]>;",
      'return store.index("ownerKey").getAll(ownerKey(namespace, ownerId)) as IDBRequest<ScopeRow[]>;'));
  });

  for (const recreate of ["invalidate", "capture"]) {
    test(`${name}: delete/recreate ABA via ${recreate} fences the original held writer`, { timeout: 30000 }, async t => {
      await fixture(t, engine, async (page, context) => {
        const original = await page.evaluate(async () => {
          globalThis.storage = make(); globalThis.lease = await storage.capture("ns", "alice");
          globalThis.value = { payload: "old incarnation", digest: await digest("old incarnation") };
          globalThis.hold = await holdDigest(); globalThis.pending = storage.write(lease, "old", value, 1000);
          await hold.started; return lease.generation;
        });
        const second = await context.newPage(); await second.goto(origin);
        const fresh = await second.evaluate(async recreate => {
          const { deleteHistoryCacheDatabase, digest } = await import("/helper.js");
          const { browserHistoryCacheStorage } = await import("/storage.js");
          await deleteHistoryCacheDatabase();
          const storage = browserHistoryCacheStorage();
          if (recreate === "invalidate") await storage.invalidate("ns", "alice");
          const lease = await storage.capture("ns", "alice");
          return { generation: lease.generation,
            written: await storage.write(lease, "fresh", { payload: "new incarnation", digest: await digest("new incarnation") }, 1000) };
        }, recreate);
        const observed = await page.evaluate(async () => {
          hold.release(); const written = await pending, fresh = await storage.capture("ns", "alice");
          return { written, staleRead: await storage.read(lease, "fresh", 1001), old: await storage.read(fresh, "old", 1001),
            fresh: (await storage.read(fresh, "fresh", 1001))?.payload };
        });
        assert.equal(fresh.written, true, "replacement owner is a real committed positive control");
        assert.deepEqual(observed, { written: false, staleRead: null, old: null, fresh: "new incarnation" });
        assert.notEqual(fresh.generation, original, "a deleted DB cannot reuse an old owner incarnation");
      });
    });
  }

  test(`${name}: delete/recreate ABA refuses the original held read snapshot`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async (page, context) => {
      await page.evaluate(async () => {
        globalThis.storage = make(); globalThis.lease = await storage.capture("ns", "alice");
        await storage.write(lease, "x", { payload: "old incarnation", digest: await digest("old incarnation") }, 1000);
        globalThis.hold = await holdDigest(); globalThis.pending = storage.read(lease, "x", 1001); await hold.started;
      });
      const second = await context.newPage(); await second.goto(origin);
      assert.equal(await second.evaluate(async () => {
        const { deleteHistoryCacheDatabase, digest } = await import("/helper.js");
        const { browserHistoryCacheStorage } = await import("/storage.js");
        await deleteHistoryCacheDatabase();
        const storage = browserHistoryCacheStorage(); await storage.invalidate("ns", "alice");
        return storage.write(await storage.capture("ns", "alice"), "x", { payload: "new incarnation", digest: await digest("new incarnation") }, 1000);
      }), true);
      assert.equal(await page.evaluate(async () => { hold.release(); return pending; }), null);
    });
  });

  test(`${name}: mutable lease snapshot cannot adopt a fresh generation during held write`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), original = await storage.capture("ns", "alice"), lease = { ...original };
        const value = { payload: "before invalidation", digest: await digest("before invalidation") };
        const hold = await holdDigest(), pending = storage.write(lease, "x", value, 1000); await hold.started;
        await storage.invalidate("ns", "alice"); const fresh = await storage.capture("ns", "alice");
        Object.assign(lease, fresh); value.payload = "changed input"; value.digest = "0".repeat(64);
        hold.release();
        return { written: await pending, stored: await storage.read(fresh, "x", 1001), stale: await storage.read(original, "x", 1001) };
      }), { written: false, stored: null, stale: null });
    });
  });

  test(`${name}: mutable lease snapshot cannot rebind a held read to a foreign owner`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), alice = await storage.capture("ns", "alice"), bob = await storage.capture("other", "bob");
        const value = { payload: "alice snapshot", digest: await digest("alice snapshot") };
        await storage.write(alice, "x", value, 1000);
        const lease = { ...alice }, hold = await holdDigest(), pending = storage.read(lease, "x", 1001); await hold.started;
        await storage.invalidate("ns", "alice"); Object.assign(lease, bob); hold.release();
        return { read: await pending, bob: await storage.read(bob, "x", 1001) };
      }), { read: null, bob: null });
    });
  });

  test(`${name}: mutable lease and payload changes preserve the original uninvalidated write inputs`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), original = await storage.capture("ns", "alice"), lease = { ...original };
        const value = { payload: "original input", digest: await digest("original input") };
        const hold = await holdDigest(), pending = storage.write(lease, "x", value, 1000); await hold.started;
        Object.assign(lease, { namespace: "foreign", ownerId: "bob", generation: "changed" });
        value.payload = "changed input"; value.digest = "0".repeat(64); hold.release();
        return { written: await pending, stored: (await storage.read(original, "x", 1001))?.payload,
          foreign: await storage.read(await storage.capture("foreign", "bob"), "x", 1001) };
      }), { written: true, stored: "original input", foreign: null });
    });
  });

  test(`${name}: UUID entropy failure rejects owner creation/invalidation without losing rows`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice");
        await storage.write(lease, "x", { payload: "retained", digest: await digest("retained") }, 1000);
        const original = crypto.randomUUID;
        crypto.randomUUID = () => { throw Error("synthetic sensitive entropy detail"); };
        const errors = [];
        try {
          for (const fn of [() => storage.capture("ns", "new"), () => storage.invalidate("ns", "alice")]) {
            try { await fn(); errors.push(null); } catch (e) { errors.push(e.message); }
          }
        } finally { crypto.randomUUID = original; }
        return { errors, retained: (await storage.read(lease, "x", 1001))?.payload };
      }), { errors: ["HISTORY_CACHE_STORAGE_UNAVAILABLE", "HISTORY_CACHE_STORAGE_UNAVAILABLE"], retained: "retained" });
    });
  });

  test(`${name}: loaded negative control repeats incarnation UUID and the real delete/recreate guard catches ABA`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async (page, context) => {
      await page.evaluate(async () => {
        globalThis.storage = make(); globalThis.lease = await storage.capture("ns", "alice");
        const value = { payload: "old incarnation", digest: await digest("old incarnation") };
        globalThis.hold = await holdDigest(); globalThis.pending = storage.write(lease, "x", value, 1000); await hold.started;
      });
      const second = await context.newPage(); await second.goto(origin);
      await second.evaluate(async () => {
        const { deleteHistoryCacheDatabase } = await import("/helper.js");
        const { browserHistoryCacheStorage } = await import("/storage.js");
        await deleteHistoryCacheDatabase(); await browserHistoryCacheStorage().invalidate("ns", "alice");
      });
      const written = await page.evaluate(async () => { hold.release(); return pending; });
      assert.equal(written, true, "the loaded repeated-token mutant must reproduce the ABA resurrection");
      assert.throws(() => assert.equal(written, false), { code: "ERR_ASSERTION" });
    }, replaceOne("const token = globalThis.crypto.randomUUID();", 'const token = "00000000-0000-4000-8000-000000000000";'));
  });

  test(`${name}: loaded negative control omits lease scalar snapshot and held mutation guard catches it`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      const written = await page.evaluate(async () => {
        const storage = make(), lease = { ...await storage.capture("ns", "alice") };
        const value = { payload: "old admission", digest: await digest("old admission") };
        const hold = await holdDigest(), pending = storage.write(lease, "x", value, 1000); await hold.started;
        await storage.invalidate("ns", "alice"); Object.assign(lease, await storage.capture("ns", "alice"));
        hold.release(); return pending;
      });
      assert.equal(written, true, "the loaded missing-snapshot mutant must adopt the caller's fresh generation");
      assert.throws(() => assert.equal(written, false), { code: "ERR_ASSERTION" });
    }, replaceOne("return { namespace, ownerId, generation };", "return lease;"));
  });

  test(`${name}: loaded negative control removes generation fence and is caught`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      const observed = await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice");
        await storage.invalidate("ns", "alice");
        return storage.write(lease, "x", { payload: "x", digest: await digest("x") }, 1000);
      });
      assert.equal(observed, true, "loaded omission must actually resurrect a stale writer");
      assert.throws(() => assert.equal(observed, false), { code: "ERR_ASSERTION" });
    }, replaceOne("if (!ownerRow || generation(ownerRow) !== lease.generation) { set(false); return; }",
      "if (!ownerRow) { set(false); return; }"));
  });

  test(`${name}: loaded negative control acknowledges before commit and is caught by real abort`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      const observed = await page.evaluate(async () => {
        const probe = historyCacheIdbProbe(), storage = make(probe.factory);
        try {
          const lease = await storage.capture("ns", "alice"); await probe.idle();
          probe.arm("put"); let acknowledged = false;
          try { acknowledged = await storage.write(lease, "x", { payload: "x", digest: await digest("x") }, 1000); } catch { /* Proper implementation refuses. */ }
          await probe.idle();
          return { acknowledged, outcome: probe.transactions.at(-1).outcome };
        } finally { probe.close(); }
      });
      assert.deepEqual(observed, { acknowledged: true, outcome: "abort" });
      assert.throws(() => assert.equal(observed.acknowledged, false), { code: "ERR_ASSERTION" });
    }, replaceOne("next => { value = next; }", "next => { value = next; resolve(value); }"));
  });

  test(`${name}: loaded negative control bypasses SHA256 and corruption guards catch it`, { timeout: 30000 }, async t => {
    await fixture(t, engine, async page => {
      const observed = await page.evaluate(async () => {
        const storage = make(), lease = await storage.capture("ns", "alice");
        const wrong = await storage.write(lease, "x", { payload: "abc", digest: "0".repeat(64) }, 1000);
        await rawRows(row => { if (row.scope === "x") { row.payload = "abd"; return true; } });
        return { wrong, read: (await storage.read(lease, "x", 1001))?.payload };
      });
      assert.deepEqual(observed, { wrong: true, read: "abd" });
      assert.throws(() => assert.equal(observed.wrong, false), { code: "ERR_ASSERTION" });
      assert.throws(() => assert.equal(observed.read, null), { code: "ERR_ASSERTION" });
    }, replaceOne("return actual === digest;", "return true;"));
  });

  for (const [label, from, to, probe] of [
    ["ten scopes", "const MAX_SCOPES = 10;", "const MAX_SCOPES = 11;", async () => {
      const storage = make(), lease = await storage.capture("ns", "alice"), v = { payload: "x", digest: await digest("x") };
      for (let i = 0; i < 11; i++) await storage.write(lease, `s${i}`, v, 1000);
      return (await rawRows()).filter(row => typeof row.payload === "string").length === 10;
    }],
    ["8MiB", "const MAX_BYTES = 8 * 1024 * 1024;", "const MAX_BYTES = 9 * 1024 * 1024;", async () => {
      const storage = make(), lease = await storage.capture("ns", "alice"), payload = "x".repeat(8 * 1024 * 1024);
      return await storage.write(lease, "x", { payload, digest: await digest(payload) }, 1000) === false;
    }],
    ["seven days", "const TTL_MS = 7 * 24 * 60 * 60 * 1000;", "const TTL_MS = 8 * 24 * 60 * 60 * 1000;", async () => {
      const storage = make(), lease = await storage.capture("ns", "alice");
      await storage.write(lease, "x", { payload: "x", digest: await digest("x") }, 1000);
      return await storage.read(lease, "x", 604801000) === null;
    }],
  ]) {
    test(`${name}: loaded negative control widens ${label} and literal guard catches it`, { timeout: 30000 }, async t => {
      await fixture(t, engine, async page => {
        const guarded = await page.evaluate(probe);
        assert.equal(guarded, false, "loaded mutated limit must violate the literal acceptance guard");
        assert.throws(() => assert.equal(guarded, true), { code: "ERR_ASSERTION" });
      }, replaceOne(from, to));
    });
  }
}
