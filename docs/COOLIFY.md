# Деплой KUB через Coolify

Документ описывает generic-деплой из private Git-репозитория. В репозитории не должно быть личного домена, локальных портов, реальных Supabase ключей, `SUPABASE_SERVICE_ROLE_KEY` или VAPID private key.

## Подход A: Proxy Управляет Coolify

Этот вариант проще, если Coolify сам владеет reverse proxy и HTTPS.

1. Создайте приложение в Coolify из private Git repository.
2. Build Pack: Docker Compose.
3. Base Directory: корень репозитория.
4. Docker Compose Location: `docs/deploy/docker-compose.coolify.yml`.
5. Domain: задайте в Coolify UI, например `https://your-domain.example`.
6. Environment Variables: задайте в Coolify UI, не в git.
7. Deploy/Rebuild.

В этом режиме compose не публикует host-port наружу. Сервис только `expose: 80`, а Coolify проксирует трафик сам. Не добавляйте custom Docker networks без необходимости.

## Подход B: Уже Есть Host Caddy

Этот вариант нужен, если на Ubuntu-ноде уже есть Caddy, который владеет портами `80/443`.

1. Создайте приложение в Coolify из private Git repository.
2. Build Pack: Docker Compose.
3. Base Directory: корень репозитория.
4. Docker Compose Location: `docs/deploy/docker-compose.yml`.
5. В Coolify UI задайте `KUB_WEB_PORT`, например `8080`.
6. В host Caddy настройте свой домен на `127.0.0.1:<KUB_WEB_PORT>`.

Пример Caddy находится в `docs/deploy/Caddyfile.example`. Замените:

- `your-domain.example` на свой домен;
- `8080` на значение `KUB_WEB_PORT`, если вы его меняли.

Домен и порт являются локальной конфигурацией сервера. Их нельзя зашивать в репозиторий.

## Переменные Окружения В Coolify

Минимум для frontend build:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<YOUR_SUPABASE_PUBLISHABLE_KEY>
VITE_SUPABASE_ANON_KEY=
VITE_VAPID_PUBLIC_KEY=
BASE_PATH=/
PORT=5173
```

Для режима с host-port:

```env
KUB_WEB_PORT=8080
```

Если web push используется, заполните только публичный ключ:

```env
VITE_VAPID_PUBLIC_KEY=<YOUR_VAPID_PUBLIC_KEY>
```

`VITE_*` переменные являются build-time значениями Vite. После изменения Supabase URL/key, VAPID public key или `BASE_PATH` нужен rebuild/redeploy frontend, а не простой restart.

## Безопасность

- Никогда не добавляйте `SUPABASE_SERVICE_ROLE_KEY` в frontend service в Coolify.
- Никогда не добавляйте VAPID private key в frontend service.
- Если позже будет запускаться отдельный `api-server` или push worker, `service_role` может находиться только в приватном server-side worker service.
- Не монтируйте `.env` с секретами во frontend-контейнер без необходимости.
- Не коммитьте `.env`, `.env.production`, Caddyfile с реальным доменом или дампы логов.

## Supabase Production Settings

В Supabase Dashboard откройте Authentication -> URL Configuration.

Site URL:

```text
https://your-domain.example
```

Redirect URLs:

```text
https://your-domain.example/
https://your-domain.example/**
https://your-domain.example/auth/callback
```

Для локальной разработки можно добавить:

```text
http://localhost:5173/**
http://localhost:5173/auth/callback
```

Current temporary test deployment example:

```text
Site URL:
https://kub.apollot.ru

Redirect URLs:
https://kub.apollot.ru/
https://kub.apollot.ru/**
https://kub.apollot.ru/auth/callback
http://localhost:5173/**
http://localhost:5173/auth/callback
```

`kub.apollot.ru` is only the current test domain. Do not hardcode it in source
code. When the domain changes, update Coolify/domain proxy settings and
Supabase Auth URL Configuration; the frontend redirect code uses the current
browser origin.

Если это новый Supabase проект, примените все миграции из:

```text
.migration-backup/supabase/migrations/
```

Realtime должен быть включён для таблиц, которые используются realtime-подписками приложения.

## Проверка После Деплоя

1. Откройте production URL.
2. Проверьте, что статические assets грузятся без 404.
3. Обновите `/admin` напрямую и убедитесь, что SPA fallback не отдаёт 404.
4. Проверьте login/register/logout.
5. Проверьте Supabase Redirect URLs.
6. Отправьте realtime-сообщение в чат.
7. Проверьте workflow задач.
8. Проверьте notifications.
9. Проверьте audit tab.
10. Проверьте phone privacy.
11. Проверьте voice messages и microphone permission только по HTTPS.
12. Откройте Network tab, подождите 2 минуты и проверьте отсутствие request storm.
13. Проверьте console errors.
14. Проверьте service worker registration.
15. Проверьте, что frontend bundle не содержит `SUPABASE_SERVICE_ROLE_KEY` или private VAPID values.

Подробный smoke checklist: `docs/SMOKE_TESTS.md`.

## Быстрый Чеклист Coolify

- Repository: `<YOUR_REPO_URL>`.
- Build Pack: Docker Compose.
- Compose file:
  - Coolify proxy: `docs/deploy/docker-compose.coolify.yml`;
  - host Caddy: `docs/deploy/docker-compose.yml`.
- Domain: задаётся в Coolify UI или в host Caddy, не в git.
- Env: задаётся в Coolify UI.
- Rebuild после изменения любых `VITE_*`.
