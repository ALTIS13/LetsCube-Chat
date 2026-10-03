import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  observationFixture, known, trusted, authenticated, messageInsert, mediaUrl,
  quote, uuid, actor, outsider, observations, session, settled, mutateInstalled,
  snapshot, allBindings, installForward,
} from "./bot-message-media-observations.fixture.mjs";

export {
  trusted, authenticated, messageInsert, mediaUrl, quote, uuid, actor, outsider,
  observations, session, settled, mutateInstalled, installForward,
};
export const namespace = 270311, gate = 1;
export const candidateSource = () => readFileSync(new URL("./fixtures/bot-media-coverage-candidate.sql", import.meta.url), "utf8");

// Only fictional close state. No Storage generation, DELETE, receipt, refund or
// production eligibility: known receipts intentionally remain pending holders.
export async function coverageFixture(t) {
  const db = await observationFixture(t, { applyObservations: true });
  db.a = await known(db, 90); db.b = await known(db, 91);
  await db.exec(`create schema fixture_coverage authorization postgres;
    create table fixture_coverage.objects(id integer primary key,generation_id uuid not null unique,
      closed boolean not null default false);
    alter table fixture_coverage.objects owner to postgres;
    alter table fixture_coverage.objects enable row level security;
    revoke all on schema fixture_coverage from public,anon,authenticated,service_role;
    revoke all on fixture_coverage.objects from public,anon,authenticated,service_role;
    insert into fixture_coverage.objects(id,generation_id) values
      (1,'${db.a.identity.generation_id}'),(2,'${db.b.identity.generation_id}');
    create function fixture_coverage.close_objects(ids integer[]) returns void language plpgsql as $$
      begin update fixture_coverage.objects set closed=true where id=any(ids); end $$;
    alter function fixture_coverage.close_objects(integer[]) owner to postgres;
    revoke all on function fixture_coverage.close_objects(integer[]) from public,anon,authenticated,service_role;`);
  if (process.env.BOT_MEDIA_COVERAGE_BASELINE !== "1") await db.exec(candidateSource());
  return db;
}

export const closing = (db, ids = [1]) => trusted(db, `select fixture_coverage.close_objects(array[${ids.join(",")}]);`);
export const accounting = async db => ({ rows: await snapshot(db), bindings: await allBindings(db) });
export const objectState = db => db.query("select id,closed from fixture_coverage.objects order by id");
export const messageCount = async db => (await db.query("select count(*)::int as n from public.messages"))[0].n;
export const asActor = "set role authenticated; set request.jwt.claim.sub=" + quote(actor) + ";";

export async function assertBarrier(db, pid, mode) {
  const rows = await db.query(`select mode,granted from pg_locks where locktype='advisory'
    and pid=${Number(pid)} and classid=${namespace} and objid=${gate} and objsubid=2`);
  assert.deepEqual(rows, [{ mode, granted: true }], "one granted transaction-wide barrier, never a per-object wait");
}

export async function pauseAfterRow(db, id) {
  await db.exec(`create function fixture_coverage.pause_row() returns trigger language plpgsql as $$
    begin if new.id='${id}'::uuid then perform pg_advisory_xact_lock(${namespace},99); end if; return null; end $$;
    create trigger fixture_pause_row after insert on public.messages
      for each row execute function fixture_coverage.pause_row();`);
}

export async function waitForGate(db, waiter, blocker, objectId = 99) {
  for (let i = 0; i < 120; i++) {
    const [state] = await db.query(`select exists(select 1 from pg_locks where pid=${Number(waiter)}
      and locktype='advisory' and classid=${namespace} and objid=${objectId} and not granted) as waiting,
      ${Number(blocker)}=any(pg_blocking_pids(${Number(waiter)})) as expected_blocker`);
    if (state.waiting && state.expected_blocker) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("expected actual fixture barrier edge was not observed");
}

export async function outcomeOrWait(db, operation, waiter, blocker) {
  let finished = false;
  operation.then(() => { finished = true; });
  for (let i = 0; i < 150; i++) {
    if (finished) return { waiting: false };
    const [state] = await db.query(`select wait_event_type='Lock' as waiting,
      ${Number(blocker)}=any(pg_blocking_pids(${Number(waiter)})) as expected_blocker
      from pg_stat_activity where pid=${Number(waiter)}`);
    if (state?.waiting && state.expected_blocker) return { waiting: true };
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("neither a refusal nor the controlled real lock edge was observed");
}

export async function pauseCloserAcquisition(db, { cacheScans = false } = {}) {
  return mutateInstalled(db, "fixture_coverage.close_objects(integer[])", body => {
    if (cacheScans) {
      const declarations = [];
      for (const name of ["cached_unknown", "cached_reference"]) {
        const start = body.indexOf("IF EXISTS (SELECT 1 FROM public.messages m");
        const end = body.indexOf(" THEN", start);
        assert.ok(start > 0 && end > start, "mutant selects the compiled closer's actual reference predicate");
        const condition = body.slice(start + 3, end);
        declarations.push(`SELECT (${condition}) INTO ${name};`);
        body = body.slice(0, start) + `IF ${name}` + body.slice(end);
      }
      body = "DECLARE cached_unknown boolean; cached_reference boolean;\n" + body.replace("BEGIN", "BEGIN\n" + declarations.join("\n"));
    }
    const acquisition = "IF NOT pg_catalog.pg_try_advisory_xact_lock(270311, 1) THEN";
    assert.ok(body.includes(acquisition), "pause belongs immediately inside the actual acquisition path");
    return body.replace(acquisition, `PERFORM pg_catalog.pg_advisory_xact_lock(${namespace},98);\n  ` + acquisition);
  });
}
