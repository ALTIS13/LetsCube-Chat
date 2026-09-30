/**
 * Which people a search shows (2026-09-30).
 *
 * A tester using the product for work: «когда пользуешься поиском там мало
 * людей и постоянно мелькает «…», «…» и другая залупа. Мы можем не показывать
 * всех пользователей, а только тех кого ищем + поиск по номеру нужен?» Every
 * people search here matched any name that merely contained the letters typed —
 * from the second letter in the sidebar, from the first in a new chat and in
 * contacts — so two letters brought up anybody whose display name held them
 * anywhere, whatever it said.
 *
 * Telegram keeps two answers apart, read 2026-09-30. Its client sends one
 * `contacts.search` and shows the server's `my_results`, the people the reader
 * already has, apart from `results`, the global ones (`SearchAdapterHelper.
 * java`), and the API documents the global half as «users found by username
 * substring» (core.telegram.org/method/contacts.search): a stranger is found by
 * the handle, never by the name they chose to display. The people the reader
 * already has are matched on the device by a name that starts with the query or
 * has a word that does, or a handle that starts with it (`MessagesStorage.
 * localSearch`: `name.startsWith(q) || name.contains(" " + q)`,
 * `username.startsWith(q)`).
 *
 * Ours, the same split:
 * - somebody the reader already has — a contact, or a member of one of their
 *   conversations — by the start of the name or of any word in it, or of the
 *   handle, from the first letter;
 * - anybody else by the start of the handle, from the third letter, or by a
 *   verified phone number (`search_profiles_by_phone`) — never by the name.
 *
 * A prefix rather than Telegram's substring for a stranger's handle: somebody
 * typing a handle types its beginning, and a fragment from its middle is
 * exactly how two letters found a stranger nobody was looking for.
 *
 * Pure, so `node --test` decides every case.
 */

/** A stranger's handle is matched from this many letters. */
export const STRANGER_HANDLE_MIN = 3;

export interface SearchablePerson {
  readonly id: string;
  readonly full_name?: string | null;
  readonly username?: string | null;
}

function fold(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ");
}

/** What the reader typed, as the rule compares it: no leading «@», case and «ё» folded. */
export function peopleSearchNeedle(query: string): string {
  return fold(query).replace(/^@+/, "");
}

/** Whether one person answers the query, given whether the reader already has them. */
export function personMatchesSearch(person: SearchablePerson, needle: string, known: boolean): boolean {
  if (!needle) return false;
  const handle = fold(person.username ?? "");
  if (!known) return needle.length >= STRANGER_HANDLE_MIN && handle !== "" && handle.startsWith(needle);
  const name = fold(person.full_name ?? "");
  return (
    (name !== "" && (name.startsWith(needle) || name.includes(` ${needle}`) || name.includes(`-${needle}`)))
    || (handle !== "" && handle.startsWith(needle))
  );
}

/**
 * The people the reader already has: themselves, their contacts, and everybody
 * in a conversation with them.
 */
export function knownPeopleIds(
  chats: readonly { readonly members?: readonly { readonly user_id: string }[] | null }[],
  contactIds: Iterable<string>,
  selfId: string | null,
): Set<string> {
  const known = new Set<string>(contactIds);
  if (selfId) known.add(selfId);
  for (const chat of chats) {
    for (const member of chat.members ?? []) known.add(member.user_id);
  }
  return known;
}

/**
 * A search result's person, from what a result row carries: the title is the
 * displayed name unless it is the handle itself, and the handle is the subtitle
 * that starts with «@».
 */
export function personOfSearchRow(row: {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string | null;
  readonly profile?: { readonly full_name?: string | null; readonly username?: string | null } | null;
}): SearchablePerson {
  if (row.profile) return { id: row.id, full_name: row.profile.full_name, username: row.profile.username };
  const handle = row.subtitle?.startsWith("@") ? row.subtitle.slice(1) : null;
  const name = row.title.startsWith("@") ? null : row.title;
  return { id: row.id, full_name: name, username: handle };
}
