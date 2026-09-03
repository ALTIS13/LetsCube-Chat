import { expect, test, type Page } from "@playwright/test";

/**
 * D-008: a wrapped message must keep its time inline when the last line has room.
 *
 * The bubble measures how much space is left after the *last* rendered line and
 * puts the time there when it fits. A separate single-line condition used to sit
 * on top of that measurement and refuse every wrapped message, so a bubble whose
 * last line ended well short of the edge still grew a row containing nothing but
 * a right-aligned timestamp. That is what makes a normal conversation read as
 * ragged, and it is what the owner noticed in the product previews.
 *
 * The assertions are geometric rather than structural: whether the time shares a
 * line with the last words is what a reader sees, and a structural check would
 * pass just as well if the markup moved but the layout did not.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";

/** A short line, then a long wrapped one that ends early, then one that ends full. */
const MESSAGES = [
  { sender: "Аня", text: "Коротко", time: "10:01", own: false },
  {
    sender: "Аня",
    // Wraps to several lines and deliberately ends on a very short last line.
    text:
      "Это довольно длинное сообщение, которое обязательно перенесётся на несколько строк в обычном пузыре, а закончится совсем коротко. Да",
    time: "10:02",
    own: false,
  },
  {
    sender: "Аня",
    // Wraps and ends with a long final line that leaves no room for the meta.
    text:
      "Ещё одно длинное сообщение, у которого последняя строка занята текстом почти целиком и места для времени в ней уже не остаётся никакого совсем",
    time: "10:03",
    own: false,
  },
];

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [{ name: "Команда проекта", preview: "Коротко", time: "10:03", unread: 0 }],
  messages: MESSAGES,
};

async function openCapture(page: Page) {
  // Freeze the clock. The fixture guard refuses a message stamped later than
  // "now" — it would render a weekday instead of a time — and the fixture's
  // times are 10:02 and 10:03. Against the wall clock this spec therefore threw
  // before 10am and skipped itself, so it ran only during part of the day and
  // protected nothing the rest of it.
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  test.skip(!response, "the DEV preview capture route is not served by this build");
  const ready = await page
    .locator(`[${READY}="true"]`)
    .waitFor({ state: "attached", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!ready, "the capture route did not report ready; VITE_PUBLIC_PREVIEW_FIXTURE is probably unset");
}

/** For one bubble: is the time on the same line as the last words, or below them? */
async function metaPlacement(page: Page, index: number) {
  return await page.evaluate((position) => {
    const bubbles = Array.from(document.querySelectorAll('[data-message-bubble="true"]'));
    const bubble = bubbles[position];
    if (!bubble) return null;

    const content = bubble.querySelector('[data-message-text-content="true"]');
    const time = Array.from(bubble.querySelectorAll("span")).find((node) =>
      /^\d{1,2}:\d{2}$/.test((node.textContent ?? "").trim()),
    );
    if (!content || !time) return null;

    const lines = Array.from(content.getClientRects());
    const lastLine = lines.at(-1);
    if (!lastLine) return null;
    const timeRect = time.getBoundingClientRect();

    const lineCentre = (lastLine.top + lastLine.bottom) / 2;
    const timeCentre = (timeRect.top + timeRect.bottom) / 2;
    return {
      lineCount: lines.length,
      inline: Math.abs(lineCentre - timeCentre) <= Math.max(8, lastLine.height * 0.75),
      lastLineRight: Math.round(lastLine.right),
      bubbleRight: Math.round(bubble.getBoundingClientRect().right),
      timeRight: Math.round(timeRect.right),
      timeWidth: Math.round(timeRect.width),
      bubblePaddingRight: Math.round(
        Number.parseFloat(window.getComputedStyle(bubble).paddingRight) || 0,
      ),
    };
  }, index);
}

test.describe("message meta placement", () => {
  test("a wrapped message keeps its time inline when the last line has room", async ({ page }) => {
    await openCapture(page);
    await page.waitForTimeout(700);

    const short = await metaPlacement(page, 0);
    expect(short, "the first bubble was not found").not.toBeNull();
    expect(short?.lineCount, "the first message should not wrap").toBe(1);
    expect(short?.inline, "a short message must keep its time inline").toBe(true);

    const wrapped = await metaPlacement(page, 1);
    expect(wrapped, "the second bubble was not found").not.toBeNull();
    expect(wrapped!.lineCount, "the second message should wrap").toBeGreaterThan(1);
    expect(
      wrapped!.inline,
      "a wrapped message whose last line ends short must keep its time inline, not grow a row for it",
    ).toBe(true);
  });

  test("the time sits at the bubble's right edge, not against the last word", async ({ page }) => {
    // The reported defect. A wrapped bubble takes its width from its LONGEST
    // line, so a time that flows after a short final line lands in the middle
    // of the bubble: measured at 348px, 328px and 157px from the right edge of
    // a 560px bubble, against 13px for a single-line message.
    await openCapture(page);
    await page.waitForTimeout(700);

    let checked = 0;
    for (let index = 0; index < 6; index += 1) {
      const meta = await metaPlacement(page, index);
      if (!meta) continue;
      checked += 1;
      const gap = meta.bubbleRight - meta.timeRight;
      expect(
        gap,
        `bubble ${index}: the time is ${gap}px from the right edge, so it is floating in the middle rather than sitting at it`,
      ).toBeLessThanOrEqual(meta.bubblePaddingRight + 6);
      expect(gap, `bubble ${index}: the time has been pushed past the bubble edge`).toBeGreaterThanOrEqual(0);
    }
    expect(checked, "no bubbles were measured").toBeGreaterThan(1);
  });

  /**
   * The anchored branch is asserted as an invariant rather than by building a
   * message that must take it. With `w-fit` bubbles the last line is never the
   * widest, so a wrapped message essentially always has room and the anchored
   * case cannot be constructed reliably from text. What can always be checked
   * is the property that matters either way: an inline time must never sit on
   * top of the words.
   */
  test("an inline time never overlaps the text it sits beside", async ({ page }) => {
    await openCapture(page);
    await page.waitForTimeout(700);

    const overlaps = await page.evaluate(() => {
      const problems: string[] = [];
      for (const bubble of Array.from(document.querySelectorAll('[data-message-bubble="true"]'))) {
        const content = bubble.querySelector('[data-message-text-content="true"]');
        const time = Array.from(bubble.querySelectorAll("span")).find((node) =>
          /^\d{1,2}:\d{2}$/.test((node.textContent ?? "").trim()),
        );
        if (!content || !time) continue;
        const lastLine = Array.from(content.getClientRects()).at(-1);
        if (!lastLine) continue;
        const timeRect = time.getBoundingClientRect();

        const sameRow =
          Math.abs((lastLine.top + lastLine.bottom) / 2 - (timeRect.top + timeRect.bottom) / 2) <=
          Math.max(8, lastLine.height * 0.75);
        if (!sameRow) continue;
        if (timeRect.left < lastLine.right - 1) {
          problems.push(`"${(content.textContent ?? "").slice(0, 24)}…" time starts at ${Math.round(timeRect.left)} but the text runs to ${Math.round(lastLine.right)}`);
        }
      }
      return problems;
    });

    expect(overlaps, `an inline time overlapped the message text: ${overlaps.join(" | ")}`).toEqual([]);
  });

  test("placement is stable and does not oscillate", async ({ page }) => {
    await openCapture(page);
    await page.waitForTimeout(700);

    const first = await metaPlacement(page, 1);
    await page.waitForTimeout(900);
    const second = await metaPlacement(page, 1);
    await page.waitForTimeout(900);
    const third = await metaPlacement(page, 1);

    expect(second?.inline, "placement changed after settling").toBe(first?.inline);
    expect(third?.inline, "placement changed again after settling").toBe(first?.inline);
  });
});
