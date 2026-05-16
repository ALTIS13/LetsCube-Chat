import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

export type QaCredentials = {
  email: string;
  password: string;
};

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
  const emailInput = page.locator('input[type="email"]').first();
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(credentials.email);
    await page.locator('input[type="password"]').first().fill(credentials.password);
    await page.locator('button[type="submit"]').first().click();
  }

  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 20_000 });
}
