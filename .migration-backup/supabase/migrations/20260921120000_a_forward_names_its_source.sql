/**
 * A forward names its source, and the opt-out belongs to the person named.
 *
 * DECIDED BY THE OWNER, 2026-09-20: «У телеграма скрытие имени при пересылке
 * завязано на настройках приватности, т.е. изначально все видят изначального
 * отправителя пересылаемого сообщения.» Recorded in
 * docs/PRODUCTION_PRIORITY_TRACKER.md under «Decisions taken under the
 * 2026-09-21 delegation». CLAUDE.md §7 excludes decisions about other people's
 * information from the delegation, so this half was settled by him; §10 governs
 * the apply, and is not relaxed by either.
 *
 * WHAT EXISTS. `public.messages.forwarded_from_id` names the source row, and
 * the client resolves the origin by embedding it:
 * `forwarded_from:messages!forwarded_from_id(...)` in
 * `lib/messageProjection.ts`. `public.messages` SELECT is
 * `is_chat_member(chat_id)`, so that embed answers NULL for any reader who is
 * not a member of the SOURCE chat. The forwarder therefore sees «Переслано от
 * X» and a stranger in the destination sees «Переслано».
 *
 * WHY THAT IS WRONG, AND IT IS NOT «too strict». The same forward shows a name
 * to one reader and withholds it from another, and **nobody chose that**. It is
 * an artefact of who happens to hold access, not a decision by the person whose
 * name it is. A privacy property that varies by the viewer's access without the
 * subject's involvement is not a privacy property.
 *
 * WHAT THIS ADDS.
 *
 *   - `public.privacy_preferences.forward_origin_visible boolean not null
 *     default true` — disclosed by default, as Telegram is, and the control
 *     belongs to the person being disclosed. It sits beside
 *     `presence_visible`, in the table whose RLS is already own-row only.
 *   - `public.messages.forward_origin_name text` and
 *     `public.messages.forward_origin_hidden boolean not null default false` —
 *     the origin, denormalised at forward time, readable by everyone who can
 *     read the message at all.
 *   - `public.messages_forward_origin()` and the BEFORE INSERT OR UPDATE
 *     trigger `trg_messages_forward_origin`, which are the ONLY writer of those
 *     two columns.
 *
 * WHY A TRIGGER AND NOT THE FUNCTION. Three reasons, and the first two are
 * holes rather than preferences.
 *
 *   1. `"Chat members can send messages"` lets any member INSERT a row with
 *      `user_id = auth.uid()`. Nothing in an insert policy inspects the other
 *      columns, so without a guard a client could POST a message carrying
 *      `forward_origin_name = 'Пётр Ильин'` and put a name it chose under a
 *      message it wrote. That is impersonation, not a formatting bug.
 *   2. `"Users can edit own messages"` is `for update using (user_id =
 *      auth.uid())`, so the forwarder could PATCH the origin afterwards — and
 *      «carries it permanently» is half the decision. A column-level REVOKE
 *      would not close it: measured on `public.voice_channels` on 2026-09-20,
 *      a column REVOKE against a standing table-level grant is a **silent
 *      no-op** here. The guard has to be a trigger, which is the shape that
 *      migration settled on for the same reason.
 *   3. `lib/messageForward.ts` still has a direct-insert fallback for a
 *      deployment where the RPC is missing (`forwardInsertPayload`). With the
 *      trigger as the writer that path gets a correct origin too, free. With
 *      the logic inside `forward_message` it would silently produce forwards
 *      with no origin at all.
 *
 * The trigger therefore **computes** the two columns on INSERT, discarding
 * whatever the client sent, and **refuses** any later change to them.
 *
 * SECURITY DEFINER, and this is the part that would have failed silently. The
 * trigger reads the ORIGINAL sender's `privacy_preferences` row, and that
 * table's policy is `auth.uid() = user_id`. A plain trigger function runs as
 * the forwarder, would read no row, would fall to the default — and the opt-out
 * would never once be honoured while every test about «the name is written»
 * passed. The function is SECURITY DEFINER with `search_path = ''`.
 *
 * **Which path that actually matters on**, because the first draft of this
 * header got it wrong and the mutation run found it. A forward made through
 * `public.forward_message` is safe either way: that function is itself SECURITY
 * DEFINER, so the trigger fires inside ITS context and reads the privacy row as
 * the owner even with no `security definer` of its own. Measured 2026-09-21:
 * removing `security definer` from this function and relaxing the self-check
 * below left the entire rehearsal green. The path that needs it is the client's
 * **direct insert**, which runs as `authenticated` with nothing definer in
 * between — reason 3 above, the fallback that exists precisely for a deployment
 * where the RPC is missing. Rehearsal case (k) is that path, and it is the
 * assertion that catches this; case (c) is not, whatever it looks like.
 *
 * A FORWARD OF A FORWARD keeps the original origin, as Telegram does: the
 * source's own recorded origin is carried through rather than replaced by the
 * intermediate forwarder's name.
 *
 * A BOT source is named from `public.bots.display_name`. A bot has no privacy
 * settings and is not a person, so there is nothing to opt out of.
 *
 * NO BACKFILL, deliberately. Existing forwards keep `forward_origin_name` NULL
 * and `forward_origin_hidden` false, which the client reads as «not recorded»
 * and answers exactly as it does today, through the RLS-dependent embed.
 * Backfilling would read every sender's setting **as it stands now** and stamp
 * it onto messages sent before they had one — the retroactive direction the
 * decision explicitly refuses.
 *
 * LOCKS. Three `alter table ... add column` with defaults. `forward_origin_name`
 * is nullable with no default and is metadata-only. The two boolean columns
 * carry a non-volatile default, which PostgreSQL 11+ stores in the catalogue
 * rather than rewriting the table, so neither rewrites `public.messages`. Each
 * takes a brief ACCESS EXCLUSIVE lock to update the catalogue. No CHECK
 * constraint is added to `public.messages`: validating one would scan the whole
 * table, and the trigger is a stronger guarantee than a CHECK anyway, since it
 * owns the values rather than merely admitting them.
 *
 * OWNER. Creates a SECURITY DEFINER function and a trigger on
 * `public.messages`, and alters two tables: apply as the owner of both tables
 * (postgres on this deployment) or a superuser. The self-check refuses
 * otherwise, refuses if the function is not SECURITY DEFINER, refuses if any
 * policy on either table changed, and refuses if any grant on either table
 * changed — the last measured per column with `has_column_privilege`, because
 * `has_table_privilege` answers false by design where a privilege is held per
 * column and would report a change that is not one.
 *
 * REALTIME. Nothing new: the columns ride on the INSERT that a forward has
 * always produced. Note that `public.messages` REPLICA IDENTITY must remain
 * whatever it is; this migration does not touch it.
 *
 * Rollback: 20260921120000_a_forward_names_its_source.rollback.sql.
 */

begin;

-- What the policies and the column grants are, so the self-check can prove this
-- migration changed neither.
create temp table _forward_origin_policies_before on commit drop as
select polrelid::regclass::text as table_name,
       polname::text,
       polcmd::text,
       polpermissive,
       pg_catalog.pg_get_expr(polqual, polrelid) as qual,
       pg_catalog.pg_get_expr(polwithcheck, polrelid) as with_check
  from pg_catalog.pg_policy
 where polrelid in ('public.messages'::regclass, 'public.privacy_preferences'::regclass);

create temp table _forward_origin_grants_before on commit drop as
select rel.relname::text as table_name,
       att.attname::text as column_name,
       grantee.rolname::text as grantee,
       priv.privilege::text,
       pg_catalog.has_column_privilege(grantee.rolname, rel.oid, att.attname, priv.privilege) as held
  from pg_catalog.pg_class rel
  join pg_catalog.pg_attribute att on att.attrelid = rel.oid and att.attnum > 0 and not att.attisdropped
 cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) as priv(privilege)
 cross join (select rolname from pg_catalog.pg_roles where rolname in ('anon', 'authenticated', 'service_role')) as grantee
 where rel.oid in ('public.messages'::regclass, 'public.privacy_preferences'::regclass);

-- ── the setting, on the table that already holds one ────────────────────────

alter table public.privacy_preferences
  add column if not exists forward_origin_visible boolean not null default true;

comment on column public.privacy_preferences.forward_origin_visible is
  'Whether a message this person sent carries their name when somebody forwards it. Disclosed by default, as in Telegram; the control belongs to the person being disclosed, and it is read at the moment of forwarding and never afterwards.';

-- ── the origin, denormalised onto the copy ──────────────────────────────────

alter table public.messages
  add column if not exists forward_origin_name text;

alter table public.messages
  add column if not exists forward_origin_hidden boolean not null default false;

comment on column public.messages.forward_origin_name is
  'The display name of whoever sent the message this one was forwarded from, captured at forward time. NULL where this is not a forward, where the origin opted out (forward_origin_hidden is then true), or where the forward predates 2026-09-21 and nothing was recorded. Written only by trg_messages_forward_origin.';

comment on column public.messages.forward_origin_hidden is
  'True where the original sender had turned off privacy_preferences.forward_origin_visible at the moment this copy was made. Permanent: a later change of their setting does not reach back into copies already sent, in either direction. Written only by trg_messages_forward_origin.';

-- ── the only writer of those two columns ────────────────────────────────────

create or replace function public.messages_forward_origin()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_source public.messages%rowtype;
  v_visible boolean;
  v_name text;
begin
  if tg_op = 'UPDATE' then
    -- Permanence. Neither column may move once written, so a forwarder cannot
    -- rewrite whose name their copy carries and a later change of the origin's
    -- setting cannot reach backwards into what has already been sent.
    if new.forward_origin_name is distinct from old.forward_origin_name
       or new.forward_origin_hidden is distinct from old.forward_origin_hidden then
      raise exception 'a forward records who it came from at the moment it is made, and that record does not change afterwards'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- INSERT. Whatever the client sent in these columns is discarded: they are
  -- a statement about somebody else, so they are the server's to make.
  new.forward_origin_name := null;
  new.forward_origin_hidden := false;

  if new.forwarded_from_id is null then
    return new;
  end if;

  select * into v_source
    from public.messages as source
   where source.id = new.forwarded_from_id;
  if not found then
    return new;
  end if;

  -- A forward of a forward keeps the original origin rather than naming the
  -- person who passed it on, as Telegram does.
  if v_source.forwarded_from_id is not null
     and (v_source.forward_origin_name is not null or v_source.forward_origin_hidden) then
    new.forward_origin_name := v_source.forward_origin_name;
    new.forward_origin_hidden := v_source.forward_origin_hidden;
    return new;
  end if;

  if v_source.bot_id is not null then
    -- A bot is not a person and has no privacy settings to consult.
    select bot.display_name into v_name
      from public.bots as bot
     where bot.id = v_source.bot_id;
    new.forward_origin_name := pg_catalog.left(pg_catalog.btrim(coalesce(v_name, '')), 120);
    if new.forward_origin_name = '' then
      new.forward_origin_name := null;
    end if;
    return new;
  end if;

  if v_source.user_id is null then
    -- The sender's account is gone; there is nobody to name and nobody whose
    -- setting could be read. Not «hidden» — hidden is a choice somebody made.
    return new;
  end if;

  -- The original sender's own answer, read here and nowhere else. This SELECT
  -- is the reason the function is SECURITY DEFINER: under the caller's rights
  -- the own-row policy on privacy_preferences would return nothing and every
  -- opt-out would be read as the default.
  select preference.forward_origin_visible into v_visible
    from public.privacy_preferences as preference
   where preference.user_id = v_source.user_id;

  -- An absent row is somebody who has never opened the setting, which is the
  -- default: disclosed.
  if coalesce(v_visible, true) then
    select profile.full_name into v_name
      from public.profiles as profile
     where profile.id = v_source.user_id;
    new.forward_origin_name := pg_catalog.left(pg_catalog.btrim(coalesce(v_name, '')), 120);
    if new.forward_origin_name = '' then
      new.forward_origin_name := null;
    end if;
  else
    new.forward_origin_hidden := true;
  end if;

  return new;
end
$function$;

comment on function public.messages_forward_origin() is
  'Computes messages.forward_origin_name and messages.forward_origin_hidden on insert from the source message and the original sender''s privacy_preferences.forward_origin_visible, and refuses any later change to either. SECURITY DEFINER because it reads another person''s own-row privacy setting.';

drop trigger if exists trg_messages_forward_origin on public.messages;
create trigger trg_messages_forward_origin
  before insert or update on public.messages
  for each row execute function public.messages_forward_origin();

-- ── the function that makes a forward learns where the origin comes from ────

comment on function public.forward_message(uuid, uuid, uuid, timestamptz, uuid) is
  'Forwards a message the caller can see into a chat they may write to, with its media fields and its ready preview variants. Idempotent on the client message id. The copy''s forward_origin_name and forward_origin_hidden are set by trg_messages_forward_origin on the insert, not here: the same trigger has to cover the client''s direct-insert fallback and a hand-written INSERT, so there is one writer rather than three.';

-- ── self-check: raise rather than commit a half-applied state ───────────────

do $$
declare
  v_changed int;
  v_owner text;
begin
  -- 1. The columns exist, with the shapes the client will read.
  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.privacy_preferences'::regclass
       and attname = 'forward_origin_visible' and not attisdropped
       and atttypid = 'boolean'::regtype and attnotnull
  ) then
    raise exception 'privacy_preferences.forward_origin_visible is missing or is not a NOT NULL boolean';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.messages'::regclass
       and attname = 'forward_origin_name' and not attisdropped
       and atttypid = 'text'::regtype
  ) then
    raise exception 'messages.forward_origin_name is missing or is not text';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.messages'::regclass
       and attname = 'forward_origin_hidden' and not attisdropped
       and atttypid = 'boolean'::regtype and attnotnull
  ) then
    raise exception 'messages.forward_origin_hidden is missing or is not a NOT NULL boolean';
  end if;

  -- 2. The writer is SECURITY DEFINER with a fixed search_path. Without this
  --    the opt-out is read as the default for every forward, silently.
  --    `set search_path = ''` is stored as the single element `search_path=""`
  --    — the quotes are part of the stored string, measured in PostgreSQL
  --    rather than assumed; `search_path=` alone matches nothing and this
  --    check would then refuse a correct migration.
  if not exists (
    select 1 from pg_catalog.pg_proc
     where oid = 'public.messages_forward_origin()'::regprocedure
       and prosecdef
       and proconfig @> array['search_path=""']
  ) then
    raise exception 'messages_forward_origin() is not SECURITY DEFINER with search_path = '''', so it cannot read the origin''s privacy row';
  end if;

  -- 3. The trigger is on the table, for both operations.
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.messages'::regclass
       and tgname = 'trg_messages_forward_origin'
       and not tgisinternal
       -- 7 = ROW | BEFORE | INSERT, plus 16 = UPDATE.
       and (tgtype & 4) = 4 and (tgtype & 16) = 16 and (tgtype & 2) = 2 and (tgtype & 1) = 1
  ) then
    raise exception 'trg_messages_forward_origin is not a BEFORE INSERT OR UPDATE FOR EACH ROW trigger on public.messages';
  end if;

  -- 4. The function is owned by the table's owner, or the trigger reads the
  --    privacy row as somebody with no more rights than the forwarder.
  select tableowner into v_owner from pg_catalog.pg_tables
   where schemaname = 'public' and tablename = 'privacy_preferences';
  if not exists (
    select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = 'public.messages_forward_origin()'::regprocedure
       and pg_catalog.pg_has_role(r.rolname, v_owner, 'USAGE')
  ) then
    raise exception 'messages_forward_origin() is not owned by a role that can read privacy_preferences past its own-row policy';
  end if;

  -- 5. No policy on either table moved.
  select count(*) into v_changed
    from (
      select table_name, polname, polcmd, polpermissive, qual, with_check from _forward_origin_policies_before
      except
      select polrelid::regclass::text, polname::text, polcmd::text, polpermissive,
             pg_catalog.pg_get_expr(polqual, polrelid), pg_catalog.pg_get_expr(polwithcheck, polrelid)
        from pg_catalog.pg_policy
       where polrelid in ('public.messages'::regclass, 'public.privacy_preferences'::regclass)
    ) as gone;
  if v_changed > 0 then
    raise exception 'this migration changed % polic(y/ies) on messages or privacy_preferences', v_changed;
  end if;

  select count(*) into v_changed
    from pg_catalog.pg_policy
   where polrelid in ('public.messages'::regclass, 'public.privacy_preferences'::regclass);
  if v_changed <> (select count(*) from _forward_origin_policies_before) then
    raise exception 'the number of policies on messages or privacy_preferences changed';
  end if;

  -- 6. No column grant on either table moved, measured per column. A table-wide
  --    check would answer false wherever a privilege is held per column and
  --    report a change that is not one.
  select count(*) into v_changed
    from _forward_origin_grants_before as before
    join pg_catalog.pg_class rel on rel.relname = before.table_name and rel.relnamespace = 'public'::regnamespace
   where pg_catalog.has_column_privilege(before.grantee, rel.oid, before.column_name, before.privilege) <> before.held;
  if v_changed > 0 then
    raise exception 'this migration changed % column grant(s) on messages or privacy_preferences', v_changed;
  end if;

  -- 7. RLS is still on for both. Never turned off, and said so here.
  if not (
    select bool_and(relrowsecurity) from pg_catalog.pg_class
     where oid in ('public.messages'::regclass, 'public.privacy_preferences'::regclass)
  ) then
    raise exception 'row level security is not enabled on messages and privacy_preferences';
  end if;

  -- 8. Nothing was backfilled. Every row that existed keeps «not recorded»,
  --    which is what the client reads as «fall back to the old behaviour».
  if exists (
    select 1 from public.messages
     where forwarded_from_id is null
       and (forward_origin_name is not null or forward_origin_hidden)
  ) then
    raise exception 'a non-forward carries an origin, so something wrote these columns outside the trigger';
  end if;
end
$$;

commit;
