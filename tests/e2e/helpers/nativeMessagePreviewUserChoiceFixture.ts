import { createHash } from "node:crypto";
import ts from "typescript";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_HOST, requireFixtureServer } from "./messageActionsFixture";
import { ME, openSettingsScreen } from "./settingsColumnFixture";
import { BASELINE_HOOK_BASE64, BASELINE_HOOK_BYTES, BASELINE_HOOK_SHA256 } from "./nativeMessagePreviewUserChoiceBaseline";
import { resolveSupabaseConfig, type SupabasePublicEnv } from "../../../artifacts/kub/src/lib/supabase/config";

// All identities and both external ports below are fictional. No native SDK is exercised.
export const CHOICE_SESSION = "22222222-2222-4222-8222-000000000001";
export const CHOICE_DEVICE = "33333333-3333-4333-8333-000000000001";
const CONTEXT = "44444444-4444-4444-8444-000000000001";
type Choice = "none" | "sender" | "message";
type Theme = "dark" | "light";
export type WireSnapshot = {
  capabilities: number; contexts: number; begins: number; confirms: number; retires: number;
  retireAcks: number;
  pending: number | null; confirmed: Choice; terminal: boolean; protocol: 0;
};
type FictionalPort = {
  selector(): { recipientId: string; recipientSessionId: string; deviceId: string };
  snapshot(): WireSnapshot;
  holdConfirm(): void; releaseConfirm(): void; refuseNextBegin(): void;
};
type FixtureWindow = Window & { __qaChoiceFictionalPort: FictionalPort };
const fixtureOrigins = new WeakMap<Page, string>();

export async function choiceWireSnapshot(page: Page): Promise<WireSnapshot> {
  return page.evaluate(() => {
    const port = (window as unknown as FixtureWindow).__qaChoiceFictionalPort;
    if (!port || typeof port.snapshot !== "function") throw Error("FICTIONAL_PORT_UNAVAILABLE");
    return port.snapshot();
  });
}
export async function choiceWireControl(page: Page, action: "holdConfirm" | "releaseConfirm" | "refuseNextBegin") {
  await page.evaluate(value => {
    const port = (window as unknown as FixtureWindow).__qaChoiceFictionalPort;
    if (!port || typeof port[value] !== "function") throw Error("FICTIONAL_PORT_UNAVAILABLE");
    port[value]();
  }, action);
}

export async function calibrateQaChoicePorts(page: Page, expectedArmed = true) {
  // Read-only calibration through actual Task1 adapters; never calls hook.setChoice or a preference writer.
  const observed = await page.evaluate(async () => {
    const adapterPath = "/src/lib/platform/nativeMessagePreviews.ts";
    const storePath = "/src/store/app.store.ts";
    const { nativeMessagePreviewQaChoiceBridge, readNativeMessagePreviewCandidate } = await import(adapterPath);
    const { useAppStore } = await import(storePath);
    const port = (window as unknown as FixtureWindow).__qaChoiceFictionalPort;
    if (!port || typeof port.selector !== "function") throw Error("FICTIONAL_PORT_UNAVAILABLE");
    const binding = port.selector();
    const owner = { ...binding, accountEpoch: useAppStore.getState().accountEpoch };
    const candidate = await readNativeMessagePreviewCandidate();
    const context = await nativeMessagePreviewQaChoiceBridge.getQaUserChoiceContext(owner);
    return { protocol0: candidate?.protocol === 0, armedContext: context?.qa_choice_v === 1
      && context.purpose === "consent-only" && context.recipientId === binding.recipientId
      && context.recipientSessionId === binding.recipientSessionId && context.deviceId === binding.deviceId
      && context.accountEpoch === owner.accountEpoch && context.expiresAt > Date.now() };
  });
  expect(observed, "QA_ADAPTER_CONTEXT_CALIBRATION_BEFORE_FEATURE_ASSERTION").toEqual({ protocol0: true, armedContext: expectedArmed });
}

export async function requireLocalChoiceFixture(page: Page, request: APIRequestContext, baseURL?: string) {
  if (process.env.KUB_QA_ALLOW_MUTATIONS !== "0") throw Error("FIXTURE_MUTATION_FLAG_REFUSED");
  let origin: URL;
  try { origin = new URL(baseURL ?? process.env.KUB_BASE_URL ?? "http://127.0.0.1:5173"); }
  catch { throw Error("FIXTURE_ORIGIN_PARSE_REFUSED"); }
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(origin.hostname)
    || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw Error("FIXTURE_ORIGIN_REFUSED");
  }
  const clientUrl = new URL("/src/lib/supabase/client.ts", origin).href;
  const localGet: APIRequestContext["get"] = async (url, options) => {
    if (new URL(url, origin).href !== clientUrl) throw Error("FIXTURE_PREFLIGHT_URL_REFUSED");
    const response = await request.get(clientUrl, { ...options, maxRedirects: 0 });
    if (response.status() !== 200 || response.url() !== clientUrl) throw Error("FIXTURE_PREFLIGHT_RESPONSE_REFUSED");
    return response;
  };
  // The shared preflight has an unguarded GET; expose only our no-redirect port to it.
  const guardedRequest = new Proxy(request, { get(_target, property) {
    if (property === "get") return localGet;
    throw Error("FIXTURE_PREFLIGHT_METHOD_REFUSED");
  } });
  await requireFixtureServer(guardedRequest);
  const client = await localGet(clientUrl).then(response => response.text());
  requireChosenFixtureConfig(client);
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    // Backend/release doubles registered later may fulfill; unmatched requests never reach a real backend.
    if (url.origin !== origin.origin || url.username || url.password || route.request().redirectedFrom()) {
      return route.abort("blockedbyclient");
    }
    const response = await route.fetch({ maxRedirects: 0 });
    if ((response.status() >= 300 && response.status() < 400) || response.url() !== route.request().url()) {
      throw Error("FIXTURE_BROWSER_REDIRECT_REFUSED");
    }
    return route.fulfill({ response });
  });
  fixtureOrigins.set(page, origin.origin);
}

function requireChosenFixtureConfig(source: string): void {
  const ast = ts.createSourceFile("fixture-client.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const envObjects: ts.ObjectLiteralExpression[] = [];
  const clientCalls: ts.CallExpression[] = [];
  const envAccess = (node: ts.Node): boolean => ts.isPropertyAccessExpression(node)
    && node.name.text === "env" && ts.isMetaProperty(node.expression)
    && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.expression.name.text === "meta";
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && envAccess(node.left)) {
      if (!ts.isObjectLiteralExpression(node.right)) throw Error("FIXTURE_VITE_ENV_SHAPE_REFUSED");
      envObjects.push(node.right);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "createSupabaseClient") {
      clientCalls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (envObjects.length !== 1 || clientCalls.length !== 2) throw Error("FIXTURE_CLIENT_SOURCE_CONTRACT_REFUSED");
  const resolverImports = ast.statements.filter(ts.isImportDeclaration).filter(node =>
    ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "/src/lib/supabase/config.ts"
    && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some(element => element.name.text === "resolveSupabaseConfig"
      && (!element.propertyName || element.propertyName.text === "resolveSupabaseConfig")));
  const resolved = ast.statements.filter(ts.isVariableStatement).flatMap(node => node.declarationList.declarations)
    .filter(node => node.initializer && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "resolveSupabaseConfig");
  if (resolverImports.length !== 1 || resolved.length !== 1) throw Error("FIXTURE_RESOLVER_SOURCE_CONTRACT_REFUSED");
  const declaration = resolved[0];
  const initializer = declaration.initializer;
  if (!initializer || !ts.isCallExpression(initializer) || initializer.arguments.length !== 1
    || !envAccess(initializer.arguments[0]) || !ts.isObjectBindingPattern(declaration.name)
    || declaration.name.elements.length !== 3) throw Error("FIXTURE_RESOLVER_SOURCE_CONTRACT_REFUSED");
  const bindings = declaration.name.elements.map(element => {
    if (element.dotDotDotToken || element.initializer || !element.propertyName || !ts.isIdentifier(element.propertyName)
      || !ts.isIdentifier(element.name)) throw Error("FIXTURE_RESOLVER_SOURCE_CONTRACT_REFUSED");
    return `${element.propertyName.text}:${element.name.text}`;
  }).sort().join(",");
  if (bindings !== "configured:SUPABASE_CONFIGURED,key:SUPABASE_KEY,url:SUPABASE_URL") {
    throw Error("FIXTURE_RESOLVER_SOURCE_CONTRACT_REFUSED");
  }
  const selectedArgument = (node: ts.Expression | undefined, name: string): boolean => !!node
    && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    && ts.isIdentifier(node.left) && node.left.text === name && ts.isStringLiteral(node.right) && node.right.text === "";
  if (clientCalls.some(node => !selectedArgument(node.arguments[0], "SUPABASE_URL")
    || !selectedArgument(node.arguments[1], "SUPABASE_KEY"))) throw Error("FIXTURE_CLIENT_ARGUMENTS_REFUSED");
  const env: SupabasePublicEnv = {};
  const seen = new Set<string>();
  for (const property of envObjects[0].properties) {
    if (!ts.isPropertyAssignment(property) || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) {
      throw Error("FIXTURE_VITE_ENV_SHAPE_REFUSED");
    }
    const key = property.name.text;
    if (seen.has(key)) throw Error("FIXTURE_VITE_ENV_SHAPE_REFUSED");
    seen.add(key);
    if (key !== "VITE_SUPABASE_URL" && key !== "VITE_SUPABASE_PUBLISHABLE_KEY" && key !== "VITE_SUPABASE_ANON_KEY") continue;
    if (!ts.isStringLiteral(property.initializer)) throw Error("FIXTURE_VITE_ENV_SHAPE_REFUSED");
    env[key] = property.initializer.text;
  }
  const selected = resolveSupabaseConfig(env);
  // Never attach selected values/source to an assertion: a refused server may carry private configuration.
  if (!selected.configured || selected.url !== "http://127.0.0.1:54321" || selected.key !== "playwright-public-fixture") {
    throw Error("FIXTURE_SELECTED_PUBLIC_CONFIG_REFUSED");
  }
}

function bodyOf(source: string, name: string) {
  const ast = ts.createSourceFile("served.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const nodes = ast.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name);
  expect(nodes, "exact existing selector port, not a substituted production module").toHaveLength(1);
  expect(nodes[0].body).toBeDefined();
  return { start: nodes[0].body!.getStart(ast), end: nodes[0].body!.getEnd() };
}

function baselineModule(currentModule: string): string {
  const bytes = Buffer.from(BASELINE_HOOK_BASE64, "base64");
  expect(bytes.length).toBe(9117);
  expect(BASELINE_HOOK_BYTES).toBe(9117);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("6c3fce41a5175b7a6e63f09f13143e7204beb5b4eebc41d1c89a3c0bfd9e11e2");
  expect(BASELINE_HOOK_SHA256).toBe("6c3fce41a5175b7a6e63f09f13143e7204beb5b4eebc41d1c89a3c0bfd9e11e2");
  const ast = ts.createSourceFile("served.ts", currentModule, ts.ScriptTarget.Latest, true);
  const reactImports = ast.statements.filter(ts.isImportDeclaration).filter(node => {
    const value = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : "";
    return value === "react" || /\/react\.js(?:\?|$)/.test(value);
  });
  expect(reactImports, "baseline must share the application's actual React module").toHaveLength(1);
  const reactUrl = (reactImports[0].moduleSpecifier as ts.StringLiteral).text;
  const reactDefault = !!reactImports[0].importClause?.name && !reactImports[0].importClause?.namedBindings;
  const aliases: Record<string, string> = {
    "@/store/app.store": "/src/store/app.store.ts",
    "@/lib/supabase/client": "/src/lib/supabase/client.ts",
    "@/lib/platform/nativeMessagePreviews": "/src/lib/platform/nativeMessagePreviews.ts",
    "@/lib/platform/nativeMessagePreviewContract": "/src/lib/platform/nativeMessagePreviewContract.ts",
  };
  const rewriteImports: ts.TransformerFactory<ts.SourceFile> = context => {
    const visit: ts.Visitor = (node: ts.Node): ts.VisitResult<ts.Node> => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const name = node.moduleSpecifier.text;
        const replacement = name === "react" ? reactUrl : aliases[name];
        if (!replacement) throw Error("UNEXPECTED_BASELINE_IMPORT");
        if (name === "react" && reactDefault) {
          const bindings = node.importClause?.namedBindings;
          if (!bindings || !ts.isNamedImports(bindings)) throw Error("UNEXPECTED_BASELINE_REACT_IMPORT");
          const alias = ts.factory.createIdentifier("__qaBaselineReact");
          const clause: ts.ImportClause = ts.factory.createImportClause(undefined, alias, undefined);
          const declaration: ts.ImportDeclaration = ts.factory.createImportDeclaration(
            undefined, clause, ts.factory.createStringLiteral(reactUrl), undefined);
          return [declaration,
          ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([
            ts.factory.createVariableDeclaration(ts.factory.createObjectBindingPattern(bindings.elements.map(element =>
              ts.factory.createBindingElement(undefined, element.propertyName, element.name))), undefined, undefined, alias),
          ], ts.NodeFlags.Const))];
        }
        return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
          ts.factory.createStringLiteral(replacement), node.attributes);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (root: ts.SourceFile): ts.SourceFile => ts.visitEachChild(root, visit, context);
  };
  const transformed = ts.transpileModule(bytes.toString("utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: { before: [rewriteImports] },
    reportDiagnostics: true,
  });
  expect((transformed.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)).toHaveLength(0);
  return transformed.outputText;
}

async function fictionalNativePorts(page: Page, armed: boolean) {
  const origin = fixtureOrigins.get(page);
  if (!origin) throw Error("FIXTURE_PREFLIGHT_REQUIRED");
  await page.route(url => url.pathname === "/src/lib/platform/nativeVoiceCalls.ts", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.username || url.password || route.request().redirectedFrom()) {
      throw Error("FIXTURE_SELECTOR_URL_REFUSED");
    }
    const response = await route.fetch({ maxRedirects: 0 });
    if (response.status() !== 200 || response.url() !== route.request().url()) throw Error("FIXTURE_SELECTOR_RESPONSE_REFUSED");
    const source = await response.text();
    const body = bodyOf(source, "nativeMessagePreviewBindingSnapshot");
    // Only this unprivileged selector is simulated. Registration/verification code stays intact.
    await route.fulfill({ response, body: source.slice(0, body.start)
      + "{ return globalThis.__qaChoiceFictionalPort.selector(); }" + source.slice(body.end) });
  });
  if (process.env.KUB_QA_CHOICE_HOOK === "baseline") {
    await page.route(url => url.pathname === "/src/hooks/useNativeMessagePreview.ts", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.username || url.password || route.request().redirectedFrom()) {
        throw Error("FIXTURE_BASELINE_URL_REFUSED");
      }
      const response = await route.fetch({ maxRedirects: 0 });
      if (response.status() !== 200 || response.url() !== route.request().url()) throw Error("FIXTURE_BASELINE_RESPONSE_REFUSED");
      await route.fulfill({ response, body: baselineModule(await response.text()) });
    });
  } else {
    if ((process.env.KUB_QA_CHOICE_HOOK ?? "current") !== "current") throw Error("FIXTURE_HOOK_MODE_REFUSED");
  }
  await page.addInitScript(({ owner, session, device, contextId, armed }) => {
    const wire = window as unknown as Record<string, unknown>;
    const methods = ["getCapabilities", "getQaUserChoiceContext", "beginQaUserChoice", "confirmQaUserChoice", "retireQaUserChoice"];
    const calls: Record<string, number> = Object.fromEntries(methods.map(name => [name, 0]));
    const expiresAt = Date.now() + 120_000;
    let accountEpoch: number | null = null, intent = 0, pending: number | null = null;
    let terminal = false, confirmed = "none", rejectBegin = false;
    let erasureContext: string | null = armed ? contextId : null;
    let retireAcks = 0;
    let confirmGate: Promise<void> | null = null, releaseConfirm: (() => void) | null = null;
    const expiry = () => { if (Date.now() >= expiresAt) { terminal = true; pending = null; confirmed = "none"; } };
    const port = {
      selector: () => ({ recipientId: owner, recipientSessionId: session, deviceId: device }),
      snapshot: () => { expiry(); return { capabilities: calls.getCapabilities, contexts: calls.getQaUserChoiceContext,
        begins: calls.beginQaUserChoice, confirms: calls.confirmQaUserChoice, retires: calls.retireQaUserChoice,
        retireAcks, pending, confirmed, terminal, protocol: 0 }; },
      holdConfirm: () => { if (confirmGate) throw Error("FICTIONAL_GATE_ALREADY_HELD");
        confirmGate = new Promise<void>(resolve => { releaseConfirm = resolve; }); },
      releaseConfirm: () => { releaseConfirm?.(); confirmGate = null; releaseConfirm = null; },
      refuseNextBegin: () => { rejectBegin = true; },
    };
    wire.__qaChoiceFictionalPort = port;
    wire.androidBridge = { postMessage() {} };
    wire.Capacitor = {
      PluginHeaders: [{ name: "MessagePreviews", methods: methods.map(name => ({ name, rtype: "promise" })) }],
      nativePromise: async (plugin: string, method: string, input: Record<string, unknown> = {}) => {
        if (plugin !== "MessagePreviews" || !methods.includes(method)) throw Error("UNEXPECTED_FICTIONAL_NATIVE_METHOD");
        calls[method]++; expiry();
        if (method === "getCapabilities") return { protocol: 0 };
        if (method === "getQaUserChoiceContext") {
          if (!armed || terminal || input.recipientId !== owner || input.recipientSessionId !== session
            || input.deviceId !== device || !Number.isSafeInteger(input.accountEpoch) || (input.accountEpoch as number) < 0) return { qa_choice_v: 0 };
          accountEpoch ??= input.accountEpoch as number;
          if (input.accountEpoch !== accountEpoch) return { qa_choice_v: 0 };
          return { qa_choice_v: 1, purpose: "consent-only", contextId, recipientId: owner,
            recipientSessionId: session, deviceId: device, accountEpoch, expiresAt };
        }
        const revision = input.revision as number;
        if (!armed || input.contextId !== contextId || !Number.isSafeInteger(revision) || revision <= 0) return { applied: false };
        if (method === "retireQaUserChoice") {
          if (input.contextId !== erasureContext || input.expectedIntentRevision !== intent || revision <= intent) return { applied: false };
          terminal = true; pending = null; confirmed = "none"; intent = revision;
          erasureContext = null;
          retireAcks++;
          return { applied: true };
        }
        if (terminal) return { applied: false };
        if (method === "beginQaUserChoice") {
          if (rejectBegin) { rejectBegin = false; return { applied: false }; }
          if (revision <= intent) return { applied: false };
          intent = revision; pending = revision; confirmed = "none";
          return { applied: true };
        }
        if (pending !== revision || !["none", "sender", "message"].includes(input.choice as string)) return { applied: false };
        pending = null; confirmed = input.choice as string;
        // The action applies before its ACK is held/lost, as on an uncertain remote boundary.
        if (confirmGate) await confirmGate;
        return { applied: true };
      },
    };
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "kub-auth") {
        const auth = JSON.parse(value);
        auth.access_token = "fictional." + btoa(JSON.stringify({ sub: owner, session_id: session,
          role: "authenticated", is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 3600 })) + ".fictional";
        value = JSON.stringify(auth);
      }
      return original.call(this, key, value);
    };
  }, { owner: ME.id, session: CHOICE_SESSION, device: CHOICE_DEVICE, contextId: CONTEXT, armed });
}

export async function openChoiceSettings(page: Page, options: { armed?: boolean; theme?: Theme } = {}) {
  await fictionalNativePorts(page, options.armed ?? true);
  let level: Choice = "none", refuseWrite = false, releaseWrite: (() => void) | undefined;
  let heldWrite: Promise<void> | undefined;
  const writes: Choice[] = [], rpcArgs: unknown[] = [];
  await openSettingsScreen(page, { theme: options.theme, rpc(name, args) {
    if (name !== "native_message_preview_capability") return undefined;
    rpcArgs.push(args);
    expect(args).toEqual({ p_device_id: "33333333-3333-4333-8333-000000000001" });
    return { body: [{ preview_v: 1, recipient_id: ME.id, session_id: CHOICE_SESSION,
      device_id: CHOICE_DEVICE, preview_level: level }] };
  } });
  await page.route(`${FIXTURE_HOST}/rest/v1/notification_preview_preferences**`, async route => {
    expect(route.request().method()).toBe("POST");
    const row = route.request().postDataJSON();
    expect(Object.keys(row).sort()).toEqual(["preview_level", "user_id"]);
    expect(row.user_id).toBe("11111111-1111-4111-8111-000000000001");
    expect(["none", "sender", "message"]).toContain(row.preview_level);
    expect(route.request().headers().prefer).toContain("return=representation");
    expect(new URL(route.request().url()).searchParams.get("select")).toBe("user_id,preview_level");
    writes.push(row.preview_level);
    if (refuseWrite) { refuseWrite = false; return route.fulfill({ status: 403, contentType: "application/json",
      body: JSON.stringify({ code: "42501", message: "fictional owner-row refusal" }) }); }
    level = row.preview_level;
    const gate = heldWrite; heldWrite = undefined;
    if (gate) await gate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([row]) });
  });
  return {
    row: page.getByTestId("native-message-preview-setting"), writes, rpcArgs,
    savedServerChoice: () => level,
    holdNextWrite: () => { if (heldWrite || releaseWrite) throw Error("FICTIONAL_WRITE_ALREADY_HELD");
      heldWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
      return () => { releaseWrite?.(); releaseWrite = undefined; }; },
    refuseNextWrite: () => { refuseWrite = true; },
  };
}
