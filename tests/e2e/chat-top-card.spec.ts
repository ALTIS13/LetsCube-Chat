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
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * Tracker item 70, from the owner on 2026-09-28 with two screenshots side by
 * side: «посмотри как минималистично/удобно сделана верхняя панель в telegram
 * (включая прослушивание голосовых) и как громоздко … это выглядит у нас».
 *
 * Ours drew the player as a card a third of a phone's screen tall inside the
 * header, and the pinned message as a second capsule under it. Telegram draws
 * one card: the pinned message a 48-high row, the player a 36-high one, a
 * hairline between. What is measured here is that shape and the mechanics that
 * came with it — the speed chip's tap cycle and its long list, the pinned row's
 * walk through every pin, and the cross that asks before unpinning.
 *
 * Everything is fictional and mocked on the fixture host; the voice is a tone
 * served by the test itself, as in `voice-playback-continuity.spec.ts`.
 */

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

const ME = person("71111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const NIKITA = person("71111111-1111-4111-8111-000000000002", "Никита Фермер", "nikita");
const CHAT_MANY = "72222222-2222-4222-8222-000000000001";
const CHAT_ONE = "72222222-2222-4222-8222-000000000002";
const VOICE_ID = "73333333-3333-4333-8333-000000000009";
const SECONDS = 20;

/** Minutes before now, so the player's date reads today whatever day this runs. */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

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
    if (range) response.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${wav.length}` });
    else response.writeHead(200, headers);
    response.end(wav.subarray(start, end + 1));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  voiceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/nikita-item70.wav`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

const pinned = (id: string, chatId: string, text: string, minutes: number): Row =>
  message(id, chatId, NIKITA, text, ago(minutes), { pinned: true, pinned_at: ago(minutes) });

async function boot(page: Page): Promise<Fixture> {
  return openFixture(page, {
    me: ME,
    people: [NIKITA],
    chats: [
      chat(CHAT_MANY, "private", null, ago(1)),
      chat(CHAT_ONE, "group", "Смена на складе", ago(30)),
    ],
    memberships: [
      membership(CHAT_MANY, ME, "owner", ago(1)),
      membership(CHAT_MANY, NIKITA, "member", ago(1)),
      membership(CHAT_ONE, ME, "owner", ago(1)),
      membership(CHAT_ONE, NIKITA, "member", ago(1)),
    ],
    messages: [
      pinned("73333333-3333-4333-8333-000000000001", CHAT_MANY, "Адрес склада: Лесная, 12", 50),
      pinned("73333333-3333-4333-8333-000000000002", CHAT_MANY, "Пропуск на въезд у охраны", 40),
      pinned("73333333-3333-4333-8333-000000000003", CHAT_MANY, "Смена начинается в восемь", 30),
      pinned("73333333-3333-4333-8333-000000000004", CHAT_MANY, "Код от шкафчика 4471", 20),
      message(VOICE_ID, CHAT_MANY, NIKITA, `Голосовое сообщение (0:${SECONDS})`, ago(5), {
        type: "audio",
        media_url: voiceUrl,
        media_metadata: { duration_ms: SECONDS * 1000 },
      }),
      pinned("73333333-3333-4333-8333-000000000011", CHAT_ONE, "Инвентаризация в пятницу", 35),
    ],
    rpc: (name, body) => (name === "unpin_message"
      ? { body: { id: body.p_message_id, pinned: false } }
      : undefined),
  });
}

async function openConversation(page: Page, name: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-list-item").filter({ hasText: name }).click();
  await expect(page.getByTestId("chat-top-card")).toBeVisible();
}

async function startVoice(page: Page) {
  const voice = page.locator('[data-voice-message="true"]').first();
  await expect(voice).toBeVisible();
  await voice.getByRole("button", { name: "Воспроизвести" }).click();
  await expect(page.getByTestId("chat-media-playback-bar").getByRole("button", { name: "Пауза" })).toBeVisible();
}

const height = async (page: Page, testId: string) =>
  (await page.getByTestId(testId).boundingBox())?.height ?? 0;

test("the pinned message and the player are one card, a row each, as Telegram draws them", async ({ page }) => {
  await boot(page);
  await openConversation(page, NIKITA.full_name);

  const card = page.getByTestId("chat-top-card");
  const pinnedRow = card.getByTestId("pinned-message-bar");
  await expect(pinnedRow).toContainText("Закреплённое сообщение");
  await expect(pinnedRow).toContainText("Код от шкафчика 4471");
  expect(await height(page, "pinned-message-bar"), "Telegram's pinned bar is 48 high").toBe(48);
  // Four pins: a segment each, the newest lit at the foot.
  await expect(card.getByTestId("pinned-message-line")).toHaveAttribute("data-segments", "4");
  await expect(card.getByTestId("pinned-message-line")).toHaveAttribute("data-lit", "3");

  await startVoice(page);
  const bar = card.getByTestId("chat-media-playback-bar");
  await expect(bar, "the player is a row of the same card").toBeVisible();
  await expect(bar).toHaveAttribute("data-placement", "chat");
  await expect(page.getByTestId("chat-header-shell").getByTestId("chat-media-playback-bar"), "and no longer in the header").toHaveCount(0);
  expect(await height(page, "chat-media-playback-bar"), "one line, not a card").toBe(40);
  // Two rows and the rule between them, and nothing else: the old player alone
  // was a card over 110 high on a phone.
  const cardHeight = (await card.boundingBox())?.height ?? 0;
  expect(cardHeight).toBeGreaterThanOrEqual(89);
  expect(cardHeight).toBeLessThanOrEqual(91);

  // Telegram's words: the sender in bold, then when it was sent.
  const source = bar.getByTestId("chat-media-playback-source");
  await expect(source).toContainText(NIKITA.full_name);
  await expect(source).toHaveText(/Никита Фермер\s*(в|вчера в) \d{2}:\d{2}$/);
  // No slider and no previous or next: the line along the foot is the progress.
  await expect(bar.getByRole("button", { name: "Предыдущее медиа" })).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Следующее медиа" })).toHaveCount(0);
  await expect.poll(async () =>
    (await page.getByTestId("chat-media-playback-line").boundingBox())?.width ?? 0,
  { timeout: 6_000, message: "the line grows as it plays" }).toBeGreaterThan(2);
  expect((await page.getByTestId("chat-media-playback-line").boundingBox())?.height).toBeLessThanOrEqual(4);
});

test("a tap on the speed walks 1, 1.5, 2 and back; holding it or a right click lists every speed", async ({ page }) => {
  await boot(page);
  await openConversation(page, NIKITA.full_name);
  await startVoice(page);

  const chip = page.getByTestId("chat-media-playback-speed");
  await expect(chip).toHaveText("1X");
  await chip.click();
  await expect(chip).toHaveText("1.5X");
  await chip.click();
  await expect(chip).toHaveText("2X");
  await chip.click();
  await expect(chip).toHaveText("1X");
  await chip.click();
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("kub.mediaPlayback.v1") ?? "{}") as { playbackRate?: number });
  expect(stored.playbackRate, "the speed is the player's, kept for the next message").toBe(1.5);

  const finger = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  if (finger) {
    const box = (await chip.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(chip, "a quick tap is still the cycle").toHaveText("2X");
    // A held finger: pointer down, then nothing until the list opens.
    await chip.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, button: 0 });
    await expect(page.getByTestId("chat-media-playback-speed-menu")).toBeVisible();
    await chip.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, button: 0 });
    await chip.dispatchEvent("click");
    await expect(chip, "the release that closes a long press does not move the speed").toHaveText("2X");
  } else {
    await chip.click({ button: "right" });
    await expect(page.getByTestId("chat-media-playback-speed-menu")).toBeVisible();
    await expect(chip, "a right click only opens the list").toHaveText("1.5X");
    await chip.click();
    await expect(page.getByTestId("chat-media-playback-speed-menu"), "a press on the chip closes its open list").toHaveCount(0);
    await expect(chip, "and does not move the speed under it").toHaveText("1.5X");
    await chip.click({ button: "right" });
  }
  const menu = page.getByTestId("chat-media-playback-speed-menu");
  await expect(menu.getByRole("menuitemradio")).toHaveText(["0.5X", "1X", "1.5X", "2X"]);
  await menu.getByRole("menuitemradio", { name: "0.5X" }).click();
  await expect(menu).toHaveCount(0);
  await expect(chip).toHaveText("0.5X");
  // From a speed off the cycle, a tap goes to the next stop above it.
  await chip.click();
  await expect(chip).toHaveText("1X");
});

test("a tap on the pinned row goes to the pin and moves the row to the one before it, round to the newest", async ({ page }) => {
  await boot(page);
  await openConversation(page, NIKITA.full_name);

  const row = page.getByTestId("pinned-message-bar");
  const line = page.getByTestId("pinned-message-line");
  await expect(row).toContainText("Код от шкафчика 4471");
  await row.click();
  await expect(row).toContainText("Закреплённое сообщение #3");
  await expect(row).toContainText("Смена начинается в восемь");
  await expect(line).toHaveAttribute("data-lit", "2");
  await row.click();
  await row.click();
  await expect(row).toContainText("Закреплённое сообщение #1");
  await expect(row).toContainText("Адрес склада: Лесная, 12");
  await expect(line).toHaveAttribute("data-lit", "0");
  await row.click();
  await expect(row, "after the oldest, the newest again").not.toContainText("#");
  await expect(row).toContainText("Код от шкафчика 4471");

  // More than one pin: the control at the right is the list, not a cross.
  await expect(page.getByTestId("pinned-message-unpin")).toHaveCount(0);
  await page.getByTestId("pinned-message-list-toggle").click();
  await expect(page.getByTestId("pinned-message-list")).toBeVisible();
  await expect(page.getByTestId("pinned-message-list").getByText("Пропуск на въезд у охраны")).toBeVisible();
});

test("a single pin's cross asks before it unpins for everybody", async ({ page }) => {
  const fixture = await boot(page);
  await openConversation(page, "Смена на складе");

  const row = page.getByTestId("pinned-message-bar");
  await expect(row).toContainText("Инвентаризация в пятницу");
  await expect(page.getByTestId("pinned-message-list-toggle"), "one pin has nothing to list").toHaveCount(0);

  await page.getByTestId("pinned-message-unpin").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Открепить сообщение?");
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await expect(row).toBeVisible();
  expect(fixture.rpcBodies("unpin_message"), "cancelling unpins nothing").toHaveLength(0);

  await page.getByTestId("pinned-message-unpin").click();
  await page.getByRole("dialog").getByRole("button", { name: "Открепить" }).click();
  await expect.poll(() => fixture.rpcBodies("unpin_message").length).toBe(1);
  expect(fixture.rpcBodies("unpin_message")[0]).toEqual({ p_message_id: "73333333-3333-4333-8333-000000000011" });
  await expect(page.getByTestId("chat-top-card"), "the last pin gone, the card goes").toHaveCount(0);
});

test("a computer keeps its volume behind an icon; a phone has none", async ({ page }) => {
  await boot(page);
  await openConversation(page, NIKITA.full_name);
  await startVoice(page);
  const finger = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  const volume = page.getByTestId("chat-media-playback-volume");
  if (finger) {
    await expect(volume).toBeHidden();
    return;
  }
  const opacity = () => volume.evaluate((node) => Number(getComputedStyle(node.parentElement!.parentElement!).opacity));
  expect(await opacity(), "out of sight until pointed at").toBe(0);
  await page.getByTitle("Громкость").hover();
  await expect.poll(opacity).toBe(1);
});
