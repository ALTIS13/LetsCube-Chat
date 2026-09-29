/**
 * Hands the keyboard back to the sidebar's search field.
 *
 * The field lives in `SidebarHeader` and what is offered under it lives in
 * `SidebarSearchResults`. A press on an offered completion keeps the focus
 * with `preventDefault` on the pointer, as the in-chat offer does, and then asks
 * for it back through this event. A touch that did move the focus away gets it
 * back, and nothing else in the shell is touched.
 */
export const SIDEBAR_SEARCH_FOCUS_EVENT = "kub:focus-sidebar-search";

export function focusSidebarSearch(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SIDEBAR_SEARCH_FOCUS_EVENT));
}
