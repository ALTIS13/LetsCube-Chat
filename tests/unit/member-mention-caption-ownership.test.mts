import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { spawnSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const chatFile = "components/chat/ChatWindow.tsx";
const ME = "11111111-1111-4111-8111-000000000001";
const OTHER = "11111111-1111-4111-8111-000000000002";
const CHAT = "22222222-2222-4222-8222-000000000001";
const FIRST = "55555555-5555-4555-8555-000000000001";
const SECOND = "55555555-5555-4555-8555-000000000002";
const content = "\u{1f680} hi @Ada";
const serialized = '{"version":1,"revision":"33333333-3333-4333-8333-000000000001","items":[{"kind":"user","user_id":"11111111-1111-4111-8111-000000000002","offset":6,"length":4,"label":"@Ada"}]}';
const mentions = () => JSON.parse(serialized);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const noop = () => {};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 30 && !check(); i += 1) await flush();
  assert.equal(check(), true, "runtime boundary was not reached");
}

function attachment(id = FIRST, kind = "file") {
  const file = new File(["synthetic"], `${id}.txt`, { type: "text/plain" });
  return { id, clientMessageId: id, kind, file, name: file.name, size: file.size, mimeType: file.type,
    previewUrl: null, uploaded: null, status: "ready", progress: null, error: null, durationMs: 1000 };
}

function chatSource() {
  let source = readFileSync(path.join(root, chatFile), "utf8");
  const replacements: Record<string, [string, string]> = {
    transfer: ["if (captionSentWithAttachment) claimCaption(attachment);", ""],
    prefix: ["let prefixOwner = captionPrefixOwnersRef.current.get(firstTarget.id);", "let prefixOwner = undefined;"],
    epoch: ["accountEpoch === sendEpoch &&", ""],
    late: ["if (!sameAccount() || sendResult.status === \"stale\") return false;", "if (sendResult.status === \"stale\") return false;"],
    discard: ["captionPrefixOwnersRef.current.delete(attachmentId);", ""],
    cleared: ["captionPrefixOwnersRef.current.delete(firstTarget.id);", ""],
    linkage: ["...(prefixOwner && attachment.id === firstTarget.id ? {", "...(false ? {"],
    restore: ["const restoredPrefix = originalEntry?.captionPrefix;", "const restoredPrefix = undefined;"],
    retain: ["await prefixStorage.put(structuredClone(prefixEntry(owner)));", ""],
    queued: ["!owner.attempt && appOutbox.has(owner.row.client_message_id!)", "false"],
    clearRef: ["accountEpoch += 1;\n        captionPrefixOwnersRef.current.clear();", "accountEpoch += 1;"],
    persistEpoch: ["if (!sameAccount() || captionPrefixOwnersRef.current.get(firstTarget.id) !== owner) return false;", ""],
    editUnlink: ["discardSend(msg);", "discardLocalMessage(msg.id);"],
    discardedRetention: ["await prefixStorage.remove(owner.row.client_message_id!);", ""],
  };
  const mutation = process.env.D331_CAPTION_MUTANT;
  if (mutation) {
    assert.ok(Object.hasOwn(replacements, mutation), `unknown mutation: ${mutation}`);
    const [from, to] = replacements[mutation];
    assert.ok(source.includes(from), `mutation anchor missing: ${mutation}`);
    source = source.replaceAll(from, to);
  }
  return source;
}

// Compile the actual callbacks without mounting unrelated chat/render hooks.
function callback(relative: string, name: string, environment: Record<string, any>) {
  const source = relative === chatFile ? chatSource() : readFileSync(path.join(root, relative), "utf8");
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(expression, `callback missing: ${name}`);
  const sourceExpression = expression.getText(tree);
  const compiled = ts.transpileModule(`(function(${Object.keys(environment).join(",")}){return (${sourceExpression});})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return runInThisContext(compiled, { filename: relative })(...Object.values(environment));
}

function modules(stubs: Record<string, any>) {
  const cache = new Map<string, any>();
  const load = (relative: string): any => {
    let filename = path.resolve(root, relative);
    if (!existsSync(filename)) filename += existsSync(`${filename}.ts`) ? ".ts" : ".tsx";
    const key = path.relative(root, filename).replaceAll("\\", "/");
    if (Object.hasOwn(stubs, key)) return stubs[key];
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    }).outputText;
    const require = (specifier: string) => {
      if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
      if (specifier.startsWith("@/")) return load(specifier.slice(2));
      if (specifier.startsWith(".")) return load(path.relative(root, path.resolve(path.dirname(filename), specifier)));
      throw Error(`unexpected dependency: ${specifier}`);
    };
    const timer = (run: () => void, ms: number) => { const handle = setTimeout(run, ms); handle.unref(); return handle; };
    runInThisContext(`(function(require,module,exports,setTimeout){${compiled}\n})`, { filename })(require, module, module.exports, timer);
    return module.exports;
  };
  return load;
}

type HarnessOptions = {
  attachments?: any[];
  upload?: (item: any) => Promise<any>;
  answer?: (payload: any, index: number) => Promise<any>;
  textPut?: (entry: any, count: number) => Promise<void>;
};

async function harness(options: HarnessOptions = {}) {
  const payloads: any[] = [];
  const stored = new Map<string, string>();
  const mediaStored = new Map<string, string>();
  const mediaRecords = new Map<string, any>();
  const stageEffects: string[] = [];
  const listeners = new Set<(next: any, previous: any) => void>();
  const currentUserRef = { current: { id: ME } as any };
  const stagedAttachmentsRef = { current: options.attachments ?? [attachment(FIRST), attachment(SECOND)] };
  const captionPrefixOwnersRef = { current: new Map() };
  const state: any = { currentUser: currentUserRef.current, chats: [], messages: {},
    addMessage: (chatId: string, row: any) => upsert(chatId, row),
    replaceMessage: (chatId: string, oldId: string, row: any) => {
      state.messages[chatId] = (state.messages[chatId] ?? []).filter((m: any) => m.id !== oldId);
      upsert(chatId, row);
    },
    updateMessage: (chatId: string, row: any) => upsert(chatId, row), updateChatLastMessage: noop,
    removeMessage: (chatId: string, id: string) => { state.messages[chatId] = (state.messages[chatId] ?? []).filter((m: any) => m.id !== id); },
  };
  function upsert(chatId: string, row: any) {
    const list = state.messages[chatId] ?? [];
    state.messages[chatId] = [...list.filter((m: any) => m.id !== row.id &&
      !(m.user_id === row.user_id && m.client_message_id && m.client_message_id === row.client_message_id)), row];
  }
  const useAppStore = { getState: () => state, subscribe: (listen: (next: any, previous: any) => void) => {
    listeners.add(listen); return () => listeners.delete(listen);
  } };
  let textPuts = 0;
  const storage = { put: async (entry: any) => {
    await options.textPut?.(entry, ++textPuts);
    stored.set(entry.clientMessageId, JSON.stringify(entry));
  },
    remove: async (id: string) => { stored.delete(id); },
    list: async (userId: string) => [...stored.values()].map((s) => JSON.parse(s)).filter((entry) => entry.userId === userId) };
  const client = { from: (table: string) => {
    let payload: any;
    const query: any = { insert: (value: any) => { payload = JSON.parse(JSON.stringify(value)); payloads.push(payload); return query; },
      select: () => query, eq: () => query, lt: () => query, update: () => query,
      single: async () => options.answer ? options.answer(payload, payloads.length) : canonical(payload),
      maybeSingle: async () => ({ data: null }), then: (resolve: any) => Promise.resolve({}).then(resolve) };
    assert.ok(table === "messages" || table === "chats");
    return query;
  } };
  const stubs: Record<string, any> = {
    react: { createElement: noop }, "store/app.store.ts": { useAppStore },
    "lib/supabase/client.ts": { createClient: () => client },
    "lib/monitoring.ts": { reportError: noop }, "lib/personalModeration.ts": { blockedSendRefusal: () => null },
    "lib/messageAckError.ts": { getMessageAckUserMessage: () => "retry", sanitizeMessageAckError: (error: any) => ({ error }) },
    "lib/outbox/outboxStorage.ts": { browserOutboxStorage: () => storage },
    "lib/attachmentUpload.ts": { uploadAttachmentBytes: async () => uploaded },
  };
  const load = modules(stubs);
  const appOutbox = load("lib/outbox/appOutbox.ts").appOutbox;
  await appOutbox.start(ME);
  const out = load("lib/outgoingMedia.ts");
  const mediaStorage = load("lib/outbox/outgoingMediaStorage.ts");
  stubs["lib/outbox/outgoingMediaStorage.ts"] = { ...mediaStorage, browserOutgoingMediaStorage: () => ({
    save: async (userId: string, entry: any) => {
    const record = mediaStorage.toPersisted(userId, entry);
    mediaRecords.set(entry.tempId, structuredClone(record));
    mediaStored.set(entry.tempId, JSON.stringify(record));
  }, drop: async (id: string) => { mediaStored.delete(id); mediaRecords.delete(id); },
    list: async (userId: string) => [...mediaRecords.values()].filter((record) => record.userId === userId)
      .map((record) => structuredClone(record.entry)),
  }) };
  const mediaDevice = load("lib/outbox/appOutgoingMedia.ts");
  mediaDevice.keepOutgoingMediaFor(ME);
  const mention = load("lib/memberMentions.ts");
  const optimistic = load("lib/optimisticMessage.ts");
  const sendLocalMessage = callback("hooks/useMessages.ts", "sendLocalMessage", {
    currentUserRef, chatIdRef: { current: CHAT }, topicIdRef: { current: null }, ...mention, ...optimistic,
    addMessage: state.addMessage, replaceMessage: state.replaceMessage, updateChatLastMessage: noop,
    appOutbox, useAppStore, setActionRefusal: noop, blockedSendRefusal: () => null,
    console: { error: noop },
  });
  const adapter = Object.fromEntries(["sendMessage", "sendMediaMessage", "retryMessageSend"].map((name) => [name,
    callback("hooks/useMessages.ts", name, { sendLocalMessage, ...mention })]));
  const workflow = load("lib/stagedUploadWorkflow.tsx");
  const scope = workflow.createStagedUploadScope(CHAT);
  const updateStagedAttachment = (id: string, patch: any) => {
    stageEffects.push(id);
    stagedAttachmentsRef.current = stagedAttachmentsRef.current.map((item: any) => item.id === id ? patch(item) : item);
  };
  const env = {
    userId: ME, messageTopicId: null, useAppStore, uploadScope: scope, stagedAttachmentsRef, captionPrefixOwnersRef,
    browserOutboxStorage: () => storage, appOutbox,
    ...mention, ...optimistic, ...adapter, ...workflow, ...out, ...load("lib/attachmentSendQueue.ts"), ...load("lib/committedSend.ts"),
    ...load("lib/mediaAlbumSend.ts"), buildAttachmentPlaceholder: load("lib/attachmentPlaceholder.ts").buildAttachmentPlaceholder,
    getStagedAttachmentMessageContent: load("lib/attachmentPlaceholder.ts").attachmentMessageContent,
    getStagedAttachmentMessageType: load("lib/attachmentPlaceholder.ts").attachmentMessageType,
    getStagedAttachmentMediaMetadata: () => undefined, updateStagedAttachment,
    removeStagedAttachment: (id: string) => { stageEffects.push(id); stagedAttachmentsRef.current = stagedAttachmentsRef.current.filter((a: any) => a.id !== id); },
    setStagedAttachments: (patch: any) => { stagedAttachmentsRef.current = patch(stagedAttachmentsRef.current); },
    uploadStagedAttachment: options.upload ?? (async () => uploaded), cancelledAttachmentIdsRef: { current: new Set() },
    replyTo: null, setReplyTo: () => stageEffects.push("reply"), showAppAlert: noop, releaseOutgoingPreview: noop,
    describeUploadFailure: load("lib/uploadFailure.ts").describeUploadFailure,
    uploadFailureMessage: load("lib/uploadFailure.ts").uploadFailureMessage,
    uploadMayWait: load("lib/uploadFailure.ts").uploadMayWait,
    uploadFailureFeedback: load("lib/uploadFailure.ts").uploadFailureFeedback,
    reportError: noop, showActionFeedback: noop, console: { warn: noop },
  };
  const patchOutgoingPlaceholder = callback(chatFile, "patchOutgoingPlaceholder", { useAppStore });
  const send = callback(chatFile, "sendStagedAttachments", { ...env, patchOutgoingPlaceholder });
  const discardLocalMessage = callback("hooks/useMessages.ts", "discardLocalMessage", {
    chatIdRef: { current: CHAT }, useAppStore, appOutbox, removeMessage: state.removeMessage,
  });
  const discard = callback(chatFile, "discardSend", { ...env, discardLocalMessage, revokeAttachmentPreview: noop });
  const abortUploadsIfAccountChanged = callback(chatFile, "abortUploadsIfAccountChanged", {
    ...env, uploadRegistry: { abortAll: async () => {} }, revokeAttachmentPreview: noop,
  });
  const editFailed = (message: any) => callback(chatFile, "handleEditFailedSend", {
    ...env, discardLocalMessage, discardSend: discard, setDraftRestore: noop,
  })(message);
  const remount = () => {
    const ref = { current: new Map() };
    return { send: callback(chatFile, "sendStagedAttachments", { ...env, captionPrefixOwnersRef: ref, patchOutgoingPlaceholder }),
      discard: callback(chatFile, "discardSend", { ...env, captionPrefixOwnersRef: ref, discardLocalMessage, revokeAttachmentPreview: noop }),
      captionPrefixOwnersRef: ref };
  };
  const restoreMedia = async () => {
    out.cancelAllOutgoing();
    return mediaDevice.restoreOutgoingMedia(ME);
  };
  const background = load("lib/outbox/appBackgroundUploads.ts").appBackgroundUploads;
  const switchAccount = (id: string | null) => {
    const previous = { ...state };
    state.currentUser = id ? { id } : null;
    currentUserRef.current = state.currentUser;
    for (const listener of listeners) listener(state, previous);
  };
  return { send, discard, state, load, out, appOutbox, background, stagedAttachmentsRef, stageEffects, payloads, stored, mediaStored,
    listeners, switchAccount, scope, captionPrefixOwnersRef, adapter, remount, restoreMedia, editFailed, abortUploadsIfAccountChanged,
    cleanup: () => { appOutbox.stop(); out.cancelAllOutgoing(); out.persistOutgoingWith(null); } };
}

const uploaded = { bucket: "media", path: "synthetic", publicUrl: "synthetic" };
function canonical(payload: any) {
  return { data: { ...payload, id: `server:${payload.client_message_id}`, created_at: payload.client_sent_at,
    mention_entities: payload.mention_entities ?? { version: 1, revision: null, items: [] } }, error: null, status: 201 };
}
function refused() { return { data: null, error: { code: "42501", message: "synthetic RLS refusal" }, status: 403 }; }

test("ownership moves before successor ACK so background retry cannot duplicate caption identities", async () => {
  const ack = deferred<any>();
  const h = await harness({ upload: async (item) => {
    if (item.id === FIRST) throw new TypeError("Failed to fetch");
    return uploaded;
  }, answer: async (payload) => payload.client_message_id === SECOND ? ack.promise : canonical(payload) });
  const sending = h.send(content, undefined, undefined, undefined, mentions());
  try {
    await until(() => h.payloads.length === 1);
    assert.equal(h.payloads[0].client_message_id, "55555555-5555-4555-8555-000000000002");
    assert.equal(JSON.stringify(h.payloads[0].mention_entities), serialized);
    const original = h.out.outgoingEntry(`tmp:${FIRST}`);
    assert.equal(original.caption, null);
    assert.equal(original.mentionEntities, undefined);
    assert.equal(original.attachment.mentionEntities, undefined);
    assert.equal(JSON.parse(h.mediaStored.get(`tmp:${FIRST}`)!).entry.caption, null);
    assert.deepEqual(h.state.messages[CHAT].find((m: any) => m.id === `tmp:${FIRST}`).mention_entities, { version: 1, revision: null, items: [] });
    const background = h.background.run();
    ack.resolve(canonical(h.payloads[0]));
    assert.equal(await sending, true);
    await background;
    assert.equal(h.payloads.length, 2);
    assert.equal(Object.hasOwn(h.payloads[1], "mention_entities"), false);
    assert.equal(h.payloads.filter((p) => p.mention_entities?.items.length).length, 1);
    assert.equal(h.listeners.size, 0);
  } finally { ack.resolve(canonical(h.payloads[0])); await sending; h.cleanup(); }
});

test("voice prefix refusal retries the same failed row and client ID without replaying a committed prefix", async () => {
  const h = await harness({ attachments: [attachment(FIRST, "voice")],
    answer: async (payload, index) => index === 1 ? refused() : canonical(payload) });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), false);
    assert.equal(h.payloads.length, 1);
    const failed = h.state.messages[CHAT].find((m: any) => m.type === "text");
    assert.equal(failed.failed, true);
    assert.equal(JSON.stringify(failed.mention_entities), serialized);
    const voice = h.out.outgoingEntry(`tmp:${FIRST}`).attachment;
    // Retrying the staged voice must use the existing text row even with an empty caption.
    assert.equal(await h.send(voice.caption ?? "", voice.id, [voice], undefined, voice.mentionEntities), true);
    const texts = h.payloads.filter((p) => p.type === "text");
    assert.equal(texts.length, 2);
    assert.equal(texts[1].client_message_id, texts[0].client_message_id);
    assert.equal(texts[1].client_message_id, failed.client_message_id);
    assert.equal(JSON.stringify(texts[1].mention_entities), serialized);
    assert.equal(h.state.messages[CHAT].filter((m: any) => m.type === "text").length, 1);
    assert.equal(h.payloads.filter((p) => p.type === "audio").length, 1);
    assert.equal(Object.hasOwn(h.payloads.at(-1), "mention_entities"), false);
    assert.equal(h.listeners.size, 0);
  } finally { h.cleanup(); }
});

test("a committed voice prefix is not replayed when its failed upload resumes in the background", async () => {
  const h = await harness({ attachments: [attachment(FIRST, "voice")],
    upload: async () => { throw new TypeError("Failed to fetch"); } });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), true);
    assert.equal(h.payloads.length, 1);
    assert.equal(h.payloads[0].type, "text");
    assert.equal(JSON.stringify(h.payloads[0].mention_entities), serialized);
    const voice = h.out.outgoingEntry(`tmp:${FIRST}`);
    assert.equal(voice.caption, null);
    assert.equal(voice.mentionEntities, undefined);
    assert.equal(voice.attachment.mentionEntities, undefined);
    await h.background.run();
    assert.equal(h.payloads.length, 2);
    assert.equal(h.payloads[1].type, "audio");
    assert.equal(Object.hasOwn(h.payloads[1], "mention_entities"), false);
    assert.equal(h.payloads.filter((p) => p.mention_entities?.items.length).length, 1);
  } finally { h.cleanup(); }
});

test("refused prefix remains the sole durable text owner through reopen and serialized media restore", async () => {
  const h = await harness({ attachments: [attachment(FIRST, "voice")],
    answer: async (payload, index) => index <= 2 ? refused() : canonical(payload) });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), false);
    const prefixId = h.payloads[0].client_message_id;
    assert.equal(h.stored.has(prefixId), true, "failed prefix must remain in durable text outbox");
    const kept = JSON.parse(h.stored.get(prefixId)!);
    assert.equal(kept.clientMessageId, prefixId);
    assert.equal(JSON.stringify(kept.mentionEntities), serialized);
    assert.equal(h.stagedAttachmentsRef.current.length, 0);
    const record = JSON.parse(h.mediaStored.get(`tmp:${FIRST}`)!);
    assert.ok(record.entry.captionPrefix, "serialized media must keep the original prefix linkage");
    assert.equal(record.entry.captionPrefix.entry.clientMessageId, prefixId);
    assert.equal(record.entry.caption, null);
    assert.equal(record.entry.mentionEntities, undefined);
    // Reopening uses a genuinely new local ref, not the previous component's map.
    const reopened = h.remount();
    const entry = h.out.outgoingEntry(`tmp:${FIRST}`);
    assert.equal(await reopened.send(entry.caption ?? "", undefined, [entry.attachment]), false);
    assert.equal(h.payloads[1].client_message_id, prefixId);
    // Page restore loses both component refs and outgoing memory, but not file bytes/association.
    await h.restoreMedia();
    h.state.messages = {};
    const restored = h.out.outgoingEntry(`tmp:${FIRST}`);
    assert.ok(restored.attachment.file instanceof File);
    const reloaded = h.remount();
    assert.equal(await reloaded.send(restored.caption ?? "", undefined, [restored.attachment]), true);
    assert.equal(h.payloads.filter((p) => p.type === "text").length, 3);
    assert.equal(new Set(h.payloads.filter((p) => p.type === "text").map((p) => p.client_message_id)).size, 1);
    assert.equal(JSON.stringify(h.payloads[2].mention_entities), serialized);
    assert.equal(h.payloads[3].type, "audio");
    assert.equal(Object.hasOwn(h.payloads[3], "mention_entities"), false);
    assert.equal(h.stored.has(prefixId), false);
  } finally { h.cleanup(); }
});

test("text outbox startup and media restore keep one prefix UUID even when startup retry is refused again", async () => {
  const h = await harness({ attachments: [attachment(FIRST, "voice")],
    answer: async (payload, index) => index <= 2 ? refused() : canonical(payload) });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), false);
    const prefixId = h.payloads[0].client_message_id;
    h.appOutbox.stop();
    await h.restoreMedia();
    await h.appOutbox.start(ME);
    await until(() => h.payloads.length === 2 && !h.appOutbox.has(prefixId));
    await flush();
    const restored = h.out.outgoingEntry(`tmp:${FIRST}`);
    assert.equal(await h.remount().send("", undefined, [restored.attachment]), true);
    assert.equal(h.payloads.filter((p) => p.type === "text").length, 3);
    assert.ok(h.payloads.filter((p) => p.type === "text").every((p) => p.client_message_id === prefixId));
    assert.equal(JSON.stringify(h.payloads[2].mention_entities), serialized);
    assert.equal(h.payloads.at(-1).type, "audio");
    assert.equal(Object.hasOwn(h.payloads.at(-1), "mention_entities"), false);
  } finally { h.cleanup(); }
});

test("accepted prefix association survives restore without replaying text after its upload failed", async () => {
  let uploads = 0;
  const h = await harness({ attachments: [attachment(FIRST, "video_message")],
    upload: async () => { if (++uploads === 1) throw new TypeError("Failed to fetch"); return uploaded; } });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), true);
    const prefixId = h.payloads[0].client_message_id;
    const record = JSON.parse(h.mediaStored.get(`tmp:${FIRST}`)!);
    assert.equal(record.entry.captionPrefix.accepted, true);
    assert.equal(record.entry.captionPrefix.entry.clientMessageId, prefixId);
    await h.restoreMedia();
    h.state.messages = {};
    const restored = h.out.outgoingEntry(`tmp:${FIRST}`);
    assert.equal(await h.remount().send("", undefined, [restored.attachment]), true);
    assert.equal(h.payloads.length, 2);
    assert.equal(h.payloads[1].type, "video");
    assert.equal(Object.hasOwn(h.payloads[1], "mention_entities"), false);
  } finally { h.cleanup(); }
});

test("account lifecycle clears a finished failed-prefix ref but keeps only the original account's durable records", async () => {
  const h = await harness({ attachments: [attachment(FIRST, "voice")], answer: async () => refused() });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), false);
    const entry = h.out.outgoingEntry(`tmp:${FIRST}`);
    const before = [...h.stored.entries()];
    assert.equal(h.captionPrefixOwnersRef.current.size, 1);
    h.switchAccount(OTHER);
    h.abortUploadsIfAccountChanged();
    assert.equal(h.captionPrefixOwnersRef.current.size, 0);
    assert.equal(h.out.allOutgoingEntries().length, 0);
    assert.equal(await h.remount().send("", undefined, [entry.attachment]), false);
    assert.deepEqual([...h.stored.entries()], before);
    assert.equal(h.payloads.length, 1);
    assert.equal(JSON.parse(h.mediaStored.get(`tmp:${FIRST}`)!).userId, "11111111-1111-4111-8111-000000000001");
  } finally { h.cleanup(); }
});

test("reopening during prefix ACK does not replace the queued prefix waiter or allocate another text UUID", async () => {
  const ack = deferred<any>();
  const h = await harness({ attachments: [attachment(FIRST, "voice")],
    answer: async (payload) => payload.type === "text" ? ack.promise : canonical(payload) });
  const sending = h.send(content, undefined, undefined, undefined, mentions());
  let reopenedSend: Promise<boolean> | undefined;
  try {
    await until(() => h.payloads.length === 1);
    const entry = h.out.outgoingEntry(`tmp:${FIRST}`);
    assert.ok(entry, "file bytes/linkage must already be durable before prefix ACK");
    reopenedSend = h.remount().send("", undefined, [entry.attachment]);
    await flush();
    await flush();
    assert.equal(h.payloads.length, 1);
    assert.equal(await Promise.race([reopenedSend, flush().then(() => "still-pending")]), false);
    ack.resolve(canonical(h.payloads[0]));
    assert.equal(await sending, true);
    assert.equal(h.payloads.length, 2);
    assert.equal(h.payloads[1].type, "audio");
    assert.equal(Object.hasOwn(h.payloads[1], "mention_entities"), false);
  } finally {
    ack.resolve(canonical(h.payloads[0])); h.appOutbox.stop();
    await Promise.race([Promise.all([sending, reopenedSend]), flush()]); h.cleanup();
  }
});

test("late prefix persistence completion cannot patch a new account epoch's same-ID placeholder", async () => {
  const saved = deferred<void>();
  let retaining = false;
  const h = await harness({ attachments: [attachment(FIRST, "voice")], answer: async () => refused(),
    textPut: async (_entry, count) => { if (count === 2) { retaining = true; await saved.promise; } } });
  const sending = h.send(content, undefined, undefined, undefined, mentions());
  try {
    await until(() => retaining);
    h.switchAccount(OTHER);
    h.appOutbox.stop();
    h.switchAccount(ME);
    const restored = { ...h.state.messages[CHAT].find((m: any) => m.id === `tmp:${FIRST}`),
      pending: true, failed: false, upload_waiting: true, content: "new-session" };
    h.state.replaceMessage(CHAT, restored.id, restored);
    const before = JSON.stringify(h.state.messages);
    saved.resolve();
    assert.equal(await sending, false);
    assert.equal(JSON.stringify(h.state.messages), before);
    assert.equal(h.captionPrefixOwnersRef.current.size, 0);
    assert.equal(h.payloads.length, 1);
  } finally { saved.resolve(); await sending; h.cleanup(); }
});

test("discarding a prefix from a reopened view during retention cannot resurrect it on disk", async () => {
  const saved = deferred<void>();
  let retaining = false;
  const h = await harness({ attachments: [attachment(FIRST, "voice")], answer: async () => refused(),
    textPut: async (_entry, count) => { if (count === 2) { retaining = true; await saved.promise; } } });
  const sending = h.send(content, undefined, undefined, undefined, mentions());
  try {
    await until(() => retaining);
    const prefix = h.state.messages[CHAT].find((m: any) => m.type === "text");
    h.remount().discard(prefix);
    saved.resolve();
    assert.equal(await sending, false);
    assert.equal(h.stored.has(prefix.client_message_id), false);
    assert.equal(h.out.outgoingEntry(`tmp:${FIRST}`).captionPrefix, undefined);
    assert.equal(h.state.messages[CHAT].filter((m: any) => m.type === "text").length, 0);
  } finally { saved.resolve(); await sending; h.cleanup(); }
});

test("account transition immediately clears prefix refs and late refusal cannot requeue a stale prefix", async () => {
  const ack = deferred<any>();
  const h = await harness({ attachments: [attachment(FIRST, "voice")], answer: async () => ack.promise });
  const sending = h.send(content, undefined, undefined, undefined, mentions());
  try {
    await until(() => h.payloads.length === 1);
    assert.equal(h.captionPrefixOwnersRef.current.size, 1);
    h.switchAccount(OTHER);
    h.appOutbox.stop();
    assert.equal(h.captionPrefixOwnersRef.current.size, 0);
    h.switchAccount(ME);
    const before = [...h.stored.entries()];
    ack.resolve(refused());
    assert.equal(await sending, false);
    await flush();
    assert.deepEqual([...h.stored.entries()], before);
    assert.equal(h.payloads.length, 1);
    assert.equal(h.captionPrefixOwnersRef.current.size, 0);
  } finally { ack.resolve(refused()); await sending; h.cleanup(); }
});

test("round-video prefix retry keeps its original text client ID and leaves the generated video label plain", async () => {
  const h = await harness({ attachments: [attachment(FIRST, "video_message")],
    answer: async (payload, index) => index === 1 ? refused() : canonical(payload) });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), false);
    const round = h.out.outgoingEntry(`tmp:${FIRST}`).attachment;
    assert.equal(await h.send(round.caption ?? "", round.id, [round], undefined, round.mentionEntities), true);
    assert.equal(h.payloads.length, 3);
    assert.equal(h.payloads[0].client_message_id, h.payloads[1].client_message_id);
    assert.equal(JSON.stringify(h.payloads[1].mention_entities), serialized);
    assert.equal(h.payloads[2].type, "video");
    assert.equal(h.payloads[2].content, "Видео-сообщение (00:01)");
    assert.equal(Object.hasOwn(h.payloads[2], "mention_entities"), false);
  } finally { h.cleanup(); }
});

test("editing a refused prefix keeps the same row identity and uses only the composer's fresh revision", async () => {
  const h = await harness({ attachments: [attachment(FIRST, "voice")],
    answer: async (payload, index) => index === 1 ? refused() : canonical(payload) });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), false);
    const edited = mentions();
    edited.revision = "33333333-3333-4333-8333-000000000002";
    assert.equal(await h.send("\u{1f680} hi @Ada!", FIRST, [h.out.outgoingEntry(`tmp:${FIRST}`).attachment], undefined, edited), true);
    assert.equal(h.payloads[1].client_message_id, h.payloads[0].client_message_id);
    assert.equal(h.payloads[1].content, "\u{1f680} hi @Ada!");
    assert.equal(h.payloads[1].mention_entities.revision, "33333333-3333-4333-8333-000000000002");
    assert.equal(h.payloads[1].mention_entities.items[0].offset, 6);
    assert.equal(h.payloads[1].mention_entities.items[0].user_id, "11111111-1111-4111-8111-000000000002");
  } finally { h.cleanup(); }
});

test("discarding the failed prefix does not resurrect its text when the staged voice is retried", async () => {
  const h = await harness({ attachments: [attachment(FIRST, "voice")],
    answer: async (payload, index) => index === 1 ? refused() : canonical(payload) });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), false);
    h.discard(h.state.messages[CHAT].find((m: any) => m.type === "text"));
    const voice = h.out.outgoingEntry(`tmp:${FIRST}`).attachment;
    assert.equal(await h.send(voice.caption ?? "", voice.id, [voice], undefined, voice.mentionEntities), true);
    assert.equal(h.payloads.filter((p) => p.type === "text").length, 1);
    assert.equal(h.state.messages[CHAT].filter((m: any) => m.type === "text").length, 0);
    assert.equal(Object.hasOwn(h.payloads.at(-1), "mention_entities"), false);
  } finally { h.cleanup(); }
});

test("an explicitly cleared composer caption does not resend mentions from its refused voice prefix", async () => {
  const h = await harness({ attachments: [attachment(FIRST, "voice")],
    answer: async (payload, index) => index === 1 ? refused() : canonical(payload) });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), false);
    assert.equal(await h.send("", FIRST, [h.out.outgoingEntry(`tmp:${FIRST}`).attachment], undefined,
      { version: 1, revision: "33333333-3333-4333-8333-000000000002", items: [] }), true);
    assert.equal(h.payloads.filter((p) => p.type === "text").length, 1);
    assert.equal(h.payloads.length, 2);
    assert.equal(h.payloads[1].type, "audio");
    assert.equal(Object.hasOwn(h.payloads[1], "mention_entities"), false);
    assert.equal(h.state.messages[CHAT].find((m: any) => m.type === "text").failed, true);
  } finally { h.cleanup(); }
});

test("editing the failed prefix into the composer unlinks it before a later media retry", async () => {
  const h = await harness({ attachments: [attachment(FIRST, "voice")],
    answer: async (payload, index) => index === 1 ? refused() : canonical(payload) });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), false);
    h.editFailed(h.state.messages[CHAT].find((m: any) => m.type === "text"));
    await flush();
    const edited = mentions();
    edited.revision = "33333333-3333-4333-8333-000000000002";
    await h.adapter.sendMessage(content, undefined, edited);
    const voice = h.out.outgoingEntry(`tmp:${FIRST}`).attachment;
    assert.equal(await h.remount().send("", undefined, [voice]), true);
    assert.equal(h.payloads.filter((p) => p.type === "text").length, 2);
    assert.equal(h.payloads.at(-1).type, "audio");
    assert.equal(Object.hasOwn(h.payloads.at(-1), "mention_entities"), false);
  } finally { h.cleanup(); }
});

test("a refused media owner retains its caption while following INSERT payloads stay plain", async () => {
  const h = await harness({ answer: async (payload, index) => index === 1 ? refused() : canonical(payload) });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), true);
    assert.equal(h.payloads.length, 2);
    assert.equal(JSON.stringify(h.payloads[0].mention_entities), serialized);
    assert.equal(Object.hasOwn(h.payloads[1], "mention_entities"), false);
    const failed = h.state.messages[CHAT].find((m: any) => m.client_message_id === FIRST);
    assert.equal(failed.failed, true);
    assert.equal(JSON.stringify(failed.mention_entities), serialized);
  } finally { h.cleanup(); }
});

test("all failed uploads retain exactly one durable caption owner without consuming it", async () => {
  const h = await harness({ upload: async () => { throw new TypeError("Failed to fetch"); } });
  try {
    assert.equal(await h.send(content, undefined, undefined, undefined, mentions()), false);
    assert.equal(h.payloads.length, 0);
    const owners = h.out.allOutgoingEntries().filter((entry: any) => entry.caption);
    assert.equal(owners.length, 1);
    assert.equal(owners[0].tempId, "tmp:55555555-5555-4555-8555-000000000001");
    assert.equal(JSON.stringify(owners[0].mentionEntities), serialized);
    assert.equal(JSON.stringify(JSON.parse(h.mediaStored.get(owners[0].tempId)!).entry.mentionEntities), serialized);
  } finally { h.cleanup(); }
});

test("late ACK after switching accounts has no caption cleanup or later INSERT side effects", async () => {
  const ack = deferred<any>();
  const h = await harness({ answer: async () => ack.promise });
  const sending = h.send(content, undefined, undefined, undefined, mentions());
  try {
    await until(() => h.payloads.length === 1);
    const before = h.stageEffects.length;
    h.switchAccount(OTHER);
    ack.resolve(canonical(h.payloads[0]));
    assert.equal(await sending, false);
    assert.equal(h.payloads.length, 1);
    assert.equal(h.stageEffects.length, before);
    assert.equal(h.listeners.size, 0);
  } finally { ack.resolve(canonical(h.payloads[0])); await sending; h.cleanup(); }
});

test("account epoch fences A-null-A relogin while ACK waits and preserves a restored same-ID carrier", async () => {
  const ack = deferred<any>();
  const h = await harness({ attachments: [attachment(FIRST)], answer: async () => ack.promise });
  const sending = h.send(content, undefined, undefined, undefined, mentions());
  try {
    await until(() => h.payloads.length === 1);
    const original = h.out.outgoingEntry(`tmp:${FIRST}`);
    const before = h.stageEffects.length;
    h.switchAccount(null);
    h.appOutbox.stop();
    h.switchAccount(ME);
    const restored = { ...original, attachment: { ...original.attachment, name: "new-session" } };
    h.out.rememberOutgoing(restored);
    assert.equal(await sending, false);
    assert.equal(h.out.outgoingEntry(`tmp:${FIRST}`).attachment.name, "new-session");
    assert.equal(h.stageEffects.length, before);
    assert.equal(h.listeners.size, 0);
    ack.resolve(canonical(h.payloads[0]));
    await flush();
    assert.equal(h.out.outgoingEntry(`tmp:${FIRST}`).attachment.name, "new-session");
  } finally { ack.resolve(canonical(h.payloads[0])); await sending; h.cleanup(); }
});

test("account epoch fences a prefix ACK after A-other-A without consuming the restored staged voice", async () => {
  const ack = deferred<any>();
  const h = await harness({ attachments: [attachment(FIRST, "voice")], answer: async () => ack.promise });
  const sending = h.send(content, undefined, undefined, undefined, mentions());
  try {
    await until(() => h.payloads.length === 1);
    const before = h.stageEffects.length;
    h.switchAccount(OTHER);
    h.appOutbox.stop();
    h.switchAccount(ME);
    h.stagedAttachmentsRef.current = [{ ...attachment(FIRST, "voice"), name: "new-session" }];
    assert.equal(await sending, false);
    assert.equal(h.stageEffects.length, before);
    assert.equal(h.payloads.length, 1);
    assert.equal(h.stagedAttachmentsRef.current[0].name, "new-session");
    assert.equal(h.captionPrefixOwnersRef.current.size, 0);
    assert.equal(h.listeners.size, 0);
    ack.resolve(canonical(h.payloads[0]));
    await flush();
    assert.equal(h.stagedAttachmentsRef.current[0].name, "new-session");
  } finally { ack.resolve(canonical(h.payloads[0])); await sending; h.cleanup(); }
});

test("plain attachment payloads remain legacy-compatible and carry no manufactured entities", async () => {
  const h = await harness({ attachments: [attachment(FIRST)] });
  try {
    assert.equal(await h.send(""), true);
    assert.equal(h.payloads.length, 1);
    assert.equal(Object.hasOwn(h.payloads[0], "mention_entities"), false);
    assert.equal(h.payloads[0].content, "55555555-5555-4555-8555-000000000001.txt");
    assert.equal(h.listeners.size, 0);
  } finally { h.cleanup(); }
});

test("caption ownership omission mutants fail literal runtime assertions", { skip: Boolean(process.env.D331_CAPTION_MUTANT) }, () => {
  for (const [mutant, pattern] of [["transfer", "ownership moves before"], ["prefix", "voice prefix refusal retries"],
    ["epoch", "account epoch fences A-null-A"], ["late", "late ACK after switching"], ["discard", "discarding the failed prefix"],
    ["cleared", "an explicitly cleared composer caption"], ["linkage", "refused prefix remains"],
    ["restore", "refused prefix remains"], ["retain", "refused prefix remains"],
    ["queued", "reopening during prefix ACK"], ["clearRef", "account transition immediately"],
    ["persistEpoch", "late prefix persistence completion"], ["editUnlink", "editing the failed prefix into"],
    ["discardedRetention", "discarding a prefix from a reopened"]]) {
    const env = { ...process.env, D331_CAPTION_MUTANT: mutant };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", `--test-name-pattern=${pattern}`, fileURLToPath(import.meta.url)], {
      env, encoding: "utf8", timeout: 15000,
    });
    const output = result.stdout + result.stderr;
    assert.equal(result.status, 1, `${mutant} survived: ${output}`);
    assert.match(output, /AssertionError|ERR_ASSERTION/);
    assert.match(output, /tests 1\b/);
    assert.doesNotMatch(output, /mutation anchor missing|unexpected dependency|Cannot find module|ReferenceError/);
    console.log(`KILLED caption omission: ${mutant}`);
  }
});
