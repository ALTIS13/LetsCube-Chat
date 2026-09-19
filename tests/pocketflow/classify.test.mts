import assert from "node:assert/strict";
import test from "node:test";

import { classify, prettyJson } from "../../artifacts/pocketflow/src/lib/classify.ts";
import type {
  Attachment,
  IncomingMessage,
} from "../../artifacts/pocketflow/src/transport/types.ts";

/**
 * The smart inbox's one decision (§3), tested as the pure function it is.
 *
 * Everything the inbox offers hangs on this: a URL gets «Следить», a JSON
 * document gets formatted, a file gets its size and its hash. So the
 * interesting cases are the boundaries — a paragraph that merely mentions a
 * link is not a link, and a string that looks like JSON and is not must not be
 * announced as a parse failure.
 */

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    chat: { id: "22222222-2222-4222-8222-222222222222", kind: "private", title: null },
    from: { id: "33333333-3333-4333-8333-333333333333", isBot: false, displayName: "Аня", username: "anya" },
    date: new Date("2026-09-19T10:00:00Z"),
    text: null,
    replyToMessageId: null,
    topicId: null,
    attachment: null,
    ...overrides,
  };
}

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    fileId: "44444444-4444-4444-8444-444444444444",
    kind: "file",
    mimeType: "application/pdf",
    fileName: "отчёт.pdf",
    byteSize: 1024,
    width: null,
    height: null,
    durationSeconds: null,
    ...overrides,
  };
}

test("an attachment wins over its caption", () => {
  const result = classify(
    message({ text: "вот отчёт", attachment: attachment({ kind: "image", mimeType: "image/jpeg" }) }),
  );
  assert.equal(result.kind, "photo");
  if (result.kind === "photo") assert.equal(result.caption, "вот отчёт");
});

test("each attachment kind is recognised", () => {
  const cases = [
    ["image", "photo"],
    ["video", "video"],
    ["audio", "voice"],
    ["file", "document"],
    ["unknown", "document"],
  ] as const;
  for (const [kind, expected] of cases) {
    assert.equal(classify(message({ attachment: attachment({ kind }) })).kind, expected, kind);
  }
});

test("a command is a command, with its arguments", () => {
  const result = classify(message({ text: "/remind 20m проверить сервер" }));
  assert.equal(result.kind, "command");
  if (result.kind === "command") {
    assert.equal(result.command, "remind");
    assert.equal(result.args, "20m проверить сервер");
  }
});

test("a command addressed to a named bot in a group still parses", () => {
  const result = classify(message({ text: "/help@pocketflow_bot" }));
  assert.equal(result.kind, "command");
  if (result.kind === "command") assert.equal(result.command, "help");
});

test("a bare URL is a URL, with its hostname", () => {
  const result = classify(message({ text: "  https://example.com/status?a=1  " }));
  assert.equal(result.kind, "url");
  if (result.kind === "url") {
    assert.equal(result.hostname, "example.com");
    assert.equal(result.url, "https://example.com/status?a=1");
  }
});

test("a schemeless domain is still a URL", () => {
  const result = classify(message({ text: "example.com" }));
  assert.equal(result.kind, "url");
  if (result.kind === "url") assert.equal(result.url, "https://example.com/");
});

test("a paragraph that mentions a link is a note, not a link", () => {
  // The distinction the inbox depends on: offering «Следить» for a sentence
  // would be wrong, and a note about a link is the commonest message there is.
  const result = classify(message({ text: "посмотри https://example.com когда сможешь" }));
  assert.equal(result.kind, "text");
});

test("a word is not a URL just because it parses as one", () => {
  for (const text of ["привет", "todo", "C:", "mailto:a@b.c"]) {
    assert.equal(classify(message({ text })).kind, "text", text);
  }
});

test("JSON is recognised and parsed", () => {
  const result = classify(message({ text: '{"status":"DOWN","latency":925}' }));
  assert.equal(result.kind, "json");
  if (result.kind === "json") {
    assert.deepEqual(result.parsed, { status: "DOWN", latency: 925 });
  }
});

test("a JSON array is JSON too", () => {
  assert.equal(classify(message({ text: "[1, 2, 3]" })).kind, "json");
});

test("something that looks like JSON and is not falls back to text", () => {
  // Not an error the person has to hear about: they have not asked for
  // anything yet, and «не удалось разобрать» to an unasked question is noise.
  const result = classify(message({ text: "{это не json}" }));
  assert.equal(result.kind, "text");
});

test("an oversized JSON document is not parsed", () => {
  const huge = `{"a":"${"x".repeat(9000)}"}`;
  assert.equal(classify(message({ text: huge })).kind, "text");
});

test("the platform's location format is recognised", () => {
  const result = classify(message({ text: "__kub_location__:55.75396:37.62055" }));
  assert.equal(result.kind, "location");
  if (result.kind === "location") {
    assert.equal(result.latitude, 55.75396);
    assert.equal(result.longitude, 37.62055);
  }
});

test("an out-of-range location is not a location", () => {
  assert.equal(classify(message({ text: "__kub_location__:955.7:37.6" })).kind, "text");
});

test("an empty message is empty", () => {
  assert.equal(classify(message({ text: "   " })).kind, "empty");
  assert.equal(classify(message({ text: null })).kind, "empty");
});

test("prettyJson bounds its output", () => {
  const big = { values: Array.from({ length: 5000 }, (_, index) => index) };
  const text = prettyJson(big, 1000);
  assert.ok(text.length <= 1000 + "\n… (обрезано)".length, `length ${text.length}`);
  assert.match(text, /обрезано/);
});

test("prettyJson survives a value it cannot serialise", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(prettyJson(cyclic), "(не удалось отформатировать)");
});

test("a link carrying credentials is refused", () => {
  // Not squeamishness: the URL goes on to the watcher, which would store it.
  for (const text of ["https://user:pass@example.com/", "https://user@example.com/"]) {
    assert.equal(classify(message({ text })).kind, "text", text);
  }
});

test("a non-http scheme is never a link", () => {
  for (const text of ["mailto:a@b.c", "javascript:alert(1)", "file:///etc/passwd", "ftp://example.com/x"]) {
    assert.equal(classify(message({ text })).kind, "text", text);
  }
});
