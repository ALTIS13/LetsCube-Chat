import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGE_MEDIA_SECTION_ORDER,
  buildMessageMediaSections,
  classifyMessageMedia,
  extractFirstLink,
  formatMediaCount,
  isGridMediaKind,
  isRoundVideoMessageContent,
  isVoiceMessageContent,
  resolveActiveMediaSection,
  type MessageMediaKind,
  type MessageMediaRow,
} from "../../artifacts/kub/src/lib/messageMediaSections.ts";

/**
 * The shared-media list, divided.
 *
 * The card used to show one grid: a voice note, a PDF and a photo were the same
 * tile. Everything below is derivable from rows the panel already loads, which
 * is why it can be tested without a DOM.
 */

let nextId = 0;
function row(partial: Partial<MessageMediaRow> & { type: string }): MessageMediaRow {
  nextId += 1;
  return {
    id: `m${nextId}`,
    content: null,
    media_url: null,
    media_metadata: null,
    ...partial,
  };
}

const photo = () => row({ type: "image", media_url: "https://cdn.example/a.jpg" });
const video = () => row({ type: "video", media_url: "https://cdn.example/a.mp4" });
const file = () => row({ type: "file", media_url: "https://cdn.example/a.pdf", content: "Договор.pdf" });
const voice = () => row({ type: "audio", media_url: "https://cdn.example/a.ogg" });
const link = () => row({ type: "text", content: "смотри https://letscube.ru/docs" });

function kinds(rows: MessageMediaRow[]): MessageMediaKind[] {
  return buildMessageMediaSections(rows).map((section) => section.kind);
}

test("a section holding nothing is never offered", () => {
  const sections = buildMessageMediaSections([photo(), photo()]);
  assert.deepEqual(sections.map((section) => section.kind), ["photo"]);
  // Not «Видео 0», «Файлы 0», «Ссылки 0» — six tabs that do nothing is the
  // whole width of the card spent on emptiness.
  assert.equal(sections.length, 1);
  assert.deepEqual(buildMessageMediaSections([]), []);
});

test("populated sections come back in the declared order, not in row order", () => {
  const shuffled = [link(), file(), voice(), video(), photo()];
  const order = kinds(shuffled);
  assert.deepEqual(order, ["photo", "video", "file", "link", "voice"]);
  const declared = MESSAGE_MEDIA_SECTION_ORDER.filter((kind) => order.includes(kind));
  assert.deepEqual(order, declared);
});

test("a voice note and an attached track are different sections", () => {
  // The predicate is the one the playback layer uses, so the gallery and the
  // player cannot disagree about the same row.
  assert.equal(classifyMessageMedia(voice()), "voice");
  assert.equal(
    classifyMessageMedia(row({ type: "audio", media_url: "https://cdn.example/track", content: "Подкаст" })),
    "audio",
  );
  assert.equal(isVoiceMessageContent(voice()), true);
  assert.equal(
    isVoiceMessageContent(row({ type: "audio", media_url: "https://cdn.example/track", content: "Подкаст" })),
    false,
  );
});

test("a round video message is not filed with ordinary video", () => {
  const round = row({
    type: "video",
    media_url: "https://cdn.example/round.mp4",
    media_metadata: { kind: "video_message" },
  });
  assert.equal(isRoundVideoMessageContent(round), true);
  assert.equal(classifyMessageMedia(round), "videoMessage");
  assert.equal(classifyMessageMedia(video()), "video");
  assert.deepEqual(kinds([round, video()]), ["video", "videoMessage"]);
});

test("the round shape is recognised from metadata or from the caption", () => {
  assert.equal(
    isRoundVideoMessageContent(row({ type: "video", media_url: "u", media_metadata: { shape: "round" } })),
    true,
  );
  assert.equal(
    isRoundVideoMessageContent(row({ type: "video", media_url: "u", content: "Видео-сообщение (0:12)" })),
    true,
  );
  assert.equal(isRoundVideoMessageContent(row({ type: "video", media_url: "u", content: "Видео с дачи" })), false);
});

test("a GIF is its own section rather than a photo or a video", () => {
  assert.equal(classifyMessageMedia(row({ type: "image", media_url: "https://cdn.example/cat.gif" })), "gif");
  assert.equal(classifyMessageMedia(row({ type: "video", media_url: "https://cdn.example/loop.gif" })), "gif");
  assert.equal(classifyMessageMedia(photo()), "photo");
});

test("a row whose attachment is gone is not shown as an empty tile", () => {
  for (const type of ["image", "video", "file", "audio"]) {
    assert.equal(classifyMessageMedia(row({ type, media_url: null })), null, type);
  }
  assert.deepEqual(kinds([row({ type: "image", media_url: null }), photo()]), ["photo"]);
});

test("a text message counts as a link only when it carries one", () => {
  assert.equal(classifyMessageMedia(link()), "link");
  assert.equal(classifyMessageMedia(row({ type: "text", content: "привет" })), null);
  assert.equal(classifyMessageMedia(row({ type: "text", content: null })), null);
  // Nothing else is a section either: a sticker is not shared media.
  assert.equal(classifyMessageMedia(row({ type: "sticker", media_url: "https://cdn.example/s.webp" })), null);
  assert.equal(classifyMessageMedia(row({ type: "system", media_url: "https://cdn.example/x" })), null);
});

test("a link is cut at the address, not at the end of the sentence", () => {
  assert.equal(extractFirstLink("смотри https://letscube.ru/docs."), "https://letscube.ru/docs");
  assert.equal(extractFirstLink("(см. https://letscube.ru/docs)"), "https://letscube.ru/docs");
  assert.equal(extractFirstLink("http://a.ru и https://b.ru"), "http://a.ru");
  assert.equal(extractFirstLink("без ссылок"), null);
  assert.equal(extractFirstLink(null), null);
  assert.equal(extractFirstLink(""), null);
});

test("a count says «at least» while rows are still unloaded", () => {
  assert.equal(formatMediaCount(12, false), "12");
  assert.equal(formatMediaCount(12, true), "12+");
  const complete = buildMessageMediaSections([photo(), photo()]);
  assert.equal(complete[0].countLabel, "2");
  assert.equal(complete[0].count, 2);
  const partial = buildMessageMediaSections([photo(), photo()], { hasMore: true });
  assert.equal(partial[0].countLabel, "2+");
  // The count itself never lies about what is held; only the label admits more.
  assert.equal(partial[0].count, 2);
  assert.equal(partial[0].items.length, 2);
});

test("the open section survives a reload, and is replaced when it stops existing", () => {
  const sections = buildMessageMediaSections([photo(), file()]);
  assert.equal(resolveActiveMediaSection(sections, "file"), "file");
  // «Очистить историю у себя» can take the open section away underneath.
  assert.equal(resolveActiveMediaSection(sections, "voice"), "photo");
  assert.equal(resolveActiveMediaSection(sections, null), "photo");
  assert.equal(resolveActiveMediaSection([], "photo"), null);
});

test("only the visual kinds are drawn as a grid", () => {
  for (const kind of ["photo", "video", "gif", "videoMessage"] as const) {
    assert.equal(isGridMediaKind(kind), true, kind);
  }
  for (const kind of ["file", "link", "voice", "audio"] as const) {
    assert.equal(isGridMediaKind(kind), false, kind);
  }
});

test("every declared section has a label and a place in the order", () => {
  const seen = new Set(MESSAGE_MEDIA_SECTION_ORDER);
  assert.equal(seen.size, MESSAGE_MEDIA_SECTION_ORDER.length, "a kind is listed twice");
  const built = buildMessageMediaSections([photo(), video(), file(), link(), voice()]);
  for (const section of built) {
    assert.ok(section.label.length > 0, `${section.kind} has no label`);
  }
});
