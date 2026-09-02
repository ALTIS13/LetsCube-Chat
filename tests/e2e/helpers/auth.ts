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

/**
 * Positive proof that the browser is inside the authenticated shell.
 *
 * Everything here used to be inferred from the *absence* of a password field,
 * which stopped meaning anything the moment a guest at "/" was given the public
 * home instead of the login form: there is no password field on a marketing
 * page either. Every authenticated spec then ran as a guest, and the
 * "authenticated smoke" suite passed without ever signing in.
 *
 * The sidebar menu button only exists once a session is loaded, so it is the
 * marker. A helper that can only say "I did not see a login form" cannot tell
 * signed-in from signed-out, and must not be trusted to.
 */
async function waitForAuthenticatedShell(page: Page, timeout = 15_000): Promise<boolean> {
  return await page
    .getByRole("button", { name: "Меню" })
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

export async function loginIfNeeded(
  page: Page,
  credentials: QaCredentials,
  options: { authStateName?: QaAuthStateName } = {},
) {
  const authStateName = options.authStateName ?? "default";
  await restoreAuthState(page, authStateName);

  // Timings are budgeted against the 45s per-test timeout: an over-generous
  // helper gets torn down mid-sign-in and reports a closed page instead of a
  // failed login. The happy path costs a couple of seconds; these ceilings only
  // apply when something is actually wrong.
  if (await waitForAuthenticatedShell(page, 5_000)) {
    await saveAuthState(page, authStateName);
    return;
  }

  // The form lives at /login and nowhere else. Callers all start at "/", which
  // no longer shows it, so getting there is this helper's job rather than a
  // side effect of a redirect that no longer happens.
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 8_000 });
  const passwordInput = page.locator('input[type="password"]').first();
  const submit = page.locator('button[type="submit"]').first();

  let authenticated = false;
  for (let attempt = 0; attempt < 2 && !authenticated; attempt += 1) {
    await expect(emailInput).toBeEditable();
    await emailInput.fill(credentials.email);
    await expect(passwordInput).toBeEditable();
    await passwordInput.fill(credentials.password);
    await expect(submit).toBeEnabled();
    await submit.click();
    authenticated = await waitForAuthenticatedShell(page, 12_000);
  }

  expect(
    authenticated,
    "sign-in did not reach the authenticated shell; the suite would otherwise have run as a guest",
  ).toBe(true);

  // Only ever persist a state that is actually signed in. Saving unconditionally
  // is how a guest visit overwrote a role's stored session with nothing but the
  // release-catalog cache.
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
  const authenticated = await waitForAuthenticatedShell(page, 8_000);
  test.skip(
    !authenticated,
    `Saved auth state for '${role}' is expired and credentials are not configured`,
  );
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
