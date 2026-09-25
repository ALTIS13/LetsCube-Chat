import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../../supabase/migrations/20260924095548_web_push_delivery_recheck.sql",
  import.meta.url,
);
const ownerMigrationUrl = new URL(
  "../../supabase/migrations/20260925222612_web_push_subscription_owner_recheck.sql",
  import.meta.url,
);

test("a claimed Web Push row is rechecked against read, foreground and subscription state", async () => {
  const db = await new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;

      create table public.notifications (
        id uuid primary key,
        user_id uuid not null,
        read_at timestamptz
      );
      create table public.push_subscriptions (
        id uuid primary key,
        user_id uuid not null,
        is_active boolean not null default true
      );
      create table public.push_foreground_sessions (
        user_id uuid not null,
        client_id uuid not null,
        expires_at timestamptz not null,
        primary key (user_id, client_id)
      );
      create table public.notifications_push_outbox (
        id uuid primary key,
        notification_id uuid not null references public.notifications(id),
        subscription_id uuid not null references public.push_subscriptions(id),
        user_id uuid not null,
        payload jsonb not null default '{}'::jsonb,
        attempt_count integer not null default 0,
        sent_at timestamptz,
        suppressed_at timestamptz,
        suppression_reason text,
        claim_token uuid,
        claimed_until timestamptz,
        created_at timestamptz not null default now(),
        constraint notifications_push_outbox_suppression_reason_check
          check (suppression_reason is null or suppression_reason in ('read','coalesced','subscription_inactive'))
      );

      insert into public.push_subscriptions(id,user_id,is_active) values
        ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',true),
        ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',true),
        ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003',true),
        ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004',false),
        ('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000005',true),
        ('30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000006',true),
        ('30000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000099',true);
      insert into public.notifications(id,user_id,read_at) values
        ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',now()),
        ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',null),
        ('10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003',null),
        ('10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004',null),
        ('10000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000005',null),
        ('10000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000006',null),
        ('10000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000007',null);
      insert into public.notifications_push_outbox(
        id,notification_id,subscription_id,user_id,claim_token,claimed_until
      ) values
        ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',now()+interval '60 seconds'),
        ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001',now()+interval '60 seconds'),
        ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000001',now()+interval '60 seconds'),
        ('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000001',now()+interval '60 seconds'),
        ('40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000001',now()+interval '60 seconds'),
        ('40000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000006','50000000-0000-4000-8000-000000000001',now()+interval '60 seconds'),
        ('40000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000007','50000000-0000-4000-8000-000000000001',now()+interval '60 seconds');
      insert into public.push_foreground_sessions(user_id,client_id,expires_at) values
        ('20000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',now()+interval '20 seconds'),
        ('20000000-0000-4000-8000-000000000006','60000000-0000-4000-8000-000000000002',now()-interval '1 second');
    `);

    const migration = await readFile(migrationUrl, "utf8");
    await db.exec(migration);
    await db.exec(await readFile(ownerMigrationUrl, "utf8"));

    const token = "50000000-0000-4000-8000-000000000001";
    const recheck = async (rowId, claimToken = token) => (await db.query(
      "select public.push_outbox_delivery_recheck($1,$2) as status",
      [rowId, claimToken],
    )).rows[0].status;

    assert.equal(await recheck("40000000-0000-4000-8000-000000000001"), "read");
    assert.equal(await recheck("40000000-0000-4000-8000-000000000002"), "foreground");
    assert.equal(await recheck("40000000-0000-4000-8000-000000000003"), "deliver");
    assert.equal(await recheck("40000000-0000-4000-8000-000000000004"), "subscription_inactive");
    assert.equal(
      await recheck(
        "40000000-0000-4000-8000-000000000005",
        "50000000-0000-4000-8000-000000000099",
      ),
      "claim_lost",
    );
    assert.equal(await recheck("40000000-0000-4000-8000-000000000006"), "deliver");
    assert.equal(await recheck("40000000-0000-4000-8000-000000000007"), "subscription_inactive");

    const rows = (await db.query(`
      select id, suppression_reason, claim_token is null as released
      from public.notifications_push_outbox
      order by id
    `)).rows;
    assert.deepEqual(rows, [
      { id: "40000000-0000-4000-8000-000000000001", suppression_reason: "read", released: true },
      { id: "40000000-0000-4000-8000-000000000002", suppression_reason: null, released: true },
      { id: "40000000-0000-4000-8000-000000000003", suppression_reason: null, released: false },
      { id: "40000000-0000-4000-8000-000000000004", suppression_reason: "subscription_inactive", released: true },
      { id: "40000000-0000-4000-8000-000000000005", suppression_reason: null, released: false },
      { id: "40000000-0000-4000-8000-000000000006", suppression_reason: null, released: false },
      { id: "40000000-0000-4000-8000-000000000007", suppression_reason: "subscription_inactive", released: true },
    ]);

    const permissions = (await db.query(`
      select
        has_function_privilege('anon','public.push_outbox_delivery_recheck(uuid,uuid)','EXECUTE') as anon,
        has_function_privilege('authenticated','public.push_outbox_delivery_recheck(uuid,uuid)','EXECUTE') as authenticated,
        has_function_privilege('service_role','public.push_outbox_delivery_recheck(uuid,uuid)','EXECUTE') as service_role
    `)).rows[0];
    assert.deepEqual(permissions, { anon: false, authenticated: false, service_role: true });

    const mutation = migration.replace(
      "\nsecurity definer\n",
      "\nsecurity invoker\n",
    );
    assert.notEqual(mutation, migration);
    await assert.rejects(
      db.exec(mutation),
      /web_push_delivery_recheck_self_check_failed/,
    );
  } finally {
    await db.close();
  }
});
