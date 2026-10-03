import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { createClient } = kubRequire("@supabase/supabase-js");

// Load appOutbox itself, including its private send/ACK path and the real store.
// Only device storage, remote fetch and monitoring are replaced in Node.
export function appOutboxHarness({ fetch, storage, mutate, clock } = {}) {
  assert.equal(typeof fetch, "function");
  const loaded = new Set(), timers = new Set(), cache = new Map();
  const RuntimeDate = clock?.now ? class extends Date { static now() { return clock.now(); } } : Date;
  const client = createClient("http://127.0.0.1:54321", "fictional-public-key", {
    accessToken: async () => "fictional-isolated-actor",
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  const stubs = {
    "lib/supabase/client.ts": { createClient: () => client },
    "lib/monitoring.ts": { reportError: () => {} },
  };
  const setTimer = (run, ms) => {
    const handle = clock ? clock.set(run, ms) : setTimeout(run, ms);
    handle?.unref?.();
    timers.add(handle);
    return handle;
  };
  const clearTimer = (handle) => {
    timers.delete(handle);
    if (clock) clock.clear(handle); else clearTimeout(handle);
  };
  const load = (relative) => {
    let filename = path.resolve(root, relative);
    if (!existsSync(filename)) filename += existsSync(`${filename}.ts`) ? ".ts" : ".tsx";
    assert.ok(filename.startsWith(root), "only the owned application module graph");
    const key = path.relative(root, filename).replaceAll("\\", "/");
    if (Object.hasOwn(stubs, key)) return stubs[key];
    if (cache.has(filename)) return cache.get(filename).exports;
    loaded.add(filename);
    let source = readFileSync(filename, "utf8");
    if (mutate) source = mutate(key, source);
    const module = { exports: {} };
    cache.set(filename, module);
    const compiled = ts.transpileModule(source.replaceAll("import.meta.env", "({DEV:false})"), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    }).outputText;
    const require = (name) => {
      if (name.startsWith("@/")) return load(name.slice(2));
      if (name.startsWith(".")) return load(path.relative(root, path.resolve(path.dirname(filename), name)));
      return kubRequire(name);
    };
    runInThisContext(`(function(require,module,exports,setTimeout,clearTimeout,Date){${compiled}\n})`, { filename })(
      require, module, module.exports, setTimer, clearTimer, RuntimeDate,
    );
    return module.exports;
  };
  const storageModule = load("lib/outbox/outboxStorage.ts");
  const deviceStorage = storage ?? storageModule.memoryOutboxStorage();
  stubs["lib/outbox/outboxStorage.ts"] = { ...storageModule, browserOutboxStorage: () => deviceStorage };
  const store = load("store/app.store.ts").useAppStore;
  const outbox = load("lib/outbox/appOutbox.ts").appOutbox;
  return {
    outbox, store, storage: deviceStorage, loaded,
    show(entry) {
      store.getState().setCurrentUser({ id: entry.userId });
      store.getState().addMessage(entry.chatId, {
        id: entry.tempId, chat_id: entry.chatId, user_id: entry.userId,
        content: entry.content, type: entry.type, created_at: entry.clientSentAt,
        client_message_id: entry.clientMessageId, pending: true,
      });
    },
    close() {
      outbox.stop();
      for (const timer of timers) clearTimer(timer);
    },
  };
}

export function fictionalOutboxEntry(overrides = {}) {
  return {
    clientMessageId: "e5070000-0000-4000-8000-000000000201",
    userId: "e5070000-0000-4000-8000-000000000001",
    chatId: "e5070000-0000-4000-8000-000000000005", topicId: null,
    type: "text", content: "Fictional application outbox text", replyToId: null,
    forwardedFromId: null, mediaBucket: null, mediaPath: null, mediaUrl: null,
    clientSentAt: "2026-10-03T00:00:00.000Z", tempId: "fictional-app-outbox-201",
    attempts: 0, nextAttemptAt: 0, ...overrides,
  };
}

export async function flushUntil(check) {
  for (let n = 0; n < 100 && !check(); n++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(check(), "bounded actual application outcome reached");
}

export function postgrestResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
