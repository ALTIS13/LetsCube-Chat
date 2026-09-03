-- Let a chat's own picture have a small version, the way a person's does.
--
-- `20260904000000_avatar_variants_readable.sql` fixed this for profiles and
-- said so: an avatar drawn at 32 pixels was downloading a 734 kB original.
-- A group's picture was left behind, because a chat has no `profiles` row to
-- key a variant on. Measured on this deployment: three group avatars totalling
-- 2 586 818 bytes, averaging 862 kB, the largest 2 303 559 bytes — drawn into
-- a 48-pixel circle in the chat list, by every member, on every cold load.
-- An `avatar_128` here averages 2 717 bytes.
--
-- Which column carries the chat. `chat_id` already exists, and on a message
-- variant it means "the chat this message lives in" — denormalised off the
-- message purely so the read policy can check membership without a join. The
-- subject of such a row is `message_id`. For a chat's own avatar the chat is
-- both the scope and the subject, so the two readings coincide, and
-- `message_id is null` is what tells the two kinds of row apart. Nothing reads
-- this table by `chat_id` alone today: both the client and the worker filter by
-- `message_id` or `profile_id`.
--
-- Reusing `chat_id` rather than adding a fourth scope column also means the
-- read policy is already correct. `media variants chat members can read` is
-- `chat_id is not null and is_chat_member(chat_id) and not is_banned(...)`,
-- which is exactly the intended audience — so this migration adds no policy.
--
-- Why membership and not public, when profile avatars were made public. That
-- change was justified by "this exposes nothing": `profiles` is readable by
-- everyone (its select policy is literally `true`), so the original was already
-- world-readable and the policy was only hiding the address of something anyone
-- could fetch. A chat is not like that — `chats` is readable only through
-- `Chat members can view chats`. A world-readable variant row would newly tell
-- any authenticated non-member that a given chat id has a picture, and where to
-- get it, since the variant path is derivable from the chat id alone. Scoping
-- to membership costs nothing: a surface that shows a chat to a non-member sees
-- no row and falls back to the original, which is today's behaviour exactly.
--
-- The variant kinds are reused as-is. A chat's `avatar_128` is the same 128px
-- square crop at the same quality as a person's; which of `profile_id` and
-- `chat_id` is set says whose it is, so `media_variants_variant_kind_check`
-- needs no widening.

-- The one thing that genuinely blocks the row: the scope check admits exactly
-- two shapes today, and a chat-avatar row is a third.
alter table public.media_variants
  drop constraint if exists media_variants_message_or_profile_scope;

alter table public.media_variants
  add constraint media_variants_message_or_profile_scope check (
    -- a message's variant: scoped to its chat
    (message_id is not null and chat_id is not null and profile_id is null)
    -- a profile's avatar
    or (message_id is null and chat_id is null and profile_id is not null)
    -- a chat's own avatar
    or (message_id is null and chat_id is not null and profile_id is null)
  );

-- The worker replaces a variant by deleting then inserting. Without this, two
-- overlapping ticks could leave two `ready` rows for one chat and kind, and the
-- client would pick whichever came back first. The profile and message rows
-- each already have this guard; this is the same one for the third shape.
create unique index if not exists media_variants_chat_avatar_kind_uidx
  on public.media_variants (chat_id, variant_kind)
  where message_id is null and chat_id is not null and status = 'ready';
