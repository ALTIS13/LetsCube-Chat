import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as mentions from "../../artifacts/kub/src/lib/memberMentions.ts";
import { createComposerSendScope } from "../../artifacts/kub/src/lib/composerSendScope.ts";

const { createStore } = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url))("zustand/vanilla");

const OWNER = "11111111-1111-4111-8111-000000000001";
const OTHER = "11111111-1111-4111-8111-000000000002";
const CHAT = "22222222-2222-4222-8222-000000000001";
const REV = "33333333-3333-4333-8333-000000000001";
const composer = "components/chat/MessageInput.tsx";
const caption = "components/chat/attach/AttachSendBar.tsx";
const hook = "hooks/useMemberMentions.ts";
type Mutation = { file: string; from: string; to: string };

function source(relative: string, mutation?: Mutation) {
  const url = new URL(`../../artifacts/kub/src/${relative}`, import.meta.url);
  let text = readFileSync(url, "utf8");
  if (mutation?.file === relative) {
    assert.equal(text.split(mutation.from).length - 1, 1, `unique mutation anchor: ${relative}`);
    text = text.replace(mutation.from, mutation.to);
  }
  return { text, filename: fileURLToPath(url) };
}

function evaluate(expression: string, environment: Record<string, any>, filename: string) {
  const compiled = ts.transpileModule(`(function(${Object.keys(environment).join(",")}){return (${expression});})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return runInThisContext(compiled, { filename })(...Object.values(environment));
}

// Execute the actual callbacks and textarea bindings, not copies of their rules.
function callback(relative: string, name: string, environment: Record<string, any>, mutation?: Mutation) {
  const loaded = source(relative, mutation);
  const tree = ts.createSourceFile(relative, loaded.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(expression, `callback exists: ${name}`);
  return evaluate(expression.getText(tree), environment, loaded.filename);
}

function editSessionSubscription(environment: Record<string, any>, mutation?: Mutation) {
  const loaded = source(composer, mutation);
  const tree = ts.createSourceFile(composer, loaded.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useLayoutEffect"
      && node.arguments[0]?.getText(tree).includes("useAppStore.subscribe")
      && node.arguments[0]?.getText(tree).includes("editSessionRef")) expression = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(tree);
  // The pre-fix component has no subscription; its held ACK must still reach
  // the behavioral assertion rather than failing on a missing test dependency.
  return expression ? evaluate(expression.getText(tree), environment, loaded.filename)() : undefined;
}

function fieldHandler(relative: string, name: string, environment: Record<string, any>) {
  const loaded = source(relative);
  const tree = ts.createSourceFile(relative, loaded.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "textarea") {
      const attr = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(tree) === name);
      if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer)) expression = attr.initializer.expression;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(expression, `textarea handler exists: ${name}`);
  return evaluate(expression.getText(tree), environment, loaded.filename);
}

function snapshot(): mentions.MentionText {
  return { content: "@Ada and @Bob", mentionEntities: { version: 1, revision: REV, items: [
    { kind: "user", user_id: OTHER, offset: 0, length: 4, label: "@Ada" },
    { kind: "user", user_id: OWNER, offset: 9, length: 4, label: "@Bob" },
  ] } };
}

class Field extends EventTarget {
  value = "";
  selectionStart = 0;
  selectionEnd = 0;
  disabled = false;
  readOnly = false;
  focuses = 0;
  focus() { this.focuses += 1; }
  setSelectionRange(start: number, end: number) {
    this.selectionStart = Math.min(start, this.value.length);
    this.selectionEnd = Math.min(end, this.value.length);
  }
}

function inputEvent(type: string, extra: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(event, { inputType: "insertText", data: "A", isComposing: false, ...extra });
  return event;
}

function pickerHarness(initial = snapshot(), mutation?: Mutation) {
  const field = new Field();
  const ref = { current: field };
  const state: any = { currentUser: { id: OWNER }, chats: [{ id: CHAT, members: [
    { user_id: OWNER, profile: { full_name: "Owner" } },
    { user_id: OTHER, profile: { full_name: "Ada" } },
  ], bots: [] }] };
  let current = initial;
  let topic: string | null = null;
  let cursor = 0;
  let dirty = false;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const frames: (() => void)[] = [];
  const setSnapshot = (value: mentions.MentionText) => { current = value; dirty = true; };
  const react = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: any) => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(value: any) { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo(run: () => unknown) { return run(); },
    useCallback(run: unknown) { return run; },
    useId() { return "mention-list"; },
    useEffect(run: () => (() => void) | void, deps: any[]) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      slots[index] = { deps, cleanup: undefined };
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = run(); });
    },
  };
  const useAppStore = Object.assign((select: (value: any) => any) => select(state), { getState: () => state });
  const loaded = source(hook, mutation);
  const compiled = ts.transpileModule(loaded.text, {
    fileName: loaded.filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} as any };
  const require = (name: string) => {
    if (name === "react") return react;
    if (name === "@/store/app.store") return { useAppStore };
    if (name === "@/lib/composerEnter") return { enterSendsHere: () => true };
    if (name === "@/lib/memberMentions") return mentions;
    throw Error(`Unexpected hook dependency: ${name}`);
  };
  runInThisContext(`(function(require,module,exports,requestAnimationFrame){${compiled}\n})`, { filename: loaded.filename })(
    require, module, module.exports, (run: () => void) => { frames.push(run); return frames.length; },
  );
  let picker: any;
  function render() {
    for (let count = 0; count < 10; count += 1) {
      dirty = false;
      cursor = 0;
      field.value = current.content;
      picker = module.exports.useMemberMentionPicker(CHAT, topic, current, setSnapshot, ref);
      for (const effect of effects.splice(0)) effect();
      if (!dirty) return picker;
    }
    throw Error("Hook did not settle");
  }
  render();
  return { field, state, ref, setSnapshot, render, get picker() { return picker; }, get snapshot() { return current; },
    changeTopic(value: string) { topic = value; render(); },
    runFrames() { for (const run of frames.splice(0)) run(); render(); },
    onChange(surface: string, value: string) {
      const rebase = () => setSnapshot(mentions.rebaseMentionText(current, value));
      const environment = surface === composer ? { mentionPicker: picker, setText: rebase }
        : { picker, onCaptionChange: rebase };
      fieldHandler(surface, "onChange", environment)({ target: field, currentTarget: field });
      render();
    },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function assertKeyboardReplacement(surface: string, mutation?: Mutation) {
  const h = pickerHarness(snapshot(), mutation);
  try {
    h.field.setSelectionRange(0, 4);
    h.field.dispatchEvent(inputEvent("beforeinput", { data: "@Ada" }));
    // The browser emits input even when its value tracker sees identical text.
    h.field.setSelectionRange(4, 4);
    h.field.dispatchEvent(inputEvent("input", { data: "@Ada" }));
    h.onChange(surface, "@Ada and @Bob");
    assert.equal(h.snapshot.content, "@Ada and @Bob");
    assert.deepEqual(h.snapshot.mentionEntities.items, [
      { kind: "user", user_id: OWNER, offset: 9, length: 4, label: "@Bob" },
    ]);
    assert.notEqual(h.snapshot.mentionEntities.revision, "33333333-3333-4333-8333-000000000001");
    assert.match(h.snapshot.mentionEntities.revision!, /^[0-9a-f-]{36}$/i);
  } finally { h.dispose(); }
}

for (const surface of [composer, caption]) test(`${surface}: identical keyboard overtype drops only the intersected UUID`, () => {
  assertKeyboardReplacement(surface);
});

test("native replacement uses the pre-input selection and actual resulting text", () => {
  const h = pickerHarness();
  try {
    h.field.setSelectionRange(1, 2);
    h.field.dispatchEvent(inputEvent("beforeinput", { data: "Ada" }));
    h.field.value = "@Adada and @Bob";
    h.field.setSelectionRange(4, 4);
    h.field.dispatchEvent(inputEvent("input", { data: "Ada" }));
    h.onChange(composer, "@Adada and @Bob");
    assert.equal(h.snapshot.content, "@Adada and @Bob");
    assert.deepEqual(h.snapshot.mentionEntities.items.map((item) => [item.label, item.offset]), [["@Bob", 11]]);
  } finally { h.dispose(); }
});

function assertInputGate(gate: string, mutation?: Mutation) {
  const h = pickerHarness(snapshot(), mutation);
  try {
    h.field.setSelectionRange(1, 2);
    if (gate === "collapsed") h.field.setSelectionRange(1, 1);
    if (gate === "readonly") h.field.readOnly = true;
    const before = inputEvent("beforeinput", gate === "composing" ? { isComposing: true }
      : gate === "compositionType" ? { inputType: "insertCompositionText" }
        : gate === "pasteType" ? { inputType: "insertFromPaste" } : {});
    if (gate === "prevented") before.preventDefault();
    h.field.dispatchEvent(before);
    if (gate === "cancelled") before.preventDefault();
    if (gate === "account") h.state.currentUser = { id: OTHER };
    if (gate === "topic") h.changeTopic("topic-other");
    h.field.dispatchEvent(inputEvent("input", gate === "changedInputType" ? { inputType: "insertFromPaste" } : {}));
    assert.equal(h.snapshot.mentionEntities.items.length, 2);
    assert.equal(h.snapshot.mentionEntities.revision, "33333333-3333-4333-8333-000000000001");
  } finally { h.dispose(); }
}

for (const gate of ["composing", "compositionType", "pasteType", "changedInputType", "prevented", "cancelled", "collapsed", "readonly", "account", "topic"])
  test(`native replacement does not attribute ${gate} input`, () => assertInputGate(gate));

test("composition state also excludes plain insertText while the IME is open", () => {
  const h = pickerHarness();
  try {
    h.picker.onCompositionStart(); h.render();
    h.field.setSelectionRange(1, 2);
    h.field.dispatchEvent(inputEvent("beforeinput")); h.field.dispatchEvent(inputEvent("input"));
    assert.equal(h.snapshot.mentionEntities.items.length, 2);
    h.picker.onCompositionEnd(); h.render();
    h.field.setSelectionRange(1, 2);
    h.field.dispatchEvent(inputEvent("beforeinput")); h.field.dispatchEvent(inputEvent("input"));
    assert.equal(h.snapshot.mentionEntities.items.length, 1);
  } finally { h.dispose(); }
});

test("identical plain paste still retires UUID and the composer still stages file-only paste", () => {
  const h = pickerHarness();
  try {
    h.field.setSelectionRange(0, 4);
    const event: any = { currentTarget: h.field, defaultPrevented: false,
      clipboardData: { types: ["text/plain"], getData: () => "@Ada", items: [] },
      preventDefault() { this.defaultPrevented = true; } };
    h.picker.onPaste(event); h.render();
    h.field.dispatchEvent(inputEvent("beforeinput", { inputType: "insertFromPaste" }));
    h.field.dispatchEvent(inputEvent("input", { inputType: "insertFromPaste" }));
    h.onChange(composer, "@Ada and @Bob");
    assert.equal(h.snapshot.mentionEntities.items.length, 1);
    let files: File[] = [];
    const file = new File(["synthetic"], "clipboard.png", { type: "image/png" });
    event.clipboardData = { types: ["Files"], getData: () => "", items: [{ kind: "file", getAsFile: () => file }] };
    callback(composer, "handlePaste", { mentionPicker: h.picker, onStageFiles: (value: File[]) => { files = value; },
      isEditing: false, normalizeClipboardFile: (value: File) => value, setShowAttach: () => {} })(event);
    assert.equal(files.length, 1);
    assert.equal(files[0].name, "clipboard.png");
    assert.equal(event.defaultPrevented, true);
  } finally { h.dispose(); }
});

function assertCaptionEscape(mutation?: Mutation) {
  const h = pickerHarness(mentions.createMentionText("@Ad"), mutation);
  try {
    h.field.setSelectionRange(3, 3); h.picker.observeSelection(); h.render();
    assert.equal(h.picker.open, true);
    let closed = 0;
    const handler = () => callback(caption, "handleCaptionKeyDown", { picker: h.picker, enterSendsHere: () => true,
      busy: false, onSend: () => assert.fail("Escape must not send") });
    const outer = callback("components/chat/attach/AttachSheet.tsx", "handleKeyDown", {
      menuOpen: false, setMenuOpen: () => {}, requestClose: () => { closed += 1; },
    });
    const event: any = { key: "Escape", nativeEvent: { isComposing: false, keyCode: 27 }, stopped: false,
      preventDefault() {}, stopPropagation() { this.stopped = true; } };
    handler()(event);
    if (!event.stopped) outer(event);
    h.render();
    assert.equal(closed, 0, "the caption's first Escape must not cancel file selection");
    assert.equal(h.picker.open, false);
    event.stopped = false;
    handler()(event);
    if (!event.stopped) outer(event);
    assert.equal(closed, 1, "a subsequent Escape may close the sheet");
  } finally { h.dispose(); }
}

test("caption picker consumes its first Escape before the sheet sees it", () => assertCaptionEscape());

async function assertEditCompletion(outcome: { ok: boolean; error: string | null },
  next: "B" | "cancel" | "A" | "reopen" | "externalReopen" | "stale" | "unrelated", mutation?: Mutation) {
  let resolve!: (value: typeof outcome) => void;
  const answer = new Promise<typeof outcome>((done) => { resolve = done; });
  const editingMessage = { id: "message-A", chat_id: CHAT };
  const store = createStore(() => ({ editingMessage: editingMessage as typeof editingMessage | null }));
  const editSessionRef = { current: 0 };
  const unsubscribe = editSessionSubscription({ useAppStore: store, editSessionRef }, mutation);
  const preEdit = mentions.createMentionText("original draft");
  let shown = snapshot();
  let error: string | null = null;
  const scope = createComposerSendScope(CHAT); scope.activate(CHAT);
  const env = { composerSendScope: scope, textareaRef: { current: { value: shown.content, focus() {} } },
    text: shown.content, snapshot: shown, trimMentionText: mentions.trimMentionText, rebaseMentionText: mentions.rebaseMentionText,
    createMentionText: mentions.createMentionText, hasAttachments: false, hasForwardDraft: false,
    isEditing: true, editingMessage, onEdit: async (id: string, content: string, entities: mentions.MessageMentionsV1) => {
      assert.equal(id, "message-A"); assert.equal(content, "@Ada and @Bob"); assert.equal(entities.revision, REV); return answer;
    }, setEditError: (value: string | null) => { error = value; },
    setEditingMessage: (value: typeof editingMessage | null) => { store.setState({ editingMessage: value }); },
    setSnapshot: (value: mentions.MentionText) => { shown = value; }, preEditTextRef: { current: preEdit },
    setShowEmoji: () => {}, useAppStore: store, editSessionRef,
  };
  if (next === "stale") {
    store.setState({ editingMessage: { id: "message-B", chat_id: CHAT } });
    shown = mentions.createMentionText("B unsaved @raw");
  }
  const running = callback(composer, "handleSend", env, mutation)();
  if (next === "reopen" || next === "externalReopen") {
    if (next === "reopen") callback(composer, "exitEditMode", env, mutation)();
    else store.setState({ editingMessage: null });
    // Reuse the identical row object, with no intervening React render. Only
    // an edit-session boundary can distinguish this from the submitted edit.
    store.setState({ editingMessage });
    shown = mentions.rebaseMentionText(snapshot(), "reopened @Ada and @Bob");
  } else if (next === "unrelated") {
    store.setState({ incidentalReadResult: 1 });
  } else if (next !== "A" && next !== "stale") {
    store.setState({ editingMessage: next === "B" ? { id: "message-B", chat_id: CHAT } : null });
    shown = mentions.createMentionText(next === "B" ? "B unsaved @raw" : "cancelled draft");
  }
  const protectedSnapshot = shown;
  resolve(outcome);
  try {
    await running;
    if (next === "A" || next === "unrelated") {
      assert.equal(store.getState().editingMessage, null);
      assert.equal(shown.content, "original draft");
    } else if (next === "reopen" || next === "externalReopen") {
      assert.equal(store.getState().editingMessage?.id, "message-A", "a same-ID reopened edit is a different session");
      assert.equal(shown, protectedSnapshot, "the reopened session must retain its unsaved text and UUID snapshot");
      assert.deepEqual(shown.mentionEntities.items.map((item) => [item.label, item.offset]), [["@Ada", 9], ["@Bob", 18]]);
      assert.equal(error, null);
    } else {
      assert.equal(store.getState().editingMessage?.id ?? null, next === "B" || next === "stale" ? "message-B" : null);
      assert.equal(shown.content, next === "B" || next === "stale" ? "B unsaved @raw" : "cancelled draft");
      assert.equal(error, null);
    }
  } finally { unsubscribe?.(); }
}

test("late edit A success cannot close edit B or replace its unsaved text", async () => {
  await assertEditCompletion({ ok: true, error: null }, "B");
});
test("late edit A refusal cannot install an error in edit B", async () => {
  await assertEditCompletion({ ok: false, error: "synthetic refusal" }, "B");
});
test("late edit A success cannot restore a cancelled edit's old draft", async () => {
  await assertEditCompletion({ ok: true, error: null }, "cancel");
});
test("the current edit ACK still restores the pre-edit draft", async () => {
  await assertEditCompletion({ ok: true, error: null }, "A");
});

test("held edit ACK cannot close the same message after actual cancel and reopen", async () => {
  await assertEditCompletion({ ok: true, error: null }, "reopen");
});
test("held edit refusal cannot mark a reopened same-ID edit as failed", async () => {
  await assertEditCompletion({ ok: false, error: "old session refusal" }, "reopen");
});
test("batched external cancel and same-object reopen invalidate the held edit session", async () => {
  await assertEditCompletion({ ok: true, error: null }, "externalReopen");
});
test("a stale submit callback cannot close a different currently edited row", async () => {
  await assertEditCompletion({ ok: true, error: null }, "stale");
});
test("an unrelated store update does not invalidate the current edit ACK", async () => {
  await assertEditCompletion({ ok: true, error: null }, "unrelated");
});

async function assertOverlappingSaves(mutation?: Mutation) {
  const editingMessage = { id: "message-A", chat_id: CHAT };
  const store = createStore(() => ({ editingMessage: editingMessage as typeof editingMessage | null }));
  const editSessionRef = { current: 0 };
  const unsubscribe = editSessionSubscription({ useAppStore: store, editSessionRef }, mutation);
  const scope = createComposerSendScope(CHAT); scope.activate(CHAT);
  let shown = snapshot();
  let error: string | null = null;
  let acknowledge!: (value: { ok: boolean; error: string | null }) => void;
  let acknowledgeSuccessor!: (value: { ok: boolean; error: string | null }) => void;
  const first = new Promise<{ ok: boolean; error: string | null }>((resolve) => { acknowledge = resolve; });
  const second = new Promise<{ ok: boolean; error: string | null }>((resolve) => { acknowledgeSuccessor = resolve; });
  const nextAnswers = [first, second];
  const submitted: { id: string; content: string; entities: mentions.MessageMentionsV1 }[] = [];
  const env = { composerSendScope: scope, textareaRef: { current: { value: shown.content, focus() {} } },
    text: shown.content, snapshot: shown, trimMentionText: mentions.trimMentionText, rebaseMentionText: mentions.rebaseMentionText,
    createMentionText: mentions.createMentionText, hasAttachments: false, hasForwardDraft: false, isEditing: true, editingMessage,
    onEdit: (id: string, content: string, entities: mentions.MessageMentionsV1) => {
      submitted.push({ id, content, entities }); return nextAnswers.shift();
    }, setEditError: (value: string | null) => { error = value; },
    setEditingMessage: (value: typeof editingMessage | null) => store.setState({ editingMessage: value }),
    setSnapshot: (value: mentions.MentionText) => { shown = value; },
    preEditTextRef: { current: mentions.createMentionText("original draft") }, setShowEmoji: () => {}, useAppStore: store, editSessionRef };
  const save = callback(composer, "handleSend", env, mutation);
  const pending = save();
  shown = mentions.rebaseMentionText(shown, "new @Ada and @Bob");
  const latestSnapshot = shown;
  env.textareaRef.current.value = shown.content;
  const successor = callback(composer, "handleSend", { ...env, snapshot: shown, text: shown.content }, mutation)();
  // Hold the current Save's ACK too, so the first ACK meets an active same-ID
  // edit. Only the latest request may perform its composer cleanup.
  acknowledge({ ok: true, error: null });
  try {
    await pending;
    assert.equal(store.getState().editingMessage?.id, "message-A");
    assert.equal(shown, latestSnapshot);
    assert.deepEqual(submitted.map((item) => [item.id, item.content, item.entities.items.map((entity) => entity.offset)]), [
      ["message-A", "@Ada and @Bob", [0, 9]], ["message-A", "new @Ada and @Bob", [4, 13]],
    ]);
    assert.equal(error, null);
    acknowledgeSuccessor({ ok: true, error: null });
    await successor;
    assert.equal(store.getState().editingMessage, null);
    assert.equal(shown.content, "original draft");
  } finally {
    acknowledgeSuccessor({ ok: true, error: null });
    await successor;
    unsubscribe?.();
  }
}

test("an older overlapping Save ACK cannot perform the latest Save's cleanup", async () => {
  await assertOverlappingSaves();
});

function assertBotUsername(mutation?: Mutation) {
  const h = pickerHarness(mentions.createMentionText("@"), mutation);
  const botId = "44444444-4444-4444-8444-000000000001";
  try {
    h.state.chats[0].members[1].profile = { full_name: "Ada Lovelace", username: "ada_handle" };
    h.state.chats[0].bots = [
      { id: botId, state: "active", username: "helper_bot", display_name: "Release Helper", avatar_url: null },
      { id: "44444444-4444-4444-8444-000000000002", state: "removed", username: "removed_bot", display_name: "Removed", avatar_url: null },
    ];
    h.field.setSelectionRange(1, 1); h.picker.observeSelection(); h.render();
    assert.deepEqual(h.picker.matches.map((item: mentions.MemberMentionCandidate) => [item.kind, item.id, item.label]), [
      ["user", "11111111-1111-4111-8111-000000000002", "@Ada Lovelace"],
      ["bot", "44444444-4444-4444-8444-000000000001", "@helper_bot"],
    ]);
    h.state.chats[0].bots[0].display_name = "Renamed Display Title"; h.render();
    assert.equal(h.picker.matches[1].label, "@helper_bot");
    h.picker.choose(h.picker.matches[1]); h.render();
    assert.equal(h.snapshot.content, "@helper_bot ");
    assert.deepEqual(h.snapshot.mentionEntities.items, [
      { kind: "bot", bot_id: "44444444-4444-4444-8444-000000000001", offset: 0, length: 11, label: "@helper_bot" },
    ]);
  } finally { h.dispose(); }
}

test("active bot completion inserts @username while human labels retain the display name", () => assertBotUsername());

test("unchanged snapshots still preserve the revision needed by retries", () => {
  const original = snapshot();
  const next = mentions.rebaseMentionText(original, "@Ada and @Bob");
  assert.equal(next.mentionEntities.items.length, 2);
  assert.equal(next.mentionEntities.revision, "33333333-3333-4333-8333-000000000001");
});

function assertChoiceFrame(change: "text" | "metadata" | "dom" | "none", mutation?: Mutation) {
  const h = pickerHarness(mentions.createMentionText("@Ad"), mutation);
  try {
    h.field.setSelectionRange(3, 3); h.picker.observeSelection(); h.render();
    h.picker.choose(h.picker.matches[0]); h.render();
    assert.equal(h.snapshot.content, "@Ada ");
    if (change === "text") {
      h.setSnapshot(mentions.createMentionText("@A")); h.render();
      h.field.setSelectionRange(2, 2); h.picker.observeSelection(); h.render();
    } else if (change === "metadata") {
      h.setSnapshot(mentions.createMentionText("@Ada ")); h.render();
    } else if (change === "dom") {
      h.field.value = "@A";
    }
    h.runFrames();
    if (change === "text") {
      assert.equal(h.snapshot.content, "@A");
      assert.equal(h.picker.open, true, "an old choice RAF must not suppress completion for new text");
      assert.equal(h.picker.matches[0].label, "@Ada");
      assert.equal(h.field.selectionStart, 2);
      assert.equal(h.field.focuses, 0);
    } else if (change === "metadata") {
      assert.equal(h.snapshot.mentionEntities.items.length, 0);
      assert.equal(h.field.focuses, 0, "an old choice RAF must not act on a replaced snapshot");
      assert.equal(h.field.selectionStart, 3);
    } else if (change === "dom") {
      assert.equal(h.field.focuses, 0, "an old choice RAF must check the actual DOM value before React renders");
    } else {
      assert.equal(h.field.selectionStart, 5);
      assert.equal(h.field.focuses, 1);
      assert.equal(h.picker.open, false);
    }
  } finally { h.dispose(); }
}

test("choice RAF cannot overwrite selection after an immediate new query", () => assertChoiceFrame("text"));
test("choice RAF cannot act on changed metadata with identical visible text", () => assertChoiceFrame("metadata"));
test("choice RAF checks the DOM value before a new input's render", () => assertChoiceFrame("dom"));
test("choice RAF still focuses and positions an unchanged selected snapshot", () => assertChoiceFrame("none"));

const mutations: { name: string; mutation: Mutation; check: (mutation: Mutation) => unknown }[] = [
  { name: "choice RAF DOM guard", mutation: { file: hook,
    from: "|| element.value !== result.snapshot.content", to: "" },
    check: (m) => assertChoiceFrame("dom", m) },
  { name: "choice RAF snapshot guard", mutation: { file: hook,
    from: "|| snapshotRef.current.mentionEntities.revision !== result.snapshot.mentionEntities.revision", to: "" },
    check: (m) => assertChoiceFrame("metadata", m) },
  { name: "edit identity", mutation: { file: composer,
    from: "|| useAppStore.getState().editingMessage?.id !== editingMessage.id", to: "" },
    check: (m) => assertEditCompletion({ ok: true, error: null }, "stale", m) },
  { name: "edit session guard", mutation: { file: composer,
    from: "|| editSessionRef.current !== editSession", to: "" },
    check: (m) => assertEditCompletion({ ok: true, error: null }, "reopen", m) },
  { name: "edit transition invalidation", mutation: { file: composer,
    from: "if (state.editingMessage !== previous.editingMessage) editSessionRef.current += 1;", to: "" },
    check: (m) => assertEditCompletion({ ok: true, error: null }, "externalReopen", m) },
  { name: "edit-only transition boundary", mutation: { file: composer,
    from: "state.editingMessage !== previous.editingMessage", to: "state !== previous" },
    check: (m) => assertEditCompletion({ ok: true, error: null }, "unrelated", m) },
  { name: "latest Save generation", mutation: { file: composer,
    from: "const editSession = ++editSessionRef.current;", to: "const editSession = editSessionRef.current;" },
    check: assertOverlappingSaves },
  { name: "bot username basis", mutation: { file: hook,
    from: "label: `@${bot.username}`", to: "label: `@${bot.display_name || bot.username}`" },
    check: assertBotUsername },
  { name: "Escape propagation", mutation: { file: hook,
    from: "event.preventDefault(); event.stopPropagation(); setDismissed(key);", to: "event.preventDefault(); setDismissed(key);" },
    check: assertCaptionEscape },
  { name: "native beforeinput registration", mutation: { file: hook,
    from: 'element.addEventListener("beforeinput", beforeInput);', to: "" },
    check: (m) => assertKeyboardReplacement(composer, m) },
  { name: "native input registration", mutation: { file: hook,
    from: 'element.addEventListener("input", input);', to: "" },
    check: (m) => assertKeyboardReplacement(caption, m) },
  { name: "pre-input selection", mutation: { file: hook,
    from: "start: edit.start, end: edit.end, text:", to: "start: element.selectionStart, end: element.selectionEnd, text:" },
    check: (m) => assertKeyboardReplacement(composer, m) },
  { name: "native IME", mutation: { file: hook,
    from: "|| input.isComposing || input.defaultPrevented", to: "|| input.defaultPrevented" },
    check: (m) => assertInputGate("composing", m) },
  { name: "keyboard-only capture", mutation: { file: hook,
    from: 'input.inputType !== "insertText" ||', to: "false ||" },
    check: (m) => assertInputGate("pasteType", m) },
  { name: "matching input type", mutation: { file: hook,
    from: 'native.inputType !== "insertText"', to: "false" },
    check: (m) => assertInputGate("changedInputType", m) },
  { name: "cancelled beforeinput", mutation: { file: hook,
    from: "|| edit.event.defaultPrevented", to: "" },
    check: (m) => assertInputGate("cancelled", m) },
  { name: "readonly field", mutation: { file: hook,
    from: "&& !element.disabled && !element.readOnly;", to: "&& !element.disabled;" },
    check: (m) => assertInputGate("readonly", m) },
  { name: "account identity", mutation: { file: hook,
    from: "&& useAppStore.getState().currentUser?.id === userId && field.current === element", to: "&& field.current === element" },
    check: (m) => assertInputGate("account", m) },
];

for (const { name, mutation, check } of mutations) test(`mutation: removing ${name} fails its runtime assertion`, async () => {
  await assert.rejects(async () => check(mutation), { code: "ERR_ASSERTION" });
});
