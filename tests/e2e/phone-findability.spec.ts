import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const ME = person("11111111-1111-4111-8111-000000000001", "Анна Смирнова", "anna");
const initial = () => ({ user_id: ME.id, presence_visible: true, forward_origin_visible: false,
  manual_status: "online", manual_status_until: null, phone_findable_by: "contacts" });

async function open(page: Page, theme: string, failedRead = false) {
  const fixture = await openFixture(page, { me: ME, chats: [], memberships: [], messages: [] });
  let row = initial();
  let fail = failedRead;
  const writes: Array<{ method: string; body: Record<string, unknown>; prefer: string }> = [];
  await page.route("**/rest/v1/privacy_preferences?**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return route.fulfill({ status: fail ? 503 : 200, contentType: "application/json",
        body: JSON.stringify(fail ? { message: "offline" } : row) });
    }
    const body = request.postDataJSON();
    writes.push({ method: request.method(), body, prefer: request.headers().prefer ?? "" });
    if (request.method() === "PATCH") row = { ...row, ...body };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user_id: ME.id }) });
  });
  await page.route("**/rest/v1/profile_contacts?**", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ phone_verified: true }) }));
  await page.addInitScript((value) => localStorage.setItem("kub-theme", value), theme);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.getByRole("button", { name: "Меню" }).first().click();
    await page.getByRole("button", { name: "Настройки", exact: true }).first().click();
  } else {
    await page.getByTestId("side-menu-button").click();
    await page.getByTestId("side-menu-layer").getByRole("button", { name: "Настройки", exact: true }).click();
  }
  await page.getByTestId("settings-open-phone-search").click();
  await expect(page.getByTestId("phone-search-setting")).toBeVisible();
  return { fixture, writes, get: () => row, elsewhere: () => { row = { ...row, forward_origin_visible: true, manual_status: "invisible" }; },
    recover: () => { fail = false; } };
}

test.beforeEach(async ({ request }) => { await requireFixtureServer(request); });

for (const width of [390, 1440]) for (const theme of ["dark", "light"]) {
  test(`${width} ${theme}: phone choice fits and changes only its own field`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const db = await open(page, theme);
    const contacts = page.getByTestId("phone-search-option-contacts");
    await expect(contacts).toHaveAttribute("aria-checked", "true");
    await expect(contacts).toBeEnabled();
    await expect.poll(() => db.fixture.rpcBodies("presence_beat").length).toBeGreaterThan(0);
    const choice = page.getByTestId("phone-search-setting");
    await choice.scrollIntoViewIfNeeded();
    const geometry = await choice.evaluate((element) => {
      const area = element.getBoundingClientRect();
      return { x: area.x, right: area.right, overflow: element.scrollWidth > element.clientWidth,
        rows: Array.from(element.querySelectorAll("button")).map((row) => ({ width: row.clientWidth, height: row.clientHeight })) };
    });
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.overflow).toBe(false);
    expect(geometry.rows).toHaveLength(2);
    for (const row of geometry.rows) { expect(row.width).toBeGreaterThan(200); expect(row.height).toBeGreaterThanOrEqual(40); }
    if (process.env.KUB_CAPTURE_SYNTHETIC === "1") {
      await mkdir("output/phone-findability", { recursive: true });
      await page.screenshot({ path: `output/phone-findability/${width}-${theme}.png` });
    }
    db.elsewhere();
    await page.getByTestId("phone-search-option-everybody").click();
    await expect.poll(() => db.get().phone_findable_by).toBe("everybody");
    expect(db.get().forward_origin_visible).toBe(true);
    expect(db.get().manual_status).toBe("invisible");
    expect(db.writes).toHaveLength(2);
    expect(db.writes[0].body).toEqual({ user_id: ME.id });
    expect(db.writes[0].prefer).toContain("resolution=ignore-duplicates");
    expect(Object.keys(db.writes[1].body).sort()).toEqual(["phone_findable_by", "updated_at"]);
    expect(db.writes[1].method).toBe("PATCH");
  });
}

test("a failed initial read disables privacy changes and can be retried", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const db = await open(page, "dark", true);
  await expect(page.getByTestId("phone-search-option-everybody")).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Показывать, когда я в сети" })).toBeDisabled();
  await expect(page.getByText("Не удалось загрузить настройки конфиденциальности.", { exact: true })).toBeVisible();
  expect(db.writes).toHaveLength(0);
  expect(db.fixture.rpcBodies("presence_beat")).toHaveLength(0);
  db.recover();
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByTestId("phone-search-option-contacts")).toBeEnabled();
  await expect(page.getByTestId("phone-search-option-contacts")).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => db.fixture.rpcBodies("presence_beat").length).toBeGreaterThan(0);
  expect(db.writes).toHaveLength(0);
});
