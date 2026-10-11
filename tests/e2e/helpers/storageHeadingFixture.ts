import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Page } from "@playwright/test";
import ts from "typescript";
import { storageHeadingMarker } from "./storageHeadingMarker.cjs";

const root = path.resolve(__dirname, "../../..");
const src = path.join(root, "artifacts/kub/src");
const appRequire = createRequire(path.join(root, "artifacts/kub/package.json"));
const { build } = createRequire(appRequire.resolve("vite"))("esbuild");
const { compile } = createRequire(appRequire.resolve("@tailwindcss/vite"))("@tailwindcss/node");
const storagePath = path.join(src, "components/settings/StorageSection.tsx");
const initializedPages = new WeakSet<Page>();

export type HeadingMutation = "none" | "wrap" | "hide" | "clip";
const bundles = new Map<HeadingMutation, Promise<{ js: string; css: string }>>();

function compiledFixture(mutation: HeadingMutation) {
  if (bundles.has(mutation)) return bundles.get(mutation)!;
  const pending = (async () => {
    let storage = readFileSync(storagePath, "utf8");
    if (mutation !== "none") {
      // Mutants change only the real heading; UI components are never mirrored.
      const heading = 'className="flex items-center gap-x-1.5 text-sm text-[color:var(--kub-text)]"';
      assert.equal(storage.split(heading).length, 2, "HEADING_MUTATION_TARGET");
      if (mutation === "wrap") {
        storage = storage.replace(heading, heading.replace("flex items-center", "flex flex-wrap items-center"))
          .replace('<span className="min-w-0">Хранилище приложения</span>', "Хранилище приложения");
      } else if (mutation === "hide") {
        storage = storage.replace('<InfoHint\n              term="Хранилище приложения"', '<InfoHint\n              className="hidden"\n              term="Хранилище приложения"');
      } else {
        storage = storage.replace('<span className="min-w-0">Хранилище приложения</span>', '<span className="min-w-0 truncate">Хранилище приложения</span>');
      }
      assert.notEqual(storage, readFileSync(storagePath, "utf8"), "MUTANT_NOT_APPLIED");
    }
    const result = await build({
      stdin: {
        contents: `import React from "react";
import {createRoot} from "react-dom/client";
import {StorageSection} from "${storagePath.replaceAll("\\", "/")}";
import {TooltipProvider} from "@/components/ui/tooltip";
createRoot(document.getElementById("root")).render(<TooltipProvider><StorageSection /></TooltipProvider>);`,
        resolveDir: path.join(root, "artifacts/kub"), loader: "tsx",
      },
      bundle: true, write: false, minify: true, format: "iife", platform: "browser", jsx: "automatic",
      absWorkingDir: root, metafile: true, logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [{
        name: "storage-heading-fictional-ports",
        setup(builder: any) {
          builder.onResolve({ filter: /^@\// }, (args: any) => {
            if (args.path === "@/components/kub") return { path: "kub", namespace: "storage-ports" };
            if (args.path === "@/lib/monitoring") return { path: "monitoring", namespace: "storage-ports" };
            return builder.resolve(`./${args.path.slice(2)}`, { resolveDir: src, kind: args.kind });
          });
          builder.onLoad({ filter: /.*/, namespace: "storage-ports" }, (args: any) => ({
            contents: args.path === "kub"
              ? ["KubButton", "KubIcon", "KubInput", "KubNotice"].map(name => `export {${name}} from "${src.replaceAll("\\", "/")}/components/kub/${name}";`).join("\n")
              : 'export function reportError(){throw new Error("FICTIONAL_STORAGE_ERROR");}',
            resolveDir: src, loader: "ts",
          }));
          builder.onLoad({ filter: /StorageSection\.tsx$/ }, () => ({ contents: storage, loader: "tsx", resolveDir: path.dirname(storagePath) }));
        },
      }],
    });
    const candidates = new Set<string>();
    for (const filename of Object.keys(result.metafile.inputs)) {
      if (!/\.[cm]?[jt]sx?$/.test(filename) || filename.includes("storage-ports:")) continue;
      const absolute = path.resolve(root, filename);
      if (!absolute.startsWith(src)) continue;
      const source = absolute === storagePath ? storage : readFileSync(absolute, "utf8");
      const tree = ts.createSourceFile(absolute, source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          for (const token of node.text.split(/\s+/)) candidates.add(token);
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    // These are the existing SettingsOverlay/DisclosureRow fixture wrappers.
    for (const token of "mx-auto w-full kub-settings-panel border-t px-3 py-3 sm:px-4".split(" ")) candidates.add(token);
    const stylesheet = await compile(readFileSync(path.join(src, "index.css"), "utf8"), {
      base: src, onDependency() {},
    });
    return { js: result.outputFiles[0].text, css: stylesheet.build([...candidates]) };
  })();
  bundles.set(mutation, pending);
  return pending;
}

export async function openStorageHeading(page: Page, theme: "dark" | "light", mutation: HeadingMutation = "none") {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0", "READ_ONLY_QA_REQUIRED");
  const bundle = await compiledFixture(mutation);
  const errors: string[] = [];
  const unexpected: string[] = [];
  page.on("pageerror", () => errors.push("PAGE_ERROR"));
  page.on("console", message => { if (message.type() === "error") errors.push("CONSOLE_ERROR"); });
  await page.context().setOffline(true);
  await page.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://storage-heading.invalid") {
      unexpected.push("NON_FIXTURE_REQUEST");
      return route.abort();
    }
    if (url.pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html class="${theme}"><head>
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional storage heading</title>
<link rel="stylesheet" href="/fixture.css"></head><body>
<div data-testid="settings-measure" class="mx-auto w-full" style="max-width:var(--kub-settings-measure,560px)">
<div class="kub-settings-panel border-t px-3 py-3 sm:px-4"><div id="root"></div></div></div>
<script src="/fixture.js"></script></body></html>` });
    }
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle.js });
    if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: bundle.css });
    if (/^\/fonts\/inter\/[a-z-]+\.woff2$/.test(url.pathname)) {
      return route.fulfill({ contentType: "font/woff2", body: readFileSync(path.join(root, "artifacts/kub/public", url.pathname)) });
    }
    unexpected.push("UNDECLARED_FIXTURE_RESOURCE");
    return route.abort();
  });
  // Same snake_case bridge payload as settingsColumnFixture; no native command.
  if (!initializedPages.has(page)) await page.addInitScript(() => {
    const state = {
      location: "D:\\LETSCUBE\\webview-production-v1", is_default_location: false,
      total_bytes: 1_932_735_283, cache_bytes: 704_643_072, cache_limit_bytes: 2 * 1024 ** 3,
      min_cache_limit_bytes: 128 * 1024 ** 2, max_cache_limit_bytes: 20 * 1024 ** 3, pending_location: null,
    };
    Object.defineProperty(window, "letscubeDesktop", { value: Object.freeze({
      platform: "windows", getStorageState: async () => state,
      setStorageLocation: async () => { throw new Error("NO_STORAGE_MUTATION"); },
      setCacheLimit: async () => { throw new Error("NO_STORAGE_MUTATION"); },
      clearCache: async () => { throw new Error("NO_STORAGE_MUTATION"); },
    }) });
  });
  initializedPages.add(page);
  await page.goto("https://storage-heading.invalid/");
  await page.getByTestId("desktop-storage-location").waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--kub-text").trim()),
    theme === "dark" ? "#F5F7FB" : "#07111F", "ACTUAL_THEME_TOKENS_REQUIRED");
  assert.equal(await page.evaluate(() => document.fonts.check("14px Inter", "Хранилище приложения")), true, "LOCAL_INTER_REQUIRED");
  return { errors, unexpected, marker: storageHeadingMarker(bundle.js) };
}

export async function headingGeometry(page: Page) {
  return page.locator('button[aria-label="Хранилище приложения — что это"]').evaluate(button => {
    const heading = button.parentElement!;
    const range = document.createRange();
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    const textRects: DOMRect[] = [];
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (button.contains(node) || !node.textContent?.trim()) continue;
      text += node.textContent;
      range.selectNodeContents(node);
      textRects.push(...Array.from(range.getClientRects()));
    }
    const hint = button.getBoundingClientRect();
    const glyph = button.querySelector("svg")?.getBoundingClientRect();
    const parent = heading.getBoundingClientRect();
    const intersects = (a: DOMRect, b: DOMRect) => a.top < b.bottom && a.bottom > b.top;
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0;
    };
    const noClip = (element: Element) => {
      const style = getComputedStyle(element);
      return element.scrollWidth <= element.clientWidth + 1 && style.textOverflow !== "ellipsis";
    };
    return {
      text: text.replace(/\s+/g, " ").trim(),
      hintSharesTextLine: Boolean(glyph && textRects.some(rect => intersects(rect, glyph))),
      hintVisible: visible(button) && hint.width >= 24 && hint.height >= 24 && Boolean(glyph && glyph.width >= 8 && glyph.height >= 8),
      textVisible: textRects.length > 0 && textRects.every(rect => rect.width > 0 && rect.left >= parent.left - 1 && rect.right <= parent.right + 1)
        && Array.from(heading.querySelectorAll("span")).every(element => visible(element) && noClip(element)),
      headingFits: heading.scrollWidth <= heading.clientWidth + 1,
      headingHeight: parent.height, hintTop: hint.top - parent.top,
      lineTops: textRects.map(rect => rect.top - parent.top),
      font: getComputedStyle(heading).fontFamily,
    };
  });
}
