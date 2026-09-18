/**
 * Rollback for 20260918200000_a_call_says_so_in_the_conversation.sql.
 *
 * **As `supabase_admin`**, for the same reason the migration is: dropping a
 * trigger and a column on `public.voice_channels` needs ownership of it, and
 * that table is owned by `supabase_admin` rather than by `postgres`. The role
 * is enforced below rather than described.
 *
 * What this returns and what it does not:
 *
 * - The trigger goes first, so no write can reach the writer after it and
 *   before the column is gone.
 * - The three functions go with it. `voice_call_transition` and
 *   `voice_call_service_line` are pure and nothing else calls them; the whole
 *   feature is these four objects plus the column.
 * - `call_announced_at` is dropped. **A call open at that moment loses its
 *   latch**, so its «закончился» line is never written and the conversation is
 *   left with a start and no end. That is the intended failure shape of two
 *   appended rows -- incomplete rather than false -- and it is stated here
 *   because it is the one thing rolling this back costs.
 * - **The system messages already written are kept.** They are ordinary rows in
 *   people's conversations recording calls that really happened, and deleting
 *   them would rewrite history to undo a schema change. If they have to go, the
 *   statement is written out at the bottom, commented, with the reason it is
 *   not run by default.
 *
 * Locks: `drop trigger` and `alter table … drop column` each take ACCESS
 * EXCLUSIVE briefly; dropping a column is catalog-only, marking the attribute
 * dropped rather than rewriting the table. `lock_timeout = '5s'` bounds the
 * wait. Both statements are guarded, so a second run does no DDL at all.
 */

begin;

set local lock_timeout = '5s';

do $role$
begin
  if pg_catalog.to_regclass('public.voice_channels') is null then
    raise exception 'public.voice_channels does not exist, so there is nothing to roll back';
  end if;
  if not pg_catalog.pg_has_role(
       current_user,
       (select relowner from pg_catalog.pg_class where oid = 'public.voice_channels'::regclass),
       'USAGE'
     ) then
    raise exception
      'this file drops a trigger and a column on public.voice_channels, which % owns: run it as supabase_admin',
      (select pg_catalog.pg_get_userbyid(relowner)
         from pg_catalog.pg_class where oid = 'public.voice_channels'::regclass);
  end if;
end
$role$;

drop trigger if exists trg_voice_call_service_message on public.voice_channels;

drop function if exists public.write_voice_call_service_message();
drop function if exists public.voice_call_service_line(text, text);
drop function if exists public.voice_call_transition(integer, integer, boolean);

alter table public.voice_channels drop column if exists call_announced_at;

do $check$
declare
  v_left integer;
begin
  select pg_catalog.count(*) into v_left
    from pg_catalog.pg_trigger
   where not tgisinternal
     and tgrelid = 'public.voice_channels'::regclass
     and tgname = 'trg_voice_call_service_message';
  if v_left <> 0 then
    raise exception 'the service-message trigger is still on voice_channels';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'write_voice_call_service_message',
         'voice_call_service_line',
         'voice_call_transition'
       )
  ) then
    raise exception 'a service-message function survived the rollback';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.voice_channels'::regclass
       and attname = 'call_announced_at' and not attisdropped
  ) then
    raise exception 'call_announced_at survived the rollback';
  end if;

  raise notice 'a call no longer says anything in the conversation; the lines already written are kept';
end
$check$;

commit;

/**
 * Only if the rows themselves have to go as well, and only with the owner
 * saying so. It is not part of the rollback because it deletes people's
 * conversation history to undo a schema change, and because these two sentences
 * are the only way to tell such a row from D-166's membership lines -- there is
 * no column that says which feature wrote a system message.
 *
 *   delete from public.messages
 *    where type = 'system'
 *      and (content like 'Начался разговор в канале «%»'
 *           or content like 'Разговор в канале «%» закончился'
 *           or content = 'Начался разговор в голосовом канале'
 *           or content = 'Разговор в голосовом канале закончился');
 */
