import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const filename = new URL("../../artifacts/kub/src/components/chat/ChatWindow.tsx", import.meta.url);

// Execute the shipped staging callback; the editor is not allowed to create
// a second upload path, and only the unrelated UI/network leaves are replaced.
function staging() {
  const source = readFileSync(filename, "utf8");
  const tree = ts.createSourceFile("ChatWindow.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "stageFiles" && node.initializer && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(expression, "actual stageFiles callback missing");
  const encoded: File[] = [];
  const located: File[] = [];
  const result: any[] = [];
  let active = true;
  const env: Record<string, any> = {
    DEFAULT_PHOTO_SEND_QUALITY: "original", DEFAULT_MEDIA_QUALITY: "balanced",
    MAX_STAGED_ATTACHMENTS: 10, stagedAttachmentsRef: { current: [] },
    uploadScope: { capture: () => 1, isActive: () => active },
    runScopedStagedPreparation: async (_scope: unknown, _token: unknown, work: () => Promise<any>) => ({ status: "completed", value: await work() }),
    planAttachmentPreparation: (_type: string, compress: boolean) => compress ? "compress" : "original",
    prepareChatImageAttachment: async (file: File) => { encoded.push(file); return { file, dimensions: { width: 80, height: 60 } }; },
    removeLocation: async (file: File) => { located.push(file); return { file }; },
    readMediaDimensions: async () => ({ width: 80, height: 60 }),
    originalLimitMessage: () => null, validateStagedAttachment: () => null,
    shouldBuildOriginalPreview: () => false, prepareOriginalPreview: async () => null,
    originalPreviewDimensions: () => ({ width: 80, height: 60 }),
    createStagedAttachment: (file: File, metadata: unknown) => ({ file, metadata }),
    revokeAttachmentPreview: () => {},
    commitPreparedStagedAttachments: (_s: unknown, _t: unknown, items: unknown[], commit: (items: unknown[]) => void) => { commit(items); return true; },
    setStagedAttachments: (update: (items: any[]) => any[]) => { result.splice(0, result.length, ...update([])); },
    showAppAlert: () => {},
  };
  const code = ts.transpileModule(`(function(${Object.keys(env).join(",")}) { return (${expression.getText(tree)}); })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const stage = runInThisContext(code)(...Object.values(env));
  return { stage, encoded, located, result, retire: () => { active = false; } };
}

test("the exact edited File bypasses a second photo encode but keeps location stripping and real dimensions/quality", async () => {
  const h = staging();
  const edited = new File(["baked-mask"], "edited.png", { type: "image/png" });
  await h.stage([edited], "library", { photoQuality: "compact", preparedPhotos: new Map([[edited, { width: 240, height: 120, quality: "original" }]]) });
  assert.equal(h.encoded.length, 0, "an applied privacy edit was encoded a second time");
  assert.deepEqual(h.located, [edited], "existing location removal was skipped");
  assert.equal(h.result[0].file, edited);
  assert.equal(h.result[0].metadata.width, 240);
  assert.equal(h.result[0].metadata.height, 120);
  assert.equal(h.result[0].metadata.mediaQuality, "original", "later SD toggle relabeled already baked HD bytes");
});

test("mixed albums prepare only unedited members, and metadata never retains a raw File", async () => {
  const h = staging();
  const edited = new File(["cover"], "edited.png", { type: "image/png" });
  const untouched = new File(["original"], "picked.png", { type: "image/png" });
  await h.stage([edited, untouched], "library", { photoQuality: "compact", preparedPhotos: new Map([[edited, { width: 40, height: 20, quality: "original" }]]) });
  assert.deepEqual(h.encoded, [untouched]);
  assert.deepEqual(h.result.map(row => row.file), [edited, untouched]);
  assert.deepEqual(h.result.map(row => row.metadata.mediaQuality), ["original", "compact"]);
  for (const row of h.result) assert.equal(Object.values(row.metadata).some(value => value instanceof File), false);
});

test("without additional compression never calls a mask an unedited original", async () => {
  const h = staging();
  const edited = new File(["mask"], "edited.png", { type: "image/png" });
  await h.stage([edited], "library", { compress: false, preparedPhotos: new Map([[edited, { width: 40, height: 20, quality: "original" }]]) });
  assert.equal(h.encoded.length, 0);
  assert.equal(h.result[0].metadata.uncompressed, false);
  assert.equal(h.result[0].metadata.mediaQuality, "original");
});

test("a different File with identical name/size cannot borrow another file's prepared status", async () => {
  const h = staging();
  const first = new File(["aaaa"], "same.png", { type: "image/png" });
  const second = new File(["bbbb"], "same.png", { type: "image/png" });
  await h.stage([second], "library", { preparedPhotos: new Map([[first, { width: 40, height: 20, quality: "original" }]]) });
  assert.deepEqual(h.encoded, [second]);
});
