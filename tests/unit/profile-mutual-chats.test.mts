import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PROFILE_MUTUAL_CHAT_LIMIT,
  profileMutualChats,
  type MutualChatRow,
} from "../../artifacts/kub/src/lib/profileMutualChats.ts";

/**
 * The one list Discord's profile modal has that has an honest analogue here.
 *
 * §15.1 read its five tabs and recorded the rule: tabs are for lists, the body
 * is for facts. Four of the five — Board, Activity, Wishlist, Mutual Friends —
 * presuppose objects this product has not decided to have, and the assessment
 * refused them by name. «Mutual Servers» became this.
 *
 * It is also what stopped the full tier being pointless. Measured at 390 on
 * 2026-09-21: before it, the full card's sheet left about 890 px of empty
 * ground below its one button; the whole lower half of a phone screen said
 * nothing.
 */

const ME = "u-me";
const ANNA = "u-anna";

function room(id: string, type: "group" | "channel" | "private", ...members: string[]): MutualChatRow {
  return { id, name: id, type, avatar_url: null, members: members.map((user_id) => ({ user_id })) };
}

test("a group both are in is in the list", () => {
  const chats = [room("c1", "group", ME, ANNA)];
  assert.deepEqual(profileMutualChats(chats, ANNA, ME).shown.map((row) => row.id), ["c1"]);
});

test("a channel counts too", () => {
  const chats = [room("c1", "channel", ME, ANNA)];
  assert.equal(profileMutualChats(chats, ANNA, ME).total, 1);
});

test("a group the other person is not in is not in the list", () => {
  const chats = [room("c1", "group", ME), room("c2", "group", ME, ANNA)];
  assert.deepEqual(profileMutualChats(chats, ANNA, ME).shown.map((row) => row.id), ["c2"]);
});

test("a private conversation is never in it", () => {
  // «A group in common» is a fact about a place several people share. The pair
  // itself is not something they have in common with anybody, and it is already
  // one press away on the card. Discord's list is servers, not DMs.
  const chats = [room("c1", "private", ME, ANNA)];
  assert.equal(profileMutualChats(chats, ANNA, ME).total, 0);
});

test("your own card lists nothing", () => {
  // Every group you are in is a group you are in. The answer would be the
  // sidebar.
  const chats = [room("c1", "group", ME, ANNA)];
  assert.equal(profileMutualChats(chats, ME, ME).total, 0);
});

test("no person is no list", () => {
  const chats = [room("c1", "group", ME, ANNA)];
  assert.equal(profileMutualChats(chats, null, ME).total, 0);
  assert.equal(profileMutualChats(chats, undefined, ME).total, 0);
});

test("a chat with no members at all is skipped rather than thrown on", () => {
  const chats: MutualChatRow[] = [{ id: "c1", name: "c1", type: "group", avatar_url: null }];
  assert.equal(profileMutualChats(chats, ANNA, ME).total, 0);
});

test("the limit is five, and the remainder is counted rather than dropped", () => {
  // Five rows of 44 px with an 8 px gap come to 252 px — a section that reads
  // as one at 390 without turning a person's card into a list of chats.
  assert.equal(PROFILE_MUTUAL_CHAT_LIMIT, 5);
  const chats = Array.from({ length: 8 }, (_, at) => room(`c${at}`, "group", ME, ANNA));
  const result = profileMutualChats(chats, ANNA, ME);
  assert.equal(result.shown.length, 5);
  assert.equal(result.hidden, 3);
  assert.equal(result.total, 8);
});

test("the order it is given is the order it keeps", () => {
  // The sidebar hands them over sorted by recent activity, so the five drawn
  // are the five that matter now — the same reason the sidebar is sorted so.
  const chats = [room("b", "group", ME, ANNA), room("a", "group", ME, ANNA)];
  assert.deepEqual(profileMutualChats(chats, ANNA, ME, 2).shown.map((row) => row.id), ["b", "a"]);
});

/**
 * The claim that makes this safe, scanned rather than promised: it asks the
 * server for nothing.
 */
const SOURCE = readFileSync(
  new URL("../../artifacts/kub/src/lib/profileMutualChats.ts", import.meta.url),
  "utf8",
);

test("it is a filter over what the client already holds", () => {
  // No query means no new policy and no new privacy surface: the list it
  // filters IS the reader's own list, so it cannot reveal a group they are not
  // in. That property is the whole reason this list was affordable, and a
  // future `supabase` call in here would quietly remove it.
  assert.ok(!SOURCE.includes("supabase"));
  assert.ok(!SOURCE.includes("createClient"));
  assert.ok(!SOURCE.includes("rpc("));
});

test("only the full card draws it", () => {
  // Tabs — and their honest form when there is one tab, a section — are for
  // lists, and lists belong to the surface you escalate to.
  const compact = readFileSync(
    new URL("../../artifacts/kub/src/components/profile/UserProfileCompact.tsx", import.meta.url),
    "utf8",
  );
  const full = readFileSync(
    new URL("../../artifacts/kub/src/components/chat/MemberCard.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(!compact.includes("mutualChats"));
  assert.ok(full.includes('data-testid="member-card-mutual-chats"'));
});
