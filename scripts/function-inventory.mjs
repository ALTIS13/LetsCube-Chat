#!/usr/bin/env node
/**
 * Is the Edge Function on the server the one in this repository?
 *
 * Written on 2026-09-14, the same day the push function turned out to be seven
 * weeks stale and missing its whole Windows sender (D-185). The migrations got
 * `migration-inventory` for the same reason; this is its other half.
 *
 * Two modes, and the split is the point: `--local` hashes what is here and
 * never talks to anything, and `--compare` reads two manifests and reports the
 * difference. The remote manifest comes from one read-only command printed by
 * `--remote-command`, which somebody can read before running it.
 *
 *   node scripts/function-inventory.mjs --local > output/functions-local.txt
 *   node scripts/function-inventory.mjs --remote-command      # prints the ssh line
 *   node scripts/function-inventory.mjs --compare output/functions-local.txt output/functions-remote.txt
 *
 * A manifest line is `<sha256>  <function>/<relative path>`. Nothing but source
 * bytes goes into it: no environment, no secret, no row.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FUNCTIONS = "supabase/functions";

/** The served directory on the production host. */
export const REMOTE_FUNCTIONS =
  "/srv/letscube/platform/supabase-docker/volumes/functions";

/**
 * `main` and `hello` are the runtime's own, not this repository's, so a
 * manifest that named them would report a difference on every run.
 */
export const RUNTIME_OWNED = new Set(["main", "hello"]);

function filesUnder(dir, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) found.push(...filesUnder(full, rel));
    else found.push({ rel, full });
  }
  return found;
}

/** One line per file: the hash of its bytes, and its path inside the function. */
export function localManifest(root = FUNCTIONS) {
  const lines = [];
  for (const fn of readdirSync(root).sort()) {
    if (RUNTIME_OWNED.has(fn)) continue;
    if (!statSync(path.join(root, fn)).isDirectory()) continue;
    for (const { rel, full } of filesUnder(path.join(root, fn))) {
      const hash = createHash("sha256").update(readFileSync(full)).digest("hex");
      lines.push(`${hash}  ${fn}/${rel}`);
    }
  }
  return lines.sort();
}

export function parseManifest(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match) map.set(match[2], match[1]);
  }
  return map;
}

/**
 * What differs. A file the server has and this repository does not is reported
 * as `extra` rather than ignored: that is how three directories came to be
 * serving `index.ts.bak.20260622*` beside the real thing.
 */
export function compareManifests(local, remote) {
  const missing = [];
  const changed = [];
  const extra = [];
  for (const [file, hash] of local) {
    if (!remote.has(file)) missing.push(file);
    else if (remote.get(file) !== hash) changed.push(file);
  }
  for (const file of remote.keys()) {
    if (!local.has(file)) extra.push(file);
  }
  return { missing: missing.sort(), changed: changed.sort(), extra: extra.sort() };
}

function remoteCommand() {
  return [
    "ssh -i ~/.ssh/letscube_ed25519 root@ms.letscube.ru \\",
    `  'cd ${REMOTE_FUNCTIONS} && find . -type f -printf "%P\\n" | sort |`,
    "   grep -vE \"^(main|hello)/\" | xargs -d \"\\n\" sha256sum' \\",
    "  > output/functions-remote.txt",
  ].join("\n");
}

function main() {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === "--local") {
    console.log(localManifest().join("\n"));
    return;
  }
  if (mode === "--remote-command") {
    console.log(remoteCommand());
    return;
  }
  if (mode === "--compare" && a && b) {
    const local = parseManifest(readFileSync(a, "utf8"));
    const remote = parseManifest(readFileSync(b, "utf8"));
    if (local.size === 0 || remote.size === 0) {
      console.error("one of the manifests names no files at all");
      process.exit(2);
    }
    const { missing, changed, extra } = compareManifests(local, remote);
    console.log(`${local.size} files here, ${remote.size} on the server.`);
    for (const [label, list] of [
      ["not deployed", missing],
      ["deployed but different", changed],
      ["on the server and not here", extra],
    ]) {
      console.log(`\n${label}: ${list.length}`);
      for (const file of list) console.log("   -", file);
    }
    if (changed.length + missing.length > 0) process.exitCode = 1;
    return;
  }
  console.error(
    "usage:\n  --local\n  --remote-command\n  --compare <local.txt> <remote.txt>",
  );
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
