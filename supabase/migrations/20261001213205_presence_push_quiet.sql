-- Item 37: private DND pauses external alerts, not the notification feed.
-- Rollback: 20261001213205_presence_push_quiet.rollback.sql (four exact bodies).
-- Rehearse against the verified full backup before the coordinator applies once.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prestate$
DECLARE row record; p pg_proc;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:presence-push-quiet', 0)) THEN
    RAISE EXCEPTION 'presence_quiet_migration_busy';
  END IF;
  FOR row IN SELECT * FROM (VALUES
    ('public._notification_push_allowed(uuid,text,jsonb)',
     '6f560e8edc5ce3d3038f2cc42c6998c1c74b25d566f5a6cfa865ea8d102871f5',
     'postgres', 's', '["search_path=\"\""]'::jsonb, '["postgres=X/postgres","service_role=X/postgres"]'::jsonb),
    ('private.voice_push_eligible(uuid,uuid,timestamptz)',
     '713baac9ea3adac5b2ccec7b2025cc4e021df429d88cdcb5b47c9a3a8ad43eae',
     'supabase_admin', 's', '["search_path=\"\""]'::jsonb, '["supabase_admin=X/supabase_admin"]'::jsonb),
    ('public.voice_push_claim(integer,uuid)',
     '61dc21c395bc2e15b4090b9a6278c6b57d1b22cde96f0a5898e1e98f55250355',
     'supabase_admin', 'v', '["search_path=\"\""]'::jsonb, '["supabase_admin=X/supabase_admin","service_role=X/supabase_admin"]'::jsonb),
    ('public.album_push_recheck(uuid,uuid)',
     'a696a59fc42f0a3976f01d9894b725a86e60560669af2001a3c47e23cc9825ec',
     'postgres', 'v', '["search_path=pg_catalog"]'::jsonb, '["postgres=X/postgres","service_role=X/postgres"]'::jsonb)
  ) AS expected(signature, body_hash, owner_name, volatility, settings, acl) LOOP
    SELECT * INTO STRICT p FROM pg_proc WHERE oid = row.signature::regprocedure;
    IF encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') <> row.body_hash
      OR pg_get_userbyid(p.proowner) <> row.owner_name
      OR NOT p.prosecdef OR p.provolatile::text <> row.volatility
      OR to_jsonb(p.proconfig) IS DISTINCT FROM row.settings
      OR to_jsonb(p.proacl) IS DISTINCT FROM row.acl THEN
      RAISE EXCEPTION 'presence_quiet_prestate_drift:%', row.signature;
    END IF;
  END LOOP;
END
$prestate$;

SET LOCAL ROLE postgres;
DO $ordinary$
DECLARE
  ddl text := pg_get_functiondef('public._notification_push_allowed(uuid,text,jsonb)'::regprocedure);
  anchor text := $anchor$begin
  if p_kind = 'message' then$anchor$;
  replacement text := $replacement$begin
  if exists (
    select 1 from public.privacy_preferences p
    where p.user_id = p_user_id and p.manual_status = 'dnd'
      and (p.manual_status_until is null or p.manual_status_until > now())
  ) then
    return false;
  end if;
  if p_kind = 'message' then$replacement$;
BEGIN
  IF array_length(string_to_array(ddl, anchor), 1) <> 2 THEN
    RAISE EXCEPTION 'presence_quiet_ordinary_anchor_drift';
  END IF;
  EXECUTE replace(ddl, anchor, replacement);
END
$ordinary$;

SET LOCAL ROLE supabase_admin;
DO $ring$
DECLARE
  ddl text := pg_get_functiondef('private.voice_push_eligible(uuid,uuid,timestamptz)'::regprocedure);
  anchor text := $anchor$       and (e.event = 'cancel' or (e.event = 'ring'
$anchor$;
  replacement text := $replacement$       and (e.event = 'cancel' or (e.event = 'ring'
         and not exists (
           select 1 from public.privacy_preferences p
           where p.user_id = e.recipient_user_id and p.manual_status = 'dnd'
             and (p.manual_status_until is null or p.manual_status_until > p_now)
         )
$replacement$;
BEGIN
  IF array_length(string_to_array(ddl, anchor), 1) <> 2 THEN
    RAISE EXCEPTION 'presence_quiet_ring_anchor_drift';
  END IF;
  EXECUTE replace(ddl, anchor, replacement);
END
$ring$;

-- Refused pending rings must not wake up again when a short DND expires.
DO $pending_ring$
DECLARE
  ddl text := pg_get_functiondef('public.voice_push_claim(integer,uuid)'::regprocedure);
  declaration_anchor text := $declaration_anchor$  v_row record;
  v_now timestamptz;$declaration_anchor$;
  declaration_replacement text := $declaration_replacement$  v_row record;
  v_eligible boolean;
  v_quiet boolean;
  v_now timestamptz;$declaration_replacement$;
  anchor text := $anchor$  v_now := pg_catalog.clock_timestamp();
  select count(*)::integer into v_live from ($anchor$;
  replacement text := $replacement$  v_now := pg_catalog.clock_timestamp();
  with quiet_targets as (
    select d.event_id, d.push_device_id
    from public.voice_ring_push_devices d
    join public.voice_ring_push_events e on e.id = d.event_id
    join public.privacy_preferences p on p.user_id = e.recipient_user_id
    where e.state = 'pending' and e.event = 'ring' and e.expires_at > v_now
      and p.manual_status = 'dnd'
      and (p.manual_status_until is null or p.manual_status_until > v_now)
      and (d.state = 'pending' or (d.state = 'claimed' and d.claimed_until <= v_now))
    order by d.event_id, d.push_device_id
    limit v_limit
    for update of d skip locked
  )
  update public.voice_ring_push_devices d
    set state = 'terminal', claim_id = null, claimed_until = null, updated_at = v_now
    from quiet_targets q
    where d.event_id = q.event_id and d.push_device_id = q.push_device_id;
  select count(*)::integer into v_live from ($replacement$;
  admission_anchor text := $admission_anchor$    select d.event_id, d.push_device_id, e.expires_at
      from public.voice_ring_push_devices d join public.voice_ring_push_events e on e.id = d.event_id
     where$admission_anchor$;
  admission_replacement text := $admission_replacement$    select d.event_id, d.push_device_id, e.expires_at, q.quiet
      from public.voice_ring_push_devices d join public.voice_ring_push_events e on e.id = d.event_id
      -- Carry the observed refusal once, even if DND ends before the loop check.
      cross join lateral (
        select exists (
          select 1 from public.privacy_preferences p
          where e.event = 'ring' and p.user_id = e.recipient_user_id and p.manual_status = 'dnd'
            and (p.manual_status_until is null or p.manual_status_until > pg_catalog.clock_timestamp())
        ) as quiet
        offset 0
      ) q
     where$admission_replacement$;
  eligibility_anchor text := $eligibility_anchor$       and private.voice_push_eligible(d.event_id, d.push_device_id, pg_catalog.clock_timestamp())$eligibility_anchor$;
  eligibility_replacement text := $eligibility_replacement$       and (q.quiet or private.voice_push_eligible(d.event_id, d.push_device_id, pg_catalog.clock_timestamp()))$eligibility_replacement$;
  loop_anchor text := $loop_anchor$    if not private.voice_push_eligible(v_row.event_id, v_row.push_device_id, v_now) then continue; end if;$loop_anchor$;
  loop_replacement text := $loop_replacement$    select private.voice_push_eligible(v_row.event_id, v_row.push_device_id, v_now),
      v_row.quiet or exists (
        select 1 from public.voice_ring_push_events e
        join public.privacy_preferences p on p.user_id = e.recipient_user_id
        where e.id = v_row.event_id and e.event = 'ring' and p.manual_status = 'dnd'
          and (p.manual_status_until is null or p.manual_status_until > v_now)
      ) into v_eligible, v_quiet;
    if v_quiet or not v_eligible then
      if v_quiet then
        update public.voice_ring_push_devices d
          set state = 'terminal', claim_id = null, claimed_until = null, updated_at = v_now
          where d.event_id = v_row.event_id and d.push_device_id = v_row.push_device_id
            and (d.state = 'pending' or (d.state = 'claimed' and d.claimed_until <= v_now));
      end if;
      continue;
    end if;$loop_replacement$;
BEGIN
  IF array_length(string_to_array(ddl, anchor), 1) <> 2
    OR array_length(string_to_array(ddl, declaration_anchor), 1) <> 2
    OR array_length(string_to_array(ddl, admission_anchor), 1) <> 2
    OR array_length(string_to_array(ddl, eligibility_anchor), 1) <> 2
    OR array_length(string_to_array(ddl, loop_anchor), 1) <> 2 THEN
    RAISE EXCEPTION 'presence_quiet_pending_ring_anchor_drift';
  END IF;
  ddl := replace(ddl, declaration_anchor, declaration_replacement);
  ddl := replace(ddl, anchor, replacement);
  ddl := replace(ddl, admission_anchor, admission_replacement);
  ddl := replace(ddl, eligibility_anchor, eligibility_replacement);
  EXECUTE replace(ddl, loop_anchor, loop_replacement);
END
$pending_ring$;

SET LOCAL ROLE postgres;
DO $partial_album$
DECLARE
  ddl text := pg_get_functiondef('public.album_push_recheck(uuid,uuid)'::regprocedure);
  anchor text := $anchor$  select exists (
    select 1 from public.album_push_members am$anchor$;
  replacement text := $replacement$  if exists (
    select 1 from public.privacy_preferences p
    where p.user_id = v_outbox.user_id and p.manual_status = 'dnd'
      and (p.manual_status_until is null or p.manual_status_until > v_now)
  ) then
    update public.notifications_album_push_outbox o
    set suppressed_at = v_now, suppression_reason = 'not_eligible',
        claim_token = null, claimed_until = null, updated_at = v_now
    where o.id = p_outbox_id;
    return query select 'not_eligible'::text, null::jsonb;
    return;
  end if;

  select exists (
    select 1 from public.album_push_members am$replacement$;
BEGIN
  IF array_length(string_to_array(ddl, anchor), 1) <> 2 THEN
    RAISE EXCEPTION 'presence_quiet_partial_album_anchor_drift';
  END IF;
  EXECUTE replace(ddl, anchor, replacement);
END
$partial_album$;

SET LOCAL ROLE supabase_admin;

DO $selfcheck$
DECLARE row record; p pg_proc;
BEGIN
  FOR row IN SELECT * FROM (VALUES
    ('public._notification_push_allowed(uuid,text,jsonb)',
     'b143091b64cf9f1ccf1c1fcef7970411270d2dd4dacbbf8cc1ea002dc6176846',
     'postgres', 's', '["search_path=\"\""]'::jsonb, '["postgres=X/postgres","service_role=X/postgres"]'::jsonb),
    ('private.voice_push_eligible(uuid,uuid,timestamptz)',
     '86208b67c5cd15c86316ca459d0681511aef44b7bbbfc7a7e240851de25454ce',
     'supabase_admin', 's', '["search_path=\"\""]'::jsonb, '["supabase_admin=X/supabase_admin"]'::jsonb),
    ('public.voice_push_claim(integer,uuid)',
     '5af34854c7fd96923baf85191db2af06333a6f932600c93974e0e9dcb1af5f9c',
     'supabase_admin', 'v', '["search_path=\"\""]'::jsonb, '["supabase_admin=X/supabase_admin","service_role=X/supabase_admin"]'::jsonb),
    ('public.album_push_recheck(uuid,uuid)',
     '277bf3db9264699c3cc8743ce25e597bc0321a8cd5f1c6595a1ddb7d0277233b',
     'postgres', 'v', '["search_path=pg_catalog"]'::jsonb, '["postgres=X/postgres","service_role=X/postgres"]'::jsonb)
  ) AS expected(signature, body_hash, owner_name, volatility, settings, acl) LOOP
    SELECT * INTO STRICT p FROM pg_proc WHERE oid = row.signature::regprocedure;
    IF encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') <> row.body_hash
      OR pg_get_userbyid(p.proowner) <> row.owner_name
      OR NOT p.prosecdef OR p.provolatile::text <> row.volatility
      OR to_jsonb(p.proconfig) IS DISTINCT FROM row.settings
      OR to_jsonb(p.proacl) IS DISTINCT FROM row.acl THEN
      RAISE EXCEPTION 'presence_quiet_selfcheck_failed:%', row.signature;
    END IF;
  END LOOP;
END
$selfcheck$;
COMMIT;
