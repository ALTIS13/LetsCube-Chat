import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertMediaRestoreReferenceReceipt } from "./media-restore-reference.contract.mjs";

// These are fictional source receipts, not Docker/PG/native success evidence.
const expectedImage = () => ({ imageSha256: "9".repeat(64), postgresVersion: "17.6" });
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rawDdl = "CREATE TABLE fictional(id integer CHECK (((id > 0))));";
const parsedDdl = "CREATE TABLE fictional(id integer CHECK ((id > 0)));";
const nativeDefaults = () => [{ schema: "fictional", type: "r",
  acl: ["fictional_owner=arwdDxt/fictional_owner", "fictional_reader=r/fictional_owner"] }];
function fixture() {
  const source = { containerId: "1".repeat(64), owner: "fictional-live-owner", name: "fictional-live",
    ...expectedImage() };
  const native = {
    constraints: digest([{ name: "fictional_check", validated: true, expression: "id > 0" }]),
    policies: digest([{ roles: ["fictional_reader"], using: "id > 0", withCheck: null }]),
    defaults: digest(nativeDefaults()),
    extensionInitialPrivileges: digest([{ extension: "fictional_extension", acl: null }]),
    extensionCurrentPrivileges: digest([{ extension: "fictional_extension", acl: [] }]),
    roleBootstrap: digest([{ role: "fictional_owner", attributes: ["NOLOGIN"], memberships: [] }]),
    provenance: digest({ source: "fictional-live", immutableCapture: "fixture-only" }),
    permissions: digest([{ kind: "relation", owner: "fictional_owner", acl: null }]),
    roles: digest([{ role: "fictional_reader", settings: [] }]),
    copiedRows: digest([{ id: "fictional-row", multiplicity: 2 }])
  };
  const captureBefore = { source, ddlSha256: digest(rawDdl), catalogSha256: digest(native), native };
  const identity = (id, suffix) => ({ containerId: id.repeat(64), owner: "fictional-" + suffix + "-owner",
    name: "fictional-" + suffix, ...expectedImage() });
  const isolation = () => ({ network: "none", publishedPorts: [], mounts: [], cronEnabled: false });
  return {
    schemaVersion: 1,
    captureBefore,
    captureAfter: structuredClone(captureBefore),
    backup: { source: structuredClone(source), captureDdlSha256: captureBefore.ddlSha256,
      captureCatalogSha256: captureBefore.catalogSha256, sha256: digest("fictional-backup-bytes") },
    reference: { identity: identity("2", "reference"), isolation: isolation(),
      replay: { origin: "live-before", ddlSha256: captureBefore.ddlSha256 }, ddlSha256: digest(parsedDdl) },
    restore: { identity: identity("3", "restore"), isolation: isolation(),
      input: { origin: "backup", sha256: digest("fictional-backup-bytes") }, ddlSha256: digest(parsedDdl) },
    checks: [
      ...Object.entries(native).map(([name, sha]) => ({ name, passed: true,
        sourceSha256: sha, referenceSha256: sha, restoreSha256: sha })),
      { name: "parserRoundtrip", passed: true, sourceSha256: digest(rawDdl),
        referenceSha256: digest(parsedDdl), restoreSha256: digest(parsedDdl) }
    ]
  };
}
const refused = error => error.code === "MEDIA_RESTORE_REFERENCE_REFUSED";
const accept = receipt => assertMediaRestoreReferenceReceipt(receipt, expectedImage());
const mutate = change => { const receipt = fixture(); change(receipt); return receipt; };
const mustRefuse = receipt => assert.throws(() => accept(receipt), refused);

test("accepted independent bounded receipt cannot admit full restore or runtime", () => {
  const receipt = fixture(), before = structuredClone(receipt), pins = expectedImage();
  assert.notEqual(receipt.captureBefore.ddlSha256, receipt.reference.ddlSha256);
  assert.deepEqual(assertMediaRestoreReferenceReceipt(receipt, pins), {
    schemaVersion: 1, boundedReferenceAccepted: true, fullRestoreApproved: false, runtimeApproved: false,
    boundedInventory: ["constraints", "policies", "defaults", "extensionInitialPrivileges",
      "extensionCurrentPrivileges", "roleBootstrap", "provenance"],
    unprovenInventory: "all-other-native-classes"
  });
  assert.deepEqual(receipt, before);
  assert.deepEqual(pins, { imageSha256: "9".repeat(64), postgresVersion: "17.6" });
});

test("circular live-reference from backup or restored DDL is refused", () => {
  for (const origin of ["backup", "restored", "reference", "live-after", null]) {
    mustRefuse(mutate(r => { r.reference.replay.origin = origin; }));
  }
  mustRefuse(mutate(r => { r.reference.replay.ddlSha256 = r.backup.sha256; }));
  mustRefuse(mutate(r => { r.reference.replay.ddlSha256 = r.restore.ddlSha256; }));
});

test("immutable source captures and backup provenance must agree exactly", () => {
  for (const change of [
    r => { r.captureAfter.ddlSha256 = digest("drift"); },
    r => { r.captureAfter.catalogSha256 = digest("drift"); },
    r => { r.captureAfter.native.roles = digest("drift"); },
    r => { r.captureAfter.source.owner = "fictional-other"; },
    r => { r.backup.source.name = "fictional-other"; },
    r => { r.backup.source.containerId = "4".repeat(64); },
    r => { r.backup.captureDdlSha256 = digest("drift"); },
    r => { r.backup.captureCatalogSha256 = digest("drift"); },
    r => { r.restore.input.sha256 = digest("drift"); },
    r => { r.restore.input.origin = "live-before"; }
  ]) mustRefuse(mutate(change));
});

test("closed records reject absent or extra fields at every receipt level", () => {
  const paths = [[], ["captureBefore"], ["captureBefore", "source"], ["captureBefore", "native"],
    ["captureAfter"], ["captureAfter", "source"], ["captureAfter", "native"], ["backup"], ["backup", "source"],
    ["reference"], ["reference", "identity"], ["reference", "isolation"], ["reference", "replay"],
    ["restore"], ["restore", "identity"], ["restore", "isolation"], ["restore", "input"], ["checks", 0]];
  for (const path of paths) {
    mustRefuse(mutate(r => { const record = path.reduce((v, k) => v[k], r); record.extra = true; }));
    mustRefuse(mutate(r => { const record = path.reduce((v, k) => v[k], r); delete record[Object.keys(record)[0]]; }));
  }
});

test("non-JSON structures, malformed nesting and aliasing refuse without invoking accessors", () => {
  for (const receipt of [null, [], "receipt", Object.create({ schemaVersion: 1 })]) mustRefuse(receipt);
  for (const change of [
    r => { r.schemaVersion = 2; },
    r => { r.captureBefore = []; },
    r => { r.captureBefore.native = null; },
    r => { r.checks = {}; },
    r => { r.captureAfter = r.captureBefore; },
    r => { r.backup.source = r.captureBefore.source; },
    r => { r.restore.isolation.mounts = r.reference.isolation.mounts; },
    r => { r.reference.replay = r; },
    r => { r.reference.isolation.publishedPorts.extra = true; },
    r => { delete r.checks[0]; },
    r => { r.checks[Symbol("unexpected")] = true; },
    r => { Object.defineProperty(r, "hidden", { value: true }); }
  ]) mustRefuse(mutate(change));
  let reads = 0;
  mustRefuse(mutate(r => {
    Object.defineProperty(r.reference, "ddlSha256", { enumerable: true, get() { reads++; throw new Error("must not read"); } });
  }));
  assert.equal(reads, 0);
});

test("unexpected inspection failures retain original error rather than becoming refusal", () => {
  const original = new assert.AssertionError({ message: "independent fixture assertion" });
  const receipt = new Proxy(fixture(), { ownKeys() { throw original; } });
  assert.throws(() => accept(receipt), error => error === original);
});

test("hashes are literal lowercase SHA256 and may not be absent, coerced or normalized", () => {
  for (const bad of [null, "", "a".repeat(63), "A".repeat(64), "g".repeat(64), "sha256:" + "a".repeat(64), 123]) {
    mustRefuse(mutate(r => { r.captureBefore.ddlSha256 = bad; }));
    mustRefuse(mutate(r => { r.checks[0].restoreSha256 = bad; }));
    mustRefuse(mutate(r => { r.reference.identity.containerId = bad; }));
  }
});

test("independently supplied literal image and PG17 version bind every identity", () => {
  for (const path of [["captureBefore", "source"], ["captureAfter", "source"], ["backup", "source"],
    ["reference", "identity"], ["restore", "identity"]]) {
    mustRefuse(mutate(r => { path.reduce((v, k) => v[k], r).imageSha256 = "8".repeat(64); }));
    mustRefuse(mutate(r => { path.reduce((v, k) => v[k], r).postgresVersion = "17.7"; }));
  }
  for (const pins of [undefined, null, {}, { ...expectedImage(), extra: true },
    { ...expectedImage(), postgresVersion: "18.4" }, { ...expectedImage(), postgresVersion: "17" },
    { ...expectedImage(), imageSha256: "" }]) {
    assert.throws(() => assertMediaRestoreReferenceReceipt(fixture(), pins), refused);
  }
  assert.throws(() => assertMediaRestoreReferenceReceipt(fixture(), { ...expectedImage(), imageSha256: "8".repeat(64) }), refused);
});

test("source, reference and restore cannot alias container, owner or name identity", () => {
  for (const field of ["containerId", "owner", "name"]) {
    mustRefuse(mutate(r => { r.restore.identity[field] = r.reference.identity[field]; }));
    mustRefuse(mutate(r => { r.reference.identity[field] = r.captureBefore.source[field]; }));
    mustRefuse(mutate(r => { r.restore.identity[field] = r.captureBefore.source[field]; }));
  }
  for (const bad of ["", null, "fictional owner", "../fictional", "fictional\nowner"]) {
    mustRefuse(mutate(r => { r.reference.identity.owner = bad; }));
  }
});

test("both copies require network none, zero ports and mounts, and disabled cron", () => {
  for (const side of ["reference", "restore"]) for (const change of [
    isolation => { isolation.network = "bridge"; },
    isolation => { isolation.publishedPorts.push("5432"); },
    isolation => { isolation.mounts.push("fictional"); },
    isolation => { isolation.publishedPorts = null; },
    isolation => { isolation.mounts = {}; },
    isolation => { isolation.cronEnabled = true; },
    isolation => { isolation.cronEnabled = 0; }
  ]) mustRefuse(mutate(r => { change(r[side].isolation); }));
});

test("missing, extra, duplicate, unknown or nonliteral check outcomes cannot satisfy admission", () => {
  for (let i = 0; i < 11; i++) {
    mustRefuse(mutate(r => { r.checks.splice(i, 1); }));
    for (const passed of [false, null, 1, "true"]) mustRefuse(mutate(r => { r.checks[i].passed = passed; }));
  }
  mustRefuse(mutate(r => { r.checks.push(structuredClone(r.checks[0])); }));
  mustRefuse(mutate(r => { r.checks[1] = structuredClone(r.checks[0]); }));
  mustRefuse(mutate(r => { r.checks[0].name = "wholeCatalog"; }));
  mustRefuse(mutate(r => { r.checks = r.checks.filter(c => c.name === "parserRoundtrip"); }));
  assert.equal(accept(mutate(r => { r.checks.reverse(); })).fullRestoreApproved, false);
});

test("independent native authorities reject reference, restore and reported source drift", () => {
  for (let i = 0; i < 10; i++) for (const field of ["sourceSha256", "referenceSha256", "restoreSha256"]) {
    mustRefuse(mutate(r => { r.checks[i][field] = digest("changed-native-record"); }));
  }
  mustRefuse(mutate(r => {
    const check = r.checks.find(c => c.name === "permissions");
    check.sourceSha256 = check.referenceSha256 = check.restoreSha256 = digest("circular-shared-loss");
  }));
});

test("parser equality alone cannot override source binding or failed native checks", () => {
  mustRefuse(mutate(r => { r.restore.ddlSha256 = digest("changed-parser-output"); }));
  for (const field of ["sourceSha256", "referenceSha256", "restoreSha256"]) {
    mustRefuse(mutate(r => { r.checks.find(c => c.name === "parserRoundtrip")[field] = digest("drift"); }));
  }
  mustRefuse(mutate(r => { r.checks.find(c => c.name === "constraints").passed = false; }));
});

test("native NULL versus empty ACL fingerprints are distinct and never interchangeable", () => {
  const nullHash = digest([{ acl: null }]), emptyHash = digest([{ acl: [] }]);
  assert.notEqual(nullHash, emptyHash);
  for (const [source, restored] of [[nullHash, emptyHash], [emptyHash, nullHash]]) {
    const receipt = fixture();
    receipt.captureBefore.native.defaults = source;
    receipt.captureAfter.native.defaults = source;
    const check = receipt.checks.find(c => c.name === "defaults");
    check.sourceSha256 = check.referenceSha256 = source; check.restoreSha256 = restored;
    mustRefuse(receipt);
    check.restoreSha256 = source;
    assert.equal(accept(receipt).boundedReferenceAccepted, true);
  }
});

test("nested native ACL, policy role and settings order changes retain exact source authority", () => {
  const orderCases = [
    ["defaults", nativeDefaults(), [{ ...nativeDefaults()[0], acl: [...nativeDefaults()[0].acl].reverse() }]],
    ["policies", [{ roles: ["fictional_a", "fictional_b"] }], [{ roles: ["fictional_b", "fictional_a"] }]],
    ["roles", [{ settings: ["fictional.first=one", "fictional.second=two"] }],
      [{ settings: ["fictional.second=two", "fictional.first=one"] }]]
  ];
  for (const [name, before, after] of orderCases) {
    const source = digest(before), restored = digest(after);
    assert.notEqual(source, restored);
    const receipt = fixture();
    receipt.captureBefore.native[name] = source; receipt.captureAfter.native[name] = source;
    const check = receipt.checks.find(c => c.name === name);
    check.sourceSha256 = check.referenceSha256 = source; check.restoreSha256 = restored;
    mustRefuse(receipt);
  }
});

test("frozen inputs are read-only and returned inventory cannot mutate later admission", () => {
  const receipt = fixture(), original = structuredClone(receipt);
  const freeze = value => {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  };
  freeze(receipt);
  const result = accept(receipt);
  result.boundedInventory.push("wholeCatalog");
  assert.deepEqual(accept(receipt).boundedInventory, ["constraints", "policies", "defaults", "extensionInitialPrivileges",
    "extensionCurrentPrivileges", "roleBootstrap", "provenance"]);
  assert.deepEqual(receipt, original);
  const invalid = mutate(r => { r.reference.replay.origin = "backup"; }), before = structuredClone(invalid);
  mustRefuse(invalid); assert.deepEqual(invalid, before);
});

async function compiledMutant(needle, replacement) {
  const source = readFileSync(new URL("./media-restore-reference.contract.mjs", import.meta.url), "utf8");
  assert.equal(source.split(needle).length - 1, 1, "mutant changes exactly one executed predicate");
  const modified = source.replace(needle, replacement);
  assert.notEqual(modified, source);
  const module = await import("data:text/javascript;base64," + Buffer.from(modified).toString("base64"));
  assert.equal(typeof module.assertMediaRestoreReferenceReceipt, "function");
  return module.assertMediaRestoreReferenceReceipt;
}

test("compiled guard mutants make the literal refusal oracle RED without masking adapter failures", async () => {
  const cases = [
    ['reference.replay.origin === "live-before"', "true", r => { r.reference.replay.origin = "backup"; }],
    ["check.passed === true", "true", r => { r.checks[0].passed = false; }],
    ["check.restoreSha256 === before.native[check.name]", "true", r => {
      r.checks.find(c => c.name === "defaults").restoreSha256 =
        digest([{ ...nativeDefaults()[0], acl: [...nativeDefaults()[0].acl].reverse() }]);
    }],
    ["value.isolation.cronEnabled === false", "true", r => { r.reference.isolation.cronEnabled = true; }],
    [".size === 3", ".size >= 1", r => { r.restore.identity.containerId = r.reference.identity.containerId; }]
  ];
  for (const [needle, replacement, change] of cases) {
    const invalid = mutate(change), original = structuredClone(invalid);
    mustRefuse(invalid);
    const candidate = await compiledMutant(needle, replacement);
    assert.throws(() => assert.throws(() => candidate(invalid, expectedImage()), refused), {
      code: "ERR_ASSERTION", message: "Missing expected exception (refused)."
    });
    assert.deepEqual(invalid, original);
  }
  for (const error of [new assert.AssertionError({ message: "unrelated assertion" }),
    Object.assign(new Error("unrelated transport"), { code: "ECONNRESET" })]) {
    assert.throws(() => assert.throws(() => { throw error; }, refused),
      caught => caught.code === "ERR_ASSERTION" && caught.message !== "Missing expected exception (refused).");
  }
});

test("compiled approval mutants fail independent literal false result oracles", async () => {
  for (const field of ["fullRestoreApproved", "runtimeApproved"]) {
    const candidate = await compiledMutant(field + ": false", field + ": true");
    const result = candidate(fixture(), expectedImage());
    assert.throws(() => assert.equal(result[field], false), {
      code: "ERR_ASSERTION", actual: true, expected: false
    });
    assert.equal(accept(fixture())[field], false);
  }
});
