import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

type HeightObservation = { observer: ResizeObserver; node: HTMLElement };
const heightObservations = new Set<HeightObservation>();
let reobserveFrame: number | null = null;

// A sync commit can also resize a sibling measured by another hook instance.
// Pause only our observations for this delivery; the commit still lands now.
function pauseHeightObservations() {
  for (const { observer, node } of heightObservations) observer.unobserve(node);
  if (reobserveFrame !== null) return;
  reobserveFrame = requestAnimationFrame(() => {
    reobserveFrame = null;
    for (const { observer, node } of heightObservations) observer.observe(node, { box: "border-box" });
  });
}

/** The box being measured, or null while it is not mounted. */
type Measured<T extends HTMLElement> = {
  /** Attach to the box. A callback ref, so a box that mounts later is seen. */
  ref: (element: T | null) => void;
  height: number;
  /** Re-read the height now, for a change no observer will report in time. */
  measure: () => void;
  /** The mounted box, for callers that need to ask it something else. */
  node: T | null;
};

/**
 * The rendered height of a box, in CSS pixels, kept current as it changes.
 *
 * The chat chrome runs over the conversation rather than beside it, so the
 * list's padding is what keeps the newest message clear of the composer and the
 * oldest visible one clear of the header. That padding has to be the chrome's
 * *actual* height: a reply preview, a row of attachments, a multi-line draft, a
 * pinned message and the in-chat search bar all change it, and a constant would
 * be wrong the moment any of them appeared.
 *
 * Measured in a layout effect and again from a `ResizeObserver`, because the two
 * see different things. The layout effect catches every change that re-renders
 * the caller before the browser paints — `setState` from a layout effect is
 * flushed synchronously — so a reply preview never paints at the wrong height.
 * A child that changes its own layout calls `measure` from its layout effect:
 * waiting for native delivery can leave the caller's inset a frame behind.
 * The observer remains the fallback for external changes, such as a font
 * arriving or a wrapped label reflowing without a React commit.
 *
 * `Math.ceil` on purpose. A fractional height rounded down leaves a sub-pixel
 * strip of the conversation under the chrome; rounded up it costs at most one
 * pixel of padding, which nothing can see.
 */
export function useMeasuredHeight<T extends HTMLElement>(resetKey?: unknown): Measured<T> {
  const nodeRef = useRef<T | null>(null);
  // A callback ref rather than an object ref, and the node kept in state.
  //
  // An object ref is empty when the mount's layout effect runs if the box is
  // rendered conditionally — and the effect does not re-run when it appears,
  // because nothing in its dependencies changed. Measured on the QA capture
  // page, which returns `null` until its fixture arrives: the height stayed 0
  // for the life of the page, the list padded itself by nothing, and the last
  // message sat 46px under the composer.
  const [node, setNode] = useState<T | null>(null);
  const [height, setHeight] = useState(0);
  const measuredHeightRef = useRef(0);

  const measure = useCallback(() => {
    const current = nodeRef.current;
    const next = current ? Math.ceil(current.getBoundingClientRect().height) : 0;
    if (measuredHeightRef.current === next) return;
    measuredHeightRef.current = next;
    setHeight(next);
  }, []);

  const ref = useCallback((element: T | null) => {
    nodeRef.current = element;
    setNode(element);
  }, []);

  useLayoutEffect(() => {
    // Runs on the mount commit too, where `node` is still null but `nodeRef`
    // is already assigned, so the first height is right before the first paint
    // and the re-render this schedules only attaches the observer.
    measure();
  });

  useLayoutEffect(() => {
    if (!node) return undefined;

    // Committed inside the callback, not scheduled for the next frame.
    //
    // A `ResizeObserver` is delivered after layout and before paint, which makes
    // its callback the last moment a size change nobody committed can still
    // reach the frame that shows it. The callback used to hand the read to
    // `requestAnimationFrame` instead, and the state update made from there is
    // not flushed until a task after that frame as well — so the new height
    // arrived two frames after the box had it. Measured on the DEV preview
    // fixture at 390x844 and at 1440x900, the same at both: a draft that wrapped
    // grew the composer 24px over the newest message for two painted frames,
    // cutting its 26px of clearance to 2px, and the conversation then jumped
    // 24px to catch up; deleting back to one line opened a 50px gap for two
    // frames the same way. That jump is "текст прыгает, когда печатаю".
    //
    // `flushSync` commits the caller before this callback returns, so its layout
    // effects — the list's padding and its bottom anchor — run before paint.
    // It can also flush pending work outside this callback: in WebKit the dock
    // commit changed the sibling header from 56px to 89.328125px at the same
    // DOM depth, producing an undelivered notification. Pause all this hook's
    // observations, not arbitrary third-party observers. Each caller's layout
    // effect above measures the changed siblings in the same commit. Only
    // re-observation waits for the next frame; unchanged initial deliveries
    // must not restart that cycle.
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
        if (Math.ceil(node.getBoundingClientRect().height) === measuredHeightRef.current) return;
        pauseHeightObservations();
        flushSync(measure);
      })
      : null;

    // Border box, not the default content box.
    //
    // `getBoundingClientRect` reports the border box, and the composer's height
    // changes by its own padding: `--kub-keyboard-inset` is applied as
    // `padding-bottom` on the dock when the on-screen keyboard opens. A
    // content-box observer never sees that. Measured on a 390x844 phone with
    // the inset driven to 320px: the dock grew to 390px, the observer stayed
    // silent, the padding stayed at 94px, and the newest message sat 296px
    // under the composer.
    const observation = observer ? { observer, node } : null;
    if (observation) heightObservations.add(observation);
    if (reobserveFrame === null) observer?.observe(node, { box: "border-box" });
    return () => {
      if (observation) heightObservations.delete(observation);
      observer?.disconnect();
      if (heightObservations.size === 0 && reobserveFrame !== null) {
        cancelAnimationFrame(reobserveFrame);
        reobserveFrame = null;
      }
    };
  }, [measure, node, resetKey]);

  return { ref, height, measure, node };
}
