import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messageList = readFileSync(
  new URL("../../artifacts/kub/src/components/chat/MessageList.tsx", import.meta.url),
  "utf8",
);

test("older history restoration uses a rendered message anchor instead of a one-frame height delta", () => {
  assert.match(messageList, /captureVisibleMessageAnchor/);
  assert.match(messageList, /restoreVisibleMessageAnchor/);
  assert.match(messageList, /useLayoutEffect/);
  assert.doesNotMatch(
    messageList,
    /current\.scrollTop\s*=\s*beforeTop\s*\+\s*\(current\.scrollHeight\s*-\s*beforeHeight\)/,
  );
});

test("older history loading stays single-flight until the rendered anchor is restored", () => {
  assert.match(messageList, /preservingOlderScrollRef\.current/);
  assert.match(
    messageList,
    /if\s*\([\s\S]*preservingOlderScrollRef\.current[\s\S]*\)\s*return;/,
  );
});
