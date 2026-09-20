"use client";

import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { VoiceCallBar } from "@/components/chat/VoiceCallBar";
import { VoiceResumeNotice } from "@/components/chat/VoiceResumeNotice";
import { voiceShellBarNeeded } from "@/lib/voiceShellBar";

/**
 * The running call, on the screens that are not the messenger.
 *
 * `lib/voiceShellBar.ts` holds the rule — which locations draw a bar of their
 * own and which need this one — and the defect it exists for. What is here is
 * the placement, and the one thing about it that is easy to get wrong.
 *
 * ## The room is taken from the page, not held in front of it
 *
 * Every page inside this wrapper sizes itself with `h-app`, which is
 * `height: var(--kub-app-height)` — the whole viewport. A band drawn over such
 * a page covers its last row; a band drawn above it makes the document one bar
 * taller than the screen and pushes that row off the bottom instead. Both are
 * the same defect wearing different clothes.
 *
 * So the wrapper is the full height, the bar takes what it needs from the top,
 * and the page is told the viewport is the rest: `--kub-app-height: 100%`
 * inside the box that holds it, so its own `h-app` resolves against what is
 * left rather than against the screen. The page shortens, exactly as the chat
 * list shortens under the docked bar on a computer.
 *
 * **And it leaves nothing behind.** That is why the reservation is a variable
 * on a flex child rather than padding on this element. Padding is a number
 * somebody has to remember to take away again, and the day it is not taken
 * away the reader gets a band of the application's own ground in the shape of
 * a bar that is no longer there — which the owner saw on 2026-09-12 and which
 * `MainLayout` carries a comment about. Here there is no number: when there is
 * no call `VoiceCallBar` renders nothing at all, the flex child is the whole
 * height, `100%` of it is the whole height, and the page is laid out precisely
 * as it was before this wrapper existed.
 *
 * ## Why it wraps every route rather than only the ones that need it
 *
 * Wrapping is unconditional and the *bar* is conditional, because a wrapper
 * that appeared and disappeared around the router would remount the page under
 * it on every navigation into and out of the messenger — losing scroll
 * position, open panels and any state a page holds. With the wrapper constant,
 * a navigation changes only whether a band is drawn.
 *
 * `px-safe` on the bar's own box rather than on this one: an iPhone held
 * sideways keeps 59pt of each long edge, and the pages inside already apply
 * that inset themselves. Applying it here as well would indent them twice.
 */
export function VoiceCallShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const needed = voiceShellBarNeeded(location);

  return (
    <div className="flex h-app flex-col" data-testid="voice-call-shell">
      {/* Zero-height when there is no call, and zero-height when the route
          draws its own bar — an empty `shrink-0` box lays out as nothing. */}
      {/* `capsuleOnScreen={false}`: there is no conversation pane on these
          pages, so the rule must not stand the bar down because the chat the
          call is in happens to be the one still selected in the store. */}
      <div className="shrink-0 px-safe" data-testid="voice-call-shell-band">
        {needed && <VoiceCallBar placement="top" capsuleOnScreen={false} />}
      </div>
      <div className="min-h-0 flex-1 [--kub-app-height:100%]">{children}</div>
      {/* Coming back to a call somebody was taken out of. Here, and not inside
          `MainLayout`, for the same reason the bar above is: this wrapper is
          constant across every authenticated route, so a return can never
          happen on a screen where the bar that says «the microphone is live»
          is not also mounted. It draws nothing unless there is an offer to
          make, and the returning itself is silent. */}
      <VoiceResumeNotice />
    </div>
  );
}
