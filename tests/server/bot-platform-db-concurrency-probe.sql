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

-- Management races run the public verbs as service_role over two real sessions.
-- Each losing operation must wait for the bot row lock, then recheck authority
-- and lifecycle state after the winning transaction commits.
insert into public.user_global_roles(user_id, role_id, assigned_by)
select
  '11111111-1111-4111-8111-111111111111'::uuid,
  role_row.id,
  '11111111-1111-4111-8111-111111111111'::uuid
from public.roles role_row
where role_row.key = 'owner'
on conflict do nothing;

insert into public.bots(id, username, display_name, state, delete_after)
values
  ('a4000000-0000-4000-8000-000000000004', 'probe_developer', 'Probe developer', 'active', null),
  ('a4000000-0000-4000-8000-000000000005', 'probe_suspend', 'Probe suspend', 'paused', null),
  ('a4000000-0000-4000-8000-000000000006', 'probe_delete', 'Probe delete', 'active', null),
  ('a4000000-0000-4000-8000-000000000007', 'probe_finalize', 'Probe finalize', 'pending_delete', pg_catalog.now() - interval '1 minute');

insert into public.bot_owners(bot_id, user_id, role)
values
  ('a4000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('a4000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'developer'),
  ('a4000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('a4000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('a4000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'owner');

insert into private.bot_tokens(bot_id, token_prefix, token_hash)
values
  ('a4000000-0000-4000-8000-000000000005', 'lc_bot_0505050505', pg_catalog.repeat('5', 64)),
  ('a4000000-0000-4000-8000-000000000006', 'lc_bot_0606060606', pg_catalog.repeat('6', 64)),
  ('a4000000-0000-4000-8000-000000000007', 'lc_bot_0707070707', pg_catalog.repeat('7', 64));

insert into private.bot_webhooks(bot_id, target_url, secret_ciphertext, secret_fingerprint)
values (
  'a4000000-0000-4000-8000-000000000007',
  'https://probe-finalize.invalid/hook',
  'enc:v1:' || pg_catalog.repeat('F', 64),
  pg_catalog.repeat('f', 16)
);
insert into private.bot_updates(bot_id, update_id, update_type, payload)
values (
  'a4000000-0000-4000-8000-000000000007',
  1,
  'message',
  '{"message":{"probe":"finalize"}}'
);
insert into private.bot_delivery_attempts(bot_id, update_id)
values ('a4000000-0000-4000-8000-000000000007', 1);

select public.dblink_connect('management_session_a', :'probe_dsn');
select public.dblink_connect('management_session_b', :'probe_dsn');
select public.dblink_exec('management_session_a', 'set role service_role');
select public.dblink_exec('management_session_b', 'set role service_role');

-- developer_removal_race: the removed developer cannot commit a stale write.
select public.dblink_exec('management_session_a', 'begin');
select removed.value
from public.dblink(
  'management_session_a',
  $$select public.bot_developer_remove_internal(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'a4000000-0000-4000-8000-000000000004'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    'developer-removal-race'
  )$$
) as removed(value jsonb);
select public.dblink_send_query(
  'management_session_b',
  $$select public.bot_management_commands_replace_internal(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'a4000000-0000-4000-8000-000000000004'::uuid,
    '[{"command":"stale","description":"Must fail"}]'::jsonb,
    'developer-removal-race-stale-write'
  )$$
);
select pg_catalog.pg_sleep(0.2);
do $probe$
begin
  if public.dblink_is_busy('management_session_b') <> 1 then
    raise exception 'developer_removal_race_did_not_wait';
  end if;
end
$probe$;
select public.dblink_exec('management_session_a', 'commit');
do $probe$
declare
  v_result record;
begin
  for v_result in
    select result.* from public.dblink_get_result('management_session_b', false) as result(value jsonb)
  loop
    raise exception 'developer_removal_race_stale_write_succeeded';
  end loop;
  if public.dblink_error_message('management_session_b') not like '%bot_management_forbidden%' then
    raise exception 'developer_removal_race_wrong_result: %', public.dblink_error_message('management_session_b');
  end if;
end
$probe$;
select result.*
from public.dblink_get_result('management_session_b', false) as result(value jsonb);

-- suspend_resume_race: platform suspension wins before owner resume rechecks.
select public.dblink_exec('management_session_a', 'begin');
select suspended.value
from public.dblink(
  'management_session_a',
  $$select public.bot_suspend_internal(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'a4000000-0000-4000-8000-000000000005'::uuid,
    true,
    'suspend-resume-race'
  )$$
) as suspended(value jsonb);
select public.dblink_send_query(
  'management_session_b',
  $$select public.bot_resume_internal(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'a4000000-0000-4000-8000-000000000005'::uuid,
    'suspend-resume-race-stale-resume'
  )$$
);
select pg_catalog.pg_sleep(0.2);
do $probe$
begin
  if public.dblink_is_busy('management_session_b') <> 1 then
    raise exception 'suspend_resume_race_did_not_wait';
  end if;
end
$probe$;
select public.dblink_exec('management_session_a', 'commit');
do $probe$
declare
  v_result record;
begin
  for v_result in
    select result.* from public.dblink_get_result('management_session_b', false) as result(value jsonb)
  loop
    raise exception 'suspend_resume_race_stale_resume_succeeded';
  end loop;
  if public.dblink_error_message('management_session_b') not like '%bot_state_conflict%'
     or not exists (
       select 1 from public.bots bot
       where bot.id = 'a4000000-0000-4000-8000-000000000005'::uuid
         and bot.state = 'suspended'
     ) then
    raise exception 'suspend_resume_race_wrong_result';
  end if;
end
$probe$;
select result.*
from public.dblink_get_result('management_session_b', false) as result(value jsonb);

-- rotate_delete_race: deletion revokes the token before stale rotation rechecks.
select public.dblink_exec('management_session_a', 'begin');
select deletion.value
from public.dblink(
  'management_session_a',
  $$select public.bot_request_deletion_internal(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'a4000000-0000-4000-8000-000000000006'::uuid,
    'rotate-delete-race'
  )$$
) as deletion(value jsonb);
select public.dblink_send_query(
  'management_session_b',
  $$select * from public.bot_rotate_token_internal(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'a4000000-0000-4000-8000-000000000006'::uuid,
    'lc_bot_1616161616',
    '1616161616161616161616161616161616161616161616161616161616161616',
    'lc_bot_0606060606',
    'rotate-delete-race-stale-rotate'
  )$$
);
select pg_catalog.pg_sleep(0.2);
do $probe$
begin
  if public.dblink_is_busy('management_session_b') <> 1 then
    raise exception 'rotate_delete_race_did_not_wait';
  end if;
end
$probe$;
select public.dblink_exec('management_session_a', 'commit');
do $probe$
declare
  v_result record;
begin
  for v_result in
    select result.* from public.dblink_get_result('management_session_b', false)
      as result(token_id uuid, token_prefix text, created_at timestamptz)
  loop
    raise exception 'rotate_delete_race_stale_rotation_succeeded';
  end loop;
  if public.dblink_error_message('management_session_b') not like '%bot_state_conflict%'
     or exists (
       select 1 from private.bot_tokens stored_token
       where stored_token.bot_id = 'a4000000-0000-4000-8000-000000000006'::uuid
         and stored_token.revoked_at is null
     ) then
    raise exception 'rotate_delete_race_wrong_result';
  end if;
end
$probe$;
select result.*
from public.dblink_get_result('management_session_b', false)
  as result(token_id uuid, token_prefix text, created_at timestamptz);

-- cancel_finalize_race: once finalization has locked a due bot, cancellation
-- waits and then fails against the committed deleted state.
select public.dblink_exec('management_session_a', 'begin');
select finalized.value
from public.dblink(
  'management_session_a',
  $$select public.bot_deletion_finalize_internal(100, 'cancel-finalize-race')$$
) as finalized(value integer);
select public.dblink_send_query(
  'management_session_b',
  $$select public.bot_cancel_deletion_internal(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'a4000000-0000-4000-8000-000000000007'::uuid,
    'cancel-finalize-race-stale-cancel'
  )$$
);
select pg_catalog.pg_sleep(0.2);
do $probe$
begin
  if public.dblink_is_busy('management_session_b') <> 1 then
    raise exception 'cancel_finalize_race_did_not_wait';
  end if;
end
$probe$;
select public.dblink_exec('management_session_a', 'commit');
do $probe$
declare
  v_result record;
begin
  for v_result in
    select result.* from public.dblink_get_result('management_session_b', false) as result(value jsonb)
  loop
    raise exception 'cancel_finalize_race_stale_cancel_succeeded';
  end loop;
  if public.dblink_error_message('management_session_b') not like '%bot_state_conflict%'
     or not exists (
       select 1 from public.bots bot
       where bot.id = 'a4000000-0000-4000-8000-000000000007'::uuid
         and bot.state = 'deleted'
         and bot.delete_after is null
     )
     or exists (
       select 1 from private.bot_tokens stored_token
       where stored_token.bot_id = 'a4000000-0000-4000-8000-000000000007'::uuid
         and stored_token.revoked_at is null
     )
     or exists (
       select 1 from private.bot_webhooks webhook
       where webhook.bot_id = 'a4000000-0000-4000-8000-000000000007'::uuid
         and webhook.state <> 'disabled'
     )
     or exists (
       select 1 from private.bot_delivery_attempts attempt
       where attempt.bot_id = 'a4000000-0000-4000-8000-000000000007'::uuid
         and attempt.status <> 'dead_letter'
     )
     or not exists (
       select 1 from private.bot_audit_events audit
       where audit.bot_id = 'a4000000-0000-4000-8000-000000000007'::uuid
         and audit.action = 'bot_deleted'
         and audit.metadata->>'request_id' = 'cancel-finalize-race'
         and audit.metadata->>'actor' = 'system'
     ) then
    raise exception 'cancel_finalize_race_wrong_result';
  end if;
end
$probe$;
select result.*
from public.dblink_get_result('management_session_b', false) as result(value jsonb);

select public.dblink_disconnect('management_session_a');
select public.dblink_disconnect('management_session_b');

delete from private.bot_operation_idempotency
where bot_id in (
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'a4000000-0000-4000-8000-000000000005'::uuid,
  'a4000000-0000-4000-8000-000000000006'::uuid,
  'a4000000-0000-4000-8000-000000000007'::uuid
);
delete from private.bot_delivery_attempts
where bot_id in (
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'a4000000-0000-4000-8000-000000000005'::uuid,
  'a4000000-0000-4000-8000-000000000006'::uuid,
  'a4000000-0000-4000-8000-000000000007'::uuid
);
delete from private.bot_updates
where bot_id in (
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'a4000000-0000-4000-8000-000000000005'::uuid,
  'a4000000-0000-4000-8000-000000000006'::uuid,
  'a4000000-0000-4000-8000-000000000007'::uuid
);
delete from private.bot_delivery_leases
where bot_id in (
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'a4000000-0000-4000-8000-000000000005'::uuid,
  'a4000000-0000-4000-8000-000000000006'::uuid,
  'a4000000-0000-4000-8000-000000000007'::uuid
);
delete from private.bot_webhooks
where bot_id in (
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'a4000000-0000-4000-8000-000000000005'::uuid,
  'a4000000-0000-4000-8000-000000000006'::uuid,
  'a4000000-0000-4000-8000-000000000007'::uuid
);
delete from private.bot_audit_events
where bot_id in (
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'a4000000-0000-4000-8000-000000000005'::uuid,
  'a4000000-0000-4000-8000-000000000006'::uuid,
  'a4000000-0000-4000-8000-000000000007'::uuid
);
delete from private.bot_tokens
where bot_id in (
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'a4000000-0000-4000-8000-000000000005'::uuid,
  'a4000000-0000-4000-8000-000000000006'::uuid,
  'a4000000-0000-4000-8000-000000000007'::uuid
);
delete from public.bot_commands
where bot_id in (
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'a4000000-0000-4000-8000-000000000005'::uuid,
  'a4000000-0000-4000-8000-000000000006'::uuid,
  'a4000000-0000-4000-8000-000000000007'::uuid
);
delete from public.bot_owners
where bot_id in (
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'a4000000-0000-4000-8000-000000000005'::uuid,
  'a4000000-0000-4000-8000-000000000006'::uuid,
  'a4000000-0000-4000-8000-000000000007'::uuid
);
delete from public.bots
where id in (
  'a4000000-0000-4000-8000-000000000004'::uuid,
  'a4000000-0000-4000-8000-000000000005'::uuid,
  'a4000000-0000-4000-8000-000000000006'::uuid,
  'a4000000-0000-4000-8000-000000000007'::uuid
);

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
