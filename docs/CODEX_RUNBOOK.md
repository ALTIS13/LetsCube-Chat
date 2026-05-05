# Codex Runbook

Стандартный workflow для будущих Codex-сессий в KUB.

## Перед работой

1. Запустить `git status`.
2. Прочитать `AGENTS.md`.
3. Определить тип задачи: UI, auth, deploy, Supabase, chat, tasks, admin.
4. Сначала открыть только релевантные файлы. Не сканировать весь репозиторий без необходимости.
5. Для UI/auth задач воспроизвести проблему в Browser на `https://kub.apollot.ru`, если браузер доступен.
6. По возможности сделать screenshot до изменений.

## Разработка

1. Делать минимальные сфокусированные изменения.
2. Не переписывать несвязанные компоненты.
3. Не менять SQL/миграции без прямого запроса.
4. Не хардкодить текущий домен. Использовать `window.location.origin`, `BASE_PATH`, env или deployment settings.
5. Не коммитить credentials, `.env`, ключи, токены, пароли.

## Валидация

Запускать, если доступно:

```bash
pnpm --filter @workspace/kub run typecheck
pnpm --filter @workspace/kub run build
docker compose config
```

Если Docker локально не установлен, не блокировать задачу: Docker build выполняет Coolify. На Windows build может упираться в platform-specific optional dependencies; это нужно явно сообщить.

## Commit и deploy

1. `git diff --check`
2. `git status`
3. Commit с ясным сообщением.
4. Push в `main` только если текущая задача допускает direct deploy.
5. Coolify auto deploy стартует автоматически после push в `main`.
6. После deploy проверить production-like URL.

## Production verification

1. Открыть `https://kub.apollot.ru`.
2. Войти QA-аккаунтом, если пользователь дал его вне репозитория.
3. Проверить Console и Network.
4. Убедиться, что нет request storm.
5. Проверить, что UI/auth/deploy bug исправлен.
6. Сообщить, что именно проверено.

## Формат финального ответа

- Root cause.
- Files changed.
- Validation results.
- Commit hash.
- Был ли push в `main`.
- Должен ли стартовать Coolify auto deploy.
- Что пользователю проверить вручную.
