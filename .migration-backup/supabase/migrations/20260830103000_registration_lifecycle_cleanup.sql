-- Registration lifecycle cleanup proposal.
-- Do not apply automatically; review and deploy through the approved database process.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.registration_lifecycles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  signup_kind text not null check (signup_kind in ('public', 'invite')),
  invite_code_hash text null check (
    invite_code_hash is null or invite_code_hash ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz not null default now(),
  eligible_at timestamptz not null,
  extension_used boolean not null default false,
  admin_hold_at timestamptz null,
  claim_token uuid null,
  claimed_at timestamptz null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text null,
  updated_at timestamptz not null default now()
);

create table private.registration_cleanup_audit (
  id bigint generated always as identity primary key,
  user_reference uuid not null,
  action text not null check (action in ('reported', 'deleted', 'skipped', 'failed')),
  reason_code text not null,
  created_at timestamptz not null default now()
);

create index registration_lifecycles_due_idx
  on private.registration_lifecycles (eligible_at, claimed_at)
  where admin_hold_at is null;
create index registration_cleanup_audit_retention_idx
  on private.registration_cleanup_audit (created_at);

-- Bots are separate from auth.users in this repository. Human Auth rows are
-- exempt when an actual role or reserved operational identity marks them as
-- privileged, administrative, or service-owned.
create or replace function private.registration_identity_requires_hold(
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_legacy_role boolean := false;
begin
  if p_user_id is null then
    return true;
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and (
        p.role::text <> 'user'
        or (
          p.username is not null
          and public.profile_reserved_username_key(p.username)
            = any(public.profile_reserved_username_keys())
        )
      )
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.user_global_roles ugr
    join public.roles r on r.id = ugr.role_id
    where ugr.user_id = p_user_id
      and r.scope = 'global'
      and r.is_active
      and r.key <> 'user'
  ) then
    return true;
  end if;

  -- user_roles is the legacy role-assignment table and may be absent on newer
  -- installations, so inspect it only when its qualified relation exists.
  if pg_catalog.to_regclass('public.user_roles') is not null then
    execute $query$
      select exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = $1
          and r.key <> 'user'
      )
    $query$
    into v_legacy_role
    using p_user_id;
  end if;

  return coalesce(v_legacy_role, false);
end
$function$;

revoke all on function private.registration_identity_requires_hold(uuid)
  from public, anon, authenticated, service_role;

-- This predicate contains only user-initiated or user-authored product state.
-- Registration invite use, global/location role assignment and club
-- provisioning are intentionally absent because they are provisional signup
-- effects rather than product activity by the new account.
create or replace function private.registration_has_product_activity(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
  select p_user_id is null
    or exists (select 1 from public.messages m where m.user_id = p_user_id)
    or exists (
      select 1
      from storage.objects o
      where o.owner_id = p_user_id::text
        or (
          o.bucket_id = 'media'
          and (
            (storage.foldername(o.name))[1] = p_user_id::text
            or (
              (storage.foldername(o.name))[1] = 'avatars'
              and (storage.foldername(o.name))[2] = p_user_id::text
            )
          )
        )
    )
    or exists (select 1 from public.reactions r where r.user_id = p_user_id)
    or exists (
      select 1 from public.message_hidden_for_users mh
      where mh.user_id = p_user_id
    )
    or exists (
      select 1 from public.tasks t
      where t.created_by = p_user_id
        or t.assignee_id = p_user_id
        or t.deleted_by = p_user_id
    )
    or exists (select 1 from public.task_events te where te.actor_id = p_user_id)
    or exists (
      select 1 from public.task_recurrences tr where tr.created_by = p_user_id
    )
    or exists (
      select 1 from public.task_recurrence_events tre
      where tre.actor_id = p_user_id
    )
    or exists (
      select 1 from public.profile_contacts pc
      where pc.user_id = p_user_id and pc.phone_verified
    )
    or exists (select 1 from public.chats c where c.created_by = p_user_id)
    or exists (
      select 1 from public.chat_members cm
      where cm.user_id = p_user_id
        and (
          cm.last_read_at is not null
          or cm.cleared_at is not null
          or cm.hidden_at is not null
          or cm.pinned
          or cm.pinned_at is not null
        )
    )
    or exists (
      select 1 from public.group_invites gi
      where gi.inviter_id = p_user_id
        or (gi.invitee_id = p_user_id and gi.responded_at is not null)
    )
    or exists (
      select 1 from public.folders f
      where f.user_id = p_user_id or f.created_by = p_user_id
    )
    or exists (select 1 from public.locations loc where loc.created_by = p_user_id)
    or exists (select 1 from public.topics topic where topic.created_by = p_user_id)
    or exists (select 1 from public.audit_logs al where al.actor_id = p_user_id)
    or exists (select 1 from public.bans b where b.issued_by = p_user_id)
    or exists (select 1 from public.mutes mu where mu.issued_by = p_user_id)
    or exists (
      select 1 from public.push_subscriptions ps where ps.user_id = p_user_id
    )
    or exists (
      select 1 from public.user_push_devices upd where upd.user_id = p_user_id
    )
    or exists (
      select 1 from public.push_foreground_sessions pfs
      where pfs.user_id = p_user_id
    )
    or exists (
      select 1 from public.notification_preferences np
      where np.user_id = p_user_id
    )
    or exists (
      select 1 from public.chat_notification_preferences cnp
      where cnp.user_id = p_user_id
    )
    or exists (
      select 1 from public.support_tickets st
      where st.requester_user_id = p_user_id
    )
    or exists (
      select 1 from public.support_ticket_messages stm
      where stm.author_user_id = p_user_id
    )
    or exists (
      select 1 from public.support_ticket_events ste
      where ste.actor_user_id = p_user_id
    )
    or exists (
      select 1 from public.support_operator_preferences sop
      where sop.operator_user_id = p_user_id
    )
    or exists (
      select 1 from public.privacy_acceptances pa
      where pa.user_id = p_user_id
        and pa.acceptance_context <> 'registration'
    )
    or exists (
      select 1 from public.phone_verification_claims pvc
      where pvc.user_id = p_user_id
    )
    or exists (
      select 1 from public.phone_verification_sms_events pvse
      where pvse.user_id = p_user_id
    )
    or exists (
      select 1 from public.registration_invites ri
      where ri.created_by = p_user_id
    );
$function$;

revoke all on function private.registration_has_product_activity(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.registration_lifecycle_register_internal(
  p_user_id uuid,
  p_signup_kind text,
  p_invite_code_hash text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_created_at timestamptz;
  v_eligible_at timestamptz;
  v_admin_hold_at timestamptz;
begin
  if p_user_id is null then
    raise exception 'registration_user_invalid' using errcode = '22023';
  end if;
  if p_signup_kind not in ('public', 'invite') then
    raise exception 'registration_kind_invalid' using errcode = '22023';
  end if;
  if p_signup_kind = 'invite'
     and (p_invite_code_hash is null or p_invite_code_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'registration_invite_hash_invalid' using errcode = '22023';
  end if;
  if p_signup_kind = 'public' and p_invite_code_hash is not null then
    raise exception 'registration_invite_hash_unexpected' using errcode = '22023';
  end if;

  select u.created_at
  into strict v_created_at
  from auth.users u
  where u.id = p_user_id;

  v_eligible_at := v_created_at + case
    when p_signup_kind = 'invite' then interval '7 days'
    else interval '72 hours'
  end;
  v_admin_hold_at := case
    when private.registration_identity_requires_hold(p_user_id)
      then pg_catalog.now()
    else null
  end;

  insert into private.registration_lifecycles as l (
    user_id,
    signup_kind,
    invite_code_hash,
    created_at,
    eligible_at,
    admin_hold_at
  ) values (
    p_user_id,
    p_signup_kind,
    p_invite_code_hash,
    v_created_at,
    v_eligible_at,
    v_admin_hold_at
  )
  on conflict (user_id) do update
  set admin_hold_at = coalesce(l.admin_hold_at, excluded.admin_hold_at),
      updated_at = case
        when excluded.admin_hold_at is not null then pg_catalog.now()
        else l.updated_at
      end;
end
$function$;

revoke all on function public.registration_lifecycle_register_internal(uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_lifecycle_register_internal(uuid,text,text)
  to service_role;

create or replace function public.registration_lifecycle_extend_by_email_internal(
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
begin
  if v_email is null
     or pg_catalog.octet_length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return false;
  end if;

  update private.registration_lifecycles l
  set eligible_at = greatest(
        l.eligible_at,
        least(
          case when l.signup_kind = 'invite'
                 then l.created_at + interval '14 days'
               else l.created_at + interval '7 days'
          end,
          pg_catalog.now() + interval '72 hours'
        )
      ),
      extension_used = true,
      updated_at = pg_catalog.now()
  from auth.users u
  where u.id = l.user_id
    and pg_catalog.lower(pg_catalog.btrim(u.email)) = v_email
    and u.email_confirmed_at is null
    and u.phone_confirmed_at is null
    and u.last_sign_in_at is null
    and not l.extension_used;

  return found;
end
$function$;

revoke all on function public.registration_lifecycle_extend_by_email_internal(text)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_lifecycle_extend_by_email_internal(text)
  to service_role;

create or replace function public.registration_cleanup_claim(
  p_limit integer,
  p_claim_token uuid,
  p_now timestamptz
)
returns table(user_id uuid, signup_kind text)
language sql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
  with exempted as (
    update private.registration_lifecycles l
    set admin_hold_at = p_now,
        claim_token = null,
        claimed_at = null,
        updated_at = p_now
    where p_now is not null
      and l.admin_hold_at is null
      and private.registration_identity_requires_hold(l.user_id)
    returning l.user_id
  ), due as (
    select l.user_id
    from private.registration_lifecycles l
    join auth.users u on u.id = l.user_id
    where p_claim_token is not null
      and p_now is not null
      and l.eligible_at <= p_now
      and l.admin_hold_at is null
      and not private.registration_identity_requires_hold(u.id)
      and not private.registration_has_product_activity(u.id)
      and not exists (
        select 1 from exempted e where e.user_id = l.user_id
      )
      and (
        l.claim_token is null
        or l.claimed_at < p_now - interval '15 minutes'
      )
      and u.email_confirmed_at is null
      and u.phone_confirmed_at is null
      and u.last_sign_in_at is null
    order by l.eligible_at, l.user_id
    limit least(greatest(coalesce(p_limit, 0), 0), 100)
    for update of l skip locked
  ), claimed as (
    update private.registration_lifecycles l
    set claim_token = p_claim_token,
        claimed_at = p_now,
        attempt_count = l.attempt_count + 1,
        updated_at = p_now
    from due
    where l.user_id = due.user_id
    returning l.user_id, l.signup_kind
  )
  select claimed.user_id, claimed.signup_kind
  from claimed;
$function$;

revoke all on function public.registration_cleanup_claim(integer,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_cleanup_claim(integer,uuid,timestamptz)
  to service_role;

create or replace function public.registration_cleanup_recheck(
  p_user_id uuid,
  p_claim_token uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
begin
  if p_user_id is null or p_claim_token is null or p_now is null then
    return false;
  end if;

  if private.registration_identity_requires_hold(p_user_id) then
    update private.registration_lifecycles l
    set admin_hold_at = coalesce(l.admin_hold_at, p_now),
        claim_token = null,
        claimed_at = null,
        updated_at = p_now
    where l.user_id = p_user_id;
    return false;
  end if;

  return coalesce(exists (
    select 1
    from private.registration_lifecycles l
    join auth.users u on u.id = l.user_id
    where l.user_id = p_user_id
      and l.claim_token = p_claim_token
      and l.eligible_at <= p_now
      and l.admin_hold_at is null
      and not private.registration_identity_requires_hold(u.id)
      and not private.registration_has_product_activity(u.id)
      and u.email_confirmed_at is null
      and u.phone_confirmed_at is null
      and u.last_sign_in_at is null
  ), false);
end
$function$;

revoke all on function public.registration_cleanup_recheck(uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_cleanup_recheck(uuid,uuid,timestamptz)
  to service_role;

create or replace function public.registration_cleanup_finish(
  p_user_id uuid,
  p_claim_token uuid,
  p_action text,
  p_reason_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
begin
  if p_action not in ('reported', 'deleted', 'skipped', 'failed') then
    raise exception 'registration_cleanup_action_invalid' using errcode = '22023';
  end if;
  if p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'registration_cleanup_reason_invalid' using errcode = '22023';
  end if;

  update private.registration_lifecycles l
  set claim_token = null,
      claimed_at = null,
      admin_hold_at = case
        when p_action = 'reported'
          then coalesce(l.admin_hold_at, pg_catalog.now())
        else l.admin_hold_at
      end,
      last_error_code = case when p_action = 'failed' then p_reason_code else null end,
      updated_at = pg_catalog.now()
  where l.user_id = p_user_id
    and l.claim_token = p_claim_token
    and p_claim_token is not null;

  if not found and p_action <> 'deleted' then
    raise exception 'registration_cleanup_claim_not_found' using errcode = 'P0002';
  end if;

  insert into private.registration_cleanup_audit(user_reference, action, reason_code)
  values (p_user_id, p_action, p_reason_code);
end
$function$;

revoke all on function public.registration_cleanup_finish(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_cleanup_finish(uuid,uuid,text,text)
  to service_role;

create or replace function public.registration_lifecycle_backfill_internal(
  p_limit integer,
  p_enabled_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_inserted integer;
begin
  if p_enabled_at is null then
    raise exception 'registration_lifecycle_enabled_at_required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'registration_lifecycle_limit_invalid' using errcode = '22023';
  end if;

  with candidates as (
    select
      u.id,
      u.created_at,
      case when exists (
        select 1
        from public.registration_invite_uses riu
        where riu.user_id = u.id
      ) then 'invite'::text else 'public'::text end as signup_kind,
      private.registration_identity_requires_hold(u.id) as requires_hold
    from auth.users u
    where u.email_confirmed_at is null
      and u.phone_confirmed_at is null
      and u.last_sign_in_at is null
      and not exists (
        select 1
        from private.registration_lifecycles l
        where l.user_id = u.id
      )
    order by u.created_at, u.id
    limit p_limit
  )
  insert into private.registration_lifecycles(
    user_id,
    signup_kind,
    created_at,
    eligible_at,
    admin_hold_at
  )
  select
    candidates.id,
    candidates.signup_kind,
    candidates.created_at,
    greatest(
      candidates.created_at + case
        when candidates.signup_kind = 'invite' then interval '7 days'
        else interval '72 hours'
      end,
      p_enabled_at + interval '24 hours'
    ),
    case when candidates.requires_hold then p_enabled_at else null end
  from candidates
  on conflict (user_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$function$;

revoke all on function public.registration_lifecycle_backfill_internal(integer,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_lifecycle_backfill_internal(integer,timestamptz)
  to service_role;

commit;
