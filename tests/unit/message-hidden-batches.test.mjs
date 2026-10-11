import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const base = new URL('../../artifacts/kub/src/', import.meta.url);
const source = readFileSync(new URL('hooks/useMessages.ts', base), 'utf8');
const windowSource = readFileSync(new URL('components/chat/ChatWindow.tsx', base), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function javascript(text) {
  const result = ts.transpileModule(text, {reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }});
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  return result.outputText;
}
function select(text, kind = ts.ScriptKind.TS) {
  const tree = ts.createSourceFile('actual.tsx', text, ts.ScriptTarget.Latest, true, kind);
  assert.equal(tree.parseDiagnostics.length, 0);
  const nodes = [];
  const visit = node => { nodes.push(node); ts.forEachChild(node, visit); };
  visit(tree);
  return predicate => {
    const matches = nodes.filter(predicate);
    assert.equal(matches.length, 1, 'exact actual-source AST consumer');
    return matches[0].getText(tree);
  };
}
function actual(text = source) {
  const pick = select(text);
  const declaration = name => pick(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  const variable = name => pick(n => ts.isVariableDeclaration(n) && n.name.getText() === name);
  const initializer = name => {
    const part = select(`const ${variable(name)};`);
    return part(n => ts.isVariableDeclaration(n) && n.name.getText() === name);
  };
  const callback = name => {
    const tree = ts.createSourceFile('callback.ts', `const ${initializer(name)};`, ts.ScriptTarget.Latest, true);
    return tree.statements[0].declarationList.declarations[0].initializer.arguments[0].getText(tree);
  };
  const boundary = variable('boundaryVerified');
  const pending = pick(n => ts.isPropertyAssignment(n) && n.name.getText() === 'historyPending');
  const spinner = select(windowSource, ts.ScriptKind.TSX)(n => ts.isBinaryExpression(n) &&
    n.operatorToken.kind === ts.SyntaxKind.BarBarToken && n.left.getText() === 'loading' &&
    n.right.getText() === 'historyPending');
  const actorModule = {exports: {}};
  vm.runInNewContext(javascript(readFileSync(new URL('lib/messageActor.ts', base), 'utf8')),
    {module: actorModule, exports: actorModule.exports});
  const mergeModule = {exports: {}};
  vm.runInNewContext(javascript(readFileSync(new URL('lib/messageMerge.ts', base), 'utf8')),
    {module: mergeModule, exports: mergeModule.exports, require: name => {
      assert.equal(name, './messageActor.ts'); return actorModule.exports;
    }});
  const context = vm.createContext({console: {error() {}}, ...mergeModule.exports});
  const helpers = ['fetchHiddenMessageIdSet', 'captureMessageAccount', 'messageBelongsToTopic',
    'getMessageAndReplyIds', 'sanitizeHiddenReply', 'sanitizeHiddenReplies'].map(declaration).join('\n');
  vm.runInContext(javascript(`${helpers}\nconst ${variable('MESSAGE_PAGE_SIZE')};
    globalThis.helper = fetchHiddenMessageIdSet;
    globalThis.fetch = ${callback('fetchMessages')};
    globalThis.view = () => {
      const ${boundary};
      const chatMessages = useAppStore.getState().messages[chatId];
      const historyPending = ({${pending}}).historyPending;
      return {visible: (${callback('visibleMessages')})(), pending: historyPending,
        spinner: ${spinner}, boundary: boundaryVerified};
    };`), context);
  return context;
}
function deferredQueries() {
  const calls = [];
  return {calls, supabase: {from(table) {
    assert.equal(table, 'message_hidden_for_users');
    return {select(column) {
      assert.equal(column, 'message_id');
      return {in(column, ids) {
        assert.equal(column, 'message_id');
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        calls.push({ids: [...ids], resolve, reject}); return promise;
      }};
    }};
  }}};
}
function row(id, held = false) {
  return {id, chat_id: 'fictional-chat', topic_id: null, user_id: 'fictional-owner',
    created_at: held ? '2026-10-11T00:00:00Z' : '2026-10-12T00:00:00Z', deleted_at: null};
}
function fixture(count, text = source) {
  const context = actual(text), hidden = deferredQueries(), published = [], marks = [];
  const fetched = Array.from({length: 100}, (_, i) => row(`fresh-${i}`));
  const held = Array.from({length: count - 100}, (_, i) => row(`held-${i}`, true));
  const state = {currentUser: {id: 'fictional-owner'}, accountEpoch: 7,
    messages: {'fictional-chat': held}, chats: [{id: 'fictional-chat', type: 'group'}]};
  const query = {};
  for (const name of ['select', 'eq', 'is', 'gt', 'order']) query[name] = () => query;
  query.limit = async n => { assert.equal(n, 101); return {data: fetched, error: null}; };
  Object.assign(context, {
    chatId: 'fictional-chat', topicId: undefined, generalTopicIds: [], userId: 'fictional-owner', accountEpoch: 7,
    useAppStore: {getState: () => state}, EMPTY_MESSAGES: [], MESSAGE_SELECT_WITH_JOINS: 'fictional-joins',
    hookLifetimeRef: {current: Symbol('fictional-lifetime')}, chatIdRef: {current: 'fictional-chat'},
    topicIdRef: {current: undefined}, historyRequestGenerationRef: {current: 0},
    verifiedChatIdRef: {current: null}, verifiedAccountEpochRef: {current: null},
    currentUserRef: {current: state.currentUser}, clearedAtRef: {current: null},
    hiddenMessageIdsRef: {current: new Set()}, hiddenMessageIds: new Set(), hasMoreOlderRef: {current: false},
    verifiedChatId: null, verifyingChatId: null, historyError: null, loading: false,
    clearedAtCache: {hasFresh: () => false}, loadClearedAt: async () => null,
    supabase: {from: table => table === 'messages' ? query : hidden.supabase.from(table)},
    setLoading: value => { context.loading = value; },
    setHistoryError: value => { context.historyError = value; },
    setVerifiedChatId: value => { context.verifiedChatId = value; context.verifiedChatIdRef.current = value; },
    setVerifyingChatId: value => { context.verifyingChatId = value; },
    setMessages: (chat, rows) => { published.push(rows); state.messages[chat] = rows; },
    rememberHiddenMessageIds: ids => { for (const id of ids) context.hiddenMessageIds.add(id); },
    hiddenMessagesLive: {markVerified: (...args) => marks.push(args)},
    fetchedMessageScopes: new Set(), getPinnedKey: () => 'fictional-scope',
    document: {visibilityState: 'hidden'}, isIncomingMessage: () => false,
    shouldMarkDeliveredForPrivateChat: () => false, keepsDeletedPlaceholder: () => true,
    bumpFetch() {}, setClearedAt() {}, setHasMoreOlder() {}, setOlderError() {}, setPinnedMessages() {}, reportError() {},
  });
  return {context, hidden, published, marks, state};
}
async function finish(calls, pending) {
  let done = false;
  pending.finally(() => { done = true; }).catch(() => {});
  for (let i = 0; i < 8 && !done; i++) {
    for (const call of calls) call.resolve({data: [], error: null});
    await tick();
  }
  await pending;
}
function closed(f) {
  assert.deepEqual(plain(f.context.view()), {visible: [], pending: true, spinner: true, boundary: false});
  assert.equal(f.published.length, 0, 'no visible store admission before all hidden checks');
  assert.equal(f.marks.length, 0, 'no verification before all hidden checks');
}
for (const count of [101, 201]) {
  test(`actual fetchMessages ${count} IDs: second read dispatches while first held; admission waits`, async () => {
    const f = fixture(count), pending = f.context.fetch({cacheIsStale: true});
    try {
      await tick(); closed(f);
      assert.equal(f.hidden.calls.length, 2, 'SECOND_INDEPENDENT_BATCH_DISPATCHED_WHILE_FIRST_HELD');
      assert.deepEqual(f.hidden.calls.map(c => c.ids.length), [100, Math.min(100, count - 100)]);
      f.hidden.calls[1].resolve({data: [{message_id: 'held-0'}], error: null});
      await tick(); closed(f);
      assert.equal(f.hidden.calls.length, 2, 'no next wave before both first-wave reads');
      f.hidden.calls[0].resolve({data: [{message_id: 'fresh-0'}], error: null});
      await tick();
      if (count === 201) {
        closed(f); assert.equal(f.hidden.calls.length, 3);
        assert.equal(f.hidden.calls[2].ids.length, 1);
        f.hidden.calls[2].resolve({data: [{message_id: 'held-100'}], error: null});
      }
      await pending;
      const view = f.context.view();
      assert.equal(view.boundary, true); assert.equal(view.spinner, false); assert.equal(view.pending, false);
      assert.equal(view.visible.length, count - (count === 201 ? 3 : 2));
      assert.equal(view.visible.some(r => ['fresh-0', 'held-0', 'held-100'].includes(r.id)), false);
      assert.equal(f.published.length, 1); assert.equal(f.marks.length, 1);
      assert.equal(new Set(f.hidden.calls.flatMap(c => c.ids)).size, count);
      assert.equal(f.hidden.calls.flatMap(c => c.ids).length, count);
    } finally { await finish(f.hidden.calls, pending); }
  });
}
test('actual helper: zero IDs, retired owner, dedupe, single chunk and null data', async () => {
  const c = actual(), q = deferredQueries();
  assert.equal((await c.helper(q.supabase, [], () => true)).size, 0);
  assert.equal(await c.helper(q.supabase, ['a'], () => false), null);
  assert.equal(q.calls.length, 0);
  const p = c.helper(q.supabase, ['a', '', 'a', 'b'], () => true);
  assert.deepEqual(q.calls[0].ids, ['a', 'b']);
  q.calls[0].resolve({data: [{message_id: 'b'}, {message_id: 'b'}], error: null});
  assert.deepEqual([...await p], ['b']);
  const empty = c.helper(q.supabase, ['c'], () => true);
  q.calls[1].resolve({data: null, error: null}); assert.equal((await empty).size, 0);
});
test('actual fetchMessages: owner retirement during hidden checks never publishes or starts next wave', async () => {
  for (const retire of [f => { f.state.accountEpoch++; }, f => { f.state.currentUser = {id: 'foreign-owner'}; },
    f => { f.context.chatIdRef.current = 'foreign-chat'; }, f => { f.context.topicIdRef.current = 'foreign-topic'; },
    f => { f.context.historyRequestGenerationRef.current++; }, f => { f.context.hookLifetimeRef.current = null; }]) {
    const f = fixture(201), p = f.context.fetch({cacheIsStale: true});
    await tick(); const dispatched = f.hidden.calls.length; retire(f);
    for (const call of f.hidden.calls) call.resolve({data: [], error: null});
    await p; assert.equal(f.hidden.calls.length, dispatched); assert.equal(f.published.length, 0);
    assert.equal(f.marks.length, 0); assert.equal(f.context.view().boundary, false);
  }
});
test('actual caller checks reply IDs and late held rows before final admission', async () => {
  const f = fixture(101);
  f.state.messages['fictional-chat'][0].reply_to_id = 'hidden-reply';
  f.state.messages['fictional-chat'][0].reply_to = {id: 'hidden-reply'};
  const p = f.context.fetch({cacheIsStale: true});
  await tick();
  assert.deepEqual(f.hidden.calls[1].ids, ['held-0', 'hidden-reply']);
  f.state.messages['fictional-chat'] = [...f.state.messages['fictional-chat'], row('late-held', true)];
  f.hidden.calls[1].resolve({data: [{message_id: 'hidden-reply'}], error: null});
  f.hidden.calls[0].resolve({data: [], error: null});
  await tick(); closed(f);
  assert.deepEqual(f.hidden.calls[2].ids, ['late-held']);
  f.hidden.calls[2].resolve({data: [{message_id: 'late-held'}], error: null});
  await p;
  assert.equal(f.context.view().visible.some(r => r.id === 'late-held'), false);
  assert.equal(f.context.view().visible.find(r => r.id === 'held-0').reply_to, undefined);
  assert.equal(f.published.length, 1);
});
function mutatedHelper(before, after) {
  const helper = select(source)(n => ts.isFunctionDeclaration(n) && n.name?.text === 'fetchHiddenMessageIdSet');
  assert.equal(helper.split(before).length, 2, 'exact-one helper mutation');
  return source.replace(helper, helper.replace(before, after));
}
async function requireOverlap(text, expectedSizes = [100, 100]) {
  const f = fixture(201, text), p = f.context.fetch({cacheIsStale: true});
  try {
    await tick(); closed(f);
    assert.equal(f.hidden.calls.length, 2, 'SECOND_INDEPENDENT_BATCH_DISPATCHED_WHILE_FIRST_HELD');
    assert.deepEqual(f.hidden.calls.map(c => c.ids.length), expectedSizes, 'LITERAL_100_ID_BATCH_LIMIT');
  } finally { await finish(f.hidden.calls, p); }
}
test('compiled omission mutant: second parallel batch and literal batch limit are load-bearing', async () => {
  await assert.rejects(requireOverlap(mutatedHelper('.filter((batch) => batch.length)',
    '.filter((batch, index) => batch.length && index === 0)')), /SECOND_INDEPENDENT_BATCH/);
  await assert.rejects(requireOverlap(mutatedHelper('ids.slice(offset, offset + 100)',
    'ids.slice(offset, offset + 101)')), /LITERAL_100_ID_BATCH_LIMIT/);
});
async function requireRetirement(text) {
  const c = actual(text), q = deferredQueries(); let current = true;
  const p = c.helper(q.supabase, Array.from({length: 201}, (_, i) => `id-${i}`), () => current);
  current = false;
  for (const call of q.calls) call.resolve({data: [], error: null});
  let done = false; p.finally(() => { done = true; });
  for (let i = 0; i < 8 && !done; i++) {
    for (const call of q.calls) call.resolve({data: [], error: null}); await tick();
  }
  assert.equal(await p, null, 'RETIRED_HELPER_MUST_REFUSE');
  assert.equal(q.calls.length, 2, 'retirement prevents next wave');
}
test('compiled omission mutant: helper current-owner check is independently load-bearing', async () => {
  await requireRetirement(source);
  await assert.rejects(requireRetirement(mutatedHelper('if (!isCurrent()) return null;\n    for (const { data, error }',
    'for (const { data, error }')), /RETIRED_HELPER_MUST_REFUSE/);
});
test('compiled omission mutant: failed hidden read cannot admit actual caller', async () => {
  const text = mutatedHelper('console.error("Hidden message ids fetch error:", error);\n        return null;',
    'console.error("Hidden message ids fetch error:", error);');
  async function requireRefusal(input) {
    const f = fixture(201, input), p = f.context.fetch({cacheIsStale: true});
    await tick();
    f.hidden.calls[0].resolve({data: null, error: {code: 'fictional-refusal'}});
    await finish(f.hidden.calls, p);
    assert.equal(f.published.length, 0, 'FAILED_HIDDEN_READ_CANNOT_ADMIT');
    assert.equal(f.context.view().boundary, false);
    assert.equal(f.hidden.calls.length, 2, 'failure prevents next wave');
  }
  await requireRefusal(source);
  await assert.rejects(requireRefusal(text), /FAILED_HIDDEN_READ_CANNOT_ADMIT/);
});
test('actual fetchMessages: failed or rejected batch closes admission without next wave', async () => {
  for (const rejection of [false, true]) {
    const f = fixture(201), p = f.context.fetch({cacheIsStale: true});
    await tick(); const dispatched = f.hidden.calls.length;
    if (rejection) f.hidden.calls[0].reject(new Error('fictional-read-failure'));
    else f.hidden.calls[0].resolve({data: null, error: {code: 'fictional-read-failure'}});
    for (const call of f.hidden.calls.slice(1)) call.resolve({data: [], error: null});
    await p; assert.equal(f.hidden.calls.length, dispatched); assert.equal(f.published.length, 0);
    assert.equal(f.marks.length, 0); assert.equal(f.context.view().boundary, false);
    assert.equal(f.context.loading, false); assert.equal(typeof f.context.historyError, 'string');
  }
});
