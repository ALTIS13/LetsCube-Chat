import assert from "node:assert/strict";
import test from "node:test";

import { channelOfMessage, channelPreviewOf, laterPreview } from "../../artifacts/kub/src/lib/channelPreview.ts";

/**
 * Tracker item 54: «ты когда заходишь к нам ты не видишь вот этих каналов в
 * формате последнего сообщения». Telegram's topic row — who wrote last, what,
 * when — for each text channel of a server.
 */

const ME = "11111111-1111-4111-8111-000000000001";
const ANNA = { id: "11111111-1111-4111-8111-000000000002", full_name: "Анна Смирнова", username: "anna" };
const GENERAL = "44444444-4444-4444-8444-000000000001";
const CHECKS = "44444444-4444-4444-8444-000000000002";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "55555555-5555-4555-8555-000000000001",
    chat_id: "22222222-2222-4222-8222-000000000001",
    topic_id: CHECKS,
    user_id: ANNA.id,
    bot_id: null,
    created_at: "2026-09-28T08:15:00.000Z",
    deleted_at: null,
    type: "text",
    content: "Смена закрыта,\n касса сдана",
    media_url: null,
    sender: ANNA,
    ...overrides,
  } as never;
}

test("a message belongs to its topic's channel, and a null or general topic to the general channel", () => {
  assert.equal(channelOfMessage({ topic_id: CHECKS }, GENERAL, [GENERAL]), CHECKS);
  assert.equal(channelOfMessage({ topic_id: null }, GENERAL, [GENERAL]), GENERAL);
  assert.equal(channelOfMessage({ topic_id: GENERAL }, GENERAL, [GENERAL]), GENERAL);
});

test("the row says who, what and when, with a person's first name as Telegram prints it", () => {
  const preview = channelPreviewOf(row(), CHECKS, ME);
  assert.deepEqual(preview, {
    channelId: CHECKS,
    sender: "Анна",
    text: "Смена закрыта, касса сдана",
    at: "2026-09-28T08:15:00.000Z",
    messageId: "55555555-5555-4555-8555-000000000001",
  });
});

test("the reader's own message is «Вы», and a photo reads as one", () => {
  assert.equal(channelPreviewOf(row({ user_id: ME, sender: { id: ME, full_name: "Максим Орлов" } }), CHECKS, ME)?.sender, "Вы");
  assert.equal(channelPreviewOf(row({ type: "image", content: "" }), CHECKS, ME)?.text, "Фото");
});

test("a deleted message is never the preview", () => {
  assert.equal(channelPreviewOf(row({ deleted_at: "2026-09-28T09:00:00.000Z" }), CHECKS, ME), null);
});

test("a nickname-only author keeps the name the conversation prints", () => {
  assert.equal(channelPreviewOf(row({ sender: { id: ANNA.id, full_name: null, username: "anna" } }), CHECKS, ME)?.sender, "anna");
});

test("the later line wins, and a tie keeps the one held", () => {
  const earlier = channelPreviewOf(row(), CHECKS, ME)!;
  const later = channelPreviewOf(row({ id: "55555555-5555-4555-8555-000000000002", created_at: "2026-09-28T09:00:00.000Z" }), CHECKS, ME)!;
  assert.equal(laterPreview(earlier, later), later);
  assert.equal(laterPreview(later, earlier), later);
  const twin = { ...earlier, messageId: "other" };
  assert.equal(laterPreview(earlier, twin), earlier);
  assert.equal(laterPreview(undefined, earlier), earlier);
});
