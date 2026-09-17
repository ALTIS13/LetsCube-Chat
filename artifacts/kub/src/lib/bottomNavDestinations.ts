/**
 * What the phone's bottom capsule offers, and why each entry is there.
 *
 * The list used to be written inline in `components/layout/BottomNav.tsx`, so
 * the one decision it carries — **which surfaces are destinations of their
 * own** — could only be checked by a screenshot or by a regex over the
 * component's source. It is a pure list and a pure gate, so it moved here;
 * this module imports nothing and is therefore reachable from `node --test` in
 * full.
 *
 * Nothing here decides what a tab *does*. `BottomNav` draws them and
 * `app.store.ts` holds the chosen one; «Задачи» is a route rather than a
 * section, which is why `id` and not a URL is what this module carries.
 *
 * ## The rule
 *
 * A tab is a **destination**, not a second door to something the chat list
 * already puts on screen. Three entries have been removed under that rule and
 * each removal is recorded here rather than in a commit message, because the
 * cheapest way to reintroduce one is not to know it was ever taken out:
 *
 *  - **«Поиск»** (the owner, 2026-09-12). The list header carries a real search
 *    field at every width.
 *  - **«Админка»** (the owner, 2026-09-12). It has five other entries, in the
 *    side menu, and was a second door to the same one.
 *  - **«Папки»** — D-120, named by the owner on 2026-09-11 and closed on
 *    2026-09-17. The folder strip sits at the top of the chat list on a phone
 *    and does everything the tab's screen did: it chooses a folder, it creates
 *    one with «+», and a second press on the chosen tab edits it. Telegram
 *    shows folders at the top only. The full-screen list the tab opened
 *    (`FolderListModal`) went with it.
 *
 * The rule is not a style preference: the labels have to fit a 360px phone in
 * one row, which `tests/unit/narrow-phone-typography.test.mjs` measures, and
 * every door added here is paid for out of that row.
 */

/** A section of the chat shell, which `app.store.ts` holds as `mobileSection`. */
export type BottomNavSection = "chats" | "profile";

/** The icon names `KubIcon` is given. A subset of `KubIconName`, on purpose. */
export type BottomNavIcon = "chatBubble" | "user" | "tasks";

/**
 * A destination, discriminated on `route`.
 *
 * Not a `boolean` field on one shape: the component narrows off it to call
 * `setMobileSection`, whose parameter does **not** accept `"tasks"` — tasks are
 * a URL, not a section of this shell. With a plain `boolean` that call needs a
 * cast, and the cast is exactly the one that would hand the store a value it
 * has no branch for. The typechecker found this on the first build of this
 * module rather than a person finding it on a phone.
 */
export type BottomNavDestination =
  | {
      readonly id: BottomNavSection;
      readonly label: string;
      readonly icon: BottomNavIcon;
      readonly route: false;
      readonly gated: false;
    }
  | {
      readonly id: "tasks";
      readonly label: string;
      readonly icon: BottomNavIcon;
      readonly route: true;
      readonly gated: true;
    };

/**
 * Every destination the capsule can offer, in screen order.
 *
 * «Задачи» is last because it is the one that can be absent, and a row whose
 * items move when a right changes is harder to aim at than a row that grows at
 * its end.
 */
export const BOTTOM_NAV_DESTINATIONS: readonly BottomNavDestination[] = [
  { id: "chats", label: "Чаты", icon: "chatBubble", route: false, gated: false },
  { id: "profile", label: "Профиль", icon: "user", route: false, gated: false },
  { id: "tasks", label: "Задачи", icon: "tasks", route: true, gated: true },
];

/**
 * The destinations this account is offered.
 *
 * One argument, and it is the answer to a right rather than the right itself:
 * `useTaskAccessGate` already resolves «may this person see tasks» out of the
 * role and the permission, and duplicating that here would be a second place
 * for it to be wrong.
 */
export function bottomNavDestinations(canAccessTasks: boolean): readonly BottomNavDestination[] {
  return BOTTOM_NAV_DESTINATIONS.filter((entry) => !entry.gated || canAccessTasks);
}
