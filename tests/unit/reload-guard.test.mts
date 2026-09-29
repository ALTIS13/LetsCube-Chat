// What a reload would take away from somebody, which is what a quiet restart
// now waits for instead of «a conversation is open» (queue item 35, D-282).
//
// The conversation has an address, so a reload comes back to it; the veto that
// used to cover it had also been covering, unannounced, everything opened over
// a conversation. These are that list's contracts: each holder is its own, a
// dialog and an attachment that lives only in memory are read from registries
// that already exist, and nothing is ever reported twice or out of order.
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  guardAgainstReload,
  reloadWouldLose,
  resetReloadGuards,
} from "../../artifacts/kub/src/lib/reloadGuard.ts";
import { popModalLayer, pushModalLayer, resetModalLayers } from "../../artifacts/kub/src/lib/modalStack.ts";
import {
  forgetOutgoing,
  rememberOutgoing,
  type OutgoingMediaEntry,
} from "../../artifacts/kub/src/lib/outgoingMedia.ts";
import { PERSIST_LIMIT_BYTES } from "../../artifacts/kub/src/lib/outbox/outgoingMediaStorage.ts";

function outgoing(id: string, size: number): OutgoingMediaEntry {
  const file = { size, name: `clip-${id}.mp4`, type: "video/mp4" } as unknown as File;
  return {
    tempId: `tmp:${id}`,
    chatId: "22222222-2222-4222-8222-000000000001",
    topicId: null,
    replyToId: null,
    caption: null,
    clientSentAt: "2026-09-29T09:00:00.000Z",
    attachment: {
      id: `att-${id}`,
      file,
      kind: "video",
      previewUrl: null,
      name: "Видео",
      size,
      mimeType: "video/mp4",
      status: "uploading",
      progress: null,
      error: null,
    },
  } as unknown as OutgoingMediaEntry;
}

beforeEach(() => {
  resetReloadGuards();
  resetModalLayers();
  forgetOutgoing("tmp:small");
  forgetOutgoing("tmp:large");
});

test("with nothing in hand a reload loses nothing", () => {
  assert.deepEqual(reloadWouldLose(), []);
});

test("a hold is reported until it is let go", () => {
  const release = guardAgainstReload("recording");
  assert.deepEqual(reloadWouldLose(), ["recording"]);
  release();
  assert.deepEqual(reloadWouldLose(), []);
});

test("each hold is its own, so a cleanup that runs twice cannot free somebody else's", () => {
  // Two composers — a conversation and a thread beside it — can both be
  // editing. One of them finishing must not release the other, and a React
  // cleanup that runs twice must not either.
  const first = guardAgainstReload("editing");
  const second = guardAgainstReload("editing");
  assert.deepEqual(reloadWouldLose(), ["editing"], "the same loss is named once");
  first();
  first();
  assert.deepEqual(reloadWouldLose(), ["editing"], "the second composer's edit was let go by the first");
  second();
  assert.deepEqual(reloadWouldLose(), []);
});

test("every open dialog counts, because what was typed into one is nowhere else", () => {
  const layer = pushModalLayer("kub-modal:settings");
  assert.deepEqual(reloadWouldLose(), ["dialog"]);
  popModalLayer(layer);
  assert.deepEqual(reloadWouldLose(), []);
});

test("an attachment on its way counts only when a reload would drop it", () => {
  // Item 52 keeps files up to the limit on the device, and they are sent again
  // after a reload. Above it a file lives in memory alone.
  rememberOutgoing(outgoing("small", PERSIST_LIMIT_BYTES));
  assert.deepEqual(reloadWouldLose(), [], "a file the device keeps is not lost by a reload");
  rememberOutgoing(outgoing("large", PERSIST_LIMIT_BYTES + 1));
  assert.deepEqual(reloadWouldLose(), ["outgoing-in-memory"]);
  forgetOutgoing("tmp:large");
  assert.deepEqual(reloadWouldLose(), []);
});

test("the losses come back named once each, in a stable order", () => {
  const releases = [
    guardAgainstReload("reply"),
    guardAgainstReload("attach-sheet"),
    guardAgainstReload("reading-history"),
    guardAgainstReload("reply"),
  ];
  pushModalLayer("kub-modal:task");
  assert.deepEqual(reloadWouldLose(), ["attach-sheet", "dialog", "reading-history", "reply"]);
  for (const release of releases) release();
});
