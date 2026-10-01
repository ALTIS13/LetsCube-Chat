import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { loadQaCredentials } from "./helpers/auth";

if (process.env.KUB_PHONE_FINDABILITY_DEPLOYED === "1") process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

test("deployed phone setting reads the authenticated own preference without saving", async ({ page }) => {
  test.skip(process.env.KUB_PHONE_FINDABILITY_DEPLOYED !== "1", "explicit deployed read-only smoke only");
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  expect(process.env.KUB_BASE_URL).toBe("https://app.letscube.ru");
  const values = Object.fromEntries((await readFile("artifacts/kub/.env.local", "utf8")).split(/\r?\n/)
    .flatMap((line) => { const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line); return m ? [[m[1], m[2].replace(/^['"]|['"]$/g, "")]] : []; }));
  const base = values.VITE_SUPABASE_URL;
  expect(new URL(base).origin).toBe("https://core.letscube.ru");
  const credentials = loadQaCredentials("client");
  if (!credentials) throw new Error("configured QA client required");
  const headers = { apikey: values.VITE_SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  const login = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers,
    body: JSON.stringify(credentials), redirect: "error" });
  if (!login.ok) throw new Error(`QA login HTTP ${login.status}`);
  const session = await login.json();
  const statuses: number[] = [];
  const preferenceWrites: string[] = [];
  try {
    // Prevent the shell's incidental heartbeat, notification and push writes.
    // Only actual preference reads are used as production evidence.
    await page.route(`${base}/rest/v1/**`, async (route) => {
      if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.continue();
      if (new URL(route.request().url()).pathname.endsWith("/privacy_preferences")) {
        preferenceWrites.push(route.request().method());
      }
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Read-only QA" }) });
    });
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/rest/v1/privacy_preferences") statuses.push(response.status());
    });
    await page.addInitScript((value) => localStorage.setItem("kub-auth", JSON.stringify(value)), session);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Меню", exact: true }).first().click();
    const menu = (page.viewportSize()?.width ?? 0) < 768
      ? page
      : page.getByRole("dialog", { name: "Боковое меню" });
    await menu.getByRole("button", { name: "Настройки", exact: true }).first().click();
    await page.getByTestId("settings-open-phone-search").click();
    await expect(page.getByTestId("phone-search-setting")).toBeVisible();
    await expect.poll(() => statuses.length).toBeGreaterThan(0);
    expect(statuses.every((status) => status === 200)).toBe(true);
    await expect(page.getByTestId("phone-search-option-everybody")).toBeEnabled();
    await expect(page.getByTestId("phone-search-option-contacts")).toBeEnabled();
    await expect(page.getByTestId("phone-search-setting").locator('[aria-checked="true"]')).toHaveCount(1);
    expect(preferenceWrites).toHaveLength(0);
  } finally {
    const logout = await fetch(`${base}/auth/v1/logout?scope=local`, { method: "POST", redirect: "error",
      headers: { ...headers, Authorization: `Bearer ${session.access_token}` } });
    if (!logout.ok) throw new Error(`QA session cleanup HTTP ${logout.status}`);
  }
});
