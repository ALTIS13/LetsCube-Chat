/**
 * Removes the membership service lines.
 *
 * The rows already written stay: they are ordinary `system` messages in the
 * conversation, the client has drawn that shape since May 2026, and deleting
 * somebody's chat history to undo a feature is worse than the feature.
 * To remove them as well:
 *
 *   delete from public.messages
 *    where type = 'system'
 *      and created_at >= '<the moment the migration was applied>';
 *
 * — but read them first, because three legitimate system messages predate this
 * migration and a careless bound would take them too.
 */

begin;

set local lock_timeout = '5s';

drop trigger if exists trg_membership_service_message_insert on public.chat_members;
drop trigger if exists trg_membership_service_message_delete on public.chat_members;

drop function if exists public.write_membership_service_message();
drop function if exists public.chat_member_service_name(uuid);

commit;
