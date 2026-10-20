import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const kub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const sdk = createRequire(kub.resolve("@supabase/supabase-js"));
const { PostgrestClient } = sdk("@supabase/postgrest-js");
const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8").replaceAll("\r\n", "\n");
const source = read("hooks/useMessages.ts");
const CHAT = "30000000-0000-0000-0000-000000000001";
const GENERAL = "50000000-0000-0000-0000-000000000001";
const TOPIC = "50000000-0000-0000-0000-000000000002";
const TIME = "2026-10-20T12:00:00.123456+03:00";
const EARLIER = "2026-10-20T11:59:59.123456+03:00";
const CLEAR = "2026-10-20T11:59:58.123456+03:00";
const id = n => `40000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const row = (n = 1, created_at = TIME, topic_id = null) => ({ id: id(n), created_at, topic_id,
  chat_id: CHAT, user_id: "fictional-peer", bot_id: null, type: "text", content: null,
  deleted_at: null, reply_to_id: null, sender: { id: "fictional-peer" }, reactions: [] });
const corpus = () => [...Array.from({ length: 125 }, (_, n) => row(n + 1, EARLIER)),
  ...Array.from({ length: 250 }, (_, n) => row(n + 1001))];
const fixtures = new Set();
test.before(() => assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0"));
test.afterEach(async () => { for (const f of fixtures) await f.close(); fixtures.clear(); });

// Independent finite HTTP leaf: evaluate the emitted SDK URL, not a cursor helper.
// Only the documented filter grammar used by this hook is admitted.
function parts(text) {
  let depth = 0, quoted = false, start = 0;
  const result = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    if (!quoted) {
      if (text[i] === "(") depth++;
      if (text[i] === ")") depth--;
      if (text[i] === "," && depth === 0) { result.push(text.slice(start, i)); start = i + 1; }
    }
    assert.ok(depth >= 0, "balanced fixture URL grammar");
  }
  assert.equal(depth, 0); assert.equal(quoted, false);
  return [...result, text.slice(start)];
}
function micros(value) {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? "";
  return BigInt(Date.parse(value.replace(/\.\d+/, ""))) * 1000n + BigInt(fraction.padEnd(6, "0"));
}
function compare(key, left, right) {
  if (left === null || right === null) return left === right ? 0 : left === null ? -1 : 1;
  const a = key === "created_at" ? micros(left) : left;
  const b = key === "created_at" ? micros(right) : right;
  return a < b ? -1 : a > b ? 1 : 0;
}
function predicate(expression) {
  const group = /^(and|or)\((.*)\)$/.exec(expression);
  if (group) {
    const children = parts(group[2]).map(predicate);
    return value => group[1] === "and" ? children.every(fn => fn(value)) : children.some(fn => fn(value));
  }
  const atom = /^([a-z_]+)\.(eq|lt|lte|gt|is|in)\.(.*)$/.exec(expression);
  assert.ok(atom, "known fixture URL predicate");
  const [, key, operator, raw] = atom;
  const literal = value => value.startsWith('"') ? JSON.parse(value) : value === "null" ? null : value;
  if (operator === "in") {
    assert.ok(raw.startsWith("(") && raw.endsWith(")"));
    const values = parts(raw.slice(1, -1)).map(literal);
    return value => values.includes(value[key]);
  }
  const expected = literal(raw);
  return value => {
    const relation = compare(key, value[key], expected);
    return operator === "lt" ? relation < 0 : operator === "lte" ? relation <= 0
      : operator === "gt" ? relation > 0 : relation === 0;
  };
}
function selectRows(rows, url) {
  const filters = [...url.searchParams].filter(([key]) => !["select", "order", "limit"].includes(key))
    .map(([key, value]) => predicate(key === "or" ? `or${value}` : `${key}.${value}`));
  const orders = (url.searchParams.get("order") ?? "").split(",").filter(Boolean).map(value => value.split("."));
  return rows.filter(row => filters.every(fn => fn(row))).sort((a, b) => {
    for (const [key, direction] of orders) { const result = compare(key, a[key], b[key]); if (result) return direction === "desc" ? -result : result; }
    return 0;
  }).slice(0, Number(url.searchParams.get("limit") ?? rows.length));
}

// Reuse inspected full-hook execution/commit/lifetime machinery, not its tests.
const harness = readFileSync(new URL("message-producer-lifecycle.test.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("harness.mjs", harness, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let declarations = ["compile", "deferred", "fixture"].map(name => {
  const nodes = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(nodes.length, 1); return nodes[0].getText(ast);
}).join("\n");
function adapt(from, to) {
  assert.equal(declarations.split(from).length - 1, 1, "exact inspected fixture adaptation");
  declarations = declarations.replace(from, to);
}
adapt('historyRows = [row()] } = {})', 'historyRows = [row()], topicId, generalTopicIds = [], clearedAt = null, hiddenIds = new Set() } = {})');
adapt('let props = { chatId: CHAT, topicId: undefined, generalTopicIds: [] };', 'let props = { chatId: CHAT, topicId, generalTopicIds };');
const fixtureAst = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "fixture");
const clientDeclaration = fixtureAst.body.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "client"));
assert.ok(clientDeclaration);
adapt(clientDeclaration.getText(ast), `const client = makeClient({ calls, boundary, historyRows, clearedAt, hiddenIds, epoch: () => state.accountEpoch });`);
adapt('const hook = load("hooks/useMessages.ts").useMessages;', `
  delete aliases["@/lib/hiddenMessagesLive"]; delete aliases["@/lib/messageProjection"];
  const hides = load("lib/hiddenMessagesLive.ts").hiddenMessagesLive;
  hides.joined(); hides.pingReturned();
  const hook = load("hooks/useMessages.ts").useMessages;`);
adapt('calls, publications, timers, channels, hold, pending, drain,', 'calls, publications, timers, channels, hold, pending, drain, hides,');
function makeClient({ calls, boundary, historyRows, clearedAt, hiddenIds, epoch }) {
  return new PostgrestClient("https://tuple.fixture.invalid/rest/v1", { fetch: async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://tuple.fixture.invalid"); assert.equal(init.method, "GET");
    const table = url.pathname.split("/").at(-1);
    const older = url.searchParams.get("created_at")?.startsWith("lt.")
      || url.searchParams.getAll("or").some(value => value.includes("created_at.lt."));
    const name = table === "chat_members" ? "mark" : table === "message_hidden_for_users" ? "hidden"
      : url.searchParams.has("pinned") ? "pinned" : older ? "older" : "history";
    const call = { name, table, url, epoch: epoch() }; calls.push(call);
    let rows;
    try { rows = table === "messages" ? selectRows(historyRows, url) : []; }
    catch {
      return new Response(JSON.stringify({ code: "22007", message: "Fictional invalid filter" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    call.ids = rows.map(row => row.id);
    const data = name === "mark" ? { cleared_at: clearedAt } : name === "hidden"
      ? selectRows([...hiddenIds].map(message_id => ({ message_id })), url) : rows;
    const result = await boundary(name, { data, error: null });
    return new Response(JSON.stringify(result.error ?? result.data), {
      status: result.error ? 400 : 200, headers: { "Content-Type": "application/json" },
    });
  } });
}
const fixture = new Function("assert", "path", "vm", "ts", "read", "source", "row", "CHAT", "fixtures", "makeClient",
  `${declarations}\nreturn fixture;`)(assert, path, vm, ts, read, source, row, CHAT, fixtures, makeClient);
async function settle(f) { await f.drain(); await new Promise(setImmediate); await f.drain(); }
const ids = f => Array.from(f.view.messages, row => row.id);
async function opened(options = {}) {
  const f = fixture({ historyRows: corpus(), ...options }); await settle(f);
  assert.equal(f.view.messages.length, 100, "actual initial-page positive control");
  assert.equal(f.view.hasMoreOlder, true);
  return f;
}
async function completeHistory(text = source) {
  const f = await opened({ text });
  const pageSizes = [];
  for (let page = 0; page < 3; page++) {
    pageSizes.push((await f.view.loadOlderMessages()).loaded); await settle(f);
    if (page === 0) {
      assert.equal(f.view.messages.filter(row => row.created_at === TIME).length, 200,
        "second page must retain the remaining tied-timestamp UUIDs before earlier rows");
      assert.equal(f.view.messages.length, 200, "exclusive cursor must not repeat its boundary row");
    }
    assert.equal(f.view.hasMoreOlder, page < 2, "lookahead preserves hasMore until the final page");
  }
  assert.deepEqual(pageSizes, [100, 100, 75]);
  assert.equal(ids(f).length, 375); assert.equal(new Set(ids(f)).size, 375);
  assert.deepEqual(ids(f), corpus().map(row => row.id), "every server row appears once in ascending tuple order");
  const queries = f.calls.filter(call => call.name === "older");
  assert.deepEqual(queries.map(call => call.ids.length), [101, 101, 75]);
  assert.equal(queries[0].ids[0], id(1150));
  assert.equal((await f.view.loadOlderMessages()).loaded, 0);
  assert.equal(f.calls.filter(call => call.name === "older").length, 3, "exhausted history issues no fourth query");
}
test("actual hook paginates 250 tied timestamps plus 125 earlier rows without gaps or duplicates", () => completeHistory());

for (const topicId of [TOPIC, null]) test(`tuple selector preserves ${topicId ? "explicit" : "general OR"} topic and clear filters`, async () => {
  const rows = corpus().map((row, index) => ({ ...row, topic_id: topicId ?? (index % 2 ? GENERAL : null) }));
  const unwanted = [row(9001, TIME, "50000000-0000-0000-0000-000000000003"),
    row(9002, "2026-10-20T11:59:57.123456+03:00", topicId), { ...row(9003), deleted_at: TIME },
    { ...row(9004), chat_id: "30000000-0000-0000-0000-000000000002" }];
  const f = await opened({ historyRows: [...unwanted, ...rows], topicId, generalTopicIds: [GENERAL], clearedAt: CLEAR });
  for (let page = 0; page < 3; page++) { await f.view.loadOlderMessages(); await settle(f); }
  assert.deepEqual(ids(f), rows.map(row => row.id), "scope and clear must remain ANDed with the tuple cursor");
  for (const call of f.calls.filter(call => call.name === "older")) {
    assert.equal(call.url.searchParams.get("created_at"), `gt.${CLEAR}`, "tuple clause must preserve the clear lower bound");
    if (topicId === null) assert.equal(call.url.searchParams.getAll("or").length, 2, "topic OR and tuple OR must both survive SDK encoding");
    else assert.equal(call.url.searchParams.get("topic_id"), `eq.${TOPIC}`);
  }
});

test("actual SDK encodes quoted microsecond/offset cursor once without normalizing its precision", async () => {
  const f = await opened(); await f.view.loadOlderMessages(); await settle(f);
  const url = f.calls.find(call => call.name === "older").url;
  assert.equal(url.searchParams.get("or"), `(created_at.lt."${TIME}",and(created_at.eq."${TIME}",id.lt.${id(1151)}))`);
  assert.ok(url.href.includes("%22") && url.href.includes("%2B03%3A00"));
  assert.equal(url.href.includes("%2522"), false, "do not manually percent-encode before the SDK");
});

async function invalidCursor(key, value, text = source) {
  const f = await opened({ text }); f.state.messages[CHAT][0][key] = value; f.clear();
  let result;
  await assert.doesNotReject(async () => { result = await f.view.loadOlderMessages(); }, "invalid cursor must return a safe refusal");
  await settle(f);
  assert.equal(f.calls.length, 0, "invalid cursor must not issue a PostgREST query");
  assert.equal(result.loaded, 0); assert.ok(f.view.olderError); assert.equal(f.view.loadingOlder, false);
}
for (const [name, key, value] of [
  ["UUID predicate injection", "id", `${id(1151)},id.gt.0`],
  ["invalid UUID", "id", "not-a-uuid"],
  ["null UUID", "id", null],
  ["numeric UUID", "id", 123],
  ["timestamp predicate injection", "created_at", `${TIME}\",id.gt.0`],
  ["invalid timestamp", "created_at", "not-a-timestamp"],
]) test(`invalid older cursor refuses before transport: ${name}`, () => invalidCursor(key, value));

for (const retirement of ["unmount", "account", "topic", "newer history request"]) {
  test(`held tuple response cannot publish after ${retirement}`, async () => {
    const f = await opened(), gate = f.hold("older"), loading = f.view.loadOlderMessages(); await settle(f);
    assert.ok(f.pending.includes(gate), "actual SDK older request reaches held response");
    if (retirement === "unmount") f.unmount();
    else if (retirement === "account") f.changeEpoch(false);
    else if (retirement === "topic") { f.switchTopic(TOPIC); await settle(f); }
    else { await f.view.refetch(); await settle(f); }
    f.clear(); gate.resolve({ data: corpus().slice(25, 126), error: null }); await loading; await settle(f);
    assert.equal(f.calls.length, 0, "retired response cannot initiate privacy reads");
    assert.equal(f.publications.filter(item => item.kind === "messages").length, 0,
      "retired older request cannot replace the current view");
    if (retirement !== "newer history request") assert.equal(f.publications.length, 0);
  });
}

test("tuple response still waits for current hidden verdict and refuses a privacy gap", async () => {
  const f = await opened(), gate = f.hold("hidden"), loading = f.view.loadOlderMessages(); await settle(f);
  assert.ok(f.pending.includes(gate)); assert.equal(f.view.messages.length, 100);
  f.hides.lost(); f.hides.joined(); f.hides.pingReturned(); f.clear();
  gate.resolve({ data: [], error: null }); await loading; await settle(f);
  assert.equal(f.view.messages.length, 100); assert.equal(f.publications.filter(item => item.kind === "messages").length, 0);
});

test("current hidden rows stay absent after the tied page is admitted", async () => {
  const f = await opened({ hiddenIds: new Set([id(1100)]) });
  assert.equal((await f.view.loadOlderMessages()).loaded, 99); await settle(f);
  assert.equal(f.view.messages.length, 199); assert.equal(ids(f).includes(id(1100)), false);
});

async function localCursor(state, text = source) {
    const f = await opened({ text });
    const local = { ...row(9001, CLEAR), ...(state === "tmp" ? { id: "tmp:retained" } : { [state]: true }) };
    f.state.messages[CHAT].unshift(local);
    assert.equal((await f.view.loadOlderMessages()).loaded, 100, "local rows cannot block confirmed-server pagination");
    await settle(f);
    assert.equal(f.view.hasMoreOlder, true);
    assert.equal(f.state.messages[CHAT].includes(local), true, "pagination leaves the retained local entry untouched");
    assert.equal(f.view.messages.filter(row => row.created_at === TIME).length, 200);
}
for (const state of ["tmp", "pending", "failed", "checking"]) {
  test(`old ${state} local row cannot block the confirmed older cursor or be discarded`, () => localCursor(state));
}

async function pendingOnly(text = source) {
  const f = await opened({ text });
  f.state.messages[CHAT] = [{ ...row(9001), pending: true }]; f.clear();
  assert.equal((await f.view.loadOlderMessages()).loaded, 0); await settle(f);
  assert.equal(f.calls.length, 0, "pending-only cache cannot dispatch a history cursor");
  assert.equal(f.view.hasMoreOlder, true, "absence of confirmed rows is not proof that older history is exhausted");
  assert.equal(f.view.olderError, null);
}
test("pending-only held rows retain hasMore but cannot supply a raw older cursor", () => pendingOnly());

async function microsecondCursor(text = source) {
  const lower = "2026-10-20T12:00:00.123455+03:00";
  const rows = [...Array.from({ length: 100 }, (_, n) => row(n + 1001, lower)),
    ...Array.from({ length: 50 }, (_, n) => row(n + 1, TIME))];
  const f = await opened({ historyRows: rows, text });
  await f.view.refetch({ background: true }); await settle(f);
  assert.equal(f.state.messages[CHAT][0].id, id(1), "actual shared Date-ms merge has the newer low UUID first");
  const held = new Set(ids(f));
  assert.equal((await f.view.loadOlderMessages()).loaded, 50, "cursor must use true minimum microseconds before UUID");
  await settle(f);
  const query = f.calls.find(call => call.name === "older");
  assert.equal(query.url.searchParams.get("or"), `(created_at.lt."${lower}",and(created_at.eq."${lower}",id.lt.${id(1051)}))`);
  assert.equal(query.ids.some(id => held.has(id)), false, "older read cannot repeat already held server slots");
  assert.equal(new Set(ids(f)).size, 150); assert.equal(f.view.hasMoreOlder, false);
}
test("real millisecond merge cannot make a newer low UUID the microsecond older cursor", () => microsecondCursor());

async function reverseCursor(text = source) {
  const f = await opened({ text }); f.state.messages[CHAT].reverse();
  assert.equal(f.state.messages[CHAT][0].id, id(1250));
  await f.view.loadOlderMessages(); await settle(f);
  assert.equal(f.view.messages.length, 200, "cursor uses minimum UUID, not the held array's first entry");
  assert.equal(f.calls.find(call => call.name === "older").ids[0], id(1150));
}
test("held equal-time rows use minimum UUID ordinal independently of array position", () => reverseCursor());

const tuple = '.or(`created_at.lt."${cursorTime}",and(created_at.eq."${cursorTime}",id.lt.${cursorId})`)';
const uuidCheck = '!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateId)';
for (const [name, before, after, contract, oracle] of [
  ["old timestamp-only filter", tuple, '.lt("created_at", cursorTime)', completeHistory, "remaining tied-timestamp UUIDs"],
  ["inclusive UUID boundary", 'id.lt.${cursorId}', 'id.lte.${cursorId}', completeHistory, "remaining tied-timestamp UUIDs"],
  ["strictly earlier branch omitted", 'created_at.lt."${cursorTime}",', '', completeHistory, "lookahead preserves hasMore"],
  ["UUID validation omitted", uuidCheck, 'false', text => invalidCursor("id", `${id(1151)},id.gt.0`, text), "invalid cursor must not issue"],
  ["timestamp validation omitted", 'candidateMicros === null', 'false', text => invalidCursor("created_at", `${TIME}\",id.gt.0`, text), "invalid cursor must not issue"],
  ["local-row exclusion omitted", '.filter((message) =>\n      typeof message.id !== "string" || !isLocalOnlyMessage(message))', '.slice()', text => localCursor("tmp", text), "local rows cannot block"],
  ["microseconds rounded to milliseconds", 'timestampMicros(candidateTime)', 'Date.parse(candidateTime) * 1000', microsecondCursor, "true minimum microseconds"],
  ["UUID ordinal tie-break omitted", 'candidateMicros === cursorMicros && candidateId.toLowerCase() < cursorId.toLowerCase()', 'false', reverseCursor, "minimum UUID, not the held array"],
  ["pending-only barrier omitted", '    if (!confirmedCurrent.length) return { loaded: 0 };', '', pendingOnly, "pending-only cache cannot dispatch"],
  ["malformed-ID preclassification guard omitted", 'typeof message.id !== "string" || !isLocalOnlyMessage(message)', '!isLocalOnlyMessage(message)', text => invalidCursor("id", null, text), "invalid cursor must return a safe refusal"],
]) test(`loaded literal mutant rejected: ${name}`, async () => {
  assert.equal(source.split(before).length - 1, 1, "unique actual-source mutation anchor");
  const mutated = source.replace(before, after);
  await assert.rejects(() => contract(mutated), error => {
    assert.equal(error.code, "ERR_ASSERTION", "compile/setup failures cannot count as mutation kills");
    assert.ok(error.message.includes(oracle), oracle);
    return true;
  });
});
