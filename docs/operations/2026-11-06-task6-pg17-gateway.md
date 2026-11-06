# Task6: изолированная приёмка PG17, PostgREST и Auth

**Статус, 2026-11-06:** минимальный HTTP-сценарий публикации текста принят на
локальном PostgreSQL 17.6 + PostgREST 14.12 + GoTrue v2.189.0. Отдельный
дельта-прогон подтвердил HTTP-путь bot gateway и обе очередности между
публикацией и отзывом роли. Это результат Task6 для неизменённого proposal,
не разрешение на rollout.

## Разделение доказательств

- [Предыдущая проверка](2026-11-06-task6-publication-permission.md#staged-verification-and-rollout-gate):
  PGlite PostgreSQL 18.3, 18 passed и один исторический opt-in RED пропущен.
  Она охватывает больше SQL-путей, но использует адаптер HTTP/Auth. Не повторялась.
- Здесь: реальные Windows-процессы, TCP на `127.0.0.1`, отдельный временный
  кластер PostgreSQL (server_version_num `170006`, проверен его data directory),
  прямой PostgREST и обычный вход в GoTrue. Схема приложения минимальная:
  реальные политики INSERT/SELECT, функции и sender guards из репозитория на
  синтетических таблицах. Схему Auth и `auth.uid()` создали штатные миграции
  GoTrue. Три вымышленных пользователя вошли по паролю через
  `POST /token?grant_type=password` после локальной регистрации с автоподтверждением.
  Каждый JWT сопоставлен со своей строкой `auth.sessions`; PostgREST подтвердил
  subject, роль `authenticated` и активный RLS. JWT с испорченной подписью получил
  `401`. Гость действительно работал как `anon`, без JWT.

## Наблюдения

Запросы шли в `/messages` с независимой проверкой БД по точному
`client_message_id`. Для успехов проверены ID строки, чат и автор.

| Проверка | HTTP / SQLSTATE | БД или чтение |
| --- | --- | --- |
| До установки: обычный участник пишет в channel | `201` | 1 строка (контроль прежнего поведения) |
| Owner и admin публикуют в channel | `201` каждый | По 1 строке |
| Гость пытается публиковать от имени owner | `401 / 42501` | 0 строк |
| Гость читает точную публикацию owner | `200` | 0 видимых строк |
| Member читает точную публикацию owner | `200` | 1 видимая строка |
| Member пытается публиковать в channel | `403 / 42501` | 0 строк |
| Тот же member пишет в обычную group | `201` | 1 строка |
| После смены owner: прежний owner с тем же JWT | `403 / 42501` | 0 строк |
| После смены owner: новый owner с тем же JWT | `201` | 1 строка |
| После rollback: прежний owner, теперь member | `201` | 1 строка |

Все отказы на публикацию вернули `channel_publication_forbidden`.
Роли сменены одной транзакцией fixture; API передачи владения не проверялся.
[Forward SQL](../proposals/2026-11-06-task6-channel-publication.sql) выполнен
на нулевом prestate: синтетический контроль прежнего поведения удалён перед
установкой, trigger и function появились, политики messages не изменились.
[Rollback SQL](../proposals/2026-11-06-task6-channel-publication.rollback.sql)
удалил обе сущности и сохранил политики и содержимое всех трёх прежних строк
channel (хеш полных строк совпал, все три остались читаемыми).

## Воспроизведение и предел

- Исторический [PG17 full-schema](2026-10-03-bot-media-authority-full-schema.md)
  фиксирует `supabase/postgres:17.6.1.136`, а
  [исторический HTTP-runner](2026-10-16-topic-notification-overrides.md#postgrest-runtime-and-fresh-guard-batching) фиксирует
  PostgREST 14.12. Старые runners в
  `.ops-private/topic-notification-overrides-20261016/` привязаны к
  клонам на production-хосте и не запускались. Локальный Docker engine не
  отвечал: отсутствовал pipe `dockerDesktopLinuxEngine`; локальная Ubuntu WSL
  не смогла запустить shell. Общие службы не запускались и не менялись.
- Использованы [EDB PG17.6 Windows](https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip)
  (MD5 совпал с метаданными архива) и
  [PostgREST 14.12 Windows](https://github.com/PostgREST/postgrest/releases/tag/v14.12)
  (SHA-256 совпал с digest релиза). [GoTrue v2.189.0](https://github.com/supabase/auth/releases/tag/v2.189.0)
  собран Go 1.25.8 из коммита `4fa66ba71d8c55b5c95cd5635766ed8bbae6d96a`.
  Неизменённый upstream не компилировался на Windows из-за Unix-only
  `SO_REUSEPORT`; единственное изменение в ignored-копии убирает эту опцию
  у одиночного listener. Обработчики Auth, подпись JWT и SQL не менялись.
- SHA-256 точных proposal/rollback:
  `a402952c01d923e767df79ae67303327daf2ef20badcfd7782a303a9c970b14d`,
  `6e79897e6810fe61dec61e412f3e7a049ed0a21a5b0882ebc619023a41e62ee9`.
- Локальные runner, fixture и обезличенный `evidence.json` находятся в
  ignored `.ops-private/task6-pg17-gateway-20261106/`. Из корня репозитория:

  ```powershell
  $env:KUB_QA_ALLOW_MUTATIONS = '0'
  node .ops-private/task6-pg17-gateway-20261106/run.mjs
  ```

  Exit `0`, `pass: true`, `cleanup.ok: true`. SHA-256 receipt:
  `b1ac2bc29a829b5f58f24b2db4dded0fdf3d3a8caff8572a9cba4c8babf4c7f6`.
  Остановлены только процессы
  прогона, три loopback-порта закрыты, временный кластер удалён. Нет prod
  подключений, учёток, записей, миграции или релиза.

## Дельта: bot gateway и блокировки

Новый кластер на тех же бинарниках. Принятые текстовые кейсы не повторялись,
`evidence.json` не изменился. Запущен реальный
[Express bot gateway](../../artifacts/api-server/src/bot/app.ts) с его
штатными token repository, обработчиком `sendMessage`, Supabase SDK и
PostgREST. Loopback relay только снимает префикс `/rest/v1` для трёх
RPC; ответы не эмулируются. В fixture взяты реальные SQL тела
`bot_token_lookup_internal`, `bot_token_touch_internal`,
`bot_message_command_internal`, `bot_send_message_internal`,
membership authorize и функции идемпотентности. Одноразовый сервисный JWT
и bot-токен созданы только для этого кластера.

| Запрос по HTTP | Результат |
| --- | --- |
| Тот же префикс bot-токена, неверный секрет | `401 unauthorized` после реального lookup, command RPC не вызван |
| Активный бот с допуском `send_message` публикует в channel | Gateway `403 forbidden`; PostgREST `403 / 42501 channel_publication_forbidden`; 0 сообщений и 0 строк в обеих таблицах идемпотентности |
| Тот же бот пишет в обычную group | `200`; ответ связан с одной строкой сообщения и двумя записями идемпотентности |
| Тот же запрос в channel после точного rollback | `200` с тем же bot-токеном, payload и idempotency key; одна строка сообщения и две записи идемпотентности. Отказ ключ не занял |

Бот отклоняется до блокировок издателя. Для их проверки использованы два
разных PG17 backend PID: writer с проверенным Auth subject и активным RLS
`authenticated`, revoker с точным fixture UPDATE роли `admin → member`.

- **Отправка первой:** успешный INSERT удержан внутри транзакции. Для
  revoker строка ещё не видна; `pg_blocking_pids` показывает writer как
  единственного блокирующего. После commit writer отзыв завершился,
  сообщение стало видно ровно один раз.
- **Отзыв первым:** незакоммиченный UPDATE удерживает membership.
  INSERT падает из Task6 guard на `chat_members` с `55P03` при
  `lock_timeout=0`, а не после таймаута ожидания. После commit отзыва
  повтор с теми же claims и `client_message_id` получает
  `42501 channel_publication_forbidden`. Ни первая попытка, ни повтор не
  оставили строки. Это граница `FOR SHARE NOWAIT`: не использовать
  видимую старую роль и не ждать, пока решится отзыв.

```powershell
$env:KUB_QA_ALLOW_MUTATIONS = '0'
node .ops-private/task6-pg17-gateway-20261106/run.mjs --delta
```

Exit `0`, `pass: true`, `cleanup.ok: true`. SHA-256
`evidence-delta.json`: `037b8b56f19c02a0f4db7793a9e68294d1c87b52b0c16491d2ce393b0296d7e5`.
Оба PG-сеанса закрыты, все четыре loopback-порта закрыты, временный кластер
удалён. Proposal/rollback остались побайтно прежними. Production не затронут.

**Открыто:** полный стенд с Kong и Realtime, совместимость полной схемы и
live UX. Bot receipt относится к HTTP `sendMessage`, не к entrypoint с
фоновой доставкой, управлению ботами, медиа или Storage. Lock receipt
относится к membership на пути INSERT; не проверялись API отзыва,
клиентский retry/HTTP-маппинг `55P03`, отдельная блокировка строки чата
или UPDATE сообщения. Следующий стендовый шаг: повторить оставшиеся
интеграции в полном изолированном стеке без production-данных.
