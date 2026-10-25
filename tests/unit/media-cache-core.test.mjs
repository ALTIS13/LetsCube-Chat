import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { chromium, webkit } from "@playwright/test";

process.env.KUB_QA_ALLOW_MUTATIONS = "0";
const root = new URL("../../artifacts/kub/src/lib/mediaCache/", import.meta.url);
const sources = Object.fromEntries(["cache", "storage"].map(name => {
  const file = new URL(name + ".ts", root);
  return [name, existsSync(file) ? readFileSync(file, "utf8") : "export {};" ];
}));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022,
} }).outputText;
const origin = "http://127.0.0.1:18764";
const engines = [["Chromium", chromium], ["WebKit", webkit]];
const browsers = new Map();
const faults = readFileSync(new URL("../helpers/history-cache-idb.mjs", import.meta.url), "utf8");
test.before(async () => { for (const [name, engine] of engines) browsers.set(name, await engine.launch({ headless: true })); });
test.after(async () => { for (const browser of browsers.values()) await browser.close(); });

async function fixture(t, name, body, mutate = value => value) {
  const context = await browsers.get(name).newContext({ serviceWorkers: "block" });
  t.after(() => context.close());
  let unexpected = 0;
  const loaded = mutate({ ...sources });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    const modules = { "/storage": compile(loaded.storage), "/cache.js": compile(loaded.cache), "/faults.js": faults };
    if (url.origin !== origin || (url.pathname !== "/" && !modules[url.pathname])) { unexpected++; return route.abort(); }
    return route.fulfill({ contentType: url.pathname === "/" ? "text/html" : "text/javascript",
      body: url.pathname === "/" ? "<!doctype html><title>Synthetic media cache</title>" : modules[url.pathname] });
  });
  const init = async page => {
    await page.goto(origin);
    assert.equal(await page.evaluate(async () => typeof (await import("/cache.js")).createMediaCache), "function", "media-cache core API is missing");
    await page.evaluate(async () => {
      const { createMediaCache } = await import("/cache.js");
      const { browserMediaCacheStorage } = await import("/storage");
      const { holdDigest, historyCacheIdbProbe } = await import("/faults.js");
      window.clock = 1000;
      window.scope = { partition: "backend|alice|session-a", chatId: "chat-a", bucket: "chat-media", path: "chat-a/file.bin" };
      window.storage = browserMediaCacheStorage();
      window.make = (store = storage) => createMediaCache({ storage: store, now: () => clock });
      window.cache = make();
      Object.assign(window, { holdDigest, probe: historyCacheIdbProbe, browserMediaCacheStorage });
      window.bytes = (n, type = "application/octet-stream") => new Blob([new Uint8Array(n)], { type });
      window.raw = async (names, action) => {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open("kub-media-cache"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(Error("FIXTURE_OPEN")); });
        try { return await new Promise((resolve, reject) => {
          const tx = db.transaction(names, "readwrite"); let result;
          tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(Error("FIXTURE_TX"));
          action(tx, value => { result = value; });
        }); } finally { db.close(); }
      };
    });
  };
  const page = await context.newPage(); await init(page);
  await body(page, context, init);
  assert.equal(unexpected, 0, "core cannot send network requests");
}

for (const [name] of engines) {
  test(`${name}: native IndexedDB binary commit control`, { timeout: 15000 }, async t => {
    await fixture(t, name, async page => {
      const result = await page.evaluate(() => new Promise(resolve => {
        const began = performance.now(), request = indexedDB.open("synthetic-native-blob-control", 1);
        const timer = setTimeout(() => resolve({ open: false, elapsed: Math.round(performance.now() - began), uuid: typeof crypto.randomUUID }), 6000);
        request.onupgradeneeded = () => request.result.createObjectStore("bodies");
        request.onerror = () => { clearTimeout(timer); resolve({ open: false, error: request.error?.name }); };
        request.onsuccess = async () => {
          const db = request.result;
          const write = value => new Promise(done => {
            const tx = db.transaction("bodies", "readwrite");
            tx.oncomplete = () => done(true); tx.onabort = () => done(false);
            tx.objectStore("bodies").put(value, "one");
          });
          const committed = await write(new Uint8Array([1, 2, 3]).buffer);
          const blobCommitted = await write(new Blob(["synthetic"], { type: "text/plain" }));
          clearTimeout(timer); db.close(); resolve({ committed, blobCommitted });
        };
      }));
      t.diagnostic(JSON.stringify(result));
      assert.equal(result.committed, true);
      assert.equal(result.error, undefined);
    });
  });
  test(`${name}: basic Blob persistence, version and owner partition isolation`, { timeout: 15000 }, async t => {
    await fixture(t, name, async (page, context, init) => {
      assert.deepEqual(await page.evaluate(async () => {
        const ok = await cache.put(scope, new Blob(["synthetic"], { type: "text/plain" }));
        return { ok, text: await (await cache.get(scope))?.text(), missingVersion: await cache.get({ ...scope, version: "v2" }),
          foreign: await cache.get({ ...scope, partition: "backend|bob|session-a" }), stats: await cache.stats(scope.partition) };
      }), { ok: true, text: "synthetic", missingVersion: null, foreign: null, stats: { bytes: 9, count: 1, limitBytes: 134217728 } });
      const second = await context.newPage(); await init(second);
      assert.equal(await second.evaluate(async () => (await cache.get(scope))?.text()), "synthetic");
      await page.reload(); await init(page);
      assert.equal(await page.evaluate(async () => (await cache.get(scope))?.text()), "synthetic");
    });
  });

  test(`${name}: retire synchronously fences a pending local put before hash completes`, { timeout: 15000 }, async t => {
    await fixture(t, name, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const held = await holdDigest(); const writing = cache.put(scope, bytes(8)); await held.started;
        const retirement = cache.retire(scope.partition, scope.chatId); held.release();
        const ok = await writing; await retirement;
        return { ok, read: await cache.get(scope), stats: await cache.stats(scope.partition), fresh: await cache.put(scope, bytes(9)) };
      }), { ok: false, read: null, stats: { bytes: 0, count: 0, limitBytes: 134217728 }, fresh: true });
    });
  });

  test(`${name}: second-document clear fences pending put and hashed get durably`, { timeout: 15000 }, async t => {
    await fixture(t, name, async (page, context, init) => {
      const second = await context.newPage(); await init(second);
      await page.evaluate(async () => {
        await cache.put(scope, bytes(11)); window.held = await holdDigest();
        window.reading = cache.get(scope); await held.started;
      });
      await second.evaluate(() => cache.retire(scope.partition));
      assert.equal(await page.evaluate(async () => { held.release(); return await reading; }), null);
      await page.evaluate(async () => {
        window.held = await holdDigest(); window.writing = cache.put(scope, bytes(13)); await held.started;
      });
      await second.evaluate(() => cache.retire(scope.partition, scope.chatId));
      assert.deepEqual(await page.evaluate(async () => { held.release(); return { ok: await writing, read: await cache.get(scope) }; }), { ok: false, read: null });
      await second.reload(); await init(second);
      assert.deepEqual(await second.evaluate(() => cache.stats(scope.partition)), { bytes: 0, count: 0, limitBytes: 134217728 });
    });
  });

  test(`${name}: prepared producer cannot resurrect a download completed after second-document clear`, { timeout: 15000 }, async t => {
    await fixture(t, name, async (page, context, init) => {
      const second = await context.newPage(); await init(second);
      for (const all of [false, true]) {
        await page.evaluate(async () => {
          // Model the old post-download put on the shipped API for a genuine RED.
          window.producer = cache.prepare ? await cache.prepare(scope) : { put: blob => cache.put(scope, blob) };
        });
        await second.evaluate(all => cache.retire(scope.partition, all ? undefined : scope.chatId), all);
        assert.deepEqual(await page.evaluate(async () => ({
          stale: await producer.put(bytes(7)), read: await cache.get(scope), stats: await cache.stats(scope.partition),
        })), { stale: false, read: null, stats: { bytes: 0, count: 0, limitBytes: 134217728 } });
        assert.equal(await page.evaluate(async () => {
          const fresh = await cache.prepare(scope); return fresh !== null && await fresh.put(bytes(9));
        }), true, "a new admitted producer after clear can still cache fresh bytes");
      }
    });
  });

  test(`${name}: prepared producer snapshots scope and local chat retirement leaves another producer valid`, { timeout: 15000 }, async t => {
    await fixture(t, name, async page => {
      assert.equal(await page.evaluate(() => typeof cache.prepare), "function");
      assert.deepEqual(await page.evaluate(async () => {
        const input = { ...scope }, old = await cache.prepare(input), otherScope = { ...scope, chatId: "chat-b" };
        const other = await cache.prepare(otherScope); input.path = "chat-a/changed.bin";
        const original = await old.put(bytes(3));
        const redirected = await cache.get(input);
        await cache.retire(scope.partition, scope.chatId);
        return { original, redirected, old: await old.put(bytes(5)), other: await other.put(bytes(7)),
          otherRead: (await cache.get(otherScope))?.size };
      }), { original: true, redirected: null, old: false, other: true, otherRead: 7 });
    });
  });

  test(`${name}: chat-only retirement keeps another chat and partition`, { timeout: 15000 }, async t => {
    await fixture(t, name, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const otherChat = { ...scope, chatId: "chat-b" }, otherOwner = { ...scope, partition: "bob" };
        await cache.put(scope, bytes(5)); await cache.put(otherChat, bytes(7)); await cache.put(otherOwner, bytes(9));
        await cache.retire(scope.partition, scope.chatId);
        return { own: await cache.get(scope), chat: (await cache.get(otherChat))?.size, owner: (await cache.get(otherOwner))?.size };
      }), { own: null, chat: 7, owner: 9 });
    });
  });

  test(`${name}: literal seven-day TTL is not extended by LRU reads`, { timeout: 15000 }, async t => {
    await fixture(t, name, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        await cache.put(scope, bytes(7)); clock = 604800999;
        const before = (await cache.get(scope))?.size; clock = 604801000;
        return { before, after: await cache.get(scope), stats: await cache.stats(scope.partition) };
      }), { before: 7, after: null, stats: { bytes: 0, count: 0, limitBytes: 134217728 } });
    });
  });

  test(`${name}: corruption, MIME and scope validation fail soft without storing URLs`, { timeout: 15000 }, async t => {
    await fixture(t, name, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const rejected = [];
        for (const changed of [{ partition: "" }, { chatId: "" }, { bucket: "https://wrong.invalid" }, { path: "https://wrong.invalid/a?token=x" },
          { path: "a/../b" }, { path: "a/%2e%2e/b" }, { path: "a?token=x" }, { version: "" }]) rejected.push(await cache.put({ ...scope, ...changed }, bytes(1)));
        rejected.push(await cache.put(scope, bytes(1, "")));
        await cache.put(scope, bytes(5));
        await raw(["bodies"], (tx, set) => { const store = tx.objectStore("bodies"), r = store.openCursor(); r.onsuccess = () => { const c = r.result; if (c) { c.update({ ...c.value, data: new Uint8Array(5).fill(1).buffer }); set(true); } }; });
        return { rejected, corrupt: await cache.get(scope) };
      }), { rejected: Array(9).fill(false), corrupt: null });
    });
  });

  test(`${name}: quota and abort after request success never acknowledge an uncommitted write/read`, { timeout: 15000 }, async t => {
    await fixture(t, name, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const faults = probe(), store = browserMediaCacheStorage(faults.factory), local = make(store);
        await local.put(scope, bytes(3));
        faults.quotaOnce();
        const quota = await local.put(scope, bytes(5));
        const kept = (await local.get(scope))?.size;
        faults.arm("put");
        const aborted = await local.put(scope, bytes(7));
        const reading = make({ ...store, confirm(...args) { faults.arm("put"); return store.confirm(...args); } });
        const uncommittedRead = await reading.get(scope);
        const final = (await local.get(scope))?.size;
        const stats = await local.stats(scope.partition); faults.close();
        return { quota, kept, aborted, uncommittedRead, final, stats };
      }), { quota: false, kept: 3, aborted: false, uncommittedRead: null, final: 3, stats: { bytes: 3, count: 1, limitBytes: 134217728 } });
    });
  });

  test(`${name}: metadata account corruption cannot alias or clear a foreign partition`, { timeout: 15000 }, async t => {
    await fixture(t, name, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        const foreign = { ...scope, partition: "backend|bob|session-a" };
        await cache.put(scope, bytes(3)); await cache.put(foreign, bytes(7));
        await raw(["metadata"], (tx, set) => {
          const store = tx.objectStore("metadata"), r = store.openCursor();
          r.onsuccess = () => { const c = r.result; if (!c) return; if (c.value.scope.partition === scope.partition) c.update({ ...c.value, scope: { ...c.value.scope, partition: foreign.partition } }); c.continue(); };
          set(true);
        });
        const corrupt = await cache.get(scope);
        await cache.retire(scope.partition);
        return { corrupt, foreign: (await cache.get(foreign))?.size, ownStats: await cache.stats(scope.partition) };
      }), { corrupt: null, foreign: 7, ownStats: { bytes: 0, count: 0, limitBytes: 134217728 } });
    });
  });

  test(`${name}: retiring before a pending capture resolves fences the local operation`, { timeout: 15000 }, async t => {
    await fixture(t, name, async page => {
      assert.deepEqual(await page.evaluate(async () => {
        let release, entered;
        const began = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
        const local = make({ ...storage, async capture(s) { entered(); await gate; return storage.capture(s); } });
        const writing = local.put(scope, bytes(9)); await began;
        await local.retire(scope.partition); release();
        return { result: await writing, read: await cache.get(scope) };
      }), { result: false, read: null });
    });
  });

  for (const all of [false, true]) test(`${name}: older successful retirement cannot unblock a newer failed ${all ? "partition/chat" : "chat/chat"} retirement`, { timeout: 15000 }, async t => {
    await fixture(t, name, async page => {
      assert.deepEqual(await page.evaluate(async all => {
        let release, calls = 0;
        const gate = new Promise(resolve => { release = resolve; });
        const local = make({ ...storage, async retire(...args) {
          if (++calls === 1) { await gate; return storage.retire(...args); }
          throw Error("SYNTHETIC_UNAVAILABLE");
        } });
        const first = local.retire(scope.partition, all ? undefined : scope.chatId);
        const second = local.retire(scope.partition, scope.chatId).then(() => false, () => true);
        release(); await first; const rejected = await second;
        await cache.put(scope, bytes(5));
        return { rejected, local: await local.get(scope), other: (await cache.get(scope))?.size };
      }, all), { rejected: true, local: null, other: 5 });
    });
  });
}

test("Chromium: bounded unavailable cache never invents stats or reports successful clear", { timeout: 15000 }, async t => {
  await fixture(t, "Chromium", async page => {
    const observed = await page.evaluate(async () => {
      const broken = browserMediaCacheStorage({ open() { return {}; } });
      const local = make(broken), start = performance.now();
      const read = await local.get(scope), elapsed = performance.now() - start;
      const statsError = await local.stats(scope.partition).then(() => null, error => error.message);
      const retireError = await local.retire(scope.partition).then(() => null, error => error.message);
      const blockedPut = await local.put(scope, bytes(5));
      return { read, bounded: elapsed < 2600, statsError, retireError, blockedPut };
    });
    assert.deepEqual(observed, { read: null, bounded: true, statsError: "MEDIA_CACHE_UNAVAILABLE", retireError: "MEDIA_CACHE_UNAVAILABLE", blockedPut: false });
  });
});

test("Chromium: a put that times out during hashing cannot commit when hashing resumes", { timeout: 10000 }, async t => {
  await fixture(t, "Chromium", async page => {
    assert.deepEqual(await page.evaluate(async () => {
      const held = await holdDigest(), writing = cache.put(scope, bytes(7)); await held.started;
      const result = await writing; held.release(); await new Promise(resolve => setTimeout(resolve, 20));
      return { result, stats: await cache.stats(scope.partition) };
    }), { result: false, stats: { bytes: 0, count: 0, limitBytes: 134217728 } });
  });
});

test("Chromium: literal limits, metadata-only LRU and global 256MiB bound", { timeout: 30000 }, async t => {
  await fixture(t, "Chromium", async page => {
    const observed = await page.evaluate(async () => {
      // Any attempt to enumerate binary values during trim is a test failure.
      const getAll = IDBObjectStore.prototype.getAll, openCursor = IDBObjectStore.prototype.openCursor;
      for (const [method, original] of [["getAll", getAll], ["openCursor", openCursor]]) IDBObjectStore.prototype[method] = function(...args) {
        if (this.name === "bodies") throw Error("BINARY_ENUMERATION_FORBIDDEN");
        return original.apply(this, args);
      };
      const selected = [];
      for (const n of [67108864, 134217728, 268435456, 1, 33554432, 134217729]) selected.push(await cache.setLimit(scope.partition, n));
      await cache.setLimit(scope.partition, 67108864);
      const large = bytes(33554432), b = { ...scope, partition: "bob" }, c = { ...scope, partition: "carol" };
      const writes = [];
      for (let i = 0; i < 4; i++) writes.push(await cache.put({ ...b, path: `chat-a/b${i}` }, large));
      for (let i = 0; i < 2; i++) writes.push(await cache.put({ ...c, path: `chat-a/c${i}` }, large));
      for (let i = 0; i < 3; i++) writes.push(await cache.put({ ...scope, path: `chat-a/a${i}` }, large));
      const before = { a: await cache.stats(scope.partition), b: await cache.stats(b.partition), c: await cache.stats(c.partition) };
      // Owner trimming alone fixes both bounds, so it must not also evict Bob.
      writes.push(await cache.put({ ...c, path: "chat-a/c2" }, large));
      const global = { a: await cache.stats(scope.partition), b: await cache.stats(b.partition), c: await cache.stats(c.partition) };
      const tooLarge = await cache.put(scope, bytes(33554433));
      await cache.get({ ...scope, path: "chat-a/a1" });
      writes.push(await cache.put({ ...scope, path: "chat-a/a3" }, large));
      const touched = (await cache.get({ ...scope, path: "chat-a/a1" }))?.size;
      const evicted = await cache.get({ ...scope, path: "chat-a/a2" });
      const reduced = await cache.setLimit(b.partition, 67108864), afterReduction = await cache.stats(b.partition);
      return { selected, writes: writes.every(Boolean), before, global, tooLarge, touched, evicted, reduced, afterReduction };
    });
    assert.deepEqual(observed, { selected: [true, true, true, false, false, false], writes: true,
      before: { a: { bytes: 67108864, count: 2, limitBytes: 67108864 }, b: { bytes: 134217728, count: 4, limitBytes: 134217728 }, c: { bytes: 67108864, count: 2, limitBytes: 134217728 } },
      global: { a: { bytes: 67108864, count: 2, limitBytes: 67108864 }, b: { bytes: 100663296, count: 3, limitBytes: 134217728 }, c: { bytes: 100663296, count: 3, limitBytes: 134217728 } },
      tooLarge: false, touched: 33554432, evicted: null, reduced: true, afterReduction: { bytes: 67108864, count: 2, limitBytes: 67108864 } });
  });
});

const replaceOne = (source, from, to) => {
  assert.equal(source.split(from).length, 2, "loaded omission must change exactly one producer");
  return source.replace(from, to);
};
for (const [name, changes, check] of [
  ["default owner limit", [["storage", "const DEFAULT_LIMIT_BYTES = 128 * 1024 * 1024;", "const DEFAULT_LIMIT_BYTES = 64 * 1024 * 1024;"]], async () =>
    (await cache.stats(scope.partition)).limitBytes === 134217728],
  ["seven-day TTL", [["storage", "const TTL_MS = 7 * 24 * 60 * 60 * 1000;", "const TTL_MS = 8 * 24 * 60 * 60 * 1000;"]], async () => {
    await cache.put(scope, bytes(1)); clock = 604801000; return await cache.get(scope) === null;
  }],
  ["32MiB object bound", [["storage", "const OBJECT_LIMIT_BYTES = 32 * 1024 * 1024;", "const OBJECT_LIMIT_BYTES = 33 * 1024 * 1024;"]], async () =>
    await cache.put(scope, bytes(33554433)) === false],
  ["256MiB global bound", [["storage", "const GLOBAL_LIMIT_BYTES = 256 * 1024 * 1024;", "const GLOBAL_LIMIT_BYTES = 512 * 1024 * 1024;"]], async () => {
    const large = bytes(33554432);
    for (const partition of ["alice", "bob", "carol"]) for (let i = 0; i < 3; i++) {
      if (!await cache.put({ ...scope, partition, path: `chat-a/${i}` }, large)) return true;
    }
    let total = 0; for (const owner of ["alice", "bob", "carol"]) total += (await cache.stats(owner)).bytes;
    return total <= 268435456;
  }],
  ["digest verification", [["cache", "await hash(row.blob) === row.digest", "true"]], async () => {
    await cache.put(scope, bytes(1));
    await raw(["bodies"], (tx, set) => { const r = tx.objectStore("bodies").openCursor(); r.onsuccess = () => { const c = r.result; c.update({ ...c.value, data: new Uint8Array([1]).buffer }); set(true); }; });
    return await cache.get(scope) === null;
  }],
  ["post-hash read generation check", [["cache", "const confirmed = await storage.confirm(lease, row.stamp, now(), valid);", "const confirmed = true;"]], async () => {
    await cache.put(scope, bytes(1)); const held = await holdDigest(), reading = cache.get(scope); await held.started;
    await make().retire(scope.partition); held.release(); return await reading === null;
  }],
  ["durable writer tombstones", [
    ["storage", "owner.generation !== lease.partitionGeneration", "false"],
    ["storage", "chat?.generation === lease.chatGeneration ? owner : null", "owner"],
  ], async () => {
    const held = await holdDigest(), writing = cache.put(scope, bytes(1)); await held.started;
    await make().retire(scope.partition); held.release(); return await writing === false;
  }],
]) test(`Chromium: loaded omission control catches ${name}`, { timeout: 15000 }, async t => {
  await fixture(t, "Chromium", async page => {
    const guarded = await page.evaluate(check);
    assert.equal(guarded, false, "the changed producer must violate the literal acceptance oracle");
    assert.throws(() => assert.equal(guarded, true), { code: "ERR_ASSERTION" });
  }, loaded => {
    for (const [file, from, to] of changes) loaded[file] = replaceOne(loaded[file], from, to);
    return loaded;
  });
});
