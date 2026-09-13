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
 * D-163: a group's member actions must be reachable by a finger.
 *
 * They were not, from the day they shipped until 2026-09-13. The three controls
 * — promote, demote, remove — sat in a container carrying
 * `opacity-0 group-hover:opacity-100`, so on a phone they were drawn at zero
 * opacity at rest and still at zero after a tap. An owner could not promote,
 * demote or remove anyone from the device this product is mostly used on.
 *
 * **`toBeVisible()` would not have caught it, and that is the point of this
 * file.** Playwright's visibility check asks for a non-empty box and a
 * `visibility` that is not `hidden`; it does not read `opacity`. A test written
 * the obvious way would have gone green against the broken build. So the
 * reachability is measured: the computed opacity of the control and of every
 * ancestor between it and the panel.
 *
 * The second contract is the portal. The panel carries `kub-glass-strong`,
 * whose `backdrop-filter` makes it the containing block for any fixed
 * descendant — measured at 379x900 inside a 1440x900 viewport as a column — and
 * the panel stands at `z-[60]` while the row menu was written at `z-50`. A menu
 * left as a child of the panel would be confined to a 380px card on a computer
 * and painted underneath the panel besides. A phone shows neither symptom,
 * because there the panel is the whole screen, so the desktop case below is the
 * one that can fail.
 *
 * Needs the dev server on the fixture host.
 */

const AT = "2026-09-12T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const PETR = person("11111111-1111-4111-8111-000000000003", "Пётр Ильин");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";

const LINES = ["Макет главной готов, посмотрите", "Смета на витрину готова, посмотри"];

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    // I am the owner, so there is something to do to both of the others.
    memberships: [
      membership(CHAT_TEAM, ME, "owner", AT),
      membership(CHAT_TEAM, ANNA, "admin", AT),
      membership(CHAT_TEAM, PETR, "member", AT),
    ],
    messages: LINES.map((text, index) =>
      message(
        "55555555-5555-4555-8555-" + String(index + 1).padStart(12, "0"),
        CHAT_TEAM,
        index === 0 ? ME : ANNA,
        text,
        new Date(Date.UTC(2026, 8, 12, 10, index * 7)).toISOString(),
      ),
    ),
  };
}

async function openMembers(page: Page) {
  const seed = rows();
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await openChat(page, "Команда проекта", LINES[0]);
  await page.getByTestId("chat-header-info-button").click();
  const panel = page.getByTestId("chat-info-panel");
  await expect(panel).toBeVisible();
  // Scoped to the panel: unscoped, «УЧАСТНИКИ» also matches the conversation.
  await panel.getByText("УЧАСТНИКИ", { exact: false }).first().click();
  await expect(page.getByTestId("chat-info-member").first()).toBeVisible();
}

/**
 * The faintest this control gets on its way up to the panel.
 *
 * Multiplied rather than minimised: two ancestors at 0.5 each leave a control a
 * quarter visible, and the defect this guards against was a single ancestor at
 * zero with the control itself at one.
 */
async function drawnOpacity(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return -1;
    let product = 1;
    let node: Element | null = el;
    while (node && node !== document.body) {
      const value = Number.parseFloat(getComputedStyle(node).opacity);
      if (Number.isFinite(value)) product *= value;
      node = node.parentElement;
    }
    return product;
  }, selector);
}

const ACTIONS_CONTROL = '[data-testid="chat-info-member"][data-has-actions="true"] [aria-label="Действия с участником"]';

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test.describe("a group's member actions", () => {
  test.describe("under a finger", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("the control is drawn, and a tap opens the actions", async ({ page }) => {
      await openMembers(page);

      const control = page.locator(ACTIONS_CONTROL).first();
      await expect(control).toBeVisible();

      // The assertion that would have failed before, and the one `toBeVisible`
      // cannot make: the control was present at full opacity inside a container
      // standing at zero.
      const opacity = await drawnOpacity(page, ACTIONS_CONTROL);
      expect(
        opacity,
        "the member actions are in the markup but not drawn — this is D-163 returning, and no visibility assertion can see it",
      ).toBeGreaterThan(0.9);

      await control.tap();
      const menu = page.locator("[data-row-action-menu]");
      await expect(menu).toBeVisible();
      await expect(menu).toContainText("Удалить из чата");
    });

    test("a long press on the row opens the same actions", async ({ page }) => {
      await openMembers(page);
      const row = page.locator('[data-testid="chat-info-member"][data-has-actions="true"]').first();
      const box = (await row.boundingBox())!;
      // Held, not tapped: the gesture waits 520ms and cancels beyond 8px.
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.dispatchEvent(
        '[data-testid="chat-info-member"][data-has-actions="true"]',
        "pointerdown",
        { pointerType: "touch", clientX: box.x + 20, clientY: box.y + box.height / 2, bubbles: true },
      );
      await page.waitForTimeout(700);
      await expect(page.locator("[data-row-action-menu]")).toBeVisible();
    });
  });

  test.describe("on a computer, where the panel is a column", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("the actions open outside the panel, not trapped inside it", async ({ page }) => {
      await openMembers(page);
      await expect(page.getByTestId("chat-info-panel")).toHaveAttribute("data-surface", "column");

      await page.locator(ACTIONS_CONTROL).first().click();
      const menu = page.locator("[data-row-action-menu]");
      await expect(menu).toBeVisible();

      // The portal contract, asked of the DOM rather than of a rectangle: a
      // menu left inside the panel is confined by that panel's backdrop-filter
      // and painted under it, and neither shows on a phone.
      const insidePanel = await page.evaluate(() => {
        const el = document.querySelector("[data-row-action-menu]");
        const panel = document.querySelector('[data-testid="chat-info-panel"]');
        return Boolean(el && panel && panel.contains(el));
      });
      expect(
        insidePanel,
        "the actions render inside the information panel, which makes the panel their containing block and puts them under it",
      ).toBe(false);
    });
  });
});
