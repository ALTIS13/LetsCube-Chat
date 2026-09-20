import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * What happens when a new web build is deployed under an open session (D-264,
 * D-282).
 *
 * Six contracts, and none of them is about a colour.
 *
 * **Reach.** The notice is `fixed`, and so is the chat header. On a phone that
 * header is the only way out of a conversation — rule 12 of
 * `docs/operations/interface-material.md` cost a whole stage to learn — and the
 * composer is the only way to answer in one. So every control of both is
 * hit-tested with `elementFromPoint`: a box that is merely *drawn* over a
 * button is the same defect as one laid out over it. The notice this replaced
 * covered three header controls at 390.
 *
 * **An open conversation is never reloaded out from under anybody.**
 * `selectedChatId` is neither in the URL nor persisted, so a reload lands on
 * the chat list. That is why the tab below is hidden for well past the quiet
 * window and still does not reload: the open conversation is the veto, and it
 * is the only thing stopping it.
 *
 * **A tab nobody is using takes the build by itself.** No call, no conversation
 * open, hidden for longer than the quiet window: the page reloads and says
 * nothing, because there is nothing to say. This is the case the owner
 * reported — he kept a tab open across a deploy and ran a two-commit-old bundle
 * until he pressed F5.
 *
 * **And it will not do it twice.** A restart that does not take — mid-rollover,
 * two replicas, a stale proxy — would otherwise loop in a background tab where
 * nobody could see it.
 *
 * **No question.** There is no dismiss, because there is nothing to postpone.
 * Neither Discord's web client nor either Telegram web client offers one.
 *
 * **The throttle.** A build that is not marked `required` is offered at most
 * once an hour, which is our own deploy cadence; the measurement is in
 * `artifacts/kub/src/lib/pwa/appUpdateNotice.ts`.
 *
 * Plus a photograph at the two release widths in both themes, because the owner
 * judges a visual change by looking at it.
 *
 * The fixture chat is the DEV capture route, which needs the dev server started
 * with `VITE_PUBLIC_PREVIEW_FIXTURE=1`. A missing prerequisite throws with the
 * reason rather than skipping, because a check nobody ran is not a check.
 *
 * `KUB_UPDATE_NOTICE_OUT` names the capture folder; `KUB_UPDATE_NOTICE_LABEL`
 * names the run, so the same spec produces the before and the after set.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const CATALOG = "https://api.letscube.ru/releases/v1/**";
const UPDATE_READY_EVENT = "kub:sw-update-ready";
const SHOWN_KEY = "letscube:app-update:last-shown";
const FIXTURE_CLOCK = new Date("2026-09-03T18:00:00");
/** `QUIET_HIDDEN_MS` is a minute; this is comfortably past it. */
const PAST_QUIET_WINDOW_MS = 90_000;
const OUT = process.env.KUB_UPDATE_NOTICE_OUT ?? "output/update-notice";
const LABEL = process.env.KUB_UPDATE_NOTICE_LABEL ?? "after";

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [
    { name: "Команда проекта", preview: "Строка 48", time: "09:09", unread: 0 },
    ...Array.from({ length: 11 }, (_, index) => ({
      name: `Синтетический чат ${index + 2}`,
      preview: "Текст последнего сообщения для проверки строки списка",
      time: "08:4" + (index % 10),
      unread: index % 3,
    })),
  ],
  messages: Array.from({ length: 48 }, (_, index) => ({
    sender: index % 3 === 0 ? "Максим" : "Аня",
    text:
      `Строка ${String(index + 1).padStart(2, "0")} — синтетический текст, ` +
      "достаточно длинный, чтобы занять несколько строк пузыря.",
    time: "09:0" + (index % 10),
    own: index % 3 === 0,
  })),
};

const VIEWPORTS = [
  { width: 390, height: 844, name: "390" },
  { width: 1440, height: 900, name: "1440" },
] as const;

const THEMES = ["dark", "light"] as const;

/** Counts loads of this origin, so a reload nobody asked for cannot hide. */
const trackLoads = () => {
  const key = "__kubLoads";
  const store = window.sessionStorage;
  const previous = Number(store.getItem(key) ?? "0");
  store.setItem(key, String(Number.isFinite(previous) ? previous + 1 : 1));
};

/**
 * A settable `document.visibilityState`, because no browser automation can put
 * a page in a background tab. The product reads the real API and the real
 * event; only the answer is ours.
 */
const fakeVisibility = () => {
  const target = window as unknown as { __kubHidden?: boolean };
  target.__kubHidden = false;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (target.__kubHidden ? "hidden" : "visible"),
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => Boolean(target.__kubHidden),
  });
};

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((value) => {
    (window as unknown as { __kubHidden?: boolean }).__kubHidden = value;
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

type ClockMode = "fixed" | "controlled";

async function openFixtureChat(page: Page, clockMode: ClockMode = "fixed") {
  // The fixture refuses to render a time later than the capture clock, because
  // it would print a weekday where the product prints a time. `controlled` adds
  // the ability to move that clock forward, which is the only way to reach a
  // minute of being hidden inside a test.
  if (clockMode === "fixed") await page.clock.setFixedTime(FIXTURE_CLOCK);
  else await page.clock.install({ time: FIXTURE_CLOCK });
  await page.route(CATALOG, (route) => route.fulfill({ status: 404, body: "{}" }));
  await page.addInitScript(trackLoads);
  await page.addInitScript(fakeVisibility);
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 20_000 })
        .then(() => true)
        .catch(() => false)
    : false;
  if (!ready) {
    throw new Error(
      "The DEV preview capture surface did not report ready. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1.",
    );
  }
  await expect(page.getByTestId("chat-control-row")).toBeVisible();
}

/**
 * Closes the conversation through the store the product itself reads.
 *
 * The capture surface has no chat list to press «back» into, so the selection
 * is cleared directly — and the module handed over is proved to be the one the
 * application is using before anything is done with it. A dev server that has
 * taken a hot update hands a bare `import()` a *second* copy of the store, with
 * none of the fixture's chats in it; that is silent, and it would turn this
 * test into one that proves nothing. See CLAUDE.md section 5.
 */
async function closeConversation(page: Page) {
  const state = await page.evaluate(async () => {
    const module = (await import("/src/store/app.store.ts")) as {
      useAppStore: {
        getState: () => {
          chats: unknown[];
          selectedChatId: string | null;
          setSelectedChatId: (id: string | null) => void;
        };
      };
    };
    const store = module.useAppStore.getState();
    const before = { chats: store.chats.length, selected: store.selectedChatId };
    store.setSelectedChatId(null);
    return { before, after: module.useAppStore.getState().selectedChatId };
  });
  expect(
    state.before.chats,
    "the imported store holds none of the fixture's chats, so it is a second copy and this test would prove nothing",
  ).toBeGreaterThan(0);
  expect(state.before.selected, "the fixture was expected to open with a conversation").not.toBeNull();
  expect(state.after).toBeNull();
}

async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
  await page.evaluate(() => document.fonts.ready);
}

/** Announce a waiting worker the way `usePwa` does, with no worker present. */
async function announceUpdate(page: Page) {
  await page.evaluate((name) => {
    window.dispatchEvent(new CustomEvent(name, { detail: {} }));
  }, UPDATE_READY_EVENT);
  await page.waitForTimeout(600);
}

/**
 * `null` while the page is between documents.
 *
 * Reading this is how the reload is detected, so the read races the very
 * navigation it is looking for: `page.evaluate` throws «Execution context was
 * destroyed» exactly when the answer is about to change. A poll treats `null`
 * as "not yet"; a flat assertion treats it as the failure it is, because
 * nothing should have been navigating at all.
 */
function loads(page: Page): Promise<number | null> {
  return page
    .evaluate(() => Number(window.sessionStorage.getItem("__kubLoads") ?? "0"))
    .catch(() => null);
}

/** The same count, where the page had better not be navigating at all. */
async function loadCount(page: Page): Promise<number> {
  const value = await loads(page);
  expect(value, "the page was between documents when nothing should have navigated").not.toBeNull();
  return value as number;
}

/**
 * Every control of the chat chrome, hit-tested at its own centre. The header's
 * controls and the composer's are collected separately so a failure names which
 * half of the conversation was taken away.
 */
async function coveredControls(page: Page) {
  return page.evaluate(() => {
    const covered: string[] = [];
    const row = document.querySelector('[data-testid="chat-control-row"]');
    const header = row?.closest("header") ?? row?.parentElement ?? null;
    const composer = document.querySelector("textarea")?.closest("form, div") ?? null;
    for (const [where, scope] of [["header", header], ["composer", composer]] as const) {
      if (!scope) continue;
      for (const control of Array.from(scope.querySelectorAll<HTMLElement>("button, a[href], textarea"))) {
        const box = control.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (!hit || control === hit || control.contains(hit)) continue;
        const name = control.getAttribute("aria-label") ?? control.textContent?.trim().slice(0, 24) ?? "control";
        covered.push(`${where}: ${name} -> ${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 50)}`);
      }
    }
    return covered;
  });
}

test.describe("the update notice", () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`is photographed at ${viewport.name} in the ${theme} theme`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openFixtureChat(page);
        await stampTheme(page, theme);
        await announceUpdate(page);
        mkdirSync(OUT, { recursive: true });
        await page.screenshot({
          path: `${OUT}/${LABEL}-${viewport.name}-${theme}.png`,
          animations: "disabled",
        });
      });
    }
  }

  test("never covers the way out of a conversation, or the way to answer in one", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixtureChat(page);
    await announceUpdate(page);
    await expect(page.getByTestId("app-update-notice")).toBeVisible();

    const blocked = await coveredControls(page);
    expect(blocked, `the update notice covers ${blocked.length} control(s): ${blocked.join(" | ")}`).toEqual([]);
  });

  test("offers no way to postpone it, because there is nothing to postpone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixtureChat(page);
    await announceUpdate(page);
    const notice = page.getByTestId("app-update-notice");
    await expect(notice).toBeVisible();
    // One action, and it is not a question. Neither Discord nor Telegram gives
    // an update notice a dismiss.
    await expect(notice.getByRole("button")).toHaveCount(1);
    await expect(notice.getByRole("button")).toHaveText("Обновить");
    await expect(page.getByRole("button", { name: "Позже" })).toHaveCount(0);
  });

  test("a routine build is not offered again inside the interval", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Seeded from the page's own clock, not from Node's. The fixture pins the
    // page to 2026-09-03 and a time taken here would be weeks in its future —
    // which the module deliberately treats as a clock that went backwards and
    // shows the notice anyway. Measured: that is exactly how this test first
    // failed, and it is the guard working rather than a defect.
    await page.addInitScript(
      ([key, at]) => {
        try {
          window.localStorage.setItem(key as string, String(at));
        } catch {
          // A browser with site data blocked sees every notice; that case is
          // the module's, not this one's.
        }
      },
      [SHOWN_KEY, FIXTURE_CLOCK.getTime() - 30 * 60 * 1000] as const,
    );
    await openFixtureChat(page);
    await announceUpdate(page);
    await expect(page.getByTestId("app-update-notice")).toHaveCount(0);
  });
});

test.describe("taking the build without asking", () => {
  test("an open conversation is never reloaded out from under anybody", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixtureChat(page, "controlled");
    const before = await loadCount(page);
    await announceUpdate(page);
    await expect(page.getByTestId("app-update-notice")).toBeVisible();

    // Everything the quiet rule asks for except the one thing it will not
    // trade: the tab is hidden, and stays hidden well past the quiet window.
    // The conversation is the only veto left, so if it ever stops being one
    // this test is what says so.
    await setHidden(page, true);
    await page.clock.runFor(PAST_QUIET_WINDOW_MS);
    await page.waitForTimeout(500);

    expect(await loadCount(page), "the page reloaded while a conversation was open").toBe(before);
    await setHidden(page, false);
    await expect(page.getByTestId("app-update-notice")).toBeVisible();
  });

  test("a tab nobody is using takes the build by itself", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixtureChat(page, "controlled");
    const before = await loadCount(page);
    await announceUpdate(page);
    await closeConversation(page);

    // The owner's own case: a session held open across a deploy. Before D-282
    // this waited for an F5 that never came.
    await setHidden(page, true);
    await page.clock.runFor(PAST_QUIET_WINDOW_MS);

    await expect
      .poll(() => loads(page), { timeout: 15_000, message: "the tab never took the new build" })
      .toBe(before + 1);
  });

  test("the quiet window starts when the last veto clears, not before", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixtureChat(page, "controlled");
    const before = await loadCount(page);
    await announceUpdate(page);

    // Hidden for well past the window, but inside a conversation the whole
    // time, so nothing may happen yet.
    await setHidden(page, true);
    await page.clock.runFor(PAST_QUIET_WINDOW_MS);
    expect(await loadCount(page)).toBe(before);

    // The conversation closes. The tab has been hidden for a minute and a half
    // by the page's own clock — but it was *busy* for all of it, so the window
    // has to start again now. Half a minute later it is still too early.
    await closeConversation(page);
    await page.clock.runFor(30_000);
    expect(await loadCount(page), "the window was counted from before the veto cleared").toBe(before);

    // And a minute after that, it is not.
    await page.clock.runFor(60_000);
    await expect
      .poll(() => loads(page), { timeout: 15_000, message: "the tab never took the new build" })
      .toBe(before + 1);
  });

  test("a tab that has just restarted itself does not restart again", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixtureChat(page, "controlled");
    const before = await loadCount(page);
    await announceUpdate(page);
    await closeConversation(page);
    await setHidden(page, true);
    await page.clock.runFor(PAST_QUIET_WINDOW_MS);
    await expect.poll(() => loads(page), { timeout: 15_000 }).toBe(before + 1);

    // The page came back. If the deploy is mid-rollover the same bundle comes
    // back with it and the page is pending again at once — which without the
    // cooldown is a reload loop in a background tab, where nobody would see it.
    await expect(page.locator(`[${READY}="true"]`)).toBeAttached();
    await announceUpdate(page);
    await closeConversation(page);
    await setHidden(page, true);
    await page.clock.runFor(PAST_QUIET_WINDOW_MS);
    await page.waitForTimeout(500);
    expect(await loadCount(page), "the tab restarted itself twice in a row").toBe(before + 1);
  });
});
