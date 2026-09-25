import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const claimMigration = new URL("../../supabase/migrations/20260924100000_native_push_claim.sql", import.meta.url);
const recheckMigration = new URL("../../supabase/migrations/20260925212424_native_push_outbox_delivery_recheck.sql", import.meta.url);

const id = (prefix, number) => `${prefix}0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const userId = id("1", 1);
const otherUserId = id("1", 2);
const token = id("5", 1);
const otherToken = id("5", 2);

test("native delivery recheck rejects read, inactive, revoked and stale claims before sending", async () => {
  const db = await new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create role outsider;
      create table public.notifications (
        id uuid primary key, user_id uuid not null, read_at timestamptz
      );
      create table public.user_push_devices (
        id uuid primary key, user_id uuid not null,
        enabled boolean not null default true, revoked_at timestamptz
      );
      create table public.notifications_native_push_outbox (
        id uuid primary key, notification_id uuid not null references public.notifications(id),
        device_id uuid not null references public.user_push_devices(id), user_id uuid not null,
        payload jsonb not null default '{}'::jsonb,
        attempt_count integer not null default 0, sent_at timestamptz,
        last_error text, created_at timestamptz not null default now()
      );
    `);
    for (let number = 1; number <= 8; number += 1) {
      await db.query("insert into public.notifications (id, user_id) values ($1, $2)", [id("2", number), userId]);
      await db.query("insert into public.user_push_devices (id, user_id) values ($1, $2)", [
        id("3", number), number === 7 ? otherUserId : userId,
      ]);
      await db.query(
        "insert into public.notifications_native_push_outbox (id, notification_id, device_id, user_id) values ($1,$2,$3,$4)",
        [id("4", number), id("2", number), id("3", number), userId],
      );
    }
    await db.exec(await readFile(claimMigration, "utf8"));
    await db.exec(await readFile(recheckMigration, "utf8"));

    const claimed = (await db.query("select id from public.native_push_outbox_claim(8,$1)", [token])).rows;
    assert.equal(claimed.length, 8, "the fixture must exercise real claimed rows");
    await db.query("update public.notifications set read_at=now() where id=$1", [id("2", 1)]);
    await db.query("update public.user_push_devices set enabled=false where id=$1", [id("3", 2)]);
    await db.query("update public.user_push_devices set revoked_at=now() where id=$1", [id("3", 3)]);
    await db.query("update public.notifications_native_push_outbox set claimed_until=now()-interval '1 second' where id=$1", [id("4", 6)]);
    await db.query("update public.notifications set read_at=now() where id=$1", [id("2", 8)]);
    await db.query("update public.notifications_native_push_outbox set claimed_until=now()-interval '1 second' where id=$1", [id("4", 8)]);

    const recheck = async (number, claimToken = token) => (await db.query(
      "select public.native_push_outbox_delivery_recheck($1,$2) as status",
      [id("4", number), claimToken],
    )).rows[0].status;
    assert.equal(await recheck(1), "read");
    assert.equal(await recheck(2), "device_inactive");
    assert.equal(await recheck(3), "device_inactive");
    assert.equal(await recheck(4, otherToken), "claim_lost");
    assert.equal(await recheck(6), "claim_lost", "an expired lease must not authorize a late send");
    assert.equal(await recheck(7), "device_inactive", "a device from another user must not receive the payload");
    assert.equal(await recheck(5), "deliver");
    assert.equal(await recheck(8), "read", "a read row must be terminalized even after its lease expires");

    const terminal = (await db.query(
      "select id, sent_at is not null as terminal, last_error, claim_token from public.notifications_native_push_outbox order by id",
    )).rows;
    for (const number of [1, 2, 3, 7, 8]) {
      assert.equal(terminal[number - 1].terminal, true);
      assert.equal(terminal[number - 1].claim_token, null);
      assert.equal(terminal[number - 1].last_error, number === 1 || number === 8 ? "suppressed:read" : "suppressed:device_inactive");
    }
    for (const number of [4, 5, 6]) {
      assert.equal(terminal[number - 1].terminal, false);
      assert.equal(terminal[number - 1].claim_token, token);
    }
    assert.equal(await recheck(1), "claim_lost", "a terminal row cannot be delivered twice");
    await db.query("update public.notifications_native_push_outbox set sent_at=now() where id=$1", [id("4", 5)]);
    assert.equal(await recheck(5), "claim_lost", "a delivered row cannot be delivered twice");

    const privileges = (await db.query(`
      select has_function_privilege('service_role','public.native_push_outbox_delivery_recheck(uuid,uuid)','EXECUTE') as service,
        has_function_privilege('anon','public.native_push_outbox_delivery_recheck(uuid,uuid)','EXECUTE') as anon,
        has_function_privilege('authenticated','public.native_push_outbox_delivery_recheck(uuid,uuid)','EXECUTE') as authenticated,
        has_function_privilege('outsider','public.native_push_outbox_delivery_recheck(uuid,uuid)','EXECUTE') as outsider,
        (select prosecdef and proconfig @> array['search_path=pg_catalog']
         from pg_catalog.pg_proc where oid='public.native_push_outbox_delivery_recheck(uuid,uuid)'::regprocedure) as pinned
    `)).rows[0];
    assert.deepEqual(privileges, { service: true, anon: false, authenticated: false, outsider: false, pinned: true });
    await assert.rejects(db.query("select public.native_push_outbox_delivery_recheck(null,$1)", [token]), /invalid_native_push_delivery_recheck/);
  } finally {
    await db.close();
  }
});

test("native delivery migration rejects a definer-to-invoker mutation", async () => {
  const db = await new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    const original = await readFile(recheckMigration, "utf8");
    const mutated = original.replace("security definer", "security invoker");
    assert.notEqual(mutated, original, "the mutation did not change the migration");
    await assert.rejects(db.exec(mutated), /native_push_delivery_recheck_self_check_failed/);
  } finally {
    await db.close();
  }
});
