import { expect, test } from "@playwright/test";
import { openBotSettings, openBotTab } from "./helpers/botSettingsFixture";
import { openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

// Fictional states missed by the initial D-341 copy audit. Never use live data.
test.use({ screenshot: "off", trace: "off", video: "off" });
test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
  const client = await request.get("/src/lib/botManagement.ts").then(response => response.text());
  expect(client, "bot management must also use the fictional loopback origin").toContain("http://127.0.0.1:54322");
});

for (const theme of ["light", "dark"] as const) {
  test(`an invitation names a group before joining, ${theme}`, async ({ page }, info) => {
    const fixture = await openFixture(page, {
      me: person("d3410000-0000-4000-8000-000000000001", "Зоя Яблокова", "zoya"),
      chats: [], memberships: [], messages: [], theme,
      rpc: name => name === "chat_invite_link_preview" ? { body: [{
        state: "ok", chat_id: "d3410000-0000-4000-8000-000000000002",
        name: "Команда проекта", avatar_url: null, member_count: 3,
      }] } : undefined,
    });
    await page.goto("/join/AbCdEfGhIjKlMnOpQrStU_");
    await expect(page.getByTestId("join-name")).toHaveText("Команда проекта");
    await expect(page.getByTestId("join-button")).toHaveText("Присоединиться к группе");
    expect(fixture.rpcBodies("chat_invite_link_join")).toHaveLength(0);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `output/group-vocabulary/join-${theme}-${info.project.name}.png` });
  });

  test(`a bot outside any group has an accurate empty state, ${theme}`, async ({ page }, info) => {
    await openBotSettings(page, { theme, privacy: "empty" });
    await openBotTab(page, "API");
    const section = page.getByRole("region", { name: "Приватность в группах", exact: true });
    await expect(section).toHaveCount(1);
    await expect(section.getByText("Бот не добавлен в группы", { exact: true })).toBeVisible();
    await expect(section).not.toContainText(/сервер/i);
    await section.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await section.screenshot({ path: `output/group-vocabulary/bot-empty-${theme}-${info.project.name}.png` });
  });
}
