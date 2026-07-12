import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("Electron is retired from the Windows distribution", () => {
  const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const scripts = Object.values(root.scripts ?? {}).join("\n");
  const dependencies = {
    ...(root.dependencies ?? {}),
    ...(root.devDependencies ?? {}),
  };

  assert.equal(dependencies.electron, undefined);
  assert.equal(dependencies["electron-builder"], undefined);
  assert.equal(dependencies["@electron/fuses"], undefined);
  assert.doesNotMatch(scripts, /electron/i);
  assert.equal(existsSync(new URL("../../desktop", import.meta.url)), false);
  assert.equal(existsSync(new URL("../../electron-builder.yml", import.meta.url)), false);
  assert.equal(existsSync(new URL("../../scripts/build-windows-internal.mjs", import.meta.url)), false);
});
