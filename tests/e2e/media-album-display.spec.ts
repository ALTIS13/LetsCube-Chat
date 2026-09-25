import { tmpdir } from "node:os";
import { join } from "node:path";
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

const ME = person("11111111-1111-4111-8111-0000000000d1", "Мария Орлова");
const ANNA = person("11111111-1111-4111-8111-0000000000d2", "Анна Смирнова");
const CHAT = "22222222-2222-4222-8222-0000000000d1";
const ALBUM = "a-message";
const IDS = [
  "55555555-5555-4555-8555-0000000000d1",
  "55555555-5555-4555-8555-0000000000d2",
  "55555555-5555-4555-8555-0000000000d3",
];

const card = (index: number) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">' +
  `<rect width="800" height="600" fill="hsl(${index * 65 + 130} 58% 38%)"/>` +
  `<circle cx="400" cy="300" r="170" fill="none" stroke="white" stroke-width="14"/>` +
  `<text x="400" y="345" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold" font-size="130">${index}</text>` +
  "</svg>";

async function openAlbum(
  page: Page,
  withPreviews: boolean,
  order: readonly number[] = [0, 1, 2],
  options: {
    videoIndex?: number;
    signedOnly?: boolean;
    sizeBytes?: number;
    replyIndex?: number;
    brokenPreviewIndex?: number;
  } = {},
) {
  await requireFixtureServer(page.request);
  const at = "2026-09-13T09:00:00.000Z";
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT, "group", "Альбом", at)],
    memberships: [
      membership(CHAT, ME, "owner", "2026-09-13T09:00:10.000Z"),
      membership(CHAT, ANNA, "member", at),
    ],
    messages: order.map((index, chronologicalPosition) =>
      message(
        IDS[index],
        CHAT,
        ANNA,
        `Кадр ${index + 1}`,
        new Date(Date.parse(at) + chronologicalPosition * 1000).toISOString(),
        {
          type: index === options.videoIndex ? "video" : "image",
          reply_to_id: index === options.replyIndex ? IDS[0] : null,
          media_url: `/__fixture-media/album-${index + 1}${index === options.videoIndex ? ".webm" : ".svg"}`,
          media_bucket: withPreviews || options.signedOnly ? "album-media" : null,
          media_path:
            withPreviews || options.signedOnly
              ? `u1/album-${index + 1}${index === options.videoIndex ? ".webm" : ".jpg"}`
              : null,
          media_metadata: {
            width: 1200,
            height: 900,
            size_bytes: options.sizeBytes ?? 2_000_000,
            ...(withPreviews && index !== options.videoIndex
              ? {
                  uncompressed: true,
                  preview: {
                    path: `u1/album-${index + 1}.preview.webp`,
                    width: 800,
                    height: 600,
                  },
                }
              : {}),
            album_id: ALBUM,
            album_index: index,
            album_count: 3,
          },
        },
      ),
    ),
  });
  if (options.signedOnly) {
    await page.route("http://127.0.0.1:54321/storage/v1/object/sign/album-media", (route) => {
      const body = route.request().postDataJSON() as { paths: string[] };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          body.paths.map((path) => ({
            path,
            signedURL: `/object/sign/album-media/${path}?token=album-fixture`,
          })),
        ),
      });
    });
  }
  if (options.videoIndex !== undefined) {
    await page.route("http://127.0.0.1:54321/rest/v1/media_variants**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "66666666-6666-4666-8666-0000000000d3",
            message_id: IDS[options.videoIndex!],
            variant_kind: "video_poster",
            variant_bucket: "album-media",
            variant_path: `u1/album-${options.videoIndex! + 1}.poster.webp`,
            width: 800,
            height: 600,
            status: "ready",
            error_code: null,
            updated_at: at,
          },
        ]),
      }),
    );
  }
  const originalLoads: string[] = [];
  for (let index = 1; index <= 3; index += 1) {
    await page.route(
      `**/__fixture-media/album-${index}.${index - 1 === options.videoIndex ? "webm" : "svg"}`,
      (route) => {
        originalLoads.push(route.request().url());
        return route.fulfill(
          index - 1 === options.videoIndex
            ? { status: 404, body: "" }
            : { status: 200, contentType: "image/svg+xml", body: card(index) },
        );
      },
    );
    if (options.signedOnly) {
      await page.route(
        `http://127.0.0.1:54321/storage/v1/object/sign/album-media/u1/album-${index}.jpg**`,
        (route) => {
          originalLoads.push(route.request().url());
          return route.fulfill({ status: 200, contentType: "image/svg+xml", body: card(index) });
        },
      );
    }
    if (withPreviews) {
      const previewPath = `u1/album-${index}.${index - 1 === options.videoIndex ? "poster" : "preview"}.webp`;
      await page.route(
        `http://127.0.0.1:54321/storage/v1/object/${options.signedOnly ? "sign" : "public"}/album-media/${previewPath}**`,
        (route) =>
          route.fulfill(
            options.brokenPreviewIndex === index - 1
              ? { status: 404, body: "" }
              : { status: 200, contentType: "image/svg+xml", body: card(index) },
          ),
      );
    }
  }
  await openChat(page, "Альбом", "Кадр 1");
  return originalLoads;
}

test("consecutive album photos share a compact mosaic and keep their message IDs", async ({
  page,
}) => {
  const originalLoads = await openAlbum(page, false);
  const album = page.locator(`[data-message-album="${ALBUM}"]`);
  await expect(album).toHaveCount(1);
  await expect(album).toHaveAttribute("aria-label", "Медиаальбом, вложений: 3");
  await expect(album.locator("[data-message-id]")).toHaveCount(3);
  for (const id of IDS) await expect(album.locator(`[data-message-id="${id}"]`)).toBeVisible();
  await expect(album.locator("img")).toHaveCount(0);
  expect(originalLoads, "the missing preview caused an original download before a tap").toEqual([]);

  await album
    .locator(`[data-message-id="${IDS[1]}"]`)
    .getByRole("button", { name: "Открыть фото: Кадр 2" })
    .click();
  await expect(page.getByRole("dialog", { name: "Кадр 2" })).toBeVisible();
  await expect(page.getByTestId("media-viewer-position").locator("span").first()).toHaveText(
    "2 из 3",
  );
  expect(originalLoads.some((url) => url.includes("album-2.svg"))).toBe(true);
});

test("small album photos without previews load their originals inline", async ({ page }) => {
  const originalLoads = await openAlbum(page, false, [0, 1, 2], { sizeBytes: 500_000 });
  const album = page.locator(`[data-message-album="${ALBUM}"]`);
  await expect(album.locator("img")).toHaveCount(3);
  await expect
    .poll(() =>
      album
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  expect(originalLoads).toHaveLength(3);
});

test("a failed album preview falls back to a small original", async ({ page }) => {
  const originalLoads = await openAlbum(page, true, [0, 1, 2], {
    sizeBytes: 500_000,
    brokenPreviewIndex: 0,
  });
  const tile = page.locator(`[data-message-id="${IDS[0]}"]`);
  await expect(tile.locator("img")).toHaveAttribute("src", "/__fixture-media/album-1.svg");
  await expect
    .poll(() => tile.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(originalLoads.some((url) => url.includes("album-1.svg"))).toBe(true);
});

test("a failed album preview does not automatically load a large original", async ({ page }) => {
  const originalLoads = await openAlbum(page, true, [0, 1, 2], {
    brokenPreviewIndex: 0,
  });
  const tile = page.locator(`[data-message-id="${IDS[0]}"]`);
  await expect(tile.getByText("Превью недоступно")).toBeVisible();
  expect(originalLoads.some((url) => url.includes("album-1.svg"))).toBe(false);
  await tile.getByRole("button", { name: "Открыть фото: Кадр 1" }).click();
  await expect(page.getByRole("dialog", { name: "Кадр 1" })).toBeVisible();
  expect(originalLoads.some((url) => url.includes("album-1.svg"))).toBe(true);
});

test("a failed signed album preview falls back only to a signed small original", async ({
  page,
}) => {
  test.skip(process.env.KUB_ALBUM_SIGNED_ONLY !== "1", "run with a signed-only fixture dev server");
  const originalLoads = await openAlbum(page, true, [0, 1, 2], {
    signedOnly: true,
    sizeBytes: 500_000,
    brokenPreviewIndex: 0,
  });
  const tile = page.locator(`[data-message-id="${IDS[0]}"]`);
  await expect(tile.locator("img")).toHaveAttribute(
    "src",
    /\/object\/sign\/album-media\/u1\/album-1\.jpg/,
  );
  await expect
    .poll(() => tile.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(originalLoads.some((url) => url.includes("/object/sign/album-media/u1/album-1.jpg"))).toBe(
    true,
  );
  const allImagesSigned = await page
    .locator(`[data-message-album="${ALBUM}"] img`)
    .evaluateAll((images) =>
      images.every((image) => !(image as HTMLImageElement).src.includes("/object/public/")),
    );
  expect(allImagesSigned).toBe(true);
});

test("retried item at the end takes its album position but opens its own message", async ({
  page,
}) => {
  await openAlbum(page, false, [1, 2, 0]);
  const album = page.locator(`[data-message-album="${ALBUM}"]`);
  expect(
    await album
      .locator("[data-message-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-message-id"))),
  ).toEqual(IDS);
  await album
    .locator(`[data-message-id="${IDS[0]}"]`)
    .getByRole("button", { name: "Открыть фото: Кадр 1" })
    .click();
  await expect(page.getByRole("dialog", { name: "Кадр 1" })).toBeVisible();
  await expect(page.getByTestId("media-viewer-position").locator("span").first()).toHaveText(
    "3 из 3",
  );
});

test("a reply on an album tile jumps to the original message ID", async ({ page }) => {
  await openAlbum(page, true, [0, 1, 2], { replyIndex: 2 });
  const album = page.locator(`[data-message-album="${ALBUM}"]`);
  await album
    .locator(`[data-message-id="${IDS[2]}"]`)
    .getByRole("button", { name: "Перейти к исходному сообщению" })
    .click();
  await expect
    .poll(() =>
      album
        .locator(`[data-message-id="${IDS[0]}"]`)
        .evaluate((node) => node.classList.contains("transition-colors")),
    )
    .toBe(true);
});

test("optimistic album keeps its height and bottom anchor through ACK, but exposes a failed item", async ({
  page,
}) => {
  await requireFixtureServer(page.request);
  const at = Date.parse("2026-09-13T09:00:00.000Z");
  const history = Array.from({ length: 25 }, (_, index) =>
    message(
      `55555555-5555-4555-8555-${String(index + 100).padStart(12, "0")}`,
      CHAT,
      ANNA,
      `Маркер ${index}`,
      new Date(at + index * 1000).toISOString(),
    ),
  );
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT, "group", "Альбом", new Date(at + 30_000).toISOString())],
    memberships: [
      membership(CHAT, ME, "owner", new Date(at + 30_000).toISOString()),
      membership(CHAT, ANNA, "member", new Date(at + 30_000).toISOString()),
    ],
    messages: history,
  });
  await openChat(page, "Альбом", "Маркер 24");

  const pending = IDS.map((id, index) =>
    message(
      `tmp:${id}`,
      CHAT,
      ME,
      `Кадр ${index + 1}`,
      new Date(at + (30 + index) * 1000).toISOString(),
      {
        type: "image",
        media_url: `http://127.0.0.1:54321/storage/v1/object/public/media/u1/album-${index + 1}.jpg`,
        media_bucket: "media",
        media_path: `u1/album-${index + 1}.jpg`,
        media_metadata: {
          album_id: ALBUM,
          album_index: index,
          album_count: 3,
          size_bytes: 2_000_000,
        },
        client_message_id: id,
        client_sent_at: new Date(at + (30 + index) * 1000).toISOString(),
        pending: true,
        checking: false,
        failed: false,
      },
    ),
  );
  await page.evaluate(
    async ({ chatId, rows }) => {
      const modulePath = "/src/store/app.store.ts";
      const { useAppStore } = await import(modulePath);
      for (const row of rows) useAppStore.getState().addMessage(chatId, row);
    },
    { chatId: CHAT, rows: pending },
  );

  const album = page.locator(`[data-message-album="${ALBUM}"]`);
  await expect(album.locator("[data-message-album-item]")).toHaveCount(3);
  await expect(album.locator('[data-message-delivery-slot][title="Отправляется"]')).toHaveCount(3);
  await album.evaluate((element) => element.setAttribute("data-stable-instance", "true"));
  const scroll = page.getByTestId("message-scroll-container");
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const measure = async () =>
    page.evaluate(() => {
      const list = document.querySelector(
        '[data-testid="message-scroll-container"]',
      ) as HTMLElement;
      const group = document.querySelector('[data-message-album="a-message"]') as HTMLElement;
      return {
        height: group.getBoundingClientRect().height,
        top: list.scrollTop,
        fromBottom: list.scrollHeight - list.clientHeight - list.scrollTop,
      };
    });
  const before = await measure();
  expect(before.fromBottom).toBeLessThan(2);

  for (let index = 0; index < pending.length; index += 1) {
    if (index === 1) {
      await page.evaluate(
        async ({ chatId, row }) => {
          const modulePath = "/src/store/app.store.ts";
          const { useAppStore } = await import(modulePath);
          useAppStore
            .getState()
            .replaceMessage(chatId, row.id, { ...row, pending: false, checking: true });
        },
        { chatId: CHAT, row: pending[index] },
      );
      await expect(
        album.locator(`[data-message-id="${pending[index].id}"] [data-message-delivery-slot]`),
      ).toHaveAttribute("title", "Проверяем отправку");
      expect(Math.abs((await measure()).height - before.height)).toBeLessThan(1);
      await page.evaluate(
        async ({ chatId, row }) => {
          const modulePath = "/src/store/app.store.ts";
          const { useAppStore } = await import(modulePath);
          useAppStore.getState().replaceMessage(chatId, row.id, {
            ...row,
            pending: false,
            checking: false,
            failed: true,
            send_error: "Не удалось отправить",
          });
        },
        { chatId: CHAT, row: pending[index] },
      );
      const failed = page.locator(`[data-message-id="${pending[index].id}"]`);
      await expect(failed.locator('[data-message-send-error="true"]')).toBeVisible();
      await expect(failed.getByRole("button", { name: "Повторить" })).toBeVisible();
      await expect(album).toHaveCount(0);
      await page.evaluate(
        async ({ chatId, row }) => {
          const modulePath = "/src/store/app.store.ts";
          const { useAppStore } = await import(modulePath);
          useAppStore.getState().replaceMessage(chatId, row.id, row);
        },
        { chatId: CHAT, row: pending[index] },
      );
      await expect(album.locator("[data-message-album-item]")).toHaveCount(3);
      await album.evaluate((element) => element.setAttribute("data-stable-instance", "true"));
      await scroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    }
    await page.evaluate(
      async ({ chatId, row, confirmedId }) => {
        const modulePath = "/src/store/app.store.ts";
        const { useAppStore } = await import(modulePath);
        useAppStore.getState().replaceMessage(chatId, row.id, {
          ...row,
          id: confirmedId,
          pending: false,
          checking: false,
        });
      },
      { chatId: CHAT, row: pending[index], confirmedId: IDS[index] },
    );
    await expect(album.locator(`[data-message-id="${IDS[index]}"]`)).toBeVisible();
    await expect(album).toHaveAttribute("data-stable-instance", "true");
    const after = await measure();
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
    expect(Math.abs(after.top - before.top)).toBeLessThan(2);
    expect(after.fromBottom).toBeLessThan(2);
  }
});

test("a video in the album uses its poster and opens the existing viewer", async ({ page }) => {
  await openAlbum(page, true, [0, 1, 2], { videoIndex: 2 });
  const album = page.locator(`[data-message-album="${ALBUM}"]`);
  const video = album.locator(`[data-message-id="${IDS[2]}"]`);
  await expect(video.locator("img")).toHaveCount(1);
  await expect
    .poll(() => video.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(album.locator("video")).toHaveCount(0);
  await video.getByRole("button", { name: "Открыть видео: Кадр 3" }).click();
  await expect(page.getByRole("dialog", { name: "Кадр 3" })).toBeVisible();
  await expect(page.getByTestId("media-viewer-position").locator("span").first()).toHaveText(
    "3 из 3",
  );
});

test("signed-only album waits for signed preview and never puts a public or original URL in an image", async ({
  page,
}) => {
  test.skip(process.env.KUB_ALBUM_SIGNED_ONLY !== "1", "run with a signed-only fixture dev server");
  await openAlbum(page, true, [0, 1, 2], { signedOnly: true });
  const album = page.locator(`[data-message-album="${ALBUM}"]`);
  await expect(album.locator("img")).toHaveCount(3);
  await expect
    .poll(() =>
      album
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  for (const src of await album
    .locator("img")
    .evaluateAll((images) => images.map((image) => image.getAttribute("src") ?? ""))) {
    expect(src).toContain("/object/sign/album-media/");
    expect(src).not.toContain(".jpg");
  }
});

test("signed-only small album without previews uses signed originals", async ({ page }) => {
  test.skip(process.env.KUB_ALBUM_SIGNED_ONLY !== "1", "run with a signed-only fixture dev server");
  const originalLoads = await openAlbum(page, false, [0, 1, 2], {
    signedOnly: true,
    sizeBytes: 500_000,
  });
  const images = page.locator(`[data-message-album="${ALBUM}"] img`);
  await expect(images).toHaveCount(3);
  await expect
    .poll(() =>
      images.evaluateAll((nodes) =>
        nodes.every((node) => (node as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  for (const src of await images.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("src") ?? ""),
  )) {
    expect(src).toContain("/object/sign/album-media/");
    expect(src).not.toContain("/object/public/");
  }
  expect(originalLoads).toHaveLength(3);
});

test("preview mosaic keeps tile actions and fits both themes", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    // The shared fixture intentionally returns 404 for this optional RPC to exercise its fallback.
    if (
      response.status() >= 400 &&
      response.url().startsWith("http://127.0.0.1:54321/") &&
      path !== "/rest/v1/rpc/chat_list_summaries"
    ) {
      errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  await openAlbum(page, true);
  await expect(page).toHaveURL(new RegExp(`/chat/${CHAT}$`));
  expect(await page.title()).toBe("LETSCUBE");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  const album = page.locator(`[data-message-album="${ALBUM}"]`);
  await expect(album.locator("img")).toHaveCount(3);
  await expect
    .poll(() =>
      album
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);

  for (const theme of ["light", "dark"] as const) {
    if (info.project.name === "chromium-desktop-1440") {
      await page.getByTestId("side-menu-button").click();
      await page.getByTestId("side-menu-night-mode").click();
      await page.keyboard.press("Escape");
    } else {
      await page.evaluate((value) => {
        localStorage.setItem("kub-theme", value);
        window.dispatchEvent(new StorageEvent("storage", { key: "kub-theme", newValue: value }));
      }, theme);
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => localStorage.getItem("kub-theme"))).toBe(theme);
    await page.waitForTimeout(400);
    if (theme === "light" && info.project.name === "chromium-desktop-1440") {
      const iconColors = await page.evaluate(() => {
        const attach = document.querySelector('button[aria-label="Прикрепить"] svg') as SVGElement;
        const more = document.querySelector('button[aria-label="Ещё"] svg') as SVGElement;
        return { attach: getComputedStyle(attach).color, more: getComputedStyle(more).color };
      });
      expect(iconColors).toEqual({ attach: "rgb(7, 17, 31)", more: "rgb(7, 17, 31)" });
    }
    const geometry = await album.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
        viewport: innerWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.height).toBeGreaterThan(130);
    await page.screenshot({
      path: join(tmpdir(), `letscube-album-${info.project.name}-${theme}.png`),
    });
  }

  await album.getByRole("button", { name: "Профиль: Анна Смирнова" }).click();
  await expect(page.getByTestId("user-profile-overlay")).toBeVisible();
  await page.keyboard.press("Escape");

  if (info.project.name !== "chromium-desktop-1440") {
    expect(errors).toEqual([]);
    return;
  }
  const second = album.locator(`[data-message-id="${IDS[1]}"]`);
  await second.locator('[data-message-bubble="true"]').click({ button: "right" });
  const menu = page.locator('[data-message-menu="desktop"]');
  await expect(menu).toBeVisible();
  await menu.locator('[data-message-action="select"]').click();
  await expect(second.locator('[data-message-row="true"]').first()).toHaveAttribute(
    "data-message-selected",
    "true",
  );
  await album.locator(`[data-message-id="${IDS[2]}"]`).click();
  await expect(
    album.locator(`[data-message-id="${IDS[2]}"] [data-message-row="true"]`).first(),
  ).toHaveAttribute("data-message-selected", "true");
  expect(errors).toEqual([]);
});
