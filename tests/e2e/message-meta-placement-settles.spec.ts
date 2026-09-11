import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * D-080: the time placement settles, whatever lane is kept beside a message.
 *
 * A bubble decides whether its time sits inline or on a row of its own by
 * measuring the layout it has just rendered, and where the stack's cap follows a
 * row shrink-wrapped around the message, the two placements lay the message out
 * at different widths. Measured on this conversation at 768x1024 with a 40px
 * lane: inline, the spacer took the row to the full 376px, the text sat on one
 * 288.8px line and the time did not fit beside it; anchored, the row shrank to
 * 314.8px, the cap followed it to 274.8px, the text wrapped to a 45.4px last line
 * and the time fitted. Two own messages changed their minds 52 times each, React
 * stopped with "Maximum update depth exceeded", and the error boundary replaced
 * every screen with «Произошла ошибка интерфейса».
 *
 * The shipped lane (0 below 640px, 6.5rem from 640px up) does not do it, and the
 * lane is about to change: the hover actions go, and a slim lane for a quick
 * reaction may come back in narrow windows — perhaps different on each side,
 * since a received row also carries the avatar column. So the lane is the
 * variable here, on both sides and on each side alone, across tablet and desktop
 * widths.
 *
 * A lane change on its own re-measures nothing — the bubbles observe their footer
 * and, after a change, their stack — so each step also sends the window a resize,
 * which is what a real lane change comes with. One test starts with the lane
 * already on the page, which is the mount path.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const CHANGES_KEY = "__letscubePlacementChanges";
const ERROR_SCREEN = "Произошла ошибка интерфейса";

const TEMPLATES = [
  "Коротко",
  "Средней длины сообщение, которое на телефоне переносится на две строки, а на широком экране остаётся в одной",
  "Да, согласен",
  "Это довольно длинное сообщение, которое обязательно перенесётся на несколько строк в обычном пузыре, а закончится совсем коротко. Да",
  "Хорошо, посмотрю сегодня вечером",
  "Ещё одно длинное сообщение, у которого последняя строка занята текстом почти целиком и места для времени в ней уже не остаётся никакого совсем",
  "Ок",
  "Встречаемся завтра в десять у главного входа, не опаздывай, пожалуйста",
  "Я отправил документы на почту, проверь, всё ли на месте и нет ли ошибок в расчётах за прошлый месяц",
  "Спасибо!",
  "Средней длины сообщение, которое на телефоне переносится на две строки, а на широком экране остаётся в одной",
  "Длинный абзац о планах на неделю: в понедельник созвон с командой, во вторник разбор задач, в среду демонстрация, в четверг ретроспектива, а в пятницу отдыхаем",
  "Можно подробнее про второй пункт?",
  "Первая строка\nВторая строка подлиннее\nТретья",
  "Отлично, тогда так и сделаем, я предупрежу остальных",
  "Уже выхожу",
  "Сегодня не получится, давай перенесём на четверг или на пятницу после обеда, если тебе удобно",
];

const COUNT = 120;

/** The conversation of `message-meta-spacer-line.spec.ts`, which is where the loop was found. */
const MESSAGES = Array.from({ length: COUNT }, (_, index) => {
  const own = index % 5 === 1 || index % 5 === 2;
  return {
    sender: own ? "Максим" : "Аня",
    text: `${String(index + 1).padStart(3, "0")}. ${TEMPLATES[index % TEMPLATES.length]}`,
    time: `09:${String(index % 60).padStart(2, "0")}`,
    own,
  };
});

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [{ name: "Команда проекта", preview: "Коротко", time: "09:59", unread: 0 }],
  messages: MESSAGES,
};

const LANES = ["2rem", "2.5rem", "4.375rem", "6.5rem"];

/**
 * A message changes placement at most twice for one change of its inputs: a hold
 * from the old inputs is released by an inline answer, and a new anchored answer
 * then stands. More than that is a message arguing with itself.
 */
const MAX_CHANGES_PER_STEP = 2;

/**
 * A mount pays for its face as well. When Inter arrives it widens the footer, so
 * the spacer that reserves the footer's room is one render behind: the first
 * inline layout after it is on a narrower row, its anchored answer is taken but
 * not held, the anchored layout gives it back, and the inline layout with the
 * spacer in place decides. Measured at 768px with a 2.5rem lane from the start:
 * 25 messages changed once and 6 changed three times, all three in the
 * millisecond Inter arrived, and none changed after settling. A message already
 * held in the fallback face adds the release, so the bound is four.
 */
const MAX_CHANGES_ON_MOUNT = 4;

/** Counts every placement change per message, from before the application boots. */
function installChangeCounter(changesKey: string) {
  const counts: Record<string, number> = {};
  (window as unknown as Record<string, unknown>)[changesKey] = counts;
  new MutationObserver((records) => {
    for (const record of records) {
      const id = (record.target as Element).closest("[data-message-id]")?.getAttribute("data-message-id") ?? "?";
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }).observe(document, {
    attributes: true,
    attributeFilter: ["data-message-meta-placement"],
    subtree: true,
  });
}

function applyLaneBeforeBoot(lane: string) {
  // The root element does not exist yet when an init script runs.
  const apply = () => {
    if (!document.documentElement) return false;
    document.documentElement.style.setProperty("--kub-action-lane", lane);
    return true;
  };
  if (!apply()) {
    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect();
    });
    observer.observe(document, { childList: true });
  }
}

/**
 * D-071 took the lane out of the product (`932d11e`): a message's cap follows
 * the viewport now, not the row, and the loop this spec guards against needs a
 * cap that follows the row. So every capture puts back the rule the product
 * used to ship — `max(16rem, 100% - lane)` on each message stack from 640px —
 * and the lane steps drive it as before.
 *
 * What that proves changed with the layout, and it was checked rather than
 * assumed: on 2026-09-11, with the hold switched off in `MessageBubble.tsx`,
 * the 640 and 768px test still passed. The rows D-071 draws no longer shrink
 * round the message with its placement, so a cap that follows the row cannot
 * set the loop off here. This spec is now a guard that the placement settles
 * under any such cap, not a reproduction of D-080; the hold itself is proved by
 * `tests/unit/message-meta-hold.test.mts`.
 */
function restoreRowCapBeforeBoot() {
  const css =
    '@media (min-width: 640px) { :has(> [data-message-bubble="true"]) { max-width: max(16rem, calc(100% - var(--kub-action-lane, 0px))) !important; } }';
  const apply = () => {
    const root = document.head ?? document.documentElement;
    if (!root) return false;
    const style = document.createElement("style");
    style.id = "d080-row-cap";
    style.textContent = css;
    root.appendChild(style);
    return true;
  };
  if (!apply()) {
    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect();
    });
    observer.observe(document, { childList: true });
  }
}

type Capture = { page: Page; depthErrors: string[] };

/**
 * A page of its own for each viewport: init scripts stay with a page across
 * navigations, and a second counter on the same page would count every change
 * twice.
 */
async function openCapture(context: BrowserContext, width: number, options: { lane?: string } = {}): Promise<Capture> {
  const page = await context.newPage();
  const capture: Capture = { page, depthErrors: [] };
  const record = (text: string) => {
    if (/Maximum update depth/i.test(text)) capture.depthErrors.push(text.slice(0, 200));
  };
  page.on("console", (message) => {
    if (message.type() === "error") record(message.text());
  });
  page.on("pageerror", (error) => record(error.message));

  await page.setViewportSize({ width, height: 1024 });
  // The fixture refuses a message stamped later than "now", so the clock is
  // pinned exactly as the sibling meta specs pin it.
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  await page.addInitScript(installChangeCounter, CHANGES_KEY);
  await page.addInitScript(restoreRowCapBeforeBoot);
  if (options.lane) await page.addInitScript(applyLaneBeforeBoot, options.lane);

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
      return capture;
    }
    throw new Error(
      response
        ? "The preview capture route did not report ready. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1, or set KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1 to accept that this contract goes unchecked."
        : "The DEV preview capture route is not served. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1, or set KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1 to accept that this contract goes unchecked.",
    );
  }

  // The loop can take the conversation down before it has finished mounting, so
  // the error screen is waited for as well as the messages.
  await page.waitForFunction(
    ([count, errorScreen]) =>
      document.querySelectorAll('[data-message-text-meta-group="true"]').length >= (count as number) ||
      document.body.innerText.includes(errorScreen as string),
    [COUNT, ERROR_SCREEN] as const,
  );
  await page
    .waitForFunction(
      () => Array.from(document.fonts).some((face) => face.family.replace(/["']/g, "") === "Inter" && face.status === "loaded"),
      undefined,
      { timeout: 10_000 },
    )
    // Offline the face never comes; the contract holds in any face.
    .catch(() => undefined);
  return capture;
}

/** Nothing fell over: no error screen, no update-depth error, every message still there. */
async function expectStanding(capture: Capture, step: string) {
  const state = await capture.page.evaluate(
    (errorScreen) => ({
      errorScreen: document.body.innerText.includes(errorScreen),
      groups: document.querySelectorAll('[data-message-text-meta-group="true"]').length,
    }),
    ERROR_SCREEN,
  );
  expect(state.errorScreen, `${step}: the error boundary replaced the interface`).toBe(false);
  expect(capture.depthErrors, `${step}: React reported an update loop`).toEqual([]);
  expect(state.groups, `${step}: the conversation is no longer rendered`).toBe(COUNT);
}

/** Placements and paragraph boxes, unchanged for `quietMs`. */
async function waitForSettledLayout(capture: Capture, step: string, quietMs: number) {
  const signature = () =>
    capture.page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-message-text-meta-group="true"]'))
        .map((group) => {
          const paragraph = group.querySelector("[data-message-text-flow]");
          const box = paragraph?.getBoundingClientRect();
          return `${group.getAttribute("data-message-meta-placement")}:${box ? Math.round(box.width) : 0}x${box ? Math.round(box.height) : 0}`;
        })
        .join("|"),
    );
  const needed = Math.ceil(quietMs / 250);
  let previous = await signature();
  let unchanged = 0;
  for (let sample = 0; sample < 80 && unchanged < needed; sample += 1) {
    await capture.page.waitForTimeout(250);
    const current = await signature();
    unchanged = current === previous ? unchanged + 1 : 0;
    previous = current;
  }
  expect(unchanged, `${step}: the conversation never stopped re-laying itself out`).toBeGreaterThanOrEqual(needed);
  // An error screen holds still too. Measured before the fix, with the lane on
  // the page from the start: the conversation mounted in the fallback face,
  // Inter re-wrapped it into the loop 1–2s later, and an empty page then read
  // as settled.
  await expectStanding(capture, step);
}

const readChanges = (capture: Capture) =>
  capture.page.evaluate(
    (key) => ({ ...((window as unknown as Record<string, Record<string, number>>)[key] ?? {}) }),
    CHANGES_KEY,
  );

const resetChanges = (capture: Capture) =>
  capture.page.evaluate((key) => {
    const counts = (window as unknown as Record<string, Record<string, number>>)[key];
    for (const id of Object.keys(counts)) delete counts[id];
  }, CHANGES_KEY);

const readPlacements = (capture: Capture) =>
  capture.page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll("[data-message-id]")).map((row) => [
        row.getAttribute("data-message-id") ?? "?",
        row.querySelector('[data-message-text-meta-group="true"]')?.getAttribute("data-message-meta-placement") ?? null,
      ]),
    ),
  );

/** Few changes on the way to settling, and none once settled. */
async function expectBounded(
  capture: Capture,
  step: string,
  changes: Record<string, number>,
  bound: number = MAX_CHANGES_PER_STEP,
) {
  const restless = Object.entries(changes).filter(([, count]) => count > bound);
  expect(restless, `${step}: messages that changed placement more than ${bound} times`).toEqual([]);
  await resetChanges(capture);
  await capture.page.waitForTimeout(1200);
  expect(await readChanges(capture), `${step}: placements still changing after the conversation settled`).toEqual({});
  await expectStanding(capture, step);
}

/** Applies one step and holds the conversation to settling within the bound. */
async function expectSettles(capture: Capture, step: string, apply: () => Promise<void>) {
  await resetChanges(capture);
  await apply();
  // A lane change alone re-measures nothing; a real one comes with a resize.
  await capture.page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await capture.page.waitForTimeout(300);
  await expectStanding(capture, step);
  await waitForSettledLayout(capture, step, 1500);
  await expectStanding(capture, step);
  const changes = await readChanges(capture);
  await expectBounded(capture, step, changes);
  return changes;
}

const setRootLane = (capture: Capture, lane: string | null) =>
  capture.page.evaluate((value) => {
    if (value === null) document.documentElement.style.removeProperty("--kub-action-lane");
    else document.documentElement.style.setProperty("--kub-action-lane", value);
  }, lane);

const toPx = (lane: string) => `${Number.parseFloat(lane) * (lane.endsWith("rem") ? 16 : 1)}px`;

/** The lane each side's stacks actually resolved, read back from their computed cap. */
const resolvedLanes = (capture: Capture) =>
  capture.page.evaluate(() => {
    const lanes = { own: new Set<string>(), received: new Set<string>() };
    for (const bubble of Array.from(document.querySelectorAll('[data-message-bubble="true"]'))) {
      const stack = bubble.parentElement;
      const row = stack?.parentElement;
      if (!stack || !row) continue;
      // A zero lane serialises as `100% + 0px`, `100% - 0px` or a bare `100%`.
      const cap = getComputedStyle(stack).maxWidth;
      const offset = /100%\s*([-+])\s*([\d.]+)px/.exec(cap);
      const lane = offset
        ? `${offset[1] === "-" ? Number.parseFloat(offset[2]) : -Number.parseFloat(offset[2]) || 0}px`
        : /100%/.test(cap)
          ? "0px"
          : null;
      const side = getComputedStyle(row).justifyContent === "flex-end" ? "own" : "received";
      if (lane) lanes[side].add(lane);
    }
    return { own: [...lanes.own], received: [...lanes.received] };
  });

/** Every lane in turn on a conversation that settled on the shipped one. */
async function expectEveryLaneSettles(context: BrowserContext, width: number) {
  const capture = await openCapture(context, width);
  await expectStanding(capture, `${width}px as shipped`);
  await waitForSettledLayout(capture, `${width}px as shipped`, 2500);

  let moved = 0;
  for (const lane of LANES) {
    const step = `${width}px, lane ${lane}`;
    const changes = await expectSettles(capture, step, () => setRootLane(capture, lane));
    moved += Object.values(changes).reduce((sum, count) => sum + count, 0);
    // The premise: the lane really reached the caps, or this checked nothing.
    const resolved = await resolvedLanes(capture);
    expect(resolved.own, `${step}: own stacks did not resolve the lane`).toEqual([toPx(lane)]);
    expect(resolved.received, `${step}: received stacks did not resolve the lane`).toEqual([toPx(lane)]);
  }
  console.log(`[placement-settles] ${test.info().project.name} ${width}px: ${moved} placement changes across ${LANES.length} lanes`);
  await capture.page.close();
}

test.describe("message meta placement settles", () => {
  // Every step waits for 120 messages to hold still.
  test.describe.configure({ timeout: 150_000 });

  // Split in two to stay inside one timeout. Before the fix, 768px looped at 2rem
  // and 2.5rem, and 900px at 2rem, 2.5rem and 4.375rem; 640, 1024 and 1280px
  // settled on this conversation, which is why each half carries a width that
  // did not.
  test("every lane from 2rem to 6.5rem settles at 640 and 768px", async ({ context }) => {
    for (const width of [640, 768]) await expectEveryLaneSettles(context, width);
  });

  test("every lane from 2rem to 6.5rem settles at 900, 1024 and 1280px", async ({ context }) => {
    for (const width of [900, 1024, 1280]) await expectEveryLaneSettles(context, width);
  });

  test("a lane that differs on each side settles too", async ({ context }) => {
    // A received row carries the 32px avatar column and a 6px gap, so a lane
    // sized for it can be wrong for an own row, and each side can loop alone.
    const pairs: [own: string, received: string][] = [
      ["2rem", "4.375rem"],
      ["2.5rem", "0px"],
      ["0px", "2.5rem"],
      ["6.5rem", "2rem"],
    ];
    for (const width of [768, 1024]) {
      const capture = await openCapture(context, width);
      await waitForSettledLayout(capture, `${width}px as shipped`, 2500);
      for (const [own, received] of pairs) {
        const step = `${width}px, own ${own}, received ${received}`;
        await expectSettles(capture, step, () =>
          capture.page.evaluate(
            ([ownLane, receivedLane]) => {
              let style = document.getElementById("d080-lanes");
              if (!style) {
                style = document.createElement("style");
                style.id = "d080-lanes";
                document.head.appendChild(style);
              }
              // The row packs an own message to the end; the stack inside it
              // inherits the lane. Matched by what the row holds rather than
              // by where it sits, since D-071 changed the rows around it.
              style.textContent =
                `.justify-end:has(> * > [data-message-bubble="true"]) { --kub-action-lane: ${ownLane}; }\n` +
                `.justify-start:has(> * > [data-message-bubble="true"]) { --kub-action-lane: ${receivedLane}; }`;
            },
            [own, received] as const,
          ),
        );
        const resolved = await resolvedLanes(capture);
        expect(resolved.own, `${step}: own stacks did not resolve their lane`).toEqual([toPx(own)]);
        expect(resolved.received, `${step}: received stacks did not resolve their lane`).toEqual([toPx(received)]);
      }
      await capture.page.close();
    }
  });

  test("a lane present from the first paint settles on mount", async ({ context }) => {
    // The mount path measures synchronously inside the layout effect, where a
    // loop never reaches a frame at all.
    for (const [width, lane] of [
      [768, "2.5rem"],
      [1024, "2rem"],
    ] as const) {
      const step = `${width}px, lane ${lane} from the start`;
      const capture = await openCapture(context, width, { lane });
      await expectStanding(capture, step);
      await waitForSettledLayout(capture, step, 2500);
      const resolved = await resolvedLanes(capture);
      expect(resolved.own, `${step}: own stacks did not resolve the lane`).toEqual([toPx(lane)]);
      await expectBounded(capture, step, await readChanges(capture), MAX_CHANGES_ON_MOUNT);
      await capture.page.close();
    }
  });

  test("a wider window puts every message where a fresh page at that width puts it", async ({ context }) => {
    // The same promise for a resize: it moves the message row and the viewport
    // terms of the cap, and a message held at the narrower width must not keep
    // the placement that width gave it.
    const fresh = await openCapture(context, 1024, { lane: "2.5rem" });
    await waitForSettledLayout(fresh, "1024px from the start, lane 2.5rem", 2500);
    const expected = await readPlacements(fresh);
    await fresh.page.close();

    const capture = await openCapture(context, 768, { lane: "2.5rem" });
    await waitForSettledLayout(capture, "768px from the start, lane 2.5rem", 2500);
    const narrow = await readPlacements(capture);
    // The premise: the two widths place some message differently.
    const moved = Object.keys(expected).filter((id) => expected[id] !== narrow[id]);
    expect(moved.length, "768 and 1024px place every message alike, so a resize proves nothing").toBeGreaterThan(0);

    await capture.page.setViewportSize({ width: 1024, height: 1024 });
    await waitForSettledLayout(capture, "resized to 1024px", 2500);
    const resized = await readPlacements(capture);
    const stale = Object.keys(expected).filter((id) => expected[id] !== resized[id]);
    expect(
      stale.map((id) => `${id}: fresh ${expected[id]}, after the resize ${resized[id]}`),
      "messages that kept the placement the narrower window gave them",
    ).toEqual([]);
    await capture.page.close();
  });

  test("a lane taken back puts every message where a fresh page puts it", async ({ context }) => {
    // Holding an answer must not outlive the layout it was measured on: once the
    // lane is back, nothing may keep the placement the narrower lane gave it.
    const capture = await openCapture(context, 768);
    await waitForSettledLayout(capture, "768px as shipped", 2500);
    const fresh = await readPlacements(capture);

    await expectSettles(capture, "768px, lane 2.5rem", () => setRootLane(capture, "2.5rem"));
    const underLane = await readPlacements(capture);
    // The premise: the lane moved something, or taking it back proves nothing.
    const moved = Object.keys(fresh).filter((id) => fresh[id] !== underLane[id]);
    expect(moved.length, "the 2.5rem lane moved no placement, so there is nothing to take back").toBeGreaterThan(0);

    await expectSettles(capture, "768px, lane taken back", () => setRootLane(capture, null));
    const back = await readPlacements(capture);
    const stale = Object.keys(fresh).filter((id) => fresh[id] !== back[id]);
    expect(
      stale.map((id) => `${id}: fresh ${fresh[id]}, after the lane ${back[id]}`),
      "messages that kept the placement the lane gave them",
    ).toEqual([]);
    await capture.page.close();
  });
});
