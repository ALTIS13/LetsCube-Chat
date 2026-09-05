import path from "node:path";
import { chromium, expect, test, type Page } from "@playwright/test";
import { loadQaCredentials } from "./helpers/auth";

// One phase of the Windows storage suite, driven by scripts/windows-tauri-qa.mjs.
//
// The suite launches the same client six times over one isolated data root.
// This spec asserts what only a running application can show — that the shell
// reports the profile it is actually using, and that the person is still signed
// in on the other side of a move, a failed move, and a cache clear. The
// filesystem is measured by the harness between launches.

const PRODUCTION_ORIGIN = "https://app.letscube.ru";
const PROFILE_DIRECTORY = "webview-production-v1";
const SESSION_MARKER_KEY = "__letscubeStorageQaMarker";
/// Chromium's localStorage commit delay, with room to spare.
const LOCAL_STORAGE_COMMIT_MS = 15_000;

type StorageState = {
  location: string;
  is_default_location: boolean;
  total_bytes: number;
  cache_bytes: number;
  cache_limit_bytes: number;
  min_cache_limit_bytes: number;
  max_cache_limit_bytes: number;
  pending_location: string | null;
};

const phase = process.env.LETSCUBE_TAURI_QA_STORAGE_PHASE ?? "";
const dataRoot = process.env.LETSCUBE_TAURI_QA_DATA_ROOT ?? "";
const relocationParent = process.env.LETSCUBE_TAURI_QA_STORAGE_TARGET ?? "";

test.describe("LETSCUBE Windows storage", () => {
  test(`survives the ${phase || "storage"} phase`, async ({}, testInfo) => {
    test.skip(process.platform !== "win32", "Tauri WebView2 QA is Windows-only");
    test.skip(
      testInfo.project.name !== "chromium-desktop-1440",
      "the native shell owns its viewport and runs once",
    );
    const cdpUrl = process.env.LETSCUBE_TAURI_CDP_URL;
    if (!cdpUrl || !phase || !dataRoot || !relocationParent) {
      throw new Error(
        "The storage spec runs only under scripts/windows-tauri-qa.mjs, which supplies the CDP endpoint, the phase and the isolated data root.",
      );
    }
    const credentials = loadQaCredentials("owner") ?? loadQaCredentials("default");
    if (!credentials) {
      throw new Error(
        "The storage suite must sign in to prove a session survives a move; no QA credentials are configured.",
      );
    }
    test.setTimeout(180_000);

    const defaultProfile = path.join(dataRoot, PROFILE_DIRECTORY);
    const relocatedProfile = path.join(relocationParent, PROFILE_DIRECTORY);

    const browser = await connectToTauri(validateCdpUrl(cdpUrl));
    try {
      const page = await reachProduction(browser);

      if (phase === "record") {
        // Before anything is recorded: the shell must already be living inside
        // the directory this suite owns. If it is not, the seam was not
        // honoured and the next phase would relocate the user's real profile.
        const initial = await storageState(page);
        expect(
          initial.location,
          "the client must resolve its profile inside the isolated QA data root",
        ).toBe(defaultProfile);
        expect(initial.is_default_location).toBe(true);
        expect(initial.pending_location).toBeNull();

        const keys = await signIn(page, credentials);
        await page.evaluate(
          ([key, value]) => localStorage.setItem(key, value),
          [SESSION_MARKER_KEY, `phase-record-${Date.now()}`] as const,
        );
        console.log(
          `[storage-qa] signed in; session keys present: ${JSON.stringify(keys)}`,
        );
        // Chromium commits localStorage on a timer, and this client is stopped
        // by being killed. Without waiting for that commit, the next phase would
        // find no session and blame the move for a write that never happened.
        await page.waitForTimeout(LOCAL_STORAGE_COMMIT_MS);

        // A floor limit, so a later phase can exceed it without planting gigabytes.
        const limited = await invoke<StorageState>(page, "desktop_set_cache_limit", { bytes: 0 });
        expect(limited.cache_limit_bytes).toBe(limited.min_cache_limit_bytes);

        const recorded = await invoke<StorageState>(page, "desktop_set_storage_location", {
          location: relocationParent,
        });
        expect(
          recorded.pending_location,
          "a chosen folder gets a profile directory of ours inside it",
        ).toBe(relocatedProfile);
        expect(
          recorded.location,
          "a live profile cannot be moved, so the location must not change yet",
        ).toBe(defaultProfile);
        expect(recorded.is_default_location).toBe(true);
        return;
      }

      // One phase deliberately breaks a relocation half way through, and is
      // here to record what the person is left with rather than to require that
      // it be good. Its verdict is the harness's, taken from the tree.
      if (phase === "orphan") {
        const observed = await observeSession(page);
        const state = await storageState(page).catch(() => null);
        console.log(
          `[storage-qa] ${phase}: ${JSON.stringify({ ...observed, location: state?.location, totalBytes: state?.total_bytes })}`,
        );
        expect(observed.url, "the client must have reached production at all").toContain(
          PRODUCTION_ORIGIN,
        );
        return;
      }

      // Every other phase begins already signed in, because the session came
      // through whatever the previous phase did to the profile.
      const marker = await expectStillSignedIn(page);

      if (phase === "settle") {
        const settled = await storageState(page);
        expect(settled.location, "the recorded relocation must have been carried out").toBe(
          relocatedProfile,
        );
        expect(settled.is_default_location).toBe(false);
        expect(settled.pending_location).toBeNull();
        expect(marker, "the signed-in session moved with the profile").toContain("phase-record-");
        return;
      }

      if (phase === "blocked") {
        const afterFailure = await storageState(page);
        expect(
          afterFailure.location,
          "a relocation that could not be carried out must leave the app on the original",
        ).toBe(relocatedProfile);
        expect(
          afterFailure.pending_location,
          "a failed relocation must not be retried on every launch",
        ).toBeNull();
        expect(marker).toContain("phase-record-");

        // The runtime clear, with the engine holding part of the cache open.
        const cleared = await invoke<StorageState>(page, "desktop_clear_cache", {});
        expect(cleared.cache_bytes).toBeLessThanOrEqual(afterFailure.cache_bytes);
        expect(cleared.location).toBe(relocatedProfile);
        await page.reload({ waitUntil: "domcontentloaded" });
        const survived = await expectStillSignedIn(page);
        expect(survived, "clearing the cache must not sign anyone out").toBe(marker);
        return;
      }

      if (phase === "cache") {
        const trimmed = await storageState(page);
        expect(
          trimmed.cache_bytes,
          "an over-budget cache must be back under its limit after a launch",
        ).toBeLessThanOrEqual(trimmed.cache_limit_bytes);
        expect(marker, "trimming an over-budget cache must not sign anyone out").toContain(
          "phase-record-",
        );
        return;
      }

      if (phase === "again") {
        const moved = await storageState(page);
        expect(
          moved.location,
          "a second relocation, out of a chosen location rather than the default one",
        ).toBe(path.join(dataRoot, "again", PROFILE_DIRECTORY));
        expect(moved.is_default_location).toBe(false);
        expect(moved.pending_location).toBeNull();
        expect(marker, "the session came through a second move too").toContain("phase-record-");
        return;
      }

      throw new Error(`Unknown storage phase: ${phase}`);
    } finally {
      await browser.close();
    }
  });
});

async function reachProduction(browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>) {
  const contexts = browser.contexts();
  expect(contexts).toHaveLength(1);
  const pages = contexts[0].pages();
  expect(pages).toHaveLength(1);
  const page = pages[0];
  await page.waitForURL("http://tauri.localhost/startup.html");
  await page.evaluate(async () => {
    await window.__TAURI_INTERNALS__?.invoke("begin_startup_qa");
  });
  await page.waitForURL((url) => url.origin === PRODUCTION_ORIGIN, {
    timeout: 60_000,
    waitUntil: "domcontentloaded",
  });
  return page;
}

const productionShell = '[data-testid="app-top-bar"], [data-testid="sidebar-brand-strip"]';

async function signIn(page: Page, credentials: { email: string; password: string }) {
  const emailInput = page.locator('input[type="email"]');
  const shell = page.locator(productionShell).first();
  // `isVisible` is a point-in-time question, and asking it of an application
  // that is still mounting answers "no" and skips the sign-in it was guarding.
  // Wait for whichever of the two surfaces arrives first, then decide.
  await expect(emailInput.or(shell).first()).toBeVisible({ timeout: 60_000 });
  if (await emailInput.isVisible()) {
    await emailInput.fill(credentials.email);
    await page.locator('input[type="password"]').fill(credentials.password);
    await page.locator('button[type="submit"]').click();
  }
  await expect(shell).toBeVisible({ timeout: 60_000 });
  const keys = await authTokenKeys(page);
  expect(keys.length, "signing in must leave an auth token in the profile").toBeGreaterThan(0);
  return keys;
}

/// The names of the keys the session lives under. Never their values.
///
/// `kub-auth` is this application's configured Supabase `storageKey`; the
/// `sb-…-auth-token` form is the library default, kept so a change of that
/// setting shows up as a different key rather than as no session at all.
async function authTokenKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key === "kub-auth" || /^sb-.+-auth-token(\.\d+)?$/.test(key))
      .sort(),
  );
}

/// Everything that says whether this person is still signed in, gathered in one
/// pass so a failure names what survived and what did not rather than only the
/// first thing found missing.
async function observeSession(page: Page) {
  const shellVisible = await page
    .locator(productionShell)
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  return {
    url: page.url(),
    shellVisible,
    signInFields: await page.locator('input[type="password"]').count(),
    authTokenKeys: await authTokenKeys(page),
    marker: await page.evaluate((key) => localStorage.getItem(key), SESSION_MARKER_KEY),
  };
}

/// The measurement that costs a user something if it fails.
///
/// The auth token is the session; the marker is this suite's own witness that
/// the same profile came through. Both are gathered before anything is asserted
/// so a failure names what survived and what did not, rather than only the
/// first thing that went missing.
async function expectStillSignedIn(page: Page): Promise<string> {
  const observed = await observeSession(page);
  expect(
    {
      shellVisible: observed.shellVisible,
      signInFields: observed.signInFields,
      hasAuthToken: observed.authTokenKeys.length > 0,
      hasMarker: observed.marker !== null,
    },
    `the signed-in session must have survived; observed ${JSON.stringify(observed)}`,
  ).toEqual({ shellVisible: true, signInFields: 0, hasAuthToken: true, hasMarker: true });
  return observed.marker as string;
}

async function storageState(page: Page) {
  return invoke<StorageState>(page, "desktop_get_storage_state", {});
}

async function invoke<T>(page: Page, command: string, args: Record<string, unknown>): Promise<T> {
  return (await page.evaluate(
    async ([name, payload]) =>
      window.__TAURI_INTERNALS__?.invoke(name as string, payload as Record<string, unknown>),
    [command, args] as const,
  )) as T;
}

function validateCdpUrl(value: string): string {
  const url = new URL(value);
  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65_535
  ) {
    throw new Error("LETSCUBE_TAURI_CDP_URL must be an uncredentialed loopback HTTP origin.");
  }
  return url.origin;
}

async function connectToTauri(cdpUrl: string) {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(cdpUrl);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out connecting to the loopback Tauri CDP endpoint: ${String(lastError)}`);
}
