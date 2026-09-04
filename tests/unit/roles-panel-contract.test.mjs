// What the roles panel must keep doing, asserted against its source.
//
// The arithmetic lives in `roleHierarchy.ts` and is tested directly in
// role-hierarchy.test.mts. What is left here is everything that is only true
// because of how the component is wired: the column that must not carry its own
// scrollbar, the categories that must start closed, the arrow that must not
// quietly rewrite a role while it moves it, and the sentence that stops a
// visible hierarchy from being read as an access ladder.
//
// Each assertion below was checked by reverting the change it protects.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PANEL_PATH = "artifacts/kub/src/pages/admin/RolesPermissionsTab.tsx";
const source = readFileSync(PANEL_PATH, "utf8");

/**
 * The source with its comments removed.
 *
 * A class name may be named in prose — the note above the roles column names
 * the two classes it deliberately does not carry — and a check for a rendered
 * class must not be satisfied, or defeated, by a sentence about it.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .split(/\r?\n/u)
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");

/** The body of a top-level arrow function or handler, by name. */
function block(name) {
  const start = source.indexOf(name);
  assert.notEqual(start, -1, `${name} is gone from the panel`);
  let depth = 0;
  let started = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
      started = true;
    } else if (char === "}") {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced braces after ${name}`);
}

// ---------------------------------------------------------------------
// The column the owner pointed at
// ---------------------------------------------------------------------

test("the roles column scrolls with the page and not inside itself", () => {
  // It was `max-h-[520px] overflow-y-auto`: thirteen roles read four at a time
  // through a letterbox, inside a page that already scrolls.
  assert.doesNotMatch(code, /max-h-\[/u, "a height cap is back on a column of this page");
  assert.doesNotMatch(code, /overflow-y-auto/u, "a nested vertical scroller is back");
});

// ---------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------

test("the list is drawn from the hierarchy, not from the query order", () => {
  assert.match(source, /buildRoleHierarchy\(rolesState\.roles\)/u);
  assert.match(source, /roleHierarchy\.map\(\(group\)/u);
  // The old render walked the raw array, which sorts admin above owner. (The
  // lookup maps built from the same array are not a render and stay.)
  assert.doesNotMatch(source, /\{rolesState\.roles\.map\(/u);
  // The picker and the default selection follow the same order as the list.
  assert.match(source, /sortRolesByHierarchy\(rolesState\.roles\)/u);
  assert.match(source, /orderedRoles\[0\]/u);
});

test("a shared rank is shown rather than smoothed over", () => {
  assert.match(code, /\{sharesRank && \(/u);
  assert.match(code, /Равный ранг с другой ролью/u);
  // The rank itself is spelled out, not implied by the row's position.
  assert.match(code, /Ранг \{rank\} · \{role\.key\}/u);
});

test("both arrows exist, are labelled, and are disabled by the same planner that moves them", () => {
  assert.match(source, /planPriorityMove\(rolesState\.roles, role\.id, "up"\)/u);
  assert.match(source, /planPriorityMove\(rolesState\.roles, role\.id, "down"\)/u);
  assert.match(source, /disabled=\{upTarget === null \|\| saving !== null\}/u);
  assert.match(source, /disabled=\{downTarget === null \|\| saving !== null\}/u);
  assert.match(source, /aria-label=\{`Поднять роль «\$\{label\}» в списке`\}/u);
  assert.match(source, /aria-label=\{`Опустить роль «\$\{label\}» в списке`\}/u);
  // Buttons, not drag handles: the reorder has to work from a keyboard.
  assert.doesNotMatch(source, /draggable/u);
  assert.doesNotMatch(source, /onDragStart/u);
});

test("moving a role sends the row's own values and never the form's", () => {
  const move = block("const moveRole = async");
  // `role_update` rewrites name, description and is_active from its arguments,
  // and reads a null p_is_active as `true`. Sending anything else here would
  // let an arrow press commit half-typed text, or revive the three chat roles
  // that were deactivated on purpose.
  assert.match(move, /p_name: role\.name/u);
  assert.match(move, /p_description: role\.description/u);
  assert.match(move, /p_is_active: role\.is_active/u);
  assert.doesNotMatch(move, /p_is_active: true/u);
  assert.doesNotMatch(move, /editName|editDescription|editActive/u);
  // A move is a move: it must not carry a colour or a permission set with it.
  assert.doesNotMatch(move, /p_colour/u);
  assert.doesNotMatch(move, /p_permission_keys/u);
});

test("saving a role carries the rank and the colour through the one write path", () => {
  const save = block("const saveRole = async");
  assert.match(save, /p_priority: priority/u);
  assert.match(save, /p_colour: colour/u);
  assert.match(save, /parseRolePriorityInput\(editPriority\)/u);
  // Both are refused client-side before the round trip, so the administrator
  // gets a sentence rather than a constraint violation.
  assert.match(save, /if \(priority === null\)/u);
  assert.match(save, /normalizeRoleColour\(colourText\)/u);
  assert.match(save, /if \(colourText && colour === null\)/u);
});

// ---------------------------------------------------------------------
// The colour
// ---------------------------------------------------------------------

test("a colour reaches a style attribute only after being validated", () => {
  assert.match(source, /type="color"/u);
  assert.match(source, /roleSwatchColour\(role\)/u);
  // Every inline background is the validated value and nothing else.
  const backgrounds = [...source.matchAll(/backgroundColor:\s*([^\s,}]+)/gu)].map((match) => match[1]);
  assert.ok(backgrounds.length > 0, "the swatch no longer paints anything");
  for (const value of backgrounds) {
    assert.equal(value, "swatch", `an unvalidated value reaches a style attribute: ${value}`);
  }
  assert.doesNotMatch(source, /style=\{\{[^}]*role\.colour/u);
  assert.doesNotMatch(source, /style=\{\{[^}]*editColour/u);
  // The picker needs a well-formed value even when the role has none.
  assert.match(source, /value=\{normalizeRoleColour\(editColour\) \?\? COLOUR_PICKER_FALLBACK\}/u);
});

test("the panel admits that a colour cannot be removed here", () => {
  // `role_update` reads a null p_colour as "leave as is", so there is no value
  // that clears one. Offering a «убрать» button would be a lie.
  assert.match(source, /Цвет можно поменять, но не убрать/u);
});

// ---------------------------------------------------------------------
// The density
// ---------------------------------------------------------------------

test("permission categories start collapsed and count what is enabled", () => {
  assert.match(
    source,
    /const \[openCategories, setOpenCategories\] = useState<Set<string>>\(\(\) => new Set\(\)\)/u,
    "categories no longer start collapsed",
  );
  assert.match(source, /const open = openCategories\.has\(category\)/u);
  assert.match(
    source,
    /permissions\.filter\(\(permission\) => selectedPermissions\.has\(permission\.key\)\)\.length/u,
  );
  assert.match(source, /\{enabled\} \/ \{permissions\.length\}/u);
  assert.match(source, /Включено \{enabled\} из \{permissions\.length\}/u);
  // The checkboxes exist only while the category is open.
  assert.match(source, /\{open && \(\s*<div id=\{panelId\}/u);
});

test("the collapse is a real disclosure a keyboard can drive", () => {
  assert.match(source, /aria-expanded=\{open\}/u);
  assert.match(source, /aria-controls=\{panelId\}/u);
  assert.match(source, /const panelId = `role-permission-category-\$\{category\}`/u);
  const toggle = source.match(/<button[^>]*onClick=\{\(\) => toggleCategory\(category\)\}[\s\S]{0,400}?>/u);
  assert.ok(toggle, "the category header is no longer a button");
  assert.match(toggle[0], /type="button"/u);
});

// ---------------------------------------------------------------------
// The thing a visible hierarchy must not imply
// ---------------------------------------------------------------------

test("the panel says in words that the order grants nothing", () => {
  assert.match(source, /Порядок — только внешний вид списка/u);
  assert.match(source, /Он не даёт роли прав/u);
  // And it is rendered above the list, not left in a constant nobody reads.
  assert.match(source, /\{PRIORITY_IS_NOT_POWER\}/u);
  // The rank field repeats it where the number is typed.
  assert.match(source, /Только порядок, не доступ/u);
  // Confirming a move repeats it once more, because that is when someone has
  // just changed the ladder and is most likely to conclude they changed power.
  assert.match(source, /Порядок ролей обновлён\. На права это не влияет\./u);
  // The standing statement about the two roles the checkboxes cannot constrain.
  assert.match(source, /Владелец и тех\. администратор всегда получают полный доступ/u);
});

test("the form is only refilled when the selected role's own data changed", () => {
  // The effect watches two whole arrays, so a realtime event about any other
  // role used to throw away half-typed text.
  assert.match(source, /roleFormSignature\(selectedRole, permissionKeys\)/u);
  assert.match(source, /if \(formSignatureRef\.current === signature\) return;/u);
});
