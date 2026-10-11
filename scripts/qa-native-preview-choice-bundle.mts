import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Route } from "@playwright/test";
import ts from "typescript";
import { BASELINE_HOOK_BASE64, BASELINE_HOOK_BYTES, BASELINE_HOOK_SHA256 } from "../tests/e2e/helpers/nativeMessagePreviewUserChoiceBaseline.ts";

export type ChoiceBundleVariant = "current-true" | "current-false" | "baseline-true";
export type ChoiceAsset = Readonly<{ body: Buffer; contentType: string }>;
export const CHOICE_BUNDLE_ORIGIN = "http://127.0.0.1:54319";
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const app = resolve(root, "artifacts/kub");
const privateRoot = resolve(root, ".ops-private");
const bundleRoot = resolve(privateRoot, "task2-choice-bundle-20261010");
const hookPath = resolve(app, "src/hooks/useNativeMessagePreview.ts");
const selectorPath = resolve(app, "src/lib/platform/nativeVoiceCalls.ts");
const calibrationId = "\0qa-choice-calibration";
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const sourceInputs = ["index.html", "src/main.tsx", "src/App.tsx", "src/index.css",
  "src/hooks/useNativeMessagePreview.ts", "src/components/settings/SettingsScreen.tsx",
  "src/store/app.store.ts", "src/lib/platform/nativeVoiceCalls.ts", "src/lib/platform/nativeMessagePreviews.ts",
  "src/lib/platform/nativeMessagePreviewContract.ts", "src/lib/platform/capabilities.ts",
  "src/lib/supabase/client.ts", "src/lib/supabase/config.ts"].map(path => resolve(app, path));
const evidenceInputs = ["scripts/qa-native-preview-choice-bundle.mts",
  "scripts/qa-native-preview-choice-browser.mts", "pnpm-lock.yaml", "package.json", "artifacts/kub/package.json",
  "tests/unit/native-preview-choice-browser-oracles.test.mts",
  "tests/unit/native-preview-choice-bundle-harness.test.mts",
  "tests/unit/native-preview-choice-bundle-mutants.test.mts",
  "tests/e2e/native-message-preview-user-choice.spec.ts",
  "tests/e2e/helpers/nativeMessagePreviewUserChoiceFixture.ts",
  "tests/e2e/helpers/nativeMessagePreviewUserChoiceBaseline.ts",
  "tests/e2e/helpers/settingsColumnFixture.ts", "tests/e2e/helpers/messageActionsFixture.ts"].map(path => resolve(root, path));

function requireVariant(variant: string): asserts variant is ChoiceBundleVariant {
  if (!["current-true", "current-false", "baseline-true"].includes(variant)) throw Error("CHOICE_VARIANT_REFUSED");
}
export function requireChoiceBuildPermission(flag: string | undefined): void {
  if (flag !== "0") throw Error("CHOICE_MUTATION_FLAG_REFUSED");
}
export function requireChoiceOutput(output: string, variant: ChoiceBundleVariant): string {
  requireVariant(variant);
  if (!isAbsolute(output) || resolve(output) !== resolve(bundleRoot, variant)) throw Error("CHOICE_OUTPUT_REFUSED");
  return resolve(output);
}

export function replaceSelectorBody(source: string): string {
  const ast = ts.createSourceFile("nativeVoiceCalls.ts", source, ts.ScriptTarget.Latest, true);
  const syntaxErrors = ts.transpileModule(source, { reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext } })
    .diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error);
  const declarations = ast.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "nativeMessagePreviewBindingSnapshot");
  if (declarations.length !== 1 || !declarations[0].body
    || declarations[0].parameters.length !== 0 || syntaxErrors) throw Error("CHOICE_SELECTOR_SHAPE_REFUSED");
  const body = declarations[0].body;
  return source.slice(0, body.getStart(ast))
    + "{ return globalThis.__qaChoiceFictionalPort.selector(); }" + source.slice(body.getEnd());
}

export function decodeBaselineHook(base64 = BASELINE_HOOK_BASE64, bytes = BASELINE_HOOK_BYTES, hash = BASELINE_HOOK_SHA256): Buffer {
  const decoded = Buffer.from(base64, "base64");
  if (bytes !== 9117 || decoded.length !== 9117
    || hash !== "6c3fce41a5175b7a6e63f09f13143e7204beb5b4eebc41d1c89a3c0bfd9e11e2"
    || sha256(decoded) !== "6c3fce41a5175b7a6e63f09f13143e7204beb5b4eebc41d1c89a3c0bfd9e11e2") {
    throw Error("CHOICE_BASELINE_PIN_REFUSED");
  }
  return decoded;
}

// A second Rollup entry shares the actual store/adapters with Settings; it owns no hook or writer.
export const calibrationSource = `
import { nativeMessagePreviewBindingSnapshot } from "@/lib/platform/nativeVoiceCalls";
import { readNativeMessagePreviewCandidate, nativeMessagePreviewQaChoiceBridge } from "@/lib/platform/nativeMessagePreviews";
import { useAppStore } from "@/store/app.store";
import { isSupabaseConfigured, getSupabasePublicUrl, getSupabasePublishableKey } from "@/lib/supabase/client";
export async function calibrate() {
  const fictionalConfig = isSupabaseConfigured() && getSupabasePublicUrl() === "http://127.0.0.1:54321"
    && getSupabasePublishableKey() === "playwright-public-fixture";
  if (!fictionalConfig) throw Error("CHOICE_FICTIONAL_CONFIG_REFUSED");
  const binding = nativeMessagePreviewBindingSnapshot();
  if (!binding) throw Error("CHOICE_FICTIONAL_SELECTOR_UNAVAILABLE");
  const owner = { ...binding, accountEpoch: useAppStore.getState().accountEpoch };
  const candidate = await readNativeMessagePreviewCandidate();
  const context = await nativeMessagePreviewQaChoiceBridge.getQaUserChoiceContext(owner);
  return { protocol0: candidate?.protocol === 0, armedContext: context?.qa_choice_v === 1
    && context.purpose === "consent-only" && context.recipientId === owner.recipientId
    && context.recipientSessionId === owner.recipientSessionId && context.deviceId === owner.deviceId
    && context.accountEpoch === owner.accountEpoch && context.expiresAt > Date.now(),
    fictionalConfig, webQa: import.meta.env.VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE === "true" };
}
`;

export function createBuildOptions(output: string, qa: boolean) {
  const env = { BASE_URL: "/", MODE: "production", DEV: false, PROD: true, SSR: false,
    VITE_SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_ANON_KEY: "playwright-public-fixture",
    VITE_SUPABASE_PUBLISHABLE_KEY: "playwright-public-fixture",
    VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE: qa ? "true" : "false" };
  const define: Record<string, string> = { "import.meta.env": JSON.stringify(env),
    "process.env.NODE_ENV": JSON.stringify("production"),
    ...Object.fromEntries(Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])) };
  return {
    root: app, base: "/", mode: "production", configFile: false as const, envDir: false as const,
    envPrefix: [] as string[], logLevel: "silent" as const,
    define,
    resolve: { alias: { "@": resolve(app, "src"), "@assets": resolve(root, "attached_assets") }, dedupe: ["react", "react-dom"] },
    cacheDir: resolve(output, ".cache"),
    build: { outDir: resolve(output), emptyOutDir: false, sourcemap: false, write: true,
      // Preserve the exported calibrate() entry, not a global or a second independently built graph.
      rollupOptions: { input: { app: resolve(app, "index.html"), calibration: "qa-choice-calibration" },
        preserveEntrySignatures: "strict" as const } },
  };
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
};
function requireAssetPath(path: string): void {
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes("//")
    || path.split("/").some(part => part === "." || part === "..") || path.endsWith("/")) throw Error("CHOICE_ASSET_PATH_REFUSED");
}
export function createAssetHandler(assets: Map<string, ChoiceAsset>) {
  const snapshot = new Map<string, ChoiceAsset>();
  let total = 0;
  for (const [path, asset] of assets) {
    requireAssetPath(path);
    if (!Buffer.isBuffer(asset.body) || asset.body.length > 32 * 1024 * 1024
      || !Object.values(contentTypes).includes(asset.contentType) && !["text/html", "text/javascript", "text/css"].includes(asset.contentType)) {
      throw Error("CHOICE_ASSET_SHAPE_REFUSED");
    }
    total += asset.body.length;
    if (snapshot.size >= 2048 || total > 128 * 1024 * 1024) throw Error("CHOICE_ASSET_LIMIT_REFUSED");
    snapshot.set(path, { body: Buffer.from(asset.body), contentType: asset.contentType });
  }
  return async (route: Route): Promise<void> => {
    const request = route.request();
    let url: URL;
    try { url = new URL(request.url()); } catch { await route.abort("blockedbyclient"); return; }
    if (request.method() !== "GET" || url.origin !== CHOICE_BUNDLE_ORIGIN || url.username || url.password
      || url.search || url.hash || request.redirectedFrom() || request.url() !== `${CHOICE_BUNDLE_ORIGIN}${url.pathname}`) {
      await route.abort("blockedbyclient"); return;
    }
    const asset = snapshot.get(url.pathname === "/" ? "/index.html" : url.pathname);
    if (!asset) { await route.abort("blockedbyclient"); return; }
    await route.fulfill({ status: 200, contentType: asset.contentType,
      headers: { "cache-control": "no-store" }, body: Buffer.from(asset.body) });
  };
}

function repoPath(path: string): string { return relative(root, path).split(sep).join("/"); }
async function inputHashes(paths: readonly string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(paths.map(async path => [repoPath(path), sha256(await sourceBytes(path))])));
}
async function sourceBytes(path: string): Promise<Buffer> {
  if (!(await lstat(path)).isFile() || resolve(await realpath(path)) !== resolve(path)) throw Error("CHOICE_SOURCE_LINK_REFUSED");
  return readFile(path);
}
async function unchanged(hashes: Record<string, string>): Promise<void> {
  for (const [path, hash] of Object.entries(hashes)) {
    if (sha256(await sourceBytes(resolve(root, path))) !== hash) throw Error("CHOICE_INPUT_CHANGED_DURING_BUILD");
  }
}
async function requireRealDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || resolve(await realpath(path)) !== resolve(path)) throw Error("CHOICE_OUTPUT_LINK_REFUSED");
}
async function collectAssets(output: string): Promise<Map<string, ChoiceAsset>> {
  const assets = new Map<string, ChoiceAsset>();
  let total = 0;
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink() || resolve(await realpath(path)) !== path) throw Error("CHOICE_OUTPUT_LINK_REFUSED");
      if (entry.isDirectory()) { if (entry.name !== ".cache") await visit(path); continue; }
      const stat = await lstat(path), contentType = contentTypes[extname(path)];
      if (!stat.isFile() || !contentType || stat.size > 32 * 1024 * 1024) throw Error("CHOICE_OUTPUT_ASSET_REFUSED");
      total += stat.size;
      if (assets.size >= 2048 || total > 128 * 1024 * 1024) throw Error("CHOICE_ASSET_LIMIT_REFUSED");
      const key = "/" + relative(output, path).split(sep).join("/"); requireAssetPath(key);
      assets.set(key, { body: await readFile(path), contentType });
    }
  }
  await visit(output);
  if (!assets.has("/index.html")) throw Error("CHOICE_INDEX_MISSING");
  return assets;
}

// Explicit finite build only. Importing this module neither builds nor opens a browser/listener.
export async function buildChoiceBundle(output: string, variant: ChoiceBundleVariant) {
  requireChoiceBuildPermission(process.env.KUB_QA_ALLOW_MUTATIONS);
  const outDir = requireChoiceOutput(output, variant);
  const baseline = decodeBaselineHook();
  const source = await inputHashes(sourceInputs), evidence = await inputHashes(evidenceInputs);
  const graphSource: Record<string, string> = {};
  await requireRealDirectory(privateRoot);
  try { await mkdir(bundleRoot, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await requireRealDirectory(bundleRoot);
  await mkdir(outDir, { mode: 0o700 }); // Exclusive reservation: never overwrite a previous variant.
  await requireRealDirectory(outDir);
  const appRequire = createRequire(resolve(app, "package.json"));
  const { build } = await import(pathToFileURL(appRequire.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(appRequire.resolve("@vitejs/plugin-react")).href);
  const { default: tailwind } = await import(pathToFileURL(appRequire.resolve("@tailwindcss/vite")).href);
  let calibrationPath = "";
  const substitutions = {
    name: "fictional-choice-ports", enforce: "pre" as const,
    resolveId(id: string) { return id === "qa-choice-calibration" ? calibrationId : null; },
    async load(id: string) {
      if (id === calibrationId) return calibrationSource;
      const path = id.split("?")[0];
      if (!isAbsolute(path) || !resolve(path).startsWith(resolve(app, "src") + sep)) return null;
      const key = repoPath(path), hash = sha256(await sourceBytes(path));
      if (graphSource[key] && graphSource[key] !== hash) throw Error("CHOICE_GRAPH_INPUT_CHANGED");
      graphSource[key] = hash;
      return resolve(path) === hookPath && variant === "baseline-true" ? baseline.toString("utf8") : null;
    },
    transform(code: string, id: string) {
      if (resolve(id.split("?")[0]) !== selectorPath) return null;
      if (sha256(code) !== source[repoPath(selectorPath)]) throw Error("CHOICE_SELECTOR_INPUT_CHANGED");
      return { code: replaceSelectorBody(code), map: null };
    },
    generateBundle(_options: unknown, bundle: Record<string, { type: string; facadeModuleId?: string; fileName: string }>) {
      const entries = Object.values(bundle).filter(entry => entry.type === "chunk" && entry.facadeModuleId === calibrationId);
      if (entries.length !== 1) throw Error("CHOICE_CALIBRATION_ENTRY_REFUSED");
      calibrationPath = "/" + entries[0].fileName;
    },
  };
  await build({ ...createBuildOptions(outDir, variant !== "current-false"), plugins: [substitutions, react(), tailwind()] });
  await unchanged(source); await unchanged(evidence); await unchanged(graphSource);
  const assets = await collectAssets(outDir);
  if (!calibrationPath || !assets.has(calibrationPath)) throw Error("CHOICE_CALIBRATION_ENTRY_REFUSED");
  // Hashes describe input bytes, not a Git/device/runtime acceptance claim. The coordinator owns protected dirty pins.
  return { assets, calibrationPath, assetHashes: Object.fromEntries([...assets].map(([path, asset]) => [path, sha256(asset.body)])),
    inputHashes: { source, graphSource, evidence,
    compiledHook: { sourcePath: repoPath(hookPath), baseline: variant === "baseline-true",
      sha256: variant === "baseline-true" ? sha256(baseline) : source[repoPath(hookPath)] },
    selectorBodyOnly: { sourcePath: repoPath(selectorPath), inputSha256: source[repoPath(selectorPath)] },
    calibrationSha256: sha256(calibrationSource) }, variant, listener: false as const, fictional: true as const };
}
