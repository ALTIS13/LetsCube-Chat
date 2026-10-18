// Delegates real IDBFactory/Database/Transaction/Request objects. The only fault
// is native transaction.abort(), after the application's request-success handler.
export function outboxIdbFault({ operation = "delete", armed = false } = {}) {
  const nativeFactory = indexedDB;
  const transactions = [], handles = new Set(), events = [];
  let aborts = 0;
  const delegate = (target, overrides = {}) => new Proxy(target, {
    get(object, key) {
      if (Object.hasOwn(overrides, key)) return overrides[key];
      const value = Reflect.get(object, key, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
    set(object, key, value) { return Reflect.set(object, key, value, object); },
  });
  function wrapTransaction(tx) {
    let finish;
    const record = { operations: [], outcome: null, done: new Promise(resolve => { finish = resolve; }) };
    transactions.push(record);
    for (const outcome of ["complete", "abort"]) tx.addEventListener(outcome, () => {
      record.outcome = outcome; events.push(`tx:${outcome}`); finish();
    }, { once: true });
    const wrapRequest = (request, name) => {
      record.operations.push(name);
      return new Proxy(request, {
        get(target, key) { const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; },
        set(target, key, handler) {
          if (key !== "onsuccess") return Reflect.set(target, key, handler, target);
          target.onsuccess = event => {
            events.push(`${name}:success`); handler.call(target, event); events.push(`${name}:handled`);
            if (armed && name === operation) { armed = false; tx.abort(); aborts += 1; events.push(`${name}:abort-called`); }
          };
          return true;
        },
      });
    };
    const wrapStore = store => delegate(store, {
      ...Object.fromEntries(["put", "delete"].map(name => [name, (...args) => wrapRequest(store[name](...args), name)])),
      index: name => {
        const index = store.index(name);
        return delegate(index, { getAll: (...args) => wrapRequest(index.getAll(...args), "getAll") });
      },
    });
    return delegate(tx, { objectStore: name => wrapStore(tx.objectStore(name)) });
  }
  const factory = delegate(nativeFactory, { open: (...args) => {
    if (args[0] !== "kub-outbox") return nativeFactory.open(...args);
    const request = nativeFactory.open(...args);
    return new Proxy(request, {
      get(target, key) {
        if (key === "result") {
          handles.add(target.result);
          return delegate(target.result, { transaction: (...values) => wrapTransaction(target.result.transaction(...values)) });
        }
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, key, value) { return Reflect.set(target, key, value, target); },
    });
  } });
  return { factory, transactions, events, arm(nextOperation = operation) { operation = nextOperation; armed = true; }, get aborts() { return aborts; },
    async idle() { await Promise.all(transactions.map(tx => tx.done)); },
    close() { for (const handle of handles) handle.close(); } };
}
