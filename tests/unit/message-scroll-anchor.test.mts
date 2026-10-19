import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import {
  adjustVisibleMessageAnchorForPendingScroll,
  captureVisibleMessageAnchor,
  matchesAnchoredScrollTop,
  restoreVisibleMessageAnchor,
  type VisibleMessageAnchor,
} from "../../artifacts/kub/src/lib/messageScrollAnchor.ts";

type Rect = { top: number; bottom: number };

function message(id: string, rect: Rect) {
  return {
    dataset: { messageId: id },
    getBoundingClientRect: () => rect,
  };
}

function container(messages: ReturnType<typeof message>[]) {
  return {
    scrollTop: 120,
    scrollHeight: 2_400,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
    querySelectorAll: () => messages,
  } as unknown as HTMLElement;
}

test("a prepend correction owns only its current scroll position", () => {
  const node = container([]);
  assert.equal(matchesAnchoredScrollTop(node, 120), true);
  node.scrollTop = 108;
  assert.equal(matchesAnchoredScrollTop(node, 120), false, "continuing upward inertia belongs to the reader");
  node.scrollTop = 132;
  assert.equal(matchesAnchoredScrollTop(node, 120), false, "continuing downward inertia belongs to the reader");
  node.scrollTop = 120.5;
  assert.equal(matchesAnchoredScrollTop(node, 120), true);
  node.scrollTop = 122;
  assert.equal(matchesAnchoredScrollTop(node, 120), false);
});

test("a layout clamp does not masquerade as a new reader scroll", () => {
  const node = container([]);
  node.scrollTop = 1800;
  assert.equal(matchesAnchoredScrollTop(node, 2000), true);
  node.scrollTop = 1788;
  assert.equal(matchesAnchoredScrollTop(node, 2000), false);
  node.scrollTop = 0;
  assert.equal(matchesAnchoredScrollTop(node, -20), true);
});

test("captures the first message crossing the visible viewport", () => {
  const node = container([
    message("hidden", { top: 20, bottom: 90 }),
    message("visible", { top: 90, bottom: 150 }),
  ]);

  assert.deepEqual(captureVisibleMessageAnchor(node), {
    messageId: "visible",
    viewportOffset: -10,
  });
});

test("restores the same message offset after older rows are prepended", () => {
  const target = message("anchor", { top: 460, bottom: 520 });
  const node = container([target]);

  assert.equal(
    restoreVisibleMessageAnchor(node, { messageId: "anchor", viewportOffset: 40 }),
    true,
  );
  assert.equal(node.scrollTop, 440);
});

test("does not move when the captured message is no longer rendered", () => {
  const node = container([]);
  assert.equal(
    restoreVisibleMessageAnchor(node, { messageId: "missing", viewportOffset: 20 }),
    false,
  );
  assert.equal(node.scrollTop, 120);
});

/**
 * The property the older-history hold is built on.
 *
 * The hold calls this once per animation frame for as long as the prepended
 * rows are still settling, and that is only safe because each call recomputes
 * the correction from where the anchor is NOW. A restore that applied a
 * remembered delta instead would accumulate: the register measured the anchor
 * drifting 1147px while the content grew 6469px, against a contract that allows
 * 3px, and four consecutive settled frames are what release the hold.
 *
 * `live()` models a real scroller: writing `scrollTop` moves every row, exactly
 * as the browser does, so a second call sees the result of the first.
 */
function live(rows: Record<string, number>, scrollTop = 1_000) {
  const state = { scrollTop, rows: { ...rows } };
  const node = {
    get scrollTop() { return state.scrollTop; },
    set scrollTop(next: number) {
      const delta = next - state.scrollTop;
      state.scrollTop = next;
      for (const id of Object.keys(state.rows)) state.rows[id] -= delta;
    },
    scrollHeight: 20_000,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    querySelectorAll: () => Object.entries(state.rows).map(([id, top]) =>
      message(id, { top, bottom: top + 40 })),
  } as unknown as HTMLElement;
  return { node, state };
}

test("restoring twice converges instead of accumulating", () => {
  const { node, state } = live({ anchor: 300 });
  const anchor = { messageId: "anchor", viewportOffset: 100 };

  restoreVisibleMessageAnchor(node, anchor);
  assert.equal(state.rows.anchor, 100, "the first restore did not land the anchor");
  const afterFirst = state.scrollTop;

  restoreVisibleMessageAnchor(node, anchor);
  assert.equal(state.scrollTop, afterFirst, "a second restore moved the list again");
  assert.equal(state.rows.anchor, 100);
});

test("a restore after the content has grown above the anchor still lands it exactly", () => {
  // What a prepend does: rows arrive above the reader, so their anchor is
  // suddenly far down the viewport. One restore has to put it back wherever it
  // moved to, however far that is.
  const { node, state } = live({ anchor: 100 });
  const anchor = { messageId: "anchor", viewportOffset: 100 };

  state.rows.anchor += 1_275; // the growth the hold exists to absorb
  restoreVisibleMessageAnchor(node, anchor);

  assert.equal(state.rows.anchor, 100);
  assert.equal(state.scrollTop, 1_000 + 1_275);
});

test("a restore never scrolls past the end of the content", () => {
  const { node, state } = live({ anchor: 100 }, 19_000);
  node.scrollTop = 19_000;
  restoreVisibleMessageAnchor(node, { messageId: "anchor", viewportOffset: -50_000 });
  assert.equal(state.scrollTop, 19_400, "the clamp to the last scrollable pixel is gone");
});

const listSource = readFileSync(new URL("../../artifacts/kub/src/components/chat/MessageList.tsx", import.meta.url), "utf8");

// Run the real two layout callbacks: their ordering is the race, not the pure restore algorithm.
function layoutPasses(source = listSource) {
  const tree = ts.createSourceFile("MessageList.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useLayoutEffect") {
      const callback = node.arguments[0]?.getText(tree) ?? "";
      if (callback.includes("const prepended =")) callbacks.set("prepend", callback);
      if (callback.includes("const height = historyBandRef")) callbacks.set("band", callback);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(callbacks.size, 2);
  return (name: "prepend" | "band", environment: object) => vm.runInNewContext(`(${callbacks.get(name)})`, environment)();
}

function heldLayout(source = listSource) {
  const { node, state } = live({ anchor: 20 });
  const ref = <T,>(current: T) => ({ current });
  let releases = 0;
  const env = {
    containerRef: ref(node), preservingOlderScrollRef: ref(true), olderHoldActiveRef: ref(true),
    olderOwnedScrollTopRef: ref<number | null>(1000), olderScrollAnchorRef: ref<VisibleMessageAnchor | null>({ messageId: "anchor", viewportOffset: 20 }),
    olderObservedScrollTopRef: ref<number | null>(1000),
    olderStartMessageCountRef: ref(100), olderStartFirstMessageIdRef: ref("previous-first"),
    sortedMessages: Array.from({ length: 200 }, (_, i) => ({ id: `older-${i}` })),
    olderReleaseFrameRef: ref<number | null>(null), historyBandRef: ref({ getBoundingClientRect: () => ({ height: 0 }) }),
    historyBandHeightRef: ref(0), isAtBottomRef: ref(false), isInitialBottomLocked: () => false,
    adjustVisibleMessageAnchorForPendingScroll, matchesAnchoredScrollTop, restoreVisibleMessageAnchor, requestAnimationFrame: () => 1,
    releaseOlderScrollPreservation() {
      releases++;
      env.preservingOlderScrollRef.current = false;
      env.olderHoldActiveRef.current = false;
      env.olderOwnedScrollTopRef.current = null;
      env.olderObservedScrollTopRef.current = null;
      env.olderScrollAnchorRef.current = null;
    },
  };
  const pass = layoutPasses(source);
  return { node, state, env, pass: (name: "prepend" | "band") => pass(name, env), releases: () => releases };
}

function commitBeforeScroll(source = listSource) {
  const f = heldLayout(source);
  f.node.scrollTop -= 12; // Native scroll event/hold callback has not been delivered yet.
  assert.equal(matchesAnchoredScrollTop(f.node, 1000), false);
  f.pass("prepend");
  assert.equal(f.node.scrollTop, 988, "a message-list commit must not reclaim the reader's pending scroll");
  assert.equal(f.releases(), 1);
}

function bandBeforeScroll(source = listSource) {
  const f = heldLayout(source);
  f.env.historyBandHeightRef.current = 10;
  f.node.scrollTop -= 12;
  f.state.rows.anchor -= 10; // History status band leaves the flow.
  f.pass("band");
  f.pass("prepend");
  assert.equal(f.node.scrollTop, 978, "band compensation must keep both the reader's 12px and its own -10px");
  assert.equal(f.state.rows.anchor, 32);
  assert.equal(f.releases(), 1);
}

test("a commit before scroll delivery releases the hold instead of taking back reader momentum", () => commitBeforeScroll());
test("a band change before scroll delivery cannot erase reader ownership", () => bandBeforeScroll());

function firstCommitBeforeScroll(movement: number, bandChange = 0, source = listSource) {
  const f = heldLayout(source);
  f.env.olderHoldActiveRef.current = false;
  f.env.olderOwnedScrollTopRef.current = null;
  f.node.scrollTop = 120;
  f.state.rows.anchor = 20;
  f.env.olderObservedScrollTopRef.current = 120;
  f.node.scrollTop += movement; // In-flight native motion with no scroll callback yet.
  f.state.rows.anchor += 200;
  if (bandChange) {
    f.env.historyBandHeightRef.current = -bandChange;
    f.state.rows.anchor += bandChange;
    f.pass("band");
  }
  f.pass("prepend");
  assert.equal(f.node.scrollTop, 320 + movement + bandChange, "first restore must preserve pending reader movement and prepend growth");
  assert.equal(f.state.rows.anchor, 20 - movement);
  assert.equal(f.releases(), 0, "first restore must not be replaced with a dropped hold");
  const afterFirst = f.node.scrollTop;
  f.pass("prepend");
  assert.equal(f.node.scrollTop, afterFirst, "a later commit must retain the adjusted first anchor");
}

test("first prepend restores growth with no pending reader movement", () => firstCommitBeforeScroll(0));
test("first prepend commit before scroll delivery preserves pending movement in either direction", () => {
  firstCommitBeforeScroll(-12);
  firstCommitBeforeScroll(12);
});
test("first prepend carries pending movement through history-band compensation", () => firstCommitBeforeScroll(-12, -10));

test("pending-scroll adjustment accepts legal layout clamps without inventing reader motion", () => {
  const node = container([]);
  const anchor = { messageId: "anchor", viewportOffset: 20 };
  node.scrollTop = 1800;
  assert.equal(adjustVisibleMessageAnchorForPendingScroll(node, anchor, 2000), anchor);
  node.scrollTop = 0;
  assert.equal(adjustVisibleMessageAnchorForPendingScroll(node, anchor, -20), anchor);
});

test("owned layout growth and band changes still restore the actual anchor", () => {
  const f = heldLayout();
  f.state.rows.anchor += 24;
  f.pass("prepend");
  assert.equal(f.node.scrollTop, 1024);
  assert.equal(f.state.rows.anchor, 20);
  f.env.historyBandHeightRef.current = 10;
  f.state.rows.anchor -= 10;
  f.pass("band");
  f.pass("prepend");
  assert.equal(f.node.scrollTop, 1014);
  assert.equal(f.state.rows.anchor, 20);
  assert.equal(f.releases(), 0);
});

test("the first prepend and a legal layout clamp do not lose their restoration lane", () => {
  const first = heldLayout();
  first.env.olderHoldActiveRef.current = false;
  first.env.olderOwnedScrollTopRef.current = null;
  first.state.rows.anchor += 200;
  first.pass("prepend");
  assert.equal(first.node.scrollTop, 1200);
  assert.equal(first.state.rows.anchor, 20);
  assert.equal(first.releases(), 0);

  const clamped = heldLayout();
  clamped.node.scrollHeight = 1600;
  clamped.env.olderOwnedScrollTopRef.current = 1200;
  clamped.pass("prepend");
  assert.equal(clamped.node.scrollTop, 1000);
  assert.equal(clamped.releases(), 0);
});

test("a released hold remains inert on later list commits", () => {
  const f = heldLayout();
  f.env.releaseOlderScrollPreservation();
  f.node.scrollTop -= 12;
  f.pass("prepend");
  assert.equal(f.node.scrollTop, 988);
  assert.equal(f.releases(), 1);
});

function omitOnce(source: string, literal: string) {
  assert.equal(source.split(literal).length - 1, 1, "mutation must target exactly one production rule");
  return source.replace(literal, "");
}

test("literal omission of the first pending-scroll adjustment is rejected", () => {
  const adjustment = `!olderHoldActiveRef.current && olderObservedScrollTopRef.current !== null
      ? adjustVisibleMessageAnchorForPendingScroll(container, olderScrollAnchorRef.current, olderObservedScrollTopRef.current)
      : `;
  const mutant = omitOnce(listSource.replaceAll("\r\n", "\n"), adjustment);
  assert.throws(() => firstCommitBeforeScroll(-12, 0, mutant), { name: "AssertionError", message: /first restore must preserve/ });
});

test("literal omission of pending intent before band compensation is rejected", () => {
  const adjustment = "      olderScrollAnchorRef.current = adjustVisibleMessageAnchorForPendingScroll(el, olderScrollAnchorRef.current, olderObservedScrollTopRef.current);";
  const mutant = omitOnce(listSource, adjustment);
  assert.throws(() => firstCommitBeforeScroll(-12, -10, mutant), { name: "AssertionError", message: /first restore must preserve/ });
});

test("literal omission of retaining the adjusted first anchor is rejected", () => {
  const mutant = omitOnce(listSource, "    olderScrollAnchorRef.current = anchor;");
  assert.throws(() => firstCommitBeforeScroll(-12, 0, mutant), { name: "AssertionError", message: /a later commit must retain/ });
});

test("literal omission of the prepend layout ownership guard is rejected", () => {
  const guard = `    if (olderHoldActiveRef.current && olderOwnedScrollTopRef.current !== null && !matchesAnchoredScrollTop(container, olderOwnedScrollTopRef.current)) {
      releaseOlderScrollPreservation();
      return;
    }`;
  const mutant = omitOnce(listSource.replaceAll("\r\n", "\n"), guard);
  assert.throws(() => commitBeforeScroll(mutant), { name: "AssertionError", message: /a message-list commit must not reclaim/ });
});

test("literal omission of the band ownership guard is rejected", () => {
  const guard = `    if (olderHoldActiveRef.current && olderOwnedScrollTopRef.current !== null && !matchesAnchoredScrollTop(el, olderOwnedScrollTopRef.current)) {
      releaseOlderScrollPreservation();
    }`;
  const mutant = omitOnce(listSource.replaceAll("\r\n", "\n"), guard);
  assert.throws(() => bandBeforeScroll(mutant), { name: "AssertionError", message: /band compensation must keep/ });
});

const anchorSource = readFileSync(new URL("../../artifacts/kub/src/lib/messageScrollAnchor.ts", import.meta.url), "utf8");
function mutatedOwnership(before: string, after: string): typeof matchesAnchoredScrollTop {
  assert.equal(anchorSource.split(before).length - 1, 1);
  const exports = {} as { matchesAnchoredScrollTop: typeof matchesAnchoredScrollTop };
  const output = ts.transpileModule(anchorSource.replace(before, after), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(output, { exports });
  return exports.matchesAnchoredScrollTop;
}

test("literal removal of the ownership clamp is rejected by its positive control", () => {
  const matches = mutatedOwnership("Math.min(maximum, Math.max(0, ownedTop))", "ownedTop");
  const node = container([]);
  node.scrollTop = 1800;
  assert.throws(() => assert.equal(matches(node, 2000), true), { name: "AssertionError" });
});

test("literal widened ownership tolerance cannot admit a 12px reader movement", () => {
  const matches = mutatedOwnership("<= 1", "<= 24");
  const node = container([]);
  node.scrollTop = 108;
  assert.throws(() => assert.equal(matches(node, 120), false), { name: "AssertionError" });
});
