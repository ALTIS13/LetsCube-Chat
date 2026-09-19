/**
 * When a new web build may be put in front of somebody, and what pressing it costs.
 *
 * ## The update already applies itself
 *
 * A deploy reaches a browser without being asked. The next launch fetches
 * `index.html` from the network — the worker's navigation handler is
 * network-first — so the page boots the new build, and the waiting worker then
 * hands over on the spot rather than waiting for a prompt (see
 * `serviceWorkerHandoff.ts`: when the asking page is the worker's own build and
 * the only window of the origin, it calls `skipWaiting` itself). Nothing has to
 * be pressed for a routine deploy to land.
 *
 * That is also what the two clients this was modelled on do. Telegram Desktop
 * installs a downloaded update on the next start with no prompt at all —
 * `sandbox.cpp` logs «installing update instead of starting app...» — and
 * Discord's desktop host applies pending modules on its splash screen before
 * the window opens.
 *
 * ## So the notice is an offer, and it is never a question
 *
 * Neither client offers a way to dismiss one. Discord's web client renders a
 * single icon button in the toolbar and `null` in every other state; Telegram
 * Desktop puts one button at the bottom of the chat list, Telegram Web A one in
 * the left column. None of the three is a card over the conversation, and none
 * of them has a «Later»: there is nothing to postpone, because the update
 * arrives at the next launch either way. Ours had «Позже», which is what turned
 * a statement into a question.
 *
 * ## And it is throttled, because most deploys are not news
 *
 * Discord's web client polls `version.stable.json` and, when the answer is not
 * marked `required`, shows the button **at most once every seven days** on
 * stable — a `lastNonRequiredUpdateShown` timestamp in `localStorage` gates it
 * (one day on ptb and canary). A build the server marks `required` skips the
 * throttle and appears at once. Read live from the production bundle on
 * 2026-09-20, where `version.stable.json` answered `{"hash":"…","required":false}`.
 *
 * We take the same shape and the same stable interval. `required` is wired
 * through and is **always false today**: nothing in the release manifest or in
 * the service worker's build record marks a web build as required, so there is
 * no way to raise one. That signal belongs beside the desktop's, which already
 * has it — `mandatory` in the native manifest, `critical_update_required` in
 * `platform/desktopUpdates.ts`, and a blocking gate to render it. Adding it for
 * the web is a separate piece of work; until then the parameter documents the
 * hole rather than hiding it.
 *
 * ## The one thing worth asking about
 *
 * Taking the update means reloading, and this application loses more to a
 * reload than a person expects: `selectedChatId` lives only in `app.store.ts`,
 * is not in the URL and is not persisted, so the reload lands on the chat list.
 * That is also why nothing here ever reloads on its own — a silent reload would
 * trade a visible interruption for an invisible loss. Discord's web client
 * likewise never reloads except on a click.
 *
 * A connected voice call is the one loss large enough that Discord interrupts
 * for it, and it is the only confirmation in their whole update path: «Briefly
 * leave voice?» / «Updating Discord while in a voice channel will cause you to
 * leave briefly.» / «Cancel» / «Update anyway!». We ask the same question, in
 * the pill rather than in a modal.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

/** Discord's stable-channel interval for a build that is not marked required. */
export const ROUTINE_NOTICE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Where the last time the notice was shown is remembered, per browser. */
export const APP_UPDATE_NOTICE_SHOWN_KEY = "letscube:app-update:last-shown";

export type UpdateNoticeInput = {
  /** A build newer than the one this page booted is deployed. */
  pending: boolean;
  /**
   * The deploy declares itself required. No web build can declare this today;
   * see the note above for where the signal would have to come from.
   */
  required: boolean;
  /** When this browser last saw the notice, or `null` if it never has. */
  lastShownAt: number | null;
  now: number;
};

/**
 * Whether the notice may be put in front of somebody now.
 *
 * A required build is never throttled. A routine one waits out the interval
 * from the last time the notice was shown — not from the last deploy, so a week
 * of deploys costs one notice rather than one each.
 */
export function shouldShowUpdateNotice({ pending, required, lastShownAt, now }: UpdateNoticeInput): boolean {
  if (!pending) return false;
  if (required) return true;
  if (lastShownAt === null) return true;
  // A clock that has gone backwards — a corrected device, a restored profile —
  // must not lock the notice out until the stored time comes round again.
  if (lastShownAt > now) return true;
  return now - lastShownAt >= ROUTINE_NOTICE_INTERVAL_MS;
}

/** A timestamp read back from storage, or `null` for anything unusable. */
export function parseLastShownAt(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export type UpdateActionInput = {
  /** A voice call is connected or connecting, so a reload would drop it. */
  callActive: boolean;
  /** The person has already been told the call would drop and pressed again. */
  acknowledged: boolean;
};

/** `confirm` asks Discord's one question; `restart` takes the update. */
export type UpdateAction = "restart" | "confirm";

export function updateAction({ callActive, acknowledged }: UpdateActionInput): UpdateAction {
  return callActive && !acknowledged ? "confirm" : "restart";
}
