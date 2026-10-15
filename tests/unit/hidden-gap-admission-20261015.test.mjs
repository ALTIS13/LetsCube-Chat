import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../../artifacts/kub/src/', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8').replaceAll('\r\n', '\n');
const source = read('hooks/useMessages.ts');
const hiddenSource = read('lib/hiddenMessagesLive.ts');
const CHAT = '30000000-0000-0000-0000-000000000001';
const row = (n = 1) => ({ id: `40000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  chat_id: CHAT, user_id: 'fictional-peer', bot_id: null, topic_id: null, type: 'text', content: null,
  created_at: `2026-10-07T00:00:${String(n % 60).padStart(2, '0')}Z`, deleted_at: null,
  sender: { id: 'fictional-peer' }, reactions: [], reply_to_id: null });
const fixtures = new Set();
test.afterEach(async () => { for (const f of fixtures) await f.close(); fixtures.clear(); });

// Use the existing full-hook harness without registering its accepted tests.
const harness = readFileSync(new URL('message-producer-lifecycle.test.mjs', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('harness.mjs', harness, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let declarations = ['compile', 'deferred', 'fixture'].map((name) => {
  const matches = syntax.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(matches.length, 1);
  return matches[0].getText(syntax);
}).join('\n');
function adapt(before, after) {
  assert.equal(declarations.split(before).length - 1, 1, 'one existing harness anchor');
  declarations = declarations.replace(before, after);
}
adapt('const hook = load("hooks/useMessages.ts").useMessages;', `
  delete aliases["@/lib/clearedAtCache"];
  delete aliases["@/lib/hiddenMessagesLive"];
  const markCache = load("lib/clearedAtCache.ts").clearedAtCache;
  const hides = load("lib/hiddenMessagesLive.ts").hiddenMessagesLive;
  markCache.setLive(true); hides.joined(); hides.pingReturned();
  const hook = load("hooks/useMessages.ts").useMessages;`);
adapt('const globals = { testImportMeta:', 'let now = 10000;\n  const globals = { Date: class extends Date { static now() { return now; } }, testImportMeta:');
adapt('calls, publications, timers, channels, hold, pending, drain,',
  'calls, publications, timers, channels, hold, pending, drain, markCache, hides, advance: (ms) => { now += ms; },');
function fixture(options = {}, hidden = hiddenSource) {
  const loadRead = (name) => name === 'lib/hiddenMessagesLive.ts' ? hidden : read(name);
  const create = new Function('assert', 'path', 'vm', 'ts', 'read', 'source', 'row', 'CHAT', 'fixtures',
    `${declarations}\nreturn fixture;`)(assert, path, vm, ts, loadRead, source, row, CHAT, fixtures);
  return create(options);
}
function lose(f, kind = 'rejoin') {
  f.hides.lost();
  if (kind === 'rejoin') { f.advance(10); f.hides.joined(); f.hides.pingReturned(); }
}
async function historyGap({ text = source, hidden = hiddenSource, gap = 'rejoin', boundaryGap = false } = {}) {
  const rows = [row()];
  const f = fixture({ text, historyRows: rows }, hidden);
  await f.drain();
  assert.equal(f.view.messages.length, 1, 'known-row positive control');
  rows.unshift(row(2));
  if (boundaryGap) {
    const capture = f.hides.captureRead.bind(f.hides);
    let captures = 0;
    f.hides.captureRead = () => {
      const valid = capture();
      const helper = ++captures === 2;
      return () => {
        const current = valid();
        if (helper && current) Promise.resolve().then(() => lose(f));
        return current;
      };
    };
  }
  const held = f.hold('hidden');
  const pending = f.view.refetch({ background: true });
  await f.drain();
  assert.ok(f.pending.includes(held), 'unknown REST row reached actual hidden-ID await');
  assert.equal(f.view.messages.length, 1, 'unknown row initially withheld');
  if (gap) lose(f, gap);
  held.resolve({ data: [], error: null });
  await pending; await f.drain();
  assert.equal(f.view.messages.length, gap || boundaryGap ? 1 : 2, 'OLD_HIDDEN_ANSWER_CANNOT_ADMIT');
  if (gap || boundaryGap) {
    const fresh = f.hold('hidden');
    const retry = f.view.refetch({ background: true });
    await f.drain();
    fresh.resolve({ data: [{ message_id: row(2).id }], error: null });
    await retry; await f.drain();
    assert.equal(f.view.messages.length, 1, 'fresh deny keeps new row absent');
  }
}
for (const gap of [false, 'lost', 'rejoin']) test(`actual history privacy completion: ${gap || 'no-gap control'}`, () => historyGap({ gap }));
test('loss after helper completion but before consumer continuation still withholds unknown row', () => historyGap({ gap: false, boundaryGap: true }));

async function scopedGap(kind, gap = true) {
  const f = fixture({ historyRows: kind === 'older' ? Array.from({ length: 101 }, (_, i) => row(i + 1)) : [row()] });
  await f.drain(); await f.fireTimers();
  let pending;
  const hidden = f.hold('hidden');
  if (kind === 'exact') {
    const joined = f.hold('joined');
    pending = f.view.ensureMessageLoaded(row(103).id);
    await f.drain(); joined.resolve({ data: row(103), error: null });
  } else if (kind === 'pinned') {
    const pinned = f.hold('pinned');
    pending = f.view.refetchPinnedMessages();
    await f.drain(); pinned.resolve({ data: [row()], error: null });
  } else if (kind === 'older') pending = f.view.loadOlderMessages();
  else {
    const channel = f.channels.filter((entry) => entry.name === `messages:chat:${CHAT}`).at(-1);
    const callback = channel.bindings.find((entry) => entry.filter.table === 'messages' && entry.filter.event === 'UPDATE').callback;
    const joined = f.hold('joined');
    pending = callback({ new: { ...row(), edited_at: '2026-10-07T00:02:00Z' } });
    await f.drain(); joined.resolve({ data: { ...row(), edited_at: '2026-10-07T00:02:00Z' }, error: null });
  }
  await f.drain();
  assert.ok(f.pending.includes(hidden), `${kind} actual hidden await reached`);
  if (gap) lose(f);
  const before = f.state.messages[CHAT];
  f.clear(); hidden.resolve({ data: [], error: null });
  const result = await pending; await f.drain();
  if (gap) {
    assert.equal(f.state.messages[CHAT], before, 'GAP_COMPLETION_CANNOT_PUBLISH');
    assert.equal(f.view.pinnedMessages.length, 0, 'GAP_PINNED_CANNOT_PUBLISH');
    assert.equal(f.publications.filter((entry) => ['messages', 'add'].includes(entry.kind)).length, 0);
    if (kind === 'exact') assert.equal(result.ok, false);
    if (kind === 'older') assert.equal(result.loaded, 0);
  } else {
    if (kind === 'exact') assert.equal(result.ok, true);
    if (kind === 'older') assert.equal(result.loaded, 1);
    if (kind === 'pinned') assert.equal(f.view.pinnedMessages.length, 1);
    if (kind === 'update') assert.equal(f.state.messages[CHAT][0].edited_at, '2026-10-07T00:02:00Z');
  }
}
for (const kind of ['exact', 'pinned', 'older', 'update']) for (const gap of [false, true]) {
  test(`${kind}: ${gap ? 'old privacy snapshot refused across gap' : 'no-gap answer still accepted'}`, () => scopedGap(kind, gap));
}

test('same clock tick: gap revokes retained ID trust and pending read tickets', () => {
  const f = fixture();
  const current = f.hides.captureRead();
  f.hides.markVerified(CHAT, [row().id], 10000);
  assert.equal(f.hides.canSkip(CHAT, [row().id]), true);
  f.hides.lost(); f.hides.joined(); f.hides.pingReturned();
  assert.equal(current(), false, 'GAP_TICKET_MUST_RETIRE');
  assert.equal(f.hides.canSkip(CHAT, [row().id]), false, 'GAP_ID_TRUST_MUST_RETIRE');
  const replacement = f.hides.captureRead();
  f.hides.markVerified(CHAT, [row().id], 10000);
  assert.equal(replacement(), true);
  assert.equal(f.hides.canSkip(CHAT, [row().id]), true, 'fresh same-tick read remains usable');
});

test('compiled omission: a constant-valid privacy ticket recreates old history admission', async () => {
  const before = 'return () => generation === this.readGeneration;';
  assert.equal(hiddenSource.split(before).length - 1, 1);
  await assert.rejects(historyGap({ hidden: hiddenSource.replace(before, 'return () => true;') }), /OLD_HIDDEN_ANSWER_CANNOT_ADMIT/);
});

test('compiled omission: consumer ticket independently guards the helper-to-caller yield', async () => {
  const before = 'if (!isCurrent() || !privacyReadIsCurrent()) return;';
  assert.equal(source.split(before).length - 1, 2, 'history and added-ID completion guards');
  await assert.rejects(historyGap({ text: source.replace(before, 'if (!isCurrent()) return;'), gap: false, boundaryGap: true }), /OLD_HIDDEN_ANSWER_CANNOT_ADMIT/);
});
