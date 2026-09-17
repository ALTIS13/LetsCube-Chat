// The administration's user search (D-141).
//
// The field invites «@никнейм» and the «@» used to be sent to PostgREST, where
// usernames carry no «@» and so the invited spelling was the one that matched
// nobody. That is a search which looks broken rather than empty, and from the
// outside those two are indistinguishable — which is why the rule now lives in
// a module a test can load.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("the underscore survives, because a никнейм is allowed to contain one", () => {
  // Not in the list above, and the omission was load-bearing. `GroupInviteModal`
  // carried its own copy of this rule that replaced «_» with a space, and
  // Postgres answers false to 'anna_s' ILIKE '%anna s%' — so 4 of the 11
  // usernames on this deployment could not be found by typing them out in full.
  // Nothing here turned red when that copy was written, which is why it drifted.
  //
  // «_» is ILIKE's single-character wildcard, so leaving it in is *wider* than
  // the character typed — 'annaXs' matches too. Wider finds the person; removing
  // it finds nobody, and only one of those two mistakes is recoverable by the
  // reader.
  assert.equal(adminUserQuery("anna_s").term, "anna_s");
  assert.equal(adminUserQuery("@anna_s").term, "anna_s");
  assert.deepEqual(adminUserSearchFilters(adminUserQuery("anna_s")), [
    "full_name.ilike.%anna_s%",
    "username.ilike.%anna_s%",
  ]);
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

// ---------------------------------------------------------------------------
// Who asks, read as source.
//
// Every test above can pass while a screen builds the filter itself, and two
// of them did: `GroupInviteModal` stripped «_» (D-170) and `NewGroupModal`
// escaped nothing at all, so a «,» or a «(» in the field broke `or=(…)`
// outright and the step showed an empty list without saying why.
// ---------------------------------------------------------------------------

const CONSUMERS = [
  "artifacts/kub/src/pages/admin/UsersTab.tsx",
  "artifacts/kub/src/components/chat/GroupInviteModal.tsx",
  "artifacts/kub/src/components/sidebar/NewGroupModal.tsx",
];

test("every people-search screen builds its filter here", () => {
  for (const file of CONSUMERS) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      source.includes("adminUserQuery(") && source.includes("adminUserSearchFilters("),
      `${file}: builds its own people filter again instead of asking this module`,
    );
    // The inline spelling, in the shape all three had it. A screen that still
    // writes this has a second rule whatever else it imports.
    assert.ok(
      !source.includes("full_name.ilike.%${"),
      `${file}: the ilike filter is spelled inline again`,
    );
  }
});
