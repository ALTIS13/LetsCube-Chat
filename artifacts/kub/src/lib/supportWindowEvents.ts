export const KUB_SUPPORT_WINDOW_OPEN_EVENT = "kub:support-window-open";

/**
 * Opens the floating support panel from anywhere in the application.
 *
 * The same shape as `openGlobalSearch`: the panel is mounted once beside the
 * router and listens, so an entry point needs no prop chain down to it.
 */
export function openSupportWindow(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(KUB_SUPPORT_WINDOW_OPEN_EVENT));
}
