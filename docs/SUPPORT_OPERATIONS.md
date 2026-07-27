# Эксплуатация поддержки LETSCUBE

Актуально на 27 июля 2026 года.

Документ описывает публичную форму поддержки, гостевой чат и операторскую
очередь. Он не содержит паролей, ключей, CAPTCHA secrets или контактных данных
пользователей.

## Точки входа

- `https://app.letscube.ru/support` — форма и гостевой чат без обязательной
  регистрации.
- `https://app.letscube.ru/privacy` — действующая политика
  конфиденциальности.
- `/admin/support` — рабочее место авторизованного оператора.
- `support@app.letscube.ru` — планируемый адрес входящей почты. Почтовая
  доставка не считается включённой до отдельной настройки Mailcow и DNS.

In-app уведомления являются источником состояния. Системные уведомления не
содержат имя, email, телефон или текст обращения: только идентификатор тикета
и тип события.

## Публичный сценарий

1. Пользователь указывает имя, email для ответа, телефон в международном
   формате, категорию, тему и сообщение.
2. Пользователь принимает политику конфиденциальности и проходит Yandex
   SmartCaptcha.
3. `support-gateway` проверяет origin, honeypot, время заполнения, поля,
   CAPTCHA и rate limits.
4. Backend создаёт тикет, контактную запись, первое сообщение и гостевую
   сессию.
5. В браузер один раз возвращается случайный guest secret. Он сохраняется
   только в IndexedDB этого устройства. В БД хранится HMAC digest.
6. Чат открывается сразу. Ссылка из email для первого входа не требуется.

Guest secret запрещено помещать в URL, `localStorage`, аналитику, error report
или application logs. Кнопка «Забыть обращение на этом устройстве» отзывает
сессию и удаляет локальную копию.

## Очередь и статусы

Поддерживаются статусы:

- `new` — новое обращение в общей очереди;
- `in_progress` — обращение закреплено и обрабатывается;
- `waiting_user` — требуется ответ пользователя;
- `waiting_support` — требуется действие поддержки;
- `escalated` — нужна помощь старшего оператора;
- `resolved` — решение предложено;
- `closed` — обращение закрыто;
- `spam` — обращение классифицировано как спам.

Принятие тикета атомарно: при одновременной попытке двух операторов только один
получает назначение. Передача, возврат в пул и эскалация требуют комментария.
История действий append-only и не редактируется оператором.

Контактные данные в общей очереди маскируются. Полные контакты видит
назначенный оператор либо пользователь с `support.manage`. Поиск клиента
разрешён только через ограниченный RPC и оставляет audit event.
Список получателей для передачи формируется отдельным RPC и включает только
пользователей с обоими правами `support.view` и `support.reply`; произвольные
профили в этот список не попадают.

## Разрешения

| Разрешение | Назначение |
| --- | --- |
| `support.view` | Просмотр очереди и метаданных обращений |
| `support.claim` | Принятие обращения из общего пула |
| `support.reply` | Ответы в закреплённом обращении |
| `support.transfer` | Передача коллеге и возврат в пул |
| `support.escalate` | Передача старшему оператору |
| `support.lookup_customer` | Ограниченный и аудируемый поиск клиента |
| `support.manage` | Управление всеми тикетами и полными контактами |
| `support.settings` | Режим приёма, текст закрытия и rate limits |

`owner` и `tech_admin` получили все support permissions. Остальным ролям они
выдаются явно через существующую систему динамических ролей. Frontend не
использует `service_role`.

## Уведомления

- Авторизованные операторы с `support.view` видят вкладку «Поддержка».
- Новые тикеты и возвраты идут в пул с учётом operator preferences.
- Assigned operator получает события передачи и новые ответы пользователя.
- Эскалации получают пользователи с `support.escalate` или `support.manage`.
- Авторизованный requester получает безопасные статусы ответа, решения и
  закрытия в системной категории.
- Маршрут строится только из валидного UUID тикета. Значение `payload.route`
  не считается доверенным.
- Оператор отдельно настраивает уведомления о новых тикетах, ответах,
  передачах и эскалациях.
- Отключение системных уведомлений поддержки подавляет только web/native
  push outbox. In-app запись остаётся источником состояния и продолжает
  синхронизироваться между устройствами.

Windows notification adapter использует ту же безопасную копию и внутренний
маршрут. Browser/PWA push, message grouping, task notifications и chat read
sync остаются отдельными существующими путями.

## Защита от злоупотреблений

Начальные значения:

- не более 3 новых тикетов за 15 минут;
- не более 10 новых тикетов за сутки;
- не более 20 сообщений за 5 минут;
- не более 200 сообщений за сутки.

Ограничения хранятся в `support_settings` и меняются только с
`support.settings`. Persistent rate-limit signals являются основным
ограничителем; in-process limiter Edge Function — дополнительным.

При атаке:

1. Отключить guest intake, сохранив доступ к существующим обращениям.
2. Проверить rate-limit signals и журналы без выгрузки PII в общий канал.
3. При необходимости снизить лимиты.
4. Не блокировать весь `app.letscube.ru`, если достаточно отключить приём.
5. Зафиксировать время, характер инцидента и выполненные действия.

## Edge Function

Функция: `support-gateway`.

Обязательные имена secrets/environment variables:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `YANDEX_SMARTCAPTCHA_SECRET`;
- `SUPPORT_GUEST_SECRET_HMAC_KEY`;
- `SUPPORT_ALLOWED_ORIGINS`.

Значения хранятся только на сервере. Production origin:
`https://app.letscube.ru`.

Маршруты:

- `POST /tickets`;
- `GET /tickets/:id`;
- `POST /tickets/:id/messages`;
- отзыв гостевой сессии.

Self-hosted Kong сейчас может выставлять общий response CORS header `*`.
Функция всё равно fail-closed отклоняет неподходящий `Origin` до обработки
данных. Общую Kong-конфигурацию нельзя менять точечно без regression QA других
Edge Functions.

## Миграция и backup

Применённые migration sources:

- `.migration-backup/supabase/migrations/20260727_privacy_support_ticketing_foundation.sql`;
- `.migration-backup/supabase/migrations/20260727_support_operator_delivery_hardening.sql`.

Перед production apply были созданы и проверены dumps:

- `/srv/letscube/backups/pre-migrations/20260727-100210-before-support-ticketing.dump`;
- `/srv/letscube/backups/pre-migrations/20260727-105107-before-support-delivery-hardening.dump`.

Второй forward migration прошёл `BEGIN ... ROLLBACK` rehearsal на действующей
схеме, затем был применён одной транзакцией. Он не удаляет строки и добавляет
permission-scoped каталог операторов, полные настройки ticket/message limits,
учёт transfer preferences и OS push guard для двух outbox.

Безопасный порядок повторного развёртывания:

1. Проверить свежий полный backup и `pg_restore -l`.
2. Восстановить dump во временную БД.
3. Применить migration с `ON_ERROR_STOP=1`.
4. Проверить таблицы, RLS, grants, RPC и publication.
5. Применить production migration одной транзакцией.
6. Выполнить synthetic guest RPC smoke с rollback.
7. Развернуть `support-gateway` и выполнить allowed/disallowed-origin smoke.
8. Выполнить multi-role RLS smoke.
9. Только после этого развернуть frontend.

Миграция additive, но автоматического destructive rollback нет. При ошибке до
commit транзакция откатывается. После появления реальных тикетов удалять
таблицы нельзя: исправление выпускается forward migration. При критической
порче применяется проверенный restore runbook и указанный pre-migration dump.

## Retention

`support_retention_candidates()` только перечисляет кандидатов и ничего не
удаляет. Guest sessions имеют idle и absolute expiry. Автоматическая
анонимизация/удаление, взаимодействие с backup retention и restore rehearsal
остаются отдельным production этапом.

## Ограничения текущей версии

- Вложения в support-чате отключены до quarantine bucket, проверки сигнатур,
  MIME, размера и malware scanning.
- SMTP/IMAP ingestion и ответы через `support@app.letscube.ru` не включены.
- Автоматический retention scheduler не включён.
- Политика требует итоговой юридической проверки перед Microsoft Store и
  публичным массовым запуском.
- Guest session восстанавливается только на том устройстве, где сохранён
  IndexedDB secret; email recovery намеренно не используется в первом этапе.
