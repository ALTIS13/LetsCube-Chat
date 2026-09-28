import type { Locator } from "@playwright/test";

/**
 * Send what a message field holds the way this device sends it (tracker item
 * 71): Enter on a computer; on a phone Enter starts a new line, as in
 * Telegram, and the arrow beside the field sends.
 *
 * The phone test is the product's own, `enterSends` in
 * `artifacts/kub/src/lib/composerEnter.ts`: an iOS or Android browser in the
 * phone layout, below `md`.
 */
export async function sendFromField(field: Locator, sendButton?: Locator): Promise<void> {
  const page = field.page();
  const phone = await page.evaluate(() => {
    const touchMac = /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
    return (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || touchMac) &&
      !window.matchMedia("(min-width: 48rem)").matches;
  });
  if (!phone) {
    await field.press("Enter");
    return;
  }
  // «Сохранить изменения» is the same arrow while a message is being edited.
  await (sendButton ?? page.getByRole("button", { name: /^(Отправить|Сохранить изменения)$/ })).click();
}
