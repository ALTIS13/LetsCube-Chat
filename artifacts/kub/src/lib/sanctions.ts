/**
 * Which ban or mute is in force, and what lifting one means (D-134).
 *
 * «Снять блокировку» deleted **every** `bans` row for the person — expired ones
 * included — so lifting a week-old ban erased the record that it had ever
 * happened. The audit log keeps a trace (both tables carry insert and delete
 * triggers, checked on production on 2026-09-14), but «История санкций» in the
 * administration reads the rows, and that history is what an administrator
 * deciding a second sanction looks at.
 *
 * The predicate lives here because two places need it and they must not drift:
 * the query that decides whether a row shows «Снять блокировку» at all, and the
 * delete behind that item. If they disagreed, the button would appear for a
 * restriction the delete does not match, and pressing it would do nothing at
 * all while looking like it worked.
 */

export type SanctionKind = "ban" | "mute";

/**
 * The PostgREST `or=(…)` filter for restrictions that have not run out.
 *
 * A null `expires_at` is permanent, which is why it cannot be expressed as a
 * single comparison. The instant is an argument rather than `Date.now()` so a
 * test can state it, and so the read and the delete in one interaction can be
 * given the same one.
 */
export function activeSanctionFilter(now: Date): string {
  return `expires_at.is.null,expires_at.gt.${now.toISOString()}`;
}

/** Whether one row is a restriction in force at `now`. */
export function isSanctionActive(
  sanction: { expires_at?: string | null },
  now: Date,
): boolean {
  const expires = sanction.expires_at;
  if (expires === null || expires === undefined) return true;
  const at = Date.parse(expires);
  return Number.isFinite(at) ? at > now.getTime() : true;
}

export interface SanctionLiftPrompt {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
}

/**
 * What to ask before lifting one.
 *
 * It says what is ended and what is kept, because the thing an administrator
 * cannot see from the menu is which of those two this does. «Отменить» is not
 * offered as the confirm label anywhere in this product — the confirming button
 * names the action.
 */
export function sanctionLiftPrompt(
  kind: SanctionKind,
  personName: string,
): SanctionLiftPrompt {
  const name = personName.trim() || "этого пользователя";
  return kind === "ban"
    ? {
      title: "Снять блокировку?",
      description:
        `Действующая блокировка для ${name} будет снята сразу. ` +
        "Истёкшие блокировки останутся в истории санкций.",
      confirmLabel: "Снять блокировку",
      cancelLabel: "Отмена",
    }
    : {
      title: "Снять мьют?",
      description:
        `Действующий мьют для ${name} будет снят сразу. ` +
        "Истёкшие мьюты останутся в истории санкций.",
      confirmLabel: "Снять мьют",
      cancelLabel: "Отмена",
    };
}
