/**
 * Pin the `media` bucket's own size ceiling to the one the service already
 * enforces.
 *
 * D-177 item 3: every size the product enforces is a browser constant
 * (stagedAttachments.ts:94,96, mediaCompression.ts:36, mediaUpload.ts:19-20),
 * and the `media` bucket carries no file_size_limit of its own — measured
 * read-only on production 2026-09-11. The Storage container's global
 * FILE_SIZE_LIMIT (262,144,000 bytes, Tus-Max-Size: 262144000, read 2026-09-12)
 * is the only thing deciding, and it is an environment variable on a container
 * rather than a property of the bucket: an overlay lost in a redeploy drops it
 * to the base compose file's 52,428,800 without anything saying so.
 *
 * 262,144,000 is exactly MAX_VIDEO_ATTACHMENT_BYTES and exactly the running
 * global limit, so this refuses nothing the product accepts today. It is
 * hardening, not a repair: no upload changes outcome on the day it is applied.
 *
 * The Storage API refuses a bucket limit above the global limit; equal is
 * accepted. If FILE_SIZE_LIMIT is ever raised, this bucket stays at 250 MB
 * until this value is deliberately raised too — which is the point.
 *
 * One transaction, idempotent: a second apply writes the same number. The
 * self-check refuses to commit unless the value is really stored, unless the
 * bucket is still public (a flipped `public` would break every rendered URL),
 * and unless the new limit is at or above the largest object the bucket has
 * already accepted — the one assertion that proves it refuses nothing real.
 *
 * Rollback: 1.3.
 */

begin;

set local lock_timeout = '5s';

update storage.buckets
   set file_size_limit = 262144000
 where id = 'media';

do $$
declare
  v_limit bigint;
  v_public boolean;
  v_largest bigint;
  v_rows integer;
begin
  select file_size_limit, public
    into v_limit, v_public
    from storage.buckets
   where id = 'media';

  if not found then
    raise exception 'there is no bucket named media on this database';
  end if;
  if v_limit is distinct from 262144000 then
    raise exception 'the media bucket file_size_limit reads % after the update, not 262144000', v_limit;
  end if;
  if v_public is not true then
    raise exception 'the media bucket is no longer public; every rendered media URL depends on it';
  end if;

  select count(*), coalesce(max((metadata->>'size')::bigint), 0)
    into v_rows, v_largest
    from storage.objects
   where bucket_id = 'media';

  if v_rows = 0 then
    raise exception 'the media bucket reads as empty; refusing to trust a limit checked against nothing';
  end if;
  if v_largest > v_limit then
    raise exception
      'the new limit (%) is below the largest object already stored (% bytes): it would refuse a real upload',
      v_limit, v_largest;
  end if;
end
$$;

commit;
