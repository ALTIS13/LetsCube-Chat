// The client's copy of `public.group_invite_create`'s admission gate (D-165,
// part 2). The function body is quoted in `lib/chatInviteAccess.ts`; it was read
// off production on 2026-09-17 and four arms of it were measured there the same
// day, each inside `begin; … rollback;` with a control that had to succeed.
//
// Each test below names the arm or the branch it pins. The one that matters most
// is `invite_any`: the server admits an administrator who is an ordinary member
// of a group whose policy says administrators only, and the two-branch rule the
// information card carried refused them with nothing said — which is this
// entry's own defect pointing the other way.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  chatInviteAdmission,
  isInvitePolicy,
  readInvitePolicy,
  type ChatInviteAdmissionInput,
} from "../../artifacts/kub/src/lib/chatInviteAccess.ts";

/** An ordinary person on this deployment: `chats.invite` and nothing else. */
const ordinary = {
  hasInvite: true,
  hasInviteAny: false,
  hasSystemManage: false,
} as const;

const ask = (over: Partial<ChatInviteAdmissionInput> = {}) =>
  chatInviteAdmission({
    chatType: "group",
    chatRole: "member",
    invitePolicy: "owner_admin_only",
    ...ordinary,
    ...over,
  });

test("arm A: a plain member of an owner_admin_only group is refused, and told why", () => {
  const answer = ask();
  assert.equal(answer.canInvite, false);
  assert.equal(answer.denial, "admin_required");
  assert.equal(answer.grantedBy, null);
  assert.equal(answer.policyUnread, false);
});

test("arm B: the chat's owner and its administrators are admitted", () => {
  for (const role of ["owner", "admin"] as const) {
    const answer = ask({ chatRole: role });
    assert.equal(answer.canInvite, true, role);
    assert.equal(answer.grantedBy, "chat_admin", role);
    assert.equal(answer.denial, null, role);
  }
});

test("arm C: members_can_invite admits an ordinary member", () => {
  const answer = ask({ invitePolicy: "members_can_invite" });
  assert.equal(answer.canInvite, true);
  assert.equal(answer.grantedBy, "chat_policy");
});

test("arm D: chats.invite_any admits a plain member and ignores the policy", () => {
  const answer = ask({ hasInviteAny: true });
  assert.equal(answer.canInvite, true);
  assert.equal(answer.grantedBy, "invite_any");
  // The rule the client used to carry, for comparison: not a chat admin, and
  // the policy is not members_can_invite, so it hid the button.
  assert.equal(ask().canInvite, false);
});

test("chats.invite_any still requires being in the chat", () => {
  const answer = ask({ hasInviteAny: true, chatRole: null });
  assert.equal(answer.canInvite, false);
  assert.equal(answer.denial, "member_required");
});

test("system.manage admits without membership, which no other branch does", () => {
  const answer = ask({ hasSystemManage: true, chatRole: null });
  assert.equal(answer.canInvite, true);
  assert.equal(answer.grantedBy, "system_manage");
  assert.equal(ask({ hasInviteAny: true, chatRole: null }).canInvite, false);
});

test("the chat's type is checked before every permission, as the server checks it", () => {
  for (const over of [
    { hasSystemManage: true },
    { hasInviteAny: true },
    { invitePolicy: "members_can_invite" as const },
    { chatRole: "owner" as const },
  ]) {
    const answer = ask({ chatType: "private", ...over });
    assert.equal(answer.canInvite, false, JSON.stringify(over));
    assert.equal(answer.denial, "not_group_chat", JSON.stringify(over));
  }
});

test("a channel invites exactly as a group does", () => {
  assert.equal(ask({ chatType: "channel", chatRole: "owner" }).grantedBy, "chat_admin");
  assert.equal(ask({ chatType: "channel" }).denial, "admin_required");
});

test("an unread policy no longer removes the action from a member", () => {
  const answer = ask({ invitePolicy: null });
  assert.equal(answer.canInvite, true);
  // Nothing is claimed about which policy it is: the server reads the column.
  assert.equal(answer.grantedBy, null);
  assert.equal(answer.policyUnread, true);
});

test("an unread policy still refuses somebody who is not in the chat", () => {
  const answer = ask({ invitePolicy: null, chatRole: null });
  assert.equal(answer.canInvite, false);
  assert.equal(answer.denial, "member_required");
  assert.equal(answer.policyUnread, true);
});

test("policyUnread is reported on every answer, not only when it decides one", () => {
  assert.equal(ask({ invitePolicy: null, chatType: "private" }).policyUnread, true);
  assert.equal(ask({ invitePolicy: null, hasSystemManage: true }).policyUnread, true);
  assert.equal(ask({ invitePolicy: "owner_admin_only" }).policyUnread, false);
});

test("members_can_invite without chats.invite refuses, as the server's elsif does", () => {
  // Unreachable today — every measured global role and the legacy fallback hold
  // `chats.invite` — and mirrored because the server does not fall through to
  // the administrator branch here: a chat owner would be refused too.
  const answer = ask({ invitePolicy: "members_can_invite", hasInvite: false });
  assert.equal(answer.canInvite, false);
  assert.equal(answer.denial, "member_required");
  assert.equal(ask({ invitePolicy: "members_can_invite", hasInvite: false, chatRole: "owner" }).canInvite, false);
});

test("only the two values the CHECK admits are a policy", () => {
  assert.equal(isInvitePolicy("owner_admin_only"), true);
  assert.equal(isInvitePolicy("members_can_invite"), true);
  for (const value of ["admins_only", "everyone", "", null, undefined, 0, {}]) {
    assert.equal(isInvitePolicy(value), false, String(value));
  }
});

test("a value the CHECK would refuse reads as unread, not as the default", () => {
  // `messageActionsFixture` seeded «admins_only» until 2026-09-13 and every
  // fixture render of the card showed a state production cannot be in.
  assert.equal(readInvitePolicy("admins_only"), null);
  assert.equal(readInvitePolicy(undefined), null);
  assert.equal(readInvitePolicy("members_can_invite"), "members_can_invite");
  assert.equal(ask({ invitePolicy: readInvitePolicy("admins_only") }).policyUnread, true);
});

// ---------------------------------------------------------------------------
// The two surfaces that decide it, read as source.
//
// The lib above can be perfect while nothing consults it, and that was the
// state on 2026-09-17: `GroupInviteModal` was wired and `ChatInfoPanel` still
// carried its own two-branch rule — so the *row* that opens the modal was
// taken away from the arm-D case before the modal could judge anything.
// A mocked test cannot see that; each file's own rule typechecks.
// ---------------------------------------------------------------------------

const SURFACES = [
  "artifacts/kub/src/components/chat/ChatInfoPanel.tsx",
  "artifacts/kub/src/components/chat/GroupInviteModal.tsx",
];

test("both invite surfaces ask this module rather than spelling the rule again", () => {
  for (const file of SURFACES) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      source.includes("chatInviteAdmission("),
      `${file}: nothing calls chatInviteAdmission — the surface decides invitation on its own again`,
    );
    // The rule as it used to be written, in the two shapes it took. Not a
    // regex over the whole predicate: what has to stay gone is the policy
    // comparison standing on its own as the second branch of a decision.
    for (const shape of [
      'isOwnerOrAdmin || (invitePolicySupported && invitePolicy ===',
      'isOwnerOrAdmin || invitePolicy ===',
    ]) {
      assert.ok(
        !source.includes(shape),
        `${file}: the two-branch rule is back, as ${shape}… . The server has four ` +
          `branches and admits a legacy-admin plain member through chats.invite_any`,
      );
    }
  }
});

test("the card asks for exactly the keys the server function consults", () => {
  // Three, because `group_invite_create` reads three. A fourth here would be
  // a key somebody is about to gate on that the server never looks at — which
  // is how three register entries in one day proposed fixes the database
  // refuses.
  const card = readFileSync("artifacts/kub/src/components/chat/ChatInfoPanel.tsx", "utf8");
  // Plain slicing, not a built pattern: the escapes in a generated regular
  // expression did not survive being written through a shell, twice, and the
  // test then failed on its own syntax rather than on the product.
  const marker = "const CHAT_INVITE_PERMISSION_KEYS = [";
  const from = card.indexOf(marker);
  const declared = from < 0 ? "" : card.slice(from + marker.length, card.indexOf("]", from));
  assert.ok(declared.length > 0, "CHAT_INVITE_PERMISSION_KEYS is gone from the card");
  const keys = declared
    .split(",")
    .map((part) => part.trim().split('"').join("").split("'").join(""))
    .filter(Boolean);
  assert.deepEqual(keys.sort(), ["chats.invite", "chats.invite_any", "system.manage"]);
});

test("the card does not offer to invite somebody into your own saved messages", () => {
  // «Избранное» is created by `newGroupRow`, so its row really is `type:
  // 'group'` — the mirror would admit it on type alone and the owner of that
  // chat is its owner. The guard is `!isSaved`, and it is load-bearing rather
  // than defensive.
  const card = readFileSync("artifacts/kub/src/components/chat/ChatInfoPanel.tsx", "utf8");
  assert.ok(
    card.includes("const canSendInvites = !isSaved && inviteAdmission.canInvite;"),
    "canSendInvites no longer excludes «Избранное», which is a chat of type group",
  );
  const saved = readFileSync("artifacts/kub/src/lib/savedMessages.ts", "utf8");
  assert.ok(
    saved.includes("newGroupRow("),
    "«Избранное» is no longer built by newGroupRow, so check its type before trusting the guard above",
  );
});
