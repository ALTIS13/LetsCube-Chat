/**
 * What the administration's user search actually looks for (D-141).
 *
 * The field says «Поиск по имени, @никнейму или ID», and until this module
 * existed the «@» went straight into `username.ilike.%@olga%`. Usernames are
 * stored without it, so the one spelling the field explicitly invited was the
 * one spelling that matched nobody — a search that looks broken rather than
 * empty, and there is no way to tell those two apart from the outside.
 *
 * It lives here rather than inside `UsersTab` for the usual reason: the rule is
 * worth a test and the component is not loadable by `node --test`.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Characters that would otherwise be read by PostgREST rather than matched.
 *
 * `,` ends a filter inside `or=(…)` and `(` `)` delimit it, so either one turns
 * one search into two or into a parse error. `%` and `*` are both `ilike`
 * wildcards, and a person typing one means the character, not "anything".
 */
const POSTGREST_SPECIAL = /[%*,()"\\]/g;

export interface AdminUserQuery {
  /** What names and usernames are matched against. Empty means no filter. */
  readonly term: string;
  /** An exact id to match as well, when what was typed is a uuid. */
  readonly id: string | null;
}

/**
 * Read what was typed.
 *
 * A leading «@» is dropped — every one of them, because «@@olga» is a typo and
 * not a different person. The id is recognised after that strip, which costs
 * nothing: a uuid never begins with «@».
 */
export function adminUserQuery(raw: string): AdminUserQuery {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const withoutAt = trimmed.replace(/^@+/, "").trim();
  const term = withoutAt.replace(POSTGREST_SPECIAL, "").trim();
  return { term, id: UUID_PATTERN.test(withoutAt) ? withoutAt : null };
}

/**
 * The `or=(…)` filters for one query, or an empty list when there is nothing to
 * look for. An empty list is the caller's signal to apply no filter at all
 * rather than to apply one that matches nothing.
 */
export function adminUserSearchFilters(query: AdminUserQuery): string[] {
  // No early return for "nothing typed": both branches below already decline,
  // and a guard in front of them is a line no test can turn red. Removing it
  // was the answer to that mutation rather than writing a test that pretends
  // to reach it.
  const filters: string[] = [];
  if (query.term) {
    filters.push(`full_name.ilike.%${query.term}%`);
    filters.push(`username.ilike.%${query.term}%`);
  }
  if (query.id) filters.push(`id.eq.${query.id}`);
  return filters;
}
