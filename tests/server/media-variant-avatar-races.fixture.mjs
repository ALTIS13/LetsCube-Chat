import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";

// Actual compiled worker/SDK/sharp; database and Storage replies are fictional.
// Counterexamples, not provider, lifecycle admission or deployed repair proof.
const api = new URL("../../artifacts/api-server/", import.meta.url);
const require = createRequire(new URL("package.json", api));
const { build } = require("esbuild");
const { createClient } = require("@supabase/supabase-js");
const sharp = require("sharp");
export const workerSource = await readFile(new URL("src/workers/mediaVariantsWorker.ts", api), "utf8");
export const ownerId = "73000000-0000-4000-8000-000000000001";
const unrelatedId = "73000000-0000-4000-8000-000000000002";
const messageId = "73000000-0000-4000-8000-000000000003";
const origin = "https://avatar-race.invalid";
const kinds = ["avatar_128", "avatar_256"];
const hash = body => createHash("sha256").update(body).digest("hex");
// Pinned from the local path contract, never computed by the compiled subject.
const literalAvatars = {
  profile: {
    column: "profile_id",
    sources: {
      A: "avatars/73000000-0000-4000-8000-000000000001/avatar-a.png",
      B: "avatars/73000000-0000-4000-8000-000000000001/avatar-b.png",
    },
    targets: {
      A: ["variants/profiles/73000000-0000-4000-8000-000000000001/avatar_128.webp",
        "variants/profiles/73000000-0000-4000-8000-000000000001/avatar_256.webp"],
      B: ["variants/profiles/73000000-0000-4000-8000-000000000001/avatar_128.webp",
        "variants/profiles/73000000-0000-4000-8000-000000000001/avatar_256.webp"],
    },
  },
  chat: {
    column: "chat_id",
    sources: {
      A: "chat-avatars/73000000-0000-4000-8000-000000000001/avatar-a.png",
      B: "chat-avatars/73000000-0000-4000-8000-000000000001/avatar-b.png",
    },
    targets: {
      A: ["variants/chats/73000000-0000-4000-8000-000000000001/a99eefb734daeccc1b841347de266b48/avatar_128.webp",
        "variants/chats/73000000-0000-4000-8000-000000000001/a99eefb734daeccc1b841347de266b48/avatar_256.webp"],
      B: ["variants/chats/73000000-0000-4000-8000-000000000001/20920db7a5726538260b6381382b1d9e/avatar_128.webp",
        "variants/chats/73000000-0000-4000-8000-000000000001/20920db7a5726538260b6381382b1d9e/avatar_256.webp"],
    },
  },
};

function literalContract(scope) {
  assert.ok(Object.hasOwn(literalAvatars, scope), "literal avatar scope");
  return literalAvatars[scope];
}

function linkedRow(row, column) {
  return [row[column], row[column === "profile_id" ? "chat_id" : "profile_id"] ?? null,
    row.message_id ?? null, row.variant_kind, row.source_bucket, row.source_path,
    row.status, row.variant_bucket, row.variant_path];
}

export function changeOnce(source, from, to) {
  assert.equal(source.split(from).length, 2, "candidate changes exactly one actual compiled site");
  return source.replace(from, to);
}

// Deliberately insufficient proposal: an idle reload is NOT atomic with DELETE.
// Kept only to prove why a database publication contract is needed.
export function idleReloadCandidate(source) {
  return changeOnce(source,
    "  await deleteAvatarVariantRow(supabase, owner, variant.kind);",
    `  const { data: current, error: currentError } = await supabase
    .from(owner.scope === "profile" ? "profiles" : "chats")
    .select("id, avatar_url").eq("id", owner.id).maybeSingle();
  if (currentError) throw currentError;
  if (!current || current.avatar_url !== owner.avatar_url) return;
  await deleteAvatarVariantRow(supabase, owner, variant.kind);`);
}

export async function compileAvatarWorker(source = workerSource) {
  const output = await build({
    stdin: { contents: 'export {runMediaVariantsTick} from "./src/workers/mediaVariantsWorker.ts";',
      resolveDir: fileURLToPath(api) },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    logLevel: "silent", metafile: true,
    plugins: [{ name: "avatar-race-source", setup(builder) {
      builder.onLoad({ filter: /[\\/]workers[\\/]mediaVariantsWorker\.ts$/ },
        () => ({ contents: source, loader: "ts" }));
    } }],
  });
  const module = { exports: {} };
  runInThisContext(`(function(require,module,exports){${output.outputFiles[0].text}\n})`)(require, module, module.exports);
  return { ...module.exports, inputs: Object.keys(output.metafile.inputs) };
}

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " exceeded 10 seconds")), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
function matches(row, parameters) {
  for (const [column, value] of parameters) {
    if (["select", "order", "limit"].includes(column)) continue;
    if (value === "is.null") { if (row[column] != null) return false; continue; }
    if (value.startsWith("eq.")) { if (String(row[column]) !== value.slice(3)) return false; continue; }
    if (value.startsWith("in.(") && value.endsWith(")")) {
      if (!value.slice(4, -1).split(",").map(v => v.replace(/^"|"$/g, "")).includes(String(row[column]))) return false;
      continue;
    }
    throw new Error("unstubbed avatar filter " + column);
  }
  return true;
}

export async function avatarRaceFixture(t, implementation, {
  scope = "profile", pause = "put", late = "success", fault = null,
} = {}) {
  assert.ok(["profile", "chat"].includes(scope));
  assert.ok(["get", "put", "delete"].includes(pause));
  const prefix = scope === "profile" ? "avatars" : "chat-avatars";
  const paths = { A: `${prefix}/${ownerId}/avatar-a.png`, B: `${prefix}/${ownerId}/avatar-b.png` };
  const urls = Object.fromEntries(Object.entries(paths).map(([actor, path]) =>
    [actor, `${origin}/storage/v1/object/public/media/${path}`]));
  const bodies = Object.fromEntries(await Promise.all(["A", "B"].map(async actor =>
    [actor, await sharp({ create: { width: 32, height: 32, channels: 3,
      background: actor === "A" ? "#ee2211" : "#1155ee" } }).png().toBuffer()])));
  const column = scope === "profile" ? "profile_id" : "chat_id";
  const owner = { id: ownerId, avatar_url: urls.A, type: "group" };
  const rows = [{ profile_id: unrelatedId, chat_id: null, message_id: null,
    variant_kind: "avatar_128", source_bucket: "media", source_path: "unrelated.png",
    variant_bucket: "media", variant_path: "unrelated.webp", status: "ready" },
    { profile_id: null, chat_id: scope === "chat" ? ownerId : unrelatedId, message_id: messageId,
      variant_kind: "image_thumb", source_bucket: "media", source_path: "message.png",
      variant_bucket: "media", variant_path: "message.webp", status: "ready" }];
  const unrelated = structuredClone(rows);
  const objects = new Map(), requests = [], puts = [], publications = [], failures = [], jobs = [];
  const reached = deferred(), release = deferred();
  let paused = false, failPublication = false, faultUsed = false;
  const injected = new assert.AssertionError({ message: "injected unexpected avatar adapter assertion" });
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
  const wait = async () => {
    if (paused) return;
    paused = true; reached.release(); await release.promise;
  };
  const ownRows = () => rows.filter(r => r[column] === ownerId && r.message_id == null);
  const snapshot = () => ({ scope, owner: structuredClone(owner), rows: structuredClone(ownRows()),
    objects: [...objects.entries()].map(([path, body]) => [path, hash(body)]).sort(),
    puts: structuredClone(puts), publications: structuredClone(publications) });

  function client(actor) {
    let claimAvailable = true;
    const fetch = async (input, init = {}) => {
      try {
        const url = new URL(typeof input === "string" ? input : input.url);
        assert.equal(url.origin, origin);
        const method = (init.method ?? "GET").toUpperCase();
        requests.push({ actor, method, path: url.pathname, search: url.search });
        const payload = () => JSON.parse(init.body);
        if (url.pathname === "/rest/v1/rpc/media_variant_jobs_claim") {
          const args = payload();
          assert.equal(args.p_limit, 12); assert.match(args.p_claim_token, /^[0-9a-f-]{36}$/);
          const result = claimAvailable ? [{ scope, target_id: ownerId, attempts: 0 }] : [];
          claimAvailable = false; return json(result);
        }
        if (["/rest/v1/rpc/media_variant_job_finish", "/rest/v1/rpc/media_variant_job_retry"].includes(url.pathname)) {
          const args = payload(); assert.equal(args.p_scope, scope); assert.equal(args.p_target_id, ownerId);
          return json(true);
        }
        if (url.pathname === `/rest/v1/${scope === "profile" ? "profiles" : "chats"}`) {
          assert.equal(method, "GET"); assert.equal(url.searchParams.get("id"), `eq.${ownerId}`);
          return json(matches(owner, url.searchParams) ? [owner] : []);
        }
        if (url.pathname === "/rest/v1/media_variants") {
          if (method === "GET") return json(rows.filter(row => matches(row, url.searchParams)));
          if (method === "DELETE") {
            if (actor === "A" && pause === "delete") await wait();
            for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], url.searchParams)) rows.splice(i, 1);
            if (actor === "A" && fault === "after-delete") { failPublication = true; reached.release(); }
            return new Response(null, { status: 204 });
          }
          if (method === "POST") {
            const inserted = payload(); assert.equal(inserted[column], ownerId);
            assert.equal(inserted.source_path, paths[actor]);
            if (actor === "A" && fault === "adapter" && !faultUsed) { faultUsed = true; throw injected; }
            if (actor === "A" && failPublication) {
              return json({ code: "XX000", message: "fictional publication unavailable" }, 500);
            }
            rows.push(inserted); publications.push({ actor, row: structuredClone(inserted) });
            return new Response(null, { status: 201 });
          }
        }
        const sourceRoute = `/storage/v1/object/media/${paths[actor]}`;
        if (url.pathname === sourceRoute && method === "GET") {
          if (actor === "A" && pause === "get") await wait();
          if (actor === "A" && late === "missing") return json({ statusCode: "404", error: "not_found", message: "Object not found" }, 404);
          return new Response(bodies[actor], { status: 200, headers: { "content-type": "image/png" } });
        }
        if (url.pathname.startsWith("/storage/v1/object/media/variants/") && method === "POST") {
          const path = decodeURIComponent(url.pathname.slice("/storage/v1/object/media/".length));
          const body = Buffer.from(init.body);
          assert.equal(new Headers(init.headers).get("x-upsert"), "true");
          puts.push({ actor, bucket: "media", path, hash: hash(body) });
          if (actor === "A" && pause === "put") await wait();
          if (actor === "A" && late === "failure") return json({ statusCode: "503", error: "unavailable", message: "fictional upload unavailable" }, 503);
          objects.set(path, body);
          return json({ Key: `media/${path}`, Id: "fictional-object" });
        }
        throw new Error("unstubbed avatar request " + method + " " + url.pathname);
      } catch (error) { failures.push(error); throw error; }
    };
    return createClient(origin, "fictional-avatar-fetch-only", {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
    });
  }
  const run = actor => {
    const job = implementation.runMediaVariantsTick(client(actor), { scan: false });
    jobs.push(job); job.catch(() => {}); return job;
  };
  const assertAdapters = () => assert.deepEqual(failures, [], "unexpected adapter failures cannot count as a safety refusal");
  const assertUnrelated = () => assert.deepEqual(rows.filter(r => !ownRows().includes(r)), unrelated);
  t.after(async () => {
    release.release();
    const settled = await bounded(Promise.allSettled(jobs), "avatar jobs settling");
    for (const result of settled) assert.equal(result.status, "fulfilled", "unexpected worker rejection survives cleanup");
    assertUnrelated();
    if (fault !== "adapter") assertAdapters();
    t.diagnostic(`released/settled ${jobs.length} worker jobs; adapter errors ${failures.length}; unrelated rows unchanged`);
  });
  return { run, owner, rows, ownRows, paths, urls, kinds, objects, puts, requests, publications,
    reached: () => bounded(reached.promise, "avatar barrier"), release: () => release.release(),
    snapshot, assertAdapters, assertUnrelated, failures, injected,
    settled: async () => bounded(Promise.allSettled(jobs), "avatar jobs settling") };
}

export function assertCurrentAvatar(state, expectedSource) {
  const contract = literalContract(state.scope);
  const actor = Object.keys(contract.sources).find(actor => contract.sources[actor] === expectedSource);
  assert.ok(actor, "expected source must be a pinned fictional path");
  assert.equal(state.owner.id, "73000000-0000-4000-8000-000000000001");
  assert.equal(state.rows.length, 2, "both current avatar sizes remain published");
  assert.deepEqual(state.rows.map(row => linkedRow(row, contract.column)).sort(),
    kinds.map((kind, index) => ["73000000-0000-4000-8000-000000000001", null, null,
      kind, "media", contract.sources[actor], "ready", "media", contract.targets[actor][index]]),
    "literal current avatar targets include owner/kind/source/bucket/full path");
}

// Inspect observations outside fetch/worker error mapping: wrong targets must
// fail these assertions, never become apparent permission/upload refusals.
export function assertAvatarTargets(state) {
  const contract = literalContract(state.scope);
  const counts = { A: 0, B: 0 };
  for (const put of state.puts) {
    assert.ok(Object.hasOwn(contract.targets, put.actor), "literal PUT actor");
    const index = counts[put.actor]++;
    assert.ok(index < 2, "one PUT per actor/kind in this bounded schedule");
    assert.deepEqual([put.bucket, put.path], ["media", contract.targets[put.actor][index]],
      "literal avatar PUT target includes owner/kind/full path");
  }
  for (const publication of state.publications) {
    assert.ok(Object.hasOwn(contract.targets, publication.actor), "literal publication actor");
    const row = publication.row;
    const index = kinds.indexOf(row.variant_kind);
    assert.ok(index >= 0, "literal publication kind");
    assert.ok(["ready", "failed"].includes(row.status), "literal publication status");
    assert.deepEqual(linkedRow(row, contract.column),
      ["73000000-0000-4000-8000-000000000001", null, null, kinds[index], "media",
        contract.sources[publication.actor], row.status, "media", contract.targets[publication.actor][index]],
      "literal avatar publication target includes owner/kind/source/bucket/full path");
  }
}

export async function finishOldAfterNew(f) {
  const old = f.run("A"); await f.reached();
  f.owner.avatar_url = f.urls.B;
  await f.run("B");
  const before = f.snapshot(); f.assertAdapters();
  assertAvatarTargets(before); assertCurrentAvatar(before, f.paths.B);
  f.release(); await old; f.assertAdapters(); f.assertUnrelated();
  const after = f.snapshot(); assertAvatarTargets(after);
  return { before, after };
}
