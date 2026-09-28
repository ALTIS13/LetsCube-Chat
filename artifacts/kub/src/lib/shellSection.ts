/**
 * The sections the shell opens beside its lists (tracker item 41).
 *
 * The owner, 2026-09-20: «ботов и т.п можно перенести в место подобное тому
 * что на скриншоте 3» — Discord's home list, whose rows above the direct
 * messages are routes: Friends, Library, Message Requests, the shop. Read in
 * its web bundle (build 621195): each row is a navigation row with a route, an
 * icon and a word, and a row opens its page **in the main area while the lists
 * stay**. Ours opened «Мои боты» and «Задачи» as routes outside the shell, each
 * replacing the whole window; here they become the shell's own, so the rows can
 * lead somewhere the rows still are.
 *
 * Pure, so `node --test` reads every case; the shell and the list draw it.
 */

// The extension is required: `node --test` loads this module straight from
// disk, and Node's resolver does not guess one — `voiceShellBar.ts` imports
// `chatRoute.ts` the same way for the same reason.
import { isMessengerRoute } from "./chatRoute.ts";

export type ShellSection = "bots" | "tasks";

const SECTION_PATHS: Readonly<Record<ShellSection, string>> = {
  bots: "/bots",
  tasks: "/tasks",
};

function routePath(location: string): string {
  const path = location.split(/[?#]/, 1)[0]?.trim() || "/";
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}

/**
 * The section this location opens, or null.
 *
 * Exact paths only: `/bots/docs` is the public documentation and stays its
 * own page, and a near match is not a section.
 */
export function shellSection(location: string): ShellSection | null {
  const path = routePath(location);
  for (const [section, sectionPath] of Object.entries(SECTION_PATHS) as [ShellSection, string][]) {
    if (path === sectionPath) return section;
  }
  return null;
}

export function shellSectionPath(section: ShellSection): string {
  return SECTION_PATHS[section];
}

/**
 * Whether the shell — `MainLayout`: the lists, and whatever the main area
 * holds — renders at this location: the messenger's own addresses and the
 * sections.
 *
 * One answer for the two places that need it. `App.tsx` routes by it, and
 * `voiceShellBar.ts` exempts by it, because the shell mounts its own call bar:
 * a second list of where that is would be the stale copy that file's head
 * describes, one revision after the router moved.
 */
export function isShellRoute(location: string): boolean {
  return isMessengerRoute(location) || shellSection(location) !== null;
}

/** The rows, in Discord's manner: an icon and a word, the section's own name. */
export const SHELL_SECTION_ROWS: readonly { readonly section: ShellSection; readonly label: string; readonly icon: "bot" | "tasks" }[] = [
  { section: "bots", label: "Мои боты", icon: "bot" },
  { section: "tasks", label: "Задачи", icon: "tasks" },
];
