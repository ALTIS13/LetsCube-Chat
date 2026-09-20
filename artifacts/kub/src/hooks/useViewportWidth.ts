import { useEffect, useState } from "react";

/**
 * The layout viewport's width, kept current across a resize.
 *
 * `window.innerWidth` and not `document.documentElement.clientWidth`, for the
 * reason `ChatListResizer` already records: it is the layout viewport, which is
 * the number a `md:` breakpoint is compared against, and it is the cheaper read.
 *
 * It exists because the profile's tier is decided from the live width on every
 * render rather than frozen when the surface opened — a window narrowed past
 * `PROFILE_COMPACT_MIN_WIDTH` while a compact card stands has to become the
 * full one, and a value read once cannot do that.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));

  useEffect(() => {
    const read = () => setWidth(window.innerWidth);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  return width;
}
