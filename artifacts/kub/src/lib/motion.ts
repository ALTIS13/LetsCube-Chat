/**
 * The semantic motion contract for LETSCUBE.
 *
 * Durations are named here and nowhere else. A component that writes its own
 * `duration-150` is outside the system: it drifts silently, and nothing catches
 * it. These five names cover every transition the interface needs, and the CSS
 * variables in `index.css` carry the same numbers so markup and script agree.
 *
 * Two rules travel with them and are not negotiable per component:
 * layout dimensions are never animated for decorative feedback — a list that
 * animates its own height drags chat scroll anchoring with it — and an
 * essential action never waits for an animation to finish.
 */
export const MOTION_MS = Object.freeze({
  /** A press, a tap highlight: felt rather than seen. */
  instant: 90,
  /** Hover, row highlight, colour changes on a control. */
  fast: 140,
  /** A panel, a popover, a menu opening in place. */
  standard: 220,
  /** A modal or a full-surface transition, where the eye needs leading. */
  emphasis: 320,
  /** How long a transient confirmation stays readable before it leaves. */
  feedback: 2400,
});

export type MotionName = keyof typeof MOTION_MS;

export type FeedbackKind = "success" | "info" | "warning" | "error";

/** Whether this viewer has asked for reduced motion. False outside a browser. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * How long a transient confirmation should stay on screen.
 *
 * Reduced motion shortens it rather than removing it. The preference is about
 * movement, not about how long a person is given to read what happened, so the
 * message still appears and still says the same thing — it simply does not
 * linger. Every kind is treated alike for the same reason.
 */
export function feedbackDuration(
  _kind: FeedbackKind,
  reduced: boolean = prefersReducedMotion(),
): number {
  return reduced ? 1600 : MOTION_MS.feedback;
}
