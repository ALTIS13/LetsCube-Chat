import type { Page } from "@playwright/test";

/**
 * On a phone a server opens on its channel list (tracker item 54): Telegram's
 * forum opens on its topics and Discord's server on its channels. A test about
 * the conversation behind the list — its composer, its capsule, its panels —
 * closes the list first, as a person who wanted the conversation would.
 *
 * The list opens once the server's channels are read, a moment after the
 * conversation, so a test cannot look for it at once: it waits for it briefly
 * and goes on if it never comes (a group with no channels opens straight on
 * its conversation, and a computer has a column instead).
 */
export async function closeChannelListIfShown(page: Page, timeoutMs = 3_000): Promise<boolean> {
  if ((page.viewportSize()?.width ?? 0) >= 768) return false;
  const sheet = page.getByTestId("channel-rail-sheet");
  try {
    await sheet.waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    return false;
  }
  await page.getByTestId("channel-rail-close").click();
  await sheet.waitFor({ state: "detached" });
  return true;
}

/**
 * From a conversation back to the chat list on a phone. In a server the
 * conversation's «Назад» comes back to the channel list first (item 54), as a
 * Telegram topic returns to the forum's topics, and the list's own «Назад к
 * чатам» leaves the server; anywhere else «Назад» is already the chat list.
 */
export async function leaveConversationForChatList(page: Page): Promise<void> {
  await page.getByTestId("chat-control-row").getByLabel("Назад").click();
  const leave = page.getByTestId("channel-rail-leave");
  try {
    await leave.waitFor({ state: "visible", timeout: 1_500 });
  } catch {
    return;
  }
  await leave.click();
}
