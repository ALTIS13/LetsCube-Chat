import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * What a person sees when a new web build is deployed under an open session (D-264).
 *
 * Four contracts, and none of them is about a colour.
 *
 * **Reach.** The notice is `fixed`, and so is the chat header. On a phone that
 * header is the only way out of a conversation — rule 12 of
 * `docs/operations/interface-material.md` cost a whole stage to learn — and the
 * composer is the only way to answer in one. So every control of both is
 * hit-tested with `elementFromPoint`: a box that is merely *drawn* over a
 * button is the same defect as one laid out over it. The notice this replaced
 * covered three header controls at 390.
 *
 * **Silence.** Nothing reloads the session by itself. `selectedChatId` is
 * neither in the URL nor persisted, so a reload lands on the chat list; a
 * silent one would trade a visible interruption for an invisible loss.
 *
 * **No question.** There is no dismiss, because there is nothing to postpone:
 * the build applies itself at the next launch either way. Neither Discord's
 * web client nor either Telegram web client offers one.
 *
 * **The throttle.** A build that is not marked `required` is offered at most
 * once every seven days, which is what Discord's stable channel does.
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

async function openFixtureChat(page: Page) {
  // The fixture refuses to render a time later than the capture clock, because
  // it would print a weekday where the product prints a time.
  await page.clock.setFixedTime(FIXTURE_CLOCK);
  await page.route(CATALOG, (route) => route.fulfill({ status: 404, body: "{}" }));
  await page.addInitScript(trackLoads);
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
      "The DEV preview capture route did not report ready. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1.",
    );
  }
  await expect(page.getByTestId("chat-control-row")).toBeVisible();
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

function loads(page: Page) {
  return page.evaluate(() => Number(window.sessionStorage.getItem("__kubLoads") ?? "0"));
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

  test("never reloads the session by itself", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixtureChat(page);
    const before = await loads(page);
    await announceUpdate(page);
    await expect(page.getByTestId("app-update-notice")).toBeVisible();
    // Long enough for any settle timer, quiet-moment timer or controller latch
    // to have fired. A reload here would be a reload nobody asked for.
    await page.waitForTimeout(6000);
    expect(await loads(page), "the page reloaded itself while an update was pending").toBe(before);
    await expect(page.getByTestId("app-update-notice")).toBeVisible();
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
      [SHOWN_KEY, FIXTURE_CLOCK.getTime() - 2 * 24 * 60 * 60 * 1000] as const,
    );
    await openFixtureChat(page);
    await announceUpdate(page);
    await expect(page.getByTestId("app-update-notice")).toHaveCount(0);
  });
});
