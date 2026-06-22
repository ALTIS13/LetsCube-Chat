-- Proposal only. Do not apply automatically from Codex.
--
-- Goal:
--   Let regular authenticated chat participants read ready avatar variants for
--   profiles they share a chat with. The frontend can then use 128/256px WebP
--   avatars in chat lists and message bubbles instead of loading original
--   profile images. Existing own-profile/admin profile-variant policies remain
--   valid; this adds the peer visibility needed by the messenger UI.
--
-- Security notes:
--   - No service_role is used by the frontend.
--   - Only ready avatar variants are exposed, not source objects or failed rows.
--   - Message media variants keep the existing chat membership policy.
--   - This intentionally mirrors the product surface where chat co-members can
--     already see each other's profile avatar_url.

begin;

drop policy if exists "media variants chat peers can read avatar variants" on public.media_variants;

create policy "media variants chat peers can read avatar variants"
  on public.media_variants
  for select
  to authenticated
  using (
    profile_id is not null
    and status = 'ready'
    and variant_kind in ('avatar_128', 'avatar_256')
    and not public.is_banned(auth.uid())
    and exists (
      select 1
      from public.chat_members me
      join public.chat_members peer
        on peer.chat_id = me.chat_id
      where me.user_id = auth.uid()
        and peer.user_id = public.media_variants.profile_id
    )
  );

commit;
