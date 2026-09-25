import { expect, type Page, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

test.use({ screenshot: "off", trace: "off", video: "off" });

const ME = person("11111111-1111-4111-8111-0000000000a1", "Тестовый участник");
const OTHER = person("11111111-1111-4111-8111-0000000000a2", "Другой участник");
const CHAT_ID = "22222222-2222-4222-8222-0000000000b1";
const PHOTO_ID = "33333333-3333-4333-8333-000000000001";
const LINK_ID = "33333333-3333-4333-8333-000000000002";
const INTRO = "Проверка общей галереи";

async function openInfoWithFailingHiddenLookup(page: Page, counted = true) {
  let failHiddenLookup = false;
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "group", "Тестовый чат", "2026-09-25T09:00:00.000Z")],
    memberships: [
      membership(CHAT_ID, ME, "owner", "2026-09-25T09:00:00.000Z"),
      membership(CHAT_ID, OTHER, "member", "2026-09-25T09:00:00.000Z"),
    ],
    messages: [
      message(
        "33333333-3333-4333-8333-000000000000",
        CHAT_ID,
        OTHER,
        INTRO,
        "2026-09-25T08:00:00.000Z",
      ),
      message(PHOTO_ID, CHAT_ID, OTHER, "Снимок", "2026-09-25T08:01:00.000Z", {
        type: "image",
        media_bucket: "chat-media",
        media_path: `${CHAT_ID}/${PHOTO_ID}.png`,
        media_url: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
      }),
      message(LINK_ID, CHAT_ID, OTHER, "https://example.invalid/help", "2026-09-25T08:02:00.000Z"),
    ],
    rpc: (name) =>
      name === "chat_media_counts"
        ? counted
          ? {
              body: [
                { kind: "photo", total: 1 },
                { kind: "link", total: 1 },
              ],
            }
          : { status: 404, body: { code: "PGRST202", message: "function unavailable" } }
        : undefined,
    rest: ({ resource, method }) =>
      resource === "message_hidden_for_users" && method === "GET"
        ? failHiddenLookup
          ? { status: 503, body: { code: "53300", message: "lookup unavailable" } }
          : { status: 200, body: [] }
        : undefined,
  });

  await openChat(page, "Тестовый чат", INTRO);
  failHiddenLookup = true;
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  return {
    restoreLookup: () => {
      failHiddenLookup = false;
    },
  };
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("a failed hidden-ID lookup does not expose media and can be retried", async ({ page }) => {
  const { restoreLookup } = await openInfoWithFailingHiddenLookup(page);
  await page.getByTestId("chat-info-media-row").filter({ hasText: "фотограф" }).click();

  const tile = page.getByTestId("chat-info-media-tile");
  const empty = page.getByTestId("chat-info-media-empty");
  await expect.poll(async () => (await tile.count()) + (await empty.count())).toBeGreaterThan(0);
  await expect(tile).toHaveCount(0);
  await expect(empty).toHaveAttribute("data-failed", "true");
  restoreLookup();
  await page.getByTestId("chat-info-media-retry").click();
  await expect(page.getByTestId("chat-info-media-tile")).toHaveCount(1);
  await expect(page.getByTestId("chat-info-media-retry")).toHaveCount(0);
});

test("a failed hidden-ID lookup does not expose links and can be retried", async ({ page }) => {
  const { restoreLookup } = await openInfoWithFailingHiddenLookup(page);
  await page.getByTestId("chat-info-media-row").filter({ hasText: "ссыл" }).click();

  const link = page
    .getByTestId("chat-info-gallery-view")
    .getByRole("link", { name: /example\.invalid/ });
  const empty = page.getByTestId("chat-info-media-empty");
  await expect.poll(async () => (await link.count()) + (await empty.count())).toBeGreaterThan(0);
  await expect(link).toHaveCount(0);
  await expect(empty).toHaveAttribute("data-failed", "true");
  restoreLookup();
  await page.getByTestId("chat-info-media-retry").click();
  await expect(
    page.getByTestId("chat-info-gallery-view").getByRole("link", { name: /example\.invalid/ }),
  ).toBeVisible();
  await expect(page.getByTestId("chat-info-media-retry")).toHaveCount(0);
});

test("a hidden-ID failure remains retryable when media counts are unavailable", async ({
  page,
}) => {
  const { restoreLookup } = await openInfoWithFailingHiddenLookup(page, false);
  const retry = page.getByTestId("chat-info-media-lookup-retry");
  await expect(retry).toBeVisible();
  await expect(page.getByTestId("chat-info-media-row")).toHaveCount(0);

  restoreLookup();
  await retry.click();
  await expect(
    page.getByTestId("chat-info-media-row").filter({ hasText: "фотограф" }),
  ).toBeVisible();
  await expect(page.getByTestId("chat-info-media-row").filter({ hasText: "ссыл" })).toBeVisible();
  await expect(retry).toHaveCount(0);
});
