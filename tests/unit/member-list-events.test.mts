// Whether a `chat_members` UPDATE changes what the information panel's member
// list shows (D-260). Nearly every UPDATE on that table is somebody reading, and
// the panel reloaded itself and the whole chat list on each of them.
import assert from "node:assert/strict";
import test from "node:test";
import { memberUpdateChangesList } from "../../artifacts/kub/src/lib/memberListEvents.ts";

const ANNA = "11111111-1111-4111-8111-000000000001";
const BORIS = "11111111-1111-4111-8111-000000000002";
const LIST = [
  { id: ANNA, chat_role: "owner" },
  { id: BORIS, chat_role: "member" },
];

test("a read mark is not a change to the list", () => {
  assert.equal(memberUpdateChangesList({ user_id: BORIS, role: "member", last_read_at: "2026-09-29T10:00:00Z" } as never, LIST), false);
  assert.equal(memberUpdateChangesList({ user_id: ANNA, role: "owner" }, LIST), false);
});

test("a role that differs from the one the list holds is", () => {
  assert.equal(memberUpdateChangesList({ user_id: BORIS, role: "admin" }, LIST), true);
  assert.equal(memberUpdateChangesList({ user_id: ANNA, role: "member" }, LIST), true);
});

test("somebody the list does not hold means the list is behind", () => {
  assert.equal(memberUpdateChangesList({ user_id: "11111111-1111-4111-8111-000000000003", role: "member" }, LIST), true);
});

test("a payload without a user is nothing to act on", () => {
  assert.equal(memberUpdateChangesList(undefined, LIST), false);
  assert.equal(memberUpdateChangesList(null, LIST), false);
  assert.equal(memberUpdateChangesList({ role: "admin" }, LIST), false);
});

test("a row with no role in it changes nothing the list shows", () => {
  assert.equal(memberUpdateChangesList({ user_id: BORIS }, LIST), false);
});
