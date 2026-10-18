import assert from "node:assert/strict";
import test from "node:test";
import { compileFixture, mountFixture, requireKub } from "../helpers/task-detail-fixture.cjs";

const { chromium } = requireKub("@playwright/test");
let browser: any, bundle: any;
const tables = ["tasks", "task_events", "task_checklist_items"];
const reads = ["tasks", "task_events", "task_checklist_items", "task_reminders"];

test.before(async () => { bundle = await compileFixture(); browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function settle(page: any) {
  // React's scheduler runs on MessageChannel, independently of the paused debounce clock.
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise<void>(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
      channel.port2.postMessage(null);
    });
  });
}

async function fixture(options: any = {}, code = bundle) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.clock.install({ time: 1_700_000_000_000 });
  await page.clock.pauseAt(1_700_000_060_000);
  await page.addInitScript(() => {
    const schedule = window.setTimeout, cancel = window.clearTimeout;
    const timers = (window as any).taskTimers = { scheduled: 0, pending: new Set<number>() };
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: any[]) => {
      if (delay !== 250 || typeof callback !== "function") return schedule(callback, delay, ...args);
      timers.scheduled++;
      const id = schedule(() => { timers.pending.delete(id); callback(...args); }, delay);
      timers.pending.add(id); return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = id => { timers.pending.delete(id!); cancel(id); };
  });
  const f = await mountFixture(page, code, { ...options, autoSubscribe: false });
  await settle(page);
  return { ...f,
    async status(status = "SUBSCRIBED", table?: string) {
      await page.evaluate(({ status, table }: any) => {
        for (const channel of window.fixture.channels.filter((c: any) => c.active))
          if (!table || channel.handlers.some((h: any) => h.filter.table === table)) channel.status(status);
      }, { status, table });
      await settle(page);
    },
    async advance(ms: number) { await page.clock.runFor(ms); await settle(page); },
    async count() { return page.evaluate(() => window.fixture.batches.length); },
    async latest(title = "Fictional offline revision") {
      await page.evaluate(title => {
        const f = window.fixture, original = f.rows;
        f.rows = (table: string, id: string) => table === "tasks" ? f.task(id, title) : original(table, id);
      }, title);
    },
    async close() { try { await f.close(); } finally { await context.close(); } },
  };
}

async function missedOfflineUpdate(f: any) {
  await f.status(); await f.advance(250);
  const before = await f.count();
  await f.status("CHANNEL_ERROR");
  await f.latest(); // Backend changes without delivering any CDC row callback.
  await f.status("SUBSCRIBED", "tasks");
  await f.status("SUBSCRIBED", "task_events");
  await f.status("SUBSCRIBED", "task_checklist_items");
  await f.advance(249);
  assert.equal(await f.count(), before, "catch-up must use the existing literal 250ms debounce");
  await f.advance(1);
  assert.equal(await f.count(), before + 1, "three rejoined bindings must catch an update missed offline");
  assert.equal((await f.state()).task.title, "Fictional offline revision");
  assert.deepEqual(await f.page.evaluate(() => window.fixture.reads.slice(-4)), reads.map(table => ({ table, id: "task-a" })));
  await f.advance(1000);
  assert.equal(await f.count(), before + 1, "pending join callbacks coalesce, not three independent fetches");
}

test("actual hook catches a missed offline task update with one postjoin parent and ancillary read", async () => {
  const f = await fixture();
  try { await missedOfflineUpdate(f); } finally { await f.close(); }
});

for (const last of tables) test("catch-up waits for all distinct bindings when last is " + last, async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.page.evaluate(() => window.fixture.channels.map((c: any) => c.handlers.map((h: any) => h.filter))), [
      [{ event: "*", schema: "public", table: "tasks", filter: "id=eq.task-a" }],
      [{ event: "INSERT", schema: "public", table: "task_events", filter: "task_id=eq.task-a" }],
      [{ event: "*", schema: "public", table: "task_checklist_items", filter: "task_id=eq.task-a" }],
    ]);
    const first = tables.filter(table => table !== last);
    await f.status("SUBSCRIBED", first[0]);
    await f.advance(300);
    await f.status("SUBSCRIBED", first[0]); // Duplicate is not a third binding.
    await f.status("SUBSCRIBED", first[1]);
    await f.advance(300);
    assert.equal(await f.count(), 1, "a partial join must not stand in for the complete join barrier");
    await f.latest();
    await f.status("SUBSCRIBED", last);
    await f.advance(250);
    assert.equal(await f.count(), 2, "a completed prejoin read cannot replace postjoin revalidation");
    assert.equal((await f.state()).task.title, "Fictional offline revision");
  } finally { await f.close(); }
});

test("a successful CDC read before the last join does not consume its later catch-up", async () => {
  const f = await fixture();
  try {
    await f.status("SUBSCRIBED", "tasks"); await f.status("SUBSCRIBED", "task_events");
    await f.page.evaluate(() => window.fixture.deliver());
    await f.advance(250); assert.equal(await f.count(), 2);
    await f.latest("Fictional newer postjoin revision");
    await f.status("SUBSCRIBED", "task_checklist_items");
    await f.advance(250);
    assert.equal(await f.count(), 3, "no TTL suppression after a successful prejoin read");
    assert.equal((await f.state()).task.title, "Fictional newer postjoin revision");
  } finally { await f.close(); }
});

test("pending CDC and join callbacks coalesce at the last callback's debounce deadline", async () => {
  const f = await fixture();
  try {
    await f.status("SUBSCRIBED", "tasks"); await f.status("SUBSCRIBED", "task_events");
    await f.page.evaluate(() => window.fixture.deliver());
    await f.advance(200); await f.latest();
    await f.status("SUBSCRIBED", "task_checklist_items");
    await f.advance(249); assert.equal(await f.count(), 1);
    await f.advance(1); assert.equal(await f.count(), 2);
    await f.advance(1000); assert.equal(await f.count(), 2);
  } finally { await f.close(); }
});

test("a second reconnect immediately after a successful catch-up still revalidates", async () => {
  const f = await fixture();
  try {
    await f.status(); await f.advance(250); const before = await f.count();
    await f.status("TIMED_OUT"); await f.latest(); await f.status(); await f.advance(250);
    assert.equal(await f.count(), before + 1);
    assert.equal((await f.state()).task.title, "Fictional offline revision");
  } finally { await f.close(); }
});

for (const kind of ["task", "session", "account", "unmount"]) test("late retired join/row callbacks queue no work after " + kind, async () => {
  const f = await fixture();
  try {
    await f.status(); // Leave a catch-up pending so cleanup must cancel it.
    const before = await f.page.evaluate(kind => {
      const f = window.fixture; f.retired = f.channels.slice();
      if (kind === "task") f.render("task-b");
      else if (kind === "session") f.owner("owner-a", "session-2");
      else if (kind === "account") f.owner("owner-b", "session-b");
      else f.detach();
      return { scheduled: (window as any).taskTimers.scheduled, reads: f.reads.length };
    }, kind);
    await settle(f.page);
    assert.equal(await f.page.evaluate(() => (window as any).taskTimers.pending.size), 0, "cleanup cancels pending debounce");
    await f.page.evaluate(() => {
      for (const channel of window.fixture.retired) {
        channel.status("SUBSCRIBED");
        for (const binding of channel.handlers) binding.callback({ new: { id: "task-a" } });
      }
    });
    assert.equal(await f.page.evaluate(() => (window as any).taskTimers.scheduled), before.scheduled,
      "old channel callbacks cannot even queue a timer for the retired effect");
    const readsBefore = await f.page.evaluate(() => window.fixture.reads.length);
    await f.advance(250);
    assert.equal(await f.page.evaluate(() => window.fixture.reads.length), readsBefore);
  } finally { await f.close(); }
});

test("postjoin refresh preserves actual checklist/comment draft nodes while the real response is held", async () => {
  const f = await fixture({ mode: "modal" });
  try {
    await f.page.getByTestId("task-checklist-draft").fill("Fictional reconnect checklist draft");
    await f.page.getByPlaceholder("Оставьте комментарий…").fill("Fictional reconnect comment draft");
    await f.page.evaluate(() => {
      const f = window.fixture;
      f.drafts = [document.querySelector('[data-testid="task-checklist-draft"]'), document.querySelector('textarea[placeholder="Оставьте комментарий…"]')];
      f.enqueue({ hold: true });
    });
    await f.status(); await f.advance(250);
    assert.equal(await f.count(), 2);
    assert.deepEqual(await f.page.evaluate(() => window.fixture.drafts.map((node: any) => node.isConnected)), [true, true]);
    assert.equal(await f.page.getByTestId("task-checklist-draft").inputValue(), "Fictional reconnect checklist draft");
    assert.equal(await f.page.getByPlaceholder("Оставьте комментарий…").inputValue(), "Fictional reconnect comment draft");
    await f.release(1); await settle(f.page);
    assert.deepEqual(await f.page.evaluate(() => [document.querySelector('[data-testid="task-checklist-draft"]'),
      document.querySelector('textarea[placeholder="Оставьте комментарий…"]')].map((node, i) => node === window.fixture.drafts[i])), [true, true]);
  } finally { await f.close(); }
});

const omissions = [
  { name: "postjoin catch-up", before: "if (joined.size === 3) debouncedFetch();", after: "",
    check: missedOfflineUpdate },
  { name: "all-three barrier", before: "joined.size === 3", after: "joined.size === 2",
    async check(f: any) {
      await f.status("SUBSCRIBED", "tasks"); await f.status("SUBSCRIBED", "task_events");
      await f.advance(250); assert.equal(await f.count(), 1, "partial join cannot release catch-up");
    } },
  { name: "literal debounce deadline", before: "      }, 250);", after: "      }, 249);",
    check: missedOfflineUpdate },
  { name: "retired-effect active gate", before: "      active = false;\n      if (timer) clearTimeout(timer);",
    after: "      if (timer) clearTimeout(timer);",
    async check(f: any) {
      const scheduled = await f.page.evaluate(() => {
        const f = window.fixture; f.retired = f.channels.slice(); f.detach();
        return (window as any).taskTimers.scheduled;
      });
      await f.page.evaluate(() => {
        for (const channel of window.fixture.retired) {
          channel.status("SUBSCRIBED");
          for (const binding of channel.handlers) binding.callback({ new: { id: "task-a" } });
        }
      });
      assert.equal(await f.page.evaluate(() => (window as any).taskTimers.scheduled), scheduled,
        "cleanup must prevent old callbacks from queuing work, not just fence the eventual read");
    } },
];

for (const change of omissions) test("compiled reconnect omission is detected: " + change.name, async () => {
  const f = await fixture({}, await compileFixture({ change: { file: "hooks/useTask.ts", ...change } }));
  try { await assert.rejects(() => change.check(f), { code: "ERR_ASSERTION" }); }
  finally { await f.close(); }
});
