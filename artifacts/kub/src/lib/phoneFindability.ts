/**
 * Who can find a person by their telephone number — tracker item 74.
 *
 * Telegram's setting, read on 2026-09-30 in its Android client
 * (`PrivacyControlActivity.java`): offered when nobody may see the number —
 * always so here, where no screen shows anybody's number but staff's — with two
 * answers, everybody and my contacts, and everybody when nothing is stored.
 * «Мои контакты» are the people this person has saved (`user_contacts`), as
 * Telegram's are.
 *
 * The database decides every lookup (`search_profiles_by_phone`); this is the
 * choice and the words for it. Pure, so `node --test` holds it
 * (`tests/unit/phone-findability.test.mts`).
 */

export type PhoneFindableBy = "everybody" | "contacts";

export interface PhoneFindOption {
  readonly id: PhoneFindableBy;
  readonly label: string;
  readonly hint: string;
}

export const PHONE_FIND_OPTIONS: readonly PhoneFindOption[] = [
  { id: "everybody", label: "Все", hint: "Кто знает ваш номер, найдёт вас в поиске" },
  { id: "contacts", label: "Мои контакты", hint: "Только люди из ваших контактов" },
];

export const PHONE_FIND_DEFAULT: PhoneFindableBy = "everybody";

export function isPhoneFindableBy(value: unknown): value is PhoneFindableBy {
  return value === "everybody" || value === "contacts";
}

/** The row's value: the answer, in its own words. */
export function phoneFindSummary(value: PhoneFindableBy): string {
  return PHONE_FIND_OPTIONS.find((option) => option.id === value)?.label ?? "Все";
}

/**
 * The sentence under the choice. What a number reveals is the question the
 * setting answers, so it says so; and a number that is not verified finds
 * nobody at all, whatever is chosen, which it says too rather than letting the
 * choice look like it does something.
 */
export function phoneFindNote(state: { readonly verified: boolean | null }): string {
  const base = "Сам номер никому не показывается — по нему только находят.";
  if (state.verified === false) return `${base} Пока номер не подтверждён, по нему вас не найти.`;
  return base;
}
