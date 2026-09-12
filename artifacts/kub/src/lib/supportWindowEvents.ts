export const KUB_SUPPORT_WINDOW_OPEN_EVENT = "kub:support-window-open";

/**
 * Opens the floating support panel from anywhere in the application.
 *
 * The panel is mounted once beside the router and listens, so an entry point
 * needs no prop chain down to it. `openGlobalSearch` had the same shape until
 * 2026-09-12, when it went with the search palette it opened; this is the last
 * surface that still works that way.
 */
export function openSupportWindow(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(KUB_SUPPORT_WINDOW_OPEN_EVENT));
}
