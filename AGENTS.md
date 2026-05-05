# Инструкции для Codex-агентов

KUB - мессенджер для операций компьютерного клуба. Основное приложение находится в `artifacts/kub`: React/Vite frontend. Опциональный server-side API/push worker находится в `artifacts/api-server`. Backend - Supabase Auth, Postgres, RLS, Realtime, RPC и Storage.

Текущий деплой: GitHub `main` -> Coolify auto deploy -> Docker Compose -> `127.0.0.1:8095` -> host Caddy -> текущий тестовый домен `https://kub.apollot.ru`. Домен временный. Не хардкодить его в source code; для доменных задач использовать `window.location.origin`, `BASE_PATH`, env/deployment settings и Supabase Dashboard.

## Безопасность

- Никогда не коммитить `.env`, `.env.local`, `.env.production`, реальные ключи, токены, пароли.
- Никогда не добавлять `SUPABASE_SERVICE_ROLE_KEY` во frontend, `VITE_*`, mobile/desktop/public bundle.
- Никогда не печатать секреты в логах или документации.
- Никогда не отключать RLS.
- Никогда не менять SQL/миграции без прямого запроса.
- Не делать широкий rewrite ради маленького UI-бага.
- Один task = сфокусированный diff = понятный commit.
- Для UI-багов использовать Browser QA и screenshots, если доступно.
- Для auth/domain bugs не хардкодить домены; использовать dynamic origin и deployment settings.

## Контроль контекста

- Не сканировать весь репозиторий без необходимости.
- Использовать targeted search.
- Sidebar/UI bugs: сначала смотреть `Sidebar.tsx`, `SidebarHeader.tsx`, `NotificationBell.tsx`, `ChatList.tsx`, `MainLayout.tsx`, `index.css`.
- Auth bugs: сначала смотреть `RegisterForm.tsx`, `LoginForm.tsx`, `App.tsx`, `src/lib/supabase/client.ts`, auth callback helpers.
- После одной неудачной попытки фикса остановиться и запросить точные logs/screenshots.
- Не повторять тот же investigation loop без новых фактов.
- Перед patch кратко сформулировать root cause.
- После patch сообщать changed files и validation results.

## Деплой

- Auto deploy from `main` включён в Coolify.
- Push в `main` запускает deployment.
- Если deployment failed, нужен Coolify deployment log.
- Не требовать Docker Desktop локально. Docker build/deploy делает Coolify на Ubuntu HomeNode.
- Если Docker локально недоступен, запускать `pnpm --filter @workspace/kub run typecheck` и, если возможно, `pnpm --filter @workspace/kub run build`.
