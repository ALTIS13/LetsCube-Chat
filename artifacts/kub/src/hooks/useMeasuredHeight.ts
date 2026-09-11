import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

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
 * The observer catches what no commit of the caller describes: a textarea
 * growing a line as the reader types (that commit belongs to the composer, not
 * to the component holding this hook), a font arriving, a wrapped label
 * reflowing. Both land in the frame that shows the change; see the observer.
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

  const measure = useCallback(() => {
    const current = nodeRef.current;
    const next = current ? Math.ceil(current.getBoundingClientRect().height) : 0;
    setHeight((value) => (value === next ? value : next));
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
    // effects — the list's padding and its bottom anchor — run before the
    // browser paints. It cannot loop: nothing laid out from this height is an
    // ancestor or a sibling of the box being observed, so the commit resizes
    // nothing at this box's depth, and an unchanged height is not a state
    // update at all.
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
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
    observer?.observe(node, { box: "border-box" });
    return () => {
      observer?.disconnect();
    };
  }, [measure, node, resetKey]);

  return { ref, height, measure, node };
}
