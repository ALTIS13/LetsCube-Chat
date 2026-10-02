import assert from "node:assert/strict";
import test from "node:test";
import {
  referenceFixture, resolverSignature, urlSignature, known, references, urlPointer, mediaUrl,
  observation, quote, referenceSql, snapshot, allBindings, resolverRollback, resolverSource, authorityCatalog, mutateInstalled,
} from "./bot-message-media-references.fixture.mjs";

test("per-message resolver is available after the accepted logical identity positive control", async t => {
  const db = await referenceFixture(t);
  t.diagnostic("actual local PostgreSQL " + db.version + "; fictional focused fixture, not production");
  const { receipt, identity } = await known(db);
  assert.equal(identity.object_path, receipt.path);
  assert.equal(identity.bucket_id, "chat-media");
  const [catalog] = await db.query(`select to_regprocedure('${resolverSignature}')::text as resolver,
    to_regprocedure('${urlSignature}')::text as url_pointer`);
  assert.notEqual(catalog.resolver, null, "feature-gap RED: accepted stage 1 has no per-message reference resolver");
  assert.notEqual(catalog.url_pointer, null, "bounded URL pointer helper must exist alongside the resolver");
});

test("registered canonical URL and preview are separate exact registry observations without physical proof", async t => {
  const db = await referenceFixture(t), a = await known(db, 2), b = await known(db, 3);
  assert.equal((await db.query("select count(*)::int as n from storage.objects"))[0].n, 0);
  const before = await snapshot(db), bindings = await allBindings(db);
  const rows = await references(db, { bucket: "chat-media", path: a.receipt.path,
    url: mediaUrl(a.receipt.path), metadata: { preview: { path: b.receipt.path, bucket: "ignored-bucket" } } });
  assert.deepEqual(rows, [
    observation("canonical", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null),
    observation("legacy_url", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null),
    observation("preview", "chat-media", b.receipt.path, b.identity.generation_id, "registered", null),
  ]);
  assert.deepEqual(await snapshot(db), before);
  assert.deepEqual(await allBindings(db), bindings);
});

test("canonical literal paths are never decoded trimmed or normalized", async t => {
  const db = await referenceFixture(t), a = await known(db, 4);
  for (const path of [a.receipt.path.replaceAll("/", "%2F"), " " + a.receipt.path + " ",
    "./" + a.receipt.path, a.receipt.path.replace("/bots/", "//bots/"), "literal\\name", "literal?name#part"]) {
    const rows = await references(db, { bucket: "chat-media", path });
    assert.deepEqual(rows, [observation("canonical", "chat-media", path)]);
  }
  for (const bucket of ["media", "avatars", "unrecognized-bucket"]) {
    assert.deepEqual(await references(db, { bucket, path: a.receipt.path }), [observation("canonical", bucket, a.receipt.path)]);
  }
});

test("absent pointers yield no observations while invalid and missing bucket pointers retain holds", async t => {
  const db = await referenceFixture(t);
  for (const input of [{}, { bucket: "chat-media" }, { url: "" }, { metadata: null }, { metadata: {} },
    { metadata: { preview: null } }, { metadata: { unrelated: "ignored" } }]) {
    assert.deepEqual(await references(db, input), [], "empty observation set conveys no deletion authority");
  }
  assert.deepEqual(await references(db, { path: "literal" }), [observation("canonical", null, "literal", null, "unresolved", "missing_bucket")]);
  const blankBucket = await references(db, { bucket: "", path: "literal" });
  assert.equal(blankBucket.length, 1); assert.equal(blankBucket[0].hold_reason, "missing_bucket");
  for (const path of ["", "a".repeat(1025), "\u0416".repeat(513)]) {
    const rows = await references(db, { bucket: "chat-media", path });
    assert.equal(rows.length, 1); assert.equal(rows[0].reference_state, "unresolved");
    assert.equal(rows[0].hold_reason, "invalid_path"); assert.equal(rows[0].generation_id, null);
  }
  for (const path of ["a".repeat(1024), "\u0416".repeat(512)]) {
    assert.deepEqual(await references(db, { bucket: "chat-media", path }), [observation("canonical", "chat-media", path)]);
  }
});

test("metadata and preview malformed containers produce explicit independent sentinels", async t => {
  const db = await referenceFixture(t), a = await known(db, 5);
  for (const metadata of [[], ["path"], true, 7, "not-an-object"]) {
    assert.deepEqual(await references(db, { metadata }), [observation("metadata", null, null, null, "unresolved", "malformed_metadata")]);
  }
  for (const preview of [[], "path", true, 42, {}, { path: null }, { path: 4 }, { path: [] }]) {
    const rows = await references(db, { bucket: "chat-media", path: a.receipt.path, metadata: { preview } });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], observation("canonical", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null));
    assert.equal(rows[1].source_kind, "preview"); assert.equal(rows[1].reference_state, "unresolved");
    assert.equal(rows[1].hold_reason, "malformed_metadata"); assert.equal(rows[1].generation_id, null);
  }
  const invalid = await references(db, { bucket: "chat-media", metadata: { preview: { path: "" } } });
  assert.equal(invalid.length, 1); assert.equal(invalid[0].hold_reason, "invalid_path");
});

test("preview uses only the parent bucket and never canonical fallback or nested bucket authority", async t => {
  const db = await referenceFixture(t), a = await known(db, 6);
  assert.deepEqual(await references(db, { bucket: "chat-media", metadata: { preview: { bucket: "media", path: a.receipt.path } } }),
    [observation("preview", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null)]);
  assert.deepEqual(await references(db, { bucket: "media", metadata: { preview: { bucket: "chat-media", path: a.receipt.path } } }),
    [observation("preview", "media", a.receipt.path)]);
  const missing = await references(db, { metadata: { preview: { bucket: "chat-media", path: a.receipt.path } } });
  assert.equal(missing.length, 1); assert.equal(missing[0].source_kind, "preview");
  assert.equal(missing[0].generation_id, null); assert.equal(missing[0].hold_reason, "missing_bucket");
  const invalid = await references(db, { bucket: "chat-media", path: a.receipt.path, metadata: { preview: {} } });
  assert.equal(invalid[1].hold_reason, "malformed_metadata", "canonical must not substitute for malformed preview");
});

test("known canonical and known URL disagreement marks only their own rows ambiguous retaining both identities", async t => {
  const db = await referenceFixture(t), a = await known(db, 7), b = await known(db, 8);
  assert.deepEqual(await references(db, { bucket: "chat-media", path: a.receipt.path, url: mediaUrl(b.receipt.path),
    metadata: { preview: { path: a.receipt.path } } }), [
    observation("canonical", "chat-media", a.receipt.path, a.identity.generation_id, "ambiguous", "conflicting_pointers"),
    observation("legacy_url", "chat-media", b.receipt.path, b.identity.generation_id, "ambiguous", "conflicting_pointers"),
    observation("preview", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null),
  ]);
  assert.deepEqual(await references(db, { bucket: "chat-media", path: a.receipt.path, url: "unsupported" }), [
    observation("canonical", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null),
    observation("legacy_url", null, null, null, "unresolved", "unsupported_url"),
  ]);
  assert.deepEqual(await references(db, { bucket: "media", path: "ordinary-a", url: mediaUrl("ordinary-b", "media") }), [
    observation("canonical", "media", "ordinary-a", null, "ambiguous", "conflicting_pointers"),
    observation("legacy_url", "media", "ordinary-b", null, "ambiguous", "conflicting_pointers"),
  ]);
  assert.deepEqual(await references(db, { bucket: "media", path: "same-path", url: mediaUrl("same-path", "chat-media") }), [
    observation("canonical", "media", "same-path", null, "ambiguous", "conflicting_pointers"),
    observation("legacy_url", "chat-media", "same-path", null, "ambiguous", "conflicting_pointers"),
  ]);
});

test("URL decoder accepts the documented single-pass ASCII endpoint subset including query stripping", async t => {
  const db = await referenceFixture(t);
  for (const endpoint of ["object/public", "object/sign", "object/authenticated", "render/image/public", "render/image/sign", "render/image/authenticated"]) {
    const url = mediaUrl("folder%2Ffile%41.pdf", "chat%2Dmedia", endpoint) + "?ignored=fixture#fragment";
    assert.deepEqual(await urlPointer(db, url), [{ bucket_id: "chat-media", object_path: "folder/fileA.pdf" }]);
  }
  assert.deepEqual(await urlPointer(db, "HTTPS://CORE.LETSCUBE.RU:443/storage/v1/object/public/media/a+b.pdf"),
    [{ bucket_id: "media", object_path: "a+b.pdf" }]);
  assert.deepEqual(await references(db, { url: mediaUrl("ordinary", "media") }), [observation("legacy_url", "media", "ordinary")]);
});

test("URL decoder rejects unsupported malformed nested encoded and unsafe forms with unresolved observations", async t => {
  const db = await referenceFixture(t);
  const invalid = ["http://core.letscube.ru/storage/v1/object/public/media/a", "/storage/v1/object/public/media/a",
    "https://foreign.invalid/storage/v1/object/public/media/a", "https://core.letscube.ru.evil.invalid/storage/v1/object/public/media/a",
    "https://user@core.letscube.ru/storage/v1/object/public/media/a", "https://core.letscube.ru:444/storage/v1/object/public/media/a",
    " https://core.letscube.ru/storage/v1/object/public/media/a", mediaUrl("a", "bad%2Fbucket"),
    mediaUrl("a", "x".repeat(129)), mediaUrl(""), mediaUrl("%"), mediaUrl("%GG"), mediaUrl("%8F"), mediaUrl("%00"),
    mediaUrl("%20"), mediaUrl("%7F"), mediaUrl("a%252Fb"), mediaUrl("\u043f\u0443\u0442\u044c"), mediaUrl("%D0%BF"),
    mediaUrl("/root"), mediaUrl("folder/"), mediaUrl("a//b"), mediaUrl("a/../b"), mediaUrl("a/./b"),
    mediaUrl("a%3Fb"), mediaUrl("a%23b"), mediaUrl("a%5Cb")];
  for (let i = 0; i < invalid.length; i++) {
    assert.deepEqual(await urlPointer(db, invalid[i]), [], "unsupported subset case " + i);
    assert.deepEqual(await references(db, { url: invalid[i] }), [observation("legacy_url", null, null, null, "unresolved", "unsupported_url")],
      "unsupported forms must not become absence, case " + i);
  }
});

test("URL byte bounds are literal 8192 URL 3072 raw part and 1024 decoded path", async t => {
  const db = await referenceFixture(t);
  const base = mediaUrl("a") + "?";
  const at = base + "x".repeat(8192 - Buffer.byteLength(base));
  assert.equal(Buffer.byteLength(at), 8192);
  assert.deepEqual(await urlPointer(db, at), [{ bucket_id: "chat-media", object_path: "a" }]);
  assert.deepEqual(await urlPointer(db, at + "x"), []);
  assert.deepEqual(await urlPointer(db, mediaUrl("a".repeat(1024))), [{ bucket_id: "chat-media", object_path: "a".repeat(1024) }]);
  assert.deepEqual(await urlPointer(db, mediaUrl("a".repeat(1025))), []);
  assert.deepEqual(await urlPointer(db, mediaUrl("%41".repeat(1024))), [{ bucket_id: "chat-media", object_path: "A".repeat(1024) }]);
  assert.deepEqual(await urlPointer(db, mediaUrl("%41".repeat(1024) + "A")), []);
  assert.deepEqual(await urlPointer(db, mediaUrl("a", "x".repeat(128))), [{ bucket_id: "x".repeat(128), object_path: "a" }]);
});

test("deleted final rows count retained pointers while a fully scrubbed final row has no observations", async t => {
  const db = await referenceFixture(t), a = await known(db, 9);
  await db.exec(`insert into public.messages(chat_id,type,media_bucket,media_path,media_url,media_metadata,deleted_at)
    values ('${a.receipt.chat}','file','chat-media',${quote(a.receipt.path)},${quote(mediaUrl(a.receipt.path))},
      ${quote(JSON.stringify({ preview: { path: a.receipt.path } }))}::jsonb,clock_timestamp());`);
  const resolveRows = () => db.query(`select r.* from public.messages m cross join lateral
    private.bot_message_media_references(m.media_bucket,m.media_path,m.media_url,m.media_metadata) r order by source_kind`);
  assert.deepEqual(await resolveRows(), ["canonical", "legacy_url", "preview"].map(source =>
    observation(source, "chat-media", a.receipt.path, a.identity.generation_id, "registered", null)));
  await db.exec("update public.messages set media_bucket=null,media_path=null,media_url=null,media_metadata='{}'::jsonb;");
  assert.deepEqual(await resolveRows(), []);
  assert.equal((await db.query("select count(*)::int as n from public.messages where deleted_at is not null"))[0].n, 1);
});

test("private invoker functions deny all nonowner execution even with schema USAGE and cannot expose registry reads", async t => {
  const db = await referenceFixture(t), a = await known(db, 10);
  const catalog = await db.query(`select p.oid::regprocedure::text as signature,pg_get_userbyid(p.proowner) as owner,
    p.prosecdef,p.proconfig from pg_proc p where p.oid in ('${resolverSignature}'::regprocedure,'${urlSignature}'::regprocedure) order by 1`);
  assert.equal(catalog.length, 2);
  for (const row of catalog) {
    assert.equal(row.owner, "postgres"); assert.equal(row.prosecdef, false);
    assert.deepEqual(row.proconfig, ['search_path=""']);
  }
  await db.exec("grant usage on schema private to anon,authenticated,service_role;");
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const operation of [referenceSql({ bucket: "chat-media", path: a.receipt.path }),
      `select * from private.bot_media_url_pointer(${quote(mediaUrl(a.receipt.path))})`,
      "select generation_id from private.bot_media_object_identities"]) {
      await assert.rejects(db.exec(`set role ${role}; ${operation};`), { code: "42501" });
    }
  }
  assert.deepEqual(await references(db, { bucket: "chat-media", path: a.receipt.path }),
    [observation("canonical", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null)]);
});

test("resolver apply observations and rollback preserve base catalog rows and immutable bindings", async t => {
  const db = await referenceFixture(t, { applyResolver: false }), a = await known(db, 11);
  await db.exec(`insert into public.messages(chat_id,type,media_bucket,media_path,media_url,media_metadata,deleted_at)
    values ('${a.receipt.chat}','file','chat-media',${quote(a.receipt.path)},${quote(mediaUrl(a.receipt.path))},
      '{"preview":{"path":"ordinary-preview","bucket":"ignored"}}'::jsonb,clock_timestamp());`);
  const messages = await db.query("select * from public.messages order by id");
  const before = await snapshot(db), bindings = await allBindings(db);
  const authority = await authorityCatalog(db);
  const catalogSql = `select oid,oid::regprocedure::text as signature,prosrc,proacl::text,proconfig::text,proowner,prosecdef
    from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) order by oid`;
  const catalog = await db.query(catalogSql);
  await db.exec(resolverSource());
  assert.equal((await references(db, { url: mediaUrl(a.receipt.path) }))[0].generation_id, a.identity.generation_id);
  assert.deepEqual(await snapshot(db), before); assert.deepEqual(await allBindings(db), bindings);
  assert.deepEqual(await db.query("select * from public.messages order by id"), messages);
  assert.deepEqual(await authorityCatalog(db), authority);
  await db.exec(resolverRollback());
  assert.deepEqual(await snapshot(db), before); assert.deepEqual(await allBindings(db), bindings);
  assert.deepEqual(await db.query("select * from public.messages order by id"), messages);
  assert.deepEqual(await db.query(catalogSql), catalog);
  assert.deepEqual(await authorityCatalog(db), authority);
  assert.equal((await db.query(`select to_regprocedure('${resolverSignature}')::text as resolver`))[0].resolver, null);
});

test("mutation URL omission fails the independent one-legacy-observation oracle", async t => {
  const db = await referenceFixture(t), a = await known(db, 20);
  const expected = [observation("legacy_url", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null)];
  assert.deepEqual(await references(db, { url: mediaUrl(a.receipt.path) }), expected);
  await mutateInstalled(db, resolverSignature, body => body.replace(
    "WHERE p_media_url IS NOT NULL AND p_media_url<>''", "WHERE false AND p_media_url IS NOT NULL AND p_media_url<>''"));
  const actual = await references(db, { url: mediaUrl(a.receipt.path) });
  assert.deepEqual(actual, [], "the mutant really drops a known URL-only reference");
  assert.throws(() => assert.deepEqual(actual, expected), { name: "AssertionError" });
});

test("mutation preview omission fails the independent retained-preview oracle", async t => {
  const db = await referenceFixture(t), a = await known(db, 21);
  const input = { bucket: "chat-media", metadata: { preview: { path: a.receipt.path } } };
  const expected = [observation("preview", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null)];
  assert.deepEqual(await references(db, input), expected);
  await mutateInstalled(db, resolverSignature, body => body.replace(
    "AND p_media_metadata ? 'preview'", "AND false AND p_media_metadata ? 'preview'"));
  const actual = await references(db, input);
  assert.deepEqual(actual, []);
  assert.throws(() => assert.deepEqual(actual, expected), { name: "AssertionError" });
});

test("mutation preview nested-bucket authority and missing-parent fallback fail literal bucket hold oracles", async t => {
  const db = await referenceFixture(t), a = await known(db, 22);
  const input = { bucket: "media", metadata: { preview: { path: a.receipt.path, bucket: "chat-media" } } };
  const expected = [observation("preview", "media", a.receipt.path)];
  assert.deepEqual(await references(db, input), expected);
  const restore = await mutateInstalled(db, resolverSignature, body => body.replace(
    "'preview',p_media_bucket,", "'preview',p_media_metadata->'preview'->>'bucket',"));
  let actual = await references(db, input);
  assert.equal(actual[0].reference_state, "registered");
  assert.throws(() => assert.deepEqual(actual, expected), { name: "AssertionError" });
  await restore();
  const missing = { metadata: input.metadata };
  const missingExpected = [observation("preview", null, a.receipt.path, null, "unresolved", "missing_bucket")];
  assert.deepEqual(await references(db, missing), missingExpected);
  await mutateInstalled(db, resolverSignature, body => body.replace(
    "'preview',p_media_bucket,", "'preview',coalesce(p_media_bucket,'chat-media'),"));
  actual = await references(db, missing);
  assert.equal(actual[0].reference_state, "registered");
  assert.throws(() => assert.deepEqual(actual, missingExpected), { name: "AssertionError" });
});

test("mutation canonical percent decode fails the literal-path unresolved oracle", async t => {
  const db = await referenceFixture(t), a = await known(db, 23);
  const input = { bucket: "chat-media", path: a.receipt.path.replaceAll("/", "%2F") };
  const expected = [observation("canonical", "chat-media", input.path)];
  assert.deepEqual(await references(db, input), expected);
  await mutateInstalled(db, resolverSignature, body => body.replace(
    "p_media_path AS object_path", "pg_catalog.replace(p_media_path,'%2F','/') AS object_path"));
  const actual = await references(db, input);
  assert.equal(actual[0].reference_state, "registered");
  assert.throws(() => assert.deepEqual(actual, expected), { name: "AssertionError" });
});

test("mutation URL decoded-path raw-part and canonical byte caps fail independent literal boundary oracles", async t => {
  const db = await referenceFixture(t);
  const prefix = mediaUrl("a") + "?";
  const overUrl = prefix + "x".repeat(8193 - Buffer.byteLength(prefix));
  assert.deepEqual(await urlPointer(db, overUrl), []);
  let restore = await mutateInstalled(db, urlSignature, body => body.replace("<=8192", "<=8193"));
  let actual = await urlPointer(db, overUrl);
  assert.equal(actual.length, 1);
  assert.throws(() => assert.deepEqual(actual, []), { name: "AssertionError" });
  await restore();
  const overPath = mediaUrl("a".repeat(1025));
  assert.deepEqual(await urlPointer(db, overPath), []);
  restore = await mutateInstalled(db, urlSignature, body => body.replace("BETWEEN 1 AND 1024", "BETWEEN 1 AND 1025"));
  actual = await urlPointer(db, overPath);
  assert.equal(actual.length, 1);
  assert.throws(() => assert.deepEqual(actual, []), { name: "AssertionError" });
  await restore();
  // Widening raw cap alone is redundant with 1024 decoded ASCII bytes. Tightening it breaks the accepted boundary.
  const rawAtLimit = mediaUrl("%41".repeat(1024));
  const rawExpected = [{ bucket_id: "chat-media", object_path: "A".repeat(1024) }];
  assert.deepEqual(await urlPointer(db, rawAtLimit), rawExpected);
  restore = await mutateInstalled(db, urlSignature, body => body.replace("BETWEEN 1 AND 3072", "BETWEEN 1 AND 3071"));
  actual = await urlPointer(db, rawAtLimit);
  assert.deepEqual(actual, []);
  assert.throws(() => assert.deepEqual(actual, rawExpected), { name: "AssertionError" });
  await restore();
  const canonical = { bucket: "chat-media", path: "a".repeat(1025) };
  const expected = [observation("canonical", "chat-media", canonical.path, null, "unresolved", "invalid_path")];
  assert.deepEqual(await references(db, canonical), expected);
  await mutateInstalled(db, resolverSignature, body => body.replace("NOT BETWEEN 1 AND 1024", "NOT BETWEEN 1 AND 1025"));
  actual = await references(db, canonical);
  assert.equal(actual[0].hold_reason, "unregistered_object");
  assert.throws(() => assert.deepEqual(actual, expected), { name: "AssertionError" });
});

test("mutation unregistered-object inner join fails the retained-unresolved observation oracle", async t => {
  const db = await referenceFixture(t);
  const input = { bucket: "media", path: "ordinary-object" };
  const expected = [observation("canonical", "media", "ordinary-object")];
  assert.deepEqual(await references(db, input), expected);
  await mutateInstalled(db, resolverSignature, body => body.replace(
    "LEFT JOIN private.bot_media_object_identities", "JOIN private.bot_media_object_identities"));
  const actual = await references(db, input);
  assert.deepEqual(actual, []);
  assert.throws(() => assert.deepEqual(actual, expected), { name: "AssertionError" });
});

test("mutation ignored conflicts fails the two-ambiguous-pointers literal oracle", async t => {
  const db = await referenceFixture(t), a = await known(db, 24), b = await known(db, 25);
  const input = { bucket: "chat-media", path: a.receipt.path, url: mediaUrl(b.receipt.path) };
  const expected = [
    observation("canonical", "chat-media", a.receipt.path, a.identity.generation_id, "ambiguous", "conflicting_pointers"),
    observation("legacy_url", "chat-media", b.receipt.path, b.identity.generation_id, "ambiguous", "conflicting_pointers"),
  ];
  assert.deepEqual(await references(db, input), expected);
  await mutateInstalled(db, resolverSignature, body => body.replaceAll("c.present AND o.source_kind IN", "false AND o.source_kind IN"));
  const actual = await references(db, input);
  assert.equal(actual.length, 2);
  assert.deepEqual(actual.map(row => row.reference_state), ["registered", "registered"]);
  assert.throws(() => assert.deepEqual(actual, expected), { name: "AssertionError" });
});

test("mutation unsupported-URL inner lateral join fails the independent hold beside canonical oracle", async t => {
  const db = await referenceFixture(t), a = await known(db, 26);
  const input = { bucket: "chat-media", path: a.receipt.path, url: "unsupported" };
  const expected = [
    observation("canonical", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null),
    observation("legacy_url", null, null, null, "unresolved", "unsupported_url"),
  ];
  assert.deepEqual(await references(db, input), expected);
  await mutateInstalled(db, resolverSignature, body => body.replace(
    "LEFT JOIN LATERAL private.bot_media_url_pointer", "JOIN LATERAL private.bot_media_url_pointer"));
  const actual = await references(db, input);
  assert.equal(actual.length, 1); assert.equal(actual[0].source_kind, "canonical");
  assert.throws(() => assert.deepEqual(actual, expected), { name: "AssertionError" });
});
