import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const componentFile = new URL("../../artifacts/kub/src/components/sidebar/SidebarHeader.tsx", import.meta.url);
const source = readFileSync(componentFile, "utf8");
const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const jsxRuntime = requireKub("react/jsx-runtime");
const SEARCH = "\u041f\u043e\u0438\u0441\u043a";
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
// Compare the actual component before/after this run; parent patches are valid
// new inputs. Untracked private e2e ownership guards do not belong in this unit.
const componentBefore = hash(componentFile);
assert.equal(createHash("sha256").update(source).digest("hex"), componentBefore,
  "compiled source and before-run component pin describe the same bytes");

const isWindowCall = (node, name) => ts.isCallExpression(node)
  && ts.isPropertyAccessExpression(node.expression)
  && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "window"
  && node.expression.name.text === name;
const isFrameRef = node => ts.isPropertyAccessExpression(node)
  && ts.isIdentifier(node.expression) && node.expression.text === "searchFocusFrameRef"
  && node.name.text === "current";
function frameIdentityPassValue(node) {
  if (!ts.isBinaryExpression(node)) return null;
  if (!(isFrameRef(node.left) && ts.isIdentifier(node.right))
    && !(isFrameRef(node.right) && ts.isIdentifier(node.left))) return null;
  if (node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) return false;
  if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) return true;
  return null;
}
let identityGuardSites = 0;
function countIdentityGuards(node, insideFrame = false) {
  const within = insideFrame || isWindowCall(node, "requestAnimationFrame");
  if (within && frameIdentityPassValue(node) !== null) identityGuardSites++;
  ts.forEachChild(node, child => countIdentityGuards(child, within));
}
countIdentityGuards(ts.createSourceFile("SidebarHeader.tsx", source, ts.ScriptTarget.ES2022,
  true, ts.ScriptKind.TSX));

function compile(mutation = null) {
  let changed = 0;
  const result = ts.transpileModule(source, {
    fileName: "SidebarHeader.tsx", reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX },
    transformers: mutation ? { before: [context => {
      let insideFrame = false;
      const visit = node => {
        if (isWindowCall(node, "requestAnimationFrame")) {
          if (mutation === "drop-focus") {
            changed++;
            return ts.factory.updateCallExpression(node, node.expression, node.typeArguments,
              [ts.factory.createArrowFunction(undefined, undefined, [], undefined,
                ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), ts.factory.createBlock([]))]);
          }
          const previous = insideFrame;
          insideFrame = true;
          const result = ts.visitEachChild(node, visit, context);
          insideFrame = previous;
          return result;
        }
        if (mutation === "cancellation" && isWindowCall(node, "cancelAnimationFrame")) {
          changed++;
          return ts.factory.createVoidZero();
        }
        if (mutation === "frame-identity" && insideFrame) {
          const passing = frameIdentityPassValue(node);
          if (passing !== null) {
            changed++;
            return passing ? ts.factory.createTrue() : ts.factory.createFalse();
          }
        }
        if (mutation === "current-open" && insideFrame && ts.isPropertyAccessExpression(node)
          && ts.isIdentifier(node.expression) && node.expression.text === "revealedSearchRef"
          && node.name.text === "current") {
          changed++;
          return ts.factory.createTrue();
        }
        return ts.visitEachChild(node, visit, context);
      };
      return tree => ts.visitNode(tree, visit);
    }] } : undefined,
  });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0,
    "actual full component must transpile before any lifecycle assertion");
  if (mutation) assert.equal(changed, mutation === "cancellation" ? 3 : 1,
    "calibration changes exact actual-source rule sites, not a mirror");
  return result.outputText;
}
const compiled = compile();

function walk(element, ancestors = [], output = []) {
  if (Array.isArray(element)) {
    for (const child of element) walk(child, ancestors, output);
  } else if (element && typeof element === "object" && element.props) {
    output.push({ element, ancestors });
    walk(element.props.children, [...ancestors, element], output);
  }
  return output;
}

// Reuse the repository's Node hook-lifecycle/VM pattern. The full component and
// JSX runtime are real; hook scheduling, host refs/focus, RAF and external UI/store
// ports are controlled. No browser CSS, keyboard, paint or lag proof is implied.
function fixture(code = compiled) {
  let mounted = true, dirty = true, cursor = 0, tree, serial = 0, activeElement = null;
  let location = "/", section = null;
  const slots = [], effects = new Map(), layoutEffects = new Map(), pending = [], pendingLayout = [];
  const frames = new Map(), cancelled = new Map(), listeners = new Map();
  const focused = [], focusChanges = [], focusOptions = [];
  const state = { searchQuery: "", currentUser: null, selectedChatId: null, mobileSection: "chats" };
  state.setSearchQuery = value => { state.searchQuery = value; dirty = true; };
  state.setMobileSection = value => { state.mobileSection = value; dirty = true; };
  const forbidden = () => { throw new Error("EXTERNAL_EFFECT_NOT_IN_SCOPE"); };
  state.setSelectedChatId = state.openSettings = forbidden;
  let props = { searchTucked: true,
    onUntuckSearch() { props = { ...props, searchTucked: false }; dirty = true; },
    onSearchFocusChange(value) { focusChanges.push(value); } };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const effectPort = (saved, queue) => (run, deps) => {
    const i = cursor++, previous = saved.get(i);
    if (!previous || !same(previous.deps, deps)) queue.push(() => {
      previous?.cleanup?.();
      saved.set(i, { deps: deps && [...deps], cleanup: run() });
    });
  };
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => {
        if (!mounted) return;
        const next = typeof value === "function" ? value(slots[i]) : value;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
      }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect: effectPort(effects, pending),
    useLayoutEffect: effectPort(layoutEffects, pendingLayout),
  };
  const window = {
    innerWidth: 390,
    requestAnimationFrame(callback) { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) {
      if (frames.has(id)) cancelled.set(id, frames.get(id));
      frames.delete(id);
    },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
  };
  const inputEntry = () => {
    const matches = walk(tree).filter(({ element }) => element.type === "input"
      && element.props["data-testid"] === "sidebar-search-input");
    assert.equal(matches.length, 1, "actual component must render exactly one search input");
    return matches[0];
  };
  const input = {
    isConnected: true, offsetParent: {},
    focus(options) {
      focused.push("search");
      focusOptions.push(options && { ...options });
      if (!input.isConnected) return;
      if (activeElement !== input) {
        activeElement = input;
        inputEntry().element.props.onFocus();
      }
    },
    blur() {
      if (activeElement === input) {
        activeElement = null;
        inputEntry().element.props.onBlur();
      }
    },
    select() {},
  };
  const noUi = () => null;
  const imports = {
    react: hooks, "react/jsx-runtime": jsxRuntime,
    wouter: { useLocation: () => [location, forbidden] },
    "@/store/app.store": { useAppStore: select => select(state) },
    "@/hooks/useUser": { useSignOut: () => forbidden },
    "@/hooks/useTheme": { useTheme: () => ({ resolvedTheme: "dark" }) },
    "@/hooks/useRole": { useIsManagerOrAdmin: () => false },
    "@/hooks/useTaskAccess": { useTaskAccessGate: () => ({ canAccessTasks: false }) },
    "@/hooks/useHint": { useHint: () => ({ visible: false, dismiss: forbidden }) },
    "@/lib/shellSection": { shellSection: () => section },
    "@/hooks/use-mobile": { useIsMobile: () => true },
    "@/components/ui/ChatAvatar": { UserAvatar: noUi },
    "@/components/kub": { KubBrandLogo: noUi, KubHint: noUi, KubIcon: noUi, KubTooltip: noUi },
    "./NewGroupModal": { NewGroupModal: noUi },
    "./NotificationBell": { NotificationBell: noUi },
    "./ConnectionStatus": { ConnectionStatus: noUi },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/appDialogs": { requestAppConfirm: forbidden },
    "@/lib/signOutConfirm": { signOutConfirm: forbidden },
    "@/lib/savedMessages": { openSavedMessagesChat: forbidden },
    "@/lib/supportWindowEvents": { openSupportWindow: forbidden },
    "@/lib/sidebarSearchFocus": { SIDEBAR_SEARCH_FOCUS_EVENT: "fixture-sidebar-search-focus" },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, window,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `unexpected actual component dependency: ${name}`);
      return imports[name];
    } }, { filename: componentFile.pathname });
  const Component = module.exports.SidebarHeader;
  assert.equal(typeof Component, "function");
  function flush(passive = true) {
    for (let count = 0; mounted && dirty; count++) {
      assert.ok(count < 20, "finite component state/effect settlement");
      dirty = false; cursor = 0;
      tree = Component(props);
      inputEntry().element.props.ref.current = input;
      // Layout effects are committed before RAF even while passive effects wait.
      for (const run of pendingLayout.splice(0)) run();
      if (passive) for (const run of pending.splice(0)) run();
    }
  }
  function open(requests = 1, commit = true) {
    const buttons = walk(tree).filter(({ element }) => element.type === "button"
      && element.props["aria-label"] === SEARCH);
    assert.equal(buttons.length, 1, "invoke the actual tucked-search button");
    for (let i = 0; i < requests; i++) buttons[0].element.props.onClick();
    if (commit) flush();
  }
  function frame(passive = true) {
    for (const [id, callback] of [...frames]) if (frames.delete(id)) callback(16);
    flush(passive);
  }
  function unmount() {
    if (!mounted) return;
    // Host refs detach; layout cleanup precedes passive cleanup on unmount.
    inputEntry().element.props.ref.current = null;
    input.isConnected = false; activeElement = null; mounted = false;
    for (const effect of layoutEffects.values()) effect.cleanup?.();
    for (const effect of effects.values()) effect.cleanup?.();
  }
  function view() {
    const wrapper = inputEntry().ancestors.find(element => typeof element.props.className === "string"
      && element.props.className.includes("basis-full"));
    assert.ok(wrapper, "inspect the actual returned search wrapper");
    return { tucked: wrapper.props.className.split(" ").includes("max-h-0"),
      focused: activeElement === input, focusCalls: focused.length,
      focusChanges: [...focusChanges], focusOptions: [...focusOptions],
      query: inputEntry().element.props.value, pendingFrames: frames.size };
  }
  flush();
  return { open, frame, unmount, view,
    retuck(passive = true) { props = { ...props, searchTucked: true }; dirty = true; flush(passive); },
    hideList(kind) {
      if (kind === "chat") state.selectedChatId = "11111111-1111-4111-8111-000000000093";
      else if (kind === "section") { location = "/bots"; section = "bots"; }
      else assert.fail("unknown controlled navigation port");
      input.offsetParent = null;
      dirty = true; flush(false);
    },
    host(patch) { Object.assign(input, patch); },
    deliverCancelled() {
      assert.equal(cancelled.size, 1, "one cancelled callback is available for adversarial delivery");
      const callback = cancelled.values().next().value;
      cancelled.clear(); callback(16); flush(false);
    },
    type(value) { inputEntry().element.props.onChange({ target: { value } }); flush(); },
    escape() {
      assert.equal(activeElement, input, "Escape control starts on the focused real input ref");
      let prevented = 0;
      inputEntry().element.props.onKeyDown({ key: "Escape", currentTarget: input,
        preventDefault() { prevented++; } });
      flush(); return prevented;
    },
    pendingFrames: () => frames.size,
    listeners: () => [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0),
    focusCalls: () => focused.length,
  };
}

function normalOpening(f) {
  assert.equal(f.view().tucked, true);
  f.open();
  assert.equal(f.view().tucked, false, "actual onUntuckSearch expands the committed component");
  assert.equal(f.view().focusCalls, 0, "focus is genuinely held until RAF");
  assert.equal(f.pendingFrames(), 1, "actual handler queued one frame");
  f.frame();
  assert.equal(f.view().focusCalls, 1, "OPENING_FOCUSES_INPUT");
  assert.equal(f.view().focused, true);
  assert.deepEqual(f.view().focusOptions, [{ preventScroll: true }]);
  assert.deepEqual(f.view().focusChanges, [true], "actual onFocus notifies the parent");
}

function closedCommitCancels(f) {
  f.open();
  f.retuck(false);
  assert.equal(f.view().tucked, true, "search really committed closed before passive effects or RAF");
  assert.equal(f.view().focusCalls, 0);
  assert.equal(f.pendingFrames(), 0, "CLOSED_COMMIT_CANCELS_QUEUED_FRAME");
  f.frame(false);
  const observed = f.view();
  assert.equal(observed.focusCalls, 0,
    `CLOSED_SEARCH_MUST_NOT_REFOCUS: tucked=${observed.tucked}; focused=${observed.focused}; parentFocus=${observed.focusChanges.join(",")}`);
  assert.equal(observed.tucked, true, "closed search stays closed after the old frame");
  assert.deepEqual(observed.focusChanges, []);
}

function staleDeliveredAfterCancel(f) {
  f.open();
  f.retuck(false);
  assert.equal(f.pendingFrames(), 0, "adversarial delivery starts after actual cancellation");
  assert.equal(f.view().tucked, true);
  // A clipped, connected input may still be focusable. Exercise the complete
  // stale-delivery defense here; current-open independence is tested separately.
  f.deliverCancelled();
  assert.equal(f.view().focusCalls, 0, "DELIVERED_CANCELLED_FRAME_MUST_NOT_REFOCUS");
  assert.equal(f.view().tucked, true);
  assert.deepEqual(f.view().focusChanges, []);
}

function uncommittedOpeningCannotFocus(f) {
  f.open(1, false);
  assert.equal(f.view().tucked, true, "the requested opening has not committed yet");
  assert.equal(f.pendingFrames(), 1, "this callback still owns the live handle");
  f.frame(false);
  assert.equal(f.view().focusCalls, 0, "UNCOMMITTED_OPEN_FRAME_MUST_NOT_FOCUS");
  assert.equal(f.view().tucked, false, "the opening commits only after frame delivery");
  assert.deepEqual(f.view().focusChanges, []);
}

function queueSuccessorB(f) {
  f.open();
  assert.equal(f.pendingFrames(), 1, "A was queued by the actual handler");
  f.retuck(false);
  assert.equal(f.pendingFrames(), 0, "A was retired at the closed commit");
  f.open();
  assert.equal(f.view().tucked, false, "B's requested opening is committed");
  assert.equal(f.view().focusCalls, 0, "B has not been delivered");
  assert.equal(f.pendingFrames(), 1, "B is the only pending callback");
}

function retiredACannotFocusB(f) {
  queueSuccessorB(f);
  f.deliverCancelled();
  assert.equal(f.view().focusCalls, 0, "RETIRED_A_MUST_NOT_FOCUS_NEW_OPENING_B");
  assert.deepEqual(f.view().focusChanges, []);
  assert.equal(f.pendingFrames(), 1, "B_REMAINS_PENDING_AFTER_RETIRED_A_DELIVERY");
  f.frame();
  assert.equal(f.view().focusCalls, 1, "NORMAL_B_FRAME_FOCUSES_ONCE_AFTER_STALE_A");
  assert.equal(f.view().focused, true);
  assert.deepEqual(f.view().focusOptions, [{ preventScroll: true }]);
  assert.deepEqual(f.view().focusChanges, [true]);
}

function retiredACannotConsumeB(f) {
  queueSuccessorB(f);
  f.deliverCancelled();
  assert.equal(f.pendingFrames(), 1, "B_REMAINS_PENDING_AFTER_RETIRED_A_DELIVERY");
  // Navigation must cancel B even if an early stale focus already happened;
  // unlike tuck, hidden-list authority does not depend on isSearchFocused.
  f.hideList("chat");
  assert.equal(f.pendingFrames(), 0, "RETIRED_A_MUST_NOT_CLEAR_B_CANCELLATION_HANDLE");
  f.frame(false);
  assert.equal(f.view().focusCalls, 0);
}

test("normal opening: actual SidebarHeader focuses once after its held RAF", () => {
  const f = fixture();
  try { normalOpening(f); } finally { f.unmount(); }
});

test("calibration: dropping the actual RAF callback fails the normal-opening oracle", () => {
  const f = fixture(compile("drop-focus"));
  try {
    assert.throws(() => normalOpening(f), error => error.code === "ERR_ASSERTION"
      && error.message.includes("OPENING_FOCUSES_INPUT"));
  } finally { f.unmount(); }
});

test("regression: queued search focus must not reopen a re-tucked search row", () => {
  const f = fixture();
  try { closedCommitCancels(f); } finally { f.unmount(); }
});

test("adversarial delivery: cancelled callback cannot focus a committed-closed connected input", () => {
  const f = fixture();
  try { staleDeliveredAfterCancel(f); } finally { f.unmount(); }
});

test("current-open control: a live frame cannot focus before its opening commits", () => {
  const f = fixture();
  try { uncommittedOpeningCannotFocus(f); } finally { f.unmount(); }
});

test("regression: retired A cannot focus the newer committed opening B early", () => {
  const f = fixture();
  try { retiredACannotFocusB(f); } finally { f.unmount(); }
});

test("regression: retired A must preserve B's cancellable handle", () => {
  const f = fixture();
  try { retiredACannotConsumeB(f); } finally { f.unmount(); }
});

test("successor control: normal B delivery after retiring A focuses exactly once", () => {
  const f = fixture();
  try {
    queueSuccessorB(f);
    f.frame();
    assert.equal(f.view().focusCalls, 1, "NORMAL_B_FRAME_FOCUSES_ONCE");
    assert.equal(f.view().focused, true);
    assert.equal(f.pendingFrames(), 0);
    assert.deepEqual(f.view().focusOptions, [{ preventScroll: true }]);
    assert.deepEqual(f.view().focusChanges, [true]);
  } finally { f.unmount(); }
});

// Do not invent a guard in the pre-fix component to manufacture a mutation kill.
// This calibration becomes executable once the coordinator adds the real guard.
test("calibration: actual-source frame-identity omission fails both successor oracles", {
  skip: identityGuardSites === 0 ? "actual component has no exact-handle identity guard yet" : false,
}, () => {
  const code = compile("frame-identity");
  for (const [run, oracle] of [
    [retiredACannotFocusB, "RETIRED_A_MUST_NOT_FOCUS_NEW_OPENING_B"],
    [retiredACannotConsumeB, "RETIRED_A_MUST_NOT_CLEAR_B_CANCELLATION_HANDLE"],
  ]) {
    const healthy = fixture();
    try { run(healthy); } finally { healthy.unmount(); }
    const mutant = fixture(code);
    try {
      assert.throws(() => run(mutant), error => error.code === "ERR_ASSERTION"
        && error.message.includes(oracle));
    } finally { mutant.unmount(); }
  }
});

for (const [mutation, oracle, run] of [
  ["cancellation", "CLOSED_COMMIT_CANCELS_QUEUED_FRAME", closedCommitCancels],
  ["current-open", "UNCOMMITTED_OPEN_FRAME_MUST_NOT_FOCUS", uncommittedOpeningCannotFocus],
]) {
  test(`calibration: actual-source ${mutation} omission fails its independent oracle`, () => {
    const healthy = fixture();
    try { run(healthy); } finally { healthy.unmount(); }
    const mutant = fixture(compile(mutation));
    try {
      assert.throws(() => run(mutant), error => error.code === "ERR_ASSERTION"
        && error.message.includes(oracle));
    } finally { mutant.unmount(); }
  });
}

for (const navigation of ["chat", "section"]) {
  test(`hidden navigation: ${navigation} cancels search focus before passive effects`, () => {
    const f = fixture();
    try {
      f.open();
      f.hideList(navigation);
      assert.equal(f.pendingFrames(), 0, "hidden mobile list cancels the queued frame at commit");
      f.deliverCancelled();
      assert.equal(f.view().focusCalls, 0, "hidden navigation refuses even a delivered cancelled frame");
      assert.deepEqual(f.view().focusChanges, []);
    } finally { f.unmount(); }
  });
}

for (const [name, patch] of [
  ["disconnected", { isConnected: false }],
  ["not laid out", { offsetParent: null }],
]) {
  test(`host guard: an open but ${name} input must not receive queued focus`, () => {
    const f = fixture();
    try {
      f.open();
      f.host(patch);
      f.frame();
      assert.equal(f.view().focusCalls, 0);
      assert.deepEqual(f.view().focusChanges, []);
    } finally { f.unmount(); }
  });
}

test("duplicate opening requests retain only one queued focus", () => {
  const f = fixture();
  try {
    f.open(2);
    assert.equal(f.pendingFrames(), 1, "a duplicate request cancels the previous handle");
    f.frame();
    assert.equal(f.view().focusCalls, 1);
    assert.deepEqual(f.view().focusOptions, [{ preventScroll: true }]);
    assert.deepEqual(f.view().focusChanges, [true]);
  } finally { f.unmount(); }
});

test("query and Escape preserve focused search before an empty Escape re-tucks it", () => {
  const f = fixture();
  try {
    normalOpening(f);
    f.type("Fictional query");
    f.retuck();
    assert.equal(f.view().query, "Fictional query", "parent re-tuck must not clear a query");
    assert.equal(f.view().tucked, false);
    assert.equal(f.view().focused, true);
    assert.equal(f.escape(), 1, "query Escape is prevented while it clears the query");
    assert.equal(f.view().query, "");
    assert.equal(f.view().focused, true);
    assert.equal(f.view().tucked, false);
    assert.deepEqual(f.view().focusChanges, [true]);
    assert.equal(f.escape(), 0, "empty Escape retains its existing blur behavior");
    assert.equal(f.view().focused, false);
    assert.equal(f.view().tucked, true);
    assert.deepEqual(f.view().focusChanges, [true, false]);
    assert.equal(f.view().focusCalls, 1);
    assert.equal(f.pendingFrames(), 0);
  } finally { f.unmount(); }
});

test("unmount control: detached real input ref prevents queued focus and successor interference", () => {
  const old = fixture();
  old.open();
  assert.equal(old.pendingFrames(), 1);
  old.unmount();
  assert.equal(old.pendingFrames(), 0, "unmount layout cleanup cancels the pending handle");
  assert.equal(old.listeners(), 0, "actual component effect cleanup removes its listeners");
  const next = fixture();
  try {
    old.frame();
    old.deliverCancelled();
    assert.equal(old.focusCalls(), 0, "null detached ref already makes the old RAF harmless to focus");
    assert.equal(next.view().tucked, true);
    assert.equal(next.focusCalls(), 0);
    assert.equal(old.pendingFrames(), 0);
  } finally { next.unmount(); }
});

test.after(() => {
  assert.equal(hash(componentFile), componentBefore,
    "current parent-patched component remains unchanged during the focused run");
});
