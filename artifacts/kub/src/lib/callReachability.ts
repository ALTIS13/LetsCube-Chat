/**
 * Where a call can reach somebody, and where the product has to say it cannot.
 *
 * Slice E of `docs/proposals/2026-09-18-one-to-one-calls.md`. Section 3 of that
 * proposal measured the ring shell by shell, and one answer is a flat no with no
 * setting behind it: **the installed iPhone app cannot ring while it is in the
 * background.** Not «not yet», not «once we build it» — Safari suspends the
 * page, a Web Push notification is the only thing that arrives, and a
 * notification is not a ring: it does not sound until the system decides to, it
 * cannot be cancelled when the caller hangs up, and there is nothing to answer.
 *
 * So the interface says so. That is the whole of this module.
 *
 * ── Why only iOS, when several shells have a version of this ───────────────
 *
 * Every shell is limited somewhere, and saying all of it would be four
 * sentences nobody asked for — three of which would be wrong by the time they
 * were read:
 *
 * - **Windows** rings while it is running, and «make it be running» is a
 *   setting the product now has (`WindowsStartupSection`, slice D2). A notice
 *   here would duplicate a control that sits two rows away and does something.
 * - **Android** cannot ring closed *today*, and slice D is how it will: a high
 *   priority message, a short TTL, a call notification channel. Writing «it
 *   cannot» would be recording a schedule as a fact.
 * - **A browser tab** that somebody closed is a browser tab somebody closed.
 *   The product does not explain that mail stops arriving in a closed tab
 *   either.
 *
 * iOS is the one where the limitation is permanent, invisible, and specifically
 * about calls. That is what earns a sentence.
 *
 * ── The second half of the sentence matters as much as the first ───────────
 *
 * «…но пропущенный звонок появится в переписке» is true because slice C made it
 * true: a ring that runs out is written down by a sweep that needs no client to
 * be present. Before that migration this sentence would have been a promise the
 * system did not keep, and it is worth knowing that the copy depends on it — if
 * the sweep is ever rolled back, this paragraph becomes a lie rather than merely
 * stale.
 *
 * Imports nothing, like `micGate.ts` and `voiceRing.ts` beside it: the shape of
 * the two facts comes in as arguments, so the rule is reachable from
 * `node --test` without a browser, a user agent or a display mode.
 */

/** What the two facts a caller has to supply look like. */
export interface CallReachabilityInput {
  /** `getCurrentDistributionTarget()`'s answer, as a plain string. */
  readonly target: string;
  /** Whether the page is running as an installed application rather than a tab. */
  readonly standalone: boolean;
}

export interface CallReachabilityNotice {
  readonly title: string;
  readonly text: string;
}

/**
 * The iPhone and the iPad, installed or in Safari — the shells this applies to.
 *
 * A tab is included deliberately, and it is the case somebody actually meets:
 * an iPhone browser tab that is not in front is suspended exactly as the
 * installed app is, so «only while it is open» is true of both. What differs is
 * only the noun, and the sentence is written to work for either.
 *
 * Anything else — every desktop target, Android, a browser on a computer —
 * answers `false` and gets nothing. See the note above on why.
 */
export function callsNeedThisAppOpen(input: CallReachabilityInput): boolean {
  // `ios_pwa`, which is what `detectDistributionTarget` calls it — and it is
  // **not iPhone-only**: that function groups iPad in, by user agent and by the
  // `MacIntel` + `maxTouchPoints > 1` pair an iPad reports. So the wording below
  // names both. Caught by reading the detector rather than by the name of the
  // constant, which says `ios` and means more than it says.
  return input.target === "ios_pwa";
}

/**
 * What to say, or null when there is nothing true to say here.
 *
 * Two sentences and no control, because there is no control: a switch that
 * cannot change the outcome is the defect this project spends most of its
 * register on. The first sentence is the limitation, the second is what the
 * product does instead — and the second is why this is a notice rather than a
 * warning. Somebody who reads it should come away knowing they will not miss
 * that a call happened, only that their phone will not ring for it.
 */
export function callReachabilityNotice(
  input: CallReachabilityInput,
): CallReachabilityNotice | null {
  if (!callsNeedThisAppOpen(input)) return null;
  const app = input.standalone ? "приложение LETSCUBE открыто" : "эта вкладка открыта";
  return {
    title: "Звонки на iPhone и iPad",
    text:
      `Входящий звонок приходит, только пока ${app} и находится на экране. ` +
      "Свернули или закрыли — звонка не будет: Safari останавливает страницу, " +
      "и обойти это нельзя. Пропущенный звонок всё равно появится в переписке.",
  };
}
