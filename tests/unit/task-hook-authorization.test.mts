import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const kubRoot = fileURLToPath(new URL("../../artifacts/kub/", import.meta.url));
const sourceRoot = resolve(kubRoot, "src");
const requireKub = createRequire(resolve(kubRoot, "package.json"));
const { build } = createRequire(requireKub.resolve("vite"))("esbuild");
const { chromium } = requireKub("@playwright/test");
let browser: any;
let bundle: string;

async function compileFixture(change?: { before: string; after: string }) {
  const boundaries = new Map([
    ["store/app.store.ts", `
      import {useSyncExternalStore} from 'react';
      let state={currentUser:{id:'owner-a'},accountEpoch:1};
      const listeners=new Set();
      export const useAppStore=Object.assign(select=>useSyncExternalStore(
        fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>select(state)),{
        getState:()=>state,
        setState:next=>{state={...state,...next};for(const fn of listeners)fn();}
      });
    `],
    ["lib/supabase/client.ts", `
      const client={from:table=>window.fixture.query('select',table),
        rpc:(name,args)=>window.fixture.query('rpc',name,args),removeChannel:()=>Promise.resolve()};
      export const createClient=()=>client;
      export const getRealtimeClient=()=>client;
    `],
    ["lib/dev/instrumentation.ts", "export function bumpFetch(){} export function registerChannel(){} export function unregisterChannel(){}"],
    ["lib/realtimeTableChannels.ts", "export function subscribeByTable(){return [];}"],
    ["hooks/useRole.ts", "export const usePermissionAccess=()=>({}); export const useAnyLocationPermissionAccess=()=>({});"],
    ["hooks/useTaskRouting.ts", "export const useTaskRouting=()=>({});"],
  ]);
  const result = await build({
    write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": sourceRoot },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env": '{"DEV":true}' },
    plugins: [{ name: "fictional-task-authorization", setup(plugin: any) {
      plugin.onLoad({ filter: /\.[tj]sx?$/ }, (args: any) => {
        const relative = args.path.slice(sourceRoot.length + 1).replaceAll("\\", "/");
        if (boundaries.has(relative)) return { contents: boundaries.get(relative), loader: "tsx", resolveDir: dirname(args.path) };
        if (change && relative === "hooks/useTaskReviewAccess.ts") {
          const source = readFileSync(args.path, "utf8").replaceAll("\r\n", "\n");
          assert.equal(source.split(change.before).length - 1, 1, "mutation must match the actual hook exactly once");
          return { contents: source.replace(change.before, change.after), loader: "tsx", resolveDir: dirname(args.path) };
        }
      });
    } }],
    stdin: { loader: "tsx", resolveDir: kubRoot, contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {useAppStore} from './src/store/app.store.ts';
      import {useTasks} from './src/hooks/useTasks.ts';
      import {useTaskReviewAccess} from './src/hooks/useTaskReviewAccess.ts';
      const f=window.fixture,root=createRoot(document.getElementById('root'));
      function Probe(){
        f.state=f.mode==='review' ? useTaskReviewAccess(f.taskId,{enabled:f.enabled,updatedAt:f.updatedAt,rolesKey:f.rolesKey}) :
          useTasks(f.filter,{enabled:f.enabled});
        f.renders.push(JSON.parse(JSON.stringify(f.state)));
        return null;
      }
      f.render=()=>flushSync(()=>root.render(<Probe/>));
      f.owner=(id='owner-a',epoch=2)=>flushSync(()=>useAppStore.setState({currentUser:id?{id}:null,accountEpoch:epoch}));
      f.detach=()=>flushSync(()=>root.unmount());
      f.refetch=()=>{void f.state.refetch();};
      f.render();
    ` },
  });
  return result.outputFiles[0].text;
}

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  bundle = await compileFixture();
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); });

async function fixture(mode = "list", initial: any = {}, code = bundle) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const faults: string[] = [];
  const network: string[] = [];
  const logs: string[] = [];
  page.on("pageerror", (error: any) => faults.push(error.message));
  page.on("console", (entry: any) => logs.push(entry.text()));
  await page.route("**/*", (route: any) => {
    if (route.request().url() === "https://task-authorization.invalid/") return route.fulfill({
      contentType: "text/html", body: '<!doctype html><div id="root"></div>',
    });
    network.push(route.request().url());
    return route.abort();
  });
  await page.goto("https://task-authorization.invalid/");
  await page.evaluate(({ mode, initial }: any) => {
    const f = (window as any).fixture = { mode, enabled: true, taskId: "task-a", updatedAt: "revision-1", rolesKey: "permissions-1", filter: { mine: "assigned" },
      plans: [initial], reads: [], pending: [], renders: [], state: null };
    f.query = (kind: string, name: string, args: any) => {
      const operations: any[] = [];
      const q: any = {};
      let signal: AbortSignal | undefined;
      q.abortSignal = (next: AbortSignal) => { signal = next; return q; };
      for (const method of ["select", "eq", "in", "is", "order", "limit"]) {
        q[method] = (...values: any[]) => { operations.push([method, ...values]); return q; };
      }
      q.then = (ok: any, fail: any) => {
        const plan = f.plans.shift() ?? {};
        const read = { kind, name, args, operations, aborted: Boolean(signal?.aborted) };
        signal?.addEventListener("abort", () => { read.aborted = true; }, { once: true });
        f.reads.push(read);
        const promise = new Promise((resolve, reject) => {
          const finish = () => {
            if (plan.reject) reject(plan.error);
            else resolve({ data: plan.error ? null : (Object.hasOwn(plan, "data") ? plan.data : (kind === "rpc" ?
              { can_review: true, can_review_own: false, is_participant: false, reason: "ready" } :
              [{ id: "task-a", created_by: "owner-a", assignee_id: "owner-a", status: "waiting_confirmation" }])),
              error: plan.error ?? null, status: plan.status ?? (plan.error ? 400 : 200) });
          };
          if (plan.hold) f.pending.push(finish); else finish();
        });
        return promise.then(ok, fail);
      };
      return q;
    };
  }, { mode, initial });
  await page.addScriptTag({ content: code });
  const idle = () => page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify((window as any).fixture.state)));
  const refresh = async (plan: any) => {
    await page.evaluate(plan => { const f = (window as any).fixture; f.plans.push(plan); f.refetch(); }, plan);
    await idle();
  };
  const release = async () => {
    await page.evaluate(() => (window as any).fixture.pending.shift()?.());
    await idle();
  };
  await idle();
  return { page, idle, state, refresh, release, logs, async close() {
    try {
      await page.evaluate(() => (window as any).fixture.detach());
      assert.deepEqual(network, [], "fixture must never reach a backend");
      assert.deepEqual(faults, []);
    } finally { await context.close(); }
  } };
}

test("list control: literal assigned caller/filter/order/limit reach the read boundary", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.state()).tasks[0].id, "task-a");
    const reads = await f.page.evaluate(() => (window as any).fixture.reads);
    assert.equal(reads[0].name, "tasks");
    assert.deepEqual(reads[0].operations.slice(1), [
      ["order", "priority", { ascending: false }], ["order", "updated_at", { ascending: false }],
      ["limit", 200], ["eq", "assignee_id", "owner-a"],
    ]);
    assert.equal((await f.state()).view, "ready");
  } finally { await f.close(); }
});

for (const error of [{ code: "42501" }, { code: "PGRST301" }, { code: "PGRST302" }, { code: "PGRST303" },
  { status: 401 }, { statusCode: 403 }]) test("explicit authorization refusal retires list " + JSON.stringify(error), async () => {
  const f = await fixture();
  try {
    await f.refresh({ error: { ...error, message: "FICTIONAL_PRIVATE_ERROR" } });
    assert.deepEqual((await f.state()).tasks, []);
    assert.equal((await f.state()).view, "unavailable");
    assert.ok(!f.logs.join(" ").includes("FICTIONAL_PRIVATE_ERROR"));
    await f.refresh({ data: [{ id: "recovered" }] });
    assert.equal((await f.state()).tasks[0].id, "recovered");
  } finally { await f.close(); }
});

test("outer HTTP403 without a typed body retires the list", async () => {
  const f = await fixture();
  try {
    await f.refresh({ status: 403, error: { message: "FICTIONAL_PRIVATE_ERROR" } });
    assert.deepEqual((await f.state()).tasks, []);
    assert.equal((await f.state()).view, "unavailable");
  } finally { await f.close(); }
});

for (const plan of [{ error: { code: "57014" } }, { error: { code: "PGRST300" } }, { reject: true }]) {
  test("transient failure retains same-owner rows and finishes loading " + JSON.stringify(plan), async () => {
    const f = await fixture();
    try {
      await f.refresh(plan);
      assert.equal((await f.state()).tasks[0].id, "task-a");
      assert.equal((await f.state()).loading, false);
      assert.equal((await f.state()).view, "stale");
    } finally { await f.close(); }
  });
}

for (const transition of ["logout", "account", "session", "disable", "filter"]) {
  test("rows retire before next answer on " + transition, async () => {
    const f = await fixture();
    try {
      await f.page.evaluate(transition => {
        const f = (window as any).fixture;
        f.plans.push({ hold: true, data: [{ id: "new-owner" }] });
        if (transition === "logout") f.owner(null);
        else if (transition === "account") f.owner("owner-b");
        else if (transition === "session") f.owner("owner-a");
        else { if (transition === "disable") f.enabled = false; else f.filter = { mine: "created" }; f.render(); }
      }, transition);
      assert.deepEqual((await f.state()).tasks, []);
    } finally { await f.close(); }
  });
}

test("an older success cannot resurrect rows after a newer denial", async () => {
  const f = await fixture();
  try {
    await f.refresh({ hold: true, data: [{ id: "retired" }] });
    await f.refresh({ error: { code: "42501" } });
    await f.release();
    assert.deepEqual((await f.state()).tasks, []);
  } finally { await f.close(); }
});

test("an older denial cannot erase a newer permitted result", async () => {
  const f = await fixture();
  try {
    await f.refresh({ hold: true, error: { code: "42501" } });
    await f.refresh({ data: [{ id: "newer" }] });
    await f.release();
    assert.equal((await f.state()).tasks[0].id, "newer");
    assert.equal((await f.state()).view, "ready");
  } finally { await f.close(); }
});

test("review access asks only the authoritative readonly RPC with the exact task id", async () => {
  const f = await fixture("review");
  try {
    assert.equal((await f.state()).canReview, true);
    assert.equal((await f.state()).canReviewOwn, false);
    assert.equal((await f.state()).reason, "ready");
    assert.deepEqual(await f.page.evaluate(() => (window as any).fixture.reads), [
      { kind: "rpc", name: "task_review_access", args: { p_task_id: "task-a" }, operations: [], aborted: false },
    ]);
  } finally { await f.close(); }
});

for (const plan of [{ data: null }, { data: "true" }, { data: 1 },
  { data: { can_review: "true", can_review_own: true, is_participant: false, reason: "ready" } },
  { data: { can_review: true, can_review_own: false, is_participant: false, reason: "status" } },
  { data: { can_review: true, can_review_own: false, is_participant: true, reason: "ready" } },
  { error: { code: "42501", message: "FICTIONAL_PRIVATE_ERROR" } }, { reject: true }]) {
  test("review access fails closed for " + JSON.stringify(plan), async () => {
    const f = await fixture("review", plan);
    try {
      assert.equal((await f.state()).canReview, false);
      assert.equal((await f.state()).canReviewOwn, false);
      assert.equal((await f.state()).checking, false);
      assert.ok((await f.state()).error);
      assert.ok(!JSON.stringify(await f.state()).includes("FICTIONAL_PRIVATE_ERROR"));
      assert.ok(!f.logs.join(" ").includes("FICTIONAL_PRIVATE_ERROR"));
    } finally { await f.close(); }
  });
}

for (const transition of ["task", "account", "session", "updatedAt", "rolesKey", "disable", "logout"]) {
  test("review access resets and aborts the old answer on " + transition, async () => {
    const f = await fixture("review", { hold: true });
    try {
      assert.equal((await f.state()).canReview, false);
      assert.equal((await f.state()).checking, true);
      await f.page.evaluate(transition => {
        const f = (window as any).fixture;
        f.plans.push({ data: { can_review: false, can_review_own: false, is_participant: false, reason: "unavailable" } });
        if (transition === "account") f.owner("owner-b");
        else if (transition === "session") f.owner("owner-a");
        else if (transition === "logout") f.owner(null);
        else {
          if (transition === "task") f.taskId = "task-b";
          else if (transition === "disable") f.enabled = false;
          else f[transition] = "revision-2";
          f.render();
        }
      }, transition);
      await f.idle();
      await f.release();
      assert.equal((await f.state()).canReview, false);
      const reads = await f.page.evaluate(() => (window as any).fixture.reads);
      assert.equal(reads[0].aborted, true);
      assert.equal(reads.length, ["disable", "logout"].includes(transition) ? 1 : 2);
      if (transition === "task") assert.equal(reads[1].args.p_task_id, "task-b");
    } finally { await f.close(); }
  });
}

for (const reason of ["self_review", "status", "unavailable"]) {
  test("authoritative refusal preserves its reason " + reason, async () => {
    const f = await fixture("review", { data: { can_review: false, can_review_own: false, is_participant: reason === "self_review", reason } });
    try {
      assert.equal((await f.state()).canReview, false);
      assert.equal((await f.state()).reason, reason);
      assert.equal((await f.state()).error, null);
    } finally { await f.close(); }
  });
}

test("authoritative self-review capability is returned as data, not inferred from a role", async () => {
  const f = await fixture("review", { data: { can_review: true, can_review_own: true, is_participant: true, reason: "ready" } });
  try {
    assert.equal((await f.state()).canReview, true);
    assert.equal((await f.state()).canReviewOwn, true);
    assert.equal((await f.state()).isParticipant, true);
  } finally { await f.close(); }
});

async function lateReviewCannotGrant(f: any) {
  await f.refresh({ data: { can_review: false, can_review_own: false, is_participant: false, reason: "unavailable" } });
  await f.release();
  assert.equal((await f.state()).canReview, false);
}

test("an older review response cannot grant access after a newer refused retry", async () => {
  const f = await fixture("review", { hold: true });
  try { await lateReviewCannotGrant(f); } finally { await f.close(); }
});

test("a granted review answer is cleared while a changed permission key is pending", async () => {
  const f = await fixture("review");
  try {
    assert.equal((await f.state()).canReview, true);
    await f.page.evaluate(() => {
      const f = (window as any).fixture;
      f.plans.push({ hold: true }); f.rolesKey = "revoked-permission"; f.render();
    });
    assert.equal((await f.state()).canReview, false);
    assert.equal((await f.state()).checking, true);
  } finally { await f.close(); }
});

test("permission-loading completion can recover an earlier refusal without a task revision", async () => {
  const f = await fixture("review", { data: { can_review: false, can_review_own: false, is_participant: false, reason: "unavailable" } });
  try {
    assert.equal((await f.state()).canReview, false);
    await f.page.evaluate(() => {
      const f = (window as any).fixture;
      f.rolesKey = "permissions-ready"; f.render();
    });
    await f.idle();
    assert.equal((await f.state()).canReview, true);
    assert.equal(await f.page.evaluate(() => (window as any).fixture.reads.length), 2);
  } finally { await f.close(); }
});

test("an AbortError finishes the current review read without retaining a prior grant", async () => {
  const f = await fixture("review");
  try {
    await f.refresh({ reject: true, error: { name: "AbortError" } });
    assert.equal((await f.state()).canReview, false);
    assert.equal((await f.state()).checking, false);
    assert.ok((await f.state()).error);
  } finally { await f.close(); }
});

test("compiled omission of the review response fence is caught by the same late-answer assertion", async () => {
  const code = await compileFixture({ before: "if (!isCurrent()) return;", after: "" });
  const f = await fixture("review", { hold: true }, code);
  try { await assert.rejects(() => lateReviewCannotGrant(f), { code: "ERR_ASSERTION" }); }
  finally { await f.close(); }
});

test("compiled unconditional review grant is caught by the literal false assertion", async () => {
  const code = await compileFixture({ before: "canReview: value.can_review,", after: "canReview: true," });
  const f = await fixture("review", { data: { can_review: false, can_review_own: false, is_participant: true, reason: "self_review" } }, code);
  try {
    await assert.rejects(async () => assert.equal((await f.state()).canReview, false), { code: "ERR_ASSERTION" }); }
  finally { await f.close(); }
});
