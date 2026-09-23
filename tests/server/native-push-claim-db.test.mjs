import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../../.migration-backup/supabase/migrations/20260924100000_native_push_claim.sql",
  import.meta.url,
);

test("native push claim leases each unread row once and excludes read or exhausted rows", async () => {
  const db = await new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.notifications (id uuid primary key, read_at timestamptz);
      create table public.notifications_native_push_outbox (
        id uuid primary key, notification_id uuid not null references public.notifications(id),
        device_id uuid not null, payload jsonb not null default '{}'::jsonb,
        attempt_count integer not null default 0, sent_at timestamptz,
        last_error text, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      insert into public.notifications(id,read_at) values
        ('10000000-0000-4000-8000-000000000001',null),
        ('10000000-0000-4000-8000-000000000002',null),
        ('10000000-0000-4000-8000-000000000003',now()),
        ('10000000-0000-4000-8000-000000000004',null),
        ('10000000-0000-4000-8000-000000000005',null);
      insert into public.notifications_native_push_outbox
        (id,notification_id,device_id,attempt_count,sent_at,created_at) values
        ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0,null,now()-interval '5 minutes'),
        ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',0,null,now()-interval '4 minutes'),
        ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',0,null,now()-interval '3 minutes'),
        ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000004',0,now(),now()-interval '2 minutes'),
        ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000005',5,null,now()-interval '1 minute');
    `);
    await db.exec(await readFile(migrationUrl, "utf8"));

    const claim = async (limit, token) => (await db.query(
      "select id from public.native_push_outbox_claim($1,$2) order by id",
      [limit, token],
    )).rows.map((row) => row.id);
    const tokenA = "40000000-0000-4000-8000-000000000001";
    const tokenB = "40000000-0000-4000-8000-000000000002";
    assert.deepEqual(await claim(1, tokenA), ["20000000-0000-4000-8000-000000000001"]);
    assert.deepEqual(await claim(20, tokenB), ["20000000-0000-4000-8000-000000000002"]);
    assert.deepEqual(await claim(20, "40000000-0000-4000-8000-000000000003"), []);

    const lease = (await db.query(`
      select claim_token, claimed_until > now() as live
      from public.notifications_native_push_outbox
      where id='20000000-0000-4000-8000-000000000001'
    `)).rows[0];
    assert.equal(lease.claim_token, tokenA);
    assert.equal(lease.live, true);

    await db.exec(`update public.notifications_native_push_outbox
      set claimed_until=now()-interval '1 second'
      where id='20000000-0000-4000-8000-000000000001'`);
    assert.deepEqual(await claim(20, "40000000-0000-4000-8000-000000000004"), [
      "20000000-0000-4000-8000-000000000001",
    ]);

    const permissions = (await db.query(`
      select has_function_privilege('anon','public.native_push_outbox_claim(integer,uuid)','EXECUTE') as anon,
        has_function_privilege('authenticated','public.native_push_outbox_claim(integer,uuid)','EXECUTE') as authenticated,
        has_function_privilege('service_role','public.native_push_outbox_claim(integer,uuid)','EXECUTE') as service_role
    `)).rows[0];
    assert.deepEqual(permissions, { anon: false, authenticated: false, service_role: true });
    await assert.rejects(
      db.query("select * from public.native_push_outbox_claim(1,null)"),
      /invalid_claim_token/,
    );
  } finally {
    await db.close();
  }
});
