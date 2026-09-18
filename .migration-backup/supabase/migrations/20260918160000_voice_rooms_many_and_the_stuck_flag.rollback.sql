/**
 * Rollback for 20260918160000_voice_rooms_many_and_the_stuck_flag.sql.
 *
 * **Read this before running it.** Two of the three changes undo cleanly and
 * one does not, and the one that does not is the important one.
 *
 * - Putting the unique index back **fails outright** if any group has grown a
 *   second live voice room since the migration. That is not a flaw in this
 *   file; it is the shape of the change. Rolling back after people have used
 *   the feature means choosing which of their rooms to archive, and no script
 *   should choose that. The statement below is written to fail loudly rather
 *   than to pick.
 * - The `category_id` grant and the cleared `active_since` undo exactly.
 *   Restoring the flag is deliberately NOT attempted: it was wrong data, the
 *   original value is in the schema backup taken before the apply, and setting
 *   a room «active» with nobody in it would restart the write loop.
 */

begin;

set local lock_timeout = '5s';

-- Refuses rather than choosing, if the feature has been used.
do $$
declare
  v_crowded integer;
begin
  select count(*) into v_crowded
    from (
      select chat_id
        from public.voice_channels
       where not archived
       group by chat_id
      having count(*) > 1
    ) as crowded;
  if v_crowded > 0 then
    raise exception
      'ROLLBACK REFUSED: % group(s) already have more than one live voice room. '
      'Archiving one per group is a decision for a person, not for this script.',
      v_crowded;
  end if;
end
$$;

drop index if exists public.voice_channels_chat_position_idx;

create unique index if not exists voice_channels_one_per_chat_idx
  on public.voice_channels (chat_id)
  where not archived;

revoke update (category_id) on public.voice_channels from authenticated;

do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'voice_channels'
       and indexname = 'voice_channels_one_per_chat_idx'
  ) then
    raise exception 'the one-room index did not come back';
  end if;
  if has_column_privilege('authenticated', 'public.voice_channels', 'category_id', 'UPDATE') then
    raise exception 'the category_id grant was not revoked';
  end if;
  raise notice 'back to one voice room per group; active_since deliberately not restored';
end
$$;

commit;
