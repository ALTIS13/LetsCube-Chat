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
 *     already compute, and on a computer it REPLACES the horizontal strip, so
 *     the same folders are never drawn twice (owner, 2026-09-12);
 *  2. the side-menu button is on the rail, not above the chat list;
 *  3. the side list is a layer: it costs no width closed, opens over the
 *     window, and closes again;
 *  4. administration is in that layer on a computer, behind its right;
 *  5. every destination the layer offers actually opens;
 *  6. there is no bottom capsule on a computer at all;
 *  7. the list narrows by dragging, continuously, down to exactly 66pt;
 *  8. the width and the collapsed state survive a reload — the one thing
 *     Telegram does not do (tdesktop#6409);
 *  9. the LETSCUBE mark is in the list's top row, exactly once;
 * 10. the window begins with the rail — nothing is drawn above it;
 * 11. D-112: no page control reaches into the Windows window buttons, with the
 *     side list open and with a chat open;
 * 12. a folder on the rail chooses, and the chosen one edits.
 *
 * Checks 9 and 10 are the owner's two complaints about the application's top
 * bar, answered on 2026-09-12 by removing it. Both fail with that bar restored,
 * which is what makes them the contract rather than a description.
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

/**
 * Sixteen chats, so the list scrolls at any width under test.
 *
 * `pinned` pins those chats for me, in the order given. Opt-in, so every other
 * test in this file sees exactly the list it always saw.
 */
function fixtureRows(pinned: string[] = []) {
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
    const mine = membership(id, ME, "owner", READ);
    const pinnedIndex = pinned.indexOf(id);
    if (pinnedIndex >= 0) {
      Object.assign(mine, { pinned: true, pinned_at: READ, pinned_order: pinnedIndex + 1 });
    }
    memberships.push(mine, membership(id, other, "member", at));
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

async function boot(
  page: Page,
  { staff = true, storedShell = null as string | null, pinned = [] as string[] } = {},
) {
  if (storedShell !== null) {
    await page.addInitScript((value) => {
      localStorage.setItem("kub-desktop-chat-list", value);
    }, storedShell);
  }
  const me = { ...ME, role: staff ? "manager" : "user" };
  const fixture = await openFixture(page, {
    me,
    ...fixtureRows(pinned),
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
    // One host since 2026-09-12. `desktop-window-controls` was the group
    // inside the application's top bar, which no longer exists; a selector
    // list that keeps a name nothing can match reads as a fallback and is
    // really a dead branch.
    const host = document.querySelector('[data-testid="desktop-window-chrome"]');
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

/**
 * The fold's computed opacity.
 *
 * Not `toBeVisible()`: Playwright calls an `opacity: 0` box visible, so the
 * check that matters here — «is the way back on the screen» — cannot be asked
 * that way at all.
 */
async function foldOpacity(page: Page) {
  return page.evaluate(() => {
    const fold = document.querySelector("[data-kub-chat-list-fold]");
    return fold ? Number(getComputedStyle(fold).opacity) : null;
  });
}

/**
 * The narrow ratio, read off `.kub-chat-list-column` — not the document, and
 * not the region either.
 *
 * Both properties moved off the root on 2026-09-20 (D-268): written on
 * `document.documentElement` they cost a whole-document style resolution on
 * every frame of a drag — 12.2ms on a 3405-node page, and the same 12.2ms for a
 * property **nothing reads**, because every element inherits the root's.
 * Reading them from the root still answers, with the stale `:root` default
 * `index.css` declares for the first paint, so this helper would have passed
 * forever while the ratio it checks never moved again.
 *
 * The column rather than the region that holds it, and that is the point of the
 * choice: every rule the ratio drives is scoped `.kub-chat-list-column …` — the
 * list's chrome, the row's gap and padding, the row's body, and the four the
 * voice bars carry, `.kub-voice-call-bar__extra` among them, which is the
 * deafen control D-267 is about. Asking the column asks whether the value
 * actually reaches the elements the rules apply to; asking the region would
 * report a broken inheritance chain between the two as fine.
 */
async function narrowRatio(page: Page) {
  return page.evaluate(() => {
    const column = document.querySelector<HTMLElement>(".kub-chat-list-column");
    if (!column) return null;
    return Number(getComputedStyle(column).getPropertyValue("--kub-chat-list-narrow").trim() || "0");
  });
}

/**
 * Where each row's avatar starts, in viewport pixels — one number per row.
 *
 * A pinned row that carries anything of its own before the picture shows up
 * here as a second value, whatever that thing is called.
 */
async function avatarLefts(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="chat-list-item"]')].map((row) => {
      const avatar = row.querySelector("[data-chat-avatar]");
      return avatar ? Number(avatar.getBoundingClientRect().left.toFixed(2)) : null;
    }),
  );
}

/**
 * Drags the handle so the **column** is `width` wide, and lets go.
 *
 * The pointer goes to `region.x + REGION_CHROME + width`, not `region.x +
 * width`. That second form is what this helper did until 2026-09-14, and it is
 * the defect it was supposed to catch: the region is the rail plus the column
 * plus a hairline, so aiming at the region's own left edge asks for a column
 * 73px wider than the number. The product agreed with it — it wrote the
 * region's width into the column's variable — so the test passed while the
 * handle lagged the pointer by 73px on every frame (D-196).
 */
const REGION_CHROME = 73;

async function dragListTo(page: Page, width: number, { release = true } = {}) {
  const handle = page.getByTestId("chat-list-resizer");
  const box = await handle.boundingBox();
  const region = await page.locator("[data-kub-left-region]").boundingBox();
  if (!box || !region) throw new Error("the handle or the left region has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(region.x + REGION_CHROME + width, box.y + box.height / 2, { steps: 12 });
  if (release) await page.mouse.up();
  await page.waitForTimeout(120);
}

test.describe("the computer's shell: a folder rail, a side list and a list that narrows", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("the handle sits on the seam and takes no width of its own", async ({ page }) => {
    test.skip(!isDesktop(page), "there is nothing to drag below `md`");
    await boot(page);

    const region = await page.locator("[data-kub-left-region]").boundingBox();
    const pane = await page.locator("[data-kub-panes] > div").last().boundingBox();
    const handle = await page.getByTestId("chat-list-resizer").boundingBox();
    if (!region || !pane || !handle) throw new Error("a box is missing");

    // No gap between the two panes. The handle used to be a flex sibling 6px
    // wide, and those 6px were a band of the application's own ground — a black
    // strip down the seam in the dark theme, which is what the owner saw. A
    // grip is drawn on the edge, not wedged between the panes.
    expect(
      Math.abs(pane.x - (region.x + region.width)),
      "the handle is pushing the panes apart",
    ).toBeLessThanOrEqual(1);

    // And it is over the seam, not beside it.
    expect(
      Math.abs(handle.x + handle.width / 2 - (region.x + region.width)),
      "the grip is not centred on the edge it drags",
    ).toBeLessThanOrEqual(2);
 
  });

  test("the folder rail is 72pt, carries the counts, and is the only folder surface on a computer", async ({ page }) => {
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

    // Inverted on 2026-09-12, knowingly. This assertion used to require the
    // strip to be visible here, on the grounds that «Telegram ships both
    // arrangements as a setting and so do we». We do not: there is no such
    // setting anywhere in the source, so both arrangements rendered at once
    // and the owner saw his folders twice. The strip is now the phone's only,
    // gated at the mount site in `Sidebar.tsx` — not inside `FolderTabs`,
    // which must stay width-agnostic for the phone. `PublicPreviewCapturePage`
    // carries the same mount-site gate since 2026-09-12, so the published
    // product images show one folder surface as well.
    //
    // Found inside the list's own chrome, because the strip's button reads
    // «Личные 1» — the name and its count — where the rail's carries the name
    // as its label.
    const strip = page.locator("[data-kub-list-chrome]").getByRole("button", { name: /Личные/ });
    await expect(strip).toHaveCount(0);
  });

  // The other half of the same contract. Without it the change above would
  // merely have removed a protection: the strip is the only folder surface a
  // phone has, so something must fail when it disappears from there.
  test("the phone keeps the horizontal strip, which is its only folder surface", async ({ page }) => {
    test.skip(isDesktop(page), "the strip is the phone's");
    await boot(page);
    // Hidden, not absent: the rail's root is `hidden … md:flex`, so it stays
    // in the markup at every width and simply is not displayed on a phone —
    // the same distinction the side-menu test below draws for the header's
    // own button. Asserting absence here failed against a real phone render.
    await expect(page.getByTestId("folder-rail")).toBeHidden();
    const strip = page.locator("[data-kub-list-chrome]").getByRole("button", { name: /Личные/ });
    await expect(strip).toBeVisible();

    // «Its only» was a claim this test did not check until D-120, and it was
    // false: the bottom capsule carried «Папки», which opened a full-screen
    // folder list over the strip. Both halves of that are measured now.
    const bar = page.getByRole("navigation", { name: "Навигация" });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button", { name: "Папки" })).toHaveCount(0);

    // The whole capsule, not the one word, so a folder door under another name
    // is caught by the same assertion. `boot` signs in a manager, so «Задачи»
    // is offered; `tests/unit/bottom-nav-destinations.test.mts` covers the
    // account that is not.
    const labels = await bar
      .getByRole("button")
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label") ?? ""));
    expect(labels).toEqual(["Чаты", "Профиль", "Задачи"]);

    // And the screen that tab opened is not reachable from anywhere else: its
    // «Новая папка» footer is the one string only it ever drew.
    await expect(page.getByRole("dialog").filter({ hasText: "Новая папка" })).toHaveCount(0);
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

    // Since D-160 this destination is the list column's body rather than a
    // centred dialog: on a computer the 896px sheet with 272px of dead margin
    // each side is gone, and with it the blur over the whole application. The
    // phone keeps the sheet, which `settings-column.spec.ts` asserts.
    await open("Настройки");
    await expect(page.getByTestId("sidebar-settings")).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
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

  /**
   * D-269. The fold existed and could not be found.
   *
   * Until 2026-09-20 the only two ways into it were a double click on a 9px
   * seam that draws nothing at rest, and dragging 134px past the narrowest
   * resting width. The owner asked for the feature he already had — «нет
   * возможности быстро свернуть часть с чатами» — which is what an
   * undiscoverable feature looks like from outside.
   *
   * Discord is not the reference. Its channel sidebar does not collapse at all:
   * the collapse ships in its stable build and is switched off (the state is
   * computed and then `&& false`d, so `data-collapsed` is always "false" and the
   * 76px path never runs), and collapsing is a BetterDiscord/Vencord plugin.
   * Telegram Desktop's strip of avatars is the reference, as it is for every
   * number in `lib/desktopChatList.ts`.
   */
  test("the fold has a control, and the control is reversible", async ({ page }) => {
    test.skip(!isDesktop(page), "there is no seam on a phone");
    await boot(page);

    const fold = page.getByTestId("chat-list-fold");
    await dragListTo(page, 440);
    expect(await listColumnWidth(page)).toBe(440);

    // Folded by the control, not by a gesture nobody was told about.
    await fold.click();
    await page.waitForTimeout(200);
    expect(await listColumnWidth(page), "the control did not fold the list").toBe(COLLAPSED_WIDTH);

    // And the way back is on the screen. `opacity`, not `visible`: the disc is
    // transparent at rest so it cannot cover the channel rail's first row, and
    // a Playwright visibility check cannot tell those two apart — it reports an
    // `opacity: 0` box as visible. The number is the contract.
    expect(await foldOpacity(page), "the folded list offers no visible way back").toBe(1);
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(fold).toHaveAttribute("aria-label", "Развернуть список чатов");

    // Unfolded, to the width it had, not to the default.
    await fold.click();
    await page.waitForTimeout(200);
    expect(await listColumnWidth(page), "the fold did not give the width back").toBe(440);
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await expect(fold).toHaveAttribute("aria-label", "Свернуть список чатов");
  });

  test("the fold is out of the way until the seam is reached for", async ({ page }) => {
    test.skip(!isDesktop(page), "there is no seam on a phone");
    await boot(page);

    // At rest it draws nothing. Centred on the seam, a 20px disc stands half
    // over whatever is on the right, and in a group with channels that is the
    // rail's first row: photographed at 1440, it covered the accent bar of the
    // channel being read.
    expect(await foldOpacity(page), "the fold is painted over the pane beside it").toBe(0);

    // Reaching for the HANDLE brings it up — the sibling rule, which is the
    // half a hover on the disc itself cannot give: somebody who goes for the
    // line goes for the line, not for a 20px target they have not seen yet.
    const handle = await page.getByTestId("chat-list-resizer").boundingBox();
    if (!handle) throw new Error("the handle has no box");
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 400);
    await page.waitForTimeout(250);
    expect(await foldOpacity(page), "the seam was reached for and the fold stayed hidden").toBe(1);

    // And it is still a target while it is transparent: opacity hides a box, it
    // does not lift it out of hit testing.
    await page.mouse.move(handle.x + handle.width / 2, 0);
    await page.waitForTimeout(250);
    await page.getByTestId("chat-list-fold").click();
    await page.waitForTimeout(200);
    expect(await listColumnWidth(page)).toBe(COLLAPSED_WIDTH);
  });

  /**
   * D-268. Where the drag's style recalc went.
   *
   * Both properties were written on `document.documentElement`, and the module
   * said a drag costs zero React renders — true, and never where the time was.
   * Measured on 2026-09-20 with 140 messages and 25 chats on the page, 3405
   * nodes, 60 writes each: a custom property on the root costs 12.2ms of style
   * recalc per write **even when nothing reads it**, because every element
   * inherits the root's; the same property on the region costs 1.7ms. Recalc
   * plus layout came to 14.6ms a frame, which is the whole 60Hz budget spent
   * re-resolving message bubbles that cannot change.
   *
   * The mechanism is the contract because the milliseconds are the machine's.
   * Move either write back to the root and this goes red.
   */
  test("a drag writes the width on the region, never on the document", async ({ page }) => {
    test.skip(!isDesktop(page), "there is nothing to drag on a phone");
    await boot(page);
    await dragListTo(page, 420);

    const where = await page.evaluate(() => {
      const read = (el: HTMLElement | null) =>
        el ? { width: el.style.getPropertyValue("--kub-chat-list-width"), narrow: el.style.getPropertyValue("--kub-chat-list-narrow") } : null;
      return {
        root: read(document.documentElement),
        region: read(document.querySelector<HTMLElement>("[data-kub-left-region]")),
        seams: [...document.querySelectorAll<HTMLElement>("[data-kub-chat-list-seam]")].map(
          (box) => box.style.getPropertyValue("--kub-chat-list-width"),
        ),
      };
    });

    expect(where.region?.width, "the region does not carry the dragged width").toBe("420px");
    expect(where.region?.narrow, "the region does not carry the narrow ratio").toBe("0.0000");
    expect(where.root?.width, "the width is back on the document, and the drag pays for the whole tree").toBe("");
    expect(where.root?.narrow, "the ratio is back on the document").toBe("");

    // The handle and its fold stand beside the region and inherit nothing from
    // it, so each carries its own copy — that is what places them on the seam.
    expect(where.seams, "a box on the seam has no width to place itself by").toEqual(["420px", "420px"]);

    // And the region is actually that wide, so the property is not merely being
    // written somewhere harmless.
    expect(await listColumnWidth(page)).toBe(420);
  });

  test("the LETSCUBE mark is in the list's top row, and nowhere else", async ({ page }) => {
    await boot(page);
    // Option B's one detail, taken because A drops the logo bar and a computer
    // would otherwise show the mark nowhere.
    const mark = page.getByTestId("sidebar-control-row").getByAltText("LETSCUBE");
    await expect(mark).toBeVisible();
    // «Знак LETSCUBE появляется дважды» was one of the owner's two complaints
    // about the bar on 2026-09-12, and removing the bar is what answered it.
    // Counted across the whole page rather than asserted absent from the bar:
    // a second mark drawn anywhere else is the same defect under a new name.
    await expect(page.getByAltText("LETSCUBE")).toHaveCount(1);
  });

  test("the window begins with the folder rail, with no bar above it", async ({ page }) => {
    test.skip(!isDesktop(page), "the rail is a computer's");
    await boot(page);
    // The owner's other complaint: «полоса папок начинается ниже верхнего края
    // окна». Telegram Desktop's window begins with the rail and ours does now.
    // The rail's own box is asked for, not the region's, because a region that
    // reached the top edge with the rail padded down inside it would be the
    // same picture the bar drew.
    const shape = await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('[data-testid="folder-rail"]');
      const region = document.querySelector<HTMLElement>("[data-kub-left-region]");
      if (!rail || !region) throw new Error("no folder rail");
      const box = rail.getBoundingClientRect();
      return {
        railTop: Math.round(box.top),
        railLeft: Math.round(box.left),
        railWidth: box.width,
        regionTop: Math.round(region.getBoundingClientRect().top),
        // Anything spanning the window above the rail. A bar is a wide, short
        // box at the top; this finds one whatever it is called.
        above: [...document.querySelectorAll("header, nav, [data-testid]")]
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 400 && rect.height > 0 && rect.bottom <= box.top + 1;
          })
          .map((node) => node.getAttribute("data-testid") ?? node.tagName.toLowerCase()),
      };
    });
    expect(shape).toEqual({
      railTop: 0,
      railLeft: 0,
      railWidth: RAIL_WIDTH,
      regionTop: 0,
      above: [],
    });
  });

  test("in the Windows shell no page control reaches into the window buttons", async ({ page }) => {
    test.skip(!isDesktop(page), "the Windows shell is a desktop window");
    await installWindowsShell(page);
    await boot(page);
    // `desktop-window-chrome` since 2026-09-12: the buttons used to be drawn
    // inside the application's top bar, and they are the overlay strip every
    // other surface already had now that the bar is gone.
    await expect(page.getByTestId("desktop-window-chrome")).toBeVisible();
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
    await expect(page.getByTestId("side-menu-layer")).toHaveCount(0);

    // With a chat open, which is the case the bar's removal actually put at
    // risk: the chat header's «Ещё» capsule is at the right of its row, and
    // that row is the top of the pane now that nothing stands above it. It
    // clears the buttons because the pane reserves --kub-window-caption out of
    // its own top (`pt-window-top`), not because a band holds it down.
    await page.getByTestId("chat-list-item").first().click();
    await expect(page.getByTestId("chat-control-row")).toBeVisible();
    expect(
      await controlsInWindowButtons(page),
      "D-112: the chat header reaches into the window buttons",
    ).toEqual([]);
    const reserved = await page.evaluate(() => {
      // Through a computed padding, not `getPropertyValue`: a custom property
      // comes back as its unresolved token text — "2rem" — while every engine
      // resolves a padding to pixels. `lib/safeArea.ts` reads the four
      // safe-area tokens the same way and records the same reason.
      const probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText =
        "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding-top:var(--kub-window-caption)";
      document.body.appendChild(probe);
      const caption = Math.round(Number.parseFloat(getComputedStyle(probe).paddingTop) || 0);
      probe.remove();
      const row = document.querySelector('[data-testid="chat-control-row"]');
      const rail = document.querySelector('[data-testid="folder-rail"]');
      return {
        caption,
        rowTop: Math.round(row!.getBoundingClientRect().top),
        railTop: Math.round(rail!.getBoundingClientRect().top),
      };
    });
    // The reservation is real, and it is padding rather than a gap: the rail's
    // sheet still starts at the window's top edge while the chat pane's first
    // row starts below the buttons, by exactly the reservation.
    expect(reserved.caption).toBe(32);
    expect(reserved.rowTop).toBe(reserved.caption);
    expect(reserved.railTop).toBe(0);
    await page.getByRole("button", { name: "Назад" }).first().click().catch(() => undefined);

    // «Задачи» was the other half of D-112, and it is fixed now. The
    // 2026-09-12 assessment measured 64% of «+ Новая» under the buttons and
    // left it, because that stage owned the messenger's shell and the
    // reservation was applied by the messenger's panes rather than by the
    // pages. `KubHeader` — the header of the only two pages that are not the
    // messenger, «Задачи» and «Мои боты» — now reserves
    // `--kub-window-caption` the same way `ChatHeader` and `FolderRail` do.
    //
    // The set is empty rather than named, and it is still a ratchet: the
    // moment anything reaches that corner again, this fails with the name of
    // whatever it was.
    await page.goto("/tasks", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Новая" })).toBeVisible();
    expect(
      await controlsInWindowButtons(page),
      "a control on «Задачи» is back under the window buttons (D-112)",
    ).toEqual([]);

    // And the page's own row really did move: its top is the caption's height,
    // not zero — the reservation rather than a coincidence of layout.
    const tasksHeader = await page.evaluate(() => {
      const caption = document.querySelector('[data-testid="desktop-window-chrome"]');
      const header = document.querySelector("header");
      if (!caption || !header) return null;
      const captionBox = caption.getBoundingClientRect();
      const row = header.getBoundingClientRect();
      return { captionBottom: Math.round(captionBox.bottom), headerTop: Math.round(row.top) };
    });
    expect(tasksHeader, "no window chrome or no page header to measure").not.toBeNull();
    if (tasksHeader) {
      // The row starts at the window's top edge; its *content* is padded below
      // the caption, which is what `pt-window-top` does and what keeps the
      // material running under the strip.
      expect(tasksHeader.headerTop).toBe(0);
      expect(tasksHeader.captionBottom).toBeGreaterThan(0);
    }

    // «Мои боты» is the other page that is not the messenger — the only other
    // user of `KubHeader` — and it puts a «Документация» link in the same
    // corner, so it had the same defect and is fixed by the same reservation.
    // Checked here rather than assumed from the shared component: the entry's
    // own words are «any other page with controls in that corner».
    //
    // Note what this assertion can and cannot catch. Both pages take their
    // corner from `KubHeader`, so a regression there fails the «Задачи» check
    // above and execution never reaches this one — an early guard hiding the
    // rest, which this repository has been bitten by before. What it does catch
    // on its own is this page growing a control of its own outside that header,
    // which is the case the entry's wording is actually about.
    await page.goto("/bots", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /Документация/ })).toBeVisible();
    expect(
      await controlsInWindowButtons(page),
      "a control on «Мои боты» is under the window buttons (D-112)",
    ).toEqual([]);
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

  /**
   * 2026-09-12, the owner, looking at the rendered frames: «убери эти три
   * полосочки которые отображают закрепление, они сдвигают аватарки, а двигать
   * чаты должно быть можно и без них».
   *
   * The three stripes were a `h-8 w-4` handle standing before the avatar on
   * pinned rows only. These three checks are the two halves of what he asked:
   * the rows line up, and a pinned chat still moves — by pointer and without
   * one.
   */
  test("a pinned row keeps its avatar on the same axis as every other row", async ({ page }) => {
    test.skip(!isDesktop(page), "the strip and the drag are a computer's");
    await boot(page, { pinned: [CHAT_TEAM, CHAT_BORIS] });

    const rows = page.getByTestId("chat-list-item");
    await expect(rows.nth(0)).toHaveAttribute("data-chat-id", CHAT_TEAM);
    await expect(rows.nth(1)).toHaveAttribute("data-chat-id", CHAT_BORIS);

    // The property first and the mechanism after, so that a failure prints the
    // axes the avatars actually landed on rather than a count of the thing that
    // used to be responsible for it.
    const axes = (lefts: (number | null)[]) => [...new Set(lefts)];
    const atRest = await avatarLefts(page);
    expect(atRest).toHaveLength(CHAT_COUNT);
    expect(axes(atRest), "pinned and unpinned rows start their avatars at different x").toHaveLength(1);
    await expect(page.locator("[data-pinned-drag-handle]")).toHaveCount(0);

    // Held at each width of the narrowing band, not only at its two ends: the
    // handle kept its 16px while everything beside the avatar faded, so the
    // offset it opened grew as a share of the row on the way down.
    for (const width of [340, 300, 240, 150, 90]) {
      await dragListTo(page, width, { release: false });
      const lefts = await avatarLefts(page);
      expect(axes(lefts), `the avatars sit on more than one axis at ${width}px`).toHaveLength(1);
      await page.mouse.up();
      await page.waitForTimeout(80);
    }

    // And in the strip of avatars, which is the picture the owner was looking at.
    await dragListTo(page, 40);
    expect(await listColumnWidth(page)).toBe(COLLAPSED_WIDTH);
    expect(axes(await avatarLefts(page)), "the strip puts pinned avatars off the axis").toHaveLength(1);
  });

  test("a pinned chat reorders by dragging the row itself, and a plain click still opens it", async ({ page }) => {
    test.skip(!isDesktop(page), "the drag is a computer's");
    const fixture = await boot(page, { pinned: [CHAT_TEAM, CHAT_BORIS] });
    const rows = page.getByTestId("chat-list-item");

    // With the handle gone, the row is what has to say it can be moved — and
    // say it as a description, not as its name, which is the chat's.
    const announced = await page.evaluate(
      ({ pinnedId, plainId }) => {
        const read = (chatId: string) => {
          const row = document.querySelector(`[data-testid="chat-list-item"][data-chat-id="${chatId}"]`);
          const described = row?.getAttribute("aria-describedby") ?? null;
          return {
            draggable: row?.getAttribute("draggable") ?? null,
            name: row?.textContent?.includes("Закреплённый чат") ?? null,
            description: described ? document.getElementById(described)?.textContent?.trim() ?? null : null,
          };
        };
        return { pinnedRow: read(pinnedId), plainRow: read(plainId) };
      },
      { pinnedId: CHAT_TEAM, plainId: "22222222-2222-4222-8222-000000000003" },
    );
    expect(announced.pinnedRow.draggable).toBe("true");
    expect(announced.pinnedRow.description).toContain("Закреплённый чат");
    expect(announced.plainRow.draggable).toBe("false");
    expect(announced.plainRow.description).toBeNull();

    // Dropped on the row below it, the order it sends is the swapped one.
    await rows.nth(0).dragTo(rows.nth(1));
    await expect.poll(() => fixture.rpcBodies("set_pinned_chat_order").length).toBe(1);
    expect(fixture.rpcBodies("set_pinned_chat_order")[0]).toEqual({ p_chat_ids: [CHAT_BORIS, CHAT_TEAM] });
    await expect(rows.nth(0)).toHaveAttribute("data-chat-id", CHAT_BORIS);

    // And the click after the drag opens the chat rather than being eaten by
    // the drag's own click suppression — the row is both now.
    await page.locator(`[data-testid="chat-list-item"][data-chat-id="${CHAT_TEAM}"]`).click();
    await expect(
      page.locator('[data-message-bubble="true"]').filter({ hasText: "Макет главной готов" }),
    ).toBeVisible();
  });

  test("a pinned chat can be moved without a pointer", async ({ page }) => {
    test.skip(!isDesktop(page), "this menu is a computer's");
    const fixture = await boot(page, { pinned: [CHAT_TEAM, CHAT_BORIS] });

    // Dragging is a pointer's, so the row's own menu is the whole keyboard
    // path. It opens on the Menu key from the focused row.
    await page.getByTestId("chat-list-item").nth(0).focus();
    await page.keyboard.press("ContextMenu");
    const menu = page.locator('[data-chat-context-menu="desktop"]');
    await expect(menu).toBeVisible();
    const move = menu.getByRole("menuitem", { name: "Переместить ниже", exact: true });
    await move.focus();
    await page.keyboard.press("Enter");

    await expect.poll(() => fixture.rpcBodies("set_pinned_chat_order").length).toBe(1);
    expect(fixture.rpcBodies("set_pinned_chat_order")[0]).toEqual({ p_chat_ids: [CHAT_BORIS, CHAT_TEAM] });
  });
});
