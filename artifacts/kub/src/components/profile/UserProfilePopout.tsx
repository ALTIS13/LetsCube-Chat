"use client";

import { useCallback, useEffect, useRef } from "react";
import { BesideLayer } from "@/components/ui/AnchoredLayer";
import type { ProfileAnchor } from "@/lib/profileTier";

/**
 * The compact tier's container: a card **beside the face that opened it**.
 *
 * ## The correction this file is
 *
 * The first build of the two-tier profile (D-292) drew the compact tier in a
 * `KubModal` — centred, with a scrim and a ✕ — and the report did not name that
 * as a divergence from the reference, because it was not a decision. It was the
 * path of least resistance, and under the standing delegation a divergence
 * without a written reason is not covered.
 *
 * Discord's popout is anchored to what you pressed, and the reason is not
 * decoration. **The compact tier exists for the glance**: somebody is reading, a
 * name goes past, they want a second of context and to carry on reading. A
 * centred card takes the eye to the middle of the screen and hands it back to a
 * conversation that has meanwhile left attention; a scrim dims the very thing
 * they were reading. Anchoring is what makes the cheap tier cheap.
 *
 * ## What it therefore is, and is not
 *
 * - **No scrim.** The conversation stays lit and stays where it was.
 * - **No focus trap.** A glance is not a task; Escape and an outside press both
 *   end it, and nothing is captured in between.
 * - **It dismisses on the things that mean «I have moved on»**: a press outside
 *   it, Escape, a scroll or a resize. Discord's popout does all four, and a
 *   scroll is the sharpest of them — the card is anchored to a box that has
 *   just moved, so staying open would leave it pointing at nothing.
 *
 * **Every one of those doors goes through one `onClose`**, which is the rule
 * the register already states for the settings screen: a guard written into one
 * container leaves the others exactly as they were. There is nothing to guard
 * here yet — the popout holds no unsaved state — and that is precisely why the
 * single door has to be built now, while it costs a prop.
 */
export function UserProfilePopout({
  anchor,
  onClose,
  children,
}: {
  anchor: ProfileAnchor;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  // One door. Every listener below calls this and nothing calls `onClose`
  // directly, so a guard added later has one place to live.
  const requestClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      requestClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const node = layerRef.current;
      if (!node) return;
      if (event.target instanceof Node && node.contains(event.target)) return;
      requestClose();
    };
    // `true` — the capture phase, so a press inside the conversation closes the
    // popout before the conversation acts on it. Without it the first press
    // after opening both dismisses the card and, say, opens a picture.
    const onScroll = () => requestClose();
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    // Capture again, and this is the one that matters: a scroll inside the
    // message list does not bubble to `window`, so a bubbling listener would
    // never hear the scroll that actually moves the anchor.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [requestClose]);

  return (
    <BesideLayer
      anchor={anchor}
      layerRef={layerRef}
      // `-strong`: it covers a conversation it is not part of, which is rule 11
      // of the material contract and the list `tests/unit/entry-glass.test.mjs`
      // guards. `w-80` is 320 points — Discord's popout is 300 over a 300x105
      // banner, and this is that width on this product's scale.
      className="kub-glass-strong z-[75] w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl"
      role="dialog"
      aria-label="Профиль"
      data-testid="user-profile-popout"
    >
      {() => children}
    </BesideLayer>
  );
}
