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
import {
  MESSAGE_TEXT_SIZE_STORAGE_KEY,
  composerMaxHeight,
  composerRestHeight,
} from "../../artifacts/kub/src/lib/messageTextSize";

/**
 * D-289. What the reader types is the size of what they read.
 *
 * D-287 moved the message body to 16px through `.kub-message-text` and gave it
 * a 13–22 setting, and left the composer on `text-base sm:text-sm` — 16 on a
 * phone, **14 from 640px up**, and unmoved at every slider position. So the
 * asymmetry the tester met on a phone was inverted onto the desktop, and it
 * reopened at the far end of the range for everybody.
 *
 * Read off the rendered elements, both of them, in the same page: a source scan
 * for the class would stay green if the class stopped applying.
 *
 * The ceiling is asserted the same way, and it is the half with a real risk
 * attached: `MessageInput` measured `scrollHeight` against a fixed 140px, which
 * is five lines at 16px and three and a half at 22 — so the reader who enlarged
 * the text because they could not read it got a *shorter* field for asking.
 * Six lines at every size, which is Telegram Android's count, measured on the
 * device on 2026-09-20.
 *
 * Everything runs on the message-actions fixture — a mocked backend with
 * fictional people — so no production screen is touched.
 */

const AT = "2026-09-13T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-0000000000d1", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-0000000000d2", "Анна Смирнова");
const CHAT = "22222222-2222-4222-8222-0000000000d1";
const CHAT_NAME = "Разбор";
const LINE = "Первая строка разбора";

/** Long enough to run past six lines at the smallest size in the narrowest field. */
const MANY_LINES = Array.from({ length: 14 }, (_, i) => `строка номер ${i + 1}`).join("\n");

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT, "group", CHAT_NAME, AT)],
    memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT)],
    messages: [message("55555555-5555-4555-8555-0000000000d1", CHAT, ANNA, LINE, AT, { type: "text" })],
  };
}

async function openConversation(page: Page, storedSize?: number) {
  if (storedSize !== undefined) {
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [MESSAGE_TEXT_SIZE_STORAGE_KEY, String(storedSize)] as const,
    );
  }
  const seed = rows();
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await openChat(page, CHAT_NAME, LINE);
}

const composer = (page: Page) => page.locator("textarea").first();

/** The two type sizes, read off the elements the reader is actually looking at. */
async function bothSizes(page: Page): Promise<{ body: string; field: string; bodyLeading: string; fieldLeading: string }> {
  return page.evaluate(() => {
    const body = document.querySelector(".kub-message-text");
    const field = document.querySelector("textarea");
    if (!body) throw new Error("no message text on screen");
    if (!field) throw new Error("no composer on screen");
    const b = getComputedStyle(body);
    const f = getComputedStyle(field);
    return { body: b.fontSize, field: f.fontSize, bodyLeading: b.lineHeight, fieldLeading: f.lineHeight };
  });
}

test("the composer is the size of the conversation, at the default (D-289)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openConversation(page);

  const sizes = await bothSizes(page);
  // 16px both, as literals: at 1440 this was 14 against 16 before D-289, and
  // asserting «they are equal» alone would pass on a page where both had gone
  // wrong together.
  expect(sizes.body).toBe("16px");
  expect(sizes.field).toBe("16px");
  expect(sizes.bodyLeading).toBe("26px");
  expect(sizes.fieldLeading).toBe("26px");
});

for (const size of [13, 20, 22]) {
  test(`the composer follows the reader to ${size}px (D-289)`, async ({ page }) => {
    await requireFixtureServer(page.request);
    await openConversation(page, size);

    const sizes = await bothSizes(page);
    expect(sizes.field).toBe(`${size}px`);
    expect(sizes.field).toBe(sizes.body);
    expect(sizes.fieldLeading).toBe(sizes.bodyLeading);
  });
}

test("the composer at rest is one line of the reader's own size (D-289)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openConversation(page);
  const box = await composer(page).boundingBox();
  expect(box).not.toBeNull();
  // 46, not the 44 the old fixed `leading-6` gave.
  expect(Math.round(box!.height)).toBe(46);
});

for (const [size, ceiling] of [[13, 147], [16, 176], [22, 235]] as const) {
  test(`the composer stops at six lines at ${size}px, and then scrolls (D-289)`, async ({ page }) => {
    await requireFixtureServer(page.request);
    await openConversation(page, size);

    const field = composer(page);
    await field.fill(MANY_LINES);
    const measured = await field.evaluate((el) => ({
      client: (el as HTMLTextAreaElement).clientHeight,
      scroll: (el as HTMLTextAreaElement).scrollHeight,
      line: getComputedStyle(el).lineHeight,
    }));

    // The literal ceiling, and the same number the module computes — so the
    // test would catch both a product that stopped honouring it and a module
    // that started computing something else.
    expect(measured.client).toBe(ceiling);
    expect(composerMaxHeight(size)).toBe(ceiling);
    // It really did run out of room rather than simply fitting.
    expect(measured.scroll).toBeGreaterThan(measured.client);
    // And the room it has is six lines, which is the whole point of a count.
    const line = Number.parseFloat(measured.line);
    expect(Math.floor((measured.client - 20) / line)).toBe(6);
  });
}

test("a larger size never gives a smaller field, which the old fixed ceiling did (D-289)", async ({ page }) => {
  await requireFixtureServer(page.request);
  const heights: number[] = [];
  for (const size of [13, 16, 22]) {
    await openConversation(page, size);
    const field = composer(page);
    await field.fill(MANY_LINES);
    heights.push(await field.evaluate((el) => (el as HTMLTextAreaElement).clientHeight));
  }
  expect(heights[1]).toBeGreaterThan(heights[0]);
  expect(heights[2]).toBeGreaterThan(heights[1]);
  // The number the field used to stop at, whatever the reader had chosen.
  expect(heights).not.toContain(140);
});

test("the composer, photographed across the range (D-289)", async ({ page }, info: TestInfo) => {
  await requireFixtureServer(page.request);
  for (const size of [13, 16, 22]) {
    for (const theme of ["light", "dark"] as const) {
      await openConversation(page, size);
      await page.evaluate((value) => {
        const root = document.documentElement;
        root.classList.toggle("dark", value === "dark");
        root.classList.toggle("light", value === "light");
        root.setAttribute("data-theme", value);
        root.style.colorScheme = value;
      }, theme);
      const field = composer(page);
      await field.fill("Сравниваю поле с телом сообщения");
      // The capsule the field sits in, not the page: a careless crop is how a
      // contrast ratio came out 2.9× wrong in this register.
      const target = page.getByTestId("chat-composer-dock").first();
      mkdirSync("output/composer-size", { recursive: true });
      await target.screenshot({
        path: `output/composer-size/composer-${size}-${theme}-${info.project.name}.png`,
      });
      expect(composerRestHeight(size)).toBeGreaterThan(0);
    }
  }
});
