/**
 * Rollback for 20260918170000_voice_recount_writes_only_when_something_changed.sql.
 *
 * Restores the unconditional recount exactly as it was. Run as `supabase_admin`.
 *
 * **What comes back with it.** The write loop: every pass of the reconciler
 * updates every channel it looks at whether or not the count moved, each update
 * a Realtime broadcast to every subscribed member. And nothing clears
 * `active_since` except a `room_finished` webhook, so a flag set any other way
 * stays for ever. That is what the previous four days looked like, measured at
 * 11,867 UPDATEs on a one-row table.
 */
begin;
set local lock_timeout = '5s';

create or replace function private.voice_channel_recount(p_channel_id uuid)
returns void
language sql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
  update public.voice_channels
     set participant_count = (
           select pg_catalog.count(*)
             from public.voice_participants
            where channel_id = p_channel_id
         ),
         updated_at = pg_catalog.now()
   where id = p_channel_id;
$function$;

do $$
declare v_body text;
begin
  select pg_get_functiondef(oid) into v_body from pg_proc
   where proname = 'voice_channel_recount' and pronamespace = 'private'::regnamespace;
  if v_body like '%is distinct from%' then
    raise exception 'the conditional recount is still in place';
  end if;
  raise notice 'the unconditional recount is back, and so is the write loop';
end
$$;
commit;
