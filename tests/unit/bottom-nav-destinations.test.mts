import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BOTTOM_NAV_DESTINATIONS,
  bottomNavDestinations,
} from "../../artifacts/kub/src/lib/bottomNavDestinations.ts";

/**
 * What the phone's bottom capsule offers, and the one rule that decides it.
 *
 * D-120: the bar carried «Папки» while the folder strip sat at the top of the
 * chat list, and the tab opened a second, full-screen folder surface
 * (`FolderListModal`). Two folder surfaces on one screen, where Telegram shows
 * folders at the top only.
 *
 * The list used to be written inline in `BottomNav.tsx`, so the decision could
 * only be checked by a screenshot or by a regex over a component. It is a pure
 * list and a pure gate now, in `lib/bottomNavDestinations.ts`, which imports
 * nothing and is therefore reachable from here in full.
 *
 * Two kinds of check, kept apart:
 *
 *  - the **decisions**, imported and exercised;
 *  - the **absences**, read off the source of the three files that between them
 *    could put a folder door back — because an absence is not something an
 *    import can be asked about.
 *
 * `tests/unit/narrow-phone-typography.test.mjs` owns how much room these labels
 * take at 360px; this file owns which ones exist. The rendered half is the two
 * folder-surface tests in `tests/e2e/desktop-shell.spec.ts`.
 */

const SRC = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, SRC)), "utf8");

const NAV = "components/layout/BottomNav.tsx";
const SIDEBAR = "components/sidebar/Sidebar.tsx";
const STORE = "store/app.store.ts";

/** Comments explain the defect; they must not be read as code that causes it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

test("the capsule offers three destinations, and none of them is folders", () => {
  assert.deepEqual(
    BOTTOM_NAV_DESTINATIONS.map((entry) => entry.id),
    ["chats", "profile", "tasks"],
  );
  assert.deepEqual(
    BOTTOM_NAV_DESTINATIONS.map((entry) => entry.label),
    ["Чаты", "Профиль", "Задачи"],
  );
  // Stated twice on purpose, by id and by word: a tab reintroduced under
  // another name is the same defect, and the word is what the owner reported.
  assert.equal(
    BOTTOM_NAV_DESTINATIONS.some((entry) => /папк/i.test(entry.label) || /folder/i.test(entry.id)),
    false,
    "a folder door is back in the bottom capsule; the folder strip at the top of the chat list is the phone's folder surface (D-120)",
  );
});

test("the gate offers tasks only to an account that may see them", () => {
  assert.deepEqual(bottomNavDestinations(false).map((entry) => entry.id), ["chats", "profile"]);
  assert.deepEqual(bottomNavDestinations(true).map((entry) => entry.id), ["chats", "profile", "tasks"]);
  // The gated one is last, so nothing a person aims at moves when a right
  // changes.
  assert.equal(BOTTOM_NAV_DESTINATIONS.filter((entry) => entry.gated).length, 1);
  assert.equal(BOTTOM_NAV_DESTINATIONS.at(-1)?.gated, true);
});

test("exactly one destination is a route rather than a section", () => {
  const routes = BOTTOM_NAV_DESTINATIONS.filter((entry) => entry.route);
  assert.equal(routes.length, 1);
  assert.equal(routes[0]?.id, "tasks");
  // The store holds the other two, so its union must not carry the route — nor
  // the section the folder tab used to set.
  const store = withoutComments(read(STORE));
  const union = store.match(/mobileSection:\s*([^\n]+)/)?.[1] ?? "";
  assert.ok(union.length > 0, "`mobileSection` is not declared in the store any more");
  for (const absent of ["folders", "tasks"]) {
    assert.doesNotMatch(
      union,
      new RegExp(`'${absent}'`),
      `\`mobileSection\` accepts '${absent}' again: ${union.trim()}`,
    );
  }
  for (const present of ["chats", "profile"]) {
    assert.match(union, new RegExp(`'${present}'`), `\`mobileSection\` no longer accepts '${present}'`);
  }
});

/**
 * The component draws the module's list and does not keep one of its own.
 *
 * Without this the module could be correct while the bar rendered something
 * else entirely, which is the state this file exists to leave behind.
 */
test("the component takes its destinations from the module", () => {
  const nav = withoutComments(read(NAV));
  assert.match(nav, /bottomNavDestinations\(canAccessTasks\)/);
  assert.doesNotMatch(
    nav,
    /label:\s*"/,
    "the bottom bar writes a label of its own again, so the list it draws is no longer the one under test",
  );
});

/**
 * The second folder surface itself.
 *
 * `FolderListModal` was a full-screen folder list the tab opened; the file is
 * deleted, and the column that mounted it must not grow a new door either. The
 * strip is `FolderTabs`, which stays.
 */
test("nothing in the chat-list column opens a second folder surface", () => {
  const sidebar = withoutComments(read(SIDEBAR));
  assert.doesNotMatch(sidebar, /FolderListModal/, "the second folder surface is mounted again (D-120)");
  assert.doesNotMatch(
    sidebar,
    /mobileSection\s*===\s*"folders"/,
    "the folder section is read again, so something is still driving a folder screen from the bar",
  );
  // And the strip is still there, so the assertions above cannot be satisfied
  // by a phone with no folder surface at all.
  assert.match(sidebar, /<FolderTabs/);
  assert.match(sidebar, /<FolderRail/);
  assert.throws(
    () => read("components/sidebar/FolderListModal.tsx"),
    /ENOENT/,
    "FolderListModal.tsx is back on disk",
  );
});

// ── mutation: each guarantee is proved by breaking it ────────────────────────

/**
 * One substitution on a copy of the text, proved applied by the hash rather
 * than by looking for the anchor afterwards — an insertion leaves the anchor in
 * place and would report success either way. A non-unique anchor is refused
 * rather than guessed at.
 */
function mutate(text: string, anchor: string, replacement: string): string {
  const occurrences = text.split(anchor).length - 1;
  assert.equal(occurrences > 0, true, `anchor absent: ${anchor.slice(0, 70)}`);
  assert.equal(occurrences, 1, `anchor is not unique (${occurrences}x): ${anchor.slice(0, 70)}`);
  const before = createHash("sha256").update(text).digest("hex");
  const mutated = text.replace(anchor, replacement);
  assert.notEqual(createHash("sha256").update(mutated).digest("hex"), before);
  return mutated;
}

/** The absence checks, as pure functions of a source text, so both can be run on a mutated copy. */
function sidebarFolderDoors(text: string): string[] {
  const source = withoutComments(text);
  const found: string[] = [];
  if (/FolderListModal/.test(source)) found.push("FolderListModal");
  if (/mobileSection\s*===\s*"folders"/.test(source)) found.push('mobileSection === "folders"');
  return found;
}

function navOwnLabels(text: string): number {
  return [...withoutComments(text).matchAll(/label:\s*"/g)].length;
}

test("the sidebar guarantee fails when the folder screen is mounted again", () => {
  const text = read(SIDEBAR);
  assert.deepEqual(sidebarFolderDoors(text), []);
  const broken = mutate(
    text,
    "      {showNewGroup && (",
    '      {mobileSection === "folders" && <FolderListModal />}\n      {showNewGroup && (',
  );
  assert.deepEqual(sidebarFolderDoors(broken), ["FolderListModal", 'mobileSection === "folders"']);
});

test("the component guarantee fails when the bar writes its own list again", () => {
  const text = read(NAV);
  assert.equal(navOwnLabels(text), 0);
  const broken = mutate(
    text,
    "  const tabs = bottomNavDestinations(canAccessTasks);",
    '  const tabs = [{ id: "chats", label: "Чаты", icon: "chatBubble", route: false, gated: false }];',
  );
  assert.equal(navOwnLabels(broken), 1);
});
