/**
 * The colours a group may paint a role with, and the rule that an unknown key
 * paints nothing (D-214, D-215).
 *
 * `chat_roles.colour` holds a KEY out of this list — bounded by
 * `^[a-z][a-z0-9_]{1,31}$` under the constraint `chat_roles_colour_palette_key`
 * in `20260918120000_chat_roles_and_member_tags.sql` — and never a hex. The
 * database owns which entry a group chose; the interface owns the palette and
 * both of its theme values.
 *
 * **Why, measured rather than argued.** D-214 took the global role catalogue's
 * free hex colours — picked in exactly the way a free `^#[0-9a-fA-F]{6}$`
 * column here would have invited — and measured them against the three
 * surfaces a chip sits on. Owner `#F5B50A` reads 1.83 / 1.63 / 1.50 in the
 * light theme; manager `#4DCD5E` reads 2.06 / 1.83 / 1.69. The floor for a
 * non-text mark is 3:1, so those are not marginal misses, and the cause is
 * visible in the numbers: both hexes are the DARK palette's own values, used
 * unchanged in a theme nobody measured them in. A free picker per group
 * reproduces that defect once per group, with nobody to audit it.
 *
 * So: eight entries, each with a `--kub-role-<key>` token in BOTH theme blocks
 * of `index.css`, each held to 4.5:1 as TEXT on `--kub-surface`,
 * `--kub-surface-2` and `--kub-surface-3` in both themes by
 * `tests/unit/chat-role-palette.test.mts`. 4.5 and not the 3 a dot answers to,
 * because the mechanic being copied is Discord's, where the colour sits on the
 * member's NAME: a token tuned for a dot cannot later be moved onto a word —
 * `--kub-online` had to be split into `--kub-online-text` for exactly that —
 * and D-214 exists because nobody checked the harder threshold first.
 *
 * **What breaks if this list and the CSS disagree.** A key with no token
 * resolves to a custom property nothing declares, which paints
 * nothing: the role silently loses its colour for every group that picked it,
 * and nothing errors. A token with no key is a colour nobody can choose. The
 * test asserts the two agree in both directions for that reason, and asserts
 * each token is declared inside each theme block rather than inherited from
 * `:root`, since a single shared value is the shape of the original defect.
 *
 * (The paragraph above used to spell a CSS `var()` reference to one of these
 * tokens literally, as an example. `tests/unit/theme-token-contract.test.mjs`
 * scans every source file for such references and
 * cannot tell prose from code, so the example read as a
 * reference to a token nothing defines and turned that guard red. The guard is
 * right and the comment was the thing to change: an undefined custom property
 * resolves to nothing rather than failing, which is invisible until somebody
 * looks at the pixels.)
 *
 * Pure: no React, no browser API, no `@/` alias, so `node --test` reads it.
 */

/**
 * The palette, in the order a picker should show it: the neutral first, then
 * once round the wheel from blue.
 *
 * The order is not arbitrary. Measured on 2026-09-18, the two closest pairs in
 * the whole set are `blue`/`violet` in the dark theme (ΔE*ab 28.0) and
 * `slate`/`teal` in the light one (24.1); neither pair is adjacent here, so the
 * two swatches hardest to tell apart are never shown side by side. If an entry
 * is ever inserted, re-read those numbers from the test rather than assuming
 * this note still holds.
 *
 * Labels are Russian because this is the picker's own text, not an identifier.
 */
export const CHAT_ROLE_COLOURS = [
  { key: "slate", label: "Серый" },
  { key: "blue", label: "Синий" },
  { key: "teal", label: "Бирюзовый" },
  { key: "green", label: "Зелёный" },
  { key: "amber", label: "Янтарный" },
  { key: "orange", label: "Оранжевый" },
  { key: "rose", label: "Розовый" },
  { key: "violet", label: "Фиолетовый" },
] as const;

/** One entry of the palette, as the picker renders it. */
export type ChatRoleColourEntry = (typeof CHAT_ROLE_COLOURS)[number];

/** The value `chat_roles.colour` is allowed to hold and the interface can draw. */
export type ChatRoleColour = ChatRoleColourEntry["key"];

/** The keys alone, in the same order, for a caller that does not need labels. */
export const CHAT_ROLE_COLOUR_KEYS: readonly ChatRoleColour[] = CHAT_ROLE_COLOURS.map(
  (entry) => entry.key,
);

const KEYS = new Set<string>(CHAT_ROLE_COLOUR_KEYS);

/** Whether a value is one of the palette's keys. */
export function isChatRoleColour(value: unknown): value is ChatRoleColour {
  return typeof value === "string" && KEYS.has(value);
}

/**
 * Read a stored colour, or `null` for «render plain».
 *
 * `null` is the migration's stated contract for an unrecognised key (principle
 * 5), and it has to be, because the column's constraint bounds the SHAPE of a
 * key and cannot enumerate this list: a row may legally hold `purple` forever
 * after the palette drops that entry, and the column is nullable besides.
 *
 * Nothing is trimmed, lower-cased or defaulted on the way through, and that is
 * deliberate. `chat_roles_colour_palette_key` already forbids whitespace and
 * upper case, so a value that would need repairing did not come from the
 * database; quietly repairing it would hide whatever produced it, and guessing
 * a default would paint a role in a colour its owner never picked. Rendering
 * plain is the only answer that is both visible and honest.
 */
export function readChatRoleColour(value: unknown): ChatRoleColour | null {
  return isChatRoleColour(value) ? value : null;
}

/**
 * The CSS custom property that holds a key's colour.
 *
 * This exists so that no component spells `--kub-role-` itself. A call site
 * that builds the name by hand is a call site the palette test cannot see, and
 * a typo in it paints nothing rather than failing — the same silent-blank
 * failure the both-directions check in the test is there to prevent.
 */
export function chatRoleColourVariable(key: ChatRoleColour): `--kub-role-${ChatRoleColour}` {
  return `--kub-role-${key}`;
}

/** The same thing as a `var()` reference, ready for a style value. */
export function chatRoleColourValue(key: ChatRoleColour): string {
  return `var(${chatRoleColourVariable(key)})`;
}

/** What the picker calls a key, for a colour read back out of a stored role. */
export function chatRoleColourLabel(key: ChatRoleColour): string {
  const entry = CHAT_ROLE_COLOURS.find((candidate) => candidate.key === key);
  return entry ? entry.label : key;
}
