import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURE_HOST,
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * The computer's shell, as the owner approved it on 2026-09-12 — «A с
 * поправками», option A with Telegram Desktop's structure on a computer.
 *
 * This carries forward the property `tests/e2e/navigation-options.spec.ts` held
 * for the two rendered options: **every destination still opens and every right
 * still gates**. There the destinations were a tab bar's tabs; here they are the
 * rows of the side list and the buttons of the folder rail, so the same eleven
 * checks are asked of the shipped shell instead of a DEV switch.
 *
 * What each check is for:
 *
 *  1. the rail is Telegram's 72pt and carries the folders with the counts we
 *     already compute, without replacing the horizontal strip;
 *  2. the side-menu button is on the rail, not above the chat list;
 *  3. the side list is a layer: it costs no width closed, opens over the
 *     window, and closes again;
 *  4. administration is in that layer on a computer, behind its right;
 *  5. every destination the layer offers actually opens;
 *  6. there is no bottom capsule on a computer at all;
 *  7. the list narrows by dragging, continuously, down to exactly 66pt;
 *  8. the width and the collapsed state survive a reload — the one thing
 *     Telegram does not do (tdesktop#6409);
 *  9. the LETSCUBE mark is in the list's top row, or the logo is nowhere;
 * 10. D-112: no page control reaches into the Windows window buttons;
 * 11. a folder on the rail chooses, and the chosen one edits.
 *
 * It needs the dev server on the fixture host and mocks everything it reads.
 */

const READ = "2026-09-12T09:00:00.000Z";

const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const BORIS = person("11111111-1111-4111-8111-000000000003", "Борис Ковалёв");

const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";
const CHAT_BORIS = "22222222-2222-4222-8222-000000000002";
const FOLDER = "44444444-4444-4444-8444-000000000001";
const CHAT_COUNT = 16;

const STAFF_PERMISSIONS = new Set(["tasks.view", "tasks.create", "tasks.manage", "users.view"]);

/** Telegram Desktop's own constants, quoted in the 2026-09-12 assessment. */
const RAIL_WIDTH = 72;
const COLLAPSED_WIDTH = 66;
const MIN_WIDTH = 260;

/** Sixteen chats, so the list scrolls at any width under test. */
function fixtureRows() {
  const chats: Row[] = [];
  const memberships: Row[] = [];
  const messages: Row[] = [];
  const add = (
    index: number,
    id: string,
    type: "private" | "group",
    name: string | null,
    other: typeof ANNA,
    text: string,
  ) => {
    const at = new Date(Date.UTC(2026, 8, 12, 14, 59 - index)).toISOString();
    chats.push(chat(id, type, name, at));
    memberships.push(membership(id, ME, "owner", READ), membership(id, other, "member", at));
    messages.push(
      message(`55555555-5555-4555-8555-${String(index + 1).padStart(12, "0")}`, id, other, text, at),
    );
  };
  add(0, CHAT_TEAM, "group", "Команда проекта", ANNA, "Макет главной готов");
  add(1, CHAT_BORIS, "private", null, BORIS, "Созвонимся вечером?");
  for (let index = 2; index < CHAT_COUNT; index += 1) {
    const id = `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
    add(index, id, "group", `Группа ${index}`, ANNA, `Сообщение в группе ${index}`);
  }
  return { chats, memberships, messages };
}

async function boot(page: Page, { staff = true, storedShell = null as string | null } = {}) {
  if (storedShell !== null) {
    await page.addInitScript((value) => {
      localStorage.setItem("kub-desktop-chat-list", value);
    }, storedShell);
  }
  const me = { ...ME, role: staff ? "manager" : "user" };
  const fixture = await openFixture(page, {
    me,
    ...fixtureRows(),
    rpc: (name, body) => {
      if (name === "has_permission") {
        return { body: staff && STAFF_PERMISSIONS.has(String(body.p_permission_key)) };
      }
      if (name === "has_global_role") return { body: staff && body.p_role_key === "manager" };
      return undefined;
    },
  });
  // Registered after the fixture, so these answer first.
  await page.route(`${FIXTURE_HOST}/rest/v1/folders*`, (route) =>
    route.fulfill({
      json: [
        {
          id: FOLDER,
          user_id: me.id,
          created_by: me.id,
          scope: "personal",
          name: "Личные",
          emoji: null,
          position: 1,
          created_at: READ,
        },
      ],
    }),
  );
  await page.route(`${FIXTURE_HOST}/rest/v1/folder_chats*`, (route) =>
    route.fulfill({ json: [{ folder_id: FOLDER, chat_id: CHAT_BORIS }] }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);
  return fixture;
}

/** The desktop bridge the Tauri shell injects, reduced to what the shell's UI calls. */
async function installWindowsShell(page: Page) {
  await page.addInitScript(() => {
    const version = "0.2.10";
    const state = {
      channel: "stable",
      phase: "current",
      installedVersion: version,
      availableVersion: null,
      downloadedBytes: 0,
      totalBytes: null,
      mandatory: false,
      errorCode: null,
    };
    const quiet = async () => undefined;
    Object.defineProperty(window, "letscubeDesktop", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        platform: "windows",
        version,
        build: 14,
        getRuntimeInfo: async () => ({ platform: "windows", version, build: 14 }),
        getUpdateState: async () => ({ ...state }),
        getUpdateChannel: async () => "stable",
        setUpdateChannel: async () => ({ ...state }),
        checkUpdate: async () => ({ ...state }),
        installUpdate: async () => ({ ...state }),
        getStorageState: async () => null,
        setStorageLocation: quiet,
        setCacheLimit: quiet,
        clearCache: quiet,
        showMain: quiet,
        isMainForeground: async () => true,
        notify: async () => false,
        removeNotification: async () => false,
        takePendingNotificationRoute: async () => null,
        startDragging: quiet,
        minimize: quiet,
        toggleMaximize: quiet,
        isMaximized: async () => false,
        closeToTray: quiet,
      }),
    });
    localStorage.setItem("letscube:desktop:last-installed-version", version);
  });
}

/** Every visible page control whose box reaches into the window buttons' box. */
async function controlsInWindowButtons(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector(
      '[data-testid="desktop-window-controls"], [data-testid="desktop-window-chrome"]',
    );
    const buttons = host ? [...host.querySelectorAll("button")] : [];
    if (!host || !buttons.length) return null;
    const boxes = buttons.map((button) => button.getBoundingClientRect());
    const zone = {
      left: Math.min(...boxes.map((box) => box.left)),
      top: Math.min(...boxes.map((box) => box.top)),
      right: Math.max(...boxes.map((box) => box.right)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
    };
    return [...document.querySelectorAll('button, a[href], input, [role="button"], [role="tab"], [role="separator"], textarea')]
      .filter((control) => !host.contains(control))
      .filter((control) => {
        const box = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        if (box.width < 1 || box.height < 1 || style.visibility === "hidden" || style.display === "none") {
          return false;
        }
        return (
          Math.min(box.right, zone.right) - Math.max(box.left, zone.left) > 0.5 &&
          Math.min(box.bottom, zone.bottom) - Math.max(box.top, zone.top) > 0.5
        );
      })
      .map((control) => control.getAttribute("aria-label") || control.textContent?.trim().slice(0, 40) || control.tagName);
  });
}

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;

async function listColumnWidth(page: Page) {
  return page.evaluate(() => {
    const column = document.querySelector<HTMLElement>(".kub-chat-list-column");
    return column ? Number(column.getBoundingClientRect().width.toFixed(2)) : null;
  });
}

async function narrowRatio(page: Page) {
  return page.evaluate(() =>
    Number(getComputedStyle(document.documentElement).getPropertyValue("--kub-chat-list-narrow").trim() || "0"),
  );
}

/** Drags the handle so the list's right edge lands at `width`, and lets go. */
async function dragListTo(page: Page, width: number, { release = true } = {}) {
  const handle = page.getByTestId("chat-list-resizer");
  const box = await handle.boundingBox();
  const region = await page.locator("[data-kub-left-region]").boundingBox();
  if (!box || !region) throw new Error("the handle or the left region has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(region.x + width, box.y + box.height / 2, { steps: 12 });
  if (release) await page.mouse.up();
  await page.waitForTimeout(120);
}

test.describe("the computer's shell: a folder rail, a side list and a list that narrows", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("the folder rail is 72pt, carries the counts, and leaves the horizontal strip alone", async ({ page }) => {
    test.skip(!isDesktop(page), "the rail is a computer's");
    await boot(page);
    const rail = page.getByTestId("folder-rail");
    await expect(rail).toBeVisible();
    expect((await rail.boundingBox())?.width).toBe(RAIL_WIDTH);

    // «Все» plus the one folder, in the order the strip has them.
    const items = rail.getByTestId("folder-rail-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveAttribute("aria-label", "Все");
    await expect(items.nth(1)).toHaveAttribute("aria-label", "Личные");

    // The counts are the ones the product already computes: each of the sixteen
    // chats has one unread message, and one of them is in «Личные».
    await expect(items.nth(0).getByTestId("folder-rail-count")).toHaveText("16");
    await expect(items.nth(1).getByTestId("folder-rail-count")).toHaveText("1");

    // Telegram ships both arrangements as a setting and so do we: the rail does
    // not replace the horizontal strip above the list. Found inside the list's
    // own chrome, because the strip's button reads «Личные 1» — the name and
    // its count — where the rail's carries the name as its label.
    const strip = page.locator("[data-kub-list-chrome]").getByRole("button", { name: /Личные/ });
    await expect(strip).toBeVisible();
  });

  test("the side-menu button is on the rail, and no longer above the chat list", async ({ page }) => {
    test.skip(!isDesktop(page), "below md the button stays in the list's header");
    await boot(page);
    const button = page.getByTestId("side-menu-button");
    await expect(button).toBeVisible();

    const placed = await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>('[data-testid="side-menu-button"]');
      const rail = document.querySelector<HTMLElement>('[data-testid="folder-rail"]');
      const row = document.querySelector<HTMLElement>('[data-testid="sidebar-control-row"]');
      const header = row?.querySelector<HTMLElement>('[aria-label="Меню"]');
      return {
        onTheRail: Boolean(rail && menu && rail.contains(menu)),
        // The header's own button is still in the markup for a phone; from `md`
        // it must not be on screen.
        inTheHeader: Boolean(header && header.getBoundingClientRect().width > 0),
      };
    });
    expect(placed).toEqual({ onTheRail: true, inTheHeader: false });
  });

  test("the side list is a layer: no width closed, over the window open, and gone again", async ({ page }) => {
    test.skip(!isDesktop(page), "the side list is a computer's");
    await boot(page);

    const widthClosed = await listColumnWidth(page);
    await expect(page.getByTestId("side-menu-layer")).toHaveCount(0);

    await page.getByTestId("side-menu-button").click();
    const layer = page.getByTestId("side-menu-layer");
    await expect(layer).toBeVisible();

    const open = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="side-menu-layer"]');
      if (!panel) throw new Error("no layer");
      const style = getComputedStyle(panel);
      return { position: style.position, left: panel.getBoundingClientRect().left };
    });
    // A layer, not a column: it is laid out against the viewport and starts at
    // the window's own edge.
    expect(open.position).toBe("fixed");
    expect(open.left).toBeLessThanOrEqual(1);
    // And it costs the list nothing.
    expect(await listColumnWidth(page)).toBe(widthClosed);

    await page.keyboard.press("Escape");
    await expect(layer).toHaveCount(0);
    await page.getByTestId("side-menu-button").click();
    await expect(layer).toBeVisible();
    await page.getByTestId("side-menu-scrim").click({ position: { x: 600, y: 400 } });
    await expect(layer).toHaveCount(0);
  });

  test("the side list holds the rows the owner approved, with the night switch and the version", async ({ page }) => {
    test.skip(!isDesktop(page), "the side list is a computer's");
    await boot(page);
    await page.getByTestId("side-menu-button").click();
    const layer = page.getByTestId("side-menu-layer");
    for (const label of [
      "Мой профиль",
      "Избранное",
      "Новая группа",
      "Мои боты",
      "Задачи",
      "Управление",
      "Настройки",
    ]) {
      await expect(layer.getByRole("button", { name: label, exact: true }), `${label} is not in the side list`).toBeVisible();
    }
    await expect(layer.getByTestId("side-menu-night-mode")).toBeVisible();
    // The version line is asserted in the Windows check below. A development
    // build's own version is «0.0.0», which `getVisibleReleaseVersion` refuses
    // on purpose, so here there is nothing true to print.
  });

  test("administration lives in the side list on a computer, and only with the right", async ({ page }) => {
    test.skip(!isDesktop(page), "the side list is a computer's");
    const fixture = await boot(page, { staff: false });
    await page.getByTestId("side-menu-button").click();
    const layer = page.getByTestId("side-menu-layer");
    await expect(layer.getByRole("button", { name: "Настройки", exact: true })).toBeVisible();
    // The rights are asked for asynchronously; an absence before the answer
    // proves nothing.
    await expect.poll(() => fixture.rpcBodies("has_permission").length).toBeGreaterThan(0);
    await page.waitForTimeout(800);
    await expect(layer.getByRole("button", { name: "Управление", exact: true })).toHaveCount(0);
    await expect(layer.getByRole("button", { name: "Задачи", exact: true })).toHaveCount(0);
  });

  test("every destination in the side list opens, and the way back returns to the list", async ({ page }) => {
    test.skip(!isDesktop(page), "the side list is a computer's");
    await boot(page);
    const open = async (label: string) => {
      await page.getByTestId("side-menu-button").click();
      await page.getByTestId("side-menu-layer").getByRole("button", { name: label, exact: true }).click();
    };

    await open("Задачи");
    await expect(page).toHaveURL(/\/tasks$/);
    await page.getByRole("button", { name: "Назад" }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);

    await open("Управление");
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);

    await open("Мои боты");
    await expect(page).toHaveURL(/\/bots$/);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);

    await open("Настройки");
    await expect(page.getByRole("dialog").first()).toBeVisible();
  });

  test("a computer has no bottom capsule at all", async ({ page }) => {
    await boot(page);
    const bar = page.getByRole("navigation", { name: "Навигация" });
    if (isDesktop(page)) {
      // Telegram Desktop has none, and neither do we. It stays in the markup
      // for the phone and must never be on screen here.
      await expect(bar).toBeHidden();
    } else {
      await expect(bar).toBeVisible();
    }
  });

  test("the list narrows by dragging, continuously, down to Telegram's 66pt", async ({ page }) => {
    test.skip(!isDesktop(page), "there is nothing to drag on a phone");
    await boot(page);
    expect(await narrowRatio(page)).toBe(0);

    // Held, the column follows the pointer through the band between the strip
    // and the normal narrowest. A snap would put it at 66 or 260 instead.
    await dragListTo(page, 150, { release: false });
    const held = await listColumnWidth(page);
    expect(held, "the column snapped instead of following the pointer").toBeGreaterThan(COLLAPSED_WIDTH + 20);
    expect(held).toBeLessThan(MIN_WIDTH - 20);
    const ratio = await narrowRatio(page);
    expect(ratio, "the narrow ratio is a switch, not a ratio").toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
    await page.mouse.up();
    await page.waitForTimeout(150);

    // Let go down there and it settles on the strip: one avatar and its
    // padding, and nothing else.
    await dragListTo(page, 40);
    expect(await listColumnWidth(page)).toBe(COLLAPSED_WIDTH);
    expect(await narrowRatio(page)).toBe(1);
    const row = await page.getByTestId("chat-list-item").first().boundingBox();
    expect(row?.width).toBe(COLLAPSED_WIDTH);
    // The avatar is still there and still the thing you orient by.
    await expect(page.getByTestId("chat-list-item").first().locator("[data-chat-avatar]")).toBeVisible();

    // And it comes back.
    await dragListTo(page, 420);
    expect(await listColumnWidth(page)).toBe(420);
    expect(await narrowRatio(page)).toBe(0);
  });

  test("the width and the collapsed state both survive a reload", async ({ page }) => {
    test.skip(!isDesktop(page), "there is nothing to drag on a phone");
    await boot(page);

    await dragListTo(page, 460);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);
    expect(await listColumnWidth(page), "the dragged width was forgotten").toBe(460);

    // tdesktop#6409: Telegram remembers the width and forgets the collapsed
    // state. This is the half that has to keep working.
    await page.getByTestId("chat-list-resizer").dblclick();
    await page.waitForTimeout(150);
    expect(await listColumnWidth(page)).toBe(COLLAPSED_WIDTH);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);
    expect(await listColumnWidth(page), "the collapsed state was forgotten").toBe(COLLAPSED_WIDTH);

    // Opening it again restores the width it had before, not the default.
    await page.getByTestId("chat-list-resizer").dblclick();
    await page.waitForTimeout(150);
    expect(await listColumnWidth(page)).toBe(460);
  });

  test("the LETSCUBE mark is in the list's top row", async ({ page }) => {
    await boot(page);
    // Option B's one detail, taken because A drops the logo bar and a computer
    // would otherwise show the mark nowhere.
    const mark = page.getByTestId("sidebar-control-row").getByAltText("LETSCUBE");
    await expect(mark).toBeVisible();
  });

  test("in the Windows shell no page control reaches into the window buttons", async ({ page }) => {
    test.skip(!isDesktop(page), "the Windows shell is a desktop window");
    await installWindowsShell(page);
    await boot(page);
    await expect(page.getByTestId("desktop-window-controls")).toBeVisible();
    expect(await controlsInWindowButtons(page), "D-112: a page control is under the window buttons").toEqual([]);

    // The rail, the handle and the layer are new controls near the top edge, so
    // each is asked the same question. The side list in particular runs the
    // full height of the window at its left edge.
    await page.getByTestId("side-menu-button").click();
    await expect(page.getByTestId("side-menu-layer")).toBeVisible();
    expect(await controlsInWindowButtons(page), "the side list reaches into the window buttons").toEqual([]);
    // And it carries the installed version the bridge reports.
    await expect(page.getByTestId("side-menu-version")).toContainText("Версия 0.2.10");
    await page.keyboard.press("Escape");

    // «Задачи» is D-112 as the 2026-09-12 assessment measured it, and it is
    // **not fixed here**: this stage owns the messenger's shell, and the page's
    // own «+ Новая» has sat under the buttons since before it. The options
    // rendered for the owner solved it by making the buttons' strip the top
    // inset, which this branch does not do — see the report.
    //
    // Asserted as a named set rather than as an empty one, so it is a ratchet:
    // the moment anything the shell adds reaches that corner, this fails.
    await page.goto("/tasks", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Новая" })).toBeVisible();
    expect(
      await controlsInWindowButtons(page),
      "D-112 on «Задачи» grew beyond the page's own «Новая»",
    ).toEqual(["Новая"]);
  });

  test("a folder on the rail chooses it, and the chosen one edits it", async ({ page }) => {
    test.skip(!isDesktop(page), "the rail is a computer's");
    await boot(page);
    const personal = page.getByTestId("folder-rail").getByTestId("folder-rail-item").nth(1);
    await personal.click();
    await expect(personal).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("chat-list-item")).toHaveCount(1);
    await expect(page.getByTestId("chat-list-item")).toHaveAttribute("data-chat-id", CHAT_BORIS);
    await personal.click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
  });
});
