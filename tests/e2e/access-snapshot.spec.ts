import { expect, test } from "@playwright/test";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test.describe("access snapshot rollout", () => {
  test("uses one snapshot request without legacy permission fan-out", async ({
    page,
  }) => {
    test.skip(
      process.env.KUB_EXPECT_ACCESS_SNAPSHOT !== "1",
      "VITE_ACCESS_SNAPSHOT_RPC_ENABLED=1 build is required",
    );
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], {
      includeDefault: true,
    });
    test.skip(!role, "Owner or tech-admin QA auth state is required");
    const liveSnapshot = process.env.KUB_ACCESS_SNAPSHOT_LIVE === "1";

    let snapshotRequests = 0;
    let legacyPermissionRequests = 0;
    const rpcSequence: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/rpc/current_user_access_snapshot")) {
        snapshotRequests += 1;
        rpcSequence.push("snapshot");
      }
      if (
        url.includes("/rpc/has_permission") ||
        url.includes("/rpc/has_location_permission") ||
        url.includes("/rpc/has_global_role")
      ) {
        legacyPermissionRequests += 1;
        const rpcName = new URL(url).pathname.split("/").at(-1) ?? "unknown";
        rpcSequence.push(rpcName);
      }
    });
    if (!liveSnapshot) {
      await page.route(
        "**/rest/v1/rpc/current_user_access_snapshot",
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              global_role_keys: ["owner"],
              global_permission_keys: [
                "audit.view",
                "locations.manage",
                "roles.manage",
                "system.manage",
                "tasks.assign",
                "tasks.create",
                "tasks.manage",
                "tasks.view",
                "users.manage",
                "users.view",
              ],
              location_permissions: {},
            }),
          });
        },
      );
    }

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await expect(page.locator("body")).toBeVisible();
    await page.waitForTimeout(1_000);

    expect(snapshotRequests).toBe(1);
    expect(legacyPermissionRequests, rpcSequence.join(" -> ")).toBe(0);
    await expect(page.getByText("Произошла ошибка интерфейса")).toHaveCount(0);
  });
});
