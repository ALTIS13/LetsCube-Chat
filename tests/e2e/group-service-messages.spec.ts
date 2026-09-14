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
 * D-166: a group says who joined and who left.
 *
 * The six lines the trigger writes, put in front of a browser. The renderer
 * itself is not new — `SystemMessageNotice` has drawn `type: "system"` since
 * May 2026 — but nothing had written one since, so the shape had never been
 * seen with real sentences in it, and the three rows that exist in production
 * are none of them the newest in their chat, which means the chat list's
 * preview of one had never been drawn at all.
 *
 * Everything is fictional and mocked. No production screen is rendered.
 *
 * The wording is checked **exactly**, because its first form was
 * ungrammatical: «АКТЁР добавил(а) УЧАСТНИК» leaves a direct object in the
 * nominative, and SQL has no declension to fix it with. A loose regex over
 * these lines would have passed that too.
 */

const AT = "2026-09-14T09:00:00.000Z";

const ZOYA = person("55555555-5555-4555-8555-000000000001", "Зоя Яблокова", "zoya");
const BORIS = person("55555555-5555-4555-8555-000000000002", "Борис Ильин", "boris");
const CHAT_TEAM = "56666666-6666-4666-8666-000000000001";

/** The six sentences, in the order the trigger's rehearsal produced them. */
const LINES = [
  "Зоя Яблокова добавил(а) в группу: Борис Ильин",
  "Борис Ильин присоединился(ась) к группе",
  "Борис Ильин вышел(а) из группы",
  "Зоя Яблокова исключил(а) из группы: Борис Ильин",
  "Борис Ильин больше не в группе",
] as const;

const ANCHOR = "Созвон в четверг, как договорились";

function systemRow(index: number, content: string): Row {
  return message(
    "57777777-7777-4777-8777-" + String(index + 1).padStart(12, "0"),
    CHAT_TEAM,
    ZOYA,
    content,
    new Date(Date.UTC(2026, 8, 14, 10, index)).toISOString(),
    // What the database guarantees for this shape: `messages_sender_shape_check`
    // *requires* a system row to carry no user and no bot, and
    // `resolveMessageActor` answers `{ kind: "system" }` only when both are
    // absent. A fixture that left the sender in would measure a different thing.
    { type: "system", user_id: null, sender: null },
  );
}

async function openGroup(page: Page) {
  await openFixture(page, {
    me: ZOYA,
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [
      membership(CHAT_TEAM, ZOYA, "owner", AT),
      membership(CHAT_TEAM, BORIS, "member", AT),
    ] as Row[],
    messages: [
      message(
        "57777777-7777-4777-8777-000000000000",
        CHAT_TEAM,
        ZOYA,
        ANCHOR,
        new Date(Date.UTC(2026, 8, 14, 9, 30)).toISOString(),
      ),
      ...LINES.map((line, index) => systemRow(index, line)),
    ],
    rpc: (name) => {
      if (name === "profile_badges") return { body: [] };
      if (name === "search_chat_messages") return missingFunction(name);
      return undefined;
    },
  });
  // Not the shared `openChat`: it waits for a named bubble, and the only
  // ordinary message here is the oldest of the six. Waiting for the service
  // lines instead anchors on what the conversation actually ends with, which is
  // the thing this spec is about.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("chat-list-item").filter({ hasText: "Команда проекта" });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator("[data-system-message]")).toHaveCount(LINES.length);
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
  return `output/service-messages/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("every line the trigger writes is drawn, word for word", async ({ page }) => {
  await openGroup(page);
  // Scoped to the conversation. Unscoped, each line matched twice — the second
  // is the chat list, which is not a fault but the other half of this feature,
  // measured on its own below.
  const conversation = page.getByTestId("message-scroll-container");
  for (const line of LINES) {
    await expect(conversation.getByText(line, { exact: true })).toHaveCount(1);
  }
});

test("the chat list shows the newest service line as the chat's last word", async ({ page }) => {
  await openGroup(page);
  // This path had never been drawn: all three system messages in production are
  // older than their chat's newest message, so no chat list had ever previewed
  // one. `formatChatMessagePreview` falls through to `content` for `system`, and
  // `resolveMessageActor` returns `{ kind: "system" }`, which takes no «name: »
  // prefix — so the line stands alone, exactly as it reads in the conversation.
  const row = page.getByTestId("chat-list-item").filter({ hasText: "Команда проекта" });
  await expect(row).toContainText(LINES[LINES.length - 1]);
});

test("a service line is not a message: no bubble, no avatar, and it cannot be selected", async ({ page }) => {
  await openGroup(page);

  // `SystemMessageNotice` is rendered instead of the bubble, not inside it.
  const notices = page.locator("[data-system-message]");
  await expect(notices).toHaveCount(LINES.length);

  const anchorBubble = page.locator('[data-message-bubble="true"]').filter({ hasText: ANCHOR });
  await expect(anchorBubble).toHaveCount(1);
  for (const line of LINES) {
    await expect(
      page.locator('[data-message-bubble="true"]').filter({ hasText: line }),
    ).toHaveCount(0);
  }

  // A row that can be selected carries the selection affordance; a service line
  // does not, because `canSelect` is false for it.
  await expect(
    page.locator('[data-message-row="true"]').filter({ hasText: LINES[0] }),
  ).toHaveCount(0);
});

test("a service line is centred, not ranged to either side", async ({ page }) => {
  await openGroup(page);
  const notice = page.locator("[data-system-message]").first();
  const box = await notice.boundingBox();
  const around = await page.getByTestId("message-scroll-container").boundingBox();
  expect(box, "the service line has no box").not.toBeNull();
  expect(around, "the line has nothing to be centred in").not.toBeNull();
  if (!box || !around) return;
  const leftGap = box.x - around.x;
  const rightGap = around.x + around.width - (box.x + box.width);
  // Within two pixels of even — the scroller keeps a gutter for its scrollbar,
  // so «centred» is centred in the track rather than in the viewport. An
  // own-message line would sit hard against one side, not two pixels off.
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2);
});

for (const theme of ["light", "dark"] as const) {
  test(`the service lines hold in the ${theme} theme`, async ({ page }, info) => {
    await openGroup(page);
    await setTheme(page, theme);
    await page.waitForTimeout(250);
    await page.screenshot({ path: shotPath(info, `lines-${theme}`), fullPage: false });
  });
}
