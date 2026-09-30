import { expect, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * D-330, from a tester on 2026-09-29: «если написать голосовое, то он
 * отправляет голосовое. Что за бред?» The message was sent as text; the bubble
 * drew it as a voice player with nothing to play and «загрузка...» under it,
 * because its predicate fell back to the words. Seven text messages in
 * production said «голосовое» or «voice» and were drawn that way.
 *
 * Fictional people and messages, mocked on the fixture host.
 */

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

const AT = "2026-09-29T18:00:00.000Z";
const ME = person("67777777-7777-4777-8777-000000000001", "Максим Орлов", "maksim");
const ANNA = person("67777777-7777-4777-8777-000000000002", "Анна Смирнова", "anna");
const CHAT = "68888888-8888-4888-8888-000000000001";
const WORDS = [
  "не получается перемотать голосовое",
  "голосовое",
  "Голосовое сообщение пришло?",
  "voice chat в четыре",
];

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("a message that says «голосовое» is text, and only a voice note is a player", async ({ page }) => {
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(CHAT, "private", null, "2026-09-29T18:45:00.000Z")],
    memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT)],
    messages: [
      message("69999999-9999-4999-8999-000000000001", CHAT, ANNA, "🎤 Голосовое сообщение (00:12)", "2026-09-29T18:40:00.000Z", {
        type: "audio",
        media_url: "http://127.0.0.1:9/voice-d330.webm",
      }),
      ...WORDS.map((words, index) =>
        message(`69999999-9999-4999-8999-00000000001${index}`, CHAT, ANNA, words, `2026-09-29T18:4${index + 1}:00.000Z`),
      ),
    ],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-list-item").filter({ hasText: ANNA.full_name }).click();

  for (const words of WORDS) {
    const bubble = page.locator('[data-message-bubble="true"]').filter({ has: page.getByText(words, { exact: true }) });
    await expect(bubble, `«${words}» is on screen as its words`).toBeVisible();
    await expect(bubble.locator('[data-voice-message="true"]'), `«${words}» is not a player`).toHaveCount(0);
  }
  await expect(page.locator('[data-voice-message="true"]'), "the one voice note is the one player").toHaveCount(1);
});
