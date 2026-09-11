/**
 * Close the private-chat delete path that only the chat's creator had.
 *
 * `Chat owners delete chat` allowed DELETE on public.chats for any chat the
 * caller owns, with no condition on the chat's type. The AFTER INSERT trigger
 * `trg_add_chat_creator_as_owner` makes whoever opens a private chat its owner,
 * so in every private chat exactly one of the two participants could delete the
 * whole conversation for both sides — messages and media included, through the
 * BEFORE DELETE trigger `trg_mark_chat_delete_cascade` — by calling the API
 * directly. The interface never offered this: a private chat can only be hidden
 * for yourself, through `hide_private_chat`. The owner approved closing it on
 * 2026-09-11.
 *
 * Verified read-only on production before writing this, with no write of any
 * kind — `EXPLAIN` without `ANALYZE` inside a read-only transaction shows the
 * RLS filter Postgres attaches to a DELETE for a given user without running it:
 *   - DELETE policies: `block banned writes (delete)` is RESTRICTIVE, so it is
 *     ANDed; `Chat owners delete chat` is PERMISSIVE. For chats there is no
 *     wider opening than the owner rule.
 *   - As the owner of a private chat, the filter is
 *     `NOT is_banned(uid) AND is_chat_owner(id) AND <member of the chat>` and
 *     `is_chat_owner` is true: the delete would pass.
 *   - Against a private chat the same user is not in, `is_chat_owner` is false.
 *   - As the owner of a group chat, `is_chat_owner` is true, and must stay so.
 *   - Member roles by chat type: private/owner 24, private/member 23,
 *     group/owner 10, group/admin 1, group/member 3.
 *   - Every client delete of a chats row (ChatHeader, ChatList, ChatInfoPanel)
 *     is gated on a group or channel the caller owns; nothing legitimate
 *     deletes a private chat through this policy.
 *
 * Schema backup taken and verified first:
 *   /srv/letscube/backups/db-schema/pre-20260911120000-private-chat-owner-delete-20260911T004702Z.sql
 *   907027 bytes, sha256 93ed2f10757e64704300421f7778587bc1e48804638b9527542fcb0cf83584a3,
 *   169 policies, and the replaced policy verbatim:
 *   CREATE POLICY "Chat owners delete chat" ON public.chats FOR DELETE TO authenticated USING (public.is_chat_owner(id));
 * Rollback is recreating that exact line.
 *
 * Groups and channels keep owner deletion, which the interface uses. "Delete for
 * both" in private chats, which the owner also approved, arrives separately as a
 * function either participant may call — not as a side effect of who created
 * the chat.
 *
 * One transaction, so there is never a moment with no owner-delete policy for
 * groups. Idempotent: a second apply drops and recreates the same policy.
 */

begin;

drop policy if exists "Chat owners delete chat" on public.chats;

create policy "Chat owners delete chat"
  on public.chats
  for delete
  to authenticated
  using (public.is_chat_owner(id) and type <> 'private');

-- Refuse to succeed unless the repaired policy is really in place and really
-- excludes private chats. A half-applied state here is invisible from the
-- interface, so nothing downstream would notice it.
do $$
declare
  v_expr text;
  v_roles text;
  v_permissive boolean;
begin
  select pg_get_expr(polqual, polrelid),
         array_to_string(array(select rolname from pg_roles where oid = any(polroles)), ','),
         polpermissive
    into v_expr, v_roles, v_permissive
  from pg_policy
  where polrelid = 'public.chats'::regclass
    and polname = 'Chat owners delete chat'
    and polcmd = 'd';

  if v_expr is null then
    raise exception 'owner delete policy is missing after the repair';
  end if;
  if v_expr not like '%private%' then
    raise exception 'owner delete policy does not exclude private chats: %', v_expr;
  end if;
  if v_roles <> 'authenticated' then
    raise exception 'owner delete policy has the wrong roles: %', v_roles;
  end if;
  if not v_permissive then
    raise exception 'owner delete policy became restrictive, which would block group deletion entirely';
  end if;
end
$$;

commit;
