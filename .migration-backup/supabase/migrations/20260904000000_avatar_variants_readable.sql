-- Let a person read the small version of somebody else's avatar.
--
-- The pipeline has been producing `avatar_128` and `avatar_256` all along, and
-- the client has always known how to use them, but `media_variants` could only
-- be read for your *own* profile. So every avatar except your own fell back to
-- the original: measured on this deployment, avatar originals average 734 kB
-- against 2.7 kB for `avatar_128` — roughly 270 times the bytes, for a picture
-- drawn at 32 pixels, on every message row, chat row and search result.
--
-- This exposes nothing new. `profiles.avatar_url` is already readable by
-- everyone, the variants live in the `media` bucket which is public, and their
-- paths are derived from a source path that is public too. The policy was
-- hiding the address of something anyone could already fetch.
--
-- Deliberately narrow: only the two avatar kinds. Message variants stay scoped
-- to chat membership, where the restriction is doing real work.

drop policy if exists "media variants avatars are readable" on public.media_variants;
create policy "media variants avatars are readable"
  on public.media_variants for select
  using (
    profile_id is not null
    and variant_kind in ('avatar_128', 'avatar_256')
    and not public.is_banned(auth.uid())
  );
