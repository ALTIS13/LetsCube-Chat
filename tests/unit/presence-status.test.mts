// A status beside presence — tracker item 37, first phase. The owner's menu and
// durations, and Discord's idle: ten minutes without input or speech
// (reference-clients §25).

import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_IDLE_AFTER_MS,
  manualStatusInForce,
  ownStatus,
  presenceDotBackground,
  presencePublished,
  presentKind,
  presentLabel,
  STATUS_DURATIONS,
  STATUS_OPTIONS,
  statusSilencesSound,
  statusUntil,
  statusUntilLabel,
  statusUntilMs,
} from "../../artifacts/kub/src/lib/presenceStatus.ts";
import { getUserPresenceState } from "../../artifacts/kub/src/lib/presence.ts";
import { sameChat } from "../../artifacts/kub/src/lib/chatListChange.ts";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");

test("the owner's four statuses and six durations, in his order", () => {
  assert.deepEqual(STATUS_OPTIONS.map((option) => option.label), ["В сети", "Неактивен", "Не беспокоить", "Невидимый"]);
  assert.deepEqual(STATUS_DURATIONS.map((duration) => duration.label), ["15 минут", "1 час", "8 часов", "24 часа", "3 дня", "Навсегда"]);
  assert.equal(STATUS_OPTIONS.find((option) => option.id === "online")?.timed, false, "«В сети» is the absence of a choice");
});

test("a chosen status holds until it runs out, and «навсегда» does not", () => {
  assert.equal(manualStatusInForce("dnd", NOW + 1000, NOW), "dnd");
  assert.equal(manualStatusInForce("dnd", NOW, NOW), "online", "at the moment it runs out, it is out");
  assert.equal(manualStatusInForce("idle", null, NOW + 365 * 86_400_000), "idle");
  assert.equal(manualStatusInForce("bogus" as never, null, NOW), "online");
  assert.equal(manualStatusInForce(null, null, NOW), "online");
});

test("with nothing chosen, ten quiet minutes make the person idle, and a movement brings them back", () => {
  const base = { presenceVisible: true, manual: "online" as const, until: null, now: NOW };
  assert.equal(ownStatus({ ...base, lastActivityAt: NOW - AUTO_IDLE_AFTER_MS + 1 }), "online");
  assert.equal(ownStatus({ ...base, lastActivityAt: NOW - AUTO_IDLE_AFTER_MS }), "idle");
});

test("«Не беспокоить» is never turned into idle by a quiet mouse", () => {
  const quiet = ownStatus({ presenceVisible: true, manual: "dnd", until: null, lastActivityAt: NOW - 3 * AUTO_IDLE_AFTER_MS, now: NOW });
  assert.equal(quiet, "dnd");
});

test("presence turned off is «Невидимый» to its own person, because it is to everybody else", () => {
  assert.equal(ownStatus({ presenceVisible: false, manual: "dnd", until: null, lastActivityAt: NOW, now: NOW }), "invisible");
});

test("a chosen status that ran out gives the automatic one back", () => {
  assert.equal(ownStatus({ presenceVisible: true, manual: "invisible", until: NOW - 1, lastActivityAt: NOW, now: NOW }), "online");
  assert.equal(
    ownStatus({ presenceVisible: true, manual: "dnd", until: NOW - 1, lastActivityAt: NOW - AUTO_IDLE_AFTER_MS, now: NOW }),
    "idle",
  );
});

/**
 * The leak of 2026-09-30: the heartbeat started from the signed-out default in
 * the one render before the account's own answer had been asked for, and
 * published presence for people who had turned it off. Each line below is one
 * way a beat must not start.
 */
test("a beat starts only on this account's settled answer, with presence on and not invisible", () => {
  const ready = {
    userId: "u1",
    answerFor: "u1",
    loading: false,
    presenceVisible: true,
    manual: "online" as const,
    until: null,
    now: NOW,
  };
  assert.equal(presencePublished(ready), true);
  assert.equal(presencePublished({ ...ready, answerFor: null }), false, "the signed-out default is nobody's answer");
  assert.equal(presencePublished({ ...ready, answerFor: "u2" }), false, "another account's answer");
  assert.equal(presencePublished({ ...ready, loading: true }), false, "still being asked");
  assert.equal(presencePublished({ ...ready, userId: null, answerFor: null }), false, "nobody signed in");
  assert.equal(presencePublished({ ...ready, presenceVisible: false }), false, "presence turned off");
  assert.equal(presencePublished({ ...ready, manual: "invisible" }), false, "«Невидимый»");
  assert.equal(presencePublished({ ...ready, manual: "invisible", until: NOW - 1 }), true, "«Невидимый» that ran out");
  assert.equal(presencePublished({ ...ready, manual: "dnd" }), true, "«Не беспокоить» is published");
});

test("a stored end is read as a moment, and an unreadable one as none", () => {
  assert.equal(statusUntilMs("2026-09-30T13:00:00.000Z"), Date.parse("2026-09-30T13:00:00.000Z"));
  assert.equal(statusUntilMs(null), null);
  assert.equal(statusUntilMs(""), null);
  assert.equal(statusUntilMs("не дата"), null);
});

test("a duration becomes a moment, and «навсегда» none", () => {
  assert.equal(statusUntil(STATUS_DURATIONS[0], NOW), NOW + 15 * 60_000);
  assert.equal(statusUntil(STATUS_DURATIONS[STATUS_DURATIONS.length - 1], NOW), null);
});

test("when it runs out is said as a time today and as a date after", () => {
  const today = new Date(2026, 8, 30, 12, 0).getTime();
  assert.equal(statusUntilLabel(new Date(2026, 8, 30, 18, 20).getTime(), today), "до 18:20");
  assert.equal(statusUntilLabel(new Date(2026, 9, 3, 9, 0).getTime(), today), "до 3 окт.");
  assert.equal(statusUntilLabel(null, today), null);
  assert.equal(statusUntilLabel(today - 1, today), null);
});

test("others read the published status: the word and the dot", () => {
  assert.equal(presentLabel("dnd"), "не беспокоить");
  assert.equal(presentLabel("idle"), "неактивен");
  assert.equal(presentLabel(null), "в сети");
  assert.equal(presentLabel("invisible"), "в сети", "nothing but the two words is ever read as a status");
  assert.equal(presentKind("dnd"), "dnd");
  const seen = new Date(NOW - 10_000).toISOString();
  assert.deepEqual(getUserPresenceState({ online_at: seen, presence_status: "idle" }, NOW), { isOnline: true, label: "неактивен", kind: "idle" });
  assert.deepEqual(getUserPresenceState({ online_at: seen, presence_status: null }, NOW), { isOnline: true, label: "в сети", kind: "online" });
  const gone = new Date(NOW - 5 * 60_000).toISOString();
  assert.equal(getUserPresenceState({ online_at: gone, presence_status: "dnd" }, NOW).kind, "offline", "a status is only a status while present");
});

test("only «Не беспокоить» silences the sound", () => {
  assert.equal(statusSilencesSound("dnd"), true);
  for (const status of ["online", "idle", "invisible"] as const) assert.equal(statusSilencesSound(status), false, status);
});

test("a status change is a change of the chat row, so the dot is redrawn", () => {
  const base = { id: "c", other_user: { online_at: "2026-09-30T12:00:00.000Z", presence_status: null as string | null } };
  assert.equal(sameChat(base, { ...base, other_user: { ...base.other_user } }), true);
  assert.equal(sameChat(base, { ...base, other_user: { ...base.other_user, presence_status: "dnd" } }), false);
  const member = (status: string | null) => ({ id: "g", members: [{ user_id: "u", profile: { online_at: "x", presence_status: status } }] });
  assert.equal(sameChat(member(null), member("idle")), false);
});

test("each state has its own shape, and a hole is painted in the ground the dot sits on", () => {
  const ring = "var(--kub-surface)";
  const pictures = (["online", "idle", "dnd", "invisible"] as const).map((kind) => presenceDotBackground(kind, ring));
  assert.equal(new Set(pictures).size, 4, "two states drawn alike");
  assert.equal(pictures[0], "var(--kub-online)", "online is a plain disc");
  for (const picture of pictures.slice(1)) assert.ok(picture.includes(ring), `a hole not in the ring's colour: ${picture}`);
  assert.equal(presenceDotBackground("offline", ring), presenceDotBackground("invisible", ring), "invisible is drawn as absence");
});
