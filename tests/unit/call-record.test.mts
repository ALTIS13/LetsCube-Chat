import assert from "node:assert/strict";
import test from "node:test";

import {
  CALL_BACK_BUSY_TEXT,
  CALL_RECORD_KIND,
  callBackBlockedByCall,
  callBackPerson,
  callDirection,
  callDurationShort,
  callDurationSpoken,
  callRecordPreview,
  callRecordView,
  callWasMissed,
  readCallRecord,
  type CallOutcome,
} from "../../artifacts/kub/src/lib/callRecord.ts";

/**
 * The record a one-to-one call leaves, and the two people who read one row.
 *
 * Slice B of `docs/proposals/2026-09-18-one-to-one-calls.md`. The database half
 * is applied and verified on production; what these assertions defend is the
 * client's side of the same contract — that an untrusted payload degrades to
 * the sentence the database already wrote, that no wording comes from the row,
 * and that the length agrees with `voice_call_record_line` character for
 * character where it is shown and inflects properly where it is spoken.
 */

const ME = "11111111-1111-4111-8111-000000000001";
const ANNA = "11111111-1111-4111-8111-000000000002";
const PETR = "11111111-1111-4111-8111-000000000003";

const ALL_OUTCOMES: readonly CallOutcome[] = ["answered", "missed", "cancelled", "declined"];

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: "call", outcome: "answered", caller: ANNA, duration_ms: 192_000, ...over };
}

// ---------------------------------------------------------------------------
// Reading a payload that nothing guarantees
// ---------------------------------------------------------------------------

test("the payload the database writes is read as a call record", () => {
  assert.deepEqual(readCallRecord(payload()), {
    outcome: "answered",
    caller: ANNA,
    durationMs: 192_000,
  });
  assert.equal(CALL_RECORD_KIND, "call");
});

test("every outcome the database can derive is one this client knows", () => {
  // The four `voice_call_stop` writes, and nothing else. A fifth arriving from
  // a newer deployment is not a call record here, which is the degradation
  // path rather than a crash.
  for (const outcome of ALL_OUTCOMES) {
    assert.equal(readCallRecord(payload({ outcome, duration_ms: null }))?.outcome, outcome);
  }
  assert.equal(readCallRecord(payload({ outcome: "ringing" })), null);
  assert.equal(readCallRecord(payload({ outcome: "ANSWERED" })), null);
  assert.equal(readCallRecord(payload({ outcome: 1 })), null);
});

test("a system row that is not a call is not a call record, and that is the common case", () => {
  // The group-call line of D-229 is the first of these and must keep rendering
  // exactly as it does: it carries no payload at all.
  assert.equal(readCallRecord(null), null);
  assert.equal(readCallRecord(undefined), null);
  // A future `kind`, from a deployment newer than this bundle.
  assert.equal(readCallRecord(payload({ kind: "poll" })), null);
  assert.equal(readCallRecord({ outcome: "missed", caller: ANNA }), null);
});

test("a payload of the wrong shape entirely throws nothing and answers null", () => {
  for (const wrong of [
    "call",
    42,
    true,
    [],
    [payload()],
    { kind: ["call"] },
    Object.create(null) as Record<string, unknown>,
  ]) {
    assert.equal(readCallRecord(wrong), null, `${JSON.stringify(wrong)} was read as a call`);
  }
});

test("a record without an identity is not a record, because direction is the point", () => {
  // `caller` is what «you called / they called» is decided from, and there is
  // no neutral card to fall back to — `content` is the fallback, and it is
  // already a correct sentence.
  assert.equal(readCallRecord(payload({ caller: null })), null);
  assert.equal(readCallRecord(payload({ caller: "" })), null);
  assert.equal(readCallRecord(payload({ caller: "   " })), null);
  assert.equal(readCallRecord(payload({ caller: 12 })), null);
  // A stray space is still that person.
  assert.equal(readCallRecord(payload({ caller: ` ${ANNA} ` }))?.caller, ANNA);
});

test("a broken duration loses the number, never the record", () => {
  // The identity is `kind`, `outcome` and `caller`; the length is a detail.
  // Dropping the direction to save a number would be the worse trade, and an
  // answered call with no length is a state the database itself produces.
  for (const wrong of ["192000", Number.NaN, Number.POSITIVE_INFINITY, -1, null, undefined, {}]) {
    const record = readCallRecord(payload({ duration_ms: wrong }));
    assert.equal(record?.outcome, "answered", `${String(wrong)} lost the record`);
    assert.equal(record?.durationMs, null, `${String(wrong)} kept a length`);
  }
  assert.equal(readCallRecord(payload({ duration_ms: 1500.9 }))?.durationMs, 1500);
});

test("only an answered call carries a length, whatever the payload says", () => {
  // Re-applied rather than trusted: a payload with a duration beside «missed»
  // must not put «3 мин 12 с» under the words «Пропущенный звонок».
  for (const outcome of ALL_OUTCOMES) {
    const record = readCallRecord(payload({ outcome, duration_ms: 192_000 }));
    assert.equal(record?.durationMs, outcome === "answered" ? 192_000 : null, outcome);
  }
});

// ---------------------------------------------------------------------------
// One row, two readers
// ---------------------------------------------------------------------------

test("direction comes from comparing the caller with the reader, never from the row", () => {
  const record = readCallRecord(payload({ caller: ANNA }));
  assert.ok(record);
  assert.equal(callDirection(record, ANNA), "outgoing");
  assert.equal(callDirection(record, ME), "incoming");
  // A third person reading the same row is not the caller, so it is incoming
  // for them too. A private chat has no third person; the rule has no special
  // case for one, and asserting that is cheaper than arguing about it.
  assert.equal(callDirection(record, PETR), "incoming");
});

test("a reader this client cannot name takes the fallback, not a guess", () => {
  const record = readCallRecord(payload());
  assert.ok(record);
  assert.equal(callDirection(record, null), null);
  assert.equal(callDirection(record, undefined), null);
  assert.equal(callDirection(record, "  "), null);
  // And that reaches the view, which is what makes it `content` on screen.
  assert.equal(callRecordView(payload(), null), null);
});

test("the same row says two different things to the two people in it", () => {
  const row = payload({ outcome: "missed", caller: ANNA, duration_ms: null });
  assert.equal(callRecordView(row, ANNA)?.headline, "Звонок без ответа");
  assert.equal(callRecordView(row, ME)?.headline, "Пропущенный звонок");
});

test("the eight sentences, and not one of them is `content`", () => {
  const seen = new Set<string>();
  const table: Record<CallOutcome, { outgoing: string; incoming: string }> = {
    answered: { outgoing: "Исходящий звонок", incoming: "Входящий звонок" },
    missed: { outgoing: "Звонок без ответа", incoming: "Пропущенный звонок" },
    cancelled: { outgoing: "Отменённый звонок", incoming: "Пропущенный звонок" },
    declined: { outgoing: "Звонок отклонён", incoming: "Вы отклонили звонок" },
  };
  for (const outcome of ALL_OUTCOMES) {
    const mine = callRecordView(payload({ outcome, caller: ME, duration_ms: null }), ME);
    const theirs = callRecordView(payload({ outcome, caller: ANNA, duration_ms: null }), ME);
    assert.equal(mine?.headline, table[outcome].outgoing, `${outcome} outgoing`);
    assert.equal(theirs?.headline, table[outcome].incoming, `${outcome} incoming`);
    assert.equal(mine?.direction, "outgoing");
    assert.equal(theirs?.direction, "incoming");
    seen.add(mine?.headline ?? "");
    seen.add(theirs?.headline ?? "");
  }
  // Seven, not eight: «Пропущенный звонок» is deliberately both of the callee's
  // unanswered cases. The caller hanging up and the ring running out are two
  // facts about the caller and one fact about the person who was called.
  assert.equal(seen.size, 7);
});

test("red means «you missed this», and it agrees with the words by construction", () => {
  for (const outcome of ALL_OUTCOMES) {
    for (const direction of ["outgoing", "incoming"] as const) {
      const caller = direction === "outgoing" ? ME : ANNA;
      const view = callRecordView(payload({ outcome, caller, duration_ms: null }), ME);
      assert.ok(view);
      // The colour and the wording are not two lists kept in step by hand: the
      // cells that are red are exactly the cells that say «Пропущенный звонок».
      assert.equal(
        view.missed,
        view.headline === "Пропущенный звонок",
        `${outcome}/${direction} disagrees with its own wording`,
      );
      assert.equal(view.missed, callWasMissed(outcome, direction));
    }
  }
  // Said plainly, because the rule is short enough to state: a call you
  // declined is not a call you missed, and one you cancelled yourself is not a
  // failure of any kind.
  assert.equal(callWasMissed("declined", "incoming"), false);
  assert.equal(callWasMissed("cancelled", "outgoing"), false);
  assert.equal(callWasMissed("missed", "outgoing"), false);
  assert.equal(callWasMissed("cancelled", "incoming"), true);
  assert.equal(callWasMissed("missed", "incoming"), true);
});

test("direction is the arrow, the outcome is the colour", () => {
  assert.equal(callRecordView(payload({ caller: ME }), ME)?.icon, "phoneOutgoing");
  assert.equal(callRecordView(payload({ caller: ANNA }), ME)?.icon, "phoneIncoming");
  // A missed call is still an incoming arrow; nothing about the outcome moves
  // the glyph, which is what keeps the vocabulary at two.
  assert.equal(
    callRecordView(payload({ outcome: "missed", caller: ANNA, duration_ms: null }), ME)?.icon,
    "phoneIncoming",
  );
});

// ---------------------------------------------------------------------------
// How long it lasted
// ---------------------------------------------------------------------------

test("the shown length is `voice_call_record_line`'s, character for character", () => {
  // These are the migration's own self-check values, lifted from it so a drift
  // between the card and the sentence beneath it is a failure here rather than
  // a discovery on somebody's screen.
  assert.equal(callDurationShort(0), null); // «Звонок»
  assert.equal(callDurationShort(999), null); // «Звонок»
  assert.equal(callDurationShort(1_000), "1 с"); // «Звонок, 1 с»
  assert.equal(callDurationShort(59_000), "59 с"); // «Звонок, 59 с»
  assert.equal(callDurationShort(60_000), "1 мин 0 с"); // «Звонок, 1 мин 0 с»
  assert.equal(callDurationShort(192_000), "3 мин 12 с"); // «Звонок, 3 мин 12 с»
  assert.equal(callDurationShort(null), null);
});

test("an hour reads in hours, and drops what it stops needing", () => {
  // `20260918270000_a_call_over_an_hour_says_hours` gave `voice_call_record_line`
  // the arm it lacked — an hour used to read «Звонок, 60 мин 0 с» — and the two
  // are changed together, always: a card and the `content` under it are read
  // side by side, and one call showing two different lengths is worse than
  // either wording. The values below are the database's, verified against it.
  assert.equal(callDurationShort(3_600_000), "1 ч");
  assert.equal(callDurationShort(3_660_000), "1 ч 1 мин");
  // Seconds are dropped once hours appear: 3 719 000 is 1h 1m 59s.
  assert.equal(callDurationShort(3_719_000), "1 ч 1 мин");
  assert.equal(callDurationShort(7_392_000), "2 ч 3 мин");
  // And the boundary underneath is untouched.
  assert.equal(callDurationShort(3_599_000), "59 мин 59 с");
});

test("the spoken hour follows the short one, and agrees in Russian", () => {
  assert.equal(callDurationSpoken(3_600_000), "1 час");
  assert.equal(callDurationSpoken(3_660_000), "1 час 1 минута");
  assert.equal(callDurationSpoken(7_392_000), "2 часа 3 минуты");
  assert.equal(callDurationSpoken(5 * 3_600_000), "5 часов");
  // The 11-14 trap, on the third agreement this module now carries.
  assert.equal(callDurationSpoken(11 * 3_600_000), "11 часов");
  assert.equal(callDurationSpoken(21 * 3_600_000), "21 час");
});

test("the spoken length agrees in Russian, and 11 to 14 are the trap", () => {
  assert.equal(callDurationSpoken(1_000), "1 секунда");
  assert.equal(callDurationSpoken(2_000), "2 секунды");
  assert.equal(callDurationSpoken(5_000), "5 секунд");
  // The trap: the last digit says «одна/две/три/четыре» and the language says
  // otherwise. This is the exact mistake `voicePresence.ts` records having made.
  assert.equal(callDurationSpoken(11_000), "11 секунд");
  assert.equal(callDurationSpoken(12_000), "12 секунд");
  assert.equal(callDurationSpoken(13_000), "13 секунд");
  assert.equal(callDurationSpoken(14_000), "14 секунд");
  assert.equal(callDurationSpoken(21_000), "21 секунда");
  assert.equal(callDurationSpoken(22_000), "22 секунды");
  assert.equal(callDurationSpoken(192_000), "3 минуты 12 секунд");
  assert.equal(callDurationSpoken(60_000), "1 минута");
  assert.equal(callDurationSpoken(11 * 60_000 + 1_000), "11 минут 1 секунда");
  assert.equal(callDurationSpoken(12 * 60_000), "12 минут");
  assert.equal(callDurationSpoken(21 * 60_000), "21 минута");
  assert.equal(callDurationSpoken(null), null);
  assert.equal(callDurationSpoken(999), null);
});

test("every length from one second to two hours inflects, walked against an independent oracle", () => {
  // `tests/unit/voice-presence.test.mjs` walks 1 to 125 for the same reason:
  // a branch order that looks right for 1, 5 and 11 is wrong for every 2, 3
  // and 4 in the language, and only a walk finds that.
  //
  // The oracle is `Intl.PluralRules`, which the module deliberately does not
  // use — so this is CLDR's answer checked against a hand-written rule rather
  // than a rule checked against a copy of itself. Restating the arithmetic here
  // would pass just as happily with the same mistake in both places.
  const cldr = new Intl.PluralRules("ru");
  const forms = {
    час: { one: "час", few: "часа", many: "часов" },
    минута: { one: "минута", few: "минуты", many: "минут" },
    секунда: { one: "секунда", few: "секунды", many: "секунд" },
  };
  for (let seconds = 1; seconds <= 7_200; seconds += 1) {
    const spoken = callDurationSpoken(seconds * 1_000);
    assert.ok(spoken, `${seconds} said nothing`);
    const words = spoken.split(" ");
    assert.ok(words.length === 2 || words.length === 4, `${seconds}s: "${spoken}" is not count-word pairs`);
    for (let at = 0; at < words.length; at += 2) {
      const count = Number(words[at]);
      const word = words[at + 1];
      assert.ok(Number.isInteger(count), `${seconds}s: "${spoken}" has no number at ${at}`);
      const stem = word.startsWith("час") ? "час" : word.startsWith("мин") ? "минута" : "секунда";
      const select = cldr.select(count) as "one" | "few" | "many" | "other";
      assert.equal(
        word,
        forms[stem][select === "other" ? "many" : select],
        `${seconds}s: "${count} ${word}" disagrees with CLDR (${select})`,
      );
    }
    // One pair or two, and which is a rule rather than a list. Under an hour:
    // under a minute and a round minute say one thing, everything else says
    // both halves. From an hour: hours, plus minutes when there are any —
    // seconds stop being said at all, so 3661s is «1 час 1 минута» and not
    // three pairs.
    const expected =
      seconds >= 3_600
        ? Math.floor((seconds % 3_600) / 60) === 0
          ? 2
          : 4
        : seconds < 60 || seconds % 60 === 0
          ? 2
          : 4;
    assert.equal(words.length, expected, `${seconds}s: "${spoken}"`);
  }
});

test("the spoken form is the accessible name, and it carries the length", () => {
  assert.equal(callRecordView(payload({ caller: ANNA }), ME)?.spoken, "Входящий звонок, 3 минуты 12 секунд");
  assert.equal(
    callRecordView(payload({ outcome: "missed", caller: ANNA, duration_ms: null }), ME)?.spoken,
    "Пропущенный звонок",
  );
  // A call under a second has a headline and no length, in both forms.
  const brief = callRecordView(payload({ caller: ME, duration_ms: 400 }), ME);
  assert.equal(brief?.duration, null);
  assert.equal(brief?.spoken, "Исходящий звонок");
});

// ---------------------------------------------------------------------------
// The chat list
// ---------------------------------------------------------------------------

test("the list says which call it was, and never how long", () => {
  assert.equal(callRecordPreview(payload({ caller: ANNA }), ME), "Входящий звонок");
  assert.equal(callRecordPreview(payload({ caller: ME }), ME), "Исходящий звонок");
  assert.equal(
    callRecordPreview(payload({ outcome: "missed", caller: ANNA, duration_ms: null }), ME),
    "Пропущенный звонок",
  );
});

test("a row the list cannot read as a call falls through to what it always printed", () => {
  // Null is the signal, and `formatChatMessagePreview` answers it with
  // `content` — which is how the group-call line of D-229 keeps its wording
  // through this entire slice.
  assert.equal(callRecordPreview(null, ME), null);
  assert.equal(callRecordPreview(payload({ kind: "voice_channel" }), ME), null);
  assert.equal(callRecordPreview(payload(), null), null);
});

// ---------------------------------------------------------------------------
// Calling back
// ---------------------------------------------------------------------------

function member(id: string, fullName: string | null = null, username: string | null = null) {
  return { user_id: id, profile: { full_name: fullName, username } };
}

test("a private conversation offers the person on the other end of it", () => {
  assert.deepEqual(
    callBackPerson({
      chatType: "private",
      selfId: ME,
      members: [member(ANNA, "Анна Смирнова"), member(ME, "Максим Орлов")],
    }),
    { id: ANNA, name: "Анна Смирнова" },
  );
});

test("the name is the one the chat list would use, and it is never blank", () => {
  // `useChats` reads `full_name ?? username`; this follows it rather than
  // inventing a second order.
  assert.equal(
    callBackPerson({ chatType: "private", selfId: ME, members: [member(ANNA, null, "anna"), member(ME)] })?.name,
    "anna",
  );
  // «Звонок» is the room's own name in the database, and what the call bar
  // would print with nothing better. A blank is never carried through.
  assert.equal(
    callBackPerson({ chatType: "private", selfId: ME, members: [member(ANNA, "  ", "  "), member(ME)] })?.name,
    "Звонок",
  );
  assert.equal(
    callBackPerson({ chatType: "private", selfId: ME, members: [{ user_id: ANNA }, member(ME)] })?.name,
    "Звонок",
  );
});

test("there is nobody to call back where there is no second person", () => {
  // «Избранное»: a private chat whose only member is the reader.
  assert.equal(callBackPerson({ chatType: "private", selfId: ME, members: [member(ME, "Максим Орлов")] }), null);
  // A bot conversation has no second `chat_members` row at all.
  assert.equal(callBackPerson({ chatType: "private", selfId: ME, members: [] }), null);
  // A group, where a one-to-one call does not exist.
  assert.equal(
    callBackPerson({ chatType: "group", selfId: ME, members: [member(ANNA, "Анна"), member(ME)] }),
    null,
  );
  assert.equal(callBackPerson({ chatType: null, selfId: ME, members: [member(ANNA), member(ME)] }), null);
  // A reader this client cannot name cannot be excluded from the list, so
  // there is no «other» to find.
  assert.equal(callBackPerson({ chatType: "private", selfId: null, members: [member(ANNA), member(ME)] }), null);
  assert.equal(callBackPerson({ chatType: "private", selfId: ME, members: null }), null);
});

test("a call already running is in the way, and a call that failed is not", () => {
  // The five phases, walked, because the interesting one is not the obvious
  // one: `useVoiceCall` publishes a failure as `{ ...IDLE, phase: "failed",
  // channelId }` — the room is kept so the interface can name the call that was
  // refused. A predicate of `channelId !== null` would therefore have made one
  // dismissed microphone prompt refuse every call back in the product until the
  // page was reloaded. That is what this walk is for.
  const ROOM = "33333333-3333-4333-8333-000000000001";
  assert.equal(callBackBlockedByCall({ channelId: ROOM, phase: "connected" }), true);
  assert.equal(callBackBlockedByCall({ channelId: ROOM, phase: "reconnecting" }), true);
  // `joining` counts: the microphone has been asked for or the token has, and a
  // second room joined underneath that is the same duplicate identity.
  assert.equal(callBackBlockedByCall({ channelId: ROOM, phase: "joining" }), true);
  assert.equal(callBackBlockedByCall({ channelId: ROOM, phase: "failed" }), false);
  assert.equal(callBackBlockedByCall({ channelId: ROOM, phase: "idle" }), false);
  // No room at all is no call, whatever the phase says.
  for (const phase of ["idle", "joining", "connected", "reconnecting", "failed"]) {
    assert.equal(callBackBlockedByCall({ channelId: null, phase }), false, phase);
  }
});

test("the busy refusal is a sentence, and it is the one the capsule already says", () => {
  // Not `voiceRingRefusalText`'s: `voice_call_ring` refuses a room with people
  // in it, which is a fact about this conversation and says nothing about a
  // call held somewhere else.
  assert.equal(CALL_BACK_BUSY_TEXT, "Вы в другом голосовом чате.");
  assert.ok(!/[0-9]{4,}|PGRST|row-level|policy/i.test(CALL_BACK_BUSY_TEXT));
});

test("a private chat with two other people in it calls nobody", () => {
  // The database cannot produce this. If it ever does, ringing whichever
  // member happened to be first is ringing a stranger.
  assert.equal(
    callBackPerson({
      chatType: "private",
      selfId: ME,
      members: [member(ANNA, "Анна"), member(PETR, "Пётр"), member(ME)],
    }),
    null,
  );
});
