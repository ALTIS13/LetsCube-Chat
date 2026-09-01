import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootPath = fileURLToPath(new URL("../../", import.meta.url));
const read = (relative) => readFileSync(path.join(rootPath, relative), "utf8");

const html = read("artifacts/kub/index.html");
const hook = read("artifacts/kub/src/hooks/useTheme.ts");
const css = read("artifacts/kub/src/index.css");

/**
 * The theme is applied twice: once by an inline script before the first paint,
 * and once by the React store afterwards. They are separate copies because a
 * static HTML file cannot import from TypeScript, so the risk is that one is
 * changed and the other is not — which shows up as a flash of the wrong theme
 * that nobody notices in review.
 */

function normalize(source) {
  return source
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, "");
}

function inlineBootstrap() {
  const marker = "// Pre-hydration theme apply";
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, "index.html no longer marks its pre-hydration theme script");
  const open = html.indexOf("(function(){", start);
  const close = html.indexOf("</script>", open);
  assert.ok(open !== -1 && close !== -1, "could not delimit the inline bootstrap");
  return html.slice(open, close);
}

function hookBootstrap() {
  const start = hook.indexOf("export const THEME_INIT_SCRIPT = `");
  assert.notEqual(start, -1, "THEME_INIT_SCRIPT is gone");
  const open = hook.indexOf("`", start) + 1;
  const close = hook.indexOf("`", open);
  return hook.slice(open, close);
}

/** The value of a custom property inside a theme rule. */
function themeValue(selector, property) {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `missing rule: ${selector}`);
  const end = css.indexOf("\n}", start);
  const body = css.slice(start, end);
  const match = new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(body);
  assert.ok(match, `${selector} does not define ${property}`);
  return match[1].trim();
}

test("the pre-paint theme bootstrap matches the runtime one", () => {
  assert.equal(
    normalize(inlineBootstrap()),
    normalize(hookBootstrap()),
    "index.html and THEME_INIT_SCRIPT have drifted; a visitor would see one theme flash into another",
  );
});

test("the bootstrap sets the class, the data attribute, the colour scheme and the theme colour", () => {
  const script = normalize(hookBootstrap());

  for (const expectation of [
    'classList.add(resolved)',
    'setAttribute("data-theme",resolved)',
    "style.colorScheme=resolved",
    'meta[name="theme-color"]',
  ]) {
    assert.ok(script.includes(normalize(expectation)), `the bootstrap no longer applies ${expectation}`);
  }
});

test("the bootstrap surface colours are the stylesheet's own background", () => {
  const declared = /THEME_SURFACE_COLORS[^=]*=\s*\{([^}]+)\}/.exec(hook);
  assert.ok(declared, "THEME_SURFACE_COLORS is gone");

  const colours = Object.fromEntries(
    [...declared[1].matchAll(/(dark|light)\s*:\s*"([^"]+)"/g)].map((match) => [match[1], match[2]]),
  );

  // A literal is unavoidable because the bootstrap runs before any stylesheet,
  // but it must not be allowed to drift from the palette it stands in for.
  for (const theme of ["dark", "light"]) {
    assert.equal(
      colours[theme]?.toLowerCase(),
      themeValue(`.${theme}`, "--kub-bg").toLowerCase(),
      `${theme} bootstrap colour differs from --kub-bg`,
    );
    assert.ok(
      hookBootstrap().includes(colours[theme]),
      `${theme} bootstrap colour is not the one the inline script writes`,
    );
  }
});

test("the static theme-color meta is the dark surface the bootstrap starts from", () => {
  const meta = /<meta name="theme-color" content="([^"]+)"/.exec(html);
  assert.ok(meta, "the theme-color meta is gone, so the bootstrap has nothing to update");

  const dark = /dark\s*:\s*"([^"]+)"/.exec(hook);
  assert.equal(meta[1].toLowerCase(), dark[1].toLowerCase());
});
