import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {browserNotificationReadBoundary, closeBrowserNotification} from '../../artifacts/kub/src/lib/browserNotificationPresentation.ts';
import {buildLegacyWebPushPayload} from '../../artifacts/api-server/src/workers/pushDispatcherConfig.ts';
import {buildDeclarativeWebPushPayload} from '../../supabase/functions/send-push-notifications/webpush.ts';

const source = readFileSync(new URL('../../artifacts/kub/public/sw.js', import.meta.url), 'utf8');
const id = n => '80000000-0000-4000-8000-' + String(n).padStart(12, '0');
const CHAT = id(1), OLD = id(2), NEW = id(3), OLD_NOTICE = id(4), NEW_NOTICE = id(5), OWNER = id(7);
const ORIGIN = 'https://app.letscube.ru', TAG = 'message:chat:' + CHAT;
const expected = () => ({notificationId: OLD_NOTICE, chatId: CHAT, messageId: OLD});
const command = () => ({type: 'KUB_CLOSE_NOTIFICATION_IF_MATCH', v: 1, tag: TAG, expected: expected()});
const push = (messageId = OLD, notificationId = OLD_NOTICE) => ({kind: 'message', tag: TAG,
  chatId: CHAT, messageId, web_preview: {preview_v: 1, subscription_id: id(6), notification_id: notificationId}});
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};

// Browser ports only. Both push publication and close consumption execute the
// complete shipped worker, not a test copy of its validators or close logic.
function worker(text = source) {
  const listeners = new Map(), cards = [], queries = [];
  let holdNext = null;
  const fixture = {cards, queries, holdQuery() {holdNext = deferred(); return holdNext;}};
  vm.runInNewContext(text, {URL, Promise, Date, setTimeout, clearTimeout,
    self: {location: {origin: ORIGIN}, addEventListener: (type, fn) => listeners.set(type, fn),
      registration: {
        getNotifications(options) {
          queries.push(structuredClone(options));
          if (holdNext) {const hold = holdNext; holdNext = null; return hold.promise;}
          return Promise.resolve(cards.filter(card => !card.closed && card.tag === options.tag));
        },
        async showNotification(title, options) {
          const card = {title, ...structuredClone(options), closed: false, close() {this.closed = true;}};
          cards.push(card);
        },
      }, clients: {matchAll: async () => []}},
  }, {filename: 'sw.js'});
  fixture.message = (data = command(), client = {id: 'own-window', type: 'window', url: ORIGIN + '/'}) => {
    const pending = [];
    listeners.get('message')({data, source: client, waitUntil: p => pending.push(p)});
    return Promise.all(pending);
  };
  fixture.push = async (data = push(), declarative = false) => {
    const pending = [];
    listeners.get('push')({data: declarative ? null : {json: () => data}, notification: declarative ? data.notification : undefined,
      waitUntil: p => pending.push(p)});
    await Promise.all(pending);
    return cards.at(-1);
  };
  return fixture;
}

function subjectWire(renderer, {kind = 'task_reminder', notificationId = OLD_NOTICE, subscriptionId = id(6), build} = {}) {
  const subject = id(9), task = kind.startsWith('task_');
  const input = {kind, notificationId, tag: (task ? 'task:' : 'invite:') + subject, title: 'LETSCUBE', body: 'Новое уведомление',
    url: task ? '/tasks' : '/?notifications=1', chatId: '', messageId: '', renotify: true};
  return renderer === 'legacy' ? (build ?? buildLegacyWebPushPayload)(input, subscriptionId, ORIGIN)
    : (build ?? buildDeclarativeWebPushPayload)(input, ORIGIN, {subscriptionId, notificationId}, true);
}

async function subjectCloses(renderer, build) {
  const wire = subjectWire(renderer, {build}), f = worker(), card = await f.push(wire), packets = [];
  const row = {...readRow(), kind: 'task_reminder', payload: {task_id: id(9), status: 'confirmed'}, feed_revision: 2};
  await withNavigator(Promise.resolve({active: {postMessage: data => packets.push(structuredClone(data))}}), async () => {
    await closeBrowserNotification('task:' + id(9), () => true, browserNotificationReadBoundary(row, OWNER));
  });
  for (const packet of packets) await f.message(packet);
  assert.equal(card.closed, true, 'SAME_ROW_METADATA_UPDATE_MUST_NOT_STRAND_CARD');
}

test('both actual renderers refuse malformed notification/subscription IDs without identity fallback', () => {
  for (const renderer of ['legacy', 'declarative']) {
    for (const bad of ['', 'unknown', OLD_NOTICE + '0', ' ' + OLD_NOTICE, null]) {
      for (const options of [{notificationId: bad}, {subscriptionId: bad}]) {
        const wire = subjectWire(renderer, options);
        assert.equal(Object.hasOwn(wire, 'notificationId'), false, 'UNKNOWN_SOURCE_MUST_NOT_SUPPLY_ROW_ID');
        assert.equal(Object.hasOwn(wire.notification?.data ?? {}, 'notificationId'), false);
        assert.equal(Object.hasOwn(wire, 'web_preview'), false);
      }
    }
  }
});

test('task/invite mutable declarative delivery and same-row metadata updates retain exact cleanup', async () => {
  for (const renderer of ['legacy', 'declarative']) {
    await subjectCloses(renderer);
    for (const kind of ['task_reminder', 'group_invite']) {
      const wire = subjectWire(renderer, {kind}), f = worker(), card = await f.push(wire, true);
      const subjectKind = kind === 'group_invite' ? 'invite' : 'task';
      await f.message({type: 'KUB_CLOSE_NOTIFICATION_IF_MATCH', v: 1, tag: subjectKind + ':' + id(9),
        expected: {notificationId: OLD_NOTICE, subjectKind, subjectId: id(9)}});
      assert.equal(card.closed, true, 'DECLARATIVE_EVENT_MUST_RETAIN_ROW_ID');
      assert.equal(card.title, 'LETSCUBE'); assert.equal(card.body, 'Новое уведомление');
    }
  }
});

test('new task/invite metadata uses declarative fallback rather than an older strict mutable decoder', () => {
  for (const kind of ['task_reminder', 'group_invite']) {
    const wire = subjectWire('declarative', {kind});
    assert.equal(wire.notification.data.notificationId, OLD_NOTICE);
    assert.equal(wire.mutable, false, 'OLD_WORKER_MUST_NOT_RECEIVE_UNSUPPORTED_DATA_FIELD');
    assert.equal(wire.notification.navigate, kind === 'group_invite' ? ORIGIN + '/?notifications=1' : ORIGIN + '/tasks');
  }
});

test('queued task/invite read close preserves the next notification row with the same subject tag', async () => {
  for (const renderer of ['legacy', 'declarative']) for (const kind of ['task_reminder', 'group_invite']) {
    const f = worker(), wire = subjectWire(renderer, {kind}); await f.push(wire);
    const subjectKind = kind === 'group_invite' ? 'invite' : 'task', hold = f.holdQuery();
    const close = f.message({type: 'KUB_CLOSE_NOTIFICATION_IF_MATCH', v: 1, tag: subjectKind + ':' + id(9),
      expected: {notificationId: OLD_NOTICE, subjectKind, subjectId: id(9)}});
    const newer = await f.push(subjectWire(renderer, {kind, notificationId: NEW_NOTICE}));
    hold.resolve([newer]); await close;
    assert.equal(newer.closed, false, 'NEW_SUBJECT_ROW_MUST_SURVIVE_OLD_CLOSE');
  }
});

test('malformed nonmessage identities, mixed boundary classes and unknown owners cannot close cards', async () => {
  const valid = {notificationId: OLD_NOTICE, subjectKind: 'task', subjectId: id(9)};
  for (const patch of [{notificationId: OLD_NOTICE + '0'}, {subjectId: id(9) + '0'}, {subjectKind: 'message'},
    {extra: true}, {chatId: CHAT}, {subjectId: id(10)}]) {
    const f = worker(), card = await f.push(subjectWire('declarative'));
    await f.message({type: 'KUB_CLOSE_NOTIFICATION_IF_MATCH', v: 1, tag: 'task:' + id(9), expected: {...valid, ...patch}});
    assert.equal(card.closed, false, 'MALFORMED_SUBJECT_BOUNDARY_MUST_REFUSE');
  }
  const row = {...readRow(), kind: 'task_reminder', payload: {task_id: id(9)}};
  assert.equal(browserNotificationReadBoundary(row, null), null);
  assert.equal(browserNotificationReadBoundary(row, id(10)), null);
  const explicit = worker(), explicitCard = await explicit.push(subjectWire('declarative'));
  explicitCard.data.notificationId = OLD_NOTICE; explicitCard.data.closeBoundary = null;
  await explicit.message({type: 'KUB_CLOSE_NOTIFICATION_IF_MATCH', v: 1, tag: 'task:' + id(9), expected: valid});
  assert.equal(explicitCard.closed, false, 'EXPLICIT_INVALID_BOUNDARY_MUST_NOT_FALL_BACK');
  for (const renderer of ['legacy', 'declarative']) {
    const f = worker(), wire = subjectWire(renderer); wire.notification.data.notificationId = 'unknown';
    const card = await f.push(wire, true);
    await f.message({type: 'KUB_CLOSE_NOTIFICATION_IF_MATCH', v: 1, tag: 'task:' + id(9), expected: valid});
    assert.equal(card.closed, false, 'INVALID_DECLARATIVE_ID_MUST_NOT_CLOSE');
  }
});

test('actual renderer row-ID/compatibility omission mutations fail literal consumer oracles', async () => {
  for (const [renderer, path, from] of [
    ['legacy', '../../artifacts/api-server/src/workers/pushDispatcherConfig.ts', 'result["notificationId"] = payload["notificationId"].toLowerCase();'],
    ['declarative', '../../supabase/functions/send-push-notifications/webpush.ts', 'neutral.notificationId = selector.notificationId.toLowerCase();'],
  ]) {
    const code = readFileSync(new URL(path, import.meta.url), 'utf8'); assert.equal(code.split(from).length, 2);
    const mutant = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code.replace(from, ''))).toString('base64'));
    await assert.rejects(subjectCloses(renderer, renderer === 'legacy' ? mutant.buildLegacyWebPushPayload : mutant.buildDeclarativeWebPushPayload),
      e => e.code === 'ERR_ASSERTION' && e.message.includes('SAME_ROW_METADATA_UPDATE_MUST_NOT_STRAND_CARD'));
  }
  const code = readFileSync(new URL('../../supabase/functions/send-push-notifications/webpush.ts', import.meta.url), 'utf8');
  const from = 'compatibleWorker === true && !neutral.notificationId'; assert.equal(code.split(from).length, 2);
  const mutant = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code.replace(from, 'compatibleWorker === true'))).toString('base64'));
  const wire = subjectWire('declarative', {build: mutant.buildDeclarativeWebPushPayload});
  assert.throws(() => assert.equal(wire.mutable, false, 'OLD_WORKER_MUST_NOT_RECEIVE_NEW_DATA'), e => e.code === 'ERR_ASSERTION');
});

test('actual worker closes the exact confirmed-read card (positive control)', async () => {
  const f = worker(), card = await f.push();
  await f.message();
  assert.equal(card.closed, true, 'EXACT_CONFIRMED_CARD_MUST_CLOSE');
});

async function newerSurvives(text = source) {
  const f = worker(text);
  await f.push();
  const hold = f.holdQuery();
  const close = f.message(); // Already dispatched, getNotifications is in flight.
  const newer = await f.push(push(NEW, NEW_NOTICE));
  hold.resolve([newer]);
  await close;
  assert.equal(newer.closed, false, 'NEW_UNREAD_CARD_MUST_SURVIVE_QUEUED_CLOSE');
}

test('already-dispatched close cannot remove the newer same-chat unread card', () => newerSurvives());

test('close still queued before worker dispatch cannot remove a replacement', async () => {
  const f = worker(), queued = command();
  await f.push();
  const newer = await f.push(push(NEW, NEW_NOTICE));
  await f.message(queued);
  assert.equal(newer.closed, false, 'QUEUED_COMMAND_MUST_NOT_CLEAR_NEW_TAG');
});

async function mismatchedCard(text = source, changes = {}) {
  const f = worker(text), card = await f.push();
  Object.assign(card.data.closeBoundary, changes);
  await f.message();
  assert.equal(card.closed, false, 'MISMATCHED_CARD_MUST_SURVIVE');
}

test('every exact card field matters, not just the shared chat tag', async () => {
  for (const changes of [{notificationId: NEW_NOTICE}, {messageId: NEW}, {chatId: id(8)}]) {
    await mismatchedCard(source, changes);
  }
  const f = worker(), card = await f.push(), hold = f.holdQuery();
  card.tag = 'message:chat:' + id(8);
  const close = f.message(); hold.resolve([card]); await close;
  assert.equal(card.closed, false, 'FOREIGN_TAG_MUST_SURVIVE_PROVIDER_RESULT');
});

async function malformedRefused(text = source, mutate = () => {}) {
  const f = worker(text), card = await f.push(), data = command();
  mutate(data);
  await f.message(data);
  assert.equal(card.closed, false, 'MALFORMED_CLOSE_MUST_NOT_CLEAR_TAG');
  assert.equal(f.queries.length, 1, 'MALFORMED_CLOSE_MUST_NOT_QUERY'); // Only push replacement query.
}

test('legacy tag-only, unsupported versions, extra fields and malformed IDs refuse without a query', async () => {
  for (const mutate of [
    c => {c.type = 'KUB_CLOSE_NOTIFICATION'; delete c.v; delete c.expected;},
    c => {delete c.v; delete c.expected;}, c => {c.v = 2;}, c => {c.v = '1';},
    c => {c.extra = 'not admitted';}, c => {c.expected = null;}, c => {c.expected = [];},
    c => {c.expected.extra = true;}, c => {c.expected.notificationId = 'unknown';},
    c => {c.expected.messageId = '';}, c => {c.expected.chatId = id(8);},
    c => {c.tag += ' ';}, c => {c.tag = ['message:chat:' + CHAT];},
  ]) await malformedRefused(source, mutate);
});

test('36-byte UUID and canonical tag boundaries reject truncation, Unicode and surrounding whitespace', async () => {
  assert.equal(Buffer.byteLength(OLD_NOTICE, 'utf8'), 36);
  for (const field of ['notificationId', 'chatId', 'messageId']) {
    for (const value of [id(1) + '0', id(1).slice(0, -1), ' ' + id(1), id(1) + '\n', id(1).slice(0, -1) + '\u00e9']) {
      await malformedRefused(source, c => {c.expected[field] = value;});
    }
  }
});

test('missing or foreign window source cannot close a card', async () => {
  for (const client of [null, {}, {type: 'worker', url: ORIGIN},
    {type: 'window', frameType: 'nested', url: ORIGIN},
    {type: 'window', url: ORIGIN + '.invalid/'}, {type: 'window', url: 'not a URL'}]) {
    const f = worker(), card = await f.push(); await f.message(command(), client);
    assert.equal(card.closed, false, 'UNKNOWN_SOURCE_MUST_NOT_CLOSE');
    assert.equal(f.queries.length, 1);
  }
});

test('unknown/legacy card identity never falls back to full tag clear; generic privacy stays generic', async () => {
  for (const patch of [{web_preview: undefined}, {web_preview: {preview_v: 1, notification_id: OLD_NOTICE}},
    {web_preview: {...push().web_preview, extra: true}}]) {
    const f = worker(), card = await f.push({...push(), ...patch, title: 'UNTRUSTED', body: 'UNTRUSTED'});
    await f.message();
    assert.equal(card.closed, false, 'UNKNOWN_CARD_MUST_SURVIVE');
    assert.equal(card.title, 'LETSCUBE'); assert.equal(card.body, 'Новое уведомление');
    assert.equal(card.data.closeBoundary, null);
  }
  const f = worker(), card = await f.push();
  assert.equal(card.title, 'LETSCUBE'); assert.equal(card.body, 'Новое уведомление');
  assert.deepEqual(card.data.closeBoundary, expected(), 'REAL_PUSH_MUST_PRODUCE_EXACT_CARD_BOUNDARY');
});

const readRow = () => ({id: OLD_NOTICE, user_id: OWNER, read_at: '2026-10-28T12:00:00Z',
  kind: 'message', payload: {chat_id: CHAT, message_id: OLD}});

test('only a confirmed own message row can form a read boundary; unknown owner refuses', () => {
  assert.deepEqual(browserNotificationReadBoundary(readRow(), OWNER), expected());
  for (const owner of [null, '', 'unknown', id(8)]) assert.equal(browserNotificationReadBoundary(readRow(), owner), null);
  for (const patch of [{read_at: null}, {user_id: id(8)}, {id: 'bad'}, {kind: 'task'}, {payload: []},
    {payload: {chat_id: CHAT}}, {payload: {chat_id: CHAT, message_id: OLD + '0'}}]) {
    assert.equal(browserNotificationReadBoundary({...readRow(), ...patch}, OWNER), null);
  }
});

async function withNavigator(ready, run) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {serviceWorker: {ready}}});
  try {await run();} finally {if (old) Object.defineProperty(globalThis, 'navigator', old); else delete globalThis.navigator;}
}

test('actual helper serializes exact read data before readiness; later input mutation cannot widen it', async () => {
  const ready = deferred(), sent = [], boundary = expected();
  await withNavigator(ready.promise, async () => {
    const pending = closeBrowserNotification(TAG, () => true, boundary);
    boundary.notificationId = NEW_NOTICE;
    ready.resolve({active: {postMessage: data => sent.push(structuredClone(data))}});
    await pending;
  });
  assert.deepEqual(sent, [command()]);
  // Actual old/new worker coexistence: never hand a new boundary packet to
  // the old tag-only command gate, which would ignore the extra fields.
  let legacyClosed = false;
  const legacy = vm.runInNewContext('(event) => { if (event.data?.type === "KUB_CLOSE_NOTIFICATION") closeTag(); }',
    {closeTag() {legacyClosed = true;}});
  legacy({data: sent[0]}); assert.equal(legacyClosed, false, 'NEW_PACKET_MUST_BE_INERT_IN_LEGACY_WORKER');
  const f = worker(), card = await f.push();
  await f.message(sent[0]); assert.equal(card.closed, true, 'ACTUAL_HELPER_AND_WORKER_MUST_COMPOSE');
});

test('helper refuses missing/oversized identity without dispatch; lookup failure never triggers a tag clear', async () => {
  const sent = [];
  await withNavigator(Promise.resolve({active: {postMessage: data => sent.push(data)}}), async () => {
    for (const boundary of [null, {...expected(), messageId: OLD + '0'}, {...expected(), extra: true}]) {
      await closeBrowserNotification(TAG, () => true, boundary);
    }
    await closeBrowserNotification(TAG + ' ', () => true, expected());
  });
  assert.equal(sent.length, 0);
  const f = worker(), card = await f.push(), hold = f.holdQuery();
  const pending = f.message(); hold.resolve(Promise.reject(new Error('FICTIONAL_LOOKUP_FAILURE')));
  await assert.doesNotReject(pending); assert.equal(card.closed, false);
});

function replaced(from, to) {
  assert.equal(source.split(from).length, 2, 'EXACT_MUTATION_ANCHOR_REQUIRED');
  return source.replace(from, to);
}

test('actual worker guard/publisher mutations fail literal card-survival or exact-close oracles', async () => {
  for (const [from, to, changes] of [
    ['actual.notificationId !== expected.notificationId', 'false', {notificationId: NEW_NOTICE}],
    ['actual.messageId === expected.messageId', 'true', {messageId: NEW}],
  ]) {
    await assert.rejects(mismatchedCard(replaced(from, to), changes), e => e.code === 'ERR_ASSERTION' && e.message.includes('MISMATCHED_CARD_MUST_SURVIVE'));
  }
  await assert.rejects(malformedRefused(replaced('!previewExact(data, ["type", "v", "tag", "expected"]) || data.v !== 1',
    '!previewExact(data, ["type", "v", "tag", "expected"]) || false'), c => {c.v = 2;}),
    e => e.code === 'ERR_ASSERTION' && e.message.includes('MALFORMED_CLOSE_MUST_NOT_CLEAR_TAG'));
  const f = worker(replaced('closeBoundary: data.closeBoundary,', 'closeBoundary: null,')), card = await f.push();
  await f.message();
  assert.throws(() => assert.equal(card.closed, true, 'EXACT_CARD_MUST_CLOSE'), e => e.code === 'ERR_ASSERTION');
  const looseUuid = replaced('[a-f0-9]{12}$/.test(value)', '[a-f0-9]{12,13}$/.test(value)');
  const over = worker(looseUuid), overCard = await over.push(push(OLD, OLD_NOTICE + '0'));
  const overCommand = command(); overCommand.expected.notificationId += '0';
  await over.message(overCommand);
  assert.throws(() => assert.equal(overCard.closed, false, '37_BYTE_ID_MUST_REFUSE'), e => e.code === 'ERR_ASSERTION');
});

for (const kind of ['task_assigned', 'group_invite']) {
  for (const renderer of ['legacy', 'declarative']) {
    test(`confirmed ${kind} read closes its exact card through the actual ${renderer} producer`, async () => {
      const isTask = kind === 'task_assigned', subject = id(9), tag = (isTask ? 'task:' : 'invite:') + subject;
      // Shape emitted by _enqueue_push_after_notification_insert: the row UUID
      // is independent of the task/invite tag and belongs to one recipient.
      const input = {kind, notificationId: OLD_NOTICE, title: 'LETSCUBE', body: 'Новое уведомление',
        tag, url: isTask ? '/tasks' : '/?notifications=1', taskId: isTask ? subject : '', inviteId: isTask ? '' : subject,
        chatId: '', messageId: '', senderKind: '', senderId: '', botId: '', senderName: '', senderAvatarUrl: '',
        messageType: '', preview: '', groupTag: '', renotify: true};
      const wire = renderer === 'legacy' ? buildLegacyWebPushPayload(input, id(6), ORIGIN)
        : buildDeclarativeWebPushPayload(input, ORIGIN, {subscriptionId: id(6), notificationId: OLD_NOTICE}, true);
      assert.deepEqual(Object.keys(wire.notification.data).sort(), ['chatId', 'kind', 'messageId', 'notificationId', 'renotify', 'tag', 'url']);
      assert.equal(Buffer.byteLength(wire.notification.data.notificationId, 'utf8'), 36);
      const f = worker(), card = await f.push(wire), packets = [];
      const row = {...readRow(), kind, payload: isTask ? {task_id: subject} : {invite_id: subject}};
      await withNavigator(Promise.resolve({active: {postMessage: data => packets.push(structuredClone(data))}}), async () => {
        await closeBrowserNotification(tag, () => true, browserNotificationReadBoundary(row, OWNER));
      });
      for (const packet of packets) await f.message(packet);
      assert.equal(card.closed, true, 'CONFIRMED_NONMESSAGE_CARD_MUST_CLOSE');
    });
  }
}

for (const renderer of ['legacy', 'declarative']) {
  test(`${renderer} declarative fallback retains the exact nonmessage card identity`, async () => {
    const subject = id(9), tag = 'task:' + subject, row = {...readRow(), kind: 'task_reminder', payload: {task_id: subject}};
    const input = {kind: row.kind, notificationId: OLD_NOTICE, tag, title: 'LETSCUBE', body: 'Новое уведомление', url: '/tasks',
      chatId: '', messageId: '', renotify: true};
    const wire = renderer === 'legacy' ? buildLegacyWebPushPayload(input, id(6), ORIGIN)
      : buildDeclarativeWebPushPayload(input, ORIGIN, {subscriptionId: id(6), notificationId: OLD_NOTICE}, false);
    // OS declarative publication can bypass showPushNotification entirely.
    const f = worker(), card = {tag: wire.notification.tag, data: structuredClone(wire.notification.data),
      closed: false, close() {this.closed = true;}};
    f.cards.push(card);
    const packets = [];
    await withNavigator(Promise.resolve({active: {postMessage: data => packets.push(structuredClone(data))}}), async () => {
      await closeBrowserNotification(tag, () => true, browserNotificationReadBoundary(row, OWNER));
    });
    for (const packet of packets) await f.message(packet);
    assert.equal(card.closed, true, 'DECLARATIVE_NONMESSAGE_CARD_MUST_CLOSE');
  });
}
