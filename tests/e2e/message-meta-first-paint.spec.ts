import { expect, test, type Page } from "@playwright/test";

/**
 * D-041 and D-032: a message must be painted at the height it keeps.
 *
 * Both defects are the same sentence with different numbers. The bubble decides
 * whether the time fits beside the last line of text, the decision is worth a
 * whole row, and it used to arrive after the reader had already seen the other
 * answer.
 *
 * - D-041: the decision needs the bubble and the stack, which are ancestors of
 *   the component that measures. React attaches a host ref during the layout
 *   phase and that phase walks children before parents, so on the mount that
 *   matters both refs were null and the measurement returned at its first
 *   guard. A passive effect then put the guess back over whatever had been
 *   measured. Measured on a real chat: an own message painted at 36.8px and
 *   grew to 48.8px on the next frame.
 * - D-032: the width the decision compares against was measured from the row,
 *   which is shrink-to-fit around this very bubble and can be far wider than
 *   the design cap. A last line 507px wide was told it had 984px, chose inline,
 *   and the spacer that reserves room for the time then wrapped: +22.8px, 46ms
 *   after the message was painted. Endemic on the phone viewport — 56 of 67
 *   messages on entry, 1268.7px of late growth.
 *
 * Both are asserted on frames rather than on the settled layout. A test of the
 * settled state passes just as well while the correction is visible, which is
 * exactly the state these two defects were in.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const SAMPLES_KEY = "__letscubeBubbleHeightSamples";

type Row = { id: string; h: number; placement: string | null };
type Sample = { t: number; rows: Row[] };

type Fixture = {
  currentUser: { name: string; username: string };
  activeChat: { name: string; memberCount: number };
  chats: { name: string; preview: string; time: string; unread: number }[];
  messages: { sender: string; text: string; time: string; own: boolean }[];
};

/**
 * Records the height of every mounted bubble, once per animation frame, from
 * before the application has booted. Polling from the test process would arrive
 * long after the frames that carry the defect had been painted.
 */
function installSampler(samplesKey: string) {
  const samples: Sample[] = [];
  (window as unknown as Record<string, unknown>)[samplesKey] = samples;
  const tick = () => {
    const rows: Row[] = [];
    for (const row of Array.from(document.querySelectorAll("[data-message-id]"))) {
      const bubble = row.querySelector<HTMLElement>('[data-message-bubble="true"]');
      if (!bubble) continue;
      const group = bubble.querySelector("[data-message-text-meta-group]");
      rows.push({
        id: row.getAttribute("data-message-id") ?? "",
        h: Math.round(bubble.getBoundingClientRect().height * 10) / 10,
        placement: group?.getAttribute("data-message-meta-placement") ?? null,
      });
    }
    if (rows.length) samples.push({ t: Math.round(performance.now()), rows });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function openCapture(page: Page, fixture: Fixture, withSampler: boolean) {
  // The fixture guard refuses a message stamped later than "now", so the clock
  // is pinned exactly as the sibling specs pin it.
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));

  // Inter is loaded from Google Fonts with `display: swap`, so a cold page
  // paints in the fallback face and re-flows when the real one lands. That
  // changes every text metric — measured here, a timestamp 23.7px wide became
  // 28.6px — and it would sit on top of these measurements as noise that has
  // nothing to do with either defect, and that no measurement taken before the
  // font exists could have predicted. The face is therefore held to one: the
  // page renders in the fallback throughout, and the text below is calibrated
  // against that same face in the same run.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await page.addInitScript(
    ([key, payload]) => {
      (window as unknown as Record<string, unknown>)[key as string] = payload;
    },
    [WINDOW_KEY, fixture] as const,
  );
  if (withSampler) await page.addInitScript(installSampler, SAMPLES_KEY);

  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;

  // Same rule as the sibling specs: a missing prerequisite fails loudly. A spec
  // that quietly skips itself is how D-024 shipped.
  if (!ready) {
    if (process.env.KUB_ALLOW_PREVIEW_FIXTURE_SKIP === "1") {
      test.skip(true, "preview fixture route unavailable and skipping was explicitly allowed");
      return false;
    }
    throw new Error(
      response
        ? "The preview capture route did not report ready. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1, or set KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1 to accept that these contracts go unchecked."
        : "The DEV preview capture route is not served. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1, or set KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1 to accept that these contracts go unchecked.",
    );
  }
  return true;
}

const BASE_MESSAGES = [
  { sender: "Аня", text: "Коротко", time: "10:01", own: false },
  { sender: "Максим", text: "Хорошо, посмотрю сегодня", time: "10:02", own: true },
  {
    sender: "Аня",
    text: "Это довольно длинное сообщение, которое обязательно перенесётся на несколько строк, а закончится совсем коротко. Да",
    time: "10:03",
    own: false,
  },
];

function fixtureWith(messages: Fixture["messages"]): Fixture {
  return {
    currentUser: { name: "Максим", username: "maksim" },
    activeChat: { name: "Команда проекта", memberCount: 4 },
    chats: [{ name: "Команда проекта", preview: "Коротко", time: "10:05", unread: 0 }],
    messages,
  };
}

/**
 * A message whose last line very nearly fills the bubble, measured in the page.
 *
 * A hard-coded string cannot do this: the width that triggers D-032 is a window
 * of about `time + 8px` at the very end of the line, and where that window sits
 * depends on the viewport and on the font the machine actually has. So the text
 * is built against the running layout — the bubble's own content box and its
 * own font — and the spec calibrates itself on any viewport it is run at.
 *
 * It is built to sit as close to the near edge of that window as the words
 * allow: the shortest text whose last line no longer leaves room for the time.
 * A message deep inside the window would still reproduce the defect, but it
 * would pass with a cap that is merely *closer* to right than the row was —
 * which is not what is being claimed. This one only passes with the cap the
 * bubble actually has.
 */
async function craftNearlyFullLastLine(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll<HTMLElement>('[data-message-bubble="true"]'));
    let widest: HTMLElement | null = null;
    for (const bubble of bubbles) {
      if (!widest || bubble.getBoundingClientRect().width > widest.getBoundingClientRect().width) widest = bubble;
    }
    if (!widest) return "";
    const stack = widest.parentElement as HTMLElement;
    const style = window.getComputedStyle(widest);
    const padding =
      (Number.parseFloat(style.paddingLeft) || 0) +
      (Number.parseFloat(style.paddingRight) || 0) +
      (Number.parseFloat(style.borderLeftWidth) || 0) +
      (Number.parseFloat(style.borderRightWidth) || 0);
    const capContent = Math.floor(stack.getBoundingClientRect().width) - padding;

    const paragraph = widest.querySelector<HTMLElement>("[data-message-text-flow]");
    if (!paragraph) return "";
    const paragraphStyle = window.getComputedStyle(paragraph);
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;left:-99999px;top:0;white-space:pre-wrap;overflow-wrap:break-word;width:${capContent}px`;
    probe.style.fontFamily = paragraphStyle.fontFamily;
    probe.style.fontSize = paragraphStyle.fontSize;
    probe.style.fontWeight = paragraphStyle.fontWeight;
    probe.style.lineHeight = paragraphStyle.lineHeight;
    probe.style.letterSpacing = paragraphStyle.letterSpacing;
    document.body.appendChild(probe);

    const lastLineWidth = (text: string) => {
      probe.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(probe);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5);
      range.detach();
      if (!rects.length) return 0;
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      const last = rects.filter((rect) => rect.bottom > bottom - 4);
      return Math.max(...last.map((rect) => rect.right)) - Math.min(...last.map((rect) => rect.left));
    };

    // The narrowest timestamp on the page. A received message carries the time
    // alone, an own one carries delivery marks as well, so this is the harder
    // of the two to overflow — and the text is built to overflow it by as
    // little as the words allow.
    let footer = Infinity;
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-message-footer="true"]'))) {
      const width = node.getBoundingClientRect().width;
      if (width > 0) footer = Math.min(footer, width);
    }
    if (!Number.isFinite(footer)) return "";
    const gap = 8;
    const low = capContent - footer - gap;
    const high = capContent - 2;

    // Overflow the room left for the time by about this much. Far enough past
    // the threshold that the wrap it causes is unambiguous, and close enough to
    // it that a cap which is merely *near* right — the bubble's border box
    // rather than its content box, say, which is 26px looser here — still gets
    // the answer wrong and is caught.
    const target = low + 14;
    const words = "проверка ширины последней строки сообщения в пузыре мессенджера".split(" ");
    let crafted = "";
    let distance = Infinity;
    for (let count = 10; count < 160; count += 1) {
      const base = Array.from({ length: count }, (_, index) => words[index % words.length]).join(" ");
      if (lastLineWidth(base) > high) continue;
      for (let padWords = 0; padWords <= 40; padWords += 1) {
        const candidate = base + " о".repeat(padWords);
        const width = lastLineWidth(candidate);
        if (width > high) break;
        if (width <= low) continue;
        if (Math.abs(width - target) < distance) {
          distance = Math.abs(width - target);
          crafted = candidate;
        }
      }
      if (distance <= 2) break;
    }
    probe.remove();
    return crafted;
  });
}

async function samples(page: Page): Promise<Sample[]> {
  return await page.evaluate((key) => (window as unknown as Record<string, Sample[]>)[key] ?? [], SAMPLES_KEY);
}

/** Every bubble whose height changed after the frame it first appeared in. */
function lateGrowth(recorded: Sample[]) {
  const first = new Map<string, { h: number; t: number }>();
  const changes: string[] = [];
  for (const sample of recorded) {
    for (const row of sample.rows) {
      const seen = first.get(row.id);
      if (!seen) {
        first.set(row.id, { h: row.h, t: sample.t });
        continue;
      }
      if (Math.abs(seen.h - row.h) > 0.5) {
        changes.push(
          `${row.id} was painted at ${seen.h}px and became ${row.h}px ${sample.t - seen.t}ms later (now ${row.placement})`,
        );
        first.set(row.id, { h: row.h, t: sample.t });
      }
    }
  }
  return { changes, rowsSeen: first.size };
}

/**
 * Every time a bubble changed its mind about where the time goes.
 *
 * A wrong ceiling does not only make one wrong decision. Where the reserved
 * spacer changes how the text wraps, the two placements can each argue for the
 * other — anchored lets the last line run full and says it does not fit, inline
 * shortens it and says it does — and the bubble then flips on every frame until
 * React gives up on the render. So the count is asserted, not just the heights:
 * a settled layout hides an oscillation that a frame-by-frame record cannot.
 */
function placementFlips(recorded: Sample[]) {
  const last = new Map<string, string | null>();
  const flips: string[] = [];
  for (const sample of recorded) {
    for (const row of sample.rows) {
      if (last.has(row.id) && last.get(row.id) !== row.placement) {
        flips.push(`${row.id} went ${last.get(row.id)} -> ${row.placement} at ${sample.t}`);
      }
      last.set(row.id, row.placement);
    }
  }
  return flips;
}

/**
 * Bubbles that pay a whole line for keeping the time inline.
 *
 * The reserved spacer can cost a row in two ways: it wraps on its own, leaving
 * a blank line under the text, or it pushes the last word down and takes its
 * place. Both mean the bubble is a text line taller than the message needs,
 * and both are cheaper as `anchored`, whose row is shorter than a line of text.
 * So the question is asked once, of the text: does it take more lines inside
 * this bubble than it would with nothing reserved?
 */
async function reserveCostsARow(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const countLines = (rects: DOMRect[]) => {
      const lines: number[] = [];
      for (const rect of rects) {
        const centre = (rect.top + rect.bottom) / 2;
        if (!lines.some((line) => Math.abs(line - centre) <= Math.max(4, rect.height * 0.7))) lines.push(centre);
      }
      return lines.length;
    };
    const linesOf = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5);
      range.detach();
      return countLines(rects);
    };

    const problems: string[] = [];
    for (const group of Array.from(document.querySelectorAll("[data-message-text-meta-group]"))) {
      if (group.getAttribute("data-message-meta-placement") !== "inline") continue;
      const spacer = group.querySelector<HTMLElement>('[data-message-footer-reserve="true"]');
      const content = group.querySelector<HTMLElement>('[data-message-text-content="true"]');
      const bubble = group.closest<HTMLElement>('[data-message-bubble="true"]');
      if (!spacer || !content || !bubble) continue;

      const bubbleStyle = window.getComputedStyle(bubble);
      const inner =
        bubble.getBoundingClientRect().width -
        (Number.parseFloat(bubbleStyle.paddingLeft) || 0) -
        (Number.parseFloat(bubbleStyle.paddingRight) || 0) -
        (Number.parseFloat(bubbleStyle.borderLeftWidth) || 0) -
        (Number.parseFloat(bubbleStyle.borderRightWidth) || 0);

      const paragraph = group.querySelector<HTMLElement>("[data-message-text-flow]");
      if (!paragraph) continue;
      const paragraphStyle = window.getComputedStyle(paragraph);
      const probe = document.createElement("div");
      probe.style.cssText = `position:absolute;left:-99999px;top:0;white-space:pre-wrap;overflow-wrap:${paragraphStyle.overflowWrap};word-break:${paragraphStyle.wordBreak};width:${inner}px`;
      probe.style.fontFamily = paragraphStyle.fontFamily;
      probe.style.fontSize = paragraphStyle.fontSize;
      probe.style.fontWeight = paragraphStyle.fontWeight;
      probe.style.lineHeight = paragraphStyle.lineHeight;
      probe.style.letterSpacing = paragraphStyle.letterSpacing;
      probe.textContent = content.textContent ?? "";
      document.body.appendChild(probe);
      const withoutReserve = linesOf(probe);
      probe.remove();

      const rendered = linesOf(content);
      if (rendered > withoutReserve) {
        problems.push(
          `"${(content.textContent ?? "").slice(-24)}" takes ${rendered} lines inside a ${Math.round(inner)}px bubble but needs ${withoutReserve}: the ${Math.round(spacer.getBoundingClientRect().width)}px reserved for the time cost it a row`,
        );
      }
    }
    return problems;
  });
}

/** Bubbles whose reserved spacer has wrapped onto a line of its own. */
async function wrappedReserves(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const problems: string[] = [];
    for (const group of Array.from(document.querySelectorAll("[data-message-text-meta-group]"))) {
      const spacer = group.querySelector<HTMLElement>('[data-message-footer-reserve="true"]');
      const content = group.querySelector<HTMLElement>('[data-message-text-content="true"]');
      if (!spacer || !content) continue;
      const range = document.createRange();
      range.selectNodeContents(content);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5);
      range.detach();
      if (!rects.length) continue;
      const lastBottom = Math.max(...rects.map((rect) => rect.bottom));
      const spacerRect = spacer.getBoundingClientRect();
      if (spacerRect.top >= lastBottom - 1) {
        problems.push(
          `"${(content.textContent ?? "").slice(-28)}" reserved ${Math.round(spacerRect.width)}px on a line of its own`,
        );
      }
    }
    return problems;
  });
}

test.describe("message meta first paint", () => {
  test("no bubble is painted at a height it then changes", async ({ page }) => {
    // D-041. Every own message took this path, so any fixture with one in it
    // reproduces the defect — the assertion is over all of them.
    if (!(await openCapture(page, fixtureWith(BASE_MESSAGES), true))) return;
    await page.waitForTimeout(1_400);

    const recorded = await samples(page);
    expect(recorded.length, "no frames were recorded").toBeGreaterThan(10);
    const { changes, rowsSeen } = lateGrowth(recorded);
    expect(rowsSeen, "no bubbles were measured").toBe(BASE_MESSAGES.length);
    expect(changes, `a bubble changed height after it was painted: ${changes.join(" | ")}`).toEqual([]);
    const flips = placementFlips(recorded);
    expect(flips, `a bubble changed its mind about where the time goes: ${flips.join(" | ")}`).toEqual([]);
  });

  test("a nearly full last line takes its own row instead of growing one", async ({ page }) => {
    // D-032. The text is built against the live layout, so this runs at any
    // viewport the suite is pointed at.
    if (!(await openCapture(page, fixtureWith(BASE_MESSAGES), false))) return;
    await page.waitForTimeout(700);
    const crafted = await craftNearlyFullLastLine(page);
    expect(
      crafted,
      "no text could be built whose last line lands inside the bubble's final few pixels",
    ).not.toBe("");

    const messages = [
      ...BASE_MESSAGES,
      { sender: "Максим", text: crafted, time: "10:04", own: true },
      { sender: "Аня", text: crafted, time: "10:05", own: false },
    ];
    const fresh = await page.context().newPage();
    try {
      if (!(await openCapture(fresh, fixtureWith(messages), true))) return;
      await fresh.waitForTimeout(1_400);

      const wrapped = await wrappedReserves(fresh);
      expect(
        wrapped,
        `the space reserved for the time wrapped onto a blank line, which is the bubble growing a row: ${wrapped.join(" | ")}`,
      ).toEqual([]);

      // The reader-visible half of the same claim: a last line with no room
      // left for the time must not keep the time beside it. Measured on the two
      // crafted messages, which are the last two in the conversation.
      const craftedPlacement = await fresh.evaluate(() => {
        const groups = Array.from(document.querySelectorAll("[data-message-text-meta-group]"));
        return groups.slice(-2).map((group) => {
          const content = group.querySelector<HTMLElement>('[data-message-text-content="true"]');
          const footer = group.querySelector<HTMLElement>('[data-message-footer="true"]');
          if (!content || !footer) return null;
          const lastLine = Array.from(content.getClientRects()).at(-1);
          if (!lastLine) return null;
          const footerRect = footer.getBoundingClientRect();
          return {
            beside:
              Math.abs((lastLine.top + lastLine.bottom) / 2 - (footerRect.top + footerRect.bottom) / 2) <=
              Math.max(8, lastLine.height * 0.75),
            room: Math.round(lastLine.right - lastLine.left) + Math.round(footerRect.width),
          };
        });
      });
      expect(craftedPlacement.length, "the crafted messages were not found").toBe(2);
      for (const placed of craftedPlacement) {
        expect(placed, "a crafted bubble could not be measured").not.toBeNull();
        expect(
          placed!.beside,
          `the last line and the time together want ${placed!.room}px, which the bubble does not have, yet the time was kept beside the text`,
        ).toBe(false);
      }

      const costly = await reserveCostsARow(fresh);
      expect(
        costly,
        `keeping the time inline cost the message a line of its own bubble: ${costly.join(" | ")}`,
      ).toEqual([]);

      const recorded = await samples(fresh);
      const { changes, rowsSeen } = lateGrowth(recorded);
      expect(rowsSeen, "no bubbles were measured").toBe(messages.length);
      expect(changes, `a bubble changed height after it was painted: ${changes.join(" | ")}`).toEqual([]);
      const flips = placementFlips(recorded);
      expect(flips, `a bubble changed its mind about where the time goes: ${flips.join(" | ")}`).toEqual([]);
    } finally {
      await fresh.close();
    }
  });

  test("the decision is the same one the settled layout keeps", async ({ page }) => {
    // The first paint being stable is only worth something if it is stable at
    // the RIGHT answer. An inline time must still sit beside the last line, and
    // an anchored one below it — the property the reader sees, measured after
    // everything has settled.
    if (!(await openCapture(page, fixtureWith(BASE_MESSAGES), false))) return;
    await page.waitForTimeout(1_200);

    const rows = await page.evaluate(() => {
      const out: { placement: string | null; inline: boolean }[] = [];
      for (const group of Array.from(document.querySelectorAll("[data-message-text-meta-group]"))) {
        const content = group.querySelector<HTMLElement>('[data-message-text-content="true"]');
        const footer = group.querySelector<HTMLElement>('[data-message-footer="true"]');
        if (!content || !footer) continue;
        const lastLine = Array.from(content.getClientRects()).at(-1);
        if (!lastLine) continue;
        const footerRect = footer.getBoundingClientRect();
        const sameRow =
          Math.abs((lastLine.top + lastLine.bottom) / 2 - (footerRect.top + footerRect.bottom) / 2) <=
          Math.max(8, lastLine.height * 0.75);
        out.push({ placement: group.getAttribute("data-message-meta-placement"), inline: sameRow });
      }
      return out;
    });

    expect(rows.length, "no bubbles were measured").toBe(BASE_MESSAGES.length);
    for (const row of rows) {
      expect(
        row.inline,
        `a bubble reports placement "${row.placement}" but its time is ${row.inline ? "on" : "off"} the last line`,
      ).toBe(row.placement === "inline");
    }
  });
});
