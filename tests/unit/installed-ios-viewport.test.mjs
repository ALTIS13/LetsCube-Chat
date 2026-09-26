import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * D-111: the installed iPhone app's shell and keyboard, the source half.
 *
 * On a tester's iPhone 15 Pro Max the installed app left a band of about 60pt
 * under the composer from its first frame. The 100dvh fallback is replaced
 * by the paintable innerHeight at boot and at rest; visualViewport takes over
 * only while the keyboard is visible. The layout and keyboard
 * behaviour is covered by `tests/e2e/installed-ios-viewport.spec.ts` rather
 * than source-text checks; only a real device can reproduce iOS itself.
 */

const read = (relative) => readFileSync(new URL(`../../artifacts/kub/src/${relative}`, import.meta.url), "utf8");
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

test("the shell and independent paintable-height tokens start at 100dvh without a standalone 100vh override", () => {
  const css = withoutComments(read("index.css"));
  assert.ok(
    /--kub-safe-left:\s*env\(safe-area-inset-left, 0px\);\s*--kub-paintable-height:\s*100dvh;\s*--kub-app-height:\s*100dvh;/.test(css),
    "the root viewport and shell tokens must both fall back to 100dvh beside the safe-area tokens",
  );
  assert.doesNotMatch(
    css,
    /html\[data-ios-standalone\]\s*\{[^}]*--kub-app-height:\s*100vh;/,
    "100vh can extend below the iOS Home Screen paintable viewport",
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
