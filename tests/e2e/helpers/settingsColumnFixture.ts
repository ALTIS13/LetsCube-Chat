import { expect, type Page } from "@playwright/test";
import { chat, membership, message, openFixture, person, type Row } from "./messageActionsFixture";

/**
 * The settings screen, seeded and reachable without signing in.
 *
 * D-222's three tier-1 cards all live inside one screen that renders in two
 * containers — the chat-list column above `md`, a viewport sheet below it — so
 * every one of them has to be photographed and asserted in both. This puts the
 * screen on the page with a catalogue of its own, a Windows shell bridge when a
 * spec asks for one, and the column at whatever width the spec names.
 *
 * Everything it seeds is invented. The achievement and cosmetic rows carry the
 * product's own catalogue, which is public and checked into the migrations; no
 * row here is anybody's data.
 */

export const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
export const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");

const AT = "2026-09-18T09:00:00.000Z";
const TEAM = "22222222-2222-4222-8222-000000000001";
const SHA256 = "a".repeat(64);

/** The catalogue as the migrations write it, so the titles are the real ones. */
const ACHIEVEMENTS = [
  {
    key: "tester",
    title: "Тестировщик",
    description: "Был с LETSCUBE ещё до первых приложений для Android и Windows",
    icon: "shield",
    grant_kind: "auto",
    sort_order: 10,
  },
  {
    key: "alpha_tester",
    title: "Альфа-тестер",
    description: "Был с LETSCUBE во время альфа-тестирования",
    icon: "shield",
    grant_kind: "auto",
    sort_order: 15,
  },
  {
    key: "beta_tester",
    title: "Бета-тестер",
    description: "Был с LETSCUBE до выхода 1.0",
    icon: "zap",
    grant_kind: "auto",
    sort_order: 20,
  },
  {
    key: "settled_in",
    title: "Освоился",
    description: "В LETSCUBE больше месяца",
    icon: "check",
    grant_kind: "auto",
    sort_order: 30,
  },
  {
    key: "veteran",
    title: "Ветеран",
    description: "В LETSCUBE больше года",
    icon: "crown",
    grant_kind: "auto",
    sort_order: 40,
  },
  {
    key: "conversationalist",
    title: "Собеседник",
    description: "Отправил 100 сообщений",
    icon: "chats",
    grant_kind: "auto",
    sort_order: 50,
  },
  {
    key: "storyteller",
    title: "Рассказчик",
    description: "Отправил 1000 сообщений",
    icon: "chatRect",
    grant_kind: "auto",
    sort_order: 60,
  },
];

const COSMETICS = [
  {
    key: "frame_tester",
    kind: "frame",
    title: "Рамка тестировщика",
    required_achievement: "tester",
    sort_order: 10,
  },
  {
    key: "frame_alpha",
    kind: "frame",
    title: "Рамка альфа-тестера",
    required_achievement: "alpha_tester",
    sort_order: 15,
  },
  {
    key: "frame_beta",
    kind: "frame",
    title: "Рамка бета-тестера",
    required_achievement: "beta_tester",
    sort_order: 20,
  },
  {
    key: "frame_veteran",
    kind: "frame",
    title: "Рамка ветерана",
    required_achievement: "veteran",
    sort_order: 30,
  },
  {
    key: "frame_talker",
    kind: "frame",
    title: "Рамка собеседника",
    required_achievement: "conversationalist",
    sort_order: 40,
  },
  {
    key: "bg_aurora",
    kind: "background",
    title: "Северное сияние",
    required_achievement: "settled_in",
    sort_order: 10,
  },
  {
    key: "bg_circuit",
    kind: "background",
    title: "Схема",
    required_achievement: "conversationalist",
    sort_order: 20,
  },
  {
    key: "bg_prism",
    kind: "background",
    title: "Призма",
    required_achievement: "tester",
    sort_order: 30,
  },
];

const STATS = [
  { achievement_key: "tester", holders: 4, eligible: 90 },
  { achievement_key: "alpha_tester", holders: 7, eligible: 90 },
  { achievement_key: "beta_tester", holders: 18, eligible: 90 },
  { achievement_key: "settled_in", holders: 46, eligible: 90 },
  { achievement_key: "veteran", holders: 0, eligible: 90 },
  { achievement_key: "conversationalist", holders: 25, eligible: 90 },
  { achievement_key: "storyteller", holders: 6, eligible: 90 },
];

const SYNC = {
  earned: ["tester", "alpha_tester", "beta_tester", "settled_in"],
  progress: {
    veteran: { current: 118, target: 365 },
    conversationalist: { current: 64, target: 100 },
    storyteller: { current: 64, target: 1000 },
  },
};

/**
 * A profile that has been moved off the default folder, because that is the
 * state that renders both buttons — «Вернуть по умолчанию» beside «Изменить
 * папку» — and the pair is what the third column was taking the card for.
 */
const STORAGE_STATE = {
  location: "D:\\LETSCUBE\\webview-production-v1",
  is_default_location: false,
  total_bytes: 1_932_735_283,
  cache_bytes: 704_643_072,
  cache_limit_bytes: 2 * 1024 * 1024 * 1024,
  min_cache_limit_bytes: 128 * 1024 * 1024,
  max_cache_limit_bytes: 20 * 1024 * 1024 * 1024,
  pending_location: null as string | null,
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

export interface SettingsFixtureOptions {
  theme?: "dark" | "light";
  /** The chat-list column's stored width, restored before the first paint. */
  columnWidth?: number;
  /** Installs a Windows shell bridge, which is what `StorageSection` needs. */
  desktopShell?: boolean;
  /**
   * Makes the release catalogue unreachable, which is the state that renders
   * «Повторить» — the third of the three buttons D-222 names, and the only one
   * of them reachable in a browser on the desktop layout.
   */
  releaseUnavailable?: boolean;
  /**
   * Lets Inter through the fixture's blanket abort.
   *
   * Off by default: a contract must not depend on a font host being reachable.
   * The capture spec turns it on, because Segoe UI is the Windows fallback and
   * it is narrow enough to hide the very clipping the owner photographed — a
   * screenshot taken without the shipped font is a picture of a different
   * product.
   */
  webFont?: boolean;
}

export async function openSettingsScreen(page: Page, options: SettingsFixtureOptions = {}) {
  const {
    theme = "dark",
    columnWidth,
    desktopShell = false,
    webFont = false,
    releaseUnavailable = false,
  } = options;

  await openFixture(page, {
    me: ME,
    people: [ANNA],
    ...seed(),
    rpc: (name) => (name === "achievements_sync" ? { body: SYNC } : undefined),
  });

  const table = (name: string, rows: unknown) =>
    page.route(`**/rest/v1/${name}?**`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) }),
    );
  await table("achievements", ACHIEVEMENTS);
  await table("cosmetics", COSMETICS);
  await table("achievement_stats", STATS);

  // The client caches a manifest in localStorage with a TTL, and an entry from
  // an earlier run answers before a stub is ever reached.
  await page.addInitScript(() => {
    try {
      for (const key of Object.keys(globalThis.localStorage ?? {})) {
        if (key.startsWith("letscube:release-catalog:")) localStorage.removeItem(key);
      }
    } catch {
      /* a browser that blocks site data has no cache to clear */
    }
  });

  for (const platform of ["windows", "android"] as const) {
    if (releaseUnavailable) {
      await page.route(`https://api.letscube.ru/releases/v1/${platform}/stable.json`, (route) =>
        route.abort("connectionfailed"),
      );
      continue;
    }
    await page.route(`https://api.letscube.ru/releases/v1/${platform}/stable.json`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          schemaVersion: 1,
          platform,
          channel: "stable",
          available: true,
          version: "0.2.14",
          build: 18,
          publishedAt: "2026-09-12T00:00:00.000Z",
          minimumSupportedVersion: null,
          mandatory: false,
          notes: "",
          artifact: {
            url: `https://api.letscube.ru/releases/files/${platform}/0.2.14/letscube-0.2.14.${platform === "android" ? "apk" : "exe"}`,
            size: 8_734_685,
            sha256: SHA256,
          },
        }),
      }),
    );
  }

  if (webFont) {
    await page.route(
      (url) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com",
      (route) => route.continue(),
    );
  }

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

  if (desktopShell) {
    // A stub of the wire, not of the rules: it answers the same snake_case
    // payload the Rust command serialises, and everything the page then does
    // with it is the shipped code. Installed before the application's modules
    // run, which is the guarantee Tauri's own init script gives.
    await page.addInitScript((initial) => {
      let current = { ...(initial as Record<string, unknown>) };
      const idle = {
        enabled: false,
        start_minimized: false,
        entry_present: false,
        entry_matches_install: false,
        blocked_by_windows: false,
      };
      Object.defineProperty(window, "letscubeDesktop", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: Object.freeze({
          platform: "windows",
          version: "0.2.14",
          build: 18,
          getRuntimeInfo: async () => ({ platform: "windows", version: "0.2.14", build: 18 }),
          getAutostart: async () => idle,
          setAutostart: async () => idle,
          getStorageState: async () => current,
          setStorageLocation: async (location: string | null) => {
            current = { ...current, pending_location: location };
            return current;
          },
          setCacheLimit: async (bytes: number) => {
            current = { ...current, cache_limit_bytes: bytes };
            return current;
          },
          clearCache: async () => {
            current = { ...current, cache_bytes: 0 };
            return current;
          },
        }),
      });
    }, STORAGE_STATE);
  }

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
}

/** Opens one of the screen's disclosures and lets it settle. */
export async function openDisclosure(page: Page, id: "decoration" | "application") {
  await page.getByTestId(`settings-open-${id}`).click();
  await expect(page.getByTestId(`settings-section-${id}`)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // The disclosure animates in; let it land before anything is measured.
  await page.waitForTimeout(400);
}

/**
 * Drags the column, by writing exactly what the handle writes.
 *
 * `ChatListResizer` puts the width on `document.documentElement` as a custom
 * property and never into React state, so this is the live mechanism rather
 * than a stand-in for it.
 */
export async function setColumnWidth(page: Page, width: number) {
  await page.evaluate((value) => {
    document.documentElement.style.setProperty("--kub-chat-list-width", `${value as number}px`);
  }, width);
  await page.waitForTimeout(120);
}

/** The grid tracks of a card's own header grid, in CSS pixels. */
export function gridTracks(page: Page, testId: string): Promise<number[]> {
  return page.evaluate((id) => {
    const card = document.querySelector(`[data-testid='${id as string}']`) as HTMLElement | null;
    if (!card) throw new Error(`no card ${id as string}`);
    const grid = card.querySelector(":scope > div.grid") as HTMLElement | null;
    if (!grid) throw new Error(`no grid inside ${id as string}`);
    return getComputedStyle(grid)
      .gridTemplateColumns.split(" ")
      .map((value) => Math.round(parseFloat(value)));
  }, testId);
}
