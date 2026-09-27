import assert from "node:assert/strict";
import test from "node:test";

import {
  contactDisplayName,
  filterAndSortContacts,
  normalizeContactAlias,
} from "../../artifacts/kub/src/lib/userContacts.ts";

const contacts = [
  { contact_user_id: "1", alias: "Коллега", profile: { full_name: "Анна", username: "anna" } },
  { contact_user_id: "2", alias: null, profile: { full_name: "Борис", username: "boris" } },
  { contact_user_id: "3", alias: null, profile: { full_name: null, username: "zeta" } },
];

test("private alias is trimmed, bounded, and optional", () => {
  assert.equal(normalizeContactAlias("  Коллега  "), "Коллега");
  assert.equal(normalizeContactAlias("   "), null);
  assert.throws(() => normalizeContactAlias("а".repeat(65)), /64/);
});

test("a private alias changes the display name without changing the public profile", () => {
  assert.equal(contactDisplayName(contacts[0]), "Коллега");
  assert.equal(contactDisplayName(contacts[1]), "Борис");
  assert.equal(contactDisplayName(contacts[2]), "@zeta");
  assert.equal(contacts[0].profile.full_name, "Анна");
});

test("contacts are searched by alias, public name, and username and sorted for the viewer", () => {
  assert.deepEqual(filterAndSortContacts(contacts, "кол").map((item) => item.contact_user_id), ["1"]);
  assert.deepEqual(filterAndSortContacts(contacts, "@anna").map((item) => item.contact_user_id), ["1"]);
  assert.deepEqual(filterAndSortContacts(contacts, "Бор").map((item) => item.contact_user_id), ["2"]);
  assert.deepEqual(filterAndSortContacts(contacts, "").map((item) => item.contact_user_id), ["3", "2", "1"]);
});
