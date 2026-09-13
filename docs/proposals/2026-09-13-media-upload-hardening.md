# Media upload hardening — a reviewed SQL proposal for D-177

Written 2026-09-13 against `integration/message-actions`. **Nothing here has been
applied.** No database was touched to write it; every statement about production
is either quoted from a measurement already recorded in the register, or listed
below as something that must be read before anything is applied.

D-177 (`docs/INTERFACE_DEFECT_REGISTER.md:8885-8944`) lists eleven things the
client decides that the server never re-checks. This proposal covers the ones a
database change can close, in the order D-177 itself asks for: the bucket
settings first, then the path rule, then the metadata, then the timestamps. Two
of the eleven are closed here as **"do not apply"**, with the reasoning, because
the change that would close them refuses uploads the product makes today.

The governing rule, from the task and from the register's own "Proposed"
paragraph: **a limit that refuses a real upload is worse than the hole.**

---

## 0. What is not known, and the read-only step that must run first

Bucket settings are not in the repository. `storage.buckets` rows are created by
migrations but mutated by the Storage API and by the dashboard, so the checked-in
migration is a statement of intent from 2026-05-06, not a statement of fact about
2026-09-13. **Do not apply anything below before running section 0.1 and reading
its output.** Several of the changes name a number that must be confirmed, and
two of them are refused outright if the measurement disagrees.

What the repository does establish, and what it does not:

| Fact | Established? | Where |
| --- | --- | --- |
| Message media, all avatars and all worker variants live in one bucket named `media` | yes | `artifacts/kub/src/lib/stagedAttachments.ts:92`, `artifacts/kub/src/lib/mediaUpload.ts:198-202`, `artifacts/api-server/src/workers/mediaVariantsWorker.ts:46` |
| `media` is a **public** bucket | yes | `.migration-backup/supabase/migrations/20260505_media_storage_path_policies.sql:17-20`; re-read from `storage.buckets` on 2026-09-11 per `20260911144000_forward_message_with_media.sql:12-13` |
| `media` has **no** `file_size_limit` and **no** `allowed_mime_types` | measured, not repository | `docs/INTERFACE_DEFECT_REGISTER.md:6411-6412` (read-only on production, 2026-09-11) |
| A second bucket `chat-media` exists, private, 104857600 bytes, ten MIME types | repository only | `.migration-backup/supabase/migrations/20260506_secure_chat_media_access.sql:15-37` |
| `chat-media` is unused | yes | `20260911144000_forward_message_with_media.sql:46-48` — "Nothing uses that bucket today"; and `CHAT_MEDIA_BUCKET` is the *name of a constant whose value is* `"media"` (`stagedAttachments.ts:92`) |
| The storage service's global limit is 262,144,000 bytes | measured, not repository | `docs/INTERFACE_DEFECT_REGISTER.md:6428-6431` — the running container's `FILE_SIZE_LIMIT`, and `Tus-Max-Size: 262144000` from the resumable endpoint, 2026-09-12. The base compose file still reads 52,428,800 and is overridden by an overlay. |
| Which MIME strings the `media` bucket has actually stored | **unknown** | nothing in the repository records this; 0.1 measures it |

### 0.1 The read-only query that must run first

Read-only. No writes, no `EXPLAIN ANALYZE`, no temp tables. Run as a role that
can read `storage.*` (`postgres` or `supabase_admin`); run it in a read-only
transaction so a mistyped statement cannot commit.

```sql
begin read only;

-- (a) The bucket settings this proposal is about. Everything in section 1 and
--     section 2 depends on these three columns.
select id, name, public, file_size_limit, allowed_mime_types, owner, created_at
  from storage.buckets
 order by id;

-- (b) The largest object the bucket has already accepted. A file_size_limit
--     below this number would refuse a file the product already stored.
select bucket_id,
       count(*) as objects,
       max((metadata->>'size')::bigint) as largest_bytes,
       percentile_disc(0.999) within group (order by (metadata->>'size')::bigint) as p999_bytes
  from storage.objects
 where bucket_id in ('media', 'chat-media')
 group by bucket_id;

-- (c) EVERY distinct content-type the bucket has stored, with a count. This is
--     the only honest input to the allowed_mime_types question: it says what the
--     browsers people actually use have sent, parameters and all.
select metadata->>'mimetype' as mimetype, count(*) as objects
  from storage.objects
 where bucket_id = 'media'
 group by 1
 order by 2 desc;

-- (d) Whether the recorders' parameterised types reached storage as written.
--     If `audio/webm;codecs=opus` appears here, a bare `audio/webm` entry in an
--     allowlist would not have matched it, and section 2 is settled.
select metadata->>'mimetype' as mimetype, count(*) as objects
  from storage.objects
 where bucket_id = 'media'
   and metadata->>'mimetype' like '%;%'
 group by 1
 order by 2 desc;

-- (e) The live storage.objects policies and the live bodies of the helper
--     functions, so the section-3 change is written against what is deployed
--     rather than against the checked-in file.
select policyname, cmd, roles, permissive, qual, with_check
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by policyname;

select p.proname,
       pg_catalog.pg_get_functiondef(p.oid) as definition,
       p.proacl
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     '_kub_media_path_allowed',
     '_kub_bot_avatar_path_allowed',
     '_kub_can_access_chat_media_path',
     '_kub_chat_media_chat_id'
   )
 order by p.proname;

-- (f) PRE-FLIGHT for section 3: how many existing message rows would the new
--     media_path rule have refused? The rule is wrong if this is not 0 (see 3.4).
select count(*) as would_have_been_refused
  from public.messages m
 where m.media_path is not null
   and m.bot_id is null
   and m.user_id is not null
   and split_part(m.media_path, '/', 1) is distinct from m.user_id::text
   and not exists (
     select 1 from public.messages src
      where src.id = m.forwarded_from_id
        and src.media_path is not distinct from m.media_path
        and src.media_bucket is not distinct from m.media_bucket
   );

-- (g) PRE-FLIGHT for section 3b: how many rows have a media_url that does not
--     end in their own bucket and path? 3b must not be applied if this is > 0.
select count(*) as media_url_mismatch
  from public.messages
 where media_path is not null
   and media_bucket is not null
   and media_url is not null
   and right(split_part(media_url, '?', 1),
             length('/' || media_bucket || '/' || media_path))
       is distinct from '/' || media_bucket || '/' || media_path;

-- (h) PRE-FLIGHT for section 4: does any existing row already violate the
--     media_metadata shape rules? Each of these must be 0.
select
  count(*) filter (where jsonb_typeof(media_metadata->'preview') not in ('object','null')
                     and media_metadata ? 'preview')                       as bad_preview_type,
  count(*) filter (where media_metadata#>>'{preview,path}' like '/%')       as preview_absolute,
  count(*) filter (where media_metadata#>>'{preview,path}' like '%..%')     as preview_traversal,
  count(*) filter (where media_metadata ? 'uncompressed'
                     and jsonb_typeof(media_metadata->'uncompressed') <> 'boolean') as bad_uncompressed,
  count(*) filter (where media_metadata ? 'optimized'
                     and jsonb_typeof(media_metadata->'optimized') <> 'boolean')    as bad_optimized,
  count(*) filter (where media_metadata ? 'media_quality'
                     and media_metadata->>'media_quality' not in ('compact','balanced','original'))
                                                                            as bad_quality,
  count(*) filter (where media_metadata ? 'width'
                     and jsonb_typeof(media_metadata->'width') not in ('number','null'))  as bad_width,
  count(*) filter (where media_metadata ? 'height'
                     and jsonb_typeof(media_metadata->'height') not in ('number','null')) as bad_height
  from public.messages
 where media_metadata is not null;

-- (i) PRE-FLIGHT for section 5: how far into the future has a client_sent_at
--     ever been written, relative to the row's own created_at? The tolerance in
--     5.1 must be larger than this.
select count(*) as ahead_of_created_at,
       max(client_sent_at - created_at) as furthest_ahead,
       percentile_disc(0.999) within group (order by client_sent_at - created_at) as p999_ahead
  from public.messages
 where client_sent_at is not null
   and client_sent_at > created_at;

select count(*) as edited_before_created,
       count(*) filter (where edited_at > now()) as edited_in_the_future
  from public.messages
 where edited_at is not null
   and (edited_at < created_at or edited_at > now());

rollback;
```

Everything below is written so that the operator fills in nothing by guess: each
change states which line of 0.1's output it depends on, and its self-check
re-reads that line from the database rather than trusting this document.

---

## 1. The `media` bucket has no size limit

### 1.1 The hole

Every size the product enforces is a constant in the browser:

| Constant | Bytes | Where |
| --- | --- | --- |
| `MAX_ATTACHMENT_BYTES` | 52,428,800 | `artifacts/kub/src/lib/stagedAttachments.ts:94` |
| `MAX_VIDEO_ATTACHMENT_BYTES` | **262,144,000** | `artifacts/kub/src/lib/stagedAttachments.ts:96` |
| `MAX_ORIGINAL_ATTACHMENT_BYTES` | 52,428,800 | `artifacts/kub/src/lib/mediaCompression.ts:36` |
| `MAX_AVATAR_SOURCE_BYTES` | 15,728,640 | `artifacts/kub/src/lib/mediaUpload.ts:20` |
| `MAX_AVATAR_UPLOAD_BYTES` | 2,097,152 | `artifacts/kub/src/lib/mediaUpload.ts:19` |

They are applied in `validateStagedAttachment` (`stagedAttachments.ts:117-126`)
and `validateAvatarImage` (`mediaUpload.ts:31-45`) — in the browser, before the
request. Nothing on the server repeats any of them for the `media` bucket:
the bucket carries no `file_size_limit`, measured read-only on production on
2026-09-11 (`docs/INTERFACE_DEFECT_REGISTER.md:6411-6412`), and the only bucket
that has one is `chat-media`
(`.migration-backup/supabase/migrations/20260506_secure_chat_media_access.sql:20`),
which nothing writes to (`20260911144000_forward_message_with_media.sql:46-48`).

The Storage container's global `FILE_SIZE_LIMIT` is what decides today:
262,144,000 bytes, with `Tus-Max-Size: 262144000` advertised by the resumable
endpoint (`docs/INTERFACE_DEFECT_REGISTER.md:6428-6431`, 2026-09-12). That is an
environment variable on a container, not a property of the bucket; a redeploy
that loses the overlay silently drops it to the base compose file's 52,428,800,
and a redeploy that raises it silently raises every bucket at once.

### 1.2 The smallest change that closes it

Pin the bucket to exactly the number the service already enforces and the client
already refuses to exceed: **262,144,000**. This refuses nothing that is accepted
today, and it survives a change to the container's environment.

This is deliberately not an opportunity to lower the limit. The owner chose the
client's 250 MB on 2026-09-12 (`docs/INTERFACE_DEFECT_REGISTER.md:6428-6429`);
lowering it is a separate product decision, not hardening.

```sql
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
```

### 1.3 Rollback

```sql
begin;
update storage.buckets set file_size_limit = null where id = 'media';
do $$
declare v_limit bigint;
begin
  select file_size_limit into v_limit from storage.buckets where id = 'media';
  if v_limit is not null then
    raise exception 'rollback incomplete: the media bucket still carries a limit of %', v_limit;
  end if;
end $$;
commit;
```

After the rollback the bucket is governed by the container's `FILE_SIZE_LIMIT`
again — which is where it is today.

### 1.4 What would break

Every client call path that writes to `media`, and whether the new ceiling
refuses it. **The largest legitimate upload today is 262,144,000 bytes** — a
video, sent as picked.

| # | Call path | File:line | Largest file it can send | Refused at 262,144,000? |
| --- | --- | --- | --- | --- |
| A1 | Chat attachment, multipart (under 6 MiB) | `components/chat/ChatWindow.tsx:573-579` | 6,291,456 (`resumableStorageUpload.ts:5`) | no |
| A2 | Chat attachment, tus/resumable (over 6 MiB) | `ChatWindow.tsx:549-571` → `lib/resumableStorageUpload.ts:150-206` | 262,144,000 for a video, 52,428,800 otherwise (`stagedAttachments.ts:117-126`) | **no, exactly at the limit** |
| A3 | The sidecar preview beside an original photo | `ChatWindow.tsx:597-603` | a 1280–2560 px WebP/JPEG, far under 1 MiB (`mediaCompression.ts:48,71,72`) | no |
| B | Own avatar | `components/settings/SettingsScreen.tsx:187-193` | 2,097,152 (`mediaUpload.ts:19`, checked at `SettingsScreen.tsx:180`) | no |
| C | Group/channel avatar | `components/chat/ChatInfoPanel.tsx:759-764` | 2,097,152 (checked at `:752`) | no |
| D | An administrator setting another person's avatar | `pages/admin/UsersTab.tsx:1072-1078` | 2,097,152 (checked at `:1063`) | no |
| E | Bot avatar | `lib/botAvatar.ts:52-58` | 15,728,640 — this path calls `validateAvatarImage` only, not `validateAvatarUploadImage`, so an image the canvas could not shrink goes up at its source size (`botAvatar.ts:44-49`, `mediaUpload.ts:296-304`) | no |
| W | The worker's variants (service role) | `artifacts/api-server/src/workers/mediaVariantsWorker.ts:720` | a 720p copy or a WebP poster, always smaller than its source | no |

Why A2 is safe at exactly the limit rather than one byte over it:
`validateStagedAttachment` refuses `file.size > MAX_VIDEO_ATTACHMENT_BYTES`
(`stagedAttachments.ts:122`), so the largest file that can reach the network is
262,144,000 bytes exactly, and `file_size_limit` is a ceiling, not an exclusive
bound. `removeLocation` preserves the file's length by construction
(`lib/mediaLocation.ts:1-18`), and `transcodeVideo` only ever produces something
smaller — it declines to encode when the result would not be smaller
(`lib/videoTranscode.ts`, plan reason `not-smaller`). So nothing between the
check and the request can grow the file past the number that was checked.

And if a refusal ever did happen, it is already a legible one rather than a
silent failure: a 413 carries `Tus-Max-Size` through `describeUploadFailure`
(`lib/uploadFailure.ts:130-148`) into "файл больше, чем принимает сервер: до 250 МБ"
(`uploadFailure.ts:198-204`). That is the D-113 fix, merged in `584a38f`.

### 1.5 Verification after applying

```sql
-- 1. The limit is stored, and the bucket is still public.
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'media';
-- expect: media | t | 262144000 | (null)

-- 2. It is at or above everything already stored.
select max((metadata->>'size')::bigint) as largest_bytes,
       (select file_size_limit from storage.buckets where id = 'media') as bucket_limit,
       max((metadata->>'size')::bigint)
         <= (select file_size_limit from storage.buckets where id = 'media') as limit_covers_history
  from storage.objects where bucket_id = 'media';
-- expect: limit_covers_history = t

-- 3. The resumable endpoint still advertises the same number, from outside:
--    curl -sI -X OPTIONS https://<storage host>/storage/v1/upload/resumable | grep -i tus-max-size
```

---

## 2. The `media` bucket has no MIME allowlist — **recommendation: do not add one**

### 2.1 The hole

D-177 item 4. `media` carries no `allowed_mime_types`
(`docs/INTERFACE_DEFECT_REGISTER.md:6411-6412`), and the content type stored
against an object is whatever the client said:

```ts
// artifacts/kub/src/components/chat/ChatWindow.tsx:546
const contentType = attachment.mimeType || attachment.file.type || "application/octet-stream";
```

`attachment.mimeType` is `file.type || "application/octet-stream"`
(`lib/stagedAttachments.ts:140`), and the «Файл» picker sets no `accept` at all —
`{ accept: null, capture: null, multiple: true, compress: false, source: "picker" }`
(`lib/attachSheet.ts:177-179`), which is D-119's approved behaviour: «Файл» takes
any file. `getAttachmentKind` files anything that is not `image/`, `video/` or
`audio/` under `"file"` (`stagedAttachments.ts:234-239`) and nothing rejects it.
On a **public** bucket that means an attacker-chosen `content-type` — `text/html`,
`image/svg+xml` — served from the storage origin.

### 2.2 Why the obvious change must not be applied

`allowed_mime_types` is an allowlist and only an allowlist; there is no deny-list
form. To keep the product working, the allowlist would have to contain, at
minimum:

1. **`application/octet-stream`** — the fallback at `stagedAttachments.ts:140`
   for any file whose type the OS did not report. Admitting it admits arbitrary
   bytes under an arbitrary extension, which is most of what the entry was meant
   to stop.
2. **Every type «Файл» can carry**, which is every type, by design (D-119,
   `attachSheet.ts:177-179`). An allowlist of everything is not an allowlist.
3. **The recorders' parameterised types.** The voice recorder's preferred list is
   `["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]`
   (`hooks/useVoiceRecorder.ts:24-28`); the round-video recorder's is
   `["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm", "video/mp4;codecs=h264,aac", "video/mp4"]`
   (`components/chat/VideoMessageRecorderModal.tsx:13-19`). The codec parameter
   is **kept**: `createStagedVoiceAttachment` sets
   `type: mimeType || blob.type || "audio/webm"` (`stagedAttachments.ts:162,174`)
   and `createStagedVideoMessageAttachment` the same (`:192,204`), and that value
   becomes `contentType` verbatim at `ChatWindow.tsx:546`.

   **I do not know whether the Storage API matches `audio/webm;codecs=opus`
   against an `audio/webm` entry, and I am not willing to guess.** If it does
   not, an allowlist without the parameterised spellings refuses **every voice
   message and every round video** on the browsers that report them — which is
   the exact failure this proposal exists to avoid. Query 0.1(d) settles it from
   what production has actually stored.
4. **The worker's own writes.** `uploadVariant` sends `image/webp` and, for the
   720p copy, `video/mp4` (`mediaVariantsWorker.ts:47,449,720`;
   `mediaVariantRules.ts:107`). A bucket-level allowlist is enforced by the
   Storage API for every caller; whether the service role is exempt is **not
   something I have verified**, and it must not be assumed.

A list that satisfies 1 and 2 closes nothing. A list that omits 3 breaks voice.
So the smallest change that closes this hole without refusing a real upload
**does not exist at the bucket level.**

### 2.3 What to do instead

The exposure is not really "an unusual MIME type is stored" — it is "a public
origin serves attacker-chosen HTML". Three ways out, none of them this migration:

- **Client-side (recommended, out of scope for a SQL proposal):** normalise the
  `contentType` at `ChatWindow.tsx:546` for the `"file"` kind — send
  `application/octet-stream` for anything that is not on a known-renderable list,
  and strip the codec parameter for the recorder kinds. One line each, no server
  change, and it cannot refuse an upload because it changes only the label.
- **Serving-side:** a `Content-Disposition: attachment` / `X-Content-Type-Options`
  policy at the storage origin's proxy. Not a database change.
- **Bucket-level, only if the owner insists:** the gated SQL in 2.4, which I do
  not recommend.

### 2.4 The allowlist, written out but **not recommended**

Apply only if the owner directs it, and only after 0.1(c) and 0.1(d) have been
read, with every type they returned added to the array below. The self-check
refuses to commit if any type already stored in the bucket is missing from the
list — that is the only thing standing between this statement and a broken voice
recorder.

```sql
/**
 * NOT RECOMMENDED. See section 2.2 of docs/proposals/2026-09-13-media-upload-hardening.md.
 *
 * A bucket-level MIME allowlist on `media`. It cannot close D-177 item 4,
 * because «Файл» accepts any type by design (D-119, attachSheet.ts:177-179) and
 * the client falls back to application/octet-stream (stagedAttachments.ts:140),
 * both of which must be in the list for the product to work. It is written out
 * so the option is reviewable rather than imagined.
 *
 * The array below is a PLACEHOLDER. Before applying, replace it with the union
 * of (a) this list and (b) every value query 0.1(c) returned. The self-check
 * refuses to commit otherwise.
 */

begin;

set local lock_timeout = '5s';

update storage.buckets
   set allowed_mime_types = array[
     -- pictures the client writes
     'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
     -- video, including every parameterised spelling the recorder can report
     'video/mp4', 'video/webm', 'video/quicktime',
     'video/mp4;codecs=h264,aac',
     'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus',
     -- audio, likewise
     'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav',
     'audio/webm;codecs=opus',
     -- documents and the fallback, without which «Файл» stops working
     'application/pdf', 'text/plain', 'application/octet-stream'
   ]::text[]
 where id = 'media';

do $$
declare
  v_allowed text[];
  v_missing text;
begin
  select allowed_mime_types into v_allowed from storage.buckets where id = 'media';
  if v_allowed is null then
    raise exception 'the allowlist did not store';
  end if;

  -- The assertion that matters: nothing the bucket has ever accepted may be
  -- outside the list. A voice message recorded as audio/webm;codecs=opus that
  -- is not in the array would stop being sendable, silently, on that browser.
  select string_agg(distinct t.mimetype, ', ')
    into v_missing
    from (
      select metadata->>'mimetype' as mimetype
        from storage.objects
       where bucket_id = 'media'
         and metadata->>'mimetype' is not null
    ) t
   where not (t.mimetype = any (v_allowed));

  if v_missing is not null then
    raise exception
      'these content types are already stored in the bucket and are not in the allowlist: %', v_missing;
  end if;

  if not ('application/octet-stream' = any (v_allowed)) then
    raise exception 'application/octet-stream is missing: every file whose type the browser did not report would be refused';
  end if;
end
$$;

commit;
```

**Rollback:** `update storage.buckets set allowed_mime_types = null where id = 'media';`
with a self-check that reads the column back as null.

**What would break if applied:** paths A1, A2 and A3 for any type not in the
array — in particular any document sent through «Файл» with an unusual type, and
(if the Storage API does not strip parameters, which 0.1(d) determines) every
voice message and round video. Paths B, C, D and E are safe: `validateAvatarImage`
already restricts avatars to `image/jpeg|png|webp|gif`
(`mediaUpload.ts:24-29,31-45`). Path W is safe if and only if the service role is
subject to the same check and `image/webp`/`video/mp4` are in the list; both are.

**Verification after applying:**

```sql
select id, allowed_mime_types from storage.buckets where id = 'media';

-- Nothing already stored falls outside it (must return zero rows):
select metadata->>'mimetype' as mimetype, count(*)
  from storage.objects
 where bucket_id = 'media'
   and not (metadata->>'mimetype' = any (
     select allowed_mime_types from storage.buckets where id = 'media'))
 group by 1;

-- And, after a real voice message and a real round video are sent from each
-- supported browser, that both arrived:
select metadata->>'mimetype', max(created_at)
  from storage.objects
 where bucket_id = 'media' and created_at > now() - interval '1 hour'
 group by 1;
```

---

## 3. Nothing ties a message's `media_path` to whoever uploaded it

### 3.1 The hole

Uploads **are** confined to the uploader's own folder. The live predicate is
`public._kub_media_path_allowed`, whose deployed body is written out in
`.migration-backup/supabase/migrations/20260905150000_media_path_uuid_pattern_repair.sql:31-94`;
the branch that matters is at `:51-54`:

```sql
  -- Message, voice and generic attachments: {auth.uid()}/...
  if v_first = auth.uid()::text then
    return true;
  end if;
```

and it is what the four `media` policies call
(`20260505_media_storage_path_policies.sql:70-108`, all four of the form
`bucket_id = 'media' and public._kub_media_path_allowed(name)`). The avatar
branches are at `:56-90` of the repair, and `bot-avatars/{bot_id}/...` is a
separate predicate with its own four policies
(`20260905140000_bot_avatar_policy_repair.sql:38-105`).

What has no such rule is the **message row**. The insert policy is

```sql
-- .migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql:759-767
drop policy if exists "Chat members can send messages" on public.messages;
create policy "Chat members can send messages"
on public.messages for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and bot_id is null
  and public.is_chat_member(chat_id)
);
```

— membership and authorship, and nothing at all about `media_bucket`,
`media_path` or `media_url`. So a member can post a message whose `media_path`
names **another person's** object. D-177 item 2 calls this a mislabelling hole
rather than an upload hole, and that is right, but it is not cosmetic: the
variant worker reads `media_path` to decide what to transcode
(`mediaVariantsWorker.ts:398,450`), `readOriginalPreview` derives the preview
address from it (`mediaCompression.ts:288-306`), and forwarding now copies it
(`20260911144000_forward_message_with_media.sql:24-27`).

It is reachable on UPDATE too, not only INSERT: `public.messages` has an
author-only UPDATE policy (named as such at
`20260911143000_delete_messages_for_everyone.sql:54-56`), and a trigger already
fires `after update of content, media_bucket, media_path, media_metadata, ...`
(`20260831100000_bot_platform_foundation.sql:4205-4208`), so those columns are
expected to change after insert.

### 3.2 The rule, and the two exemptions it cannot do without

For a write by a signed-in person, where `media_path` is set and `bot_id` is
null, the first segment of `media_path` must be the author's own id — the same
rule `_kub_media_path_allowed` applies to the object.

Two exemptions are mandatory, and leaving either out breaks the product:

- **A forward.** `public.forward_message` copies `media_bucket`, `media_path` and
  `media_metadata` from the server's own row of the source
  (`20260911144000_forward_message_with_media.sql:24-27`), so the copy's path
  begins with the **original** sender's id, not the forwarder's. A naive rule
  refuses every forward of a photo — the exact defect D-083 was fixed to stop.
  The exemption is narrow: the row must name a `forwarded_from_id` whose message
  carries that same bucket and path. It grants nothing new, because a forward can
  only ever re-point at media of a message the caller could already read.
- **A session with no `auth.uid()`.** The variant worker and any maintenance run
  as the service role. They are not the subject of this rule.

Bot messages are exempt by `bot_id is not null`; the insert policy above already
forbids a client from setting it.

### 3.3 The change

```sql
/**
 * A message's media_path must be the sender's own upload.
 *
 * D-177 item 2. The upload side is already closed: `_kub_media_path_allowed`
 * confines an object in the `media` bucket to `{auth.uid()}/...`, or to one of
 * the avatar prefixes (20260905150000_media_path_uuid_pattern_repair.sql:51-90),
 * and the four `media` policies call it (20260505_media_storage_path_policies.sql:70-108).
 * The row side is not: `Chat members can send messages`
 * (20260831100000_bot_platform_foundation.sql:759-767) checks membership and
 * authorship and nothing about media, so a member can post a message that points
 * at another person's object — and the author-only UPDATE policy plus
 * trg_enqueue_bot_message_updates_after_update (…:4205-4208) mean the same is
 * reachable after the insert.
 *
 * THE TWO EXEMPTIONS ARE NOT OPTIONAL.
 *   - A forward carries the SOURCE's media_path, copied from the server's own
 *     row by public.forward_message (20260911144000:24-27). Without the
 *     forwarded_from_id branch below this refuses every forwarded photo, which
 *     is D-083 reopened. The branch grants nothing: a forward can only re-point
 *     at media of a message the caller could already read.
 *   - A session with no auth.uid() is the service role: the variant worker
 *     (mediaVariantsWorker.ts) and maintenance. Not the subject of this rule.
 * Bot messages are exempt by bot_id; the insert policy already forbids a client
 * from setting it.
 *
 * Nothing is raised on a violation the product could produce, because there is
 * none. A violation IS raised, because unlike a read mark there is no
 * "stale client" reading of a message claiming someone else's file.
 *
 * Owner: the owner of public.messages (postgres on this deployment) or a
 * superuser. Lock: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on public.messages,
 * which every send writes; lock_timeout makes the apply fail in five seconds
 * rather than queue sends behind it.
 *
 * Idempotent: drop-and-create of one trigger and two functions.
 * Rollback: 3.5.
 */

begin;

set local lock_timeout = '5s';

create schema if not exists private;

-- The rule as a pure function, so the self-check can prove it without writing a
-- row. p_forward_matches is "this row names a forwarded_from_id whose message
-- carries the same bucket and path", resolved by the trigger.
create or replace function private.message_media_path_allowed(
  p_actor uuid,
  p_author uuid,
  p_bot_id uuid,
  p_media_path text,
  p_forward_matches boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_media_path is null then true          -- no media, nothing to check
    when p_actor is null then true               -- service role: not the subject
    when p_bot_id is not null then true          -- a bot's message, not a client insert
    when p_forward_matches then true             -- a forward carries the source's path
    when p_author is null then false             -- a person's message with no author
    else pg_catalog.split_part(p_media_path, '/', 1) = p_author::text
  end
$function$;

create or replace function private.guard_message_media_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_forward_matches boolean := false;
begin
  if new.media_path is null then
    return new;
  end if;

  if new.forwarded_from_id is not null then
    select true
      into v_forward_matches
      from public.messages source
     where source.id = new.forwarded_from_id
       and source.media_path is not distinct from new.media_path
       and source.media_bucket is not distinct from new.media_bucket;
    v_forward_matches := coalesce(v_forward_matches, false);
  end if;

  if not private.message_media_path_allowed(
       v_actor, new.user_id, new.bot_id, new.media_path, v_forward_matches) then
    raise exception 'message_media_path_not_owned'
      using errcode = '42501',
            detail = 'media_path must begin with the sender''s own id, or be copied from a forwarded message';
  end if;

  return new;
end
$function$;

revoke all on function private.message_media_path_allowed(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_message_media_path()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_message_media_path on public.messages;
create trigger trg_guard_message_media_path
  before insert or update of media_bucket, media_path, user_id, bot_id, forwarded_from_id
  on public.messages
  for each row execute function private.guard_message_media_path();

-- Refuse to commit unless the trigger is in place, the rule is the one
-- described, and — the part that would break the product — no message the
-- history already holds would have been refused by it.
do $$
declare
  v_mine constant uuid := '11111111-1111-1111-1111-111111111111';
  v_other constant uuid := '22222222-2222-2222-2222-222222222222';
  v_bot constant uuid := '33333333-3333-3333-3333-333333333333';
  v_trigger record;
  v_columns text[];
  v_refused bigint;
begin
  select t.tgenabled, t.tgtype, t.tgattr, p.oid::regprocedure::text as fn
    into v_trigger
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.messages'::regclass
     and t.tgname = 'trg_guard_message_media_path'
     and not t.tgisinternal;
  if not found then
    raise exception 'the media-path guard trigger is missing';
  end if;
  if v_trigger.tgenabled = 'D' then
    raise exception 'the media-path guard trigger is disabled';
  end if;
  -- tgtype bits: 1 = row, 2 = before, 4 = insert, 16 = update.
  if (v_trigger.tgtype & 1) = 0 or (v_trigger.tgtype & 2) = 0
     or (v_trigger.tgtype & 4) = 0 or (v_trigger.tgtype & 16) = 0 then
    raise exception 'the media-path guard must be a BEFORE INSERT OR UPDATE row trigger (tgtype %)', v_trigger.tgtype;
  end if;
  if v_trigger.fn <> 'private.guard_message_media_path()' then
    raise exception 'the media-path guard calls % instead', v_trigger.fn;
  end if;
  select pg_catalog.array_agg(a.attname::text order by a.attname)
    into v_columns
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.messages'::regclass
     and a.attnum = any (v_trigger.tgattr::smallint[]);
  if v_columns is distinct from
       array['bot_id', 'forwarded_from_id', 'media_bucket', 'media_path', 'user_id'] then
    raise exception 'the media-path guard fires for columns % instead of the media and sender columns', v_columns;
  end if;

  -- The rule itself, case by case.
  if not private.message_media_path_allowed(v_mine, v_mine, null, v_mine::text || '/a.jpg', false) then
    raise exception 'a sender''s own upload was refused';
  end if;
  if private.message_media_path_allowed(v_mine, v_mine, null, v_other::text || '/a.jpg', false) then
    raise exception 'a message claiming another person''s object was accepted';
  end if;
  if not private.message_media_path_allowed(v_mine, v_mine, null, v_other::text || '/a.jpg', true) then
    raise exception 'a forward carrying the source''s path was refused: D-083 would reopen';
  end if;
  if not private.message_media_path_allowed(null, v_other, null, v_other::text || '/a.jpg', false) then
    raise exception 'the service role was refused; the variant worker would stop';
  end if;
  if not private.message_media_path_allowed(v_mine, null, v_bot, 'anything/a.jpg', false) then
    raise exception 'a bot message was refused';
  end if;
  if not private.message_media_path_allowed(v_mine, v_mine, null, null, false) then
    raise exception 'a message without media was refused';
  end if;
  if private.message_media_path_allowed(v_mine, v_mine, null, 'avatars/' || v_mine::text || '/a.jpg', false) then
    raise exception 'a message pointing at an avatar path was accepted; message media lives under the sender''s id';
  end if;

  -- And no message already stored would have been refused. If this is not zero,
  -- the rule above is wrong about the product: widen the rule, never the check.
  select count(*)
    into v_refused
    from public.messages m
   where m.media_path is not null
     and m.bot_id is null
     and not private.message_media_path_allowed(
           m.user_id, m.user_id, m.bot_id, m.media_path,
           exists (
             select 1 from public.messages src
              where src.id = m.forwarded_from_id
                and src.media_path is not distinct from m.media_path
                and src.media_bucket is not distinct from m.media_bucket
           ));
  if v_refused <> 0 then
    raise exception
      '% messages already in the history would have been refused by this rule; it is wrong about the product', v_refused;
  end if;
end
$$;

commit;
```

### 3.4 If the pre-flight is not zero

Query 0.1(f) is the same count the self-check performs. If it comes back
non-zero, **stop.** It means the product writes a shape this rule does not know
about — an admin tool, a legacy backfill, a bot path I have not found. Widen the
rule with the shape that explains those rows, and re-run 0.1(f). Do not lower the
assertion, and do not apply the trigger with known-violating history: the trigger
only affects new writes, but a non-zero count is evidence that a legitimate new
write would be refused too.

### 3.5 Rollback

```sql
begin;
set local lock_timeout = '5s';
drop trigger if exists trg_guard_message_media_path on public.messages;
drop function if exists private.guard_message_media_path();
drop function if exists private.message_media_path_allowed(uuid, uuid, uuid, text, boolean);
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.messages'::regclass
       and tgname = 'trg_guard_message_media_path'
  ) or pg_catalog.to_regprocedure('private.guard_message_media_path()') is not null then
    raise exception 'rollback incomplete: the media-path guard is still present';
  end if;
end $$;
commit;
```

### 3.6 What would break

| Call path that writes `messages.media_path` | Where | Refused? |
| --- | --- | --- |
| A staged attachment sent from the composer | `ChatWindow.tsx:609-614` → `useMessages.ts:963-983`; path built by `chatAttachmentUploadPath` as `${userId}/${chatId}-${attachment.id}.${ext}` (`stagedAttachments.ts:241-246`) | no — the first segment **is** `userId`, and the comment at `:243-244` says it is kept that way for exactly this RLS |
| A forward | `public.forward_message` (`20260911144000:161-165`) | no — the `forwarded_from_id` branch |
| A bot's message | Bot Gateway, `bot_id` set | no |
| The variant worker | `mediaVariantsWorker.ts` (service role, and it writes `media_variants`, not `messages.media_path`) | no |
| An edit | `useMessages.ts:1220-1223` — updates `content` and `edited_at` only; the trigger does not fire | no |
| Delete for everyone | `20260911143000:191-195` — updates `deleted_at` only | no |

Nothing legitimate is refused. **What this does not close:** the bubble renders
`message.media_url`, not `media_path` (`MessageBubble.tsx:854-855, 883-889,
1350-1368`), and `media_url` is a free-form string. Closing the path alone stops
the forged variants and the forged preview; it does not stop a forged *picture*.
3b closes that, at a cost.

### 3b. Optional: `media_url` must address the row's own object

Only if 0.1(g) returns **0**. The client always builds `media_url` from
`getPublicUrl(uploadedPath)` (`ChatWindow.tsx:608`), so the URL always ends in
`/{bucket}/{path}` — but I have not verified that `getPublicUrl` never appends
anything beyond a query string, and legacy rows predate `media_path` entirely.
Hence: enforce only when `media_path` is set, and only after counting.

Add to `private.guard_message_media_path`, immediately before `return new`:

```sql
  if new.media_url is not null
     and new.media_bucket is not null
     and pg_catalog.right(
           pg_catalog.split_part(new.media_url, '?', 1),
           pg_catalog.length('/' || new.media_bucket || '/' || new.media_path))
         is distinct from '/' || new.media_bucket || '/' || new.media_path then
    raise exception 'message_media_url_mismatch'
      using errcode = '42501',
            detail = 'media_url must address the row''s own media_bucket and media_path';
  end if;
```

and to the self-check:

```sql
  select count(*)
    into v_refused
    from public.messages
   where media_path is not null
     and media_bucket is not null
     and media_url is not null
     and pg_catalog.right(pg_catalog.split_part(media_url, '?', 1),
                          pg_catalog.length('/' || media_bucket || '/' || media_path))
         is distinct from '/' || media_bucket || '/' || media_path;
  if v_refused <> 0 then
    raise exception '% stored messages have a media_url that does not address their own object', v_refused;
  end if;
```

`right()`/`split_part()` rather than `like`, so nothing in a path is read as a
wildcard. Rollback is the same as 3.5 (the condition lives in the same function).

---

## 4. Nothing constrains `media_metadata`

### 4.1 The hole

The only server rule is that it is a JSON object:

```sql
-- .migration-backup/supabase/migrations/20260523_message_media_metadata.sql:19-22
    alter table public.messages
      add constraint messages_media_metadata_is_object
      check (media_metadata is null or jsonb_typeof(media_metadata) = 'object');
```

Everything inside it is the sender's word, built at
`lib/mediaCompression.ts:333-391` and inserted verbatim
(`useMessages.ts:975-977`): `kind`, `mime_type`, `size_bytes`,
`original_size_bytes`, `original_mime_type`, `optimized`, `width`, `height`,
`media_quality`, `uncompressed`, `duration_ms`, and the whole `preview` block.
D-177 items 1, 9 and 10.

### 4.2 What a database change can and cannot do

**Cannot, and this is stated so nobody tries:** `optimized`, `uncompressed`,
`original_size_bytes`, `original_mime_type` and `media_quality` are assertions
about bytes the database does not read. No CHECK can decide whether a file is
"the untouched original". Closing those means the server reading every uploaded
byte — which D-177 itself flags as needing a decision rather than a patch, in the
same breath as location stripping.

**Can, safely:** the *shapes*. A type constraint cannot refuse anything the
client writes, because the client only ever writes one type per key
(`mediaCompression.ts:337-390`), and 0.1(h) proves it against the whole history
before anything is applied. And one real rule: `preview.path` must be derived
from `media_path`, which is what `readOriginalPreview` already demands on the
**reading** side (`mediaCompression.ts:300-303`) — the register's own words,
"the right instinct applied on the wrong side of the wire" (`:8931-8934`).

The full derivation check (`path = originalPreviewPath(media_path, webp|jpg)`)
is expressible in SQL and closes item 9's preview half exactly. It is written
below as part of the same constraint.

### 4.3 The change

```sql
/**
 * media_metadata keeps its shape, and an original's preview keeps its address.
 *
 * D-177 items 1, 9 and 10. The only rule today is jsonb_typeof = 'object'
 * (20260523_message_media_metadata.sql:19-22); every key inside is the sender's
 * word, built at lib/mediaCompression.ts:333-391 and inserted verbatim.
 *
 * WHAT THIS DOES NOT TRY TO DO. `optimized`, `uncompressed`,
 * `original_size_bytes`, `original_mime_type` and `media_quality` are assertions
 * about bytes the database never reads. No CHECK decides whether a file is the
 * untouched original. Those stay open, deliberately, and closing them means the
 * server reading every uploaded byte — the decision D-177 flags rather than
 * patches.
 *
 * WHAT IT DOES. Types, which cannot refuse anything the client writes because
 * the client writes one type per key; and the one real rule: an original's
 * preview must live at the address derived from the message's own media_path,
 * which readOriginalPreview already demands of a READER
 * (mediaCompression.ts:288-306, reasoning at :234-245). Enforcing it on the
 * writer is what stops the row being written at all.
 *
 * NOT VALID first, then VALIDATE, so the ACCESS EXCLUSIVE lock on
 * public.messages is held for the catalogue change only and the table scan runs
 * under SHARE UPDATE EXCLUSIVE, which does not block sends.
 *
 * Every clause was proved against the whole history by query 0.1(h) before this
 * was written; the self-check repeats it and refuses to commit on a single
 * violating row.
 *
 * Rollback: 4.4.
 */

begin;

set local lock_timeout = '5s';

alter table public.messages
  drop constraint if exists messages_media_metadata_shape;

alter table public.messages
  add constraint messages_media_metadata_shape check (
    media_metadata is null
    or (
      -- types only; a key that is absent is never constrained
      (not media_metadata ? 'uncompressed'
        or jsonb_typeof(media_metadata->'uncompressed') = 'boolean')
      and (not media_metadata ? 'optimized'
        or jsonb_typeof(media_metadata->'optimized') = 'boolean')
      and (not media_metadata ? 'media_quality'
        or media_metadata->>'media_quality' in ('compact', 'balanced', 'original'))
      and (not media_metadata ? 'width'
        or jsonb_typeof(media_metadata->'width') in ('number', 'null'))
      and (not media_metadata ? 'height'
        or jsonb_typeof(media_metadata->'height') in ('number', 'null'))
      and (not media_metadata ? 'size_bytes'
        or jsonb_typeof(media_metadata->'size_bytes') in ('number', 'null'))
      and (not media_metadata ? 'original_size_bytes'
        or jsonb_typeof(media_metadata->'original_size_bytes') in ('number', 'null'))
      and (not media_metadata ? 'duration_ms'
        or jsonb_typeof(media_metadata->'duration_ms') in ('number', 'null'))
      and (not media_metadata ? 'preview'
        or jsonb_typeof(media_metadata->'preview') in ('object', 'null'))
      -- the one real rule: a preview's address is derived, never chosen
      and (
        media_metadata#>>'{preview,path}' is null
        or (
          media_path is not null
          and media_metadata#>>'{preview,path}' in (
            regexp_replace(media_path, '[.][^./]*$', '') || '.preview.webp',
            regexp_replace(media_path, '[.][^./]*$', '') || '.preview.jpg'
          )
        )
      )
    )
  ) not valid;

alter table public.messages
  validate constraint messages_media_metadata_shape;

do $$
declare
  v_convalidated boolean;
  v_bad bigint;
begin
  select c.convalidated
    into v_convalidated
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.messages'::regclass
     and c.conname = 'messages_media_metadata_shape';
  if not found then
    raise exception 'the media_metadata shape constraint is missing';
  end if;
  if not v_convalidated then
    raise exception 'the media_metadata shape constraint was not validated against the existing rows';
  end if;

  -- The original object rule must still be there: this constraint is an
  -- addition to it, not a replacement.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_media_metadata_is_object'
  ) then
    raise exception 'messages_media_metadata_is_object has gone; the object rule must stay';
  end if;

  -- And prove the derivation rule actually rejects a chosen path, rather than
  -- accepting everything through a regexp that matches nothing.
  if regexp_replace('a1b2/c3d4-e5f6.jpg', '[.][^./]*$', '') <> 'a1b2/c3d4-e5f6' then
    raise exception 'the stem rule does not strip an extension; every preview would be refused';
  end if;
  if regexp_replace('a1b2/c3d4-e5f6', '[.][^./]*$', '') <> 'a1b2/c3d4-e5f6' then
    raise exception 'the stem rule mangles a path with no extension';
  end if;
  if regexp_replace('a1b2.x/c3d4', '[.][^./]*$', '') <> 'a1b2.x/c3d4' then
    raise exception 'the stem rule strips past a slash';
  end if;

  select count(*)
    into v_bad
    from public.messages
   where media_metadata#>>'{preview,path}' is not null
     and (media_path is null
          or media_metadata#>>'{preview,path}' not in (
               regexp_replace(media_path, '[.][^./]*$', '') || '.preview.webp',
               regexp_replace(media_path, '[.][^./]*$', '') || '.preview.jpg'));
  if v_bad <> 0 then
    raise exception '% stored messages carry a preview path that is not derived from their own media_path', v_bad;
  end if;
end
$$;

commit;
```

The regexp `'[.][^./]*$'` is the SQL of `originalPreviewPath`
(`mediaCompression.ts:246-253`): strip the last dot-suffix of the final path
segment, never across a slash. The two accepted endings are the two the client
can write — `.preview.webp`, and `.preview.jpg` from an engine that cannot encode
WebP (`mediaCompression.ts:252,256-258`).

### 4.4 Rollback

```sql
begin;
set local lock_timeout = '5s';
alter table public.messages drop constraint if exists messages_media_metadata_shape;
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_media_metadata_shape'
  ) then
    raise exception 'rollback incomplete: the media_metadata shape constraint is still present';
  end if;
end $$;
commit;
```

### 4.5 What would break

| Writer of `media_metadata` | Where | Refused? |
| --- | --- | --- |
| A staged image, video, audio or file | `buildAttachmentMediaMetadata` (`mediaCompression.ts:356-390`): `kind`/`mime_type` strings, `size_bytes`/`original_size_bytes`/`width`/`height` numbers or null, `optimized`/`uncompressed` booleans, `media_quality` one of `compact`/`balanced`/`original` (`lib/mediaQuality.ts:1`) | no |
| A round video message | `mediaCompression.ts:337-346`: `duration_ms` number or null, no `preview` | no |
| An original photo's preview block | `mediaCompression.ts:382-388`, path from `originalPreviewPath(uploadedPath, previewFile.type)` (`ChatWindow.tsx:596`) | no — that is precisely the derivation the constraint demands |
| A forward | `forward_message` copies the source's whole `media_metadata` **and** its `media_path` together (`20260911144000:24-27`) | no — both travel, so the derivation still holds |
| A bot | Bot Gateway | not refused unless it writes a chosen preview path; **confirm with 0.1(h) that no bot row violates it** — the pre-flight covers every row, bots included |

The risk to watch: `optimistic` rows inserted client-side carry `media_metadata`
before the upload finishes (`useMessages.ts:1042-1064`) — those are local store
objects, never an INSERT, so the constraint never sees them.

---

## 5. `client_sent_at` and `edited_at` are free-form client timestamps

### 5.1 `client_sent_at`

**The hole.** D-177 item 7. The column was added nullable with no default
(`20260508_messages_client_message_id.sql:25`) and nothing clamps it; the client
sends whatever it likes (`useMessages.ts:973`). `created_at` is a database
default and is safe.

**The thing that makes a naive clamp wrong.** The client deliberately writes
timestamps slightly in the future to preserve pick order within one send:

```ts
// artifacts/kub/src/lib/attachmentSendQueue.ts:161-165
export function nextClientSentAt(previous: string | null, nowMs: number): string {
  const previousMs = previous ? Date.parse(previous) : Number.NaN;
  const at = Number.isFinite(previousMs) ? Math.max(nowMs, previousMs + 1) : nowMs;
  return new Date(at).toISOString();
}
```

Ten attachments (`MAX_STAGED_ATTACHMENTS`, `stagedAttachments.ts:93`) started
inside one millisecond can be up to ten milliseconds ahead of the client's own
clock, uploaded three at a time (`attachmentSendQueue.ts`), and the server's clock
may be behind the phone's. **A hard `least(client_sent_at, now())` would collapse
two attachments onto the same instant and lose the pick order** — the exact thing
`nextClientSentAt` exists to protect, and a visible regression rather than a
theoretical one. So the clamp needs a tolerance, and the tolerance must be larger
than the worst value 0.1(i) reports.

**The change.** One minute of tolerance: far beyond any batch or clock skew the
product produces, and it still removes what the hole actually buys — a message
pinned to the top of a conversation until 2099. No lower bound: an offline queue
legitimately reports an old time.

```sql
/**
 * client_sent_at may not be in the future by more than a minute.
 *
 * D-177 item 7. The column is a free-form client value
 * (20260508_messages_client_message_id.sql:25, useMessages.ts:973) with nothing
 * clamping it, where read marks got exactly that clamp (20260911140000:61-76).
 *
 * WHY THE TOLERANCE IS NOT A COMPROMISE. lib/attachmentSendQueue.ts:161-165
 * writes max(now, previous + 1ms) on purpose, so a send of up to ten attachments
 * (MAX_STAGED_ATTACHMENTS) started inside one millisecond is legitimately up to
 * ten milliseconds ahead of the client's clock, and the server's clock may be
 * behind the phone's. A clamp to now() exactly would collapse two attachments
 * onto one instant and lose the pick order — a visible regression. One minute is
 * far past anything the product produces and far short of what the hole buys.
 *
 * Nothing is raised: a value past the tolerance is brought back, in the shape of
 * 20260911140000, because a device with a wrong clock is not an attacker and
 * refusing its message helps nobody.
 *
 * Rollback: 5.3.
 */

begin;

set local lock_timeout = '5s';

create schema if not exists private;

create or replace function private.clamp_client_timestamp(
  p_value timestamptz,
  p_now timestamptz,
  p_tolerance interval
)
returns timestamptz
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_value is null then null
    when p_value > p_now + p_tolerance then p_now
    else p_value
  end
$function$;

create or replace function private.guard_message_client_times()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_tolerance constant interval := interval '1 minute';
begin
  new.client_sent_at := private.clamp_client_timestamp(new.client_sent_at, v_now, v_tolerance);
  new.edited_at := private.clamp_client_timestamp(new.edited_at, v_now, v_tolerance);

  -- An edit that changes the text always stamps a time, whatever the client
  -- sent, and never earlier than the message itself.
  if tg_op = 'UPDATE'
     and new.content is distinct from old.content
     and new.deleted_at is not distinct from old.deleted_at then
    if new.edited_at is null or new.edited_at is not distinct from old.edited_at then
      new.edited_at := v_now;
    end if;
  end if;
  if new.edited_at is not null and new.created_at is not null and new.edited_at < new.created_at then
    new.edited_at := new.created_at;
  end if;

  return new;
end
$function$;

revoke all on function private.clamp_client_timestamp(timestamptz, timestamptz, interval)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_message_client_times()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_message_client_times on public.messages;
create trigger trg_guard_message_client_times
  before insert or update of client_sent_at, edited_at, content
  on public.messages
  for each row execute function private.guard_message_client_times();

do $$
declare
  v_now constant timestamptz := pg_catalog.now();
  v_min constant interval := interval '1 minute';
  v_trigger record;
  v_columns text[];
  v_ahead interval;
begin
  select t.tgenabled, t.tgtype, t.tgattr, p.oid::regprocedure::text as fn
    into v_trigger
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.messages'::regclass
     and t.tgname = 'trg_guard_message_client_times'
     and not t.tgisinternal;
  if not found then
    raise exception 'the client-time guard trigger is missing';
  end if;
  if v_trigger.tgenabled = 'D' then
    raise exception 'the client-time guard trigger is disabled';
  end if;
  if (v_trigger.tgtype & 1) = 0 or (v_trigger.tgtype & 2) = 0
     or (v_trigger.tgtype & 4) = 0 or (v_trigger.tgtype & 16) = 0 then
    raise exception 'the client-time guard must be a BEFORE INSERT OR UPDATE row trigger (tgtype %)', v_trigger.tgtype;
  end if;
  select pg_catalog.array_agg(a.attname::text order by a.attname)
    into v_columns
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.messages'::regclass
     and a.attnum = any (v_trigger.tgattr::smallint[]);
  if v_columns is distinct from array['client_sent_at', 'content', 'edited_at'] then
    raise exception 'the client-time guard fires for columns % instead', v_columns;
  end if;

  -- The rule itself.
  if private.clamp_client_timestamp(v_now - interval '2 days', v_now, v_min)
       is distinct from v_now - interval '2 days' then
    raise exception 'an offline queue''s old timestamp was moved; it must be kept';
  end if;
  if private.clamp_client_timestamp(v_now + interval '10 milliseconds', v_now, v_min)
       is distinct from v_now + interval '10 milliseconds' then
    raise exception 'a ten-millisecond batch offset was clamped; nextClientSentAt would lose the pick order';
  end if;
  if private.clamp_client_timestamp(v_now + interval '30 seconds', v_now, v_min)
       is distinct from v_now + interval '30 seconds' then
    raise exception 'ordinary clock skew was clamped';
  end if;
  if private.clamp_client_timestamp(v_now + interval '10 years', v_now, v_min) is distinct from v_now then
    raise exception 'a timestamp ten years ahead was not brought back';
  end if;
  if private.clamp_client_timestamp(null, v_now, v_min) is not null then
    raise exception 'a null timestamp was given a value';
  end if;

  -- The tolerance must cover everything the product has actually written.
  select max(client_sent_at - created_at)
    into v_ahead
    from public.messages
   where client_sent_at is not null and client_sent_at > created_at;
  if v_ahead is not null and v_ahead > v_min then
    raise exception
      'a stored client_sent_at is % ahead of its own created_at, past the % tolerance: the tolerance is too small',
      v_ahead, v_min;
  end if;

  if pg_catalog.has_function_privilege('authenticated', 'private.guard_message_client_times()', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'private.guard_message_client_times()', 'EXECUTE') then
    raise exception 'the guard function is executable by an API role';
  end if;
end
$$;

commit;
```

### 5.2 `edited_at`

D-177 item 8: it is set by the client in the same PATCH as the content
(`useMessages.ts:1220-1223`), nothing requires it, and there is no edit-window
rule at all. The trigger above handles it in the same pass: a client value is
clamped like any other, it can never precede `created_at`, and an edit that
changes the text always stamps one.

**The half worth separating.** The stamp — `new.edited_at := v_now` when
`content` changed — is a behaviour change, not only hardening: any server-side
path that rewrites a message's text would start showing «Изменено»
(`MessageBubble.tsx:1024`, `MessageActionLayer.tsx:562`). I looked for such a
path and found none: `delete_messages_for_everyone` writes `deleted_at` only
(`20260911143000:191-195`) and the guard skips a row whose `deleted_at` changed;
`forward_message` inserts rather than updates; `clear_chat_for_me` hides rather
than edits. If a reviewer finds one, drop the four lines from
`if tg_op = 'UPDATE'` to the matching `end if;` and keep the clamp — the clamp
alone is pure hardening.

**No edit window is proposed.** "Fifteen minutes to edit" is a product decision
with visible consequences, not hardening, and it is not mine to choose.

### 5.3 Rollback

```sql
begin;
set local lock_timeout = '5s';
drop trigger if exists trg_guard_message_client_times on public.messages;
drop function if exists private.guard_message_client_times();
drop function if exists private.clamp_client_timestamp(timestamptz, timestamptz, interval);
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.messages'::regclass
       and tgname = 'trg_guard_message_client_times'
  ) or pg_catalog.to_regprocedure('private.guard_message_client_times()') is not null then
    raise exception 'rollback incomplete: the client-time guard is still present';
  end if;
end $$;
commit;
```

### 5.4 What would break

| Writer | Where | Effect |
| --- | --- | --- |
| A single message send | `useMessages.ts:1405` — `new Date().toISOString()` | none; inside the tolerance |
| A multi-attachment send | `ChatWindow.tsx:720-734` → `nextClientSentAt` (`attachmentSendQueue.ts:161-165`) | none; up to ~10 ms ahead, the tolerance is 60,000 ms |
| A resend of a failed message | `useMessages.ts:1201` — reuses `client_sent_at ?? created_at` | none; a past value is kept |
| An edit | `useMessages.ts:1220-1223` | the client's own `edited_at` is used unless it is more than a minute ahead; if a future build omits it, the server stamps one |
| Delete for everyone | `20260911143000:191-195` | none; `content` unchanged, and `deleted_at` changing skips the stamp |
| A forward | `20260911144000:161-165` (INSERT) | none; `p_client_sent_at` passes through the clamp unchanged |

### 5.5 Verification after applying

```sql
-- 1. The trigger is present, enabled, and on the three columns.
select t.tgname, t.tgenabled, p.oid::regprocedure::text as fn,
       (select array_agg(a.attname order by a.attname)
          from pg_attribute a
         where a.attrelid = 'public.messages'::regclass
           and a.attnum = any (t.tgattr::smallint[])) as columns
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
 where t.tgrelid = 'public.messages'::regclass and not t.tgisinternal
   and t.tgname in ('trg_guard_message_client_times', 'trg_guard_message_media_path');

-- 2. No new row is written more than a minute ahead of its own created_at.
select count(*) as ahead_by_more_than_a_minute
  from public.messages
 where created_at > now() - interval '1 day'
   and client_sent_at > created_at + interval '1 minute';
-- expect: 0

-- 3. Pick order survives a ten-attachment send: send one, then
select id, client_sent_at, created_at
  from public.messages
 where chat_id = '<the test chat>'
   and created_at > now() - interval '5 minutes'
 order by client_sent_at, created_at;
-- expect: ten distinct, strictly increasing client_sent_at values in pick order

-- 4. No edited_at precedes its own created_at, and none is in the future.
select count(*) from public.messages
 where edited_at is not null and (edited_at < created_at or edited_at > now() + interval '1 minute');
-- expect: 0
```

---

## 6. The items left open, and why

| D-177 item | Status | Why |
| --- | --- | --- |
| 5 — ten attachments per send | **open** | `MAX_STAGED_ATTACHMENTS` (`stagedAttachments.ts:93`) is a composer limit. Enforcing it server-side means counting inserts per `client_message_id` batch, which the schema does not group; and the cost of exceeding it is n ordinary messages, each of which the rate limits and the insert policy already govern. Not worth a trigger. |
| 6 — location stripping | **open, needs a decision** | `removeLocation` runs in the browser only (`ChatWindow.tsx:406`, `lib/mediaLocation.ts:80`). Enforcing it means the server reading every uploaded byte — EXIF GPS, XMP, QuickTime location boxes — before the object is visible. That is an architecture change with a real cost, and D-177 says so itself (`:8939-8940`). It is also, as the register notes, the item on the list that is a **privacy guarantee with no server enforcement anywhere**; it should be the next decision asked of the owner, not the next migration. |
| 9, 10 — `uncompressed`, `optimized`, `original_size_bytes`, `original_mime_type`, `media_quality` truth | **open by design** | Assertions about bytes the database does not read. Section 4.2. The *shape* half is closed by section 4; the *truth* half needs the same byte-reading as item 6, and should be decided with it. |
| 11 — a resumable upload reports its own destination | **open, client fix** | `resumableStorageUpload.ts:183-187` resolves with `options.objectName`, the name the client intended, rather than anything the tus server confirmed; the plain branch uses the path the server returned (`ChatWindow.tsx:581`). No database change reaches this. The fix is to read the object's real name back from the tus `Location` header, in the client. Section 3's trigger makes a wrong name fail loudly instead of silently, which is a partial mitigation, not the fix. |
| 4 — MIME | **recommended open** | Section 2. |

---

## 7. Order of application, and what each step costs

1. **0.1** — read-only, no lock, any time. **Mandatory.**
2. **Section 1** (bucket size limit) — one `UPDATE` of one row in
   `storage.buckets`. No user-visible change on the day it is applied.
3. **Section 4** (`media_metadata` shape) — `NOT VALID` then `VALIDATE`, so the
   `ACCESS EXCLUSIVE` lock is held for the catalogue change only. Apply in a
   quiet window regardless.
4. **Section 3** (`media_path` guard) — `CREATE TRIGGER` takes
   `SHARE ROW EXCLUSIVE` on `public.messages`, which every send writes;
   `lock_timeout = '5s'` makes it fail rather than queue sends behind it. Retry
   in a quiet window if it times out.
5. **Section 5** (timestamps) — same lock, same treatment.
6. **Section 3b** only if 0.1(g) returned 0.
7. **Section 2** only if the owner directs it, after reading 0.1(c) and 0.1(d).

Before any of it, per `CLAUDE.md` section 10: confirm the exact target database,
take and verify a fresh schema backup, and record its path, byte count and
SHA-256 in the migration header the way
`20260911120000_private_chat_owner_delete_repair.sql:31-36` and
`20260911130000_revoke_unfiltered_table_privileges.sql:52-57` do. Two of the
2026-09-05 repairs had to be applied as `supabase_admin` rather than `postgres`
because `postgres` did not own the function involved; `storage.buckets` and
`storage.objects` are owned by `supabase_storage_admin` on a Supabase
deployment, so **section 1 and section 2 will most likely need
`supabase_admin`**, while sections 3, 4 and 5 need the owner of
`public.messages` (`postgres` here). Verify the ownership before assuming either.

## 8. Sources

Everything above is cited inline. The files read to write it:

- `docs/INTERFACE_DEFECT_REGISTER.md:8885-8944` (D-177), `:6392-6437` (D-113)
- `.migration-backup/supabase/migrations/20260505_media_storage_path_policies.sql`
- `.migration-backup/supabase/migrations/20260506_secure_chat_media_access.sql`
- `.migration-backup/supabase/migrations/20260523_message_media_metadata.sql`
- `.migration-backup/supabase/migrations/20260905150000_media_path_uuid_pattern_repair.sql`
- `.migration-backup/supabase/migrations/20260905140000_bot_avatar_policy_repair.sql`
- `.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql:759-767, 4205-4208`
- `.migration-backup/supabase/migrations/20260911120000_private_chat_owner_delete_repair.sql` (structure)
- `.migration-backup/supabase/migrations/20260911130000_revoke_unfiltered_table_privileges.sql` (structure)
- `.migration-backup/supabase/migrations/20260911140000_chat_read_marks_forward_only.sql` (+ rollback; the clamp and self-check shape)
- `.migration-backup/supabase/migrations/20260911143000_delete_messages_for_everyone.sql`
- `.migration-backup/supabase/migrations/20260911144000_forward_message_with_media.sql`
- `artifacts/kub/src/lib/` — `stagedAttachments.ts`, `mediaCompression.ts`,
  `mediaUpload.ts`, `mediaQuality.ts`, `mediaLocation.ts`, `videoTranscode.ts`,
  `resumableStorageUpload.ts`, `uploadFailure.ts`, `attachSheet.ts`,
  `attachmentSendQueue.ts`, `botAvatar.ts`
- `artifacts/kub/src/components/chat/` — `ChatWindow.tsx`, `ChatInfoPanel.tsx`,
  `VideoMessageRecorderModal.tsx`, `CameraCaptureModal.tsx`, `MessageBubble.tsx`
- `artifacts/kub/src/hooks/` — `useMessages.ts`, `useVoiceRecorder.ts`
- `artifacts/kub/src/components/settings/SettingsScreen.tsx`,
  `artifacts/kub/src/pages/admin/UsersTab.tsx`
- `artifacts/api-server/src/workers/mediaVariantsWorker.ts`,
  `artifacts/api-server/src/workers/mediaVariantRules.ts`
