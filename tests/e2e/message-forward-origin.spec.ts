import { mkdirSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * D-291. A forwarded message says where it came from.
 *
 * The tester, 2026-09-20: «плюс не вижу от кого переслал сообщения тебе». The
 * bubble has drawn «Переслано от имя» all along, from a field nothing ever
 * filled, so every real forward read a bare «Переслано».
 *
 * Both halves are asserted here, because only one of them is a fix and the
 * other is a limit that has to stay visible:
 *
 *   - the source **was** readable — the reader is in the chat it came from, as
 *     the person who forwarded it always is — and the name is drawn;
 *   - the source was **not** — `null` through the embed, which is what RLS
 *     returns for a chat the reader is not in — and the line stays, unnamed.
 *
 * Everything runs on the message-actions fixture. Every person, chat and line
 * is invented.
 */

const AT = "2026-09-13T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-0000000000e1", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-0000000000e2", "Анна Смирнова");
const PETER = person("11111111-1111-4111-8111-0000000000e3", "Пётр Ильин");
const CHAT = "22222222-2222-4222-8222-0000000000e1";
const CHAT_NAME = "Планёрка";

const PLAIN = "Обычное сообщение без пересылки";
const NAMED = "Пересланное, источник читается";
const UNNAMED = "Пересланное, источник закрыт";

const SOURCE_ID = "55555555-5555-4555-8555-0000000000e9";

/** The source row exactly as the projection's embed brings it back. */
const READABLE_SOURCE = {
  id: SOURCE_ID,
  type: "text",
  deleted_at: null,
  user_id: PETER.id,
  bot_id: null,
  sender: { id: PETER.id, full_name: PETER.full_name, username: PETER.username, avatar_url: null },
  bot: null,
};

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT, "group", CHAT_NAME, AT)],
    memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT)],
    messages: [
      message("55555555-5555-4555-8555-0000000000e1", CHAT, ANNA, PLAIN, iso(0), {}),
      message("55555555-5555-4555-8555-0000000000e2", CHAT, ANNA, NAMED, iso(2), {
        forwarded_from_id: SOURCE_ID,
        forwarded_from: READABLE_SOURCE,
      }),
      // What a row looks like when the reader is not in the source's chat: the
      // id is there, the row behind it is not.
      message("55555555-5555-4555-8555-0000000000e3", CHAT, ANNA, UNNAMED, iso(4), {
        forwarded_from_id: SOURCE_ID,
        forwarded_from: null,
      }),
    ],
  };
}

const iso = (minute: number) => new Date(Date.UTC(2026, 8, 13, 10, minute)).toISOString();

async function openConversation(page: Page) {
  const seed = rows();
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await openChat(page, CHAT_NAME, PLAIN);
}

const bubble = (page: Page, text: string) => page.locator('[data-message-bubble="true"]', { hasText: text });
const forwardLine = (page: Page, text: string) => bubble(page, text).locator('[data-message-forwarded="true"]');

test("a forward whose source can be read names the person who wrote it (D-291)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openConversation(page);

  const line = forwardLine(page, NAMED);
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("data-forward-origin", "named");
  await expect(line).toHaveText("Переслано от Пётр Ильин");
});

test("a forward whose source is closed keeps the line and adds no guess (D-291)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openConversation(page);

  const line = forwardLine(page, UNNAMED);
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("data-forward-origin", "unnamed");
  await expect(line).toHaveText("Переслано");
  // Not a name in smaller letters, not «Неизвестный отправитель»: the surface
  // says only what it read.
  await expect(line).not.toContainText("от");
});

test("a message that was never forwarded draws no line at all (D-291)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openConversation(page);
  await expect(forwardLine(page, PLAIN)).toHaveCount(0);
});

test("what a forwarded message looks like, photographed (D-291)", async ({ page }, info: TestInfo) => {
  await requireFixtureServer(page.request);
  for (const theme of ["light", "dark"] as const) {
    await openConversation(page);
    await page.evaluate((value) => {
      const root = document.documentElement;
      root.classList.toggle("dark", value === "dark");
      root.classList.toggle("light", value === "light");
      root.setAttribute("data-theme", value);
      root.style.colorScheme = value;
    }, theme);
    await expect(forwardLine(page, NAMED)).toBeVisible();
    mkdirSync("output/forward-origin", { recursive: true });
    // The bubble, not the page: the line is 12px and a whole-screen shot of it
    // proves nothing about how it reads.
    await bubble(page, NAMED).first().screenshot({
      path: `output/forward-origin/named-${theme}-${info.project.name}.png`,
    });
    await bubble(page, UNNAMED).first().screenshot({
      path: `output/forward-origin/unnamed-${theme}-${info.project.name}.png`,
    });
  }
});
