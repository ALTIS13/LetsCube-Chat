import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInThisContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { expect, webkit, chromium, devices, type Page } from "@playwright/test";
import { chat, membership, message, openFixture, person, requireFixtureServer } from "../e2e/helpers/messageActionsFixture.ts";

const baseURL = process.env.KUB_MEASURED_HEIGHT_BASE_URL;
const ablation = process.env.KUB_MEASURED_HEIGHT_ABLATION ?? "none";
const ME = person("76111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("76111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const OTHER = person("76111111-1111-4111-8111-000000000003", "Анна Смирнова", "anna_second");
const CHAT = "76222222-2222-4222-8222-000000000001";
const AT = "2026-10-01T12:00:00Z";
const hookSource = readFileSync(new URL("../../artifacts/kub/src/hooks/useMeasuredHeight.ts", import.meta.url), "utf8");

function runtime(mutation?: [string, string]) {
  let source = hookSource;
  if (mutation) {
    assert.equal(source.split(mutation[0]).length - 1, 1, "unique runtime mutation anchor");
    source = source.replace(...mutation);
  }
  const frames = new Map<number, () => void>();
  const observers: any[] = [];
  let nextFrame = 0;
  let flushes = 0;
  let active: any;
  class Observer {
    targets = new Map<any, any>();
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; observers.push(this); }
    observe(node: any, options: any) { this.targets.set(node, options); }
    unobserve(node: any) { this.targets.delete(node); }
    disconnect() { this.targets.clear(); }
  }
  const environment = {
    ResizeObserver: Observer,
    requestAnimationFrame: (callback: () => void) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    require: (name: string) => name === "react-dom" ? { flushSync: (callback: () => void) => { flushes += 1; callback(); } } : {
      useRef: (value: any) => ({ current: value }),
      useCallback: (callback: any) => callback,
      useState: (value: any) => [value === null ? active.node : value, (next: any) => { if (value !== null) active.heights.push(next); }],
      useLayoutEffect: (callback: any) => active.effects.push(callback),
    },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  runInThisContext(`(function(exports, ${Object.keys(environment).join(",")}) { ${compiled}\n })`, { filename: "useMeasuredHeight.runtime.ts" })(exports, ...Object.values(environment));
  const mount = (height = 66) => {
    const instance = { node: { height, getBoundingClientRect() { return { height: this.height }; } }, heights: [] as number[], effects: [] as any[], observer: null as any, cleanup: null as any };
    active = instance;
    const measured = exports.useMeasuredHeight();
    measured.ref(instance.node);
    instance.effects[0]();
    instance.cleanup = instance.effects[1]();
    instance.observer = observers.at(-1);
    return instance;
  };
  const deliver = (instance: any) => { active = instance; instance.observer.callback(); };
  const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); };
  return { mount, deliver, frame, frames, get flushes() { return flushes; } };
}

function unchangedDelivery(mutation?: [string, string]) {
  const r = runtime(mutation); const dock = r.mount(); r.deliver(dock);
  assert.equal(r.flushes, 0, "an unchanged initial delivery must not flush unrelated pending work");
  assert.equal(r.frames.size, 0, "an unchanged initial delivery must not perpetually reobserve");
}
function siblingCleanup(mutation?: [string, string]) {
  const r = runtime(mutation); const dock = r.mount(); const header = r.mount(56);
  dock.node.height = 182.65625; r.deliver(dock);
  assert.deepEqual(dock.heights, [66, 183], "the changed height is committed synchronously and rounded up");
  assert.equal(dock.observer.targets.size, 0); assert.equal(header.observer.targets.size, 0);
  assert.equal(r.frames.size, 1);
  header.cleanup(); r.frame();
  assert.equal(header.observer.targets.size, 0, "a removed sibling must not be reobserved by the pending frame");
  assert.deepEqual(dock.observer.targets.get(dock.node), { box: "border-box" });
  const replacement = r.mount(66.125);
  assert.deepEqual(replacement.heights, [67], "a fractional border box must never be rounded down");
  replacement.cleanup();
  dock.node.height = 90; r.deliver(dock); dock.cleanup();
  assert.equal(r.frames.size, 0, "the last cleanup cancels the shared reobserve frame");
}
test("unchanged initial deliveries do not flush or reobserve", () => unchangedDelivery());
test("own sibling observations pause together and cleanup cannot resurrect a node", () => siblingCleanup());
test("runtime guards reject isolated observer lifecycle mutants", () => {
  assert.throws(() => unchangedDelivery(["if (Math.ceil(node.getBoundingClientRect().height) === measuredHeightRef.current) return;", ""]), /unchanged initial delivery/);
  for (const mutation of [
    ["heightObservations.delete(observation);", "void observation;"],
    ["for (const { observer, node } of heightObservations) observer.unobserve(node);", ""],
    ["Math.ceil(current.getBoundingClientRect().height)", "Math.floor(current.getBoundingClientRect().height)"],
    ["cancelAnimationFrame(reobserveFrame);", "void reobserveFrame;"],
  ] as [string, string][]) assert.throws(() => siblingCleanup(mutation), { code: "ERR_ASSERTION" });
});

async function composerFrames(deliveryMode: string) {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  const engine = process.env.KUB_MEASURED_HEIGHT_ENGINE ?? "webkit";
  const browser = await (engine === "chromium" ? chromium : webkit).launch();
  const failures: any[] = [];
  try {
    for (const width of [390, 1440]) for (const theme of ["dark", "light"] as const) {
      const context = await browser.newContext({ ...(width === 390 ? devices["iPhone 14 Pro"] : {}),
        viewport: { width, height: width === 390 ? 844 : 900 }, baseURL, serviceWorkers: "block" });
      await requireFixtureServer(context.request);
      const page = await context.newPage();
      await openFixture(page, { me: ME, theme, chats: [], memberships: [], messages: [] });
      await mutateHook(page, deliveryMode);
      let gate: ((fixture: { page: Page }) => Promise<void>) | undefined;
      const register = Object.assign((_name: string, callback: any) => { gate = callback; }, {
        describe: (_name: string, callback: () => void) => callback(),
        info: () => ({ project: { name: `${engine}-${width}-${theme}` } }),
        skip: () => assert.fail("the existing same-frame gate must not skip"),
      });
      // Run the existing browser gate verbatim, with only its runner registration
      // adapted to node:test. Its frame sampler and all assertions remain intact.
      const source = readFileSync(new URL("../e2e/composer-typing-frames.spec.ts", import.meta.url), "utf8");
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      runInThisContext(`(function(exports, require) { ${compiled}\n })`, { filename: "composer-typing-frames.spec.ts" })({}, () => ({ test: register, expect }));
      assert.ok(gate);
      let failure: string | null = null;
      try { await gate({ page }); } catch (error) { failure = String(error); failures.push({ width, theme, failure }); }
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains("light")), theme === "light");
      const directory = resolve("output/runtime-error-webkit");
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, `frames-${engine}-${deliveryMode}-${width}-${theme}.json`), JSON.stringify({ failure,
        ...await page.evaluate(() => (window as any).__letscubeComposerFrames.stop()) }));
      await page.screenshot({ path: resolve(directory, `height-${width}-${theme}.png`), scale: "css" });
      console.log(`SAME_FRAME_${failure ? "RED" : "GREEN"} ${width} ${theme}`);
      await context.close();
    }
  } finally { await browser.close(); }
  assert.deepEqual(failures, []);
}

test("existing composer painted-frame contract holds at 390/1440 in both themes", { skip: !baseURL },
  () => composerFrames(ablation));
test("composer commits preserve every painted frame without native observer delivery", { skip: !baseURL },
  () => composerFrames("ignore-delivery"));

async function mutateHook(page: Page, deliveryMode = ablation) {
  if (process.env.KUB_MEASURED_HEIGHT_CHILD_ABLATION === "1") {
    await page.route("**/src/components/chat/MessageInput.tsx*", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      assert.equal(source.split("onLayoutChange?.();").length - 1, 1, "unique child-layout notification anchor");
      await route.fulfill({ response, body: source.replace("onLayoutChange?.();", "") });
    });
  }
  if (deliveryMode === "none") return;
  await page.route("**/src/hooks/useMeasuredHeight.ts*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    if (deliveryMode === "pre-fix") {
      const original = execFileSync("git", ["show", "HEAD:artifacts/kub/src/hooks/useMeasuredHeight.ts"], { encoding: "utf8" });
      const compiled = ts.transpileModule(original, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
        .replace('import { useCallback, useLayoutEffect, useRef, useState } from "react";', 'import React from "/node_modules/.vite/deps/react.js"; const { useCallback, useLayoutEffect, useRef, useState } = React;')
        .replace('import { flushSync } from "react-dom";', 'import ReactDOM from "/node_modules/.vite/deps/react-dom.js"; const { flushSync } = ReactDOM;');
      await route.fulfill({ response, body: compiled });
      return;
    }
    const [from, to] = deliveryMode === "ignore-delivery" ? ["flushSync(measure);", ""]
      : deliveryMode === "no-pause" ? ["pauseHeightObservations();", ""]
      : deliveryMode === "no-layout-remeasure" ? ["  useLayoutEffect(() => {\n    measure();\n  });", "  useLayoutEffect(() => { measure(); }, []);"]
      : deliveryMode === "late-measure" ? ["flushSync(measure);", "requestAnimationFrame(measure);"]
      : deliveryMode === "no-unchanged-guard" ? ["if (Math.ceil(node.getBoundingClientRect().height) === measuredHeightRef.current) return;", ""]
      : ["flushSync(measure);", `observer.unobserve(node);
          flushSync(measure);
          requestAnimationFrame(() => observer.observe(node, { box: "border-box" }));`];
    assert.equal(source.split(from).length - 1, 1, "unique served-source mutation anchor");
    await route.fulfill({ response, body: source.replace(from, to) });
  });
}

test("same-depth hook siblings commit both heights before paint without a native loop", { skip: !baseURL }, async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
    await requireFixtureServer(context.request);
    const page = await context.newPage();
    await mutateHook(page);
    await page.route("**/__qa/measured-height-boundary", (route) => route.fulfill({ contentType: "text/html", body: `
      <div id="root"></div><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { useMeasuredHeight } from '/src/hooks/useMeasuredHeight.ts';
      const errors = []; window.addEventListener('error', e => errors.push(e.message));
      let observerCallbacks = 0; const Native = ResizeObserver;
      window.ResizeObserver = class extends Native { constructor(callback) {
        super((entries, observer) => { observerCallbacks++; callback(entries, observer); });
      } };
      const frames = []; let recording = false; let pending = null;
      function Boundary() {
        const dock = useMeasuredHeight(); const header = useMeasuredHeight();
        return React.createElement('main', null,
          React.createElement('div', { id: 'header', ref: header.ref,
            style: { height: dock.height > 66 ? '89.328125px' : '56px' } }, React.createElement('div', { id: 'header-sample', style: { height: '100%' } })),
          React.createElement('div', { id: 'dock', ref: dock.ref, style: { height: '66px' } }, React.createElement('div', { id: 'dock-sample', style: { height: '100%' } })),
          React.createElement('output', { id: 'measurements', 'data-dock': dock.height, 'data-header': header.height }));
      }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Boundary));
      const sample = () => { const output = document.getElementById('measurements');
        if (output && recording) pending = { dock: document.getElementById('dock').getBoundingClientRect().height,
          header: document.getElementById('header').getBoundingClientRect().height,
          measuredDock: +output.dataset.dock, measuredHeader: +output.dataset.header }; };
      const sampler = new ResizeObserver(sample);
      const tick = () => { if (pending) frames.push(pending); sample(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      window.boundary = { errors, frames, get observerCallbacks() { return observerCallbacks; }, start: () => {
        // Deeper read-only sentinels let the sampler receive the corrected layout
        // without creating its own same-depth dependency between the two boxes.
        sampler.observe(document.getElementById('dock-sample'), { box: 'border-box' });
        sampler.observe(document.getElementById('header-sample'), { box: 'border-box' });
        recording = true; document.getElementById('dock').style.height = '182.65625px';
      } };
      </script>` }));
    await page.goto("/__qa/measured-height-boundary");
    await page.waitForFunction(() => document.getElementById("measurements")?.getAttribute("data-dock") === "66", null, { timeout: 5000 });
    await page.evaluate(() => (window as any).boundary.start());
    await page.waitForTimeout(150);
    const result = await page.evaluate(() => ({ errors: (window as any).boundary.errors, frames: (window as any).boundary.frames }));
    console.log(JSON.stringify({ sameDepth: result }));
    assert.deepEqual(result.errors, []);
    assert.ok(result.frames.length >= 3);
    assert.ok(result.frames.every((frame: any) => frame.measuredDock === 183 && frame.measuredHeader === 90),
      "both sibling measurements must be committed before the changed frame paints");
    const settledCount = await page.evaluate(() => (window as any).boundary.observerCallbacks);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => (window as any).boundary.observerCallbacks), settledCount,
      "settled native observers must not deliver an initial callback every idle frame");
    await context.close();
  } finally { await browser.close(); }
});

async function observe(page: Page) {
  await page.addInitScript(() => {
    const observers = new Map<ResizeObserver, any>();
    let nextId = 0;
    let nextNode = 0;
    const nodeIds = new WeakMap<Element, number>();
    const logs: any[] = [];
    const errors: any[] = [];
    const label = (node: Element) => {
      if (!nodeIds.has(node)) nodeIds.set(node, ++nextNode);
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { key: nodeIds.get(node), tag: node.localName, testId: node.getAttribute("data-testid"),
        class: node.getAttribute("class")?.slice(0, 200), connected: node.isConnected,
        width: box.width, height: box.height, clientWidth: node.clientWidth, clientHeight: node.clientHeight,
        paddingBottom: style.paddingBottom, transform: style.transform, depth: (() => {
          let depth = 0; for (let parent = node.parentElement; parent; parent = parent.parentElement) depth += 1;
          return depth;
        })() };
    };
    const snapshot = () => [...observers.values()].flatMap((value) => [...value.targets].map((node: any) => ({ observer: value.id, ...label(node) })));
    const Native = window.ResizeObserver;
    window.ResizeObserver = class extends Native {
      constructor(callback: ResizeObserverCallback) {
        const id = ++nextId;
        const created = new Error().stack?.split("\n").slice(1, 4).join("\n");
        super((entries, observer) => {
          const before = snapshot();
          const idsBefore = [...observers.values()].map((value) => value.id);
          const entry = { id, created, at: performance.now(), before,
            delivered: entries.map((row) => ({ ...label(row.target), contentHeight: row.contentRect.height,
              borderHeight: row.borderBoxSize?.[0]?.blockSize })), after: [] as any[], addedObservers: [] as any[] };
          logs.push(entry);
          if (logs.length > 32) logs.shift();
          callback(entries, observer);
          entry.after = snapshot();
          entry.addedObservers = [...observers.values()].filter((value) => !idsBefore.includes(value.id))
            .map((value) => ({ id: value.id, created: value.created, targets: [...value.targets].map((node: any) => label(node)) }));
        });
        observers.set(this, { id, created, targets: new Set() });
      }
      observe(node: Element, options?: ResizeObserverOptions) {
        observers.get(this)?.targets.add(node);
        super.observe(node, options);
      }
      unobserve(node: Element) {
        observers.get(this)?.targets.delete(node);
        super.unobserve(node);
      }
      disconnect() {
        observers.get(this)?.targets.clear();
        super.disconnect();
      }
    };
    window.addEventListener("error", (event) => {
      errors.push({ at: performance.now(), message: event.message, error: event.error ? String(event.error) : null,
        viewport: { innerHeight, innerWidth, height: visualViewport?.height, width: visualViewport?.width,
          scale: visualViewport?.scale, offsetTop: visualViewport?.offsetTop },
        targets: snapshot(), callbacks: structuredClone(logs) });
    });
    window.addEventListener("unhandledrejection", (event) => errors.push({ at: performance.now(), rejection: String(event.reason) }));
    (window as any).__heightFeedback = { errors, logs };
  });
}

test("native measured height preserves delivery during mounted composer/picker transitions", { skip: !baseURL }, async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  assert.equal(baseURL, "http://127.0.0.1:5218");
  assert.ok(["none", "detach-next-frame", "no-pause", "no-layout-remeasure", "late-measure", "no-unchanged-guard"].includes(ablation));
  const browser = await webkit.launch();
  const result: any[] = [];
  try {
    for (let round = 0; round < 16; round += 1) {
      const width = 390;
      const theme = round % 2 ? "light" : "dark";
      const context = await browser.newContext({ ...devices["iPhone 14 Pro"], viewport: { width, height: 844 },
        baseURL, serviceWorkers: "block" });
      await requireFixtureServer(context.request);
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      page.setDefaultNavigationTimeout(20_000);
      await observe(page);
      await mutateHook(page);
      const fixture = await openFixture(page, { me: ME, theme, people: [ANNA, OTHER],
        chats: [chat(CHAT, "group", "Synthetic mentions", AT)],
        memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT), membership(CHAT, OTHER, "member", AT)],
        messages: [message("76333333-3333-4333-8333-000000000001", CHAT, OTHER, "Привет, @Анна Смирнова!", AT, {
          mention_entities: { version: 1, revision: "76444444-4444-4444-8444-000000000001", items: [
            { kind: "user", user_id: ANNA.id, offset: 8, length: 14, label: "@Анна Смирнова" },
          ] },
        })] });
      let failure: string | null = null;
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.getByTestId("chat-list-item").filter({ hasText: "Synthetic mentions" }).click();
        const field = page.getByPlaceholder("Сообщение…").first();
        await field.fill("@Ан");
        await page.getByRole("listbox", { name: "Участники чата" }).waitFor();
        await page.locator(`[data-mention-id="${ANNA.id}"]`).click();
        await page.waitForTimeout(750);
        await page.evaluate(() => {
          window.dispatchEvent(new Event("online"));
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.waitForTimeout(1000);
      } catch (error) { failure = String(error); }
      const record = await page.evaluate(() => (window as any).__heightFeedback);
      const overlay = await page.locator("vite-error-overlay").count();
      result.push({ round, width, theme, ...record, overlay, failure });
      assert.equal(fixture.restCalls("messages", "POST").length, 0);
      console.log(JSON.stringify({ round, theme, errors: record.errors.map((event: any) => event.message), overlay, failure: Boolean(failure) }));
      await context.close();
    }
  } finally {
    await browser.close();
    const directory = resolve("output/runtime-error-webkit");
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, `ablation-${ablation}-${Date.now()}.json`);
    await writeFile(path, JSON.stringify(result));
    console.log(`EVIDENCE ${path}`);
  }
  assert.deepEqual(result.flatMap((row) => row.errors.map((event: any) => event.message ?? event.rejection)), []);
  assert.equal(result.reduce((total, row) => total + row.overlay, 0), 0);
  assert.deepEqual(result.filter((row) => row.failure).map(({ round, failure }) => ({ round, failure })), []);
});
