// Faults delegate to real IndexedDB; abort happens after the request handler.
export function historyCacheIdbProbe() {
  const handles = new Set(), transactions = [];
  let armed = null, quota = false;
  const proxy = (target, overrides = {}) => new Proxy(target, {
    get(object, key) {
      if (Object.hasOwn(overrides, key)) return overrides[key];
      const value = Reflect.get(object, key, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
    set(object, key, value) { return Reflect.set(object, key, value, object); },
  });
  const wrapTx = tx => {
    let finish;
    const record = { outcome: null, done: new Promise(resolve => { finish = resolve; }) };
    transactions.push(record);
    for (const outcome of ["complete", "abort"]) tx.addEventListener(outcome, () => {
      record.outcome = outcome; finish();
    }, { once: true });
    const request = (req, operation) => {
      const abort = () => { if (armed === operation) { armed = null; tx.abort(); } };
      req.onsuccess = abort;
      return new Proxy(req, {
        get(target, key) { return Reflect.get(target, key, target); },
        set(target, key, handler) {
          if (key !== "onsuccess") return Reflect.set(target, key, handler, target);
          target.onsuccess = event => {
            handler.call(target, event);
            abort();
          };
          return true;
        },
      });
    };
    const wrapStore = store => proxy(store, {
      ...Object.fromEntries(["get", "getAll", "put", "delete"].map(op => [op, (...args) => {
        if (op === "put" && quota) { quota = false; throw new DOMException("synthetic sensitive quota detail", "QuotaExceededError"); }
        return request(store[op](...args), op);
      }])),
      index: name => {
        const index = store.index(name);
        return proxy(index, { getAll: (...args) => request(index.getAll(...args), "getAll") });
      },
    });
    return proxy(tx, { objectStore: name => wrapStore(tx.objectStore(name)) });
  };
  const factory = proxy(indexedDB, { open: (...args) => {
    const req = indexedDB.open(...args);
    return proxy(req, { get result() {
      handles.add(req.result);
      return proxy(req.result, { transaction: (...args) => wrapTx(req.result.transaction(...args)) });
    } });
  } });
  return { factory, transactions, arm(operation) { armed = operation; },
    quotaOnce() { quota = true; },
    async idle() { await Promise.all(transactions.map(tx => tx.done)); },
    close() { for (const db of handles) db.close(); } };
}

export async function digest(payload) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("");
}

export async function rawRows(edit, extraRows = []) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("kub-history-cache");
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(Error("FIXTURE_OPEN"));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([...db.objectStoreNames], edit || extraRows.length ? "readwrite" : "readonly");
      const store = tx.objectStore(db.objectStoreNames[0]);
      let rows;
      tx.oncomplete = () => resolve(rows); tx.onabort = tx.onerror = () => reject(Error("FIXTURE_TX"));
      const req = store.getAll();
      req.onsuccess = () => {
        rows = req.result;
        if (edit) for (const row of rows) { if (edit(row)) store.put(row); }
        for (const row of extraRows) store.put(row);
      };
    });
  } finally { db.close(); }
}

export async function holdDigest() {
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  crypto.subtle.digest = async (...args) => { entered(); await held; return original(...args); };
  return { started, release() { crypto.subtle.digest = original; release(); } };
}

export function deleteHistoryCacheDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("kub-history-cache");
    request.onsuccess = () => resolve();
    request.onerror = request.onblocked = () => reject(Error("FIXTURE_DELETE_DATABASE_FAILED"));
  });
}

export async function historyCacheOwnershipProbe({ corruption, mode }) {
  const { browserHistoryCacheStorage } = await import("/storage.js");
  const storage = browserHistoryCacheStorage(), namespace = 'ns",x', owner = 'alice\\"]';
  const lease = await storage.capture(namespace, owner);
  const payload = mode === "bytes" ? "\u00e9".repeat(2 * 1024 * 1024) : "owned synthetic";
  const value = { payload, digest: await digest(payload) }, writes = [];
  writes.push(await storage.write(lease, "hidden", value, 1000));
  const foreign = [[namespace, owner + "x"], [namespace + "x", owner], ["ns", "alice"]];
  const foreignKeys = new Set();
  for (const [ns, id] of foreign) {
    const foreignLease = await storage.capture(ns, id);
    writes.push(await storage.write(foreignLease, "foreign", { payload: "foreign synthetic", digest: await digest("foreign synthetic") }, 1000));
    foreignKeys.add(JSON.stringify(["scope", ns, id, "foreign"]));
    foreignKeys.add(JSON.stringify(["owner", ns, id]));
  }
  const hiddenKey = JSON.stringify(["scope", namespace, owner, "hidden"]);
  await rawRows(row => {
    if (row.key === hiddenKey) {
      if (corruption === "missing") delete row.ownerKey;
      else row.ownerKey = JSON.stringify(["owner", "wrong", "owner"]);
      return true;
    }
    if (foreignKeys.has(row.key)) { row.ownerKey = JSON.stringify(["owner", namespace, owner]); return true; }
  });
  const owned = rows => rows.filter(row => {
    try {
      const key = JSON.parse(row.key);
      return key[0] === "scope" && key[1] === namespace && key[2] === owner;
    } catch { return false; }
  });
  const before = await rawRows(), unreadable = await storage.read(lease, "hidden", 1001);
  if (mode === "purge") await storage.invalidate(namespace, owner);
  else if (mode === "count") {
    const small = { payload: "new synthetic", digest: await digest("new synthetic") };
    for (let i = 0; i < 10; i++) writes.push(await storage.write(lease, `new-${i}`, small, 1001));
  } else {
    writes.push(await storage.write(lease, "new-a", value, 1001));
    writes.push(await storage.write(lease, "new-b", value, 1002));
  }
  const after = await rawRows(), ownedAfter = owned(after);
  return { seedOwned: owned(before).length, seedForeign: before.filter(row => foreignKeys.has(row.key)).length,
    unreadable, allWrites: writes.every(Boolean), ownedCount: ownedAfter.length,
    bytesWithin: ownedAfter.reduce((sum, row) => sum + new TextEncoder().encode(JSON.stringify(row)).byteLength, 0) <= 8 * 1024 * 1024,
    hiddenGone: !after.some(row => row.key === hiddenKey),
    foreignPreserved: JSON.stringify(after.filter(row => foreignKeys.has(row.key))) === JSON.stringify(before.filter(row => foreignKeys.has(row.key))) };
}
