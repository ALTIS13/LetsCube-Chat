import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { spawnSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const ME = "11111111-1111-4111-8111-000000000001";
const OTHER = "11111111-1111-4111-8111-000000000002";
const CHAT = "22222222-2222-4222-8222-000000000001";
const REVISION = "33333333-3333-4333-8333-000000000001";
const content = "\u{1f680} hi @Ada and @cube";
const serialized = '{"version":1,"revision":"33333333-3333-4333-8333-000000000001","items":[{"kind":"user","user_id":"11111111-1111-4111-8111-000000000002","offset":6,"length":4,"label":"@Ada"},{"kind":"bot","bot_id":"44444444-4444-4444-8444-000000000001","offset":15,"length":5,"label":"@cube"}]}';
const mentions = () => JSON.parse(serialized);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const timers = { set: () => null, clear: () => {} };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function entry(extra: Record<string, unknown> = {}) {
  return {
    clientMessageId: "55555555-5555-4555-8555-000000000001", userId: ME, chatId: CHAT,
    topicId: null, type: "text", content, replyToId: null, forwardedFromId: null,
    mediaBucket: null, mediaPath: null, mediaUrl: null, clientSentAt: "2026-10-01T12:00:00.000Z",
    tempId: "tmp:55555555-5555-4555-8555-000000000001", attempts: 0, nextAttemptAt: 0,
    mentionEntities: mentions(), ...extra,
  };
}

function media(extra: Record<string, unknown> = {}) {
  const file = new File(["bytes"], "@Ada.txt", { type: "text/plain" });
  return {
    tempId: "tmp:media", chatId: CHAT, topicId: null, replyToId: null, caption: content,
    mentionEntities: mentions(), clientSentAt: "2026-10-01T12:00:00.000Z",
    attachment: {
      id: "attachment", file, kind: "file", previewUrl: null, name: file.name,
      size: file.size, mimeType: file.type, status: "failed", progress: null, error: null,
      clientMessageId: "media", uploaded: null, caption: content, mentionEntities: mentions(),
    }, ...extra,
  };
}

// Execute the actual TS modules; substitute only network/store boundaries.
function modules(stubs: Record<string, unknown> = {}, environment: Record<string, unknown> = {}) {
  const cache = new Map<string, { exports: any }>();
  const load = (relative: string): any => {
    let filename = path.resolve(root, relative);
    if (!existsSync(filename)) filename += ".ts";
    const key = path.relative(root, filename).replaceAll("\\", "/");
    if (Object.hasOwn(stubs, key)) return stubs[key];
    if (cache.has(filename)) return cache.get(filename)!.exports;
    let source = readFileSync(filename, "utf8");
    const mutation = process.env.D331_TRANSPORT_MUTANT;
    const replacements: Record<string, [string, string, string]> = {
      payload: ["lib/outbox/appOutbox.ts", "...(entry.mentionEntities === undefined ? {} : { mention_entities: { ...entry.mentionEntities } }),", ""],
      optimistic: ["lib/optimisticMessage.ts", "...{ mention_entities: { ...structuredClone(input.mentionEntities ?? emptyMessageMentions()) } },", ""],
      background: ["lib/outbox/appBackgroundUploads.ts", "...(mentionEntities === undefined ? {} : { mentionEntities }),", ""],
      persisted: ["lib/outbox/outgoingMediaStorage.ts", "entry: snapshotOutgoingEntry({ ...entry, attachment:", "entry: snapshotOutgoingEntry({ ...entry, mentionEntities: undefined, attachment:"],
      carrier: ["lib/attachmentSendQueue.ts", "if (attachmentId !== carrierId) return { caption: null };", "if (false) return { caption: null };"],
      placeholder: ["lib/attachmentPlaceholder.ts", "mentionEntities: stagedAttachmentMentionEntities(input.attachment.kind, input.caption, input.mentionEntities ?? input.attachment.mentionEntities),", ""],
      restored: ["hooks/useOutbox.ts", "mentionEntities: entry.mentionEntities,", ""],
    };
    const replacement = mutation ? replacements[mutation] : undefined;
    if (replacement?.[0] === key) {
      assert.ok(source.includes(replacement[1]), `mutation anchor missing: ${mutation}`);
      source = source.replaceAll(replacement[1], replacement[2]);
    }
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    const module = { exports: {} };
    cache.set(filename, module);
    const require = (specifier: string) => {
      if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
      if (specifier.startsWith("@/")) return load(specifier.slice(2));
      if (specifier.startsWith(".")) return load(path.relative(root, path.resolve(path.dirname(filename), specifier)));
      throw new Error(`unexpected dependency: ${specifier}`);
    };
    const timer = (callback: () => void, ms: number) => { const handle = setTimeout(callback, ms); handle.unref(); return handle; };
    runInThisContext(`(function(require,module,exports,setTimeout,window,document){${compiled}\n})`, { filename })(
      require, module, module.exports, timer, environment.window, environment.document,
    );
    return module.exports;
  };
  return load;
}

function gateway(answers: any[] = [], landed: unknown = null) {
  const payloads: any[] = [];
  const installed: any[] = [];
  const stored = new Map<string, string>();
  const storage = {
    async put(value: any) { stored.set(value.clientMessageId, JSON.stringify(value)); },
    async remove(id: string) { stored.delete(id); },
    async list(userId: string) { return [...stored.values()].map((s) => JSON.parse(s)).filter((e) => e.userId === userId); },
  };
  const state: any = {
    currentUser: { id: ME }, messages: { [CHAT]: [{ id: entry().tempId, content, mention_entities: mentions() }] }, chats: [],
    replaceMessage: (_chat: string, _temp: string, row: any) => installed.push(row),
    updateChatLastMessage: () => {},
  };
  const client = {
    from(table: string) {
      const query: any = {
        insert(payload: any) { payloads.push(JSON.parse(JSON.stringify(payload))); return query; },
        select() { return query; }, eq() { return query; }, lt() { return query; }, update() { return query; },
        single() { return Promise.resolve(answers.shift() ?? { data: { id: "server", content, mention_entities: mentions(), created_at: "2026-10-01T12:00:00Z" }, error: null, status: 201 }); },
        maybeSingle() { return Promise.resolve({ data: landed }); },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({}).then(resolve); },
      };
      assert.ok(table === "messages" || table === "chats");
      return query;
    },
  };
  const load = modules({
    "lib/supabase/client.ts": { createClient: () => client },
    "store/app.store.ts": { useAppStore: { getState: () => state } },
    "lib/monitoring.ts": { reportError: () => {} },
    "lib/personalModeration.ts": { blockedSendRefusal: () => null },
    "lib/messageAckError.ts": { getMessageAckUserMessage: () => "retry", sanitizeMessageAckError: (error: unknown) => ({ error }) },
    "lib/outbox/outboxStorage.ts": { browserOutboxStorage: () => storage },
  });
  const runner = load("lib/outbox/appOutbox.ts").appOutbox;
  return { runner, storage, payloads, installed, load };
}

test("serialized text retry preserves UUIDs and revision, installs canonical ACK, and leaves legacy payload plain", async () => {
  const canonical = { version: 1, revision: REVISION, items: [] };
  const h = gateway([
    { data: null, error: { message: "Failed to fetch" }, status: 0 },
    { data: { id: "canonical", content, mention_entities: canonical, created_at: "2026-10-01T12:00:00Z" }, error: null, status: 201 },
  ]);
  await h.runner.start(ME);
  try {
    const original = entry();
    assert.equal((await h.runner.enqueue(original)).kind, "waiting");
    original.mentionEntities.items[0].user_id = ME;
    assert.equal(JSON.stringify((await h.storage.list(ME))[0].mentionEntities), serialized);
    h.runner.retryNow();
    await flush();
    assert.equal(h.payloads.length, 2);
    for (const payload of h.payloads) {
      assert.equal(JSON.stringify(payload.mention_entities), serialized);
      assert.equal(payload.client_message_id, "55555555-5555-4555-8555-000000000001");
      assert.equal(Object.hasOwn(payload, "mentionEntities"), false);
    }
    assert.deepEqual(h.installed.at(-1).mention_entities, canonical);
    assert.deepEqual(await h.storage.list(ME), []);
    await h.runner.enqueue(entry({ clientMessageId: "legacy", mentionEntities: undefined }));
    assert.equal(Object.hasOwn(h.payloads.at(-1), "mention_entities"), false);
  } finally { h.runner.stop(); }
});

test("missing mention column retains the serialized failed snapshot without sending a stripped payload", async () => {
  const missing = { code: "PGRST204", message: "Could not find the 'mention_entities' column in the schema cache" };
  const h = gateway([{ data: null, error: missing, status: 400 }]);
  await h.runner.start(ME);
  try {
    assert.equal((await h.runner.enqueue(entry())).kind, "refused");
    assert.equal(h.payloads.length, 1);
    assert.equal(JSON.stringify(h.payloads[0].mention_entities), serialized);
    assert.equal(JSON.stringify((await h.storage.list(ME))[0]?.mentionEntities), serialized);
    assert.equal(h.installed.at(-1).failed, true);
    h.runner.stop();
    await h.runner.start(ME);
    await flush();
    assert.equal(h.payloads.length, 2);
    assert.equal(JSON.stringify(h.payloads[1].mention_entities), serialized);
  } finally { h.runner.stop(); }
});

test("media_metadata compatibility retry keeps mention_entities and its original revision", async () => {
  const h = gateway([{ data: null, error: { code: "PGRST204", message: "media_metadata column absent in schema cache" }, status: 400 }]);
  await h.runner.start(ME);
  try {
    assert.equal((await h.runner.enqueue(entry({ mediaMetadata: { album_id: "album" } }))).kind, "sent");
    assert.equal(h.payloads.length, 2);
    assert.ok(Object.hasOwn(h.payloads[0], "media_metadata"));
    assert.equal(Object.hasOwn(h.payloads[1], "media_metadata"), false);
    assert.equal(JSON.stringify(h.payloads[1].mention_entities), serialized);
  } finally { h.runner.stop(); }
});

test("a legacy landed row cannot acknowledge a send refused for a missing mention column", async () => {
  const missing = { code: "42703", message: 'column "mention_entities" does not exist' };
  const h = gateway([{ data: null, error: missing, status: 400 }], { id: "legacy-landed", content, created_at: "2026-10-01T12:00:00Z" });
  await h.runner.start(ME);
  try {
    assert.equal((await h.runner.enqueue(entry())).kind, "refused");
    assert.equal(h.installed.at(-1).failed, true);
    assert.equal(JSON.stringify((await h.storage.list(ME))[0]?.mentionEntities), serialized);
  } finally { h.runner.stop(); }
});

test("missing mention schema after media fallback retains identities, and an explicitly empty envelope is sent", async () => {
  const h = gateway([
    { data: null, error: { code: "PGRST204", message: "media_metadata column missing" }, status: 400 },
    { data: null, error: { code: "PGRST204", message: "mention_entities column missing" }, status: 400 },
  ]);
  await h.runner.start(ME);
  try {
    assert.equal((await h.runner.enqueue(entry({ mediaMetadata: {} }))).kind, "refused");
    assert.equal(h.payloads.length, 2);
    assert.equal(JSON.stringify(h.payloads[1].mention_entities), serialized);
    assert.equal(JSON.stringify((await h.storage.list(ME))[0].mentionEntities), serialized);
    await h.runner.enqueue(entry({ clientMessageId: "empty", mentionEntities: { version: 1, revision: null, items: [] } }));
    assert.deepEqual(h.payloads.at(-1).mention_entities, { version: 1, revision: null, items: [] });
  } finally { h.runner.stop(); }
});

test("memory text storage snapshots nested entities rather than retaining composer aliases", async () => {
  const storage = modules()("lib/outbox/outboxStorage.ts").memoryOutboxStorage();
  const original = entry();
  await storage.put(original);
  original.mentionEntities.items[0].user_id = ME;
  const listed = await storage.list(ME);
  assert.equal(JSON.stringify(listed[0].mentionEntities), serialized);
  listed[0].mentionEntities.items.length = 0;
  assert.equal(JSON.stringify((await storage.list(ME))[0].mentionEntities), serialized);
  assert.deepEqual(await storage.list(OTHER), []);
});

test("optimistic rows carry the mention snapshot and legacy rows have harmless empty metadata", () => {
  const build = modules()("lib/optimisticMessage.ts").buildOptimisticMessage;
  const input = { ...entry(), user: { id: ME } };
  const row = build(input);
  assert.equal(JSON.stringify(row.mention_entities), serialized);
  input.mentionEntities.items.length = 0;
  assert.equal(JSON.stringify(row.mention_entities), serialized);
  assert.deepEqual(build({ ...input, mentionEntities: undefined }).mention_entities, { version: 1, revision: null, items: [] });
});

test("attachment placeholders preserve authored caption identities without annotating fallback labels", () => {
  const build = modules()("lib/attachmentPlaceholder.ts").buildAttachmentPlaceholder;
  const item = media();
  const padded = mentions();
  padded.items[0].offset = 8; padded.items[1].offset = 17;
  const input = {
    chatId: CHAT, topicId: null, user: { id: ME }, attachment: { ...item.attachment, mentionEntities: padded },
    caption: `  ${content}  `, replyToId: null, clientSentAt: item.clientSentAt, tempId: item.tempId,
  };
  const row = build(input);
  assert.equal(row.content, "\u{1f680} hi @Ada and @cube");
  assert.equal(JSON.stringify(row.mention_entities), serialized);
  padded.items.length = 0;
  assert.equal(JSON.stringify(row.mention_entities), serialized);
  const empty = { version: 1, revision: null, items: [] };
  const sibling = build({ ...input, caption: null, attachment: { ...item.attachment, mentionEntities: mentions() } });
  assert.equal(sibling.content, "@Ada.txt");
  assert.deepEqual(sibling.mention_entities, empty);
  const legacy = build({ ...input, caption: content, attachment: { ...item.attachment, mentionEntities: undefined } });
  assert.equal(legacy.content, content);
  assert.deepEqual(legacy.mention_entities, empty);
  for (const kind of ["voice", "video_message"]) {
    const generated = build({ ...input, caption: content, attachment: { ...item.attachment, kind, mentionEntities: mentions() } });
    assert.notEqual(generated.content, content);
    assert.deepEqual(generated.mention_entities, empty);
  }
});

test("outbox restoration preserves serialized text and top-level media caption identities", async () => {
  const waiting = JSON.parse(JSON.stringify([
    entry(), entry({ clientMessageId: "legacy", tempId: "tmp:legacy", content: "legacy", mentionEntities: undefined }),
  ]));
  const item = media();
  item.attachment.mentionEntities = undefined;
  const mediaWaiting = [{ ...item, mentionEntities: JSON.parse(serialized) }];
  const rows: any[] = [];
  const cleanups: Array<() => void> = [];
  const state = { currentUser: { id: ME }, addMessage: (_chat: string, row: any) => rows.push(row) };
  const useAppStore = Object.assign((selector: (state: unknown) => unknown) => selector(state), { getState: () => state });
  const load = modules({
    react: { useEffect: (effect: () => () => void) => cleanups.push(effect()) },
    "store/app.store.ts": { useAppStore },
    "lib/outbox/appOutgoingMedia.ts": { keepOutgoingMediaFor() {}, restoreOutgoingMedia: async () => mediaWaiting },
    "lib/outbox/appOutbox.ts": { appOutbox: { start: async () => waiting, retryNow() {}, stop() {} } },
    "lib/outbox/appBackgroundUploads.ts": { appBackgroundUploads: { run: async () => {} } },
  }, {
    window: { setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
  });
  load("hooks/useOutbox.ts").useOutbox();
  try {
    await flush();
    assert.equal(rows.length, 3);
    const text = rows.find((row) => row.id === "tmp:55555555-5555-4555-8555-000000000001");
    assert.equal(JSON.stringify(text.mention_entities), serialized);
    assert.equal(text.content, "\u{1f680} hi @Ada and @cube");
    assert.equal(JSON.stringify(rows.find((row) => row.id === "tmp:media").mention_entities), serialized);
    assert.deepEqual(rows.find((row) => row.id === "tmp:legacy").mention_entities, { version: 1, revision: null, items: [] });
    waiting[0].mentionEntities.items.length = 0;
    mediaWaiting[0].mentionEntities.items.length = 0;
    assert.equal(JSON.stringify(text.mention_entities), serialized);
    assert.equal(JSON.stringify(rows.find((row) => row.id === "tmp:media").mention_entities), serialized);
  } finally { for (const cleanup of cleanups) cleanup(); }
});

test("caption allocation trims UTF-16 ranges once, uses only the carrier, and never annotates filename or voice fallback", () => {
  const load = modules();
  const { attachmentCaptionFields } = load("lib/attachmentSendQueue.ts");
  const { stagedAttachmentMentionEntities } = load("lib/stagedAttachments.ts");
  const padded = mentions();
  padded.items[0].offset = 8; padded.items[1].offset = 17;
  const first = attachmentCaptionFields("first", "first", `  ${content}  `, padded);
  assert.equal(first.caption, content);
  assert.equal(JSON.stringify(first.mentionEntities), serialized);
  assert.deepEqual(attachmentCaptionFields("second", "first", `  ${content}  `, padded), { caption: null });
  assert.equal(stagedAttachmentMentionEntities("file", "  ", mentions()), undefined);
  assert.equal(stagedAttachmentMentionEntities("voice", content, mentions()), undefined);
  assert.equal(stagedAttachmentMentionEntities("video_message", content, mentions()), undefined);
});

test("outgoing media serialization keeps top-level and staged caption entities independent of later edits", async () => {
  const load = modules();
  const { toPersisted, memoryOutgoingMediaStorage } = load("lib/outbox/outgoingMediaStorage.ts");
  const original = media();
  const written = toPersisted(ME, original);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(written)).entry.mentionEntities), serialized);
  assert.equal(JSON.stringify(written.entry.attachment.mentionEntities), serialized);
  assert.equal(written.entry.attachment.previewUrl, null);
  original.mentionEntities.items.length = 0;
  original.attachment.mentionEntities.items.length = 0;
  assert.equal(JSON.stringify(written.entry.mentionEntities), serialized);
  assert.equal(JSON.stringify(written.entry.attachment.mentionEntities), serialized);
  const storage = memoryOutgoingMediaStorage();
  await storage.save(ME, media());
  const listed = await storage.list(ME);
  listed[0].mentionEntities.items.length = 0;
  assert.equal(JSON.stringify((await storage.list(ME))[0].mentionEntities), serialized);
  assert.deepEqual(await storage.list(OTHER), []);
});

test("background upload hands the caption snapshot to optimistic and durable text queues exactly once", async () => {
  const queued: any[] = [];
  const installed: any[] = [];
  const item = media({ mentionEntities: undefined });
  let shown: any = { id: item.tempId, upload_waiting: true, media_path: null };
  const state = { currentUser: { id: ME }, messages: { [CHAT]: [] },
    replaceMessage: (_c: string, _t: string, row: any) => { installed.push(row); shown = row; },
    updateChatLastMessage: () => {}, updateMessage: (_c: string, row: any) => { shown = row; },
  };
  const load = modules({
    "store/app.store.ts": { useAppStore: { getState: () => ({ ...state, messages: { [CHAT]: [shown] } }) } },
    "lib/supabase/client.ts": { createClient: () => ({}) },
    "lib/attachmentUpload.ts": { uploadAttachmentBytes: async () => ({ bucket: "media", path: "path", publicUrl: "url" }) },
    "lib/mediaCompression.ts": { buildAttachmentMediaMetadata: () => undefined },
    "lib/outbox/appOutbox.ts": { appOutbox: { enqueue: async (e: any) => { queued.push(JSON.parse(JSON.stringify(e))); } } },
    "lib/outgoingMedia.ts": { allOutgoingEntries: () => [item], isChatViewed: () => false, isOutgoingUploading: () => false, isOutgoingCancelled: () => false, forgetOutgoing: () => {} },
  });
  await load("lib/outbox/appBackgroundUploads.ts").appBackgroundUploads.run();
  assert.equal(queued.length, 1);
  assert.equal(JSON.stringify(queued[0].mentionEntities), serialized);
  assert.equal(JSON.stringify(installed[0].mention_entities), serialized);
});

test("a late outbox start cannot restore or send the previous account's entries", async () => {
  const pending = deferred<any[]>();
  const sent: any[] = [];
  const storage = { list: (id: string) => id === ME ? pending.promise : Promise.resolve([]), put: async () => {}, remove: async () => {} };
  const runner = modules()("lib/outbox/outboxRunner.ts").createOutboxRunner({ storage,
    send: async (e: any) => { sent.push(e); return { sent: {} }; }, onSent() {}, onWaiting() {}, onRefused() {}, timers });
  const old = runner.start(ME);
  await runner.start(OTHER);
  pending.resolve([entry()]);
  assert.deepEqual(await old, []);
  await flush();
  assert.equal(runner.size(), 0);
  assert.equal(sent.length, 0);
  runner.stop();
});

test("a captured old-account enqueue stays on disk and only its owner can resume it", async () => {
  const load = modules();
  const storage = load("lib/outbox/outboxStorage.ts").memoryOutboxStorage();
  const sent: any[] = [];
  const runner = load("lib/outbox/outboxRunner.ts").createOutboxRunner({ storage,
    send: async (e: any) => { sent.push(JSON.parse(JSON.stringify(e))); return { sent: {} }; },
    onSent() {}, onWaiting() {}, onRefused() {}, timers });
  await runner.start(OTHER);
  assert.equal((await runner.enqueue(entry())).kind, "waiting");
  assert.equal(sent.length, 0);
  assert.equal(JSON.stringify((await storage.list(ME))[0].mentionEntities), serialized);
  await runner.start(ME);
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, "11111111-1111-4111-8111-000000000001");
  assert.equal(JSON.stringify(sent[0].mentionEntities), serialized);
  runner.stop();
});

test("a pending durable caption send holds its chat without a zero-delay wake loop", async () => {
  const pending = deferred<void>();
  const order: string[] = [];
  const wakes: number[] = [];
  const storage = { list: async () => [], put: (e: any) => e.clientMessageId === "first" ? pending.promise : Promise.resolve(), remove: async () => {} };
  const runner = modules()("lib/outbox/outboxRunner.ts").createOutboxRunner({ storage,
    send: async (e: any) => { order.push(e.clientMessageId); return { sent: {} }; }, onSent() {}, onWaiting() {}, onRefused() {}, now: () => 0,
    timers: { set: (_run: unknown, ms: number) => { wakes.push(ms); return null; }, clear() {} } });
  await runner.start(ME);
  const first = runner.enqueue(entry({ clientMessageId: "first" }));
  const second = runner.enqueue(entry({ clientMessageId: "second", clientSentAt: "2026-10-01T12:00:00.001Z" }));
  try {
    await flush();
    assert.deepEqual(order, []);
    assert.deepEqual(wakes, []);
  } finally {
    pending.resolve();
    await Promise.all([first, second]);
    runner.stop();
  }
  assert.deepEqual(order, ["first", "second"]);
});

test("an old-session ACK cannot remove or project a restored same-account mention send", async () => {
  const load = modules();
  const storage = load("lib/outbox/outboxStorage.ts").memoryOutboxStorage();
  const first = deferred<any>();
  const second = deferred<any>();
  let calls = 0;
  const projections: any[] = [];
  const runner = load("lib/outbox/outboxRunner.ts").createOutboxRunner({ storage,
    send: () => ++calls === 1 ? first.promise : second.promise,
    onSent: (_e: any, row: any) => projections.push(row), onWaiting() {}, onRefused() {}, timers });
  await runner.start(ME);
  const old = runner.enqueue(entry());
  await flush();
  assert.equal(calls, 1);
  runner.stop();
  await runner.start(ME);
  await flush();
  first.resolve({ sent: { id: "obsolete" } });
  await old;
  await flush();
  assert.deepEqual(projections, []);
  assert.equal(JSON.stringify((await storage.list(ME))[0].mentionEntities), serialized);
  second.resolve({ sent: { id: "current" } });
  await flush();
  assert.deepEqual(projections, [{ id: "current" }]);
  runner.stop();
});

test("a late media restore cannot repopulate a new account or a relogged session", async () => {
  const pending = deferred<any[]>();
  const load = modules({ "lib/outbox/outgoingMediaStorage.ts": { browserOutgoingMediaStorage: () => ({ list: () => pending.promise, save() {}, drop() {} }) } });
  const app = load("lib/outbox/appOutgoingMedia.ts");
  app.keepOutgoingMediaFor(ME);
  const old = app.restoreOutgoingMedia(ME);
  app.keepOutgoingMediaFor(null);
  app.keepOutgoingMediaFor(ME);
  pending.resolve([media()]);
  assert.deepEqual(await old, []);
  assert.deepEqual(load("lib/outgoingMedia.ts").allOutgoingEntries(), []);
});

test("transport omission mutants are killed by real serialized fixture assertions", { skip: Boolean(process.env.D331_TRANSPORT_MUTANT) }, () => {
  const cases = [
    ["payload", "serialized text retry"], ["optimistic", "optimistic rows carry"],
    ["background", "background upload hands"], ["persisted", "outgoing media serialization"],
    ["carrier", "caption allocation trims"],
    ["placeholder", "attachment placeholders preserve"], ["restored", "outbox restoration preserves"],
  ];
  for (const [mutant, name] of cases) {
    const env = { ...process.env, D331_TRANSPORT_MUTANT: mutant };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", `--test-name-pattern=${name}`, fileURLToPath(import.meta.url)], {
      env, encoding: "utf8", timeout: 15000,
    });
    assert.equal(result.status, 1, `${mutant} survived: ${result.stdout}${result.stderr}`);
    assert.match(result.stdout + result.stderr, /AssertionError|ERR_ASSERTION/, `${mutant}: not a behavioral failure`);
    assert.match(result.stdout + result.stderr, /tests 1\b/, `${mutant}: wrong selected test count`);
    assert.doesNotMatch(result.stdout + result.stderr, /mutation anchor missing|unexpected dependency|Cannot find module/);
    console.log(`KILLED transport omission: ${mutant}`);
  }
});
