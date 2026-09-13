// What the invitations block says, and what it offers.
//
// D-172. The block explained its own implementation: a sentence saying that
// statuses update without reloading the panel, beside a manual refresh button
// that contradicted it, over an empty state that named the filter rather than
// the world. The copy is data here so that «which states exist and what each
// one says to a person» can be argued about without a browser — and so that a
// state cannot be quietly dropped to make the wording tidier.

import assert from "node:assert/strict";
import test from "node:test";

import {
  inviteState,
  invitesEmptyText,
  invitesWaitingLine,
} from "../../artifacts/kub/src/lib/groupInviteCopy.ts";
import { GROUP_INVITES_MIGRATION_REQUIRED } from "../../artifacts/kub/src/lib/groupInvites.ts";

const inGroup = (status: Parameters<typeof inviteState>[0]["status"], isMember = false) =>
  inviteState({ status, isMember, type: "group" });

test("every state the block really has is still named", () => {
  assert.equal(inGroup("pending").label, "Ждёт ответа");
  assert.equal(inGroup("accepted", true).label, "В группе");
  assert.equal(inGroup("accepted", false).label, "Уже не в группе");
  assert.equal(inGroup("declined").label, "Отклонено");
  assert.equal(inGroup("cancelled").label, "Отменено");
  assert.equal(inGroup("expired").label, "Истекло");
});

test("a channel's invitations speak of a channel", () => {
  assert.equal(inviteState({ status: "accepted", isMember: true, type: "channel" }).label, "В канале");
  assert.equal(inviteState({ status: "accepted", isMember: false, type: "channel" }).label, "Уже не в канале");
  // The states that name nothing but the invitation are the same either way.
  assert.equal(inviteState({ status: "pending", isMember: false, type: "channel" }).label, "Ждёт ответа");
});

test("nothing on a chip guesses at the invitee's gender", () => {
  // «Отказался» and «Принял» agree with the person, so each was wrong for half
  // of them. These agree with the invitation, which has no gender.
  const labels = (["pending", "accepted", "declined", "cancelled", "expired"] as const)
    .flatMap((status) => [inGroup(status, false).label, inGroup(status, true).label]);
  for (const label of labels) {
    assert.doesNotMatch(label, /(ся|ла|ал)$/, `«${label}» is a past tense that agrees with somebody`);
  }
});

test("only a waiting invitation can be withdrawn", () => {
  assert.equal(inGroup("pending").canCancel, true);
  for (const status of ["accepted", "declined", "cancelled", "expired"] as const) {
    assert.equal(inGroup(status).canCancel, false, status);
  }
});

test("only somebody outside the chat can be asked again", () => {
  assert.equal(inGroup("accepted", true).canInviteAgain, false, "they are already here");
  assert.equal(inGroup("accepted", false).canInviteAgain, true);
  assert.equal(inGroup("declined").canInviteAgain, true);
  assert.equal(inGroup("cancelled").canInviteAgain, true);
  assert.equal(inGroup("expired").canInviteAgain, true);
  assert.equal(inGroup("pending").canInviteAgain, false, "they have not answered the first one");
});

test("somebody who accepted and left is not coloured as though they were here", () => {
  // The old mapping took the label from the status and the membership and the
  // colour from the status alone, so this case wore the «joined» green.
  assert.equal(inGroup("accepted", true).tone, "joined");
  assert.equal(inGroup("accepted", false).tone, "gone");
  assert.equal(inGroup("pending").tone, "waiting");
  assert.equal(inGroup("declined").tone, "refused");
  assert.equal(inGroup("cancelled").tone, "gone");
  assert.equal(inGroup("expired").tone, "gone");
});

test("the line under the heading counts what is outstanding, in Russian", () => {
  assert.equal(invitesWaitingLine(1), "1 приглашение ждёт ответа");
  assert.equal(invitesWaitingLine(2), "2 приглашения ждут ответа");
  assert.equal(invitesWaitingLine(5), "5 приглашений ждут ответа");
  assert.equal(invitesWaitingLine(11), "11 приглашений ждут ответа", "eleven is not one");
  assert.equal(invitesWaitingLine(21), "21 приглашение ждёт ответа");
});

test("nobody waiting means no line at all, not a line saying so", () => {
  // A sentence announcing that there is nothing to see, beside a list showing
  // that there is nothing to see, is the same thing said twice.
  assert.equal(invitesWaitingLine(0), null);
  assert.equal(invitesWaitingLine(-1), null);
});

test("an empty list says why it is empty, and there are two reasons", () => {
  assert.equal(
    invitesEmptyText({ total: 0, visible: 0, failed: false, type: "group" }),
    "В группу ещё никого не приглашали.",
  );
  assert.equal(
    invitesEmptyText({ total: 0, visible: 0, failed: false, type: "channel" }),
    "В канал ещё никого не приглашали.",
  );
  // An accepted invitation from somebody who is in the chat is hidden from the
  // list, so «никого не приглашали» was told to people who had invited five and
  // watched all five arrive.
  assert.equal(
    invitesEmptyText({ total: 5, visible: 0, failed: false, type: "group" }),
    "Все приглашённые уже в группе.",
  );
  assert.equal(
    invitesEmptyText({ total: 5, visible: 0, failed: false, type: "channel" }),
    "Все приглашённые уже в канале.",
  );
  assert.equal(
    invitesEmptyText({ total: 5, visible: 2, failed: false, type: "group" }),
    "",
    "the list is not empty",
  );
});

test("a list that could not be read is not an empty list", () => {
  // Found in the rendered pixels: with the table missing, the block drew its
  // unavailable banner and «В группу ещё никого не приглашали.» directly under
  // it — a fact it had no way of knowing, since it had read nothing.
  assert.equal(invitesEmptyText({ total: 0, visible: 0, failed: true, type: "group" }), "");
  assert.equal(invitesEmptyText({ total: 0, visible: 0, failed: true, type: "channel" }), "");
});

test("the state a missing migration leaves behind tells the reader nothing about the database", () => {
  // The condition is ours; the sentence is theirs. «требуют обновления базы
  // данных» named a repair nobody reading it can make.
  assert.equal(GROUP_INVITES_MIGRATION_REQUIRED, "Приглашения сейчас недоступны. Попробуйте позже.");
  assert.doesNotMatch(GROUP_INVITES_MIGRATION_REQUIRED, /баз[аы] данных|миграц|таблиц|функци/i);
});
