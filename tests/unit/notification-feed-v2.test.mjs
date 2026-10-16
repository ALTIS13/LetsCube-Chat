import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const path = new URL("../../artifacts/kub/src/lib/notificationFeedV2.ts", import.meta.url);
const source = existsSync(path) ? readFileSync(path, "utf8").replaceAll("\r\n", "\n") : "";
function compile(text = source) {
  const module = { exports: {} };
  const result = ts.transpileModule(text, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports, Date, Promise, Set, Map, Object, JSON });
  return module.exports;
}
const api = compile();
const decisionApi = compile(readFileSync(new URL("../../artifacts/kub/src/lib/messageAlertDecisions.ts", import.meta.url), "utf8"));
const UID = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const SESSION = "20000000-0000-4000-8000-000000000001";
const A = "30000000-0000-4000-8000-000000000001";
const B = "30000000-0000-4000-8000-000000000002";
const C = "30000000-0000-4000-8000-000000000003";
const MARKER = "40000000-0000-4000-8000-000000000001";
const OTHER_MARKER = "40000000-0000-4000-8000-000000000002";
const TIME = "2026-10-17T00:00:01.123456+00:00";
const READ = "2026-10-17T00:00:02.000000+00:00";
const owner = () => ({ userId: UID, sessionId: SESSION, accountEpoch: 7 });
const plain = value => JSON.parse(JSON.stringify(value));
const row = (id = A, changes = {}) => ({ id, user_id: UID, kind: "message", payload: { preview: "fictional" },
  read_at: null, alert_suppressed_at: null, feed_revision: 1, created_at: TIME, ...changes });
const page = (rows = [], next = null) => ({ v: 2, rows, next });
const lookup = (rows = [], unavailable_ids = []) => ({ v: 2, rows, unavailable_ids });
const opened = (rows = [], held = [], marker = MARKER) => ({ v: 2, barrier_event_id: marker, page: page(rows),
  lookup: lookup(rows.filter(r => held.includes(r.id)), held.filter(id => !rows.some(r => r.id === id))) });
let eventNo = 10;
const event = (kind = "created", id = A, options = {}) => ({
  event_id: `40000000-0000-4000-8000-${String(++eventNo).padStart(12, "0")}`,
  recipient_id: UID, notification_id: id, event_kind: kind, created_at: TIME, ...options,
});
const marker = (id = MARKER) => event("invalidate", null, { event_id: id });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function drain() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function fixture(module = api, initial = []) {
  const opens = [], pages = [], lookups = [], subscriptions = [], frames = [], alerts = [], resyncs = [];
  let current = owner();
  const ports = {
    isCurrent: captured => Object.keys(captured).every(key => captured[key] === current?.[key]),
    subscribe(receive, status) { const sub = { receive, status, closed: false }; subscriptions.push(sub); return () => { sub.closed = true; }; },
    open(args) { const d = deferred(); opens.push({ args: plain(args), ...d }); return d.promise; },
    page(args) { const d = deferred(); pages.push({ args: plain(args), ...d }); return d.promise; },
    lookup(args) {
      const d = deferred(); lookups.push({ args: plain(args), ...d });
      assert.ok(args.p_ids.length >= 1 && args.p_ids.length <= 100, "server lookup requires 1..100 input IDs");
      return d.promise;
    },
    onRows(rows) { frames.push(plain(rows)); },
    onCreated(value, isCurrent) { alerts.push({ row: plain(value), isCurrent }); },
    onResync(reason) { resyncs.push(reason); },
  };
  const feed = module.createNotificationFeedV2(owner(), ports, initial);
  const f = { feed, opens, pages, lookups, subscriptions, frames, alerts, resyncs,
    get sub() { return subscriptions.at(-1); },
    change(changes) { current = changes === null ? null : { ...current, ...changes }; },
    async ready(rows = []) { f.sub.status("SUBSCRIBED"); await drain(); opens.at(-1).resolve(opened(rows, initial.map(r => r.id))); f.sub.receive(marker()); await drain(); },
    async answer(rows = [], unavailable) {
      const pending = lookups.at(-1);
      pages.at(-1).resolve(page([...rows].sort((a, b) => b.id.localeCompare(a.id))));
      pending.resolve(lookup(rows.filter(r => pending.args.p_ids.includes(r.id)), unavailable ?? pending.args.p_ids.filter(id => !rows.some(r => r.id === id))));
      await drain();
    },
  };
  return f;
}

test("actual compiled module supplies strict parser and owned feed, not a fallback implementation", () => {
  assert.equal(typeof api.parseNotificationFeedOpenV2, "function", "missing v2 feature");
  assert.equal(typeof api.createNotificationFeedV2, "function", "missing owned handshake");
});

test("page accepts exact eight fields, submillisecond descending order and exact display cursor", () => {
  const rows = [row(B), row(A, { created_at: "2026-10-17T00:00:01.123455+00:00" })];
  const result = api.parseNotificationFeedPageV2(page(rows, { created_at: rows[1].created_at, id: A }), UID);
  assert.deepEqual(plain(result), page(rows, { created_at: rows[1].created_at, id: A }));
  assert.equal(Object.isFrozen(result.rows[0].payload), true);
});

test("page accepts literal 30 rows but refuses 31, duplicates, tie disorder and forged next", () => {
  const rows = Array.from({ length: 31 }, (_, n) => row(`30000000-0000-4000-8000-${String(100 - n).padStart(12, "0")}`));
  assert.equal(api.parseNotificationFeedPageV2(page(rows.slice(0, 30)), UID).rows.length, 30);
  for (const value of [page(rows), page([row(), row()]), page([row(A), row(B)]),
    page([row()], { id: B, created_at: TIME }), page([], { id: A, created_at: TIME })]) {
    assert.throws(() => api.parseNotificationFeedPageV2(value, UID), /notification_feed_v2/);
  }
});

test("row parser refuses foreign identity, missing terminal fields, non-JSON and malformed timestamps", () => {
  const missing = row(); delete missing.alert_suppressed_at;
  for (const value of [row(A, { user_id: OTHER }), row("bad"), row(A, { read_at: false }), missing,
    row(A, { created_at: "2026-02-30T00:00:00Z" }), row(A, { payload: { bad: undefined } }),
    row(A, { payload: { bad: NaN } }), row(A, { kind: "" }), { ...row(), unexpected: true },
    { ...row(), alert_origin: null }]) {
    assert.throws(() => api.parseNotificationFeedPageV2(page([value]), UID), /notification_feed_v2/);
  }
  for (const value of [null, [], { ...page(), v: 1 }, { ...page(), error: null }])
    assert.throws(() => api.parseNotificationFeedPageV2(value, UID), /notification_feed_v2/);
});

test("lookup exact requested partition: literal100 accepted,101 refused before dedupe", () => {
  const ids = Array.from({ length: 100 }, (_, n) => `30000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`);
  assert.equal(api.parseNotificationFeedLookupV2(lookup([], ids), UID, ids).unavailable_ids.length, 100);
  assert.throws(() => api.parseNotificationFeedLookupV2(lookup([], [A]), UID, Array(101).fill(A)), /notification_feed_v2/);
  assert.deepEqual(plain(api.parseNotificationFeedLookupV2(lookup([row()], [B]), UID, [A, A, B])), lookup([row()], [B]));
  for (const value of [lookup(), lookup([row()], [A]), lookup([], [A, A]), lookup([row(B)]), lookup([], [C])])
    assert.throws(() => api.parseNotificationFeedLookupV2(value, UID, [A]), /notification_feed_v2/);
});

test("open refuses contradictions; event uses four kinds and own marker carries null notification", () => {
  assert.equal(api.parseNotificationFeedOpenV2(opened([row()], [A]), UID, [A]).barrier_event_id, MARKER);
  assert.throws(() => api.parseNotificationFeedOpenV2({ ...opened([row()], [A]), lookup: lookup([], [A]) }, UID, [A]), /notification_feed_v2/);
  for (const value of [marker(), event("created"), event("changed"), event("removed")])
    assert.equal(api.parseNotificationFeedEventV2(value, UID).event_kind, value.event_kind);
  for (const value of [event("barrier", null), event("created", null), event("invalidate", A),
    event("created", A, { recipient_id: OTHER }), { ...marker(), payload: "forbidden" }])
    assert.throws(() => api.parseNotificationFeedEventV2(value, UID), /notification_feed_v2/);
});

test("subscribe owns callback before open; no open before SUBSCRIBED", async () => {
  const f = fixture(); assert.equal(f.subscriptions.length, 1); assert.equal(f.opens.length, 0);
  f.sub.receive(event()); assert.equal(f.opens.length, 0);
  f.sub.status("SUBSCRIBED"); await drain(); assert.deepEqual(f.opens[0].args, { p_limit: 30, p_held_ids: [] });
  f.feed.dispose(); assert.equal(f.sub.closed, true);
});

for (const first of ["marker", "response"]) test(`${first} first: only ordered post-marker creation alerts after both prerequisites`, async () => {
  const f = fixture(); f.sub.status("SUBSCRIBED"); await drain();
  f.sub.receive(event("created", A));
  if (first === "response") { f.opens[0].resolve(opened()); await drain(); }
  f.sub.receive(marker()); f.sub.receive(event("created", B, { created_at: "2000-01-01T00:00:00Z" }));
  await drain(); assert.equal(f.alerts.length, 0);
  if (first === "marker") f.opens[0].resolve(opened());
  await drain(); await f.answer([row(B), row(A)]);
  assert.deepEqual(f.alerts.map(a => a.row.id), [B]); assert.equal(f.alerts[0].isCurrent(), true);
});

test("snapshot/unknown changed/other-document marker never create an alert or another open", async () => {
  const f = fixture(); await f.ready([row()]);
  f.sub.receive(marker(OTHER_MARKER)); f.sub.receive(event("changed", B)); await drain();
  await f.answer([row(B), row()]);
  assert.equal(f.opens.length, 1); assert.equal(f.alerts.length, 0); assert.equal(f.feed.rows().length, 2);
});

test("delayed commit with old timestamp after handshake is live; read or terminal rows are never admitted", async () => {
  const f = fixture(); await f.ready();
  f.sub.receive(event("created", A, { created_at: "2000-01-01T00:00:00Z" })); await drain(); await f.answer([row()]);
  f.sub.receive(event("created", B)); await drain(); await f.answer([row(B, { read_at: READ })]);
  f.sub.receive(event("created", C)); await drain(); await f.answer([row(C, { alert_suppressed_at: READ })]);
  assert.deepEqual(f.alerts.map(a => a.row.id), [A]);
});

test("one coalesced reader discards held pre-scrub response, then publishes only fresh scrubbed payload", async () => {
  const f = fixture(); await f.ready([row()]); f.sub.receive(event("changed", A)); await drain();
  f.sub.receive(event("changed", A)); f.sub.receive(event("changed", A)); await drain();
  assert.equal(f.pages.length, 1); await f.answer([row()]);
  assert.equal(f.frames.length, 1, "stale payload must not publish"); assert.equal(f.pages.length, 2);
  await f.answer([row(A, { feed_revision: 2, payload: { preview: null, deleted: true }, alert_suppressed_at: READ })]);
  assert.deepEqual(plain(f.feed.rows()[0].payload), { preview: null, deleted: true });
  assert.equal(f.alerts.length, 0);
});

test("late read cannot restore confirmed read/terminal state; confirmation invalidates outstanding alert permit", async () => {
  const f = fixture(); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent;
  f.sub.receive(event("changed", A)); await drain();
  f.feed.confirm([row(A, { feed_revision: 2, read_at: READ, alert_suppressed_at: READ, payload: { preview: null, deleted: true } })]);
  assert.equal(permit(), false);
  await f.answer([row()]); assert.equal(f.feed.rows()[0].read_at, READ);
  await f.answer([row()]);
  assert.equal(f.feed.rows()[0].read_at, READ); assert.equal(f.feed.rows()[0].alert_suppressed_at, READ);
  assert.deepEqual(plain(f.feed.rows()[0].payload), { preview: null, deleted: true });
});

test("partial page absence retains held item; exact unavailable retires it and held old reply cannot resurrect", async () => {
  const f = fixture(); await f.ready([row()]); f.sub.receive(marker(OTHER_MARKER)); await drain();
  assert.deepEqual(f.lookups[0].args, { p_ids: [A] });
  f.pages[0].resolve(page()); f.lookups[0].resolve(lookup([row()])); await drain();
  assert.equal(f.feed.rows()[0].id, A);
  f.sub.receive(event("removed", A)); await drain(); await f.answer([], [A]);
  assert.deepEqual(plain(f.feed.rows()), []); assert.equal(f.alerts.length, 0);
});

for (const change of [{ userId: OTHER }, { sessionId: OTHER }, { accountEpoch: 8 }, null])
  test(`owner fence drops old open and stream: ${JSON.stringify(change)}`, async () => {
    const f = fixture(); f.sub.status("SUBSCRIBED"); await drain(); f.change(change);
    f.opens[0].resolve(opened([row()])); f.sub.receive(marker()); f.sub.receive(event()); await drain();
    assert.equal(f.frames.length, 0); assert.equal(f.alerts.length, 0); assert.equal(f.pages.length, 0);
    assert.deepEqual(plain(f.feed.rows()), []);
  });

test("gap/restart invalidates old callbacks and no buffered creation replays", async () => {
  const f = fixture(); await f.ready(); f.sub.receive(event()); await drain(); const old = f.sub;
  old.status("CHANNEL_ERROR"); assert.deepEqual(f.resyncs, ["gap"]); assert.equal(old.closed, true);
  f.feed.restart(); f.sub.status("SUBSCRIBED"); await drain();
  f.opens[1].resolve(opened([row()])); f.sub.receive(marker()); await drain();
  old.receive(event("created", B)); f.pages[0].resolve(page([row()])); f.lookups[0].resolve(lookup([row()])); await drain();
  assert.equal(f.alerts.length, 0); assert.equal(f.pages.length, 1);
});

test("literal512 buffered signals accepted;513 refuses quietly with no retry spin", async () => {
  const f = fixture(); f.sub.status("SUBSCRIBED"); await drain();
  for (let i = 0; i < 512; i++) f.sub.receive(marker(OTHER_MARKER));
  assert.deepEqual(f.resyncs, []); f.sub.receive(marker(OTHER_MARKER));
  assert.deepEqual(f.resyncs, ["overflow"]); assert.equal(f.sub.closed, true);
  f.opens[0].resolve(opened([row()])); await drain(); assert.equal(f.frames.length, 0); assert.equal(f.opens.length, 1);
});

test("malformed event/open and failed reads fail closed, never become unavailable or fallback", async () => {
  const f = fixture(); f.sub.receive({ ...marker(), recipient_id: OTHER }); assert.deepEqual(f.resyncs, ["protocol"]);
  const g = fixture(); g.sub.status("SUBSCRIBED"); await drain(); g.opens[0].resolve({ ...opened(), v: 1 }); await drain();
  assert.deepEqual(g.resyncs, ["protocol"]);
  const h = fixture(); await h.ready([row()]); h.sub.receive(event("created", B)); await drain();
  h.pages[0].reject(new Error("fictional offline")); h.lookups[0].resolve(lookup([row()], [B])); await drain();
  assert.deepEqual(h.resyncs, ["read_error"]); assert.equal(h.feed.rows()[0].id, A); assert.equal(h.alerts.length, 0);
});

test("dispose invalidates queued alert predicate and all held completions", async () => {
  const f = fixture(); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  f.feed.dispose(); assert.equal(f.alerts[0].isCurrent(), false); assert.equal(f.sub.closed, true);
});

test("source kind reclassification updates retained feed quietly without reopening read state", async () => {
  const f = fixture(); await f.ready([row(A, { read_at: READ })]);
  f.sub.receive(event("changed", A)); await drain();
  await f.answer([row(A, { feed_revision: 2, kind: "chat_added" })]);
  assert.deepEqual(f.resyncs, []); assert.equal(f.feed.rows()[0].kind, "chat_added");
  assert.equal(f.feed.rows()[0].read_at, READ); assert.equal(f.alerts.length, 0);
});

test("duplicate created signal for a retained row cannot sound twice", async () => {
  const f = fixture(); await f.ready(); const signal = event(); f.sub.receive(signal); await drain(); await f.answer([row()]);
  f.sub.receive(signal); await drain(); await f.answer([row()]);
  assert.deepEqual(f.alerts.map(a => a.row.id), [A]);
});

test("open response alone or foreign marker alone never enables creation admission", async () => {
  const f = fixture(); f.sub.status("SUBSCRIBED"); await drain(); f.opens[0].resolve(opened()); await drain();
  f.sub.receive(marker(OTHER_MARKER)); f.sub.receive(event()); await drain();
  assert.equal(f.pages.length, 0); assert.equal(f.frames.length, 0); assert.equal(f.alerts.length, 0);
  f.feed.timeout(); assert.deepEqual(f.resyncs, ["timeout"]);
});

test("old same-owner reader completion cannot clear or publish over restarted reader", async () => {
  const f = fixture(); await f.ready(); f.sub.receive(event("changed", A)); await drain();
  const oldPage = f.pages[0], oldLookup = f.lookups[0];
  f.feed.restart(); f.sub.status("SUBSCRIBED"); await drain(); f.opens[1].resolve(opened()); f.sub.receive(marker()); await drain();
  f.sub.receive(event("created", B)); await drain();
  oldPage.resolve(page([row()])); oldLookup.resolve(lookup([row()])); await drain();
  assert.equal(f.frames.length, 2); assert.equal(f.alerts.length, 0);
  f.sub.receive(event("changed", B)); await drain(); assert.equal(f.pages.length, 2);
  await f.answer([row(B)]); assert.equal(f.pages.length, 3);
  await f.answer([row(B)]); assert.deepEqual(plain(f.feed.rows().map(r => r.id)), [B]);
});

test("live target set refuses101 distinct IDs without lookup overflow or an alert", async () => {
  const f = fixture(); await f.ready();
  for (let i = 0; i < 101; i++) f.sub.receive(event("created", `30000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`));
  await drain(); assert.deepEqual(f.resyncs, ["overflow"]); assert.equal(f.pages.length, 0); assert.equal(f.alerts.length, 0);
});

test("delayed live creation older than a full page30 still enters fresh admission, never timestamp catch-up", async () => {
  const retained = Array.from({ length: 30 }, (_, n) => row(`30000000-0000-4000-8000-${String(100 - n).padStart(12, "0")}`));
  const f = fixture(); await f.ready(retained);
  f.sub.receive(event()); await drain();
  f.pages[0].resolve(page(retained));
  f.lookups[0].resolve(lookup([...retained, row(A, { created_at: "2000-01-01T00:00:00Z" })]));
  await drain();
  assert.deepEqual(f.alerts.map(a => a.row.id), [A]); assert.equal(f.alerts[0].isCurrent(), true);
  assert.equal(f.feed.rows().length, 30);
});

test("actual helper is semantically typechecked against existing database types", () => {
  const filename = path.pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const baseUrl = new URL("../../artifacts/kub/src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const program = ts.createProgram([decodeURIComponent(filename)], { strict: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: decodeURIComponent(baseUrl), paths: { "@/*": ["*"] } });
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
});

test("received invalidation immediately revokes held alert authority before terminal lookup completes", async () => {
  const f = fixture(); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent; assert.equal(permit(), true);
  f.sub.receive(event("changed", A)); assert.equal(permit(), false); await drain();
  await f.answer([row(A, { feed_revision: 2, alert_suppressed_at: READ })]); assert.equal(permit(), false);
  assert.equal(f.alerts.length, 1);
});

test("bootstrap dirty buffer never publishes the older open payload even briefly", async () => {
  const f = fixture(); f.sub.status("SUBSCRIBED"); await drain();
  f.sub.receive(event("changed", A)); f.sub.receive(marker()); f.opens[0].resolve(opened([row()])); await drain();
  assert.equal(f.frames.length, 0); await f.answer([row(A, { payload: { deleted: true, preview: null } })]);
  assert.deepEqual(f.frames.map(rows => rows[0].payload), [{ deleted: true, preview: null }]);
});

test("bounded creation memory keeps512 identities and refuses513 rather than evicting replay protection", async () => {
  const f = fixture(); await f.ready();
  let sent = 0;
  for (const count of [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 12]) {
    const ids = Array.from({ length: count }, () => `30000000-0000-4000-8000-${String(++sent).padStart(12, "0")}`);
    for (const id of ids) f.sub.receive(event("created", id)); await drain(); await f.answer([], ids);
  }
  assert.deepEqual(f.resyncs, []);
  f.sub.receive(event("created", "30000000-0000-4000-8000-000000000513"));
  assert.deepEqual(f.resyncs, ["overflow"]); assert.equal(f.alerts.length, 0);
});

for (const change of ["Y update", "Y read", "unchanged refresh"]) {
  test(`held live X authority survives ${change} without onCreated replay`, async () => {
    const f = fixture(); await f.ready([row(B)]);
    f.sub.receive(event("created", A)); await drain(); await f.answer([row(B), row()]);
    const admission = f.alerts[0], held = deferred(), effects = [];
    const decision = decisionApi.currentMessageAlertAllowed(A, admission.isCurrent, {
      rpc(name, args) {
        assert.equal(name, "message_notification_alert_decisions");
        assert.deepEqual(plain(args), { p_notification_ids: [A] }); return held.promise;
      },
    });
    assert.equal(admission.isCurrent(), true);
    if (change === "Y update") f.sub.receive(event("changed", B));
    else if (change === "Y read") f.feed.confirm([row(B, { feed_revision: 2, read_at: READ })]);
    else f.feed.refresh();
    assert.equal(admission.isCurrent(), true, "unrelated feed dirtiness must not revoke exact X");
    const y = change === "Y read" ? { feed_revision: 2, read_at: READ }
      : change === "Y update" ? { feed_revision: 2, payload: { preview: "changed Y only" } } : {};
    await drain(); await f.answer([row(B, y), row()]);
    held.resolve({ error: null, data: [{ notification_id: A, allowed: true, scope_key: "general", revision: 0 }] });
    if (await decision && admission.isCurrent()) effects.push(admission.row.payload.preview);
    assert.deepEqual(effects, ["fictional"]);
    assert.deepEqual(f.alerts.map(a => a.row.id), [A], "do not replay creation to replace a lost permit");
    f.feed.dispose();
  });
}

for (const change of ["changed", "removed", "read", "terminal", "scrub", "payload", "kind", "unavailable", "account", "gap", "invalidate"]) {
  test(`held live X rejects ${change} before authority completion and cannot publish old payload`, async () => {
    const f = fixture(); await f.ready([row(B)]);
    f.sub.receive(event("created", A)); await drain(); await f.answer([row(B), row()]);
    const admission = f.alerts[0], held = deferred(), effects = [];
    const decision = decisionApi.currentMessageAlertAllowed(A, admission.isCurrent, { rpc: () => held.promise });
    if (change === "changed" || change === "removed") f.sub.receive(event(change, A));
    else if (change === "account") f.change({ accountEpoch: 8 });
    else if (change === "gap") f.sub.status("CHANNEL_ERROR");
    else if (change === "invalidate") f.sub.receive(marker(OTHER_MARKER));
    else if (change === "unavailable") {
      f.sub.receive(event("changed", B)); await drain(); await f.answer([row(B)], [A]);
    } else {
      const values = { read: { read_at: READ }, terminal: { alert_suppressed_at: READ },
        scrub: { payload: { deleted: true, preview: null } }, payload: { payload: { preview: "new X" } }, kind: { kind: "chat_added" } };
      f.feed.confirm([row(A, { feed_revision: 2, ...values[change] })]);
    }
    assert.equal(admission.isCurrent(), false);
    held.resolve({ error: null, data: [{ notification_id: A, allowed: true, scope_key: "general", revision: 0 }] });
    if (await decision && admission.isCurrent()) effects.push(admission.row.payload.preview);
    assert.deepEqual(effects, []); assert.equal(f.alerts.length, 1);
    f.feed.dispose();
  });
}

test("fresh lookup changes same X payload without a preceding exact signal: held old payload still refuses", async () => {
  const f = fixture(); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent;
  f.feed.refresh(); await drain(); await f.answer([row(A, { feed_revision: 2, payload: { preview: "new X" } })]);
  assert.equal(permit(), false); assert.equal(f.alerts.length, 1); f.feed.dispose();
});

test("equal fresh X JSON with reordered keys preserves its exact admission; nested value change revokes it", async () => {
  const f = fixture(); await f.ready(); f.sub.receive(event()); await drain();
  await f.answer([row(A, { payload: { preview: "fictional", nested: { a: 1, b: [true, null] } } })]);
  const permit = f.alerts[0].isCurrent;
  f.feed.refresh(); await drain();
  await f.answer([row(A, { payload: { nested: { b: [true, null], a: 1 }, preview: "fictional" } })]);
  assert.equal(permit(), true, "JSON key order is not a row change");
  f.feed.refresh(); await drain();
  await f.answer([row(A, { feed_revision: 2, payload: { nested: { b: [false, null], a: 1 }, preview: "fictional" } })]);
  assert.equal(permit(), false); assert.equal(f.alerts.length, 1); f.feed.dispose();
});

test("empty feed refresh skips lookup RPC only after current owned open and still refreshes page", async () => {
  const f = fixture(); f.feed.refresh(); await drain();
  assert.equal(f.pages.length, 0); assert.equal(f.lookups.length, 0);
  await f.ready(); f.feed.refresh(); await drain();
  assert.equal(f.lookups.length, 0, "lookup RPC must never receive an empty input");
  assert.deepEqual(f.pages[0].args, { p_limit: 30 }); f.pages[0].resolve(page()); await drain();
  assert.deepEqual(f.resyncs, []); assert.deepEqual(f.frames, [[], []]);
  f.sub.receive(marker(OTHER_MARKER)); await drain();
  assert.equal(f.lookups.length, 0); f.pages[1].resolve(page([row()])); await drain();
  assert.deepEqual(f.feed.rows().map(value => value.id).join(","), A); assert.equal(f.alerts.length, 0);
  f.feed.refresh(); await drain();
  assert.deepEqual(f.lookups[0].args, { p_ids: [A] }, "nonempty held identities must still use the real RPC");
  await f.answer([row()]); assert.deepEqual(f.resyncs, []); f.feed.dispose();
});

test("empty refresh completion is fenced by account identity and same-owner restart generation", async () => {
  const f = fixture(); await f.ready(); f.feed.refresh(); await drain();
  assert.equal(f.lookups.length, 0); f.change({ accountEpoch: 8 });
  f.pages[0].resolve(page([row()])); await drain(); assert.deepEqual(f.frames, [[]]);
  assert.deepEqual(plain(f.feed.rows()), []); f.feed.dispose();
  const g = fixture(); await g.ready(); g.feed.refresh(); await drain();
  const oldPage = g.pages[0]; g.feed.restart(); g.sub.status("SUBSCRIBED"); await drain();
  g.opens[1].resolve(opened([row(B)])); g.sub.receive(marker()); await drain();
  oldPage.resolve(page([row()])); await drain();
  assert.equal(g.frames.length, 2); assert.deepEqual(g.frames[1].map(value => value.id), [B]);
  assert.equal(g.lookups.length, 0); assert.equal(g.alerts.length, 0); g.feed.dispose();
});

test("malformed empty lookup envelopes still refuse, including the real empty open response", async () => {
  assert.deepEqual(plain(api.parseNotificationFeedLookupV2(lookup(), UID, [])), lookup());
  const malformed = [null, {}, { v: 2, rows: [] }, { ...lookup(), v: 1 }, lookup([row()]),
    lookup([], [A]), { ...lookup(), extra: true }];
  for (const value of malformed) {
    assert.throws(() => api.parseNotificationFeedLookupV2(value, UID, []), /notification_feed_v2/);
    const f = fixture(); f.sub.status("SUBSCRIBED"); await drain();
    f.opens[0].resolve({ ...opened(), lookup: value }); f.sub.receive(marker()); await drain();
    assert.deepEqual(f.resyncs, ["protocol"]); assert.equal(f.frames.length, 0);
    assert.equal(f.pages.length, 0); assert.equal(f.lookups.length, 0); f.feed.dispose();
  }
});

test("empty lookup skip is not an error-to-empty fallback for page failures or malformed page data", async () => {
  for (const failure of ["transport", "schema"]) {
    const f = fixture(); await f.ready(); f.feed.refresh(); await drain();
    assert.equal(f.lookups.length, 0);
    if (failure === "transport") f.pages[0].reject(new Error("fictional offline"));
    else f.pages[0].resolve({ v: 2, rows: [], next: null, unexpected: true });
    await drain(); assert.deepEqual(f.frames, [[]]);
    assert.deepEqual(f.resyncs, [failure === "transport" ? "read_error" : "protocol"]);
    assert.equal(f.alerts.length, 0); assert.equal(f.pages.length, 1); f.feed.dispose();
  }
});

test("held admission rejects new page payload followed by older lookup payload", async () => {
  const f = fixture(); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent; assert.equal(permit(), true);
  f.feed.refresh(); await drain();
  f.pages.at(-1).resolve(page([row(A, { feed_revision: 2, payload: { preview: "new X" } })]));
  f.lookups.at(-1).resolve(lookup([row()])); await drain();
  assert.equal(permit(), false, "a newer page must not be undone by an independently older lookup");
  assert.equal(f.feed.rows()[0].payload.preview, "new X"); assert.equal(f.alerts.length, 1); f.feed.dispose();
});

test("feed revision is required and accepts only literal safe integers1..9007199254740991", () => {
  for (const value of [0, -1, 1.5, 9007199254740992, "1", null, undefined, NaN])
    assert.throws(() => api.parseNotificationFeedPageV2(page([row(A, { feed_revision: value })]), UID), /notification_feed_v2/);
  const absent = row(); delete absent.feed_revision;
  assert.throws(() => api.parseNotificationFeedPageV2(page([absent]), UID), /notification_feed_v2/);
  assert.equal(api.parseNotificationFeedPageV2(page([row(A, { feed_revision: 9007199254740991 })]), UID).rows[0].feed_revision, 9007199254740991);
});

for (const newer of ["page", "lookup"]) {
  test(`independent ${newer} revision2 wins over revision1 and retires the old permit even with unchanged payload`, async () => {
    const f = fixture(); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
    const permit = f.alerts[0].isCurrent; f.feed.refresh(); await drain();
    f.pages.at(-1).resolve(page([row(A, { feed_revision: newer === "page" ? 2 : 1 })]));
    f.lookups.at(-1).resolve(lookup([row(A, { feed_revision: newer === "lookup" ? 2 : 1 })])); await drain();
    assert.equal(f.feed.rows()[0].feed_revision, 2); assert.equal(permit(), false);
    assert.deepEqual(f.resyncs, []); assert.equal(f.alerts.length, 1); f.feed.dispose();
  });
}

test("inverse old page/new lookup retains the actual newer payload", async () => {
  const f = fixture(); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent; f.feed.refresh(); await drain();
  f.pages.at(-1).resolve(page([row()]));
  f.lookups.at(-1).resolve(lookup([row(A, { feed_revision: 2, payload: { preview: "lookup new X" } })])); await drain();
  assert.equal(f.feed.rows()[0].payload.preview, "lookup new X"); assert.equal(permit(), false);
  assert.deepEqual(f.resyncs, []); f.feed.dispose();
});

test("both lower-revision snapshots cannot replace a newer owned row or cancel its current permit", async () => {
  const f = fixture(); await f.ready(); f.sub.receive(event()); await drain();
  await f.answer([row(A, { feed_revision: 2, payload: { preview: "current X" } })]);
  const permit = f.alerts[0].isCurrent; f.feed.refresh(); await drain(); await f.answer([row()]);
  assert.equal(f.feed.rows()[0].feed_revision, 2); assert.equal(f.feed.rows()[0].payload.preview, "current X");
  assert.equal(permit(), true); assert.deepEqual(f.resyncs, []); f.feed.dispose();
});

test("equal revision with different owned rows refuses within open and independent page/lookup", async () => {
  const conflict = { ...opened([row()], [A]), lookup: lookup([row(A, { payload: { preview: "contradiction" } })]) };
  assert.throws(() => api.parseNotificationFeedOpenV2(conflict, UID, [A]), /notification_feed_v2/);
  const f = fixture(); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent, frames = f.frames.length;
  f.feed.refresh(); await drain();
  f.pages.at(-1).resolve(page([row(A, { feed_revision: 2, payload: { preview: "page X" } })]));
  f.lookups.at(-1).resolve(lookup([row(A, { feed_revision: 2, payload: { preview: "lookup X" } })])); await drain();
  assert.deepEqual(f.resyncs, ["protocol"]); assert.equal(permit(), false); assert.equal(f.frames.length, frames); f.feed.dispose();
});

test("equal revision conflicting with current owned row or a direct confirmation refuses, never silently keeps authority", async () => {
  for (const mode of ["read", "confirm"]) {
    const f = fixture(); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
    const permit = f.alerts[0].isCurrent;
    if (mode === "confirm") f.feed.confirm([row(A, { read_at: READ })]);
    else { f.feed.refresh(); await drain(); await f.answer([row(A, { payload: { preview: "same-version conflict" } })]); }
    assert.deepEqual(f.resyncs, ["protocol"]); assert.equal(permit(), false); assert.equal(f.alerts.length, 1); f.feed.dispose();
  }
});

test("newer raw revision cannot clear read/marker/scrub; repeating that exact raw revision remains valid", async () => {
  const f = fixture(); await f.ready([row(A, { read_at: READ, alert_suppressed_at: READ, payload: { deleted: true, preview: null } })]);
  for (let i = 0; i < 2; i++) {
    f.feed.refresh(); await drain(); await f.answer([row(A, { feed_revision: 2 })]);
    assert.deepEqual(f.resyncs, []); assert.equal(f.feed.rows()[0].feed_revision, 2);
    assert.equal(f.feed.rows()[0].read_at, READ); assert.equal(f.feed.rows()[0].alert_suppressed_at, READ);
    assert.deepEqual(plain(f.feed.rows()[0].payload), { deleted: true, preview: null });
  }
  assert.equal(f.alerts.length, 0); f.feed.dispose();
});

async function lowerFrameProof(module, newerIn, proof) {
  const f = fixture(module); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent;
  f.feed.refresh(); await drain();
  const latest = row(A, { feed_revision: 3, alert_suppressed_at: proof.alert_suppressed_at ? null : READ, payload: { preview: "current revision3" } });
  const older = row(A, { feed_revision: 2, ...proof });
  f.pages.at(-1).resolve(page([newerIn === "page" ? latest : older]));
  f.lookups.at(-1).resolve(lookup([newerIn === "lookup" ? latest : older])); await drain();
  const result = f.feed.rows()[0];
  assert.equal(result.feed_revision, 3); assert.equal(result.alert_suppressed_at, READ);
  assert.equal(result.read_at, proof.read_at ?? null);
  assert.deepEqual(plain(result.payload), proof.payload?.deleted ? { deleted: true, preview: null } : { preview: "current revision3" });
  assert.equal(permit(), false);
  // Comparing raw revision3 must not confuse the retained overlay with its
  // own raw read-null/payload fields.
  f.feed.refresh(); await drain(); await f.answer([latest]);
  assert.deepEqual(f.resyncs, []); assert.equal(f.feed.rows()[0].read_at, proof.read_at ?? null);
  f.feed.dispose();
}
for (const order of ["page", "lookup"]) for (const [name, proof] of Object.entries({
  read: { read_at: READ }, marker: { alert_suppressed_at: READ }, scrub: { payload: { deleted: true, preview: null } },
  both: { read_at: READ, payload: { deleted: true, preview: null } },
})) test(`trusted lower frame ${name} proof survives newer ${order} in either merge order`, () => lowerFrameProof(api, order, proof));

function mutation(name, needle, replacement, proof) {
  test(`compiled literal omission: ${name}`, async () => {
    assert.equal(source.split(needle).length - 1, 1, "mutation must select exactly one actual source guard");
    await proof(api);
    const mutant = compile(source.replace(needle, replacement));
    await assert.rejects(async () => proof(mutant), error => error.code === "ERR_ASSERTION",
      "mutant must break the literal behavioral assertion, not fail setup");
  });
}
mutation("page31 rejected", "uniqueRows(input.rows, userId, 30)", "uniqueRows(input.rows, userId, 31)", module => {
  const rows = Array.from({ length: 31 }, (_, n) => row(`30000000-0000-4000-8000-${String(100 - n).padStart(12, "0")}`));
  assert.throws(() => module.parseNotificationFeedPageV2(page(rows), UID), /notification_feed_v2/);
});
mutation("lookup101 before dedupe", "Array.isArray(value) && value.length <= 100", "Array.isArray(value) && value.length <= 101", module => {
  assert.throws(() => module.parseNotificationFeedLookupV2(lookup([], [A]), UID, Array(101).fill(A)), /notification_feed_v2/);
});
mutation("own row only", "uuid(row.user_id) === userId", "uuid(row.user_id) !== ''", module => {
  assert.throws(() => module.parseNotificationFeedPageV2(page([row(A, { user_id: OTHER })]), UID), /notification_feed_v2/);
});
mutation("no alert_origin or extra envelope fields", "Object.keys(value).length === expected.length", "true", module => {
  assert.throws(() => module.parseNotificationFeedPageV2(page([{ ...row(), alert_origin: null }]), UID), /notification_feed_v2/);
});
mutation("unavailable partition is exact and unique", "new Set(partition).size === partition.length", "true", module => {
  assert.throws(() => module.parseNotificationFeedLookupV2(lookup([], [A, A]), UID, [A, B]), /notification_feed_v2/);
});
mutation("unknown changed is not created", 'if (event.event_kind === "created") {', 'if (event.event_kind === "created" || event.event_kind === "changed") {', async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event("changed", B)); await drain(); await f.answer([row(B)]);
  assert.equal(f.alerts.length, 0); f.feed.dispose();
});
mutation("pre-marker created stays quiet", "ingest(events[i], i > at, g)", "ingest(events[i], true, g)", async module => {
  const f = fixture(module); f.sub.status("SUBSCRIBED"); await drain();
  f.sub.receive(event("created", A)); f.sub.receive(marker()); f.sub.receive(event("created", B));
  f.opens[0].resolve(opened()); await drain(); await f.answer([row(B), row()]);
  assert.deepEqual(f.alerts.map(a => a.row.id), [B]); f.feed.dispose();
});
mutation("exact marker, not another tab's marker", "event.event_id === openResult?.barrier_event_id", 'event.event_kind === "invalidate"', async module => {
  const f = fixture(module); f.sub.status("SUBSCRIBED"); await drain(); f.opens[0].resolve(opened()); await drain();
  f.sub.receive(marker(OTHER_MARKER)); await drain(); assert.equal(f.frames.length, 0); f.feed.dispose();
});
mutation("stale read cannot publish", "if (dirty !== version)", "if (false)", async module => {
  const f = fixture(module); await f.ready([row()]); f.sub.receive(event("changed", A)); await drain();
  f.sub.receive(event("changed", A)); await f.answer([row()]); assert.equal(f.frames.length, 1); f.feed.dispose();
});
mutation("owner fence after awaits", "try { return ports.isCurrent(owner); } catch { return false; }", "try { return true; } catch { return false; }", async module => {
  const f = fixture(module); f.sub.status("SUBSCRIBED"); await drain(); f.change({ accountEpoch: 8 });
  f.opens[0].resolve(opened([row()])); f.sub.receive(marker()); await drain(); assert.equal(f.frames.length, 0); f.feed.dispose();
});
mutation("old same-owner channel generation", "generation !== g", "false", async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event("changed", A)); await drain();
  const oldPage = f.pages[0], oldLookup = f.lookups[0];
  f.feed.restart(); f.sub.status("SUBSCRIBED"); await drain(); f.opens[1].resolve(opened()); f.sub.receive(marker()); await drain();
  f.sub.receive(event("created", B)); await drain(); assert.equal(f.pages.length, 2);
  oldPage.resolve(page([row()])); oldLookup.resolve(lookup([row()])); await drain();
  assert.equal(f.pages.length, 2, "old completion must not clear new reader or start another one"); f.feed.dispose();
});
mutation("buffer literal513 refuses", "buffer.length >= 512", "buffer.length >= 513", async module => {
  const f = fixture(module); for (let i = 0; i < 513; i++) f.sub.receive(marker(OTHER_MARKER));
  assert.deepEqual(f.resyncs, ["overflow"]); f.feed.dispose();
});
mutation("read rows never admit", "row.read_at === null", "true", async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row(A, { read_at: READ })]);
  assert.equal(f.alerts.length, 0); f.feed.dispose();
});
mutation("terminal marker never admits", "row.alert_suppressed_at === null", "true", async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row(A, { alert_suppressed_at: READ })]);
  assert.equal(f.alerts.length, 0); f.feed.dispose();
});
mutation("read state remains monotone", "read_at: forwardTimestamp(old.read_at, row.read_at)", "read_at: row.read_at", async module => {
  const f = fixture(module); await f.ready([row(A, { read_at: READ })]); f.sub.receive(event("changed", A)); await drain(); await f.answer([row(A, { feed_revision: 2 })]);
  assert.equal(f.feed.rows()[0].read_at, READ); f.feed.dispose();
});
mutation("terminal marker remains monotone", "alert_suppressed_at: forwardTimestamp(old.alert_suppressed_at, row.alert_suppressed_at)", "alert_suppressed_at: row.alert_suppressed_at", async module => {
  const f = fixture(module); await f.ready([row(A, { alert_suppressed_at: READ })]); f.sub.receive(event("changed", A)); await drain(); await f.answer([row(A, { feed_revision: 2 })]);
  assert.equal(f.feed.rows()[0].alert_suppressed_at, READ); f.feed.dispose();
});
mutation("scrub cannot be undone", "scrubbed(old) && !scrubbed(row) ? old.payload : row.payload", "row.payload", async module => {
  const f = fixture(module); await f.ready([row(A, { payload: { deleted: true, preview: null } })]);
  f.sub.receive(event("changed", A)); await drain(); await f.answer([row(A, { feed_revision: 2 })]);
  assert.deepEqual(plain(f.feed.rows()[0].payload), { deleted: true, preview: null }); f.feed.dispose();
});
mutation("open snapshot cannot outrun buffered scrub", "if (events.length === 1)", "if (true)", async module => {
  const f = fixture(module); f.sub.status("SUBSCRIBED"); await drain();
  f.sub.receive(event("changed", A)); f.sub.receive(marker()); f.opens[0].resolve(opened([row()])); await drain();
  assert.equal(f.frames.length, 0); f.feed.dispose();
});
mutation("exact row admission token revokes held permit", "admitted.get(id) === row", "true", async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent; f.sub.receive(event("changed", A)); assert.equal(permit(), false); f.feed.dispose();
});

mutation("unrelated dirty state cannot cancel held X", "const allowed = () => current(g)", "const admittedDirty = dirty; const allowed = () => dirty === admittedDirty && current(g)", async module => {
  const f = fixture(module); await f.ready([row(B)]); f.sub.receive(event()); await drain(); await f.answer([row(B), row()]);
  const permit = f.alerts[0].isCurrent; f.sub.receive(event("changed", B)); assert.equal(permit(), true); f.feed.dispose();
});

mutation("same-X event retires admission synchronously", "else { candidates.delete(id); admitted.delete(id); }", "else { candidates.delete(id); }", async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent; f.sub.receive(event("changed", A)); assert.equal(permit(), false); f.feed.dispose();
});

mutation("fresh same-X row change retires admission", "latest && !sameRow(admission, latest)", "false", async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent; f.feed.refresh(); await drain(); await f.answer([row(A, { feed_revision: 2, payload: { preview: "changed X" } })]);
  assert.equal(permit(), false); f.feed.dispose();
});

mutation("confirmed same-X change retires admission", "admission && !sameRow(admission, forward(admission, row, snapshots))", "false", async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent; f.feed.confirm([row(A, { feed_revision: 2, read_at: READ })]);
  assert.equal(permit(), false); f.feed.dispose();
});

mutation("payload equality is part of exact row admission", "sameJson(left.payload, right.payload)", "true", async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent; f.feed.refresh(); await drain(); await f.answer([row(A, { payload: { preview: null, deleted: true } })]);
  assert.equal(permit(), false); f.feed.dispose();
});

mutation("bounded creation identity memory", "creations.size >= 512", "creations.size >= 513", async module => {
  const f = fixture(module); await f.ready(); let sent = 0;
  for (const count of [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 12]) {
    const ids = Array.from({ length: count }, () => `30000000-0000-4000-8000-${String(++sent).padStart(12, "0")}`);
    for (const id of ids) f.sub.receive(event("created", id)); await drain(); await f.answer([], ids);
  }
  f.sub.receive(event("created", "30000000-0000-4000-8000-000000000513"));
  assert.deepEqual(f.resyncs, ["overflow"]); f.feed.dispose();
});

mutation("out-of-page delayed creation cannot replay", "const seen = creations.has(id)", "const seen = false", async module => {
  const retained = Array.from({ length: 30 }, (_, n) => row(`30000000-0000-4000-8000-${String(100 - n).padStart(12, "0")}`));
  const f = fixture(module); await f.ready(retained); const signal = event();
  for (let i = 0; i < 2; i++) {
    f.sub.receive(signal); await drain(); f.pages.at(-1).resolve(page(retained));
    f.lookups.at(-1).resolve(lookup([...retained, row(A, { created_at: "2000-01-01T00:00:00Z" })])); await drain();
  }
  assert.deepEqual(f.alerts.map(a => a.row.id), [A]); f.feed.dispose();
});

mutation("empty refresh never calls the 1..100 lookup RPC", "ids.length === 0 ? { v: 2, rows: [], unavailable_ids: [] } : ports.lookup({ p_ids: ids })", "ports.lookup({ p_ids: ids })", async module => {
  const f = fixture(module); await f.ready(); f.feed.refresh(); await drain();
  assert.equal(f.lookups.length, 0, "literal zero empty lookup calls");
  f.pages[0].resolve(page()); await drain(); assert.deepEqual(f.resyncs, []); f.feed.dispose();
});

mutation("local empty envelope remains strictly parsed", "ids.length === 0 ? { v: 2, rows: [], unavailable_ids: [] }", "ids.length === 0 ? { v: 1, rows: [], unavailable_ids: [] }", async module => {
  const f = fixture(module); await f.ready(); f.feed.refresh(); await drain();
  f.pages[0].resolve(page()); await drain();
  assert.deepEqual(f.resyncs, []); assert.deepEqual(f.frames, [[], []]); f.feed.dispose();
});

mutation("revision zero refuses", "row.feed_revision >= 1", "row.feed_revision >= 0", module => {
  assert.throws(() => module.parseNotificationFeedPageV2(page([row(A, { feed_revision: 0 })]), UID), /notification_feed_v2/);
});
mutation("fractional revision refuses", "Number.isSafeInteger(row.feed_revision)", "Number.isFinite(row.feed_revision)", module => {
  assert.throws(() => module.parseNotificationFeedPageV2(page([row(A, { feed_revision: 1.5 })]), UID), /notification_feed_v2/);
});
mutation("lower revision cannot overwrite newer page or retain old permit", "if (incoming.feed_revision < previous.feed_revision) return forward(row, old, snapshots);", "if (incoming.feed_revision < previous.feed_revision) return row;", async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent; f.feed.refresh(); await drain();
  f.pages.at(-1).resolve(page([row(A, { feed_revision: 2, payload: { preview: "new X" } })]));
  f.lookups.at(-1).resolve(lookup([row()])); await drain();
  assert.equal(f.feed.rows()[0].feed_revision, 2); assert.equal(permit(), false); f.feed.dispose();
});
mutation("equal current revision cannot silently ignore conflicting fields", "demand(sameRow(previous, incoming));", "", async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent; f.feed.refresh(); await drain(); await f.answer([row(A, { payload: { preview: "conflict" } })]);
  assert.deepEqual(f.resyncs, ["protocol"]); assert.equal(permit(), false); f.feed.dispose();
});
mutation("open refuses equal-revision contradictory snapshots", "if (other?.feed_revision === row.feed_revision) demand(sameRow(other, row));", "", module => {
  assert.throws(() => module.parseNotificationFeedOpenV2({ ...opened([row()], [A]),
    lookup: lookup([row(A, { payload: { preview: "conflict" } })]) }, UID, [A]), /notification_feed_v2/);
});
mutation("newer identical payload still retires old admission token", "left.feed_revision === right.feed_revision", "true", async module => {
  const f = fixture(module); await f.ready(); f.sub.receive(event()); await drain(); await f.answer([row()]);
  const permit = f.alerts[0].isCurrent; f.feed.refresh(); await drain(); await f.answer([row(A, { feed_revision: 2 })]);
  assert.equal(permit(), false); f.feed.dispose();
});
mutation("monotone display overlays do not replace exact raw revision identity", "snapshots.set(merged, incoming);", "", async module => {
  const f = fixture(module); await f.ready([row(A, { read_at: READ })]);
  for (let i = 0; i < 2; i++) { f.feed.refresh(); await drain(); await f.answer([row(A, { feed_revision: 2 })]); }
  assert.deepEqual(f.resyncs, []); assert.equal(f.feed.rows()[0].read_at, READ); f.feed.dispose();
});
mutation("trusted lower frame cannot discard read/marker/scrub proof", "return forward(row, old, snapshots);", "return old;", async module => {
  await lowerFrameProof(module, "page", { read_at: READ, payload: { deleted: true, preview: null } });
});
