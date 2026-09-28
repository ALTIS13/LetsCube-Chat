import assert from "node:assert/strict";
import test from "node:test";

import {
  nextPinnedIndex,
  nextToggleSpeed,
  pinnedLine,
  pinnedTitle,
  playerMoment,
  speedLabel,
} from "../../artifacts/kub/src/lib/chatTopCard.ts";

// Tracker item 70: the top of a conversation is Telegram's two rows, and these
// are the decisions those rows make.

test("a tap on the speed walks Telegram's stops: 1, 1.5, 2 and back to 1", () => {
  assert.equal(nextToggleSpeed(1), 1.5);
  assert.equal(nextToggleSpeed(1.5), 2);
  assert.equal(nextToggleSpeed(2), 1);
  // 0.5 is on the long-press list only. From it the next stop above is 1;
  // Telegram's own arithmetic would send it to 1.5.
  assert.equal(nextToggleSpeed(0.5), 1);
  // Nothing a stored value can hold leaves the cycle.
  assert.equal(nextToggleSpeed(Number.NaN), 1.5);
  assert.equal(nextToggleSpeed(3), 1);
});

test("the chip reads the speed the way Telegram's does", () => {
  assert.equal(speedLabel(1), "1X");
  assert.equal(speedLabel(1.5), "1.5X");
  assert.equal(speedLabel(0.5), "0.5X");
  assert.equal(speedLabel(2), "2X");
  assert.equal(speedLabel(Number.NaN), "1X");
});

test("the player writes when the message was sent as Telegram's formatDateAudio does", () => {
  const now = new Date(2026, 8, 28, 19, 20);
  assert.equal(playerMoment(new Date(2026, 8, 28, 18, 20).toISOString(), now), "в 18:20");
  assert.equal(playerMoment(new Date(2026, 8, 27, 9, 5).toISOString(), now), "вчера в 09:05");
  // The owner's screenshot: «Никита Фермер 06 сент. в 18:20».
  assert.equal(playerMoment(new Date(2026, 8, 6, 18, 20).toISOString(), now), "06 сент. в 18:20");
  // Calendar days: 23:50 is yesterday ten minutes after midnight.
  assert.equal(playerMoment(new Date(2026, 8, 27, 23, 50).toISOString(), new Date(2026, 8, 28, 0, 10)), "вчера в 23:50");
  // Older than a year, the date carries the year.
  assert.equal(playerMoment(new Date(2025, 8, 6, 18, 20).toISOString(), now), "06.09.25 в 18:20");
  assert.equal(playerMoment(null, now), null);
  assert.equal(playerMoment("not a date", now), null);
});

test("the pinned title numbers a pin only once the bar has left the newest, counting from the oldest", () => {
  assert.equal(pinnedTitle(0, 1), "Закреплённое сообщение");
  assert.equal(pinnedTitle(0, 4), "Закреплённое сообщение");
  assert.equal(pinnedTitle(1, 4), "Закреплённое сообщение #3");
  assert.equal(pinnedTitle(3, 4), "Закреплённое сообщение #1");
});

test("a tap on the bar moves it to the next older pin, and from the oldest back to the newest", () => {
  assert.equal(nextPinnedIndex(0, 4), 1);
  assert.equal(nextPinnedIndex(3, 4), 0);
  assert.equal(nextPinnedIndex(0, 1), 0);
});

test("the line lights the pin shown, the newest at the foot, and scrolls past three", () => {
  // One pin: one segment, lit.
  assert.deepEqual(pinnedLine(0, 1), { total: 1, visible: 1, position: 0, offset: 0 });
  // Three: the newest is the lowest, and nothing scrolls.
  assert.deepEqual(pinnedLine(0, 3), { total: 3, visible: 3, position: 2, offset: 0 });
  assert.deepEqual(pinnedLine(2, 3), { total: 3, visible: 3, position: 0, offset: 0 });
  // Six: the newest sits at the foot of the last three, and the lit segment
  // is kept second from the top while there is room above it.
  assert.deepEqual(pinnedLine(0, 6), { total: 6, visible: 3, position: 5, offset: 3 });
  assert.deepEqual(pinnedLine(3, 6), { total: 6, visible: 3, position: 2, offset: 1 });
  assert.deepEqual(pinnedLine(5, 6), { total: 6, visible: 3, position: 0, offset: 0 });
});
