import { KubNotice } from "@/components/kub";
import { callReachabilityNotice } from "@/lib/callReachability";
import { getCurrentDistributionTarget } from "@/lib/platform/capabilities";

/**
 * What a call can and cannot do on an iPhone or an iPad, said once.
 *
 * Slice E of `docs/proposals/2026-09-18-one-to-one-calls.md`. The rule and the
 * words are in `lib/callReachability.ts`, which imports nothing and is covered
 * by `tests/unit/call-reachability.test.mts`; what is here is the two facts it
 * needs and the box they go in.
 *
 * **A notice and not a section**, unlike `WindowsStartupSection` next door, and
 * the difference is the point: that one is two switches because there is
 * something to change, and this is a sentence because there is not. A switch
 * that cannot change its outcome is the defect this register spends most of its
 * pages on, and a heading with no control under it invites somebody to add one.
 *
 * `tone="info"` rather than `warn`: the second sentence says the missed call
 * still reaches the conversation, so this is a description of how the app works
 * and not a problem to be fixed. Painting it as a warning would make a permanent
 * property of Safari look like something the person did wrong.
 *
 * Renders nothing on every other shell — see the module's own note on why
 * Windows, Android and a desktop browser each get silence rather than a version
 * of this.
 */
export function IosCallsSection() {
  const notice = callReachabilityNotice({
    target: getCurrentDistributionTarget(),
    // `display-mode: standalone` for the installed app, and Safari's own
    // non-standard `navigator.standalone` for the older iOS that answers only
    // that one. `usePwa.ts:204-205` reads the same pair; this is a render-time
    // read rather than a subscription because moving a page between a tab and an
    // installed app is not something that happens while it is open.
    standalone:
      typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches === true ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true),
  });
  if (!notice) return null;

  return (
    <KubNotice tone="info" title={notice.title} data-testid="ios-calls-notice">
      {notice.text}
    </KubNotice>
  );
}
