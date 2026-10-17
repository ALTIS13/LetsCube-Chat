# Прогресс агента

Обновлено: 2026-10-17. Канон: `android-current-20261015`, ветка `codex/topic-alerts-20261016`. Секретов в этом файле нет.

## План

1. Автономный цикл и этот журнал.
2. Новая изолированная среда и новые сессии с горизонтом не короче 1170 с. Новый execution nonce. Старый отказ cohort 330 и receipt `f53793ab` не трогать и не вызывать.
3. Один прогон приёмки провода. Fastguard и бюджеты 15 с / 480 с не ослаблять.
4. Production apply только successor-скриптом после принятого провода. Затем Edge/API/web, канарейки, Android 23 после публичных байтов.
5. Чужой worktree стабильности подключения не трогать.

## Сделано

- `8740c61b` выходил как `e0a32b7c`, затем рукопожатие `978617b9`. Оба остались в истории. Текущий веб — `aed60557`, см. раздел релизов.
- Fastguard оставлен как есть: inspect 27412 мс не стартует. Повторно не гонялся.
- Новые сессии созданы. Cohort `0dc06a8873a6`, execution nonce `be7c24f394bb`. Контейнер `letscube-topic-fresh-isolated-0dc06a8873a6`, id `e891b7a0a760e8cf2ca51b53a59f8ec4f9e01e1b884e070524ea1abc65f9f70a`, сеть `none`, статус running. Порты наружу не публиковались.
- Среда собрана из схемы, без копирования строк `auth.sessions` и без копирования ключа подписи. Четыре INSERT, идентификаторы 430–433, `not_after` = время транзакции плюс 90 минут. UPDATE и DELETE не было. Старые строки cohort 330 не продлевались.
- Сразу после вставки: 4 строки, горизонт 5399 с, публичные таблицы без RLS: 0. Один запрос занял 159 мс; fastguard вернул `PARENT330_FASTGUARD_WITHIN_BUDGET` и inspect не запускал.
- Отказ cohort 330 (`e49ffc4f38f7`, receipt `f53793ab`, proof `b099014b`) остался записью. Этот cohort не вызывался.

- На старте этого захода горизонт 430–433 был 4895 с, четыре строки на месте. Новый cohort не создавался, строки не обновлялись.
- Один successor-провод в `READ COMMITTED` принят: горизонт 4863 с, 670 мс, fastguard `WITHIN_BUDGET`, inspect не стартовал, один backend pid, CAS `applied` revision 1, режим `disabled`, rollback runtime `false`, фазы 3. Readback после COMMIT: runtime `false`, mode `disabled`, revision 1, строк 4. Cohort 330 не вызывался.
- Production: свежий backup 6448310 байт в `/srv/letscube/backups/notification-coordinated-20261017`, архив читается. Миграция `20261017104253_coordinated_notification_release.sql` применена один раз. После неё topic runtime `false`, web runtime `false`, RLS обеих таблиц включён, setter есть.
- `main` быстро перемотан `978617b9..aed60557`. Образ веба `l64kyyu1sysev2izzjjbizhe:aed605574697db46f5a101d2f1f664a1cd33cc94`, healthy, прежний контейнер снят. Публичный бандл `/assets/index-CW9ih_wQ.js` содержит `topic_notification_preference_set`. API-образ `fkd10qwlo4qod9e6gtyzzuwk:aed605574697db46f5a101d2f1f664a1cd33cc94`, healthy, прежний снят.
- Edge `send-push-notifications` обновлён пятью файлами, три прежних сохранены рядом с backup. `supabase-edge-functions` после перезапуска healthy. Android 23 не публиковался: публичные байты APK в этом заходе не проверялись.

## Не сделано

- Android 23 Stable. Публичные байты APK не сверялись, поэтому публикация не запускалась.

## Блокеры

Нет блокера на провод и SQL. Android ждёт отдельной сверки публичных байтов.

## Что делается

Журнал фиксирует принятый провод и выкат веба, API и edge.

## Проверки

- Горизонт перед прогоном: 4895 с. Прогон: `READ COMMITTED`, горизонт 4863 с, 670 мс, CAS revision 1, rollback runtime false.
- Production readback: оба runtime false, RLS true, setter true. Backup 6448310 байт.
- Живой веб и API на `aed605574697db46f5a101d2f1f664a1cd33cc94`. Маркер `topic_notification_preference_set` в `/assets/index-CW9ih_wQ.js`.

## Миграции

`20261017104253_coordinated_notification_release.sql` применена в production после проверенного backup. Оба runtime оставлены выключенными. RLS не отключался.

## Релизы

Stable веба и API: `aed605574697db46f5a101d2f1f664a1cd33cc94`. Предыдущий `978617b9` остался в истории и не затирался. Android 23 не опубликован.

## Следующее действие

Сверить публичные байты Android 23 с каталогом и только после этого публиковать. Runtime уведомлений в production остаются выключены, пока не будет отдельного включения.
