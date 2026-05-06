# План гибких ролей и прав KUB

Статус: проектный план и foundation SQL proposal. Production Supabase не изменялся автоматически.

## Текущее состояние

Сейчас права завязаны на `profiles.role public.app_role`:

- `app_role`: `admin | manager | user`.
- Frontend: `useRole`, `useIsAdmin`, `useIsManagerOrAdmin`, `AdminLayout`, `UsersTab`, task actions.
- RLS/RPC helpers: `is_admin(uid)`, `is_manager_or_admin(uid)`.
- Role-change guards: `enforce_role_change_matrix`, `prevent_demoting_last_admin`.
- Sanctions matrix: `enforce_sanction_matrix`.
- Tasks: `task_create(_v2)`, `task_assign`, `task_claim`, `task_confirm`, `task_reject`, task visibility helpers.
- Admin data: `admin_user_emails`, audit read policy, profile/contact read/update policies.
- Folders/shared/system management uses `is_admin` / `is_manager_or_admin`.

Текущая модель рабочая, но слишком жесткая для клуба: любое расширение превращается в новые ветки `admin/manager/user`.

Актуальное ограничение для задач: frontend уже скрывает `/tasks` от legacy `user`, но production RLS helper `_task_visible_to_current_user(...)` всё еще разрешает доступ creator/assignee независимо от роли. Это означает, что полный запрет task data для обычных клиентов требует отдельного DB/RPC этапа после внедрения `staff`/permission layer. До этого безопасная краткосрочная модель UI — показывать задачи только `admin`/`manager`.

## Целевая модель

Phase A добавляет новую модель рядом со старой:

- `roles`
  - `id uuid`
  - `key text unique`
  - `name text`
  - `description text`
  - `rank integer`
  - `is_system boolean`
  - `created_at`, `updated_at`
- `permissions`
  - `key text primary key`
  - `description text`
  - `category text`
- `role_permissions`
  - `role_id`
  - `permission_key`
- `user_roles`
  - `user_id`
  - `role_id`
  - `is_primary boolean default true`
  - `created_at`, `updated_at`

Для первого production-safe шага используется одна primary role на пользователя. `profiles.role` остается compatibility layer, чтобы существующие RLS/RPC продолжали работать.

## Системные роли

- `owner` / Владелец
- `administrator` / Администратор
- `manager` / Управляющий
- `tech_admin` / Технический администратор
- `staff` / Персонал
- `user` / Пользователь

Legacy mapping:

- `profiles.role = admin` -> `administrator`
- `profiles.role = manager` -> `manager`
- `profiles.role = user` -> `user`

`owner` не назначается автоматически. Первый owner должен быть назначен вручную отдельным подтвержденным SQL после проверки.

## Permissions

Начальный набор:

- `admin.panel.view`
- `users.view`
- `users.manage`
- `users.manage_roles`
- `users.manage_admins`
- `bans.manage`
- `mutes.manage`
- `chats.manage_all`
- `chats.create_group`
- `chats.manage_members`
- `folders.manage_shared`
- `tasks.view_all`
- `tasks.access`
- `tasks.view_assigned`
- `tasks.create`
- `tasks.assign`
- `tasks.confirm`
- `tasks.manage_all`
- `audit.view`
- `settings.manage`
- `notifications.manage`
- `profile.view_private_fields`
- `phone.view`
- `phone.verify`

## Миграционные фазы

### Phase A: foundation

Создать таблицы `roles`, `permissions`, `role_permissions`, `user_roles`, seed system roles/permissions, backfill primary role из `profiles.role`, добавить helper functions:

- `role_key_for_app_role(app_role)`.
- `current_role_key(uid)`.
- `has_permission(uid, permission_key)`.
- `role_rank(uid)`.
- `can_manage_role(actor, target_role_key)`.

Старые `is_admin` / `is_manager_or_admin` не менять в этой фазе.

### Phase B: frontend admin UI

Обновить admin users UI:

- показывать системные роли из `roles`;
- назначать primary role через новый RPC, не прямым update;
- показывать permissions readonly;
- не давать управлять owner/administrator пользователям без `users.manage_admins`.

### Phase C: staged permission adoption

Постепенно заменить проверки:

- `audit.view` вместо `is_admin` для audit tab;
- `users.manage_roles` вместо жесткого admin/manager;
- `tasks.*` вместо `is_manager_or_admin` в task RPC;
- `bans.manage` / `mutes.manage` для sanctions;
- `folders.manage_shared` для shared/system folders.

### Phase D: compatibility cleanup

Только после QA и ручного подтверждения:

- решить, остается ли `profiles.role`;
- если остается, держать его как legacy summary;
- если удаляется, переписать RLS/RPC на `has_permission`.

## Безопасность

- Обычный user не может сам назначать себе роли: write policies/RPC должны требовать `users.manage_roles`.
- Последнего owner/administrator нельзя потерять.
- Роль с меньшим rank не может управлять ролью с равным или большим rank.
- `users.manage_admins` требуется для управления `owner` / `administrator`.
- `has_permission` должен быть `SECURITY DEFINER`, но не должен выдавать больше прав, чем role mapping.
- Старые RLS/RPC остаются неизменными до отдельного этапа.

## Что можно внедрить без поломки

- Foundation таблицы и helper functions.
- Readonly отображение roles/permissions в admin UI.
- Документация и QA checklist.

## Что требует ручного SQL

- Применение `.migration-backup/supabase/migrations/20260505_roles_permissions_foundation.sql`.
- Назначение первого `owner`, если он нужен до frontend UI.
- Любая замена старых RLS/RPC на `has_permission`.

## Риски

- Две системы ролей могут разъехаться, если начать менять `user_roles` и `profiles.role` без sync/RPC.
- Нельзя переписать `is_admin` на `owner/administrator` без полного regression QA admin/tasks/folders/sanctions.
- Нужно отдельно продумать UX: у пользователя одна понятная должность, а permissions видны staff/admin.

## Verify после ручного применения Phase A

```sql
select key, name, rank from public.roles order by rank desc;
select key, category from public.permissions order by category, key;
select p.role, r.key as mapped_role
from public.profiles p
left join public.user_roles ur on ur.user_id = p.id and ur.is_primary
left join public.roles r on r.id = ur.role_id
order by p.created_at;
select public.has_permission(auth.uid(), 'admin.panel.view');
```

## Manual QA после Phase A

- Login admin: admin panel работает как раньше.
- Login manager: users/tasks/sanctions работают как раньше.
- Login user: admin panel недоступна, task visibility не расширилась.
- Role changes через старый UI не ломают `profiles.role`.
- Supabase logs не показывают RLS errors для обычных flows.
