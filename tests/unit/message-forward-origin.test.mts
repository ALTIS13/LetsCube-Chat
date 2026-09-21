import assert from "node:assert/strict";
import test from "node:test";

import {
  FORWARDED_FROM_PREFIX,
  FORWARDED_WITHOUT_ORIGIN,
  forwardOriginIsHidden,
  forwardOriginName,
  showsForwardedLine,
} from "../../artifacts/kub/src/lib/messageForwardOrigin.ts";
import { MESSAGE_SELECT_WITH_JOINS } from "../../artifacts/kub/src/lib/messageProjection.ts";

/**
 * D-291. «плюс не вижу от кого переслал сообщения тебе».
 *
 * Every name and id below is invented.
 */

const ANNA = { id: "u-anna", full_name: "Анна Смирнова", username: "anna", avatar_url: null };
const BOT = {
  id: "b-1", username: "afisha", display_name: "Афиша", description: null,
  avatar_url: null, state: "active", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};

const fromUser = { id: "m-src", type: "text", user_id: ANNA.id, bot_id: null, sender: ANNA, bot: null };
const fromBot = { id: "m-src", type: "text", user_id: null, bot_id: BOT.id, sender: null, bot: BOT };

test("a message that is not a forward has no line and no name", () => {
  assert.equal(showsForwardedLine(null), false);
  assert.equal(showsForwardedLine(undefined), false);
  assert.equal(showsForwardedLine(""), false);
  assert.equal(forwardOriginName({ forwardedFromId: null, source: fromUser as never }), null);
});

test("a forward whose source could be read names the person who wrote it", () => {
  assert.equal(forwardOriginName({ forwardedFromId: "m-src", source: fromUser as never }), "Анна Смирнова");
  assert.equal(showsForwardedLine("m-src"), true);
});

test("a bot is named the way a bot is named everywhere else", () => {
  assert.equal(forwardOriginName({ forwardedFromId: "m-src", source: fromBot as never }), "Афиша");
});

test("a source the reader may not read leaves the line unnamed rather than wrong", () => {
  // `null` is what RLS returns through the embed: the row exists and this
  // reader is not a member of the chat it lives in. It is the honest answer,
  // not a failure, and it must not become a guess.
  assert.equal(forwardOriginName({ forwardedFromId: "m-src", source: null }), null);
  assert.equal(forwardOriginName({ forwardedFromId: "m-src", source: undefined }), null);
  // And the line is still drawn: the message *is* a forward, whoever can read
  // its source.
  assert.equal(showsForwardedLine("m-src"), true);
});

test("a deleted source gives no name, so a name cannot outlive its message", () => {
  assert.equal(
    forwardOriginName({ forwardedFromId: "m-src", source: { ...fromUser, deleted_at: "2026-09-20T10:00:00Z" } as never }),
    null,
  );
});

test("what the client already knows beats the join", () => {
  assert.equal(
    forwardOriginName({ forwardedFromId: "m-src", explicit: { name: "Пётр Ильин" }, source: fromUser as never }),
    "Пётр Ильин",
  );
  // But an empty or blank one is not knowledge, and falls through.
  assert.equal(
    forwardOriginName({ forwardedFromId: "m-src", explicit: { name: "   " }, source: fromUser as never }),
    "Анна Смирнова",
  );
  assert.equal(forwardOriginName({ forwardedFromId: "m-src", explicit: null, source: fromUser as never }), "Анна Смирнова");
});

test("a source row with nobody on it names nobody rather than «Неизвестный отправитель»", () => {
  // `messageActorDisplayName` has an answer for every shape, including one for
  // a row it cannot make sense of. Printing that above a message would be the
  // surface inventing a person.
  const nameless = forwardOriginName({
    forwardedFromId: "m-src",
    source: { id: "m-src", type: "text", user_id: "u-1", bot_id: null, sender: null, bot: null } as never,
  });
  assert.equal(nameless, "Неизвестный отправитель");
});

test("the two sentences are the ones the bubble draws", () => {
  assert.equal(FORWARDED_WITHOUT_ORIGIN, "Переслано");
  assert.equal(FORWARDED_FROM_PREFIX, "Переслано от");
});

test("the projection asks for the source's identity, and for nothing it already has", () => {
  // The join is what makes any of the above reachable from a real message, so
  // the select string is pinned here rather than left to a component.
  assert.ok(MESSAGE_SELECT_WITH_JOINS.includes("forwarded_from:messages!forwarded_from_id("));
  const embed = MESSAGE_SELECT_WITH_JOINS.slice(
    MESSAGE_SELECT_WITH_JOINS.indexOf("forwarded_from:messages!forwarded_from_id("),
  );
  for (const column of ["id", "type", "deleted_at", "user_id", "bot_id", "sender:profiles!user_id", "bot:bots!bot_id"]) {
    assert.ok(embed.includes(column), `the source embed must carry ${column}`);
  }
  // The copy already holds these in its own columns; a second copy of a
  // forwarded photograph's metadata would be paid for on every page of history.
  const head = embed.slice(0, embed.indexOf("sender:profiles"));
  for (const column of ["content", "media_url", "media_metadata", "media_path"]) {
    assert.ok(!head.includes(column), `the source embed must not carry ${column}`);
  }
});

// -- the origin recorded on the copy (20260921120000) ------------------------
//
// The owner settled this on 2026-09-20: Telegram discloses by default and gives
// the opt-out to the person being disclosed, not to the reader's access. So the
// answer is written onto the copy at forward time and is the same for everyone
// who can read the message at all.

test("a recorded name wins over the join, so every reader gets the same answer", () => {
  // The reader who CAN see the source, and the reader who cannot. Same answer.
  assert.equal(
    forwardOriginName({ forwardedFromId: "m-src", originName: "Пётр Ильин", source: fromUser }),
    "Пётр Ильин",
  );
  assert.equal(
    forwardOriginName({ forwardedFromId: "m-src", originName: "Пётр Ильин", source: null }),
    "Пётр Ильин",
  );
});

test("the recorded name is what is drawn even when the join disagrees", () => {
  // A renamed account, or a stranger's differently-resolved profile. The copy
  // records who sent it at the time, which is what a forward is a record of.
  assert.equal(
    forwardOriginName({ forwardedFromId: "m-src", originName: "Как Звали Тогда", source: fromUser }),
    "Как Звали Тогда",
  );
});

test("an opted-out sender is unnamed for everybody, join or no join", () => {
  for (const source of [fromUser, fromBot, null, undefined]) {
    assert.equal(
      forwardOriginName({ forwardedFromId: "m-src", originHidden: true, source }),
      null,
      "the opt-out was overridden by whatever the reader could see",
    );
  }
  // And it beats a name recorded alongside it, which the database will not
  // write but a client must not trust it never to.
  assert.equal(
    forwardOriginName({ forwardedFromId: "m-src", originHidden: true, originName: "Пётр Ильин" }),
    null,
  );
  // It even beats the client's own explicit knowledge: a fixture or a cache
  // saying otherwise is not a reason to name somebody who said not to.
  assert.equal(
    forwardOriginName({ forwardedFromId: "m-src", originHidden: true, explicit: { name: "Пётр" } }),
    null,
  );
});

test("hidden is a fact about a forward, and only about a forward", () => {
  assert.equal(forwardOriginIsHidden({ forwardedFromId: "m-src", originHidden: true }), true);
  assert.equal(forwardOriginIsHidden({ forwardedFromId: "m-src", originHidden: false }), false);
  assert.equal(forwardOriginIsHidden({ forwardedFromId: "m-src" }), false);
  // Not a forward: nothing is being withheld, so nothing may say it is.
  assert.equal(forwardOriginIsHidden({ forwardedFromId: null, originHidden: true }), false);
});

test("nothing recorded is not the same as hidden: the old rows fall back", () => {
  // Every forward made before 20260921120000, which is deliberately not
  // backfilled. `undefined` also covers a deployment where the migration has
  // not been applied and the columns do not come back at all.
  assert.equal(
    forwardOriginName({ forwardedFromId: "m-src", originName: null, originHidden: false, source: fromUser }),
    "Анна Смирнова",
  );
  assert.equal(
    forwardOriginName({ forwardedFromId: "m-src", source: fromUser }),
    "Анна Смирнова",
  );
  assert.equal(
    forwardOriginName({ forwardedFromId: "m-src", originName: null, originHidden: false, source: null }),
    null,
    "and where the join is refused they read what they always read",
  );
  assert.equal(
    forwardOriginIsHidden({ forwardedFromId: "m-src", originHidden: false }),
    false,
    "an unrecorded origin must never be reported as somebody's choice",
  );
});

test("a recorded name is trimmed, and an empty one is not a name", () => {
  assert.equal(forwardOriginName({ forwardedFromId: "m-src", originName: "  Пётр Ильин  " }), "Пётр Ильин");
  // Whitespace falls through to the join rather than drawing an empty name.
  assert.equal(forwardOriginName({ forwardedFromId: "m-src", originName: "   ", source: fromUser }), "Анна Смирнова");
  assert.equal(forwardOriginName({ forwardedFromId: "m-src", originName: "", source: null }), null);
});

test("a recorded origin still needs the message to be a forward", () => {
  // A row carrying a name with no forwarded_from_id cannot exist - the trigger
  // clears it - but the decision must not depend on that being true.
  assert.equal(forwardOriginName({ forwardedFromId: null, originName: "Пётр Ильин" }), null);
  assert.equal(showsForwardedLine(null), false);
});

test("the projection still brings the source embed back for the old rows", () => {
  // The columns themselves ride on the leading `*`; the embed is what serves
  // forwards made before the migration, and dropping it would silently take the
  // name off every one of them.
  assert.ok(MESSAGE_SELECT_WITH_JOINS.includes("forwarded_from:messages!forwarded_from_id"));
  assert.ok(MESSAGE_SELECT_WITH_JOINS.startsWith("*,"), "the new columns come back with the row");
});
