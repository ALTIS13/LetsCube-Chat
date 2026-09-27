import { devices, expect, test, type Page } from "@playwright/test";
import {
  FIXTURE_HOST,
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

const AT = "2026-09-27T09:00:00.000Z";
const OWNER = person("11111111-1111-4111-8111-0000000000a1", "Владелец группы");
const MEMBER = person("11111111-1111-4111-8111-0000000000a2", "Участник группы");
const CHAT_ID = "22222222-2222-4222-8222-0000000000b1";
const TOPIC_ID = "44444444-4444-4444-8444-0000000000d1";
const GROUP_NAME = "Тестовая группа";
const GENERAL_TEXT = "Общее сообщение тестовой группы";
const CHANNEL_TEXT = "Сообщение тестового канала";

function channelRest(topics: Row[], member: boolean) {
  return ({ resource, method, body }: { resource: string; method: string; body: unknown }) => {
    if (resource === "chat_channel_categories" || resource === "voice_channels" || resource === "voice_participants") {
      return { status: 200, body: [] };
    }
    if (resource !== "topics") return undefined;
    if (method === "GET") return { status: 200, body: topics };
    if (member) return { status: 403, body: { code: "42501", message: "permission denied" } };
    if (method === "POST") {
      const row = {
        id: TOPIC_ID,
        emoji: null,
        is_general: false,
        archived: false,
        created_at: AT,
        ...(body as Row),
      };
      topics.push(row);
      return { status: 201, body: row };
    }
    return { status: 200, body: [] };
  };
}

async function openChannelList(page: Page) {
  await expect.poll(async () =>
    (await page.getByTestId("channel-rail-trigger").count()) + (await page.getByTestId("channel-rail").count()),
  ).toBeGreaterThan(0);
  const trigger = page.getByTestId("channel-rail-trigger");
  if (await trigger.count()) {
    await trigger.click();
    await expect(page.getByTestId("channel-rail-sheet")).toBeVisible();
  } else {
    await expect(page.getByTestId("channel-rail")).toBeVisible();
  }
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("an ordinary member can open and read a text channel created in a non-forum group", async ({ page, browser }, testInfo) => {
  const topics: Row[] = [];
  const group = chat(CHAT_ID, "group", GROUP_NAME, AT);
  expect(group.is_forum).toBe(false);
  const memberships = [
    membership(CHAT_ID, OWNER, "owner", AT),
    membership(CHAT_ID, MEMBER, "member", AT),
  ];
  const general = message("66666666-6666-4666-8666-000000000001", CHAT_ID, OWNER, GENERAL_TEXT, AT);
  const ownerFixture = await openFixture(page, {
    me: OWNER,
    chats: [group],
    memberships,
    messages: [general],
    rest: channelRest(topics, false),
  });
  await openChat(page, GROUP_NAME, GENERAL_TEXT);
  await openChannelList(page);
  await page.getByTestId("channel-rail-manage").first().click();
  await page.getByTestId("channel-create-open").click();
  const form = page.getByTestId("channel-create-form");
  await expect(form.getByTestId("channel-create-kind-text")).toHaveAttribute("aria-checked", "true");
  await form.getByTestId("channel-create-name").fill("Планы");
  await form.getByTestId("channel-create-submit").click();
  await expect(page.getByTestId("channel-create-form")).toHaveCount(0);
  expect(ownerFixture.restCalls("topics", "POST")).toHaveLength(1);
  expect(ownerFixture.restCalls("topics", "POST")[0].body).toMatchObject({
    chat_id: CHAT_ID,
    name: "Планы",
  });
  expect(topics).toHaveLength(1);
  expect(topics[0]).toMatchObject({ id: TOPIC_ID, is_general: false, archived: false });

  const device = testInfo.project.name.startsWith("webkit")
    ? devices["iPhone 14 Pro"]
    : testInfo.project.name.includes("mobile")
      ? devices["Pixel 7"]
      : devices["Desktop Chrome"];
  const memberContext = await browser.newContext({ ...device, viewport: page.viewportSize() ?? device.viewport });
  const memberPage = await memberContext.newPage();
  const memberFixture = await openFixture(memberPage, {
    me: MEMBER,
    chats: [group],
    memberships,
    messages: [
      general,
      message("66666666-6666-4666-8666-000000000002", CHAT_ID, OWNER, CHANNEL_TEXT, AT, {
        topic_id: TOPIC_ID,
      }),
    ],
    rest: channelRest(topics, true),
  });
  await openChat(memberPage, GROUP_NAME, GENERAL_TEXT);
  await openChannelList(memberPage);
  const channel = memberPage.locator(`[data-testid="channel-rail-text"][data-channel-id="${TOPIC_ID}"]`);
  await expect(channel).toBeVisible();
  await expect(memberPage.getByTestId("channel-rail-manage")).toHaveCount(0);
  for (const theme of ["dark", "light"] as const) {
    await memberPage.evaluate((value) => {
      const root = document.documentElement;
      root.classList.toggle("dark", value === "dark");
      root.classList.toggle("light", value === "light");
      root.setAttribute("data-theme", value);
      root.style.colorScheme = value;
    }, theme);
    await memberPage.evaluate(() => document.fonts.ready);
    await memberPage.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );
    await memberPage.getByTestId("channel-rail-list").screenshot({
      path: `output/plain-group-text-channel/member-rail-${theme}-${testInfo.project.name}.png`,
    });
  }
  await channel.click();
  await openChannelList(memberPage);
  await expect(channel).toHaveAttribute("data-active", "true");
  await expect(memberPage.locator('[data-message-bubble="true"]').filter({ hasText: CHANNEL_TEXT })).toBeVisible();
  await expect(memberPage.locator('[data-message-bubble="true"]').filter({ hasText: GENERAL_TEXT })).toHaveCount(0);
  await expect.poll(() => memberFixture.restCalls("messages", "GET").some((call) =>
    call.search.includes(`topic_id=eq.${TOPIC_ID}`),
  )).toBe(true);

  await memberPage.locator('[data-testid="channel-rail-text"][data-channel-id="general"]').click();
  await expect(memberPage.locator('[data-message-bubble="true"]').filter({ hasText: GENERAL_TEXT })).toBeVisible();
  await expect(memberPage.locator('[data-message-bubble="true"]').filter({ hasText: CHANNEL_TEXT })).toHaveCount(0);
  expect(memberFixture.restCalls("topics", "POST")).toHaveLength(0);
  expect(memberFixture.restCalls("topics", "PATCH")).toHaveLength(0);
  expect(memberFixture.restCalls("topics", "DELETE")).toHaveLength(0);
  await memberContext.close();
});

test("a pending topics read never exposes another channel in the general conversation", async ({ page }) => {
  const topics: Row[] = [{
    id: TOPIC_ID,
    chat_id: CHAT_ID,
    name: "Планы",
    emoji: null,
    is_general: false,
    archived: false,
    position: 0,
    category_id: null,
    created_at: AT,
  }];
  const fixture = await openFixture(page, {
    me: MEMBER,
    chats: [chat(CHAT_ID, "group", GROUP_NAME, AT)],
    memberships: [membership(CHAT_ID, MEMBER, "member", AT)],
    messages: [
      message("66666666-6666-4666-8666-000000000001", CHAT_ID, MEMBER, GENERAL_TEXT, AT),
      message("66666666-6666-4666-8666-000000000002", CHAT_ID, MEMBER, CHANNEL_TEXT, AT, {
        topic_id: TOPIC_ID,
      }),
    ],
    rest: channelRest(topics, true),
  });
  let releaseTopics = () => undefined;
  const heldTopics = new Promise<void>((resolve) => { releaseTopics = resolve; });
  let topicsRequested = false;
  await page.route(
    (url) => url.origin === FIXTURE_HOST && url.pathname === "/rest/v1/topics",
    async (route) => {
      topicsRequested = true;
      await heldTopics;
      await route.fallback();
    },
  );

  try {
    await openChat(page, GROUP_NAME, GENERAL_TEXT);
    await expect.poll(() => topicsRequested).toBe(true);
    const history = () => fixture.restCalls("messages", "GET").filter((call) =>
      new URLSearchParams(call.search).get("order")?.includes("id.desc"),
    );
    await expect.poll(() => history().length).toBeGreaterThan(0);
    await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: CHANNEL_TEXT })).toHaveCount(0);
    expect(history().every((call) => new URLSearchParams(call.search).get("topic_id") === "is.null")).toBe(true);
  } finally {
    releaseTopics();
  }

  await openChannelList(page);
  const channel = page.locator(`[data-testid="channel-rail-text"][data-channel-id="${TOPIC_ID}"]`);
  await expect(channel).toBeVisible();
  await channel.click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: CHANNEL_TEXT })).toBeVisible();
});

test("group settings call out forum mode separately from working text channels", async ({ page }, testInfo) => {
  const topics: Row[] = [{
    id: TOPIC_ID,
    chat_id: CHAT_ID,
    name: "Планы",
    emoji: null,
    is_general: false,
    archived: false,
    position: 0,
    category_id: null,
    created_at: AT,
  }];
  await openFixture(page, {
    me: OWNER,
    chats: [chat(CHAT_ID, "group", GROUP_NAME, AT)],
    memberships: [membership(CHAT_ID, OWNER, "owner", AT)],
    messages: [message("66666666-6666-4666-8666-000000000001", CHAT_ID, OWNER, GENERAL_TEXT, AT)],
    rest: channelRest(topics, false),
  });
  await openChat(page, GROUP_NAME, GENERAL_TEXT);
  await expect.poll(async () =>
    (await page.getByTestId("channel-rail-trigger").count()) + (await page.getByTestId("channel-rail").count()),
  ).toBeGreaterThan(0);
  await page.getByTestId("chat-header-info-button").click();
  await page.getByLabel("Редактировать").click();
  await expect(page.getByTestId("chat-info-settings-view")).toHaveAttribute("data-state", "current");
  await expect(page.getByTestId("chat-settings-row-channels")).toContainText("Каналы");
  const mode = page.getByTestId("chat-settings-row-topics");
  await expect(mode).toContainText("Режим топиков");
  await expect(mode).toHaveAttribute("data-settings-value", "Выключен");

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      const root = document.documentElement;
      root.classList.toggle("dark", value === "dark");
      root.classList.toggle("light", value === "light");
      root.setAttribute("data-theme", value);
      root.style.colorScheme = value;
    }, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
    const fits = await mode.evaluate((element) =>
      Array.from(element.querySelectorAll("span")).every((span) => span.scrollWidth <= span.clientWidth),
    );
    expect(fits).toBe(true);
    await mode.screenshot({ path: testInfo.outputPath(`forum-mode-${theme}.png`) });
  }
});

test("a refused topics read is visible to a member of an ordinary group", async ({ page }) => {
  const rest = channelRest([], true);
  const fixture = await openFixture(page, {
    me: MEMBER,
    chats: [chat(CHAT_ID, "group", GROUP_NAME, AT)],
    memberships: [membership(CHAT_ID, MEMBER, "member", AT)],
    messages: [message("66666666-6666-4666-8666-000000000001", CHAT_ID, MEMBER, GENERAL_TEXT, AT)],
    rest: (call) => call.resource === "topics" && call.method === "GET"
      ? { status: 403, body: { code: "42501", message: "permission denied" } }
      : rest(call),
  });
  await openChat(page, GROUP_NAME, GENERAL_TEXT);
  await openChannelList(page);
  await expect(page.getByTestId("channel-rail-unreadable")).toContainText("Не удалось загрузить каналы.");
  await expect(page.getByTestId("channel-rail-retry")).toBeVisible();
  await expect(page.getByTestId("channel-rail-manage")).toHaveCount(0);
  expect(fixture.restCalls("topics", "GET")).toHaveLength(1);
  expect(fixture.restCalls("topics", "POST")).toHaveLength(0);
});

test("a plain group without active text channels keeps its legacy conversation", async ({ page }) => {
  const fixture = await openFixture(page, {
    me: MEMBER,
    chats: [chat(CHAT_ID, "group", GROUP_NAME, AT)],
    memberships: [membership(CHAT_ID, MEMBER, "member", AT)],
    messages: [
      message("66666666-6666-4666-8666-000000000001", CHAT_ID, MEMBER, GENERAL_TEXT, AT),
      message("66666666-6666-4666-8666-000000000002", CHAT_ID, MEMBER, CHANNEL_TEXT, AT, {
        topic_id: TOPIC_ID,
      }),
    ],
    rest: channelRest([], true),
  });
  await openChat(page, GROUP_NAME, GENERAL_TEXT);
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: CHANNEL_TEXT })).toBeVisible();
  await expect(page.getByTestId("channel-rail-trigger")).toHaveCount(0);
  await expect(page.getByTestId("channel-rail")).toHaveCount(0);
  expect(fixture.restCalls("topics", "GET")).toHaveLength(1);
  const history = () => fixture.restCalls("messages", "GET").filter((call) =>
    new URLSearchParams(call.search).get("order")?.includes("id.desc"),
  );
  await expect.poll(() => history().some((call) => !new URLSearchParams(call.search).has("topic_id"))).toBe(true);
});

test("a non-forum private chat does not wait for topics or acquire a topic filter", async ({ page }) => {
  const fixture = await openFixture(page, {
    me: MEMBER,
    chats: [chat(CHAT_ID, "private", null, AT)],
    memberships: [
      membership(CHAT_ID, MEMBER, "member", AT),
      membership(CHAT_ID, OWNER, "member", AT),
    ],
    messages: [
      message("66666666-6666-4666-8666-000000000001", CHAT_ID, MEMBER, GENERAL_TEXT, AT),
      message("66666666-6666-4666-8666-000000000002", CHAT_ID, MEMBER, CHANNEL_TEXT, AT, {
        topic_id: TOPIC_ID,
      }),
    ],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-list-item").first().click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: GENERAL_TEXT })).toBeVisible();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: CHANNEL_TEXT })).toBeVisible();
  expect(fixture.restCalls("topics", "GET")).toHaveLength(0);
  const history = fixture.restCalls("messages", "GET").filter((call) =>
    new URLSearchParams(call.search).get("order")?.includes("id.desc"),
  );
  expect(history.length).toBeGreaterThan(0);
  expect(history.every((call) => !new URLSearchParams(call.search).has("topic_id"))).toBe(true);
});
