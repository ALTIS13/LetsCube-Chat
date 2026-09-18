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

/**
 * How much of the palette's own colour survives on the conversation's
 * wallpaper. The rest is the theme's text colour. See below.
 */
export const CHAT_ROLE_ON_CHAT_STRENGTH = 80;

/**
 * The same colour, composed for the conversation's wallpaper.
 *
 * **This exists because the wallpaper is a FOURTH surface, and the palette was
 * measured on three.** `tests/unit/chat-role-palette.test.mts` holds every entry
 * at 4.5:1 on `--kub-surface`, `--kub-surface-2` and `--kub-surface-3`; a
 * message's author line sits on none of them. It sits on `.chat-bg`, which is
 * `--kub-chat-ground` under `--kub-chat-wallpaper` — and in the LIGHT theme
 * that composite is darker than all three panel surfaces, darkest at the
 * bottom-left, which is exactly where author names are.
 *
 * Measured off the rendered pixels at 1440 on 2026-09-18, the modal ground
 * inside each name's own box, top of the conversation to bottom:
 *
 *     y=50   rgb(217,228,245)   slate 6.40
 *     y=160  rgb(214,226,244)   blue  4.57
 *     y=277  rgb(212,224,243)   green 4.54
 *     y=451  rgb(207,218,242)   rose  4.27
 *     y=509  rgb(203,212,240)   violet 4.11
 *     y=625  rgb(200,203,240)   blue  3.77
 *     y=741  rgb(199,197,238)   green 3.65
 *
 * So the raw token starts at the 4.5 line at the top of the window and is a
 * fifth under it at the bottom — where a conversation opens. The dark theme has
 * no such problem: the same measurement reads 6.23 to 7.03 throughout, because
 * `--kub-chat-ground` is darker there than any panel surface rather than
 * lighter. That is D-214's shape one surface further along, and it was found by
 * photographing the change rather than by reading the palette's guarantee.
 *
 * **What this does.** It keeps 80% of the palette's colour and takes 20% of
 * `--kub-text`, which is the theme's own extreme: near-black in the light theme,
 * so the colour darkens and gains contrast on a light ground, and near-white in
 * the dark one, so it lightens on a dark ground. One expression, both
 * directions, and it carries no hard-coded colour of its own — which is why it
 * is not the material written by hand that `interface-material.md` rule 1
 * forbids. Measured against the worst ground above: light 4.63 to 6.04, dark
 * 7.25 to 7.58.
 *
 * **What it costs, stated rather than hidden.** Pulling every entry toward one
 * neutral compresses them. The closest pair in the light theme, `slate`/`teal`,
 * goes from ΔE*ab 24.1 to 19.9, a hair under the 20 the palette test holds a
 * member list's chips to. That floor is set for two short words side by side in
 * a 280px row; two author names are multi-word and a message apart. It is
 * recorded here because the honest fix is not this at all: it is a
 * `--kub-role-*` set declared inside `.kub-chat-screen` in `index.css`, next to
 * the `--kub-cyan`, `--kub-muted` and `--kub-accent-text` that block already
 * re-points for exactly this reason — «the values measured over the tinted
 * wallpaper». That is a change to `index.css`, which the work that found this
 * was not allowed to make.
 */
export function chatRoleColourOnChat(key: ChatRoleColour): string {
  return `color-mix(in srgb, ${chatRoleColourValue(key)} ${CHAT_ROLE_ON_CHAT_STRENGTH}%, var(--kub-text))`;
}

/** What the picker calls a key, for a colour read back out of a stored role. */
export function chatRoleColourLabel(key: ChatRoleColour): string {
  const entry = CHAT_ROLE_COLOURS.find((candidate) => candidate.key === key);
  return entry ? entry.label : key;
}
