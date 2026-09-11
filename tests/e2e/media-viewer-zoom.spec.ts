import { expect, test, type Page } from "@playwright/test";
import { emulateInstalledIosApp, IPHONE_14_PRO } from "./helpers/ios-standalone";

/**
 * "Нельзя увеличить фото": the photo viewer zooms.
 *
 * The page refuses page zoom on purpose — `maximum-scale=1, user-scalable=no` —
 * so until the viewer zoomed, a photo could only ever be seen fitted to the
 * screen. The arithmetic of every gesture is unit-tested in
 * `tests/unit/media-zoom.test.mts`; this spec is the browser half: that input
 * reaches that arithmetic, and that what is drawn is what it decided.
 *
 * Every photo here is an inline SVG injected through the DEV preview fixture,
 * which accepts nothing but a `data:image/` address, and the fixture's backend
 * host is answered locally. Nothing is fetched from anywhere real.
 *
 * Mouse gestures use Playwright's real input. A pinch and a double tap have no
 * real-input API that works in both engines, so they are dispatched as the
 * `PointerEvent`s a touch screen produces — the events the viewer listens to.
 * The same goes for Ctrl+wheel in mobile WebKit, which Playwright gives no
 * wheel at all; see `ctrlWheel`.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const WHEEL_KEY = "__letscubeWheelOutcomes";

/** A 4:3 test card: a grid to see a zoom by, and a label to tell two photos apart. */
function testCard(label: string, hue: number): string {
  const lines = [
    ...Array.from({ length: 11 }, (_, i) => `<line x1="${i * 120}" y1="0" x2="${i * 120}" y2="900"/>`),
    ...Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${i * 112.5}" x2="1200" y2="${i * 112.5}"/>`),
  ].join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">` +
    `<rect width="1200" height="900" fill="hsl(${hue} 45% 24%)"/>` +
    `<g stroke="hsl(${hue} 70% 62%)" stroke-width="3">${lines}</g>` +
    `<circle cx="600" cy="450" r="90" fill="none" stroke="white" stroke-width="10"/>` +
    `<rect x="0" y="0" width="240" height="180" fill="hsl(${(hue + 150) % 360} 70% 55%)"/>` +
    `<text x="600" y="150" font-family="Arial, sans-serif" font-size="110" font-weight="700" fill="white" text-anchor="middle">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const FIRST = "Первый этаж";
const SECOND = "Второй этаж";

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [{ name: "Команда проекта", preview: "Фото", time: "09:09", unread: 0 }],
  messages: [
    { sender: "Аня", text: "Вот обе схемы", time: "09:01", own: false },
    { sender: "Аня", text: FIRST, time: "09:02", own: false, image: { url: testCard("A", 205), width: 1200, height: 900 } },
    { sender: "Максим", text: SECOND, time: "09:03", own: true, image: { url: testCard("B", 340), width: 1200, height: 900 } },
  ],
};

type Point = { x: number; y: number };
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type View = {
  stage: Rect;
  picture: Rect;
  /** The picture's fitted size: its layout box, which a transform does not change. */
  fitted: { width: number; height: number };
  scale: number;
  /** The drawn picture's centre, from the stage's centre. */
  offset: Point;
};

async function openCapture(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  // The fixture's backend host. A picture makes the list ask for its variants;
  // answering here keeps the run deterministic and offline.
  await page.route(/^http:\/\/127\.0\.0\.1:54321\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  await page.addInitScript((key) => {
    // What became of every Ctrl+wheel: a browser that zoomed the page instead of
    // the photo is exactly the failure this spec exists for.
    const outcomes: boolean[] = [];
    (window as unknown as Record<string, unknown>)[key] = outcomes;
    window.addEventListener("wheel", (event) => {
      if (event.ctrlKey) outcomes.push(event.defaultPrevented);
    });
  }, WHEEL_KEY);

  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;
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
}

/** Opens the photo whose caption is `caption`, from its bubble, and waits for it to be drawn. */
async function openPhoto(page: Page, caption: string) {
  const bubble = page.locator('[data-message-bubble="true"]', { hasText: caption });
  await bubble.getByRole("button", { name: "Открыть фото" }).click();
  await expect(page.getByRole("dialog", { name: caption })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const picture = document.querySelector<HTMLImageElement>('[data-testid="media-viewer-stage"] img');
        return Boolean(picture && picture.complete && picture.naturalWidth > 0 && picture.offsetWidth > 0);
      }),
    )
    .toBe(true);
}

async function view(page: Page): Promise<View> {
  // A frame for React to commit what the last event decided.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('[data-testid="media-viewer-stage"]');
    const picture = stage?.querySelector<HTMLImageElement>("img");
    if (!stage || !picture) throw new Error("the viewer's stage is not on screen");
    const box = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const s = box(stage);
    const p = box(picture);
    return {
      stage: s,
      picture: p,
      fitted: { width: picture.offsetWidth, height: picture.offsetHeight },
      scale: p.width / picture.offsetWidth,
      offset: {
        x: p.left + p.width / 2 - (s.left + s.width / 2),
        y: p.top + p.height / 2 - (s.top + s.height / 2),
      },
    };
  });
}

const centreOf = (rect: Rect): Point => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

/**
 * Where the model says the picture's centre goes when a picture at rest is
 * zoomed to `scale` at `focus`: the point under the focus stays under it, until
 * an edge of the picture would come inside the stage.
 */
function expectedOffset(before: View, focus: Point, scale: number): Point {
  const centre = centreOf(before.stage);
  const axis = (relative: number, fitted: number, stage: number) => {
    const limit = Math.max(0, (fitted * scale - stage) / 2);
    return Math.min(limit, Math.max(-limit, relative * (1 - scale)));
  };
  return {
    x: axis(focus.x - centre.x, before.fitted.width, before.stage.width),
    y: axis(focus.y - centre.y, before.fitted.height, before.stage.height),
  };
}

/** On each axis the picture either still covers the stage or is centred in it — never lost off it. */
function expectNeverLost(current: View, context: string) {
  for (const [axis, size, start, end, stageStart, stageEnd, offset] of [
    ["horizontally", current.picture.width, current.picture.left, current.picture.right, current.stage.left, current.stage.right, current.offset.x],
    ["vertically", current.picture.height, current.picture.top, current.picture.bottom, current.stage.top, current.stage.bottom, current.offset.y],
  ] as const) {
    const stageSize = stageEnd - stageStart;
    if (size > stageSize + 1) {
      expect(start, `${context}: an empty band opened ${axis} before the picture`).toBeLessThanOrEqual(stageStart + 1);
      expect(end, `${context}: an empty band opened ${axis} after the picture`).toBeGreaterThanOrEqual(stageEnd - 1);
    } else {
      expect(Math.abs(offset), `${context}: a picture no larger than the stage drifted off centre ${axis}`).toBeLessThanOrEqual(1);
    }
  }
}

function expectAtRest(current: View, context: string) {
  expect(current.scale, `${context}: the picture is not at its fitted size`).toBeCloseTo(1, 2);
  expect(Math.abs(current.offset.x) + Math.abs(current.offset.y), `${context}: the picture is not centred`).toBeLessThanOrEqual(1);
}

/** A sequence of touch pointer events, dispatched on the stage as a touch screen would. */
async function touch(
  page: Page,
  steps: { type: "pointerdown" | "pointermove" | "pointerup"; id: number; x: number; y: number }[],
) {
  await page.evaluate((events) => {
    const stage = document.querySelector('[data-testid="media-viewer-stage"]');
    if (!stage) throw new Error("the viewer's stage is not on screen");
    for (const step of events) {
      stage.dispatchEvent(
        new PointerEvent(step.type, {
          pointerId: step.id,
          pointerType: "touch",
          isPrimary: step.id === 1,
          clientX: step.x,
          clientY: step.y,
          button: 0,
          buttons: step.type === "pointerup" ? 0 : 1,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    }
  }, steps);
}

/**
 * `times` wheel steps of `deltaY` at `point`, with Ctrl held.
 *
 * Real input wherever Playwright has a wheel. Mobile WebKit has none — the call
 * throws — so there the same `WheelEvent` is dispatched on whatever is under the
 * point. The viewer's listener reads only what both carry: `ctrlKey`, the
 * deltas and the position. That keeps Safari's engine under test rather than
 * skipping it. It says nothing about a trackpad in Safari, which sends a pinch
 * as its own gesture events rather than as a wheel; the viewer does not handle
 * those, and no project here can produce them.
 */
async function ctrlWheel(page: Page, point: Point, deltaY: number, times: number, synthetic: boolean) {
  if (!synthetic) {
    await page.mouse.move(point.x, point.y);
    await page.keyboard.down("Control");
    for (let step = 0; step < times; step += 1) await page.mouse.wheel(0, deltaY);
    await page.keyboard.up("Control");
    return;
  }
  await page.evaluate(
    ({ point, deltaY, times }) => {
      for (let step = 0; step < times; step += 1) {
        const target = document.elementFromPoint(point.x, point.y);
        if (!target) throw new Error("nothing is under the wheel");
        target.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY,
            deltaMode: 0,
            clientX: point.x,
            clientY: point.y,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      }
    },
    { point, deltaY, times },
  );
}

test.describe("media viewer zoom", () => {
  test("a double click zooms in at the point, and a second one zooms back out", async ({ page }) => {
    await openCapture(page);
    await openPhoto(page, FIRST);
    const before = await view(page);
    expectAtRest(before, "on opening");

    const centre = centreOf(before.stage);
    const focus = { x: centre.x - before.fitted.width * 0.2, y: centre.y + before.fitted.height * 0.15 };
    await page.mouse.dblclick(focus.x, focus.y);
    const zoomed = await view(page);
    expect(zoomed.scale, "a double click did not zoom to 2.5x").toBeCloseTo(2.5, 1);
    const expected = expectedOffset(before, focus, zoomed.scale);
    expect(Math.abs(zoomed.offset.x - expected.x), "the clicked point did not stay under the cursor horizontally").toBeLessThanOrEqual(1.5);
    expect(Math.abs(zoomed.offset.y - expected.y), "the clicked point did not stay under the cursor vertically").toBeLessThanOrEqual(1.5);
    expectNeverLost(zoomed, "after the double click");

    await page.mouse.dblclick(focus.x, focus.y);
    expectAtRest(await view(page), "after the second double click");
    await expect(page.getByRole("dialog", { name: FIRST }), "a double click closed the viewer").toBeVisible();
  });

  test("a double tap zooms in at the point, and a second one zooms back out", async ({ page }) => {
    await openCapture(page);
    await openPhoto(page, FIRST);
    const before = await view(page);
    const centre = centreOf(before.stage);
    const focus = { x: centre.x + before.fitted.width * 0.25, y: centre.y - before.fitted.height * 0.1 };

    const tap = [
      { type: "pointerdown" as const, id: 1, ...focus },
      { type: "pointerup" as const, id: 1, ...focus },
    ];
    await touch(page, tap);
    // One tap is not a double tap: nothing moves.
    expectAtRest(await view(page), "after a single tap");
    await touch(page, tap);
    const zoomed = await view(page);
    expect(zoomed.scale, "a double tap did not zoom to 2.5x").toBeCloseTo(2.5, 1);
    const expected = expectedOffset(before, focus, zoomed.scale);
    expect(Math.abs(zoomed.offset.x - expected.x), "the tapped point did not stay under the finger").toBeLessThanOrEqual(1.5);
    expect(Math.abs(zoomed.offset.y - expected.y), "the tapped point did not stay under the finger").toBeLessThanOrEqual(1.5);

    // Two taps a moment apart.
    await touch(page, tap);
    await page.waitForTimeout(80);
    await touch(page, tap);
    expectAtRest(await view(page), "after the second double tap");
  });

  test("Ctrl with the wheel zooms about the cursor, between fitted and four times", async ({ page, browserName, isMobile }) => {
    const synthetic = browserName === "webkit" && isMobile;
    await openCapture(page);
    await openPhoto(page, FIRST);
    const before = await view(page);
    const centre = centreOf(before.stage);
    const focus = { x: centre.x + before.fitted.width * 0.1, y: centre.y + before.fitted.height * 0.05 };
    const pageScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);

    await ctrlWheel(page, focus, -100, 1, synthetic);
    const notch = await view(page);
    expect(notch.scale, "a notch of Ctrl+wheel did not zoom in").toBeGreaterThan(1.3);
    expect(notch.scale, "a single notch jumped too far").toBeLessThan(2.2);
    const expected = expectedOffset(before, focus, notch.scale);
    expect(Math.abs(notch.offset.x - expected.x), "the point under the cursor moved horizontally").toBeLessThanOrEqual(1.5);
    expect(Math.abs(notch.offset.y - expected.y), "the point under the cursor moved vertically").toBeLessThanOrEqual(1.5);

    await ctrlWheel(page, focus, -100, 12, synthetic);
    const deepest = await view(page);
    expect(deepest.scale, "Ctrl+wheel zoomed past four times").toBeLessThanOrEqual(4.01);
    expect(deepest.scale, "Ctrl+wheel stopped short of four times").toBeGreaterThan(3.95);
    expectNeverLost(deepest, "at four times");

    await ctrlWheel(page, focus, 100, 20, synthetic);
    expectAtRest(await view(page), "after zooming all the way back out");

    const outcomes = await page.evaluate((key) => (window as unknown as Record<string, boolean[]>)[key], WHEEL_KEY);
    expect(outcomes.length, "no Ctrl+wheel reached the page, so nothing was tested").toBeGreaterThanOrEqual(33);
    expect(outcomes.filter((prevented) => !prevented).length, "a Ctrl+wheel was left for the browser to zoom the page with").toBe(0);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1), "the page itself was zoomed").toBe(pageScale);
  });

  test("zoomed, a drag pans the picture and can never take it off the stage", async ({ page }) => {
    await openCapture(page);
    await openPhoto(page, FIRST);
    const before = await view(page);
    const centre = centreOf(before.stage);
    await page.mouse.dblclick(centre.x, centre.y);
    const zoomed = await view(page);
    expect(zoomed.scale).toBeCloseTo(2.5, 1);

    // Far past every edge, towards the bottom right.
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 40, centre.y + 30, { steps: 4 });
    const partway = await view(page);
    expect(partway.offset.x - zoomed.offset.x, "a drag did not move the zoomed picture").toBeGreaterThan(20);
    await page.mouse.move(centre.x + 3000, centre.y + 3000, { steps: 6 });
    await page.mouse.up();
    const flung = await view(page);
    const limitX = Math.max(0, (flung.picture.width - flung.stage.width) / 2);
    expect(flung.offset.x, "the drag did not stop at the edge").toBeCloseTo(limitX, 0);
    expectNeverLost(flung, "after a drag far to the bottom right");
    await expect(page.getByRole("dialog", { name: FIRST }), "panning closed the viewer").toBeVisible();

    // And back past the opposite edges.
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x - 3000, centre.y - 3000, { steps: 6 });
    await page.mouse.up();
    const back = await view(page);
    expect(back.offset.x, "the drag back did not stop at the other edge").toBeCloseTo(-limitX, 0);
    expectNeverLost(back, "after a drag far to the top left");
  });

  test("at rest, a drag moves nothing and closes nothing", async ({ page }) => {
    // At rest a drag belongs to whatever holds the viewer, so a swipe gesture
    // and panning can never both answer it.
    await openCapture(page);
    await openPhoto(page, FIRST);
    const before = await view(page);
    const centre = centreOf(before.stage);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 120, centre.y + 90, { steps: 5 });
    await page.mouse.up();
    expectAtRest(await view(page), "after a drag at rest");
    await touch(page, [
      { type: "pointerdown", id: 1, ...centre },
      { type: "pointermove", id: 1, x: centre.x - 90, y: centre.y + 140 },
      { type: "pointerup", id: 1, x: centre.x - 90, y: centre.y + 140 },
    ]);
    expectAtRest(await view(page), "after a swipe at rest");
    await expect(page.getByRole("dialog", { name: FIRST })).toBeVisible();
  });

  test("a pinch zooms about the fingers and follows them, and closing the fingers returns to rest", async ({ page }) => {
    await openCapture(page);
    await openPhoto(page, FIRST);
    const before = await view(page);
    const centre = centreOf(before.stage);
    const mid = { x: centre.x + before.fitted.width * 0.12, y: centre.y };

    await touch(page, [
      { type: "pointerdown", id: 1, x: mid.x - 50, y: mid.y },
      { type: "pointerdown", id: 2, x: mid.x + 50, y: mid.y },
    ]);
    for (const half of [70, 90, 110, 125]) {
      await touch(page, [
        { type: "pointermove", id: 1, x: mid.x - half, y: mid.y },
        { type: "pointermove", id: 2, x: mid.x + half, y: mid.y },
      ]);
    }
    const spread = await view(page);
    expect(spread.scale, "spreading two fingers from 100px to 250px did not zoom 2.5x").toBeCloseTo(2.5, 1);
    const expected = expectedOffset(before, mid, spread.scale);
    expect(Math.abs(spread.offset.x - expected.x), "the picture slid out from under the fingers").toBeLessThanOrEqual(1.5);
    expect(Math.abs(spread.offset.y - expected.y), "the picture slid out from under the fingers").toBeLessThanOrEqual(1.5);

    // Both fingers move together: the picture follows them.
    await touch(page, [
      { type: "pointermove", id: 1, x: mid.x - 125 - 30, y: mid.y },
      { type: "pointermove", id: 2, x: mid.x + 125 - 30, y: mid.y },
    ]);
    const moved = await view(page);
    expect(moved.offset.x - spread.offset.x, "a two-finger drag did not pan").toBeCloseTo(-30, 0);
    expectNeverLost(moved, "during the pinch");

    // Closing the fingers past where they started comes back to rest.
    await touch(page, [
      { type: "pointermove", id: 1, x: mid.x - 15, y: mid.y },
      { type: "pointermove", id: 2, x: mid.x + 15, y: mid.y },
      { type: "pointerup", id: 1, x: mid.x - 15, y: mid.y },
      { type: "pointerup", id: 2, x: mid.x + 15, y: mid.y },
    ]);
    expectAtRest(await view(page), "after closing the fingers");
    await expect(page.getByRole("dialog", { name: FIRST }), "a pinch closed the viewer").toBeVisible();
  });

  test("the zoom resets when the viewer closes, and another photo opens at rest", async ({ page }) => {
    await openCapture(page);
    await openPhoto(page, FIRST);
    const first = await view(page);
    await page.mouse.dblclick(centreOf(first.stage).x, centreOf(first.stage).y);
    expect((await view(page)).scale).toBeCloseTo(2.5, 1);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: FIRST })).toBeHidden();
    await openPhoto(page, FIRST);
    expectAtRest(await view(page), "the same photo, opened again");

    const again = await view(page);
    await page.mouse.dblclick(centreOf(again.stage).x, centreOf(again.stage).y);
    expect((await view(page)).scale).toBeCloseTo(2.5, 1);
    await page.getByRole("dialog", { name: FIRST }).getByRole("button", { name: "Закрыть" }).click();
    await expect(page.getByRole("dialog", { name: FIRST })).toBeHidden();
    await openPhoto(page, SECOND);
    expectAtRest(await view(page), "the next photo");
  });

  test("zoomed all the way into a corner, the picture and the way out stay clear of the unsafe areas", async ({ page, browserName, isMobile }) => {
    // Rule 13 of the interface material. The insets of an iPhone 14 Pro held
    // upright, injected through the tokens every edge reads.
    const { insets } = IPHONE_14_PRO.portrait;
    await emulateInstalledIosApp(page, insets);
    await openCapture(page);
    await openPhoto(page, FIRST);
    const before = await view(page);
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    // Into the picture's top left corner, as far as it goes.
    const corner = { x: before.picture.left + 4, y: before.picture.top + 4 };
    await ctrlWheel(page, corner, -100, 16, browserName === "webkit" && isMobile);
    const zoomed = await view(page);
    expect(zoomed.scale).toBeGreaterThan(3.95);
    expectNeverLost(zoomed, "at four times in the corner");

    const safe = { top: insets.top, bottom: viewport!.height - insets.bottom, left: insets.left, right: viewport!.width - insets.right };
    const drawn = {
      top: Math.max(zoomed.picture.top, zoomed.stage.top),
      bottom: Math.min(zoomed.picture.bottom, zoomed.stage.bottom),
      left: Math.max(zoomed.picture.left, zoomed.stage.left),
      right: Math.min(zoomed.picture.right, zoomed.stage.right),
    };
    expect(drawn.top, "the zoomed picture is drawn under the status bar").toBeGreaterThanOrEqual(safe.top - 0.5);
    expect(drawn.bottom, "the zoomed picture is drawn over the home indicator").toBeLessThanOrEqual(safe.bottom + 0.5);
    expect(drawn.left).toBeGreaterThanOrEqual(safe.left - 0.5);
    expect(drawn.right).toBeLessThanOrEqual(safe.right + 0.5);

    // What the picture is actually clipped to: nothing of it is visible outside
    // the stage, whatever its box says.
    const clipped = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('[data-testid="media-viewer-stage"]');
      return stage ? getComputedStyle(stage).overflow : null;
    });
    expect(clipped, "the stage does not clip the zoomed picture").toBe("hidden");

    // The way out is still reachable, outside the unsafe areas, over a picture
    // zoomed as far as it goes.
    const close = page.getByRole("dialog", { name: FIRST }).getByRole("button", { name: "Закрыть" });
    const box = await close.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y, "the close button is under the status bar").toBeGreaterThanOrEqual(safe.top - 0.5);
    const reached = await close.evaluate((button) => {
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit && button.contains(hit));
    });
    expect(reached, "a tap on the close button lands on the zoomed picture").toBe(true);
    await close.click();
    await expect(page.getByRole("dialog", { name: FIRST })).toBeHidden();
  });
});
