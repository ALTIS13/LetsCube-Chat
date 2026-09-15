# The `storage` schema

A survey, not a repair. Nothing in this pass edits a source file, and nothing in
it writes to production.

Date: 2026-09-15. Branch `integration/message-actions`, worktree
`.worktrees/bot-platform`. Every database fact below was read off the live
Postgres behind `core.letscube.ru` on that date, not inferred from a migration
file — migrations say what somebody meant to apply, and this area has already
paid twice for the difference
(`20260905140000_bot_avatar_policy_repair.sql`,
`20260905150000_media_path_uuid_pattern_repair.sql`).

## Why this area, and what kind of mistake it makes

The 2026-09-04 outage is the reference case. A migration about *bot avatars*
added four `storage.objects` policies calling a function, revoked that
function's EXECUTE from `public` and `anon`, and granted it to nobody.
`authenticated` held it only by inheritance from PUBLIC and lost it too. For
24 hours **every client upload in the product failed** — message media, profile
avatars, chat avatars, TUS uploads — none of which involves a bot.

Two lessons shape this audit:

1. **A predicate is only as reachable as its EXECUTE grant.** A policy calling a
   function the caller may not execute does not evaluate to false; it raises,
   and an OR-ed policy set cannot short-circuit past a permission error. So
   §"who holds EXECUTE" is asked of every function, and the one gap found is
   proved harmless rather than assumed harmless.
2. **A guard that matches nothing looks exactly like a guard that works.**
   `_kub_media_path_allowed` carried a UUID pattern of 8-4-4-12 where a UUID is
   8-4-4-4-12, so two of its branches had never once been reachable. So every
   pattern here is checked against the paths the client really writes *and*
   against the objects really stored.

## How it was measured

All reads were issued through one pipe, as `postgres`, with no psqlrc:

    ssh -i "C:/Users/maksi/.ssh/letscube_ed25519" root@ms.letscube.ru
      'docker exec -i supabase-db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1' < query.sql

Structure came from `pg_policies`, `pg_proc`, `pg_class`, `pg_trigger`,
`pg_roles`, `pg_default_acl`, `information_schema.role_table_grants` and the
`has_*_privilege` family. Population came from `count` and `group by` over
`storage.objects` — counts, shapes, MIME types and byte totals only.

**No object path, file name, account id, phone number, email or media content
was printed, copied or stored at any point.** Where a probe needed a real path
it was held in a shell variable and never echoed; the reports below quote its
*length* and its *shape*, never its value.

**Behavioural probes were run inside `begin; ... rollback;`**, impersonating a
real account with `set local role authenticated` plus a `request.jwt.claims`
carrying that account's `sub`. A policy measured as its own table's owner is not
measured at all, which is why the impersonation was necessary — `postgres` here
carries `rolbypassrls`, so as `postgres` every policy in this schema is
invisible. Each probe below is quoted under its finding. After the write probes,
a post-rollback count proved nothing was left behind: `storage.objects` 771 rows,
rows matching the probe marker **0**.

Sixteen HTTP probes were issued against the public storage endpoint with no
credentials. They are reads of bytes the internet can already fetch; every
response body was discarded (`curl -o /dev/null`) and only status, byte count
and content type were recorded. Each set opens with a control against an
invented path, because a probe that returns 200 for everything proves nothing.

**Where a probe returned nothing, it was treated as unknown until proved
otherwise.** Two probes in this pass initially returned empty — one because
`docker exec -i` inside a remote script drains the script itself from stdin, one
because a classifier's `like 'max-age=%'` matched the *correct* value as well as
the malformed one. Both are noted where they affected a result.

## The shape of this deployment

Read on 2026-09-15, because every judgement below about "how many people this
costs" rests on it.

| fact | value |
|---|---|
| buckets | 2 |
| objects | 771, all of them in one bucket |
| bytes stored | 591 MB |
| tables in `storage` | 10, all with RLS enabled, none forced |
| views in `storage` | 0 |
| policies in `storage` | 10, all on `objects`, all PERMISSIVE, 0 RESTRICTIVE |
| policies on `storage.buckets` | **0** |
| distinct accounts owning an object | 16 |

---

# The inventory

## 1. Every bucket

| | `media` | `chat-media` |
|---|---|---|
| public | **yes** | no |
| size limit | 262 144 000 (250 MB) | 104 857 600 (100 MB) |
| MIME allowlist | **none** | 10 types |
| objects | **771** | **0** |
| bytes | 591 MB | 0 |
| first / last object | 2026-04-10 / 2026-09-12 | — |

`chat-media` is the bucket somebody configured for this job: private, capped at
100 MB, restricted to ten media types. It holds nothing. `media` is the bucket
the product actually uses — `CHAT_MEDIA_BUCKET = "media"` in
`artifacts/kub/src/lib/stagedAttachments.ts:92` — and it is public, 250 MB, and
accepts any type at all. That inversion is F-1, F-5 and F-7 below.

Contents of `media`, by shape. Path values are never shown; `{uuid}` marks a
segment measured to be a canonical five-group UUID.

| shape | objects | what writes it |
|---|---|---|
| `{sender_id}/{chat_id}-{attachment_id}.{ext}` | 305 | message media, voice, video, files |
| `variants/messages/{chat_id}/{message_id}/{kind}` | 410 | the variants worker |
| `variants/profiles/{user_id}/{kind}.webp` | 20 | the variants worker |
| `variants/chats/{chat_id}/{token}/{kind}.webp` | 6 | the variants worker |
| `avatars/{user_id}/avatar-{uuid}.{ext}` | 19 | own avatar, and an administrator's replacement |
| `chat-avatars/{chat_id}/avatar-{uuid}.{ext}` | 8 | group and channel pictures |
| `avatars/<name>` and `chat-avatars/<name>`, no folder level | 3 | legacy, 2026-04-10…2026-05-11 (see C-5) |
| `bot-avatars/{bot_id}/…` | **0** | nothing yet (see C-3) |

One reconciliation, because two of my own counts disagreed and the gap turned
out to be real: there are **436 objects** under `variants/` but **446 rows** in
`public.media_variants`. The ten-row difference is B-4.

MIME types present in the public bucket: `image/webp` 460, `image/png` 79,
`audio/webm` 67, `image/jpeg` 64, `video/mp4` 52, `image/gif` 25, `video/webm`
11, `audio/wav` 5, `video/quicktime` 4, and — one each —
`application/vnd.android.package-archive`, `application/x-msdownload`,
`application/pdf`, `application/octet-stream`. The last four sit in an account's
own folder with `owner_id` set, i.e. a person uploaded them, not a service. That
is F-5.

## 2. Every policy, and who it admits

Ten policies, all on `storage.objects`, all `PERMISSIVE`, all `TO authenticated`.
`storage.buckets` carries **none** (see C-6).

| policy | cmd | predicate | who it admits | fits the bucket? |
|---|---|---|---|---|
| `media authenticated scoped read` | SELECT | `bucket_id='media' AND _kub_media_path_allowed(name)` | a signed-in account, for its own folder, its own avatar, an avatar it administers, or anyone's avatar if it holds `users.manage`/`media.moderate`/`system.manage` | yes for the API path — but see F-1: this is not the route the bytes are served on |
| `media authenticated scoped insert` | INSERT | same, as `WITH CHECK` | as above | yes, except that nothing bounds type or size (F-5) |
| `media authenticated scoped update` | UPDATE | same, both sides | as above | yes |
| `media authenticated scoped delete` | DELETE | same | as above | yes |
| `media bot avatars owner read/insert/update/delete` | each | `bucket_id='media' AND _kub_bot_avatar_path_allowed(name)` | the `owner`-role holder of that exact bot | yes |
| `chat media members can read` | SELECT | `bucket_id='chat-media' AND _kub_can_access_chat_media_path(name)` | a member of the chat named by the first path segment, who is not banned | yes — and it is the only predicate here that checks a ban (F-4) |
| `chat media members can upload` | INSERT | same, as `WITH CHECK` | as above | yes |

Two structural gaps in that table. `chat-media` has **no UPDATE and no DELETE
policy at all**, so were it ever switched on, an uploader could not replace or
remove their own file. And no policy anywhere in `storage` is `RESTRICTIVE`,
which is how F-4 happens.

## 3. Every function those policies call

| function | owner | secdef | search_path | `anon` | `authenticated` | `service_role` |
|---|---|---|---|---|---|---|
| `public._kub_media_path_allowed(text)` | postgres | yes | `public, storage` | no | **yes** | yes |
| `public._kub_bot_avatar_path_allowed(text)` | supabase_admin | yes | `public, storage` | no | **yes** | **no** |
| `public._kub_can_access_chat_media_path(text)` | postgres | yes | `public, storage` | no | **yes** | yes |
| `public._kub_chat_media_chat_id(text)` | postgres | yes | `public, storage` | — nested — | | |
| `public.is_banned(uuid)`, `has_global_role`, `has_permission`, `is_chat_admin` | postgres | yes | `public` | — nested — | | |
| `storage.foldername/filename/extension` | supabase_storage_admin | **no** | none pinned | yes | yes | yes |

**The 2026-09-04 question — who actually holds EXECUTE — is answered and clean
for the role that matters.** `authenticated` holds EXECUTE on all three policy
predicates. The one gap, `service_role` on `_kub_bot_avatar_path_allowed`, was
proved harmless by measurement rather than by reasoning; see C-2.

Nested calls cannot reintroduce the outage: all four `_kub_*` predicates are
SECURITY DEFINER, so their inner calls run as the definer (`postgres` /
`supabase_admin`), both of which hold EXECUTE on every function they reach.

## 4. Grants on `storage.*`

    select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type)
    from information_schema.role_table_grants
    where table_schema='storage' and grantee in ('anon','authenticated','service_role')
    group by table_name, grantee;

| table | `anon` | `authenticated` | `service_role` |
|---|---|---|---|
| `objects` | **all seven** | **all seven** | all seven |
| `buckets` | **all seven** | **all seven** | all seven |
| `buckets_analytics` | **all seven** | **all seven** | all seven |
| `buckets_vectors`, `vector_indexes` | SELECT | SELECT | SELECT |
| `iceberg_namespaces`, `iceberg_tables` | SELECT | SELECT | all seven |
| `s3_multipart_uploads`, `…_parts` | SELECT | SELECT | all seven |

"All seven" is `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES`.
The last three are the ones RLS never filters. That is F-6.

Schema `USAGE` on `storage` is held by `anon`, `authenticated` and
`service_role` — expected, and required for the API to work.

## 5. Path-shape guards versus what the client writes

The five shapes the client produces, each traced to the branch that admits it:

| client call site | path written | admitted by |
|---|---|---|
| `stagedAttachments.ts:241` `chatAttachmentUploadPath` | `{userId}/{chatId}-{attachmentId}.{ext}` | branch 1, `v_first = auth.uid()` |
| `mediaCompression.ts:246` `originalPreviewPath` | same folder, `.preview.webp` | branch 1 |
| `mediaUpload.ts:204` `avatarUploadPath("user", …)` | `avatars/{userId}/avatar-{uuid}.{ext}` | branch 2 (own) or branch 3 (administrator) |
| `mediaUpload.ts:204` `avatarUploadPath("chat", …)` | `chat-avatars/{chatId}/avatar-{uuid}.{ext}` | branch 4, `is_chat_admin` |
| `mediaUpload.ts:204` `avatarUploadPath("bot", …)` | `bot-avatars/{botId}/avatar-{uuid}.{ext}` | `_kub_bot_avatar_path_allowed` |

All four live predicates carry the correct five-group pattern
`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`. Measured
against real data rather than read: of the 19 `avatars/{uuid}/…` and 8
`chat-avatars/{uuid}/…` objects stored, **27 of 27 match the five-group pattern
and 0 of 27 match the old four-group one**. The 2026-09-05 repair is live and
the two branches it unblocked are reachable — C-1 proves the `chat-avatars`
branch behaviourally.

One subtlety worth recording, because it is how three objects became
unreachable: `storage.foldername` returns the path **minus its last segment**,
so a path with no folder level yields `v_parts[1] = NULL` and matches no branch.
See C-5.

---

# Part A — Confirmed findings

Ranked by what a person actually loses. Every entry was measured, and the
measurement is quoted.

---

## F-1 `[confirmed]` Every photo, voice message and video in the product is readable by anyone on the internet who has the URL, and there is no way to withdraw one

**Severity: highest.** It is the whole media corpus, it includes the owner's own
data, and nothing in the product can revoke a single byte of it.

**The object.** `storage.buckets` where `id = 'media'`: `public = true`. 771
objects, 591 MB — every object the product has.

**What is actually wrong.** Supabase serves a public bucket from
`/storage/v1/object/public/<bucket>/<path>` **without authentication and without
consulting RLS at all**. The ten policies on `storage.objects` govern the
PostgREST/authenticated route; they do not govern the route the bytes come out
of. So the careful predicate work in `_kub_media_path_allowed` — which, measured
below, genuinely does confine one account to its own folder — is not what stands
between one person's media and another's.

**How it was measured.** With no credentials of any kind, from the server, body
discarded. The control comes first, because a probe that returns 200 for
everything proves nothing:

    CONTROL: a path that does not exist must NOT return 200
      public endpoint, invented path       -> 400  69 bytes  application/json
      public endpoint, invented bucket     -> 400  76 bytes  application/json

    NO CREDENTIALS AT ALL, public endpoint, real objects
      a chat photo                         -> 200  144356 bytes  image/webp
      a voice message                      -> 200  796303 bytes  audio/webm
      a profile avatar                     -> 200  12838 bytes   image/webp
      a worker-generated variant           -> 200  5666 bytes    image/webp
      a user-uploaded executable           -> 200  6769308 bytes application/vnd.android.package-archive

There is no second, protected URL shape to fall back on. The *authenticated*
endpoint serves the same object to a caller carrying no token:

      authenticated endpoint, chat photo   -> 200  144356 bytes  image/webp

Response headers on a public object:

      access-control-allow-origin: *
      cache-control: max-age=max-age=31536000, immutable

**One thing this is not.** The bucket is not enumerable anonymously, so an
outsider needs the path:

      POST /object/list/media, no auth -> 400
      GET  /bucket, no auth            -> 400

**The observable consequence for a person.** Someone sends a photo in a private
conversation. Its URL is a permanent, credential-free address on the product's
own domain, cached by any intermediary, readable from any origin. If it is
forwarded, screenshotted out of a devtools panel, pasted into a support ticket,
or held by a member who is later removed from the chat, it stays fetchable
forever. Leaving the chat does not revoke it; deleting the message does not
revoke it (F-3); banning the account does not revoke it (F-4). The product has
no mechanism that can make a byte in this bucket stop being served, short of
deleting the object.

**Note on scope.** This is architectural, not an accident of one migration, and
the product depends on it as currently written — see B-2 before proposing that
the bucket simply be made private.

---

## F-2 `[confirmed]` A message's preview is at an address anyone who ever saw the chat can compute, which undoes the unguessability of the original

**Severity: high.** It converts "you need the exact URL" into "you need two ids
you already have", for everyone who was ever in the room.

**The objects.** 436 rows under `variants/`, written by the variants worker as
`service_role`. Their addresses come from
`artifacts/api-server/src/workers/mediaVariantRules.ts`:

```ts
// :239
return `variants/messages/${chatId}/${messageId}/${kind}.${normalizedExtension}`;
// :251
return `variants/profiles/${profileId}/${kind}.webp`;
```

**What is actually wrong.** The *original* is not guessable: its path is
`{userId}/{chatId}-{attachmentId}.{ext}` and `attachmentId` is a
`crypto.randomUUID()` (`stagedAttachments.ts:298`). Its *variants* are addressed
by `chat_id` + `message_id` + a kind from a tiny fixed list. Both ids are
ordinary API data held by every member of the chat. So the preview, thumbnail,
720p transcode and video poster of a message are all at derivable addresses in a
public bucket, while the original is not.

**How it was measured.** The whole enumeration, from `public.media_variants`:

    variant_kind  | objects
    --------------+--------
    avatar_128    |     13
    avatar_256    |     13
    image_preview |    176
    image_thumb   |    176
    video_720p    |     32
    video_poster  |     36

    message variants | distinct_chats | distinct_messages | distinct_leaf_names
    -----------------+----------------+-------------------+--------------------
                 420 |             21 |               212 |                   4

Four leaf names across 420 message variants. And fetched with no credentials:

      a derived variant path (5 segments, leaf image_preview.webp) -> 200  64918 bytes  image/webp

For profiles it is worse, because there is no per-upload segment at all — the
path is fully determined by the account id, and the entire leaf enumeration is
two names:

      distinct leaf names across all profile variants: 2
      the leaf names are: avatar_128.webp, avatar_256.webp
      public fetch, no credentials -> 200  5666 bytes  image/webp

**The observable consequence for a person.** A member of a group keeps the
message ids they saw — the client caches them, and any export contains them.
After they are removed from that group they can still fetch the preview of every
picture and the 720p transcode of every video in it, from any machine, signed
out, indefinitely. And for any account id they can name, two requests fetch that
person's profile picture with no session at all.

---

## F-3 `[confirmed]` Deleting a message does not delete its media, and the media stays publicly fetchable

**Severity: high.** The product offers an action whose visible promise it does
not keep.

**The objects.** 27 rows in `storage.objects` whose path is the `media_path` of
a `public.messages` row with `deleted_at` set.

    select count(*) from public.messages m
      join storage.objects o on o.name = m.media_path and o.bucket_id='media'
     where m.deleted_at is not null;

    deleted_messages_whose_object_still_exists
    ------------------------------------------
                                            27

**How it was measured.** The most recently deleted one was picked, its deletion
confirmed, and its object fetched with no credentials. The path was held in a
shell variable and not printed:

      picked a soft-deleted message's object (path length 115, not printed)
      deleted_at is set on that message: t
      public fetch, no credentials -> 200  210312 bytes  image/webp

**The wider retention picture.** 30 of the 771 objects are referenced by no live
row at all — 16 in account folders, 11 superseded avatars, 3 superseded chat
pictures, oldest 2026-04-10. The reference extraction was proved non-vacuous
first: 288 `messages.media_path` values match a real object.

**The observable consequence for a person.** Someone deletes a photo they
regret sending. The message disappears from every client. The photo is still at
its address, still served without credentials, still cached by whatever fetched
it. Nothing in the product will ever remove it.

---

## F-4 `[confirmed]` A ban does not reach the bucket the product actually uses

**Severity: medium.** Sanctions are enforced everywhere except the one bucket
that holds anything.

**The objects.** The eight `media` policies, and the four functions they reach.

**What is actually wrong.** `_kub_can_access_chat_media_path` ends with
`and not public.is_banned(auth.uid())` — and it guards `chat-media`, which holds
zero objects. `_kub_media_path_allowed`, which guards all 771, never consults a
ban, and neither does anything it calls.

**How it was measured.** The whole call graph, read from the deployed bodies:

    proname                         | calls_is_banned
    --------------------------------+----------------
    _kub_bot_avatar_path_allowed    | f
    _kub_can_access_chat_media_path | t
    _kub_media_path_allowed         | f
    has_global_role                 | f
    has_permission                  | f
    is_chat_admin                   | f

And no restrictive policy exists to add the check from outside:

    restrictive | permissive
    ------------+-----------
              0 |         10

That is the contrast worth naming: the 2026-09-11 security audit found every
"block banned" policy in `public` **restrictive**. `storage` has none of either
kind.

**Honest limit on this measurement.** This is proved from the complete predicate
source, not behaviourally. There are currently **0 unexpired rows in
`public.bans`**, and creating one to probe with would have fired
`trg_notify_bans_after_insert` and two audit triggers, so it was not done. The
static proof is nonetheless complete: the full body of every function in the
path contains no ban check, and there is no restrictive policy that could
impose one.

**The observable consequence for a person.** A banned account keeps read and
write access to its own storage folder and to the avatar paths it controls. It
cannot post a message, but it can still upload — which matters most when
combined with F-5.

---

## F-5 `[confirmed]` Any account can host an arbitrary file, up to 250 MB, at a permanent public URL on the product's own domain

**Severity: medium.** A trusted hostname is a phishing and malware asset, and
this hands one to every account.

**The object.** `storage.buckets` where `id = 'media'`: `allowed_mime_types` is
**NULL** and `file_size_limit` is 262 144 000, on a bucket with `public = true`.
The sibling bucket that nothing uses carries a ten-type allowlist and half the
cap.

**How it was measured.** It is not hypothetical; the bucket already holds them:

    shape                  | mime                                       | count | owner_null
    -----------------------+--------------------------------------------+-------+-----------
    <uuid = a user folder> | application/vnd.android.package-archive     |     1 | f
    <uuid = a user folder> | application/x-msdownload                    |     1 | f
    <uuid = a user folder> | application/pdf                             |     1 | f
    <uuid = a user folder> | application/octet-stream                    |     1 | f

`owner_null = f` means an account uploaded them, not a service. And the write
itself was probed directly — an ordinary, non-administrator account inserting
into its own folder is admitted with no constraint on what it is writing:

      media: own folder                         EXPECT admitted -> ADMITTED
      media: deep inside own folder             EXPECT admitted -> ADMITTED

Fetching one back with no credentials returns the bytes:

      a user-uploaded executable -> 200  6769308 bytes  application/vnd.android.package-archive

**The observable consequence.** Someone registers, uploads a signed-looking
installer, and distributes
`https://core.letscube.ru/storage/v1/object/public/media/…` — a link on the
product's own domain, served with `Access-Control-Allow-Origin: *`, cached for a
year, which no moderator action can take down and which survives the account
being banned (F-4).

---

## F-6 `[confirmed]` `anon` and `authenticated` hold TRUNCATE on `storage.objects`, which neither RLS nor the delete guard filters

**Severity: medium — hardening, not a live hole.** Stated plainly so it is not
read as an open door: this is **not reachable through PostgREST or pg_graphql**,
which is the same judgement `20260911130000_revoke_unfiltered_table_privileges.sql`
recorded when it made exactly this change for `public`. That migration covered
36 tables in `public` and **never touched `storage`.**

**The objects.** `storage.objects`, `storage.buckets`, `storage.buckets_analytics`.

    rolname       | tbl                       | truncate | trigger_priv | references_priv
    --------------+---------------------------+----------+--------------+----------------
    anon          | storage.objects           | t        | t            | t
    authenticated | storage.objects           | t        | t            | t
    anon          | storage.buckets           | t        | t            | t
    authenticated | storage.buckets           | t        | t            | t
    anon          | storage.buckets_analytics | t        | t            | t
    authenticated | storage.buckets_analytics | t        | t            | t

**Why TRUNCATE specifically.** Two independent mechanisms protect every other
write path on this table, and TRUNCATE is filtered by neither. RLS does not
apply to TRUNCATE. And `protect_objects_delete` — the trigger that refuses
direct SQL deletion — is `BEFORE DELETE ... FOR EACH STATEMENT`, and a
statement-level DELETE trigger **does not fire on TRUNCATE**. One statement
would empty the index for all 771 objects, leaving the bytes orphaned in the
backend with nothing pointing at them.

**And it would come back.** `postgres`'s default privileges in schema `storage`
re-grant the whole set on every new table:

    grantor  | schema  | objtype | acl
    ---------+---------+---------+------------------------------------------------
    postgres | storage | r       | {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
                                    authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

`D` in that ACL string is TRUNCATE. A revocation that does not also fix the
default privilege is undone by the next table created there — which is the
lesson the `public` migration already wrote down.

---

## F-7 `[confirmed]` The bucket configured for this job is empty, and its policies have never run in production

**Severity: low, but it is the reason F-1 and F-5 exist.**

**The objects.** `chat-media`: private, 100 MB, ten allowed MIME types, **0
objects**, created 2026-05-06. Its two policies are correct — measured, not
assumed:

      chat-media: a chat A IS a member of       EXPECT admitted -> ADMITTED
      chat-media: a chat A is NOT a member of   EXPECT refused  -> REFUSED (42501)

**What is actually wrong.** `artifacts/kub/src/lib/stagedAttachments.ts:92`:

```ts
export const CHAT_MEDIA_BUCKET = "media";
```

The constant is named for one bucket and points at the other. Every upload path
in the client — `ChatWindow.tsx:863`, `ChatInfoPanel.tsx:1058`,
`SettingsScreen.tsx:380`, `UsersTab.tsx:1136`, `botAvatar.ts:54` — writes to
`media`. `_kub_can_access_chat_media_path` keys on `{chat_id}` as the first path
segment, whereas the client writes `{sender_id}` first, so the two schemes are
not merely unused together, they are incompatible as written.

**Also.** `chat-media` has a SELECT and an INSERT policy and **no UPDATE or
DELETE policy at all**, so adopting it as-is would leave uploaders unable to
replace or remove their own files.

**The observable consequence.** The private, size-capped, type-restricted,
membership-scoped, ban-aware bucket exists and is correct, and every byte in the
product went into the public one instead.

---

# Part B — Suspicions, and things that are latent rather than live

Kept separate on purpose. Nothing here is established, and none of it should be
acted on as though it were.

## B-1 Four objects carry a malformed `cache-control`, and I cannot tell from the database whether the cause is still live

`artifacts/kub/src/lib/mediaCacheControl.ts` documents this exact mechanism
already: the storage service writes ``max-age=${cacheTime}`` itself, so a value
that is a directive rather than a number is pasted after its own prefix. The
current constants are plain seconds, so the code as it stands is right.

Stored values across all 771 objects:

    stored_cache_control                | objects | first_seen | last_seen
    ------------------------------------+---------+------------+-----------
    max-age=31536000, immutable         |     688 | 2026-04-10 | 2026-09-12
    max-age=31536000                    |      50 | 2026-09-06 | 2026-09-12
    max-age=2592000                     |      20 | 2026-06-22 | 2026-09-12
    max-age=3600                        |       8 | 2026-09-08 | 2026-09-12
    max-age=max-age=31536000, immutable |       4 | 2026-09-05 | 2026-09-12
    no-cache                            |       1 | 2026-09-08 | 2026-09-08

**Only 4 objects are truly malformed**, not the 186 my first pass reported — that
classifier tested `like 'max-age=%'`, which matches the correct value too. The
per-value table above is the authority; the classifier was wrong and is recorded
here so the wrong number does not get quoted later.

What I cannot settle: the newest malformed object is dated 2026-09-12, the same
day as the newest correct one. That is consistent with a transitional period
already fixed, and equally consistent with one upload route — the tus/resumable
branch, or the worker's binary branch — still passing a directive. Deciding it
needs an upload through each route with the header read back, which this pass did
not do. The 8 objects at `max-age=3600` (the service default, meaning no TTL was
sent) and the 1 at `no-cache` are unexplained for the same reason.

This is a performance matter, not a security one.

## B-2 Whether the public bucket is a decision or an inheritance

`artifacts/kub/src/lib/botAvatar.ts:15` states it as a choice — "The bucket is
public, so the recorded URL is a plain public object address — never a signed
one, which would expire and carry a credential." For a bot's picture that is
reasonable.

But the same bucket holds private conversation media, and the product **cannot
currently function without it being public**. Measured: user A, impersonated,
sees 58 rows of their own folder and **0** of user B's. There is no branch in
`_kub_media_path_allowed` that admits a *recipient* to a sender's file. So every
chat photo is displayed to its recipients only because the public route skips
RLS entirely. Making the bucket private without first adding a recipient branch,
or moving reads to signed URLs, would blank every image in every conversation.

Whether that was a weighed trade-off or a consequence nobody revisited cannot be
read from the database. Flagged as the decision to take before F-1 is "fixed",
not as a defect in itself.

## B-3 The direct-delete guard is self-service for the client role

`storage.protect_delete()` refuses direct SQL deletion unless
`storage.allow_delete_query` is `'true'`. That GUC is in an unreserved namespace,
and the client role can set it. Measured, impersonating an ordinary account:

      authenticated set storage.allow_delete_query to true, with no error
      A deleting ANOTHER users rows removed 0 rows   EXPECT 0
      A deleting its OWN rows removed 58 rows   control, EXPECT above 0

So the trigger is an accident guard, not a security boundary — RLS is what
actually held, and it held correctly. This matters only in combination with F-6,
and only if a route existed by which a client could issue arbitrary SQL. No such
route was found in this pass.

---

## B-4 Ten variant rows point at an object that does not exist, and the obvious explanation is wrong

Found only because two counts disagreed: 436 objects under `variants/`, 446 rows
in `public.media_variants`.

    variant_bucket | variant_rows | rows_with_an_object | rows_pointing_at_nothing
    ---------------+--------------+---------------------+-------------------------
    media          |          446 |                 436 |                       10

The reverse direction is clean — every object under `variants/` has a row, so
this is rows without objects, not objects without rows. The ten split evenly
across four kinds: `image_preview` 3, `image_thumb` 3, `video_720p` 2,
`video_poster` 2, i.e. five messages, each missing both of its variants.

Fetching one exactly as `useMediaVariants.ts:86` builds it, against a control:

      a dangling variant_path (length 108, not printed) -> 400  69 bytes  application/json
      a variant row that DOES have an object            -> 200  6718 bytes image/webp

**The obvious explanation is that these are residue of the 2026-09-04 outage.
I tested that and it is false.** The ten rows were written in a two-minute burst:

    first_utc                  | last_utc                   | rows
    ---------------------------+----------------------------+------
    2026-09-04 13:13:16.840568 | 2026-09-04 13:15:17.442962 |   10

The outage ran from 2026-09-04T14:54:14Z, about a hundred minutes *later*, and
inside the outage window there are **no variant rows at all** — 0 succeeded and
0 failed. So the worker was not writing during the outage, and these predate it.
The cause is not established.

**No one can see this today**, which is why it is here and not in Part A: all
five affected messages have `deleted_at` set, so nothing renders them. The
latent shape is worth recording anyway — `useMediaVariants` derives a public URL
from `variant_path` without checking that the object exists, so the same residue
against a live message would put a 400 where a picture goes.

# Part C — Checked, and found sound

Recorded so the next person does not re-do it.

## C-1 RLS on `storage.objects` genuinely confines an account, on the API route

Measured under impersonation, not as the table owner. `postgres` here carries
`rolbypassrls`, so measuring as `postgres` would have shown nothing. Probe user
A was verified to be an ordinary account first — `has_permission(A,'system.manage')`
false, `has_global_role(A,'owner')` false — and to genuinely own objects.

Controls first: `postgres` sees all 771; `anon`, carrying no JWT, sees **0
objects and 0 buckets**; the identical query as `authenticated` returns 62, so
the zero is a refusal and not a broken probe.

    total_rows_a_can_see | own_folder | another_users_folder | variants_prefix | avatars | chat-avatars
    ---------------------+------------+----------------------+-----------------+---------+-------------
                      62 |         58 |                    0 |               0 |       3 |            1

Eleven write probes, every one meeting its expectation:

      media: own folder                         EXPECT admitted -> ADMITTED
      media: deep inside own folder             EXPECT admitted -> ADMITTED
      media: ANOTHER users folder               EXPECT refused  -> REFUSED (42501)
      media: under variants/                    EXPECT refused  -> REFUSED (42501)
      media: own avatar                         EXPECT admitted -> ADMITTED
      media: ANOTHER users avatar               EXPECT refused  -> REFUSED (42501)
      media: avatar of a chat A is not in       EXPECT refused  -> REFUSED (42501)
      media: bot avatar A does not own          EXPECT refused  -> REFUSED (42501)
      media: bucket root, no folder             EXPECT refused  -> REFUSED (42501)
      chat-media: a chat A IS a member of       EXPECT admitted -> ADMITTED
      chat-media: a chat A is NOT a member of   EXPECT refused  -> REFUSED (42501)

UPDATE and DELETE are confined the same way (0 of another account's rows, 58 of
their own), and `anon`'s INSERT grant is filtered by RLS to a refusal (42501).
Post-rollback: 771 objects, **0** probe rows left.

**So the answer to "can one person read another's private media by guessing a
path" is: not through the API — only through the public route, which is F-1, and
by derivation, which is F-2.**

Note the third line of the table: `another_users_folder` is 0, but so is
`variants_prefix`. No authenticated account can read a variant row at all. The
app reads variants through `getPublicUrl` (`useMediaVariants.ts:86`), which is
another place the product depends on F-1.

## C-2 The 2026-09-04 outage cannot recur in its original form, and the one remaining EXECUTE gap was proved harmless rather than assumed

`authenticated` holds EXECUTE on all three policy predicates. `service_role`
lacks it on `_kub_bot_avatar_path_allowed` only — the same shape as the bug —
so it was measured rather than reasoned about:

    service_role_may_execute | storage_admin_may_execute | service_role_bypasses_rls | rls_forced_on_owner
    -------------------------+---------------------------+---------------------------+--------------------
    f                        | f                         | t                         | f

    service_role INSERT on a bot-avatar path -> ADMITTED (predicate never evaluated)
    authenticated INSERT -> REFUSED (42501), which is the predicate doing its job

`service_role` carries `rolbypassrls`, so the policy is never evaluated for it
and the missing grant cannot raise. `supabase_storage_admin` also lacks EXECUTE
and also never evaluates these policies, being the table's owner with
`relforcerowsecurity = false`. The control proves the predicate *is* evaluated
for `authenticated`, so the probe is not vacuous.

## C-3 The bot-avatar policy set is correct, and has never had a real object to act on

`bot-avatars/` holds **0 objects**. The four policies are `TO authenticated`,
their predicate is reachable, and a non-owner is refused (42501, probe above).
Recorded because "it works" here rests on a probe, not on production traffic.

## C-4 `search_path` on the predicates — a linter will flag this, and it is not exploitable

All four `_kub_*` predicates pin `search_path = public, storage`. **None appends
`pg_temp`**, which automated hardening advice flags, because the temporary
schema is searched first for relation names and a caller could shadow a table.

It does not bite here: every relation reference in all four bodies is
schema-qualified — `public.profiles`, `public.bot_owners`, `public.chat_members`,
`public.bans`, `storage.foldername` — and `pg_temp` is never searched for
function or operator names. Recorded so the finding is not re-filed as real.

## C-5 Three legacy objects are unreachable by every authenticated caller, and this is not a hole

2 objects at `avatars/<name>` and 1 at `chat-avatars/<name>` have no folder
level. `storage.foldername` returns the path minus its last segment, so for
these `v_parts[2]` is NULL, `coalesce(NULL,'') ~* uuid_re` is false, and no
branch admits them. They date from 2026-04-10…2026-05-11. They fail closed on
the API route and are reachable only by public URL, like everything else (F-1).

## C-6 `storage.buckets` fails closed despite broad grants

RLS is enabled and there are **zero policies**, so despite `anon` and
`authenticated` holding SELECT/INSERT/UPDATE/DELETE, both see nothing. Measured:
`anon_sees_buckets` 0, `buckets_a_can_see` 0. A client calling `listBuckets()`
gets an empty list, which is the correct outcome. The grants themselves are
still over-broad — that is F-6, and it is about TRUNCATE, not about SELECT.

## C-7 The `storage` schema's own functions carry no privilege

17 functions, **0 of them SECURITY DEFINER**, all executable by `anon`. These
are the stock Supabase helpers (`foldername`, `filename`, `extension`, …); none
is a privilege boundary, and none is called by a policy in a way that could be
subverted. All 10 relations in `storage` are tables with RLS enabled; there are
**no views**, so the `security_invoker` question does not arise here.

## C-8 The UUID-pattern repair is live and its two branches are reachable

Covered in the inventory §5: 27 of 27 stored avatar and chat-avatar objects
match the five-group pattern, 0 match the old four-group one. Behaviourally, the
`chat-avatars` branch — dead before 2026-09-05 — now returns true: probe user A,
an ordinary account, sees exactly 1 `chat-avatars` row, for a chat they
administer.

## C-9 Triggers on `storage` tables have no external side effects

Four non-internal triggers: two `protect_delete`, one `enforce_bucket_name_length`,
one `update_updated_at_column`. All are pure SQL, none performs I/O, which is why
the rolled-back write probes above were safe to run.

---

# Part D — What this survey did not cover

Named plainly, so the gaps are not mistaken for clean results.

1. **The storage service's own authorization.** Everything here measures the
   database. `storage-api`'s configuration, its JWT verification, and whether
   `render/image`, `tus` or the S3 routes apply rules of their own were not
   read. F-1 is the observed behaviour of the public endpoint, not a reading of
   the service's code.
2. **The resumable (TUS) upload path end to end.** Grants and RLS on
   `s3_multipart_uploads` and `…_parts` were checked, but no resumable upload was
   performed, so it is not verified that TUS applies the same predicate as a
   plain upload. The 2026-09-04 logs show `storage.tus.upload.create` failing
   alongside plain uploads, which suggests it does — that is an inference, not a
   measurement.
3. **Whether the cause of B-1 is still live.** Settling it needs an upload
   through each of the three routes with the stored header read back.
4. **F-4 behaviourally.** Proved from complete predicate source; not probed with
   a real banned account, because none exists and creating one would have fired
   notification and audit triggers.
5. **`owner` / `owner_id` on `storage.objects`.** 335 of 771 rows carry one; the
   436 under `variants/` do not. No policy reads either column. Why it is
   populated inconsistently was not chased.
6. **Backups and retention of the bucket's bytes**, and whether an object
   deleted from the index is ever removed from the backend.
7. **The contents of the 30 unreferenced objects and the 27 whose message is
   deleted.** Deliberately not examined — no pixels, no file names.
8. **The variants worker's and the Bot Gateway's storage credentials.** It was
   confirmed the worker writes as a role that bypasses RLS; how that key is held
   and scoped was not audited.
9. **`buckets_analytics`, `buckets_vectors`, `iceberg_*`, `vector_indexes`.**
   RLS on, no policies, so they fail closed, and this product does not use them.
   Whether the storage service would ever create rows there was not checked.
10. **What wrote the ten dangling variant rows of B-4.** The outage explanation
    was tested and refuted; no replacement was found. It would need the worker's
    logs for 2026-09-04 13:13–13:15 UTC, which this pass did not read.

---

## If only three things are done

1. **F-3 and F-2 are the cheapest real wins.** Deleting a message should delete
   its object and its variants; and `variants/messages/…` should carry a
   per-upload token the way `variants/chats/…` already does via
   `avatarPathToken`, so a preview is no more guessable than its original.
2. **F-5 is a one-line configuration change** — an `allowed_mime_types` on
   `media`, and a smaller cap — and it closes the file-hosting surface without
   touching any policy.
3. **F-6 is the migration that already exists**, applied to a schema it missed:
   revoke TRUNCATE, TRIGGER and REFERENCES from `anon` and `authenticated` on
   the three `storage` tables, and fix the default privilege that would re-grant
   them.

F-1 is the largest finding and the one not to rush: read B-2 first, because the
product currently depends on the behaviour that makes it a finding.

---

# Appendix, 2026-09-15 — two corrections and a plan that can be executed

Added after the audit, by measuring the things a fix would depend on. Nothing
here changed the database or the product.

## Correction 1 — F-5's missing MIME allowlist is not a defect, and adding one would break a shipped feature

F-5 reads the absence of `allowed_mime_types` on `media` as a hole, and points
at the APK, the EXE and the PDF as evidence that «any account can host arbitrary
files». The first half is right about the *public* part. The second half is
wrong about the allowlist, and acting on it would break the product.

**Sending an arbitrary file is a feature.** `lib/attachSheet.ts:179` returns
`accept: null` for the document source, `messages.type` carries `'file'`, and
`messagePreview.ts:15` draws «Файл» for it. So those three objects are ordinary
attachments, not abuse.

**And `chat-media`'s allowlist — the one F-7 calls «configured properly» — is
itself incomplete for what this product accepts.** Measured against what the
public bucket actually holds:

| declared type | objects | in `chat-media`'s allowlist |
| --- | --- | --- |
| `image/webp`, `image/png`, `image/jpeg`, `image/gif` | 628 | yes |
| `video/mp4`, `video/webm` | 63 | yes |
| `audio/webm` | 67 | yes |
| **`video/quicktime`** | 4 | **no** |
| **`audio/wav`** | 5 | **no** |
| `application/pdf` | 1 | yes |
| `application/vnd.android.package-archive`, `application/x-msdownload`, `application/octet-stream` | 3 | no — and they are legitimate file attachments |

`video/quicktime` is what an iPhone sends. Copying that allowlist onto `media`
would refuse iPhone video uploads and every file attachment, which is a worse
outcome than the finding it was meant to close.

**So F-5 collapses into F-1.** The problem is that the bucket is public, not
that it accepts what the product sends.

## Correction 2 — the object count a fix has to carry is smaller than it looks

| what | count |
| --- | --- |
| messages with media | 313 |
| …that already carry `media_path` | **293** |
| …that carry only a legacy `media_url` | **20** |
| profiles with an avatar URL | 10 |
| chats with an avatar URL | 6 |

So 293 of 313 can be addressed from the path columns today. Only twenty need
their path recovered, and it is recoverable — a public URL contains the path it
was built from.

## The mechanism the plan depends on, proved rather than assumed

Signed URLs work on this deployment. Measured through the storage service, with
the path held in a shell variable and never printed:

    POST /storage/v1/object/sign/<bucket>/<path>   → a signedURL with a token
    GET  with that signature                        → 200, 6718 bytes
    GET  with the token replaced by nonsense        → 400

That last line is the one worth having: the signature is actually verified, so a
private bucket plus signed URLs is a real boundary rather than a longer address.

## The order, and why it cannot be reversed

1. **The client stops depending on public URLs.** Seven call sites build them
   with `getPublicUrl`, and the resolution has to move to the path columns so
   the twenty legacy rows and the sixteen avatars are the only special cases.
2. **Signed URLs get a lifetime and a refresh.** This is the real work: a signed
   URL expires, so an `<img>` that lives longer than the TTL needs re-signing.
3. **The twenty legacy paths and the sixteen avatar URLs are back-filled** into
   path columns.
4. **Only then does the bucket become private**, which is one row in
   `storage.buckets`.

Done in any other order, every photograph, voice message, video and avatar in
the product disappears at once and stays gone until the client catches up.

**Not started, and deliberately: this is the owner's call, because step 4 is
outward-facing and breaks things until step 1 has shipped.** Steps 1–3 are safe
to build at any time and change nothing visible while the bucket stays public.
