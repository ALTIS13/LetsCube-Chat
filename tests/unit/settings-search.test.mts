import assert from "node:assert/strict";
import test from "node:test";

import {
  SETTINGS_ROWS,
  SETTINGS_SECTION_TITLES,
  matchSettingsRows,
  settingsSearchResult,
  visibleSettingsSections,
  type SettingsRowId,
} from "../../artifacts/kub/src/lib/settingsRows.ts";

/**
 * The search over the settings screen (D-160).
 *
 * The screen had none at all: fourteen rows under four headings, 332px of them
 * below the fold at 1440, and the only way to a row was to know where it was.
 * These are the claims the column's field rests on — that an empty query is the
 * whole screen, that a person who types what they call the thing finds it even
 * when that word is not the label, that a heading finds its whole block, and
 * that the staff row is unreachable for everyone else through the search as
 * well as through the rendering.
 *
 * The engine is reachable from here at all because `lib/settingsRows.ts`
 * imports nothing — the module-boundary lesson CLAUDE.md records for
 * `isSupabaseConfigured()`. It deliberately does not search over *values*
 * («Тёмная», «Включены», «40%»), which come from hooks; pulling those in would
 * cost the module that property.
 */

const EVERYONE = { isStaff: false };
const STAFF = { isStaff: true };

const idsOf = (rows: readonly { id: SettingsRowId }[]) => rows.map((row) => row.id);

test("an empty query is the whole screen, in the order the screen draws it", () => {
  const all = matchSettingsRows("", EVERYONE);
  assert.deepEqual(idsOf(all), [
    "name", "username", "bio", "phone", "decoration",
    "push", "push-messages", "push-tasks", "push-invites",
    "presence",
    "theme", "audio", "updates",
  ]);
  // Whitespace is not a query. A field holding only spaces must not empty the
  // screen it is meant to narrow.
  assert.deepEqual(idsOf(matchSettingsRows("   ", EVERYONE)), idsOf(all));
});

test("a row is found by its own label, whatever the case", () => {
  assert.deepEqual(idsOf(matchSettingsRows("Никнейм", EVERYONE)), ["username"]);
  assert.deepEqual(idsOf(matchSettingsRows("никнейм", EVERYONE)), ["username"]);
  assert.deepEqual(idsOf(matchSettingsRows("  ТЕМА  ", EVERYONE)), ["theme"]);
});

test("a row is found by what a person calls it, not only by what it is called", () => {
  // None of these words appears in the label of the row it must find. This is
  // the half a label-only match cannot do.
  assert.deepEqual(idsOf(matchSettingsRows("микрофон", EVERYONE)), ["audio"]);
  assert.deepEqual(idsOf(matchSettingsRows("онлайн", EVERYONE)), ["presence"]);
  assert.deepEqual(idsOf(matchSettingsRows("версия", EVERYONE)), ["updates"]);
  assert.deepEqual(idsOf(matchSettingsRows("фио", EVERYONE)), ["name"]);
  assert.deepEqual(idsOf(matchSettingsRows("рамка", EVERYONE)), ["decoration"]);
});

test("a heading finds the whole block under it", () => {
  const result = settingsSearchResult("конфиденциальность", EVERYONE);
  assert.deepEqual([...result.sections], ["privacy"]);
  assert.deepEqual(idsOf(matchSettingsRows("конфиденциальность", EVERYONE)), ["presence"]);

  // «Уведомления» is both a heading and part of one row's label. The heading
  // has to win the whole section rather than the row winning alone.
  const notifications = settingsSearchResult("уведомления", EVERYONE);
  assert.deepEqual([...notifications.sections], ["notifications"]);
  assert.equal(notifications.total, 4);
  assert.equal(notifications.rows.has("push-tasks"), true);
});

test("a query that narrows to one section says so", () => {
  const result = settingsSearchResult("тема", EVERYONE);
  assert.equal(result.total, 1);
  assert.deepEqual([...result.sections], ["application"]);
  assert.equal(result.rows.has("theme"), true);
  assert.equal(result.rows.has("phone"), false);
});

test("a query that matches nothing leaves no heading standing over nothing", () => {
  const result = settingsSearchResult("кибер-арена", EVERYONE);
  assert.equal(result.total, 0);
  assert.deepEqual([...result.sections], []);
  assert.equal(result.rows.size, 0);
});

test("every section the result names still has a row in it", () => {
  // The failure this forbids is a heading drawn over an empty block, which is
  // what a section-title match with no surviving rows would leave behind.
  for (const query of ["", "push", "п", "о", "настройк", "тема", "админ"]) {
    for (const flags of [EVERYONE, STAFF]) {
      const result = settingsSearchResult(query, flags);
      const matched = matchSettingsRows(query, flags);
      for (const section of result.sections) {
        assert.ok(
          matched.some((row) => row.section === section),
          `«${query}» named the section ${section} with no row under it`,
        );
      }
      assert.equal(result.total, matched.length);
    }
  }
});

test("the staff row is out of reach of the search too, not only of the rendering", () => {
  // Hiding a row and still returning it from the search is how a staff-only
  // entry leaks: the column would draw the «Сервис» heading for everyone.
  assert.deepEqual(idsOf(matchSettingsRows("админ", EVERYONE)), []);
  assert.deepEqual([...settingsSearchResult("админ", EVERYONE).sections], []);

  assert.deepEqual(idsOf(matchSettingsRows("админ", STAFF)), ["admin"]);
  assert.deepEqual([...settingsSearchResult("админ", STAFF).sections], ["service"]);
  // And by a synonym, which is the road a label-only match leaves open.
  assert.deepEqual(idsOf(matchSettingsRows("баны", STAFF)), ["admin"]);
  assert.deepEqual(idsOf(matchSettingsRows("баны", EVERYONE)), []);

  assert.equal(matchSettingsRows("", STAFF).length, matchSettingsRows("", EVERYONE).length + 1);
});

test("the catalogue and the section list agree with each other", () => {
  const sections = visibleSettingsSections(STAFF);
  const seen = new Set<string>();
  for (const row of SETTINGS_ROWS) {
    assert.ok(sections.includes(row.section), `${row.id} is in no section the screen draws`);
    assert.ok(SETTINGS_SECTION_TITLES[row.section], `${row.section} has no heading`);
    assert.equal(seen.has(row.id), false, `${row.id} appears twice`);
    seen.add(row.id);
    assert.ok(row.label.trim().length > 0, `${row.id} has no label`);
  }
  // Every heading the screen can draw belongs to at least one row, or it is a
  // section that exists only as a title.
  for (const section of sections) {
    assert.ok(
      SETTINGS_ROWS.some((row) => row.section === section),
      `the section ${section} has no rows`,
    );
  }
});

test("the catalogue is not handed out for mutation", () => {
  // `matchSettingsRows` returns a filtered copy, so a caller cannot reorder or
  // empty the screen for everyone else by keeping the array it was given.
  const first = matchSettingsRows("", EVERYONE) as { id: SettingsRowId }[];
  const length = first.length;
  first.length = 0;
  assert.equal(matchSettingsRows("", EVERYONE).length, length);
  assert.equal(SETTINGS_ROWS.length, 14);
});
