import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";

const api = new URL("../../artifacts/api-server/", import.meta.url);
const require = createRequire(new URL("package.json", api));
const { build } = require("esbuild");
const repository = await readFile(new URL("src/bot/repository.ts", api), "utf8");
const identity = { idempotencyKey: "fictional-mutation-01", requestFingerprint: "a".repeat(64) };
const command = { botId: "e5070000-0000-4000-8000-000000000003",
  chatId: "e5070000-0000-4000-8000-000000000004", kind: "text", payload: { text: "Fictional" }, ...identity };

function replaceOne(source, from, to) {
  assert.equal(source.split(from).length, 2, "mutation compiles exactly the intended rule");
  return source.replace(from, to);
}

async function compiled(source) {
  const output = await build({
    stdin: { contents: 'export {createBotMethodRepository} from "./src/bot/repository.ts"; export {toBotApiErrorResponse} from "./src/bot/errors.ts";',
      resolveDir: fileURLToPath(api) },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "owned-rule-mutant", setup(builder) {
      builder.onLoad({ filter: /[\\/]bot[\\/]repository\.ts$/ }, () => ({ contents: source, loader: "ts" }));
    } }],
  });
  const module = { exports: {} };
  runInThisContext(`(function(require,module,exports){${output.outputFiles[0].text}\n})`)(require, module, module.exports);
  return module.exports;
}

// Exercise the compiled real repository and mapper, not a second classifier.
// The only double is the database response; no tokens, HTTP or Storage here.
async function oracle(source) {
  const { createBotMethodRepository, toBotApiErrorResponse } = await compiled(source);
  let code = "55P03", calls = 0;
  const r = createBotMethodRepository({ async rpc() { calls++; return { data: null,
    error: { code, message: "Fictional private detail", hint: "Fictional private hint" } }; } });
  const expect = async (invoke, status, expectedCode) => {
    const before = calls;
    await assert.rejects(invoke, (error) => {
      assert.deepEqual(toBotApiErrorResponse(error, "fictional-mutant"), {
        status, body: { ok: false, error: { code: expectedCode,
          message: status === 503 ? "Service unavailable" : "Internal server error",
          request_id: "fictional-mutant", ...(status === 503 ? { retry_after: 2 } : {}) } },
      });
      return true;
    });
    assert.equal(calls, before + 1, "exactly one RPC, never internal retry");
  };
  await expect(() => r.executeMessageCommand(command), 503, "service_unavailable");
  await expect(() => r.executeMessageCommand({ ...command, kind: "unknown" }), 500, "internal_error");
  await expect(() => r.executeMessageCommand({ ...command, requestFingerprint: "invalid" }), 500, "internal_error");
  await expect(() => r.executeMessageCommand({ ...command, idempotencyKey: "short" }), 500, "internal_error");
  await expect(() => r.replaceCommands({ botId: command.botId, commands: [], ...identity }), 500, "internal_error");
  code = "XX000";
  await expect(() => r.executeMessageCommand(command), 500, "internal_error");
}

test("compiled original satisfies the literal message-only busy contract", () => oracle(repository));
for (const [name, mutate] of [
  ["retry delay", (s) => replaceOne(s, 'new BotApiError("service_unavailable", 2)', 'new BotApiError("service_unavailable", 3)')],
  ["exact SQLSTATE", (s) => replaceOne(s, 'case "55P03":', 'case "55P02":')],
  ["fingerprint boundary", (s) => replaceOne(s, '!TOKEN_HASH_RE.test(args.p_request_fingerprint)', 'false')],
  ["idempotency boundary", (s) => replaceOne(s, '!/^[A-Za-z0-9._:-]{8,128}$/.test(args.p_idempotency_key)', 'false')],
  ["command-list expansion", (s) => replaceOne(s, 'case "bot_media_ingest_commit_internal":', 'case "bot_commands_replace_internal":\n    case "bot_media_ingest_commit_internal":')],
  ["message-method expansion", (s) => replaceOne(s, '"editMessageText", "deleteMessage"].includes(args.p_method as string)', '"editMessageText", "deleteMessage"].length > 0')],
]) test(`compiled ${name} mutant is rejected by literal consumer assertions`, async () => {
  await assert.rejects(() => oracle(mutate(repository)), (error) => error.code === "ERR_ASSERTION");
});
