import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openFixture,
  person,
  type Row,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * The two lines a call puts in the conversation, put in front of a browser.
 *
 * `.migration-backup/supabase/migrations/20260918200000_a_call_says_so_in_the_conversation.sql`
 * writes them, `tests/server/voice-call-service-message-db.test.mjs` proves
 * when and how many. Neither can see a pixel, and the renderer is not new --
 * `SystemMessageNotice` has drawn `type: "system"` since May 2026 and D-166's
 * membership lines since 2026-09-15. What had never been looked at is these
 * sentences at this length: «Начался разговор в канале «Общая»» is longer than
 * every membership line, and a room name may be 64 characters, which is wider
 * than the pill's `min(82vw, 32rem)` on a phone and therefore wraps.
 *
 * Everything is fictional and mocked. No production screen is rendered.
 *
 * The wording is checked **exactly**. D-166's first service line was
 * ungrammatical and a loose regex over it would have passed, so a loose regex
 * is not used here either.
 */

const AT = "2026-09-18T09:00:00.000Z";

const ANNA = person("58888888-8888-4888-8888-000000000001", "Анна Ковалёва", "anna");
const BORIS = person("58888888-8888-4888-8888-000000000002", "Борис Ильин", "boris");
const CHAT_TEAM = "59999999-9999-4999-8999-000000000001";

/** Exactly what `voice_call_service_line` returns, both arms. */
const STARTED = "Начался разговор в канале «Общая»";
const ENDED = "Разговор в канале «Общая» закончился";

/**
 * A room name at the column's limit -- `voice_channels_name_length_check`
 * allows 64 characters -- so the pill is measured at its widest rather than at
 * a name somebody happened to pick.
 */
const LONG_ROOM = "Переговорная для больших планёрок и длинных обсуждений проекта ЛЦ";
const STARTED_LONG = `Начался разговор в канале «${LONG_ROOM}»`;

const ANCHOR = "Созвонимся после обеда, как договорились";

function serviceRow(index: number, content: string, minute: number): Row {
  return message(
    "5aaaaaaa-aaaa-4aaa-8aaa-" + String(index + 1).padStart(12, "0"),
    CHAT_TEAM,
    ANNA,
    content,
    new Date(Date.UTC(2026, 8, 18, 10, minute)).toISOString(),
    // The shape the database guarantees: `messages_sender_shape_check`
    // *requires* a system row to carry no user and no bot, and
    // `resolveMessageActor` answers `{ kind: "system" }` only when both are
    // absent. A fixture that left the sender in would measure a bubble.
    { type: "system", user_id: null, sender: null },
  );
}

async function openGroup(page: Page) {
  await openFixture(page, {
    me: ANNA,
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [
      membership(CHAT_TEAM, ANNA, "owner", AT),
      membership(CHAT_TEAM, BORIS, "member", AT),
    ] as Row[],
    messages: [
      message(
        "5aaaaaaa-aaaa-4aaa-8aaa-000000000000",
        CHAT_TEAM,
        ANNA,
        ANCHOR,
        new Date(Date.UTC(2026, 8, 18, 9, 30)).toISOString(),
      ),
      serviceRow(0, STARTED, 5),
      serviceRow(1, ENDED, 41),
      serviceRow(2, STARTED_LONG, 50),
    ],
    rpc: (name) => {
      if (name === "profile_badges") return { body: [] };
      if (name === "search_chat_messages") return missingFunction(name);
      return undefined;
    },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("chat-list-item").filter({ hasText: "Команда проекта" });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator("[data-system-message]")).toHaveCount(3);
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
}

function shotPath(info: TestInfo, name: string): string {
  return `output/voice-call-service-messages/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("the conversation carries both lines exactly as the database writes them", async ({
  page,
}) => {
  await openGroup(page);
  // Scoped to the conversation: unscoped, the newest line matches twice and the
  // second is the chat list, which is the other half of this feature and is
  // measured on its own below.
  const conversation = page.getByTestId("message-scroll-container");
  for (const line of [STARTED, ENDED, STARTED_LONG]) {
    await expect(conversation.getByText(line, { exact: true })).toHaveCount(1);
  }
});

test("a running call is the group's last word in the chat list", async ({ page }) => {
  await openGroup(page);
  // This is how somebody in the chat right now learns a call is running without
  // watching the rail. `formatChatMessagePreview` falls through to `content`
  // for `system`, and `resolveMessageActor` returns `{ kind: "system" }`, which
  // takes no «name: » prefix -- so the line stands alone, exactly as it reads
  // in the conversation.
  const row = page.getByTestId("chat-list-item").filter({ hasText: "Команда проекта" });
  await expect(row).toContainText(STARTED_LONG.slice(0, 30));
});

test("a call line is not a message: no bubble, no avatar, and it cannot be selected", async ({
  page,
}) => {
  await openGroup(page);
  await expect(page.locator("[data-system-message]")).toHaveCount(3);
  for (const line of [STARTED, ENDED, STARTED_LONG]) {
    await expect(
      page.locator('[data-message-bubble="true"]').filter({ hasText: line }),
    ).toHaveCount(0);
    await expect(page.locator('[data-message-row="true"]').filter({ hasText: line })).toHaveCount(
      0,
    );
  }
  // The control: the ordinary message beside them is a bubble.
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: ANCHOR }),
  ).toHaveCount(1);
});

test("each line is centred, and a 64-character room name wraps rather than overflowing", async ({
  page,
}) => {
  await openGroup(page);
  const around = await page.getByTestId("message-scroll-container").boundingBox();
  expect(around, "the lines have nothing to be centred in").not.toBeNull();
  if (!around) return;

  const notices = page.locator("[data-system-message]");
  for (let index = 0; index < 3; index += 1) {
    const box = await notices.nth(index).boundingBox();
    expect(box, `line ${index} has no box`).not.toBeNull();
    if (!box) continue;
    const leftGap = box.x - around.x;
    const rightGap = around.x + around.width - (box.x + box.width);
    // Within two pixels of even -- the scroller keeps a gutter for its
    // scrollbar, so «centred» is centred in the track.
    expect(Math.abs(leftGap - rightGap), `line ${index} is not centred`).toBeLessThanOrEqual(2);
    // Nothing may reach past the track. The pill is capped at
    // min(82vw, 32rem), so the long name has to wrap.
    expect(box.x, `line ${index} starts left of the track`).toBeGreaterThanOrEqual(around.x - 1);
    expect(
      box.x + box.width,
      `line ${index} runs past the right of the track`,
    ).toBeLessThanOrEqual(around.x + around.width + 1);
  }

  // The long line is taller than the short one, which is what wrapping means.
  const short = await notices.nth(0).boundingBox();
  const long = await notices.nth(2).boundingBox();
  if (short && long) {
    expect(long.height, "a 64-character room name did not wrap").toBeGreaterThan(short.height);
  }

  // And the page itself must not scroll sideways because of it.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls horizontally").toBeLessThanOrEqual(1);
});

for (const theme of ["light", "dark"] as const) {
  test(`the call lines hold in the ${theme} theme`, async ({ page }, info) => {
    await openGroup(page);
    await setTheme(page, theme);
    await page.waitForTimeout(250);
    await page.screenshot({ path: shotPath(info, `lines-${theme}`), fullPage: false });

    // A tight crop of the three pills, because a whole-window shot at 1440 is
    // too small to judge a 12px sentence by eye -- which is the only way the
    // owner judges it.
    const boxes = [];
    const notices = page.locator("[data-system-message]");
    for (let index = 0; index < 3; index += 1) {
      const box = await notices.nth(index).boundingBox();
      if (box) boxes.push(box);
    }
    if (boxes.length === 3) {
      const view = page.viewportSize() ?? { width: 1440, height: 900 };
      const leftmost = Math.min(...boxes.map((box) => box.x));
      const rightmost = Math.max(...boxes.map((box) => box.x + box.width));
      const top = Math.max(0, boxes[0].y - 24);
      const bottom = boxes[2].y + boxes[2].height + 24;
      await page.screenshot({
        path: shotPath(info, `crop-${theme}`),
        clip: {
          x: Math.max(0, leftmost - 24),
          y: top,
          width: Math.min(view.width - Math.max(0, leftmost - 24), rightmost - leftmost + 48),
          height: Math.min(view.height - top, bottom - top),
        },
      });
    }
  });
}
