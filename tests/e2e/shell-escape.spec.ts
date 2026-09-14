import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * What Escape closes, and what it must not be spent on.
 *
 * `MainLayout` answers Escape by closing the conversation, and refuses when
 * something the reader opened is on top of it — a dialog, a menu, a listbox,
 * one of the product's own popovers. That refusal is the whole rule, and D-194
 * is what happened when something else made the decision instead.
 *
 * On a phone the composer's recorder hint is up on arrival. It is a
 * `role="status"` notice nobody opened, drawn by Radix, and Radix's
 * `DismissableLayer` listens on `document` in the capture phase and calls
 * `preventDefault()` on the keydown for any layer it has mounted. A
 * bubble-phase listener in `MainLayout` therefore saw `defaultPrevented` and
 * did nothing: **the conversation could not be closed from the keyboard at
 * all** in a one-pane window, which is what a desktop window narrowed below
 * `md` also gets. Measured on 2026-09-14 — at window-capture the event was not
 * prevented, and by the time it reached `document` on the way up it was.
 *
 * The listener runs in the capture phase now, so the decision is back with
 * `hasBlockingOverlay`, which is what that check was written to be.
 *
 * Every row below is invented.
 */

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const TEAM = "22222222-2222-4222-8222-000000000001";
const LINE = "Смета на витрину готова, посмотри";

function seed(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "member", AT)],
    messages: [
      message("55555555-5555-4555-8555-000000000001", TEAM, ANNA, LINE, "2026-09-14T10:00:00.000Z"),
      message("55555555-5555-4555-8555-000000000002", TEAM, ME, "Посмотрю вечером", "2026-09-14T10:05:00.000Z"),
    ],
  };
}

async function boot(page: Page) {
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    ...seed(),
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await openChat(page, "Команда проекта", LINE);
  await page.evaluate(() => document.fonts.ready);
}

const dock = (page: Page) => page.getByTestId("chat-composer-dock");

async function pressEscape(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press("Escape");
}

test("Escape closes the conversation even with a hint on screen", async ({ page, request }, info) => {
  await requireFixtureServer(request);
  await boot(page);
  await expect(dock(page)).toHaveCount(1);

  // The hint has to have had its chance, or this passes for the wrong reason:
  // a run where it never appeared would prove nothing about the case it exists
  // for. On a computer it is not offered at all, and that is stated rather than
  // skipped over.
  await page.waitForTimeout(1200);
  const hints = await page.locator('[data-testid="kub-hint"]').count();
  if (info.project.name.includes("mobile")) {
    expect(hints, "the recorder hint never appeared, so this measures nothing").toBeGreaterThan(0);
  }

  await pressEscape(page);
  await expect(dock(page), "Escape did not close the conversation").toHaveCount(0);
});

test("Escape is refused while something the reader opened is on top", async ({ page, request }) => {
  await requireFixtureServer(request);
  await boot(page);

  // A confirmation the reader asked for. It owns Escape; the conversation
  // underneath must survive it, or one press would close two things.
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  const leave = page.getByRole("button", { name: /Покинуть группу|Удалить группу/ }).first();
  await leave.click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(dialog).toBeVisible();

  await pressEscape(page);
  await expect(dialog, "the dialog did not take its own Escape").toHaveCount(0);
  await expect(dock(page), "one press closed the dialog and the conversation").toHaveCount(1);
});
