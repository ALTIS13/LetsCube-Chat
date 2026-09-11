/**
 * The design options for the phone chat screen, rendered for the owner's
 * approval on 2026-09-11 and not shipped.
 *
 * The owner put the installed iPhone app beside Telegram on iOS 26 and said two
 * things: the chat screen looks strange and awkward around the Dynamic Island,
 * and the whole app is one monotone navy. Each option answers one half, or both,
 * so the renders show which change fixes which complaint — and whether the
 * translucent material is to blame:
 *
 *  - `capsules`: the geometry only. No bar under the status bar: the
 *    conversation runs to the top edge under a fade, and the header, the pinned
 *    message and the composer float as capsules of the same glass. Phones only;
 *    from `md` the bars stay.
 *  - `depth`: the colour only. A tinted wallpaper with a pattern, a saturated own
 *    bubble with white text, incoming bubbles without an outline, a filled date
 *    chip and an accent on the own bubble's hue. The bars stay.
 *  - `capsules-depth`: both.
 *
 * This module is the rule as pure functions, so it can be tested without a
 * bundler. `hooks/useChatChromeOptions.ts` is where it meets `import.meta.env`,
 * storage and the page.
 */

export const CHAT_CHROME_OPTIONS = ["current", "capsules", "depth", "capsules-depth"] as const;
export type ChatChromeOption = (typeof CHAT_CHROME_OPTIONS)[number];

/** Where a developer or the render script chooses an option. Read by a development build only. */
export const CHAT_CHROME_OPTION_STORAGE_KEY = "kub-dev-chat-chrome";

/** The attributes the options' stylesheet keys on, set on `<html>`. */
export const CHAT_CHROME_CAPSULES_ATTRIBUTE = "data-kub-chat-capsules";
export const CHAT_CHROME_DEPTH_ATTRIBUTE = "data-kub-chat-depth";

export type ChatChromeGateEnv = { DEV?: unknown };

/**
 * Which option applies. Anything but a development build is `current`, whatever
 * storage says. A value this module does not know is `current` too, so a key
 * left over from an earlier round cannot put a removed option on screen.
 */
export function resolveChatChromeOption(env: ChatChromeGateEnv, stored: unknown): ChatChromeOption {
  if (env.DEV !== true) return "current";
  return (CHAT_CHROME_OPTIONS as readonly unknown[]).includes(stored) ? (stored as ChatChromeOption) : "current";
}

export type ChatChromeFlags = { capsules: boolean; depth: boolean };

export function chatChromeFlags(option: ChatChromeOption): ChatChromeFlags {
  return {
    capsules: option === "capsules" || option === "capsules-depth",
    depth: option === "depth" || option === "capsules-depth",
  };
}

/**
 * What the back button counts: everything unread in the other chats, the way
 * Telegram's back button does. The open chat is left out — it is being read.
 */
export function unreadElsewhere(
  chats: ReadonlyArray<{ id: string; unread_count?: number | null }>,
  openChatId: string,
): number {
  return chats.reduce(
    (total, chat) => (chat.id === openChatId ? total : total + Math.max(0, chat.unread_count ?? 0)),
    0,
  );
}

/** The count as it is drawn: nothing at zero, and «999+» from a thousand, so the capsule keeps its size. */
export function unreadBadgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  return count > 999 ? "999+" : String(Math.floor(count));
}

/**
 * A round capsule's glass, given to `KubGlassLayer`: the panel material on a
 * leaf, with the lit rim a floating surface keeps against a backdrop nobody
 * chose (rule 11 of docs/operations/interface-material.md). The rim is
 * `--glass-line` rather than the sheet-edge blue: a capsule is not a sheet, and
 * that colour's perimeters are held to a ratchet in
 * tests/unit/edge-vocabulary.test.mjs.
 */
export const CAPSULE_GLASS = "rounded-full border border-[color:var(--glass-line)]";
