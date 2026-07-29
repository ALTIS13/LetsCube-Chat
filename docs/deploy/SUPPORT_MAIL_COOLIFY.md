# Почтовый мост поддержки в Coolify

Актуально на 28 июля 2026 года.

`letscube-support-mail` является отдельным непубличным процессом. Он читает
почту `support@app.letscube.ru` через IMAPS, отправляет ответы через SMTPS и
вызывает только server-only RPC self-hosted Supabase. Web-приложение, Edge
Functions и Browser/PWA push от него не зависят.

## Граница безопасности

- Resource не получает публичный домен и не публикует порт в интернет.
- `service_role`, пароль ящика и HMAC-ключи передаются только через server-side
  environment Coolify.
- Эти значения запрещено добавлять в build args, `VITE_*`, frontend, git,
  логи или health response.
- IMAP-письмо отмечается `Seen` только после успешного атомарного RPC.
- В БД сохраняются hash/delivery metadata и текст сообщения тикета. Raw RFC
  source, SMTP response, пароль и адреса маршрутизации в лог не выводятся.
- Вложения первого этапа не импортируются. Письма крупнее 2 MiB и
  автоматические ответы помещаются в quarantine ledger.

## Coolify resource

1. Создать отдельный Git-backed Dockerfile resource из репозитория
   `ALTIS13/LetsCube-Chat`, ветка `main`.
2. Dockerfile path:
   `docs/deploy/Dockerfile.support-mail`.
3. Имя resource: `letscube-support-mail`.
4. Не назначать domain/proxy route.
5. Включить automatic deployment только после первого ручного healthy deploy.
6. Watch paths:
   - `artifacts/api-server/**`
   - `docs/deploy/Dockerfile.support-mail`
   - `docker-compose.support-mail.yml`
   - `package.json`
   - `pnpm-lock.yaml`
   - `pnpm-workspace.yaml`
   - `lib/api-zod/**`
   - `lib/db/**`

Обязательные environment names:

- `SUPPORT_MAIL_ENABLED`;
- `SUPPORT_MAIL_HOST`;
- `SUPPORT_MAIL_IMAP_PORT`;
- `SUPPORT_MAIL_SMTP_PORT`;
- `SUPPORT_MAIL_TLS`;
- `SUPPORT_MAIL_USER`;
- `SUPPORT_MAIL_PASSWORD`;
- `SUPPORT_MAIL_FROM`;
- `SUPPORT_MAIL_FROM_NAME`;
- `SUPPORT_MAIL_POLL_MS`;
- `SUPPORT_MAIL_TRUSTED_AUTH_SERVER`;
- `SUPPORT_MAIL_HMAC_SECRET`;
- `SUPPORT_MAIL_CONTACT_HMAC_SECRET`;
- `SUPABASE_URL`;
- один из `SUPABASE_SERVICE_ROLE_KEY` или `SELFHOST_SERVICE_ROLE_KEY`.

Сначала установить `SUPPORT_MAIL_ENABLED=0`. В этом режиме container остаётся
healthy/ready, но не подключается к IMAP/SMTP.

`SUPPORT_MAIL_CONTACT_HMAC_SECRET` должен совпадать с
`SUPPORT_GUEST_SECRET_HMAC_KEY` Edge Function `support-gateway`. Новый
случайный ключ использовать нельзя: ответы по email перестанут совпадать с
email hash web-тикетов.

`SUPPORT_MAIL_TRUSTED_AUTH_SERVER` должен быть равен hostname локального MTA,
который Mailcow добавляет в `Authentication-Results`. Worker доверяет только
первому локальному результату с этим hostname и принимает письмо при успешном
DMARC или domain-aligned DKIM/SPF. Входной заголовок отправителя Mailcow
удаляет до добавления собственного результата.

TLS обязателен. Worker fail-closed отклоняет конфигурацию с отключённым
`SUPPORT_MAIL_TLS` и не подключается к IMAP/SMTP в plaintext.

## DNS gate

Точные публичные значения сгенерированы на сервере:

`/srv/letscube/ops/support-mail-dns-records.md`

До включения worker должны одновременно пройти:

- MX для `app.letscube.ru`;
- SPF для `app.letscube.ru`;
- DKIM selector `dkim._domainkey.app.letscube.ru`;
- DMARC для `_dmarc.app.letscube.ru`;
- A-запись `mailserver.letscube.ru`;
- PTR основного IPv4 mailserver.

После DNS propagation:

1. Проверить записи через authoritative nameservers и публичные resolvers.
2. Выполнить внешнюю доставку на `support@app.letscube.ru`.
3. Убедиться, что письмо появилось в ящике без вывода его содержимого в
   терминал.
4. Переключить `SUPPORT_MAIL_ENABLED=1` и redeploy resource.
5. Проверить `/healthz` и `/readyz` внутри container.
6. Создать тестовый тикет, ответить оператором, проверить внешнее письмо.
7. Ответить на письмо и проверить добавление сообщения в тот же тикет.
8. Проверить dedupe повторной доставки одного IMAP `UIDVALIDITY:UID`.
9. Проверить quarantine для auto-reply и sender mismatch.
10. Проверить, что письмо для уже закрытого/spam тикета получает
    `ticket_not_writable`, не блокируя обработку следующих писем.
11. Проверить SMTP 4xx retry, SMTP 5xx permanent failure и sweep исчерпанной
    восьмой попытки в `dead`.
12. Проверить ежедневную очистку только старых `quarantined`/`dead` email
    ledger rows.

## Production activation 2026-07-29

- MX, SPF, DKIM and DMARC passed on both REG.RU authoritative nameservers and
  the Google and Cloudflare public resolvers.
- A full pre-enable backup was created at
  `/srv/letscube/backups/automated/20260729-134340`; its `SHA256SUMS` and the
  three database dumps were verified.
- The production environment has `SUPPORT_MAIL_ENABLED=1`; preview remains
  disabled.
- Coolify deployment `t62rj4zw12jp7jgomlfru4va` finished for application
  `letscube-support-mail`. The non-public container is healthy and still runs
  as `node` with a read-only root filesystem, all capabilities dropped and
  `no-new-privileges`.
- One QA operator response traversed the real database trigger, leased outbox,
  worker, Mailcow and Gmail MX path. The ledger reached `sent` in one attempt,
  Gmail returned SMTP `250 2.0.0 OK`, and the local Mailcow queue was empty.
- User confirmation and the reply-to-ticket IMAP intake check remain pending.
  Do not describe the bidirectional mail bridge as fully accepted until that
  reply is attached to the original QA ticket.

## Откат

При проблеме сначала вернуть `SUPPORT_MAIL_ENABLED=0` и redeploy. Тикеты и
in-app чат продолжат работать. Очередь outbound останется в БД для безопасного
повторного запуска.

Migration sources:

- `.migration-backup/supabase/migrations/20260728082213_support_mail_bridge.sql`;
- `.migration-backup/supabase/migrations/20260728085924_support_mail_intake_guard.sql`;
- `.migration-backup/supabase/migrations/20260728092354_support_mail_delivery_hardening.sql`;
- `.migration-backup/supabase/migrations/20260728093755_support_mail_idempotent_delivery_ack.sql`.

Проверенные pre-migration dumps:

- `/srv/letscube/backups/pre-migrations/20260728-before-support-mail-bridge.dump`;
- `/srv/letscube/backups/pre-migrations/20260728-before-support-mail-intake-hardening.dump`.

Потеря ответа БД после принятия письма SMTP обрабатывается повторным
идемпотентным acknowledgement с тем же provider hash. Остаётся узкое
ограничение at-least-once SMTP: аварийное завершение процесса ровно после
приёма SMTP и при полной недоступности БД может потребовать операторской
сверки по детерминированному `Message-ID`.

Удалять таблицы или строки email ledger при обычном откате нельзя.
