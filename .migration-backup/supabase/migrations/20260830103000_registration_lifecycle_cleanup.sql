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
  failure_count integer not null default 0 check (failure_count between 0 and 5),
  next_attempt_at timestamptz null,
  dead_lettered_at timestamptz null,
  last_error_code text null check (
    last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  updated_at timestamptz not null default now()
);

create table private.registration_cleanup_audit (
  id bigint generated always as identity primary key,
  user_reference uuid not null,
  action text not null check (
    action in ('reported', 'deleted', 'skipped', 'failed', 'recovered')
  ),
  reason_code text not null,
  created_at timestamptz not null default now()
);

create table private.registration_location_provenance (
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null,
  invite_id uuid not null,
  role_id uuid null,
  legacy_role text not null check (
    legacy_role in ('owner', 'admin', 'manager', 'staff')
  ),
  primary_admin_id uuid null,
  is_primary boolean not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id, location_id)
);

create index registration_lifecycles_due_idx
  on private.registration_lifecycles (
    coalesce(next_attempt_at, eligible_at),
    eligible_at,
    user_id
  )
  where admin_hold_at is null and dead_lettered_at is null;
create index registration_lifecycles_retry_idx
  on private.registration_lifecycles (next_attempt_at, eligible_at, user_id)
  where admin_hold_at is null
    and dead_lettered_at is null
    and next_attempt_at is not null;
create index registration_lifecycles_dead_letter_idx
  on private.registration_lifecycles (dead_lettered_at, user_id)
  where dead_lettered_at is not null;
create index registration_cleanup_audit_retention_idx
  on private.registration_cleanup_audit (created_at);
create index registration_location_provenance_invite_idx
  on private.registration_location_provenance (invite_id, user_id);

revoke all on table private.registration_lifecycles,
  private.registration_cleanup_audit,
  private.registration_location_provenance
  from public, anon, authenticated, service_role;

create or replace function private.registration_location_membership_requires_hold(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
  select p_user_id is null
    or exists (
      select 1
      from public.location_members lm
      where lm.user_id = p_user_id
        and not exists (
          select 1
          from private.registration_location_provenance provenance
          where provenance.user_id = lm.user_id
            and provenance.location_id = lm.location_id
            and provenance.role_id is not distinct from lm.role_id
            and provenance.legacy_role = lm.role
            and provenance.primary_admin_id is not distinct from lm.primary_admin_id
            and provenance.is_primary = lm.is_primary
        )
    );
$function$;

revoke all on function private.registration_location_membership_requires_hold(uuid)
  from public, anon, authenticated, service_role;

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

  if private.registration_location_membership_requires_hold(p_user_id) then
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

create or replace function private.registration_record_invite_location_provenance(
  p_user_id uuid,
  p_invite_code_hash text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_recorded integer := 0;
begin
  if p_user_id is null then
    return 0;
  end if;
  if p_invite_code_hash is not null
     and p_invite_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'registration_invite_hash_invalid' using errcode = '22023';
  end if;

  -- A retry after lifecycle creation must never recreate provenance invalidated
  -- by a later explicit assignment.
  if exists (
    select 1
    from private.registration_lifecycles l
    where l.user_id = p_user_id
  ) then
    return 0;
  end if;

  with exact_matches as (
    select distinct on (riu.user_id, ri.location_id)
      riu.user_id,
      ri.location_id,
      ri.id as invite_id,
      ri.location_role_id as role_id,
      lm.role as legacy_role,
      lm.primary_admin_id,
      lm.is_primary
    from public.registration_invite_uses riu
    join public.registration_invites ri on ri.id = riu.invite_id
    join public.roles r
      on r.id = ri.location_role_id
     and r.scope = 'location'
     and r.is_active
    join public.location_members lm
      on lm.user_id = riu.user_id
     and lm.location_id = ri.location_id
    where riu.user_id = p_user_id
      and ri.location_id is not null
      and ri.location_role_id is not null
      and (
        p_invite_code_hash is null
        or pg_catalog.encode(extensions.digest(ri.code, 'sha256'), 'hex')
          = p_invite_code_hash
      )
      and ri.location_role_id = lm.role_id
      and lm.role = case r.key
        when 'location_owner' then 'owner'
        when 'location_admin' then 'admin'
        when 'location_manager' then 'manager'
        else 'staff'
      end
      and lm.primary_admin_id is not distinct from case
        when r.key = 'location_staff' then ri.primary_admin_id
        else null
      end
      and lm.is_primary = false
      -- registration_invite_consume writes both timestamps with now() in one
      -- transaction. Any later assignment, including the same values, changes
      -- location_members.updated_at and must not be treated as provisional.
      and lm.updated_at = riu.used_at
    order by riu.user_id, ri.location_id, riu.used_at desc, ri.id
  )
  insert into private.registration_location_provenance as provenance (
    user_id,
    location_id,
    invite_id,
    role_id,
    legacy_role,
    primary_admin_id,
    is_primary
  )
  select
    exact_matches.user_id,
    exact_matches.location_id,
    exact_matches.invite_id,
    exact_matches.role_id,
    exact_matches.legacy_role,
    exact_matches.primary_admin_id,
    exact_matches.is_primary
  from exact_matches
  on conflict (user_id, location_id) do update
  set invite_id = excluded.invite_id,
      role_id = excluded.role_id,
      legacy_role = excluded.legacy_role,
      primary_admin_id = excluded.primary_admin_id,
      is_primary = excluded.is_primary,
      recorded_at = pg_catalog.now();

  get diagnostics v_recorded = row_count;
  return v_recorded;
end
$function$;

revoke all on function private.registration_record_invite_location_provenance(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.registration_location_membership_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
begin
  if exists (
    select 1
    from private.registration_lifecycles l
    where l.user_id = new.user_id
  ) then
    delete from private.registration_location_provenance provenance
    where provenance.user_id = new.user_id
      and provenance.location_id = new.location_id;

    update private.registration_lifecycles l
    set admin_hold_at = coalesce(l.admin_hold_at, pg_catalog.clock_timestamp()),
        updated_at = pg_catalog.clock_timestamp()
    where l.user_id = new.user_id;
  end if;

  return new;
end
$function$;

revoke all on function private.registration_location_membership_guard()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_registration_location_membership_guard
  on public.location_members;
create trigger trg_registration_location_membership_guard
  after insert or update on public.location_members
  for each row execute function private.registration_location_membership_guard();

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
  if p_signup_kind = 'invite' then
    perform private.registration_record_invite_location_provenance(
      p_user_id,
      p_invite_code_hash
    );
  end if;
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
  with hold_candidates as (
    select l.user_id
    from private.registration_lifecycles l
    where p_limit between 1 and 100
      and p_claim_token is not null
      and p_now is not null
      and l.eligible_at <= p_now
      and l.admin_hold_at is null
      and l.dead_lettered_at is null
      and private.registration_identity_requires_hold(l.user_id)
    order by l.eligible_at, l.user_id
    limit p_limit
    for update of l skip locked
  ), held as (
    update private.registration_lifecycles l
    set admin_hold_at = p_now,
        claim_token = null,
        claimed_at = null,
        updated_at = p_now
    from hold_candidates candidate
    where l.user_id = candidate.user_id
    returning l.user_id
  ), locked_candidates as (
    select l.user_id, l.signup_kind
    from private.registration_lifecycles l
    join auth.users u on u.id = l.user_id
    where p_limit between 1 and 100
      and p_claim_token is not null
      and p_now is not null
      and l.eligible_at <= p_now
      and l.admin_hold_at is null
      and l.dead_lettered_at is null
      and coalesce(l.next_attempt_at, l.eligible_at) <= p_now
      and (
        l.claim_token is null
        or l.claimed_at < p_now - interval '15 minutes'
      )
      and u.email_confirmed_at is null
      and u.phone_confirmed_at is null
      and u.last_sign_in_at is null
      and not private.registration_identity_requires_hold(l.user_id)
      and not private.registration_has_product_activity(l.user_id)
    order by
      coalesce(l.next_attempt_at, l.eligible_at),
      l.eligible_at,
      l.user_id
    limit p_limit
    for update of l skip locked
  ), claimed as (
    update private.registration_lifecycles l
    set claim_token = p_claim_token,
        claimed_at = p_now,
        attempt_count = l.attempt_count + 1,
        updated_at = p_now
    from locked_candidates candidate
    where l.user_id = candidate.user_id
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
      and l.claimed_at > p_now - interval '15 minutes'
      and l.eligible_at <= p_now
      and l.admin_hold_at is null
      and l.dead_lettered_at is null
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

create or replace function public.registration_cleanup_delete(
  p_user_id uuid,
  p_claim_token uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_deleted integer := 0;
begin
  if p_user_id is null or p_claim_token is null or p_now is null then
    return false;
  end if;

  -- Wait only briefly for current product writes. Once acquired, these locks
  -- let the final activity snapshot and Auth delete complete without a writer
  -- committing between them. Reads remain available.
  perform pg_catalog.set_config('lock_timeout', '500ms', true);
  lock table
    public.profiles,
    public.user_global_roles,
    public.roles,
    public.location_members,
    public.messages,
    storage.objects,
    public.reactions,
    public.message_hidden_for_users,
    public.tasks,
    public.task_events,
    public.task_recurrences,
    public.task_recurrence_events,
    public.profile_contacts,
    public.chats,
    public.chat_members,
    public.group_invites,
    public.folders,
    public.locations,
    public.topics,
    public.audit_logs,
    public.bans,
    public.mutes,
    public.push_subscriptions,
    public.user_push_devices,
    public.push_foreground_sessions,
    public.notification_preferences,
    public.chat_notification_preferences,
    public.support_tickets,
    public.support_ticket_messages,
    public.support_ticket_events,
    public.support_operator_preferences,
    public.privacy_acceptances,
    public.phone_verification_claims,
    public.phone_verification_sms_events,
    public.registration_invites
  in share row exclusive mode;

  if pg_catalog.to_regclass('public.user_roles') is not null then
    execute 'lock table public.user_roles in share row exclusive mode';
  end if;

  perform 1
  from private.registration_lifecycles l
  join auth.users u on u.id = l.user_id
  join public.profiles profile on profile.id = u.id
  where l.user_id = p_user_id
    and l.claim_token = p_claim_token
    and l.claimed_at > p_now - interval '15 minutes'
    and l.eligible_at <= p_now
    and l.admin_hold_at is null
    and l.dead_lettered_at is null
    and not private.registration_identity_requires_hold(l.user_id)
    and not private.registration_has_product_activity(l.user_id)
    and u.email_confirmed_at is null
    and u.phone_confirmed_at is null
    and u.last_sign_in_at is null
  for update of l, u, profile;

  if not found then
    return false;
  end if;

  perform pg_catalog.set_config(
    'letscube.registration_cleanup_claim_token',
    p_claim_token::text,
    true
  );

  delete from auth.users u
  where u.id = p_user_id;

  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end
$function$;

revoke all on function public.registration_cleanup_delete(uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_cleanup_delete(uuid,uuid,timestamptz)
  to service_role;

create or replace function private.registration_cleanup_guard_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_lifecycle private.registration_lifecycles%rowtype;
  v_cleanup_claim_token text := nullif(
    pg_catalog.current_setting(
      'letscube.registration_cleanup_claim_token',
      true
    ),
    ''
  );
begin
  -- Deletes not initiated by the cleanup RPC keep the existing administrative
  -- behavior and do not depend on lifecycle state.
  if v_cleanup_claim_token is null then
    return old;
  end if;

  select l.*
  into v_lifecycle
  from private.registration_lifecycles l
  where l.user_id = old.id
  for update;

  if not found then
    raise exception 'registration_cleanup_delete_rejected'
      using errcode = '55000';
  end if;

  if v_lifecycle.claim_token is null
     or v_lifecycle.claim_token::text <> v_cleanup_claim_token
     or v_lifecycle.claimed_at is null
     or v_lifecycle.claimed_at
       <= pg_catalog.clock_timestamp() - interval '15 minutes'
     or v_lifecycle.eligible_at > pg_catalog.clock_timestamp()
     or v_lifecycle.admin_hold_at is not null
     or v_lifecycle.dead_lettered_at is not null
     or private.registration_identity_requires_hold(old.id)
     or private.registration_has_product_activity(old.id)
     or old.email_confirmed_at is not null
     or old.phone_confirmed_at is not null
     or old.last_sign_in_at is not null then
    raise exception 'registration_cleanup_delete_rejected'
      using errcode = '55000';
  end if;

  insert into private.registration_cleanup_audit(
    user_reference,
    action,
    reason_code
  ) values (old.id, 'deleted', 'expired_unconfirmed');

  return old;
end
$function$;

revoke all on function private.registration_cleanup_guard_auth_user_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_registration_cleanup_guard_auth_user_delete
  on auth.users;
create trigger trg_registration_cleanup_guard_auth_user_delete
  before delete on auth.users
  for each row execute function private.registration_cleanup_guard_auth_user_delete();

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
  if p_action not in ('reported', 'skipped', 'failed') then
    raise exception 'registration_cleanup_action_invalid' using errcode = '22023';
  end if;
  if p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'registration_cleanup_reason_invalid' using errcode = '22023';
  end if;

  update private.registration_lifecycles l
  set claim_token = null,
      claimed_at = null,
      admin_hold_at = l.admin_hold_at,
      failure_count = case
        when p_action = 'failed'
          then least(5, l.failure_count + 1)
        when p_action = 'reported' then l.failure_count
        else l.failure_count
      end,
      next_attempt_at = case
        when p_action = 'failed' and l.failure_count + 1 >= 5 then null
        when p_action = 'failed' then pg_catalog.clock_timestamp() + least(
          interval '24 hours',
          interval '15 minutes' * pg_catalog.power(
            2,
            greatest(0, l.failure_count)
          )::double precision
        )
        when p_action = 'reported' then l.next_attempt_at
        else l.next_attempt_at
      end,
      dead_lettered_at = case
        when p_action = 'failed' and l.failure_count + 1 >= 5
          then coalesce(l.dead_lettered_at, pg_catalog.clock_timestamp())
        when p_action = 'reported' then l.dead_lettered_at
        else l.dead_lettered_at
      end,
      last_error_code = case
        when p_action = 'failed' then p_reason_code
        else l.last_error_code
      end,
      updated_at = pg_catalog.clock_timestamp()
  where l.user_id = p_user_id
    and l.claim_token = p_claim_token
    and p_claim_token is not null;

  if not found then
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

create or replace function public.registration_cleanup_report(
  p_now timestamptz default now(),
  p_audit_since timestamptz default now() - interval '24 hours'
)
returns table(
  report_scope text,
  signup_kind text,
  reason_code text,
  item_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
begin
  if p_now is null or p_audit_since is null
    or p_audit_since > p_now
    or p_audit_since < p_now - interval '31 days' then
    raise exception 'registration_cleanup_report_invalid_window' using errcode = '22023';
  end if;

  return query
  with lifecycle_rows as (
    select
      l.signup_kind::text as signup_kind,
      case
        when l.claim_token is not null
          and private.registration_identity_requires_hold(l.user_id)
          then 'claimed_unsafe_identity'
        when l.claim_token is not null and u.email_confirmed_at is not null
          then 'claimed_unsafe_email_confirmed'
        when l.claim_token is not null and u.phone_confirmed_at is not null
          then 'claimed_unsafe_phone_confirmed'
        when l.claim_token is not null and u.last_sign_in_at is not null
          then 'claimed_unsafe_signed_in'
        when l.claim_token is not null
          and private.registration_has_product_activity(l.user_id)
          then 'claimed_unsafe_product_activity'
        when l.dead_lettered_at is not null then 'dead_lettered'
        when l.admin_hold_at is not null then 'admin_hold'
        when private.registration_identity_requires_hold(l.user_id)
          then 'identity_exempt'
        when u.email_confirmed_at is not null then 'email_confirmed'
        when u.phone_confirmed_at is not null then 'phone_confirmed'
        when u.last_sign_in_at is not null then 'signed_in'
        when private.registration_has_product_activity(l.user_id)
          then 'product_activity'
        when l.eligible_at > p_now then 'not_due'
        when l.next_attempt_at is not null and l.next_attempt_at > p_now
          then 'retry_wait'
        else 'eligible_due'
      end as reason_code
    from private.registration_lifecycles l
    join auth.users u on u.id = l.user_id
  ), lifecycle_aggregates as (
    select
      'lifecycle'::text as report_scope,
      lifecycle_rows.signup_kind,
      lifecycle_rows.reason_code,
      count(*)::bigint as item_count
    from lifecycle_rows
    group by lifecycle_rows.signup_kind, lifecycle_rows.reason_code
  ), audit_aggregates as (
    select
      'audit'::text as report_scope,
      'all'::text as signup_kind,
      a.action || ':' || a.reason_code as reason_code,
      count(*)::bigint as item_count
    from private.registration_cleanup_audit a
    where a.created_at >= p_audit_since
      and a.created_at <= p_now
    group by a.action, a.reason_code
  )
  select
    lifecycle_aggregates.report_scope,
    lifecycle_aggregates.signup_kind,
    lifecycle_aggregates.reason_code,
    lifecycle_aggregates.item_count
  from lifecycle_aggregates
  union all
  select
    audit_aggregates.report_scope,
    audit_aggregates.signup_kind,
    audit_aggregates.reason_code,
    audit_aggregates.item_count
  from audit_aggregates;
end
$function$;

revoke all on function public.registration_cleanup_report(timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_cleanup_report(timestamptz,timestamptz)
  to service_role;

create or replace function public.registration_cleanup_recover_dead_letter(
  p_user_id uuid,
  p_reason_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
begin
  if p_user_id is null then
    raise exception 'registration_cleanup_user_invalid' using errcode = '22023';
  end if;
  if p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'registration_cleanup_reason_invalid' using errcode = '22023';
  end if;

  update private.registration_lifecycles l
  set failure_count = 0,
      next_attempt_at = null,
      dead_lettered_at = null,
      last_error_code = null,
      claim_token = null,
      claimed_at = null,
      delete_authorization_token = null,
      delete_authorized_at = null,
      delete_authorization_expires_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where l.user_id = p_user_id
    and l.dead_lettered_at is not null;

  if not found then
    return false;
  end if;

  insert into private.registration_cleanup_audit(
    user_reference,
    action,
    reason_code
  ) values (p_user_id, 'recovered', p_reason_code);
  return true;
end
$function$;

revoke all on function public.registration_cleanup_recover_dead_letter(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_cleanup_recover_dead_letter(uuid,text)
  to service_role;

create or replace function public.registration_cleanup_purge_audit(
  p_limit integer,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_deleted integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 10000 then
    raise exception 'registration_cleanup_purge_limit_invalid'
      using errcode = '22023';
  end if;
  if p_now is null
     or p_now < pg_catalog.clock_timestamp() - interval '1 day'
     or p_now > pg_catalog.clock_timestamp() + interval '1 day' then
    raise exception 'registration_cleanup_purge_time_invalid'
      using errcode = '22023';
  end if;

  with expired as (
    select a.id
    from private.registration_cleanup_audit a
    where a.created_at < least(p_now, pg_catalog.clock_timestamp())
      - interval '90 days'
    order by a.created_at, a.id
    limit p_limit
    for update skip locked
  )
  delete from private.registration_cleanup_audit a
  using expired
  where a.id = expired.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$function$;

revoke all on function public.registration_cleanup_purge_audit(integer,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_cleanup_purge_audit(integer,timestamptz)
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
  v_candidate record;
  v_inserted integer := 0;
  v_row_count integer := 0;
begin
  if p_enabled_at is null then
    raise exception 'registration_lifecycle_enabled_at_required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'registration_lifecycle_limit_invalid' using errcode = '22023';
  end if;

  for v_candidate in
    select
      u.id,
      u.created_at,
      case when exists (
        select 1
        from public.registration_invite_uses riu
        where riu.user_id = u.id
      ) then 'invite'::text else 'public'::text end as signup_kind
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
  loop
    if v_candidate.signup_kind = 'invite' then
      perform private.registration_record_invite_location_provenance(
        v_candidate.id,
        null
      );
    end if;

    insert into private.registration_lifecycles(
      user_id,
      signup_kind,
      created_at,
      eligible_at,
      admin_hold_at
    ) values (
      v_candidate.id,
      v_candidate.signup_kind,
      v_candidate.created_at,
      greatest(
        v_candidate.created_at + case
          when v_candidate.signup_kind = 'invite' then interval '7 days'
          else interval '72 hours'
        end,
        p_enabled_at + interval '24 hours'
      ),
      case
        when private.registration_identity_requires_hold(v_candidate.id)
          then p_enabled_at
        else null
      end
    )
    on conflict (user_id) do nothing;

    get diagnostics v_row_count = row_count;
    v_inserted := v_inserted + v_row_count;
  end loop;

  return v_inserted;
end
$function$;

revoke all on function public.registration_lifecycle_backfill_internal(integer,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_lifecycle_backfill_internal(integer,timestamptz)
  to service_role;

commit;
