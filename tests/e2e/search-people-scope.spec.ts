import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * 2026-09-30, a tester using the product for work: «когда пользуешься поиском
 * там мало людей и постоянно мелькает «…»… Мы можем не показывать всех
 * пользователей, а только тех кого ищем». The server's people search matches
 * any name that contains the letters typed, from the second letter; the
 * search now shows, as Telegram does, somebody the reader already has by the
 * start of a word of their name, and anybody else only by the start of their
 * handle (`lib/peopleSearchScope.ts`).
 *
 * The server's answer is mocked to be what it is today: everybody whose name or
 * handle contains the query. Everyone here is fictional.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

const AT = "2026-09-30T09:00:00.000Z";
const ME = person("d1111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("d1111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const STRANGER = person("d1111111-1111-4111-8111-000000000003", "Анатолий Незнакомов", "tolik_n");
const CHAT = "d2222222-2222-4222-8222-000000000001";

function userRow(profile: typeof ANNA) {
  return {
    result_type: "user",
    id: profile.id,
    title: profile.full_name,
    subtitle: profile.username ? `@${profile.username}` : "Профиль",
    snippet: null,
    avatar_url: null,
    chat_id: null,
    message_id: null,
    task_id: null,
    location_id: null,
    created_at: AT,
    rank: 0.5,
  };
}

async function boot(page: Page) {
  await openFixture(page, {
    me: ME,
    people: [ANNA, STRANGER],
    chats: [chat(CHAT, "private", null, AT)],
    memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT)],
    messages: [message("d3333333-3333-4333-8333-000000000001", CHAT, ANNA, "Подпишешь акт?", AT)],
    rpc: (name, body) => {
      if (name !== "global_search_v2") return undefined;
      // Today's server: a name or a handle that contains the query anywhere.
      const needle = String(body.p_query ?? "").toLowerCase().replace(/^@+/, "");
      const found = [ANNA, STRANGER].filter((profile) =>
        profile.full_name.toLowerCase().includes(needle) || (profile.username ?? "").toLowerCase().includes(needle),
      );
      return { body: found.map(userRow) };
    },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(1);
}

async function search(page: Page, query: string) {
  const field = page.getByTestId("sidebar-search-input");
  await field.click();
  await field.fill(query);
  await expect(page.getByTestId("sidebar-global-search-results")).toBeVisible();
  // The request is debounced; wait for the answer to be drawn, whatever it holds.
  await page.waitForTimeout(700);
}

const people = (page: Page) => page.getByTestId("sidebar-search-result-user");

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("two letters find the person the reader has, and not a stranger whose name holds them", async ({ page }) => {
  await boot(page);
  await search(page, "ан");
  await expect(people(page).filter({ hasText: "Анна Смирнова" })).toHaveCount(1);
  await expect(people(page).filter({ hasText: "Анатолий Незнакомов" }), "a stranger is not found by his displayed name").toHaveCount(0);
});

test("a stranger is found by the start of his handle", async ({ page }) => {
  await boot(page);
  await search(page, "@tol");
  await expect(people(page).filter({ hasText: "Анатолий Незнакомов" })).toHaveCount(1);
});

test("a stranger's whole displayed name still does not find him", async ({ page }) => {
  await boot(page);
  await search(page, "Анатолий");
  await expect(people(page)).toHaveCount(0);
});
