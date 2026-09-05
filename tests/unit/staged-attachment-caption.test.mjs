import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A photo sent without a caption must arrive without a caption.
 *
 * It used to arrive with the file's name in the message body — in the sender's
 * own bubble, formatted exactly as though they had typed it. The reported one
 * read "ChatGPT Image 31 авг. 2026 г., 05_38_12-image.webp" under a portrait.
 *
 * The receiving side already had a guard for this, matching a word followed by
 * a media extension, and it is the reason this file exists rather than a wider
 * pattern: that name defeated it twice over — `\w` without the unicode flag
 * has no Cyrillic, and the character class has no comma. A heuristic for "does
 * this text look like a file name" has unbounded holes, and every attempt to
 * close them costs a real caption that happens to look like one. So the name is
 * not written at all, and the guard stays only for the messages already stored
 * with one.
 */

const source = readFileSync(
  new URL("../../artifacts/kub/src/lib/stagedAttachments.ts", import.meta.url),
  "utf8",
);

/* The module is TypeScript, and this repository runs its unit tests on the Node
   test runner with no build step, so the function is exercised by lifting the
   body out and evaluating it. It carries no imports and no types beyond the
   parameter list, which is what makes that safe here — a helper that grew a
   dependency would fail to compile below rather than silently pass. */
function loadStagedAttachmentTextContent() {
  const start = source.indexOf("export function stagedAttachmentTextContent(");
  assert.ok(start >= 0, "stagedAttachmentTextContent is missing");
  const end = source.indexOf("\n}", start) + 2;
  const body = source
    .slice(start, end)
    .replace("export function", "function")
    .replace(/: StagedAttachmentKind|: string \| null \| undefined|: string(?=[,)])|\): string/g, (match) =>
      match === "): string" ? ")" : "",
    );
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return stagedAttachmentTextContent;`)();
}

const content = loadStagedAttachmentTextContent();

test("a picture or a video with no caption carries no text", () => {
  for (const kind of ["image", "video"]) {
    assert.equal(content(kind, null, "photo.webp"), "");
    assert.equal(content(kind, "", "photo.webp"), "");
    assert.equal(content(kind, "   ", "photo.webp"), "");
    assert.equal(
      content(kind, undefined, "ChatGPT Image 31 авг. 2026 г., 05_38_12-image.webp"),
      "",
      "the reported name, which the receiving side's filter does not catch",
    );
  }
});

test("a caption the sender typed is kept exactly", () => {
  assert.equal(content("image", "  вот он  ", "photo.webp"), "вот он");
  assert.equal(content("video", "смотри", "clip.mp4"), "смотри");
  // A caption that happens to look like a file name is still a caption. This is
  // the case a cleverer filter on the receiving side would have eaten, and the
  // reason the decision belongs here instead.
  assert.equal(content("image", "report.png", "photo.webp"), "report.png");
});

test("a document or an audio file still says what it is", () => {
  // Nothing about these messages tells you what they are without the name, and
  // the receiving side's caption filter never covered them.
  assert.equal(content("file", null, "договор.pdf"), "договор.pdf");
  assert.equal(content("audio", null, "track.mp3"), "track.mp3");
  assert.equal(content("file", "подписанный", "договор.pdf"), "подписанный");
});

test("the receiving side's filter is not widened to compensate", () => {
  // Deliberately pinned. Widening it is the tempting fix and the wrong one: it
  // trades a visible defect for an invisible one, where a real caption
  // disappears and the sender is never told.
  const bubble = readFileSync(
    new URL("../../artifacts/kub/src/components/chat/MessageBubble.tsx", import.meta.url),
    "utf8",
  );
  const guard = bubble.match(/function looksLikeMediaFileName\(value: string\): boolean \{([^}]*)\}/);
  assert.ok(guard, "the guard for already-stored messages must stay");
  assert.doesNotMatch(guard[1], /\\p\{|\/u\b|\bu\)/, "it must not be widened to unicode");
});
