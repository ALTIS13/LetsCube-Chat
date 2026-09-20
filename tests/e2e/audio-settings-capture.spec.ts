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
 * The fold at the foot of the panel, both ways, at both widths and in both
 * themes.
 *
 * Two pictures of one control, which is the only way to photograph a
 * disclosure: closed, it is one row and the whole claim is that the screen
 * above it is calmer; open, it is four rows and the claim is that they are
 * still the same objects the rest of the panel draws.
 *
 * The full-window frames are taken with it **open**, because the closed state
 * is already what every other capture in this file shows.
 */
for (const theme of ["dark", "light"] as const) {
  test(`the advanced fold, closed and open (${theme})`, async ({ page, request }, info) => {
    await requireFixtureServer(request);
    const panel = await openSound(page, theme);
    const width = page.viewportSize()?.width ?? 0;
    const tag = `${process.env.KUB_CAPTURE_TAG || "after"}-${width}-${theme}`;
    const fold = panel.locator('[data-audio-group="Расширенные настройки голоса"]');

    await fold.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await expect(page.getByTestId("audio-advanced-toggle")).toHaveAttribute("aria-expanded", "false");
    await fold.screenshot({ path: `output/audio/audio-${tag}-advanced-closed.png` });

    await page.getByTestId("audio-advanced-toggle").click();
    await expect(page.getByTestId("audio-advanced")).toBeVisible();
    await fold.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await fold.screenshot({ path: `output/audio/audio-${tag}-advanced-open.png` });

    // And the whole panel with it open, walked down the same way the frames
    // above are — the point of the fold is what the *screen* looks like, which
    // an element shot of the fold itself cannot show.
    const frames = await scrollThrough(page, "settings-section-audio");
    for (let i = 0; i <= frames; i += 1) {
      if (i > 0) {
        await page.evaluate(() => {
          const scroller = (window as unknown as { __audioScroller: HTMLElement }).__audioScroller;
          scroller.scrollTop += scroller.clientHeight - 80;
        });
        await page.waitForTimeout(250);
      }
      await page.screenshot({ path: `output/audio/audio-${tag}-open-${i}.png` });
    }
    info.annotations.push({
      type: "capture",
      description: `output/audio/audio-${tag}-advanced-{closed,open}.png and -open-*.png (${frames + 1})`,
    });
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
      // The switches are behind «Показать расширенные настройки голоса» since
      // 2026-09-20, so the fold is opened first — which is also the state this
      // photograph should be taken in, since a «Вручную» nobody can see the
      // cause of is not what the picture is about.
      await page.locator('[data-audio-mode="raw"]').click();
      await page.getByTestId("audio-advanced-toggle").click();
      await expect(page.getByTestId("audio-advanced")).toBeVisible();
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

  /**
   * «Микрофон в звонке», in the two modes that bring a control with them.
   *
   * The threshold is photographed **with the microphone test running**, because
   * that is the state it exists to be read in: the bar under the slider is the
   * live level on the threshold's own axis, and a still of it at rest says
   * nothing about whether the two line up. Chromium's fake device is a pulse,
   * so the bar in these frames is whatever that pulse was doing at the shutter
   * — what the picture is for is the layout, the tone of a bar that is open
   * against one that is not, and whether anything is clipped at 390.
   */
  for (const theme of ["dark", "light"] as const) {
    test(`the microphone mode, photographed (${theme})`, async ({ page, request }, info) => {
      await requireFixtureServer(request);
      await openSound(page, theme);
      const width = page.viewportSize()?.width ?? 0;
      const tag = `${process.env.KUB_CAPTURE_TAG || "after"}-${width}-${theme}`;
      const picker = page.getByTestId("mic-activation-picker");
      // The group itself rather than the whole window: it is the last one on
      // the screen, so a window shot cuts it at the scrollport's edge and the
      // threshold — the row the mode exists for — falls off the bottom.
      const group = page.locator('[data-audio-group="Микрофон в звонке"]');

      await page.getByTestId("audio-mic-test").click();
      await expect(page.getByTestId("audio-self-monitor")).toBeEnabled();

      await picker.locator('[data-mic-activation="voice"]').click();
      await expect(page.getByTestId("mic-gate-level")).toBeVisible();
      await group.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await group.screenshot({ path: `output/audio/audio-${tag}-gate-voice.png` });

      await picker.locator('[data-mic-activation="ptt"]').click();
      await expect(page.getByTestId("mic-talk-key")).toBeVisible();
      await group.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await group.screenshot({ path: `output/audio/audio-${tag}-gate-ptt.png` });

      // And the recorder waiting for a key, which is the one state with no
      // resting appearance of its own.
      await page.getByTestId("mic-talk-key").click();
      await expect(page.getByTestId("mic-talk-key")).toHaveAttribute("data-listening", "true");
      await page.waitForTimeout(250);
      await group.screenshot({ path: `output/audio/audio-${tag}-gate-key.png` });
      info.annotations.push({
        type: "capture",
        description: `output/audio/audio-${tag}-gate-{voice,ptt,key}.png`,
      });
    });
  }

  /**
   * The bar at a **known** level, which is the only way to photograph an
   * instrument.
   *
   * Every frame above is taken against Chromium's fake capture device, which is
   * a once-a-second beep: the bar in those pictures is whatever the beep was
   * doing at the shutter, so they show the layout and say nothing about the
   * reading. Here the level is driven through `window.__letscubeMicLevel`, the
   * DEV seam in `lib/micLevel.ts`, so «at rest», «with signal» and «under the
   * threshold» are three states rather than three lucky moments.
   *
   * That this works at all is the change: before 2026-09-20 the settings
   * meter had an analyser of its own and this seam reached only a call.
   */
  for (const theme of ["dark", "light"] as const) {
    test(`the meter at a known level, photographed (${theme})`, async ({ page, request }, info) => {
      await requireFixtureServer(request);
      await page.addInitScript(() => {
        const probe = { push: null as ((level: number) => void) | null };
        (window as unknown as { __capturePush: typeof probe }).__capturePush = probe;
        window.__letscubeMicLevel = (onLevel: (level: number) => void) => {
          probe.push = onLevel;
          return { close() { probe.push = null; } };
        };
      });
      await openSound(page, theme);
      const width = page.viewportSize()?.width ?? 0;
      const tag = `${process.env.KUB_CAPTURE_TAG || "after"}-${width}-${theme}`;
      const push = (level: number) =>
        page.evaluate(
          (value) => (window as unknown as { __capturePush: { push: ((l: number) => void) | null } }).__capturePush.push?.(value),
          level,
        );

      const level = page.locator('[data-audio-group="Уровень"]');
      const gate = page.locator('[data-audio-group="Микрофон в звонке"]');

      await page.getByTestId("audio-mic-test").click();
      await expect(page.getByTestId("audio-self-monitor")).toBeEnabled();

      // At rest: a capture that is running and a room that is silent.
      await push(0);
      await level.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await level.screenshot({ path: `output/audio/audio-${tag}-meter-rest.png` });

      // With signal: −26 dBFS, which is a voice into a laptop capture.
      await push(0.05);
      await page.waitForTimeout(400);
      await level.screenshot({ path: `output/audio/audio-${tag}-meter-signal.png` });

      await page.getByTestId("mic-activation-picker").locator('[data-mic-activation="voice"]').click();
      await expect(page.getByTestId("mic-gate-level")).toBeVisible();

      // The threshold with the level under it — the gate shut, the bar muted.
      await push(0.002);
      await gate.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await gate.screenshot({ path: `output/audio/audio-${tag}-gate-below.png` });

      // And over it — the gate open, the bar lit. Two pictures of one control,
      // which is what the colour is for.
      await push(0.05);
      await expect(page.getByTestId("mic-gate-level")).toHaveAttribute("data-open", "true");
      await page.waitForTimeout(400);
      await gate.screenshot({ path: `output/audio/audio-${tag}-gate-above.png` });

      // The threshold placed by the measurement rather than by a hand.
      await push(0);
      await page.getByTestId("mic-auto-threshold").click();
      await expect(page.getByTestId("mic-auto-threshold")).toHaveAttribute("data-state", "listening");
      await page.evaluate(() => {
        const held = window as unknown as {
          __capturePush: { push: ((l: number) => void) | null };
          __captureTimer?: number;
        };
        held.__captureTimer = window.setInterval(() => held.__capturePush.push?.(0.0025118864315095794), 50);
      });
      await expect(page.getByTestId("mic-auto-threshold")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
      // Stopped before the last push, or the room would go on overwriting it:
      // the first run of this capture left the driver running and photographed
      // the room at 26% under a threshold of 40% while claiming to show a
      // voice over it.
      await page.evaluate(() => {
        const held = window as unknown as { __captureTimer?: number };
        if (held.__captureTimer !== undefined) window.clearInterval(held.__captureTimer);
      });
      await push(0.05);
      await expect(page.getByTestId("mic-gate-level")).toHaveAttribute("data-open", "true");
      await gate.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await gate.screenshot({ path: `output/audio/audio-${tag}-gate-measured.png` });
      info.annotations.push({
        type: "capture",
        description: `output/audio/audio-${tag}-{meter-rest,meter-signal,gate-below,gate-above,gate-measured}.png`,
      });
    });
  }
});
