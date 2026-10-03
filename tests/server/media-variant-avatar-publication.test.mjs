import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { postgres, quote, read } from "./bot-inline-media-ingest.fixture.mjs";

// Real SQL in an owned local PG/captured bootstrap, NOT installed worker or
// full deployed-schema/Storage acceptance. The prototype intentionally lacks
// source epochs and durable target PUT intents; it cannot authorize cleanup.
const source = read("tests/server/fixtures/media-avatar-publication-candidate.sql");
const owner = "74000000-0000-4000-8000-000000000001";
const other = "74000000-0000-4000-8000-000000000002";
const url = actor => `https://avatar-publication.invalid/storage/v1/object/public/media/avatars/${owner}/${actor}.png`;
const row = (actor, status = "ready") => ({ variant_kind: "avatar_128", status,
  source_bucket: "media", source_path: `avatars/${owner}/${actor}.png`,
  variant_bucket: "media", variant_path: `variants/profiles/${owner}/${actor}/avatar_128.webp` });
const signature = "fixture_avatar.publish(text,uuid,text,jsonb)";
const publish = (scope, actor, body = row(actor)) => `select fixture_avatar.publish(${quote(scope)},${quote(owner)},${quote(url(actor))},${quote(JSON.stringify(body))}::jsonb) as value`;

async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " exceeded its bound")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function fixture(t, scope = "profile") {
  assert.ok(process.env.BOT_INGEST_PG_BIN, "supply the configured owned local BOT_INGEST_PG_BIN");
  let directory;
  const pending = new Set();
  const db = await postgres({ after(cleanup) { t.after(async () => {
    const started = performance.now();
    try {
      await bounded(Promise.allSettled([...pending]), 8000, "SQL settling");
      assert.equal(pending.size, 0, "no source SQL call remains before disposal");
    } finally { await bounded(cleanup(), 12000, "exact owned fixture disposal"); }
    assert.equal(existsSync(directory), false, "exact owned local PG directory absent");
    assert.ok(performance.now() - started < 20000, "SQL settling and exact disposal stay below 20 seconds");
    t.diagnostic(`cleanup: SQL pending=0; exact owned PG directory absent; ${Math.ceil(performance.now() - started)}ms`);
  }); } }, "select 1;");
  const exec = sql => {
    const result = db.exec("set statement_timeout='3s'; set lock_timeout='2s';\n" + sql);
    pending.add(result); result.then(() => pending.delete(result), () => pending.delete(result));
    return bounded(result, 8000, "owned SQL transport");
  };
  const query = async sql => JSON.parse(await exec("select coalesce(jsonb_agg(q),'[]'::jsonb) from (" + sql + ") q;"));
  directory = (await query("select current_setting('data_directory') as path"))[0].path;
  assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
  assert.match(basename(directory), /^letscube-bot-ingest-/);
  await exec(`create schema fixture_avatar;
    revoke all on schema fixture_avatar from public,anon,authenticated;
    grant usage on schema fixture_avatar to service_role;
    create table fixture_avatar.owners(scope text,id uuid,avatar_url text,primary key(scope,id));
    create table fixture_avatar.variants(scope text,owner_id uuid,kind text,row_data jsonb,
      primary key(scope,owner_id,kind));
    alter table fixture_avatar.owners enable row level security;
    alter table fixture_avatar.variants enable row level security;
    insert into fixture_avatar.owners values (${quote(scope)},${quote(owner)},${quote(url("B"))});
    insert into fixture_avatar.variants values
      (${quote(scope)},${quote(other)},'avatar_128','{"untouched":true}'::jsonb);
    ${source}`);
  const service = async sql => JSON.parse(await exec("set role service_role; select to_jsonb(q) from (" + sql + ") q;"));
  const rows = () => query("select scope,owner_id,kind,row_data from fixture_avatar.variants order by owner_id,kind");
  t.diagnostic("owned local PostgreSQL " + db.version + "; fictional atomic publication only");
  return { db, exec, query, service, rows, scope };
}

for (const scope of ["profile", "chat"]) {
  test(`${scope}: atomic prototype refuses stale ready and failed publications without touching B`, async t => {
    const f = await fixture(t, scope);
    assert.equal((await f.service(publish(scope, "B"))).value, true);
    const before = await f.rows();
    assert.equal((await f.service(publish(scope, "A"))).value, false);
    assert.deepEqual(await f.rows(), before);
    assert.equal((await f.service(publish(scope, "A", row("A", "failed")))).value, false);
    assert.deepEqual(await f.rows(), before);
    assert.deepEqual(before.map(r => r.row_data), [row("B"), { untouched: true }]);
  });

  test(`${scope}: current failed publication is one atomic replacement, not a stale refusal`, async t => {
    const f = await fixture(t, scope);
    assert.equal((await f.service(publish(scope, "B"))).value, true);
    assert.equal((await f.service(publish(scope, "B", row("B", "failed")))).value, true);
    assert.deepEqual((await f.rows()).map(r => r.row_data), [row("B", "failed"), { untouched: true }]);
  });
}

test("an insert failure rolls back the preceding DELETE and preserves current pointers", async t => {
  const f = await fixture(t);
  await f.service(publish("profile", "B")); const before = await f.rows();
  await f.exec(`create function fixture_avatar.reject_write() returns trigger language plpgsql as
    $$ begin raise exception using errcode='23514',message='fictional_insert_rejected'; end $$;
    create trigger reject_write before insert on fixture_avatar.variants
    for each row execute function fixture_avatar.reject_write();`);
  await assert.rejects(f.service(publish("profile", "B", row("B", "failed"))), { code: "23514" });
  assert.deepEqual(await f.rows(), before);
});

test("installed SQL source-guard omission goes RED against the unchanged literal stale oracle", async t => {
  const f = await fixture(t);
  await f.service(publish("profile", "B")); const before = await f.rows();
  const definition = (await f.query(`select pg_get_functiondef(${quote(signature)}::regprocedure) as ddl`))[0].ddl;
  assert.equal(definition.split("not found or v_current is distinct from p_avatar_url").length, 2);
  try {
    await f.exec(definition.replace("not found or v_current is distinct from p_avatar_url", "not found"));
    const value = (await f.service(publish("profile", "A"))).value;
    assert.equal(value, true);
    assert.throws(() => assert.equal(value, false), { code: "ERR_ASSERTION" });
    assert.deepEqual((await f.rows()).map(r => r.row_data), [row("A"), { untouched: true }]);
  } finally {
    await f.exec(definition);
    assert.equal((await f.query(`select pg_get_functiondef(${quote(signature)}::regprocedure) as ddl`))[0].ddl, definition);
  }
  assert.equal((await f.service(publish("profile", "A"))).value, false);
  assert.notDeepEqual(await f.rows(), before, "restoring code does not fabricate row restoration");
});

test("unprivileged roles cannot call the trusted test publisher or read its fixture rows", async t => {
  const f = await fixture(t);
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(f.exec(`set role ${role}; ${publish("profile", "B")}`), { code: "42501" });
    await assert.rejects(f.exec(`set role ${role}; select * from fixture_avatar.variants`), { code: "42501" });
  }
  assert.equal((await f.service(publish("profile", "B"))).value, true);
});

const abaState = (actor, generation) => ({ scope: "profile", id: owner,
  avatar_url: url(actor), test_generation: generation });

function assertRetainedAba({ capture, transitions, payload }) {
  assert.deepEqual(capture, abaState("A", "fictional-Aold-1"), "capture must belong to old A, not new A");
  assert.deepEqual(transitions, [abaState("A", "fictional-Aold-1"), abaState("B", "fictional-B-2"),
    abaState("A", "fictional-Anew-3")], "ABA requires old A before B before new A");
  assert.deepEqual(payload, row("A"), "retain the exact old-A candidate payload");
}

test("ABA coverage rejects Binitial -> A and relabelling the retained capture as Anew", { timeout: 1000 }, () => {
  const transitions = [abaState("A", "fictional-Aold-1"), abaState("B", "fictional-B-2"),
    abaState("A", "fictional-Anew-3")];
  const trace = { capture: structuredClone(transitions[0]), transitions, payload: row("A") };
  assertRetainedAba(trace);
  assert.throws(() => assertRetainedAba({ ...trace, transitions: transitions.slice(1) }),
    { code: "ERR_ASSERTION", message: /ABA requires old A before B before new A/ });
  assert.throws(() => assertRetainedAba({ ...trace, capture: structuredClone(transitions[2]) }),
    { code: "ERR_ASSERTION", message: /capture must belong to old A, not new A/ });
});

test("retained old-A payload survives Aold -> B -> Anew: literal epoch-refusal oracle RED", async t => {
  const f = await fixture(t);
  // These are independent fictional test epochs, not Storage incarnations.
  await f.exec(`alter table fixture_avatar.owners add column test_generation text;
    update fixture_avatar.owners set avatar_url=${quote(url("A"))},test_generation='fictional-Aold-1'
    where scope='profile' and id=${quote(owner)};`);
  const currentOwner = async () => (await f.query(`select scope,id,avatar_url,test_generation from fixture_avatar.owners
    where scope='profile' and id=${quote(owner)}`))[0];
  const capture = await currentOwner();
  const transitions = [structuredClone(capture)];
  const oldPayload = Object.freeze(structuredClone(row("A")));
  const oldRequest = publish("profile", "A", oldPayload);
  assert.equal((await f.service(oldRequest)).value, true, "Aold is current at capture");
  await f.exec(`update fixture_avatar.owners set avatar_url=${quote(url("B"))},test_generation='fictional-B-2'
    where scope='profile' and id=${quote(owner)};`);
  transitions.push(await currentOwner());
  assert.equal((await f.service(publish("profile", "B"))).value, true);
  assert.deepEqual((await f.rows()).map(r => r.row_data), [row("B"), { untouched: true }]);
  await f.exec(`update fixture_avatar.owners set avatar_url=${quote(url("A"))},test_generation='fictional-Anew-3'
    where scope='profile' and id=${quote(owner)};`);
  const current = await currentOwner(); transitions.push(current);
  assertRetainedAba({ capture, transitions, payload: oldPayload });
  assert.equal(capture.test_generation, "fictional-Aold-1");
  assert.equal(current.test_generation, "fictional-Anew-3");
  assert.equal(current.avatar_url, capture.avatar_url);
  assert.notEqual(current.test_generation, capture.test_generation);
  assert.equal(oldRequest, publish("profile", "A", oldPayload), "retry is the unchanged captured request");
  const definition = (await f.query(`select pg_get_functiondef(${quote(signature)}::regprocedure) as ddl`))[0].ddl;
  const accepted = (await f.service(oldRequest)).value;
  assert.equal(accepted, true, "unchanged SQL candidate actually admits the retained old-A request");
  // Only the literal boolean oracle is caught; SQL/transport/assertion failures
  // before or after it must reject the test independently.
  assert.throws(() => assert.equal(accepted, false, "a retained old epoch must be refused despite equal URL"),
    { code: "ERR_ASSERTION", actual: true, expected: false, operator: "strictEqual" });
  assert.deepEqual((await f.rows()).map(r => r.row_data), [oldPayload, { untouched: true }]);
  assert.deepEqual(await currentOwner(), abaState("A", "fictional-Anew-3"), "old publication did not erase new test epoch");
  assert.equal((await f.query(`select pg_get_functiondef(${quote(signature)}::regprocedure) as ddl`))[0].ddl, definition);
  assert.equal((await f.service(publish("profile", "A", row("A", "failed")))).value, true,
    "fresh current Anew publication remains a positive control");
  assert.deepEqual((await f.rows()).map(r => r.row_data), [row("A", "failed"), { untouched: true }]);
  t.diagnostic("retained Aold payload accepted after independently observed Aold/B/Anew test epochs: literal refusal RED; not provider incarnation");
});

test("malformed scope, row kind or status cannot mutate the prototype's retained rows", async t => {
  const f = await fixture(t);
  await f.service(publish("profile", "B")); const before = await f.rows();
  for (const body of [{ ...row("B"), variant_kind: null }, { ...row("B"), status: null },
    { ...row("B"), source_bucket: "chat-media" }, { ...row("B"), variant_path: "" }]) {
    await assert.rejects(f.service(publish("profile", "B", body)), { code: "22023" });
    assert.deepEqual(await f.rows(), before);
  }
  await assert.rejects(f.service(`select fixture_avatar.publish(null,${quote(owner)},${quote(url("B"))},${quote(JSON.stringify(row("B")))}::jsonb)`), { code: "22023" });
  assert.deepEqual(await f.rows(), before);
});

async function ownerLockSchedule(t, omitLock = false) {
  const f = await fixture(t);
  await f.exec(`update fixture_avatar.owners set avatar_url=${quote(url("A"))} where scope='profile' and id=${quote(owner)};
    create function fixture_avatar.pause_insert() returns trigger language plpgsql as
    $$ begin perform pg_advisory_xact_lock(270314,1); return new; end $$;
    create trigger pause_insert before insert on fixture_avatar.variants
    for each row execute function fixture_avatar.pause_insert();`);
  const definition = (await f.query(`select pg_get_functiondef(${quote(signature)}::regprocedure) as ddl`))[0].ddl;
  const sessions = [], jobs = [];
  const session = async () => {
    const s = f.db.session(); sessions.push(s);
    await s.send("set statement_timeout='8s'; set lock_timeout='6s';");
    s.pid = Number(await s.send("select pg_backend_pid();"));
    return s;
  };
  let blocker, publisher, setter;
  const waitFor = async predicate => {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const result = await predicate(); if (result) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("the exact owned SQL blocking relationship was not observed");
  };
  try {
    if (omitLock) {
      assert.equal(definition.split("for update").length, 2);
      await f.exec(definition.replace("for update", ""));
    }
    blocker = await session(); publisher = await session(); setter = await session();
    await blocker.send("select pg_advisory_lock(270314,1);");
    const writing = publisher.send(`set role service_role; ${publish("profile", "A")};`);
    jobs.push(writing); writing.catch(() => {});
    await waitFor(async () => (await f.query(`select ${blocker.pid}=any(pg_blocking_pids(${publisher.pid})) as blocked`))[0].blocked);
    const changing = setter.send(`update fixture_avatar.owners set avatar_url=${quote(url("B"))} where scope='profile' and id=${quote(owner)};`);
    jobs.push(changing); changing.catch(() => {});
    if (omitLock) {
      await bounded(changing, 4000, "unfenced owner update");
      const blocked = (await f.query(`select ${publisher.pid}=any(pg_blocking_pids(${setter.pid})) as blocked`))[0].blocked;
      assert.equal(blocked, false);
      assert.throws(() => assert.equal(blocked, true), { code: "ERR_ASSERTION" });
    } else {
      await waitFor(async () => (await f.query(`select ${publisher.pid}=any(pg_blocking_pids(${setter.pid})) as blocked`))[0].blocked);
      assert.equal((await f.query("select avatar_url from fixture_avatar.owners"))[0].avatar_url, url("A"));
    }
    await blocker.send("select pg_advisory_unlock(270314,1);");
    assert.equal(await bounded(writing, 5000, "publication completion"), "t");
    await bounded(changing, 5000, "owner update completion");
    assert.deepEqual((await f.rows()).map(r => r.row_data), [row("A"), { untouched: true }]);
    assert.equal((await f.query("select avatar_url from fixture_avatar.owners"))[0].avatar_url, url("B"));
    if (omitLock) t.diagnostic("omitted owner lock allowed B before A publication: literal waiting oracle RED");
    else t.diagnostic("setter waited for exact publisher PID; publication completed before B update");
  } finally {
    try { if (blocker) await bounded(blocker.send("select pg_advisory_unlock_all();"), 5000, "owned blocker release"); }
    finally {
      try {
        const results = await bounded(Promise.allSettled(jobs), 10000, "source session settling");
        for (const result of results) assert.equal(result.status, "fulfilled", "no unexpected session failure is masked");
      } finally {
        try { await bounded(Promise.all(sessions.map(s => s.close())), 5000, "source session closure"); }
        finally {
          await f.exec(definition);
          assert.equal((await f.query(`select pg_get_functiondef(${quote(signature)}::regprocedure) as ddl`))[0].ddl, definition);
        }
      }
    }
  }
}

test("owner update actually waits for the atomic publisher's row lock, not a preceding idle read", async t => {
  await ownerLockSchedule(t);
});
test("installed owner-lock omission mutant exposes the same check/publication race", async t => {
  await ownerLockSchedule(t, true);
});
