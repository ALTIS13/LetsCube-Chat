/**
 * Reactions are read and added by the members of the message's chat, and by no
 * one else (D-104).
 *
 * WHAT EXISTS. `public.reactions` carries «Anyone in chat can view reactions», a
 * SELECT policy for every role that is `using (true)`, and «Users can add
 * reactions», an INSERT policy that checks only `auth.uid() = user_id`. Read on
 * production on 2026-09-11, read-only: a signed-in person who is a member of no
 * chat reads every reaction of every chat — who reacted to which message, with
 * what and when — and since the table is published to Realtime under the same
 * policy, every signed-in client is sent every reaction change; and anyone who
 * knows a message id can put a reaction on a message of a chat they are not in.
 * Without signing in the read is refused only because the restrictive ban check
 * calls `is_banned`, which `anon` may not execute — an accident, not a rule —
 * while `anon` holds SELECT, INSERT, UPDATE and DELETE on the table. Of the 149
 * reactions on production, none was put by someone outside the message's chat.
 *
 * WHAT THIS CHANGES.
 *
 *   - «Chat members can view reactions» replaces the open read. A reaction is
 *     visible to the members of its message's chat — the rule «Chat members can
 *     view messages» gives the message itself, through the same
 *     `public.is_chat_member`. Realtime applies the read policy per subscriber,
 *     so a reaction's changes reach those members only.
 *   - «Chat members can add reactions» replaces the insert check. The reaction
 *     is the caller's own, on a message of a chat they are a member of that is
 *     neither deleted nor a system notice: what `set_message_reaction`
 *     (20260911142000) checks, so the direct insert an unupdated client still
 *     makes answers to the same rules.
 *   - `anon` loses SELECT, INSERT, UPDATE and DELETE on the table.
 *
 * Unchanged: removing one's own reaction, the restrictive ban policies, the
 * publication, and every SECURITY DEFINER path — `set_message_reaction` runs as
 * the table's owner and makes its own checks.
 *
 * COMPATIBILITY. The client production runs today reads reactions only with the
 * messages of the reader's own chats and inserts only there, so this may land
 * before the new client or with it.
 *
 * OWNER. Apply as the owner of `public.reactions` (postgres on this deployment).
 *
 * Lock: DROP and CREATE POLICY take ACCESS EXCLUSIVE on `public.reactions` for
 * the length of this transaction; `lock_timeout` gives up after five seconds
 * rather than queue behind a long one.
 *
 * Rollback: 20260911150000_reactions_visible_to_chat_members.rollback.sql.
 */

begin;

set local lock_timeout = '5s';

drop policy if exists "Anyone in chat can view reactions" on public.reactions;
drop policy if exists "Chat members can view reactions" on public.reactions;
create policy "Chat members can view reactions"
  on public.reactions
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.messages as message
       where message.id = reactions.message_id
         and public.is_chat_member(message.chat_id)
    )
  );

drop policy if exists "Users can add reactions" on public.reactions;
drop policy if exists "Chat members can add reactions" on public.reactions;
create policy "Chat members can add reactions"
  on public.reactions
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
        from public.messages as message
       where message.id = reactions.message_id
         and message.deleted_at is null
         and coalesce(message.type::text, 'text') <> 'system'
         and public.is_chat_member(message.chat_id)
    )
  );

revoke select, insert, update, delete on public.reactions from anon;

comment on policy "Chat members can view reactions" on public.reactions is
  'A reaction is visible to the members of its message''s chat, as the message is (D-104).';
comment on policy "Chat members can add reactions" on public.reactions is
  'A reaction is the caller''s own, on a live message of a chat they are a member of that is not a system notice (D-104).';

do $$
declare
  v_policy record;
  v_privilege text;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.reactions'::regclass) then
    raise exception 'public.reactions has row-level security off';
  end if;

  -- No permissive policy lets anyone read everything, or insert without being a member.
  for v_policy in
    select p.policyname, p.cmd, p.qual, p.with_check
      from pg_catalog.pg_policies p
     where p.schemaname = 'public' and p.tablename = 'reactions' and p.permissive = 'PERMISSIVE'
  loop
    if v_policy.cmd in ('SELECT', 'ALL') and (v_policy.qual is null or pg_catalog.btrim(v_policy.qual) = 'true') then
      raise exception 'public.reactions still has an open read policy: %', v_policy.policyname;
    end if;
    if v_policy.cmd in ('INSERT', 'ALL')
       and (v_policy.with_check is null or v_policy.with_check not ilike '%is_chat_member%') then
      raise exception 'public.reactions has an insert policy that does not ask for membership: %', v_policy.policyname;
    end if;
  end loop;

  select p.cmd, p.roles, p.qual, p.with_check into v_policy
    from pg_catalog.pg_policies p
   where p.schemaname = 'public' and p.tablename = 'reactions' and p.policyname = 'Chat members can view reactions';
  if not found or v_policy.cmd <> 'SELECT' or v_policy.roles <> array['authenticated']::name[]
     or v_policy.qual not ilike '%is_chat_member%' then
    raise exception 'the members-only read policy on public.reactions is missing or changed';
  end if;

  select p.cmd, p.roles, p.qual, p.with_check into v_policy
    from pg_catalog.pg_policies p
   where p.schemaname = 'public' and p.tablename = 'reactions' and p.policyname = 'Chat members can add reactions';
  if not found or v_policy.cmd <> 'INSERT' or v_policy.roles <> array['authenticated']::name[]
     or v_policy.with_check not ilike '%is_chat_member%' or v_policy.with_check not ilike '%uid()%'
     or v_policy.with_check not ilike '%deleted_at%' then
    raise exception 'the members-only insert policy on public.reactions is missing or changed';
  end if;

  foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if pg_catalog.has_table_privilege('anon', 'public.reactions', v_privilege) then
      raise exception 'anon still holds % on public.reactions', v_privilege;
    end if;
  end loop;

  if not pg_catalog.has_function_privilege('authenticated', 'public.is_chat_member(uuid)', 'EXECUTE') then
    raise exception 'authenticated cannot execute public.is_chat_member, which both policies call';
  end if;
  -- The Realtime publication is not checked: nothing here touches it, and a
  -- schema-only copy of production carries the publication without its tables.
end
$$;

commit;
