# Правила Supabase Migration

Этот проект использует Supabase как production-like backend: Auth, Postgres, RLS, Realtime, RPC и Storage. MCP можно использовать только read-only для инспекции фактического состояния.

## Запрещено

- Не применять SQL через MCP.
- Не мутировать production database из Codex.
- Не отключать RLS.
- Не добавлять `SUPABASE_SERVICE_ROLE_KEY` во frontend, `VITE_*`, mobile/desktop/public bundle.
- Не коммитить `.env`, реальные ключи, токены, пароли, service role.
- Не менять migrations/SQL без явного запроса пользователя.

## Как готовить SQL

Все изменения БД оформлять только idempotent SQL-файлами в:

```text
.migration-backup/supabase/migrations/
```

Файл должен:

- иметь имя вида `YYYYMMDD_short_description.sql`;
- быть безопасным для повторного запуска;
- использовать `create ... if not exists`, `alter table ... add column if not exists`, `drop policy if exists`;
- не полагаться на Supabase CLI migration ledger, потому что фактический ledger проекта пустой;
- не содержать секретов или QA credentials;
- не использовать service role;
- не выключать RLS даже временно;
- сохранять старые RPC, если frontend еще не переключен на новые.

## Обязательный шаблон

В каждом migration-файле должны быть:

- цель и root cause;
- зависимости от предыдущих migrations/functions;
- DDL/RLS/RPC изменения;
- `grant/revoke` для exposed RPC;
- verify SQL;
- manual QA checklist;
- явное указание, что SQL применяет пользователь вручную через Supabase SQL Editor.

## Порядок работы

1. Через MCP read-only сверить текущие таблицы, columns, enums, RLS, functions, triggers, indexes, realtime publication, storage policies/advisors.
2. Сравнить с `docs/SUPABASE_CURRENT_STATE.md` и `docs/SUPABASE_SCHEMA_MAP.md`.
3. Если нужен DB fix, создать migration-файл, но не применять.
4. Обновить docs с рисками, verify SQL и ручными QA шагами.
5. Frontend, зависящий от новых columns/RPC, пушить только после ручного применения SQL и проверки пользователем.

## Current SQL State

На 2026-05-05 read-only MCP inspection подтвердил, что production Supabase уже содержит изменения из:

- `.migration-backup/supabase/migrations/20260505_tasks_visibility_and_assignment.sql`
- `.migration-backup/supabase/migrations/20260505_media_storage_path_policies.sql`
- `.migration-backup/supabase/migrations/20260505_folders_policy_cleanup.sql`

Production Supabase уже содержит task v2:

- `tasks.visibility`
- `tasks.assignment_scope`
- enum `task_visibility`
- enum `task_assignment_scope`
- RPC `task_create_v2`
- RPC `task_update_v2`
- RPC `task_claim`
- RLS policies `tasks select with visibility` и `task_events select with visibility`

Storage bucket `media` уже использует scoped read/insert/update/delete policies, а legacy broad upload/list policies отсутствуют.

Legacy `folders` / `folder_chats` `*_own` policies уже удалены; активны scope-aware policies и restrictive banned-user guards.

Pending manual SQL сейчас отсутствует. Если Supabase MCP позже покажет drift, создать новый idempotent migration file в `.migration-backup/supabase/migrations/`, но не применять его через MCP.

Task frontend можно выравнивать под `task_create_v2` / `task_update_v2` / `task_claim` небольшими совместимыми этапами; источник прав остается RLS/RPC.
