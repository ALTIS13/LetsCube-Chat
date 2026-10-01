import { expect, test } from "@playwright/test";
import { openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const ME = person("11111111-1111-4111-8111-000000000001", "Анна Смирнова", "anna");
const OTHER = person("11111111-1111-4111-8111-000000000002", "Иван Орлов", "ivan");
const projection = { id: OTHER.id, title: OTHER.full_name, subtitle: "@ivan", avatar_url: null, created_at: "2026-09-30T09:00:00Z" };

test.beforeEach(async ({ request }) => { await requireFixtureServer(request); });

test("a whole Russian number finds a permitted stranger under People without reading contact rows", async ({ page }) => {
  const fixture = await openFixture(page, { me: ME, people: [OTHER], chats: [], memberships: [], messages: [],
    rpc: (name) => name === "global_search_v2" ? { body: [] }
      : name === "search_profiles_by_phone" ? { body: [projection] } : undefined });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("sidebar-search-input").fill("8 (999) 123-45-67");
  const found = page.getByTestId("sidebar-search-result-user");
  await expect(found).toHaveCount(1);
  await expect(found).toContainText("Иван Орлов");
  expect(fixture.rpcBodies("search_profiles_by_phone")).toEqual([{ p_query: "+79991234567", p_limit: 10 }]);
  expect(fixture.restCalls("profile_contacts")).toHaveLength(0);
  await expect(page.getByTestId("sidebar-search-result-chat")).toHaveCount(0);
});

test("private or missing phone results remain empty and a partial number makes no lookup", async ({ page }) => {
  const fixture = await openFixture(page, { me: ME, chats: [], memberships: [], messages: [],
    rpc: (name) => name === "global_search_v2" || name === "search_profiles_by_phone" ? { body: [] } : undefined });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("sidebar-search-input").fill("+7999");
  await expect.poll(() => fixture.rpcBodies("global_search_v2").length).toBe(1);
  expect(fixture.rpcBodies("search_profiles_by_phone")).toHaveLength(0);
  await page.getByTestId("sidebar-search-input").fill("+79991234567");
  await expect.poll(() => fixture.rpcBodies("search_profiles_by_phone").length).toBe(1);
  await expect(page.getByTestId("sidebar-search-result-user")).toHaveCount(0);
  await expect(page.getByTestId("search-phone-limited")).toHaveCount(0);
});

test("a phone rate limit is actionable and does not remain on an unrelated later search", async ({ page }) => {
  await openFixture(page, { me: ME, chats: [], memberships: [], messages: [],
    rpc: (name) => name === "global_search_v2" ? { body: [] }
      : name === "search_profiles_by_phone" ? { status: 400, body: { code: "P0001", message: "phone_lookup_rate_limited" } } : undefined });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("sidebar-search-input").fill("+79991234567");
  await expect(page.getByTestId("search-phone-limited")).toHaveText("Слишком много поисков по номеру. Попробуйте чуть позже.");
  await expect(page.getByTestId("sidebar-search-result-user")).toHaveCount(0);
  await page.getByTestId("sidebar-search-input").fill("@anna");
  await expect(page.getByTestId("search-phone-limited")).toHaveCount(0);
});
