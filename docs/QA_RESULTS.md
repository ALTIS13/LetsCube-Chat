# QA Results

Снимок аудита: 2026-05-05. Test domain: `https://kub.apollot.ru` временный; домен нельзя хардкодить в source code.

## Passed

- Supabase MCP read-only подключение работает для проекта `nhogbeojfnbjcfipitrh`.
- В `public` найдено 17 таблиц, RLS включен на user-facing таблицах.
- Realtime publication содержит `bans`, `chat_members`, `chats`, `folder_chats`, `folders`, `messages`, `mutes`, `notifications`, `profiles`, `reactions`, `task_events`, `tasks`, `topics`.
- `tasks` и `task_events` используют direct write block policies; mutations идут через SECURITY DEFINER RPC.
- Sidebar source уже содержит `min-w-0`, fixed 36px icon buttons и profile menu с admin entry.
- Auth callback в frontend доменно-агностичный: redirect строится от текущего origin, не от hardcoded `kub.apollot.ru`.
- Heartbeat source использует singleton/refcount и throttle; `useChats`, `useTasks`, `useNotifications` уже имеют стабильные channel names и debounced refetch.

## Failed

- Task privacy в БД недостаточна: текущая RLS показывает linked-chat задачи всем участникам linked chat. Для staff/private задач это слишком широко.
- Storage `media` имеет broad public SELECT/listing policy и authenticated upload без path ownership.
- В `folders` и `folder_chats` одновременно есть старые `*_own` policies и новые scope-aware policies. Это не ломает функционал напрямую, но дает multiple permissive policies и усложняет reasoning.
- Auth logs за последние 24 часа все еще показывают `referer=tg.letscube.ru`. Это не доказывает hardcode в source code, но означает, что Supabase Auth URL/settings нужно держать под контролем при смене домена.
- Supabase Auth logs показывают ошибки `missing Twilio account SID` на `/user` при phone update. Это отдельный Supabase Auth/SMS configuration вопрос, не frontend service_role проблема.

## Needs Manual Verification

- Browser QA на `https://kub.apollot.ru`:
  - login/logout/session restore;
  - direct refresh `/admin`, `/tasks`, `/auth/callback`;
  - sidebar profile menu на desktop и admin panel entry;
  - notifications popover;
  - tasks page/admin/audit;
  - folders create/edit/delete/add/remove chat;
  - voice recording/send/playback;
  - themes light/dark/system;
  - responsive 390px, 768px, 1280px.
- Network QA:
  - idle 2 минуты без request storm;
  - heartbeat примерно не чаще штатного интервала;
  - realtime websocket остается подключенным;
  - нет повторяющихся `Failed to fetch` / `ERR_INSUFFICIENT_RESOURCES`.
- Email confirmation UX:
  - успешная ссылка ведет на текущий `/auth/callback`;
  - expired/invalid link показывает дружелюбное сообщение, а не raw Supabase JSON.

## Needs DB Migration

- Task privacy/assignment:
  - `.migration-backup/supabase/migrations/20260505_tasks_visibility_and_assignment.sql`
  - добавляет `task_visibility`, `task_assignment_scope`, columns, RLS и новые RPC `task_create_v2`, `task_update_v2`, `task_claim`;
  - существующие задачи backfill в `visibility='staff'`.
- Storage hardening:
  - `.migration-backup/supabase/migrations/20260505_media_storage_path_policies.sql`
  - убирает broad listing и ограничивает upload/update/delete по path ownership.
- Folders policy cleanup:
  - `.migration-backup/supabase/migrations/20260505_folders_policy_cleanup.sql`
  - удаляет старые `*_own` policies после scope-aware migration.

## Needs UX Polish

- Chat list search сейчас ищет по названию чата и last message text, но не по всем сообщениям.
- In-chat search работает только по загруженным сообщениям текущего чата, не по всей истории.
- Нет глобальной search/command palette.
- Task filters пока не знают о pool/unassigned/visibility, потому frontend не переключается на новые task RPC до применения SQL.
- Chat overview в `useChats` все еще делает per-chat last-message/unread enrichment; при росте количества чатов стоит вынести это в RLS-safe RPC/view отдельной миграцией.

## Browser QA Notes

В этой сессии код подготовлен для локальной сборки и последующего deploy. Скриншоты не коммитить; локальная `.qa-screenshots/` остается untracked.
