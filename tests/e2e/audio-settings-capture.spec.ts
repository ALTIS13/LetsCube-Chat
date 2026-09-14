import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * A photograph of the sound settings, not a contract.
 *
 * The owner judges a visual change on rendered pixels, so this exists to
 * produce them at the two release widths in both themes. Every row it seeds is
 * invented. The contract for the same surface is
 * `audio-settings-vocabulary.spec.ts`; this file asserts nothing about the
 * design and is safe to delete once the audit closes.
 */

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const TEAM = "22222222-2222-4222-8222-000000000001";

function seed(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "member", AT)],
    messages: [
      message(
        "55555555-5555-4555-8555-000000000001",
        TEAM,
        ANNA,
        "Смета на витрину готова, посмотри",
        "2026-09-14T10:00:00.000Z",
      ),
    ],
  };
}

async function openSound(page: Page, theme: "dark" | "light") {
  await openFixture(page, { me: ME, people: [ANNA], ...seed() });
  // `openFixture` seeds the dark theme; a later init script wins.
  await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(1);

  const phone = (page.viewportSize()?.width ?? 0) < 768;
  if (phone) {
    await page.getByRole("button", { name: "Меню" }).first().click();
    await page.getByRole("button", { name: "Настройки" }).first().click();
  } else {
    await page.getByTestId("side-menu-button").click();
    await page.getByTestId("side-menu-layer").getByRole("button", { name: "Настройки", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Профиль", exact: true })).toBeVisible();

  await page.getByTestId("settings-open-audio").click();
  const panel = page.getByTestId("settings-section-audio");
  await expect(panel).toBeVisible();
  await panel.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  // The disclosure panel animates in; let it land before the shutter.
  await page.waitForTimeout(400);
  return panel;
}

/**
 * The section is taller than the scrollport, and an element screenshot of a box
 * inside a scroller is clipped to what is on screen — so it is walked down in
 * viewport-sized steps instead, one frame per step.
 */
async function scrollThrough(page: Page, testId: string): Promise<number> {
  return page.evaluate((id) => {
    const panel = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!panel) return 0;
    let node: HTMLElement | null = panel.parentElement;
    while (node && node.scrollHeight <= node.clientHeight + 1) node = node.parentElement;
    const scroller = node ?? document.scrollingElement as HTMLElement;
    (window as unknown as { __audioScroller: HTMLElement }).__audioScroller = scroller;
    const top = panel.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = top;
    return Math.ceil(panel.getBoundingClientRect().height / scroller.clientHeight);
  }, testId);
}

for (const theme of ["dark", "light"] as const) {
  test(`the sound settings, photographed (${theme})`, async ({ page, request }, info) => {
    await requireFixtureServer(request);
    await openSound(page, theme);
    const width = page.viewportSize()?.width ?? 0;
    const tag = `${process.env.KUB_CAPTURE_TAG || "after"}-${width}-${theme}`;
    const frames = await scrollThrough(page, "settings-section-audio");
    for (let i = 0; i <= frames; i += 1) {
      if (i > 0) {
        await page.evaluate(() => {
          const scroller = (window as unknown as { __audioScroller: HTMLElement }).__audioScroller;
          scroller.scrollTop += scroller.clientHeight - 80;
        });
        await page.waitForTimeout(250);
      }
      await page.screenshot({ path: `output/audio/audio-${tag}-${i}.png` });
    }
    info.annotations.push({ type: "capture", description: `output/audio/audio-${tag}-*.png (${frames + 1})` });
  });
}

/**
 * The states that only exist once something has been pressed: a mode set by
 * hand, and a microphone test with self-monitoring running. Chromium's fake
 * device stands in for the hardware — see the reporting note about what that
 * does and does not prove.
 */
test.describe("under a running microphone", () => {
  // `launchOptions` has to be file-level — it forces a new worker, and
  // Playwright refuses it inside a describe. The permission stays here, so the
  // captures above are still taken in the state a person meets first: devices
  // enumerated, names not yet granted.
  test.use({ permissions: ["microphone"] });

  for (const theme of ["dark", "light"] as const) {
    test(`the live states, photographed (${theme})`, async ({ page, request }, info) => {
      await requireFixtureServer(request);
      await openSound(page, theme);
      const width = page.viewportSize()?.width ?? 0;
      const tag = `${process.env.KUB_CAPTURE_TAG || "after"}-${width}-${theme}`;

      // A mode nobody chose: «Вручную» is what the switches put the settings in.
      await page.locator('[data-audio-mode="raw"]').click();
      await page.getByTestId("audio-echo-cancellation").click();
      await page.locator('[data-audio-mode="custom"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `output/audio/audio-${tag}-manual.png` });

      await page.getByTestId("audio-mic-test").click();
      await expect(page.getByTestId("audio-self-monitor")).toBeEnabled();
      await page.getByTestId("audio-self-monitor").click();
      await page.waitForTimeout(600);
      await page.getByTestId("audio-mic-test").scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `output/audio/audio-${tag}-testing.png` });
      info.annotations.push({ type: "capture", description: `output/audio/audio-${tag}-{manual,testing}.png` });
    });
  }
});
