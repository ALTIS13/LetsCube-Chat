import assert from "node:assert/strict";
import {
  identityFixture, next, reserve, identityFor, snapshot, allBindings,
} from "./bot-media-logical-identity.fixture.mjs";

export { snapshot, allBindings };
export const namespace = 270310;
export const gate = 99;

// Deliberately test-only, naive admission candidate. These tables/functions never
// modify accepted messages, registry state, accounting, Storage, or production SQL.
// Its closer models fence contention, not real eligibility: receipts/PUT holds
// and other lifecycle participants are intentionally outside this experiment.
const candidate = `
create schema fixture_fence;
create table fixture_fence.objects(id integer primary key, generation_id uuid not null, closed boolean not null default false);
create table fixture_fence.messages(id integer primary key, object_id integer references fixture_fence.objects(id));

create function fixture_fence.admit(ids integer[]) returns void language plpgsql as $$
declare fence_id integer;
begin
  for fence_id in select distinct v from unnest(ids) v where v is not null order by v loop
    perform pg_advisory_xact_lock_shared(${namespace},fence_id);
  end loop;
  if exists(select 1 from fixture_fence.objects where id=any(ids) and closed) then
    raise exception 'fixture_writer_closed' using errcode='55000';
  end if;
end $$;

create function fixture_fence.after_insert() returns trigger language plpgsql as $$
begin perform fixture_fence.admit(array(select object_id from new_rows)); return null; end $$;
create function fixture_fence.after_update() returns trigger language plpgsql as $$
begin perform fixture_fence.admit(array(select object_id from old_rows union select object_id from new_rows)); return null; end $$;
create function fixture_fence.after_delete() returns trigger language plpgsql as $$
begin perform fixture_fence.admit(array(select object_id from old_rows)); return null; end $$;
create trigger a_insert_fences after insert on fixture_fence.messages referencing new table as new_rows
  for each statement execute function fixture_fence.after_insert();
create trigger a_update_fences after update on fixture_fence.messages referencing old table as old_rows new table as new_rows
  for each statement execute function fixture_fence.after_update();
create trigger a_delete_fences after delete on fixture_fence.messages referencing old table as old_rows
  for each statement execute function fixture_fence.after_delete();

create function fixture_fence.close_objects(ids integer[]) returns void language plpgsql as $$
declare fence_id integer;
begin
  for fence_id in select distinct v from unnest(ids) v where v is not null order by v loop
    perform pg_advisory_xact_lock(${namespace},fence_id);
  end loop;
  -- No FOR UPDATE/SHARE on messages, memberships or Storage. The admission
  -- candidate's advisory fences alone must protect this fresh committed read.
  if exists(select 1 from fixture_fence.messages where object_id=any(ids)) then
    raise exception 'fixture_reference_present' using errcode='55000';
  end if;
  update fixture_fence.objects set closed=true where id=any(ids);
end $$;
`;

export async function fenceFixture(t) {
  const db = await identityFixture(t, { applyIdentity: true });
  await db.exec(candidate);
  for (const id of [1, 2]) {
    const receipt = next(500 + id);
    await reserve(db, receipt);
    const identity = await identityFor(db, receipt);
    await db.exec(`insert into fixture_fence.objects(id,generation_id) values (${id},'${identity.generation_id}');`);
  }
  return db;
}

export async function session(db, { deadlockTimeout = "10s" } = {}) {
  const connection = db.session();
  const pid = Number(await connection.send(`begin; set local statement_timeout='15s';
    set local deadlock_timeout='${deadlockTimeout}'; select pg_backend_pid();`));
  assert.ok(Number.isInteger(pid) && pid > 0, "real session PID is required");
  return { connection, pid };
}

export async function locks(db, pid) {
  return db.query(`select classid::int as namespace,objid::int as object_id,mode,granted
    from pg_locks where locktype='advisory' and pid=${Number(pid)} and classid=${namespace}
    order by objid,mode`);
}

export async function waitForFence(db, waiter, blocker, objectId, mode) {
  for (let i = 0; i < 120; i++) {
    const rows = await locks(db, waiter);
    const [state] = await db.query(`select wait_event_type,wait_event,
      ${Number(blocker)}=any(pg_blocking_pids(${Number(waiter)})) as blocked_by_expected
      from pg_stat_activity where pid=${Number(waiter)}`);
    if (rows.some(row => row.object_id === objectId && row.mode === mode && !row.granted)
      && state?.wait_event_type === "Lock" && state?.wait_event === "advisory" && state.blocked_by_expected) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("the expected actual advisory wait edge was not observed");
}

export async function assertHeld(db, pid, objectId, mode) {
  assert.ok((await locks(db, pid)).some(row => row.object_id === objectId && row.mode === mode && row.granted),
    "expected granted advisory fence");
}

export const settled = operation => operation.then(value => ({ value }), error => ({ error }));
export const accounting = async db => ({ rows: await snapshot(db), bindings: await allBindings(db) });
export const state = async db => ({
  objects: await db.query("select id,closed from fixture_fence.objects order by id"),
  messages: await db.query("select id,object_id from fixture_fence.messages order by id"),
});

export async function pausedNestedInsert(db) {
  await db.exec(`create function fixture_fence.nested_insert() returns trigger language plpgsql as $$
    begin
      if new.id=901 then
        insert into fixture_fence.messages(id,object_id) values (902,2);
        perform pg_advisory_xact_lock(${namespace},${gate});
      end if;
      return null;
    end $$;
    create trigger nested_insert after insert on fixture_fence.messages
      for each row execute function fixture_fence.nested_insert();`);
}

export async function pausedUpsert(db) {
  await db.exec(`insert into fixture_fence.messages(id,object_id) values (701,null);
    create function fixture_fence.pause_after_update() returns trigger language plpgsql as $$
    begin
      if current_setting('fixture_fence.pause_upsert',true)='on' then
        perform pg_advisory_xact_lock(${namespace},${gate});
      end if;
      return null;
    end $$;
    create trigger z_pause_after_update after update on fixture_fence.messages
      for each statement execute function fixture_fence.pause_after_update();`);
}
