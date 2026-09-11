import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CHAT_CHROME_OPTIONS,
  chatChromeFlags,
  resolveChatChromeOption,
  unreadBadgeLabel,
  unreadElsewhere,
} from "../../artifacts/kub/src/lib/chatChromeOptions.ts";

/**
 * The phone chat screen's design options are renders for the owner, not the
 * product. Two things have to hold while they live in the code: nothing but a
 * development build can show one, and the one import of their stylesheet stays
 * behind that gate, so no production bundle carries a rule of it.
 */

test("an option applies in a development build, and only there", () => {
  for (const option of CHAT_CHROME_OPTIONS) {
    assert.equal(resolveChatChromeOption({ DEV: true }, option), option);
    // A production bundle inlines `false`, an unset flag arrives as undefined,
    // and a shell can only ever supply strings. None of them is consent.
    for (const DEV of [false, undefined, "true", 1]) {
      assert.equal(resolveChatChromeOption({ DEV }, option), "current", `DEV=${String(DEV)} showed ${option}`);
    }
  }
});

test("a value this build does not know is the current look", () => {
  for (const stored of [null, "", "Capsules", " capsules", "capsules ", "glass", 1, true, {}]) {
    assert.equal(resolveChatChromeOption({ DEV: true }, stored), "current", `${JSON.stringify(stored)} was accepted`);
  }
});

test("each option switches exactly its own half", () => {
  assert.deepEqual(chatChromeFlags("current"), { capsules: false, depth: false });
  assert.deepEqual(chatChromeFlags("capsules"), { capsules: true, depth: false });
  assert.deepEqual(chatChromeFlags("depth"), { capsules: false, depth: true });
  assert.deepEqual(chatChromeFlags("capsules-depth"), { capsules: true, depth: true });
});

test("the back button counts what waits in every other chat", () => {
  const chats = [
    { id: "open", unread_count: 5 },
    { id: "a", unread_count: 12 },
    { id: "b", unread_count: 0 },
    { id: "c", unread_count: null },
    { id: "d", unread_count: 7 },
    { id: "e", unread_count: -3 },
  ];
  assert.equal(unreadElsewhere(chats, "open"), 19, "the open chat, a missing count or a negative one was added in");
  assert.equal(unreadBadgeLabel(0), null);
  assert.equal(unreadBadgeLabel(19), "19");
  assert.equal(unreadBadgeLabel(999), "999");
  assert.equal(unreadBadgeLabel(1000), "999+");
});

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx|css)$/.test(entry)) found.push(full);
  }
  return found;
}

test("the options' stylesheet has one importer, and the import sits behind the development gate", () => {
  const importers = sourceFiles("artifacts/kub/src")
    .filter((file) => readFileSync(file, "utf8").includes("chatChromeOptions.css"))
    .map((file) => file.split(path.sep).join("/"));
  assert.deepEqual(importers, ["artifacts/kub/src/hooks/useChatChromeOptions.ts"]);

  const source = readFileSync("artifacts/kub/src/hooks/useChatChromeOptions.ts", "utf8");
  const load = source.indexOf('import("@/styles/chatChromeOptions.css")');
  assert.ok(load > 0, "the stylesheet is no longer loaded by a dynamic import");
  const gate = source.lastIndexOf("if (import.meta.env.DEV", load);
  assert.ok(gate >= 0, "the stylesheet import is not inside an import.meta.env.DEV branch");
  assert.equal(
    source.slice(gate, load).includes("}"),
    false,
    "the development branch closes before the stylesheet import, so a production build keeps it",
  );
});
