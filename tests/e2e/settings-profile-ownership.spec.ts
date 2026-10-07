import { expect, test } from "@playwright/test";
import { FIXTURE_HOST, openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const A = person("64111111-1111-4111-8111-000000000071", "Проверка профиля", "profile_qa");

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });
test.beforeEach(async ({ request }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  await requireFixtureServer(request);
});

test("a held Settings profile response cannot restore a signed-out account", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  await openFixture(page, { me: A, people: [], chats: [], memberships: [], messages: [] });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  let completed = 0;
  await page.route(url => url.origin === FIXTURE_HOST && url.pathname === "/rest/v1/profiles", async route => {
    if (route.request().method() !== "PATCH") return route.fallback();
    expect(new URL(route.request().url()).searchParams.get("id")).toBe(`eq.${A.id}`);
    writes++;
    await gate;
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ...A, full_name: "Обновлённый профиль проверки" }) });
    completed++;
  });
  const ownership = () => page.evaluate(async () => {
    const { useAppStore } = await import("/src/store/app.store.ts" /* @vite-ignore */);
    const state = useAppStore.getState();
    return { epoch: state.accountEpoch, userId: state.currentUser?.id ?? null,
      authUserId: state.authSessionIdentity?.userId ?? null };
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("notification-bell-button")).toBeVisible();
    const first = await ownership();
    expect(first.userId).toBe(A.id);
    await page.evaluate(async () => {
      const { useAppStore } = await import("/src/store/app.store.ts" /* @vite-ignore */);
      useAppStore.getState().openSettings();
    });
    await page.getByTestId("settings-field-name").fill("Обновлённый профиль проверки");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    await page.evaluate(async () => {
      const { createClient } = await import("/src/lib/supabase/client.ts" /* @vite-ignore */);
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw Error("synthetic sign-out was not accepted by fixture");
    });
    await expect.poll(ownership).toEqual({ epoch: first.epoch + 1, userId: null, authUserId: null });
    release();
    await expect.poll(() => completed).toBe(1);
    await expect.poll(ownership).toEqual({ epoch: first.epoch + 1, userId: null, authUserId: null });
    expect(errors).toEqual([]);
  } finally { release(); }
});

test("a held profile save cannot restore an avatar removed through Settings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  await openFixture(page, { me: A, people: [], chats: [], memberships: [], messages: [] });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let saves = 0;
  let removals = 0;
  let completed = 0;
  await page.route(url => url.origin === FIXTURE_HOST && url.pathname === "/rest/v1/profiles", async route => {
    if (route.request().method() !== "PATCH") return route.fallback();
    expect(new URL(route.request().url()).searchParams.get("id")).toBe(`eq.${A.id}`);
    const body = route.request().postDataJSON();
    if (Object.hasOwn(body, "avatar_url")) {
      expect(body.avatar_url).toBeNull();
      removals++;
      return route.fulfill({ status: 204 });
    }
    saves++;
    await gate;
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ...A, full_name: "Имя после сохранения", avatar_url: "profile-qa.png" }) });
    completed++;
  });
  const profile = () => page.evaluate(async () => {
    const { useAppStore } = await import("/src/store/app.store.ts" /* @vite-ignore */);
    const state = useAppStore.getState();
    return { epoch: state.accountEpoch, userId: state.currentUser?.id ?? null,
      name: state.currentUser?.full_name, avatar: state.currentUser?.avatar_url };
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("notification-bell-button")).toBeVisible();
    await page.evaluate(async () => {
      const { useAppStore } = await import("/src/store/app.store.ts" /* @vite-ignore */);
      const state = useAppStore.getState();
      if (!state.currentUser) throw Error("fictional account did not mount");
      state.setCurrentUser({ ...state.currentUser, avatar_url: "profile-qa.png" }, state.accountEpoch);
      useAppStore.getState().openSettings();
    });
    const first = await profile();
    expect(first.avatar).toBe("profile-qa.png");
    await page.getByTestId("settings-field-name").fill("Имя после сохранения");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect.poll(() => saves).toBe(1);
    await page.getByRole("button", { name: "Удалить фото", exact: true }).click();
    await page.getByRole("dialog", { name: "Удалить фото профиля?" })
      .getByRole("button", { name: "Удалить фото", exact: true }).click();
    await expect.poll(() => removals).toBe(1);
    await expect.poll(async () => (await profile()).avatar).toBeNull();
    release();
    await expect.poll(() => completed).toBe(1);
    await expect.poll(profile).toEqual({ epoch: first.epoch, userId: A.id,
      name: "Имя после сохранения", avatar: null });
    expect(errors).toEqual([]);
  } finally { release(); }
});
