import { useCallback, useLayoutEffect, useRef, useState } from "react";

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
 * see different things. The layout effect catches every React-driven change
 * before the browser paints — `setState` from a layout effect is flushed
 * synchronously — so a reply preview never paints at the wrong height. The
 * observer catches what no commit describes: a textarea growing a line as the
 * reader types, a font arriving, a wrapped label reflowing.
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

    let frame = window.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(measure);
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
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [measure, node, resetKey]);

  return { ref, height, measure, node };
}
