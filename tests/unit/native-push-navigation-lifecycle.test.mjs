import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parseMessageNotificationProjection } from "../../artifacts/kub/src/lib/messageNotificationProjection.ts";
import { isReservedNativeVoiceData } from "../../artifacts/kub/src/lib/platform/nativeVoiceContract.ts";

const source = readFileSync(new URL("../../artifacts/kub/src/lib/platform/nativePush.ts", import.meta.url), "utf8");
const CHAT = "6f9f45a8-1de9-475e-82df-d16e39b9df7b";
const MESSAGE = "4e3468a1-61d3-4c70-b67d-3d8f045b87bf";
const ROUTE = "/?chat=6f9f45a8-1de9-475e-82df-d16e39b9df7b&message=4e3468a1-61d3-4c70-b67d-3d8f045b87bf";
const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture({ program = source, native = true, bridge = true, failFirstSynchronously = false } = {}) {
  const requests = [];
  const routes = [];
  const removals = [];
  const dependencies = {
    "@capacitor/push-notifications": { PushNotifications: {
      addListener(name, listener) {
        if (failFirstSynchronously) throw new Error("fixture bridge unavailable");
        const pending = deferred();
        requests.push({ name, listener, ...pending });
        return pending.promise;
      },
    } },
    "./capabilities": { isNativeAndroid: () => native },
    "../plainMessages": {},
    "../messageNotificationProjection": { parseMessageNotificationProjection },
    "./nativeVoiceContract": { isReservedNativeVoiceData },
    "./nativePushRegistration": {},
    "./nativePushReadSync": {},
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(program, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, URLSearchParams,
    window: bridge ? { androidBridge: { postMessage() {} } } : {},
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return {
    requests, routes, removals,
    register: () => module.exports.registerNativePushNavigationListeners((route) => routes.push(route)),
    resolve(index, { failRemoval = false } = {}) {
      const handle = { remove() {
        removals.push(index);
        if (failRemoval === "throw") throw new Error("fixture synchronous removal refused");
        return failRemoval ? Promise.reject(new Error("fixture removal refused")) : Promise.resolve();
      } };
      requests[index].resolve(handle);
      return handle;
    },
  };
}

async function mounted(options) {
  const f = fixture(options);
  const result = f.register();
  f.resolve(0);
  await settle();
  assert.equal(f.requests[1].name, "pushNotificationActionPerformed");
  f.resolve(1);
  const dispose = await result;
  await settle();
  return { ...f, dispose };
}

test("native registration exposes disposal before a held SDK registration completes", async () => {
  const f = fixture();
  const registration = f.register();
  let dispose;
  void registration.then((value) => { dispose = value; });
  await settle();
  assert.equal(typeof dispose, "function");
  dispose();
  f.resolve(0);
  await settle();
  assert.deepEqual(f.removals, [0]);
  assert.equal(f.requests.length, 1, "A retired first listener must not register another listener");
});

test("native action registration rejection retires the successful first listener", async () => {
  const f = fixture();
  const registration = f.register();
  f.resolve(0);
  await settle();
  f.requests[1].reject(new Error("fixture action registration refused"));
  const dispose = await registration;
  await settle();
  assert.deepEqual(f.removals, [0]);
  dispose();
  assert.deepEqual(f.removals, [0]);
});

test("a retired callback cannot route even if the SDK has not removed it yet", async () => {
  const f = await mounted();
  f.dispose();
  f.requests[1].listener({ notification: { data: { chat_id: CHAT, message_id: MESSAGE } } });
  assert.deepEqual(f.routes, []);
  assert.deepEqual(f.removals, [0, 1]);
});

test("disposing during the second registration also retires its late handle once", async () => {
  const f = fixture();
  const registration = f.register();
  f.resolve(0);
  await settle();
  let dispose;
  void registration.then((value) => { dispose = value; });
  await settle();
  assert.equal(typeof dispose, "function");
  dispose();
  dispose();
  f.requests[1].listener({ notification: { data: { route: ROUTE } } });
  f.resolve(1);
  await settle();
  assert.deepEqual(f.routes, []);
  assert.deepEqual(f.removals, [0, 1]);
});

test("completed native disposal is idempotent", async () => {
  const f = await mounted();
  f.dispose();
  f.dispose();
  assert.deepEqual(f.removals, [0, 1]);
});

test("native removal rejection is contained without reactivating the listener", async () => {
  const f = fixture();
  const registration = f.register();
  f.resolve(0, { failRemoval: true });
  await settle();
  f.resolve(1, { failRemoval: true });
  const dispose = await registration;
  await settle();
  dispose();
  await settle();
  f.requests[1].listener({ notification: { data: { route: ROUTE } } });
  assert.deepEqual(f.routes, []);
  assert.deepEqual(f.removals, [0, 1]);
});

test("active native clicks retain the exact chat and message, without duplicating receive events", async () => {
  const f = await mounted();
  f.requests[0].listener({ data: { chat_id: CHAT, message_id: MESSAGE } });
  assert.deepEqual(f.routes, []);
  f.requests[1].listener({ notification: { data: { chat_id: CHAT, message_id: MESSAGE } } });
  assert.deepEqual(f.routes, [ROUTE]);
  f.dispose();
});

test("voice payloads and absent targets never become chat clicks", async () => {
  const f = await mounted();
  for (const data of [null, {}, { type: "voice_call", route: ROUTE }, { protocol_version: "1", route: ROUTE }, { ring_key: "voice:fixture", route: ROUTE }]) {
    f.requests[1].listener({ notification: { data } });
  }
  assert.deepEqual(f.routes, []);
  f.dispose();
});

test("non-Android and unavailable bridges perform no native registration", async () => {
  for (const options of [{ native: false }, { bridge: false }]) {
    const f = fixture(options);
    const dispose = await f.register();
    dispose();
    assert.equal(f.requests.length, 0);
  }
});

test("first native registration rejection is safely disposable", async () => {
  const f = fixture();
  const registration = f.register();
  f.requests[0].reject(new Error("fixture first registration refused"));
  const dispose = await registration;
  await settle();
  dispose();
  assert.deepEqual(f.removals, []);
  assert.equal(f.requests.length, 1);
});

test("a synchronous bridge failure returns an inert disposer", async () => {
  const f = fixture({ failFirstSynchronously: true });
  const dispose = await f.register();
  await settle();
  dispose();
  assert.equal(f.requests.length, 0);
});

test("one synchronously refused removal does not prevent the other cleanup", async () => {
  const f = fixture();
  const registration = f.register();
  f.resolve(0, { failRemoval: "throw" });
  await settle();
  f.resolve(1);
  const dispose = await registration;
  await settle();
  dispose();
  assert.deepEqual(f.removals, [0, 1]);
  f.requests[1].listener({ notification: { data: { route: ROUTE } } });
  assert.deepEqual(f.routes, []);
});

function mutated(before, after) {
  assert.ok(source.includes(before), "Mutation anchor must still identify the production guard");
  return source.replace(before, after);
}

test("compiled omission of the callback retirement guard is refused", async () => {
  const f = await mounted({ program: mutated("if (disposed) return;\n      const target", "const target") });
  f.dispose();
  f.requests[1].listener({ notification: { data: { route: ROUTE } } });
  assert.throws(() => assert.deepEqual(f.routes, []), assert.AssertionError);
});

test("compiled omission of partial-registration cleanup is refused", async () => {
  const f = fixture({ program: mutated("})().catch(dispose);", "})().catch(() => undefined);") });
  const dispose = await f.register();
  f.resolve(0);
  await settle();
  f.requests[1].reject(new Error("fixture second registration refused"));
  await settle();
  assert.throws(() => assert.deepEqual(f.removals, [0]), assert.AssertionError);
  dispose();
});

test("compiled omission of late-handle disposal is refused", async () => {
  const f = fixture({ program: mutated("if (disposed) { remove(handle); return false; }", "if (disposed) { return false; }") });
  const dispose = await f.register();
  dispose();
  f.resolve(0);
  await settle();
  assert.throws(() => assert.deepEqual(f.removals, [0]), assert.AssertionError);
});

test("compiled continuation after a retired first registration is refused", async () => {
  const f = fixture({ program: mutated("}))) return;", "}))) { /* incorrect continuation */ }") });
  const dispose = await f.register();
  dispose();
  f.resolve(0);
  await settle();
  assert.throws(() => assert.equal(f.requests.length, 1), assert.AssertionError);
  f.resolve(1);
  await settle();
});
