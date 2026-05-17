-- Proposal only. Apply manually in Supabase after review.
-- Purpose: persist media-specific rendering hints, starting with round video messages.

alter table public.messages
  add column if not exists media_metadata jsonb null default '{}'::jsonb;

update public.messages
set media_metadata = '{}'::jsonb
where media_metadata is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_media_metadata_is_object'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_media_metadata_is_object
      check (media_metadata is null or jsonb_typeof(media_metadata) = 'object');
  end if;
end $$;

comment on column public.messages.media_metadata is
  'Optional client media metadata, for example {"kind":"video_message","shape":"round","duration_ms":1200}.';
