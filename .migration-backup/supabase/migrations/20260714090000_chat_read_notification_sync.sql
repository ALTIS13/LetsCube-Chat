-- Keep chat delivery receipts and message notifications in one transaction.
-- The notification helper is SECURITY DEFINER because notifications intentionally
-- expose no direct UPDATE policy to authenticated clients.

begin;

create or replace function public.mark_chat_read(
  p_chat_id uuid
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  update public.chat_members
  set last_read_at = greatest(
        coalesce(last_read_at, '-infinity'::timestamptz),
        v_now
      ),
      last_delivered_at = greatest(
        coalesce(last_delivered_at, '-infinity'::timestamptz),
        v_now
      )
  where chat_id = p_chat_id
    and user_id = auth.uid();

  if not found then
    raise exception 'chat_member_required' using errcode = '42501';
  end if;

  perform public.notifications_mark_chat_messages_read(p_chat_id, v_now);
end
$$;

revoke all on function public.mark_chat_read(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_chat_read(uuid)
  to authenticated;
grant execute on function public.mark_chat_read(uuid)
  to service_role;

commit;
