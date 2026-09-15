import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  EPOCH,
  openAdmin,
  openAdminFixture,
  person,
  requireFixtureServer,
  stampTheme,
  type Row,
} from "./helpers/adminFixture";

/**
 * A refused assignment keeps what was entered (D-142, A-29).
 *
 * «Назначить» cleared its three selects after the call whatever the call said,
 * so a person, a role and a primary administrator all had to be found again
 * from an empty form — with the error message on screen saying only that it had
 * failed. `createLocation`, twenty lines up in the same file, already kept its
 * fields on a failure; this was the same rule missing in one place.
 *
 * Everything on screen is fictional and mocked; nothing leaves this machine.
 */

const ME = person("aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "Ирина Волкова", "irina");
const CANDIDATE = person("aaaaaaaa-aaaa-4aaa-8aaa-000000000002", "Никита Орлов", "nikita");
const LOCAL_ADMIN = person("aaaaaaaa-aaaa-4aaa-8aaa-000000000003", "Сергей Гаврилов", "sergey");

const PERMISSIONS = [
  "locations.manage",
  "locations.view",
  "location_members.manage",
  "location_members.view",
  "users.view",
  "users.manage",
];

const ROLES: Row[] = [
  { id: "role-loc-admin", key: "location_admin", scope: "location", is_active: true, name: "Администратор локации", sort_order: 1, color: null, description: null, is_system: true, created_at: EPOCH, updated_at: EPOCH },
  { id: "role-loc-staff", key: "location_staff", scope: "location", is_active: true, name: "Сотрудник локации", sort_order: 2, color: null, description: null, is_system: true, created_at: EPOCH, updated_at: EPOCH },
];

const LOCATIONS: Row[] = [
  { id: "loc-1", name: "Гагарина 14", description: "Основная площадка", address: "Гагарина, 14", is_active: true, created_at: EPOCH, updated_at: EPOCH },
];

const LOCATION_MEMBERS: Row[] = [
  {
    location_id: "loc-1",
    user_id: LOCAL_ADMIN.id,
    role: "admin",
    role_id: "role-loc-admin",
    primary_admin_id: null,
    created_at: EPOCH,
    updated_at: EPOCH,
    profile: LOCAL_ADMIN,
  },
];

async function openLocations(page: Page, options: { assignFails: boolean }) {
  await openAdminFixture(page, {
    me: ME,
    globalRoleKeys: ["admin"],
    globalPermissionKeys: PERMISSIONS,
    people: [CANDIDATE, LOCAL_ADMIN],
    tables: {
      roles: ROLES,
      permissions: [],
      role_permissions: [],
      locations: LOCATIONS,
      location_members: LOCATION_MEMBERS,
    },
    rpc: (name) => {
      if (name.startsWith("location_member_assign")) {
        // What production returns when the person is already in the location —
        // the commonest way for this press to fail.
        return options.assignFails
          ? { status: 400, body: { code: "23505", message: "duplicate key value violates unique constraint" } }
          : { body: null };
      }
      return undefined;
    },
  });
  await openAdmin(page, "/admin/locations");
  await expect(page.getByRole("heading", { name: "Назначения" })).toBeVisible();
}

const userSelect = (page: Page) => page.locator("select").filter({ hasText: "Выберите пользователя" });
const adminSelect = (page: Page) => page.locator("select").filter({ hasText: "Основной администратор" });
const roleSelect = (page: Page) => page.locator("select").filter({ hasText: "Сотрудник локации" });

function shot(info: TestInfo, name: string): string {
  return `output/admin-locations/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("a refused assignment keeps the person, the role and the administrator", async ({ page }) => {
  await openLocations(page, { assignFails: true });

  await userSelect(page).selectOption({ label: "Никита Орлов" });
  await roleSelect(page).selectOption("role-loc-staff");
  await adminSelect(page).selectOption({ label: "Сергей Гаврилов" });

  await page.getByRole("button", { name: "Назначить", exact: true }).click();

  // Something on screen has to say it failed…
  await expect(page.getByText("Назначение сохранено.")).toHaveCount(0);
  // …and the form has to still hold what was entered.
  await expect(userSelect(page)).toHaveValue(CANDIDATE.id);
  await expect(roleSelect(page)).toHaveValue("role-loc-staff");
  await expect(adminSelect(page)).toHaveValue(LOCAL_ADMIN.id);

  // Pressing again must be all it takes, so the button is still live.
  await expect(page.getByRole("button", { name: "Назначить", exact: true })).toBeEnabled();
});

test("an assignment that goes through clears the form, as it always did", async ({ page }) => {
  await openLocations(page, { assignFails: false });

  await userSelect(page).selectOption({ label: "Никита Орлов" });
  await adminSelect(page).selectOption({ label: "Сергей Гаврилов" });
  await page.getByRole("button", { name: "Назначить", exact: true }).click();

  await expect(page.getByText("Назначение сохранено.")).toBeVisible();
  // The half of the behaviour that was right: a saved assignment leaves an
  // empty form ready for the next one.
  await expect(userSelect(page)).toHaveValue("");
  await expect(adminSelect(page)).toHaveValue("");
  await expect(roleSelect(page)).toHaveValue("role-loc-staff");
});

for (const theme of ["dark", "light"] as const) {
  test(`frames — ${theme}`, async ({ page }, info) => {
    await openLocations(page, { assignFails: true });
    await stampTheme(page, theme);
    await userSelect(page).selectOption({ label: "Никита Орлов" });
    await adminSelect(page).selectOption({ label: "Сергей Гаврилов" });
    await page.getByRole("button", { name: "Назначить", exact: true }).click();
    await expect(userSelect(page)).toHaveValue(CANDIDATE.id);
    await page.getByRole("heading", { name: "Назначения" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(info, `refused-assignment-${theme}`) });
  });
}
