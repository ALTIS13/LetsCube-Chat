// The client's copy of what `chat_roles` and `chat_member_roles` enforce.
//
// D-215. The tables were applied to production on 2026-09-18 and the rules
// below are read off that migration, not off the design document it came from
// — the design was wrong about this database in three places and the migration
// says so at length. Every number here is the migration's.
//
// The reason this file exists rather than trusting the server to refuse: a
// screen that offers a control the database will answer 403 to is worse than
// one that hides it, because the person cannot tell which of the two happened.
// The mirror is what lets the interface say «Роли группы настраивает владелец»
// instead of «Не удалось».

import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_ROLE_LIMITS,
  chatRoleAssignDenial,
  chatRoleDefineDenial,
  chatRoleDenialText,
  chatRoleNameTaken,
  chatRolesOfMember,
  isChatRoleNameValid,
  normalizeChatRoleName,
  orderChatRoles,
  topChatRole,
  type ChatRoleRow,
} from "../../artifacts/kub/src/lib/chatRoles.ts";

const CHAT = "22222222-2222-4222-8222-000000000001";

function row(over: Partial<ChatRoleRow> = {}): ChatRoleRow {
  // `in` rather than `??`, because `null` and «not given» are different answers
  // for `colour` and `icon` and the whole point of two of the tests below is to
  // tell them apart. The first version used `??` and the null case silently
  // became "blue", so the test failed on its own helper.
  return {
    id: over.id ?? "role-1",
    chat_id: CHAT,
    name: over.name ?? "Наставник",
    colour: "colour" in over ? (over.colour ?? null) : "blue",
    icon: "icon" in over ? (over.icon ?? null) : "shield",
    priority: over.priority ?? 0,
  };
}

// ---------------------------------------------------------------------------
// The name, as the database compares it
// ---------------------------------------------------------------------------

test("the name is trimmed, because the CHECK and the unique index both trim", () => {
  assert.equal(normalizeChatRoleName("  Наставник  "), "Наставник");
  assert.equal(normalizeChatRoleName(""), "");
  // Not a crash on a value that is not a string: this reads rows off the wire.
  assert.equal(normalizeChatRoleName(undefined as unknown as string), "");
});

test("a name is valid at one character and at thirty-two, and not at thirty-three", () => {
  assert.equal(isChatRoleNameValid("О"), true);
  assert.equal(isChatRoleNameValid("О".repeat(32)), true);
  assert.equal(isChatRoleNameValid("О".repeat(33)), false);
  // Whitespace is not length: `char_length(btrim(name))` is what the CHECK
  // measures, so a field of spaces is a blank name and the database says so.
  assert.equal(isChatRoleNameValid("     "), false);
  assert.equal(isChatRoleNameValid(" О "), true);
});

test("the length is counted in characters, not in UTF-16 units", () => {
  // Thirty-two of these is thirty-two characters and sixty-four units. A
  // `.length` check would refuse a name the database accepts, which is the
  // more annoying of the two ways to be wrong: the field says «слишком
  // длинное» about a name that is not.
  const emoji = "\u{1F600}".repeat(32);
  assert.equal(emoji.length, 64);
  assert.equal(isChatRoleNameValid(emoji), true);
  assert.equal(isChatRoleNameValid("\u{1F600}".repeat(33)), false);
});

test("the same name in another case is the same name, in Russian", () => {
  const roles = orderChatRoles([row({ name: "Наставник" })]);
  assert.equal(chatRoleNameTaken("наставник", roles), true);
  assert.equal(chatRoleNameTaken("  НАСТАВНИК ", roles), true);
  assert.equal(chatRoleNameTaken("Дежурный", roles), false);
  // Folded with toLocaleLowerCase("ru-RU"): this project has been bitten by a
  // case fold that does not know Cyrillic, which answered 1 and 7 where the
  // truth was 7 and 13.
  assert.equal("НАСТАВНИК".toLocaleLowerCase("ru-RU"), "наставник");
});

test("renaming a role does not collide with itself", () => {
  const roles = orderChatRoles([row({ id: "a", name: "Наставник" }), row({ id: "b", name: "Дежурный" })]);
  assert.equal(chatRoleNameTaken("Наставник", roles, "a"), false, "a role blocked its own rename");
  assert.equal(chatRoleNameTaken("Дежурный", roles, "a"), true);
});

test("an empty name is never «taken», so the field does not refuse itself", () => {
  const roles = orderChatRoles([row({ name: "Наставник" })]);
  assert.equal(chatRoleNameTaken("", roles), false);
  assert.equal(chatRoleNameTaken("   ", roles), false);
});

// ---------------------------------------------------------------------------
// The order, which has to be the index's order
// ---------------------------------------------------------------------------

test("roles come out highest first, and ties break by name rather than by luck", () => {
  const ordered = orderChatRoles([
    row({ id: "c", name: "Дежурный", priority: 10 }),
    row({ id: "a", name: "Основатель", priority: 90 }),
    row({ id: "b", name: "Ветеран", priority: 10 }),
  ]);
  assert.deepEqual(
    ordered.map((role) => role.name),
    ["Основатель", "Ветеран", "Дежурный"],
  );
  // `priority` is not unique in the database, and the index is
  // (chat_id, priority desc, name). Without the name tiebreaker two tags at
  // one rank swap places between reads and a member list flickers.
  const ties = orderChatRoles([
    row({ id: "b", name: "Ветеран", priority: 10 }),
    row({ id: "c", name: "Дежурный", priority: 10 }),
  ]);
  assert.deepEqual(ties.map((role) => role.name), ["Ветеран", "Дежурный"]);
});

test("a glyph this build does not have renders plain, rather than the row being dropped", () => {
  const known = new Set(["shield", "crown"]);
  const [kept] = orderChatRoles([row({ icon: "crown" })], known);
  assert.equal(kept.icon, "crown");
  const [stripped] = orderChatRoles([row({ icon: "somethingFromTheFuture" })], known);
  assert.equal(stripped.icon, null, "an unknown glyph took the whole role with it");
  assert.equal(stripped.name, "Наставник", "the role survived, which is the point");
});

test("a colour key is carried through untouched, because the palette is the interface's", () => {
  // The database constrains the SHAPE of the key and knows nothing about which
  // keys exist; `lib/chatRolePalette.ts` owns that. So an unrecognised key has
  // to reach the component, which renders it plain — dropping it here would
  // make a mis-seeded row indistinguishable from a colourless one.
  assert.equal(orderChatRoles([row({ colour: "amber" })])[0].colour, "amber");
  assert.equal(orderChatRoles([row({ colour: "not_a_palette_key" })])[0].colour, "not_a_palette_key");
  assert.equal(orderChatRoles([row({ colour: null })])[0].colour, null);
  assert.equal(orderChatRoles([row({ colour: "" })])[0].colour, null);
});

// ---------------------------------------------------------------------------
// Who wears what
// ---------------------------------------------------------------------------

test("a member wears the tags assigned to them, in the group's own order", () => {
  const roles = orderChatRoles([
    row({ id: "top", name: "Основатель", priority: 90 }),
    row({ id: "mid", name: "Наставник", priority: 50 }),
    row({ id: "low", name: "Дежурный", priority: 10 }),
  ]);
  const assignments = [
    { chat_id: CHAT, user_id: "u1", role_id: "low" },
    { chat_id: CHAT, user_id: "u1", role_id: "top" },
    { chat_id: CHAT, user_id: "u2", role_id: "mid" },
  ];
  assert.deepEqual(
    chatRolesOfMember("u1", assignments, roles).map((role) => role.name),
    ["Основатель", "Дежурный"],
    "the assignment order leaked into the display order",
  );
  assert.deepEqual(chatRolesOfMember("u2", assignments, roles).map((r) => r.name), ["Наставник"]);
  assert.deepEqual(chatRolesOfMember("u3", assignments, roles), []);
});

test("a tag naming a role the group no longer has is not drawn", () => {
  // The composite foreign key cascades, so this state does not survive a
  // delete — but a client holding a stale list between reads sees it, and a
  // row that renders an id would be the worst possible answer.
  const roles = orderChatRoles([row({ id: "kept", name: "Наставник" })]);
  const assignments = [
    { chat_id: CHAT, user_id: "u1", role_id: "kept" },
    { chat_id: CHAT, user_id: "u1", role_id: "deleted-a-moment-ago" },
  ];
  assert.deepEqual(chatRolesOfMember("u1", assignments, roles).map((r) => r.name), ["Наставник"]);
});

test("the row takes the highest tag and only the highest", () => {
  const roles = orderChatRoles([
    row({ id: "top", name: "Основатель", priority: 90 }),
    row({ id: "low", name: "Дежурный", priority: 10 }),
  ]);
  assert.equal(topChatRole(roles)?.name, "Основатель");
  assert.equal(topChatRole([]), null, "an untagged member must get no tag rather than a blank one");
});

// ---------------------------------------------------------------------------
// The two gates, which are different on purpose
// ---------------------------------------------------------------------------

test("only the chat's owner may define the vocabulary", () => {
  const base = { chatType: "group" as const };
  assert.equal(chatRoleDefineDenial({ ...base, standing: "owner" }), null);
  assert.equal(chatRoleDefineDenial({ ...base, standing: "admin" }), "owner_required");
  assert.equal(chatRoleDefineDenial({ ...base, standing: "member" }), "owner_required");
  assert.equal(chatRoleDefineDenial({ ...base, standing: null }), "owner_required");
});

test("an owner or an administrator may hand an existing tag out", () => {
  const base = { chatType: "group" as const };
  assert.equal(chatRoleAssignDenial({ ...base, standing: "owner" }), null);
  assert.equal(chatRoleAssignDenial({ ...base, standing: "admin" }), null);
  assert.equal(chatRoleAssignDenial({ ...base, standing: "member" }), "admin_required");
  assert.equal(chatRoleAssignDenial({ ...base, standing: null }), "admin_required");
});

test("a private chat is refused before the standing is even looked at", () => {
  // The order matters and it is the server's. `private.enforce_chat_role_scope`
  // is a trigger, so it fires whatever the policy decided — and `is_chat_owner`
  // is TRUE for one side of 24 of this deployment's 27 private conversations,
  // an artefact of the 2026-09-11 repair. Checking the standing first would
  // offer that side a control the database then refuses.
  for (const standing of ["owner", "admin", "member", null] as const) {
    assert.equal(chatRoleDefineDenial({ chatType: "private", standing }), "not_group_chat");
    assert.equal(chatRoleAssignDenial({ chatType: "private", standing }), "not_group_chat");
  }
  // And an unread chat type is not a group either: the trigger reads the row
  // itself, so guessing «probably a group» would draw a control on a saved
  // messages chat.
  assert.equal(chatRoleDefineDenial({ chatType: null, standing: "owner" }), "not_group_chat");
  assert.equal(chatRoleDefineDenial({ chatType: undefined, standing: "owner" }), "not_group_chat");
});

test("a channel has roles, because the trigger only refuses «private»", () => {
  assert.equal(chatRoleDefineDenial({ chatType: "channel", standing: "owner" }), null);
  assert.equal(chatRoleAssignDenial({ chatType: "channel", standing: "admin" }), null);
});

test("the limits are the migration's, and they bite at the boundary", () => {
  assert.equal(CHAT_ROLE_LIMITS.perChat, 25);
  assert.equal(CHAT_ROLE_LIMITS.perMember, 5);

  const define = (definedCount: number) =>
    chatRoleDefineDenial({ chatType: "group", standing: "owner", definedCount });
  assert.equal(define(24), null, "the twenty-fifth role was refused a place");
  assert.equal(define(25), "chat_full");
  assert.equal(define(26), "chat_full");

  const assign = (wornCount: number) =>
    chatRoleAssignDenial({ chatType: "group", standing: "admin", wornCount });
  assert.equal(assign(4), null, "the fifth tag was refused");
  assert.equal(assign(5), "member_full");
});

test("an unknown count is «not counted», not «at the limit»", () => {
  // The screen asks before the list has come back. Refusing then would hide the
  // control for a moment and reappear, which reads as a flicker rather than as
  // a rule.
  assert.equal(chatRoleDefineDenial({ chatType: "group", standing: "owner" }), null);
  assert.equal(chatRoleAssignDenial({ chatType: "group", standing: "admin" }), null);
});

test("every denial has a sentence, and none of them says «не удалось»", () => {
  const denials = [
    "not_group_chat",
    "owner_required",
    "admin_required",
    "chat_full",
    "member_full",
  ] as const;
  for (const denial of denials) {
    const text = chatRoleDenialText(denial);
    assert.ok(text.length > 0, `${denial} has no sentence`);
    assert.ok(
      !/не удалось/i.test(text),
      `${denial} says «не удалось», which describes our plumbing rather than the rule`,
    );
    assert.match(text, /[.!?]$/, `${denial} is not a sentence`);
  }
  // The two numbers are quoted from the limits rather than typed twice.
  assert.match(chatRoleDenialText("chat_full"), new RegExp(String(CHAT_ROLE_LIMITS.perChat)));
  assert.match(chatRoleDenialText("member_full"), new RegExp(String(CHAT_ROLE_LIMITS.perMember)));
});
