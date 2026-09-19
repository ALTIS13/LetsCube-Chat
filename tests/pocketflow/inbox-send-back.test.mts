import assert from "node:assert/strict";
import test from "node:test";

import type { AppContext } from "../../artifacts/pocketflow/src/app/context.ts";
import { createInboxFeature } from "../../artifacts/pocketflow/src/app/inbox.ts";
import { classify } from "../../artifacts/pocketflow/src/lib/classify.ts";
import { createLogger } from "../../artifacts/pocketflow/src/lib/logger.ts";
import type { Db } from "../../artifacts/pocketflow/src/store/db.ts";
import type {
  BotTransport,
  IncomingMessage,
  SendFileByIdOptions,
  TransportCapability,
  Update,
} from "../../artifacts/pocketflow/src/transport/types.ts";

/**
 * «Отправить обратно», which could not exist until 2026-09-19.
 *
 * Gap G-1 said a bot cannot send a file at all; the platform now accepts a
 * `file_id` in place of a storage reference, so it can hand back what it was
 * sent. The two properties worth pinning are the ones that would otherwise rot
 * quietly:
 *
 *   - the button is drawn from `supports("sendFileById")`, so a platform that
 *     lacks it shows no control rather than one that answers «не получилось»;
 *   - the kind goes to the right method. The platform refuses a mismatch, and
 *     a video offered as a document would fail at the wire with a message
 *     nobody in the conversation can act on.
 */

const CANDIDATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Sent = { kind: "text"; text: string; keyboard: unknown } | { kind: "file"; options: SendFileByIdOptions };

function createFakeDb(candidate: { kind: string; fileId: string | null } | null): Db {
  const db = {
    async query(text: string) {
      if (text.includes("insert into pf_inbox_candidates")) {
        return { rows: [{ id: CANDIDATE }], rowCount: 1 } as never;
      }
      if (text.includes("from pf_inbox_candidates")) {
        if (!candidate) return { rows: [], rowCount: 0 } as never;
        return {
          rows: [
            {
              id: CANDIDATE,
              owner_id: "u1",
              chat_id: "c1",
              source_message_id: "m-source",
              kind: candidate.kind,
              content: "file.pdf",
              file_id: candidate.fileId,
            },
          ],
          rowCount: 1,
        } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return fn(db as unknown as Db);
    },
    async close() {},
  };
  return db as unknown as Db;
}

function createFakeTransport(options: {
  supports?: (capability: TransportCapability) => boolean;
  failSend?: boolean;
}) {
  const sent: Sent[] = [];
  const answered: { id: string; text?: string }[] = [];
  const transport = {
    platform: "fake",
    supports: options.supports ?? (() => true),
    async getMe() {
      return { id: "bot", username: "pf", displayName: "PocketFlow" };
    },
    async sendText(opts: { text: string; keyboard: unknown }) {
      sent.push({ kind: "text", text: opts.text, keyboard: opts.keyboard });
      return { id: "m1", chatId: "c1", date: null } as never;
    },
    async sendFileById(opts: SendFileByIdOptions) {
      if (options.failSend) throw new Error("forbidden");
      sent.push({ kind: "file", options: opts });
      return { id: "m2", chatId: "c1", date: null } as never;
    },
    async editText() {},
    async deleteMessage() {},
    async sendChatAction() {},
    async answerCallbackQuery(id: string, opts?: { text?: string }) {
      answered.push({ id, ...(opts?.text ? { text: opts.text } : {}) });
    },
    async getFile() {
      throw new Error("not used");
    },
    async setMyCommands() {},
    async getMyCommands() {
      return [];
    },
    async getUpdates() {
      return [];
    },
    async setWebhook() {},
    async deleteWebhook() {},
    async getWebhookInfo() {
      return { configured: false, pendingUpdateCount: 0, failureCount: 0, lastErrorCode: null };
    },
    parseWebhookUpdate(body: unknown) {
      return body as Update;
    },
  };
  return { bot: transport as unknown as BotTransport, sent, answered };
}

function createContext(bot: BotTransport, db: Db): AppContext {
  return {
    config: {
      botToken: "x",
      botApiBaseUrl: "https://api.example.com",
      publicBaseUrl: null,
      transport: "polling",
      databaseUrl: "postgres://",
      developerIds: new Set<string>(),
      webhookSecret: null,
      port: 8099,
      defaultTimeZone: "Europe/Moscow",
    },
    db,
    bot,
    log: createLogger({ minLevel: "error", write: () => {} }),
    now: () => new Date("2026-09-19T12:00:00Z"),
  };
}

const USER = {
  userId: "u1",
  displayName: "Аня",
  username: "anya",
  timeZone: "Europe/Moscow",
  developerMode: false,
};

function fileMessage(kind: "image" | "video" | "audio" | "file"): IncomingMessage {
  return {
    id: "m-source",
    chat: { id: "c1", kind: "private", title: null },
    from: { id: "u1", isBot: false, displayName: "Аня", username: "anya" },
    date: new Date("2026-09-19T12:00:00Z"),
    text: null,
    replyToMessageId: null,
    topicId: null,
    attachment: {
      fileId: "f1",
      kind,
      mimeType: kind === "file" ? "application/pdf" : null,
      fileName: kind === "file" ? "отчёт.pdf" : null,
      byteSize: 2048,
      width: null,
      height: null,
      durationSeconds: null,
    },
  };
}

function buttonLabels(keyboard: unknown): string[] {
  const rows = (keyboard as { rows?: { text: string }[][] } | undefined)?.rows ?? [];
  return rows.flat().map((entry) => entry.text);
}

async function offerFor(kind: "image" | "video" | "audio" | "file", supports?: (c: TransportCapability) => boolean) {
  const fake = createFakeTransport(supports ? { supports } : {});
  const db = createFakeDb({ kind: "document", fileId: "f1" });
  const ctx = createContext(fake.bot, db);
  const message = fileMessage(kind);
  await createInboxFeature().onMessage?.(
    { ctx, message, user: USER, isGroup: false },
    classify(message),
  );
  return fake;
}

test("a file offer carries «Отправить обратно» when the platform can honour it", async () => {
  const fake = await offerFor("file");
  const offer = fake.sent.find((entry) => entry.kind === "text");
  assert.ok(offer && offer.kind === "text");
  assert.deepEqual(buttonLabels(offer.keyboard), ["SHA256", "Сохранить", "Отправить обратно"]);
});

test("and does not when it cannot — no control that answers «не получилось»", async () => {
  // The whole reason the button is drawn from `supports` rather than from a
  // constant: before 2026-09-19 the platform had no way to send a file, and a
  // button that could not change its own outcome is the defect this project's
  // register spends most of its pages on.
  const fake = await offerFor("file", (capability) => capability !== "sendFileById");
  const offer = fake.sent.find((entry) => entry.kind === "text");
  assert.ok(offer && offer.kind === "text");
  assert.deepEqual(buttonLabels(offer.keyboard), ["SHA256", "Сохранить"]);
});

test("a video is offered as a video, not as a document", async () => {
  // The platform refuses a mismatch, so the kind is part of the address rather
  // than a label. Before this, every attachment that was not a photo or a
  // voice message was stored as «document».
  const fake = createFakeTransport({});
  let storedKind: string | null = null;
  const db = {
    async query(text: string, values: readonly unknown[] = []) {
      if (text.includes("insert into pf_inbox_candidates")) {
        storedKind = String(values[3]);
        return { rows: [{ id: CANDIDATE }], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return fn(db as unknown as Db);
    },
    async close() {},
  } as unknown as Db;
  const message = fileMessage("video");
  await createInboxFeature().onMessage?.(
    { ctx: createContext(fake.bot, db), message, user: USER, isGroup: false },
    classify(message),
  );
  assert.equal(storedKind, "video");
});

async function press(candidate: { kind: string; fileId: string | null } | null, failSend = false) {
  const fake = createFakeTransport({ failSend });
  const ctx = createContext(fake.bot, createFakeDb(candidate));
  const feature = createInboxFeature();
  await feature.callbacks?.["inbox.sendback"]?.({
    ctx,
    query: {
      id: "cb1",
      from: { id: "u1", isBot: false, displayName: "Аня", username: "anya" },
      data: `inbox.sendback:${CANDIDATE}`,
      message: { id: "m1", chatId: "c1" },
    },
    user: USER,
    args: [CANDIDATE],
  });
  return fake;
}

test("pressing it sends the file back, addressed to the right method", async () => {
  const fake = await press({ kind: "document", fileId: "f1" });
  const file = fake.sent.find((entry) => entry.kind === "file");
  assert.ok(file && file.kind === "file");
  assert.equal(file.options.kind, "document");
  assert.equal(file.options.fileId, "f1");
  // Sent as a reply to the message it came from, so the pair reads as a pair.
  assert.equal(file.options.replyToMessageId, "m-source");
});

test("a saved kind that is not a file sends nothing", async () => {
  const fake = await press({ kind: "text", fileId: "f1" });
  assert.equal(fake.sent.filter((entry) => entry.kind === "file").length, 0);
  assert.match(fake.answered[0]?.text ?? "", /больше не действует/);
});

test("a candidate with no file identifier sends nothing", async () => {
  const fake = await press({ kind: "document", fileId: null });
  assert.equal(fake.sent.filter((entry) => entry.kind === "file").length, 0);
});

test("a candidate that is not this person's sends nothing", async () => {
  // `readCandidate` is owner-scoped, so a forged id answers null — the same
  // rule as everywhere else: callback data is a lookup, never a permission.
  const fake = await press(null);
  assert.equal(fake.sent.filter((entry) => entry.kind === "file").length, 0);
  assert.match(fake.answered[0]?.text ?? "", /больше не действует/);
});

test("a refusal from the platform is one sentence, not a stack trace", async () => {
  const fake = await press({ kind: "document", fileId: "f1" }, true);
  const text = fake.sent.find((entry) => entry.kind === "text");
  assert.ok(text && text.kind === "text");
  assert.match(text.text, /Не получилось отправить файл обратно/);
  assert.ok(!text.text.includes("forbidden"), "the platform's own words are not shown");
});
