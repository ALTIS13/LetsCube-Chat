import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INVITE_LINK_EXPIRY,
  DEFAULT_INVITE_LINK_USES,
  INVITE_LINK_EXPIRY_CHOICES,
  INVITE_LINK_USES_CHOICES,
  inviteLinkErrorText,
  inviteLinkState,
  inviteLinkSummary,
  inviteLinkUrl,
  invitePreviewStateText,
  joinTokenFromPath,
  memberCountLabel,
  type InviteLinkRow,
} from "../../artifacts/kub/src/lib/chatInviteLinks.ts";
import { clearPendingJoin, pendingJoinPath, rememberPendingJoin } from "../../artifacts/kub/src/lib/pendingJoin.ts";

// D-170: a link into a group, with Telegram's choices (LinkEditActivity, read
// 2026-09-30) and the owner's answer about what the holder sees.

const TOKEN = "AbCdEfGhIjKlMnOpQrStU_";
const NOW = Date.parse("2026-09-30T12:00:00.000Z");

function link(over: Partial<InviteLinkRow> = {}): InviteLinkRow {
  return {
    id: "l1",
    token: TOKEN,
    title: null,
    created_by: "u1",
    created_at: "2026-09-30T10:00:00.000Z",
    expires_at: null,
    max_uses: null,
    uses: 0,
    revoked_at: null,
    ...over,
  };
}

test("Telegram's choices: an hour, a day, a week or none; one, ten, a hundred or none; none by default", () => {
  assert.deepEqual(INVITE_LINK_EXPIRY_CHOICES.map((choice) => choice.seconds), [3600, 86_400, 604_800, null]);
  assert.deepEqual(INVITE_LINK_USES_CHOICES.map((choice) => choice.uses), [1, 10, 100, null]);
  assert.equal(DEFAULT_INVITE_LINK_EXPIRY, "none");
  assert.equal(DEFAULT_INVITE_LINK_USES, "none");
});

test("a link's address, and the token read back from it", () => {
  assert.equal(inviteLinkUrl("https://app.letscube.ru/", TOKEN), `https://app.letscube.ru/join/${TOKEN}`);
  assert.equal(joinTokenFromPath(`/join/${TOKEN}`), TOKEN);
  assert.equal(joinTokenFromPath(`/join/${TOKEN}/?utm=x`), TOKEN);
  assert.equal(joinTokenFromPath("/join/short"), null, "a token of the wrong shape is no token");
  assert.equal(joinTokenFromPath(`/joined/${TOKEN}`), null);
  assert.equal(joinTokenFromPath(`/join/${TOKEN}/more`), null);
});

test("a link's state and the line under it", () => {
  assert.equal(inviteLinkState(link(), NOW), "active");
  assert.equal(inviteLinkSummary(link(), NOW), "Ещё не использована · без срока");
  assert.equal(inviteLinkSummary(link({ uses: 3 }), NOW), "3 входа · без срока");
  assert.equal(inviteLinkSummary(link({ uses: 3, max_uses: 10 }), NOW), "3 из 10 входов · без срока");
  assert.equal(
    inviteLinkSummary(link({ expires_at: "2026-10-02T13:00:00.000Z" }), NOW),
    "Ещё не использована · истекает через 2 дня",
  );
  assert.equal(inviteLinkSummary(link({ expires_at: "2026-09-30T12:30:00.000Z" }), NOW), "Ещё не использована · истекает через 30 минут");
  assert.equal(inviteLinkState(link({ uses: 1, max_uses: 1 }), NOW), "used_up");
  assert.equal(inviteLinkSummary(link({ uses: 1, max_uses: 1 }), NOW), "1 из 1 входа · больше не действует");
  assert.equal(inviteLinkState(link({ expires_at: "2026-09-30T11:00:00.000Z" }), NOW), "expired");
  assert.equal(inviteLinkState(link({ revoked_at: "2026-09-30T11:00:00.000Z", uses: 5, max_uses: 5 }), NOW), "revoked", "revoked wins over everything");
});

test("a dead link says why in words, and a refusal never shows Postgres's", () => {
  for (const state of ["invalid", "revoked", "expired", "used_up", "unavailable"] as const) {
    assert.ok(invitePreviewStateText(state), state);
  }
  assert.equal(invitePreviewStateText("ok"), null);
  assert.equal(invitePreviewStateText("member"), null);
  assert.match(inviteLinkErrorText({ message: "invite_link_used_up" }, "x"), /столько людей/);
  assert.equal(inviteLinkErrorText({ message: "permission denied for table chats" }, "Не удалось."), "Не удалось.");
  assert.equal(memberCountLabel(1), "1 участник");
  assert.equal(memberCountLabel(3), "3 участника");
  assert.equal(memberCountLabel(12), "12 участников");
});

test("a link opened before signing in is where sign-in leads, once", () => {
  const map = new Map<string, string>();
  const store = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), removeItem: (key: string) => void map.delete(key) };
  assert.equal(pendingJoinPath(store), null);
  rememberPendingJoin("/chat/abc", store);
  assert.equal(pendingJoinPath(store), null, "only a join address is kept");
  rememberPendingJoin(`/join/${TOKEN}`, store);
  assert.equal(pendingJoinPath(store), `/join/${TOKEN}`);
  clearPendingJoin(store);
  assert.equal(pendingJoinPath(store), null);
  map.set("kub:pending-join:v1", "<script>");
  assert.equal(pendingJoinPath(store), null, "a stored value is not trusted");
});
