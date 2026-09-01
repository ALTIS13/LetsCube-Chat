import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyResolvedTheme,
  THEME_INIT_SCRIPT,
  THEME_LEGACY_KEY,
  THEME_STORAGE_KEY,
  THEME_SURFACE_COLORS,
} from "../../artifacts/kub/src/lib/themeRuntime.ts";

const rootPath = fileURLToPath(new URL("../../", import.meta.url));
const read = (relative) => readFileSync(path.join(rootPath, relative), "utf8");

const html = read("artifacts/kub/index.html");
const css = read("artifacts/kub/src/index.css");

/**
 * The theme is applied twice: once by an inline script in `index.html` before
 * the first paint, and once by `applyResolvedTheme` on every change afterwards.
 * They are separate copies because a static HTML file cannot import from
 * TypeScript.
 *
 * Both halves are covered here. Comparing the inline script only to
 * `THEME_INIT_SCRIPT` would prove nothing about the code that actually runs
 * after load, so `applyResolvedTheme` is exercised against a stub document.
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

function themeValue(selector, property) {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `missing rule: ${selector}`);
  const end = css.indexOf("\n}", start);
  const match = new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(css.slice(start, end));
  assert.ok(match, `${selector} does not define ${property}`);
  return match[1].trim();
}

/** The smallest document the theme code touches. */
function stubDocument() {
  const classes = new Set();
  const attributes = new Map();
  const meta = { content: null };

  return {
    documentElement: {
      classList: {
        toggle(name, on) {
          if (on) classes.add(name);
          else classes.delete(name);
        },
        has: (name) => classes.has(name),
      },
      setAttribute: (name, value) => attributes.set(name, value),
      style: {},
    },
    querySelector: (selector) => (selector.includes("theme-color")
      ? { setAttribute: (_name, value) => { meta.content = value; } }
      : null),
    inspect: () => ({ classes, attributes, meta }),
  };
}

test("the pre-paint bootstrap matches the script it is a copy of", () => {
  assert.equal(
    normalize(inlineBootstrap()),
    normalize(THEME_INIT_SCRIPT.replace(/^\(function\(\)\{/, "(function(){")),
    "index.html and THEME_INIT_SCRIPT have drifted; a visitor would see one theme flash into another",
  );
});

test("the inline bootstrap reads the storage keys the application writes", () => {
  // The script interpolates these, so a rename cannot silently leave the
  // bootstrap reading a key nothing writes — but index.html carries literals,
  // so the copy has to be checked against the constants directly.
  const inline = inlineBootstrap();
  assert.ok(inline.includes(`"${THEME_STORAGE_KEY}"`), "the inline bootstrap reads a different storage key");
  assert.ok(inline.includes(`"${THEME_LEGACY_KEY}"`), "the inline bootstrap reads a different legacy key");
});

for (const resolved of ["dark", "light"]) {
  test(`applying the ${resolved} theme sets everything the bootstrap sets`, () => {
    const doc = stubDocument();
    applyResolvedTheme(resolved, doc);
    const { classes, attributes, meta } = doc.inspect();

    assert.ok(classes.has(resolved), `the ${resolved} class was not applied`);
    assert.ok(!classes.has(resolved === "dark" ? "light" : "dark"), "the other theme class was left behind");
    assert.equal(attributes.get("data-theme"), resolved, "data-theme was not applied");
    assert.equal(
      doc.documentElement.style.colorScheme,
      resolved,
      "color-scheme was not applied, so the user agent keeps drawing its own controls from the wrong palette",
    );
    assert.equal(meta.content, THEME_SURFACE_COLORS[resolved], "the theme-color meta was not updated");
  });
}

test("switching themes clears the previous one", () => {
  const doc = stubDocument();
  applyResolvedTheme("dark", doc);
  applyResolvedTheme("light", doc);
  const { classes } = doc.inspect();

  assert.ok(classes.has("light"));
  assert.ok(!classes.has("dark"), "the dark class survived a switch to light");
});

test("the bootstrap surface colours are the stylesheet's own background", () => {
  for (const theme of ["dark", "light"]) {
    assert.equal(
      THEME_SURFACE_COLORS[theme].toLowerCase(),
      themeValue(`.${theme}`, "--kub-bg").toLowerCase(),
      `${theme} bootstrap colour differs from --kub-bg`,
    );
    assert.ok(
      THEME_INIT_SCRIPT.includes(THEME_SURFACE_COLORS[theme]),
      `${theme} bootstrap colour is not the one the inline script writes`,
    );
  }
});

test("the static theme-color meta is the dark surface the bootstrap starts from", () => {
  const meta = /<meta name="theme-color" content="([^"]+)"/.exec(html);
  assert.ok(meta, "the theme-color meta is gone, so the bootstrap has nothing to update");
  assert.equal(meta[1].toLowerCase(), THEME_SURFACE_COLORS.dark.toLowerCase());
});
