/**
 * Rollback for 20260914140000_channel_categories.sql.
 *
 * Every category and every channel's place in one is discarded; the channels
 * themselves are untouched, because the foreign keys only ever nulled the
 * heading. Worth knowing before running this rather than after.
 */

begin;

set local lock_timeout = '5s';

alter table public.topics drop constraint if exists topics_category_fkey;
alter table public.voice_channels drop constraint if exists voice_channels_category_fkey;

drop index if exists public.topics_category_idx;
drop index if exists public.voice_channels_category_idx;

alter table public.topics drop column if exists category_id;
alter table public.voice_channels drop column if exists category_id;

drop table if exists public.chat_channel_categories;

do $check$
begin
  if pg_catalog.to_regclass('public.chat_channel_categories') is not null then
    raise exception 'the table survived its own rollback';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name in ('topics', 'voice_channels')
       and column_name = 'category_id'
  ) then
    raise exception 'a category column survived the rollback';
  end if;
end
$check$;

commit;
