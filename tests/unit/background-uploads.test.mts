import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundUploadSender, type BackgroundUploadDeps } from "../../artifacts/kub/src/lib/outbox/backgroundUploads.ts";

// Tracker item 52's last step: a file or a voice note that waited for the
// network goes from wherever the reader is, not only from its own chat.

type Row = { id: string; chat_id: string; upload_waiting?: boolean; pending?: boolean; failed?: boolean; send_error?: string | null; upload_progress?: number };

interface Entry {
  tempId: string;
  chatId: string;
  topicId: string | null | undefined;
  replyToId: string | null;
  caption: string | null;
  clientSentAt: string;
  attachment: { id: string; name: string; clientMessageId: string };
}

function entry(chatId: string, n: number, at: string): Entry {
  return {
    tempId: `tmp:${chatId}-${n}`,
    chatId,
    topicId: undefined,
    replyToId: null,
    caption: null,
    clientSentAt: at,
    attachment: { id: `${chatId}-a${n}`, name: `voice-${n}.webm`, clientMessageId: `${chatId}-${n}` },
  };
}

function world(entries: Entry[], options: { viewed?: string[]; offline?: boolean } = {}) {
  const rows = new Map<string, Row>();
  for (const item of entries) rows.set(item.tempId, { id: item.tempId, chat_id: item.chatId, upload_waiting: true, pending: true });
  const log: string[] = [];
  const cancelled = new Set<string>();
  const state = { user: "u1" as string | null, offline: Boolean(options.offline) };
  // What each upload answers, by attachment id: "ok", "network" or "refused".
  const answers = new Map<string, "ok" | "network" | "refused">();
  let release: (() => void) | null = null;
  let holdUploads = false;

  const deps: BackgroundUploadDeps = {
    currentUserId: () => state.user,
    online: () => !state.offline,
    entries: () => entries.filter((item) => rows.has(item.tempId)) as never,
    viewed: (chatId) => (options.viewed ?? []).includes(chatId),
    uploading: () => false,
    cancelled: (id) => cancelled.has(id),
    placeholder: (_chatId, tempId) => (rows.get(tempId) as never) ?? null,
    patch: (_chatId, tempId, change) => {
      const current = rows.get(tempId);
      if (current) rows.set(tempId, change(current as never) as never);
    },
    upload: async (item) => {
      log.push(`upload ${item.attachment.id}`);
      if (holdUploads) await new Promise<void>((resolve) => { release = resolve; });
      const answer = answers.get(item.attachment.id) ?? "ok";
      if (answer === "network") throw Object.assign(new Error("Failed to fetch"), { kind: "network" });
      if (answer === "refused") throw Object.assign(new Error("Payload too large"), { kind: "refused" });
      return { bucket: "chat-media", path: `p/${item.attachment.id}`, publicUrl: `https://x/p/${item.attachment.id}` };
    },
    insert: async (item) => {
      log.push(`insert ${item.attachment.id}`);
    },
    forget: (item) => {
      rows.delete(item.tempId);
    },
    describe: (error) => ({
      reason: (error as { kind?: string }).kind === "network" ? "network" : "too_large",
      status: (error as { kind?: string }).kind === "network" ? null : 413,
      limitBytes: null,
    }) as never,
    refusal: (item) => `Не удалось отправить «${item.attachment.name}».`,
  };
  return {
    deps,
    rows,
    log,
    cancelled,
    state,
    answers,
    holdUploads: () => { holdUploads = true; },
    release: () => { holdUploads = false; release?.(); },
  };
}

test("what waits in a conversation nobody has open goes, oldest first, and a view's own are left to it", async () => {
  const w = world(
    [entry("b", 2, "2026-09-28T10:02:00Z"), entry("b", 1, "2026-09-28T10:01:00Z"), entry("a", 1, "2026-09-28T10:00:00Z")],
    { viewed: ["a"] },
  );
  await createBackgroundUploadSender(w.deps).run();
  assert.deepEqual(w.log, ["upload b-a1", "insert b-a1", "upload b-a2", "insert b-a2"]);
  assert.ok(w.rows.has("tmp:a-1"), "the open conversation's attachment was taken from its view");
  assert.equal(w.rows.get("tmp:a-1")?.upload_waiting, true);
});

test("offline, or with nobody signed in, nothing is tried", async () => {
  const offline = world([entry("b", 1, "2026-09-28T10:01:00Z")], { offline: true });
  await createBackgroundUploadSender(offline.deps).run();
  assert.deepEqual(offline.log, []);
  const signedOut = world([entry("b", 1, "2026-09-28T10:01:00Z")]);
  signedOut.state.user = null;
  await createBackgroundUploadSender(signedOut.deps).run();
  assert.deepEqual(signedOut.log, []);
});

test("cut by the network again, it waits with its clock and holds its chat back; other chats still go", async () => {
  const w = world([
    entry("b", 1, "2026-09-28T10:01:00Z"),
    entry("b", 2, "2026-09-28T10:02:00Z"),
    entry("c", 1, "2026-09-28T10:03:00Z"),
  ]);
  w.answers.set("b-a1", "network");
  await createBackgroundUploadSender(w.deps).run();
  assert.deepEqual(w.log, ["upload b-a1", "upload c-a1", "insert c-a1"], "b's second would have overtaken its first");
  const first = w.rows.get("tmp:b-1");
  assert.equal(first?.upload_waiting, true);
  assert.equal(first?.failed, false);
  assert.equal(first?.send_error, null);
  assert.equal(first && "upload_progress" in first, false);
  assert.equal(w.rows.get("tmp:b-2")?.upload_waiting, true, "the one behind it still waits");
});

test("refused, it turns red with the reason and «Повторить», and the next in its chat still goes", async () => {
  const w = world([entry("b", 1, "2026-09-28T10:01:00Z"), entry("b", 2, "2026-09-28T10:02:00Z")]);
  w.answers.set("b-a1", "refused");
  await createBackgroundUploadSender(w.deps).run();
  const refused = w.rows.get("tmp:b-1");
  assert.equal(refused?.failed, true);
  assert.equal(refused?.pending, false);
  assert.equal(refused?.upload_waiting, false);
  assert.equal(refused?.send_error, "Не удалось отправить «voice-1.webm».");
  assert.deepEqual(w.log, ["upload b-a1", "upload b-a2", "insert b-a2"]);
});

test("the claim is taken before anything is awaited, so two moments at once send it once", async () => {
  const w = world([entry("b", 1, "2026-09-28T10:01:00Z")]);
  w.holdUploads();
  const sender = createBackgroundUploadSender(w.deps);
  const first = sender.run();
  // The upload is running; the placeholder no longer says it waits.
  assert.equal(w.rows.get("tmp:b-1")?.upload_waiting, false);
  const second = sender.run();
  w.release();
  await Promise.all([first, second]);
  assert.deepEqual(w.log, ["upload b-a1", "insert b-a1"]);
});

test("taken away while it uploads, nothing is inserted; an account change stops the rest", async () => {
  const cancelledWorld = world([entry("b", 1, "2026-09-28T10:01:00Z")]);
  cancelledWorld.holdUploads();
  const run = createBackgroundUploadSender(cancelledWorld.deps).run();
  cancelledWorld.cancelled.add("b-a1");
  cancelledWorld.release();
  await run;
  assert.deepEqual(cancelledWorld.log, ["upload b-a1"]);

  const switched = world([entry("b", 1, "2026-09-28T10:01:00Z"), entry("c", 1, "2026-09-28T10:02:00Z")]);
  switched.holdUploads();
  const next = createBackgroundUploadSender(switched.deps).run();
  switched.state.user = "u2";
  switched.release();
  await next;
  assert.deepEqual(switched.log, ["upload b-a1"], "a row went out under the account that signed in next");
});

test("what a view is sending itself, or took over, is not touched", async () => {
  const w = world([entry("b", 1, "2026-09-28T10:01:00Z")]);
  w.rows.set("tmp:b-1", { ...w.rows.get("tmp:b-1")!, upload_waiting: false });
  await createBackgroundUploadSender(w.deps).run();
  assert.deepEqual(w.log, []);
});
