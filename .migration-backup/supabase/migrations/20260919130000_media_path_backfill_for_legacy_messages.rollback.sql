-- Rollback for `20260919130000_media_path_backfill_for_legacy_messages.sql`.
--
-- Restores each touched row to exactly what it held before, from the record the
-- forward migration wrote. It restores nothing it did not itself fill: the
-- table is keyed by message and carries the previous values, so a row somebody
-- else changed in between is left alone rather than reverted to a stale value.

begin;

update public.messages m
set media_bucket = b.previous_bucket,
    media_path = b.previous_path
from private.d208_media_path_backfill b
where m.id = b.message_id
  and m.media_bucket is not distinct from b.filled_bucket
  and m.media_path is not distinct from b.filled_path;

do $check$
declare
  v_left integer;
begin
  select count(*) into v_left
  from public.messages m
  join private.d208_media_path_backfill b on b.message_id = m.id
  where m.media_path is not distinct from b.filled_path
    and b.previous_path is distinct from b.filled_path;
  if v_left > 0 then
    raise exception '% rows still carry the back-filled path', v_left;
  end if;
end
$check$;

drop table if exists private.d208_media_path_backfill;

commit;
