import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

export type QaCredentials = {
  email: string;
  password: string;
};

export type QaRole = "owner" | "tech_admin" | "location_admin" | "location_staff" | "client";
export type QaAuthStateName = QaRole | "default";

export const QA_ROLES: QaRole[] = [
  "owner",
  "tech_admin",
  "location_admin",
  "location_staff",
  "client",
];

const AUTH_STATE_PATH = path.join(process.cwd(), "output", "e2e-auth-state.json");
const AUTH_STATE_DIR = path.join(process.cwd(), "output", "playwright-auth");

export function loadQaEnvValues(): Map<string, string> {
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

  return values;
}

export function loadQaCredentials(role: QaRole | "default" = "default"): QaCredentials | null {
  const values = loadQaEnvValues();
  const keys =
    role === "default"
      ? { email: "KUB_QA_EMAIL", password: ["KUB", "QA", "PASSWORD"].join("_") }
      : {
          email: ["KUB", "QA", role.toUpperCase(), "EMAIL"].join("_"),
          password: ["KUB", "QA", role.toUpperCase(), "PASSWORD"].join("_"),
        };
  const email = process.env[keys.email] || values.get(keys.email);
  const password = process.env[keys.password] || values.get(keys.password);
  if (!email || !password) return null;
  return { email, password };
}

export function findFirstAvailableQaRole(
  roles: QaRole[],
  options?: { includeDefault?: boolean },
): QaAuthStateName | null {
  for (const role of roles) {
    if (loadQaCredentials(role) || hasSavedAuthState(role)) return role;
  }
  if (options?.includeDefault && (loadQaCredentials("default") || hasSavedAuthState("default")))
    return "default";
  return null;
}

export function getAuthStatePath(name: QaAuthStateName = "default"): string {
  if (name === "default") return AUTH_STATE_PATH;
  return path.join(AUTH_STATE_DIR, `${name}.json`);
}

export function hasSavedAuthState(name: QaAuthStateName = "default"): boolean {
  return fs.existsSync(getAuthStatePath(name));
}

export async function gotoOrSkip(page: Page, pathName: string) {
  const response = await page.goto(pathName, { waitUntil: "domcontentloaded" }).catch(() => null);
  test.skip(!response, `KUB_BASE_URL is not reachable: ${test.info().project.use.baseURL}`);
}

export async function loginIfNeeded(
  page: Page,
  credentials: QaCredentials,
  options: { authStateName?: QaAuthStateName } = {},
) {
  const authStateName = options.authStateName ?? "default";
  await restoreAuthState(page, authStateName);

  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 5_000 }).catch(() => null);
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
  await saveAuthState(page, authStateName);
}

export async function loginAsRoleOrSkip(page: Page, role: QaAuthStateName) {
  const credentials = loadQaCredentials(role);
  const hasState = hasSavedAuthState(role);
  test.skip(
    !credentials && !hasState,
    `QA auth state or credentials for '${role}' are not configured`,
  );

  if (credentials) {
    await loginIfNeeded(page, credentials, { authStateName: role });
    return;
  }

  await restoreAuthState(page, role);
  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 3_000 }).catch(() => null);
  test.skip(
    await emailInput.isVisible().catch(() => false),
    `Saved auth state for '${role}' is expired and credentials are not configured`,
  );
  await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 10_000 });
}

async function restoreAuthState(page: Page, name: QaAuthStateName = "default") {
  const statePath = getAuthStatePath(name);
  if (!fs.existsSync(statePath)) return;
  const origin = new URL(page.url()).origin;
  const raw = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
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

async function saveAuthState(page: Page, name: QaAuthStateName = "default") {
  const statePath = getAuthStatePath(name);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  await page.context().storageState({ path: statePath });
}
