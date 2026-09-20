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
 * D-288. A photograph opened from the conversation is a place in a sequence.
 *
 * The tester, 2026-09-20, on a phone: «я не могу влево-вправо свайп сделать и
 * те же 2 отправленные фото сравнить». `MediaViewer` has had arrows, arrow keys
 * and a touch swipe since D-171 — behind a `sequence` prop only «Общие медиа»
 * ever passed. The viewer opened from a bubble was a dead end.
 *
 * What is asserted here is the rendered surface, not the source that produces
 * it: the position the header draws, which picture is on screen after each
 * control, and the fact that the last one in the conversation has no next.
 *
 * The order is Telegram's, measured on the device the same day: opening a
 * picture from a feed there reads «237 из 244» and a swipe **left** moved it to
 * «238» — the chat's whole media, chronological, forward towards the newer end.
 *
 * Everything runs on the message-actions fixture — a mocked backend with
 * fictional people and pictures this spec draws itself — so no production
 * screen and no stored file is ever touched.
 */

const AT = "2026-09-13T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-0000000000c1", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-0000000000c2", "Анна Смирнова");
const CHAT = "22222222-2222-4222-8222-0000000000c1";
const CHAT_NAME = "Стройка";

/**
 * Three photographs in three separate messages, with a note and a file between
 * two of them — because the sequence must skip what is not a picture, and a
 * fixture where every message is one could not tell that.
 */
const SHOTS = [
  { id: "55555555-5555-4555-8555-0000000000c1", caption: "Фундамент", url: "/__fixture-media/seq-1.svg", hue: 205 },
  { id: "55555555-5555-4555-8555-0000000000c3", caption: "Перекрытия", url: "/__fixture-media/seq-2.svg", hue: 145 },
  { id: "55555555-5555-4555-8555-0000000000c5", caption: "Кровля", url: "/__fixture-media/seq-3.svg", hue: 20 },
] as const;

const NOTE_ID = "55555555-5555-4555-8555-0000000000c2";
const FILE_ID = "55555555-5555-4555-8555-0000000000c4";
const FILE_CAPTION = "Смета.pdf";

/** A flat card whose hue names it, so one picture can be told from another by its pixels. */
const card = (hue: number, label: string) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">' +
  `<rect width="1200" height="900" fill="hsl(${hue} 55% 30%)"/>` +
  '<circle cx="600" cy="450" r="220" fill="none" stroke="white" stroke-width="16"/>' +
  `<text x="600" y="480" font-family="Arial, sans-serif" font-size="120" font-weight="700" fill="white" text-anchor="middle">${label}</text>` +
  "</svg>";

const iso = (minute: number) => new Date(Date.UTC(2026, 8, 13, 10, minute)).toISOString();

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT, "group", CHAT_NAME, AT)],
    memberships: [
      membership(CHAT, ME, "owner", AT),
      membership(CHAT, ANNA, "member", AT),
    ],
    messages: [
      message(SHOTS[0].id, CHAT, ANNA, SHOTS[0].caption, iso(0), {
        type: "image",
        media_url: SHOTS[0].url,
        media_metadata: { width: 1200, height: 900 },
      }),
      message(NOTE_ID, CHAT, ANNA, "Начали во вторник", iso(2), { type: "text" }),
      message(SHOTS[1].id, CHAT, ANNA, SHOTS[1].caption, iso(4), {
        type: "image",
        media_url: SHOTS[1].url,
        media_metadata: { width: 1200, height: 900 },
      }),
      message(FILE_ID, CHAT, ANNA, FILE_CAPTION, iso(6), {
        type: "file",
        media_url: "/__fixture-media/estimate.pdf",
      }),
      message(SHOTS[2].id, CHAT, ANNA, SHOTS[2].caption, iso(8), {
        type: "image",
        media_url: SHOTS[2].url,
        media_metadata: { width: 1200, height: 900 },
      }),
    ],
  };
}

async function openConversation(page: Page) {
  const seed = rows();
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  for (const [index, shot] of SHOTS.entries()) {
    await page.route(`**${shot.url}`, (route) =>
      route.fulfill({ status: 200, contentType: "image/svg+xml", body: card(shot.hue, String(index + 1)) }),
    );
  }
  await openChat(page, CHAT_NAME, SHOTS[0].caption);
}

/** Opens the viewer on one of the conversation's photographs. */
async function openPhoto(page: Page, caption: string) {
  const bubble = page.locator('[data-message-bubble="true"]', { hasText: caption });
  await bubble.getByRole("button", { name: "Открыть фото" }).click();
  await expect(page.getByRole("dialog", { name: caption })).toBeVisible();
}

/** Which picture is on screen, read off the element rather than off the state. */
async function shownUrl(page: Page): Promise<string> {
  return page.evaluate(() => {
    const image = document.querySelector('[role="dialog"] img[src]') as HTMLImageElement | null;
    return image?.getAttribute("src") ?? "";
  });
}

/** The «N из M» itself, without the date that shares its line from `sm` up. */
const position = (page: Page) => page.getByTestId("media-viewer-position").locator("span").first();

test("the conversation's viewer says where the picture stands, and moves (D-288)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openConversation(page);

  // The middle one, so both directions have somewhere to go.
  await openPhoto(page, SHOTS[1].caption);

  // Three photographs, not five messages: the note and the file are not
  // pictures and must not be counted. «из 3» exactly — no hedge, because the
  // whole conversation is loaded.
  await expect(position(page)).toHaveText("2 из 3");
  expect(await shownUrl(page)).toContain("seq-2");

  await page.getByTestId("media-viewer-next").click();
  await expect(position(page)).toHaveText("3 из 3");
  expect(await shownUrl(page)).toContain("seq-3");

  await page.getByTestId("media-viewer-prev").click();
  await page.getByTestId("media-viewer-prev").click();
  await expect(position(page)).toHaveText("1 из 3");
  expect(await shownUrl(page)).toContain("seq-1");
});

test("forward is towards the newer picture, as it is in Telegram (D-288)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openConversation(page);

  // The oldest. «Next» must walk DOWN the conversation, the way the reader was
  // already travelling — the grid's newest-first order would walk them up.
  await openPhoto(page, SHOTS[0].caption);
  await expect(position(page)).toHaveText("1 из 3");

  await page.getByTestId("media-viewer-next").click();
  expect(await shownUrl(page)).toContain("seq-2");
  await page.getByTestId("media-viewer-next").click();
  expect(await shownUrl(page)).toContain("seq-3");
});

test("the ends of the conversation draw no control that goes nowhere (D-288)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openConversation(page);

  await openPhoto(page, SHOTS[0].caption);
  await expect(page.getByTestId("media-viewer-prev")).toHaveCount(0);
  await expect(page.getByTestId("media-viewer-next")).toBeVisible();

  await page.keyboard.press("Escape");
  await openPhoto(page, SHOTS[2].caption);
  await expect(page.getByTestId("media-viewer-next")).toHaveCount(0);
  await expect(page.getByTestId("media-viewer-prev")).toBeVisible();
});

test("the arrow keys move the conversation's pictures too (D-288)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openConversation(page);
  await openPhoto(page, SHOTS[0].caption);

  await page.keyboard.press("ArrowRight");
  await expect(position(page)).toHaveText("2 из 3");
  await page.keyboard.press("ArrowLeft");
  await expect(position(page)).toHaveText("1 из 3");
});

test("a swipe inside the open viewer moves the picture, not the row under it (D-288)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openConversation(page);
  await openPhoto(page, SHOTS[0].caption);

  // The boundary D-287 drew deliberately: a horizontal drag on a message row is
  // reply; the same drag inside the viewer belongs to the viewer. This goes red
  // the moment the viewer stops catching the finger.
  const stage = page.getByTestId("media-viewer-stage");
  const box = await stage.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width - 40, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + 40, y, { steps: 12 });
  await page.mouse.up();

  // A mouse is refused on purpose — a trackpad drag is how a pointer scrolls —
  // so the picture must not have moved. The touch path is the one below.
  await expect(position(page)).toHaveText("1 из 3");

  await page.evaluate(() => {
    const stageEl = document.querySelector('[data-testid="media-viewer-stage"]') as HTMLElement | null;
    if (!stageEl) throw new Error("no stage");
    const rect = stageEl.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const make = (kind: string, x: number) =>
      new PointerEvent(kind, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch",
        clientX: x, clientY: mid,
      });
    stageEl.dispatchEvent(make("pointerdown", rect.right - 40));
    stageEl.dispatchEvent(make("pointerup", rect.left + 40));
  });
  await expect(position(page)).toHaveText("2 из 3");
});


/**
 * A conversation longer than one page, with a photograph stranded behind it.
 *
 * `useMessages` loads 100 messages at a time, so the oldest picture here is
 * genuinely not in the store when the viewer opens — which is the only way to
 * exercise the step that asks the conversation for more history and then lands
 * on what arrives.
 */
const OLD_SHOT = { id: "55555555-5555-4555-8555-0000000000f1", caption: "Котлован", url: "/__fixture-media/seq-0.svg", hue: 280 };

function longRows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  const messages: Row[] = [];
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 13, 6, minute)).toISOString();
  // The stranded one first, then 120 notes, then the two that are loaded: the
  // first page is the newest 100, so 120 notes is comfortably more than enough
  // to push this one out of it.
  messages.push(message(OLD_SHOT.id, CHAT, ANNA, OLD_SHOT.caption, at(0), {
    type: "image", media_url: OLD_SHOT.url, media_metadata: { width: 1200, height: 900 },
  }));
  for (let i = 0; i < 120; i += 1) {
    messages.push(message(`55555555-5555-4555-8555-1000000${String(i).padStart(5, "0")}`, CHAT, ANNA, `Заметка ${i + 1}`, at(i + 1), {}));
  }
  messages.push(message(SHOTS[0].id, CHAT, ANNA, SHOTS[0].caption, at(200), {
    type: "image", media_url: SHOTS[0].url, media_metadata: { width: 1200, height: 900 },
  }));
  messages.push(message(SHOTS[1].id, CHAT, ANNA, SHOTS[1].caption, at(202), {
    type: "image", media_url: SHOTS[1].url, media_metadata: { width: 1200, height: 900 },
  }));
  return {
    chats: [chat(CHAT, "group", CHAT_NAME, AT)],
    memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT)],
    messages,
  };
}

async function openLongConversation(page: Page) {
  const seed = longRows();
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  for (const [index, shot] of [OLD_SHOT, ...SHOTS].entries()) {
    await page.route(`**${shot.url}`, (route) =>
      route.fulfill({ status: 200, contentType: "image/svg+xml", body: card(shot.hue, String(index)) }),
    );
  }
  await openChat(page, CHAT_NAME, SHOTS[1].caption);
}

test("stepping off the oldest loaded picture loads history and lands on it (D-288)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openLongConversation(page);

  // Only the two pictures inside the first page are loaded, and the label says
  // so with the hedge rather than claiming a total it has not read.
  await openPhoto(page, SHOTS[0].caption);
  await expect(position(page)).toHaveText("1 из 2+");
  expect(await shownUrl(page)).toContain("seq-1");

  // «Previous» at the oldest loaded picture is offered, because more exists
  // behind it — which is what `moreAt: "start"` decides.
  const previous = page.getByTestId("media-viewer-prev");
  await expect(previous).toBeVisible();
  await previous.click();

  // The page lands and the viewer moves onto what arrived, rather than sitting
  // on a spinner or on the picture it was already showing.
  await expect(position(page)).toHaveText("1 из 3");
  expect(await shownUrl(page)).toContain("seq-0");
  // The whole history is loaded now, so the hedge is gone and this really is
  // the end.
  await expect(page.getByTestId("media-viewer-prev")).toHaveCount(0);
});

test("a prepend under an open viewer does not move the reader to another picture (D-288)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openLongConversation(page);

  // The newest, which is index 1 of 2 before the prepend and index 2 of 3
  // after it. Held by id, so what is on screen must not change — only the
  // number under it.
  await openPhoto(page, SHOTS[1].caption);
  await expect(position(page)).toHaveText("2 из 2+");
  const before = await shownUrl(page);

  await page.getByTestId("media-viewer-prev").click();
  await expect(position(page)).toHaveText("1 из 2+");
  await page.getByTestId("media-viewer-prev").click();
  await expect(position(page)).toHaveText("1 из 3");

  // And forward twice returns to exactly the picture it started on: an index
  // held across the prepend would have landed somewhere else.
  await page.getByTestId("media-viewer-next").click();
  await page.getByTestId("media-viewer-next").click();
  await expect(position(page)).toHaveText("3 из 3");
  expect(await shownUrl(page)).toBe(before);
});

test("what the conversation's viewer shows, photographed (D-288)", async ({ page }, info: TestInfo) => {
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
    await openPhoto(page, SHOTS[1].caption);
    await expect(position(page)).toHaveText("2 из 3");
    mkdirSync("output/conversation-media", { recursive: true });
    await page.screenshot({
      path: `output/conversation-media/viewer-${theme}-${info.project.name}.png`,
    });
    await page.keyboard.press("Escape");
  }
});
