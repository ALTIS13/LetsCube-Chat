import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import * as protocol from "../../artifacts/kub/src/lib/memberMentions.ts";
import type { Json } from "../../artifacts/kub/src/types/database.ts";

import {
  concatMentionText,
  createMentionText,
  diffMentionTextEdit,
  emptyMessageMentions,
  emptyMentionEntities,
  filterMentionCandidates,
  getMentionCompletion,
  insertMemberMention,
  matchMentionCandidates,
  mentionCompletionContext,
  parseMessageMentions,
  readMentionEntities,
  rebaseMentionText,
  replaceMentionText,
  sliceMentionText,
  trimMentionText,
  type MentionText,
  type MemberMentionCandidate,
  type MemberMentionScope,
} from "../../artifacts/kub/src/lib/memberMentions.ts";

const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const BOT = "bbbbbbbb-0000-4000-8000-000000000002";
const REVISION = "cccccccc-0000-4000-8000-000000000003";
const NEXT_REVISION = "dddddddd-0000-4000-8000-000000000004";

function userEntity(offset = 0, label = "@Ada", userId = USER) {
  return { kind: "user" as const, user_id: userId, offset, length: label.length, label };
}

function envelope(items = [userEntity()]) {
  return { version: 1 as const, revision: REVISION, items };
}

function snapshot(content = "@Ada", items = [userEntity()]): MentionText {
  return { content, mentionEntities: envelope(items) };
}

test("an empty legacy envelope has no identity or generated revision", () => {
  assert.deepEqual(emptyMessageMentions(), { version: 1, revision: null, items: [] });
  assert.deepEqual(parseMessageMentions("plain @ada", { version: 1, revision: null, items: [] }),
    { version: 1, revision: null, items: [] });
  assert.equal(parseMessageMentions("plain", undefined), null);
  assert.equal(parseMessageMentions("plain", null), null);
});

test("protocol envelopes are JSON-assignable without casts or widened keys", () => {
  const legacy: Json = emptyMentionEntities();
  const persisted: Json = createMentionText("@Ada", envelope()).mentionEntities;
  assert.deepEqual(legacy, { version: 1, revision: null, items: [] });
  assert.deepEqual(persisted, { version: 1, revision: "cccccccc-0000-4000-8000-000000000003",
    items: [{ kind: "user", user_id: "aaaaaaaa-0000-4000-8000-000000000001", offset: 0, length: 4, label: "@Ada" }] });
});

test("parsing a retry preserves revision and distinct user/bot UUID namespaces", () => {
  const raw = { version: 1, revision: REVISION, items: [
    userEntity(),
    { kind: "bot", bot_id: USER, offset: 5, length: 7, label: "@helper" },
  ] };
  const first = parseMessageMentions("@Ada @helper", raw);
  assert.deepEqual(first, raw);
  assert.deepEqual(parseMessageMentions("@Ada @helper", first), raw);
  assert.equal(first?.revision, "cccccccc-0000-4000-8000-000000000003");
  assert.equal(first?.items[0]?.kind, "user");
  assert.equal(first?.items[1]?.kind, "bot");
  assert.equal(first?.items[1]?.kind === "bot" ? first.items[1].bot_id : null,
    "aaaaaaaa-0000-4000-8000-000000000001");
});

test("protocol objects require exact own keys, version and a UUID revision for entities", () => {
  const good = envelope();
  const invalid = [
    [], "{}", {}, { ...good, version: "1" }, { ...good, version: 2 },
    { ...good, extra: true }, { ...good, revision: undefined },
    { ...good, revision: null }, { ...good, revision: "next" },
    { version: 1, revision: REVISION }, { ...good, items: {} },
    { ...good, items: [{ ...userEntity(), bot_id: BOT }] },
    { ...good, items: [{ ...userEntity(), extra: true }] },
    { ...good, items: [{ ...userEntity(), kind: "everyone" }] },
    { ...good, items: [{ ...userEntity(), user_id: "ada" }] },
    { ...good, items: [{ kind: "bot", user_id: BOT, offset: 0, length: 4, label: "@Ada" }] },
    Object.assign(Object.create({ inherited: true }), good),
    { ...good, [Symbol("hidden")]: true },
  ];
  for (const raw of invalid) assert.equal(parseMessageMentions("@Ada", raw), null);
  const accessor = { version: 1, revision: REVISION, get items() { throw new Error("must not run"); } };
  assert.equal(parseMessageMentions("@Ada", accessor), null);
});

test("untrusted array fields or accessors fail closed without executing user code", () => {
  const extra = Object.assign([userEntity()], { ignored: true });
  const accessor = [userEntity()];
  let getterCalls = 0;
  Object.defineProperty(accessor, "0", { enumerable: true, get() { getterCalls += 1; throw new Error("must not run"); } });
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error("must not escape"); } });
  assert.equal(parseMessageMentions("@Ada", { ...envelope(), items: extra }), null);
  assert.equal(parseMessageMentions("@Ada", { ...envelope(), items: accessor }), null);
  assert.equal(getterCalls, 0);
  assert.equal(parseMessageMentions("@Ada", proxy), null);
  assert.deepEqual(readMentionEntities("@Ada", proxy), { version: 1, revision: null, items: [] });
});

test("ranges are finite UTF-16 integers, sorted, disjoint and matched to exact source text", () => {
  for (const item of [
    { ...userEntity(), offset: -1 }, { ...userEntity(), offset: 0.5 },
    { ...userEntity(), offset: Infinity }, { ...userEntity(), offset: "0" },
    { ...userEntity(), length: 0 }, { ...userEntity(), length: NaN },
    { ...userEntity(), length: 5 }, { ...userEntity(), label: "Ada" },
    { ...userEntity(), label: "@Eve" },
  ]) assert.equal(parseMessageMentions("@Ada", { ...envelope(), items: [item] }), null);
  assert.equal(parseMessageMentions("@Ada @Ada", envelope([userEntity(5), userEntity(0)])), null);
  assert.equal(parseMessageMentions("@Ada", envelope([userEntity(), userEntity()])), null);
  assert.deepEqual(parseMessageMentions("@Ada@Ada", envelope([userEntity(), userEntity(4)]))?.items,
    [userEntity(), userEntity(4)]);
});

test("non-BMP prefixes count as two units and labels cannot contain half-surrogates", () => {
  const label = "@\u0410\u043d\u043d\u0430 \u041b\u0438";
  assert.equal(parseMessageMentions("\ud83d\ude00 " + label, envelope([userEntity(3, label)]))?.items[0]?.offset, 3);
  assert.equal(parseMessageMentions("\ud83d\ude00 @Ada", envelope([userEntity(2)])), null);
  assert.equal(parseMessageMentions("@\ud83d\ude00", envelope([userEntity(0, "@\ud83d")])), null);
  assert.equal(parseMessageMentions("@\ud83d", envelope([userEntity(0, "@\ud83d")])), null);
  assert.equal(parseMessageMentions("@\ude00", envelope([userEntity(0, "@\ude00")])), null);
  assert.equal(parseMessageMentions("@\ud83d\ude00", envelope([userEntity(0, "@\ud83d\ude00")]))?.items[0]?.length, 3);
  assert.equal(parseMessageMentions("\ud83d @Ada", envelope([userEntity(2)])), null);
});

test("a label is visible @text, not whitespace, controls, line breaks or bidi instructions", () => {
  for (const label of ["@", "@ ", "@Ada ", "@A\nB", "@A\rB", "@A\tB", "@A\u0000B",
    "@A\u007fB", "@A\u0085B", "@A\u2028B", "@A\u2029B", "@A\u202eB", "@\u200b"]) {
    assert.equal(parseMessageMentions(label, envelope([userEntity(0, label)])), null, JSON.stringify(label));
  }
  const label = "@\ud83d\udc69\u200d\ud83d\udcbb";
  assert.ok(parseMessageMentions(label, envelope([userEntity(0, label)])));
});

test("32 entities are admitted but 33 are rejected independently of exported constants", () => {
  const text = Array(33).fill("@Ada").join(" ");
  const items = Array.from({ length: 33 }, (_, index) => userEntity(index * 5));
  assert.equal(parseMessageMentions(text, envelope(items.slice(0, 32)))?.items.length, 32);
  assert.equal(parseMessageMentions(text, envelope(items)), null);
});

test("the label limit is 128 UTF-16 units, not 128 code points", () => {
  const atLimit = "@" + "a".repeat(127);
  assert.equal(parseMessageMentions(atLimit, envelope([userEntity(0, atLimit)]))?.items[0]?.length, 128);
  const tooLong = "@" + "a".repeat(128);
  assert.equal(parseMessageMentions(tooLong, envelope([userEntity(0, tooLong)])), null);
  const astral = "@" + "\ud83d\ude00".repeat(64);
  assert.equal(parseMessageMentions(astral, envelope([userEntity(0, astral)])), null);
});

test("parsed snapshots do not share mutable item objects with persisted input", () => {
  const raw = envelope();
  const parsed = parseMessageMentions("@Ada", raw);
  assert.ok(parsed);
  raw.items[0].user_id = BOT;
  raw.items.push(userEntity());
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0]?.kind === "user" ? parsed.items[0].user_id : null,
    "aaaaaaaa-0000-4000-8000-000000000001");
});

test("text diff identifies a single replacement without bisecting a shared surrogate", () => {
  assert.equal(diffMentionTextEdit("same", "same"), null);
  assert.deepEqual(diffMentionTextEdit("hi @Ada!", "hello @Ada!"), { start: 1, end: 2, text: "ello" });
  assert.deepEqual(diffMentionTextEdit("\ud83d\ude00 @Ada", "\ud83d\ude03 @Ada"),
    { start: 0, end: 2, text: "\ud83d\ude03" });
  assert.deepEqual(diffMentionTextEdit("@Ada", ""), { start: 0, end: 4, text: "" });
});

test("preceding edits shift intact mentions while following edits preserve offsets", () => {
  const source = snapshot("hi @Ada and @Ada", [userEntity(3), userEntity(12)]);
  const result = replaceMentionText(source, { start: 0, end: 2, text: "hello" }, NEXT_REVISION);
  assert.equal(result.content, "hello @Ada and @Ada");
  assert.deepEqual(result.mentionEntities.items, [userEntity(6), userEntity(15)]);
  assert.equal(result.mentionEntities.revision, "dddddddd-0000-4000-8000-000000000004");
  assert.equal(source.content, "hi @Ada and @Ada");
  assert.deepEqual(source.mentionEntities.items, [userEntity(3), userEntity(12)]);
  const suffix = rebaseMentionText(snapshot(), "@Ada!", NEXT_REVISION);
  assert.deepEqual(suffix.mentionEntities.items, [userEntity()]);
});

test("insertion at a range start shifts it and insertion at its end stays outside", () => {
  const atStart = replaceMentionText(snapshot(), { start: 0, end: 0, text: "hi " }, NEXT_REVISION);
  assert.equal(atStart.content, "hi @Ada");
  assert.equal(atStart.mentionEntities.items[0]?.offset, 3);
  const atEnd = replaceMentionText(snapshot(), { start: 4, end: 4, text: "!" }, NEXT_REVISION);
  assert.equal(atEnd.content, "@Ada!");
  assert.deepEqual(atEnd.mentionEntities.items, [userEntity()]);
});

test("edits intersecting a label drop its identity but keep the edited text and other entities", () => {
  for (const edit of [
    { start: 2, end: 2, text: "x" },
    { start: 2, end: 3, text: "" },
    { start: 0, end: 4, text: "@Eve" },
    { start: 0, end: 4, text: "@Ada" },
  ]) {
    const result = replaceMentionText(snapshot("@Ada @Ada", [userEntity(), userEntity(5)]), edit, NEXT_REVISION);
    assert.equal(result.mentionEntities.items.length, 1);
    assert.equal(result.mentionEntities.items[0]?.offset, edit.text === "x" ? 6 : edit.start === 2 ? 4 : 5);
    assert.equal(result.mentionEntities.items[0]?.kind === "user" ? result.mentionEntities.items[0].user_id : null,
      "aaaaaaaa-0000-4000-8000-000000000001");
  }
  const deleted = rebaseMentionText(snapshot(), "", NEXT_REVISION);
  assert.equal(deleted.content, "");
  assert.deepEqual(deleted.mentionEntities.items, []);
});

test("text-only undo does not reconstruct removed identity from a handle", () => {
  const edited = rebaseMentionText(snapshot(), "@Eve", NEXT_REVISION);
  const undone = rebaseMentionText(edited, "@Ada", REVISION);
  assert.equal(undone.content, "@Ada");
  assert.deepEqual(undone.mentionEntities.items, []);
});

test("validation and a no-op text diff preserve the queued revision", () => {
  const result = rebaseMentionText(snapshot(), "@Ada", NEXT_REVISION);
  assert.equal(result.mentionEntities.revision, "cccccccc-0000-4000-8000-000000000003");
  assert.deepEqual(result.mentionEntities.items, [userEntity()]);
  assert.throws(() => rebaseMentionText(snapshot(), "hi @Ada", REVISION), /revision/i);
  assert.throws(() => rebaseMentionText(snapshot(), "hi @Ada", "random"), /revision/i);
});

test("explicit edits refuse invalid boundaries and broken source envelopes", () => {
  const source = snapshot("\ud83d\ude00 @Ada", [userEntity(3)]);
  for (const edit of [
    { start: 1, end: 1, text: "x" }, { start: -1, end: 0, text: "x" },
    { start: 4, end: 3, text: "x" }, { start: 0, end: 99, text: "x" },
    { start: 0, end: 0, text: "\ud83d" },
  ]) assert.throws(() => replaceMentionText(source, edit, NEXT_REVISION));
  assert.throws(() => rebaseMentionText(snapshot("wrong"), "@Ada", NEXT_REVISION), /snapshot/i);
});

test("slice projects whole labels without changing revision; trim saves surviving identities", () => {
  const source = snapshot(" \n@Ada and @Ada \n", [userEntity(2), userEntity(11)]);
  const trimmed = trimMentionText(source, NEXT_REVISION);
  assert.equal(trimmed.content, "@Ada and @Ada");
  assert.deepEqual(trimmed.mentionEntities.items, [userEntity(), userEntity(9)]);
  assert.equal(trimmed.mentionEntities.revision, "dddddddd-0000-4000-8000-000000000004");
  const cut = sliceMentionText(source, 3, 15);
  assert.equal(cut.content, "Ada and @Ada");
  assert.deepEqual(cut.mentionEntities.items, [userEntity(8)]);
  assert.deepEqual(sliceMentionText(snapshot(), 1, 3).mentionEntities.items, []);
  assert.equal(trimMentionText({ content: " \n ", mentionEntities: emptyMessageMentions() }).content, "");
  assert.throws(() => sliceMentionText(snapshot("\ud83d\ude00 @Ada", [userEntity(3)]), 1, 7));
});

test("completion is caret-local and never runs on a selection, email or command address", () => {
  assert.deepEqual(getMentionCompletion("hi @al suffix", 6), { start: 3, end: 6, query: "al" });
  assert.deepEqual(getMentionCompletion("@", 1), { start: 0, end: 1, query: "" });
  assert.deepEqual(getMentionCompletion("line\n@\u0410\u043d", 8), { start: 5, end: 8, query: "\u0410\u043d" });
  assert.deepEqual(getMentionCompletion("**@ad**", 5), { start: 2, end: 5, query: "ad" });
  for (const text of ["alice@ad", "alice@example.com", "/help@ad", "hi @@ad", "@Ada Smith",
    "https://example.com/@ad", "www.example.com/@ad", "https://example.com/?x=@ad"]) {
    assert.equal(getMentionCompletion(text, text.length), null, text);
  }
  assert.equal(getMentionCompletion("@ada", 1, 4), null);
  assert.equal(getMentionCompletion("@ada", -1), null);
  assert.equal(getMentionCompletion("@ada", 99), null);
  assert.equal(getMentionCompletion("\ud83d\ude00 @a", 1), null);
});

test("code masks cover closed and unfinished inline/fenced code but not neighboring plain text", () => {
  for (const text of ["`@ad`", "`code @ad", "``code ` @ad``", "```\n@ad", "```ts\n@ad\n```",
    "~~~ts\n@ad\n~~~", "```\n```nested\n@ad"]) {
    const caret = text.indexOf("@ad") + 3;
    assert.equal(getMentionCompletion(text, caret), null, text);
  }
  assert.deepEqual(getMentionCompletion("`@old` @ad", 10), { start: 7, end: 10, query: "ad" });
  assert.deepEqual(getMentionCompletion("```\n@old\n```\n@ad", 16), { start: 13, end: 16, query: "ad" });
  assert.deepEqual(getMentionCompletion("\\` @ad", 6), { start: 3, end: 6, query: "ad" });
});

test("persisted entities in masked contexts fail strict validation instead of causing phantom pings", () => {
  for (const text of ["`@Ada`", "`code @Ada", "```\n@Ada\n```", "~~~\n@Ada\n~~~",
    "https://example.com/@Ada", "www.example.com/@Ada", "alice@Ada.example", "/help@Ada", "**/help@Ada**"]) {
    assert.equal(parseMessageMentions(text, envelope([userEntity(text.indexOf("@Ada"))])), null, text);
  }
  assert.ok(parseMessageMentions("**@Ada**", envelope([userEntity(2)])));
  assert.ok(parseMessageMentions("`old` @Ada", envelope([userEntity(6)])));
});

test("turning intact mention text into code or a URL removes identity after rebasing", () => {
  const source = snapshot();
  const openedCode = replaceMentionText(source, { start: 0, end: 0, text: "`" }, NEXT_REVISION);
  assert.equal(openedCode.content, "`@Ada");
  assert.deepEqual(openedCode.mentionEntities.items, []);
  const url = replaceMentionText(source, { start: 0, end: 0, text: "https://example.com/" }, NEXT_REVISION);
  assert.equal(url.content, "https://example.com/@Ada");
  assert.deepEqual(url.mentionEntities.items, []);
  const email = replaceMentionText(snapshot("@Ada.example"), { start: 0, end: 0, text: "alice" }, NEXT_REVISION);
  assert.equal(email.content, "alice@Ada.example");
  assert.deepEqual(email.mentionEntities.items, []);
});

test("a selected entity is not a new completion query and raw pasted text never gains an entity", () => {
  assert.equal(getMentionCompletion("@Ada", 3, 3, [userEntity()]), null);
  const pasted = rebaseMentionText({ content: "", mentionEntities: emptyMessageMentions() }, "@Ada", NEXT_REVISION);
  assert.deepEqual(pasted.mentionEntities.items, []);
});

test("trim/slice can receive an explicit fresh save revision without losing surviving entities", () => {
  const saved = trimMentionText(snapshot(" @Ada ", [userEntity(1)]), NEXT_REVISION);
  assert.deepEqual(saved, { content: "@Ada", mentionEntities: {
    version: 1, revision: "dddddddd-0000-4000-8000-000000000004", items: [userEntity()],
  } });
  const sliced = sliceMentionText(snapshot("hi @Ada", [userEntity(3)]), 3, 7, NEXT_REVISION);
  assert.equal(sliced.mentionEntities.revision, "dddddddd-0000-4000-8000-000000000004");
  assert.throws(() => trimMentionText(snapshot(" @Ada ", [userEntity(1)]), REVISION), /revision/i);
});

test("default rebase and trim create UUID revisions only for actual content edits", () => {
  const rebased = rebaseMentionText(snapshot(), "hi @Ada");
  assert.notEqual(rebased.mentionEntities.revision, "cccccccc-0000-4000-8000-000000000003");
  assert.match(rebased.mentionEntities.revision!, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(rebased.mentionEntities.items[0]?.offset, 3);
  const trimmed = trimMentionText(snapshot(" @Ada ", [userEntity(1)]));
  assert.notEqual(trimmed.mentionEntities.revision, "cccccccc-0000-4000-8000-000000000003");
  assert.deepEqual(trimmed.mentionEntities.items, [userEntity()]);
  assert.equal(trimMentionText(snapshot()).mentionEntities.revision, "cccccccc-0000-4000-8000-000000000003");
});

test("UI readers keep plain content harmless while preserving valid persisted metadata", () => {
  assert.deepEqual(emptyMentionEntities(), { version: 1, revision: null, items: [] });
  assert.deepEqual(readMentionEntities("@Ada", { version: 2, revision: REVISION, items: [userEntity()] }),
    { version: 1, revision: null, items: [] });
  assert.deepEqual(createMentionText("@Ada", envelope()), snapshot());
  assert.deepEqual(createMentionText("@stranger"),
    { content: "@stranger", mentionEntities: { version: 1, revision: null, items: [] } });
  assert.deepEqual(mentionCompletionContext("hi @a", 5), { start: 3, end: 5, query: "a" });
});

test("caption handoff concatenates snapshots and shifts the second UUID without losing whitespace", () => {
  const held = snapshot();
  const typed = snapshot("@Bot", [userEntity(0, "@Bot", BOT)]);
  const combined = concatMentionText(held, typed, NEXT_REVISION);
  assert.equal(combined.content, "@Ada @Bot");
  assert.deepEqual(combined.mentionEntities.items, [userEntity(), userEntity(5, "@Bot", BOT)]);
  assert.equal(combined.mentionEntities.revision, "dddddddd-0000-4000-8000-000000000004");
  assert.equal(held.content, "@Ada");
  const whitespace = concatMentionText(snapshot("@Ada\n"), snapshot(" @Bot", [userEntity(1, "@Bot", BOT)]), NEXT_REVISION);
  assert.equal(whitespace.content, "@Ada\n @Bot");
  assert.equal(whitespace.mentionEntities.items[1]?.offset, 6);
  assert.equal(concatMentionText(held, createMentionText("")).mentionEntities.revision,
    "cccccccc-0000-4000-8000-000000000003");
  assert.equal(concatMentionText(createMentionText(""), typed).mentionEntities.revision,
    "cccccccc-0000-4000-8000-000000000003");
});

test("concatenation rechecks a context newly spanning the seam and refuses a 33rd entity", () => {
  const masked = concatMentionText(createMentionText("https://example.com/"), snapshot(), NEXT_REVISION);
  // The normal handoff inserts a separator; a newline-free existing space also keeps it plain.
  assert.equal(masked.content, "https://example.com/ @Ada");
  assert.deepEqual(masked.mentionEntities.items, [userEntity(21)]);
  const code = concatMentionText(createMentionText("` "), snapshot(), NEXT_REVISION);
  assert.equal(code.content, "` @Ada");
  assert.deepEqual(code.mentionEntities.items, []);
  const content = Array(32).fill("@Ada").join(" ");
  const held = snapshot(content, Array.from({ length: 32 }, (_, index) => userEntity(index * 5)));
  assert.throws(() => concatMentionText(held, snapshot(), NEXT_REVISION), /limit|many/i);
});

const ALICE: MemberMentionCandidate = { kind: "user", id: USER, label: "@Alice Smith", username: "alice" };
const HELPER: MemberMentionCandidate = { kind: "bot", id: BOT, label: "@helper_bot", username: "helper_bot" };
const SECOND_USER = "aaaaaaaa-0000-4000-8000-000000000011";
const THIRD_USER = "aaaaaaaa-0000-4000-8000-111100000011";

test("candidate matching uses display word starts and handle prefixes, not middle substrings", () => {
  const russian: MemberMentionCandidate = { kind: "user", id: SECOND_USER,
    label: "@\u0410\u043d\u043d\u0430 \u041b\u0438", username: "anna_li" };
  assert.deepEqual(matchMentionCandidates([ALICE, HELPER, russian], "smi").map((item) => item.id), [USER]);
  assert.deepEqual(matchMentionCandidates([ALICE, HELPER, russian], "lice"), []);
  assert.deepEqual(matchMentionCandidates([ALICE, HELPER, russian], "HELP").map((item) => item.id), [BOT]);
  assert.deepEqual(matchMentionCandidates([russian], "\u043b\u0438").map((item) => item.id), [SECOND_USER]);
  assert.deepEqual(matchMentionCandidates([ALICE], "\uff21\uff2c\uff29").map((item) => item.label), ["@Alice Smith"]);
});

test("candidate ordering and UUID deduplication are stable and keep bot/person namespaces separate", () => {
  const people: MemberMentionCandidate[] = [
    { kind: "user", id: SECOND_USER, label: "@Zoe" },
    { kind: "user", id: USER, label: "@Ada" },
    { kind: "bot", id: USER, label: "@Ada" },
    { kind: "user", id: USER, label: "@Ada" },
  ];
  const expected = ["bot:aaaaaaaa-0000-4000-8000-000000000001",
    "user:aaaaaaaa-0000-4000-8000-000000000001", "user:aaaaaaaa-0000-4000-8000-000000000011"];
  assert.deepEqual(matchMentionCandidates(people, "").map((item) => `${item.kind}:${item.id}`), expected);
  assert.deepEqual(matchMentionCandidates([...people].reverse(), "").map((item) => `${item.kind}:${item.id}`), expected);
  assert.equal(people.length, 4);
});

test("same-name candidates without a handle get distinct stable UUID suffixes", () => {
  const candidates: MemberMentionCandidate[] = [
    { kind: "user", id: SECOND_USER, label: "@Same" },
    { kind: "user", id: THIRD_USER, label: "@Same" },
    { kind: "bot", id: BOT, label: "@Same", username: "helper_bot" },
  ];
  const matched = matchMentionCandidates(candidates, "sa");
  assert.deepEqual(matched.map((item) => item.disambiguator), ["@helper_bot", "000000000011", "111100000011"]);
  assert.deepEqual(matchMentionCandidates([...candidates].reverse(), "sa"), matched);
});

test("a shared display name and shared handle still require distinguishable UUID suffixes", () => {
  const matches = matchMentionCandidates([
    { kind: "user", id: SECOND_USER, label: "@Same", username: "same" },
    { kind: "user", id: THIRD_USER, label: "@Same", username: "SAME" },
  ], "same");
  assert.deepEqual(matches.map((item) => item.disambiguator), ["000000000011", "111100000011"]);
});

test("invalid candidate IDs, labels and kinds cannot enter suggestions", () => {
  assert.deepEqual(matchMentionCandidates([
    { ...ALICE, id: "alice" }, { ...ALICE, label: "Alice" },
    { ...ALICE, label: "@A\nB" }, { ...ALICE, kind: "everyone" } as unknown as MemberMentionCandidate,
  ], ""), []);
});

const SCOPE: MemberMentionScope = { userId: THIRD_USER, chatId: BOT, topicId: null, generation: 4 };

test("roster scope excludes self and stale account/chat/topic/generation or unread results", () => {
  const roster = { scope: SCOPE, state: "ready" as const, candidates: [
    ALICE, { kind: "user" as const, id: THIRD_USER, label: "@Self" },
    { kind: "bot" as const, id: THIRD_USER, label: "@self_bot" },
  ] };
  assert.deepEqual(filterMentionCandidates(roster, SCOPE, "").map((item) => `${item.kind}:${item.id}`),
    ["user:aaaaaaaa-0000-4000-8000-000000000001", "bot:aaaaaaaa-0000-4000-8000-111100000011"]);
  for (const scope of [
    { ...SCOPE, userId: USER }, { ...SCOPE, chatId: USER },
    { ...SCOPE, topicId: USER }, { ...SCOPE, generation: 5 },
  ]) assert.deepEqual(filterMentionCandidates(roster, scope, ""), []);
  for (const state of ["loading", "error", "denied"] as const) {
    assert.deepEqual(filterMentionCandidates({ ...roster, state }, SCOPE, ""), []);
  }
});

test("selection inserts a UUID entity at the query, preserves suffix and consumes no text outside it", () => {
  const source = createMentionText("hi @al suffix");
  const selected = insertMemberMention(source, { start: 3, end: 6, query: "al" }, ALICE, NEXT_REVISION);
  assert.equal(selected.snapshot.content, "hi @Alice Smith suffix");
  assert.equal(selected.caret, 16);
  assert.deepEqual(selected.snapshot.mentionEntities, { version: 1, revision: NEXT_REVISION,
    items: [userEntity(3, "@Alice Smith")] });
  assert.equal(source.content, "hi @al suffix");
  assert.equal(source.mentionEntities.revision, null);
});

test("bot insertion uses bot_id even when the same UUID also identifies a candidate person", () => {
  const source = createMentionText("@he");
  const selected = insertMemberMention(source, { start: 0, end: 3, query: "he" },
    { ...HELPER, id: USER }, NEXT_REVISION);
  assert.equal(selected.snapshot.content, "@helper_bot ");
  assert.equal(selected.caret, 12);
  assert.deepEqual(selected.snapshot.mentionEntities.items, [
    { kind: "bot", bot_id: "aaaaaaaa-0000-4000-8000-000000000001", offset: 0, length: 11, label: "@helper_bot" },
  ]);
  const renamed = { ...HELPER, username: "renamed_bot", label: "@renamed_bot" };
  assert.equal(renamed.id, "bbbbbbbb-0000-4000-8000-000000000002");
  assert.equal(parseMessageMentions(selected.snapshot.content, selected.snapshot.mentionEntities)?.items[0]?.label,
    "@helper_bot");
});

test("insertion keeps previous entities sorted while rebasing those after a caret-local query", () => {
  const source = snapshot("@Ada @he @Ada", [userEntity(), userEntity(9)]);
  const result = insertMemberMention(source, { start: 5, end: 8, query: "he" }, HELPER, NEXT_REVISION);
  assert.equal(result.snapshot.content, "@Ada @helper_bot @Ada");
  assert.deepEqual(result.snapshot.mentionEntities.items.map((item) => [item.kind, item.offset, item.length]),
    [["user", 0, 4], ["bot", 5, 11], ["user", 17, 4]]);
  assert.equal(result.caret, 17);
});

test("a stale, masked or selected-entity completion cannot silently retarget a UUID", () => {
  const context = { start: 0, end: 2, query: "a" };
  assert.throws(() => insertMemberMention(createMentionText("@e"), context, ALICE), /completion/i);
  assert.throws(() => insertMemberMention(createMentionText("`@a"), { start: 1, end: 3, query: "a" }, ALICE), /completion/i);
  assert.throws(() => insertMemberMention(snapshot(), { start: 0, end: 4, query: "Ada" }, ALICE), /completion/i);
  assert.throws(() => insertMemberMention(createMentionText("@a"), context, { ...ALICE, id: "bad" }), /candidate/i);
  const existing = Array(32).fill("@Ada").join(" ") + " @he";
  const source = snapshot(existing, Array.from({ length: 32 }, (_, index) => userEntity(index * 5)));
  assert.throws(() => insertMemberMention(source, { start: 160, end: 163, query: "he" }, HELPER), /limit|many/i);
});

// Mutants are imported from memory; never rewrite the shared production file.
type Protocol = typeof protocol;
const mutations: { name: string; anchor: string; replacement: string; verify: (api: Protocol) => void }[] = [
  { name: "32 item limit", anchor: "MAX_MEMBER_MENTIONS = 32", replacement: "MAX_MEMBER_MENTIONS = 33",
    verify(api) {
      const text = Array(33).fill("@Ada").join(" ");
      assert.equal(api.parseMessageMentions(text, envelope(Array.from({ length: 33 }, (_, i) => userEntity(i * 5)))), null);
    } },
  { name: "128 UTF-16 label limit", anchor: "MAX_MENTION_LABEL_UNITS = 128", replacement: "MAX_MENTION_LABEL_UNITS = 129",
    verify(api) {
      const label = "@" + "a".repeat(128);
      assert.equal(api.parseMessageMentions(label, envelope([userEntity(0, label)])), null);
    } },
  { name: "target UUID validation", anchor: "!isUuid(id)", replacement: "false",
    verify(api) { assert.equal(api.parseMessageMentions("@Ada", envelope([userEntity(0, "@Ada", "ada")])), null); } },
  { name: "exact metadata keys", anchor: "return ownKeys.length === keys.length", replacement: "return true || ownKeys.length === keys.length",
    verify(api) { assert.equal(api.parseMessageMentions("@Ada", { ...envelope(), secret: true }), null); } },
  { name: "range ordering", anchor: "offset < previousEnd", replacement: "false",
    verify(api) { assert.equal(api.parseMessageMentions("@Ada @Ada", envelope([userEntity(5), userEntity()])), null); } },
  { name: "surrogate boundary", anchor: "return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);",
    replacement: "return true;",
    verify(api) { assert.deepEqual(api.diffMentionTextEdit("\ud83d\ude00", "\ud83d\ude03"), { start: 0, end: 2, text: "\ud83d\ude03" }); } },
  { name: "label controls", anchor: "!LABEL_CONTROLS.test(label)", replacement: "true",
    verify(api) { assert.equal(api.parseMessageMentions("@A\nB", envelope([userEntity(0, "@A\nB")])), null); } },
  { name: "masked code context", anchor: "return ranges;", replacement: "return [];",
    verify(api) { assert.equal(api.mentionCompletionContext("`code @ad`", 9), null); } },
  { name: "preceding edit shifts", anchor: "offset: item.offset + delta", replacement: "offset: item.offset",
    verify(api) { assert.equal(api.rebaseMentionText(snapshot(), "hi @Ada", NEXT_REVISION).mentionEntities.items[0]?.offset, 3); } },
  { name: "intersecting edit drops identity", anchor: "if (edit.start >= item.offset + item.length) return [item];\n    return [];",
    replacement: "if (edit.start >= item.offset + item.length) return [item];\n    return [item];",
    verify(api) { assert.deepEqual(api.replaceMentionText(snapshot(), { start: 0, end: 4, text: "@Ada" }, NEXT_REVISION).mentionEntities.items, []); } },
  { name: "retry revision preservation", anchor: "return { version: 1, revision: raw.revision, items };",
    replacement: "return { version: 1, revision: crypto.randomUUID(), items };",
    verify(api) { assert.equal(api.readMentionEntities("@Ada", envelope()).revision, "cccccccc-0000-4000-8000-000000000003"); } },
  { name: "fresh revision requirement", anchor: "requireFreshRevision(nextRevision, source.mentionEntities.revision);", replacement: "void nextRevision;",
    verify(api) { assert.throws(() => api.rebaseMentionText(snapshot(), "hi @Ada", REVISION), /revision/i); } },
  { name: "scope generation", anchor: "roster.scope.generation !== scope.generation", replacement: "false",
    verify(api) {
      assert.deepEqual(api.filterMentionCandidates({ scope: SCOPE, state: "ready", candidates: [ALICE] },
        { ...SCOPE, generation: 5 }, ""), []);
    } },
  { name: "self exclusion", anchor: 'candidate.kind !== "user"\n    || candidate.id.toLowerCase() !== scope.userId.toLowerCase()',
    replacement: "true",
    verify(api) {
      assert.deepEqual(api.filterMentionCandidates({ scope: SCOPE, state: "ready",
        candidates: [{ kind: "user", id: THIRD_USER, label: "@Self" }] }, SCOPE, ""), []);
    } },
  { name: "namespace in candidate identity", anchor: "return `${candidate.kind}:${candidate.id.toLowerCase()}`;",
    replacement: "return candidate.id.toLowerCase();",
    verify(api) {
      assert.equal(api.matchMentionCandidates([{ kind: "user", id: USER, label: "@Ada" },
        { kind: "bot", id: USER, label: "@Ada" }], "").length, 2);
    } },
  { name: "word-start matching", anchor: "display.slice(word.index).startsWith(needle)", replacement: "display.includes(needle)",
    verify(api) { assert.deepEqual(api.matchMentionCandidates([ALICE], "lice"), []); } },
  { name: "caption concatenation offset", anchor: "const shift = left.content.length + separator.length;",
    replacement: "const shift = left.content.length;",
    verify(api) { assert.equal(api.concatMentionText(snapshot(), snapshot("@Bot", [userEntity(0, "@Bot", BOT)]), NEXT_REVISION).mentionEntities.items[1]?.offset, 5); } },
  { name: "stale completion query", anchor: "current.query !== context.query", replacement: "false",
    verify(api) { assert.throws(() => api.insertMemberMention(api.createMentionText("@e"), { start: 0, end: 2, query: "a" }, ALICE), /completion/i); } },
];

for (const mutation of mutations) {
  test(`isolated mutation is caught: ${mutation.name}`, async () => {
    mutation.verify(protocol);
    const source = readFileSync(new URL("../../artifacts/kub/src/lib/memberMentions.ts", import.meta.url), "utf8");
    assert.equal(source.split(mutation.anchor).length - 1, 1, `mutation anchor: ${mutation.name}`);
    const changed = source.replace(mutation.anchor, mutation.replacement);
    assert.notEqual(changed, source);
    const js = stripTypeScriptTypes(changed) + `\n//# sourceURL=member-mentions-mutant-${mutation.name.replaceAll(" ", "-")}.js`;
    const mutant: Protocol = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    assert.throws(() => assert.doesNotThrow(() => mutation.verify(mutant)), assert.AssertionError,
      `mutation survived: ${mutation.name}`);
  });
}
