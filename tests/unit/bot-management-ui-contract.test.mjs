import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("artifacts/kub/src/index.css", "utf8");
const button = readFileSync("artifacts/kub/src/components/kub/KubButton.tsx", "utf8");
const createModal = readFileSync("artifacts/kub/src/components/bots/BotCreateModal.tsx", "utf8");
const settings = readFileSync("artifacts/kub/src/components/bots/BotSettingsPanel.tsx", "utf8");
const tokenDialog = readFileSync("artifacts/kub/src/components/bots/BotTokenDialog.tsx", "utf8");
const page = readFileSync("artifacts/kub/src/pages/bots/BotsPage.tsx", "utf8");

test("light bot-management primary actions use a scoped WCAG AA color pair", () => {
  const scoped = css.match(/\.light\s+\.bots-management-surface\s*\{([^}]+)\}/)?.[1] ?? "";
  const background = scoped.match(/--kub-action-primary-background:\s*(#[0-9a-f]{6})/i)?.[1];
  const foreground = scoped.match(/--kub-action-primary-foreground:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(background && foreground, "scoped semantic action colors must be explicit hex values");
  assert.ok(contrast(background, foreground) >= 4.5, "normal action text must meet WCAG AA");
  assert.match(button, /--kub-action-primary-background/);
  assert.match(button, /--kub-action-primary-foreground/);
  for (const surface of [page, createModal, settings, tokenDialog]) {
    assert.match(surface, /bots-management-surface/);
  }
});

test("create errors are field-specific and use stable descriptions", () => {
  for (const field of ["display-name", "username", "description"]) {
    assert.match(createModal, new RegExp(`bot-create-${field}-error`));
  }
  assert.match(createModal, /aria-describedby/);
  assert.match(createModal, /fieldErrors\.displayName/);
  assert.match(createModal, /fieldErrors\.username/);
  assert.match(createModal, /fieldErrors\.description/);
  assert.doesNotMatch(createModal, /aria-invalid=\{Boolean\(error\)\}/);
});

test("null delivery mode is rendered as unconfigured", () => {
  assert.match(settings, /delivery_mode === null\s*\?\s*"Не настроен"/);
});

function contrast(left, right) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [bright, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}
