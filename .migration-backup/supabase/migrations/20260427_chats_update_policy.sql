-- Missing RLS policy on `chats`: there were INSERT and SELECT policies but no
-- UPDATE, so all updates (is_forum toggle, rename, avatar, updated_at bumps
-- from sendMessage) silently no-op'd — PostgREST returned 204 No Content
-- because RLS hid the row from the UPDATE.
--
-- Allow any chat member to update the row.  Role-specific gating (only
-- owner/admin can toggle is_forum, rename, etc.) is enforced client-side;
-- this policy just lets the row pass RLS at all.

create policy "Chat members can update chats"
  on public.chats for update
  using (
    exists (
      select 1 from public.chat_members m
      where m.chat_id = chats.id and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chat_members m
      where m.chat_id = chats.id and m.user_id = auth.uid()
    )
  );
