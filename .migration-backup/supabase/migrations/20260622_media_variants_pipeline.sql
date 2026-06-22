-- LETSCUBE media variants / preview pipeline proposal
-- Date: 2026-06-22
--
-- Purpose:
--   Prepare the database side for server-generated lightweight media variants:
--   image thumbnails, avatar previews, video posters and future transcoded video.
--
-- Important:
--   Proposal only. Do not apply automatically.
--   A trusted worker/Edge Function should generate variants from Storage objects
--   and insert/update this table. Frontend clients must not receive service_role.

begin;

create table if not exists public.media_variants (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete cascade,
  source_bucket text not null default 'media',
  source_path text not null,
  variant_kind text not null check (
    variant_kind in (
      'image_preview',
      'image_thumb',
      'video_poster',
      'video_720p',
      'avatar_128',
      'avatar_256'
    )
  ),
  variant_bucket text not null default 'media',
  variant_path text not null,
  mime_type text not null,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  status text not null default 'ready' check (status in ('ready', 'failed', 'stale')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_variants_message_or_profile_scope
    check (
      (message_id is not null and chat_id is not null and profile_id is null)
      or
      (message_id is null and chat_id is null and profile_id is not null)
    )
);

create unique index if not exists media_variants_message_kind_uidx
  on public.media_variants (message_id, variant_kind)
  where message_id is not null and status = 'ready';

create unique index if not exists media_variants_profile_kind_uidx
  on public.media_variants (profile_id, variant_kind)
  where profile_id is not null and status = 'ready';

create index if not exists media_variants_chat_idx
  on public.media_variants (chat_id, variant_kind, created_at desc)
  where chat_id is not null;

create index if not exists media_variants_source_idx
  on public.media_variants (source_bucket, source_path);

alter table public.media_variants enable row level security;

drop policy if exists "media variants chat members can read" on public.media_variants;
create policy "media variants chat members can read"
  on public.media_variants
  for select
  to authenticated
  using (
    chat_id is not null
    and public.is_chat_member(chat_id)
    and not public.is_banned(auth.uid())
  );

drop policy if exists "media variants users can read own profile variants" on public.media_variants;
create policy "media variants users can read own profile variants"
  on public.media_variants
  for select
  to authenticated
  using (
    profile_id = auth.uid()
    and not public.is_banned(auth.uid())
  );

drop policy if exists "media variants admins can read profile variants" on public.media_variants;
create policy "media variants admins can read profile variants"
  on public.media_variants
  for select
  to authenticated
  using (
    profile_id is not null
    and public.is_admin(auth.uid())
    and not public.is_banned(auth.uid())
  );

revoke all on public.media_variants from public, anon;
grant select on public.media_variants to authenticated;

commit;

-- Worker contract:
-- 1. Read source Storage object in a trusted backend context.
-- 2. Generate bounded variants:
--    - chat image preview: max 1280px WebP, quality around 0.78;
--    - chat image thumb: max 360px WebP;
--    - video poster: max 720px WebP/JPEG;
--    - avatar previews: 128px and 256px WebP.
-- 3. Store variants under deterministic paths, e.g.
--    variants/messages/{chat_id}/{message_id}/{variant_kind}.webp
--    variants/avatars/{profile_id}/{variant_kind}.webp
-- 4. Upsert media_variants with dimensions and size_bytes.
-- 5. Frontend reads variant rows and uses signed/private URLs if the media
--    bucket is private, or public URLs only while the legacy public bucket
--    remains in use.
