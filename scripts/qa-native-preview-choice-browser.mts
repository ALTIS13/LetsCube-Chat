import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, webkit, expect, type Locator, type Page } from "@playwright/test";
import { buildChoiceBundle, createAssetHandler, requireChoiceOutput } from "./qa-native-preview-choice-bundle.mts";
import { choiceWireControl, choiceWireSnapshot, installFictionalChoiceWire,
  openChoiceSettingsWithPreparedPorts } from "../tests/e2e/helpers/nativeMessagePreviewUserChoiceFixture.ts";

const origin = "http://127.0.0.1:54319";
const labels = ["Общий текст", "Имя отправителя", "Имя и сообщение"] as const;
type Fixture = Awaited<ReturnType<typeof openChoiceSettingsWithPreparedPorts>>;
type Variant = "current-true" | "current-false" | "baseline-true";
type Bundle = Awaited<ReturnType<typeof buildChoiceBundle>>;
const protectedPins: Record<string, string> = {
  "artifacts/kub/src/components/sidebar/SidebarHeader.tsx": "0a67b2502e540e630bb59dea41a67afc4cf2a160643d7d4e2e1b80832f32a0c2",
  "tests/e2e/search-motion-fixture.spec.ts": "919d3a7d612b5c3954c51f2b7ddc1c694a436af7bbd7e5f508e346b8e99b01ef",
  "tests/e2e/sidebar-search-motion.spec.ts": "c1aa29c76f2be142388962af542647766714e9cd0e7fc79ac30639ac2ba8b01d",
};
async function checkPins(root: string, pins: Record<string, string>) {
  for (const [path, expected] of Object.entries(pins)) {
    assert.equal(createHash("sha256").update(await readFile(resolve(root, path))).digest("hex"), expected,
      "CHOICE_INPUT_CHANGED_DURING_RENDERED_CHECK");
  }
}

export function assertBaselineFeatureAbsence(count: number) {
  assert.equal(count, 0, "BASELINE_FEATURE_ABSENCE_REQUIRES_ZERO_CONTROLS");
  assert.throws(() => assert.equal(count, 1, "REAL_SETTINGS_QA_CHOICE_AVAILABLE_WITHOUT_PROTOCOL1"), { code: "ERR_ASSERTION" });
}

async function openRadios(page: Page) {
  const disclosure = page.getByTestId("settings-open-message-preview");
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  const row = page.getByTestId("native-message-preview-setting");
  await expect(row.getByRole("radio")).toHaveCount(3);
  return row;
}
export async function closeSettings(page: Page) {
  const close = page.getByTestId("settings-close").or(
    page.getByTestId("settings-actions").getByRole("button", { name: "Закрыть", exact: true }));
  await expect(close).toHaveCount(1);
  await close.click();
}
async function checked(row: Locator, name: typeof labels[number], enabled = true) {
  await expect(row.getByRole("radio", { name, exact: true })).toBeChecked();
  for (const label of labels) {
    const radio = row.getByRole("radio", { name: label, exact: true });
    if (enabled) await expect(radio).toBeEnabled(); else await expect(radio).toBeDisabled();
  }
}
async function geometry(row: Locator, width: number) {
  await row.scrollIntoViewIfNeeded();
  const box = await row.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, overflow: element.scrollWidth > element.clientWidth + 1 };
  });
  assert.ok(box.left >= 0 && box.right <= width + 0.5 && !box.overflow);
}
async function calibrate(page: Page, bundle: Bundle, armed: boolean) {
  const observed = await page.evaluate(async path => {
    const entry = await import(path);
    return entry.calibrate();
  }, bundle.calibrationPath);
  assert.deepEqual(observed, { protocol0: true, armedContext: armed,
    fictionalConfig: true, webQa: bundle.variant !== "current-false" });
}

async function sequence(page: Page, fixture: Fixture, row: Locator, width: number, capture: (state: string) => Promise<void>) {
  await checked(row, "Общий текст");
  await geometry(row, width); await capture("ready-none");
  const rpcBefore = fixture.rpcArgs.length;
  const release = fixture.holdNextWrite();
  try {
    await row.getByRole("radio", { name: "Имя отправителя", exact: true }).click();
    await expect.poll(() => fixture.writes.length).toBe(1);
    await expect(row).toContainText("Сохранение…");
    await checked(row, "Общий текст", false);
    const pending = await choiceWireSnapshot(page);
    assert.equal(pending.begins, 1); assert.equal(pending.confirms, 0);
    assert.notEqual(pending.pending, null); assert.equal(pending.confirmed, "none");
    await geometry(row, width); await capture("saving-sender");
  } finally { release(); }
  await checked(row, "Имя отправителя");
  assert.equal(fixture.rpcArgs.length - rpcBefore, 2);
  assert.equal((await choiceWireSnapshot(page)).confirmed, "sender");
  await row.getByRole("radio", { name: "Имя и сообщение", exact: true }).click();
  await checked(row, "Имя и сообщение");
  assert.equal((await choiceWireSnapshot(page)).confirmed, "message");
  await geometry(row, width); await capture("ready-message");
  await row.getByRole("radio", { name: "Общий текст", exact: true }).click();
  await checked(row, "Общий текст");
  assert.deepEqual(fixture.writes, ["sender", "message", "none"]);
  assert.equal(fixture.savedServerChoice(), "none");
  assert.equal(fixture.rpcArgs.length - rpcBefore, 6);
  const done = await choiceWireSnapshot(page);
  assert.equal(done.begins, 3); assert.equal(done.confirms, 3);
  assert.equal(done.confirmed, "none"); assert.equal(done.protocol, 0);
  await geometry(row, width); await capture("final-none");
}

async function failureCase(name: string, page: Page, fixture: Fixture, row: Locator) {
  await checked(row, "Общий текст");
  if (name === "begin-refusal") {
    const before = fixture.rpcArgs.length;
    await choiceWireControl(page, "refuseNextBegin");
    await row.getByRole("radio", { name: "Имя отправителя", exact: true }).click();
    await expect(row.getByRole("button", { name: "Повторить", exact: true })).toBeVisible();
    assert.deepEqual(fixture.writes, []); assert.equal(fixture.rpcArgs.length - before, 0);
    const wire = await choiceWireSnapshot(page);
    assert.equal(wire.begins, 1); assert.equal(wire.confirms, 0); assert.equal(wire.confirmed, "none");
  } else if (name === "lost-confirm" || name === "dispose-confirm") {
    await choiceWireControl(page, "holdConfirm");
    try {
      await row.getByRole("radio", { name: "Имя отправителя", exact: true }).click();
      await expect.poll(async () => (await choiceWireSnapshot(page)).confirms).toBe(1);
      if (name === "dispose-confirm") {
        await closeSettings(page); await expect(row).toHaveCount(0);
      } else {
        await checked(row, "Общий текст", false); await expect(row).toContainText("Сохранение…");
      }
      await expect.poll(async () => (await choiceWireSnapshot(page)).terminal).toBe(true);
      assert.equal((await choiceWireSnapshot(page)).confirmed, "none");
    } finally { await choiceWireControl(page, "releaseConfirm"); }
    if (name === "lost-confirm") {
      await expect(row.getByRole("button", { name: "Повторить", exact: true })).toBeVisible();
      await expect(row.locator('input[type="radio"][value="sender"]:checked')).toHaveCount(0);
      await closeSettings(page);
    }
    assert.deepEqual(fixture.writes, ["sender"]); assert.equal(fixture.savedServerChoice(), "sender");
    assert.equal((await choiceWireSnapshot(page)).confirms, 1);
  } else if (name === "failed-none") {
    await row.getByRole("radio", { name: "Имя и сообщение", exact: true }).click();
    await checked(row, "Имя и сообщение");
    fixture.refuseNextWrite();
    await row.getByRole("radio", { name: "Общий текст", exact: true }).click();
    await expect(row.getByRole("button", { name: "Повторить", exact: true })).toBeVisible();
    assert.deepEqual(fixture.writes, ["message", "none"]); assert.equal(fixture.savedServerChoice(), "message");
    await expect(row.locator('input[type="radio"][value="none"]:checked')).toHaveCount(0);
    const wire = await choiceWireSnapshot(page);
    assert.equal(wire.begins, 2); assert.equal(wire.confirms, 1); assert.equal(wire.confirmed, "none");
  } else {
    assert.equal(name, "fixed-expiry");
    const release = fixture.holdNextWrite();
    try {
      await row.getByRole("radio", { name: "Имя отправителя", exact: true }).click();
      await expect.poll(() => fixture.writes.length).toBe(1);
      await checked(row, "Общий текст", false); await page.clock.fastForward(120_000);
      assert.equal((await choiceWireSnapshot(page)).terminal, true);
    } finally { release(); }
    await expect(row).not.toContainText("Сохранение…");
    assert.deepEqual(fixture.writes, ["sender"]); assert.equal(fixture.savedServerChoice(), "sender");
    const wire = await choiceWireSnapshot(page);
    assert.equal(wire.confirms, 0); assert.equal(wire.confirmed, "none");
    await expect.poll(async () => (await choiceWireSnapshot(page)).retireAcks).toBe(1);
  }
}

// Reuse only the exact first finite build and its nine completed cases; no rebuild/replay.
async function retainedAttempt(output: string, root: string) {
  const provenanceBytes = await readFile(resolve(output, "source-provenance.json"));
  assert.equal(createHash("sha256").update(provenanceBytes).digest("hex"),
    "04871e8199f8c4c8d35e25447dfb504cab26ea99cd19f8746b2b78602fce6486");
  const progressBytes = await readFile(resolve(output, "progress.json"));
  assert.equal(createHash("sha256").update(progressBytes).digest("hex"),
    "6a627ed02066c474cad3b494d3e3e84826a4c750016b7561c8e2a7c9a3f654a7");
  const provenance = JSON.parse(provenanceBytes.toString());
  const results: Record<string, unknown>[] = JSON.parse(progressBytes.toString()).results;
  assert.equal(results.length, 9);
  const bundles = new Map<Variant, Bundle>();
  const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".ogg": "audio/ogg", ".mp3": "audio/mpeg" };
  for (const saved of provenance.bundles) {
    const variant = saved.variant as Variant;
    const base = requireChoiceOutput(resolve(output, variant), variant);
    assert.equal(resolve(await realpath(base)), base);
    await checkPins(root, saved.inputHashes.source); await checkPins(root, saved.inputHashes.graphSource);
    const unchangedEvidence = { ...saved.inputHashes.evidence };
    delete unchangedEvidence["scripts/qa-native-preview-choice-browser.mts"];
    delete unchangedEvidence["tests/e2e/native-message-preview-user-choice.spec.ts"];
    await checkPins(root, unchangedEvidence);
    const assets = new Map<string, Bundle["assets"] extends Map<string, infer A> ? A : never>();
    for (const [path, expected] of Object.entries(saved.assetHashes)) {
      assert.match(path, /^\/[a-zA-Z0-9_./-]+$/);
      assert.ok(!path.split("/").some(part => part === ".." || part === ".") && !path.includes("//"));
      const file = resolve(base, "." + path), stat = await lstat(file);
      assert.ok(stat.isFile() && stat.size <= 32 * 1024 * 1024);
      assert.equal(resolve(await realpath(file)), file);
      const body = await readFile(file);
      assert.equal(createHash("sha256").update(body).digest("hex"), expected);
      assert.ok(mime[extname(path)]);
      assets.set(path, { body, contentType: mime[extname(path)] });
    }
    assert.ok(assets.has(saved.calibrationPath));
    createAssetHandler(assets); // Reuse the original size/path/MIME guards before a browser exists.
    bundles.set(variant, { ...saved, assets, fictional: true, listener: false,
      inputHashes: { ...saved.inputHashes, evidence: unchangedEvidence } });
  }
  assert.deepEqual([...bundles.keys()], ["current-true", "current-false", "baseline-true"]);
  const observerPins: Record<string, string> = {};
  for (const path of ["scripts/qa-native-preview-choice-browser.mts", "tests/e2e/native-message-preview-user-choice.spec.ts"]) {
    observerPins[path] = createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");
  }
  return { bundles, results, provenance, observerPins };
}

export async function runChoiceBrowser(output: string, resume = false) {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  assert.equal(resolve(output), dirname(requireChoiceOutput(resolve(output, "current-true"), "current-true")));
  const privateParent = dirname(output), root = dirname(privateParent);
  assert.ok((await lstat(privateParent)).isDirectory());
  assert.equal(resolve(await realpath(privateParent)), resolve(privateParent));
  await checkPins(root, protectedPins);
  const retained = resume ? await retainedAttempt(output, root) : undefined;
  const evidenceOutput = resume ? resolve(output, "browser-round3") : output;
  await mkdir(evidenceOutput);
  const bundles = retained?.bundles ?? new Map<Variant, Bundle>();
  if (!retained) for (const variant of ["current-true", "current-false", "baseline-true"] as const) {
    bundles.set(variant, await buildChoiceBundle(resolve(output, variant), variant));
  }
  await writeFile(resolve(evidenceOutput, "source-provenance.json"), JSON.stringify({
    fictionalOnly: true, listeningServer: false, protectedPins,
    reusedCases: retained?.results.length ?? 0, retainedProvenance: retained?.provenance,
    observerPins: retained?.observerPins,
    bundles: [...bundles].map(([variant, bundle]) => ({ variant, calibrationPath: bundle.calibrationPath,
      inputHashes: bundle.inputHashes, assetHashes: bundle.assetHashes })),
  }, null, 2), { flag: "wx" });
  const results: Record<string, unknown>[] = [...(retained?.results ?? [])];
  for (const engine of ["chromium", "webkit"] as const) {
    const browser = await (engine === "chromium" ? chromium : webkit).launch();
    try {
      const cases = [
        { name: "web-false", variant: "current-false" as Variant, armed: true },
        { name: "native-disabled", variant: "current-true" as Variant, armed: false },
        { name: "baseline-red", variant: "baseline-true" as Variant, armed: true },
        { name: "current-ready", variant: "current-true" as Variant, armed: true },
        ...[1440, 390].flatMap(width => ["dark", "light"].map(theme => ({
          name: "sequence", variant: "current-true" as Variant, armed: true, width, theme,
        }))),
        ...["begin-refusal", "lost-confirm", "dispose-confirm", "failed-none", "fixed-expiry"].map(name => ({
          name, variant: "current-true" as Variant, armed: true,
        })),
      ];
      for (const scenario of cases) {
        const width = "width" in scenario ? scenario.width as number : 390;
        const theme = ("theme" in scenario ? scenario.theme : "dark") as "light" | "dark";
        if (results.some(result => result.engine === engine && result.scenario === scenario.name
          && result.width === width && result.theme === theme && result.variant === scenario.variant)) continue;
        const context = await browser.newContext({ baseURL: origin, viewport: { width, height: width === 390 ? 844 : 900 },
          colorScheme: theme, serviceWorkers: "block" });
        try {
          const page = await context.newPage();
          let pageErrors = 0; page.on("pageerror", () => { pageErrors++; });
          await page.routeWebSocket(/.*/, socket => socket.close());
          const bundle = bundles.get(scenario.variant)!;
          await page.route("**/*", createAssetHandler(bundle.assets));
          if (scenario.name === "fixed-expiry") await page.clock.install();
          await installFictionalChoiceWire(page, scenario.armed);
          const fixture = await openChoiceSettingsWithPreparedPorts(page, { theme });
          assert.equal(new URL(page.url()).origin, origin);
          await expect(page).toHaveTitle(/LETSCUBE/i);
          await expect(fixture.row).toBeVisible();
          await calibrate(page, bundle, scenario.name === "web-false" ? false : scenario.armed);
          if (["web-false", "native-disabled", "baseline-red"].includes(scenario.name)) {
            await expect(fixture.row).toContainText("Общий текст на этом устройстве");
            assert.equal(await fixture.row.getByRole("radio").count(), 0);
            assert.deepEqual(fixture.writes, []); assert.deepEqual(fixture.rpcArgs, []);
            const wire = await choiceWireSnapshot(page);
            assert.equal(wire.protocol, 0); assert.equal(wire.begins, 0); assert.equal(wire.confirms, 0);
            if (scenario.name === "web-false") assert.equal(wire.contexts, 0);
            if (scenario.name === "baseline-red") {
              const count = await page.getByTestId("settings-open-message-preview").count();
              assertBaselineFeatureAbsence(count);
            }
          } else {
            const row = await openRadios(page);
            if (scenario.name === "current-ready") {
              await checked(row, "Общий текст");
              assert.deepEqual(fixture.writes, []); assert.ok(fixture.rpcArgs.length >= 1);
              const wire = await choiceWireSnapshot(page);
              assert.ok(wire.contexts >= 2); assert.equal(wire.begins, 0); assert.equal(wire.confirms, 0);
            } else if (scenario.name === "sequence") {
              const captures = resolve(evidenceOutput, `${engine}-${width}-${theme}`); await mkdir(captures);
              await sequence(page, fixture, row, width, async state => {
                await row.screenshot({ path: resolve(captures, `${state}.png`) });
              });
            } else { await failureCase(scenario.name, page, fixture, row); }
          }
          assert.equal(pageErrors, 0, "ACTUAL_APPLICATION_RUNTIME_ERROR");
          results.push({ engine, scenario: scenario.name, width, theme, variant: scenario.variant, passed: true,
            fictionalOnly: true, baselineFeatureAbsenceRed: scenario.name === "baseline-red", pageErrors });
          await writeFile(resolve(evidenceOutput, "progress.json"), JSON.stringify({ results }, null, 2));
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  await checkPins(root, protectedPins);
  if (retained) await checkPins(root, retained.observerPins);
  for (const bundle of bundles.values()) {
    await checkPins(root, bundle.inputHashes.source);
    await checkPins(root, bundle.inputHashes.evidence);
    await checkPins(root, bundle.inputHashes.graphSource);
  }
  await writeFile(resolve(evidenceOutput, "result.json"), JSON.stringify({
    checkedAt: new Date().toISOString(), fictionalOnly: true, listeningServer: false,
    actualNativeGuard: false, realDevice: false, personChoice: false, productionAcceptance: false,
    reusedCases: retained?.results.length ?? 0, newCases: results.length - (retained?.results.length ?? 0), results,
  }, null, 2), { flag: "wx" });
  return { cases: results.length, passed: true, fictionalOnly: true, listeningServer: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.ok(process.argv.length === 3 || process.argv.length === 4 && process.argv[3] === "--resume-retained");
  console.log(JSON.stringify(await runChoiceBrowser(resolve(process.argv[2]), process.argv[3] === "--resume-retained")));
}
