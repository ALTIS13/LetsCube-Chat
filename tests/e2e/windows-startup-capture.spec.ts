import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * A photograph of the Windows sign-in settings, not a contract.
 *
 * The owner judges a visual change on rendered pixels, so this exists to
 * produce them at the two release widths, in both themes, and — because this
 * block lives inside the chat-list column the owner drags between 260 and 540
 * points — at the narrow end of that column as well, which is D-222's exact
 * shape. Every row it seeds is invented. The contract for these rules is
 * `tests/unit/desktop-autostart.test.mts`; this file asserts nothing about the
 * design beyond the block being on screen.
 *
 * The shell bridge is stubbed, because that is the only way to photograph a
 * Windows-only block from a browser. It is a stub of the *wire*, not of the
 * rules: it answers with the same snake_case payload the Rust command
 * serialises, and everything the page then does with it is the shipped code.
 */

const AT = "2026-09-18T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const TEAM = "22222222-2222-4222-8222-000000000001";

type Registry = {
  enabled: boolean;
  start_minimized: boolean;
  entry_present: boolean;
  entry_matches_install: boolean;
  blocked_by_windows: boolean;
};

/** The five states the registry can actually be in, as the shell reports them. */
const STATES: Record<string, Registry> = {
  off: {
    enabled: false,
    start_minimized: false,
    entry_present: false,
    entry_matches_install: false,
    blocked_by_windows: false,
  },
  on: {
    enabled: true,
    start_minimized: false,
    entry_present: true,
    entry_matches_install: true,
    blocked_by_windows: false,
  },
  tray: {
    enabled: true,
    start_minimized: true,
    entry_present: true,
    entry_matches_install: true,
    blocked_by_windows: false,
  },
  blocked: {
    enabled: false,
    start_minimized: true,
    entry_present: true,
    entry_matches_install: true,
    blocked_by_windows: true,
  },
  moved: {
    enabled: true,
    start_minimized: false,
    entry_present: true,
    entry_matches_install: false,
    blocked_by_windows: false,
  },
};

function seed(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "member", AT)],
    messages: [
      message(
        "55555555-5555-4555-8555-000000000001",
        TEAM,
        ANNA,
        "Смета на витрину готова, посмотри",
        "2026-09-18T10:00:00.000Z",
      ),
    ],
  };
}

async function openStartup(
  page: Page,
  theme: "dark" | "light",
  state: Registry,
  columnWidth?: number,
) {
  await openFixture(page, { me: ME, people: [ANNA], ...seed() });

  // `openFixture` seeds the dark theme; a later init script wins.
  await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
  if (columnWidth !== undefined) {
    await page.addInitScript(
      (width) =>
        localStorage.setItem(
          "kub-desktop-chat-list",
          JSON.stringify({ width: width as number, collapsed: false }),
        ),
      columnWidth,
    );
  }

  // The shell bridge, installed before the application's modules run — which is
  // the same guarantee Tauri's own initialization script gives it.
  await page.addInitScript((initial) => {
    let current = initial as Registry;
    Object.defineProperty(window, "letscubeDesktop", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        platform: "windows",
        version: "0.2.14",
        build: 18,
        getRuntimeInfo: async () => ({ platform: "windows", version: "0.2.14", build: 18 }),
        getAutostart: async () => current,
        setAutostart: async (request: { enabled: boolean; startMinimized: boolean }) => {
          current = {
            enabled: request.enabled,
            start_minimized: request.enabled && request.startMinimized,
            entry_present: request.enabled,
            entry_matches_install: request.enabled,
            blocked_by_windows: false,
          };
          return current;
        },
      }),
    });
  }, state);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(1);

  const phone = (page.viewportSize()?.width ?? 0) < 768;
  if (phone) {
    await page.getByRole("button", { name: "Меню" }).first().click();
    await page.getByRole("button", { name: "Настройки" }).first().click();
  } else {
    await page.getByTestId("side-menu-button").click();
    await page
      .getByTestId("side-menu-layer")
      .getByRole("button", { name: "Настройки", exact: true })
      .click();
  }
  await expect(page.getByRole("heading", { name: "Профиль", exact: true })).toBeVisible();

  await page.getByTestId("settings-open-application").click();
  const card = page.getByTestId("desktop-autostart-card");
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  // The disclosure animates in; let it land before the shutter.
  await page.waitForTimeout(400);
  return card;
}

for (const theme of ["dark", "light"] as const) {
  for (const [name, state] of Object.entries(STATES)) {
    test(`the Windows startup rows, photographed (${theme}, ${name})`, async ({ page, request }, info) => {
      await requireFixtureServer(request);
      const card = await openStartup(page, theme, state);
      const width = page.viewportSize()?.width ?? 0;
      const file = `output/autostart/autostart-${width}-${theme}-${name}.png`;
      await card.screenshot({ path: file });
      info.annotations.push({ type: "capture", description: file });
    });
  }
}

/**
 * D-222's own shape: the block at the narrow end of the column the owner drags.
 * Desktop only — below `md` the settings screen is a viewport sheet and the
 * column does not exist.
 */
test("the Windows startup rows at the narrowest column the owner can drag", async ({
  page,
  request,
}, info) => {
  const width = page.viewportSize()?.width ?? 0;
  test.skip(width < 768, "the draggable column exists only on the desktop layout");
  await requireFixtureServer(request);

  for (const theme of ["dark", "light"] as const) {
    const card = await openStartup(page, theme, STATES.blocked, 260);
    const file = `output/autostart/autostart-column260-${theme}.png`;
    await card.screenshot({ path: file });
    info.annotations.push({ type: "capture", description: file });
  }
});
