# Карта проекта

Этот файл помогает быстро понять структуру KUB без повторного объяснения контекста.

## Основные области

- `artifacts/kub` - основное React/Vite frontend-приложение.
- `artifacts/kub/src/components/sidebar` - sidebar, `SidebarHeader`, `ChatList`, `NotificationBell`, папки, настройки, создание чатов/групп.
- `artifacts/kub/src/components/chat` - `ChatWindow`, `MessageList`, `MessageInput`, `VoiceRecorder`, `AudioMessage`, топики и действия с сообщениями.
- `artifacts/kub/src/pages/admin` - админ-панель: layout, dashboard, users, bans/mutes, audit.
- `artifacts/kub/src/pages/tasks` - страница задач, карточки, detail/edit/confirm/reject/assign modals.
- `artifacts/kub/src/hooks` - Supabase hooks, realtime, heartbeat, chats, messages, folders, tasks, notifications, audit, roles.
- `artifacts/kub/src/store` - Zustand app state.
- `artifacts/kub/src/lib/supabase` - browser Supabase client.
- `artifacts/kub/src/types/database.ts` - вручную поддерживаемые Supabase types.
- `artifacts/api-server` - опциональный Node API server / push worker. Это server-side зона, не frontend bundle.
- `.migration-backup/supabase/migrations` - применённые/ручные Supabase migrations. Не менять без прямого запроса.
- `docs/deploy` - Dockerfile, compose examples, nginx/caddy examples.
- `docker-compose.yml` - root Coolify compose текущего деплоя.
- `docs/*` - deployment, smoke tests, Supabase audit, Git/Coolify docs, Codex runbooks.

## Common bug -> likely files

- Sidebar overflow/icons broken -> `Sidebar.tsx`, `SidebarHeader.tsx`, `NotificationBell.tsx`, `ChatList.tsx`, `MainLayout.tsx`, `index.css`.
- Request storm -> `useHeartbeat`, `useUser`, `useChats`, `useFolders`, `useTasks`, `useNotifications`, `app.store`.
- Email confirmation redirect -> `RegisterForm`, `LoginForm`, `App` routing, Supabase client, auth callback helpers.
- Voice message bugs -> `VoiceRecorder`, `AudioMessage`, `useVoiceRecorder`, `MessageInput`.
- Shared folder bugs -> `useFolders`, `FolderEditModal`, `FolderTabs`, `Sidebar`.
- Tasks workflow bugs -> `useTask`/`useTasks`, `TaskDetailModal`, `TaskFormModal`, `taskMeta`, database types.
- Admin bugs -> `pages/admin/*`, `useRole`, `useBanState`, `useMuteState`, `useAuditLogs`.
- Deploy bugs -> `docker-compose.yml`, `docs/deploy/Dockerfile`, `docs/deploy/nginx.conf`, Coolify logs.
