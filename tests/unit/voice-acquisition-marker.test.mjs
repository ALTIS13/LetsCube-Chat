import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";
import { voiceAcquisitionMarker } from "../e2e/helpers/voiceAcquisitionMarker.cjs";

const path = new URL("../../artifacts/kub/src/components/chat/MessageInput.tsx", import.meta.url);
const bytes = readFileSync(path);
const source = bytes.toString("utf8");
const hash = value => createHash("sha256").update(value).digest("hex");
const guard = "    if (voiceHoldActiveRef.current) return;\n";
function once(text, from, to) {
  assert.equal(text.split(from).length - 1, 1, "mutation targets the actual unique source boundary");
  return text.replace(from, to);
}
const before = once(source, guard, "");
const oldMarker = { schema: "voice-acquisition-consumer/v1", oldConsumerCount: 1, newConsumerCount: 0 };
const newMarker = { schema: "voice-acquisition-consumer/v1", oldConsumerCount: 0, newConsumerCount: 1 };
function compile(text) {
  const result = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  return result.outputText;
}
test.after(() => assert.ok(bytes.equals(readFileSync(path)), "product source remains unchanged"));

test("actual full MessageInput old/new compiled consumers are uniquely associated", () => {
  assert.equal(hash(before), "6b6598f3fb88494fca0488483a7447b58fcc07942bd1e956230d47253a981dee");
  assert.deepEqual(voiceAcquisitionMarker(compile(before)), oldMarker);
  assert.deepEqual(voiceAcquisitionMarker(compile(source)), newMarker);
});

test("existing production minifier and renamed bindings retain the same old/new association", () => {
  const req = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
  const esbuild = createRequire(req.resolve("vite"))("esbuild");
  for (const [text, want] of [[before, oldMarker], [source, newMarker]]) {
    const minified = esbuild.transformSync(compile(text), { loader: "js", minify: true, target: "es2022" }).code;
    assert.deepEqual(voiceAcquisitionMarker(minified), want);
  }
});

test("wrong-ref late and inverted guards cannot masquerade as accepted old or new", () => {
  for (const text of [
    once(source, guard, "    if (voicePendingStopRef.current) return;\n"),
    once(before, '    if (event.pointerType === "touch") {', guard + '    if (event.pointerType === "touch") {'),
    once(source, guard, "    if (!voiceHoldActiveRef.current) return;\n"),
  ]) assert.throws(() => voiceAcquisitionMarker(compile(text)), /VOICE_ACQUISITION_CONSUMER_NOT_UNIQUE/);
});

test("omitted active assignment start call timer route and actual UI binding refuse", () => {
  for (const text of [
    once(source, "    voiceHoldActiveRef.current = true;\n", ""),
    once(source, "    const started = await voiceHold.start();", "    const started = await voiceHold.stop();"),
    once(source, "        startRecorderHold(recorderMode);", "        stopRecorderHold();"),
    source.replaceAll("onPointerDown={handleRecorderPointerDown}", "onPointerDown={handleRecorderPointerMove}"),
    once(source, "setPointerCapture(event.pointerId)", "setPointerCapture(0)"),
  ]) assert.throws(() => voiceAcquisitionMarker(compile(text)), /VOICE_ACQUISITION_CONSUMER_NOT_UNIQUE/);
});

test("unrelated strings and unbound guards do not inflate consumer counts", () => {
  const noise = '\nconst unrelated = "if (voiceHoldActiveRef.current) return;";\n'
    + 'function unbound(other) { if (other.current) return; }\n';
  assert.deepEqual(voiceAcquisitionMarker(compile(before) + noise), oldMarker);
  assert.deepEqual(voiceAcquisitionMarker(compile(source) + noise), newMarker);
  assert.throws(() => voiceAcquisitionMarker(noise), /VOICE_ACQUISITION_CONSUMER_NOT_UNIQUE/);
});

test("duplicate actual consumers and malformed JavaScript refuse with fixed codes", () => {
  const compiled = compile(source);
  assert.throws(() => voiceAcquisitionMarker(compiled + "\n" + compiled), /VOICE_ACQUISITION_CONSUMER_NOT_UNIQUE/);
  assert.throws(() => voiceAcquisitionMarker("function {"), /VOICE_ACQUISITION_JS_PARSE_REFUSED/);
});
