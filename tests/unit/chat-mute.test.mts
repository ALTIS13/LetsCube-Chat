import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_MUTE_CACHE_KEY,
  CHAT_MUTE_MESSAGES,
  CHAT_MUTE_OFF,
  CHAT_MUTE_OPTIONS,
  EMPTY_CHAT_MUTES,
  MUTE_ACTION_LABEL,
  MUTE_CHOICE_BACK,
  UNMUTE_ACTION_LABEL,
  applyCachedMutes,
  applyLocalMute,
  applyMutesError,
  applyServerMutes,
  chatMuteChoiceTitle,
  chatMuteDetail,
  chatMuteFeedbackTitle,
  chatMuteFor,
  chatMuteMenuEntries,
  chatMutePreferenceFor,
  chatMuteState,
  chatMutesForUser,
  isChatMuted,
  mutedChatIdsAt,
  muteEndsLabel,
  muteRefusalText,
  mutesReadFailureText,
  nextChatMuteChange,
  readCachedMutes,
  serializeCachedMutes,
  type ChatMutePreference,
} from "../../artifacts/kub/src/lib/chatMute.ts";
import { INTERNALS_PATTERN, MAPPER_GENERIC_FAILURE } from "../../artifacts/kub/src/lib/plainMessages.ts";

/**
 * Muting a chat, as the account holds it (D-167).
 *
 * The server half of this has been live since
 * `20260527_push_notifications_foundation.sql` and was never used: the interface
 * kept its mutes in `localStorage['ng_muted']`, so a chat silenced on a phone
 * read as unsilenced on a computer while the server really was suppressing its
 * push. What is tested here is the half that decides — and every one of these is
 * a contract that fails silently rather than loudly if it drifts.
 *
 * The clock is built with the local `Date` constructor throughout, never from a
 * UTC literal, so the assertions mean the same thing in every time zone a
 * workstation or a CI box might be set to. That matters more than usual here:
 * «до завтра» is the one duration measured against the wall clock rather than
 * added to the current instant.
 */

const at = (
  year: number, month: number, day: number, hour: number, minute = 0,
): number => new Date(year, month - 1, day, hour, minute, 0, 0).getTime();

const NOW = at(2026, 9, 14, 20, 0);

const pref = (pushEnabled: boolean, mutedUntil: number | null): ChatMutePreference => ({
  pushEnabled,
  mutedUntil: mutedUntil === null ? null : new Date(mutedUntil).toISOString(),
});

// ---------------------------------------------------------------------------
// The two conditions the database applies, in the order it applies them
// ---------------------------------------------------------------------------

/**
 * Read off `public._notification_push_allowed`:
 *
 *     if found then
 *       if v_chat_pref.push_enabled is not true then return false; end if;
 *       if v_chat_pref.muted_until is not null
 *          and v_chat_pref.muted_until > now() then return false; end if;
 *     end if;
 */
test("a chat with no preference row is not muted, because the gate is inside `if found`", () => {
  assert.equal(chatMuteState(null, NOW).muted, false);
  assert.equal(chatMuteState(undefined, NOW).muted, false);
  assert.equal(isChatMuted(null, NOW), false);
});

test("push_enabled false is a mute with no end, whatever muted_until says", () => {
  // The database checks `push_enabled is not true` FIRST and returns, so a row
  // carrying both is silenced forever and not until Tuesday. A client that read
  // the timestamp first would draw an end that never comes.
  const forever = chatMuteState(pref(false, at(2026, 9, 15, 9)), NOW);
  assert.equal(forever.muted, true);
  assert.equal(forever.until, null, "a permanent mute grew an end date from the column beside it");

  // And the same row with the timestamp already past: still muted, still no end.
  const past = chatMuteState(pref(false, at(2026, 9, 13, 9)), NOW);
  assert.deepEqual(past, { muted: true, until: null });
});

test("muted_until in the past is not muted — the comparison is `> now()`", () => {
  // This is the one that would be invisible: the row exists, so a client asking
  // «is there a row?» or «is muted_until set?» says silenced, while the database
  // delivers every message. One second either side of the instant.
  const justPast = at(2026, 9, 14, 19, 59);
  assert.equal(chatMuteState(pref(true, justPast), NOW).muted, false);
  assert.equal(chatMuteState(pref(true, NOW), NOW).muted, false, "`>` became `>=`");
  const justFuture = at(2026, 9, 14, 20, 1);
  assert.deepEqual(chatMuteState(pref(true, justFuture), NOW), { muted: true, until: justFuture });
});

test("push_enabled true with no end date is not muted", () => {
  assert.equal(chatMuteState(CHAT_MUTE_OFF, NOW).muted, false);
  assert.equal(CHAT_MUTE_OFF.pushEnabled, true);
  assert.equal(CHAT_MUTE_OFF.mutedUntil, null, "an unmute leaves an end date behind");
});

test("an unparseable end date is not a mute", () => {
  assert.equal(chatMuteState({ pushEnabled: true, mutedUntil: "not a timestamp" }, NOW).muted, false);
});

// ---------------------------------------------------------------------------
// The durations
// ---------------------------------------------------------------------------

test("the four options are the four the product offers, in order", () => {
  assert.deepEqual(CHAT_MUTE_OPTIONS.map((option) => option.id), ["hour", "workday", "tomorrow", "forever"]);
  for (const option of CHAT_MUTE_OPTIONS) {
    assert.ok(option.label.trim().length > 0, `${option.id} has no label`);
  }
  assert.equal(CHAT_MUTE_OPTIONS[CHAT_MUTE_OPTIONS.length - 1].id, "forever", "«Навсегда» left the foot of the list");
});

test("«навсегда» writes push_enabled false and no end date", () => {
  assert.deepEqual(chatMutePreferenceFor("forever", NOW), { pushEnabled: false, mutedUntil: null });
});

test("a timed mute leaves push_enabled true, so the gate reaches the timestamp", () => {
  // If a timed mute wrote `push_enabled: false` the server would silence the
  // chat forever and the first condition would swallow the second.
  for (const option of ["hour", "workday", "tomorrow"] as const) {
    const row = chatMutePreferenceFor(option, NOW);
    assert.equal(row.pushEnabled, true, `«${option}» would be a permanent mute on the server`);
    assert.ok(row.mutedUntil, `«${option}» wrote no end date`);
  }
});

test("an hour is an hour and eight hours are eight, from now", () => {
  assert.equal(Date.parse(chatMutePreferenceFor("hour", NOW).mutedUntil!), NOW + 60 * 60 * 1000);
  assert.equal(Date.parse(chatMutePreferenceFor("workday", NOW).mutedUntil!), NOW + 8 * 60 * 60 * 1000);
});

test("«до завтра» is nine in the morning of the next calendar day, by the wall clock", () => {
  // Not «now plus a day», and not «the next time it is nine»: pressed at eight
  // in the evening it ends thirteen hours later, and pressed ten minutes after
  // midnight it ends thirty-three hours later, on the morning the word names.
  assert.equal(
    Date.parse(chatMutePreferenceFor("tomorrow", at(2026, 9, 14, 20)).mutedUntil!),
    at(2026, 9, 15, 9),
  );
  assert.equal(
    Date.parse(chatMutePreferenceFor("tomorrow", at(2026, 9, 14, 0, 10)).mutedUntil!),
    at(2026, 9, 15, 9),
  );
  // Across a month boundary, which is where an arithmetic shortcut would break.
  assert.equal(
    Date.parse(chatMutePreferenceFor("tomorrow", at(2026, 9, 30, 22)).mutedUntil!),
    at(2026, 10, 1, 9),
  );
});

test("the next change is the earliest end still ahead, and null when there is none", () => {
  const prefs = {
    a: pref(true, at(2026, 9, 14, 23)),
    b: pref(true, at(2026, 9, 14, 21)),
    c: pref(true, at(2026, 9, 14, 10)),
    d: pref(false, null),
    e: CHAT_MUTE_OFF,
  };
  assert.equal(nextChatMuteChange(prefs, NOW), at(2026, 9, 14, 21), "a past end, or a permanent mute, armed the timer");
  assert.equal(nextChatMuteChange({ d: pref(false, null) }, NOW), null);
  assert.equal(nextChatMuteChange({}, NOW), null);
});

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

test("the end is named in the words a person reads", () => {
  assert.equal(muteEndsLabel(at(2026, 9, 14, 21, 0), NOW), "до 21:00");
  assert.equal(muteEndsLabel(at(2026, 9, 14, 21, 5), NOW), "до 21:05");
  assert.equal(muteEndsLabel(at(2026, 9, 15, 9, 0), NOW), "до завтра, 9:00");
  assert.equal(muteEndsLabel(at(2026, 9, 17, 9, 0), NOW), "до 17 сентября, 9:00");
  // Across the year, where «tomorrow» is a different month and a different year.
  assert.equal(muteEndsLabel(at(2027, 1, 1, 9, 0), at(2026, 12, 31, 20)), "до завтра, 9:00");
});

test("a detail is «навсегда», an end, or nothing at all", () => {
  assert.equal(chatMuteDetail(chatMuteState(null, NOW), NOW), null);
  assert.equal(chatMuteDetail(chatMuteState(pref(false, null), NOW), NOW), "навсегда");
  assert.equal(chatMuteDetail(chatMuteState(pref(true, at(2026, 9, 14, 21)), NOW), NOW), "до 21:00");
});

test("the confirmation names the end, including the long night «До завтра» can be", () => {
  assert.equal(chatMuteChoiceTitle("off", NOW), "Уведомления включены");
  assert.equal(chatMuteChoiceTitle("forever", NOW), "Уведомления отключены");
  assert.equal(chatMuteChoiceTitle("hour", NOW), "Уведомления отключены до 21:00");
  assert.equal(chatMuteChoiceTitle("tomorrow", NOW), "Уведомления отключены до завтра, 9:00");
  assert.equal(
    chatMuteChoiceTitle("tomorrow", at(2026, 9, 14, 0, 10)),
    "Уведомления отключены до завтра, 9:00",
    "the one duration that can run thirty-three hours stopped saying when it ends",
  );
  assert.equal(chatMuteFeedbackTitle({ muted: false, until: null }, NOW), "Уведомления включены");
});

// ---------------------------------------------------------------------------
// What the three surfaces offer
// ---------------------------------------------------------------------------

test("at rest the menu is one row, and it says which way it goes", () => {
  const off = chatMuteMenuEntries(chatMuteState(null, NOW), false, NOW);
  assert.deepEqual(off, [{ id: "mute", label: MUTE_ACTION_LABEL, detail: null }]);

  const timed = chatMuteMenuEntries(chatMuteState(pref(true, at(2026, 9, 14, 21)), NOW), false, NOW);
  assert.deepEqual(timed, [{ id: "unmute", label: UNMUTE_ACTION_LABEL, detail: "до 21:00" }]);

  const forever = chatMuteMenuEntries(chatMuteState(pref(false, null), NOW), false, NOW);
  assert.deepEqual(forever, [{ id: "unmute", label: UNMUTE_ACTION_LABEL, detail: "навсегда" }]);
});

test("opened, it is the way back and the four durations", () => {
  const entries = chatMuteMenuEntries(chatMuteState(null, NOW), true, NOW);
  assert.deepEqual(entries.map((entry) => entry.id), ["back", "hour", "workday", "tomorrow", "forever"]);
  assert.equal(entries[0].label, MUTE_CHOICE_BACK, "the durations became a one-way door");
  assert.deepEqual(entries.slice(1).map((entry) => entry.label), CHAT_MUTE_OPTIONS.map((option) => option.label));
});

// ---------------------------------------------------------------------------
// Whose answer wins
// ---------------------------------------------------------------------------

const ME = "11111111-1111-4111-8111-000000000001";
const SOMEBODY_ELSE = "11111111-1111-4111-8111-000000000002";
const CHAT_A = "22222222-2222-4222-8222-00000000000a";
const CHAT_B = "22222222-2222-4222-8222-00000000000b";

test("a cache is shown while nothing better has arrived", () => {
  const cached = { userId: ME, prefs: { [CHAT_A]: pref(false, null) } };
  const state = applyCachedMutes(EMPTY_CHAT_MUTES, cached, ME);
  assert.equal(state.source, "cache");
  assert.deepEqual(mutedChatIdsAt(state, NOW), [CHAT_A]);
});

test("THE CONTRACT: a cache never wins over an answer that came back", () => {
  // The whole defect, stated once. The cache read is synchronous and the network
  // read is not, so nothing about the order these arrive in is guaranteed — and
  // a cache applied after the account answered would put back a mute the person
  // had just lifted on their phone.
  const server = applyServerMutes(EMPTY_CHAT_MUTES, ME, []);
  assert.equal(server.source, "server");
  assert.deepEqual(mutedChatIdsAt(server, NOW), []);

  const afterCache = applyCachedMutes(server, { userId: ME, prefs: { [CHAT_A]: pref(false, null) } }, ME);
  assert.equal(afterCache.source, "server", "a cache overwrote the account's own answer");
  assert.deepEqual(mutedChatIdsAt(afterCache, NOW), [], "a mute the account does not hold came back from storage");
});

test("THE CONTRACT: a cache written by another account is never shown", () => {
  // Two people, one browser. Showing one of them the other's silenced chats is
  // the same class of defect as showing them the wrong chats.
  const state = applyCachedMutes(EMPTY_CHAT_MUTES, { userId: SOMEBODY_ELSE, prefs: { [CHAT_A]: pref(false, null) } }, ME);
  assert.equal(state.source, "none");
  assert.deepEqual(mutedChatIdsAt(state, NOW), []);
});

test("signing out empties the list, and signing in as somebody else resets it", () => {
  const mine = applyServerMutes(EMPTY_CHAT_MUTES, ME, [{ chat_id: CHAT_A, push_enabled: false, muted_until: null }]);
  assert.deepEqual(mutedChatIdsAt(mine, NOW), [CHAT_A]);

  const signedOut = chatMutesForUser(mine, null);
  assert.equal(signedOut.userId, null);
  assert.deepEqual(mutedChatIdsAt(signedOut, NOW), []);

  const theirs = chatMutesForUser(mine, SOMEBODY_ELSE);
  assert.equal(theirs.userId, SOMEBODY_ELSE);
  assert.equal(theirs.source, "none");
  assert.deepEqual(mutedChatIdsAt(theirs, NOW), [], "the previous account's mutes survived the change of person");

  // The same person is the same snapshot, by identity — a reset per render
  // would re-ask the server on every mount.
  assert.equal(chatMutesForUser(mine, ME), mine);
});

test("the account's answer replaces, it does not merge", () => {
  const before = applyServerMutes(EMPTY_CHAT_MUTES, ME, [
    { chat_id: CHAT_A, push_enabled: false, muted_until: null },
    { chat_id: CHAT_B, push_enabled: false, muted_until: null },
  ]);
  assert.deepEqual(mutedChatIdsAt(before, NOW), [CHAT_A, CHAT_B].sort());

  // The mute on A was lifted somewhere else. A merge would keep it.
  const after = applyServerMutes(before, ME, [{ chat_id: CHAT_B, push_enabled: false, muted_until: null }]);
  assert.deepEqual(mutedChatIdsAt(after, NOW), [CHAT_B]);
});

test("a row with no chat id is not a row", () => {
  const state = applyServerMutes(EMPTY_CHAT_MUTES, ME, [{ chat_id: null, push_enabled: false, muted_until: null }]);
  assert.deepEqual(Object.keys(state.prefs), []);
  assert.deepEqual(mutedChatIdsAt(applyServerMutes(EMPTY_CHAT_MUTES, ME, null), NOW), []);
  assert.equal(applyServerMutes(EMPTY_CHAT_MUTES, null, []), EMPTY_CHAT_MUTES);
});

test("an optimistic write can be taken back exactly", () => {
  const base = applyServerMutes(EMPTY_CHAT_MUTES, ME, [{ chat_id: CHAT_A, push_enabled: true, muted_until: new Date(at(2026, 9, 14, 21)).toISOString() }]);
  const before = chatMuteFor(base, CHAT_A);
  assert.ok(before);

  const optimistic = applyLocalMute(base, ME, CHAT_A, { pushEnabled: false, mutedUntil: null });
  assert.deepEqual(chatMuteState(chatMuteFor(optimistic, CHAT_A), NOW), { muted: true, until: null });
  assert.equal(optimistic.source, "server", "writing a row locally passed itself off as the account's answer");

  // The refusal path: the row that was there goes back, not «no row».
  const rolledBack = applyLocalMute(optimistic, ME, CHAT_A, before);
  assert.deepEqual(chatMuteFor(rolledBack, CHAT_A), before);

  // And where there was no row at all, taking it back removes it.
  const invented = applyLocalMute(base, ME, CHAT_B, { pushEnabled: false, mutedUntil: null });
  assert.equal(chatMuteFor(applyLocalMute(invented, ME, CHAT_B, null), CHAT_B), null);

  // A write for somebody who is not the person on screen changes nothing.
  assert.equal(applyLocalMute(base, SOMEBODY_ELSE, CHAT_A, null), base);
  assert.equal(applyLocalMute(base, null, CHAT_A, null), base);
});

test("the ids are sorted and hold only what is silent at that instant", () => {
  const state = applyServerMutes(EMPTY_CHAT_MUTES, ME, [
    { chat_id: CHAT_B, push_enabled: false, muted_until: null },
    { chat_id: CHAT_A, push_enabled: true, muted_until: new Date(at(2026, 9, 14, 19)).toISOString() },
  ]);
  assert.deepEqual(mutedChatIdsAt(state, NOW), [CHAT_B], "an end already past was still counted as a mute");
  // Before that end, both.
  assert.deepEqual(mutedChatIdsAt(state, at(2026, 9, 14, 18)), [CHAT_A, CHAT_B].sort());
});

test("a failed read keeps what is on screen and says so", () => {
  const cached = applyCachedMutes(EMPTY_CHAT_MUTES, { userId: ME, prefs: { [CHAT_A]: pref(false, null) } }, ME);
  const failed = applyMutesError(cached, ME, mutesReadFailureText());
  assert.deepEqual(mutedChatIdsAt(failed, NOW), [CHAT_A]);
  assert.equal(failed.source, "cache", "a failed read promoted the cache to the account's own answer");
  assert.ok(failed.error);
});

// ---------------------------------------------------------------------------
// The cache on disk
// ---------------------------------------------------------------------------

test("the cache key is a new one, and the old account-less key is not it", () => {
  assert.equal(CHAT_MUTE_CACHE_KEY, "kub_chat_mutes");
  assert.notEqual(CHAT_MUTE_CACHE_KEY, "ng_muted");
});

test("anything unreadable is no cache at all", () => {
  assert.equal(readCachedMutes(null), null);
  assert.equal(readCachedMutes(""), null);
  assert.equal(readCachedMutes("{"), null);
  assert.equal(readCachedMutes("[]"), null);
  // The shape `ng_muted` held: a bare array of ids with nobody's name on it.
  assert.equal(readCachedMutes(JSON.stringify([CHAT_A])), null);
  assert.equal(readCachedMutes(JSON.stringify({ prefs: {} })), null, "a cache with no account was accepted");
  assert.equal(readCachedMutes(JSON.stringify({ userId: ME })), null);
});

test("what is written is what comes back", () => {
  const state = applyServerMutes(EMPTY_CHAT_MUTES, ME, [
    { chat_id: CHAT_A, push_enabled: false, muted_until: null },
    { chat_id: CHAT_B, push_enabled: true, muted_until: new Date(at(2026, 9, 14, 21)).toISOString() },
  ]);
  const serialized = serializeCachedMutes(state);
  assert.ok(serialized);
  const read = readCachedMutes(serialized);
  assert.ok(read);
  assert.equal(read.userId, ME);
  assert.deepEqual(read.prefs, state.prefs);
  assert.equal(serializeCachedMutes(EMPTY_CHAT_MUTES), null, "a cache was written under nobody's name");
});

// ---------------------------------------------------------------------------
// What a failure is allowed to say
// ---------------------------------------------------------------------------

test("a refused write is one plain sentence, never the database's own", () => {
  assert.match(muteRefusalText(true), /^Не удалось отключить уведомления/);
  assert.match(muteRefusalText(false), /^Не удалось включить уведомления/);

  // What actually reaches this function is `mapPgError`'s answer, and that is
  // the shape the two branches are measured on.
  //
  // A message a person can act on is worth more than either sentence here and
  // survives untouched.
  assert.equal(muteRefusalText(true, "Недостаточно прав для этого действия."), "Недостаточно прав для этого действия.");
  assert.equal(mutesReadFailureText("Нет соединения с сервером."), "Нет соединения с сервером.");

  // The mapper's own «Не удалось выполнить операцию» says «операцию» where this
  // surface knows which operation it was, so it is replaced.
  assert.equal(muteRefusalText(true, MAPPER_GENERIC_FAILURE), muteRefusalText(true));

  // And a sentence explaining the machine is refused. `mapPgError` passes any
  // Cyrillic message straight through, so a Postgres RAISE in Russian naming a
  // table really can arrive here.
  assert.equal(
    muteRefusalText(true, "Ошибка в таблице настроек."),
    muteRefusalText(true),
    "a sentence naming a database object reached the screen",
  );
  assert.equal(muteRefusalText(false, "Нет такой функции."), muteRefusalText(false));
});

test("nothing this module says explains the machine", () => {
  for (const message of CHAT_MUTE_MESSAGES) {
    assert.doesNotMatch(message, INTERNALS_PATTERN, `«${message}» names an internal`);
    assert.ok(message.trim().length > 0);
  }
  // Every sentence a failure can be is in that list, so the check above reaches
  // them; a new one added without listing it is the gap this guards.
  assert.ok(CHAT_MUTE_MESSAGES.includes(muteRefusalText(true)));
  assert.ok(CHAT_MUTE_MESSAGES.includes(muteRefusalText(false)));
  assert.ok(CHAT_MUTE_MESSAGES.includes(mutesReadFailureText()));
});
