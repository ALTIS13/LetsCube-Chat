import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { hasRule, parseRules, ruleBody } from "./helpers/css.mjs";
import {
  CAPSULE_CONTROL_GLASS,
  CAPSULE_GLASS,
  unreadBadgeLabel,
  unreadElsewhere,
} from "../../artifacts/kub/src/lib/chatChrome.ts";

/**
 * The chat screen as the owner chose it on 2026-09-11 — option C, «Капсулы и
 * цвет» — on every shell.
 *
 * Pinned here is what a screenshot shows only once it has gone wrong: the
 * wallpaper's tile meeting its neighbour in a seam, the tile scaled by a
 * background size that is not its own, a capsule's hover going silent because
 * its button stopped being the group the glass steps with, the scroll edge
 * taking a tap meant for the chrome, and the retired DEV switch coming back.
 */

const CSS = readFileSync("artifacts/kub/src/index.css", "utf8");

function themeToken(theme: "dark" | "light", name: string): string {
  const block = CSS.match(new RegExp(`\\n\\.${theme}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  assert.ok(block, `the ${theme} theme block could not be found`);
  const value = block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
  assert.ok(value, `--${name} is not declared in the ${theme} theme`);
  return value.trim();
}

/** The pattern tile, decoded from the data URI the theme declares. */
function tileSvg(theme: "dark" | "light"): string {
  const inner = themeToken(theme, "kub-chat-pattern").match(/^url\("data:image\/svg\+xml,(.*)"\)$/)?.[1];
  assert.ok(inner, `--kub-chat-pattern in the ${theme} theme is not an inline SVG`);
  return decodeURIComponent(inner);
}

const tileSize = (svg: string) => Number(svg.match(/^<svg [^>]*\bwidth='(\d+)'/)?.[1]);

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx|css)$/.test(entry)) found.push(full);
  }
  return found;
}

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

for (const theme of ["dark", "light"] as const) {
  test(`the wallpaper's tile repeats without a seam in the ${theme} theme`, async () => {
    const svg = tileSvg(theme);
    const size = tileSize(svg);
    assert.ok(size > 0, "the tile declares no width");
    assert.match(svg, new RegExp(`^<svg [^>]*\\bheight='${size}'`), "the tile is not square");
    assert.match(svg, new RegExp(`viewBox='0 0 ${size} ${size}'`), "the tile's viewBox is not its own size");

    // Drawn opaque on nothing, so every pixel a stroke reaches counts. A shape
    // that reaches the edge is cut there, and the next tile does not carry the
    // rest of it: that is a seam repeated across the whole conversation.
    const ink = svg.replace(/\bstroke='[^']*'/, "stroke='#000'").replace(/\bstroke-opacity='[^']*'/, "stroke-opacity='1'");
    const { data, info } = await sharp(Buffer.from(ink)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, size, "the tile rasterised at a size other than its own");
    const margin = 2;
    let drawn = 0;
    let atEdge = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
        drawn += 1;
        if (x < margin || y < margin || x >= info.width - margin || y >= info.height - margin) atEdge += 1;
      }
    }
    assert.ok(drawn > 1000, `the tile drew ${drawn} pixels, so an empty edge proves nothing`);
    assert.equal(atEdge, 0, `${atEdge} pixels of stroke reach the tile's outer ${margin}px, where the next tile cuts them`);
  });
}

test("both themes draw one tile, stroked quietly in one colour", () => {
  const shape = (svg: string) => svg.replace(/\bstroke='[^']*'/, "").replace(/\bstroke-opacity='[^']*'/, "");
  assert.equal(shape(tileSvg("dark")), shape(tileSvg("light")), "the two themes draw different patterns");
  for (const theme of ["dark", "light"] as const) {
    const svg = tileSvg(theme);
    assert.match(svg, /^<svg [^>]*\bfill='none'/, `${theme}: the tile fills its shapes`);
    assert.equal((svg.match(/\bstroke='/g) ?? []).length, 1, `${theme}: a motif carries a colour of its own`);
    assert.doesNotMatch(svg, /\bfill='(?!none')/, `${theme}: a motif is filled`);
    const opacity = Number(svg.match(/\bstroke-opacity='([\d.]+)'/)?.[1]);
    // Every word over the wallpaper was photographed against strokes at this
    // strength; the lightest of them, a sender's name in the light theme, has
    // little room above 4.5:1.
    assert.ok(opacity > 0 && opacity <= 0.12, `${theme}: the pattern's strokes are at ${opacity}, louder than the text over them was measured against`);
  }
});

test("the conversation paints the tile at its own size, and no theme paints over it", () => {
  const body = ruleBody(CSS, ".chat-bg");
  const size = tileSize(tileSvg("dark"));
  assert.match(body, /background-color:\s*var\(--kub-chat-ground\)/);
  assert.match(body, /background-image:\s*var\(--kub-chat-wallpaper\)/);
  assert.match(
    body,
    new RegExp(`background-size:\\s*${size}px ${size}px,`),
    "the tile is painted at a size other than its own, which scales every stroke and the contrast measured over them",
  );
  for (const theme of ["dark", "light"] as const) {
    assert.match(themeToken(theme, "kub-chat-wallpaper"), /^var\(--kub-chat-pattern\),/, `${theme}: the pattern is no longer the wallpaper's first layer, which the size above is for`);
  }
  assert.equal(hasRule(CSS, ".dark .chat-bg") || hasRule(CSS, ".light .chat-bg"), false, "a theme paints over the wallpaper again");
});

test("a capsule that is itself a control steps its glass, and its button is the group that makes it step", () => {
  assert.ok(CAPSULE_CONTROL_GLASS.startsWith(CAPSULE_GLASS), "a control capsule lost the rim every capsule keeps");
  assert.match(CAPSULE_CONTROL_GLASS, /group-hover\/capsule:bg-\[image:linear-gradient\(var\(--kub-raise-veil\)/);
  assert.match(CAPSULE_CONTROL_GLASS, /group-active\/capsule:bg-\[image:linear-gradient\(var\(--kub-sink-veil\)/);

  // The variants name their group, so a button that stops carrying
  // `group/capsule` leaves its glass layer's hover and press matching nothing —
  // no error, no warning, just a control that no longer answers.
  for (const file of ["artifacts/kub/src/components/chat/ChatHeader.tsx", "artifacts/kub/src/components/chat/MessageInput.tsx"]) {
    const source = readFileSync(file, "utf8");
    const layers = [...source.matchAll(/<KubGlassLayer className=\{CAPSULE_CONTROL_GLASS\} \/>/g)];
    assert.ok(layers.length > 0, `${file} has no control capsule left to check`);
    for (const layer of layers) {
      const before = source.slice(0, layer.index);
      const button = before.slice(before.lastIndexOf("<button"));
      assert.match(button, /\bgroup\/capsule\b/, `${file}: a control capsule's button is not the group its glass steps with`);
    }
  }
});

test("the scroll edge is painted from the two boxes the conversation measures, and takes no pointer", () => {
  for (const selector of [".kub-chat-chrome-stack::before", ".kub-chat-composer-dock::before"]) {
    const rules = parseRules(CSS).filter((rule) => rule.selectors.includes(selector));
    assert.ok(rules.length > 0, `${selector} is gone`);
    const text = rules.map((rule) => rule.body).join("\n");
    assert.ok(rules.every((rule) => rule.layer === "components"), `${selector} left @layer components`);
    // A tap through the edge reaches the chrome or the message under it.
    assert.match(text, /pointer-events:\s*none/, `${selector} takes the pointer`);
    // Both spellings: Safari before 18 frosts only through the prefixed one.
    assert.match(text, /-webkit-backdrop-filter:\s*var\(--kub-chat-edge-blur\)/);
    assert.match(text, /(?:^|[^-])backdrop-filter:\s*var\(--kub-chat-edge-blur\)/);
    // Rule 12: tree order paints the chrome over its own edge. A z-index would
    // make a stacking context and clamp the fixed menus inside the chrome.
    assert.doesNotMatch(text, /z-index/, `${selector} takes a z-index`);
  }
  for (const file of [
    "artifacts/kub/src/components/chat/ChatWindow.tsx",
    "artifacts/kub/src/pages/public/PublicPreviewCapturePage.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /className="kub-chat-chrome-stack absolute inset-x-0 top-0[^"]*"\s*data-testid="chat-chrome-stack"/, `${file}: the chrome stack no longer paints its edge`);
    assert.match(source, /data-testid="chat-composer-dock"[\s\S]{0,900}?className="kub-chat-composer-dock\b|className="kub-chat-composer-dock\b[\s\S]{0,900}?data-testid="chat-composer-dock"/, `${file}: the composer dock no longer paints its edge`);
  }
});

test("the chat pane, and the empty pane in its place, read the chat screen's words", () => {
  for (const [file, landmark] of [
    ["artifacts/kub/src/components/chat/ChatWindow.tsx", /className="kub-chat-screen relative flex h-full w-full min-w-0 overflow-hidden"/],
    ["artifacts/kub/src/pages/public/PublicPreviewCapturePage.tsx", /className="kub-chat-screen flex h-full flex-1 overflow-hidden"/],
    ["artifacts/kub/src/components/chat/WelcomeScreen.tsx", /className="kub-chat-screen [^"]*\bchat-bg\b/],
  ] as const) {
    assert.match(readFileSync(file, "utf8"), landmark, `${file} no longer carries the chat screen's tokens`);
  }
});

test("nothing of the retired DEV switch is left in the application", () => {
  const offenders = sourceFiles("artifacts/kub/src")
    .filter((file) => /kub-dev-chat-chrome|data-kub-chat-|chatChromeOptions|useChatChromeOptions|--chat-option-/.test(readFileSync(file, "utf8")))
    .map((file) => file.split(path.sep).join("/"));
  assert.deepEqual(offenders, [], "the options the owner chose between are back in the product");
});
