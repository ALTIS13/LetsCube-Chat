import { expect, test, type Route } from "@playwright/test";
import {
  FIXTURE_HOST,
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

const ME = person("11111111-1111-4111-8111-0000000000a1", "Fixture User");
const CHAT = "22222222-2222-4222-8222-0000000000b1";
const CHAT_NAME = "Fixture conversation";
const FIRST_LINE = "Fixture opening message";
const PHOTO_COUNT = 10;
const FILE_COUNT = 25;

const photos = Array.from({ length: PHOTO_COUNT }, (_, index) =>
  message(
    `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
    CHAT,
    ME,
    `Fixture photo ${index + 1}`,
    new Date(Date.UTC(2026, 8, 27, 12, -index)).toISOString(),
    { type: "image", media_url: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E" },
  ),
);
const files = Array.from({ length: FILE_COUNT }, (_, index) =>
  message(
    `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    CHAT,
    ME,
    `Fixture file ${String(index + 1).padStart(2, "0")}`,
    new Date(Date.UTC(2026, 8, 27, 11, -index)).toISOString(),
    { type: "file", media_url: "data:application/octet-stream,fixture" },
  ),
);

test.use({ screenshot: "off", trace: "off", video: "off" });

test("late mixed media cannot replace the Files page or its cursor", async ({ page, request }) => {
  await requireFixtureServer(request);
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT, "group", CHAT_NAME, "2026-09-27T12:00:00.000Z")],
    memberships: [membership(CHAT, ME, "owner", "2026-09-27T11:00:00.000Z")],
    messages: [message("55555555-5555-4555-8555-000000000001", CHAT, ME, FIRST_LINE, "2026-09-27T12:00:00.000Z"), ...photos, ...files],
    rpc: (name) => name === "chat_media_counts"
      ? { body: [{ kind: "photo", total: PHOTO_COUNT }, { kind: "file", total: FILE_COUNT }] }
      : undefined,
  });

  let releaseMixed!: () => void;
  const mixedGate = new Promise<void>((resolve) => { releaseMixed = resolve; });
  let signalMixed!: () => void;
  const mixedRequested = new Promise<void>((resolve) => { signalMixed = resolve; });
  const fileOffsets: number[] = [];
  await page.route(`${FIXTURE_HOST}/rest/v1/messages*`, async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("media_url") !== "not.is.null") return route.fallback();
    const types = url.searchParams.get("type");
    if (types === "in.(image,video,file,audio)") {
      signalMixed();
      await mixedGate;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([...photos.slice(0, 2), ...files.slice(0, 8)]) });
    }
    if (types === "in.(file)") {
      fileOffsets.push(Number(url.searchParams.get("offset") ?? 0));
    }
    return route.fallback();
  });

  await openChat(page, CHAT_NAME, FIRST_LINE);
  await page.getByTestId("chat-header-info-button").click();
  await mixedRequested;
  const fileRow = page.getByTestId("chat-info-media-row").and(page.locator('[data-media-kind="file"]'));
  await expect(fileRow).toBeVisible();
  await fileRow.click();

  const gallery = page.getByTestId("chat-info-gallery-view");
  const fileLink = (name: string) => gallery.getByRole("link", { name, exact: true });
  await expect(gallery.locator('[data-media-kind="file"]')).toBeVisible();
  await expect(fileLink("Fixture file 01")).toBeVisible();
  await expect(fileLink("Fixture file 24")).toBeVisible();
  expect(fileOffsets[0]).toBe(0);

  const oldHiddenResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/rest/v1/message_hidden_for_users" &&
      url.searchParams.get("message_id")?.includes(String(photos[0].id)) === true;
  });
  releaseMixed();
  await oldHiddenResponse;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  await gallery.locator("#chat-info-media-panel").evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(fileLink("Fixture file 25")).toBeVisible();
  const labels = (await gallery.locator("#chat-info-media-panel a").allTextContents()).map((value) => value.trim());
  expect({
    offsets: fileOffsets,
    count: labels.length,
    first: labels[0],
    twentyFourth: labels[23],
    last: labels.at(-1),
  }).toEqual({
    offsets: [0, 24],
    count: 25,
    first: "Fixture file 01",
    twentyFourth: "Fixture file 24",
    last: "Fixture file 25",
  });
});

test("late links from chat A cannot replace chat B's links", async ({ page, request }) => {
  await requireFixtureServer(request);
  const chatA = CHAT;
  const chatB = "22222222-2222-4222-8222-0000000000b2";
  const chatAName = "Fixture chat A";
  const chatBName = "Fixture chat B";
  const linkA = "https://a.example.invalid/only-a";
  const linkB = "https://b.example.invalid/only-b";
  await openFixture(page, {
    me: ME,
    chats: [chat(chatA, "group", chatAName, "2026-09-27T12:00:00.000Z"), chat(chatB, "group", chatBName, "2026-09-27T12:00:00.000Z")],
    memberships: [membership(chatA, ME, "owner", null), membership(chatB, ME, "owner", null)],
    messages: [
      message("55555555-5555-4555-8555-0000000000a1", chatA, ME, "Fixture opening A", "2026-09-27T12:00:00.000Z"),
      message("55555555-5555-4555-8555-0000000000a2", chatA, ME, linkA, "2026-09-27T11:00:00.000Z"),
      message("55555555-5555-4555-8555-0000000000b1", chatB, ME, linkB, "2026-09-27T11:00:00.000Z"),
    ],
    rpc: (name) => name === "chat_media_counts" ? { body: [{ kind: "link", total: 1 }] } : undefined,
  });
  let storeModule: string | null = null;
  page.on("request", (incoming) => {
    if (new URL(incoming.url()).pathname === "/src/store/app.store.ts") storeModule = incoming.url();
  });
  let releaseA!: () => void;
  const aGate = new Promise<void>((resolve) => { releaseA = resolve; });
  let signalA!: () => void;
  const aRequested = new Promise<void>((resolve) => { signalA = resolve; });
  await page.route(`${FIXTURE_HOST}/rest/v1/messages*`, async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("chat_id") === `eq.${chatA}` && url.searchParams.get("content")?.includes("http")) {
      signalA();
      await aGate;
    }
    return route.fallback();
  });

  await openChat(page, chatAName, "Fixture opening A");
  await page.getByTestId("chat-header-info-button").click();
  await aRequested;
  expect(storeModule).toBeTruthy();
  await page.evaluate(async ({ path, nextChatId }) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    useAppStore.getState().setSelectedChatId(nextChatId);
  }, { path: storeModule!, nextChatId: chatB });
  await expect(page.getByTestId("chat-header-info-button")).toContainText(chatBName);
  const linkRow = page.getByTestId("chat-info-media-row").and(page.locator('[data-media-kind="link"]'));
  await expect(linkRow).toBeVisible();
  await linkRow.click();
  const gallery = page.getByTestId("chat-info-gallery-view");
  await expect(gallery.getByRole("link", { name: linkB, exact: true })).toBeVisible();

  const oldLinksResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/rest/v1/messages" && url.searchParams.get("chat_id") === `eq.${chatA}` && url.searchParams.get("content")?.includes("http") === true;
  });
  releaseA();
  await oldLinksResponse;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(gallery.getByRole("link", { name: linkB, exact: true })).toBeVisible();
  await expect(gallery.getByRole("link", { name: linkA, exact: true })).toHaveCount(0);
});
