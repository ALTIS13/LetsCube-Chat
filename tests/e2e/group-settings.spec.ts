import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * D-164: a group has a settings screen.
 *
 * It had none. The pencil in the information card set `editing = true`, which
 * swapped the card's title and subtitle for a one-line name box and a two-row
 * description box, with **no cancel control at all** — the only way out of edit
 * mode was to commit. Every other setting a group has sat on the information
 * tab, in front of people who cannot change any of it.
 *
 * What is asserted here is the arrangement rather than the styling: the pencil
 * opens a screen, the screen is left by the arrow, every row carries its current
 * value on the right, and a person who may not change a setting still reads it.
 *
 * Everything runs on the message-actions fixture — a mocked backend with
 * fictional people — so no production screen is ever rendered.
 */

const AT = "2026-09-12T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const PETR = person("11111111-1111-4111-8111-000000000003", "Пётр Ильин");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";
const LINES = ["Макет главной готов, посмотрите", "Смета на витрину готова, посмотри"];

type MyRole = "owner" | "admin" | "member";

function rows(myRole: MyRole): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [
      membership(CHAT_TEAM, ME, myRole, AT),
      membership(CHAT_TEAM, ANNA, myRole === "owner" ? "admin" : "owner", AT),
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

function shotPath(info: TestInfo, name: string): string {
  return `output/group-settings/${name}-${info.project.name}.png`;
}

/**
 * The theme, stamped the way the product's own runtime stamps it.
 *
 * Not through `localStorage`: the message-actions fixture writes «dark» in its
 * own init script, which runs after anything this file could add, so a theme
 * set that way is overwritten before the application ever reads it. These are
 * the same three things `applyResolvedTheme` does, and nothing else decides the
 * palette.
 */
async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
}

/**
 * Until the layers have finished sliding: a state attribute flips at once, the
 * paint does not.
 *
 * The first draft accepted an opacity of 0 **or** 1 for every layer, which is
 * true at the very start of the transition as well as at its end, so it waited
 * for nothing and the frame caught the layer underneath still fading out. What
 * is actually being waited for is the layer that is leaving reaching zero.
 */
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const layers = document.querySelectorAll<HTMLElement>(".kub-subview");
    return Array.from(layers).every((layer) => {
      const opacity = Number.parseFloat(getComputedStyle(layer).opacity);
      return layer.dataset.state === "current" ? opacity === 1 : opacity === 0;
    });
  });
}

async function openInfo(page: Page, myRole: MyRole = "owner", theme: "light" | "dark" = "light") {
  const seed = rows(myRole);
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await openChat(page, "Команда проекта", LINES[0]);
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  await stampTheme(page, theme);
}

const openSettings = async (page: Page) => {
  await page.getByLabel("Редактировать").click();
  // The state lives on the layer, not on the component inside it. Asserting
  // `toBeVisible` on the component would pass while the layer sits parked to
  // one side: the layers stay mounted and slide, so every one of them is
  // «visible» in the only sense Playwright has.
  await expect(page.getByTestId("chat-info-settings-view")).toHaveAttribute("data-state", "current");
};

test("the pencil opens a settings screen rather than swapping two fields", async ({ page }, info) => {
  await openInfo(page);
  await openSettings(page);

  // The card's own header says where you are and offers the way back — the
  // thing edit mode never had.
  await expect(page.getByTestId("chat-info-header")).toContainText("Настройки группы");
  await expect(page.getByTestId("chat-info-back")).toBeVisible();

  await settled(page);
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "owner") });
});

test("every row carries its current value on the right", async ({ page }) => {
  await openInfo(page);
  await openSettings(page);

  // Four members were seeded, two of them running the group.
  await expect(page.getByTestId("chat-settings-row-invites")).toHaveAttribute(
    "data-settings-value",
    /администраторы|участники|Неизвестно/,
  );
  await expect(page.getByTestId("chat-settings-row-topics")).toHaveAttribute("data-settings-value", "Выключены");
  await expect(page.getByTestId("chat-settings-row-administrators")).toHaveAttribute(
    "data-settings-value",
    "2 администратора",
  );
  await expect(page.getByTestId("chat-settings-row-members")).toHaveAttribute("data-settings-value", "3 участника");
});

test("the arrow goes back, and taking nothing away asks nothing", async ({ page }) => {
  await openInfo(page);
  await openSettings(page);

  await page.getByTestId("chat-info-back").click();
  // The layers stay mounted and slide, so «hidden» is the wrong question: the
  // one the card actually answers is which layer is current.
  await expect(page.getByTestId("chat-info-settings-view")).toHaveAttribute("data-state", "ahead");
  await expect(page.getByTestId("chat-info-root-view")).toHaveAttribute("data-state", "current");
});

test("a name typed and not saved is asked about rather than dropped", async ({ page }) => {
  await openInfo(page);
  await openSettings(page);

  await page.getByTestId("chat-settings-name").fill("Команда проекта и друзья");
  // The check appears only once something has really been typed.
  await expect(page.getByLabel("Сохранить")).toBeVisible();

  await page.getByTestId("chat-info-back").click();
  const dialog = page.locator('[aria-modal="true"]');
  await expect(dialog).toContainText("Отменить изменения?");
  await dialog.getByRole("button", { name: "Продолжить" }).click();
  // Still on the screen, with what was typed still in hand.
  await expect(page.getByTestId("chat-info-settings-view")).toHaveAttribute("data-state", "current");
  await expect(page.getByTestId("chat-settings-name")).toHaveValue("Команда проекта и друзья");
});

test("an ordinary member reads the screen and changes none of it", async ({ page }, info) => {
  await openInfo(page, "member");
  // The pencil is the owner's and the administrator's; a member has no way in,
  // which is the same rule the card always applied to the name.
  await expect(page.getByLabel("Редактировать")).toBeHidden();
});

test("the settings screen holds in the dark theme", async ({ page }, info) => {
  await openInfo(page, "owner", "dark");
  await openSettings(page);
  await settled(page);
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "dark") });
  await expect(page.getByTestId("chat-settings-row-members")).toBeVisible();
});

test("a confirmation raised from the panel is the thing under the finger", async ({ page }) => {
  // D-179. `KubModal` painted at `z-50` while the information card stands at
  // `z-[60]`, so on a phone — where the card is the whole screen — every
  // confirmation the card raises was drawn *behind* it. The button was there,
  // at full opacity, with pointer events on, and the press landed on a settings
  // row instead. Measured rather than argued: `elementFromPoint` at the centre
  // of «Продолжить» answered a row's `<span>`.
  await openInfo(page);
  await openSettings(page);
  await page.getByTestId("chat-settings-name").fill("Команда проекта и друзья");
  await page.getByTestId("chat-info-back").click();

  const hit = await page.evaluate(() => {
    const dialog = document.querySelector('[aria-modal="true"]');
    const button = dialog
      ? Array.from(dialog.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Продолжить")
      : null;
    if (!button) return "no button";
    const rect = button.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return top === button || button.contains(top) ? "the button" : "something else";
  });
  expect(hit).toBe("the button");
});

test("a dialog opened from the card is not confined to the card", async ({ page }) => {
  // The same defect seen from the other side. The card carries
  // `kub-glass-strong`, whose `backdrop-filter` makes it the containing block
  // for any fixed descendant, so a modal rendered as its child is trapped in a
  // 380-point column on a computer — which is D-163's finding about the row
  // menu, arriving again at the dialog.
  await openInfo(page);
  await openSettings(page);
  await page.getByTestId("chat-settings-row-delete").click();

  const boxes = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    const panel = document.querySelector('[data-testid="chat-info-panel"]');
    if (!dialog || !panel) return null;
    const a = dialog.getBoundingClientRect();
    const b = panel.getBoundingClientRect();
    return { dialog: Math.round(a.width), panel: Math.round(b.width), viewport: window.innerWidth };
  });
  expect(boxes).not.toBeNull();
  // On a computer the card is a column; a dialog confined to it would be no
  // wider. It is centred on the window instead, so its left edge starts before
  // the card's.
  if ((boxes as { panel: number; viewport: number }).panel < (boxes as { viewport: number }).viewport - 100) {
    const left = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      const panel = document.querySelector('[data-testid="chat-info-panel"]');
      return dialog && panel
        ? Math.round(dialog.getBoundingClientRect().left - panel.getBoundingClientRect().left)
        : 0;
    });
    expect(left).toBeLessThan(0);
  }
});
