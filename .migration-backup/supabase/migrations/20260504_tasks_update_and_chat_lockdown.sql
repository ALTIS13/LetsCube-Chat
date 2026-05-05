-- =====================================================================
-- Amendment to Task #30 + Task #28
-- =====================================================================
-- 1) `task_update` SECURITY DEFINER RPC — creator/staff edit a non-
--    finalised task and emit an `update` event in `task_events`.
-- 2) Tighten the `chats` INSERT policy so private chats can ONLY be
--    created via the SECURITY DEFINER RPC `open_or_create_private_chat`
--    (the earlier policy allowed any `type`, which let a caller bypass
--    the dedup logic with a direct INSERT).
--
-- Idempotent. Safe to re-run.
-- =====================================================================

set search_path = public;

-- ── 1. task_update ─────────────────────────────────────────────────────
-- Full-replace semantics: the frontend always sends the complete
-- editable field set. Passing NULL for description / due_at /
-- assignee_id / chat_id clears that field. `title` and `priority`
-- are required.
--
-- Workflow integrity guards on assignee changes:
--   * If the assignee changes while status is one of accepted /
--     in_progress / waiting_confirmation / rejected / confirmed /
--     cancelled, the call is rejected (`assignee_change_not_allowed_for_status`).
--   * null → user while status='new'  → status auto-becomes 'assigned'.
--   * user → null while status='assigned' → status auto-becomes 'new'.
--   * Other transitions keep status unchanged.
--   * Manager-can't-assign-to-admin is re-asserted via
--     `_task_assert_can_assign_to`.
--
-- Allowed only while the task is alive (status NOT IN
-- confirmed/cancelled). Reuses ban/role guards from `task_create`.
create or replace function public.task_update(
  p_task_id     uuid,
  p_title       text,
  p_description text,
  p_priority    public.task_priority,
  p_due_at      timestamptz,
  p_assignee_id uuid,
  p_chat_id     uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     uuid := auth.uid();
  v_task       public.tasks%rowtype;
  v_new_status public.task_status;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'title_required' using errcode = '22023';
  end if;
  if p_priority is null then
    raise exception 'priority_required' using errcode = '22023';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if v_task.status in ('confirmed','cancelled') then
    raise exception 'task_locked: status=%', v_task.status using errcode = '22023';
  end if;

  -- Creator or staff (admin/manager) only.
  if v_caller <> v_task.created_by
     and not public.is_manager_or_admin(v_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Optional chat existence check.
  if p_chat_id is not null
     and not exists (select 1 from public.chats where id = p_chat_id) then
    raise exception 'chat_not_found' using errcode = 'P0002';
  end if;

  -- Assignee changes have status restrictions and may auto-flip status.
  v_new_status := v_task.status;
  if p_assignee_id is distinct from v_task.assignee_id then
    if v_task.status not in ('new','assigned') then
      raise exception 'assignee_change_not_allowed_for_status: %', v_task.status
        using errcode = '22023';
    end if;
    if p_assignee_id is not null then
      -- Manager-can't-assign-to-admin guard.
      perform public._task_assert_can_assign_to(p_assignee_id);
    end if;
    if v_task.assignee_id is null and p_assignee_id is not null
       and v_task.status = 'new' then
      v_new_status := 'assigned';
    elsif v_task.assignee_id is not null and p_assignee_id is null
       and v_task.status = 'assigned' then
      v_new_status := 'new';
    end if;
  end if;

  update public.tasks set
    title       = btrim(p_title),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    priority    = p_priority,
    due_at      = p_due_at,
    assignee_id = p_assignee_id,
    chat_id     = p_chat_id,
    status      = v_new_status,
    updated_at  = now()
  where id = p_task_id;

  -- task_events.kind is `text` with a CHECK constraint that already
  -- lists 'update' (see 20260504_tasks_system.sql). No enum cast.
  insert into public.task_events (task_id, actor_id, kind, payload)
  values (
    p_task_id,
    v_caller,
    'update',
    jsonb_build_object(
      'title',       p_title,
      'priority',    p_priority::text,
      'due_at',      p_due_at,
      'assignee_id', p_assignee_id,
      'chat_id',     p_chat_id,
      'status',      v_new_status::text
    )
  );
end $$;

revoke all on function public.task_update(
  uuid, text, text, public.task_priority, timestamptz, uuid, uuid
) from public, anon;

grant execute on function public.task_update(
  uuid, text, text, public.task_priority, timestamptz, uuid, uuid
) to authenticated;

-- ── 2. Lock direct private-chat INSERT ─────────────────────────────────
-- `open_or_create_private_chat` is SECURITY DEFINER — it creates
-- private chats with elevated privilege and bypasses this WITH CHECK.
-- Regular authenticated INSERTs may still create groups/channels.
drop policy if exists "Users create chats with self as creator" on public.chats;
create policy "Users create chats with self as creator"
  on public.chats for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and type is not null
    and type <> 'private'
  );
