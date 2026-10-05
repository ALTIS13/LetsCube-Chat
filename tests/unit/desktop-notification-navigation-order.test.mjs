import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getEventListeners } from "node:events";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../artifacts/kub/src/lib/platform/desktopNotifications.ts", import.meta.url), "utf8");
const A = "/chat/64222222-2222-4222-8222-000000000001/m/64555555-5555-4555-8555-000000000001#details";
const B = "/chat/64222222-2222-4222-8222-000000000002/m/64555555-5555-4555-8555-000000000002#details";
const drain = () => new Promise(setImmediate);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(program = source, { holdStartup = false, singleSlot = false, controlledSlotReads = false } = {}) {
  const window = new EventTarget();
  const startup = deferred();
  if (!holdStartup) startup.resolve(null);
  const reads = [];
  const queued = [];
  const restores = [];
  const effects = [];
  let initial = true;
  let slot = null;
  const bridge = {
    takePendingNotificationRoute() {
      if (controlledSlotReads) {
        const read = deferred(); reads.push(read);
        return read.promise.then(() => { const route = slot; slot = null; return route; });
      }
      if (singleSlot) {
        const take = () => { const route = slot; slot = null; return route; };
        if (initial) { initial = false; return startup.promise.then(take); }
        const read = queued.shift();
        assert.ok(read);
        return read.promise.then(take);
      }
      if (initial) { initial = false; return startup.promise; }
      const read = queued.shift();
      assert.ok(read, "only an emitted notification action may read this route");
      reads.push(read);
      return read.promise;
    },
    showMain() {
      const restore = deferred();
      restores.push(restore);
      effects.push(["restore"]);
      return restore.promise;
    },
  };
  const dependencies = Object.fromEntries([...ts.createSourceFile("desktopNotifications.ts", program, ts.ScriptTarget.Latest, true).statements]
    .filter(ts.isImportDeclaration).map((node) => [node.moduleSpecifier.text, {}]));
  dependencies["./desktop.ts"] = { getDesktopBridge: () => bridge, isDesktopApp: () => true };
  const module = { exports: {} };
  const compiled = ts.transpileModule(program, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, window, URL,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  const register = () => module.exports.registerDesktopNotificationNavigationListener((route) => effects.push(["open", route]));
  const registered = register();
  const emit = async (route, hold = false) => {
    const read = deferred();
    queued.push(read);
    window.dispatchEvent(new Event("letscube:desktop-notification-action"));
    if (!hold) read.resolve(route);
    await drain();
    return read;
  };
  const finish = async (index, failure = false) => {
    assert.ok(restores[index], "the actual adapter must request window restoration");
    if (failure) restores[index].reject(new Error("fictional restore refusal"));
    else restores[index].resolve();
    await drain();
  };
  return { registered, register, startup, reads, restores, effects, emit, finish,
    put: (route) => { slot = route; },
    listenerCount: () => getEventListeners(window, "letscube:desktop-notification-action").length };
}

async function live(program = source) {
  const f = fixture(program);
  f.dispose = await f.registered;
  return f;
}

async function ordinary(program = source) {
  const f = await live(program);
  try {
    await f.emit(A);
    assert.deepEqual(f.effects, [["restore"]]);
    await f.finish(0);
    assert.deepEqual(f.effects, [["restore"], ["open", "/chat/64222222-2222-4222-8222-000000000001/m/64555555-5555-4555-8555-000000000001#details"]]);
  } finally { f.dispose(); }
}

async function reversedRestores(program = source, olderFirst = false) {
  const f = await live(program);
  try {
    await f.emit(A); await f.emit(B);
    await f.finish(olderFirst ? 0 : 1);
    assert.deepEqual(f.effects.filter(([kind]) => kind === "open"), olderFirst ? [] : [["open", "/chat/64222222-2222-4222-8222-000000000002/m/64555555-5555-4555-8555-000000000002#details"]]);
    await f.finish(olderFirst ? 1 : 0);
    assert.deepEqual(f.effects.filter(([kind]) => kind === "open"), [["open", "/chat/64222222-2222-4222-8222-000000000002/m/64555555-5555-4555-8555-000000000002#details"]]);
  } finally { f.dispose(); }
}

async function disposedRestore(program = source) {
  const f = await live(program);
  await f.emit(A);
  f.dispose();
  await f.finish(0);
  assert.deepEqual(f.effects, [["restore"]]);
  await f.emit(B);
  assert.deepEqual(f.effects, [["restore"]]);
  assert.equal(f.reads.length, 1, "disposed listeners must not read another bridge target");
  assert.equal(f.listenerCount(), 0, "the emitted-event listener must actually be detached");
}

async function reversedReads(program = source) {
  const f = await live(program);
  try {
    const old = await f.emit(A, true);
    const latest = await f.emit(B, true);
    assert.equal(f.reads.length, 1, "native take-slot reads must not run concurrently");
    latest.resolve(B); old.resolve(A); await drain(); await f.finish(0);
    assert.deepEqual(f.effects, [["restore"], ["open", "/chat/64222222-2222-4222-8222-000000000002/m/64555555-5555-4555-8555-000000000002#details"]]);
  } finally { f.dispose(); }
}

async function failedRestore(program = source) {
  const f = await live(program);
  try {
    await f.emit(A); await f.finish(0, true);
    assert.deepEqual(f.effects, [["restore"]]);
    await f.emit(B); await f.finish(1);
    assert.deepEqual(f.effects, [["restore"], ["restore"], ["open", "/chat/64222222-2222-4222-8222-000000000002/m/64555555-5555-4555-8555-000000000002#details"]]);
  } finally { f.dispose(); }
}

async function emittedBeforeRead(program = source) {
  const f = await live(program);
  try {
    await f.emit(A);
    const latest = await f.emit(B, true);
    await f.finish(0);
    assert.deepEqual(f.effects, [["restore"]]);
    latest.resolve(B); await drain(); await f.finish(1);
    assert.deepEqual(f.effects.filter(([kind]) => kind === "open"), [["open", "/chat/64222222-2222-4222-8222-000000000002/m/64555555-5555-4555-8555-000000000002#details"]]);
  } finally { f.dispose(); }
}

test("ordinary canonical route and hash open only after the actual bridge restores the window", () => ordinary());
test("emitted A then B opens only B when restores finish B then A", () => reversedRestores());
test("emitted B invalidates A even when A restores before B", () => reversedRestores(source, true));
test("dispose prevents a delayed restore callback and removes the event listener", () => disposedRestore());
test("serialized native reads keep emitted order even if the later fixture response is ready first", () => reversedReads());
test("restore refusal intentionally does not navigate and a later ordinary action still works", () => failedRestore());

test("a newer emitted event invalidates an older restore before its route read finishes", () => emittedBeforeRead());

test("dispose also refuses a route read that was already in flight", async () => {
  const f = await live();
  const old = await f.emit(A, true);
  f.dispose(); old.resolve(A); await drain();
  assert.deepEqual(f.effects, []);
});

test("failure of the newer restore cannot reactivate an older event", async () => {
  const f = await live();
  try {
    await f.emit(A); await f.emit(B);
    await f.finish(1, true); await f.finish(0);
    assert.deepEqual(f.effects, [["restore"], ["restore"]]);
  } finally { f.dispose(); }
});

test("a cold pending canonical route still restores before navigating", async () => {
  const f = fixture(source, { holdStartup: true });
  await drain(); f.startup.resolve(A);
  const dispose = await f.registered;
  try {
    await drain();
    assert.deepEqual(f.effects, [["restore"]]);
    await f.finish(0);
    assert.deepEqual(f.effects, [["restore"], ["open", "/chat/64222222-2222-4222-8222-000000000001/m/64555555-5555-4555-8555-000000000001#details"]]);
  } finally { dispose(); }
});

test("a live emitted action wins over a slower cold pending read", async () => {
  const f = fixture(source, { holdStartup: true });
  await drain(); await f.emit(B); f.startup.resolve(A); await drain(); await f.finish(0);
  const dispose = await f.registered;
  try {
    await drain();
    assert.deepEqual(f.effects, [["restore"], ["open", "/chat/64222222-2222-4222-8222-000000000002/m/64555555-5555-4555-8555-000000000002#details"]]);
  } finally { dispose(); }
});

test("foreign and protocol-relative routes still refuse restore and navigation", async () => {
  const f = await live();
  try {
    await f.emit("https://example.invalid/chat/elsewhere");
    await f.emit("//example.invalid/chat/elsewhere");
    assert.deepEqual(f.effects, []);
  } finally { f.dispose(); }
});

async function singleSlotTarget(program = source) {
  const f = fixture(program, { holdStartup:true, singleSlot:true });
  await drain(); f.put(B); const eventRead = await f.emit(B, true);
  f.startup.resolve(); await drain(); eventRead.resolve();
  const dispose = await f.registered;
  try {
    await drain();
    assert.deepEqual(f.effects, [["restore"]], "the latest consumed route must survive a later empty take");
    await f.finish(0);
    assert.deepEqual(f.effects, [["restore"], ["open", "/chat/64222222-2222-4222-8222-000000000002/m/64555555-5555-4555-8555-000000000002#details"]]);
  } finally { dispose(); }
}

test("a destructive single-slot startup read cannot discard the latest emitted target", () => singleSlotTarget());

async function remountedSlotTarget(program = source) {
  const f = fixture(program, { controlledSlotReads:true });
  const disposeOld = await f.registered; await drain();
  assert.equal(f.reads.length, 1); disposeOld();
  const disposeNew = await f.register();
  try {
    f.put(B); await f.emit(B);
    f.reads[0].resolve(); await drain();
    for (let index = 1; index < 3; index++) {
      assert.ok(f.reads[index], "the remounted listener must drain its startup and event reads");
      f.reads[index].resolve(); await drain();
    }
    assert.deepEqual(f.effects, [["restore"]], "a retired listener's destructive take must hand the consumed route to its successor");
    await f.finish(0);
    assert.deepEqual(f.effects, [["restore"], ["open", "/chat/64222222-2222-4222-8222-000000000002/m/64555555-5555-4555-8555-000000000002#details"]]);
  } finally { disposeNew(); }
}

test("a remounted listener retains a route consumed by a retired in-flight reader", () => remountedSlotTarget());

const restoreBlock = `void restoreMain()
        .then(() => {
          if (active && targetRevision === latestTargetRevision && isCurrent()) openTarget(route);
        })
        .catch(() => undefined);`;

for (const [name, from, to, count, scenario] of [
  ["do not stamp emitted events", "const eventRevision = ++latestEventRevision;", "const eventRevision = latestEventRevision;", 1, reversedReads],
  ["do not carry emitted ownership across restore", "callback(target, isCurrent);", "callback(target);", 1, emittedBeforeRead],
  ["discard a route on the latest empty take", "if (route != null) desktopActionRoute = route;", "desktopActionRoute = route;", 1, singleSlotTarget],
  ["bypass serialized native reads", "desktopActionReads = desktopActionReads.then(", "desktopActionReads = Promise.resolve().then(", 1, reversedReads],
  ["discard a retired reader's consumed route", "if (route != null) desktopActionRoute = route;", "if (!active) return; if (route != null) desktopActionRoute = route;", 1, remountedSlotTarget],
  ["drop restore ordering guards", "if (active && targetRevision === latestTargetRevision && isCurrent()) openTarget(route);", "if (active) openTarget(route);", 1, reversedRestores],
  ["keep disposed callbacks active", "active = false;", "active = true;", 2, disposedRestore],
  ["keep the disposed event listener installed", "window.removeEventListener(\"letscube:desktop-notification-action\", listener);", "undefined;", 1, disposedRestore],
  ["navigate without restoring the window", restoreBlock, "openTarget(route);", 1, ordinary],
  ["navigate after restore refusal", restoreBlock, restoreBlock.replace(".catch(() => undefined);", ".catch(() => openTarget(route));"), 1, failedRestore],
]) {
  test(`literal navigation oracle refuses compiled mutation: ${name}`, async () => {
    const normalized = source.replaceAll("\r\n", "\n");
    assert.equal(normalized.split(from).length - 1, count, "mutation must reach the exact actual adapter guards");
    await scenario(source);
    await assert.rejects(() => scenario(normalized.replaceAll(from, to)), (error) => error instanceof assert.AssertionError);
  });
}
