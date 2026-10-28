import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInThisContext } from "node:vm";
import ts from "typescript";

import { prepareMediaAlbumTargets } from "../../artifacts/kub/src/lib/mediaAlbumSend.ts";
import { buildAttachmentMediaMetadata } from "../../artifacts/kub/src/lib/mediaCompression.ts";
import { runOrderedSend, attachmentCaptionFields } from "../../artifacts/kub/src/lib/attachmentSendQueue.ts";
import { createStagedAttachment, revokeAttachmentPreview } from "../../artifacts/kub/src/lib/stagedAttachments.ts";
import { SOURCE_STOP, stopForVideo } from "../../artifacts/kub/src/lib/videoSendSelection.ts";
import { planVideoSend } from "../../artifacts/kub/src/lib/videoTranscode.ts";
import * as videoSelection from "../../artifacts/kub/src/lib/videoSendSelection.ts";
import * as videoLadder from "../../artifacts/kub/src/lib/videoSendLadder.ts";

interface Pick { id: string; file: File; edited?: boolean }

function callerPicks(baked: File, untouched: File) {
  const source = readFileSync(new URL("../../artifacts/kub/src/components/chat/attach/AttachSheet.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("AttachSheet.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expressions = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const name = node.name.getText(tree);
      if (["replacement", "videoPicks", "ladder"].includes(name)) expressions.set(name, node.initializer.getText(tree));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const name of ["replacement", "videoPicks", "ladder"]) assert.ok(expressions.has(name), `actual ${name} wiring missing`);
  const code = ts.transpileModule(`(function(baked, untouched, useVideoSendLadder) {
    const edit = {pick:{id:'edited',kind:'video',file:untouched,edited:false}};
    const result = {file:baked}; const url = 'blob:synthetic'; const selectionScope = 'gallery';
    const replacement = ${expressions.get("replacement")};
    const chosen = [replacement, {id:'picked',kind:'video',file:untouched}, {id:'photo',kind:'image',file:untouched}];
    const videoPicks = ${expressions.get("videoPicks")};
    return ${expressions.get("ladder")};
  })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return runInThisContext(code)(baked, untouched, (picks: Pick[]) => picks) as Pick[];
}

async function governedLadder(picks: Pick[], omitGovernedFilter = false) {
  let source = readFileSync(new URL("../../artifacts/kub/src/hooks/useVideoSendLadder.ts", import.meta.url), "utf8");
  if (omitGovernedFilter) {
    const changed = source.replace("picks.filter(pick => pick.edited !== true)", "picks");
    assert.notEqual(changed, source, "governed-filter omission must reach the actual hook");
    source = changed;
  }
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const reads: File[] = [];
  let facts: unknown;
  let stateIndex = 0;
  const effects: Array<() => unknown> = [];
  // A two-render source harness: execute the real fact effect, then its real
  // count/rungs/summary consumers. React scheduling and pixels are not under test.
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      return [index === 0 ? facts ?? initial : index === 1 ? 480 : initial,
        (next: unknown) => { if (index === 0) facts = next; }];
    },
    useRef: (current: unknown) => ({ current }),
    useEffect: (effect: () => unknown) => { effects.push(effect); },
    useMemo: (calculate: () => unknown) => calculate(),
    useCallback: (callback: unknown) => callback,
  };
  const modules: Record<string, unknown> = {
    react,
    "@/lib/videoSendLadder": videoLadder,
    "@/lib/videoSendSelection": videoSelection,
    "@/lib/videoSource": { readVideoSource: async (file: File) => {
      reads.push(file);
      return { source: { width: file === picks[0]?.file ? 3840 : 1920,
        height: file === picks[0]?.file ? 2160 : 1080, duration: 1, sizeBytes: file.size } };
    } },
    "@/lib/videoTranscodeSupport": { videoTranscodeSupport: async () => ({ available: true, codec: "avc" }),
      canEncodeFrame: async () => true },
    "@/lib/videoTranscode": { planVideoSend, transcodeVideo: async () => { throw new Error("not a send test"); } },
  };
  const exported: Record<string, any> = {};
  runInThisContext(`(function(require,exports){${code}\n})`)((id: string) => {
    assert.ok(id in modules, `unreviewed dependency: ${id}`);
    return modules[id];
  }, exported);
  exported.useVideoSendLadder(picks);
  effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(facts, "actual fact effect did not finish");
  stateIndex = 0;
  return { ladder: exported.useVideoSendLadder(picks), reads };
}

function preparation(picks: Pick[], omitEditedGuard = false) {
  const filename = new URL("../../artifacts/kub/src/hooks/useVideoSendLadder.ts", import.meta.url);
  const source = readFileSync(filename, "utf8");
  const tree = ts.createSourceFile("useVideoSendLadder.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "prepare"
      && node.initializer && ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(expression, "actual ladder prepare callback missing");
  let callback = expression.getText(tree);
  if (omitEditedGuard) {
    const changed = callback.replace("if (pick.edited === true) continue;", "");
    assert.notEqual(changed, callback, "omission must reach the actual callback");
    callback = changed;
  }
  const encoded: File[] = [];
  // Container facts and codec IO are ports; the actual rung/encoding decisions run.
  const env = {
    SOURCE_STOP,
    aliveRef: { current: true }, abortRef: { current: null as AbortController | null },
    selectionRef: { current: { key: 1 } }, picksRef: { current: picks },
    readRef: { current: new Map(picks.map(pick => [pick.id, { file: pick.file,
      video: { id: pick.id, sizeBytes: pick.file.size,
        source: { width: 1920, height: 1080, duration: 1, sizeBytes: pick.file.size } } }])) },
    currentFacts: { encodable: new Set(picks.map(pick => `${pick.id}|480`)) }, stop: 480,
    pairKey: (id: string, rung: number) => `${id}|${rung}`,
    videoTranscodeSupport: async () => ({ available: true, codec: "avc" }),
    stopForVideo, planVideoSend,
    setProgress: () => {},
    transcodeVideo: async (file: File) => {
      encoded.push(file);
      return new File(["second-encode:" + await file.text()], file.name, { type: "video/mp4" });
    },
  };
  const code = ts.transpileModule(`(function(${Object.keys(env).join(",")}) { return (${callback}); })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return { prepare: runInThisContext(code)(...Object.values(env)), encoded };
}

async function mixedAlbum(omitEditedGuard = false) {
  const edited = new File(["exact-baked-trim", new Uint8Array(1_000_000)], "edited.mp4", { type: "video/mp4" });
  const untouched = new File(["unedited-video", new Uint8Array(1_000_000)], "picked.mp4", { type: "video/mp4" });
  const original = new File(["exact-original-png"], "original.png", { type: "image/png" });
  const h = preparation([{ id: "edited", file: edited, edited: true }, { id: "picked", file: untouched }], omitEditedGuard);
  const prepared = await h.prepare([edited, original, untouched]);
  assert.ok(prepared);
  return { h, edited, untouched, original, prepared };
}

test("a mixed album retains the exact baked video File while only its unedited video is encoded", async () => {
  const { h, edited, untouched, original, prepared } = await mixedAlbum();
  assert.deepEqual(h.encoded, [untouched], "the edited rendition was sent through a second lossy encode");
  assert.equal(prepared.files[0], edited);
  assert.equal(prepared.files[1], original);
  assert.notEqual(prepared.files[2], untouched);
  assert.equal(await prepared.files[0].slice(0, 16).text(), "exact-baked-trim");
  assert.equal(await prepared.files[1].text(), "exact-original-png");
  assert.equal(prepared.origins.has(edited), false);
  assert.equal(prepared.origins.get(prepared.files[2]), untouched.size);
});

test("the mixed rendition's DTO and failed-item retry keep bytes, client identity, album order and caption", async () => {
  const { edited, original, prepared } = await mixedAlbum();
  const staged = [
    createStagedAttachment(prepared.files[0], { uncompressed: false, mediaQuality: "balanced" }),
    createStagedAttachment(prepared.files[1], { uncompressed: true }),
    createStagedAttachment(prepared.files[2], { uncompressed: false, mediaQuality: "balanced" }),
  ];
  try {
    const grouped = prepareMediaAlbumTargets(staged);
    const items = grouped.map(item => ({ ...item, ...attachmentCaptionFields(item.id, grouped[0].id, "mixed caption") }));
    const ids = items.map(item => item.clientMessageId);
    const attempts: Array<{ item: typeof items[number]; metadata: Record<string, unknown> | undefined }> = [];
    const uploaded: File[] = [];
    let refuse = true;
    const steps = {
      concurrency: 1, isActive: () => true, isWanted: () => true,
      upload: async (item: typeof items[number]) => {
        uploaded.push(item.file);
        return { path: `owner/chat-${item.id}.bin` };
      },
      insert: async (item: typeof items[number], upload: { path: string }) => {
        attempts.push({ item, metadata: buildAttachmentMediaMetadata(item, upload) });
        return !(item === items[0] && refuse);
      },
    };
    assert.deepEqual((await runOrderedSend(items, steps)).outcomes, ["insert_failed", "sent", "sent"]);
    refuse = false;
    assert.deepEqual((await runOrderedSend([items[0]], steps)).outcomes, ["sent"]);
    const retried = attempts.at(-1)!;
    assert.deepEqual(uploaded, [edited, original, prepared.files[2], edited]);
    assert.equal(retried.item.file, edited);
    assert.equal(await retried.item.file.slice(0, 16).text(), "exact-baked-trim");
    assert.equal(retried.item.clientMessageId, ids[0]);
    assert.equal(retried.item.caption, "mixed caption");
    assert.deepEqual(items.map(item => item.clientMessageId), ids);
    assert.deepEqual(items.map(item => item.albumIndex), [0, 1, 2]);
    assert.deepEqual(items.slice(1).map(item => item.caption), [null, null]);
    assert.equal(retried.metadata?.uncompressed, false);
    assert.equal(retried.metadata?.media_quality, "balanced");
    assert.equal(retried.metadata?.size_bytes, edited.size);
    assert.deepEqual(retried.metadata, attempts[0].metadata);
    assert.deepEqual(attempts.slice(0, 3).map(attempt => attempt.metadata?.album_index), [0, 1, 2]);
    assert.equal(retried.metadata?.album_count, 3);
    assert.equal(retried.metadata?.album_id, items[0].albumId);
    assert.equal(attempts[1].item.file, original);
    assert.equal(attempts[1].metadata?.uncompressed, true);
    assert.equal("media_quality" in attempts[1].metadata!, false);
  } finally { staged.forEach(revokeAttachmentPreview); }
});

test("omitting the loaded edited guard re-encodes the baked File; unedited preparation remains active", async () => {
  const { h, edited, untouched, prepared } = await mixedAlbum(true);
  assert.deepEqual(h.encoded, [edited, untouched]);
  assert.notEqual(prepared.files[0], edited);
  assert.equal(await prepared.files[0].slice(0, 14).text(), "second-encode:");
  assert.equal(prepared.origins.get(prepared.files[0]), edited.size);
  assert.notEqual(prepared.files[2], untouched);
});

test("actual AttachSheet editor replacement and caller forward the edited flag and exact File", () => {
  const baked = new File(["baked"], "edited.mp4", { type: "video/mp4" });
  const untouched = new File(["raw"], "picked.mp4", { type: "video/mp4" });
  const picks = callerPicks(baked, untouched);
  assert.equal(picks.length, 2);
  assert.equal(picks[0].edited, true, "caller discarded actual editor provenance");
  assert.equal(picks[0].file, baked);
  assert.equal(picks[1].file, untouched);
  assert.notEqual(picks[1].edited, true);
});

test("the real hook facts, governed count, stops and summary exclude the caller's baked video", async () => {
  const baked = new File([new Uint8Array(1_000_000)], "edited.mp4", { type: "video/mp4" });
  const untouched = new File([new Uint8Array(1_000_000)], "picked.mp4", { type: "video/mp4" });
  const picks = callerPicks(baked, untouched);
  const { ladder, reads } = await governedLadder(picks);
  assert.equal(ladder.videos, 1, "slider claims to govern the already baked File");
  assert.deepEqual(reads, [untouched]);
  assert.deepEqual(ladder.stops, [480, 720, "source"], "baked 4K source leaked extra slider rungs");
  assert.equal(ladder.summary.label, "480p");
  assert.equal(ladder.summary.encoding, 1);
  assert.equal(ladder.summary.size, videoSelection.stopSummary([{ id: "picked", sizeBytes: untouched.size,
    source: { width: 1920, height: 1080, duration: 1, sizeBytes: untouched.size } }], 480).size);
});

test("an edited-only caller selection offers no governing slider or encoding promise", async () => {
  const baked = new File([new Uint8Array(1_000_000)], "edited.mp4", { type: "video/mp4" });
  const picks = callerPicks(baked, baked).slice(0, 1);
  const { ladder, reads } = await governedLadder(picks);
  assert.equal(ladder.videos, 0);
  assert.deepEqual(ladder.stops, ["source"]);
  assert.equal(ladder.summary.encoding, 0);
  assert.deepEqual(reads, []);
  assert.equal(ladder.ready && ladder.stops.length > 1, false, "AttachSheet would show an ignored quality control");
});

test("omitting the actual governed filter restores the misleading count, rungs and encoding promise", async () => {
  const baked = new File([new Uint8Array(1_000_000)], "edited.mp4", { type: "video/mp4" });
  const untouched = new File([new Uint8Array(1_000_000)], "picked.mp4", { type: "video/mp4" });
  const { ladder, reads } = await governedLadder(callerPicks(baked, untouched), true);
  assert.equal(ladder.videos, 2);
  assert.deepEqual(reads, [baked, untouched]);
  assert.deepEqual(ladder.stops, [480, 720, 1080, 1440, "source"]);
  assert.equal(ladder.summary.encoding, 2);
});
