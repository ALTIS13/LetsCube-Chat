import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
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

async function openSound(page: Page, theme: "dark" | "light" = "dark") {
  await openFixture(page, { me: ME, people: [ANNA], ...seed() });
  // `openFixture` seeds the dark theme; a later init script wins. The two
  // contrast measurements below need both, and the light one is the worse.
  await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
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
    if (!track) return -1;
    const outer = track.getBoundingClientRect();
    if (outer.width <= 0 || outer.height <= 0) return -1;
    // A gated meter draws the level in **two** parts either side of the
    // threshold (D-279), so «how far has the bar got» is the right-hand edge
    // of whichever part reaches furthest — not the first child, which is now
    // the scale behind them.
    const below = track.querySelector<HTMLElement>(`[data-testid="${id}-below"]`);
    const above = track.querySelector<HTMLElement>(`[data-testid="${id}-above"]`);
    if (below && above) {
      const edge = Math.max(
        above.getBoundingClientRect().width > 0 ? above.getBoundingClientRect().right : 0,
        below.getBoundingClientRect().right,
      );
      return (edge - outer.left) / outer.width;
    }
    const fill = track.firstElementChild as HTMLElement | null;
    if (!fill) return -1;
    return fill.getBoundingClientRect().width / outer.width;
  }, testId);
}

/** The hue of a painted background, 0–360, for comparing two of them. */
async function fillHue(page: Page, testId: string): Promise<number> {
  return page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) return -1;
    const match = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
    if (!match || match.length < 3) return -1;
    const [r, g, b] = match.slice(0, 3).map((value) => Number(value) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return -1;
    const d = max - min;
    const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (hue * 60 + 360) % 360;
  }, testId);
}


/* ── Measuring what is actually painted ──────────────────────────────────── */

/**
 * One horizontal row of the meter, decoded from a photograph of it.
 *
 * `docs/operations/interface-material.md` rule 7: contrast is measured from
 * photographed pixels and not from token values, because the token is not what
 * composites. Here it is not even close to academic — the first version of the
 * threshold mark was a gap in the track's own colour between two 16% tints,
 * every token in it was a real token, and the whole boundary came out at
 * 1.09:1 and could not be seen.
 */
async function meterRow(page: Page, testId: string): Promise<{ row: [number, number, number][]; scale: number }> {
  const meter = page.getByTestId(testId);
  const box = await meter.boundingBox();
  expect(box, `no ${testId} on screen to photograph`).not.toBeNull();
  const shot = await meter.screenshot();
  const raw = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = raw.info;
  const y = Math.floor(height / 2);
  const row: [number, number, number][] = [];
  for (let x = 0; x < width; x += 1) {
    const at = (y * width + x) * channels;
    row.push([raw.data[at], raw.data[at + 1], raw.data[at + 2]]);
  }
  return { row, scale: width / box!.width };
}

function luminance([r, g, b]: readonly [number, number, number]): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** WCAG's floor for a graphical object that carries meaning. */
const BOUNDARY_CONTRAST_FLOOR = 3;

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
   * **The separation, as the owner judges it.**
   *
   * He watched the old bar switch colour at the threshold and said «но
   * требуется более явно разделение». The reason it did not read is
   * measurable: `--kub-muted` is hue 210° and `--kub-cyan` is hue 211°, so the
   * switch changed a saturation and nothing else, and it changed it about the
   * **whole** bar — there was never a mark on screen saying where the line
   * was. What is held here is both halves of the fix.
   *
   * Mutation, and it is the one this test exists for: the two fills back to
   * `--kub-muted` and `--kub-cyan`. The hue distance falls to about 1° and the
   * first assertion goes red.
   */
  test("the level crosses a line that is on screen, in two different hues", async ({ page }) => {
    const panel = await openSound(page);
    await panel.getByTestId("audio-mic-test").click();
    await expect(panel.getByTestId("audio-self-monitor")).toBeEnabled();
    await panel.getByTestId("mic-activation-picker").locator('[data-mic-activation="voice"]').click();
    const gate = panel.getByTestId("mic-gate-level");
    await expect(gate).toBeVisible();

    // Over the threshold, so both parts are painted and both hues exist.
    await pushLevel(page, 0.05);
    await expect(gate).toHaveAttribute("data-open", "true");
    const warm = await fillHue(page, "mic-gate-level-below");
    const accent = await fillHue(page, "mic-gate-level-above");
    expect(warm).toBeGreaterThanOrEqual(0);
    expect(accent).toBeGreaterThanOrEqual(0);
    const apart = Math.min(Math.abs(warm - accent), 360 - Math.abs(warm - accent));
    expect(apart, `the two fills are ${warm.toFixed(0)}° and ${accent.toFixed(0)}° apart`).toBeGreaterThan(60);

    // The boundary is the threshold's own position, measured off the boxes.
    // Polled, and for the reason this file already records twice: the parts
    // are animated into place, and a single read taken the instant
    // `data-open` lands catches one of them on its way — measured 0.412
    // against a settled 0.350 on the first run of this test.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const track = document.querySelector<HTMLElement>('[data-testid="mic-gate-level"]')!;
          const below = document.querySelector<HTMLElement>('[data-testid="mic-gate-level-below"]')!;
          const above = document.querySelector<HTMLElement>('[data-testid="mic-gate-level-above"]')!;
          const notch = document.querySelector<HTMLElement>('[data-testid="mic-gate-level-notch"]')!;
          const outer = track.getBoundingClientRect();
          const at = (box: DOMRect, edge: "left" | "right") => (box[edge] - outer.left) / outer.width;
          const parts = [
            at(below.getBoundingClientRect(), "right"),
            at(above.getBoundingClientRect(), "left"),
            at(notch.getBoundingClientRect(), "right"),
          ];
          return parts.every((value) => Math.abs(value - 0.35) < 0.02)
            ? "on the threshold"
            : parts.map((value) => value.toFixed(3)).join(" / ");
        }),
      )
      .toBe("on the threshold");
    expect(
      await page.evaluate(() =>
        Number(document.querySelector<HTMLElement>('[data-testid="mic-gate-level"]')!.getAttribute("data-threshold")),
      ),
    ).toBe(35);

    // Under the threshold, the accent part is not painted at all — «through»
    // has to be a state the bar can fail to be in.
    await pushLevel(page, 0.002);
    await expect(gate).toHaveAttribute("data-open", "false");
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.querySelector<HTMLElement>('[data-testid="mic-gate-level-above"]')!.getBoundingClientRect()
              .width,
        ),
      )
      .toBeLessThan(1);

    // And the line survives an empty room, which is the frame it exists for:
    // a person dragging the handle in silence still has something to aim at.
    await pushLevel(page, 0);
    await expect(gate).toHaveAttribute("aria-valuenow", "0");
    const atRest = await page.evaluate(() => {
      const track = document.querySelector<HTMLElement>('[data-testid="mic-gate-level"]')!;
      const notch = document.querySelector<HTMLElement>('[data-testid="mic-gate-level-notch"]')!;
      const box = notch.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        at: (box.right - track.getBoundingClientRect().left) / track.getBoundingClientRect().width,
      };
    });
    expect(atRest.width).toBeGreaterThan(0);
    expect(atRest.height).toBeGreaterThan(0);
    expect(Math.abs(atRest.at - 0.35)).toBeLessThan(0.02);
  });

  /**
   * **The threshold has to be locatable with no sound arriving**, which is the
   * state the owner is in and the state the first version of this failed.
   *
   * He has an analogue dimmer on his microphone and it is at zero, so after
   * D-278 his level reads near nothing — and the boundary was implied by two
   * 16% track tints with a 2px gap between them. Measured off the rendered
   * pixels: the two zones **1.09:1** apart in the dark theme and **1.03:1** in
   * the light one, the gap **1.33:1** against the warm zone. A second reader
   * looked at the screenshot and reported that there was no meter bar at all.
   *
   * It is also what `micGateThresholdHint` promises in words — «засечка на
   * ней — порог» — so the copy was describing something the pixels did not
   * show, which is this register's most repeated shape.
   *
   * Photographed and decoded rather than read off `getComputedStyle`, because
   * **a class-name assertion cannot catch 1.09:1**; that is exactly how it
   * shipped. Both themes, because the light one was the worse of the two.
   *
   * Mutation: the mark back to `bg-[var(--kub-range-track)]` — the gap this
   * replaced. It measures 1.00:1 against the bare track and this goes red.
   */
  for (const theme of ["dark", "light"] as const) {
    test(`the threshold is visible with nothing arriving (${theme})`, async ({ page }) => {
      const panel = await openSound(page, theme);
      await panel.getByTestId("audio-mic-test").click();
      await expect(panel.getByTestId("audio-self-monitor")).toBeEnabled();
      await panel.getByTestId("mic-activation-picker").locator('[data-mic-activation="voice"]').click();
      const gate = panel.getByTestId("mic-gate-level");
      await expect(gate).toBeVisible();

      // A silent room, which is the whole point: nothing is filled.
      await pushLevel(page, 0);
      await expect(gate).toHaveAttribute("aria-valuenow", "0");
      await expect(gate).toHaveAttribute("data-open", "false");
      // The gap belongs to the covered state and must not be drawn here — it
      // would sit on top of the mark and paint it back out in track colour.
      await expect(panel.getByTestId("mic-gate-level-gap")).toHaveCount(0);
      await page.waitForTimeout(120);

      const { row, scale } = await meterRow(page, "mic-gate-level");
      const at = Math.round((35 / 100) * (row.length / scale) * scale);
      // The mark is 2px wide, centred on the boundary and then scaled by the
      // device pixel ratio; a pixel either side of centre is inside it at any
      // ratio this suite runs at.
      const mark = row[at - 1];
      const left = row[at - Math.round(8 * scale)];
      const right = row[at + Math.round(8 * scale)];

      const against = (ground: readonly [number, number, number], where: string) => {
        const ratio = contrastRatio(mark, ground);
        expect(
          ratio,
          `the threshold mark is rgb(${mark.join(",")}) at ${ratio.toFixed(2)}:1 against the ` +
            `${where} rgb(${ground.join(",")}) in the ${theme} theme, with nothing arriving. ` +
            `A boundary that carries meaning needs ${BOUNDARY_CONTRAST_FLOOR}:1. The version ` +
            `that shipped on 2026-09-20 measured 1.33:1 and a reader reported no bar at all.`,
        ).toBeGreaterThanOrEqual(BOUNDARY_CONTRAST_FLOOR);
      };
      against(left, "track to its left");
      against(right, "track to its right");

      // And it is where the threshold is, not merely somewhere.
      expect(Math.abs((at - 1) / scale - 0.35 * (row.length / scale))).toBeLessThan(3);
    });
  }

  /**
   * And once a fill covers the mark, the boundary is still there **without
   * relying on the hue break**.
   *
   * Amber against blue is a real separation and it is what the owner asked
   * for, but it is a separation in *hue*: measured from the tokens, the two
   * fills are 1.94:1 apart in luminance in the dark theme and **1.32:1** in
   * the light one. A reader who cannot tell those two hues apart would have
   * nothing. The gap — the track's own colour, drawn over both — is what they
   * have, and it is measured here against each fill in turn.
   *
   * Mutation: drop the `covered &&` guard's element. Both assertions go red.
   */
  for (const theme of ["dark", "light"] as const) {
    test(`the covered boundary survives without the hue (${theme})`, async ({ page }) => {
      const panel = await openSound(page, theme);
      await panel.getByTestId("audio-mic-test").click();
      await expect(panel.getByTestId("audio-self-monitor")).toBeEnabled();
      await panel.getByTestId("mic-activation-picker").locator('[data-mic-activation="voice"]').click();
      const gate = panel.getByTestId("mic-gate-level");

      await pushLevel(page, 0.05);
      await expect(gate).toHaveAttribute("data-open", "true");
      await expect(panel.getByTestId("mic-gate-level-gap")).toHaveCount(1);
      await page.waitForTimeout(150);

      const { row, scale } = await meterRow(page, "mic-gate-level");
      const at = Math.round(0.35 * row.length);
      const gap = row[at - 1];
      const warm = row[at - Math.round(8 * scale)];
      const accent = row[at + Math.round(8 * scale)];

      for (const [ground, where] of [
        [warm, "warm fill below it"],
        [accent, "accent fill above it"],
      ] as const) {
        const ratio = contrastRatio(gap, ground);
        expect(
          ratio,
          `the covered boundary is rgb(${gap.join(",")}) at ${ratio.toFixed(2)}:1 against the ` +
            `${where} rgb(${ground.join(",")}) in the ${theme} theme. Colour is not the only ` +
            `carrier: the two fills themselves are only 1.32:1 apart in luminance in the light theme.`,
        ).toBeGreaterThanOrEqual(BOUNDARY_CONTRAST_FLOOR);
      }
    });
  }

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
   * A run that arrived complete and contained nothing — D-280.
   *
   * The distinction the test above cannot make. There the level source never
   * answered at all and the safety timer ended it; here forty readings arrive,
   * on time, and every one of them is silence. That is what a muted headset,
   * an ended track and a capsule dimmed past the bottom of the axis all
   * produce — measured through the real constraint pipeline on 2026-09-20,
   * `output/d280-measure-dead.mjs` — and the shipped build answered it with a
   * threshold of 0.14 and «Порог поставлен на 10 дБ выше измеренного шума
   * комнаты», which is a sentence about a room nobody measured.
   */
  test("a measurement that heard only silence refuses, and says which refusal it is", async ({ page }) => {
    const panel = await openSound(page);
    await panel.getByTestId("mic-activation-picker").locator('[data-mic-activation="voice"]').click();
    const slider = panel.locator('input[type="range"]').last();
    await expect(slider).toHaveValue("0.35");
    const button = panel.getByTestId("mic-auto-threshold");

    await button.click();
    await expect(button).toHaveAttribute("data-state", "listening");
    await expect
      .poll(async () => page.evaluate(() => window.__micProbe?.push !== null && window.__micProbe?.push !== undefined))
      .toBe(true);
    await holdLevel(page, 0);

    await expect(button).toHaveAttribute("data-state", "silent", { timeout: 15_000 });
    // 0.35 is the untouched default. 0.14 is what the shipped build wrote —
    // the margin alone, with nothing of the room in it — so this assertion is
    // the defect, and it is red against that build.
    await expect(slider).toHaveValue("0.35");
    await expect(panel.getByText(/не дал ни одного звука/)).toBeVisible();
    // Not the other refusal's sentence: «не удалось измерить» is true when the
    // level never arrived and says nothing about the microphone, and this run
    // is the opposite case.
    await expect(panel.getByText(/Не удалось измерить/)).toHaveCount(0);
    await expect(panel.getByText(/Порог поставлен на 10 дБ выше/)).toHaveCount(0);
  });

  /**
   * The refusal has to be **visible**, which a class name cannot say.
   *
   * `AudioNote tone="danger"` paints `--kub-danger-text` on the panel's own
   * material, and the panel is translucent: what a token declares and what a
   * reader gets are two different things, which is the whole of D-279 and rule
   * 7 of `docs/operations/interface-material.md`. So the note is photographed
   * and the painted text is read back — the darkest-against-ground pixel of
   * the glyphs against the modal ground behind them — in both themes.
   */
  for (const theme of ["dark", "light"] as const) {
    test(`the refusal is readable in the ${theme} theme`, async ({ page }) => {
      const panel = await openSound(page, theme);
      await panel.getByTestId("mic-activation-picker").locator('[data-mic-activation="voice"]').click();
      const button = panel.getByTestId("mic-auto-threshold");
      await button.click();
      await expect
        .poll(async () =>
          page.evaluate(() => window.__micProbe?.push !== null && window.__micProbe?.push !== undefined),
        )
        .toBe(true);
      await holdLevel(page, 0);
      await expect(button).toHaveAttribute("data-state", "silent", { timeout: 15_000 });

      const note = panel.getByText(/не дал ни одного звука/);
      await expect(note).toBeVisible();
      const shot = await note.screenshot();
      const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
      const pixels: [number, number, number][] = [];
      for (let i = 0; i < data.length; i += info.channels) {
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
      // The ground is the commonest colour in the box — a note is mostly
      // padding — and the text is the pixel furthest from it in luminance.
      // Antialiased edges are not expected to clear anything; the glyph core
      // is what a reader reads.
      const tally = new Map<string, number>();
      for (const pixel of pixels) {
        const key = pixel.join(",");
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      let groundKey = "";
      let best = 0;
      for (const [key, count] of tally) {
        if (count > best) {
          best = count;
          groundKey = key;
        }
      }
      const ground = groundKey.split(",").map(Number) as [number, number, number];
      // The stroke **body**, not the best pixel in the box. A single outlier
      // would pass any threshold, and at 12px most glyph pixels are partial
      // coverage — so what is measured is the highest-contrast colour that
      // covers at least half a percent of the note. Measured 2026-09-20: the
      // answer is `--kub-danger-text` itself, 632 pixels of it at 1440 and
      // 9602 at 390, which is the whole point — the material is translucent
      // and a token's declared value is not what a reader gets (D-279).
      const floorPixels = Math.max(1, Math.round(pixels.length * 0.005));
      let text = ground;
      let worst = 1;
      for (const [key, count] of tally) {
        if (count < floorPixels) continue;
        const pixel = key.split(",").map(Number) as [number, number, number];
        const ratio = contrastRatio(pixel, ground);
        if (ratio > worst) {
          worst = ratio;
          text = pixel;
        }
      }
      expect(
        worst,
        `the refusal is rgb(${text.join(",")}) on rgb(${ground.join(",")}) at ${worst.toFixed(2)}:1 in the ` +
          `${theme} theme, measured over at least ${floorPixels} pixels. A refusal nobody reads is a ` +
          `threshold silently left alone.`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  /**
   * The measurement leaves the capture open, and that is the decision.
   *
   * The owner reported on 2026-09-20 that «Подобрать порог» also starts the
   * «Уровень» capture. A pair of sentences announcing it shipped the same day
   * and came out again on his word — «как бы пользователь и так знает что его
   * микрофон используется, он ведь зашёл общаться в войсе» — so what is left
   * to hold is the **behaviour**, which is deliberate and load-bearing:
   * `micAutoThresholdNote("done")` asks him to speak into the capture, and the
   * whole threshold group is drawn around a live bar, so a control that
   * measured and then closed it would leave the hint describing a bar frozen
   * at zero. Nothing here asserts copy; a test that pinned the sentences is
   * what had to be rewritten when they went.
   */
  test("the measurement opens the capture and leaves it open", async ({ page }) => {
    const panel = await openSound(page);
    await panel.getByTestId("mic-activation-picker").locator('[data-mic-activation="voice"]').click();
    const button = panel.getByTestId("mic-auto-threshold");
    const micTest = panel.getByTestId("audio-mic-test");

    expect(await page.evaluate(() => window.__micProbe?.opened ?? 0)).toBe(0);
    await expect(micTest).toHaveText("Проверить микрофон");

    await button.click();
    await expect
      .poll(async () => page.evaluate(() => window.__micProbe?.push !== null && window.__micProbe?.push !== undefined))
      .toBe(true);
    await holdLevel(page, 0.0025118864315095794);
    await expect(button).toHaveAttribute("data-state", "done", { timeout: 15_000 });

    // The capture is genuinely still open — this is the owner's screenshot,
    // asserted — and the «Уровень» control is the way out of it, where it has
    // always been.
    expect(await page.evaluate(() => window.__micProbe?.closed ?? 0)).toBe(0);
    await expect(micTest).toHaveText("Остановить");

    await micTest.click();
    await expect
      .poll(async () => page.evaluate(() => window.__micProbe?.closed ?? 0))
      .toBeGreaterThan(0);
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
