import { expect, test, type Page, type Route } from "@playwright/test";
import {
  chat, membership, message, openChat, openDesktopMenu, openFixture, openPhoneMenu,
  person, requireFixtureServer, type Row,
} from "./helpers/messageActionsFixture";
import { RealtimeFixture } from "./helpers/realtime-fixture";

const AT = "2026-09-01T09:00:00.000Z";
const ME = person("a6000000-0000-4000-8000-000000000001", "Автор проверки");
const PEER = person("a6000000-0000-4000-8000-000000000002", "Участник проверки");
const CHANNEL = "a6000000-0000-4000-8000-000000000003";
const SECOND = "a6000000-0000-4000-8000-000000000004";
const GROUP = "a6000000-0000-4000-8000-000000000005";
const DM = "a6000000-0000-4000-8000-000000000006";
const POST = "План публикаций на неделю";
const GROUP_POST = "Материал для пересылки";
const CHANNEL_NAME = "Новости команды";
const SECOND_NAME = "Объявления проекта";
const GROUP_NAME = "Рабочая группа";

const composer = (page: Page) => page.getByTestId("chat-composer-dock");
const input = (page: Page) => composer(page).getByPlaceholder("Сообщение…");
const state = (page: Page) => composer(page).getByTestId("broadcast-publication-state");
const reply = (route: Route, body: unknown, status = 200) => route.fulfill({ json: body, status });
const own = (chatId: string, role: string) => ({ chat_id: chatId, user_id: ME.id, role });

const mutations = {
  "reader-publisher": [
    'return role === "owner" || role === "admin" ? "publisher" : "read-only";',
    'return role === "owner" || role === "admin" || role === "member" ? "publisher" : "read-only";',
  ],
  "keep-stale-publisher": ['update("checking");', "void 0;"],
} as const;

async function fixture(page: Page, theme: "light" | "dark") {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => { pageErrors.push(error.name); });
  const realtime = new RealtimeFixture();
  const backend = await openFixture(page, {
    theme,
    me: ME,
    people: [PEER],
    chats: [
      chat(CHANNEL, "channel", CHANNEL_NAME, AT),
      chat(SECOND, "channel", SECOND_NAME, AT),
      chat(GROUP, "group", GROUP_NAME, AT),
      chat(DM, "private", null, AT),
    ],
    memberships: [
      membership(CHANNEL, ME, "admin", AT),
      membership(SECOND, ME, "owner", AT),
      membership(GROUP, ME, "member", AT),
      membership(DM, ME, "member", AT),
      ...[CHANNEL, SECOND, GROUP, DM].map((id) => membership(id, PEER, "member", AT)),
    ],
    messages: [
      message("a6000000-0000-4000-8000-000000000010", CHANNEL, PEER, POST, AT),
      message("a6000000-0000-4000-8000-000000000011", GROUP, PEER, GROUP_POST, AT),
    ],
  });
  await realtime.install(page);
  const mutant = process.env.LETSCUBE_TASK6_MUTATION;
  const mutation = mutant ? mutations[mutant as keyof typeof mutations] : undefined;
  if (mutant) expect(mutation, "known broadcast test mutation").toBeDefined();
  let applied = 0;
  if (mutation) {
    await page.route((url) => url.origin === new URL(process.env.KUB_BASE_URL ?? "http://127.0.0.1:5173").origin &&
      url.pathname === "/src/hooks/useBroadcastPublication.ts", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      expect(source.split(mutation[0])).toHaveLength(2);
      applied += 1;
      await route.fulfill({ response, body: source.replace(mutation[0], mutation[1]) });
    });
  }
  const reads: Route[] = [];
  await page.route((url) => url.pathname === "/rest/v1/chat_members" &&
    url.searchParams.get("select") === "chat_id,user_id,role", (route) => { reads.push(route); });
  async function read(index: number, ...ids: string[]) {
    await expect.poll(() => reads.length).toBeGreaterThan(index);
    const route = reads[index];
    const params = new URL(route.request().url()).searchParams;
    expect(route.request().method()).toBe("GET");
    expect(params.get("user_id")).toBe(`eq.${ME.id}`);
    expect(params.get("chat_id")).toBe(`in.(${ids.slice().sort().join(",")})`);
    return route;
  }
  const roleChanged = (id: string, role: string) => {
    expect(realtime.emit({ type: "UPDATE", table: "chat_members",
      record: { ...membership(id, ME, role, AT), profile: undefined } })).toBeGreaterThan(0);
  };
  return { backend, read, reads, realtime, roleChanged, pageErrors, checkMutation: () => {
    if (mutation) expect(applied, "compiled hook mutation applied").toBeGreaterThan(0);
  } };
}

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });
test.beforeEach(async ({ request }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  await requireFixtureServer(request);
});

for (const theme of ["light", "dark"] as const) {
  test(`broadcast composer waits for membership and retires stale publication controls (${theme})`, async ({ page }, info) => {
    const f = await fixture(page, theme);
    await openChat(page, CHANNEL_NAME, POST);
    f.checkMutation();
    await expect(input(page), "cached admin must not render a composer").toHaveCount(0, { timeout: 1500 });
    await expect(state(page)).toHaveText("Проверяем право публикации…");
    await reply(await f.read(0, CHANNEL), [own(CHANNEL, "admin")]);
    await expect(input(page)).toBeVisible();
    await input(page).fill("Неотправленный черновик");

    // Begin a recovery read, then overtake it with a role change while the
    // original request is still held by the fixture.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    const older = await f.read(1, CHANNEL);
    await expect(input(page), "pending revalidation must retire the old publisher")
      .toHaveCount(0, { timeout: 1500 });
    f.roleChanged(CHANNEL, "member");
    await reply(await f.read(2, CHANNEL), [own(CHANNEL, "member")]);
    await expect(state(page)).toHaveText("Только чтение");
    await reply(older, [own(CHANNEL, "admin")]).catch(() => undefined);
    await expect(input(page)).toHaveCount(0);
    await expect(page.getByTestId("message-scroll-container").getByText(POST, { exact: true })).toBeVisible();
    if (process.env.LETSCUBE_TASK6_CAPTURE === "1") {
      await page.screenshot({ path: info.outputPath("broadcast-reader.png") });
    }

    f.roleChanged(CHANNEL, "owner");
    await reply(await f.read(3, CHANNEL), [own(CHANNEL, "owner")]);
    await expect(input(page)).toHaveValue("Неотправленный черновик");
    await f.realtime.goDark();
    await expect(input(page)).toHaveCount(0);
    await expect(state(page)).toContainText("Не удалось проверить право публикации");
    f.realtime.restore();
    await reply(await f.read(4, CHANNEL), []);
    await expect(state(page)).toHaveText("Только чтение");
    f.roleChanged(CHANNEL, "admin");
    await reply(await f.read(5, CHANNEL), [{ ...own(CHANNEL, "owner"), user_id: PEER.id }]);
    await expect(state(page)).toHaveText("Не удалось проверить право публикации.");
    await expect(input(page)).toHaveCount(0);
    if (process.env.LETSCUBE_TASK6_CAPTURE === "1") {
      await composer(page).screenshot({ path: info.outputPath("broadcast-retry.png") });
    }
    await composer(page).getByRole("button", { name: "Повторить" }).click();
    await reply(await f.read(6, CHANNEL), [own(CHANNEL, "admin")]);
    await expect(input(page)).toHaveValue("Неотправленный черновик");
    expect(f.backend.restCalls("messages", "POST")).toHaveLength(0);
    expect(f.pageErrors).toEqual([]);
  });

  test(`forward picker admits only verified broadcast publishers without changing other destinations (${theme})`, async ({ page, isMobile }, info) => {
    const f = await fixture(page, theme);
    const bubble = await openChat(page, GROUP_NAME, GROUP_POST);
    f.checkMutation();
    await expect(input(page)).toBeVisible();
    expect(f.reads).toHaveLength(0);
    const menu = isMobile ? await openPhoneMenu(page, bubble) : await openDesktopMenu(page, bubble);
    await menu.getByRole("menuitem", { name: "Переслать", exact: true }).click();
    const picker = page.getByRole("dialog").filter({ hasText: "Переслать в…" });
    const first = picker.getByRole("button", { name: CHANNEL_NAME });
    const second = picker.getByRole("button", { name: SECOND_NAME });
    await expect(picker.getByRole("button", { name: GROUP_NAME })).toBeVisible();
    await expect(picker.getByRole("button", { name: PEER.full_name })).toBeVisible();
    await expect(first, "cached admin must not be an available forward target").toHaveCount(0, { timeout: 1500 });
    await expect(second).toHaveCount(0);
    await expect(picker.getByRole("status")).toHaveText("Проверяем права каналов…");
    if (process.env.LETSCUBE_TASK6_CAPTURE === "1") {
      await picker.screenshot({ path: info.outputPath("broadcast-forward-loading.png") });
    }
    await reply(await f.read(0, CHANNEL, SECOND), [own(CHANNEL, "admin"), own(SECOND, "owner")]);
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    f.roleChanged(CHANNEL, "member");
    const refreshing = await f.read(1, CHANNEL, SECOND);
    await expect(first).toHaveCount(0);
    await reply(refreshing, [own(CHANNEL, "member"), own(SECOND, "owner")]);
    await expect(second).toBeVisible();
    await expect(first).toHaveCount(0);
    if (process.env.LETSCUBE_TASK6_CAPTURE === "1") {
      await page.screenshot({ path: info.outputPath("broadcast-forward-picker.png") });
    }
    await second.click();
    await expect(picker).toHaveCount(0);
    await expect(input(page)).toHaveCount(0);
    await reply(await f.read(2, SECOND), [own(SECOND, "member")]);
    await expect(state(page)).toContainText("Только чтение");
    await composer(page).getByRole("button", { name: "Отменить пересылку" }).click();
    await expect(state(page)).toHaveText("Только чтение");
    expect(f.backend.rpcBodies("forward_message")).toHaveLength(0);
    expect(f.backend.restCalls("messages", "POST")).toHaveLength(0);
    expect(f.pageErrors).toEqual([]);
  });
}
