import { expect, type Page } from "@playwright/test";

/**
 * The bot settings panel, seeded and reachable without signing in.
 *
 * D-222's tier 2 names eight lines inside `BotSettingsPanel` and one inside
 * `SupportTicketDetails`, and the entry is explicit that all nine were computed
 * rather than seen. This puts the panel on the screen so they can be
 * photographed and, where the pixels convict them, asserted.
 *
 * Everything it seeds is invented: no production bot, no owner id, no real
 * token. `TOKEN_PREFIX` is a fictional prefix and is the only token-shaped
 * string the panel ever draws — nothing here issues or displays a whole token.
 *
 * The pattern is `bot-management.spec.ts`'s own, lifted into a helper because
 * the capture spec and the contract spec both need it.
 */

export const MANAGEMENT_API = "http://127.0.0.1:54322/bot/manage/v1";
export const SUPABASE_FIXTURE = "http://127.0.0.1:54321";

const USER_ID = "11111111-1111-4111-8111-00000000d222";
const OWNER_BOT_ID = "22222222-2222-4222-8222-00000000d222";
const AT = "2026-09-18T09:00:00.000Z";
/** Fictional, and the only token-shaped string on screen. */
const TOKEN_PREFIX = "lc_bot_0123456789";

/**
 * The widest label the panel can be made to draw from checked-in copy.
 *
 * Every string below is either the product's own fixed copy or a plausible
 * Russian command description; nothing is a real bot's configuration.
 */
const COMMANDS = [
  { command: "smena", description: "Ближайшая смена и точка выхода" },
  { command: "raspisanie", description: "Расписание на неделю" },
  { command: "otchet", description: "Отчёт за прошедший день" },
];

export interface BotSettingsFixtureOptions {
  theme?: "dark" | "light";
  /** Lets Inter through, which a photograph needs and a contract must not. */
  webFont?: boolean;
}

export async function openBotSettings(page: Page, options: BotSettingsFixtureOptions = {}) {
  const { theme = "dark", webFont = false } = options;

  const bot = {
    id: OWNER_BOT_ID,
    username: "smenabot",
    display_name: "Смены",
    description: "Подтверждение смен и напоминания",
    avatar_url: null as string | null,
    state: "active",
    delete_after: null as string | null,
    role: "owner",
    token: { prefix: TOKEN_PREFIX, created_at: AT, last_used_at: null },
    created_at: AT,
    updated_at: AT,
  };

  // Nothing leaves this machine. The font host is the one exception, and only
  // when a capture asks for it.
  await page.route(
    (url) =>
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "127.0.0.1" &&
      url.hostname !== "localhost",
    (route) => route.abort("blockedbyclient"),
  );
  if (webFont) {
    await page.route(
      (url) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com",
      (route) => route.continue(),
    );
  }

  await page.addInitScript(
    ({ userId, now, value }) => {
      localStorage.setItem("kub-theme", value as string);
      localStorage.setItem(
        "kub-auth",
        JSON.stringify({
          access_token: "playwright.user.jwt",
          refresh_token: "playwright-refresh",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: "bearer",
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "bot-owner@example.invalid",
            user_metadata: { full_name: "Максим Орлов" },
            app_metadata: {},
            created_at: now,
          },
        }),
      );
    },
    { userId: USER_ID, now: AT, value: theme },
  );

  await page.route(`${SUPABASE_FIXTURE}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/rest/v1/profiles")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: USER_ID,
          full_name: "Максим Орлов",
          username: "maksim",
          avatar_url: null,
          bio: null,
          online_at: AT,
          created_at: AT,
          updated_at: AT,
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.route(`${MANAGEMENT_API}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/bot/manage/v1", "");
    // The management API answers `{ ok, result }`; the client unwraps `result`.
    const ok = (result: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, result }),
      });

    if (request.method() === "GET" && path === "/bots") {
      return ok({
        bots: [bot],
        eligibility: {
          email_verified: true,
          phone_verified: true,
          account_age_met: true,
          not_banned: true,
          under_limit: true,
          active_bot_count: 1,
          max_bots: 3,
          can_create: true,
        },
      });
    }
    if (request.method() === "GET" && /^\/bots\/[0-9a-f-]+$/.test(path)) {
      return ok({
        bot,
        commands: COMMANDS,
        developers: [
          {
            user_id: "44444444-4444-4444-8444-00000000d222",
            display_name: "Анна Смирнова",
            username: "anna",
            created_at: AT,
          },
        ],
        privacy: [
          {
            chat_id: "33333333-3333-4333-8333-00000000d222",
            chat_name: "Команда продукта",
            privacy_mode: "restricted",
            full_visibility_requested_at: null,
            full_visibility_approved: false,
          },
        ],
        webhook: { configured: true, url: "https://hooks.example.invalid/letscube" },
        diagnostics: {
          delivery_mode: null,
          pending_update_count: 0,
          failure_count: 0,
          last_error_code: null,
          refreshed_at: AT,
        },
      });
    }
    return ok({ success: true });
  });

  await page.goto(`/bots?bot=${OWNER_BOT_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("bots-detail-pane")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Диагностика" })).toBeVisible();
}

/** The panel's four tabs, by the label a reader sees. */
export type BotTab = "Основное" | "API" | "Команда" | "Диагностика";

export async function openBotTab(page: Page, tab: BotTab) {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute(
    "data-state",
    "active",
  );
}
