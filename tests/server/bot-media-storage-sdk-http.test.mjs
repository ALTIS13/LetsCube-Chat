import test from "node:test";
import { runStorageSdkHttpCase } from "./bot-media-storage-sdk-http.fixture.mjs";

for (const mode of ["ok", "equal", "changed", "short", "oversize", "get-reset", "put-reset", "denied", "malformed"]) {
  test(`actual Storage SDK HTTP preserves bounded upload intent (${mode})`, { timeout: 10000 },
    t => runStorageSdkHttpCase(t, mode));
}
