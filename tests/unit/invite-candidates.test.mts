// Who the invite list offers and in what order (D-170).
//
// The entry is «There is no way to invite anyone who is not already findable by
// name». The screen's own answer to that used to be a blank box behind a
// two-character gate; the answer here is the order — people you already share a
// chat with first — plus the states a row can be in, lifted out of the
// component so they can be argued about without a browser.
import assert from "node:assert/strict";
import test from "node:test";

import {
  canInviteCandidate,
  inviteCandidateName,
  inviteCandidateState,
  matchesInviteSearch,
  orderInviteCandidates,
  peopleAlreadyInYourChats,
} from "../../artifacts/kub/src/lib/inviteCandidates.ts";

const ME = "00000000-0000-4000-8000-00000000000a";
const ANNA = "00000000-0000-4000-8000-00000000000b";
const BORIS = "00000000-0000-4000-8000-00000000000c";
const VERA = "00000000-0000-4000-8000-00000000000d";

const person = (id: string, full_name: string | null, username: string | null = null) => ({
  id,
  full_name,
  username,
});

type StateInput = Parameters<typeof inviteCandidateState>[0];

const stateOf = (personId: string, over: Partial<StateInput> = {}) =>
  inviteCandidateState({
    personId,
    myId: ME,
    memberIds: new Set<string>(),
    inviteStatuses: {},
    sentIds: new Set<string>(),
    ...over,
  });

test("the people you already talk to come from the chat list, at no cost", () => {
  const known = peopleAlreadyInYourChats(
    [
      { members: [{ user_id: ME }, { user_id: ANNA }] },
      { members: [{ user_id: ME }], other_user: { id: BORIS } },
      { members: null, other_user: null },
    ],
    ME,
  );
  assert.deepEqual([...known].sort(), [ANNA, BORIS].sort());
  // Never yourself, however many chats you are in.
  assert.equal(known.has(ME), false);
});

test("an absent chat list is an empty answer, not a throw", () => {
  assert.equal(peopleAlreadyInYourChats(null, ME).size, 0);
  assert.equal(peopleAlreadyInYourChats(undefined, null).size, 0);
  assert.equal(peopleAlreadyInYourChats([{}], ME).size, 0);
});

test("a private chat's other_user counts, which is the strongest signal there is", () => {
  const known = peopleAlreadyInYourChats([{ other_user: { id: VERA } }], ME);
  assert.deepEqual([...known], [VERA]);
});

test("every state a row can be in", () => {
  assert.equal(stateOf(ME), "self");
  assert.equal(stateOf(ANNA, { memberIds: new Set([ANNA]) }), "member");
  assert.equal(stateOf(ANNA, { sentIds: new Set([ANNA]) }), "pending");
  assert.equal(stateOf(ANNA, { inviteStatuses: { [ANNA]: "pending" } }), "pending");
  assert.equal(stateOf(ANNA, { inviteStatuses: { [ANNA]: "declined" } }), "declined");
  assert.equal(stateOf(ANNA, { inviteStatuses: { [ANNA]: "cancelled" } }), "cancelled");
  assert.equal(stateOf(ANNA, { inviteStatuses: { [ANNA]: "expired" } }), "expired");
  assert.equal(stateOf(ANNA), "available");
});

test("accepted and no longer a member is «former», which can be asked again", () => {
  // The chat's invitations still carry «accepted» for somebody who joined and
  // has since left. Showing that as «accepted» would offer nothing at all.
  assert.equal(stateOf(ANNA, { inviteStatuses: { [ANNA]: "accepted" } }), "former");
  assert.equal(canInviteCandidate("former"), true);
  // And membership wins over the invitation that produced it.
  assert.equal(
    stateOf(ANNA, { memberIds: new Set([ANNA]) , inviteStatuses: { [ANNA]: "accepted" } }),
    "member",
  );
});

test("only three states do nothing when pressed", () => {
  const inert = ["self", "member", "pending"] as const;
  for (const state of inert) assert.equal(canInviteCandidate(state), false, state);
  for (const state of ["available", "former", "declined", "cancelled", "expired"] as const) {
    assert.equal(canInviteCandidate(state), true, state);
  }
});

test("a session's own invitation outranks the statuses the first read returned", () => {
  // The read happens once when the screen opens; an invitation sent afterwards
  // has to move the row without it.
  assert.equal(
    stateOf(ANNA, { sentIds: new Set([ANNA]), inviteStatuses: { [ANNA]: "declined" } }),
    "pending",
  );
});

test("people you share a chat with are listed first", () => {
  const ordered = orderInviteCandidates({
    people: [person(VERA, "Аня Яковлева"), person(ANNA, "Яна Абрамова")],
    knownIds: new Set([ANNA]),
    memberIds: new Set<string>(),
    myId: ME,
    searching: false,
  });
  // Яна sorts after Аня by name, and comes first anyway because she is known.
  assert.deepEqual(ordered.map((p) => p.id), [ANNA, VERA]);
});

test("within a group the order is name then id, which is total and stable", () => {
  const ordered = orderInviteCandidates({
    people: [person(VERA, "борис"), person(BORIS, "Борис"), person(ANNA, "Анна")],
    knownIds: new Set<string>(),
    memberIds: new Set<string>(),
    myId: ME,
    searching: false,
  });
  // Case folds, so the two «Борис» tie on name and the id breaks it.
  assert.deepEqual(ordered.map((p) => p.id), [ANNA, BORIS, VERA]);
});

test("the signed-in person is never in the list", () => {
  const ordered = orderInviteCandidates({
    people: [person(ME, "Я сам"), person(ANNA, "Анна")],
    knownIds: new Set([ME, ANNA]),
    memberIds: new Set<string>(),
    myId: ME,
    searching: true,
  });
  assert.deepEqual(ordered.map((p) => p.id), [ANNA]);
});

test("members are hidden while nothing is typed and shown once something is", () => {
  const input = {
    people: [person(ANNA, "Анна"), person(BORIS, "Борис")],
    knownIds: new Set<string>(),
    memberIds: new Set([ANNA]),
    myId: ME,
  };
  assert.deepEqual(
    orderInviteCandidates({ ...input, searching: false }).map((p) => p.id),
    [BORIS],
  );
  // A search for somebody who is already a member must say so rather than
  // answer nothing, which cannot be told from a search that never ran.
  assert.deepEqual(
    orderInviteCandidates({ ...input, searching: true }).map((p) => p.id),
    [ANNA, BORIS],
  );
});

test("the same person from two sources is listed once", () => {
  const ordered = orderInviteCandidates({
    people: [person(ANNA, "Анна"), person(ANNA, "Анна"), person(BORIS, "Борис")],
    knownIds: new Set([ANNA]),
    memberIds: new Set<string>(),
    myId: ME,
    searching: false,
  });
  assert.deepEqual(ordered.map((p) => p.id), [ANNA, BORIS]);
});

test("a row with no id is dropped rather than drawn empty", () => {
  const ordered = orderInviteCandidates({
    people: [{ id: "", full_name: "Ничей" }, person(ANNA, "Анна")],
    knownIds: new Set<string>(),
    memberIds: new Set<string>(),
    myId: ME,
    searching: false,
  });
  assert.deepEqual(ordered.map((p) => p.id), [ANNA]);
});

test("the local filter folds case", () => {
  const anna = person(ANNA, "Анна Смирнова", "anna_s");
  assert.equal(matchesInviteSearch(anna, "СМИРН"), true);
  assert.equal(matchesInviteSearch(anna, "смирн"), true);
  assert.equal(matchesInviteSearch(anna, "Ёлка"), false);
});

test("the local filter matches the никнейм, with or without the «@»", () => {
  const anna = person(ANNA, "Анна Смирнова", "anna_s");
  assert.equal(matchesInviteSearch(anna, "@anna_s"), true);
  assert.equal(matchesInviteSearch(anna, "anna_s"), true);
  // The underscore is matched as itself here, the character people type.
  assert.equal(matchesInviteSearch(anna, "anna s"), false);
});

test("nothing typed matches everybody, so the list opens full", () => {
  const anna = person(ANNA, "Анна", null);
  assert.equal(matchesInviteSearch(anna, ""), true);
  assert.equal(matchesInviteSearch(anna, "   "), true);
  assert.equal(matchesInviteSearch(anna, "@"), true);
});

test("a person with neither name is still named something", () => {
  assert.equal(inviteCandidateName(person(ANNA, "Анна Смирнова", "anna")), "Анна Смирнова");
  assert.equal(inviteCandidateName(person(ANNA, "   ", "anna")), "@anna");
  assert.equal(inviteCandidateName(person(ANNA, null, null)), "Без имени");
  assert.equal(inviteCandidateName({ id: ANNA }), "Без имени");
});
