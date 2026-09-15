import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  chat,
  membership,
  missingFunction,
  openFixture,
  person,
  type Row,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * F-6, the chat list: a refused read is not an empty account.
 *
 * `useChats` did not destructure `error` on its `chats` read, so a refusal left
 * «Чаты не найдены» on screen — a statement about this account, made out of a
 * question that never got an answer. The memberships read just above it had
 * already proved the person has chats.
 *
 * Two things are measured here that a unit test cannot reach:
 *
 *   1. the two new states are actually **drawn** — neither had ever been
 *      rendered, in any browser, before this file;
 *   2. the wrapper added around `ChatList` to hold them
 *      (`flex min-h-0 flex-1 flex-col`) has **not broken the list's scroller**.
 *      That was the one claim in the change reasoned from class names rather
 *      than measured, and `min-h-0` is exactly the property whose absence
 *      silently turns a flex child into a page-height column that never
 *      scrolls.
 *
 * **The `stale` state is not covered here, and deliberately not faked.** It
 * needs a second read to be refused after a first has succeeded, and nothing a
 * test can reach from the page triggers one: the realtime subscription is
 * mocked off and the resume gate wants a real visibility change. An assertion
 * written with `.or(...)` to cover both outcomes was drafted and thrown away —
 * it would have passed whatever the product did, which is the shape of test
 * this repository has been bitten by twice today. The state's transitions are
 * proved in `tests/unit/list-read-refusal.test.mts`; its rendering is not
 * proved anywhere, and that is stated rather than papered over.
 *
 * Everything is fictional and mocked. No production screen is rendered.
 */

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("65555555-5555-4555-8555-000000000001", "Зоя Яблокова", "zoya");

/** Enough conversations that the list must scroll at every release viewport. */
const MANY = 24;

function seed() {
  const chats: Row[] = [];
  const memberships: Row[] = [];
  for (let index = 0; index < MANY; index += 1) {
    const id = "66666666-6666-4666-8666-" + String(index + 1).padStart(12, "0");
    chats.push(chat(id, "group", `Группа ${index + 1}`, AT));
    memberships.push(membership(id, ME, "member", AT));
  }
  return { chats, memberships };
}

async function open(page: Page, options: { refuse?: "always" | "after-first" } = {}) {
  const { chats, memberships } = seed();
  await openFixture(page, {
    me: ME,
    chats,
    memberships,
    messages: [],
    rpc: (name) => {
      if (name === "profile_badges") return { body: [] };
      if (name === "search_chat_messages") return missingFunction(name);
      return undefined;
    },
  });

  if (options.refuse) {
    let served = 0;
    // Registered after `openFixture`, because Playwright tries the most recent
    // handler first and falls through for anything it does not take.
    await page.route("**/rest/v1/chats*", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      served += 1;
      if (options.refuse === "after-first" && served === 1) return route.fallback();
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "42501", message: "permission denied for table chats" }),
      });
    });
  }

  await page.goto("/", { waitUntil: "domcontentloaded" });
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
  return `output/list-refusal/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("a refused chat list says so, and offers to ask again", async ({ page }) => {
  await open(page, { refuse: "always" });
  const notice = page.getByTestId("chat-list-unavailable");
  await expect(notice).toBeVisible();
  // Measured, not predicted. The first version of this expected «Не удалось
  // загрузить чаты.» — the hook's own fallback — and the surface says
  // «Недостаточно прав для этого действия.», because `plainFailure` passes the
  // mapper's sentence through whenever it names something a person could act
  // on, and falls back only when it does not. The member list was measured to
  // the same answer on 2026-09-15 and its spec records the same correction, so
  // this is the product being consistent rather than two surfaces disagreeing.
  await expect(notice).toContainText("Недостаточно прав");
  await expect(notice.getByRole("button", { name: "Повторить" })).toBeVisible();

  // The sentence it replaced. «Чаты не найдены» is a claim about the account.
  await expect(page.getByText("Чаты не найдены")).toHaveCount(0);
});

test("the chat list still scrolls inside its new wrapper", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("chat-list-item").first()).toBeVisible();

  const scroller = page.locator('[data-testid="chat-list-item"]').first().locator(
    "xpath=ancestor::*[@data-chat-list-scroller or contains(@class,'overflow-y-auto')][1]",
  );
  const metrics = await scroller.evaluate((node) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    overflowY: getComputedStyle(node).overflowY,
  }));

  // The list must be taller than its box, or there is nothing to scroll and the
  // rest of this test would pass over a broken layout.
  expect(
    metrics.scrollHeight,
    "seed more conversations: the list is not taller than its container, so scrolling is untestable here",
  ).toBeGreaterThan(metrics.clientHeight + 40);
  expect(metrics.overflowY).toMatch(/auto|scroll/);

  // And it actually moves. `min-h-0` missing on the new wrapper would leave a
  // column the height of its content, which scrolls the page rather than the
  // list — scrollTop would stay at 0.
  await scroller.evaluate((node) => { node.scrollTop = 200; });
  const moved = await scroller.evaluate((node) => node.scrollTop);
  expect(moved, "the list did not move: its scroller is not the element that overflows").toBeGreaterThan(0);

  // The viewport itself must not have grown a scrollbar to accommodate it.
  const pageOverflows = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 1,
  );
  expect(pageOverflows, "the page scrolls instead of the list").toBe(false);
});

for (const theme of ["light", "dark"] as const) {
  test(`the refusal holds in the ${theme} theme`, async ({ page }, info) => {
    await open(page, { refuse: "always" });
    await expect(page.getByTestId("chat-list-unavailable")).toBeVisible();
    await setTheme(page, theme);
    await page.waitForTimeout(250);
    await page.screenshot({ path: shotPath(info, `chats-${theme}`), fullPage: false });
  });
}
