import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * `livekit-client` must never be in the initial bundle.
 *
 * Question 8 of docs/proposals/2026-09-13-voice-channels.md made this a
 * condition of adopting the dependency rather than a hope about it: «12.4 MB
 * unpacked across 636 files, ten transitive dependencies. Add it behind a
 * dynamic `import()` and read the production build's chunk report. If it does
 * not split out of the main chunk, it does not go in.»
 *
 * A source scan would prove nothing here — an `await import()` written
 * correctly still lands in the entry chunk if anything else in the graph
 * imports the module statically, which is precisely the warning Vite printed
 * about `supabase/client.ts` in the same build. So this reads the emitted
 * files.
 *
 * Measured on 2026-09-13 at the commit this was written on: the SDK emitted as
 * `livekit-client.esm-*.js`, 561 kB raw and 148 kB gzipped, with the entry
 * chunk at 2 889 kB — and the only occurrence of the word `RoomEvent` in the
 * entry is the local name our own adapter destructures the dynamic import into.
 *
 * Run `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/kub run build` first; this
 * fails rather than skips when the output is missing or older than its sources,
 * because a skip that reports success is how a bundle regression survives.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const BUILD = path.join(root, "artifacts/kub/dist/public/assets");

/** Sources that decide the answer. A build older than any of them is not evidence. */
const SOURCES = [
  "artifacts/kub/src/hooks/voiceRoom.ts",
  "artifacts/kub/src/hooks/useVoiceCall.ts",
  "artifacts/kub/src/components/chat/ChatWindow.tsx",
  "artifacts/kub/package.json",
].map((file) => path.join(root, file));

/**
 * Strings that exist only inside the SDK's own code.
 *
 * `RoomEvent` and `livekit-client` are deliberately **not** here: the first is
 * a destructured local in our adapter and the second is the import specifier,
 * and both legitimately appear in the entry chunk. A marker that our own code
 * can produce would make this test pass or fail for the wrong reason.
 */
// Three string literals rather than identifiers: minification renames every
// class and function, so `PCTransportManager` — the first candidate tried — was
// absent from a chunk that plainly contained the SDK.
const SDK_ONLY = ["livekit.SignalRequest", "livekit.SignalResponse", "lk_e2ee", "could not establish pc connection"];

/** The DEV-only transport seam. A production bundle must have no path to it. */
const DEV_SEAM = "__letscubeVoiceRoom";

function assets() {
  assert.ok(existsSync(BUILD), `no build at ${BUILD} — run the production build first`);
  return readdirSync(BUILD).filter((name) => name.endsWith(".js"));
}

function read(name) {
  return readFileSync(path.join(BUILD, name), "utf8");
}

test("the build is newer than the sources that decide this", () => {
  const names = assets();
  assert.ok(names.length > 0, "the build produced no JavaScript");
  const newestOutput = Math.max(...names.map((name) => statSync(path.join(BUILD, name)).mtimeMs));
  const newestSource = Math.max(...SOURCES.map((file) => statSync(file).mtimeMs));
  assert.ok(
    newestOutput >= newestSource,
    "artifacts/kub/dist/public is older than the voice sources — rebuild before trusting this file",
  );
});

test("the SDK is emitted as its own chunk", () => {
  const chunks = assets().filter((name) => name.startsWith("livekit-client"));
  assert.equal(chunks.length, 1, `expected exactly one livekit chunk, found ${chunks.join(", ") || "none"}`);
  const body = read(chunks[0]);
  for (const marker of SDK_ONLY) {
    assert.ok(body.includes(marker), `the livekit chunk should contain ${marker}`);
  }
});

test("none of the SDK is in the entry chunk", () => {
  // Proved in both directions: the markers above are present in the SDK's chunk
  // and absent here. An absence on its own would also be satisfied by a marker
  // that never existed.
  const entries = assets().filter((name) => name.startsWith("index-"));
  assert.equal(entries.length, 1, `expected one entry chunk, found ${entries.join(", ") || "none"}`);
  const body = read(entries[0]);
  for (const marker of SDK_ONLY) {
    assert.ok(!body.includes(marker), `the entry chunk must not contain ${marker}`);
  }
  // And it must reach the SDK by a dynamic import of the emitted file, which is
  // what makes the chunk load on a join and not on a page load.
  assert.match(body, /import\("\.\/livekit-client\.esm-[A-Za-z0-9_-]+\.js"\)/);
});

test("the entry chunk is not carrying the SDK's weight", () => {
  const [entry] = assets().filter((name) => name.startsWith("livekit-client"));
  const sdkBytes = statSync(path.join(BUILD, entry)).size;
  // 561 kB when this was written. The bound is loose on purpose — what it
  // catches is the chunk collapsing to a stub while the code moved elsewhere.
  assert.ok(sdkBytes > 200_000, `the livekit chunk is only ${sdkBytes} bytes — has it really been split out?`);
});

test("the DEV-only transport seam is in no emitted file", () => {
  // `import.meta.env.DEV` folds to false in a production build and the branch is
  // dropped. This is the check that says it actually did.
  for (const name of assets()) {
    assert.ok(!read(name).includes(DEV_SEAM), `${name} carries the DEV-only voice seam`);
  }
});
