// Who may read the moderation queue (D-187).
//
// The client's `isStaff` is wider than the policy that actually reads these
// rows, and the gap is not theoretical: `isStaff` admits anybody holding
// `chats.moderate` or `users.view`, which a location role can carry with no
// global role at all. Somebody in that gap, given the screen, reads zero rows
// for ever — and an empty queue and a queue you may not read look alike.
//
// This pins the narrower rule against `public.is_manager_or_admin`, read off
// production on 2026-09-14:
//   profiles.role in ('admin','manager')
//   or has_global_role(uid, 'owner'|'tech_admin'|'admin'|'manager')
import assert from "node:assert/strict";
import test from "node:test";

import {
  canReadModerationQueue,
  MODERATION_QUEUE_LEGACY_ROLES,
  MODERATION_QUEUE_ROLE_KEYS,
} from "../../artifacts/kub/src/lib/moderationAccess.ts";

const may = (legacyRole: string | null, keys: string[] = []) =>
  canReadModerationQueue({ legacyRole, globalRoleKeys: keys });

test("the legacy column admits exactly what the function admits", () => {
  assert.equal(may("admin"), true);
  assert.equal(may("manager"), true);
  assert.equal(may("user"), false);
  assert.equal(may(null), false);
  assert.equal(may(""), false);
  assert.deepEqual([...MODERATION_QUEUE_LEGACY_ROLES], ["admin", "manager"]);
});

test("the four global role keys admit, and nothing else does", () => {
  for (const key of MODERATION_QUEUE_ROLE_KEYS) {
    assert.equal(may("user", [key]), true, key);
  }
  // The keys this deployment actually carries beside them.
  assert.equal(may("user", ["user"]), false);
  assert.equal(may("user", ["location_admin"]), false);
  assert.equal(may("user", ["support"]), false);
  assert.deepEqual([...MODERATION_QUEUE_ROLE_KEYS], ["owner", "tech_admin", "admin", "manager"]);
});

test("a permission is not a role, which is the whole point of this rule", () => {
  // `chats.moderate` makes somebody `isStaff` in the client and nothing at all
  // to `is_manager_or_admin`. Passing it here as if it were a role must not
  // open the queue.
  assert.equal(may("user", ["chats.moderate"]), false);
  assert.equal(may("user", ["users.view", "tasks.manage"]), false);
});

test("one qualifying key among several is enough", () => {
  assert.equal(may("user", ["user", "support", "manager"]), true);
});

test("nothing at all is not staff", () => {
  assert.equal(canReadModerationQueue({ legacyRole: null, globalRoleKeys: null }), false);
  assert.equal(canReadModerationQueue({ legacyRole: undefined, globalRoleKeys: undefined }), false);
  assert.equal(may(null, []), false);
});

test("a Set works as well as an array, because that is what the hook holds", () => {
  assert.equal(canReadModerationQueue({ legacyRole: "user", globalRoleKeys: new Set(["owner"]) }), true);
  assert.equal(canReadModerationQueue({ legacyRole: "user", globalRoleKeys: new Set(["user"]) }), false);
});
