// The client's mirror of `enforce_chat_member_update`, and the one rule it is
// not allowed to mirror.
//
// The fixture is the trigger itself, not the component that used to hold these
// expressions: every case below is read off
// `.migration-backup/supabase/migrations/20260504_chats_membership_hardening.sql:391-459`
// and the delete policy at `:351-358`. Writing the tests from the old client
// code would have pinned whatever it happened to do, which is the opposite of a
// mirror.
//
// Until D-163 this matrix lived inside `members.map()` in `ChatInfoPanel.tsx`
// with a comment naming the trigger and no test at all.

import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedRoleChanges,
  canDemoteFromAdmin,
  canPromoteToAdmin,
  canRemoveMember,
  canTransferOwnership,
  chatRoleLabel,
  hasAnyMemberAction,
  type ChatMemberRole,
} from "../../artifacts/kub/src/lib/chatMemberRules.ts";

const subject = (myRole: ChatMemberRole | null, targetRole: ChatMemberRole, isSelf = false) => ({
  myRole,
  targetRole,
  isSelf,
});

test("an owner has full control, the handover included", () => {
  // `caller_role = 'owner'` takes the trigger's `null; -- full control` branch,
  // so every role except the one already held is permitted.
  assert.deepEqual(allowedRoleChanges(subject("owner", "member")).sort(), ["admin", "owner"]);
  assert.deepEqual(allowedRoleChanges(subject("owner", "admin")).sort(), ["member", "owner"]);
  assert.deepEqual(allowedRoleChanges(subject("owner", "owner")).sort(), ["admin", "member"]);
  assert.equal(canTransferOwnership(subject("owner", "member")), true);
});

test("an administrator has exactly two transitions and never touches an owner", () => {
  // The trigger admits only (member -> admin) and (admin -> member), and
  // refuses when either the old or the new role is owner.
  assert.deepEqual(allowedRoleChanges(subject("admin", "member")), ["admin"]);
  assert.deepEqual(allowedRoleChanges(subject("admin", "admin")), ["member"]);
  assert.deepEqual(allowedRoleChanges(subject("admin", "owner")), []);
  assert.equal(canTransferOwnership(subject("admin", "member")), false, "an admin must never create an owner");
});

test("an ordinary member, and a stranger, may change nobody", () => {
  assert.deepEqual(allowedRoleChanges(subject("member", "member")), []);
  assert.deepEqual(allowedRoleChanges(subject("member", "admin")), []);
  assert.deepEqual(allowedRoleChanges(subject(null, "member")), [], "not a member of this chat at all");
});

test("nobody acts on themselves", () => {
  // Not a courtesy: the old client matrix opened with `!isSelf` on every line,
  // and an owner demoting themselves is the exact path the last-owner trigger
  // guards.
  assert.deepEqual(allowedRoleChanges(subject("owner", "owner", true)), []);
  assert.equal(canRemoveMember(subject("owner", "owner", true)), false);
  assert.equal(hasAnyMemberAction(subject("owner", "owner", true)), false);
});

test("the handover counts as an action, so its row draws a control", () => {
  // D-150. `hasAnyMemberAction` left `canTransferOwnership` out until
  // 2026-09-14, and **no test can turn that omission red**: everywhere the
  // handover is permitted, demotion or removal is permitted too, so the control
  // drew anyway. It is listed now for completeness rather than for coverage —
  // this function answers "any action", and an enumeration missing one of its
  // four is a promise waiting on somebody narrowing `canRemoveMember`. Said
  // here rather than pretended away with an assertion that passes either way.
  assert.equal(hasAnyMemberAction(subject("owner", "admin")), true);
  assert.equal(canTransferOwnership(subject("owner", "admin")), true);

  // And it must not appear where the database would refuse it.
  assert.equal(canTransferOwnership(subject("admin", "member")), false);
  assert.equal(canTransferOwnership(subject("member", "member")), false);
  assert.equal(canTransferOwnership(subject("owner", "owner", true)), false, "not to yourself");
  assert.equal(canTransferOwnership(subject(null, "member")), false, "not as an onlooker");
});

test("removal follows the delete policy, not the role matrix", () => {
  assert.equal(canRemoveMember(subject("owner", "member")), true);
  assert.equal(canRemoveMember(subject("owner", "admin")), true);
  assert.equal(canRemoveMember(subject("owner", "owner")), false, "an owner is never removable");
  assert.equal(canRemoveMember(subject("admin", "member")), true);
  assert.equal(canRemoveMember(subject("admin", "admin")), false, "an admin may remove members only");
  assert.equal(canRemoveMember(subject("admin", "owner")), false);
  assert.equal(canRemoveMember(subject("member", "member")), false);
});

test("promote and demote are the two the interface draws", () => {
  assert.equal(canPromoteToAdmin(subject("admin", "member")), true);
  assert.equal(canPromoteToAdmin(subject("admin", "admin")), false, "already an administrator");
  assert.equal(canDemoteFromAdmin(subject("admin", "admin")), true);
  assert.equal(canDemoteFromAdmin(subject("admin", "member")), false, "not an administrator");
  assert.equal(canPromoteToAdmin(subject("member", "member")), false);
});

test("whether a control is drawn at all", () => {
  assert.equal(hasAnyMemberAction(subject("owner", "member")), true);
  assert.equal(hasAnyMemberAction(subject("admin", "owner")), false, "an admin can do nothing to an owner");
  assert.equal(hasAnyMemberAction(subject("member", "admin")), false);
  assert.equal(hasAnyMemberAction(subject(null, "member")), false);
});

/**
 * The rule this module refuses to know.
 *
 * The trigger also raises `P0001` when the last owner would be demoted, after
 * taking an advisory lock and counting the remaining owners. That depends on
 * the whole chat rather than on the two people in hand. A client that guessed
 * it would sometimes hide a control that would have worked, so the answer stays
 * the server's and its error is shown to the reader.
 */
test("the last-owner rule is not mirrored, deliberately", () => {
  // Two owners or one, this module answers the same, because it cannot see the
  // difference and must not pretend to. Nothing in its input carries the number
  // of owners, which is the point: the shape of the subject is the guarantee.
  assert.deepEqual(allowedRoleChanges(subject("owner", "owner")).sort(), ["admin", "member"]);
  assert.deepEqual(
    Object.keys(subject("owner", "owner")).sort(),
    ["isSelf", "myRole", "targetRole"],
    "a field describing the rest of the chat would let this module start guessing the server's answer",
  );
});

test("the role words are the ones already on screen", () => {
  assert.equal(chatRoleLabel("owner"), "Владелец");
  assert.equal(chatRoleLabel("admin"), "Администратор");
  assert.equal(chatRoleLabel("member"), "", "an ordinary member carries no label");
  assert.equal(chatRoleLabel("nonsense"), "");
});

test("the word can say which chat it means, and an ordinary member still says nothing", () => {
  // D-180. The member row now carries a global standing beside this word, and
  // that chip may itself read «Владелец» — so the row said it twice, meaning
  // two different things. Scoped, each half says what it is about.
  assert.equal(chatRoleLabel("owner", "группы"), "Владелец группы");
  assert.equal(chatRoleLabel("admin", "канала"), "Администратор канала");
  assert.equal(
    chatRoleLabel("member", "группы"),
    "",
    "scoping an empty word would leave a line reading « группы»",
  );
});

/**
 * The mutations. Each one is a way the mirror could crack while every other
 * test still passed, and each is the shape of a real defect: the interface
 * offering what the server refuses.
 */
test("the guarantee fails if an administrator gains the handover", () => {
  const broken = (s: ReturnType<typeof subject>) =>
    s.myRole === "admin" ? ["owner", ...allowedRoleChanges(s)] : allowedRoleChanges(s);
  assert.ok(broken(subject("admin", "member")).includes("owner"));
  assert.equal(
    allowedRoleChanges(subject("admin", "member")).includes("owner"),
    false,
    "the real rule must still refuse it",
  );
});

test("the guarantee fails if an administrator may touch an owner", () => {
  assert.deepEqual(allowedRoleChanges(subject("admin", "owner")), []);
  assert.equal(canRemoveMember(subject("admin", "owner")), false);
  // Both halves must hold: the trigger refuses the role change and the delete
  // policy refuses the removal, and they are separate rules in the database.
});
