\set ON_ERROR_STOP on

-- Disposable PostgreSQL 17 only. dblink connections are independent backend
-- sessions and let this probe hold one transaction while exercising another.
\if :{?probe_dsn}
\else
\set probe_dsn 'dbname=postgres user=postgres host=/var/run/postgresql'
\endif

create extension if not exists dblink with schema public;

delete from private.bot_operation_idempotency
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from private.bot_delivery_attempts
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from private.bot_updates
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from private.bot_delivery_leases
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from private.bot_webhooks
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from private.bot_audit_events
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from public.bots
where id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);

insert into public.bots(id, username, display_name)
values
  ('a4000000-0000-4000-8000-000000000001', 'probe_claim_a', 'Probe claim A'),
  ('a4000000-0000-4000-8000-000000000002', 'probe_claim_b', 'Probe claim B'),
  ('a4000000-0000-4000-8000-000000000003', 'probe_poll_c', 'Probe poll C');

insert into private.bot_webhooks(
  bot_id,
  target_url,
  secret_ciphertext,
  secret_fingerprint
)
values
  (
    'a4000000-0000-4000-8000-000000000001',
    'https://probe-a.invalid/hook',
    'enc:v1:' || repeat('A', 64),
    repeat('a', 16)
  ),
  (
    'a4000000-0000-4000-8000-000000000002',
    'https://probe-b.invalid/hook',
    'enc:v1:' || repeat('B', 64),
    repeat('b', 16)
  );

insert into private.bot_updates(bot_id, update_id, update_type, payload)
values
  ('a4000000-0000-4000-8000-000000000001', 1, 'message', '{"message":{"probe":"a1"}}'),
  ('a4000000-0000-4000-8000-000000000001', 2, 'message', '{"message":{"probe":"a2"}}'),
  ('a4000000-0000-4000-8000-000000000002', 1, 'message', '{"message":{"probe":"b1"}}'),
  ('a4000000-0000-4000-8000-000000000002', 2, 'message', '{"message":{"probe":"b2"}}');

insert into private.bot_delivery_attempts(bot_id, update_id)
values
  ('a4000000-0000-4000-8000-000000000001', 1),
  ('a4000000-0000-4000-8000-000000000001', 2),
  ('a4000000-0000-4000-8000-000000000002', 1),
  ('a4000000-0000-4000-8000-000000000002', 2);

select public.dblink_connect('claim_session_a', :'probe_dsn');
select public.dblink_connect('claim_session_b', :'probe_dsn');
select public.dblink_exec('claim_session_a', 'begin');

create temporary table probe_claim_a as
select claimed.*
from public.dblink(
  'claim_session_a',
  $$select * from public.bot_delivery_claim_internal(
    1,
    'a4000000-0000-4000-8000-000000000011'::uuid
  )$$
) as claimed(
  attempt_id bigint,
  bot_id uuid,
  update_id bigint,
  attempt_count integer,
  webhook_epoch bigint
);

create temporary table probe_claim_b as
select claimed.*
from public.dblink(
  'claim_session_b',
  $$select * from public.bot_delivery_claim_internal(
    2,
    'a4000000-0000-4000-8000-000000000012'::uuid
  )$$
) as claimed(
  attempt_id bigint,
  bot_id uuid,
  update_id bigint,
  attempt_count integer,
  webhook_epoch bigint
);

do $probe$
begin
  if (select pg_catalog.count(*) from probe_claim_a) <> 1
     or not exists (
       select 1 from probe_claim_a
       where bot_id = 'a4000000-0000-4000-8000-000000000001'::uuid
         and update_id = 1
     ) then
    raise exception 'claim_session_a_did_not_lock_first_update';
  end if;
  if (select pg_catalog.count(*) from probe_claim_b) <> 1
     or not exists (
       select 1 from probe_claim_b
       where bot_id = 'a4000000-0000-4000-8000-000000000002'::uuid
         and update_id = 1
     )
     or exists (
       select 1 from probe_claim_b
       where bot_id = 'a4000000-0000-4000-8000-000000000001'::uuid
     ) then
    raise exception 'claim_session_b_bypassed_per_bot_ordering_or_skip_locked';
  end if;
end
$probe$;

select public.dblink_exec('claim_session_a', 'commit');

select public.dblink_exec('claim_session_a', 'begin');
create temporary table probe_poll_result as
select polled.*
from public.dblink(
  'claim_session_a',
  $$select * from public.bot_updates_poll_internal(
    'a4000000-0000-4000-8000-000000000003'::uuid,
    0,
    1,
    array[]::text[],
    'a4000000-0000-4000-8000-000000000013'::uuid
  )$$
) as polled(
  update_id bigint,
  update_type text,
  payload jsonb,
  available_at timestamptz,
  expires_at timestamptz
);

select public.dblink_send_query(
  'claim_session_b',
  $$select public.bot_webhook_set_internal(
    'a4000000-0000-4000-8000-000000000003'::uuid,
    'https://probe-c.invalid/hook',
    'enc:v1:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    'cccccccccccccccc',
    false,
    'probe-lock-webhook',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  )$$
);
select pg_catalog.pg_sleep(0.2);

do $probe$
begin
  if public.dblink_is_busy('claim_session_b') <> 1 then
    raise exception 'webhook_mutation_did_not_wait_for_polling_lease_lock';
  end if;
end
$probe$;

select public.dblink_exec('claim_session_a', 'commit');

do $probe$
declare
  v_result record;
  v_error text;
begin
  for v_result in
    select result.*
    from public.dblink_get_result('claim_session_b', false) as result(value jsonb)
  loop
    raise exception 'webhook_mutation_succeeded_while_polling_lease_active';
  end loop;
  v_error := public.dblink_error_message('claim_session_b');
  if v_error not like '%bot_polling_active%' then
    raise exception 'webhook_mutation_conflict_missing: %', v_error;
  end if;
end
$probe$;

select public.bot_updates_poll_release_internal(
  'a4000000-0000-4000-8000-000000000003'::uuid,
  'a4000000-0000-4000-8000-000000000013'::uuid
);
select public.dblink_disconnect('claim_session_a');
select public.dblink_disconnect('claim_session_b');

delete from private.bot_operation_idempotency
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from private.bot_delivery_attempts
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from private.bot_updates
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from private.bot_delivery_leases
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from private.bot_webhooks
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from private.bot_audit_events
where bot_id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);
delete from public.bots
where id in (
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000003'::uuid
);

select 'bot_platform_db_concurrency_probe_ok' as result;
