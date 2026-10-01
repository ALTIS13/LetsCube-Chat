import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as mentions from "../../artifacts/kub/src/lib/memberMentions.ts";
import * as botSurfaces from "../../artifacts/kub/src/lib/botChatSurfaces.ts";

const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const React = kubRequire("react");
const { renderToStaticMarkup } = kubRequire("react-dom/server");
const OWNER = "11111111-1111-4111-8111-000000000001";
const OTHER = "11111111-1111-4111-8111-000000000002";
const CHAT = "22222222-2222-4222-8222-000000000001";
const REV = "33333333-3333-4333-8333-000000000001";
const NEXT_REV = "33333333-3333-4333-8333-000000000002";
const JOIN_REV = "33333333-3333-4333-8333-000000000003";
const BOT = "44444444-4444-4444-8444-000000000001";
const OWN_KEY = "kub:draft:v2:11111111-1111-4111-8111-000000000001:22222222-2222-4222-8222-000000000001";
const OTHER_KEY = "kub:draft:v2:11111111-1111-4111-8111-000000000002:22222222-2222-4222-8222-000000000001";
const LEGACY_KEY = "kub:draft:22222222-2222-4222-8222-000000000001";
const EMPTY = { content: "", mentionEntities: { version: 1, revision: null, items: [] } };

type Runtime = ReturnType<typeof runtime>;
type Omission = { file: "formatText.tsx" | "memberMentionDrafts.ts"; before: string; after: string };
const sources = new Map(["formatText.tsx", "memberMentionDrafts.ts"].map((name) => {
  const url = new URL(`../../artifacts/kub/src/lib/${name}`, import.meta.url);
  return [name, { path: fileURLToPath(url), text: readFileSync(url, "utf8") }];
}));

// Fresh CommonJS exports per load; dependencies are the real pure APIs and kub's React.
function runtime(omission?: Omission) {
  function load(name: string) {
    const source = sources.get(name)!;
    let text = source.text;
    if (omission?.file === name) {
      assert.equal(text.split(omission.before).length - 1, 1, `unique omission anchor: ${name}`);
      text = text.replace(omission.before, omission.after);
    }
    const compiled = ts.transpileModule(text, {
      fileName: source.path,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React, esModuleInterop: true },
    });
    assert.deepEqual(compiled.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error), []);
    const module = { exports: {} as any };
    const require = (id: string) => {
      if (id === "react") return React;
      if (id === "./memberMentions.ts") return mentions;
      if (id === "./botChatSurfaces.ts") return botSurfaces;
      throw new Error(`Unexpected runtime dependency: ${id}`);
    };
    runInThisContext(`(function(require, module, exports) {\n${compiled.outputText}\n})`, {
      filename: source.path,
    })(require, module, module.exports);
    return module.exports;
  }
  return { FormattedText: load("formatText.tsx").FormattedText,
    ...load("memberMentionDrafts.ts") };
}

function elements(node: any, type?: string): any[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!React.isValidElement(node)) return [];
  return [...(!type || node.type === type ? [node] : []), ...elements(node.props.children, type)];
}

function textContent(node: any): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (React.isValidElement(node)) {
    return node.type === "br" ? "\n" : textContent(node.props.children);
  }
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

function render(api: Runtime, content: string, entities: unknown,
  onOpen: (entity: mentions.MentionEntity, trigger: unknown) => void = () => {}) {
  const tree = api.FormattedText({ content, members: { entities, onOpen } });
  const markup = renderToStaticMarkup(tree);
  return { tree, markup, buttons: elements(tree, "button").filter((b) => "data-member-mention" in b.props) };
}

function multilineFixture() {
  return { content: "start \u{1f600}\n**@\u0410\u043d\u043d\u0430 \u0421\u043c\u0438\u0440\u043d\u043e\u0432\u0430** and @Helper\n@raw_handle",
    entities: { version: 1, revision: REV, items: [
      { kind: "user", user_id: OWNER, offset: 11, length: 14, label: "@\u0410\u043d\u043d\u0430 \u0421\u043c\u0438\u0440\u043d\u043e\u0432\u0430" },
      { kind: "bot", bot_id: BOT, offset: 32, length: 7, label: "@Helper" },
    ] } };
}

function assertOffsets(api: Runtime) {
  const { content, entities } = multilineFixture();
  assert.equal(mentions.parseMessageMentions(content, entities)?.items.length, 2);
  const shown = render(api, content, entities);
  assert.deepEqual(shown.buttons.map((b) => b.props["data-member-mention"]), [
    "11111111-1111-4111-8111-000000000001", "44444444-4444-4444-8444-000000000001",
  ]);
  assert.equal(textContent(shown.tree), "start \u{1f600}\n@\u0410\u043d\u043d\u0430 \u0421\u043c\u0438\u0440\u043d\u043e\u0432\u0430 and @Helper\n@raw_handle");
  assert.equal(elements(shown.tree, "br").length, 2);
  const strong = elements(shown.tree, "strong");
  assert.equal(strong.length, 1);
  assert.equal(elements(strong[0], "button").length, 1);
  assert.equal(textContent(strong[0]), "@\u0410\u043d\u043d\u0430 \u0421\u043c\u0438\u0440\u043d\u043e\u0432\u0430");
  assert.match(shown.markup, /<strong><button[^>]+data-member-mention="11111111-1111-4111-8111-000000000001"/);
  assert.match(shown.markup, /<br\/>/);
  assert.doesNotMatch(shown.markup, /data-member-mention="raw_handle"/);
}

function assertUuidAction(api: Runtime) {
  const calls: any[] = [];
  const { content, entities } = multilineFixture();
  const shown = render(api, content, entities, (entity: any, trigger: any) => calls.push({ entity, trigger }));
  assert.equal(shown.buttons.length, 2);
  const trigger = { id: "profile-trigger" };
  for (const button of shown.buttons) {
    let prevented = 0;
    let stopped = 0;
    button.props.onClick({ currentTarget: trigger, preventDefault() { prevented += 1; }, stopPropagation() { stopped += 1; } });
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
  }
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ entity }) => entity), [
    { kind: "user", user_id: "11111111-1111-4111-8111-000000000001", offset: 11, length: 14,
      label: "@\u0410\u043d\u043d\u0430 \u0421\u043c\u0438\u0440\u043d\u043e\u0432\u0430" },
    { kind: "bot", bot_id: "44444444-4444-4444-8444-000000000001", offset: 32, length: 7, label: "@Helper" },
  ]);
  assert.ok(calls.every((call) => call.trigger === trigger));
}

function assertInvalidPlain(api: Runtime) {
  const shown = render(api, "@ghost", { version: 1, revision: REV,
    items: [{ kind: "user", user_id: "not-a-uuid", offset: 0, length: 6, label: "@ghost" }] });
  assert.equal(shown.buttons.length, 0);
  assert.equal(textContent(shown.tree), "@ghost");
  assert.doesNotMatch(shown.markup, /data-member-mention|<button/);
}

function assertWhitespace(api: Runtime) {
  const cases = [
    ["@raw_handle @\u0410\u043d\u043d\u0430 @unknown", "@raw_handle @\u0410\u043d\u043d\u0430 @unknown"],
    ["hello @raw_handle", "hello @raw_handle"],
    ["@first @second", "@first @second"],
    ["\t@one  @two\u00a0@three\n\u{1f600} @four", "\t@one  @two\u00a0@three\n\u{1f600} @four"],
  ];
  for (const [content, expected] of cases) {
    const shown = render(api, content, { version: 1, revision: null, items: [] });
    assert.equal(textContent(shown.tree), expected);
    assert.equal(shown.buttons.length, 0);
  }
  assert.match(render(api, "hello @raw_handle", null).markup, /^hello <span /);
}

function storage(initial: [string, string][] = []) {
  const values = new Map(initial);
  const calls: { kind: string; key: string }[] = [];
  return { values, calls,
    getItem(key: string) { calls.push({ kind: "get", key }); return values.get(key) ?? null; },
    setItem(key: string, value: string) { calls.push({ kind: "set", key }); values.set(key, value); },
    removeItem(key: string) { calls.push({ kind: "remove", key }); values.delete(key); },
  };
}

function draftFixture() {
  return mentions.createMentionText("\u{1f600} @\u0410\u043d\u043d\u0430 @Helper", { version: 1, revision: REV, items: [
    { kind: "user", user_id: OWNER, offset: 3, length: 5, label: "@\u0410\u043d\u043d\u0430" },
    { kind: "bot", bot_id: BOT, offset: 9, length: 7, label: "@Helper" },
  ] });
}

function assertOwnerGuard(api: Runtime) {
  const raw = JSON.stringify({ version: 2, owner: OTHER, chat: CHAT, ...draftFixture() });
  const disk = storage([[OWN_KEY, raw]]);
  assert.deepEqual(api.readMentionDraft(disk, OWNER, CHAT), EMPTY);
  assert.equal(disk.values.get(OWN_KEY), raw);
  assert.deepEqual(disk.calls, [{ kind: "get", key: OWN_KEY }]);
}

const api = runtime();

test("render preserves UTF-16 offsets through newline, non-BMP prefix, bold and a preceding token", () => assertOffsets(api));
test("user and bot profile actions pass the persisted UUID entity and the actual trigger, not a handle", () => assertUuidAction(api));
test("invalid UUID metadata cannot turn visible text into a profile action", () => assertInvalidPlain(api));

test("raw whitespace is rendered exactly once, including tabs, NBSP and consecutive handles", () => {
  console.log("LITERAL rendered:", JSON.stringify(textContent(api.FormattedText({
    content: "@raw_handle @\u0410\u043d\u043d\u0430 @unknown",
  }))));
  assertWhitespace(api);
});

test("raw handles before and after styled members preserve newline and UTF-16 entity offsets", () => {
  const content = "\u{1f600} @raw\n**@Ann** @raw\n*@Ann* @raw\n~~@Ann~~ @raw";
  const entities = { version: 1, revision: REV, items: [
    { kind: "user", user_id: OWNER, offset: 10, length: 4, label: "@Ann" },
    { kind: "bot", bot_id: BOT, offset: 23, length: 4, label: "@Ann" },
    { kind: "user", user_id: OTHER, offset: 36, length: 4, label: "@Ann" },
  ] };
  assert.equal(mentions.parseMessageMentions(content, entities)?.items.length, 3);
  const shown = render(api, content, entities);
  assert.equal(textContent(shown.tree), "\u{1f600} @raw\n@Ann @raw\n@Ann @raw\n@Ann @raw");
  assert.deepEqual(shown.buttons.map((b) => b.props["data-member-mention"]), [
    "11111111-1111-4111-8111-000000000001", "44444444-4444-4444-8444-000000000001", "11111111-1111-4111-8111-000000000002",
  ]);
  for (const [tag, uuid] of [["strong", OWNER], ["em", BOT], ["s", OTHER]]) {
    const style = elements(shown.tree, tag);
    assert.equal(style.length, 1);
    assert.equal(textContent(style[0]), "@Ann");
    assert.equal(elements(style[0], "button")[0].props["data-member-mention"], uuid);
  }
});

test("isolated Chromium focus and native activation produce no unexpected profile, command or bubble callbacks", { timeout: 30000 }, async () => {
  const { chromium } = kubRequire("@playwright/test");
  const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");
  const bundle = await build({ write: false, bundle: true, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"development"' },
    stdin: { resolveDir: fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url)),
      sourcefile: "member-mention-focus-fixture.tsx", loader: "tsx", contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { FormattedText } from "./lib/formatText.tsx";
        const root = createRoot(document.getElementById("root"));
        window.mountMentions = (invalid = false) => {
          const proof = window.mentionProof = { profiles: [], commands: [], rowClicks: 0, rowPointers: 0 };
          root.render(<div id="bubble" onClick={() => proof.rowClicks++} onPointerDown={() => proof.rowPointers++}>
            <FormattedText content={invalid ? "@raw_handle @Ann @other" : "@raw_handle @Ann @other /help"}
              members={{ entities: { version: 1, revision: ${JSON.stringify(REV)}, items: [
                { kind: "user", user_id: invalid ? "not-a-uuid" : ${JSON.stringify(OWNER)}, offset: 12, length: 4, label: "@Ann" }
              ] }, onOpen: (entity, trigger) => proof.profiles.push([entity.user_id, trigger.dataset.memberMention]) }}
              bot={{ commands: [{ command: "help", description: "Help" }],
                addressing: { chatType: "private", botUsername: "helper" }, onRun: (text) => proof.commands.push(text) }} />
          </div>);
        };
        window.mountMentions();
      ` },
  });
  const browser = await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
  try {
    for (const width of [1440, 390]) {
      for (const colorScheme of ["light", "dark"]) {
        const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme, serviceWorkers: "block" });
        try {
          let requests = 0;
          await context.route("**/*", (route: any) => { requests += 1; return route.abort(); });
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error: Error) => errors.push(error.message));
          await page.setContent('<div id="root"></div>');
          await page.addScriptTag({ content: bundle.outputFiles[0].text });
          const member = page.locator('[data-member-mention="11111111-1111-4111-8111-000000000001"]');
          const command = page.locator('[data-bot-command-run="/help"]');
          await member.waitFor();
          assert.equal(await page.locator("#bubble").textContent(), "@raw_handle @Ann @other /help");
          const proof = () => page.evaluate(() => (window as any).mentionProof);
          const inactive = { profiles: [], commands: [], rowClicks: 0, rowPointers: 0 };
          assert.deepEqual(await proof(), inactive);
          await page.keyboard.press("Tab");
          assert.equal(await member.evaluate((node: HTMLElement) => node === document.activeElement), true);
          assert.deepEqual(await proof(), inactive);
          await page.keyboard.press("Tab");
          assert.equal(await command.evaluate((node: HTMLElement) => node === document.activeElement), true);
          await page.keyboard.press("Shift+Tab");
          await member.press("ArrowRight");
          await member.press("Escape");
          await member.dispatchEvent("pointerdown");
          assert.deepEqual(await proof(), inactive);
          await member.press("Enter");
          await member.press("Space");
          await member.click();
          assert.deepEqual(await proof(), { profiles: [
            ["11111111-1111-4111-8111-000000000001", "11111111-1111-4111-8111-000000000001"],
            ["11111111-1111-4111-8111-000000000001", "11111111-1111-4111-8111-000000000001"],
            ["11111111-1111-4111-8111-000000000001", "11111111-1111-4111-8111-000000000001"],
          ], commands: [], rowClicks: 0, rowPointers: 0 });
          await command.click();
          const activated = await proof();
          assert.equal(activated.profiles.length, 3);
          assert.deepEqual(activated.commands, ["/help"]);
          assert.equal(activated.rowClicks, 0);
          assert.equal(activated.rowPointers, 0);
          await page.evaluate(() => (window as any).mountMentions(true));
          await member.waitFor({ state: "detached" });
          assert.equal(await page.getByRole("button").count(), 0);
          await page.keyboard.press("Tab");
          await page.locator("span").filter({ hasText: /^@Ann$/ }).click();
          const refused = await proof();
          assert.deepEqual(refused.profiles, []);
          assert.deepEqual(refused.commands, []);
          assert.equal(requests, 0);
          assert.deepEqual(errors, []);
          console.log(`FOCUS/ACTIVATION ${width}/${colorScheme}: native actions 3, unexpected callbacks 0, requests 0`);
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
});

test("member profile pointer and click handlers stop bubbling before the bubble's gestures", () => {
  const { content, entities } = multilineFixture();
  let opens = 0;
  const shown = render(api, content, entities, () => { opens += 1; });
  let parentGestures = 0;
  for (const button of shown.buttons) {
    for (const handler of ["onPointerDown", "onClick"]) {
      let stopped = false;
      let preventions = 0;
      button.props[handler]({ currentTarget: {}, stopPropagation() { stopped = true; }, preventDefault() { preventions += 1; } });
      if (!stopped) parentGestures += 1;
      assert.equal(stopped, true, handler);
      assert.equal(preventions, handler === "onClick" ? 1 : 0);
    }
  }
  assert.equal(parentGestures, 0);
  assert.equal(opens, 2);
});

test("raw handles and unbound nonmember labels remain text without an identity lookup or action", () => {
  for (const content of ["@raw_handle", "@\u0410\u043d\u043d\u0430", "@unknown"]) {
    for (const members of [null, { entities: { version: 1, revision: null, items: [] },
      onOpen() { assert.fail("raw text cannot open a profile"); } }]) {
      const tree = api.FormattedText({ content, members });
      assert.equal(textContent(tree), content);
      assert.equal(elements(tree, "button").length, 0);
      assert.equal(elements(tree, "a").length, 0);
      assert.doesNotMatch(renderToStaticMarkup(tree), /data-member-mention/);
    }
  }
});

test("render fail-closes invalid envelopes, stale slices and code/URL/email/command identities", () => {
  const item = { kind: "user", user_id: OWNER, offset: 0, length: 6, label: "@ghost" };
  const cases = [
    { content: "@ghost", metadata: { version: 2, revision: REV, items: [item] } },
    { content: "@ghost", metadata: { version: 1, revision: null, items: [item] } },
    { content: "@ghost", metadata: { version: 1, revision: REV, items: [item], extra: true } },
    { content: "@other", metadata: { version: 1, revision: REV, items: [item] } },
    { content: "`@ghost`", metadata: { version: 1, revision: REV, items: [{ ...item, offset: 1 }] } },
    { content: "https://example.invalid/@ghost", metadata: { version: 1, revision: REV, items: [{ ...item, offset: 24 }] } },
    { content: "a@ghost.test", metadata: { version: 1, revision: REV, items: [{ ...item, offset: 1 }] } },
    { content: "/start@ghost", metadata: { version: 1, revision: REV, items: [{ ...item, offset: 6 }] } },
  ];
  for (const { content, metadata } of cases) {
    assert.equal(mentions.parseMessageMentions(content, metadata), null);
    const shown = render(api, content, metadata, () => assert.fail("invalid metadata cannot open a profile"));
    assert.equal(shown.buttons.length, 0);
    assert.doesNotMatch(shown.markup, /data-member-mention/);
  }
});

test("owned v2 draft round-trip preserves human/bot UUIDs, UTF-16 offsets and revision through real render", () => {
  const disk = storage();
  api.writeMentionDraft(disk, OWNER, CHAT, draftFixture());
  assert.deepEqual(disk.calls, [{ kind: "set", key: OWN_KEY }]);
  const restored = api.readMentionDraft(disk, OWNER, CHAT);
  assert.deepEqual(JSON.parse(disk.values.get(OWN_KEY)!), {
    version: 2, owner: "11111111-1111-4111-8111-000000000001", chat: "22222222-2222-4222-8222-000000000001",
    content: "\u{1f600} @\u0410\u043d\u043d\u0430 @Helper", mentionEntities: { version: 1, revision: "33333333-3333-4333-8333-000000000001", items: [
      { kind: "user", user_id: "11111111-1111-4111-8111-000000000001", offset: 3, length: 5, label: "@\u0410\u043d\u043d\u0430" },
      { kind: "bot", bot_id: "44444444-4444-4444-8444-000000000001", offset: 9, length: 7, label: "@Helper" },
    ] },
  });
  assert.equal(restored.mentionEntities.revision, "33333333-3333-4333-8333-000000000001");
  const shown = render(api, restored.content, restored.mentionEntities);
  assert.deepEqual(shown.buttons.map((b) => b.props["data-member-mention"]), [
    "11111111-1111-4111-8111-000000000001", "44444444-4444-4444-8444-000000000001",
  ]);
});

test("a foreign owner inside the current account's v2 key is refused without modifying storage", () => assertOwnerGuard(api));

test("switching accounts does not read a foreign v2 key or migrate/remove the legacy unowned draft", () => {
  const foreign = JSON.stringify({ version: 2, owner: OTHER, chat: CHAT, ...draftFixture() });
  const disk = storage([[OTHER_KEY, foreign], [LEGACY_KEY, "legacy @raw_handle"]]);
  assert.deepEqual(api.readMentionDraft(disk, OWNER, CHAT), EMPTY);
  assert.deepEqual(disk.calls, [{ kind: "get", key: OWN_KEY }]);
  assert.deepEqual([...disk.values], [[OTHER_KEY, foreign], [LEGACY_KEY, "legacy @raw_handle"]]);
  api.writeMentionDraft(disk, OWNER, CHAT, draftFixture());
  api.writeMentionDraft(disk, OWNER, CHAT, mentions.createMentionText(""));
  assert.deepEqual([...disk.values], [[OTHER_KEY, foreign], [LEGACY_KEY, "legacy @raw_handle"]]);
  assert.ok(disk.calls.every((call) => call.key === OWN_KEY));
});

test("malformed JSON, wrong chat/version and non-string content fail closed without deleting drafts", () => {
  const base = { version: 2, owner: OWNER, chat: CHAT, ...draftFixture() };
  for (const raw of ["{", "null", "[]", '"old text"', JSON.stringify({ ...base, version: 1 }),
    JSON.stringify({ ...base, chat: "22222222-2222-4222-8222-000000000002" }),
    JSON.stringify({ ...base, content: 42 })]) {
    const disk = storage([[OWN_KEY, raw]]);
    assert.deepEqual(api.readMentionDraft(disk, OWNER, CHAT), EMPTY);
    assert.equal(disk.values.get(OWN_KEY), raw);
    assert.deepEqual(disk.calls, [{ kind: "get", key: OWN_KEY }]);
  }
  assert.deepEqual(api.readMentionDraft({ getItem() { throw new Error("unavailable storage"); } }, OWNER, CHAT), EMPTY);
});

test("malformed mention metadata preserves owned draft text but cannot recover an identity from its label", () => {
  const content = "@ghost";
  for (const mentionEntities of [undefined, null, { version: 1, revision: REV, items: "bad" },
    { version: 1, revision: REV, items: [{ kind: "user", user_id: "bad", offset: 0, length: 6, label: "@ghost" }] },
    { version: 1, revision: REV, items: [{ kind: "user", user_id: OWNER, offset: 0, length: 6, label: "@other" }] }]) {
    const raw = JSON.stringify({ version: 2, owner: OWNER, chat: CHAT, content, mentionEntities });
    const disk = storage([[OWN_KEY, raw]]);
    const restored = api.readMentionDraft(disk, OWNER, CHAT);
    assert.deepEqual(restored, { content: "@ghost", mentionEntities: { version: 1, revision: null, items: [] } });
    assert.equal(render(api, restored.content, restored.mentionEntities).buttons.length, 0);
    assert.equal(disk.values.get(OWN_KEY), raw);
  }
});

test("empty-owner writes are no-ops and an empty draft removes only the exact owned chat key", () => {
  const anotherChat = "kub:draft:v2:11111111-1111-4111-8111-000000000001:22222222-2222-4222-8222-000000000002";
  const disk = storage([[OWN_KEY, "own"], [OTHER_KEY, "foreign"], [anotherChat, "another chat"], [LEGACY_KEY, "legacy"]]);
  api.writeMentionDraft(disk, "", CHAT, draftFixture());
  api.writeMentionDraft(disk, "", CHAT, mentions.createMentionText(""));
  assert.deepEqual(disk.calls, []);
  api.writeMentionDraft(disk, OWNER, CHAT, mentions.createMentionText(""));
  assert.deepEqual(disk.calls, [{ kind: "remove", key: OWN_KEY }]);
  assert.deepEqual([...disk.values], [[OTHER_KEY, "foreign"], [anotherChat, "another chat"], [LEGACY_KEY, "legacy"]]);
});

test("serialized drafts cannot be changed by later mutations of either the submitted or restored snapshot", () => {
  const disk = storage();
  const submitted = draftFixture();
  api.writeMentionDraft(disk, OWNER, CHAT, submitted);
  const bytes = disk.values.get(OWN_KEY);
  submitted.content = "changed";
  submitted.mentionEntities.items[0].label = "@changed";
  const restored = api.readMentionDraft(disk, OWNER, CHAT);
  restored.mentionEntities.items.splice(0);
  restored.mentionEntities.revision = NEXT_REV;
  const reread = api.readMentionDraft(disk, OWNER, CHAT);
  assert.equal(disk.values.get(OWN_KEY), bytes);
  assert.equal(reread.content, "\u{1f600} @\u0410\u043d\u043d\u0430 @Helper");
  assert.equal(reread.mentionEntities.revision, "33333333-3333-4333-8333-000000000001");
  assert.deepEqual(reread.mentionEntities.items.map((item: any) => [item.offset, item.length, item.label]),
    [[3, 5, "@\u0410\u043d\u043d\u0430"], [9, 7, "@Helper"]]);
});

test("trimmed caption draft restores rebased identities and bold without reusing the old edit revision", () => {
  const source = mentions.createMentionText("\n\u{1f600} **@\u0410\u043d\u043d\u0430** @Helper \n", {
    version: 1, revision: REV, items: [
      { kind: "user", user_id: OWNER, offset: 6, length: 5, label: "@\u0410\u043d\u043d\u0430" },
      { kind: "bot", bot_id: BOT, offset: 14, length: 7, label: "@Helper" },
    ],
  });
  const caption = mentions.trimMentionText(source, NEXT_REV);
  const disk = storage();
  api.writeMentionDraft(disk, OWNER, CHAT, caption);
  const restored = api.readMentionDraft(disk, OWNER, CHAT);
  assert.equal(restored.content, "\u{1f600} **@\u0410\u043d\u043d\u0430** @Helper");
  assert.equal(restored.mentionEntities.revision, "33333333-3333-4333-8333-000000000002");
  assert.deepEqual(restored.mentionEntities.items.map((item: any) => [item.offset, item.length]), [[5, 5], [13, 7]]);
  const shown = render(api, restored.content, restored.mentionEntities);
  assert.equal(elements(elements(shown.tree, "strong")[0], "button").length, 1);
  assert.deepEqual(shown.buttons.map((b) => b.props["data-member-mention"]), [
    "11111111-1111-4111-8111-000000000001", "44444444-4444-4444-8444-000000000001",
  ]);
});

test("caption projection keeps only whole entities and never activates a clipped label after draft restore", () => {
  const source = draftFixture();
  const whole = mentions.sliceMentionText(source, 3, 8);
  const clipped = mentions.sliceMentionText(source, 3, 7);
  const disk = storage();
  api.writeMentionDraft(disk, OWNER, CHAT, whole);
  const restored = api.readMentionDraft(disk, OWNER, CHAT);
  assert.equal(restored.content, "@\u0410\u043d\u043d\u0430");
  assert.deepEqual(restored.mentionEntities.items, [{ kind: "user", user_id: "11111111-1111-4111-8111-000000000001",
    offset: 0, length: 5, label: "@\u0410\u043d\u043d\u0430" }]);
  assert.equal(restored.mentionEntities.revision, "33333333-3333-4333-8333-000000000001");
  api.writeMentionDraft(disk, OWNER, CHAT, clipped);
  const restoredClip = api.readMentionDraft(disk, OWNER, CHAT);
  assert.equal(restoredClip.content, "@\u0410\u043d\u043d");
  assert.deepEqual(restoredClip.mentionEntities.items, []);
  assert.equal(render(api, restoredClip.content, restoredClip.mentionEntities).buttons.length, 0);
  assert.throws(() => mentions.sliceMentionText(source, 1, 8), RangeError);
});

test("held and typed captions retain separate same-label UUIDs through concat, owned persistence and render", () => {
  const typed = mentions.createMentionText("next @\u0410\u043d\u043d\u0430", { version: 1, revision: NEXT_REV,
    items: [{ kind: "user", user_id: OTHER, offset: 5, length: 5, label: "@\u0410\u043d\u043d\u0430" }] });
  const joined = mentions.concatMentionText(draftFixture(), typed, JOIN_REV);
  const disk = storage();
  api.writeMentionDraft(disk, OWNER, CHAT, joined);
  const restored = api.readMentionDraft(disk, OWNER, CHAT);
  assert.equal(restored.content, "\u{1f600} @\u0410\u043d\u043d\u0430 @Helper next @\u0410\u043d\u043d\u0430");
  assert.equal(restored.mentionEntities.revision, "33333333-3333-4333-8333-000000000003");
  assert.deepEqual(restored.mentionEntities.items.map((item: any) => item.offset), [3, 9, 22]);
  assert.deepEqual(render(api, restored.content, restored.mentionEntities).buttons.map((b) => b.props["data-member-mention"]), [
    "11111111-1111-4111-8111-000000000001", "44444444-4444-4444-8444-000000000001", "11111111-1111-4111-8111-000000000002",
  ]);
});

test("isolated runtime omission mutants are killed by the same behavioral assertions", async (t) => {
  const cases: [string, Omission, (api: Runtime) => void][] = [
    ["newline offset", { file: "formatText.tsx", before: "offset += line.length + 1;", after: "" }, assertOffsets],
    ["token cursor offset", { file: "formatText.tsx", before: "members, offset + cursor)", after: "members, offset)" }, assertOffsets],
    ["bold child offset", { file: "formatText.tsx", before: "tokenize(t.value, bot, members, t.valueOffset)", after: "tokenize(t.value, bot, members)" }, assertOffsets],
    ["UUID profile action", { file: "formatText.tsx", before: "members?.onOpen(t.entity, event.currentTarget);", after: "" }, assertUuidAction],
    ["render metadata validation", { file: "formatText.tsx", before: "readMentionEntities(content, members.entities)", after: "members.entities" }, assertInvalidPlain],
    ["draft owner guard", { file: "memberMentionDrafts.ts", before: "raw.owner !== owner || ", after: "" }, assertOwnerGuard],
    ["raw duplicate whitespace", { file: "formatText.tsx", before: ">@{t.user}</span>", after: ">{\" \"}@{t.user}</span>" }, assertWhitespace],
  ];
  for (const [name, omission, check] of cases) {
    await t.test(name, () => {
      const baseline = runtime();
      check(baseline);
      const mutant = runtime(omission);
      assert.throws(() => check(mutant), { name: "AssertionError", code: "ERR_ASSERTION" }, `${name} survived`);
      check(baseline);
      console.log(`KILLED render/draft omission: ${name}`);
    });
  }
});
