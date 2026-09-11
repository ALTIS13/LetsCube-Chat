/**
 * The unsafe areas, in pixels, for the few surfaces that place themselves by
 * hand.
 *
 * Everything laid out by CSS reads the four `--kub-safe-*` tokens declared on
 * `:root` in `index.css`. A floating window, a popover clamped to the screen or
 * a menu opened at the pointer computes its own coordinates, and those need
 * numbers. The numbers come from the same tokens, never from `env()`, for the
 * reason the tokens exist at all: one declaration, and a channel a test can
 * drive in an engine that cannot report the insets itself.
 *
 * Read through a computed padding rather than `getPropertyValue`. Every engine
 * resolves a padding to pixels, while a custom property may come back as the
 * unresolved `env(...)` text; and an undefined token resolves the padding to
 * `0px`, which is exactly what a surface reading it would get.
 */

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_SAFE_AREA_INSETS: Readonly<SafeAreaInsets> = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

/**
 * The insets as they are right now. It adds and removes an element, so call it
 * from an effect or an event handler rather than during render.
 */
export function readSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === "undefined" || !document.body || typeof getComputedStyle !== "function") {
    return { ...NO_SAFE_AREA_INSETS };
  }
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:0",
    "height:0",
    "visibility:hidden",
    "pointer-events:none",
    "padding-top:var(--kub-safe-top)",
    "padding-right:var(--kub-safe-right)",
    "padding-bottom:var(--kub-safe-bottom)",
    "padding-left:var(--kub-safe-left)",
  ].join(";");
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: toPixels(style.paddingTop),
    right: toPixels(style.paddingRight),
    bottom: toPixels(style.paddingBottom),
    left: toPixels(style.paddingLeft),
  };
  probe.remove();
  return insets;
}

/**
 * The part of a viewport the hardware leaves alone. Geometry that already
 * keeps a window on screen keeps it clear of the notch too when it is given
 * this instead of the whole viewport, and draws at `insets.left, insets.top`.
 */
export function safeViewport(
  viewport: { width: number; height: number },
  insets: SafeAreaInsets,
): { width: number; height: number } {
  return {
    width: Math.max(0, viewport.width - insets.left - insets.right),
    height: Math.max(0, viewport.height - insets.top - insets.bottom),
  };
}

function toPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
