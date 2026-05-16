import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

export type QaCredentials = {
  email: string;
  password: string;
};

const AUTH_STATE_PATH = path.join(process.cwd(), "output", "e2e-auth-state.json");

export function loadQaCredentials(): QaCredentials | null {
  const envFile = process.env.KUB_QA_ENV_FILE || path.join(os.homedir(), ".kub-messenger-qa.env");
  const values = new Map<string, string>();

  if (fs.existsSync(envFile)) {
    for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index <= 0) continue;
      const key = line.slice(0, index).trim();
      const value = line
        .slice(index + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      values.set(key, value);
    }
  }

  const passwordKey = ["KUB", "QA", "PASSWORD"].join("_");
  const email = process.env.KUB_QA_EMAIL || values.get("KUB_QA_EMAIL");
  const password = process.env[passwordKey] || values.get(passwordKey);
  if (!email || !password) return null;
  return { email, password };
}

export async function gotoOrSkip(page: Page, pathName: string) {
  const response = await page.goto(pathName, { waitUntil: "domcontentloaded" }).catch(() => null);
  test.skip(!response, `KUB_BASE_URL is not reachable: ${test.info().project.use.baseURL}`);
}

export async function loginIfNeeded(page: Page, credentials: QaCredentials) {
  await restoreAuthState(page);

  const emailInput = page.locator('input[type="email"]').first();
  if (await emailInput.isVisible().catch(() => false)) {
    const passwordInput = page.locator('input[type="password"]').first();
    const submit = page.locator('button[type="submit"]').first();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if ((await page.locator('input[type="password"]').count()) === 0) break;
      await expect(emailInput).toBeEditable();
      await emailInput.fill(credentials.email);
      await expect(passwordInput).toBeEditable();
      await passwordInput.fill(credentials.password);
      await expect(submit).toBeEnabled();
      await submit.click();
      try {
        await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 10_000 });
        await page.waitForTimeout(1_000);
        if ((await page.locator('input[type="password"]').count()) === 0) break;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  }

  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 20_000 });
  await saveAuthState(page);
}

async function restoreAuthState(page: Page) {
  if (!fs.existsSync(AUTH_STATE_PATH)) return;
  const origin = new URL(page.url()).origin;
  const raw = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, "utf8")) as {
    origins?: { origin: string; localStorage?: { name: string; value: string }[] }[];
  };
  const state = raw.origins?.find((item) => item.origin === origin);
  if (!state?.localStorage?.length) return;
  await page.evaluate((entries) => {
    for (const entry of entries) {
      window.localStorage.setItem(entry.name, entry.value);
    }
  }, state.localStorage);
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function saveAuthState(page: Page) {
  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: AUTH_STATE_PATH });
}
