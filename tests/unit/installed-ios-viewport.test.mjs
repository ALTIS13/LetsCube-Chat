import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * D-111: the installed iPhone app's shell and keyboard, the source half.
 *
 * On a tester's iPhone 15 Pro Max the installed app left a band of about 60pt
 * under the composer from its first frame, and it stayed after the app was opened
 * again: iOS hands `100dvh` over short there, while `100vh` is right. With the
 * keyboard up the chat header went off the top of the screen. The frame-level
 * half is `tests/e2e/installed-ios-viewport.spec.ts`. Neither reproduces iOS
 * itself, which only a device can; both hold the mechanism in place.
 */

const read = (relative) => readFileSync(new URL(`../../artifacts/kub/src/${relative}`, import.meta.url), "utf8");
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

test("the shell's height is one token: 100dvh, and 100vh in the installed iPhone app", () => {
  const css = withoutComments(read("index.css"));
  assert.match(
    css,
    /--kub-safe-left:\s*env\(safe-area-inset-left, 0px\);\s*--kub-app-height:\s*100dvh;/,
    "the shell height token is gone from beside the safe-area tokens, or is no longer 100dvh",
  );
  assert.match(
    css,
    /html\[data-ios-standalone\]\s*\{\s*--kub-app-height:\s*100vh;\s*\}/,
    "the installed iPhone app no longer switches the shell to 100vh",
  );
  assert.match(css, /@utility h-app\s*\{\s*height:\s*var\(--kub-app-height\);\s*\}/, "h-app no longer reads the token");
  assert.match(
    css,
    /\.kub-auth-shell\s*\{[^}]*height:\s*var\(--kub-app-height\);/,
    "the sign-in shell sizes itself with 100dvh again",
  );
});

test("every in-app shell takes its height from the token", () => {
  for (const [file, shells] of [
    ["components/layout/MainLayout.tsx", 1],
    ["pages/tasks/TasksPage.tsx", 3],
    ["pages/bots/BotsPage.tsx", 1],
    ["pages/public/PublicPreviewCapturePage.tsx", 1],
  ]) {
    const source = withoutComments(read(file));
    const found = (source.match(/\bh-app\b/g) ?? []).length;
    assert.equal(found, shells, `${file} has ${found} shells on h-app, expected ${shells}`);
    assert.doesNotMatch(
      source,
      /h-\[100dvh\]/,
      `${file} sizes a shell with 100dvh again, which iOS gives short in the installed app`,
    );
  }
});

test("with the keyboard up the installed iPhone app fits its shell to what is visible, and gives the height back", () => {
  const source = withoutComments(read("components/chat/ChatWindow.tsx"));
  assert.match(
    source,
    /hasAttribute\("data-ios-standalone"\)/,
    "the keyboard handling no longer tells the installed iPhone app apart",
  );
  assert.match(
    source,
    /setProperty\("--kub-app-height", `\$\{Math\.round\(visualViewport\.height\)\}px`\)/,
    "the shell is no longer fitted to the visible height while the keyboard is up",
  );
  assert.match(source, /removeProperty\("--kub-app-height"\)/, "the shell's height is never given back");
  assert.match(
    source,
    /"--kub-safe-bottom": "0px"/,
    "the composer pads for the home indicator under the keys again",
  );
});
