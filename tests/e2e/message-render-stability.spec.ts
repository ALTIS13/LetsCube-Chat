import { expect, test, type Page } from "@playwright/test";

/**
 * Nothing that is not about a message may render the messages.
 *
 * Half of "текст прыгает, когда печатаю": a wrap renders the list, because the
 * list's padding is a prop, and every bubble rendered with it. Measured on the
 * DEV preview fixture, identically at 390x844 and 1440x900: seven keystrokes
 * with one wrap and one unwrap rendered 96 bubbles — all 48, twice — though no
 * message changed. On a long conversation that is a long task in the very
 * frames the conversation has to move in. Two things defeated memoisation, and
 * each has a test here:
 *
 * - every row was handed values that are new on every render: an arrow per
 *   callback, a delivery state and a read summary rebuilt per call, the whole
 *   message map;
 * - every bubble read the current user with `useAppStore()` and no selector,
 *   which subscribes it to the entire store, so any store change rendered every
 *   message on screen past any `memo`.
 *
 * The render counter is a React DevTools hook injected by this test before the
 * application boots. Nothing is added to the application to count renders. The
 * frame half of the same report is `composer-typing-frames.spec.ts`.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const RENDERS_KEY = "__letscubeRenderCounts";

/** Several viewports of history: every one of these rows is at risk. */
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

/**
 * Counts React commits in which a component's body ran, by name.
 *
 * Installed as `__REACT_DEVTOOLS_GLOBAL_HOOK__` before React loads, so React
 * reports every commit to it. A component "rendered" in a commit when the
 * committed fiber carries props or hook state it did not carry at the previous
 * commit: rendering always produces a fresh hook list, and a bailout — a memo
 * hit, or a subtree React never entered — keeps both. Fibers alternate between
 * two objects, so the record is looked up on either one and the newer wins.
 */
function installRenderCounter(countsKey: string) {
  const names = ["MessageBubble", "MeasuredTextWithMeta", "MessageList", "MessageInput", "ChatHeader"];
  const counts: Record<string, number> = Object.fromEntries(names.map((name) => [name, 0]));
  type Seen = { props: unknown; state: unknown; commit: number };
  const seen = new WeakMap<object, Seen>();
  let commit = 0;

  type FiberLike = {
    tag: number;
    type: unknown;
    child: FiberLike | null;
    sibling: FiberLike | null;
    alternate: FiberLike | null;
    memoizedProps: unknown;
    memoizedState: unknown;
  };

  const nameOf = (fiber: FiberLike): string | null => {
    // FunctionComponent (0), ForwardRef (11) and SimpleMemoComponent (15) are
    // the tags whose body is the component function. A MemoComponent (14)
    // wraps a child fiber that is visited in its own right.
    if (fiber.tag !== 0 && fiber.tag !== 11 && fiber.tag !== 15) return null;
    const type = fiber.tag === 11 ? (fiber.type as { render?: unknown } | null)?.render : fiber.type;
    if (typeof type !== "function") return null;
    const named = type as { displayName?: string; name?: string };
    return named.displayName || named.name || null;
  };

  const visit = (root: { current: FiberLike }) => {
    commit += 1;
    const stack: FiberLike[] = [root.current];
    while (stack.length) {
      const fiber = stack.pop()!;
      const name = nameOf(fiber);
      if (name && name in counts) {
        const own = seen.get(fiber);
        const other = fiber.alternate ? seen.get(fiber.alternate) : undefined;
        const previous = own && other ? (own.commit > other.commit ? own : other) : own ?? other;
        if (!previous || previous.props !== fiber.memoizedProps || previous.state !== fiber.memoizedState) {
          counts[name] += 1;
        }
        seen.set(fiber, { props: fiber.memoizedProps, state: fiber.memoizedState, commit });
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
    }
  };

  (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    inject: () => 1,
    onScheduleFiberRoot: () => undefined,
    onCommitFiberRoot: (_id: number, root: { current: FiberLike }) => {
      try {
        visit(root);
      } catch {
        // A counting failure must never break the page under test.
      }
    },
    onCommitFiberUnmount: () => undefined,
    onPostCommitFiberRoot: () => undefined,
    checkDCE: () => undefined,
  };
  (window as unknown as Record<string, unknown>)[countsKey] = {
    read: () => ({ ...counts }),
    reset: () => {
      for (const name of Object.keys(counts)) counts[name] = 0;
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
  await page.addInitScript(installRenderCounter, RENDERS_KEY);

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

  // Past the entry lock and its settle timers, so the only commits counted are
  // the ones this test causes.
  await page.waitForTimeout(5_200);
}

async function resetCounts(page: Page) {
  await page.evaluate((key) => {
    (globalThis as unknown as Record<string, { reset: () => void }>)[key].reset();
  }, RENDERS_KEY);
}

async function readCounts(page: Page): Promise<Record<string, number>> {
  return await page.evaluate((key) => {
    return (globalThis as unknown as Record<string, { read: () => Record<string, number> }>)[key].read();
  }, RENDERS_KEY);
}

const composer = (page: Page) => page.locator('[data-testid="chat-composer-dock"] textarea');

/** Words the draft is typed from. Long enough to wrap at every width in the matrix. */
const DRAFT =
  "Сейчас проверю, как ведёт себя поле ввода, когда черновик доходит до края и переносится на новую строку прямо во время набора текста";

/** The longest prefix of `DRAFT` that still fits on the composer's first line, found against the running layout. */
async function longestSingleLinePrefix(page: Page): Promise<number> {
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
  await field.fill("");
  return low;
}

test.describe("message render stability", () => {
  test("typing, wrapping and unwrapping re-render no message bubble", async ({ page }) => {
    await openCapture(page);
    const length = await longestSingleLinePrefix(page);
    const field = composer(page);
    await field.fill(DRAFT.slice(0, length - 3));
    await page.waitForTimeout(800);
    await resetCounts(page);

    // Three characters that fit, the one that wraps, one more, and two
    // deletions — the second of which unwraps.
    for (let index = length - 3; index <= length + 1; index += 1) {
      await page.keyboard.type(DRAFT[index]);
      await page.waitForTimeout(120);
    }
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(120);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(400);

    const counts = await readCounts(page);
    console.log(`[render-stability] ${test.info().project.name} renders over 7 keystrokes: ${JSON.stringify(counts)}`);

    // The premise: the counter sees commits at all, and the composer's own
    // renders are among them. A counter that saw nothing would pass the
    // assertion below against any code.
    expect(counts.MessageInput, "the render counter recorded no composer render, so it is not counting").toBeGreaterThanOrEqual(7);
    // The wrap and the unwrap change the list's padding, so the list itself
    // renders — that is how the padding reaches it. What it renders must stop
    // at the rows, because no message changed.
    expect(counts.MessageList, "the composer never changed height, so the list was never at risk").toBeGreaterThan(0);
    expect(counts.MessageBubble, `typing re-rendered message bubbles: ${JSON.stringify(counts)}`).toBe(0);
    expect(counts.MeasuredTextWithMeta, `typing re-rendered message text: ${JSON.stringify(counts)}`).toBe(0);
  });

  test("a store change that is about no message re-renders no bubble", async ({ page }) => {
    // Typing alone never touches the store, so the test above cannot see a
    // bubble that subscribes to all of it.
    await openCapture(page);
    await resetCounts(page);

    const premise = await page.evaluate(async () => {
      // The module the application imports: Vite serves one instance per URL.
      // A string, so the type checker does not try to resolve a browser path.
      const url = "/src/store/app.store.ts";
      const { useAppStore } = (await import(/* @vite-ignore */ url)) as {
        useAppStore: {
          getState: () => { currentUser: { username: string | null } | null };
          setState: (partial: Record<string, unknown>) => void;
        };
      };
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      // Nothing on the capture page reads a panel request; `ChatWindow`, which
      // does, is not mounted here.
      useAppStore.setState({ chatPanelRequest: { chatId: "not-this-chat", panel: "search", key: 1 } });
      await frame();
      await frame();
      useAppStore.setState({ chatPanelRequest: null });
      await frame();
      await frame();
      return { sameStore: useAppStore.getState().currentUser?.username === "maksim" };
    });
    expect(premise.sameStore, "the imported store is not the one the page renders from").toBe(true);

    const counts = await readCounts(page);
    console.log(`[render-stability] ${test.info().project.name} renders over 2 unrelated store changes: ${JSON.stringify(counts)}`);

    // The premise: the change reached subscribers. The chat header subscribes to
    // the whole store, so it renders for each one.
    expect(counts.ChatHeader, "the store changes reached no subscriber, so nothing was at risk").toBeGreaterThanOrEqual(2);
    expect(counts.MessageBubble, `an unrelated store change re-rendered message bubbles: ${JSON.stringify(counts)}`).toBe(0);
  });
});
