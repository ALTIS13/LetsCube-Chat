import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const redirectPath = resolve(root, "artifacts/kub/src/lib/authRedirect.ts");

function loadRedirect(nativeAndroid) {
  const source = readFileSync(redirectPath, "utf8").replaceAll("import.meta", "import_meta");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    exports: module.exports,
    module,
    import_meta: { env: { BASE_URL: "/" } },
    window: globalThis.window,
    require: (path) => path.includes("androidAppLinks")
      ? { ANDROID_AUTH_CALLBACK_URL: "https://app.letscube.ru/auth/callback" }
      : { isNativeAndroid: () => nativeAndroid },
  });
  return module.exports;
}

test("web auth redirects retain the current same-origin callback", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://preview.letscube.test" } };

  try {
    assert.equal(
      loadRedirect(false).getAuthCallbackUrl(),
      "https://preview.letscube.test/auth/callback",
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("native Android auth redirects use the verified app-link callback", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://preview.letscube.test" } };

  try {
    const redirect = loadRedirect(true);
    assert.equal(redirect.ANDROID_AUTH_CALLBACK_URL, "https://app.letscube.ru/auth/callback");
    assert.equal(redirect.getAuthCallbackUrl(), "https://app.letscube.ru/auth/callback");
  } finally {
    globalThis.window = previousWindow;
  }
});
