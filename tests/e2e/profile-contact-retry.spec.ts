import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURE_HOST,
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";

const ME = person("63111111-1111-4111-8111-000000000001", "Тестовый участник", "contact_reader");
const PEER = person("63111111-1111-4111-8111-000000000002", "Другой участник", "contact_peer");
const CHAT_ID = "63222222-2222-4222-8222-000000000001";
const AT = "2026-10-05T09:00:00.000Z";
const REFUSAL = { code: "XX000", message: "Fictional contact lookup unavailable", details: null, hint: null };
const savedRow = (): Row => ({ owner_user_id: ME.id, contact_user_id: PEER.id, alias: null, created_at: AT });

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

test.beforeEach(async ({ request }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  await requireFixtureServer(request);
});

test.beforeEach(async ({ page }) => {
  const mutant = process.env.KUB_CONTACT_RETRY_MUTANT;
  if (!mutant) return;
  const mutations: Record<string, [string, string]> = {
    "unknown-add": ["contact: contacts.list.isSuccess", "contact: true"],
    "retry-noop": ["contacts.list.refetch()", "undefined"],
    "retry-unlocked": ["loading: contacts.list.isFetching", "loading: false"],
    "stale-background-add": [
      "contact: contacts.list.isSuccess && !contacts.list.isFetching",
      "contact: contacts.list.isSuccess",
    ],
    "stale-error-copy": [
      'contacts.list.isFetching ? "Загрузка контактов…"',
      'contacts.list.isError ? "Не удалось загрузить контакты."',
    ],
  };
  expect(mutations[mutant], "unknown mutation must refuse").toBeTruthy();
  await page.route("**/src/components/profile/UserProfileOverlay.tsx*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const [before, after] = mutations[mutant];
    expect(source.split(before)).toHaveLength(2);
    await route.fulfill({ response, body: source.replace(before, after) });
  });
});

async function boot(page: Page, rest: Parameters<typeof openFixture>[1]["rest"], theme: "light" | "dark" = "dark") {
  return openFixture(page, {
    me: ME,
    people: [PEER],
    theme,
    chats: [chat(CHAT_ID, "group", "Проверка контактов", AT)],
    memberships: [membership(CHAT_ID, ME, "member", AT), membership(CHAT_ID, PEER, "admin", AT)],
    messages: [message("63555555-5555-4555-8555-000000000001", CHAT_ID, PEER, "Тестовый профиль", AT)],
    rest,
  });
}

async function openFullProfile(page: Page) {
  await openChat(page, "Проверка контактов", "Тестовый профиль");
  await page.getByTestId("message-author-avatar").first().click();
  const overlay = page.getByTestId("user-profile-overlay");
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    await expect(overlay).toHaveAttribute("data-profile-surface", "compact");
    await page.getByTestId("profile-open-full").click();
  }
  await expect(overlay).toHaveAttribute("data-profile-surface", "full");
  await expect(overlay).toContainText(PEER.full_name);
  await expect(overlay).toContainText("Администратор группы");
  await expect(overlay.getByTestId("member-card-role-give")).toHaveCount(0);
  return overlay;
}

function expectNoContactWrites(fixture: Fixture) {
  expect(fixture.restCalls("user_contacts").filter(({ method }) => method !== "GET")).toEqual([]);
  expect(fixture.restCalls("user_blocks").filter(({ method }) => method !== "GET")).toEqual([]);
  expect(fixture.restCalls("chat_members").filter(({ method }) => method !== "GET")).toEqual([]);
}

async function capture(page: Page, name: string) {
  if (process.env.KUB_CONTACT_RETRY_CAPTURE !== "1") return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), animations: "disabled" });
}

for (const theme of ["dark", "light"] as const) {
  for (const saved of [true, false]) {
    test(`failed lookup retries to a ${saved ? "saved" : "new"} contact (${theme})`, async ({ page }) => {
      let available = false;
      const contacts: Row[] = saved ? [savedRow()] : [];
      const fixture = await boot(page, ({ resource, method, body }) => {
        if (resource !== "user_contacts") return undefined;
        if (method === "GET") return available
          ? { status: 200, body: [...contacts] }
          : { status: 500, body: REFUSAL };
        if (method === "POST") {
          contacts.push({ ...(body as Row), alias: null, created_at: AT });
          return { status: 201, body: [] };
        }
        return undefined;
      }, theme);
      const overlay = await openFullProfile(page);
      await expect.poll(() => fixture.restCalls("user_contacts", "GET").length).toBe(1);
      await expect(overlay.getByTestId("member-card-add-contact")).toHaveCount(0);
      await expect(overlay.getByTestId("member-card-contact-saved")).toHaveCount(0);
      expectNoContactWrites(fixture);
      const failure = overlay.getByRole("alert");
      await expect(failure).toContainText("Не удалось загрузить контакты.");
      const retry = overlay.getByRole("button", { name: "Повторить" });
      await expect(retry).toBeVisible();
      if (saved) await capture(page, "lookup-error");

      // Hold the real query at its network boundary: the UI must keep the
      // unknown state and refuse repeated clicks until this request settles.
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let intercepted = 0;
      await page.route(`${FIXTURE_HOST}/rest/v1/user_contacts?**`, async (route) => {
        intercepted += 1;
        await held;
        await route.fallback();
      });
      try {
        await retry.click();
        await expect.poll(() => intercepted).toBe(1);
        await expect(retry).toBeDisabled();
        await expect(overlay.getByRole("status")).toContainText("Загрузка контактов…");
        await expect(failure).toHaveCount(0);
        await expect(overlay.getByTestId("member-card-add-contact")).toHaveCount(0);
        await expect(overlay.getByTestId("member-card-contact-saved")).toHaveCount(0);
        if (saved) await capture(page, "lookup-retrying");
        expectNoContactWrites(fixture);
        available = true;
      } finally {
        release();
      }

      const add = overlay.getByTestId("member-card-add-contact");
      const savedState = overlay.getByTestId("member-card-contact-saved");
      if (saved) {
        await expect(savedState).toHaveText("В контактах");
        await expect(add).toHaveCount(0);
      } else {
        await expect(add).toHaveText("Добавить в контакты");
        await expect(savedState).toHaveCount(0);
      }
      await expect(failure).toHaveCount(0);
      expect(fixture.restCalls("user_contacts", "GET")).toHaveLength(2);
      expect(intercepted).toBe(1);
      for (const call of fixture.restCalls("user_contacts", "GET")) {
        expect(new URLSearchParams(call.search).get("owner_user_id")).toBe(`eq.${ME.id}`);
      }
      expectNoContactWrites(fixture);
      await capture(page, saved ? "lookup-saved" : "lookup-new-contact");
      if (!saved) {
        await add.click();
        await expect(savedState).toHaveText("В контактах");
        expect(fixture.restCalls("user_contacts", "POST").map(({ body }) => body)).toEqual([
          { owner_user_id: ME.id, contact_user_id: PEER.id },
        ]);
        await expect(add).toHaveCount(0);
      }
    });
  }
}

test("a failed explicit retry stays unknown and can be retried again", async ({ page }) => {
  let reads = 0;
  const fixture = await boot(page, ({ resource, method }) => {
    if (resource !== "user_contacts" || method !== "GET") return undefined;
    reads += 1;
    return reads < 3 ? { status: 500, body: REFUSAL } : { status: 200, body: [savedRow()] };
  });
  const overlay = await openFullProfile(page);
  const retry = overlay.getByRole("button", { name: "Повторить" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => reads).toBe(2);
  await expect(retry).toBeEnabled();
  await expect(overlay.getByTestId("member-card-add-contact")).toHaveCount(0);
  await expect(overlay.getByTestId("member-card-contact-saved")).toHaveCount(0);
  expectNoContactWrites(fixture);
  await retry.click();
  await expect(overlay.getByTestId("member-card-contact-saved")).toHaveText("В контактах");
  await expect(overlay.getByRole("alert")).toHaveCount(0);
  expect(reads).toBe(3);
  expectNoContactWrites(fixture);
});

test("contact profile lookup failure is not an empty contact list", async ({ page }) => {
  let failProfiles = true;
  const fixture = await boot(page, ({ resource, method, search }) => {
    if (resource === "user_contacts" && method === "GET") return { status: 200, body: [savedRow()] };
    if (resource === "profiles" && method === "GET" && search?.includes("id=in.") && failProfiles) {
      return { status: 500, body: REFUSAL };
    }
    return undefined;
  });
  const overlay = await openFullProfile(page);
  const retry = overlay.getByRole("button", { name: "Повторить" });
  await expect(retry).toBeVisible();
  await expect(overlay.getByTestId("member-card-add-contact")).toHaveCount(0);
  await expect(overlay.getByTestId("member-card-contact-saved")).toHaveCount(0);
  failProfiles = false;
  await retry.click();
  await expect(overlay.getByTestId("member-card-contact-saved")).toHaveText("В контактах");
  await expect(overlay.getByRole("alert")).toHaveCount(0);
  expect(fixture.restCalls("user_contacts", "GET")).toHaveLength(2);
  expectNoContactWrites(fixture);
});

test("a stale cached non-contact stays unknown on failure and shows loading during retry", async ({ page }) => {
  let fail = false;
  let recovered = false;
  const fixture = await boot(page, ({ resource, method }) => {
    if (resource !== "user_contacts" || method !== "GET") return undefined;
    return fail ? { status: 500, body: REFUSAL } : { status: 200, body: recovered ? [savedRow()] : [] };
  });
  let overlay = await openFullProfile(page);
  await expect(overlay.getByTestId("member-card-add-contact")).toBeVisible();
  expectNoContactWrites(fixture);
  await page.getByTestId("user-profile-close").click();
  fail = true;
  await page.clock.setFixedTime(new Date((await page.evaluate(() => Date.now())) + 31_000));
  await page.getByTestId("message-author-avatar").first().click();
  if ((page.viewportSize()?.width ?? 0) >= 768) await page.getByTestId("profile-open-full").click();
  overlay = page.getByTestId("user-profile-overlay");
  await expect(overlay.getByRole("alert")).toContainText("Не удалось загрузить контакты.");
  await expect(overlay.getByTestId("member-card-add-contact")).toHaveCount(0);
  await expect(overlay.getByTestId("member-card-contact-saved")).toHaveCount(0);
  await capture(page, "lookup-cached-error");

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = 0;
  await page.route(`${FIXTURE_HOST}/rest/v1/user_contacts?**`, async (route) => {
    intercepted += 1;
    await held;
    await route.fallback();
  });
  try {
    const retry = overlay.getByRole("button", { name: "Повторить" });
    await retry.click();
    await expect.poll(() => intercepted).toBe(1);
    await expect(retry).toBeDisabled();
    await expect(overlay.getByRole("status")).toContainText("Загрузка контактов…");
    await expect(overlay.getByRole("alert")).toHaveCount(0);
    await expect(overlay.getByTestId("member-card-add-contact")).toHaveCount(0);
    await capture(page, "lookup-cached-retrying");
    expectNoContactWrites(fixture);
    recovered = true;
    fail = false;
  } finally {
    release();
  }
  await expect(overlay.getByTestId("member-card-contact-saved")).toHaveText("В контактах");
  await expect(overlay.getByRole("alert")).toHaveCount(0);
  expect(fixture.restCalls("user_contacts", "GET")).toHaveLength(3);
  expectNoContactWrites(fixture);
});

for (const saved of [false, true]) {
  test(`a stale cached ${saved ? "saved" : "new"} contact waits for a held background refresh`, async ({ page }) => {
    let refreshed = false;
    const fixture = await boot(page, ({ resource, method }) => {
      if (resource !== "user_contacts" || method !== "GET") return undefined;
      return { status: 200, body: (refreshed ? !saved : saved) ? [savedRow()] : [] };
    }, saved ? "light" : "dark");
    let overlay = await openFullProfile(page);
    await expect(overlay.getByTestId(saved ? "member-card-contact-saved" : "member-card-add-contact")).toBeVisible();
    await page.getByTestId("user-profile-close").click();
    await page.clock.setFixedTime(new Date((await page.evaluate(() => Date.now())) + 31_000));

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let intercepted = 0;
    await page.route(`${FIXTURE_HOST}/rest/v1/user_contacts?**`, async (route) => {
      intercepted += 1;
      await held;
      await route.fallback();
    });
    try {
      await page.getByTestId("message-author-avatar").first().click();
      if ((page.viewportSize()?.width ?? 0) >= 768) await page.getByTestId("profile-open-full").click();
      overlay = page.getByTestId("user-profile-overlay");
      await expect.poll(() => intercepted).toBe(1);
      await expect(overlay.getByTestId("member-card-add-contact")).toHaveCount(0);
      await expect(overlay.getByTestId("member-card-contact-saved")).toHaveCount(0);
      await expect(overlay.getByRole("status")).toContainText("Загрузка контактов…");
      await expect(overlay.getByRole("button", { name: "Повторить" })).toBeDisabled();
      await capture(page, "lookup-background-refresh");
      expectNoContactWrites(fixture);
      refreshed = true;
    } finally {
      release();
    }
    await expect(overlay.getByTestId(saved ? "member-card-add-contact" : "member-card-contact-saved")).toBeVisible();
    await expect(overlay.getByRole("status")).toHaveCount(0);
    expect(fixture.restCalls("user_contacts", "GET")).toHaveLength(2);
    expectNoContactWrites(fixture);
  });
}
