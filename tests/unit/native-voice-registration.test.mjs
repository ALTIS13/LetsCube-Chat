import assert from "node:assert/strict";
import test from "node:test";

const source = await import("../../artifacts/kub/src/lib/platform/nativePushRegistration.ts").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const defer = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { resolve, promise }; };
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function harness(late = false) {
  assert.equal(typeof source.waitForNativePushRegistration, "function");
  const callbacks = {}, handles = {}, removed = [], calls = [];
  let timeout;
  const plugin = {
    addListener(name, callback) {
      callbacks[name] = callback;
      const handle = { remove: async () => { removed.push(name); } };
      handles[name] = defer();
      if (!late) handles[name].resolve(handle);
      handles[name].handle = handle;
      return handles[name].promise;
    },
    register: async () => { calls.push("register"); },
  };
  const options = {
    schedule: (callback) => { timeout = callback; return 1; },
    cancel: () => calls.push("cancelTimer"),
    onError: () => ({ status: "native_error", message: "safe" }),
  };
  return { plugin, options, callbacks, handles, removed, calls, timeout: () => timeout() };
}

test("registration timeout removes late-installed handles and never starts register afterwards", async () => {
  const h = harness(true); let registrations = 0;
  const operation = source.waitForNativePushRegistration(h.plugin, async () => { registrations++; }, h.options);
  h.timeout(); assert.equal((await operation).status, "native_setup_missing");
  for (const handle of Object.values(h.handles)) handle.resolve(handle.handle);
  await tick();
  await h.callbacks.registration({ value: "synthetic" });
  assert.equal(registrations, 0); assert.equal(h.calls.includes("register"), false);
  assert.deepEqual(h.removed.sort(), ["registration", "registrationError"]);
});

test("registration success removes both handles and duplicate callback does not invoke backend twice", async () => {
  const h = harness(); let count = 0; const pending = defer();
  const operation = source.waitForNativePushRegistration(h.plugin, async () => { count++; await pending.promise; }, h.options);
  await tick();
  const first = h.callbacks.registration({ value: "synthetic" });
  await h.callbacks.registration({ value: "synthetic" });
  pending.resolve(); await first;
  assert.equal((await operation).status, "native_active"); assert.equal(count, 1);
  assert.deepEqual(h.removed.sort(), ["registration", "registrationError"]);
});

test("one rejected addListener still removes its successful sibling", async () => {
  const h = harness(true);
  const original = h.plugin.addListener;
  h.plugin.addListener = (name, callback) => name === "registrationError" ? Promise.reject(new Error("synthetic")) : original(name, callback);
  const operation = source.waitForNativePushRegistration(h.plugin, async () => {}, h.options);
  assert.equal((await operation).status, "native_error");
  h.handles.registration.resolve(h.handles.registration.handle); await tick();
  assert.deepEqual(h.removed, ["registration"]);
});

test("backend finishing after timeout cannot report active or leave listeners", async () => {
  const h = harness(); const pending = defer();
  const operation = source.waitForNativePushRegistration(h.plugin, () => pending.promise, h.options);
  await tick(); const callback = h.callbacks.registration({ value: "synthetic" });
  h.timeout(); pending.resolve(null); await callback;
  assert.equal((await operation).status, "native_setup_missing"); assert.equal(h.removed.length, 2);
});
