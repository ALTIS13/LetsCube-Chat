/**
 * A forwarded photo or video keeps its previews (D-083).
 *
 * WHAT EXISTS. `forwardMessage` in `useMessages.ts` inserts the copy itself and
 * carries `content`, `type` and `media_url` — not `media_bucket`, `media_path` or
 * `media_metadata`. Preview variants are rows of `public.media_variants` keyed
 * by the source message's id, with `chat_id` the source chat, and their read
 * policy `media variants chat members can read`
 * (20260622_media_variants_pipeline.sql:69) is `is_chat_member(chat_id)`. So the
 * copy has no variant rows, and the members of the target chat could not read
 * the source's rows even if the client asked for them. The files themselves are
 * in the `media` bucket, which is public (read from `storage.buckets` on
 * 2026-09-11): every object is fetched by its URL, without a policy.
 *
 * WHAT THIS ADDS. `public.forward_message(source, target, client id, client
 * time, topic)` makes the copy on the server:
 *
 *   - the caller must be able to see the source — a member of its chat, not
 *     deleted, not hidden for them, not before their cleared history — and gets
 *     the same answer for "no such message" as for any of those;
 *   - the caller must be a member of the target, not banned and not muted there,
 *     which is what the insert policy and the restrictive send veto check for a
 *     direct insert; the topic, when given, must belong to the target;
 *   - the copy takes content, type, media_url, media_bucket, media_path and the
 *     whole media_metadata — so an original's `uncompressed` flag and its
 *     preview path travel with it, whatever keys another branch adds there —
 *     from the server's own row of the source, never from the client;
 *   - the source's READY variant rows are copied onto the copy, scoped to the
 *     target chat. They point at the same files, so the previews appear at once
 *     and nothing is generated twice; the worker sees ready rows whose source
 *     path is the copy's own and leaves them alone. A kind the source lacks is
 *     generated for the copy by the worker, because the copy now carries its
 *     media path;
 *   - a retry with the same client message id returns the first copy.
 *
 * WHAT THE TARGET CHAT LEARNS ABOUT THE SOURCE. Nothing it can open. The copied
 * rows are readable through the target chat's membership only; no policy is
 * widened, the source's own rows and messages stay invisible to non-members
 * (the rehearsal checks both). A variant's path contains the source chat's and
 * source message's ids — `variants/messages/{chat}/{message}/…` — and
 * `forwarded_from_id` already carried the source message's id; an id grants no
 * read of either. The worker could instead render new files under the target's
 * path at the cost of a second transcode per forward; that is the option if the
 * ids themselves are ever considered sensitive.
 *
 * If message media move to the private `chat-media` bucket, whose read policy
 * is scoped to the object's chat folder, a forwarded copy will need signed URLs
 * issued through the target chat. Nothing uses that bucket today.
 *
 * OWNER. Inserts into `public.messages` past the insert policy and into
 * `public.media_variants`, which authenticated cannot write at all: apply as the
 * owner of both (postgres on this deployment) or a superuser. The self-check
 * refuses otherwise, and refuses if a policy on either table changed.
 *
 * REALTIME. Nothing new: the INSERT into `messages` is what forwards have
 * always produced. `media_variants` is not published; clients load variants by
 * message id when a message appears.
 *
 * Rollback: 20260911144000_forward_message_with_media.rollback.sql.
 */

begin;

create temp table _forward_policies_before on commit drop as
select polrelid::regclass::text as table_name,
       polname::text,
       polcmd::text,
       polpermissive,
       pg_catalog.pg_get_expr(polqual, polrelid) as qual,
       pg_catalog.pg_get_expr(polwithcheck, polrelid) as with_check
  from pg_catalog.pg_policy
 where polrelid in ('public.messages'::regclass, 'public.media_variants'::regclass);

create or replace function public.forward_message(
  p_source_message_id uuid,
  p_target_chat_id uuid,
  p_client_message_id uuid default null,
  p_client_sent_at timestamptz default null,
  p_topic_id uuid default null
)
returns public.messages
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_source public.messages%rowtype;
  v_copy public.messages%rowtype;
  v_source_member boolean;
  v_cleared_at timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_source_message_id is null or p_target_chat_id is null then
    raise exception 'invalid_forward' using errcode = '22023';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'user_banned' using errcode = '42501';
  end if;

  select * into v_source
    from public.messages as message
   where message.id = p_source_message_id;
  if found then
    select true, me.cleared_at
      into v_source_member, v_cleared_at
      from public.chat_members as me
     where me.chat_id = v_source.chat_id
       and me.user_id = v_uid;
  end if;
  if not coalesce(v_source_member, false)
     or v_source.deleted_at is not null
     or (v_cleared_at is not null and v_source.created_at <= v_cleared_at)
     or exists (
       select 1 from public.message_hidden_for_users as hidden
        where hidden.message_id = v_source.id
          and hidden.user_id = v_uid
     ) then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;
  if coalesce(v_source.type, 'text') = 'system' then
    raise exception 'message_not_forwardable' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.chat_members as target
     where target.chat_id = p_target_chat_id
       and target.user_id = v_uid
  ) then
    raise exception 'not_chat_member' using errcode = '42501';
  end if;
  if public.is_muted(v_uid, p_target_chat_id) then
    raise exception 'user_muted' using errcode = '42501';
  end if;
  if p_topic_id is not null and not exists (
    select 1 from public.topics as topic
     where topic.id = p_topic_id
       and topic.chat_id = p_target_chat_id
  ) then
    raise exception 'invalid_topic' using errcode = '22023';
  end if;

  if p_client_message_id is not null then
    select * into v_copy
      from public.messages as message
     where message.chat_id = p_target_chat_id
       and message.user_id = v_uid
       and message.client_message_id = p_client_message_id;
    if found then
      return v_copy;
    end if;
  end if;

  begin
    insert into public.messages (
      chat_id, topic_id, user_id, content, type,
      media_url, media_bucket, media_path, media_metadata,
      forwarded_from_id, client_message_id, client_sent_at
    ) values (
      p_target_chat_id, p_topic_id, v_uid, v_source.content, v_source.type,
      v_source.media_url, v_source.media_bucket, v_source.media_path, v_source.media_metadata,
      v_source.id, p_client_message_id, p_client_sent_at
    )
    returning * into v_copy;
  exception
    when unique_violation then
      -- The same client id landed from a concurrent retry.
      select * into v_copy
        from public.messages as message
       where message.chat_id = p_target_chat_id
         and message.user_id = v_uid
         and message.client_message_id = p_client_message_id;
      if not found then
        raise;
      end if;
      return v_copy;
  end;

  if v_copy.media_url is not null or v_copy.media_path is not null then
    insert into public.media_variants (
      message_id, chat_id, owner_id, profile_id,
      source_bucket, source_path, variant_kind, variant_bucket, variant_path,
      mime_type, width, height, size_bytes, status
    )
    select v_copy.id, v_copy.chat_id, v_uid, null,
           variant.source_bucket, variant.source_path, variant.variant_kind,
           variant.variant_bucket, variant.variant_path,
           variant.mime_type, variant.width, variant.height, variant.size_bytes, variant.status
      from public.media_variants as variant
     where variant.message_id = v_source.id
       and variant.chat_id = v_source.chat_id
       and variant.status = 'ready'
    on conflict do nothing;
  end if;

  return v_copy;
end
$function$;

revoke all on function public.forward_message(uuid, uuid, uuid, timestamptz, uuid) from public, anon;
grant execute on function public.forward_message(uuid, uuid, uuid, timestamptz, uuid) to authenticated;

comment on function public.forward_message(uuid, uuid, uuid, timestamptz, uuid) is
  'Forwards a message the caller can see into a chat they may write to, with its media fields and its ready preview variants. Idempotent on the client message id.';

do $$
declare
  v_proc record;
  v_table record;
  v_changed integer;
begin
  select p.prosecdef, p.proconfig, p.proowner
    into v_proc
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.forward_message(uuid,uuid,uuid,timestamp with time zone,uuid)');
  if not found then
    raise exception 'public.forward_message is missing';
  end if;
  if not v_proc.prosecdef then
    raise exception 'forward_message must be SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_catalog.unnest(v_proc.proconfig) c where c like 'search_path=%') then
    raise exception 'forward_message has no fixed search_path';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', 'public.forward_message(uuid,uuid,uuid,timestamp with time zone,uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.forward_message(uuid,uuid,uuid,timestamp with time zone,uuid)', 'EXECUTE') then
    raise exception 'forward_message has the wrong execute grants';
  end if;

  for v_table in
    select c.relname, c.relowner, c.relforcerowsecurity, c.relrowsecurity
      from pg_catalog.pg_class c
     where c.oid in ('public.messages'::regclass, 'public.media_variants'::regclass)
  loop
    if not v_table.relrowsecurity then
      raise exception 'public.% has row-level security off', v_table.relname;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_roles r
       where r.oid = v_proc.proowner and (r.rolsuper or r.rolbypassrls)
    ) and (v_table.relforcerowsecurity or not pg_catalog.pg_has_role(v_proc.proowner, v_table.relowner, 'USAGE')) then
      raise exception 'forward_message is owned by %, which row-level security on public.% (owner %) applies to; apply as the table owner',
        pg_catalog.pg_get_userbyid(v_proc.proowner), v_table.relname, pg_catalog.pg_get_userbyid(v_table.relowner);
    end if;
  end loop;

  select pg_catalog.count(*)::integer into v_changed
    from (
      (select * from _forward_policies_before
       except
       select polrelid::regclass::text, polname::text, polcmd::text, polpermissive,
              pg_catalog.pg_get_expr(polqual, polrelid), pg_catalog.pg_get_expr(polwithcheck, polrelid)
         from pg_catalog.pg_policy
        where polrelid in ('public.messages'::regclass, 'public.media_variants'::regclass))
      union all
      (select polrelid::regclass::text, polname::text, polcmd::text, polpermissive,
              pg_catalog.pg_get_expr(polqual, polrelid), pg_catalog.pg_get_expr(polwithcheck, polrelid)
         from pg_catalog.pg_policy
        where polrelid in ('public.messages'::regclass, 'public.media_variants'::regclass)
       except
       select * from _forward_policies_before)
    ) as difference;
  if v_changed <> 0 then
    raise exception 'a policy on public.messages or public.media_variants changed during this migration (% differences)', v_changed;
  end if;
  if not exists (select 1 from _forward_policies_before where table_name = 'media_variants') then
    raise exception 'captured no policy on public.media_variants; refusing to trust an empty comparison';
  end if;
end
$$;

commit;
