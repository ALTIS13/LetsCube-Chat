import type { Page } from "@playwright/test";

/**
 * Counts React renders by component, and by instance, from outside the
 * application.
 *
 * The instrument `message-render-stability.spec.ts` introduced: a React
 * DevTools hook installed before React loads, so React reports every commit to
 * it. Nothing is added to the application to count renders. A component
 * "rendered" in a commit when its fiber carries props or hook state it did not
 * carry at the previous commit — rendering always produces a fresh hook list,
 * and a bailout (a memo hit, or a subtree React never entered) keeps both. A
 * mount counts as a render. Fibers alternate between two objects, so the record
 * is looked up on either one and the newer wins.
 *
 * `keyPaths` names the prop that identifies an instance — `["chat", "id"]` for
 * a chat row — so a count can say which rows rendered, not only how many.
 */

export interface RenderCounts {
  counts: Record<string, number>;
  byKey: Record<string, Record<string, number>>;
}

const WINDOW_KEY = "__letscubeRenderCounter";

export async function installRenderCounter(
  page: Page,
  names: string[],
  keyPaths: Record<string, string[]> = {},
): Promise<void> {
  await page.addInitScript(renderCounterScript, { windowKey: WINDOW_KEY, names, keyPaths });
}

export async function resetRenderCounts(page: Page): Promise<void> {
  await page.evaluate((key) => {
    (globalThis as unknown as Record<string, { reset: () => void }>)[key].reset();
  }, WINDOW_KEY);
}

export async function readRenderCounts(page: Page): Promise<RenderCounts> {
  return await page.evaluate((key) => {
    return (globalThis as unknown as Record<string, { read: () => RenderCounts }>)[key].read();
  }, WINDOW_KEY);
}

function renderCounterScript({
  windowKey,
  names,
  keyPaths,
}: {
  windowKey: string;
  names: string[];
  keyPaths: Record<string, string[]>;
}) {
  const counts: Record<string, number> = Object.fromEntries(names.map((name) => [name, 0]));
  const byKey: Record<string, Record<string, number>> = Object.fromEntries(names.map((name) => [name, {}]));
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
    const name = named.displayName || named.name || null;
    // The dev transform renames a function expression that would shadow the
    // binding it is assigned to: `const MessageRow = React.memo(function
    // MessageRow(...))` is served as `function MessageRow2`. Without this, a
    // memoised component is simply never counted, and every assertion about it
    // passes against any code — which is exactly what happened to `MessageRow`.
    return name ? name.replace(/\d+$/, "") : null;
  };

  const keyOf = (name: string, props: unknown): string | null => {
    const path = keyPaths[name];
    if (!path) return null;
    let value: unknown = props;
    for (const part of path) {
      if (!value || typeof value !== "object") return null;
      value = (value as Record<string, unknown>)[part];
    }
    return value === undefined || value === null ? null : String(value);
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
          const key = keyOf(name, fiber.memoizedProps);
          if (key !== null) byKey[name][key] = (byKey[name][key] ?? 0) + 1;
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
  (window as unknown as Record<string, unknown>)[windowKey] = {
    read: () => ({ counts: { ...counts }, byKey: JSON.parse(JSON.stringify(byKey)) }),
    reset: () => {
      for (const name of Object.keys(counts)) {
        counts[name] = 0;
        byKey[name] = {};
      }
    },
  };
}
