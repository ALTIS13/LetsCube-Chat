import { expect, test } from "@playwright/test";
import {
  EPOCH,
  openAdmin,
  openAdminFixture,
  person,
  requireFixtureServer,
  stampTheme,
  type FixturePerson,
} from "./helpers/adminFixture";

/**
 * D-200, shown rather than argued: the users tab offered a manager a button the
 * database refuses.
 *
 * `public.enforce_sanction_matrix()` ranks both sides through
 * `public.roles.priority` (D-197). The tab ranked the target by the legacy
 * `profiles.role` column, so somebody who is an owner by global role alone —
 * three accounts on this deployment carry exactly that shape — read as an
 * ordinary user and got an enabled «Заблокировать…».
 *
 * **Why a fixture and not a sign-in.** Measured read-only on 2026-09-19, the
 * manager branch is unreachable on production: the `manager` and `admin` global
 * roles carry 0 assignments, no account carries `profiles.role = 'manager'`,
 * and the client's own `isStaff && !isAdmin` band is empty. There is nobody to
 * sign in as, so the caller is built here. Every person and every id below is
 * invented; the fixture aborts every request that would leave this machine.
 *
 * It also reproduces the second half of the measurement: a manager reads one
 * row of `public.roles` and one of `user_global_roles`, so `roles` and
 * `user_global_roles` are deliberately left empty here and the ranks arrive
 * only through `effective_global_role_priority`, which is SECURITY DEFINER with
 * EXECUTE granted to `authenticated`.
 */

const OWNER_PRIORITY = 100;
const MANAGER_PRIORITY = 60;
const USER_PRIORITY = 10;

const MANAGER_PERMISSIONS = [
  "users.view",
  "locations.view",
  "location_members.view",
  "tasks.view",
  "tasks.create",
  "tasks.assign",
  "tasks.manage",
  "chats.invite",
];

const ADMIN_PERMISSIONS = [...MANAGER_PERMISSIONS, "users.manage", "roles.view", "audit.view"];

const me = { ...person("11111111-1111-4111-8111-111111111111", "Марина Ветрова", "vetrova"), role: "user" };
/** An owner by global role alone: `profiles.role` says `user`. The blind spot. */
const quietOwner: FixturePerson = {
  ...person("22222222-2222-4222-8222-222222222222", "Олег Дубровин", "dubrovin"),
  role: "user",
};
/** An ordinary account: the person a manager is meant to be able to sanction. */
const ordinary: FixturePerson = {
  ...person("33333333-3333-4333-8333-333333333333", "Таисия Жмых", "zhmyh"),
  role: "user",
};

/** The live global role ladder, with invented ids. */
const GLOBAL_ROLE_ROWS = [
  ["role-owner", "owner", "Владелец", OWNER_PRIORITY],
  ["role-tech", "tech_admin", "Тех. администратор", OWNER_PRIORITY],
  ["role-admin", "admin", "Администратор", 80],
  ["role-manager", "manager", "Менеджер", MANAGER_PRIORITY],
  ["role-user", "user", "Пользователь", USER_PRIORITY],
].map(([id, key, name, priority]) => ({
  id,
  key,
  name,
  description: null,
  scope: "global",
  is_system: true,
  is_active: true,
  priority,
  colour: null,
  created_at: EPOCH,
  updated_at: EPOCH,
}));

const PRIORITIES: Record<string, number> = {
  [me.id]: MANAGER_PRIORITY,
  [quietOwner.id]: OWNER_PRIORITY,
  [ordinary.id]: USER_PRIORITY,
};

function fixtureOptions(roleKeys: string[], permissionKeys: string[], myPriority: number) {
  return {
    me: me as FixturePerson,
    globalRoleKeys: roleKeys,
    globalPermissionKeys: permissionKeys,
    people: [quietOwner, ordinary],
    // A manager may read neither, so both stay empty and the tab has to ask.
    tables: { roles: [], user_global_roles: [], bans: [], mutes: [], location_members: [], locations: [] },
    rpc: (name: string, body: Record<string, unknown>) => {
      if (name !== "effective_global_role_priority") return undefined;
      const id = String(body.p_user_id ?? "");
      const priority = id === me.id ? myPriority : PRIORITIES[id];
      return { body: priority ?? 0 };
    },
    theme: "dark" as const,
  };
}

async function menuFor(page: import("@playwright/test").Page, fullName: string) {
  const row = page.getByTestId("admin-user-row").filter({ hasText: fullName });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Действия" }).click();
  const menu = page.getByRole("menu");
  // The menu fades in. A frame captured mid-transition shows the items at a
  // fraction of their opacity and reads like a disabled control, so the capture
  // waits for the animation to finish rather than for the element to exist.
  await expect
    .poll(() => menu.evaluate((element) => window.getComputedStyle(element).opacity))
    .toBe("1");
  return menu;
}

test.describe("the sanction control agrees with the sanction matrix", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("a manager is not offered a sanction against an owner, and is against an ordinary account", async ({ page }) => {
    const fixture = await openAdminFixture(
      page,
      fixtureOptions(["manager"], MANAGER_PERMISSIONS, MANAGER_PRIORITY),
    );
    await openAdmin(page, "/admin/users");
    await stampTheme(page, "dark");
    await expect(page.getByTestId("admin-user-row")).toHaveCount(3);

    // The positive case comes FIRST, deliberately. «Заблокировать…» absent is
    // also what an unranked row looks like, so asserting the owner's row before
    // the ranks arrive would pass against a client that ranks nothing at all —
    // measured: a mutation feeding the matrix the legacy column stayed green
    // until this order was fixed. This waits for the answer, and the ranks for
    // the whole page arrive in one pass.
    const other = await menuFor(page, "Таисия Жмых");
    await expect(other.getByText("Заблокировать…")).toBeVisible();
    await expect(other.getByText("Замьютить…")).toBeVisible();
    await page.screenshot({ path: "output/d200-manager-vs-ordinary.png", fullPage: false });
    await page.keyboard.press("Escape");

    // Positive proof the owner's rank was asked for, not merely never answered.
    expect(
      fixture.requests.filter((entry) => entry.resource === "rpc/effective_global_role_priority").length,
    ).toBeGreaterThanOrEqual(3);

    // The defect: `profiles.role` says `user`, the database ranks them 100, and
    // the trigger answers «Менеджер не может применять санкции к
    // администратору». The control is not offered at all.
    const owner = await menuFor(page, "Олег Дубровин");
    await expect(owner.getByText("Открыть профиль")).toBeVisible();
    await expect(owner.getByText("Заблокировать…")).toHaveCount(0);
    await expect(owner.getByText("Замьютить…")).toHaveCount(0);
    await page.screenshot({ path: "output/d200-manager-vs-owner.png", fullPage: false });
    await page.keyboard.press("Escape");

    // The trigger refuses the caller themselves before it ranks anybody.
    const self = await menuFor(page, "Марина Ветрова");
    await expect(self.getByText("Заблокировать…")).toHaveCount(0);
  });

  test("an administrator keeps the control against everybody but themselves", async ({ page }) => {
    await openAdminFixture(page, fixtureOptions(["owner"], ADMIN_PERMISSIONS, OWNER_PRIORITY));
    await openAdmin(page, "/admin/users");
    await stampTheme(page, "dark");
    await expect(page.getByTestId("admin-user-row")).toHaveCount(3);

    for (const name of ["Олег Дубровин", "Таисия Жмых"]) {
      const menu = await menuFor(page, name);
      await expect(menu.getByText("Заблокировать…")).toBeVisible();
      await page.keyboard.press("Escape");
    }

    const self = await menuFor(page, "Марина Ветрова");
    await expect(self.getByText("Заблокировать…")).toHaveCount(0);
    await page.screenshot({ path: "output/d200-admin-unchanged.png", fullPage: false });
  });

  test("an administrator ranks everybody from the role tables and asks the database nothing extra", async ({ page }) => {
    // The other half of the cost claim: the fallback above is for the callers
    // who cannot read `roles`. An administrator can, so the ranks are worked
    // out locally and the screen makes no request per row.
    const fixture = await openAdminFixture(page, {
      ...fixtureOptions(["owner"], ADMIN_PERMISSIONS, OWNER_PRIORITY),
      tables: {
        roles: GLOBAL_ROLE_ROWS,
        user_global_roles: [
          { user_id: me.id, role_id: "role-owner", assigned_by: null, assigned_at: EPOCH },
          { user_id: quietOwner.id, role_id: "role-owner", assigned_by: null, assigned_at: EPOCH },
        ],
        bans: [],
        mutes: [],
        location_members: [],
        locations: [],
      },
    });
    await openAdmin(page, "/admin/users");
    await expect(page.getByTestId("admin-user-row")).toHaveCount(3);

    const menu = await menuFor(page, "Олег Дубровин");
    await expect(menu.getByText("Заблокировать…")).toBeVisible();
    expect(fixture.requests.filter((entry) => entry.resource === "rpc/effective_global_role_priority")).toHaveLength(0);
  });
});

// `EPOCH` is imported for the fixture's clock and is referenced here so a
// linter cannot drop the import that documents which instant the rows carry.
test("the fixture's rows are stamped at a fixed instant", () => {
  expect(EPOCH).toBe("2026-09-01T09:00:00.000Z");
});
