import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Nothing that is not about a message may render the messages: the source half.
 *
 * The behaviour is measured in `tests/e2e/message-render-stability.spec.ts` — React
 * commits counted while typing and while the store changes — and that is the
 * proof. It needs the DEV preview fixture server, so it does not run in the
 * default gate. These scans do, and they are weaker than they look: they say
 * the mechanism is still written the way that measured correctly.
 */

// Comments describe the very constructs forbidden below, so they are stripped
// first — a sentence about an inline arrow must not trip a scan for one.
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (path) => strip(readFileSync(new URL(`../../artifacts/kub/src/${path}`, import.meta.url), "utf8"));

const list = read("components/chat/MessageList.tsx");
const bubble = read("components/chat/MessageBubble.tsx");

test("a bubble does not subscribe to the whole store", () => {
  assert.doesNotMatch(
    bubble,
    /useAppStore\(\s*\)/,
    "a selector-less store read re-renders every message on any store change, past any memo",
  );
});

test("rows and bubbles render through memo boundaries", () => {
  assert.match(list, /const MessageRow = React\.memo\(function MessageRow\(/, "the row is no longer memoised");
  assert.match(list, /const MemoizedMessageBubble = React\.memo\(MessageBubble\);/, "the bubble is no longer memoised");
  assert.doesNotMatch(list, /<MessageBubble\s/, "the list renders the unmemoised bubble again");
});

test("nothing handed to a row or a bubble is created while rendering it", () => {
  // An arrow or an object literal in these props is new on every render of the
  // list, so the memo never matches and every bubble renders again.
  for (const [name, pattern] of [
    ["MessageRow", /<MessageRow\s([\s\S]*?)\/>/],
    ["MemoizedMessageBubble", /<MemoizedMessageBubble\s([\s\S]*?)\/>/],
  ]) {
    const element = list.match(pattern);
    assert.ok(element, `<${name}> could not be found`);
    assert.doesNotMatch(element[1], /=>/, `an inline arrow is passed to <${name}>`);
    assert.doesNotMatch(element[1], /=\{\{/, `an inline object is passed to <${name}>`);
    assert.doesNotMatch(
      element[1],
      /getMessageDeliveryState|getGroupReadReceiptInfo/,
      `<${name}> is handed a receipt built during the render, which is a new object every time`,
    );
  }
});

test("the row actions are created once for the life of the list", () => {
  assert.match(
    list,
    /const rowActions = React\.useMemo<MessageRowActions>\(\(\) => \(\{[\s\S]*?\}\), \[toggleSelected\]\);/,
    "the row actions depend on something that changes, so every row renders when it does",
  );
  assert.match(list, /actions=\{rowActions\}/, "the rows are not given the stable actions");
  assert.match(list, /capabilities=\{rowCapabilities\}/, "the rows are not given the stable capabilities");
});
