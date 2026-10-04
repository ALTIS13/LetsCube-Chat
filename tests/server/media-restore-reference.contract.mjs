// Action-free receipt validation only. The caller owns immutable capture, native
// execution, frozen expected image pins and exact-copy lifecycle verification.
const identityFields = ["containerId", "owner", "name", "imageSha256", "postgresVersion"];
const nativeNames = ["constraints", "policies", "defaults", "extensionInitialPrivileges",
  "extensionCurrentPrivileges", "roleBootstrap", "provenance", "permissions", "roles", "copiedRows"];
const boundedInventory = ["constraints", "policies", "defaults", "extensionInitialPrivileges",
  "extensionCurrentPrivileges", "roleBootstrap", "provenance"];
const checkNames = [...nativeNames, "parserRoundtrip"];

function requireThat(ok, reason) {
  if (ok) return;
  // Only fixed diagnostics: never include input IDs, names, hashes or payloads.
  const error = new Error("media restore reference receipt refused");
  error.code = "MEDIA_RESTORE_REFERENCE_REFUSED"; error.reason = reason;
  throw error;
}
function record(value, fields, seen) {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "record");
  const prototype = Object.getPrototypeOf(value);
  requireThat(prototype === Object.prototype || prototype === null, "record");
  const keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(keys.length === fields.length && keys.every(key => fields.includes(key)), "closed-schema");
  requireThat(fields.every(key => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value")), "data-only");
  requireThat(!seen.has(value), "alias"); seen.add(value);
  return value;
}
function array(value, length, seen) {
  requireThat(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
    && value.length === length, "array");
  const keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(keys.length === length + 1 && keys.includes("length")
    && Array.from({ length }, (_, i) => String(i)).every(key =>
      descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value")), "closed-array");
  requireThat(!seen.has(value), "alias"); seen.add(value);
}
function sha(value) {
  requireThat(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), "sha256");
}
function identity(value, expected, seen) {
  record(value, identityFields, seen); sha(value.containerId); sha(value.imageSha256);
  for (const field of ["owner", "name"]) {
    requireThat(typeof value[field] === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value[field]), "identity");
  }
  requireThat(value.imageSha256 === expected.imageSha256 && value.postgresVersion === expected.postgresVersion, "image-version");
}
function capture(value, expected, seen) {
  record(value, ["source", "ddlSha256", "catalogSha256", "native"], seen);
  identity(value.source, expected, seen); sha(value.ddlSha256); sha(value.catalogSha256);
  record(value.native, nativeNames, seen);
  for (const name of nativeNames) sha(value.native[name]);
}
function isolatedCopy(value, inputField, expected, seen) {
  record(value, ["identity", "isolation", inputField, "ddlSha256"], seen);
  identity(value.identity, expected, seen); sha(value.ddlSha256);
  record(value.isolation, ["network", "publishedPorts", "mounts", "cronEnabled"], seen);
  requireThat(value.isolation.network === "none" && value.isolation.cronEnabled === false, "isolation");
  array(value.isolation.publishedPorts, 0, seen); array(value.isolation.mounts, 0, seen);
}
const sameIdentity = (a, b) => identityFields.every(field => a[field] === b[field]);

export function assertMediaRestoreReferenceReceipt(receipt, expectedImage) {
  const seen = new WeakSet();
  record(expectedImage, ["imageSha256", "postgresVersion"], seen); sha(expectedImage.imageSha256);
  requireThat(typeof expectedImage.postgresVersion === "string"
    && /^17\.(?:0|[1-9][0-9]*)$/.test(expectedImage.postgresVersion), "expected-pg17-version");
  record(receipt, ["schemaVersion", "captureBefore", "captureAfter", "backup", "reference", "restore", "checks"], seen);
  requireThat(receipt.schemaVersion === 1, "schema-version");
  const { captureBefore: before, captureAfter: after, backup, reference, restore } = receipt;
  capture(before, expectedImage, seen); capture(after, expectedImage, seen);
  record(backup, ["source", "captureDdlSha256", "captureCatalogSha256", "sha256"], seen);
  identity(backup.source, expectedImage, seen);
  for (const field of ["captureDdlSha256", "captureCatalogSha256", "sha256"]) sha(backup[field]);
  requireThat(sameIdentity(before.source, after.source) && sameIdentity(before.source, backup.source), "source-identity");
  requireThat(before.ddlSha256 === after.ddlSha256 && before.catalogSha256 === after.catalogSha256
    && nativeNames.every(name => before.native[name] === after.native[name]), "capture-drift");
  requireThat(backup.captureDdlSha256 === before.ddlSha256
    && backup.captureCatalogSha256 === before.catalogSha256, "backup-provenance");
  isolatedCopy(reference, "replay", expectedImage, seen); isolatedCopy(restore, "input", expectedImage, seen);
  record(reference.replay, ["origin", "ddlSha256"], seen); sha(reference.replay.ddlSha256);
  record(restore.input, ["origin", "sha256"], seen); sha(restore.input.sha256);
  requireThat(reference.replay.origin === "live-before" && reference.replay.ddlSha256 === before.ddlSha256, "reference-source");
  requireThat(restore.input.origin === "backup" && restore.input.sha256 === backup.sha256, "restore-input");
  for (const field of ["containerId", "owner", "name"]) {
    requireThat(new Set([before.source[field], reference.identity[field], restore.identity[field]]).size === 3, "copy-identity-alias");
  }
  requireThat(reference.ddlSha256 === restore.ddlSha256, "parser-output");
  array(receipt.checks, checkNames.length, seen);
  const found = new Set();
  for (const check of receipt.checks) {
    record(check, ["name", "passed", "sourceSha256", "referenceSha256", "restoreSha256"], seen);
    requireThat(checkNames.includes(check.name) && !found.has(check.name), "check-inventory");
    found.add(check.name);
    requireThat(check.passed === true, "check-outcome");
    for (const field of ["sourceSha256", "referenceSha256", "restoreSha256"]) sha(check[field]);
    if (check.name === "parserRoundtrip") {
      requireThat(check.sourceSha256 === before.ddlSha256 && check.referenceSha256 === reference.ddlSha256
        && check.restoreSha256 === restore.ddlSha256, "parser-proof");
    } else {
      requireThat(check.sourceSha256 === before.native[check.name]
        && check.referenceSha256 === before.native[check.name]
        && check.restoreSha256 === before.native[check.name], "native-source-authority");
    }
  }
  requireThat(found.size === checkNames.length, "check-inventory");
  return {
    schemaVersion: 1, boundedReferenceAccepted: true,
    fullRestoreApproved: false, runtimeApproved: false,
    boundedInventory: [...boundedInventory],
    unprovenInventory: "all-other-native-classes"
  };
}
