import { expect, test, type Route } from "@playwright/test";
import { FIXTURE_HOST, openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const accountA = person("00000000-0000-4000-8000-0000000000a1", "Synthetic A", "synthetic_a");
const accountB = person("00000000-0000-4000-8000-0000000000b2", "Synthetic B", "synthetic_b");

function accessToken(userId: string): string {
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "HS256", typ: "JWT" })}.${segment({ aud: "authenticated", role: "authenticated", sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
}

function authUser(user: typeof accountA) {
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.invalid",
    user_metadata: { full_name: user.full_name },
    app_metadata: {},
    created_at: user.created_at,
  };
}

async function currentProfileId(page: import("@playwright/test").Page, path: string): Promise<string | null> {
  return page.evaluate(async (modulePath) => {
    const { useAppStore } = await import(/* @vite-ignore */ modulePath);
    return useAppStore.getState().currentUser?.id ?? null;
  }, path);
}

async function sessionUserId(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("kub-auth") ?? "null")?.user?.id ?? null);
}

test.use({ screenshot: "off", trace: "off", video: "off" });

test("a delayed profile from account A cannot replace account B", async ({ page, request }) => {
  await requireFixtureServer(request);
  await openFixture(page, { me: accountA, chats: [], memberships: [], messages: [] });
  const modules = new Map<string, string>();
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (["/src/lib/supabase/client.ts", "/src/store/app.store.ts"].includes(path)) {
      modules.set(path, request.url());
    }
  });

  let signalA!: () => void;
  const aRequested = new Promise<void>((resolve) => { signalA = resolve; });
  let releaseA!: () => void;
  const aGate = new Promise<void>((resolve) => { releaseA = resolve; });
  const tokenB = accessToken(accountB.id);
  let bAuthReads = 0;
  let bProfileReads = 0;

  await page.route(
    (url) => url.href.startsWith(FIXTURE_HOST) && url.pathname === "/rest/v1/profiles",
    async (route: Route) => {
      const id = new URL(route.request().url()).searchParams.get("id");
      if (id === `eq.${accountA.id}`) {
        signalA();
        await aGate;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(accountA) });
      } else if (id === `eq.${accountB.id}`) {
        bProfileReads += 1;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(accountB) });
      } else {
        await route.fallback();
      }
    },
  );
  await page.route(`${FIXTURE_HOST}/auth/v1/user`, async (route) => {
    bAuthReads += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(authUser(accountB)) });
  });

  await page.goto("/login");
  await aRequested;
  const clientModule = modules.get("/src/lib/supabase/client.ts");
  const storeModule = modules.get("/src/store/app.store.ts");
  expect(clientModule && storeModule).toBeTruthy();
  await page.evaluate(async ({ token, path }) => {
    const { createClient } = await import(/* @vite-ignore */ path);
    const { error } = await createClient().auth.setSession({ access_token: token, refresh_token: "synthetic-refresh-b" });
    if (error) throw new Error(error.message);
  }, { token: tokenB, path: clientModule! });
  expect(bAuthReads).toBeGreaterThan(0);
  await expect.poll(() => bProfileReads).toBeGreaterThan(0);
  await expect.poll(() => currentProfileId(page, storeModule!)).toBe(accountB.id);

  const oldResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/rest/v1/profiles" &&
    new URL(response.url()).searchParams.get("id") === `eq.${accountA.id}`,
  );
  releaseA();
  await oldResponse;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  expect(await sessionUserId(page)).toBe(accountB.id);
  expect(await currentProfileId(page, storeModule!)).toBe(accountB.id);
});
