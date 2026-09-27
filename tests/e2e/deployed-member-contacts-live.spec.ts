import { expect, test } from "@playwright/test";
import { signInFreshOrSkip } from "./helpers/auth";

const PRODUCTION_ORIGIN = "https://app.letscube.ru";

if (process.env.KUB_MEMBER_CONTACTS_DEPLOYED === "1") {
  process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
}

test.use({ screenshot: "off", trace: "off", video: "off" });

test("a deployed ordinary member can open and search contacts", async ({ page }, testInfo) => {
  test.skip(
    !["chromium-desktop-1440", "chromium-mobile-390", "webkit-mobile-390"].includes(testInfo.project.name),
    "the deployed check uses one desktop and two phone engines",
  );
  test.skip(
    process.env.KUB_MEMBER_CONTACTS_DEPLOYED !== "1",
    "opt in only for the deployed LETSCUBE web build",
  );
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  expect(process.env.KUB_BASE_URL).toBe(PRODUCTION_ORIGIN);

  const contactStatuses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/rest/v1/user_contacts") {
      contactStatuses.push(response.status());
    }
  });

  await page.goto(PRODUCTION_ORIGIN, { waitUntil: "domcontentloaded" });
  await signInFreshOrSkip(page, "client");

  if (testInfo.project.name === "chromium-desktop-1440") {
    await page.getByRole("button", { name: "Меню" }).first().click();
    await page.getByRole("dialog", { name: "Боковое меню" })
      .getByRole("button", { name: "Контакты" }).click();
  } else {
    await page.getByRole("navigation", { name: "Навигация" })
      .getByRole("button", { name: "Контакты" }).click();
  }

  const panel = page.getByTestId("contacts-panel");
  await expect(panel).toBeVisible();
  await expect.poll(() => contactStatuses.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(contactStatuses.every((status) => status === 200)).toBe(true);
  await expect(panel.getByRole("alert")).toHaveCount(0);

  const filter = panel.getByRole("textbox", { name: "Поиск контактов" });
  await expect(filter).toBeVisible();
  await filter.fill("qa_nonexistent_contact_79463");
  await expect(panel.getByText("Ничего не найдено")).toBeVisible();
  await filter.clear();

  await panel.getByRole("button", { name: "Добавить контакт" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Добавить контакт" });
  await expect(dialog.getByRole("textbox", { name: "Найти человека" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Найти человека" })
    .fill("qa_nonexistent_contact_79463");
  await expect(dialog.getByText("Пользователи не найдены.")).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});
