import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGE_MEDIA_COUNT_FORMS,
  MESSAGE_MEDIA_SECTION_LABELS,
  MESSAGE_MEDIA_SECTION_ORDER,
  buildMessageMediaSections,
  classifyMessageMedia,
  extractFirstLink,
  formatMediaCount,
  formatMediaCountLabel,
  isGridMediaKind,
  isRoundVideoMessageContent,
  isVoiceMessageContent,
  resolveActiveMediaSection,
  selectRussianPluralForm,
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

/**
 * The count is the label.
 *
 * The card names a kind by counting it — «1543 фотографии», one row per line —
 * so the number and the noun are one string and the noun has to agree with the
 * number. The short strip labels above are nominative headings and are wrong
 * after a numeral; both live in the same module so they cannot drift apart.
 */

test("the noun agrees with the number in front of it", () => {
  const photos = MESSAGE_MEDIA_COUNT_FORMS.photo;
  assert.equal(selectRussianPluralForm(1, photos), "фотография");
  assert.equal(selectRussianPluralForm(2, photos), "фотографии");
  assert.equal(selectRussianPluralForm(4, photos), "фотографии");
  assert.equal(selectRussianPluralForm(5, photos), "фотографий");
  assert.equal(selectRussianPluralForm(20, photos), "фотографий");
  assert.equal(selectRussianPluralForm(0, photos), "фотографий");
});

test("the teens take the many form even though they end in 1 to 4", () => {
  // The mistake this exists to prevent: testing `% 10` first produces
  // «11 фотография» and «12 фотографии», which is what makes an interface read
  // as machine-translated.
  const photos = MESSAGE_MEDIA_COUNT_FORMS.photo;
  for (const teen of [11, 12, 13, 14, 111, 112, 113, 114, 1011]) {
    assert.equal(selectRussianPluralForm(teen, photos), "фотографий", `${teen}`);
  }
  // …while the same last digits one hundred away do not.
  assert.equal(selectRussianPluralForm(21, photos), "фотография");
  assert.equal(selectRussianPluralForm(22, photos), "фотографии");
  assert.equal(selectRussianPluralForm(101, photos), "фотография");
  assert.equal(selectRussianPluralForm(1543, photos), "фотографии");
});

test("the rows read the way the owner's reference reads", () => {
  assert.equal(formatMediaCountLabel("photo", 1543), "1543 фотографии");
  assert.equal(formatMediaCountLabel("video", 67), "67 видео");
  assert.equal(formatMediaCountLabel("file", 96), "96 файлов");
  assert.equal(formatMediaCountLabel("link", 88), "88 ссылок");
  assert.equal(formatMediaCountLabel("voice", 619), "619 голосовых сообщений");
  // The singular of each of those is a different word, so a row of one is not
  // «1 фотографии».
  assert.equal(formatMediaCountLabel("photo", 1), "1 фотография");
  assert.equal(formatMediaCountLabel("file", 1), "1 файл");
  assert.equal(formatMediaCountLabel("link", 1), "1 ссылка");
  assert.equal(formatMediaCountLabel("voice", 1), "1 голосовое сообщение");
  assert.equal(formatMediaCountLabel("videoMessage", 2), "2 видеосообщения");
  assert.equal(formatMediaCountLabel("audio", 5), "5 аудиозаписей");
  assert.equal(formatMediaCountLabel("gif", 3), "3 GIF-анимации");
});

test("«видео» is indeclinable, and that is not an unfilled placeholder", () => {
  for (const count of [1, 2, 5, 11, 21, 67]) {
    assert.equal(formatMediaCountLabel("video", count), `${count} видео`);
  }
});

test("an incomplete row agrees with the number it actually prints", () => {
  // `24+` is read as «at least 24». The noun goes with the 24 standing beside
  // it, not with an unknown larger total nobody can see.
  assert.equal(formatMediaCountLabel("photo", 24, true), "24+ фотографии");
  assert.equal(formatMediaCountLabel("photo", 1, true), "1+ фотография");
  assert.equal(formatMediaCountLabel("file", 25, true), "25+ файлов");
  assert.equal(formatMediaCountLabel("photo", 24, false), "24 фотографии");
});

test("every kind has all three forms, and the built section carries the label", () => {
  for (const kind of MESSAGE_MEDIA_SECTION_ORDER) {
    const forms = MESSAGE_MEDIA_COUNT_FORMS[kind];
    assert.ok(forms, `${kind} has no counted forms`);
    assert.equal(forms.length, 3, `${kind} does not declare all three forms`);
    for (const form of forms) assert.ok(form.trim().length > 0, `${kind} has an empty form`);
    // The heading and the counted noun are different strings on purpose; the
    // heading is what the sub-view's title bar shows.
    assert.ok(MESSAGE_MEDIA_SECTION_LABELS[kind].length > 0, `${kind} has no heading`);
  }

  const [photos] = buildMessageMediaSections([photo(), photo(), photo()]);
  assert.equal(photos.countedLabel, "3 фотографии");
  assert.equal(photos.countLabel, "3");
  assert.equal(photos.label, "Фото");

  const [partial] = buildMessageMediaSections([photo(), photo()], { hasMore: true });
  assert.equal(partial.countedLabel, "2+ фотографии");

  const [single] = buildMessageMediaSections([file()]);
  assert.equal(single.countedLabel, "1 файл");
});

test("a counted row is built for every populated kind and for no empty one", () => {
  // What the card renders, in the order it renders it: one row per line, and
  // no row at all for a kind this chat has never carried.
  const built = buildMessageMediaSections([link(), link(), file(), voice(), photo()]);
  assert.deepEqual(
    built.map((section) => section.countedLabel),
    ["1 фотография", "1 файл", "2 ссылки", "1 голосовое сообщение"],
  );
  assert.deepEqual(buildMessageMediaSections([]).map((section) => section.countedLabel), []);
});
