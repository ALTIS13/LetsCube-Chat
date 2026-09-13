// What a group's settings screen holds.
//
// D-164. The rows are data rather than markup so that «which settings exist,
// for whom, with what value beside them» can be argued about without a browser,
// and so that a row for a feature nobody has built cannot quietly appear.

import assert from "node:assert/strict";
import test from "node:test";

import {
  adminCountValue,
  chatProfileDirty,
  chatSettingsRows,
  invitePolicyLabel,
  memberCountValue,
  type ChatSettingsInput,
} from "../../artifacts/kub/src/lib/chatSettings.ts";

const group = (over: Partial<ChatSettingsInput> = {}): ChatSettingsInput => ({
  type: "group",
  isForum: false,
  invitePolicy: "owner_admin_only",
  administrators: 2,
  members: 12,
  media: 128,
  isOwner: true,
  isOwnerOrAdmin: true,
  ...over,
});

const ids = (input: ChatSettingsInput) => chatSettingsRows(input).map((row) => row.id);
const row = (input: ChatSettingsInput, id: string) => chatSettingsRows(input).find((item) => item.id === id);

test("a group owner sees every row, ending on the destructive one", () => {
  assert.deepEqual(ids(group()), ["invites", "topics", "administrators", "members", "media", "delete"]);
});

test("an administrator who does not own the group is not offered its deletion", () => {
  assert.ok(!ids(group({ isOwner: false })).includes("delete"));
  // But they still set who may invite, which is what being an administrator is.
  assert.equal(row(group({ isOwner: false }), "invites")?.editable, true);
});

test("an ordinary member reads the same screen and changes none of it", () => {
  const member = group({ isOwner: false, isOwnerOrAdmin: false });
  assert.deepEqual(ids(member), ["invites", "topics", "administrators", "members", "media"]);
  assert.equal(row(member, "invites")?.editable, false);
  assert.equal(row(member, "topics")?.editable, false);
  // The value is still shown. A setting somebody cannot change is still a fact
  // about the group they are in.
  assert.equal(row(member, "invites")?.value, "Только администраторы");
});

test("a channel has no topics, and its destructive row says channel", () => {
  const channel = group({ type: "channel" });
  assert.ok(!ids(channel).includes("topics"));
  assert.equal(row(channel, "delete")?.label, "Удалить канал");
  assert.equal(row(group(), "delete")?.label, "Удалить группу");
});

test("topics say which way they are, because the row is read at a glance", () => {
  assert.equal(row(group({ isForum: true }), "topics")?.value, "Включены");
  assert.equal(row(group({ isForum: false }), "topics")?.value, "Выключены");
});

test("a media row appears only once something has been counted", () => {
  assert.ok(!ids(group({ media: null })).includes("media"));
  assert.equal(row(group({ media: 0 }), "media")?.value, "0");
});

test("an unread invite policy says so rather than naming a default", () => {
  // D-165: the card printed «Только администраторы» whenever it had read
  // nothing, which asserts a policy instead of admitting to not having one.
  assert.equal(invitePolicyLabel(null), "Неизвестно");
  assert.equal(invitePolicyLabel("members_can_invite"), "Все участники");
  assert.equal(invitePolicyLabel("owner_admin_only"), "Только администраторы");
  assert.equal(row(group({ invitePolicy: null }), "invites")?.value, "Неизвестно");
});

test("the counts are counted in Russian", () => {
  assert.equal(memberCountValue(1), "1 участник");
  assert.equal(memberCountValue(2), "2 участника");
  assert.equal(memberCountValue(5), "5 участников");
  assert.equal(memberCountValue(11), "11 участников", "eleven is not one");
  assert.equal(memberCountValue(21), "21 участник");
  assert.equal(memberCountValue(112), "112 участников");
  assert.equal(memberCountValue(0), "0 участников");

  assert.equal(adminCountValue(1), "1 администратор");
  assert.equal(adminCountValue(3), "3 администратора");
  assert.equal(adminCountValue(14), "14 администраторов");
});

test("leaving with something typed and unsaved is a question, and leaving with nothing is not", () => {
  const saved = { name: "Команда", description: "О чём мы" };
  assert.equal(chatProfileDirty(saved, { ...saved }), false);
  assert.equal(chatProfileDirty(saved, { ...saved, name: "Команда " }), false, "a space is not an edit");
  assert.equal(chatProfileDirty(saved, { ...saved, name: "Команда проекта" }), true);
  assert.equal(chatProfileDirty(saved, { ...saved, description: "" }), true, "clearing is an edit too");
});
