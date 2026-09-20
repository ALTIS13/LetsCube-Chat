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
 * The sound settings, measured on the rendered page.
 *
 * `tests/unit/audio-settings-surface.test.mts` holds the words and reads the
 * class lists; a class list is not a pixel, so what those classes actually
 * paint, how tall the controls come out and whether anything is clipped are
 * measured here instead — at the two release widths, because the settings
 * screen is a ~350px column on a computer and a full-width dialog on a phone,
 * and every defect this section had showed at one of the two.
 *
 * Nothing here touches a backend: the fixture answers every request, and the
 * three writes the spec makes go to `localStorage`.
 */

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

async function openSound(page: Page) {
  await openFixture(page, { me: ME, people: [ANNA], ...seed() });
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
  await expect(page.getByTestId("audio-settings")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // **The panel is still moving when it becomes visible**, and several tests
  // below measure boxes. `.kub-settings-panel` runs `kub-settings-panel-in`,
  // a `translateY(-4px) → 0`, and a box measured mid-flight sits at a
  // fractional y: measured 2026-09-20, `audio-reset` reported a height of
  // 43.9998779, 44 and 44.0001220 on three consecutive runs of this file while
  // its `offsetHeight` was 44 every time and the animation's `playState` was
  // `running` every time. A translate does not change a height — Chromium is
  // rounding the row's two edges to different subpixels — so «is this row 44px
  // tall» was being asked of an instrument that could not answer it. Awaiting
  // the panel's **own** animations is deterministic and cannot hang on an
  // unrelated infinite one.
  await page.evaluate(async () => {
    const panel = document.querySelector('[data-testid="settings-section-audio"]');
    if (!panel) return;
    await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
  return panel;
}

test.describe("the sound settings speak the settings screen's own vocabulary", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  /**
   * The defect the owner reported first: the section painted the application's
   * own page ground inside a panel, so it came out near-black against a
   * slate-blue screen and read as a hole rather than as part of it.
   *
   * Stated from the pixels rather than from the token: **no box inside the
   * panel paints a background colour at all.** What separates a group from the
   * panel is a step of material — a background *image* laid over whatever is
   * under it — which is rule 11 of the material contract and what every other
   * group on this screen is separated by. The exceptions are the controls
   * themselves and the one well a segmented track is cut into.
   */
  test("no box inside the panel paints a ground of its own", async ({ page }) => {
    await openSound(page);
    const painted = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="settings-section-audio"]')!;
      // A control is allowed a fill; so is a segmented picker's track, which is
      // a well rather than a box holding rows. `[data-segment-track]` rather
      // than the processing picker's own test id since 2026-09-18: there are
      // two such wells now — the second is «Микрофон в звонке» — and they are
      // one object drawn twice, from a single class list in the component.
      const ALLOWED = 'button, select, input, [role="switch"], [role="meter"], [data-segment-track]';
      const out: string[] = [];
      for (const el of panel.querySelectorAll<HTMLElement>("*")) {
        if (el.closest(ALLOWED)) continue;
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          out.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 60)} => ${bg}`);
        }
      }
      return out;
    });
    expect(painted).toEqual([]);

    // And the material really is doing the separating, so the assertion above
    // cannot be satisfied by a section that stopped drawing groups at all.
    const veiled = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="settings-section-audio"]')!;
      return [...panel.querySelectorAll<HTMLElement>("[data-audio-group] > div")].filter(
        (el) => getComputedStyle(el).backgroundImage !== "none",
      ).length;
    });
    // Six since 2026-09-20, when the advanced fold was added at the foot of
    // the panel. Its box is drawn whether or not it is open — the toggle is
    // its first row — so this number does not move with the disclosure.
    // Five before that: «Звуки» and «Микрофон в звонке» joined
    // «Устройства», «Уровень» and «Обработка голоса», all drawn as the same
    // object by the same `AudioGroup` — which is what this number is really
    // counting.
    expect(veiled).toBe(6);
  });

  /**
   * One level, not three. The section used to be an outer box holding an inner
   * box holding the rows, where everything else on the screen is a caption and
   * a list.
   */
  test("nothing inside the panel is nested inside anything else", async ({ page }) => {
    const panel = await openSound(page);
    const groups = panel.locator("[data-audio-group]");
    // Six since 2026-09-20: the advanced fold is a group like the others,
    // drawn by the same `AudioGroup` and therefore flat like the others.
    await expect(groups).toHaveCount(6);
    const nested = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="settings-section-audio"]')!;
      return [...panel.querySelectorAll<HTMLElement>("[data-audio-group]")].filter(
        (el) => el.parentElement?.closest("[data-audio-group]"),
      ).length;
    });
    expect(nested).toBe(0);
  });

  /** The product says on and off with a switch. Two checkboxes said it here. */
  test("every on/off control is a switch", async ({ page }) => {
    const panel = await openSound(page);
    await expect(panel.locator('input[type="checkbox"]')).toHaveCount(0);
    // Three with the panel as it opens: the call sound, the notification
    // sound and self-monitoring. The other four moved behind
    // «Показать расширенные настройки голоса» on 2026-09-20, which is
    // the whole point of the fold — so asserting both counts is what proves it
    // hides rather than merely exists.
    await expect(panel.getByRole("switch")).toHaveCount(3);
    await expect(panel.getByTestId("audio-self-monitor")).toBeDisabled();
    for (const id of ["audio-noise-suppression", "audio-echo-cancellation", "audio-auto-gain"]) {
      await expect(panel.getByTestId(id)).toHaveCount(0);
    }

    await panel.getByTestId("audio-advanced-toggle").click();
    await expect(panel.getByTestId("audio-advanced-toggle")).toHaveAttribute("aria-expanded", "true");
    // The three constraints and the no-input warning, on top of the three above.
    await expect(panel.getByRole("switch")).toHaveCount(7);
    await expect(panel.locator('input[type="checkbox"]')).toHaveCount(0);
    for (const id of ["audio-noise-suppression", "audio-echo-cancellation", "audio-auto-gain"]) {
      await expect(panel.getByTestId(id)).toHaveAttribute("aria-checked", "true");
    }
    // On by default, which is `MIC_NO_INPUT_DEFAULT` reaching the screen.
    await expect(panel.getByTestId("audio-no-input-warning")).toHaveAttribute("aria-checked", "true");

    // And it closes again, taking them with it.
    await panel.getByTestId("audio-advanced-toggle").click();
    await expect(panel.getByRole("switch")).toHaveCount(3);
  });

  /**
   * «Звуки», which is two switches and the one sentence saying where they live.
   *
   * The rules are `lib/callSounds.ts`'s and are proved without a browser in
   * `tests/unit/call-sounds.test.mts`; what is measured here is that the panel
   * really offers them, that they are two rather than one, and that both start
   * on — which is the state every settings blob written before 2026-09-18 also
   * normalises to, and the state the owner asked for.
   */
  test("the sounds are two switches, both on, and the panel says where they live", async ({ page }) => {
    const panel = await openSound(page);
    const call = panel.getByTestId("audio-call-sound");
    const notification = panel.getByTestId("audio-notification-sound");
    await expect(call).toHaveAttribute("aria-checked", "true");
    await expect(notification).toHaveAttribute("aria-checked", "true");

    // Separate, which is the point: somebody who wants a silent office still
    // wants their telephone to ring.
    await call.click();
    await expect(call).toHaveAttribute("aria-checked", "false");
    await expect(notification).toHaveAttribute("aria-checked", "true");

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("kub:audio-settings:v1") ?? "{}"),
    );
    expect(stored.callSoundEnabled).toBe(false);
    expect(stored.notificationSoundEnabled).toBe(true);

    // The setting is this browser's, not the account's, and the panel says so
    // rather than letting somebody discover it from a telephone that rang
    // anyway. The same honesty §4a asks of the per-device call switch.
    await expect(panel.getByText("Настройка действует на этом устройстве.")).toBeVisible();

    // And the reset puts them back, like every other setting in this panel.
    await panel.getByTestId("audio-reset").click();
    await expect(call).toHaveAttribute("aria-checked", "true");
  });

  /**
   * The picker, and the one segment that is a state rather than a choice.
   *
   * It was three stacked full-width pills with a disabled third painted exactly
   * like the two that work; it is now the track the theme radiogroup two rows
   * above and «Лимит кэша» are both drawn as.
   */
  test("the picker is one track of three segments, and «Вручную» cannot be pressed", async ({ page }) => {
    const panel = await openSound(page);
    const picker = panel.getByTestId("audio-mode-picker");
    await expect(picker).toHaveAttribute("role", "radiogroup");
    await expect(picker.getByRole("radio")).toHaveCount(3);
    await expect(picker.locator('[aria-checked="true"]')).toHaveCount(1);
    await expect(picker.locator('[data-audio-mode="clean"]')).toHaveAttribute("aria-checked", "true");
    await expect(picker.locator('[data-audio-mode="custom"]')).toBeDisabled();

    // The three segments are one row of equal parts: a wrapped track is a
    // different object, and a `flex-wrap` is how one becomes one by accident.
    const geometry = await page.evaluate(() => {
      const segs = [...document.querySelectorAll<HTMLElement>("[data-audio-mode]")].map((el) => el.getBoundingClientRect());
      return {
        tops: [...new Set(segs.map((r) => Math.round(r.top)))].length,
        widths: [...new Set(segs.map((r) => Math.round(r.width)))].length,
      };
    });
    expect(geometry).toEqual({ tops: 1, widths: 1 });
  });

  /**
   * The current mode was printed twice — once as the right-hand value of «Как
   * звучит голос» and once, immediately under it, as the filled pill. The row
   * this panel opens from already prints it, so the readout inside the panel
   * was the third copy.
   */
  test("the current mode is named once inside the panel", async ({ page }) => {
    const panel = await openSound(page);
    const outsideThePicker = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="settings-section-audio"]')!;
      const picker = root.querySelector<HTMLElement>('[data-testid="audio-mode-picker"]')!;
      const active = picker.querySelector<HTMLElement>('[aria-checked="true"]')!.textContent!.trim();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const hits: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.includes(active)) continue;
        if (picker.contains(node)) continue;
        hits.push(node.textContent.trim().slice(0, 60));
      }
      return hits;
    });
    expect(outsideThePicker).toEqual([]);
  });

  /**
   * The reset was a 162x16 text link at the bottom left. Every other action on
   * this screen is a row, and a row is 44px tall whatever the pointer.
   */
  test("the reset is a row, not a link", async ({ page }) => {
    const panel = await openSound(page);
    const reset = panel.getByTestId("audio-reset");
    await expect(reset).toBeVisible();
    const box = await reset.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // As wide as the group it sits in: a row, not a word with a hit area.
    const rowIsFullWidth = await page.evaluate(() => {
      const reset = document.querySelector<HTMLElement>('[data-testid="audio-reset"]')!;
      const group = reset.parentElement!;
      return Math.round(reset.getBoundingClientRect().width) === Math.round(group.getBoundingClientRect().width);
    });
    expect(rowIsFullWidth).toBe(true);
  });

  /**
   * Nothing is clipped, and nothing has to be scrolled sideways.
   *
   * This is the check that caught the picker at 1440, where the settings column
   * gives a segment 87px, «Без обработки» needs 98.9 and a fixed height cut the
   * wrapped second line off the bottom of the pill.
   *
   * Measured with a `Range` over each control's contents rather than with
   * `scrollWidth`/`scrollHeight`, and that is not a style preference: put the
   * fixed height back and the segment reports `scrollHeight` **36 against a
   * clientHeight of 36** while its words end 6px below its content box. A
   * button overflows visibly, and a box with `overflow: visible` does not grow
   * its scrolling area for content that spills out of it — so the scroll-size
   * form of this check was green over exactly the defect it was written for.
   * The range rect is where the words actually are.
   *
   * The device select is measured against its own value for a related reason:
   * it clips its text internally without ever reporting an overflow.
   */
  test("no control is clipped at this width", async ({ page }) => {
    const panel = await openSound(page);
    const report = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="settings-section-audio"]')!;
      const clipped: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>("button, [data-audio-mode]")) {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        if (text.width === 0 && text.height === 0) continue;
        const out = {
          top: Math.round(box.top + parseFloat(style.paddingTop) - text.top),
          bottom: Math.round(text.bottom - (box.bottom - parseFloat(style.paddingBottom))),
          left: Math.round(box.left + parseFloat(style.paddingLeft) - text.left),
          right: Math.round(text.right - (box.right - parseFloat(style.paddingRight))),
        };
        const worst = Math.max(out.top, out.bottom, out.left, out.right);
        if (worst > 1) {
          clipped.push(
            `${el.dataset.audioMode ?? el.dataset.testid ?? el.textContent?.trim().slice(0, 24)}: ` +
              `${worst}px outside its box (${JSON.stringify(out)})`,
          );
        }
      }
      const tight: string[] = [];
      for (const select of root.querySelectorAll<HTMLSelectElement>("select")) {
        const span = document.createElement("span");
        span.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
        span.style.font = getComputedStyle(select).font;
        span.textContent = select.options[select.selectedIndex]?.text ?? "";
        document.body.appendChild(span);
        const needed = span.getBoundingClientRect().width;
        span.remove();
        // 16 of horizontal padding and about 20 for the browser's own arrow.
        if (select.clientWidth < needed + 36) {
          tight.push(`${span.textContent}: needs ${Math.round(needed + 36)}, has ${select.clientWidth}`);
        }
      }
      return {
        clipped,
        tight,
        sideways: root.scrollWidth - root.clientWidth,
      };
    });
    expect(report).toEqual({ clipped: [], tight: [], sideways: 0 });
  });

  /**
   * The surface was rebuilt and the settings were not: the picker still writes
   * the three constraints, and a switch still puts the mode into «Вручную».
   * Both go through `useAudioSettings`, so this is the wiring rather than the
   * words.
   */
  test("the picker and the switches still move each other", async ({ page }) => {
    const panel = await openSound(page);
    const picker = panel.getByTestId("audio-mode-picker");
    // The three switches are behind the fold since 2026-09-20; the picker is
    // not, which is the split — the plain-language choice stays on the calm
    // screen and the three constraints it writes are the advanced expansion of
    // it. Opened first here so this test goes on measuring the wiring.
    await panel.getByTestId("audio-advanced-toggle").click();

    await picker.locator('[data-audio-mode="raw"]').click();
    await expect(picker.locator('[data-audio-mode="raw"]')).toHaveAttribute("aria-checked", "true");
    for (const id of ["audio-noise-suppression", "audio-echo-cancellation", "audio-auto-gain"]) {
      await expect(panel.getByTestId(id)).toHaveAttribute("aria-checked", "false");
    }

    await panel.getByTestId("audio-echo-cancellation").click();
    await expect(picker.locator('[data-audio-mode="custom"]')).toHaveAttribute("aria-checked", "true");
    await expect(picker.locator('[aria-checked="true"]')).toHaveCount(1);
    // And the state that cannot be pressed is still the one that cannot be
    // pressed, now that it is the state.
    await expect(picker.locator('[data-audio-mode="custom"]')).toBeDisabled();

    await panel.getByTestId("audio-reset").click();
    await expect(picker.locator('[data-audio-mode="clean"]')).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByTestId("audio-echo-cancellation")).toHaveAttribute("aria-checked", "true");
  });

  /**
   * «Микрофон в звонке»: each mode brings exactly the control it needs.
   *
   * The rules — what each mode does, which keys may be bound, what the
   * threshold means — are `lib/micGate.ts` and are proved without a browser in
   * `tests/unit/mic-gate.test.mts`. What is measured here is the surface: that
   * the rows appear and disappear with the mode rather than standing there
   * greyed out, which on a translucent panel is the thing rule 5 forbids.
   */
  test("the microphone mode brings its own control, and only its own", async ({ page }) => {
    const panel = await openSound(page);
    const picker = panel.getByTestId("mic-activation-picker");
    await expect(picker.getByRole("radio")).toHaveCount(3);
    // The default is the behaviour this product already had, and it asks for
    // nothing: no threshold, no key.
    await expect(picker.locator('[data-mic-activation="open"]')).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByTestId("mic-gate-level")).toHaveCount(0);
    await expect(panel.getByTestId("mic-talk-key")).toHaveCount(0);

    await picker.locator('[data-mic-activation="voice"]').click();
    await expect(panel.getByTestId("mic-gate-level")).toBeVisible();

    /*
     * Every slider on this screen is **ours on both halves**, at both release
     * widths.
     *
     * Measured on 2026-09-18 at 390: `appearance` came back `auto` and
     * `background` `none`, so the control was the user agent's own — a white
     * track on a dark panel, which is the defect `.kub-range` exists to fix.
     * The class had been written inside `index.css`'s `min-width: 48rem` block
     * and therefore did nothing on a phone, and the rail's per-person volume
     * was drawn the same way and had the same defect. A screenshot at one
     * width could not have caught it; this reads the computed value at both.
     */
    const sliders = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="settings-section-audio"]')!;
      return [...root.querySelectorAll<HTMLInputElement>('input[type="range"]')].map((input) => {
        const style = getComputedStyle(input);
        return {
          classes: input.className,
          appearance: style.appearance,
          paintsBothHalves: style.backgroundImage.includes("linear-gradient"),
        };
      });
    });
    expect(sliders.length).toBeGreaterThan(0);
    for (const slider of sliders) {
      expect(slider.classes, "a slider on this screen is not drawn with the product's own").toContain("kub-range");
      expect(slider.appearance, `${slider.classes} fell back to the user agent's slider`).toBe("none");
      expect(slider.paintsBothHalves, `${slider.classes} leaves its empty half to the browser`).toBe(true);
    }
    // Nothing is measuring until the microphone test above is running, and the
    // bar says so by being empty rather than by inventing a level.
    await expect(panel.getByTestId("mic-gate-level")).toHaveAttribute("data-open", "false");
    await expect(panel.getByTestId("mic-talk-key")).toHaveCount(0);

    await picker.locator('[data-mic-activation="ptt"]').click();
    await expect(panel.getByTestId("mic-gate-level")).toHaveCount(0);
    const key = panel.getByTestId("mic-talk-key");
    await expect(key).toHaveText("Ё / ~");

    // The recorder: a press is taken, and a key the interface owns is refused
    // in words rather than swallowed.
    await key.click();
    await expect(key).toHaveText("Нажмите клавишу…");
    await page.keyboard.press("F8");
    await expect(key).toHaveText("F8");

    await key.click();
    await expect(key).toHaveAttribute("data-listening", "true");
    // `Tab` rather than `Escape`, though both are refused. At 390 this screen
    // is a dialog and `Escape` closes it — which is precisely the ownership the
    // refusal list exists to respect (D-194), and it would take the panel this
    // assertion reads away with it.
    await page.keyboard.press("Tab");
    await expect(key).toHaveText("F8", { timeout: 5000 });
    await expect(panel.getByText(/уже занята интерфейсом/)).toBeVisible();

    // The choice reaching storage is not re-proved here. A reload is how it
    // would be shown, and the fixture does not survive one on WebKit — the
    // chat list comes back empty, measured on `webkit-mobile-390` — so the
    // claim would rest on a harness rather than on the product. What proves it
    // instead: `tests/unit/mic-gate.test.mts` reads the stored shape through
    // `normalizeAudioSettings`, and every «Рация» test in
    // `tests/e2e/voice-call.spec.ts` seeds the mode into `localStorage` before
    // the application boots and then watches the real capture follow it.
  });
});
