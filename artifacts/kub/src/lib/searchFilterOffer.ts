/**
 * What the in-chat search offers under its field (tracker item 36 c).
 *
 * The owner, 2026-09-20: «функция поиска удобно показывает что можно сделать
 * и даёт выбрать нужную функцию нажатием». Ours already parsed `from:`, `has:`,
 * `before:` and `after:` inside a conversation and offered none of them — the
 * field was bare, and the chips appeared only for somebody who already knew the
 * grammar. Discord's in-chat search, read in its bundle (reference-clients
 * §15.3), answers with a popout on the empty field: a row per filter, each
 * naming what it does with the syntax beneath it, and a press inserts the
 * prefix without searching. Inside a `from:` it completes people; inside a
 * `has:` its fixed set.
 *
 * Pure, so `node --test` decides every case; the component only draws it.
 */

export type SearchFilterOffer =
  | { readonly kind: "filters" }
  | { readonly kind: "from"; readonly partial: string; readonly start: number }
  | { readonly kind: "has"; readonly partial: string; readonly start: number }
  | { readonly kind: "in"; readonly partial: string; readonly start: number }
  | { readonly kind: "none" };

/**
 * Which field is asking: the search inside one conversation, or the sidebar's
 * search of everything (tracker item 36 c, its global half).
 *
 * They differ in two places. `in:` means something only in the global one —
 * inside a conversation there is nowhere else to be. And the global field's
 * empty state already belongs to the quick switch, which offers where to go, so
 * it offers no filters there.
 */
export type SearchFilterScope = "chat" | "global";

/**
 * The four rows of an empty field, in Discord's order for the ones we have.
 *
 * A hint is written the way the parser reads it, with no space after the
 * colon. Discord prints «from: user» and its grammar takes the space; ours does
 * not, so its spelling here would teach a query that searches for the words.
 */
export const SEARCH_FILTER_ROWS: readonly { readonly prefix: string; readonly title: string; readonly hint: string }[] = [
  { prefix: "from:", title: "От участника", hint: "from:имя" },
  { prefix: "has:", title: "Содержит вложение", hint: "has:фото, видео, файл, ссылка, аудио" },
  { prefix: "before:", title: "До даты", hint: "before:2026-09-01" },
  { prefix: "after:", title: "После даты", hint: "after:2026-09-01" },
];

/** `has:`'s values, with the words the chips already print for them. */
export const SEARCH_HAS_CHOICES: readonly { readonly value: string; readonly label: string }[] = [
  { value: "image", label: "Фото" },
  { value: "video", label: "Видео" },
  { value: "file", label: "Файл" },
  { value: "link", label: "Ссылка" },
  { value: "audio", label: "Аудио" },
];

const QUOTED_OPEN = /(^|\s)(from|has|in):"([^"]*)$/i;
const UNQUOTED = /(^|\s)(from|has|in):([^\s"]*)$/i;

/**
 * What to offer for this text.
 *
 * An empty field is an offer of the filters. A `from:` or `has:` still being
 * typed at the end of the text is an offer of its values — quoted or not, since
 * a name with a space in it is written in quotes. Anything else offers nothing:
 * somebody typing words is searching, and a list under the field would cover
 * the results they are waiting for.
 */
export function searchFilterOffer(query: string, scope: SearchFilterScope = "chat"): SearchFilterOffer {
  if (query.trim() === "") return scope === "chat" ? { kind: "filters" } : { kind: "none" };
  const match = QUOTED_OPEN.exec(query) ?? UNQUOTED.exec(query);
  if (!match) return { kind: "none" };
  const start = (match.index ?? 0) + match[1].length;
  const key = match[2].toLowerCase();
  if (key === "in") return scope === "global" ? { kind: "in", partial: match[3], start } : { kind: "none" };
  return key === "from"
    ? { kind: "from", partial: match[3], start }
    : { kind: "has", partial: match[3], start };
}

/** A value as the grammar reads it: quoted when it has a space in it. */
export function searchValueToken(value: string): string {
  const clean = value.replace(/"/g, "").trim();
  return /\s/.test(clean) ? `"${clean}"` : clean;
}

/**
 * The text with its unfinished filter replaced by a finished one, and a space
 * after it so the next word starts clean.
 */
export function completeSearchFilter(query: string, start: number, key: "from" | "has" | "in", value: string): string {
  return `${query.slice(0, start)}${key}:${searchValueToken(value)} `;
}

/** A prefix pressed on the empty field: the field becomes the prefix, ready for its value. */
export function insertSearchPrefix(query: string, prefix: string): string {
  const before = query.trim();
  return before ? `${before} ${prefix}` : prefix;
}

/** Whether somebody's name or никнейм holds what was typed after `from:`. */
export function personMatchesSearch(person: { name: string; username?: string | null }, partial: string): boolean {
  const needle = partial.replace(/^@+/, "").toLocaleLowerCase("ru-RU");
  if (!needle) return true;
  return person.name.toLocaleLowerCase("ru-RU").includes(needle) ||
    Boolean(person.username && person.username.toLocaleLowerCase("ru-RU").includes(needle));
}

/** Whether a conversation's name holds what was typed after `in:`. */
export function chatNameMatchesSearch(name: string, partial: string): boolean {
  const needle = partial.replace(/"/g, "").trim().toLocaleLowerCase("ru-RU");
  if (!needle) return true;
  return name.toLocaleLowerCase("ru-RU").includes(needle);
}
