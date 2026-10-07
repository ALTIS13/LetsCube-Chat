import { expect, test } from "@playwright/test";
import { openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const A = person("64111111-1111-4111-8111-000000000061", "Проверка сеанса", "session_qa");
const S1 = "64111111-1111-4111-8111-000000000062";
const S2 = "64111111-1111-4111-8111-000000000063";
const CHAT = "64111111-1111-4111-8111-000000000064";

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });
test.beforeEach(async ({ request }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  await requireFixtureServer(request);
});

test("actual auth observer retains ordinary refresh and retires a new same-user session", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  await openFixture(page, { me: A, people: [], chats: [], memberships: [], messages: [] });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("notification-bell-button")).toBeVisible();
  const setSession = async (sessionId: string, nonce: number) => page.evaluate(async ({ userId, sessionId, nonce }) => {
    const { createClient } = await import("/src/lib/supabase/client.ts" /* @vite-ignore */);
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const access_token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
      sub: userId, session_id: sessionId, role: "authenticated", iat: now, exp: now + 3600, nonce,
    })}.${encode("fictional-signature")}`;
    const { error } = await createClient().auth.setSession({ access_token, refresh_token: "fictional-session-refresh" });
    if (error) throw Error("synthetic session was not accepted by fixture");
  }, { userId: A.id, sessionId, nonce });
  const ownership = () => page.evaluate(async () => {
    const { useAppStore } = await import("/src/store/app.store.ts" /* @vite-ignore */);
    const state = useAppStore.getState();
    return { epoch: state.accountEpoch, sessionId: state.authSessionIdentity?.sessionId,
      userId: state.currentUser?.id, selected: state.selectedChatId };
  });
  await setSession(S1, 1);
  await expect.poll(ownership).toMatchObject({ sessionId: S1, userId: A.id });
  const first = await ownership();
  await page.evaluate(async chatId => {
    const { useAppStore } = await import("/src/store/app.store.ts" /* @vite-ignore */);
    useAppStore.getState().setSelectedChatId(chatId);
  }, CHAT);
  await setSession(S1, 2);
  await expect.poll(ownership).toMatchObject({ epoch: first.epoch, sessionId: S1, selected: CHAT });
  await setSession(S2, 3);
  await expect.poll(ownership).toEqual({ epoch: first.epoch + 1, sessionId: S2, userId: A.id, selected: null });
  await expect(page.getByTestId("notification-bell-button")).toBeVisible();
  expect(errors).toEqual([]);
});
