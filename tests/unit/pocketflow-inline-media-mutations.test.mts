import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const ADAPTER = await readFile(new URL("../../artifacts/pocketflow/src/transport/letscube.ts", import.meta.url), "utf8");
const TYPES = await readFile(new URL("../../artifacts/pocketflow/src/transport/types.ts", import.meta.url), "utf8");
const CHAT = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222222";

type Mutation = { adapter?: [string, string]; types?: [string, string] };

function change(source: string, replacement?: [string, string]) {
  if (!replacement) return source;
  assert.equal(source.split(replacement[0]).length - 1, 1, "mutation target must be unique");
  return source.replace(...replacement);
}

async function withAdapter(mutation: Mutation, probe: (Adapter: any) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "letscube-pf-inline-"));
  try {
    const typesPath = join(root, "types.mts");
    const adapterPath = join(root, "letscube.mts");
    await writeFile(typesPath, change(TYPES, mutation.types));
    await writeFile(adapterPath, change(ADAPTER, mutation.adapter).replace('"#pf/transport/types"', JSON.stringify(pathToFileURL(typesPath).href)));
    await probe((await import(pathToFileURL(adapterPath).href)).LetscubeTransport);
  } finally {
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}letscube-pf-inline-`));
    await rm(root, { recursive: true, force: true });
  }
}

function fixture(Adapter: any, failures = 0, failureCode = "internal_error") {
  const requests: Record<string, unknown>[] = [];
  const bot = new Adapter({
    baseUrl: "https://example.invalid", token: "synthetic-test-token", sleep: async () => {}, maxAttempts: 3,
    fetchImpl: async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      if (requests.length <= failures) return Response.json({ ok: false, error: { code: failureCode } }, { status: 500 });
      return Response.json({ ok: true, result: { message_id: MESSAGE, chat_id: CHAT, created_at: "2026-10-02T12:00:00Z", duplicate: false } });
    },
  });
  return { bot, requests };
}

const options = (size = 1) => ({ chatId: CHAT, kind: "photo", mimeType: "image/png", bytes: Buffer.alloc(size, 1), idempotencyKey: "stable-probe-01" });

const cases: { name: string; mutation: Mutation; probe: (Adapter: any) => Promise<void> }[] = [
  {
    name: "raises byte ceiling by one",
    mutation: { adapter: ["const MAX_INLINE_BYTES = 6 * 1024 * 1024;", "const MAX_INLINE_BYTES = 6 * 1024 * 1024 + 1;"] },
    probe: async (Adapter) => {
      const { bot } = fixture(Adapter);
      await assert.rejects(() => bot.sendBytes(options(6_291_457)), { code: "validation_failed" });
    },
  },
  {
    name: "lowers byte ceiling by one",
    mutation: { adapter: ["const MAX_INLINE_BYTES = 6 * 1024 * 1024;", "const MAX_INLINE_BYTES = 6 * 1024 * 1024 - 1;"] },
    probe: async (Adapter) => {
      const { bot } = fixture(Adapter);
      await assert.doesNotReject(() => bot.sendBytes(options(6_291_456)));
    },
  },
  {
    name: "retries an exhausted quota",
    mutation: { types: ['if (this.code === "quota_exceeded") return false;', 'if (this.code === "quota_exceeded") return true;'] },
    probe: async (Adapter) => {
      const { bot, requests } = fixture(Adapter, 3, "quota_exceeded");
      await assert.rejects(() => bot.sendBytes(options()), { code: "quota_exceeded" });
      assert.equal(requests.length, 1);
    },
  },
  {
    name: "mints a new key inside the retry loop",
    mutation: { adapter: ["return await this.#attempt(method, body, signal);", "return await this.#attempt(method, { ...body, idempotency_key: this.#idempotencyKey() }, signal);"] },
    probe: async (Adapter) => {
      const { bot, requests } = fixture(Adapter, 1);
      await bot.sendBytes(options());
      assert.equal(requests[0].idempotency_key, "stable-probe-01");
      assert.equal(requests[1].idempotency_key, "stable-probe-01");
    },
  },
  {
    name: "drops the unknown-field guard",
    mutation: { adapter: ["Object.keys(value).some((key) => !INLINE_OPTION_KEYS.has(key))", "false"] },
    probe: async (Adapter) => {
      const { bot } = fixture(Adapter);
      await assert.rejects(() => bot.sendBytes({ ...options(), topicId: MESSAGE }), { code: "validation_failed" });
    },
  },
  {
    name: "accepts an image as video",
    mutation: { adapter: ['video: ["video/mp4", "video/webm"],', 'video: ["video/mp4", "video/webm", "image/png"],'] },
    probe: async (Adapter) => {
      const { bot } = fixture(Adapter);
      await assert.rejects(() => bot.sendBytes({ ...options(), kind: "video" }), { code: "validation_failed" });
    },
  },
];

test("all literal regression probes pass against an isolated unmodified adapter", async () => {
  await withAdapter({}, async (Adapter) => { for (const entry of cases) await entry.probe(Adapter); });
});

for (const entry of cases) {
  test(`regression probes kill a mutant that ${entry.name}`, async () => {
    await assert.rejects(() => withAdapter(entry.mutation, entry.probe), { code: "ERR_ASSERTION" });
  });
}
