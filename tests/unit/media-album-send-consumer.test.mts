import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInThisContext } from "node:vm";
import ts from "typescript";

import * as staged from "../../artifacts/kub/src/lib/stagedAttachments.ts";
import * as compression from "../../artifacts/kub/src/lib/mediaCompression.ts";
import * as quality from "../../artifacts/kub/src/lib/mediaQuality.ts";
import * as mentions from "../../artifacts/kub/src/lib/memberMentions.ts";
import * as outgoing from "../../artifacts/kub/src/lib/outgoingMedia.ts";
import * as placeholder from "../../artifacts/kub/src/lib/attachmentPlaceholder.ts";
import * as queue from "../../artifacts/kub/src/lib/attachmentSendQueue.ts";
import * as failure from "../../artifacts/kub/src/lib/uploadFailure.ts";
import { planAttachSend } from "../../artifacts/kub/src/lib/attachSheet.ts";
import { prepareMediaAlbumTargets } from "../../artifacts/kub/src/lib/mediaAlbumSend.ts";
import { removeLocation } from "../../artifacts/kub/src/lib/mediaLocation.ts";
import { runCommittedStagedSendAttempt } from "../../artifacts/kub/src/lib/committedSend.ts";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const chatFile = "components/chat/ChatWindow.tsx";
const CHAT = "22222222-2222-4222-8222-000000000001";
const USER = "11111111-1111-4111-8111-000000000001";
const TOPIC = "33333333-3333-4333-8333-000000000001";
const REPLY = "44444444-4444-4444-8444-000000000001";
const CAPTION = "synthetic album caption";
const noop = () => {};

// Execute source callbacks, not a second implementation of their submission logic.
function callback(file: string, name: string, env: Record<string, any>, omitTransfer = false): any {
  let source = readFileSync(new URL(file, root), "utf8");
  if (omitTransfer && name === "sendStagedAttachments") {
    const anchor = "if (captionSentWithAttachment) claimCaption(attachment);";
    assert.equal(source.split(anchor).length, 2, "omission must reach exactly one actual consumer statement");
    source = source.replace(anchor, "");
  }
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expressions: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) {
      expressions.push(ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expressions.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(expressions.length, 1, `actual callback must be unique: ${file}:${name}`);
  const compiled = ts.transpileModule(`(function(${Object.keys(env).join(",")}) {
    return (${expressions[0].getText(tree)});
  })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return runInThisContext(compiled, { filename: `${file}:${name}` })(...Object.values(env));
}

function uploadWorkflow() {
  const source = readFileSync(new URL("lib/stagedUploadWorkflow.tsx", root), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  runInThisContext(`(function(require,exports) { ${compiled}\n })`)((id: string) => {
    assert.equal(id, "react", "workflow acquired an unreviewed runtime dependency");
    return { createElement: () => { throw Error("rendering is outside this source consumer test"); } };
  }, exports);
  return exports;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(check(), true, "actual callback did not reach the expected boundary");
}

async function albumAttempt({ refuseFirst = true, omitTransfer = false } = {}) {
  outgoing.cancelAllOutgoing();
  const baked = new File(["edited-trim-output"], "edited.mp4", { type: "video/mp4" });
  const photo = new File(["unchanged-animation"], "picked.gif", { type: "image/gif" });
  const video = new File(["unchanged-video"], "picked.webm", { type: "video/webm" });
  const files = [baked, photo, video];
  const previews: staged.StagedAttachment[] = [];
  const workflow = uploadWorkflow();
  const uploadScope = workflow.createStagedUploadScope(CHAT);
  // Leave the ref one render behind throughout sheet submission. The actual
  // consumer must send its explicit new selection, not this unrelated tray.
  const unrelated = staged.createStagedAttachment(new File(["not selected"], "other.txt", { type: "text/plain" }));
  const stagedAttachmentsRef = { current: [unrelated] };
  let tray = [unrelated];
  const state: any = { currentUser: { id: USER }, messages: {},
    addMessage(chat: string, row: any) {
      state.messages[chat] = [...(state.messages[chat] ?? []).filter((item: any) => item.id !== row.id), row];
    },
    updateMessage(chat: string, row: any) { state.addMessage(chat, row); },
    updateChatLastMessage: noop,
  };
  const listeners = new Set();
  const useAppStore = { getState: () => state, subscribe: (listen: unknown) => {
    listeners.add(listen); return () => listeners.delete(listen);
  } };
  const calls: any[] = [];
  const uploads: staged.StagedAttachment[] = [];
  const gates = files.map(() => deferred<staged.StagedAttachmentUpload>());
  let retried: Promise<boolean> | undefined;
  let submitted: Promise<void> | undefined;
  let closed = false;
  const env: Record<string, any> = {
    ...staged, ...compression, ...quality, ...mentions, ...outgoing, ...queue, ...failure, ...workflow,
    ...placeholder, prepareMediaAlbumTargets, runCommittedStagedSendAttempt, removeLocation,
    userId: USER, messageTopicId: TOPIC, replyTo: { id: REPLY }, useAppStore, uploadScope,
    stagedAttachmentsRef, captionPrefixOwnersRef: { current: new Map() },
    cancelledAttachmentIdsRef: { current: new Set() },
    setStagedAttachments: (update: any) => { tray = update(tray); },
    createStagedAttachment: (file: File, metadata: staged.StagedAttachmentMediaMetadata) => {
      const item = staged.createStagedAttachment(file, metadata);
      previews.push(item);
      return item;
    },
    // Browser container/dimension IO is a port; preparation and location-removal
    // decisions still execute in the real stageFiles callback.
    readMediaDimensions: async () => ({ width: 640, height: 360 }),
    prepareChatImageAttachment: () => { throw Error("GIF must not be canvas-encoded"); },
    prepareOriginalPreview: () => { throw Error("compressed selection must not request original preview"); },
    showAppAlert: () => { throw Error("unexpected staging refusal"); },
    setReplyTo: noop, releaseOutgoingPreview: noop, reportError: noop, showActionFeedback: noop,
    console: { warn: noop },
    retryMessageSend: () => { throw Error("upload-failed placeholder must retry its retained File, not a stored row"); },
    uploadStagedAttachment: async (item: staged.StagedAttachment) => {
      uploads.push(item);
      if (uploads.length <= 3) return gates[files.indexOf(item.file)].promise;
      return { bucket: "chat-media", path: `fixture/${item.clientMessageId}`, publicUrl: "https://example.invalid/media" };
    },
    // This is the network boundary, not an upload/DB implementation. Assert
    // DTOs produced by ChatWindow; no server acceptance is inferred here.
    sendMediaMessage: async (dto: any) => { calls.push(dto); return { id: `fixture:${dto.clientMessageId}` }; },
    getStagedAttachmentMessageContent: placeholder.attachmentMessageContent,
    getStagedAttachmentMessageType: placeholder.attachmentMessageType,
    getStagedAttachmentMediaMetadata: callback(chatFile, "getStagedAttachmentMediaMetadata", compression),
  };
  env.updateStagedAttachment = callback(chatFile, "updateStagedAttachment", env);
  env.removeStagedAttachment = callback(chatFile, "removeStagedAttachment", {
    ...env, uploadRegistry: { abort: async () => {} },
  });
  env.patchOutgoingPlaceholder = callback(chatFile, "patchOutgoingPlaceholder", env);
  env.stageFiles = callback(chatFile, "stageFiles", env);
  let send = callback(chatFile, "sendStagedAttachments", env, omitTransfer);
  env.sendStagedAttachments = (...args: any[]) => { retried = send(...args); return retried; };
  const fromSheet = callback(chatFile, "sendMediaFromSheet", env);
  const retry = callback(chatFile, "retrySend", env);
  const chosen = files.map((file, index) => ({ id: `pick-${index}`, kind: index === 1 ? "image" : "video",
    file, source: "gallery", edited: index === 0 }));
  const sheetSend = callback("components/chat/attach/AttachSheet.tsx", "send", {
    ...mentions, ...compression, planAttachSend, photoSendQuality: quality.photoSendQuality,
    chosen, chosenFiles: files, chosenRef: { current: chosen }, tab: "gallery", hd: true,
    encoding: false, editorRef: { current: null }, scopeIsCurrent: () => true,
    lifetimeRef: { current: { version: 1 } }, setMenuOpen: noop,
    captionSnapshot: mentions.createMentionText(`  ${CAPTION}  `),
    // Accepted quality7 covers preparation/edited provenance. Supply its output
    // at that boundary, without rerunning codec or ladder checks here.
    ladder: { prepare: async () => ({ files, origins: new Map() }) },
    onSendMedia: (request: any) => { submitted = fromSheet(request); },
    onClose: () => { closed = true; },
    showAppAlert: env.showAppAlert,
  });
  try {
    await sheetSend("compressed");
    assert.equal(closed, true);
    await until(() => uploads.length === 3);
    const placed = state.messages[CHAT].map((row: any) => ({ ...row }));
    assert.equal(calls.length, 0);
    const uploaded = (index: number) => ({ bucket: "chat-media", path: `fixture/${previews[index].clientMessageId}`,
      publicUrl: `https://example.invalid/${index}` });
    gates[2].resolve(uploaded(2));
    gates[1].resolve(uploaded(1));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 0, "fast sibling upload overtook the first picked item");
    if (refuseFirst) gates[0].reject({ status: 415, message: "synthetic refusal" });
    else gates[0].resolve(uploaded(0));
    await submitted;
    const retained = outgoing.outgoingEntry(placed[0].id);
    if (refuseFirst) {
      assert.ok(retained, "upload failure must retain the actual outgoing entry");
      const failed = state.messages[CHAT].find((row: any) => row.id === placed[0].id);
      assert.equal(failed.failed, true, "refusal must be visible on the actual placeholder");
      // A changed view must not replace the original topic/reply on retry.
      send = callback(chatFile, "sendStagedAttachments", {
        ...env, messageTopicId: "33333333-3333-4333-8333-000000000002",
        replyTo: { id: "44444444-4444-4444-8444-000000000002" },
      }, omitTransfer);
      retry(failed);
      assert.ok(retried, "actual retrySend did not resubmit the retained entry");
      assert.equal(await retried, true);
    }
    return { baked, photo, video, calls, uploads, placed, retained,
      tray, unrelated, remaining: outgoing.outgoingEntriesForChat(CHAT), listeners: listeners.size };
  } finally {
    gates.forEach(gate => gate.resolve({ bucket: "chat-media", path: "fixture/cleanup", publicUrl: "https://example.invalid" }));
    await submitted;
    await retried;
    outgoing.cancelAllOutgoing();
    [unrelated, ...previews].forEach(staged.revokeAttachmentPreview);
  }
}

function assertRetryContract(result: Awaited<ReturnType<typeof albumAttempt>>) {
  const { calls, uploads, placed, retained, baked, photo, video } = result;
  assert.deepEqual(calls.map(dto => dto.content), [CAPTION, "", ""],
    "retry duplicated the caption after its successor claimed it");
  assert.deepEqual(calls.map(dto => dto.clientMessageId),
    [placed[1].client_message_id, placed[2].client_message_id, placed[0].client_message_id]);
  assert.deepEqual(calls.map(dto => dto.mediaMetadata.album_index), [1, 2, 0]);
  assert.deepEqual(calls.map(dto => dto.mediaMetadata.album_count), [3, 3, 3]);
  assert.deepEqual(calls.map(dto => dto.mediaMetadata.album_id), Array(3).fill(placed[0].client_message_id));
  assert.deepEqual(calls.map(dto => dto.clientSentAt),
    [placed[1].client_sent_at, placed[2].client_sent_at, placed[0].client_sent_at]);
  assert.ok(Date.parse(placed[0].client_sent_at) < Date.parse(placed[1].client_sent_at));
  assert.ok(Date.parse(placed[1].client_sent_at) < Date.parse(placed[2].client_sent_at));
  assert.deepEqual(uploads.map(item => item.file), [baked, photo, video, baked]);
  for (const [index, file] of [baked, photo, video, baked].entries()) assert.equal(uploads[index].file, file);
  assert.equal(uploads[3].file, baked, "retry must retain the exact edited File, not reconstruct the pick");
  assert.equal(uploads[3].clientMessageId, uploads[0].clientMessageId);
  assert.equal(retained?.attachment.file, baked);
  assert.equal(retained?.caption, null);
  assert.equal(retained?.attachment.caption, null);
  assert.equal(calls[2].mediaMetadata.size_bytes, 18);
  assert.equal(calls[2].mediaMetadata.mime_type, "video/mp4");
  assert.deepEqual(calls.map(dto => [dto.targetChatId, dto.topicId, dto.replyToId]),
    Array(3).fill([CHAT, TOPIC, REPLY]));
  assert.equal(calls[2].tempId, placed[0].id);
  assert.deepEqual(result.tray, [result.unrelated], "sheet consumed the unrelated composer attachment");
  assert.deepEqual(result.remaining, []);
  assert.equal(result.listeners, 0);
}

test("actual sheet/staging/send/retry transfers one caption and retains edited File, album position and client identity", async () => {
  assertRetryContract(await albumAttempt({ omitTransfer: process.env.LETSCUBE_MEDIA_CONSUMER_OMIT_TRANSFER === "1" }));
});

test("omitting actual consumer caption transfer makes the same retry contract red", async () => {
  const result = await albumAttempt({ omitTransfer: true });
  assert.deepEqual(result.calls.map(dto => dto.content), [CAPTION, "", CAPTION]);
  assert.throws(() => assertRetryContract(result), /retry duplicated the caption/);
});

test("ordinary mixed-album send still inserts once in pick order with only the first caption", async () => {
  const result = await albumAttempt({ refuseFirst: false });
  assert.deepEqual(result.calls.map(dto => dto.content), [CAPTION, "", ""]);
  assert.deepEqual(result.calls.map(dto => dto.clientMessageId), result.placed.map((row: any) => row.client_message_id));
  assert.deepEqual(result.calls.map(dto => dto.mediaMetadata.album_index), [0, 1, 2]);
  assert.deepEqual(result.uploads.map(item => item.file), [result.baked, result.photo, result.video]);
  assert.equal(result.retained, null);
  assert.deepEqual(result.tray, [result.unrelated]);
  assert.equal(result.listeners, 0);
});
