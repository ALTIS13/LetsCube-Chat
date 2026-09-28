import { recordRecentChat } from "./quickSwitch.ts";

/**
 * Where this reader has been, on this device (tracker item 36, c): the history
 * the search offers before anything is typed, as Discord's quick switcher keeps
 * its Previous Channels. Per account, because another account on the same
 * device has been somewhere else; ids only, never what was said there.
 */

const storageKey = (userId: string) => `kub:recent-chats:${userId}`;

export function readRecentChats(userId: string | null): string[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRecentChat(userId: string | null, chatId: string): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(recordRecentChat(readRecentChats(userId), chatId)));
  } catch {
    // Unwritable storage costs the history, and nothing else.
  }
}

/** Whether the composer is holding an unsent draft for this conversation. */
export function hasComposerDraft(chatId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem(`kub:draft:${chatId}`)?.trim());
  } catch {
    return false;
  }
}
