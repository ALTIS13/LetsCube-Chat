# Production Debug

## Архитектура

GitHub `main` -> Coolify auto deploy -> Docker Compose -> `127.0.0.1:8095` -> host Caddy -> `https://kub.apollot.ru`.

`kub.apollot.ru` - текущий временный тестовый домен. Смена домена должна требовать только DNS/Caddy/Coolify/Supabase settings, не source code changes.

## Coolify

- Проверить Deployments tab.
- Читать build logs целиком, не только последнюю строку.
- Auto deploy включён от `main`.
- Push в `main` запускает новый deployment.

Частые deploy errors:

- Dockerfile path/context wrong.
- `pnpm` lockfile/install error.
- Missing build args.
- Vite env error.
- Port conflict.
- Неподходящий Node image для native deps.

Локально Docker Desktop не требуется. Docker build/deploy выполняет Coolify на Ubuntu HomeNode.

## Caddy

Текущий Coolify Caddy routing:

- `coolify.apollot.ru /` -> `127.0.0.1:8000`
- `coolify.apollot.ru /app*` -> `127.0.0.1:6001`
- `coolify.apollot.ru /terminal/ws*` -> `127.0.0.1:6002`

KUB должен route:

- `kub.apollot.ru` -> `127.0.0.1:8095`

Useful checks, если есть SSH:

```bash
curl -I https://kub.apollot.ru
curl -I http://127.0.0.1:8095
docker ps
docker logs <container> --tail=150
sudo journalctl -u caddy -n 100 --no-pager
```

## Supabase

Current test Site URL:

```text
https://kub.apollot.ru
```

Redirect URLs:

```text
https://kub.apollot.ru/
https://kub.apollot.ru/**
https://kub.apollot.ru/auth/callback
http://localhost:5173/**
http://localhost:5173/auth/callback
```

Не хардкодить домен в source code. Для auth redirect использовать `window.location.origin` и `BASE_PATH`.

## Known current issues to verify

- Supabase email confirmation redirect UX needs verification after Dashboard URL settings.
- Sidebar/header icons overflow after notifications/tasks additions: fixed once, regressions should be checked at 390/768/1280.
- Voice messages need production smoke-test.
- Request storm fix must be verified in browser Network tab.
