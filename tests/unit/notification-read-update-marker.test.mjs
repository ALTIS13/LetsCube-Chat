import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { notificationReadUpdateMarker as marker } from "../e2e/helpers/notificationReadUpdateMarker.cjs";

const path = new URL("../../artifacts/kub/src/hooks/useNotifications.ts", import.meta.url);
const bytes = readFileSync(path), source = bytes.toString();
const branch = "mergeNotificationRows([n], [row], 1)[0]";
function once(text, from, to) {
  assert.equal(text.split(from).length, 2, "mutation targets the actual unique UPDATE boundary");
  return text.replace(from, to);
}
const before = once(source, branch, "row");
const old = { schema: "notification-read-update-consumer/v1", oldConsumerCount: 1, newConsumerCount: 0 };
const current = { schema: "notification-read-update-consumer/v1", oldConsumerCount: 0, newConsumerCount: 1 };
const req = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const esbuild = createRequire(req.resolve("vite"))("esbuild");
function compile(text) {
  const out = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  } });
  assert.equal(out.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  return out.outputText;
}
const minify = text => esbuild.transformSync(compile(text), { loader: "js", minify: true, target: "es2022" }).code;
test.after(() => assert.ok(bytes.equals(readFileSync(path)), "author source was not changed during controls"));

test("calibration actual full hook old/new compiled UPDATE consumers are distinct", () => {
  assert.deepEqual(marker(compile(before)), old);
  assert.deepEqual(marker(compile(source)), current);
});
test("actual full hook production minification preserves old/new consumer association", () => {
  assert.deepEqual(marker(minify(before)), old);
  assert.deepEqual(marker(minify(source)), current);
});
test("wrong event/table/schema and unknown-row insertion cannot be counted", () => {
  for (const bad of [
    once(source, 'event: "UPDATE"', 'event: "DELETE"'),
    once(source, 'event: "UPDATE", schema: "public", table: "notifications"', 'event: "UPDATE", schema: "public", table: "other"'),
    once(source, 'event: "UPDATE", schema: "public"', 'event: "UPDATE", schema: "private"'),
    once(source, 'current() ? prev.map((n) =>', 'current() ? [row, ...prev].map((n) =>'),
    once(source, branch + " : n", branch + " : row"),
  ]) for (const text of [compile(bad), minify(bad)]) assert.throws(() => marker(text), /NOTIFICATION_READ_UPDATE_CONSUMER_NOT_UNIQUE/);
});
test("missing merge and wrong argument/index/setter-row associations refuse", () => {
  for (const replacement of ["n", "mergeOtherRows([n], [row], 1)[0]", "mergeNotificationRows([row], [n], 1)[0]",
    "mergeNotificationRows([n], [row], 2)[0]", "mergeNotificationRows([n], [row], 1)[1]",
    "mergeNotificationRows([n, row], [row], 1)[0]", "mergeNotificationRows([n], [n], 1)[0]"]) {
    const bad = once(source, branch, replacement);
    for (const text of [compile(bad), minify(bad)]) assert.throws(() => marker(text), /NOTIFICATION_READ_UPDATE_CONSUMER_NOT_UNIQUE/);
  }
  const bad = once(source, "n.id === row.id", "n.id === row.created_at");
  assert.throws(() => marker(minify(bad)), /NOTIFICATION_READ_UPDATE_CONSUMER_NOT_UNIQUE/);
});
test("generic read_at noise does not inflate markers; duplicate consumers and malformed JS refuse", () => {
  const noise = '\nconst unrelated = "postgres_changes UPDATE notifications read_at mergeNotificationRows";\n';
  assert.deepEqual(marker(minify(before) + noise), old);
  assert.deepEqual(marker(minify(source) + noise), current);
  assert.throws(() => marker(noise), /NOTIFICATION_READ_UPDATE_CONSUMER_NOT_UNIQUE/);
  assert.throws(() => marker(compile(source) + compile(source)), /NOTIFICATION_READ_UPDATE_CONSUMER_NOT_UNIQUE/);
  assert.throws(() => marker("function {"), /NOTIFICATION_READ_UPDATE_JS_PARSE_REFUSED/);
});
