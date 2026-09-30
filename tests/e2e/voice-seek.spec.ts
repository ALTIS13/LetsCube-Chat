import { expect, test, type Locator, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";
import { recorderShapedWebm } from "./helpers/recorderWebm";

/**
 * D-329, from a tester on 2026-09-29: «не получается перемотать голосовое…
 * когда я выбираю середину, он после этого перескакивает либо на начало, либо
 * на конец».
 *
 * Every voice note in production is WebM written by a browser's recorder: no
 * Duration, a Segment and Clusters of unknown size, and — from an iPhone — a
 * Cues element at the end with nothing pointing at it. An engine reports such a
 * file's `duration` as Infinity until it has read to the end. The files here
 * have exactly that shape and carry silence, served with byte ranges from the
 * test's own server; the conversation is fictional and mocked on the fixture
 * host.
 */

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

const AT = "2026-09-29T15:00:00.000Z";
const ME = person("64444444-4444-4444-8444-000000000001", "Максим Орлов", "maksim");
const ANNA = person("64444444-4444-4444-8444-000000000002", "Анна Смирнова", "anna");
const CHAT = "65555555-5555-4555-8555-000000000001";
const SECONDS = 30;
const LABEL = `🎤 Голосовое сообщение (00:${SECONDS})`;

let server: Server;
let baseUrl = "";

test.beforeAll(async () => {
  const files: Record<string, Buffer> = {
    "/iphone.webm": recorderShapedWebm({ seconds: SECONDS, trailingCues: true }),
    "/chromium.webm": recorderShapedWebm({ seconds: SECONDS }),
  };
  server = createServer((request, response) => {
    const body = files[request.url ?? ""];
    if (!body) {
      response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
      response.end();
      return;
    }
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.range ?? "");
    const start = range && range[1] ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    const headers = {
      "Content-Type": "audio/webm",
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Content-Length": String(end - start + 1),
    };
    if (range) response.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${body.length}` });
    else response.writeHead(200, headers);
    response.end(body.subarray(start, end + 1));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

async function boot(page: Page, file: string) {
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(CHAT, "private", null, "2026-09-29T15:10:00.000Z")],
    memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT)],
    // As production stores them: the length only in the label, no metadata.
    messages: [
      message("66666666-6666-4666-8666-000000000001", CHAT, ANNA, LABEL, "2026-09-29T15:10:00.000Z", {
        type: "audio",
        media_url: `${baseUrl}${file}`,
      }),
    ],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-list-item").filter({ hasText: ANNA.full_name }).click();
  const voice = page.locator('[data-voice-message="true"]').first();
  await expect(voice).toBeVisible();
  return voice;
}

function track(voice: Locator) {
  return voice.locator('[data-voice-progress="track"]');
}

async function position(voice: Locator) {
  return Number(await track(voice).inputValue());
}

for (const file of ["/iphone.webm", "/chromium.webm"]) {
  test.describe(`a recorder-shaped voice note (${file.slice(1)})`, () => {
    test("a seek before playing holds, and playing starts from it", async ({ page }) => {
      const voice = await boot(page, file);
      await expect(track(voice), "the length is known from the message before the file says it").toBeEnabled({ timeout: 5_000 });
      await expect(track(voice)).toHaveAttribute("max", String(SECONDS));

      await track(voice).fill("15");
      await page.waitForTimeout(1_500);
      expect(await position(voice), "the thumb stays where it was put").toBeCloseTo(15, 0);

      await voice.getByRole("button", { name: "Воспроизвести" }).click();
      await expect(voice.getByRole("button", { name: "Пауза" })).toBeVisible();
      await page.waitForTimeout(1_200);
      const playing = await position(voice);
      expect(playing, "playing goes on from the chosen second").toBeGreaterThan(15.3);
      expect(playing, "and not from the end").toBeLessThan(20);
    });

    test("a seek while playing lands in the middle and stays there", async ({ page }) => {
      const voice = await boot(page, file);
      await voice.getByRole("button", { name: "Воспроизвести" }).click();
      await expect(voice.getByRole("button", { name: "Пауза" })).toBeVisible();
      await expect.poll(() => position(voice), { timeout: 6_000 }).toBeGreaterThan(0.5);

      await track(voice).fill("20");
      await page.waitForTimeout(1_200);
      const after = await position(voice);
      expect(after, "not back to the start").toBeGreaterThan(20.3);
      expect(after, "not to the end").toBeLessThan(25);
      await expect(voice.getByRole("button", { name: "Пауза" }), "and it is still playing").toBeVisible();

      await track(voice).fill("8");
      await page.waitForTimeout(1_200);
      const back = await position(voice);
      expect(back, "a seek backwards lands too").toBeGreaterThan(8.3);
      expect(back).toBeLessThan(13);
    });

    test("a drag follows the pointer and seeks once, where it is let go", async ({ page }) => {
      const voice = await boot(page, file);
      await voice.getByRole("button", { name: "Воспроизвести" }).click();
      await expect(voice.getByRole("button", { name: "Пауза" })).toBeVisible();
      await expect.poll(() => position(voice), { timeout: 6_000 }).toBeGreaterThan(0.5);

      const box = await track(voice).boundingBox();
      if (!box) throw new Error("the slider has no box");
      const y = box.y + box.height / 2;
      const at = (seconds: number) => box.x + 6 + ((box.width - 12) * seconds) / SECONDS;
      await page.mouse.move(at(await position(voice)), y);
      await page.mouse.down();
      await page.mouse.move(at(12), y, { steps: 6 });
      await page.mouse.move(at(20), y, { steps: 6 });
      await expect(track(voice), "held, the slider says so").toHaveAttribute("data-scrubbing", "true");
      const heldAt = await position(voice);
      expect(heldAt, "the thumb follows the pointer while it is held").toBeGreaterThan(18);
      await page.mouse.up();

      await expect(track(voice)).not.toHaveAttribute("data-scrubbing", "true");
      await page.waitForTimeout(1_200);
      const after = await position(voice);
      expect(after, "the seek is where it was let go, not back at the start").toBeGreaterThan(heldAt);
      expect(after, "and not at the end").toBeLessThan(heldAt + 4);
      await expect(voice.getByRole("button", { name: "Пауза" }), "still playing").toBeVisible();
    });
  });
}
