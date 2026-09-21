import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const html = readFileSync(new URL("../../artifacts/kub/index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../../artifacts/kub/src/main.tsx", import.meta.url), "utf8");
const controller = html.match(/<script\b[^>]*id="kub-boot-controller"[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(controller, "the real document must contain its independent boot controller");

const address = "https://fixture.invalid/chat/fixture/m/message?returnTo=%2Fchat%2Ffixture#retained";

// This is a DOM/event boundary, not a browser renderer. In particular, resource
// errors are captured (they do not bubble), and removal matches capture flags.
class Target {
  listeners = [];
  addEventListener(type, callback, options = false) {
    const capture = typeof options === "boolean" ? options : Boolean(options.capture);
    if (!this.listeners.some((entry) => entry.type === type && entry.callback === callback && entry.capture === capture)) {
      this.listeners.push({ type, callback, capture, once: Boolean(options?.once) });
    }
  }
  removeEventListener(type, callback, options = false) {
    const capture = typeof options === "boolean" ? options : Boolean(options.capture);
    this.listeners = this.listeners.filter((entry) => entry.type !== type || entry.callback !== callback || entry.capture !== capture);
  }
  dispatchEvent(event) {
    event.target ??= this;
    event.defaultPrevented ??= false;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    for (const entry of [...this.listeners]) {
      if (entry.type !== event.type || !this.listeners.includes(entry)) continue;
      if (event.target !== this && !event.bubbles && !entry.capture) continue;
      if (entry.once) this.removeEventListener(entry.type, entry.callback, entry.capture);
      entry.callback.call(this, event);
    }
    return !event.defaultPrevented;
  }
}

function load({ source = controller, href = address, online = true, storageDenied = false } = {}) {
  const effects = [];
  const timers = new Map();
  const nodes = new Map();
  let now = 0;
  let nextTimer = 0;
  function element(id, parent = null) {
    const node = Object.assign(new Target(), {
      id, parent, dataset: {}, children: [], hidden: false, disabled: false, textContent: "", connected: true,
      remove() { this.connected = false; },
      click() { if (!this.disabled) this.dispatchEvent({ type: "click" }); },
    });
    Object.defineProperties(node, {
      isConnected: { get: () => node.connected && (!parent || parent.isConnected) },
      childElementCount: { get: () => node.children.length },
    });
    nodes.set(id, node);
    return node;
  }
  const root = element("root");
  const surface = element("kub-boot-recovery");
  const style = element("kub-boot-style");
  const title = element("kub-boot-title", surface);
  const message = element("kub-boot-message", surface);
  const retry = element("kub-boot-retry", surface);
  const retryTag = html.match(/<button\b[^>]*id="kub-boot-retry"[^>]*>/)?.[0];
  assert.ok(retryTag, "the static retry must exist without React");
  retry.hidden = /\bhidden\b/.test(retryTag);
  retry.type = retryTag.match(/\btype="([^"]*)"/)?.[1] ?? "submit";
  const document = {
    documentElement: { dataset: {} },
    getElementById: (id) => nodes.get(id)?.isConnected ? nodes.get(id) : null,
  };
  const storages = [];
  function storage(name) {
    const data = new Map([["fixture-session", "keep-session"], ["fixture-draft", "keep-draft"]]);
    storages.push(data);
    return {
      getItem(key) { effects.push([name, "read", key]); return data.get(key) ?? null; },
      setItem(key, value) { effects.push([name, "write", key]); data.set(key, String(value)); },
      removeItem(key) { effects.push([name, "remove", key]); data.delete(key); },
      clear() { effects.push([name, "clear"]); data.clear(); },
    };
  }
  let currentUrl = new URL(href);
  const location = {
    get href() { return currentUrl.href; },
    set href(value) { effects.push(["navigate", value]); currentUrl = new URL(value, currentUrl); },
    get pathname() { return currentUrl.pathname; },
    get search() { return currentUrl.search; },
    get hash() { return currentUrl.hash; },
    assign(value) { this.href = value; },
    replace(value) { this.href = value; },
    reload(...args) { effects.push(["reload", this.href, args]); },
  };
  const window = Object.assign(new Target(), {
    location,
    setTimeout(callback, delay = 0) {
      timers.set(++nextTimer, { callback, at: now + Number(delay) });
      return nextTimer;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  for (const name of ["localStorage", "sessionStorage"]) {
    const value = storage(name);
    Object.defineProperty(window, name, { get() {
      effects.push([name, "access"]);
      if (storageDenied) throw new Error("fixture storage denied");
      return value;
    } });
  }
  const forbidden = (name) => (...args) => { effects.push([name, ...args]); throw new Error(`unexpected ${name}`); };
  const navigator = { onLine: online, sendBeacon: forbidden("beacon") };
  const sandbox = {
    window, document, navigator, URL,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail ?? null; } },
    console: Object.fromEntries(["log", "warn", "error", "info", "debug"].map((name) => [name, (...args) => effects.push(["console", name, ...args])])),
    fetch: forbidden("fetch"),
    caches: { delete: forbidden("cache-delete") },
    indexedDB: { deleteDatabase: forbidden("database-delete") },
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
  };
  Object.assign(window, { navigator, document, fetch: sandbox.fetch, caches: sandbox.caches, indexedDB: sandbox.indexedDB });
  for (const name of ["localStorage", "sessionStorage", "location"]) {
    Object.defineProperty(sandbox, name, { get: () => window[name] });
  }
  Object.defineProperty(document, "cookie", {
    get() { effects.push(["cookie-read"]); return "fixture=keep"; },
    set(value) { effects.push(["cookie-write", value]); },
  });
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: "index.html#kub-boot-controller", timeout: 1000 });
  const emit = (type, details = {}) => window.dispatchEvent({ type, ...details });
  return {
    root, surface, style, title, message, retry, document, window, effects, timers, storages, context, emit,
    get state() { return document.documentElement.dataset.kubBootState; },
    advance(ms) {
      const end = now + ms;
      let iterations = 0;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next || next[1].at > end) break;
        assert.ok(++iterations < 1000, "timer/reload loop");
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
    mount() {
      root.children.push({ tagName: "MAIN" });
      root.dataset.kubAppReady = "true";
      emit("letscube:app-rendered");
    },
  };
}

function assertWaiting(fixture) {
  assert.equal(fixture.state, "loading");
  assert.equal(fixture.retry.hidden, true);
  assert.equal(fixture.surface.isConnected, true);
}

function assertRecovered(fixture) {
  assert.equal(fixture.state, "ready");
  assert.equal(fixture.surface.isConnected, false);
  assert.equal(fixture.style.isConnected, false);
  assert.equal(fixture.timers.size, 0, "success must cancel the deadline, not merely ignore it");
  assert.equal(fixture.window.listeners.length, 0, "all bootstrap listeners, including capture errors, must be removed");
}

function timeoutContract(source = controller) {
  const fixture = load({ source });
  assertWaiting(fixture);
  fixture.advance(11999);
  assertWaiting(fixture);
  fixture.advance(1);
  assert.equal(fixture.state, "failed");
  assert.equal(fixture.retry.hidden, false);
  assert.equal(fixture.surface.isConnected, true);
}

function successContract(source = controller) {
  const fixture = load({ source });
  fixture.advance(11999);
  fixture.mount();
  assertRecovered(fixture);
  fixture.advance(60000);
  fixture.emit("error");
  fixture.emit("unhandledrejection", { reason: new Error("post-boot fixture error") });
  fixture.emit("letscube:app-rendered");
  assertRecovered(fixture);
  assert.deepEqual(fixture.effects, []);
}

function lateMountContract(source = controller) {
  for (const failure of ["timeout", "error", "unhandledrejection"]) {
    const fixture = load({ source });
    if (failure === "timeout") fixture.advance(12000);
    else fixture.emit(failure);
    assert.equal(fixture.state, "failed");
    fixture.advance(30000);
    fixture.mount();
    assertRecovered(fixture);
    assert.deepEqual(fixture.effects, []);
  }
}

function readinessContract(source = controller) {
  const fixture = load({ source });
  for (const type of ["DOMContentLoaded", "load", "letscube:app-rendered"]) fixture.emit(type);
  assertWaiting(fixture);
  fixture.root.dataset.kubAppReady = "true";
  fixture.emit("letscube:app-rendered");
  assertWaiting(fixture);
  delete fixture.root.dataset.kubAppReady;
  fixture.root.children.push({ tagName: "MAIN" });
  fixture.emit("letscube:app-rendered");
  assertWaiting(fixture);
  fixture.root.dataset.kubAppReady = "false";
  fixture.emit("letscube:app-rendered");
  assertWaiting(fixture);
  fixture.root.dataset.kubAppReady = "true";
  fixture.emit("letscube:app-rendered");
  assertRecovered(fixture);
}

function irrelevantContract(source = controller) {
  const fixture = load({ source });
  for (const target of [{ tagName: "IMG" }, { tagName: "LINK" }, { tagName: "VIDEO" }, { tagName: "SCRIPT", type: "text/javascript" }]) {
    fixture.emit("error", { target });
    assertWaiting(fixture);
  }
  fixture.advance(11999);
  assertWaiting(fixture);
  fixture.advance(1);
  assert.equal(fixture.state, "failed");
}

function moduleFailureContract(source = controller) {
  const fixture = load({ source });
  fixture.emit("error", { target: { tagName: "SCRIPT", type: "module" } });
  assert.equal(fixture.state, "failed", "a non-bubbling module error must be captured immediately");
  assert.equal(fixture.retry.hidden, false);
  assert.equal(fixture.timers.size, 0);
}

function retentionContract(source = controller, href = address) {
  const fixture = load({ source, href });
  const initialListeners = [...fixture.window.listeners];
  fixture.advance(12000);
  for (let i = 0; i < 5; i++) {
    fixture.emit("error");
    fixture.emit("unhandledrejection", { reason: "fixture-private-detail" });
  }
  fixture.advance(24 * 60 * 60 * 1000);
  assert.equal(fixture.state, "failed");
  assert.equal(fixture.surface.isConnected, true);
  assert.ok(fixture.window.listeners.every((entry) => initialListeners.includes(entry)), "repeated failures must not add duplicate subscriptions");
  assert.deepEqual(fixture.effects, [], "failure must not touch storage, leak details, navigate or automatically reload");
  assert.equal(fixture.retry.hidden, false);
  fixture.retry.click();
  assert.equal(fixture.retry.disabled, true);
  fixture.retry.click();
  fixture.advance(120000);
  assert.deepEqual(fixture.effects, [["reload", href, []]], "one explicit retry must reload the exact current location only");
  assert.equal(fixture.window.location.href, href);
  for (const data of fixture.storages) assert.deepEqual([...data], [["fixture-session", "keep-session"], ["fixture-draft", "keep-draft"]]);
}

test("a stalled boot offers retry at exactly 12000 ms, not before or after", () => timeoutContract());
test("rendered success removes the surface, style, timeout and all listeners", () => successContract());
test("a late successful mount recovers after a timeout or fatal event", () => lateMountContract());
test("document/module load, an empty root or children without the React acknowledgement are not readiness", () => readinessContract());
test("errors from images, CSS, media and classic scripts do not fail the application boot", () => irrelevantContract());
test("module resource errors are captured before the deadline even though they do not bubble", () => moduleFailureContract());

for (const [name, type, details] of [
  ["module resource failure", "error", { target: { tagName: "SCRIPT", type: "module" } }],
  ["uncaught entry exception", "error", { message: "fixture-private-detail", error: new Error("fixture-private-detail") }],
  ["unhandled rejection", "unhandledrejection", { reason: new Error("fixture-private-detail") }],
]) {
  test(`${name} immediately provides recovery without consuming the error or exposing its content`, () => {
    const fixture = load();
    const event = { type, ...details };
    assert.equal(fixture.window.dispatchEvent(event), true);
    assert.equal(event.defaultPrevented, false);
    assert.equal(fixture.state, "failed");
    assert.equal(fixture.retry.hidden, false);
    assert.equal(fixture.timers.size, 0);
    assert.ok(fixture.title.textContent.length > 0);
    assert.ok(fixture.message.textContent.length > 0);
    assert.doesNotMatch(fixture.title.textContent + fixture.message.textContent, /fixture-private-detail/);
    assert.deepEqual(fixture.effects, []);
  });
}

test("repeated fatal events do not create retry/reload loops or discard sessions and drafts", () => retentionContract());
test("retry preserves an auth callback query and fragment byte for byte", () => {
  retentionContract(controller, "https://fixture.invalid/auth/callback?code=synthetic%2Bcode&next=%2Fchat%2Ffixture#access_token=synthetic-only");
});
test("recovery and retry work when storage is inaccessible", () => {
  const fixture = load({ storageDenied: true });
  fixture.advance(12000);
  fixture.retry.click();
  assert.deepEqual(fixture.effects, [["reload", address, []]]);
});
test("offline and online failures have safe distinct guidance", () => {
  const offline = load({ online: false });
  const online = load();
  offline.advance(12000);
  online.advance(12000);
  assert.notEqual(offline.message.textContent, online.message.textContent);
  assert.equal(offline.retry.hidden, false);
  assert.equal(online.retry.hidden, false);
});
test("failure events expose only a state transition, never exception contents", () => {
  const fixture = load();
  const notifications = [];
  fixture.window.addEventListener("letscube:boot-failed", (event) => notifications.push(event));
  fixture.window.dispatchEvent({ type: "unhandledrejection", get reason() { assert.fail("the recovery must not read a private rejection reason"); } });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].detail, null);
  assert.equal(fixture.state, "failed");
  assert.deepEqual(fixture.effects, []);
});
test("successful cleanup preserves unrelated application listeners", () => {
  const fixture = load();
  const observed = [];
  const listener = (event) => observed.push(event.type);
  fixture.window.addEventListener("error", listener, true);
  fixture.window.addEventListener("unhandledrejection", listener);
  fixture.window.addEventListener("letscube:app-rendered", listener);
  fixture.mount();
  assert.equal(fixture.window.listeners.length, 3);
  fixture.emit("error");
  fixture.emit("unhandledrejection");
  assert.deepEqual(observed, ["letscube:app-rendered", "error", "unhandledrejection"]);
  assert.equal(fixture.state, "ready");
  assert.deepEqual(fixture.effects, []);
});
test("a missing application root cannot acknowledge readiness", () => {
  const fixture = load();
  fixture.root.remove();
  fixture.emit("letscube:app-rendered");
  assertWaiting(fixture);
  fixture.advance(12000);
  assert.equal(fixture.state, "failed");
  assert.equal(fixture.retry.hidden, false);
});
test("the static recovery has a named native button and an announced status without a runtime-error overlay", () => {
  const fixture = load();
  assert.equal(fixture.retry.type, "button");
  assert.match(html, /<section\b[^>]*id="kub-boot-recovery"[^>]*aria-labelledby="kub-boot-title"/);
  assert.match(html, /<div\b[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /<button\b[^>]*id="kub-boot-retry"[^>]*>\s*[^<\s][^<]*<\/button>/);
  assert.equal(fixture.document.getElementById("runtime-error-modal"), null);
  fixture.advance(12000);
  assert.equal(fixture.retry.hidden, false);
  assert.deepEqual(fixture.effects, []);
});

test("the actual entry module waits for the committed effect before signalling readiness", () => {
  const fixture = load();
  const effects = [];
  let renderTree;
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    "react-dom/client": { createRoot: (root) => {
      assert.equal(root, fixture.root);
      return { render: (tree) => { renderTree = tree; } };
    } },
    "react": { useEffect: (callback) => effects.push(callback) },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "./App": { default: () => null },
    "@/components/AppErrorBoundary": { AppErrorBoundary: () => null },
    "@/lib/monitoring": { initMonitoring() {} },
    "@/lib/platform/desktop": { applyDesktopShellAttribute() {} },
    "@/hooks/useMessageTextSize": { initMessageTextSize() {} },
    "./index.css": {},
  };
  const code = ts.transpileModule(main, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  Object.assign(fixture.context, {
    exports: {},
    crypto: { randomUUID: () => "synthetic-boot-id" },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected entry dependency: ${name}`);
      return dependencies[name];
    },
  });
  vm.runInContext(code, fixture.context, { filename: "main.tsx", timeout: 1000 });
  assertWaiting(fixture);
  assert.equal(fixture.root.dataset.kubAppReady, undefined);
  renderTree.type(renderTree.props);
  assertWaiting(fixture);
  assert.equal(effects.length, 1);
  // Simulate the React commit boundary. Actual React/layout belongs to E2E.
  fixture.root.children.push({ tagName: "MAIN" });
  effects[0]();
  assertRecovered(fixture);
});

// Execute realistic broken copies through the SAME behavioral assertions.
// Mutants never touch shared production files, builds, profiles or the network.
const mutations = [
  ["deadline shortened to 6000", "setTimeout(failed, 12000)", "setTimeout(failed, 6000)", timeoutContract],
  ["deadline extended to 24000", "setTimeout(failed, 12000)", "setTimeout(failed, 24000)", timeoutContract],
  ["success leaves its timer alive", "finished = true;\n          window.clearTimeout(timer);", "finished = true;", successContract],
  ["capture listener removed with the wrong flag", 'removeEventListener("error", error, true)', 'removeEventListener("error", error, false)', successContract],
  ["module failures observed only in the bubbling phase", 'addEventListener("error", error, true)', 'addEventListener("error", error, false)', moduleFailureContract],
  ["irrelevant resource errors treated as fatal", 'event.target.tagName === "SCRIPT" && event.target.type === "module"', "true", irrelevantContract],
  ["failure leaves the retry button hidden", "retry.hidden = false;", "retry.hidden = true;", timeoutContract],
  ["failed boot prevents a late mount", "function ready() {", 'function ready() { if (root.dataset.kubBootState === "failed") return;', lateMountContract],
  ["empty roots accepted as rendered", " || !app.childElementCount", "", readinessContract],
  ["unacknowledged DOM accepted as rendered", ' || app.dataset.kubAppReady !== "true"', "", readinessContract],
  ["failure clears local session", "function failed() {", "function failed() { window.localStorage.clear();", retentionContract],
  ["failure clears draft storage", "function failed() {", "function failed() { window.sessionStorage.clear();", retentionContract],
  ["failure automatically reloads", "function failed() {", "function failed() { window.location.reload();", retentionContract],
  ["retry navigates away from callback and deep link", "window.location.reload();", 'window.location.href = "/";', retentionContract],
  ["retry remains enabled for repeated activation", "retry.disabled = true;", "retry.disabled = false;", retentionContract],
];
for (const [name, before, after, check] of mutations) {
  test(`mutation proof: ${name}`, () => {
    const normalized = controller.replaceAll("\r\n", "\n");
    assert.equal(normalized.split(before).length - 1, 1, `mutation must have exactly one target: ${name}`);
    const mutant = normalized.replace(before, after);
    assert.doesNotThrow(() => new vm.Script(mutant), "syntax failure is not behavioral mutation evidence");
    assert.throws(() => check(mutant), { code: "ERR_ASSERTION" }, "the same behavioral guard must reject the regression");
  });
}
