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
 * The invitation form stops offering what the server refuses (D-142, A-37 and
 * A-36).
 *
 * The permissions are an argument here, and they have to be: there is no QA
 * account on this deployment shaped like the person the defect is about — a
 * global administrator who may hand out roles and may *not* change technical
 * settings. `owner` and `tech_admin` both hold `system.manage` implicitly, so
 * signing in as either would render the state that always worked.
 *
 * Everything on screen is fictional and mocked; nothing leaves this machine.
 */

const ME = person("99999999-9999-4999-8999-000000000001", "Ирина Волкова", "irina");
const LOCAL_ADMIN = person("99999999-9999-4999-8999-000000000002", "Сергей Гаврилов", "sergey");

/** Enough to open «Инвайты»: `isAdmin` through a permission, not a role key. */
const BASE_PERMISSIONS = ["users.assign_roles", "roles.manage", "users.view", "users.manage"];

const ROLES: Row[] = [
  { id: "role-owner", key: "owner", scope: "global", is_active: true, name: "Владелец", sort_order: 1, color: null, description: null, is_system: true, created_at: EPOCH, updated_at: EPOCH },
  { id: "role-tech", key: "tech_admin", scope: "global", is_active: true, name: "Тех. администратор", sort_order: 2, color: null, description: null, is_system: true, created_at: EPOCH, updated_at: EPOCH },
  { id: "role-admin", key: "admin", scope: "global", is_active: true, name: "Администратор", sort_order: 3, color: null, description: null, is_system: true, created_at: EPOCH, updated_at: EPOCH },
  { id: "role-manager", key: "manager", scope: "global", is_active: true, name: "Менеджер", sort_order: 4, color: null, description: null, is_system: true, created_at: EPOCH, updated_at: EPOCH },
  { id: "role-user", key: "user", scope: "global", is_active: true, name: "Пользователь", sort_order: 5, color: null, description: null, is_system: true, created_at: EPOCH, updated_at: EPOCH },
  { id: "role-loc-owner", key: "location_owner", scope: "location", is_active: true, name: "Владелец локации", sort_order: 6, color: null, description: null, is_system: true, created_at: EPOCH, updated_at: EPOCH },
  { id: "role-loc-admin", key: "location_admin", scope: "location", is_active: true, name: "Администратор локации", sort_order: 7, color: null, description: null, is_system: true, created_at: EPOCH, updated_at: EPOCH },
  { id: "role-loc-staff", key: "location_staff", scope: "location", is_active: true, name: "Сотрудник локации", sort_order: 8, color: null, description: null, is_system: true, created_at: EPOCH, updated_at: EPOCH },
];

const LOCATIONS: Row[] = [
  {
    id: "loc-1",
    name: "Гагарина 14",
    description: "Основная площадка",
    address: "Гагарина, 14",
    is_active: true,
    created_at: EPOCH,
    updated_at: EPOCH,
  },
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

const INVITES = [
  {
    id: "inv-1",
    code: "LCQ7WM2K",
    label: "Смена ресепшн, сентябрь",
    max_uses: 5,
    uses_count: 1,
    expires_at: null,
    revoked_at: null,
    created_at: EPOCH,
    global_role_id: null,
    location_id: "loc-1",
    location_role_id: "role-loc-staff",
    primary_admin_id: null,
  },
];

async function openInvites(page: Page, permissions: string[], roles: Row[] = ROLES) {
  await openAdminFixture(page, {
    me: ME,
    globalRoleKeys: ["admin"],
    globalPermissionKeys: permissions,
    people: [LOCAL_ADMIN],
    tables: {
      roles,
      permissions: [],
      role_permissions: [],
      locations: LOCATIONS,
      location_members: LOCATION_MEMBERS,
    },
    rpc: (name) => {
      if (name === "registration_invites_list") return { body: INVITES };
      if (name === "registration_invite_mode") return { body: [{ invite_only_enabled: false }] };
      return undefined;
    },
  });
  await openAdmin(page, "/admin/invites");
  await page.getByRole("button", { name: "Создать инвайт", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Роль в локации" })).toBeVisible();
}

function globalRoleSelect(page: Page) {
  // The first select in the form; «Глобальная роль» labels it through a `<label>`
  // wrapper rather than an `id`, so it is reached by its own first option.
  return page.locator("select").filter({ hasText: "Без глобальной роли" });
}

function shot(info: TestInfo, name: string): string {
  return `output/admin-invites/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

// ---------------------------------------------------------------------------
// A-37 — the two critical roles
// ---------------------------------------------------------------------------

test("without system.manage the two critical roles are not offered, and the absence is explained", async ({ page }) => {
  await openInvites(page, BASE_PERMISSIONS);

  const select = globalRoleSelect(page);
  // Compared as a set: the order on screen is the roles list's own, and what
  // this entry is about is which roles are there at all.
  const options = (await select.locator("option").allInnerTexts()).sort();
  expect(options).toEqual(["Администратор", "Без глобальной роли", "Менеджер", "Пользователь"]);

  // The defect was that they were offered and refused after the press, with
  // «Критические роли может выдавать только тех. администратор» — a sentence
  // about a role, where the database checks a permission.
  const note = page.getByTestId("invite-global-role-withheld");
  await expect(note).toHaveText(
    "Роли «Владелец» и «Тех. администратор» может выдать только тот, кому разрешено «Менять технические настройки».",
  );
  await expect(page.getByText("только тех. администратор")).toHaveCount(0);
});

test("with system.manage all five are offered and nothing is explained away", async ({ page }) => {
  await openInvites(page, [...BASE_PERMISSIONS, "system.manage"]);

  const options = (await globalRoleSelect(page).locator("option").allInnerTexts()).sort();
  expect(options).toEqual([
    "Администратор",
    "Без глобальной роли",
    "Владелец",
    "Менеджер",
    "Пользователь",
    "Тех. администратор",
  ]);
  await expect(page.getByTestId("invite-global-role-withheld")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// A-36 — «Роль в локации»
// ---------------------------------------------------------------------------

test("a chosen role in the location stays chosen", async ({ page }) => {
  await openInvites(page, BASE_PERMISSIONS);

  const locationSelect = page.getByRole("combobox", { name: "Локация" });
  const roleSelect = page.getByRole("combobox", { name: "Роль в локации" });

  // Disabled until a location is chosen, and the server sends nothing for it.
  await expect(roleSelect).toBeDisabled();
  await locationSelect.selectOption({ label: "Гагарина 14" });
  await expect(roleSelect).toBeEnabled();

  // The default is `location_staff`, which is what the function resolves an
  // absent role to — and «Автоматически», which named that same outcome and
  // could not be kept, is gone.
  await expect(roleSelect).toHaveValue("role-loc-staff");
  const options = (await roleSelect.locator("option").allInnerTexts()).sort();
  expect(options).not.toContain("Автоматически");
  expect(options).toEqual(["Администратор локации", "Владелец локации", "Сотрудник локации"]);

  // The defect: an effect listed the value among its own dependencies and put
  // the staff role back the instant anything else was chosen.
  await roleSelect.selectOption("role-loc-admin");
  await expect(roleSelect).toHaveValue("role-loc-admin");
  await page.waitForTimeout(400);
  await expect(roleSelect).toHaveValue("role-loc-admin");
});

test("«Основной администратор» works under the default role, which «Автоматически» switched off", async ({ page }) => {
  await openInvites(page, BASE_PERMISSIONS);
  await page.getByRole("combobox", { name: "Локация" }).selectOption({ label: "Гагарина 14" });

  // Enabled only while the chosen role is `location_staff`. With the empty
  // value selectable it was off by default, although the server under that same
  // branch calls `_location_assert_admin_member` and accepts one.
  const primary = page.getByRole("combobox", { name: "Основной администратор" });
  await expect(primary).toBeEnabled();
  await expect(primary.locator("option")).toContainText(["Не назначать", "Сергей Гаврилов"]);

  await page.getByRole("combobox", { name: "Роль в локации" }).selectOption("role-loc-admin");
  await expect(primary).toBeDisabled();
});

test("with no location roles at all the select says what the server will do", async ({ page }) => {
  // Removing «Автоматически» must not leave an empty select behind when the
  // roles feature is unavailable: an empty control reads as broken, and the
  // sentence it shows instead is the branch `registration_invite_create`
  // actually takes for an absent role.
  await openInvites(page, BASE_PERMISSIONS, ROLES.filter((role) => role.scope === "global"));
  await page.getByRole("combobox", { name: "Локация" }).selectOption({ label: "Гагарина 14" });

  const roleSelect = page.getByRole("combobox", { name: "Роль в локации" });
  await expect(roleSelect).toBeDisabled();
  await expect(roleSelect.locator("option")).toHaveText(["По умолчанию — сотрудник локации"]);
});

// ---------------------------------------------------------------------------
// The permission's own name, on the switch above the form
// ---------------------------------------------------------------------------

test("the registration switch names the permission as the catalogue names it", async ({ page }) => {
  await openInvites(page, BASE_PERMISSIONS);
  await expect(
    page.getByText(
      "Переключать режим регистрации может только тот, кому разрешено «Менять технические настройки».",
    ),
  ).toBeVisible();
  // «Управление системой» is the label this catalogue replaced; it exists
  // nowhere an administrator could look it up.
  await expect(page.getByText("Управление системой")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// The frames
// ---------------------------------------------------------------------------

for (const theme of ["dark", "light"] as const) {
  test(`frames — ${theme}`, async ({ page }, info) => {
    await openInvites(page, BASE_PERMISSIONS);
    await stampTheme(page, theme);
    await page.getByRole("combobox", { name: "Локация" }).selectOption({ label: "Гагарина 14" });
    await expect(page.getByTestId("invite-global-role-withheld")).toBeVisible();
    await page.getByTestId("invite-global-role-withheld").scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(info, `withheld-roles-${theme}`) });
  });
}
