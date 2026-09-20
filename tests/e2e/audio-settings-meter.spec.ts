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
 * The meter as a live thing, which no source scan and no render assertion can
 * reach.
 *
 * `tests/unit/mic-gate.test.mts` holds the arithmetic — the axis, the
 * quantisation under reduced motion, what a measured threshold comes to — and
 * `tests/unit/audio-settings-surface.test.mts` holds the guarantee that this
 * panel has not grown a second sampler. Neither of them can say that the bar
 * on the screen moves when the microphone does, and «the component rendered» is
 * not that claim either. So this file drives a **known level** into the page
 * and reads the painted bar back out.
 *
 * It can do that only because the meter goes through `lib/micLevel.ts`: the
 * DEV-only `window.__letscubeMicLevel` is that module's own stand-in, written
 * for `voice-call.spec.ts` because Chromium's fake capture device is a
 * once-a-second beep and a test waiting on a beep is asserting against the
 * wrong thing. The settings screen inherited the seam by reusing the module
 * rather than building a second analyser, which is what D-261 asked to be
 * checked first.
 *
 * What this file does **not** prove, stated rather than implied: that a real
 * microphone produces these numbers. The path from hardware to
 * `AnalyserNode.getByteTimeDomainData` is stubbed out here exactly as it is in
 * the voice specs. What is proved is everything after the reading — the axis,
 * the two bars agreeing, the gate's colour, the measurement, and the capture
 * ending with the screen.
 */

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["microphone"],
});

const AT = "2026-09-20T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const TEAM = "22222222-2222-4222-8222-000000000001";

declare global {
  interface Window {
    __micProbe?: {
      /** The callback the level source was opened with, while one is open. */
      push: ((level: number) => void) | null;
      /** How many sources have been opened, and how many closed. */
      opened: number;
      closed: number;
      timer: number | null;
    };
  }
}

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
        "2026-09-20T10:00:00.000Z",
      ),
    ],
  };
}

async function openSound(page: Page) {
  await openFixture(page, { me: ME, people: [ANNA], ...seed() });
  // Before the application boots, so the first `openMicLevelSource` already
  // finds it. The module gates this on `import.meta.env.DEV`, so the branch
  // folds away in a production build and there is no path to it there.
  await page.addInitScript(() => {
    const probe = { push: null as ((level: number) => void) | null, opened: 0, closed: 0, timer: null as number | null };
    window.__micProbe = probe;
    window.__letscubeMicLevel = (onLevel: (level: number) => void) => {
      probe.push = onLevel;
      probe.opened += 1;
      return {
        close() {
          probe.closed += 1;
          probe.push = null;
          if (probe.timer !== null) {
            window.clearInterval(probe.timer);
            probe.timer = null;
          }
        },
      };
    };
  });
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
  return panel;
}

/** One reading, as if the microphone had just been that loud. */
async function pushLevel(page: Page, level: number) {
  await page.evaluate((value) => window.__micProbe?.push?.(value), level);
}

/** A steady level, twenty times a second, the way the real source arrives. */
async function holdLevel(page: Page, level: number) {
  await page.evaluate((value) => {
    const probe = window.__micProbe;
    if (!probe) return;
    if (probe.timer !== null) window.clearInterval(probe.timer);
    probe.push?.(value);
    probe.timer = window.setInterval(() => probe.push?.(value), 50);
  }, level);
}

/**
 * What the bar actually paints, as a fraction of its track.
 *
 * Measured off the boxes rather than read back off the inline style: a style
 * attribute is the value the test itself caused to be written, and a bar that
 * was `overflow-hidden` at zero height would still carry it.
 */
async function paintedFraction(page: Page, testId: string): Promise<number> {
  return page.evaluate((id) => {
    const track = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const fill = track?.firstElementChild as HTMLElement | null;
    if (!track || !fill) return -1;
    const outer = track.getBoundingClientRect();
    const inner = fill.getBoundingClientRect();
    if (outer.width <= 0 || outer.height <= 0) return -1;
    return inner.width / outer.width;
  }, testId);
}

test.describe("the level meter is an instrument", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  /**
   * The claim D-261 is really about: a bar that follows the microphone, on the
   * axis the threshold is set on, said the same way by both bars on the screen.
   *
   * The three levels are chosen for what they separate. 0.05 is a peak that a
   * **linear** meter would draw at 5% and this one draws at 63%, which is the
   * exact disagreement the two bars used to have with each other; 0.5 is loud;
   * 0 is silence, and a bar that stayed where it was on silence would be the
   * `NaN%` defect `audioLevelPercent` was written for.
   */
  test("the bar follows the microphone, and the two bars say the same number", async ({ page }) => {
    const panel = await openSound(page);
    await panel.getByTestId("audio-mic-test").click();
    await expect(panel.getByTestId("audio-self-monitor")).toBeEnabled();
    // The level arrives through the shared module, so the stand-in was handed
    // the callback. Without this the pushes below would go nowhere and every
    // assertion would be reading a bar at rest.
    expect(await page.evaluate(() => window.__micProbe?.opened ?? 0)).toBe(1);

    const meter = panel.getByTestId("audio-level-meter");

    await pushLevel(page, 0.05);
    await expect(meter).toHaveAttribute("aria-valuenow", "63");
    // Polled rather than read once: outside reduced motion the width really is
    // animated, so a single reading taken the instant the attribute lands
    // catches the bar somewhere on its way — measured as 0 on the first run of
    // this spec, which is the transition starting rather than a bar that never
    // painted.
    await expect.poll(async () => paintedFraction(page, "audio-level-meter")).toBeGreaterThan(0.55);
    expect(await paintedFraction(page, "audio-level-meter")).toBeLessThan(0.71);

    await pushLevel(page, 0.5);
    await expect(meter).toHaveAttribute("aria-valuenow", "91");
    await expect.poll(async () => paintedFraction(page, "audio-level-meter")).toBeGreaterThan(0.85);

    await pushLevel(page, 0);
    await expect(meter).toHaveAttribute("aria-valuenow", "0");
    await expect.poll(async () => paintedFraction(page, "audio-level-meter")).toBeLessThan(0.02);

    // And the threshold's own bar is the same reading. Until 2026-09-20 it was
    // not: this one was linear and that one logarithmic, so one microphone
    // filled 5% of the first and 63% of the second at the same instant.
    await panel.getByTestId("mic-activation-picker").locator('[data-mic-activation="voice"]').click();
    const gate = panel.getByTestId("mic-gate-level");
    await expect(gate).toBeVisible();
    await pushLevel(page, 0.05);
    await expect(meter).toHaveAttribute("aria-valuenow", "63");
    await expect(gate).toHaveAttribute("aria-valuenow", "63");
    // Both are read in the same poll and both have to have landed, because the
    // two bars are still being animated into place and catching one of them in
    // flight is not a disagreement: at 390 the first run of this spec measured
    // 0.580 against 0.610 with both on their way to 0.628.
    await expect
      .poll(async () => {
        const top = await paintedFraction(page, "audio-level-meter");
        const bottom = await paintedFraction(page, "mic-gate-level");
        return top > 0.6 && bottom > 0.6 && Math.abs(top - bottom) < 0.01
          ? "agree"
          : `${top.toFixed(3)} vs ${bottom.toFixed(3)}`;
      })
      .toBe("agree");
  });

  /**
   * The bar and the handle are one axis, proved at the place where it matters:
   * the level at which the gate changes its mind.
   *
   * `micGateOpenAt(0.5)` is 0.01778 — a peak of −35 dBFS. A reading just under
   * it must leave the bar muted and just over it must light it, and the bar's
   * own width must be the handle's own position at exactly the threshold. That
   * last equality is what makes the control readable: it is why the threshold
   * is stored as a position and not as a number of decibels.
   */
  test("the threshold and the bar are the same axis", async ({ page }) => {
    const panel = await openSound(page);
    await panel.getByTestId("audio-mic-test").click();
    await expect(panel.getByTestId("audio-self-monitor")).toBeEnabled();
    await panel.getByTestId("mic-activation-picker").locator('[data-mic-activation="voice"]').click();

    const slider = panel.locator('input[type="range"]').last();
    await slider.fill("0.5");
    const gate = panel.getByTestId("mic-gate-level");

    await pushLevel(page, 0.0177);
    await expect(gate).toHaveAttribute("data-open", "false");
    await pushLevel(page, 0.0179);
    await expect(gate).toHaveAttribute("data-open", "true");

    // At the threshold exactly, the bar's width is the handle's position.
    await pushLevel(page, 0.01778279410038923);
    await expect(gate).toHaveAttribute("aria-valuenow", "50");
  });

  /**
   * «Подобрать порог»: two seconds of a room, and a threshold that clears it
   * with the hysteresis included.
   *
   * The room is held at −52 dBFS, which is a quiet office into a laptop
   * capture. The answer has to be 0.40 — ten decibels above it, which is
   * `MIC_AUTO_THRESHOLD_MARGIN_DB` — and the state has to say it succeeded
   * rather than silently leaving the old number.
   */
  test("the measurement puts the threshold above the room it heard", async ({ page }) => {
    const panel = await openSound(page);
    await panel.getByTestId("mic-activation-picker").locator('[data-mic-activation="voice"]').click();
    const slider = panel.locator('input[type="range"]').last();
    await expect(slider).toHaveValue("0.35");

    // Pressed with no capture running: the control starts one itself, which is
    // the row's whole reason for existing — the threshold used to need a button
    // in another group pressed first.
    expect(await page.evaluate(() => window.__micProbe?.opened ?? 0)).toBe(0);
    const button = panel.getByTestId("mic-auto-threshold");
    await button.click();
    await expect(button).toHaveAttribute("data-state", "listening");
    await expect
      .poll(async () => page.evaluate(() => window.__micProbe?.push !== null && window.__micProbe?.push !== undefined))
      .toBe(true);
    await holdLevel(page, 0.0025118864315095794);

    await expect(button).toHaveAttribute("data-state", "done", { timeout: 15_000 });
    await expect(slider).toHaveValue("0.4");
    await expect(panel.getByText(/Порог поставлен на 10 дБ выше/)).toBeVisible();

    // And a hand on the slider takes the claim back: the note may not go on
    // describing a number the person has since dragged.
    await slider.fill("0.6");
    await expect(button).toHaveAttribute("data-state", "idle");
  });

  /**
   * A room the measurement cannot hear is said, not covered up.
   *
   * The level source is opened and then answers nothing — a capture that ended
   * under it, a context the browser suspended. `autoMicThreshold` returns
   * `null` for that, and the surface has to print «не удалось» rather than
   * write a plausible number nobody's room produced.
   */
  test("a measurement that heard nothing says so", async ({ page }) => {
    const panel = await openSound(page);
    await panel.getByTestId("mic-activation-picker").locator('[data-mic-activation="voice"]').click();
    const slider = panel.locator('input[type="range"]').last();
    const button = panel.getByTestId("mic-auto-threshold");

    await button.click();
    await expect(button).toHaveAttribute("data-state", "listening");
    // Nothing is pushed. The safety timer has to end it.
    await expect(button).toHaveAttribute("data-state", "failed", { timeout: 15_000 });
    await expect(slider).toHaveValue("0.35");
    await expect(panel.getByText(/Не удалось измерить/)).toBeVisible();
  });

  /**
   * The three processing switches say what the **microphone** is doing, not
   * what the switch was left at.
   *
   * A constraint is a request: `getUserMedia` takes `noiseSuppression: true`
   * and is free to hand back a track without it — a headset doing its own
   * processing, a platform that does not expose the control. Chromium's fake
   * capture device grants everything, so the disagreement is forced here by
   * making `getSettings()` report the opposite. That is the seam being tested
   * on purpose: what is proved is that the panel **asks the track** rather than
   * drawing the switch's own position, which is the difference between a
   * control that can be checked and one that cannot.
   */
  test("a constraint the browser refused is said on the screen", async ({ page }) => {
    await openFixture(page, { me: ME, people: [ANNA], ...seed() });
    await page.addInitScript(() => {
      const original = MediaStreamTrack.prototype.getSettings;
      MediaStreamTrack.prototype.getSettings = function patched(this: MediaStreamTrack) {
        const settings = original.call(this) as MediaTrackSettings;
        return { ...settings, noiseSuppression: false, echoCancellation: true, autoGainControl: true };
      };
    });
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
    await page.getByTestId("settings-open-audio").click();
    const panel = page.getByTestId("settings-section-audio");
    await expect(panel).toBeVisible();

    // The three constraints moved behind «Показать расширенные настройки
    // голоса» on 2026-09-20. The **note** did not — it is a fact about the live
    // track and stays where a person can see it without opening anything,
    // which is what the `toHaveCount(0)` and the `toBeVisible` below measure.
    await panel.getByTestId("audio-advanced-toggle").click();
    await expect(panel.getByTestId("audio-advanced")).toBeVisible();

    // «Чистый голос» is the default, so all three are asked for.
    await expect(panel.getByTestId("audio-noise-suppression")).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByText(/Браузер решил иначе/)).toHaveCount(0);

    await panel.getByTestId("audio-mic-test").click();
    const note = panel.getByText(/Браузер решил иначе/);
    await expect(note).toBeVisible();
    await expect(note).toContainText("Убрать шум");
    await expect(note).toContainText("выключено");
    // And only the one the track actually disagreed about.
    await expect(note).not.toContainText("Убрать эхо");

    // It goes when the capture does, rather than standing there describing a
    // track that no longer exists.
    await panel.getByTestId("audio-mic-test").click();
    await expect(panel.getByText(/Браузер решил иначе/)).toHaveCount(0);
  });

  /**
   * The capture lives as long as the screen and not a moment longer.
   *
   * A level sampler running for the life of the session is a battery defect
   * nobody can see, and the settings disclosure unmounts its panel when it
   * closes — so this is the product's own teardown being checked rather than a
   * promise about it.
   */
  test("closing the screen ends the capture", async ({ page }) => {
    const panel = await openSound(page);
    await panel.getByTestId("audio-mic-test").click();
    await expect(panel.getByTestId("audio-self-monitor")).toBeEnabled();
    expect(await page.evaluate(() => window.__micProbe?.opened ?? 0)).toBe(1);
    expect(await page.evaluate(() => window.__micProbe?.closed ?? 0)).toBe(0);

    await page.getByTestId("settings-open-audio").click();
    await expect(page.getByTestId("settings-section-audio")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => window.__micProbe?.closed ?? 0)).toBe(1);
    expect(await page.evaluate(() => window.__micProbe?.push)).toBe(null);
  });
});

/**
 * Reduced motion, as a decision rather than as an omission.
 *
 * The bar goes on answering — a threshold control without a level is the
 * guesswork the control exists to end — and what is removed is the part that is
 * animation rather than data: the reading steps between twenty positions
 * instead of streaming through a hundred and one, and the browser stops
 * interpolating frames between two readings that already arrive twenty times a
 * second.
 */
test.describe("under prefers-reduced-motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("the bar steps instead of streaming, and nothing interpolates it", async ({ page }) => {
    const panel = await openSound(page);
    await panel.getByTestId("audio-mic-test").click();
    await expect(panel.getByTestId("audio-self-monitor")).toBeEnabled();
    const meter = panel.getByTestId("audio-level-meter");

    // 62.83% of the axis. Drawn at 63 ordinarily and at 65 here — on the step.
    await pushLevel(page, 0.05);
    await expect(meter).toHaveAttribute("aria-valuenow", "65");
    // Still an instrument: silence and speech are still different pictures.
    await pushLevel(page, 0.002);
    await expect(meter).toHaveAttribute("aria-valuenow", "25");
    await pushLevel(page, 0);
    await expect(meter).toHaveAttribute("aria-valuenow", "0");

    const transition = await page.evaluate(() => {
      const fill = document.querySelector<HTMLElement>('[data-testid="audio-level-meter"]')?.firstElementChild;
      return fill ? getComputedStyle(fill).transitionProperty : "";
    });
    expect(transition, "the bar is still being interpolated between readings").not.toContain("width");
  });
});
