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
- D-084: карточка обратной связи больше не складывает заголовок и пояснение в две строки. Тест `tests/unit/feedback-card-line.test.mjs` был красным на `items-start` и стал зелёным. Runtime не включались, Android 23 не публиковался, образ не менялся.

## Не сделано

- Включение topic/Web runtime. `release-map-20261017.md` разрешает его только когда потребители готовы и пройдены канарейки Web Push/FCM/sound/Windows и установленный Home Screen iPhone с читаемым текстом. iPhone — гейт того же выпуска, доказательства нет. Включение разослало бы доставку живым людям, поэтому runtime оставлены выключенными. Legacy sender не включался.
- Android 0.1.22/build 23. Окно receipt кандидата `c6c67368` истекло в 16:47:56 UTC. Preflight в 16:50:21Z вернул `MAIN_BASE_CHANGED`: скрипт принимает сборку только если `origin/main` равен базовому `05f72b25` или самому коммиту кандидата, а main уже `aed60557`. Публикация по карте выпуска идёт после канареек, поэтому кандидат не публиковался, A063 не трогался, поверх личной релизной сборки ничего не ставилось.

## Блокеры

Канарейка iPhone Home Screen с читаемым текстом не выполнена. Без неё runtime не включается и Android 23 не публикуется.

## Что делается

Журнал фиксирует отказ включать runtime и публиковать Android до этой канарейки.

## Проверки

- Провод не переигрывался. Образ не менялся: `l64kyyu1sysev2izzjjbizhe:aed605574697db46f5a101d2f1f664a1cd33cc94`.
- Android preflight: `REFUSED` / `MAIN_BASE_CHANGED`, `published: false`, `deviceEffects: false`.

## Миграции

Production-миграция не повторялась. Оба runtime по-прежнему выключены.

## Релизы

Живой веб и API остаются на `aed605574697db46f5a101d2f1f664a1cd33cc94`. Android 23 не опубликован.

## Следующее действие

Канарейка установленного Home Screen iPhone на устройстве владельца. До неё runtime не включать. Android 23 не собирать в обход `MAIN_BASE_CHANGED`: скрипт примет новый кандидат только если HEAD и `origin/main` совпадают с `aed60557`, а текущая ветка уже впереди документами. D-084 сведён к одной строке карточки; это не канарейка и не Android.
