import { chromium, expect, test, type Locator, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

test.use({ serviceWorkers: "block", screenshot: "off", trace: "off", video: "off" });

const ME = person("11111111-1111-4111-8111-0000000000e1", "Fixture Reader");
const SENDER = person("11111111-1111-4111-8111-0000000000e2", "Fixture Sender");
const CHAT = "22222222-2222-4222-8222-0000000000e1";
const ALBUM = "fixture-album";
const AT = "2026-09-13T09:00:00.000Z";
const IDS = [1, 2, 3].map((index) => `55555555-5555-4555-8555-0000000000e${index}`);
const STORAGE = "http://127.0.0.1:54321/storage/v1/object";

async function recordClip(page: Page) {
  const clip = await page.evaluate(async () => {
    const mimeType = "video/mp4;codecs=avc1.42001f";
    if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error("No fixture AVC encoder");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d")!;
    const stream = canvas.captureStream(24);
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    const stopped = new Promise<void>((resolve) => {
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => resolve();
    });
    recorder.start();
    for (let frame = 0; frame < 8; frame++) {
      context.fillStyle = frame % 2 ? "#146467" : "#b66b26";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  expect(clip.length, "the fixture recorder produced no video").toBeGreaterThan(100);
  return { contentType: "video/mp4", body: Buffer.from(clip) };
}

async function touchLeft(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  const events = await page.evaluateHandle(() => {
    const received: string[] = [];
    for (const type of ["pointerdown", "pointerup", "pointercancel"]) {
      document.addEventListener(type, (event) => {
        received.push(`${type}:${(event.target as HTMLElement).tagName}`);
      }, { capture: true, once: true });
    }
    return received;
  });
  const cdp = await page.context().newCDPSession(page);
  const startX = Math.round(box.x + box.width * 0.75);
  const y = Math.round(box.y + box.height * 0.45);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y }] });
  for (let dx = 20; dx <= 140; dx += 20) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: startX - dx, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  const result = await events.jsonValue();
  await events.dispose();
  return result;
}

test("signed-only mixed album uses previews and steps through the video", async ({
  page, baseURL, browserName, isMobile,
}, info) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  await requireFixtureServer(page.request);
  const clip = await (async () => {
    if (browserName === "chromium") return recordClip(page);
    const producer = await chromium.launch();
    try {
      return await recordClip(await producer.newPage());
    } finally {
      await producer.close();
    }
  })();
  const videoPath = "u1/clip.mp4";
  const originals = ["u1/first.svg", videoPath, "u1/last.svg"];
  const previews = ["u1/first.preview.webp", "u1/video-poster.webp", "u1/last.preview.webp"];
  const originalLoads = new Set<string>();
  const previewLoads = new Set<string>();
  const publicLoads: string[] = [];
  const fixture = await openFixture(page, {
    me: ME,
    theme: process.env.KUB_TASK3_LIGHT === "1" ? "light" : "dark",
    chats: [chat(CHAT, "group", "Fixture Album", AT)],
    memberships: [
      membership(CHAT, ME, "member", "2026-09-13T09:00:10.000Z"),
      membership(CHAT, SENDER, "owner", AT),
    ],
    messages: IDS.map((id, index) =>
      message(id, CHAT, SENDER, `Fixture frame ${index + 1}`, new Date(Date.parse(AT) + index * 1000).toISOString(), {
        type: index === 1 ? "video" : "image",
        media_url: index === 1 && process.env.KUB_TASK3_PATH_ONLY_VIDEO !== "1"
          ? `${STORAGE}/public/album-media/${videoPath}`
          : null,
        media_bucket: "album-media",
        media_path: originals[index],
        media_metadata: {
          width: 320,
          height: 240,
          size_bytes: 2_000_000,
          ...(index === 1 ? {} : {
            uncompressed: true,
            preview: { path: previews[index], width: 320, height: 240 },
          }),
          album_id: ALBUM,
          album_index: index,
          album_count: 3,
        },
      }),
    ),
    rest: ({ resource }) => resource === "media_variants" ? {
      status: 200,
      body: [{
        id: IDS[1], message_id: IDS[1], variant_kind: "video_poster", variant_bucket: "album-media",
        variant_path: previews[1], width: 320, height: 240, status: "ready", error_code: null,
        updated_at: AT,
      }],
    } : undefined,
  });
  const mutateSwipe = process.env.KUB_TASK3_MUTATE_SWIPE === "1";
  let mutatedViewer = false;
  if (mutateSwipe) {
    expect(browserName === "chromium" && isMobile).toBe(true);
    await page.route(new URL("/src/components/chat/MediaViewer.tsx*", baseURL).href, async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      expect(source.split('"touch-pan-y"')).toHaveLength(2);
      mutatedViewer = true;
      await route.fulfill({ response, body: source.replace('"touch-pan-y"', '"touch-auto"') });
    });
  }
  await page.route(`${STORAGE}/public/album-media/**`, (route) => {
    publicLoads.push(new URL(route.request().url()).pathname);
    return route.abort();
  });
  await page.route(`${STORAGE}/sign/album-media`, (route) => {
    const { paths } = route.request().postDataJSON() as { paths: string[] };
    return route.fulfill({ json: paths.map((path) => ({ path, signedURL: `/object/sign/album-media/${path}?token=fixture` })) });
  });
  await page.route(`${STORAGE}/sign/album-media/**`, (route) => {
    const path = new URL(route.request().url()).pathname.split("/album-media/")[1];
    if (originals.includes(path)) originalLoads.add(path);
    if (previews.includes(path)) previewLoads.add(path);
    if (path === videoPath) return route.fulfill(clip);
    const index = previews.indexOf(path) >= 0 ? previews.indexOf(path) : originals.indexOf(path);
    if (index < 0) return route.abort();
    return route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="${["#175e90", "#146467", "#a75a24"][index]}"/></svg>`,
    });
  });
  await openChat(page, "Fixture Album", "Fixture frame 1");
  if (mutateSwipe) expect(mutatedViewer, "the browser did not load the mutated viewer").toBe(true);

  const album = page.locator(`[data-message-album="${ALBUM}"]`);
  await expect(album).toHaveCount(1);
  await expect(album).toHaveAttribute("aria-label", "Медиаальбом, вложений: 3");
  expect(await album.locator("[data-message-id]").evaluateAll((tiles) =>
    tiles.map((tile) => tile.getAttribute("data-message-id")),
  )).toEqual(IDS);
  await expect.poll(
    () => fixture.restCalls("media_variants", "GET").length,
    { message: "the path-backed video was not admitted to the variant lookup", timeout: 3000 },
  ).toBeGreaterThan(0);
  const images = album.locator("img");
  await expect(images).toHaveCount(3);
  await expect.poll(() => images.evaluateAll((nodes) =>
    nodes.every((node) => (node as HTMLImageElement).naturalWidth > 0),
  )).toBe(true);
  expect([...previewLoads].sort()).toEqual([...previews].sort());
  expect(await images.nth(1).evaluate((image: HTMLImageElement) => image.currentSrc)).toMatch(
    /^(blob:|.*\/object\/sign\/album-media\/u1\/video-poster\.webp)/,
  );
  await expect(album.locator("video")).toHaveCount(0);
  expect([...originalLoads]).toEqual([]);
  if (process.env.KUB_TASK3_CAPTURE === "1") {
    await album.screenshot({ path: info.outputPath("fictional-album.png") });
  }

  const dialog = page.getByRole("dialog");
  const position = page.getByTestId("media-viewer-position").locator("span").first();
  const next = page.getByRole("button", { name: "Следующее" });
  const previous = page.getByRole("button", { name: "Предыдущее" });
  await album.getByRole("button", { name: "Открыть фото: Fixture frame 1" }).click();
  await expect(dialog).toHaveAccessibleName("Fixture frame 1");
  await expect(position).toHaveText("1 из 3");
  await expect.poll(() => [...originalLoads]).toEqual([originals[0]]);

  const hasRealTouch = browserName === "chromium" && isMobile;
  if (hasRealTouch) {
    await touchLeft(page, dialog.getByTestId("media-viewer-stage"));
  } else {
    await next.click();
  }
  await expect(dialog).toHaveAccessibleName("Fixture frame 2");
  await expect(position).toHaveText("2 из 3");
  const video = dialog.locator("video");
  expect(await video.evaluate((element: HTMLVideoElement) => element.controls && element.paused && element.currentTime === 0)).toBe(true);
  // Windows WebKit did not decode this synthetic clip; it still checks the
  // signed fetch, paused video element and navigation buttons.
  if (browserName === "chromium") {
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(320);
  }
  expect([...originalLoads]).toEqual(originals.slice(0, 2));
  if (process.env.KUB_TASK3_CAPTURE === "1") {
    await dialog.screenshot({ path: info.outputPath("fictional-viewer.png") });
  }

  let videoTouchEvents: string[] = [];
  if (hasRealTouch) {
    videoTouchEvents = await touchLeft(page, video);
  } else {
    await next.click();
  }
  await expect(dialog, `video swipe events: ${videoTouchEvents.join(", ")}`).toHaveAccessibleName("Fixture frame 3");
  await expect(position).toHaveText("3 из 3");
  await expect.poll(() => [...originalLoads]).toEqual(originals);
  await expect(next).toHaveCount(0);
  await previous.click();
  await expect(dialog).toHaveAccessibleName("Fixture frame 2");
  await expect(position).toHaveText("2 из 3");
  expect(publicLoads).toEqual([]);
  expect(fixture.restCalls("messages", "POST")).toEqual([]);
});
