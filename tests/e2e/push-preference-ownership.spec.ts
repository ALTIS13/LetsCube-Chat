import { expect, test } from "@playwright/test";
import { FIXTURE_HOST, openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const A = person("64111111-1111-4111-8111-000000000031", "Первый участник проверки", "push_first");
const B = person("64111111-1111-4111-8111-000000000032", "Второй участник проверки", "push_second");
const OLD = { push_enabled: false, message_push_enabled: false, task_push_enabled: true, invite_push_enabled: true };
const CURRENT = { push_enabled: false, message_push_enabled: true, task_push_enabled: false, invite_push_enabled: false };

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });
test.beforeEach(async ({ request }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  await requireFixtureServer(request);
});

test("held previous-owner preferences cannot change a mounted Settings screen or its next write", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  await openFixture(page, { me: A, people: [B], chats: [], memberships: [], messages: [] });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  let completed = 0;
  const writes: Record<string, unknown>[] = [];
  await page.route(url => url.origin === FIXTURE_HOST && url.pathname === "/rest/v1/notification_preferences", async route => {
    if (route.request().method() === "GET") {
      const firstOwner = new URL(route.request().url()).searchParams.get("user_id") === `eq.${A.id}`;
      if (firstOwner) { reads++; await gate; }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(firstOwner ? OLD : CURRENT) });
      if (firstOwner) completed++;
    } else {
      writes.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: "application/json", body: "null" });
    }
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("notification-bell-button")).toBeVisible();
    await page.evaluate(async () => {
      const { useAppStore } = await import("/src/store/app.store.ts" /* @vite-ignore */);
      useAppStore.getState().openSettings();
    });
    await expect.poll(() => reads).toBeGreaterThan(0);
    const switches = {
      messages: page.getByRole("switch", { name: "Push: Сообщения", exact: true }),
      tasks: page.getByRole("switch", { name: "Push: Задачи", exact: true }),
      invites: page.getByRole("switch", { name: "Push: Приглашения", exact: true }),
    };
    await expect(switches.messages).toBeVisible();
    await page.evaluate(async owner => {
      const { useAppStore } = await import("/src/store/app.store.ts" /* @vite-ignore */);
      useAppStore.getState().setAuthSessionIdentity({ userId: owner.id, sessionId: null });
      useAppStore.getState().setCurrentUser(owner);
    }, B);
    await expect(switches.messages).toBeChecked();
    await expect(switches.tasks).not.toBeChecked();
    await expect(switches.invites).not.toBeChecked();
    await expect(switches.messages).toBeEnabled();
    const held = reads;
    release();
    await expect.poll(() => completed).toBe(held);
    await expect(switches.messages).toBeChecked();
    await expect(switches.tasks).not.toBeChecked();
    await switches.messages.click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ user_id: B.id, push_enabled: false,
      message_push_enabled: false, task_push_enabled: false, invite_push_enabled: false });
    expect(errors).toEqual([]);
  } finally { release(); }
});
