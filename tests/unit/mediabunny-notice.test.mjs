import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const kub = join(root, "artifacts/kub");
const publicDir = join(kub, "public");
const noticePath = join(publicDir, "open-source.html");
const licensePath = join(publicDir, "licenses/MPL-2.0.txt");
const installed = join(root, "node_modules/.pnpm/mediabunny@1.56.1/node_modules/mediabunny");
const kubRequire = createRequire(join(kub, "package.json"));
const rootRequire = createRequire(join(root, "package.json"));
const { chromium } = kubRequire("@playwright/test");
const artifactRoot = mkdtempSync(join(tmpdir(), "letscube-oss-notice-"));
const sourceUrl = "https://github.com/Vanilagy/mediabunny/tree/v1.56.1";
const results = [];
let browser;
let rootBundle;

test.after(async () => {
  await browser?.close();
  writeFileSync(join(artifactRoot, "metadata.json"), JSON.stringify({
    syntheticOnly: true, auth: false, appBuild: false, results,
    licenseSha256: existsSync(licensePath) ? createHash("sha256").update(readFileSync(licensePath)).digest("hex") : null,
  }, null, 2));
  console.log(`OSS notice synthetic renders and packaging: ${artifactRoot}`);
});

test("notice payload: exact version, upstream source and unmodified full MPL", () => {
  const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.equal(pkg.version, "1.56.1");
  assert.equal(pkg.license, "MPL-2.0");
  assert.deepEqual(readFileSync(licensePath), readFileSync(join(installed, "LICENSE")));
  const html = readFileSync(noticePath, "utf8");
  assert.match(html, /Mediabunny 1\.56\.1/);
  assert.match(html, /Copyright \(c\) 2026-present, Vanilagy and contributors/);
  assert.ok(html.includes(sourceUrl), "source must be pinned to the shipped version, not main/latest");
  assert.match(html, /href="licenses\/MPL-2\.0\.txt"/);
  assert.doesNotMatch(html, /https?:[^"\s]+\.(?:js|css|woff2)/, "notice must not fetch third-party resources");
});

test("discovery: Settings and entry HTML link to the packaged base-relative notice", () => {
  const settings = readFileSync(join(kub, "src/components/settings/SettingsScreen.tsx"), "utf8");
  const link = settings.match(/<a\s[^>]*data-testid="open-source-notices-link"[\s\S]*?<\/a>/)?.[0];
  assert.ok(link, "the existing application/about area must expose the notice");
  assert.match(link, /href=\{`\$\{import\.meta\.env\.BASE_URL \|\| "\/"\}open-source\.html`\}/);
  assert.match(link, /target="_blank"/);
  assert.match(link, /rel="noopener noreferrer"/);
  assert.match(link, /Лицензии открытого ПО/);
  const entry = readFileSync(join(kub, "index.html"), "utf8");
  assert.match(entry, /<link rel="license" href="%BASE_URL%open-source\.html" title="Лицензии сторонних компонентов" \/>/);
});

for (const base of ["/", "/nested/"]) {
  test(`actual Vite public copy and discovery preserve ${base} URLs`, async () => {
    const { build } = await import(pathToFileURL(kubRequire.resolve("vite")).href);
    const fixture = join(artifactRoot, base === "/" ? "root-base" : "nested-base");
    mkdirSync(fixture);
    writeFileSync(join(fixture, "index.html"), readFileSync(join(kub, "index.html")));
    const output = join(fixture, "dist");
    await build({
      configFile: false, root: fixture, envDir: false, publicDir, base, logLevel: "silent",
      build: { outDir: output, emptyOutDir: true },
      plugins: [{ name: "notice-only-entry", enforce: "pre",
        resolveId(id) { if (id.endsWith("/src/main.tsx")) return "\0notice-only-entry"; },
        load(id) { if (id === "\0notice-only-entry") return "export {};"; },
      }],
    });
    assert.deepEqual(readFileSync(join(output, "open-source.html")), readFileSync(noticePath));
    assert.deepEqual(readFileSync(join(output, "licenses/MPL-2.0.txt")), readFileSync(licensePath));
    const html = readFileSync(join(output, "index.html"), "utf8");
    assert.ok(html.includes(`href="${base}open-source.html"`), "actual HTML transform must retain discovery");
    if (base === "/") rootBundle = output;
    results.push({ packaging: "vite-public-copy", base, exactNotice: true, exactLicense: true });
  });
}

test("actual Capacitor copy retains the notice and full license in Android public assets", async () => {
  assert.ok(rootBundle, "root Vite output must exist before Capacitor copy");
  const cli = dirname(rootRequire.resolve("@capacitor/cli/package.json"));
  const { loadConfig } = rootRequire(join(cli, "dist/config.js"));
  const { copy } = rootRequire(join(cli, "dist/tasks/copy.js"));
  const fixture = join(artifactRoot, "capacitor-copy");
  mkdirSync(fixture);
  writeFileSync(join(fixture, "package.json"), JSON.stringify({ name: "synthetic-notice-copy", version: "1.0.0" }));
  writeFileSync(join(fixture, "capacitor.config.json"), JSON.stringify({
    appId: "ru.letscube.noticefixture", appName: "Synthetic notice fixture", webDir: rootBundle,
  }));
  const previous = process.cwd();
  let config;
  try {
    process.chdir(fixture);
    config = await loadConfig();
  } finally { process.chdir(previous); }
  assert.ok(config.android.webDirAbs.startsWith(fixture), "copy may only replace its owned temp target");
  await copy(config, "android");
  assert.deepEqual(readFileSync(join(config.android.webDirAbs, "open-source.html")), readFileSync(noticePath));
  assert.deepEqual(readFileSync(join(config.android.webDirAbs, "licenses/MPL-2.0.txt")), readFileSync(licensePath));
  results.push({ packaging: "capacitor-copy", assets: config.android.webDirAbs, exactNotice: true, exactLicense: true });
});

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
  test(`notice ${width}px ${theme}: readable and local license reachable`, { timeout: 20_000 }, async () => {
    assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0", "synthetic browser tests require QA0");
    const html = readFileSync(noticePath, "utf8");
    browser ??= await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, serviceWorkers: "block" });
    const page = await context.newPage();
    const unexpectedRequests = [];
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === "https://notice.invalid" && route.request().method() === "GET") {
        if (url.pathname === "/nested/open-source.html") return route.fulfill({ contentType: "text/html", body: html });
        if (url.pathname === "/nested/licenses/MPL-2.0.txt") return route.fulfill({ contentType: "text/plain", body: readFileSync(licensePath) });
      }
      unexpectedRequests.push("unlisted-or-external-request");
      return route.abort();
    });
    try {
      await page.goto("https://notice.invalid/nested/open-source.html");
      const readings = await page.evaluate(() => {
        const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = color => rgb(color).map(value => {
          const c = value / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
        const background = luminance(getComputedStyle(document.body).backgroundColor);
        return {
          noOverflow: document.documentElement.scrollWidth <= innerWidth,
          scheme: getComputedStyle(document.documentElement).colorScheme,
          samples: [...document.querySelectorAll("h1,h2,p,dt,dd,a")].map(node => {
            const style = getComputedStyle(node);
            const foreground = luminance(style.color);
            const box = node.getBoundingClientRect();
            return { contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
              opacity: Number(style.opacity), fits: box.x >= 0 && box.right <= innerWidth, fontSize: parseFloat(style.fontSize) };
          }),
        };
      });
      const source = page.getByRole("link", { name: "Исходный код Mediabunny 1.56.1" });
      assert.equal(await source.getAttribute("href"), sourceUrl);
      assert.equal(await source.getAttribute("target"), "_blank");
      assert.equal(await source.getAttribute("rel"), "noopener noreferrer");
      await page.screenshot({ path: join(artifactRoot, `${width}-${theme}.png`), fullPage: true });
      assert.equal(readings.scheme, theme);
      assert.equal(readings.noOverflow, true);
      assert.ok(readings.samples.length >= 8, "all notice text must be measured");
      for (const sample of readings.samples) {
        assert.equal(sample.opacity, 1);
        assert.equal(sample.fits, true);
        assert.ok(sample.contrast >= 4.5, `notice text contrast ${sample.contrast.toFixed(2)} must reach 4.5:1`);
        assert.ok(sample.fontSize >= 14);
      }
      await page.getByRole("link", { name: "Полный текст MPL-2.0" }).click();
      assert.equal(new URL(page.url()).pathname, "/nested/licenses/MPL-2.0.txt");
      assert.equal(await page.locator("body").innerText(), readFileSync(licensePath, "utf8").replace(/\r\n/g, "\n"));
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpectedRequests, []);
      results.push({ width, theme, readings, licenseNavigation: true, errors, unexpectedRequests });
    } finally { await context.close(); }
  });
}
