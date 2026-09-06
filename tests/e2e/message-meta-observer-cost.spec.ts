import { expect, test, type Page } from "@playwright/test";

/**
 * D-069: what every message on screen costs to keep measured.
 *
 * Each bubble decides where its timestamp sits by measuring, and it keeps that
 * decision current with a `ResizeObserver`. The observer is registered per
 * message, so the number of nodes it watches is multiplied by the size of the
 * conversation: at 400 messages, a third node adds 400 live observation targets
 * and 653 further `observe()` calls, and raises the entries the browser
 * delivers during the mount by 75%.
 *
 * `tests/unit/message-bubble-measurement-cost.test.mjs` writes the limit down,
 * but it reads the source. Measured: a third node added as its own
 * `observer.observe(textFlowRef.current)` statement, outside the array that
 * test parses, left all three of its assertions green. This is the check that
 * counts what the running chat actually registers, so the form the nodes are
 * named in cannot matter.
 *
 * The lower bound is asserted too. A guard that only forbids a third node is
 * satisfied by deleting the observer altogether — and then nothing re-measures
 * a bubble whose text re-wraps after a late webfont, which is the whole reason
 * the observer exists.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const COUNTS_KEY = "__letscubeObserverCosts";

/**
 * Both placements have to occur, because they cost different numbers of nodes.
 *
 * On the mount that matters the bubble and stack refs are still null — React
 * attaches host refs child-first — so the first pass observes the footer alone.
 * A message whose placement never changes therefore stays at one node forever,
 * and only a message that re-runs the effect reaches two. A fixture of nothing
 * but short messages would measure a limit of one and pass against three.
 */
const MESSAGES = [
  { sender: "Аня", text: "Коротко", time: "10:01", own: false },
  { sender: "Максим", text: "Ок", time: "10:02", own: true },
  {
    sender: "Аня",
    text:
      "Это довольно длинное сообщение, которое обязательно перенесётся на несколько строк в обычном пузыре, а закончится совсем коротко. Да",
    time: "10:03",
    own: false,
  },
  {
    sender: "Аня",
    text:
      "Ещё одно длинное сообщение, у которого последняя строка занята текстом почти целиком и места для времени в ней уже не остаётся никакого совсем",
    time: "10:04",
    own: false,
  },
  {
    sender: "Максим",
    text:
      "И собственное длинное сообщение, которое переносится на несколько строк и заканчивается длинной последней строкой без всякого свободного места",
    time: "10:05",
    own: true,
  },
  { sender: "Максим", text: "Договорились, встречаемся в три", time: "10:06", own: true },
];

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [{ name: "Команда проекта", preview: "Договорились", time: "10:06", unread: 0 }],
  messages: MESSAGES,
};

/**
 * Counts what is observed, not what the source says is observed.
 *
 * Installed before the application boots so every registration goes through it,
 * and it tracks `unobserve` and `disconnect` as well: the measurement effect
 * disconnects and re-registers on every placement change, so cumulative
 * `observe()` calls would say four where two nodes are live.
 */
function installObserverCounter(countsKey: string) {
  const live = new Map<Element, number>();
  const NativeResizeObserver = window.ResizeObserver;
  if (!NativeResizeObserver) return;

  class CountingResizeObserver extends NativeResizeObserver {
    private readonly targets = new Set<Element>();

    override observe(target: Element, options?: ResizeObserverOptions) {
      this.targets.add(target);
      live.set(target, (live.get(target) ?? 0) + 1);
      super.observe(target, options);
    }

    override unobserve(target: Element) {
      this.drop(target);
      super.unobserve(target);
    }

    override disconnect() {
      for (const target of [...this.targets]) this.drop(target);
      super.disconnect();
    }

    private drop(target: Element) {
      if (!this.targets.delete(target)) return;
      const remaining = (live.get(target) ?? 0) - 1;
      if (remaining > 0) live.set(target, remaining);
      else live.delete(target);
    }
  }

  window.ResizeObserver = CountingResizeObserver as unknown as typeof ResizeObserver;

  (window as unknown as Record<string, unknown>)[countsKey] = () => {
    const rows = Array.from(document.querySelectorAll("[data-message-id]"));
    const perRow = new Map<Element, number>(rows.map((row) => [row, 0]));
    let outsideRows = 0;
    for (const [target, registrations] of live) {
      if (!target.isConnected) continue;
      const row = target.closest("[data-message-id]");
      if (row && perRow.has(row)) perRow.set(row, (perRow.get(row) ?? 0) + registrations);
      else outsideRows += registrations;
    }
    return {
      rows: rows.length,
      // Only the rows that carry a measured text/meta group: a media-only or
      // system row runs no measurement and observes nothing, and averaging it
      // in would hide a third node behind it.
      measured: rows
        .filter((row) => row.querySelector('[data-message-text-meta-group="true"]'))
        .map((row) => ({
          text: (row.querySelector('[data-message-text-content="true"]')?.textContent ?? "").slice(0, 24),
          placement:
            row
              .querySelector('[data-message-text-meta-group="true"]')
              ?.getAttribute("data-message-meta-placement") ?? null,
          observed: perRow.get(row) ?? 0,
        })),
      outsideRows,
    };
  };
}

async function openCapture(page: Page) {
  // The fixture refuses a message stamped later than "now" — it would render a
  // weekday instead of a time — so the clock is pinned exactly as the sibling
  // meta specs pin it.
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  await page.addInitScript(installObserverCounter, COUNTS_KEY);

  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;

  // Same rule as the sibling meta specs: a missing prerequisite fails loudly
  // rather than reporting success while enforcing nothing.
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

  // Let every bubble settle: the first pass measures synchronously, two frames
  // and the shared fonts promise follow, and a placement change re-runs the
  // effect once more. The count is only meaningful once that has finished.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-message-text-meta-group="true"]').length > 0,
  );
  await page.waitForTimeout(1200);
}

function readCosts(page: Page) {
  return page.evaluate((key) => {
    const read = (window as unknown as Record<string, unknown>)[key];
    if (typeof read !== "function") throw new Error("the observer counter was not installed");
    return (read as () => {
      rows: number;
      measured: { text: string; placement: string | null; observed: number }[];
      outsideRows: number;
    })();
  }, COUNTS_KEY);
}

test.describe("message measurement cost", () => {
  test("a message keeps at most two nodes under observation", async ({ page }) => {
    await openCapture(page);
    const costs = await readCosts(page);

    expect(costs.measured.length, "the fixture rendered no measured message").toBeGreaterThan(0);

    const worst = costs.measured.reduce((a, b) => (b.observed > a.observed ? b : a));
    expect(
      worst.observed,
      `"${worst.text}" holds ${worst.observed} observed nodes. Every node is registered once per message, ` +
        `so this is multiplied by the whole screenful: measured at 400 messages, a third node costs 400 more ` +
        `live targets and 75% more delivered entries, and bought no different answer anywhere. ` +
        `Raise the limit only with the measurement that justifies it, and update D-069 with the numbers.`,
    ).toBeLessThanOrEqual(2);

    // The total is the number the cost is actually proportional to.
    const total = costs.measured.reduce((sum, row) => sum + row.observed, 0);
    expect(total).toBeLessThanOrEqual(costs.measured.length * 2);
  });

  test("and at least one, or nothing re-measures it", async ({ page }) => {
    await openCapture(page);
    const costs = await readCosts(page);

    const unwatched = costs.measured.filter((row) => row.observed < 1);
    expect(
      unwatched.map((row) => row.text),
      "a measured message with nothing under observation never notices its text re-wrapping — " +
        "a late webfont re-wraps a settled conversation and the placement would stay on the old layout",
    ).toEqual([]);
  });

  test("both placements are represented, or the count means nothing", async ({ page }) => {
    await openCapture(page);
    const costs = await readCosts(page);

    // The first pass observes the footer alone, because the bubble and stack
    // refs are still null while React walks children before parents. Only a
    // message that re-runs the effect ever reaches two nodes. Without one of
    // each in the fixture the ceiling above is measured against a single-node
    // population and would pass with three.
    const placements = new Set(costs.measured.map((row) => row.placement));
    expect(
      [...placements].sort(),
      "the fixture must produce both an inline and an anchored message",
    ).toEqual(["anchored", "inline"]);

    const twoNode = costs.measured.filter((row) => row.observed === 2);
    expect(
      twoNode.length,
      "no message reached the two-node state, so the ceiling was never approached and a third node could hide",
    ).toBeGreaterThan(0);
  });
});
