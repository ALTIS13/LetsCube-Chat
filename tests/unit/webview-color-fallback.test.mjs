import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ruleBody } from "./helpers/css.mjs";

const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");
const banner = readFileSync(new URL("../../artifacts/kub/src/components/PwaRuntime.tsx", import.meta.url), "utf8");

test("auth surfaces keep translucent colors on WebViews without color-mix", () => {
  for (const selector of [".kub-grid-bg", ".kub-panel", ".kub-auth-shell::after"]) {
    const body = ruleBody(css, selector);
    assert.match(body, /rgb\(var\(--kub-(?:cyan|pink)-rgb\) \/ 0\./, `${selector} lost its alpha channel`);
    assert.doesNotMatch(body, /color-mix\(/, `${selector} has an opaque old-WebView fallback`);
  }
});

test("connection banner never uses an opaque color-mix fallback", () => {
  for (const state of ["offline", "online"]) {
    const selector = `.kub-connection-status-${state}`;
    const body = ruleBody(css, selector);
    assert.match(body, /background: linear-gradient\(rgb\(var\(--kub-(?:danger|cyan)-rgb\) \/ 0\.16\)/);
    assert.doesNotMatch(body, /color-mix\(/);
    assert.match(banner, new RegExp(`kub-connection-status-${state}`));
  }
});

test("chat accent overrides its RGB channel token with the visible accent", () => {
  assert.match(ruleBody(css, ".kub-chat-screen"), /--kub-cyan-rgb: var\(--kub-chat-accent-rgb\)/);
  assert.match(ruleBody(css, ".kub-message-own"), /--kub-cyan-rgb: 255 255 255/);
});
