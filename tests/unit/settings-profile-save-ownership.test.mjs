import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { createStore } = requireKub("zustand/vanilla");
const read = (file) => readFileSync(new URL(file, root), "utf8").replaceAll("\r\n", "\n");
const source = read("components/settings/SettingsScreen.tsx");
const A = "10000000-0000-0000-0000-000000000001";
const B = "10000000-0000-0000-0000-000000000002";
const S1 = "20000000-0000-0000-0000-000000000001";
const S2 = "20000000-0000-0000-0000-000000000002";
const FILE = new File(["fictional image"], "fictional.png", { type: "image/png" });
const profile = (id = A, name = "Fictional QA") => ({ id, full_name: name, username: "qa_fixture", bio: null,
  avatar_url: "https://fictional.invalid/prior.png", created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z" });
const fixtures = new Set();
test.afterEach(() => { for (const f of fixtures) f.close(); fixtures.clear(); });

function compile(text, imports = {}, globals = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(text, { reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  assert.equal(result.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports, Date, Error, atob,
    require(name) { assert.ok(Object.hasOwn(imports, name), `unexpected dependency ${name}`); return imports[name]; }, ...globals });
  return module.exports;
}

function pure(file) {
  const text = read(file), imports = {};
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const node of tree.statements) if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
    const name = node.moduleSpecifier.text;
    assert.ok(name.startsWith("./"), `pure dependency ${name}`);
    imports[name] = pure("lib/" + name.slice(2));
  }
  return compile(text, imports, { crypto: { randomUUID: () => "40000000-0000-0000-0000-000000000001" } });
}

// Extract unchanged production handlers plus their actual owner/ref lifecycle.
// The complete store and Zustand core are real; only I/O and React boundaries are fictional.
function handlerProgram(text) {
  const tree = ts.createSourceFile("SettingsScreen.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "useSettingsScreen");
  assert.ok(component?.body, "actual Settings hook is present");
  const names = new Set(["profileOwnerLeaseRef", "profileSaveGenerationRef", "avatarGenerationRef", "captureProfileOwner",
    "handleSave", "handleAvatarChange", "handleRemoveAvatar"]);
  const selected = component.body.statements.filter((node) => {
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.some((item) => names.has(item.name.getText(tree)));
    return ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
      && node.expression.expression.getText(tree) === "useLayoutEffect" && node.getText(tree).includes("profileOwnerLeaseRef");
  });
  for (const name of ["handleSave", "handleAvatarChange", "handleRemoveAvatar"])
    assert.ok(selected.some((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(tree) === name)));
  return selected.map((node) => node.getText(tree)).join("\n") + "\nexport { handleSave, handleAvatarChange, handleRemoveAvatar };";
}

function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }

function fixture({ text = source } = {}) {
  const calls = [], effects = [], publications = [], held = new Map(), consumed = [], timers = new Map(), refs = [];
  let core, cursor, frame, cleanup, deps, timerId = 0;
  const ui = { fullName: "Fictional New", username: "qa_fixture", bio: "fictional bio", saving: false, uploadingAvatar: false, saved: false };
  const methods = {};
  for (const key of ["Saving", "UploadingAvatar", "Error", "SaveFailure", "Saved", "FullName", "Username", "Bio"])
    methods["set" + key] = (value) => { const field = key[0].toLowerCase() + key.slice(1); ui[field] = value; effects.push({ field, value }); };
  const useAppStore = compile(read("store/app.store.ts"), {
    zustand: { create(initializer) { core = createStore(initializer); return Object.assign((selector) => selector(core.getState()), core); } },
    "@/lib/supabase/client": {}, "@/lib/chatSort": {}, "@/lib/chatListChange": {}, "@/lib/chatListDelta": {},
    "@/lib/structuralSharing": {}, "@/lib/messageActor": {}, "@/lib/chatMute": { EMPTY_CHAT_MUTES: {} }, "@/lib/errors": {},
    "@/lib/profileChange": pure("lib/profileChange.ts"), "@/lib/authSessionIdentity": pure("lib/authSessionIdentity.ts"),
    "@/lib/outbox/appOutbox": { appOutbox: { stop() {} } },
  }).useAppStore;
  const auth = (id, sid = S1) => {
    useAppStore.getState().setAuthSessionIdentity(id ? { userId: id, sessionId: sid } : null);
    if (id) useAppStore.getState().setCurrentUser(profile(id), useAppStore.getState().accountEpoch);
  };
  auth(A);
  const actualSetter = useAppStore.getState().setCurrentUser;
  const setCurrentUser = (row, epoch) => { publications.push({ row, epoch }); actualSetter(row, epoch); };
  const hold = (name) => { const gate = deferred(); held.set(name, [...(held.get(name) ?? []), gate]); return gate; };
  const boundary = (name, response) => {
    const gate = held.get(name)?.shift(); if (gate) consumed.push({ gate, response });
    return gate?.promise ?? Promise.resolve(response);
  };
  const client = {
    from(table) {
      assert.equal(table, "profiles"); let payload, target;
      const request = () => { calls.push({ kind: "profile", payload, target }); return boundary("profile", { data: profile(A, "Fictional New"), error: null }); };
      const query = { update(value) { payload = value; return query; }, eq(column, value) { assert.equal(column, "id"); target = value; return query; },
        select() { return query; }, single: request, then(done, fail) { return request().then(done, fail); } };
      return query;
    },
    storage: { from(bucket) { assert.equal(bucket, "media"); return {
      upload(path, file, options) { calls.push({ kind: "upload", path, file, options }); return boundary("upload", { data: { path }, error: null }); },
      remove() { assert.fail("ownership cleanup must never delete user objects"); },
    }; } },
  };
  const validation = pure("lib/profileValidation.ts"), media = pure("lib/mediaUpload.ts"), errors = pure("lib/errors.ts");
  const program = handlerProgram(text);
  function render() {
    cursor = 0; const state = useAppStore.getState();
    frame = compile(program, {}, { ...validation, ...errors, ...methods, ...ui,
      currentUser: state.currentUser, accountEpoch: state.accountEpoch, useAppStore, setCurrentUser, supabase: client, isAdmin: false,
      useRef(initial) { return refs[cursor++] ??= { current: initial }; },
      useLayoutEffect(callback, nextDeps) {
        if (!deps || nextDeps.some((value, index) => !Object.is(value, deps[index]))) { cleanup?.(); deps = nextDeps; cleanup = callback(); }
      },
      validateAvatarImage: media.validateAvatarImage, validateAvatarUploadImage: media.validateAvatarUploadImage, avatarUploadPath: media.avatarUploadPath,
      prepareAvatarImage(file) { calls.push({ kind: "prepare" }); return boundary("prepare", file); }, cacheControlFor: () => "31536000",
      publicMediaObjectUrl({ bucket, path }) { return `https://fictional.invalid/${bucket}/${path}`; },
      requestAppConfirm() { calls.push({ kind: "confirm" }); return boundary("confirm", true); },
      avatarRemovalPrompt: pure("lib/settingsPrompts.ts").avatarRemovalPrompt,
      console: { error() { effects.push({ field: "log" }); } },
      setTimeout(callback, ms) { timers.set(++timerId, { callback, ms }); return timerId; },
    });
    return frame;
  }
  render(); Object.assign(ui, { fullName: "Fictional New", username: "qa_fixture", bio: "fictional bio" }); render();
  const f = { calls, effects, publications, timers, ui, hold, render, auth, core,
    get frame() { return frame; }, get state() { return useAppStore.getState(); },
    clear() { effects.length = 0; calls.length = 0; publications.length = 0; },
    async drain() { for (let i = 0; i < 12; i++) await Promise.resolve(); },
    fireTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
    unmount() { cleanup?.(); cleanup = null; },
    remount() { f.unmount(); refs.length = 0; deps = null; render(); },
    replayLayout() { cleanup?.(); cleanup = null; deps = null; render(); },
    close() { f.unmount(); for (const { gate, response } of consumed) gate.resolve(response); timers.clear(); },
  };
  fixtures.add(f); f.clear(); return f;
}

async function lateSave(options, { boundary = "logout", error = false, rejected = false } = {}) {
  const f = fixture(options), gate = f.hold("profile"), pending = f.frame.handleSave(); await f.drain();
  assert.equal(f.calls.filter((item) => item.kind === "profile").length, 1, "actual profile PATCH is held");
  if (boundary === "unmount") f.unmount();
  else if (boundary === "replay") f.replayLayout();
  else f.auth(boundary === "logout" ? null : boundary === "B" ? B : A, S2);
  f.clear();
  if (rejected) gate.reject(new Error("fictional offline"));
  else gate.resolve({ data: error ? null : profile(A, "Retired"), error: error ? { code: "23505" } : null });
  await assert.doesNotReject(pending, "retired save rejection is handled locally"); await f.drain();
  assert.equal(f.effects.length, 0, "retired save must not publish local completion, failure or loading");
  assert.equal(f.publications.length, 0, "retired save must not invoke the profile publisher");
  assert.equal(f.timers.size, 0, "retired save must not start a saved-status timer");
  if (boundary === "logout") assert.equal(f.state.currentUser, null, "retired profile ACK must not restore a signed-out owner");
}

async function lateAvatar(stage, options, boundary = "logout", rejected = false) {
  const f = fixture(options), gate = f.hold(stage);
  const pending = stage === "confirm" ? f.frame.handleRemoveAvatar() : f.frame.handleAvatarChange(FILE);
  await f.drain();
  assert.ok(f.calls.some((item) => item.kind === stage), "actual avatar boundary is held");
  if (boundary === "unmount") f.unmount(); else f.auth(boundary === "logout" ? null : A, S2);
  f.clear();
  if (rejected) gate.reject(new Error("fictional offline"));
  else gate.resolve(stage === "confirm" ? true : stage === "prepare" ? FILE : stage === "upload" ? { data: { path: "fictional-avatar.png" }, error: null } : { error: null });
  await assert.doesNotReject(pending, "retired avatar rejection is handled locally"); await f.drain();
  assert.equal(f.calls.length, 0, "retired avatar continuation must not issue a follow-up write");
  assert.equal(f.effects.length, 0, "retired avatar continuation must not publish local completion");
  assert.equal(f.publications.length, 0, "retired avatar continuation must not publish a profile");
  if (boundary === "logout") assert.equal(f.state.currentUser, null);
}

async function lateRemoval(options, unmount = false) {
  const f = fixture(options), gate = f.hold("profile"), pending = f.frame.handleRemoveAvatar(); await f.drain();
  assert.equal(f.calls.filter((item) => item.kind === "profile").length, 1);
  if (unmount) f.unmount(); else f.auth(null);
  f.clear(); gate.resolve({ error: null }); await pending;
  assert.equal(f.publications.length, 0, "retired avatar removal must not restore the profile");
  assert.equal(f.effects.length, 0);
}

async function expectedEpoch(options) {
  const f = fixture(options); await f.frame.handleSave();
  assert.equal(f.publications[0].epoch, 1, "profile publisher must receive expected epoch 1");
}

async function savedTimer(options) {
  const f = fixture(options); await f.frame.handleSave(); f.auth(A, S2); f.ui.saved = true; f.clear(); f.fireTimers();
  assert.equal(f.effects.length, 0, "retired saved timer must not publish into the current UI"); assert.equal(f.ui.saved, true);
}

async function staleEntry(options, kind = "save") {
  const f = fixture(options), old = kind === "save" ? f.frame.handleSave : kind === "upload" ? () => f.frame.handleAvatarChange(FILE) : f.frame.handleRemoveAvatar;
  f.auth(A, S2); f.clear(); await old();
  assert.equal(f.calls.length, 0, "stale handler must be refused before I/O"); assert.equal(f.effects.length, 0);
}

async function concurrentSave(options, remount = false) {
  const f = fixture(options), old = f.hold("profile"), pendingOld = f.frame.handleSave(); await f.drain();
  if (remount) f.remount();
  const current = f.hold("profile"), pendingCurrent = f.frame.handleSave(); await f.drain(); f.clear();
  old.resolve({ data: profile(A, "Retired"), error: null }); await pendingOld;
  assert.equal(f.effects.length, 0, "retired save must not finish or clear the latest save UI");
  assert.equal(f.publications.length, 0, "retired save must not replace the latest profile draft");
  assert.equal(f.ui.saving, true); current.resolve({ data: profile(A, "Latest"), error: null }); await pendingCurrent;
  assert.equal(f.state.currentUser.full_name, "Latest"); assert.equal(f.ui.saving, false);
}

async function concurrentAvatar(options) {
  const f = fixture(options), old = f.hold("prepare"), pendingOld = f.frame.handleAvatarChange(FILE);
  const current = f.hold("prepare"), pendingCurrent = f.frame.handleAvatarChange(FILE); f.clear();
  old.resolve(FILE); await pendingOld;
  assert.equal(f.calls.length, 0, "retired avatar operation must not issue a successor write");
  assert.equal(f.effects.length, 0); assert.equal(f.ui.uploadingAvatar, true);
  current.resolve(FILE); await pendingCurrent; assert.equal(f.ui.uploadingAvatar, false); assert.equal(f.publications.length, 1);
}

async function postPublicationBoundary(options) {
  const f = fixture(options); let switched = false;
  const unsubscribe = f.core.subscribe((state) => {
    if (!switched && state.currentUser?.full_name === "Fictional New") { switched = true; f.auth(null); f.clear(); }
  });
  await f.frame.handleSave(); unsubscribe(); assert.equal(switched, true);
  assert.equal(f.effects.length, 0, "owner loss during profile publication must stop saved UI completion");
  assert.equal(f.state.currentUser, null); assert.equal(f.timers.size, 0);
}

async function normalAvatar(options) {
  const f = fixture(options), gate = f.hold("upload"), pending = f.frame.handleAvatarChange(FILE); await f.drain();
  f.state.setCurrentUser(profile(A, "Concurrent name"), 1); gate.resolve({ data: { path: "fictional-avatar.png" }, error: null }); await pending;
  assert.equal(f.state.currentUser.full_name, "Concurrent name", "avatar completion must merge the live profile, not its old closure");
  assert.equal(f.state.currentUser.avatar_url, "https://fictional.invalid/media/fictional-avatar.png"); assert.equal(f.ui.uploadingAvatar, false);
  assert.equal(f.publications[0].epoch, 1, "avatar upload publisher must receive expected epoch 1"); assert.equal(f.calls.at(-1).target, A);
}

async function normalRemoval(options) {
  const f = fixture(options), gate = f.hold("confirm"), pending = f.frame.handleRemoveAvatar();
  f.state.setCurrentUser(profile(A, "Concurrent name"), 1); gate.resolve(true); await pending;
  assert.equal(f.state.currentUser.full_name, "Concurrent name", "avatar removal must merge the live profile, not its old closure");
  assert.equal(f.state.currentUser.avatar_url, null);
  assert.equal(f.publications[0].epoch, 1, "avatar removal publisher must receive expected epoch 1"); assert.equal(f.calls.at(-1).target, A);
}

async function saveAfterAvatar(options, upload = false) {
  const f = fixture(options), gate = f.hold("profile"), pending = f.frame.handleSave(); await f.drain();
  if (upload) await f.frame.handleAvatarChange(FILE); else await f.frame.handleRemoveAvatar();
  assert.equal(f.state.accountEpoch, 1, "avatar change keeps the same live owner epoch");
  if (upload) assert.equal(f.state.currentUser.avatar_url,
    "https://fictional.invalid/media/avatars/10000000-0000-0000-0000-000000000001/avatar-40000000-0000-0000-0000-000000000001.png");
  else assert.equal(f.state.currentUser.avatar_url, null, "actual removal publishes the cleared avatar before save ACK");
  gate.resolve({ data: { ...profile(A, "Fictional ACK"), username: "qa_ack", bio: "ack bio" }, error: null }); await pending;
  if (upload) assert.equal(f.state.currentUser.avatar_url,
    "https://fictional.invalid/media/avatars/10000000-0000-0000-0000-000000000001/avatar-40000000-0000-0000-0000-000000000001.png",
    "late save ACK must preserve the newer uploaded avatar");
  else assert.equal(f.state.currentUser.avatar_url, null, "late save ACK must not resurrect the removed avatar");
  assert.equal(f.state.currentUser.full_name, "Fictional ACK"); assert.equal(f.state.currentUser.username, "qa_ack");
  assert.equal(f.state.currentUser.bio, "ack bio"); assert.equal(f.state.currentUser.id, A);
  assert.equal(f.ui.saved, true); assert.equal(f.ui.saving, false);
}

test("ordinary profile save publishes its ACK and expires saved status after two seconds", async () => {
  const f = fixture(); await f.frame.handleSave();
  assert.equal(f.state.currentUser.full_name, "Fictional New"); assert.equal(f.ui.saving, false); assert.equal(f.ui.saved, true);
  assert.equal(f.calls[0].target, A); assert.equal(f.calls[0].payload.full_name, "Fictional New");
  assert.equal([...f.timers.values()][0].ms, 2000); f.fireTimers(); assert.equal(f.ui.saved, false);
});
test("profile publisher receives the captured account epoch", () => expectedEpoch());
for (const boundary of ["logout", "B", "session", "unmount", "replay"])
  test(`held profile ACK is inert after ${boundary}`, () => lateSave(undefined, { boundary }));
test("retired returned profile error cannot affect local UI", () => lateSave(undefined, { error: true }));
test("retired thrown profile error is caught without local effects", () => lateSave(undefined, { rejected: true }));
test("current thrown profile failure clears loading and reports failure", async () => {
  const f = fixture(), gate = f.hold("profile"), pending = f.frame.handleSave(); gate.reject(new Error("fictional offline"));
  await assert.doesNotReject(pending, "current profile rejection is handled locally"); assert.equal(f.ui.saving, false); assert.ok(f.ui.saveFailure);
  assert.equal(f.ui.saved, false); assert.equal(f.publications.length, 0);
});
test("captured old handler is refused before issuing a new request", () => staleEntry());
test("old saved timer cannot change the replacement owner's UI", () => savedTimer());
test("normal avatar upload preserves other current profile fields and publishes expected epoch", () => normalAvatar());
test("normal confirmed avatar removal preserves current fields and publishes expected epoch", () => normalRemoval());
test("held same-owner save ACK cannot resurrect an avatar removed while save waits", () => saveAfterAvatar());
test("held same-owner save ACK cannot replace an avatar uploaded while save waits", () => saveAfterAvatar(undefined, true));
test("normal save ACK followed by avatar removal still applies both operations", async () => {
  const f = fixture(); await f.frame.handleSave(); await f.frame.handleRemoveAvatar();
  assert.equal(f.state.currentUser.full_name, "Fictional New"); assert.equal(f.state.currentUser.avatar_url, null);
  assert.equal(f.publications.length, 2); assert.equal(f.state.accountEpoch, 1);
});
for (const stage of ["prepare", "upload", "profile", "confirm"])
  test(`avatar continuation is inert after logout at ${stage}`, () => lateAvatar(stage));
test("avatar preparation cannot continue after same-user session replacement", () => lateAvatar("prepare", undefined, "session"));
test("avatar upload cannot continue after mounted cleanup", () => lateAvatar("upload", undefined, "unmount"));
test("retired avatar preparation rejection is caught without UI effects", () => lateAvatar("prepare", undefined, "logout", true));
test("retired avatar removal ACK cannot restore a signed-out profile", () => lateRemoval());
test("retired avatar removal ACK is inert after unmount", () => lateRemoval(undefined, true));
test("retired avatar profile ACK is inert after same-user session replacement", () => lateAvatar("profile", undefined, "session"));
test("retired avatar confirmation rejection is caught without UI effects", () => lateAvatar("confirm", undefined, "logout", true));
test("stale captured avatar upload entry cannot acquire or upload", () => staleEntry(undefined, "upload"));
test("stale captured avatar removal entry cannot ask or update", () => staleEntry(undefined, "remove"));
test("earlier save ACK cannot clear the newest same-owner save", () => concurrentSave());
test("true unmount/remount retires the old save while a new instance saves", () => concurrentSave(undefined, true));
test("earlier avatar preparation cannot continue a newer avatar operation", () => concurrentAvatar());
test("synchronous owner loss during profile publication cannot publish saved status", () => postPublicationBoundary());
test("current avatar preparation rejection reports failure and releases loading", async () => {
  const f = fixture(), gate = f.hold("prepare"), pending = f.frame.handleAvatarChange(FILE); gate.reject(new Error("fictional offline"));
  await pending; assert.ok(f.ui.error); assert.equal(f.ui.uploadingAvatar, false); assert.equal(f.publications.length, 0);
});
test("declined avatar removal never issues a profile write", async () => {
  const f = fixture(), gate = f.hold("confirm"), pending = f.frame.handleRemoveAvatar(); gate.resolve(false); await pending;
  assert.equal(f.calls.filter((item) => item.kind === "profile").length, 0); assert.equal(f.publications.length, 0);
});
test("current returned username refusal keeps the field failure and ends loading", async () => {
  const f = fixture(), gate = f.hold("profile"), pending = f.frame.handleSave();
  gate.resolve({ data: null, error: { code: "23505", message: "fictional profiles_username_key" } }); await pending;
  assert.equal(f.ui.saveFailure.field, "username"); assert.equal(f.ui.saving, false); assert.equal(f.ui.saved, false);
});

function mutate(before, after, count = 1, index = 0) {
  const parts = source.split(before); assert.equal(parts.length - 1, count, "literal mutation targets the frozen source exactly");
  return parts.slice(0, index + 1).join(before) + after + parts.slice(index + 1).join(before);
}
const mutants = [
  ["epoch comparison", "&& useAppStore.getState().accountEpoch === epoch", "", (options) => lateSave(options, { boundary: "session" }), "retired save must not publish local completion, failure or loading"],
  ["mounted lease cleanup", "if (profileOwnerLeaseRef.current === lease) profileOwnerLeaseRef.current = null;", "", (options) => lateSave(options, { boundary: "unmount" }), "retired save must not publish local completion, failure or loading"],
  ["save entry fence", "const handleSave = async () => {\n    if (!currentUser) return;\n    const owner = captureProfileOwner(currentUser.id);\n    if (!owner.isCurrent()) return;", "const handleSave = async () => {\n    if (!currentUser) return;\n    const owner = captureProfileOwner(currentUser.id);", staleEntry, "stale handler must be refused before I/O"],
  ["save ACK fence", ".single();\n      if (!isCurrent()) return;", ".single();", (options) => lateSave(options, { error: true }), "retired save must not publish local completion, failure or loading"],
  ["save catch fence", "} catch (err) {\n      if (!isCurrent()) return;\n      setSaveFailure", "} catch (err) {\n      setSaveFailure", (options) => lateSave(options, { rejected: true }), "retired save must not publish local completion, failure or loading"],
  ["save finally fence", "if (isCurrent()) setSaving(false);", "setSaving(false);", lateSave, "retired save must not publish local completion, failure or loading"],
  ["save expected epoch", "setCurrentUser(savedProfile, owner.accountEpoch)", "setCurrentUser(savedProfile)", expectedEpoch, "profile publisher must receive expected epoch 1"],
  ["post-publication owner fence", "      }\n      if (!isCurrent()) return;\n      setSaved(true);", "      }\n      setSaved(true);", postPublicationBoundary, "owner loss during profile publication must stop saved UI completion"],
  ["save-owned field merge", "const savedProfile = {\n            ...liveProfile,\n            full_name: data.full_name,\n            username: data.username,\n            bio: data.bio,\n          };", "const savedProfile = data;", saveAfterAvatar, "late save ACK must not resurrect the removed avatar"],
  ["saved timer fence", "setTimeout(() => { if (isCurrent()) setSaved(false); }, 2000);", "setTimeout(() => { setSaved(false); }, 2000);", savedTimer, "retired saved timer must not publish into the current UI"],
  ["latest save generation", "&& profileSaveGenerationRef.current === generation", "", concurrentSave, "retired save must not finish or clear the latest save UI"],
  ["avatar preparation fence", "const preparedFile = await prepareAvatarImage(file);\n      if (!isCurrent()) return;", "const preparedFile = await prepareAvatarImage(file);", (options) => lateAvatar("prepare", options), "retired avatar continuation must not issue a follow-up write"],
  ["avatar upload fence", "if (!isCurrent()) return;\n      if (upErr)", "if (upErr)", (options) => lateAvatar("upload", options), "retired avatar continuation must not issue a follow-up write"],
  ["avatar profile ACK fence", "if (!isCurrent()) return;\n      if (profileErr)", "if (profileErr)", (options) => lateAvatar("profile", options, "session"), "retired avatar continuation must not publish a profile"],
  ["avatar catch fence", "if (isCurrent()) setError(mapPgError(err));", "setError(mapPgError(err));", (options) => lateAvatar("prepare", options, "logout", true), "retired avatar continuation must not publish local completion"],
  ["avatar finally fence", "if (isCurrent()) setUploadingAvatar(false);", "setUploadingAvatar(false);", (options) => lateAvatar("upload", options), "retired avatar continuation must not publish local completion", 2],
  ["latest avatar generation", "&& avatarGenerationRef.current === generation", "", concurrentAvatar, "retired avatar operation must not issue a successor write", 2],
  ["avatar live-profile merge", "{ ...liveProfile, avatar_url: publicUrl }", "{ ...currentUser, avatar_url: publicUrl }", normalAvatar, "avatar completion must merge the live profile, not its old closure"],
  ["avatar upload expected epoch", "setCurrentUser({ ...liveProfile, avatar_url: publicUrl }, owner.accountEpoch)", "setCurrentUser({ ...liveProfile, avatar_url: publicUrl })", normalAvatar, "avatar upload publisher must receive expected epoch 1"],
  ["removal confirm fence", "if (!isCurrent() || !confirmed) return;", "if (!confirmed) return;", (options) => lateAvatar("confirm", options), "retired avatar continuation must not issue a follow-up write"],
  ["removal ACK fence", '.eq("id", owner.userId);\n      if (!isCurrent()) return;\n      if (err)', '.eq("id", owner.userId);\n      if (err)', (options) => lateRemoval(options, true), "retired avatar removal must not restore the profile"],
  ["removal catch fence", 'if (isCurrent()) setError(prefixError("Не удалось удалить фото", err));', 'setError(prefixError("Не удалось удалить фото", err));', (options) => lateAvatar("confirm", options, "logout", true), "retired avatar continuation must not publish local completion"],
  ["removal live-profile merge", "{ ...liveProfile, avatar_url: null }", "{ ...currentUser, avatar_url: null }", normalRemoval, "avatar removal must merge the live profile, not its old closure"],
  ["avatar removal expected epoch", "setCurrentUser({ ...liveProfile, avatar_url: null }, owner.accountEpoch)", "setCurrentUser({ ...liveProfile, avatar_url: null })", normalRemoval, "avatar removal publisher must receive expected epoch 1"],
];
for (const [name, before, after, scenario, oracle, count, index] of mutants) {
  test(`compiled omission mutant rejected: ${name}`, async () => {
    const text = mutate(before, after, count, index);
    await assert.rejects(() => scenario({ text }), (error) => error.code === "ERR_ASSERTION" && error.message.split("\n")[0] === oracle);
  });
}
