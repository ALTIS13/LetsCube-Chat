import { expect, test, type Page, type Route } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openFixture,
  person,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * A blocked person's messages, folded in a conversation of several people —
 * the group chat's place in the block system (tracker item 45; the owner,
 * 2026-09-30). Discord's collapsed blocked group, read in its bundle: one line
 * saying how many, «Показать» to open them, and a run holding a jump's target
 * opens by itself. Fictional people, mocked backend.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

const AT = "2026-09-30T09:00:00.000Z";
const ME = person("61111111-1111-4111-8111-000000000001", "Зоя Яблокова", "zoya");
const ANNA = person("61111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const BORIS = person("61111111-1111-4111-8111-000000000003", "Борис Ильин", "boris");
const TEAM = "62222222-2222-4222-8222-000000000001";
const PRIVATE = "62222222-2222-4222-8222-000000000002";
const HIDDEN_ONE = "Первая реплика Бориса";
const HIDDEN_TWO = "Вторая реплика Бориса";
const AFTER = "Где отчёт?";
const LAST = "Последнее сообщение Анны";
const OLD_PRIVATE = "Старое сообщение из лички";

function at(minute: number): string {
  return new Date(Date.parse("2026-09-30T10:00:00.000Z") + minute * 60_000).toISOString();
}

async function boot(page: Page, options: { lastRead?: string | null } = {}) {
  const messages: Row[] = [
    message("63333333-3333-4333-8333-000000000001", TEAM, ANNA, "Привет всем", at(0)),
    message("63333333-3333-4333-8333-000000000002", TEAM, BORIS, HIDDEN_ONE, at(1)),
    message("63333333-3333-4333-8333-000000000003", TEAM, BORIS, HIDDEN_TWO, at(2)),
    message("63333333-3333-4333-8333-000000000004", TEAM, ANNA, AFTER, at(3)),
    // Enough after it that the folded run starts off the screen.
    ...Array.from({ length: 40 }, (_, index) =>
      message(`63333333-3333-4333-8333-${String(100 + index).padStart(12, "0")}`, TEAM, ANNA, `Строка ${index + 1}`, at(10 + index)),
    ),
    message("63333333-3333-4333-8333-000000000099", TEAM, ANNA, LAST, at(60)),
    message("63333333-3333-4333-8333-000000000005", PRIVATE, BORIS, OLD_PRIVATE, at(0)),
  ];
  await openFixture(page, {
    me: ME,
    people: [ANNA, BORIS],
    chats: [chat(TEAM, "group", "Команда", AT), chat(PRIVATE, "private", null, AT)],
    memberships: [
      membership(TEAM, ANNA, "owner", AT),
      membership(TEAM, ME, "member", options.lastRead ?? at(61)),
      membership(TEAM, BORIS, "member", AT),
      membership(PRIVATE, BORIS, "owner", AT),
      membership(PRIVATE, ME, "member", at(61)),
    ],
    messages,
    rpc: (name) => {
      if (name === "search_chat_messages" || name === "current_user_access_snapshot") return missingFunction(name);
      return undefined;
    },
  });
  await page.route("**/rest/v1/user_blocks*", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ blocked_id: BORIS.id, created_at: AT }]) });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item").first()).toBeVisible();
}

async function openTeam(page: Page) {
  await page.getByTestId("chat-list-item").filter({ hasText: "Команда" }).click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: LAST })).toBeVisible();
}

const bubble = (page: Page, text: string) => page.locator('[data-message-bubble="true"]').filter({ hasText: text });

test("a blocked person's messages in a server fold to one line, and open and close on demand", async ({ page }) => {
  await boot(page);
  await openTeam(page);
  const run = page.getByTestId("blocked-run");
  await expect(run).toHaveCount(1);
  await expect(page.getByTestId("blocked-run-label")).toHaveText("2 заблокированных сообщения");
  await expect(bubble(page, HIDDEN_ONE)).toHaveCount(0);
  await expect(bubble(page, HIDDEN_TWO)).toHaveCount(0);

  await page.getByTestId("blocked-run-toggle").click();
  await expect(bubble(page, HIDDEN_ONE)).toHaveCount(1);
  await expect(bubble(page, HIDDEN_TWO)).toHaveCount(1);
  await expect(page.getByTestId("blocked-run-toggle")).toHaveText("Скрыть");

  await page.getByTestId("blocked-run-toggle").click();
  await expect(bubble(page, HIDDEN_ONE)).toHaveCount(0);
});

test("a private chat with the same person folds nothing: what they wrote is the conversation", async ({ page }) => {
  await boot(page);
  await page.getByTestId("chat-list-item").filter({ hasText: "Борис Ильин" }).click();
  await expect(bubble(page, OLD_PRIVATE)).toBeVisible();
  await expect(page.getByTestId("blocked-run")).toHaveCount(0);
});

test("entering with unread messages lands on the first one from somebody not blocked", async ({ page }) => {
  // Read up to «Привет всем»: then two of Boris's, then Anna's question.
  await boot(page, { lastRead: at(0.5) });
  await page.getByTestId("chat-list-item").filter({ hasText: "Команда" }).click();
  const separator = page.getByTestId("first-unread-separator");
  await expect(separator).toHaveCount(1);
  await expect(separator).toBeInViewport();
  // The separator stands above Anna's question, not inside the folded run.
  const separatorBox = await separator.boundingBox();
  const questionBox = await bubble(page, AFTER).boundingBox();
  const runBox = await page.getByTestId("blocked-run").boundingBox();
  expect(separatorBox && questionBox && separatorBox.y < questionBox.y).toBe(true);
  expect(separatorBox && runBox && runBox.y < separatorBox.y).toBe(true);
});

test("a jump to a folded message opens the run and lands on that message", async ({ page }) => {
  await boot(page);
  await openTeam(page);
  await expect(page.getByTestId("blocked-run")).not.toBeInViewport();
  await page.evaluate(
    ({ chatId, messageId }) => {
      window.dispatchEvent(new CustomEvent("kub:chat-message-jump", { detail: { chatId, messageId } }));
    },
    { chatId: TEAM, messageId: "63333333-3333-4333-8333-000000000003" },
  );
  await expect(page.locator('[data-blocked-run][data-expanded="true"]')).toHaveCount(1);
  await expect(bubble(page, HIDDEN_TWO)).toBeInViewport();
  // No «not loaded» notice: the run stood in for the message it was folding.
  await expect(page.getByText("Сообщение пока не загружено.")).toHaveCount(0);
});
