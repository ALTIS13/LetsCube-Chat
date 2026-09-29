import { expect, test, type Page } from "@playwright/test";

/**
 * «К последним сообщениям», pressed (D-325).
 *
 * The press hides the button and starts a smooth scroll to the bottom. The
 * scroll handler used to read every frame of that scroll as a reader away from
 * the bottom and put the button back — measured at 390: gone at 6ms, back at
 * 43ms, gone again at 593ms — so the control that had just been pressed blinked
 * and then rode along for the rest of the way. These hold both halves of the
 * fix: the button stays away for the whole of its own scroll, and it comes back
 * as soon as the reader takes the list up again.
 *
 * And D-326, which the second of them found: on a touch phone the recorder
 * hint's plate lay over the button entirely, so a real tap dismissed the hint
 * rather than jumping. The button's own tap is held at both widths; where the
 * hint exists at all — a finger, below `md` — it is also held to make way while
 * the button is up and to come back, budget intact, once the reader is down.
 *
 * The DEV capture route, which needs the dev server started with
 * `VITE_PUBLIC_PREVIEW_FIXTURE=1`. A missing prerequisite throws with the reason
 * rather than skipping, because a check nobody ran is not a check.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const JUMP = 'button[aria-label="К последним сообщениям"]';

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [{ name: "Команда проекта", preview: "Строка 48", time: "09:09", unread: 0 }],
  messages: Array.from({ length: 48 }, (_, index) => ({
    sender: index % 3 === 0 ? "Максим" : "Аня",
    text:
      `Строка ${String(index + 1).padStart(2, "0")} — синтетический текст, ` +
      "достаточно длинный, чтобы занять несколько строк пузыря.",
    time: "09:0" + (index % 10),
    own: index % 3 === 0,
  })),
};

/** How far the list is from its bottom, in pixels. */
function gap(page: Page): Promise<number> {
  return page
    .getByTestId("message-scroll-container")
    .evaluate((element) => Math.round(element.scrollHeight - element.scrollTop - element.clientHeight));
}

/** Opens the fixture conversation and takes the reader well up into its history, with the wheel. */
async function openInTheHistory(page: Page) {
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
  await page.getByTestId("message-scroll-container").hover();
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, -900);
        return gap(page);
      },
      { timeout: 15_000, message: "the reader never got up into the history" },
    )
    .toBeGreaterThan(1500);
  await expect(page.locator(JUMP)).toBeVisible();
}

test.describe("the jump to the latest messages", () => {
  test("stays away for the whole of the scroll it started", async ({ page }) => {
    await openInTheHistory(page);
    const from = await gap(page);

    // Every frame from the press until well after the list has landed.
    const frames = await page.evaluate(async (selector) => {
      const list = document.querySelector('[data-testid="message-scroll-container"]') as HTMLElement;
      const button = document.querySelector(selector) as HTMLButtonElement;
      const seen: Array<{ at: number; shown: boolean; gap: number }> = [];
      const start = performance.now();
      button.click();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const at = Math.round(performance.now() - start);
          seen.push({
            at,
            shown: document.querySelector(selector) !== null,
            gap: Math.round(list.scrollHeight - list.scrollTop - list.clientHeight),
          });
          if (at > 1500) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return seen;
    }, JUMP);

    const gone = frames.findIndex((frame) => !frame.shown);
    expect(gone, "the button never went away").toBeGreaterThanOrEqual(0);
    const back = frames.slice(gone).filter((frame) => frame.shown);
    expect(back, `the button came back during its own scroll: ${JSON.stringify(back.slice(0, 3))}`).toEqual([]);
    // A list that never moved would pass the line above, so the scroll is
    // proved to have travelled — through the band where the old handler put
    // the button back — and to have landed.
    const travelling = frames.filter((frame) => frame.gap > 120 && frame.gap < from - 50);
    expect(travelling.length, "no frame was caught on the way down").toBeGreaterThan(2);
    expect(frames[frames.length - 1].gap).toBeLessThan(2);
  });

  test("comes back as soon as the reader takes the list up again", async ({ page }) => {
    await openInTheHistory(page);
    await page.locator(JUMP).click();
    await expect(page.locator(JUMP)).toBeHidden();
    // Partway down, the reader changes their mind. The button has to be back
    // well inside the 1.2s after which the list gives up on its jump anyway,
    // or this would pass on that fallback alone and prove nothing about the
    // reader taking over.
    await page.waitForTimeout(150);
    await page.getByTestId("message-scroll-container").hover();
    await page.mouse.wheel(0, -1200);
    await expect(page.locator(JUMP)).toBeVisible({ timeout: 800 });
    expect(await gap(page)).toBeGreaterThan(120);
  });

  test("nothing else in its corner takes its tap", async ({ page }) => {
    await openInTheHistory(page);
    const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    const hint = page.getByTestId("kub-hint");
    if (touch) await expect(hint, "the recorder hint was offered over the jump control").toHaveCount(0);

    const hit = await page.locator(JUMP).evaluate((button) => {
      const box = button.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (!top || top === button || button.contains(top)) return "the jump control";
      return `${top.tagName.toLowerCase()} «${top.getAttribute("aria-label") ?? top.textContent?.trim().slice(0, 30)}»`;
    });
    expect(hit, "something lies over the jump control's centre").toBe("the jump control");

    // A real tap, which is what the plate used to take.
    await page.locator(JUMP).click();
    await expect.poll(() => gap(page), { message: "the tap did not take the reader down" }).toBeLessThan(2);
    // Withdrawn, not dismissed: back at the bottom the hint is offered again.
    if (touch) await expect(hint).toBeVisible({ timeout: 5_000 });
  });
});
