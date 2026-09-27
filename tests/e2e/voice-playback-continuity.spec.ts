import { expect, test, type Page } from "@playwright/test";
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

/**
 * D-313, from a tester on 2026-09-27: in Telegram a voice message keeps
 * playing when you go to another chat, so a long one can be heard while you
 * write to somebody else; ours stopped the moment the chat was left.
 *
 * The player now belongs to the application. Leaving the chat hands the
 * sound from the bubble's own element to the player's, at the same second,
 * and the bar stays where the reader is: over the chat list on a phone, in
 * the other conversation's header on a computer. Coming back, the bubble
 * drives that same playback rather than starting its own from zero.
 *
 * Everything is fictional and mocked on the fixture host; the voice is a
 * generated tone served by the test from its own HTTP server, because WebKit
 * loads media past page.route, and it answers byte ranges, without which
 * WebKit will not play it.
 */

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

const AT = "2026-09-27T09:00:00.000Z";
const ME = person("61111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("61111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const CHAT_VOICE = "62222222-2222-4222-8222-000000000001";
const CHAT_OTHER = "62222222-2222-4222-8222-000000000002";
const SECONDS = 12;

/** A quiet 440 Hz tone, 8 kHz mono 8-bit PCM: small, and every engine plays it. */
function toneWav(seconds: number): Buffer {
  const rate = 8000;
  const samples = rate * seconds;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples, 40);
  const body = Buffer.alloc(samples);
  for (let i = 0; i < samples; i += 1) body[i] = 128 + Math.round(8 * Math.sin((2 * Math.PI * 440 * i) / rate));
  return Buffer.concat([header, body]);
}

let server: Server;
let voiceUrl = "";

test.beforeAll(async () => {
  const wav = toneWav(SECONDS);
  server = createServer((request, response) => {
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.range ?? "");
    const start = range && range[1] ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    const headers = {
      "Content-Type": "audio/wav",
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Content-Length": String(end - start + 1),
    };
    if (range) {
      response.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${wav.length}` });
    } else {
      response.writeHead(200, headers);
    }
    response.end(wav.subarray(start, end + 1));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  voiceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/anna-d313.wav`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function boot(page: Page) {
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [
      chat(CHAT_VOICE, "private", null, "2026-09-27T09:10:00.000Z"),
      chat(CHAT_OTHER, "group", "Команда проекта", "2026-09-27T09:05:00.000Z"),
    ],
    memberships: [
      membership(CHAT_VOICE, ME, "owner", AT),
      membership(CHAT_VOICE, ANNA, "member", AT),
      membership(CHAT_OTHER, ME, "owner", AT),
      membership(CHAT_OTHER, ANNA, "member", AT),
    ],
    messages: [
      message("63333333-3333-4333-8333-000000000001", CHAT_VOICE, ANNA, `Голосовое сообщение (0:${String(SECONDS).padStart(2, "0")})`, "2026-09-27T09:10:00.000Z", {
        type: "audio",
        media_url: voiceUrl,
        media_metadata: { duration_ms: SECONDS * 1000 },
      }),
      message("63333333-3333-4333-8333-000000000002", CHAT_OTHER, ANNA, "Созвон в четыре", "2026-09-27T09:05:00.000Z"),
    ],
  });
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

async function position(page: Page) {
  return Number(await page.getByTestId("chat-media-playback-progress").first().inputValue());
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("a voice message keeps playing after its chat is left, and the bar stays with the reader", async ({ page }) => {
  await boot(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-list-item").filter({ hasText: ANNA.full_name }).click();
  const voice = page.locator('[data-voice-message="true"]').first();
  await expect(voice).toBeVisible();
  await voice.getByRole("button", { name: "Воспроизвести" }).click();

  const bar = page.getByTestId("chat-media-playback-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Пауза" })).toBeVisible();
  await expect.poll(() => position(page), { timeout: 6_000 }).toBeGreaterThan(0.5);

  if (isPhone(page)) await page.getByRole("button", { name: "Назад", exact: true }).click();
  else await page.getByTestId("chat-list-item").filter({ hasText: "Команда проекта" }).click();
  if (isPhone(page)) await expect(page.getByTestId("chat-list-item").first()).toBeVisible();
  else await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: "Созвон в четыре" })).toBeVisible();

  const away = page.getByTestId("chat-media-playback-bar");
  await expect(away, "the bar stays where the reader went").toBeVisible();
  await expect(away.getByRole("button", { name: "Пауза" }), "and it is still playing").toBeVisible();
  const first = await position(page);
  await expect.poll(() => position(page), { timeout: 6_000, message: "the sound goes on after the chat is left" }).toBeGreaterThan(first + 0.5);

  await away.getByRole("button", { name: "Пауза" }).click();
  await expect(away.getByRole("button", { name: "Воспроизвести" })).toBeVisible();
  const paused = await position(page);
  expect(paused).toBeGreaterThan(1);

  await away.getByTestId("chat-media-playback-source").click();
  const back = page.locator('[data-voice-message="true"]').first();
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute("data-active-media", "true");
  await back.getByRole("button", { name: "Воспроизвести" }).click();
  await expect(page.getByTestId("chat-media-playback-bar").getByRole("button", { name: "Пауза" })).toBeVisible();
  const resumed = await position(page);
  expect(resumed, "coming back resumes where it stopped, not from zero").toBeGreaterThanOrEqual(paused - 0.25);
});
