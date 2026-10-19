import { useLayoutEffect, useRef, type RefObject } from "react";
import { MOTION_MS } from "@/lib/motion";

/** A semantic navigation, not every message/render. Never transform overlay hosts. */
export function usePaneArrival(ref: RefObject<HTMLElement | null>, destination: string): void {
  const previous = useRef(destination);
  useLayoutEffect(() => {
    if (previous.current === destination) return;
    previous.current = destination;
    const node = ref.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!node || preference.matches || !node.animate || node.getClientRects().length === 0) return;
    const animation = node.animate([{ opacity: 0.86 }, { opacity: 1 }], {
      id: "kub-pane-arrival",
      duration: MOTION_MS.standard,
      easing: getComputedStyle(node).getPropertyValue("--kub-ease-standard").trim() || "ease-out",
    });
    const onPreference = () => { if (preference.matches) animation.cancel(); };
    preference.addEventListener("change", onPreference);
    return () => {
      preference.removeEventListener("change", onPreference);
      animation.cancel();
    };
  }, [destination, ref]);
}
