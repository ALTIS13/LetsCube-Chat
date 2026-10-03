import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fullSchemaIds, fullSchemaSeed, forwardCall, sendCall } from "./bot-media-authority-full-schema.fixture.mjs";
import { installAuthorityRepair } from "./bot-media-authority-repair.fixture.mjs";
import { installFullSchemaRepair } from "./bot-media-authority-full-schema-repair.fixture.mjs";
import { quote, mutateInstalled } from "./bot-media-coverage.fixture.mjs";

const q = fullSchemaIds;
export const combinedIds = {
  text: "e5070000-0000-4000-8000-000000000040",
  generation: "e5070000-0000-4000-8000-000000000041",
};
export const combinedTextInsert = `insert into public.messages(id,chat_id,user_id,type,content)
  values ('${combinedIds.text}','${q.sourceChat}','${q.actor}','text','Fictional combined text')`;
export const combinedActor = `set local role authenticated; set local request.jwt.claim.sub='${q.actor}'`;
export const coverageLock = `select count(*)::int as n from pg_catalog.pg_locks
  where pid=pg_catalog.pg_backend_pid() and locktype='advisory' and classid=270311
    and objid=1 and objsubid=2 and granted and mode='ShareLock'`;

// Installs only inside an operator-verified owned full-schema copy. The controls
// are fictional; they do not mark Storage objects eligible for deletion.
export async function installCombinedCoverage(db) {
  await db.exec(fullSchemaSeed);
  await installAuthorityRepair(db, { forward: true });
  await installFullSchemaRepair(db);
  await db.exec(`reset role;
    create schema fixture_coverage authorization postgres;
    set local role postgres;
    revoke all on schema fixture_coverage from public,anon,authenticated,service_role;
    create table fixture_coverage.objects(id integer primary key,generation_id uuid unique not null,
      closed boolean not null default false);
    alter table fixture_coverage.objects enable row level security;
    revoke all on table fixture_coverage.objects from public,anon,authenticated,service_role;
    insert into fixture_coverage.objects(id,generation_id) values (1,'${combinedIds.generation}');`);
  await db.exec(await readFile(new URL("./fixtures/bot-media-coverage-candidate.sql", import.meta.url), "utf8"));
  await db.exec("reset role;");
}

export async function installCombinedOutcome(db) {
  await db.exec(`create function pg_temp.combined_outcome(statement text) returns jsonb language plpgsql as $$
    begin execute statement; return jsonb_build_object('state','00000','reason',null);
    exception when others then return jsonb_build_object('state',sqlstate,'reason',sqlerrm); end $$;`);
}

export async function combinedState(db, statement, state) {
  const [row] = await db.query(`select pg_temp.combined_outcome(${quote(statement)}) as result`);
  assert.equal(row.result.state, state, "literal SQLSTATE from the actual operation");
}

export async function runCombinedCoverage(db, { isolated }) {
  await isolated("combined coverage has exact private helpers and client execution refusals", async () => {
    const rows = await db.query(`select p.proname,pg_get_userbyid(p.proowner) as owner,
      p.provolatile,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'execute') as anon,
      has_function_privilege('authenticated',p.oid,'execute') as authenticated,
      has_function_privilege('service_role',p.oid,'execute') as service_role
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='fixture_coverage' order by p.proname`);
    assert.deepEqual(rows.map(r => r.proname), ["after_write", "before_write", "check_refs", "close_objects"]);
    for (const r of rows) assert.deepEqual({ ...r, proname: undefined }, {
      proname: undefined, owner: "postgres", provolatile: "v", prosecdef: true,
      proconfig: ['search_path=""'], anon: false, authenticated: false, service_role: false,
    });
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set local role ${role};`);
      await combinedState(db, "select fixture_coverage.close_objects(array[1])", "42501");
      await db.exec("reset role;");
    }
  });
  await isolated("real close refuses retained unknown coverage without changing controls", async () => {
    assert.equal((await db.query(`select exists(select 1 from private.bot_message_media_observations
      where reference_state<>'registered') as held`))[0].held, true);
    await combinedState(db, "select fixture_coverage.close_objects(array[1])", "55000");
    assert.equal((await db.query("select closed from fixture_coverage.objects where id=1"))[0].closed, false);
  });
  await isolated("authenticated text holds one transaction-scoped coverage barrier", async () => {
    await db.exec(combinedActor + ";" + combinedTextInsert + ";reset role;");
    assert.equal((await db.query(coverageLock))[0].n, 1);
    assert.equal((await db.query(`select count(*)::int as n from public.messages where id='${combinedIds.text}'`))[0].n, 1);
    await combinedState(db, "select fixture_coverage.close_objects(array[1])", "55000");
  });
  await isolated("whole UPDATE observes old media even when final media pointers are cleared", async () => {
    // Inconsistent-state oracle only, after proving the real closer refuses.
    // Remove only this newly seeded fictional observation to isolate OLD refs
    // from the independent observation gate. Copied observations stay intact.
    const clear = `update public.messages set media_bucket=null,media_path=null,content='Fictional replacement'
      where id='${q.source}'`;
    await db.exec(`delete from private.bot_message_media_observations where message_id='${q.source}';
      savepoint clear_allowed;${combinedActor};`);
    await combinedState(db, clear, "00000");
    await db.exec(`reset role;rollback to clear_allowed;release clear_allowed;
      update fixture_coverage.objects set closed=true where id=1;${combinedActor};`);
    await combinedState(db, clear, "55000");
    await db.exec("reset role;");
    assert.equal((await db.query(`select media_path is not null as retained from public.messages
      where id='${q.source}'`))[0].retained, true);
  });
  await isolated("closed-state ordinary text succeeds but unknown media cannot be forwarded or sent", async () => {
    await db.exec("update fixture_coverage.objects set closed=true where id=1;" + combinedActor + ";" + combinedTextInsert + ";");
    await combinedState(db, forwardCall(), "55000");
    await db.exec("set local role service_role;");
    await combinedState(db, sendCall("combined-closed-send"), "55000");
    await db.exec("reset role;");
    assert.equal((await db.query(`select count(*)::int as n from public.messages where id='${combinedIds.text}'`))[0].n, 1);
  });
  await isolated("existing bound observation is an independent after-write gate", async () => {
    await db.exec(combinedActor + ";" + combinedTextInsert + ";reset role;");
    // Synthetic stale binding exercises the independent observation path. No
    // copied observation is removed and no resolver implementation is replaced.
    await db.exec(`insert into private.bot_message_media_observations
      (message_id,source_kind,bucket_id,object_path,generation_id,reference_state)
      values ('${combinedIds.text}','canonical','chat-media','${q.actor}/fictional-bound.pdf',
        '${combinedIds.generation}','registered');
      update fixture_coverage.objects set closed=true where id=1;
      ${combinedActor};`);
    await combinedState(db, `update public.messages set content='Fictional edited' where id='${combinedIds.text}'`, "55000");
    await db.exec("reset role;");
    assert.equal((await db.query(`select content='Fictional combined text' as unchanged from public.messages
      where id='${combinedIds.text}'`))[0].unchanged, true);
  });
}

export async function mutateCombinedCoverage(db, mutant) {
  if (mutant === "missing-before-barrier") {
    await mutateInstalled(db, "fixture_coverage.before_write()", source => source.replace(
      "IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(270311, 1) THEN", "IF false THEN"));
  } else if (mutant === "missing-old-references") {
    await mutateInstalled(db, "fixture_coverage.after_write()", source => source.replace(
      "IF TG_OP <> 'INSERT' THEN", "IF false THEN"));
  } else if (mutant === "missing-bound-observations") {
    await mutateInstalled(db, "fixture_coverage.after_write()", source => source.replace(
      "WHERE r.message_id = ANY(ids)", "WHERE false"));
  } else if (mutant === "missing-isolation-refusal") {
    await mutateInstalled(db, "fixture_coverage.before_write()", source => source.replace(
      "IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN", "IF false THEN"));
  } else if (mutant === "blocking-before-barrier") {
    await mutateInstalled(db, "fixture_coverage.before_write()", source => source.replace(
      "IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(270311, 1) THEN",
      "PERFORM pg_catalog.pg_advisory_xact_lock_shared(270311, 1);\n  IF false THEN"));
  } else throw new Error("unknown combined mutant");
}

export async function runCombinedIsolation(db, { check }) {
  for (const mode of ["repeatable read", "serializable", "read uncommitted"]) {
    await db.exec(`begin isolation level ${mode};`);
    try {
      await installCombinedOutcome(db);
      await check("combined text rejects unsupported isolation " + mode, async () => {
        await db.exec(combinedActor + ";");
        await combinedState(db, combinedTextInsert, "0A000");
        await db.exec("reset role;");
        assert.equal((await db.query(`select count(*)::int as n from public.messages where id='${combinedIds.text}'`))[0].n, 0);
      });
    } finally { await db.exec("rollback;"); }
  }
}

export async function runCombinedSavepoints(writer, contender, { check, mutant }) {
  async function canClose() {
    const [r] = await contender.query("select pg_try_advisory_xact_lock(270311,1) as acquired");
    return r.acquired;
  }
  async function transaction(name, run) {
    await writer.exec("begin; set local statement_timeout='15s'; set local lock_timeout='2s';");
    await contender.exec("begin; set local statement_timeout='15s';");
    try {
      if (mutant) await mutateCombinedCoverage(writer, mutant);
      await writer.exec("reset role;");
      await check(name, run);
    }
    finally { await contender.exec("rollback;"); await writer.exec("rollback;"); }
  }
  async function expectBusy(statement) {
    const [backend] = await writer.query("select pg_backend_pid() as pid");
    let settled = false, observedWait = false;
    const operation = writer.query(`select pg_temp.combined_outcome(${quote(statement)}) as result`);
    operation.then(() => { settled = true; }, () => { settled = true; });
    do {
      const [edge] = await contender.query(`select exists(select 1 from pg_catalog.pg_locks
        where pid=${Number(backend.pid)} and locktype='advisory' and classid=270311
        and objid=1 and objsubid=2 and mode='ShareLock' and not granted
        and pg_backend_pid()=any(pg_blocking_pids(${Number(backend.pid)}))) as waiting`);
      observedWait ||= edge.waiting;
    } while (!settled);
    const [row] = await operation;
    assert.equal(row.result.state, "55P03", "literal busy SQLSTATE");
    assert.equal(observedWait, false, "try-only refusal has no observed advisory waiter/blocker edge");
    assert.equal(row.result.reason, "fixture_coverage_busy", "lock_timeout is not a genuine coverage refusal");
  }
  await transaction("savepoint rollback retains a barrier acquired before the savepoint", async () => {
    await writer.exec(combinedActor + ";" + combinedTextInsert + ";reset role; savepoint later;");
    await writer.exec("rollback to later;");
    assert.equal(await canClose(), false);
    assert.equal((await writer.query(coverageLock))[0].n, 1);
  });
  await transaction("savepoint rollback releases a barrier first acquired in that savepoint", async () => {
    await writer.exec("savepoint earlier;" + combinedActor + ";" + combinedTextInsert + ";reset role;");
    assert.equal(await canClose(), false);
    await writer.exec("rollback to earlier;");
    assert.equal(await canClose(), true);
    assert.equal((await writer.query(coverageLock))[0].n, 0);
    assert.equal((await writer.query(`select count(*)::int as n from public.messages where id='${combinedIds.text}'`))[0].n, 0);
  });
  await transaction("exclusive closer refuses authenticated writes immediately and atomically", async () => {
    assert.equal(await canClose(), true);
    await installCombinedOutcome(writer);
    await writer.exec(combinedActor + ";");
    await expectBusy(combinedTextInsert);
    await writer.exec("reset role;");
    assert.equal((await writer.query(`select count(*)::int as n from public.messages where id='${combinedIds.text}'`))[0].n, 0);
    const [r] = await contender.query(`select count(*)::int as n from pg_catalog.pg_locks
      where locktype='advisory' and classid=270311 and objid=1 and objsubid=2 and not granted`);
    assert.equal(r.n, 0);
  });
  await transaction("exclusive closer rolls back outer membership and nested system message together", async () => {
    const before = await writer.query(`select count(*)::int as n from public.messages where chat_id='${q.targetChat}'`);
    assert.equal(await canClose(), true);
    await installCombinedOutcome(writer);
    await writer.exec(combinedActor + ";");
    await expectBusy(`insert into public.chat_members(chat_id,user_id,role)
      values ('${q.targetChat}','${q.outsider}','member')`);
    await writer.exec("reset role;");
    assert.equal((await writer.query(`select count(*)::int as n from public.chat_members
      where chat_id='${q.targetChat}' and user_id='${q.outsider}'`))[0].n, 0);
    assert.deepEqual(await writer.query(`select count(*)::int as n from public.messages
      where chat_id='${q.targetChat}'`), before);
  });
  await transaction("exclusive closer rolls back actual delete RPC and its ledger together", async () => {
    assert.equal(await canClose(), true);
    await installCombinedOutcome(writer);
    await writer.exec(combinedActor + ";");
    await expectBusy(`select public.delete_messages_for_everyone(array['${q.source}']::uuid[])`);
    await writer.exec("reset role;");
    assert.equal((await writer.query(`select deleted_at is null as retained from public.messages
      where id='${q.source}'`))[0].retained, true);
    assert.equal((await writer.query(`select count(*)::int as n from private.message_deletions
      where message_id='${q.source}'`))[0].n, 0);
  });
}
