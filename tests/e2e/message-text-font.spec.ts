import { expect, test, type Page } from "@playwright/test";

/**
 * Inter is ours: it renders with every host but this one unreachable.
 *
 * D-287. Until 2026-09-20 the face came from `fonts.googleapis.com` and
 * nothing was bundled, so a phone whose network was blocked or slow read the
 * product in Roboto — and the tester's own report of that day opens with a
 * dropped VPN, which means he may have been judging a face we did not ship.
 *
 * The condition is reproduced rather than described: every request that is not
 * loopback is aborted, which is exactly what killed the *previous* attempt to
 * measure the type. That attempt then read `document.fonts.check`, which
 * answers `true` for a family that never loaded, and measured Segoe UI while
 * believing it had measured Inter — the trap this register carries as
 * «fonts.check is not a check».
 *
 * So the face is proved by width: the same string laid out with the page's own
 * stack and again with Inter struck out of it must come to *different* widths.
 * And because what is shipped is one variable file per subset rather than four
 * static ones, the weight axis is proved the same way — 400 and 700 must also
 * differ, or every bold in the product is a synthesised smear.
 *
 * Needs a dev server started with `VITE_PUBLIC_PREVIEW_FIXTURE=1`.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const PROBE = "Знаешь, который час? The quick brown fox";

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [{ name: "Команда проекта", preview: "Готово", time: "09:40", unread: 0 }],
  messages: [
    { sender: "Аня", text: "Доброе утро! Созвон сегодня в 11:00.", time: "09:02", own: false },
    { sender: "Максим", text: "Готово", time: "09:40", own: true },
  ],
};

test.describe("the product's own face", () => {
  test("Inter renders with every host but this one unreachable, and its weight axis works", async ({ page }) => {
    const offOrigin: string[] = [];
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === "127.0.0.1" || host === "localhost") return route.continue();
      offOrigin.push(host);
      return route.abort();
    });

    await openFixture(page);

    const measured = await page.evaluate((probe) => {
      const span = document.createElement("span");
      span.textContent = probe;
      span.style.cssText = "position:absolute;left:-9999px;top:0;white-space:nowrap;font-size:32px;font-weight:400";
      document.body.appendChild(span);
      const stack = getComputedStyle(document.body).fontFamily;

      span.style.fontFamily = stack;
      const withStack = span.getBoundingClientRect().width;

      span.style.fontFamily = stack
        .split(",")
        .map((s) => s.trim())
        .filter((s) => !/inter/i.test(s))
        .join(", ");
      const withoutInter = span.getBoundingClientRect().width;

      span.style.fontFamily = "Inter";
      span.style.fontWeight = "400";
      const inter400 = span.getBoundingClientRect().width;
      span.style.fontWeight = "700";
      const inter700 = span.getBoundingClientRect().width;

      span.remove();
      return { stack, withStack, withoutInter, inter400, inter700 };
    }, PROBE);

    expect(measured.stack, "the body no longer asks for Inter at all").toMatch(/inter/i);
    // The whole point: a family that never loaded would fall back and these two
    // would be the same number.
    expect(
      Math.abs(measured.withStack - measured.withoutInter),
      "Inter is not the face being rendered — the stack and the stack without it measure the same",
    ).toBeGreaterThan(1);
    expect(
      Math.abs(measured.inter700 - measured.inter400),
      "the weight axis of the variable file does nothing — every bold in the product is synthesised",
    ).toBeGreaterThan(1);

    // And nothing tried to leave this machine to get it.
    expect(
      offOrigin.filter((host) => /googleapis|gstatic/.test(host)),
      "something still reaches for Google's font hosts",
    ).toEqual([]);
  });

  test("the four faces are served from this origin, and none of them is an error page", async ({ page }) => {
    const fonts: { url: string; status: number; type: string | undefined; bytes: number }[] = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/fonts/inter/")) return;
      const body = await response.body().catch(() => Buffer.alloc(0));
      fonts.push({
        url: response.url(),
        status: response.status(),
        type: response.headers()["content-type"],
        bytes: body.length,
      });
    });

    await openFixture(page);
    // Latin and Cyrillic are preloaded; the extended subsets load on demand and
    // this conversation does not reach for them.
    await page.waitForTimeout(500);

    expect(fonts.length, "no font was requested at all — the preloads are gone").toBeGreaterThanOrEqual(2);
    for (const font of fonts) {
      expect(new URL(font.url).hostname, `${font.url} did not come from this origin`).toMatch(/^(127\.0\.0\.1|localhost)$/);
      expect(font.status, `${font.url} answered ${font.status}`).toBe(200);
      // A woff2 begins "wOF2"; an SPA fallback would answer with index.html and
      // a 200, which is the failure this catches.
      expect(font.bytes, `${font.url} is too small to be a font`).toBeGreaterThan(10_000);
    }
  });
});

async function openFixture(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
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
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;
  if (!ready) {
    throw new Error(
      "The DEV preview capture route did not report ready. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1.",
    );
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}
