import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const path = new URL('../../artifacts/kub/src/lib/historyCache/offline.ts', import.meta.url);
let source = 'export {};';
try { source = await readFile(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const id = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const time = '2026-10-23T10:00:00.123456Z';
const identity = { userId: id(1), sessionId: id(2) };
const scope = { chatId: id(3), topicId: undefined, generalTopicIds: [] };
const message = (n = 4) => ({ id: id(n), chat_id: id(3), topic_id: null, user_id: id(1), bot_id: null,
  type: 'text', content: 'synthetic received text', created_at: time, edited_at: null, deleted_at: null,
  pinned: false, client_message_id: id(5), client_sent_at: time, sender: profile(),
  media_bucket: null, media_path: null, media_url: null, media_metadata: null,
  reply_to_id: null, forwarded_from_id: null, bot_reply_markup: null,
  bot_input_field_placeholder: null, system_payload: null });
const profile = () => ({ id: id(1), full_name: 'Synthetic sender', username: 'fixture', role: 'admin',
  created_at: time, updated_at: time, avatar_url: 'https://invalid.test/private?token=secret',
  email: 'private fixture', phone: 'private fixture', access_token: 'never-store' });

function storageFixture() {
  const records = new Map(), generations = new Map(); let counter = 0;
  const ownerKey = lease => JSON.stringify([lease.namespace, lease.ownerId]);
  return { records, async capture(namespace, ownerId) {
    const key = JSON.stringify([namespace, ownerId]); if (!generations.has(key)) generations.set(key, ++counter);
    return { namespace, ownerId, generation: generations.get(key) };
  }, async read(lease, scope) { return generations.get(ownerKey(lease)) === lease.generation ? records.get(JSON.stringify([ownerKey(lease), scope])) ?? null : null; },
  async write(lease, scope, value, now) {
    if (generations.get(ownerKey(lease)) !== lease.generation) return false;
    records.set(JSON.stringify([ownerKey(lease), scope]), { ...value, verifiedAt: now }); return true;
  }, async invalidate(namespace, ownerId, scope) {
    const key = JSON.stringify([namespace, ownerId]); generations.set(key, ++counter);
    for (const item of records.keys()) { const [owner, rowScope] = JSON.parse(item); if (owner === key && (scope === undefined || scope === rowScope)) records.delete(item); }
  } };
}
function setup(storage = storageFixture(), namespace = 'https://backend.invalid') {
  assert.equal(typeof api.createOfflineHistory, 'function', 'offline received-history service is not integrated');
  const cache = api.createOfflineHistory({ storage, namespace, now: () => 1000 });
  cache.setIdentity(identity); return { cache, owner: cache.capture(), storage };
}

test('cold restore retains received text/client identity without network or secret fields', async () => {
  const f = setup();
  assert.equal(await f.owner.writeProfile(profile()), true);
  assert.equal(await f.owner.writeMessages(scope, [message()], { hasMore: true }), true);
  const cold = setup(f.storage);
  const saved = await cold.owner.readMessages(scope);
  assert.equal(saved.messages[0].content, 'synthetic received text');
  assert.equal(saved.messages[0].client_message_id, id(5));
  assert.equal(saved.hasMore, true);
  assert.equal(saved.messages[0].sender.full_name, 'Synthetic sender');
  assert.equal((await cold.owner.readProfile()).role, 'user');
  assert.doesNotMatch(JSON.stringify([...f.storage.records.values()]), /never-store|private fixture|token=secret/);
});

test('account/session/backend changes never borrow a previous snapshot', async () => {
  const f = setup(); await f.owner.writeMessages(scope, [message()], { hasMore: false });
  const other = setup(f.storage, 'https://other.invalid');
  assert.equal(await other.owner.readMessages(scope), null);
  f.cache.setIdentity({ userId: id(1), sessionId: id(20) });
  assert.equal(await f.cache.capture().readMessages(scope), null);
  assert.equal(await f.owner.readMessages(scope), null);
  assert.equal(await f.owner.writeProfile(profile()), false);
});

test('clear retires chat pages and held producers before any await', async () => {
  const f = setup(); await f.owner.writeMessages(scope, [message()], { hasMore: false });
  const old = f.owner;
  await f.owner.invalidateChat(scope.chatId);
  assert.equal(await old.readMessages(scope), null);
  assert.equal(await old.writeMessages(scope, [message()], { hasMore: false }), false);
  const renewed = f.cache.capture();
  assert.equal(await renewed.readMessages(scope), null);
  assert.equal(await renewed.writeMessages(scope, [message(9)], { hasMore: false }), true);
});

test('scope is exact; corruption, pending and foreign-chat rows cannot restore', async () => {
  const f = setup();
  await f.owner.writeMessages(scope, [message()], { hasMore: false });
  assert.equal(await f.owner.readMessages({ ...scope, topicId: null }), null);
  const record = [...f.storage.records.values()][0]; record.payload += ' ';
  assert.equal(await f.owner.readMessages(scope), null);
  for (const edit of [{ pending: true }, { id: 'tmp:fixture' }, { chat_id: id(60) }]) {
    assert.equal(await f.owner.writeMessages(scope, [{ ...message(), ...edit }], { hasMore: false }), false);
  }
});

test('fresh display projections keep attachment slots and replies without signed URLs', async () => {
  const f = setup();
  const media = { ...message(), type: 'image', media_bucket: 'chat-media', media_path: 'fixture/image.webp',
    media_url: 'https://invalid.test/object?token=secret', media_metadata: { width: 640, height: 480, access_token: 'never-store' },
    reply_to_id: id(8), reply_to: message(8) };
  assert.equal(await f.owner.writeMessages(scope, [media], { hasMore: false }), true);
  const restored = await f.owner.readMessages(scope);
  assert.equal(restored.messages[0].type, 'image');
  assert.equal(restored.messages[0].media_path, 'fixture/image.webp');
  assert.equal(restored.messages[0].reply_to.content, 'synthetic received text');
  assert.equal(restored.messages[0].media_url, null);
  assert.doesNotMatch(JSON.stringify([...f.storage.records.values()]), /token=secret|never-store/);
});

test('actual partial reply join can be cached without inventing a full message row', async () => {
  const f = setup();
  const reply = { id: id(8), content: 'Synthetic short reply', type: 'text', media_bucket: null, media_path: null,
    media_url: null, user_id: id(1), bot_id: null, deleted_at: null,
    sender: { id: id(1), full_name: 'Synthetic sender', username: 'fixture', avatar_url: null } };
  assert.equal(await f.owner.writeMessages(scope, [{ ...message(), reply_to_id: id(8), reply_to: reply }], { hasMore: false }), true);
  const saved = await f.owner.readMessages(scope);
  assert.equal(saved.messages[0].reply_to.content, 'Synthetic short reply');
  assert.equal(saved.messages[0].reply_to.id, id(8));
});

test('a topic snapshot never accepts rows from other topics', async () => {
  const f = setup(), scoped = { ...scope, topicId: id(30) };
  assert.equal(await f.owner.writeMessages(scoped, [message()], { hasMore: false }), false);
  assert.equal(await f.owner.writeMessages(scoped, [{ ...message(), topic_id: id(30) }], { hasMore: false }), true);
  assert.equal((await f.owner.readMessages(scoped)).messages.length, 1);
});

test('unavailable disk and retired publication are soft misses, not network dependencies', async () => {
  const f = setup();
  assert.equal(await f.owner.writeMessages(scope, [message()], { hasMore: false }, () => false), false);
  f.storage.capture = async () => { throw new Error('synthetic private failure'); };
  assert.equal(await f.owner.readProfile(), null);
  assert.equal(await f.owner.writeProfile(profile()), false);
});

test('failed retirement cannot expose old snapshots through a newly captured handle', async () => {
  const f = setup(); await f.owner.writeProfile(profile());
  f.storage.invalidate = async () => { throw Error('synthetic disk refused'); };
  await f.owner.invalidate();
  assert.equal(await f.cache.capture().readProfile(), null);
});

test('a durable retirement during the final digest yield cannot publish an old read', async () => {
  const f = setup(); await f.owner.writeProfile(profile());
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let invalidate = true;
  crypto.subtle.digest = async (...args) => {
    const result = await original(...args);
    if (invalidate) { invalidate = false; await f.storage.invalidate('https://backend.invalid|offline-v1|' + identity.sessionId, identity.userId); }
    return result;
  };
  try { assert.equal(await f.owner.readProfile(), null); } finally { crypto.subtle.digest = original; }
});

test('a slow earlier persistence cannot overwrite a newer admitted display snapshot', async () => {
  const f = setup();
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest = async (_algorithm, input) => Uint8Array.from(createHash('sha256').update(new Uint8Array(input)).digest()).buffer;
  const original = f.storage.write.bind(f.storage);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let first = true;
  f.storage.write = async (...args) => { if (first) { first = false; entered(); await gate; } return original(...args); };
  try {
    const older = f.owner.writeMessages(scope, [message()], { hasMore: false }); await started;
    const newer = f.owner.writeMessages(scope, [{ ...message(), content: 'Synthetic newer version' }], { hasMore: false });
    await new Promise(setImmediate); release(); await Promise.all([older, newer]);
    assert.equal((await f.owner.readMessages(scope)).messages[0].content, 'Synthetic newer version');
  } finally { release(); crypto.subtle.digest = nativeDigest; }
});
