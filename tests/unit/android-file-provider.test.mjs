import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const paths = readFileSync(resolve("android/app/src/main/res/xml/file_paths.xml"), "utf8");
const manifest = readFileSync(resolve("android/app/src/main/AndroidManifest.xml"), "utf8");

test("Android FileProvider exposes only app-owned storage locations", () => {
  assert.match(paths, /<files-path name="files" path="\." \/>/);
  assert.match(paths, /<cache-path name="cache" path="\." \/>/);
  assert.match(paths, /<external-files-path name="external_files" path="\." \/>/);
  assert.match(paths, /<external-cache-path name="external_cache" path="\." \/>/);
  assert.doesNotMatch(paths, /<external-path\b/);
  assert.match(manifest, /android:name="androidx\.core\.content\.FileProvider"[\s\S]*android:exported="false"[\s\S]*android:grantUriPermissions="true"/);
});
