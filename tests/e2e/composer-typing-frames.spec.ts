import { expect, test, type Page } from "@playwright/test";

/**
 * "Текст прыгает, когда печатаю": a draft that wraps must move the conversation
 * in the frame the composer grows, not after it.
 *
 * The dock sits over the foot of the conversation, and the list pads itself by
 * the dock's measured height. A draft that wraps grows the dock in the same
 * frame as the text, but the height was read from a `ResizeObserver` that put
 * the read off to the next animation frame — and a state update made there is
 * only flushed in a task after that frame. Measured on the DEV preview fixture,
 * identically at 390x844 and 1440x900: the wrapping keystroke painted two frames
 * with the composer 24px over the newest message — its 26px of clearance down to
 * 2px — before the whole conversation jumped 24px; deleting back to one line
 * opened a 50px gap for two frames the same way.
 *
 * Asserted on painted frames rather than on the settled layout, which was
 * correct throughout and so proves nothing about this defect. The other half of
 * the same report, every bubble re-rendering, is `message-render-stability.spec.ts`.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const FRAMES_KEY = "__letscubeComposerFrames";

/** Several viewports of history, so the list is scrolled and has a bottom to hold. */
const MESSAGES = Array.from({ length: 48 }, (_, index) => ({
  sender: index % 3 === 0 ? "Максим" : "Аня",
  text:
    `Строка ${String(index + 1).padStart(2, "0")} — синтетический текст для проверки того, ` +
    "что список не дёргается, пока в поле ввода набирается сообщение.",
  time: "09:0" + (index % 10),
  own: index % 3 === 0,
}));

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [{ name: "Команда проекта", preview: "Строка 48", time: "09:09", unread: 0 }],
  messages: MESSAGES,
};

/** What one painted frame showed. */
type Frame = {
  t: number;
  /** Keystrokes delivered to the composer before this frame. */
  keys: number;
  dockTop: number;
  dockHeight: number;
  /** Bottom edge of the newest bubble. */
  lastBottom: number;
  /** The list's padding-bottom, which is what keeps that bubble clear of the dock. */
  inset: number;
  /** scrollHeight - scrollTop - clientHeight. */
  distance: number;
};

/**
 * Records what each frame painted, with the same two-reading technique as
 * `chat-entry-scroll.spec.ts`: a reading at `requestAnimationFrame`, which runs
 * before that frame's layout, replaced by a reading from a `ResizeObserver`
 * that is delivered after the application's own observers — after every
 * correction the frame is going to make and before it is painted. The surviving
 * reading is pushed at the start of the next frame.
 *
 * The observer is created when recording starts, seconds after the
 * application registered its own, so it is always delivered after them.
 */
function installFrameSampler(framesKey: string) {
  const frames: Frame[] = [];
  let keys = 0;
  let recording = false;
  let pending: Frame | null = null;
  let observer: ResizeObserver | null = null;
  const round = (value: number) => Math.round(value * 10) / 10;

  // A height committed from inside a ResizeObserver callback is only safe while
  // that commit resizes nothing the browser has already delivered for this
  // frame. If it did, the browser reports a loop as a window error — which the
  // application's monitoring forwards — so the frames alone cannot clear it.
  const loopErrors: string[] = [];
  window.addEventListener("error", (event) => {
    if (/ResizeObserver loop/i.test(event.message ?? "")) loopErrors.push(event.message);
  });

  document.addEventListener(
    "input",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target && target.tagName === "TEXTAREA") keys += 1;
    },
    true,
  );

  const read = (): Frame | null => {
    const container = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
    const dock = document.querySelector<HTMLElement>('[data-testid="chat-composer-dock"]');
    const bubbles = container?.querySelectorAll<HTMLElement>('[data-message-bubble="true"]');
    const last = bubbles && bubbles.length ? bubbles[bubbles.length - 1] : null;
    if (!container || !dock || !last) return null;
    const dockBox = dock.getBoundingClientRect();
    return {
      t: Math.round(performance.now()),
      keys,
      dockTop: round(dockBox.top),
      dockHeight: round(dockBox.height),
      lastBottom: round(last.getBoundingClientRect().bottom),
      inset: round(Number.parseFloat(getComputedStyle(container).paddingBottom)),
      distance: Math.round(container.scrollHeight - container.scrollTop - container.clientHeight),
    };
  };

  const tick = () => {
    if (recording) {
      if (pending) frames.push(pending);
      pending = read();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  (window as unknown as Record<string, unknown>)[framesKey] = {
    start: () => {
      const dock = document.querySelector<HTMLElement>('[data-testid="chat-composer-dock"]');
      const textarea = dock?.querySelector("textarea");
      const container = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
      if (!dock || !textarea || !container) return false;
      observer = new ResizeObserver(() => {
        if (!recording) return;
        const late = read();
        if (late) pending = late;
      });
      observer.observe(dock, { box: "border-box" });
      observer.observe(textarea, { box: "border-box" });
      observer.observe(container, { box: "border-box" });
      // Counted from here: the setup typed into the composer too.
      keys = 0;
      frames.length = 0;
      pending = null;
      recording = true;
      return true;
    },
    stop: () => {
      recording = false;
      if (pending) frames.push(pending);
      pending = null;
      observer?.disconnect();
      return { frames: frames.slice(), loopErrors: loopErrors.slice() };
    },
  };
}

async function openCapture(page: Page) {
  // The fixture refuses a message stamped later than "now", so the clock is
  // pinned exactly as the sibling specs pin it.
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  await page.addInitScript(installFrameSampler, FRAMES_KEY);

  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;

  // A missing prerequisite fails loudly, as in every sibling fixture spec.
  if (!ready) {
    if (process.env.KUB_ALLOW_PREVIEW_FIXTURE_SKIP === "1") {
      test.skip(true, "preview fixture route unavailable and skipping was explicitly allowed");
      return;
    }
    throw new Error(
      response
        ? "The preview capture route did not report ready. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1, or set KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1 to accept that this contract goes unchecked."
        : "The DEV preview capture route is not served. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1, or set KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1 to accept that this contract goes unchecked.",
    );
  }

  // Past the entry lock. Chat entry arms a 4200ms bottom lock whose settle
  // timers re-pin the list on their own schedule, and a correction they happen
  // to make would hide a late one from this measurement.
  await page.waitForTimeout(5_200);
}

const composer = (page: Page) => page.locator('[data-testid="chat-composer-dock"] textarea');

/** Words the draft is typed from. Long enough to wrap at every width in the matrix. */
const DRAFT =
  "Сейчас проверю, как ведёт себя поле ввода, когда черновик доходит до края и переносится на новую строку прямо во время набора текста";

/**
 * The longest prefix of `DRAFT` that still fits on the composer's first line.
 *
 * Found against the running layout, because where the line breaks depends on
 * the viewport and on the font the machine has. `fill` goes through React's
 * change handler, so the height is the one the composer really gives itself.
 */
async function longestSingleLinePrefix(page: Page): Promise<{ length: number; lineHeight: number }> {
  const field = composer(page);
  await field.click();
  const heightOf = async (text: string) => {
    await field.fill(text);
    return await field.evaluate(
      (node) =>
        new Promise<number>((resolve) =>
          requestAnimationFrame(() => resolve(Math.round((node as HTMLElement).getBoundingClientRect().height))),
        ),
    );
  };
  const oneLine = await heightOf("а");
  let low = 1;
  let high = DRAFT.length;
  expect(await heightOf(DRAFT), "the draft does not wrap at this width, so no keystroke can grow the composer").toBeGreaterThan(oneLine);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if ((await heightOf(DRAFT.slice(0, middle))) > oneLine) high = middle;
    else low = middle;
  }
  const twoLines = await heightOf(DRAFT.slice(0, high));
  await field.fill("");
  return { length: low, lineHeight: twoLines - oneLine };
}

/** Frames grouped by the keystroke they followed, for the report and the failure message. */
function describeKeystrokes(frames: Frame[], labels: string[]): string[] {
  const lines: string[] = [];
  for (let key = 1; key <= labels.length; key += 1) {
    const group = frames.filter((frame) => frame.keys === key);
    const before = frames.filter((frame) => frame.keys === key - 1).at(-1);
    if (!group.length || !before) continue;
    const steps = group.slice(0, 6).map((frame, index) => {
      const dock = Math.round(frame.dockTop - before.dockTop);
      const bubble = Math.round(frame.lastBottom - before.lastBottom);
      const clearance = Math.round(frame.dockTop - frame.lastBottom);
      return `f${index}: composer ${dock >= 0 ? "+" : ""}${dock} bubble ${bubble >= 0 ? "+" : ""}${bubble} clearance ${clearance} from-bottom ${frame.distance}`;
    });
    lines.push(`key ${key} ${labels[key - 1]}: ${steps.join(" | ")}`);
  }
  return lines;
}

test.describe("composer typing frames", () => {
  test("a draft that wraps moves the conversation in the frame the composer grows", async ({ page }) => {
    await openCapture(page);
    const { length, lineHeight } = await longestSingleLinePrefix(page);
    expect(lineHeight, "the composer did not grow by a line when the draft wrapped").toBeGreaterThan(12);

    // Three characters that still fit, the one that wraps, one more on the new
    // line, and two deletions — the second of which unwraps it again.
    const field = composer(page);
    await field.fill(DRAFT.slice(0, length - 3));
    await page.waitForTimeout(800);

    const started = await page.evaluate((key) => {
      const sampler = (window as unknown as Record<string, { start: () => boolean }>)[key];
      return sampler.start();
    }, FRAMES_KEY);
    expect(started, "the frame sampler could not attach to the conversation").toBe(true);
    await page.waitForTimeout(300);

    const labels: string[] = [];
    for (let index = length - 3; index <= length + 1; index += 1) {
      const character = DRAFT[index];
      labels.push(index === length ? `"${character}" (wraps)` : `"${character}"`);
      await page.keyboard.type(character);
      await page.waitForTimeout(350);
    }
    for (const label of ["Backspace", "Backspace (unwraps)"]) {
      labels.push(label);
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(350);
    }

    const { frames, loopErrors } = await page.evaluate((key) => {
      const sampler = (window as unknown as Record<string, { stop: () => { frames: Frame[]; loopErrors: string[] } }>)[key];
      return sampler.stop();
    }, FRAMES_KEY);
    const report = describeKeystrokes(frames, labels);
    console.log(`[composer-typing] ${test.info().project.name}\n${report.join("\n")}`);

    const typed = frames.filter((frame) => frame.keys > 0);
    expect(typed.length, "no frame was recorded after the first keystroke").toBeGreaterThan(20);
    const heights = typed.map((frame) => frame.dockHeight);
    const resting = frames[0].dockHeight;
    // The premise, asserted: the draft really grew the composer and really
    // shrank it again, or the frames below were never at risk.
    expect(Math.max(...heights) - resting, "no keystroke grew the composer").toBeGreaterThan(lineHeight - 2);
    expect(typed.at(-1)!.dockHeight, "the last deletion did not bring the composer back to one line").toBeCloseTo(resting, 0);

    const clearance = frames[0].dockTop - frames[0].lastBottom;
    const late = typed.filter(
      (frame) => Math.abs(frame.dockTop - frame.lastBottom - clearance) > 1 || frame.distance > 1,
    );
    expect(
      late.map((frame) => `keystroke ${frame.keys}: clearance ${Math.round(frame.dockTop - frame.lastBottom)} (resting ${Math.round(clearance)}), ${frame.distance}px from the bottom`),
      `a frame was painted with the conversation out of step with the composer:\n${report.join("\n")}`,
    ).toEqual([]);

    // And the padding is the composer's height in every one of those frames —
    // the mechanism, not only its symptom.
    const unpadded = typed.filter((frame) => frame.inset < frame.dockHeight);
    expect(
      unpadded.map((frame) => `keystroke ${frame.keys}: padding ${frame.inset} under a ${frame.dockHeight}px composer`),
      "the list was painted padded for a composer shorter than the one over it",
    ).toEqual([]);

    expect(
      loopErrors,
      "committing the composer's height inside its ResizeObserver made the browser report a loop, which monitoring forwards",
    ).toEqual([]);
  });
});
