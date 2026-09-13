// The administration's user search (D-141).
//
// The field invites «@никнейм» and the «@» used to be sent to PostgREST, where
// usernames carry no «@» and so the invited spelling was the one that matched
// nobody. That is a search which looks broken rather than empty, and from the
// outside those two are indistinguishable — which is why the rule now lives in
// a module a test can load.
import assert from "node:assert/strict";
import test from "node:test";

import {
  adminUserQuery,
  adminUserSearchFilters,
} from "../../artifacts/kub/src/lib/adminUserSearch.ts";

const ID = "3f2a9c14-0e5b-4d7a-9b31-7c6d5e4f8a21";

test("the «@» the placeholder asks for is dropped, not searched for", () => {
  assert.deepEqual(adminUserQuery("@olga"), { term: "olga", id: null });
  assert.deepEqual(adminUserQuery("  @olga  "), { term: "olga", id: null });
  // A typo, not a different person.
  assert.deepEqual(adminUserQuery("@@olga"), { term: "olga", id: null });
  // Only leading: a name that contains one keeps it.
  assert.deepEqual(adminUserQuery("olga@work"), { term: "olga@work", id: null });
});

test("a uuid is recognised as an id, with or without the «@»", () => {
  assert.deepEqual(adminUserQuery(ID), { term: ID, id: ID });
  assert.deepEqual(adminUserQuery(` ${ID} `), { term: ID, id: ID });
  assert.deepEqual(adminUserQuery(`@${ID}`), { term: ID, id: ID });
  assert.equal(adminUserQuery(ID.slice(0, -1)).id, null, "a near-miss is not an id");
  assert.equal(adminUserQuery(ID.replace(/-/g, "")).id, null, "unhyphenated is not an id");
});

test("characters PostgREST would read rather than match are removed", () => {
  // `,` ends a filter inside `or=(…)`, so one of these left in place turns one
  // search into two, or into a parse error.
  assert.equal(adminUserQuery("ol,ga").term, "olga");
  assert.equal(adminUserQuery("ol(ga)").term, "olga");
  // Both `ilike` wildcards: somebody typing one means the character.
  assert.equal(adminUserQuery("ol%ga").term, "olga");
  assert.equal(adminUserQuery("ol*ga").term, "olga");
  assert.equal(adminUserQuery('ol"ga').term, "olga");
  assert.equal(adminUserQuery("ol\\ga").term, "olga");
});

test("nothing typed asks for no filter at all", () => {
  // An empty filter list means "apply none". A list that matched nothing would
  // show an empty table for an empty search box, which is a different claim.
  for (const value of ["", "   ", "@", "@@@", "%", "(),"]) {
    assert.deepEqual(
      adminUserSearchFilters(adminUserQuery(value)),
      [],
      `${JSON.stringify(value)} produced a filter`,
    );
  }
});

test("a name searches both columns, and an id searches all three", () => {
  assert.deepEqual(adminUserSearchFilters(adminUserQuery("@olga")), [
    "full_name.ilike.%olga%",
    "username.ilike.%olga%",
  ]);
  assert.deepEqual(adminUserSearchFilters(adminUserQuery(ID)), [
    `full_name.ilike.%${ID}%`,
    `username.ilike.%${ID}%`,
    `id.eq.${ID}`,
  ]);
});

test("a non-string is a query for nothing, not a crash", () => {
  for (const value of [null, undefined, 7, {}]) {
    assert.deepEqual(
      adminUserQuery(value as unknown as string),
      { term: "", id: null },
      `${JSON.stringify(value)} was not read as empty`,
    );
  }
});
