import { expect, test } from "@playwright/test";
import { signInFreshOrSkip } from "./helpers/auth";

const PRODUCTION_ORIGIN = "https://app.letscube.ru";

// Playwright 1.59.1 otherwise writes an ariaSnapshot on failure even with all media capture off.
if (process.env.KUB_SIGNED_MEDIA_DEPLOYED === "1") {
  process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
}

test.use({ screenshot: "off", trace: "off", video: "off" });

test("the deployed chat list loads a signed avatar for a QA member", async ({ page }) => {
  test.skip(
    process.env.KUB_SIGNED_MEDIA_DEPLOYED !== "1",
    "opt in only for the deployed LETSCUBE web build",
  );
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  expect(process.env.KUB_BASE_URL).toBe(PRODUCTION_ORIGIN);

  await page.goto(PRODUCTION_ORIGIN, { waitUntil: "domcontentloaded" });
  await signInFreshOrSkip(page, "client");

  const list = page.getByTestId("chat-list-scroller");
  await expect(list).toBeVisible();
  await expect
    .poll(
      () =>
        list.locator("img").evaluateAll(
          (images) =>
            images.filter((element) => {
              const image = element as HTMLImageElement;
              try {
                const url = new URL(image.currentSrc || image.src);
                return (
                  url.origin === "https://core.letscube.ru" &&
                  url.pathname.startsWith("/storage/v1/object/sign/media/") &&
                  image.complete &&
                  image.naturalWidth > 0
                );
              } catch {
                return false;
              }
            }).length,
        ),
      { timeout: 20_000, intervals: [250, 500, 1_000] },
    )
    .toBeGreaterThan(0);
});

test("switching QA accounts removes the previous account's signed chat row", async ({
  browser,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop-1440",
    "one account-switch probe is enough",
  );
  test.skip(
    process.env.KUB_SIGNED_MEDIA_DEPLOYED !== "1",
    "opt in only for the deployed web build",
  );
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  expect(process.env.KUB_BASE_URL).toBe(PRODUCTION_ORIGIN);
  test.setTimeout(90_000);

  await page.goto(PRODUCTION_ORIGIN, { waitUntil: "domcontentloaded" });
  await signInFreshOrSkip(page, "client");
  const clientList = page.getByTestId("chat-list-scroller");
  await expect.poll(() => clientList.getByTestId("chat-list-item").count()).toBeGreaterThan(0);

  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await otherPage.goto(PRODUCTION_ORIGIN, { waitUntil: "domcontentloaded" });
    await signInFreshOrSkip(otherPage, "location_staff");
    const staffList = otherPage.getByTestId("chat-list-scroller");
    await expect.poll(() => staffList.getByTestId("chat-list-item").count()).toBeGreaterThan(0);
    const staffIds = new Set(
      await staffList
        .getByTestId("chat-list-item")
        .evaluateAll((rows) =>
          rows
            .map((row) => row.getAttribute("data-chat-id"))
            .filter((id): id is string => Boolean(id)),
        ),
    );

    const exclusiveSignedId = () =>
      clientList.getByTestId("chat-list-item").evaluateAll(
        (rows, excluded) =>
          rows
            .find((row) => {
              const id = row.getAttribute("data-chat-id");
              const image = row.querySelector("img");
              if (!id || excluded.includes(id) || !image) return false;
              try {
                const url = new URL(image.currentSrc || image.src);
                return (
                  url.origin === "https://core.letscube.ru" &&
                  url.pathname.startsWith("/storage/v1/object/sign/media/") &&
                  image.complete &&
                  image.naturalWidth > 0
                );
              } catch {
                return false;
              }
            })
            ?.getAttribute("data-chat-id") ?? null,
        [...staffIds],
      );
    await expect
      .poll(async () => Boolean(await exclusiveSignedId()), { timeout: 15_000 })
      .toBe(true);
    const clientOnlyId = await exclusiveSignedId();
    expect(clientOnlyId).not.toBeNull();

    await page.getByRole("button", { name: "Меню" }).first().click();
    await page
      .getByRole("dialog", { name: "Боковое меню" })
      .getByRole("button", { name: "Выйти", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "Выйти из аккаунта?" }) })
      .getByRole("button", { name: "Выйти", exact: true })
      .click();
    await expect(page.getByTestId("desktop-app-shell")).toBeHidden({ timeout: 15_000 });

    await signInFreshOrSkip(page, "location_staff");
    const switchedList = page.getByTestId("chat-list-scroller");
    await expect.poll(() => switchedList.getByTestId("chat-list-item").count()).toBeGreaterThan(0);
    const switchedIds = await switchedList
      .getByTestId("chat-list-item")
      .evaluateAll((rows) =>
        rows
          .map((row) => row.getAttribute("data-chat-id"))
          .filter((id): id is string => Boolean(id)),
      );
    expect(switchedIds.some((id) => staffIds.has(id))).toBe(true);
    expect(switchedIds.includes(clientOnlyId!)).toBe(false);
  } finally {
    await otherContext.close();
  }
});
