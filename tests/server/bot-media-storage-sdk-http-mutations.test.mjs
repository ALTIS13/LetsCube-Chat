import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { runStorageSdkHttpCase } from "./bot-media-storage-sdk-http.fixture.mjs";

const api = new URL("../../artifacts/api-server/", import.meta.url);
const require = createRequire(new URL("package.json", api));
const { build } = require("esbuild");
const original = await readFile(new URL("src/bot/repository.ts", api), "utf8");
const change = (source, from, to) => {
  assert.equal(source.split(from).length, 2, "mutation changes exactly one loaded rule");
  return source.replace(from, to);
};
async function compiled(source) {
  const output = await build({
    stdin: { contents: 'export {createBotMethodRepository,createBotServiceClient} from "./src/bot/repository.ts"; export {toBotApiErrorResponse} from "./src/bot/errors.ts";',
      resolveDir: fileURLToPath(api) },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "storage-http-rule-mutant", setup(builder) {
      builder.onLoad({ filter: /[\\/]bot[\\/]repository\.ts$/ }, () => ({ contents: source, loader: "ts" }));
    } }],
  });
  const module = { exports: {} };
  runInThisContext(`(function(require,module,exports){${output.outputFiles[0].text}\n})`)(require, module, module.exports);
  return module.exports;
}

const mutants = [
  ["same-length digest bypass", "changed", s => change(s,
    'hash.digest("hex") !== createHash("sha256").update(input.bytes).digest("hex")', "false")],
  ["short body acceptance", "short", s => change(s,
    'length !== input.bytes.length || hash.digest("hex") !== createHash("sha256").update(input.bytes).digest("hex")', "false")],
  ["lost upload marked acknowledged", "put-reset", s => change(s,
    'await finishUploadAttempt(input, "unknown").catch(() => {});',
    'await finishUploadAttempt(input, "acknowledged").catch(() => {});')],
  ["stream cancellation removed", "oversize", s => change(change(s,
    "      controller.abort();", "      // mutant deliberately omits abort"),
    "      await reader?.cancel().catch(() => {});", "      // mutant deliberately omits cancellation")],
];

test("compiled original satisfies every literal Storage SDK HTTP oracle", { timeout: 15000 }, async t => {
  const implementation = await compiled(original);
  for (const [, mode] of mutants) await runStorageSdkHttpCase(t, mode, implementation);
});
for (const [name, mode, mutate] of mutants) {
  test(`actual HTTP consumer kills compiled ${name} mutant`, { timeout: 15000 }, async t => {
    const implementation = await compiled(mutate(original));
    await assert.rejects(runStorageSdkHttpCase(t, mode, implementation), { code: "ERR_ASSERTION" });
  });
}
