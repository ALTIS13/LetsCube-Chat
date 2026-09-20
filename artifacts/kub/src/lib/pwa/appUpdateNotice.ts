/**
 * When a new web build may be put in front of somebody, when it may be taken
 * without asking, and what pressing it costs.
 *
 * ## An update is a reload, and a tab that is never reloaded never takes one
 *
 * This file used to open by saying the update applies itself, because the next
 * launch fetches `index.html` from the network — the worker's navigation
 * handler is network-first — and the waiting worker then hands over on the spot
 * (`serviceWorkerHandoff.ts`). All of that is true, and all of it is about a
 * *launch*. `skipWaiting` changes which worker controls the page; the
 * JavaScript already loaded into the document is untouched and keeps running
 * until a navigation. So for somebody who keeps one tab open for days — which
 * is how this product is actually used — there is no next launch, and the
 * update never arrives. That is the defect this module now exists to fix, and
 * it is why the question below is "when is a reload free", not "how do we hand
 * over faster".
 *
 * Telegram Desktop installs a downloaded update on the next start with no
 * prompt at all — `sandbox.cpp` logs «installing update instead of starting
 * app...» — and Discord's desktop host applies pending modules on its splash
 * screen before the window opens. Both are the same trick: do it at a launch.
 * Neither answers the held-open tab, which is ours to answer.
 *
 * ## So the notice is an offer, and it is never a question
 *
 * Neither client offers a way to dismiss one. Discord's web client renders a
 * single icon button in the toolbar and `null` in every other state; Telegram
 * Desktop puts one button at the bottom of the chat list, Telegram Web A one in
 * the left column. None of the three is a card over the conversation, and none
 * of them has a «Позже»: there is nothing to postpone. Ours had one, which is
 * what turned a statement into a question.
 *
 * ## The throttle is ours now, and it is set from our own cadence
 *
 * It used to be seven days, copied from Discord's **stable** channel. The same
 * paragraph recorded that Discord uses one day on ptb and canary — that is, it
 * sets the throttle from how often the channel ships, and we had taken the
 * number belonging to the channel least like ours.
 *
 * Measured against production, `letscube-web`, 2026-08-21 to 2026-09-20, from
 * Coolify's own deployment records: **242 successful deploys of 238 distinct
 * commits, on 21 of those 30 days. Median gap between two of them 28 minutes,
 * mean and p90 both 3 hours, and the single longest quiet stretch 101 hours** —
 * four days, still shorter than the throttle it was subject to. In the measured
 * window one notice would have covered all 242, which is not a throttle, it is
 * silence.
 *
 * One hour is above the median gap, so a burst of deploys still costs one
 * notice rather than one each, and it is far below any session this product
 * sees, so a build cannot go unmentioned for longer than an hour of being
 * pending. It is deliberately shorter than the one day Discord gives its
 * fastest channel, because ours ships faster than that channel does.
 *
 * ## And most of the time nobody should be asked at all
 *
 * The reason nothing used to reload on its own was real: `selectedChatId` lives
 * only in `app.store.ts`, is not in the URL and is not persisted, so a reload
 * lands on the chat list. That is a cost, so it was never paid. But it is not a
 * cost in every state — and where it is nil, asking is worse than acting.
 *
 * `shouldRestartQuietly` is the rule for that, and it is deliberately narrow:
 * it fires only where a reload would land the page exactly where it already is,
 * with nothing running that a reload would end. What the conditions are and why
 * each of them is reachable is written beside it.
 *
 * **Its two vetoes are placeholders for something that does not exist yet.**
 * Queue item 35 of `docs/PRODUCTION_PRIORITY_TRACKER.md` is the standing rule
 * they stand in for: «where you were» — the conversation and the voice channel
 * — is state the product owns and restores, across a reload, across an update
 * it applied itself, and across a connection drop. Until a reload puts somebody
 * back in the conversation they had open, "no conversation open" is the only
 * honest way to say "this reload is free"; and until a reload rejoins the call,
 * "no call" is not a preference but the whole of the argument. Widen either of
 * them only after the matching restoration exists and has been proved.
 *
 * ## The one thing worth asking about
 *
 * A connected voice call is the one loss large enough that Discord interrupts
 * for it, and it is the only confirmation in their whole update path: «Briefly
 * leave voice?» / «Updating Discord while in a voice channel will cause you to
 * leave briefly. You're probably going to update anyway but, you know, just
 * warning you.» / «Cancel» / «Update anyway!» — read from their string table on
 * 2026-09-20, second sentence included, which our earlier note had cut. We ask
 * the same question, in the pill rather than in a modal — and a quiet restart
 * never overrides it.
 *
 * Theirs guards `RTC_CONNECTED` alone. Ours also covers `joining`,
 * `reconnecting` and a live ring, because a narrower guard is right for a
 * client that can rejoin after a reload and we cannot. That difference, and the
 * one about reloading without a click, are argued in section 9 of
 * `docs/operations/reference-clients.md` rather than here.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

/**
 * How long a routine build waits between notices.
 *
 * One hour, set from our own deploy cadence rather than from Discord's stable
 * channel; the measurement is in the note above.
 */
export const ROUTINE_NOTICE_INTERVAL_MS = 60 * 60 * 1000;

/** Where the last time the notice was shown is remembered, per browser. */
export const APP_UPDATE_NOTICE_SHOWN_KEY = "letscube:app-update:last-shown";

/** Where the last quiet restart is remembered, for this tab only. */
export const APP_UPDATE_QUIET_RESTART_KEY = "letscube:app-update:quiet-restart";

/**
 * How long a tab has to have been hidden before reloading it is free.
 *
 * Long enough that somebody switching windows for a moment does not come back
 * to a booting application; short enough that a tab left in the background
 * takes the next deploy rather than the one after it.
 */
export const QUIET_HIDDEN_MS = 60 * 1000;

/**
 * How long a visible tab has to have gone untouched instead.
 *
 * A person who has not moved the pointer, pressed a key or touched the screen
 * for ten minutes is not mid-anything; ten minutes is also comfortably longer
 * than reading a conversation without typing in it.
 */
export const QUIET_IDLE_MS = 10 * 60 * 1000;

/**
 * How long a tab refuses to restart itself again.
 *
 * A restart that does not take — the deploy is mid-rollover and the same bundle
 * comes back, two replicas disagree, a proxy holds a stale document — makes the
 * page pending again the moment it boots. Without this the tab would reload
 * itself in a loop, in the background, where nobody would see it happening.
 */
export const QUIET_RESTART_COOLDOWN_MS = 30 * 60 * 1000;

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
 * from the last time the notice was shown — not from the last deploy, so an
 * hour of deploys costs one notice rather than one each.
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

export type QuietRestartInput = {
  /** A build newer than the one this page booted is deployed. */
  pending: boolean;
  /**
   * A call is connected, connecting or putting itself back, or a ring is live.
   *
   * The hard one. The owner sits in a voice channel for hours; a reload ends
   * the call and there is no rejoin after one, so this can never be traded
   * against convenience. It stays until that rejoin exists and is proved.
   */
  callBusy: boolean;
  /**
   * A conversation is open.
   *
   * A reload lands on the chat list, because `selectedChatId` is neither in the
   * URL nor persisted. So the reload is free exactly when the page is already
   * on the chat list — it lands where it already is. This also covers the
   * composer: `MessageInput` only exists inside an open conversation, and so do
   * a recording in progress and a staged attachment being uploaded.
   *
   * A separate "unsent draft" condition was considered and left out because it
   * could not be reached: the draft is written to `localStorage` per chat and
   * read back when the composer mounts (`MessageInput.tsx`), so the text
   * survives a reload; and typing is interaction, so the idle clock below
   * already covers somebody who is mid-word. A condition that cannot decide
   * anything is worse than a missing one — it reads like a guarantee.
   */
  conversationOpen: boolean;
  /** When the tab was last hidden, or `null` while it is visible. */
  hiddenSince: number | null;
  /** When somebody last touched this tab: a pointer, a key, a touch. */
  lastInteractionAt: number;
  /** When this tab last restarted itself, or `null` if it never has. */
  lastQuietRestartAt: number | null;
  now: number;
};

/**
 * Whether this tab may take the new build now, without asking.
 *
 * Every clause here is a veto, and the safe direction is always "do not
 * reload" — the opposite of `shouldShowUpdateNotice`, where the safe direction
 * is to speak up. So a clock that has gone backwards makes a tab look freshly
 * hidden and freshly touched rather than long abandoned, and a restart stamp in
 * the future keeps the cooldown closed rather than opening it.
 */
export function shouldRestartQuietly({
  pending,
  callBusy,
  conversationOpen,
  hiddenSince,
  lastInteractionAt,
  lastQuietRestartAt,
  now,
}: QuietRestartInput): boolean {
  if (!pending) return false;
  if (callBusy) return false;
  if (conversationOpen) return false;
  if (lastQuietRestartAt !== null && now - lastQuietRestartAt < QUIET_RESTART_COOLDOWN_MS) return false;
  const hiddenLongEnough = hiddenSince !== null && now - hiddenSince >= QUIET_HIDDEN_MS;
  const idleLongEnough = now - lastInteractionAt >= QUIET_IDLE_MS;
  return hiddenLongEnough || idleLongEnough;
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
