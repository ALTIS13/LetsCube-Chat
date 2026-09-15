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

/** Where a sanction notice in the notification centre leads, if anywhere. */
export type SanctionNoticeTarget = { readonly kind: "chat"; readonly chatId: string } | null;

/**
 * What opens when somebody presses their own ban or mute notice (D-139).
 *
 * `ban_issued` used to open `/admin`, which nobody who receives one can reach:
 * `AdminLayout` redirects anybody who is neither staff nor a support operator
 * straight back to `/`, so the press bounced. And it is not a near miss for a
 * staff member either — measured on production on 2026-09-15,
 * `public._notify_bans_after_insert` posts the notice to `new.user_id` and to
 * nobody else, so its only recipient is ever the banned person. Two such rows
 * exist today.
 *
 * The server had already decided this. Its own push payload builds a `url` for
 * `chat_added`, `mute_issued`, the task kinds — and for `ban_issued` leaves it
 * null, because «Вы заблокированы» is the whole message and there is nothing to
 * open. The client invented a destination the server never claimed.
 *
 * A mute is different and keeps its behaviour: it is issued in a chat, and that
 * chat is where the person finds out what it means. Without a `chat_id` in the
 * payload it too leads nowhere rather than somewhere arbitrary.
 */
export function sanctionNoticeTarget(
  kind: string,
  chatId: string | null | undefined,
): SanctionNoticeTarget {
  if (kind === "mute_issued") {
    const chat = (chatId ?? "").trim();
    return chat ? { kind: "chat", chatId: chat } : null;
  }
  return null;
}
