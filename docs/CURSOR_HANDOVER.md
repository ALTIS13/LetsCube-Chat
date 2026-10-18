# LETSCUBE: передача работы в Cursor

> Исторический срез. После возвращения к Codex 18 октября текущие исходники,
> состояние продакшена и следующий шаг находятся в [HANDOVER.md](HANDOVER.md) и
> [актуальном отчёте](operations/2026-10-18-cursor-return-notifications.md).
> Нижние сведения о ветке основной папки, выключенном Web-предпросмотре и
> отсутствии production SQL больше не описывают текущее состояние. Не повторять
> старые подготовительные сценарии или публикацию старого Android-кандидата.

Срез: 17 октября 2026, 12:46 UTC. Это инструкция для продолжения, **не отчёт об
успешном Stable**. Новое приложение не опубликовано. Прод не менялся в текущем
этапе. Команды ниже не следует выполнять автоматически при чтении документа.

## 1. С чего начать

1. Прочитать `AGENTS.md`, `docs/HANDOVER.md`,
   `docs/operations/working-lessons.md`, затем `CLAUDE.md`. Разделы1–2 последнего
   устарели; эксплуатационные правила, БД и deployment остаются обязательными.
2. Открыть **канонический worktree**, не переключать ветку в общей основной папке:
   `C:/Users/maksi/.codex/worktrees/android-current-20261015/LetsCube-Chat`.
   Ветка: `codex/topic-alerts-20261016`. Последний исходный checkpoint до этой
   передачи:326544b4; исполняемый продукт и Android-кандидат:C6c67368.
3. Проверить `git status`, branch и новый `origin/main`. Не reset/stash/clean.
   Repo: `ALTIS13/LetsCube-Chat`. Push в main запускает прод через Coolify.
4. Прочитать текущий план
   `docs/superpowers/plans/2026-10-16-topic-notification-overrides.md`,
   отчёты `docs/operations/2026-10-16-topic-notification-overrides.md` и
   `docs/operations/2026-10-17-coordinated-notification-release.md`.
5. Локальная подробная хронология находится в **каноническом** ignored-файле
   `.superpowers/sdd/2026-10-16-topic-notification-overrides/progress.md`.
   Его нет в Git. Принятые проверки оттуда не повторять без изменившегося входа.

Основная папка `D:/CodexProjects/LetsCube-Chat` — НЕ текущая release-ветка:
там `codex/bot-inline-media-20261002` и чужие незавершённые изменения. Не переносить
туда весь worktree и не подтягивать main поверх dirty state. На рабочем столе
может оставаться junction; перед файловыми операциями разрешать реальные пути.

## 2. Что за продукт и чего хочет владелец

LETSCUBE — самостоятельный мессенджер, не приложение компьютерного клуба.
Публично не писать KUB/КУБ/кибер-арена/компьютерный клуб. Внутренние `kub`
идентификаторы, package id и API-контракты не переименовывать без необходимости.

- Web: React/Vite в `artifacts/kub`; Windows: Tauri remote-web shell;
  Android: Capacitor с ВСТРОЕННЫМ web bundle, не загрузкой сайта.
- Backend: self-hosted Supabase, Postgres/RLS/Auth/Realtime/Storage;
  API/worker в `artifacts/api-server`, отдельный Bot Gateway, LiveKit.
- Сохранять актуальный Liquid Glass дизайн. Discord — основной референс механик,
  Telegram — для чатов/медиа/папок. Не выдавать воспоминание о клиенте за факт:
  датированные наблюдения в `docs/operations/reference-clients.md`.
- При прямом поручении продолжить владелец разрешает обычные обратимые решения,
  проверенные изменения БД, native build/sign/install/publication и deployment
  без очередных подтверждений. Это НЕ отменяет технические release-гейты.
- Новые source-тесты не равны реальному HTTP, provider push, native или iPhone QA.
- Текст push на iPhone должен войти в ТОТ ЖЕ релиз, что текущая работа над
  уведомлениями; не откладывать незаметно отдельным обещанием.
- Windows пока распространяется без Authenticode по решению владельца. Не
  обещать отсутствие SmartScreen, не менять Store/MSIX/PFN/package identity.

## 3. Прод и доступы

- Web: `https://app.letscube.ru`; API/releases: `https://api.letscube.ru`.
- Supabase: `https://core.letscube.ru`; Coolify: `https://deploy.letscube.ru`.
- SSH: `ms.letscube.ru:22`; ранее157.22.206.43, актуальность проверить.
- SSH identity file: `C:/Users/maksi/.ssh/letscube_ed25519`.
- Приватные данные: `D:/CodexProjects/LetsCube-Chat/.ops-private/`.
  Читать только нужный файл; не искать/печатать весь каталог с credentials.
- Текущие приватные release-материалы:
  `.ops-private/topic-notification-overrides-20261016/` (далее BASE).
  Доступны на этом ПК, **не лежат в Git** и не должны туда попасть.

Последнее подтверждённое наблюдение прода12:04 UTC: web05f72b25,
worker8da252ad, Edge supabase/edge-runtime1.74.0. Оба worker opt-in
`PUSH_DISPATCHER_ENABLED` и `NOTIFICATION_FEED_MAINTENANCE_ENABLED` unset/OFF.
Не включать legacy sender попутно: нельзя создать двух владельцев доставки.
Перед действием проверить текущее состояние заново; это датированный снимок.

Реальный bind Edge:
`/srv/letscube/platform/supabase-docker/volumes/functions` ->
`/home/deno/functions`. В `send-push-notifications`8 старых исходников и4 чужих
`.bak`;2 новых helper-файла ещё отсутствуют. Существующие8 совпали с origin05f.
Все4 `.bak` сохранить. Одного копирования кода недостаточно для reload runtime.

Поддерживаемый SSH helper — BASE/../native-preview-task5-metadata-observer-20261009/
`retirement-db.mjs`, SHA256
`37c928368882bf13e4d3e3d28a9bd4e71b66e7cc46a1f0d6babc0942a036ad16`.
Использовали ТОЛЬКО `remote(argv,stdin,seconds)`. Его `sql()`/`exactTarget()`
нацелены на production, не применять для QA. Нельзя печатать raw exceptions,
stderr/stack или data-URL с программой: они могут содержать секреты.

## 4. Что уже готово и повторять не надо

- Реализованы source-контракты per-topic notification choices, source/access
  recheck, immutable subscription descriptors, terminal suppression, session
  ownership, browser settings/lifecycle и revocable Web preview grants.
- Web push payload остаётся generic; rich text получаем через ограниченный
  отзывной grant. Нельзя просто отправить текст всем в payload. Explicit opt-in
  текущей установки, live session, descriptor/revision, logout/None retirement,
  одно первое отображение и generic fallback обязательны.
- Пройдены scoped DB/browser/worker/ownership/legacy проверки и mutation controls,
  typecheck, API/web build;4 точных settings render1440/390 light/dark просмотрены.
  Их точные результаты/хеши в release-отчёте/ledger, не запускать всё снова.
- Свежая production logical backup и isolated recovery VERIFIED:
  raw proof `3b4692b213fcba65fb27e5cc4eb7c562ab1bb738fb505f3b78854f513d47f73d`.
  Серверный root `/srv/letscube/backups/topic-alerts-release-20261017-r6`.
  Все768 constraints проверены; raw rows/globals не скачивались.
- Полная миграция из7 частей исполнялась на R6 с единственной заменой финального
  COMMIT на ROLLBACK;173 таблицы,10 sequences, catalog/data/epoch неизменны.
  Proof `fd5baacfbb76057ab9681aeebea1ff8d0169c5c8d28739b7b8775542beb3f73a`.
- Миграция `supabase/migrations/20261017104253_coordinated_notification_release.sql`
  и byte-identical mirror в `.migration-backup/supabase/migrations/`:
  SHA256 `27f6be346d6834280f9cdba729b264010426f7b1258483cfffb656746f150252`,
  145510 bytes/195 statements. В production НЕ применялась. R6 не удалять/reset.

### Android-кандидат

0.1.22/build23, product source
`c6c67368c279cb8467618abdae0e71ff9cb4a35e`, завершён10:47:56 UTC.
BASE/`android23-c6c67368c279-r1/` содержит готовые APK/AAB и доказательства.

- APK7754379 bytes:
  `13fc9b7d3558df1a9a7ff80b40ec22b444f47036363afa6e4b957dcabae27ff2`.
- AAB7386126 bytes:
  `fd3523a28679132d0f461fd46d6f1e9c3b7b03d16db3c4eef3fc00fbf0fdceb3`.
- Package `com.kub.messenger`; production signer
  `ac8249647e3e32b32e7dba283c6c7bc835f293401a3cf82115901ce74f4a0839`.
- Actual Firebase4, signatures, QA/debug=false, assets/config/DEX parity и
  private-value scan проходят; SWcaa4d8b78f906990.
- Не опубликован/не установлен. Receipt window до16:47:56 UTC — проверить его
  правила перед использованием, не переписывать expired receipt. Docs-only
  изменения сами по себе НЕ причина пересобирать неизменный product tree.
- Последний известный публичный Android Stable0.1.21/build22, Windows0.2.14.
  Windows remote renderer не требует нового EXE без shell/Rust изменений.

## 5. Точный блокер Stable и новая точка остановки

QA R5 — ИЗОЛИРОВАННАЯ база, не production:
CID `a743bac851223e88c09c76bf338ab6ee224464f5e226896dd8e46df848ea1bb4`,
cluster7697492762684891153; root
`/srv/letscube/backups/topic-alerts-fullstack-20261017-r5`.
Network none, без host binds/ports, `/qa` socket, cron/pg_net выключены.
Не менять HBA/listeners/супервизор, не пересоздавать/reset/seed retained clone.

Исторические94/552/d8/230 НЕ повторять и не продлевать. Ошибка552 — не
инициализированные часы harness, а не продукт. d8 не имел достаточной
диагностики. PUBLIC Docker probef023 подтвердил только liveness клиента.

Новый cohort330..333:

- Cohort nonce `e49ffc4f38f7`; BASE/`cohort330-e49ffc4f38f7/`.
- Operatorcf554610 исправляет доказанную ошибку сравнения raw proof с его
  сокращённой projection. Старый59a8 сохранён. Это не ослабление raw SHA.
- Фактические backup/preflight/append/cold readback приняты: старые124 сеанса
  сохранены, теперь128. Никаких TTL/update/renewal старых сеансов.
- Baseline SHA
  `47150b3cb837a841b4638a9e72316358be5de279a648492f6bf8007cf12abd36`.
- Server-only raw session backup SHA
  `4289a70e0cad2f3890176ad2608c864fb03b87236490558624de14bf5d530d6d`.
  Только custody reference; НЕ скачивать/embedding эти строки.
- Known COMMIT receipt SHA
  `f53793abe51161852ce32b3e956f26ebab423c4ec41c0c61b90c0eca372bb4e7`.
- Parent source568519e2, CLI91d08bdf, run program880ad82e;11+10 source checks.
  Independent source review не нашёл P1/P2, но это не runtime acceptance.
- Actual run REFUSED, raw proof
  `b099014b0241af5244ac1815babe29e79134971d980220be64d40aa4c782fb05`.
  Локальный полный raw: `spent-parent-raw.json`; projected envelope:
  `rt-parent330-e49ffc4f38f7-run-result.json`, SHAf789ab06.
- **Причина ДОКАЗАНА** диагностикой5d96962c: первый inspect получает ответ за
  27.412s (fresh-before13.417s + checkpoint0.765s + fresh-after13.230s),
  тогда как клиент ограничен15s. Clientexit1/REFUSED/inspectCount1, stderr0,
  noOOM, validator жив. Не менять15s/480s и не убирать closing guards.
- Все4 процесса REMOVED, tenant RETIRED, cleanupFailure=null. Сейчас нет
  работающего exec/CPJ, арендованного устройства или фоновой автопродолжалки.

### Ближайшие действия

1. Сделать batched эквивалент свежих guard-проверок. Уже есть подходящий шаблон:
   BASE/`fullstack-http-fast-probe.mjs` и `fullstack-http-fast-timing.mjs`.
   Сохранить все physical epoch, process/file/permission/config/SQL/closing
   проверки, но собрать Docker/Perl/SQL чтения в конечный batch вместо десятков
   повторных docker exec. Не кешировать старый PASS и не увеличивать таймаут.
   **Новый fastguard пока НЕ реализован**, есть только анализ/ABI.
2. Новый execution nonce, но ORIGINAL e49 cohort + knownf537 COMMIT. Explicit
   prior b099 cleanup authority, оригинальные128 sessions/TTL, свежий horizon
   >=1170s. Никакого append/renew/reset/replay. Новый once-marker и namespace.
   Предлагаемый статус `R5_330_CONTINUATION_CAS_ROLLBACK_COMPLETED` либо
   `R5_330_CONTINUATION_REFUSED_NO_RETRY`; execNonce/cohortNonce раздельно.
   `parent330-continuation.test.mjs` SHA6cd2d370 — ожидаемый RED0/3,
   constructor/CLI пока отсутствуют. Если horizon истёк — это не permission
   продлить его или подменить receipt; потребуется отдельный обоснованный план.
3. Сделать реальный same-client wire/CAS/rollback с быстрыми guards, retain raw
   proof, exact cleanup и closing catalog. Не записывать REFUSED как accepted.
4. Web HTTP19: prepared `web-preview-host.mjs` SHAfb0f43ce,13 focused PASS;
   `web-preview-http-runtime-adapter-boot.mjs` SHA34d9, старыйb542 сохранён.
   Фабрика поднимает собственные ограниченные Perl/PostgREST после cleanup
   родителя, Web DDL/enable только в R5, ordinary subscriptions BEFORE messages,
   topic21, SIDs300/301. Source-only, никакого actual HTTP результата нет.
5. **Открытый P2 review Webhost:** default `spawnProcess` в host:262 не наследует
   исправленный host environment и возвращает broken minimal-env SSH path
   (`fullstack-http-transport.mjs:197`). Воспроизвести/починить и закончить review.
   Review остановлен, нельзя считать fb0f прошедшим весь independent review.
6. `production-coordinated-apply.mjs` f515 — source-only, требует реального
   старого330 success. Нельзя подавать ему relabeled continuation. Нужен явный
   successor под новые exec/cohort/source/fastguard pins; старыйf515 сохранить.
   Webhost тоже должен явно принять новый контракт, а не менять hash вслепую.
7. Production: свежая проверка backup/epoch/schema, raising transaction с обоими
   runtime OFF, затем bound Edge/API/web consumers. Edge source operatorb375
   (11 focused PASS) описан в BASE/`coordinator-edge-release.md`: backup и atomic
   RENAME_EXCHANGE, сохранить4 `.bak`, no fallback/restart/retry; actual Linux
   syscall и SQL receipt ещё НЕ приняты. Отдельный controlled runtime reload.
8. Проверить реальные image tags/public-container content parity/rollback,
   явно включить согласованные runtime, выполнить provider/Android/Windows/
   HomeScreen iPhone canaries. Затем опубликовать Android23 Stable и проверить
   публичные APK/catalog SHA. Не вводить forced minimum для некритичного релиза.

## 6. Инструменты, плагины и устройства

В Codex были callable: multi-agent, terminal/SSH, browser CUA, Figma, Mobbin,
MobileNext `mobile_mcp`, XcodeBuildMCP, Supabase, Coolify RO/write и code review.
Наличие их в Codex **не означает подключения в Cursor**. Проверить текущий список
Cursor MCP/skills; использовать его реальные схемы. Не копировать `.mcp`/env
файлы в Git и не переносить tokens через чат. Rive был куплен владельцем, но
callable Rive tools в текущем списке не подтверждены — не выдумывать подключение.

Локальные skills лежат в `C:/Users/maksi/.codex/skills/` и
`C:/Users/maksi/.codex/plugins/cache/`. Читать только подходящий SKILL.md, не
импортировать весь каталог. В этом этапе полезны systematic-debugging,
verification-before-completion, Supabase, remote-ssh; для интерфейса — frontend
testing, React best practices, product-design audit/impeccable, Figma/Mobbin.
Не покупать/устанавливать дубли инструментов и не тратить лимиты на случайные
генерации/референсы. Figma требует чтения соответствующего skill перед вызовом.

MobileNext использовался через tools, CLI `mobilenext`/`mobile-next` в PATH не
найден. Порядок: list_available_devices -> list_remote_devices (при auth error
официальный login flow) -> allocate -> проверка -> release в finally. У владельца
была подписка200 минут; текущий остаток не подтверждён. Не арендовать, пока backend
не готов. Первая целевая iPhone сессия <=60 минут, последние10 оставить cleanup.
Ранее каталог показывал physical iPhone16/iOS18.6.2; выбирать из свежего каталога,
не считать прошлое наличие текущим. LOCK capability отсутствовала: не выдавать
background/HomeScreen проверку за физическую lock-screen проверку.

Realme RMX3830/Android15 (id0C73A18I22105AB1) разрешён для тестов. A063 ЗАПРЕЩЁН:
занят Apollo.RGA. Не ставить поверх primary release/не чистить личные данные;
использовать согласованную изоляцию/owned test accounts. Историческое разрешение
разблокировки не повод печатать PIN; секреты в документ не включены. На personal
chat экранах нельзя uiautomator/screenshots/logging message bodies. Для iOS
обязателен настоящий установленный Home Screen PWA canary, не одна эмуляция.

Browser extension Chrome был восстановлен владельцем; перепроверить живую связь
через штатный инструмент, не ремонтировать/переустанавливать его вслепую. Linux
SSH helper и поддерживаемые CLI предпочтительнее UI для инфраструктуры.
CPJ start на Windows дал unsupported win32, ничего не запустил; не искать
несуществующий job и не создавать циклы polling.

## 7. Жёсткие ограничения и проверка

- Никаких secrets/keys/паролей/env/FCM/subscriptions/DB dumps в source, чат,
  screenshots, tool output, prompts субагентов или commit. `service_role` никогда
  не в VITE/client bundle. Не отключать RLS.
- БД: verified backup BEFORE, одна транзакция, raising selfcheck, rollback в
  header и byte-identical migration mirror; самовольный HBA/restore запрещён.
- Нельзя трогать Happ/HappService/happd/xray, global PATH или Java/JDK/JRE,
  Docker address pools/firewall/routing ради прохождения теста.
- Playwright всегда `KUB_QA_ALLOW_MUTATIONS=0`; signed-in screenshots/traces/video
  OFF. QA dev server может использовать production config.
- Не bare stash/pop/reset/clean. Чужие root paths: SidebarHeader.tsx,
  search-motion-fixture.spec.ts, sidebar-search-motion.spec.ts; чужой Android
  version overlay в worktreepush-retirement-20261010 сохранить.
- Каждый effect once; lost ACK не повод повторить SQL/install/rename. Сначала
  независимый readonly reconciliation; raw SHA и reencoded/projection SHA разные.
- Перед push отдельно прочитать `origin/main..HEAD`; проверить imports в дереве
  самого commit. Feature push не есть prod deploy. Main только после acceptance.
- Публикационный `scripts/publish-native-release.sh` выполнять НА СЕРВЕРЕ:
  Git Bash локально уже давал ложный success. Требуются immutable path/lock/
  prior manifest backup и фактический публичный hash.
- Build доказывать `sw.js build <id>` и `built in Ns`, не одним exit0.
  В Git Bash BASE_PATH требует `MSYS2_ENV_CONV_EXCL=BASE_PATH`.
- Deployment подтверждать running container image + content marker в обе стороны,
  а не webhook/HTTP200. SPA200 не доказывает client route.

Остальной backlog не потерян: `docs/PRODUCTION_PRIORITY_TRACKER.md`,
`docs/INTERFACE_DEFECT_REGISTER.md`, `docs/QA_RESULTS.md`, `docs/SEARCH_PLAN.md`,
`docs/native/ANDROID_CAPACITOR_PLAN.md`, `docs/native/IOS_CAPACITOR_PLAN.md`,
`docs/native/NATIVE_PUSH_PLAN.md`, `docs/native/WINDOWS_PACKAGING_PLAN.md` и
актуальные handoff/operations. Их статусы надо сверять, не считать старые числа
задач текущими. В частности, сохранить запрос на micro-UX переключения
микрофона/видео и прочие незакрытые пункты; не начинать их вместо блокера Stable.

## 8. Готовый стартовый запрос для Cursor

> Прочитай docs/CURSOR_HANDOVER.md, AGENTS.md и актуальные связанные checkpoint.
> Проверь canonical worktree/branch/dirty state. Продолжи от измеренной причины
> 27.412s inspector vs15s client, не повторяя принятые build/SQL проверки.
> Используй существующий fast-probe batch и разделение exec/cohort nonce.
> Исправь отмеченный Webhost P2, проведи реальные wire/HTTP/provider/iPhone
> гейты, затем verified rollout и Stable. Не публикуй непроверенный кандидат и
> не меняй secrets/package/signing identities. Сохраняй краткий resume и evidence.
