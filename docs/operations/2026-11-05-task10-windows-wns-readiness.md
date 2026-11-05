# Task 10/12: холодная доставка Windows

**Контрольная точка, 2026-11-05 20:22 UTC.** Владелец: координатор LETSCUBE.
`main` / `32ab32fc96eb`. Холодный WNS для установленного NSIS **не готов**.
Сейчас доступен отдельный путь Edge PWA / Web Push; для самого EXE остаются
уведомления при работающем процессе, в том числе в трее. Следующее действие
для EXE: подтвердить существующие identity и Entra mapping и доступную
подпись, прежде чем готовить подписанный sparse-пилот. Предыдущий
[отчёт об установке и совместимости](2026-11-05-task10-windows-boundary.md)
остаётся в силе; его тесты не переигрывались.

## Новые измерения

| Уровень | Результат |
| --- | --- |
| Точный установленный EXE | `0.2.14`, SHA-256 `05a8af74b8b0b6c2180c573c2b06c87c9291e4efafe49ef06c588b35cf28aed6`, Authenticode `NotSigned`. `RT_MANIFEST` #1 прочитан как ресурс PE: нет элемента `msix`; внешнего манифеста тоже нет. Для этого EXE `CreateProcessW(CREATE_SUSPENDED)` → `GetPackageFamilyName` вернул `15700` (`APPMODEL_ERROR_NO_PACKAGE`). Поток не возобновлялся, завершение точного дочернего процесса подтверждено; экземпляров LETSCUBE после проверки 0. Контроль: штатный AppModel API вернул PFN зарегистрированного x64 Framework, совпавший с AppX inventory. |
| Локальная активация и WinRT | `AssocQueryStringW(ASSOCF_IS_PROTOCOL, ASSOCSTR_EXECUTABLE)` вернул `S_OK` и разрешил `letscube-notification` в тот же EXE; зарегистрированная команда принимает URI. Реальный `buildWnsToast` сформировал три фикстуры, все три сконструировали `Windows.UI.Notifications.ToastNotification` с ожидаемыми URI и заголовками: точное сообщение, отдельная задача, внешний маршрут заменён на `/`; маркер приватного текста отсутствует. Это проверка OS-объекта и разрешения протокола: `Show`, история, нажатие, запуск обработчика и восстановление сессии не проверялись. Попытка запуска изолированного теста с записью локального AUMID была отклонена средой до выполнения; обхода не было. |
| Подпись и пакет | В двух найденных `.local/windows-package-identity*.msix` есть ссылка на нужный EXE, но нет `AppxSignature.p7x` или `windows.comServer`; ни одно имя из их манифестов не зарегистрировано. По именам LETSCUBE/KUB в AppX inventory совпадений нет; неизвестный Store PFN по такому поиску исключить нельзя. Семь параметров identity и конфигурация обоих провайдеров подписи отсутствуют в Process/User/Machine. В `CurrentUser\My` и `LocalMachine\My` ноль сертификатов Code Signing; `artifact-signing-cli` и `az` не найдены в PATH. SDK-инструменты есть, провайдер подписи не готов. |
| ОС и runtime | Windows 11 x64 `26300`; службы WPN и WPN текущего пользователя работают. В AppX есть x64 Framework и Main 1.8 `8000.994.2142.0`, но `MicrosoftCorporationII.WinAppRuntime.Singleton` не найден ни для текущего, ни для всех пользователей. В каталоге установленного приложения нет app-local Bootstrap DLL. Наличие WinRT и Framework не равно рабочему `PushNotificationManager`: для unpackaged WNS Microsoft указывает зависимость от Singleton. |
| Живой Edge / БД | Read-only SSH и `BEGIN READ ONLY … ROLLBACK`: Edge-контейнер healthy, хеши смонтированных `index.ts` / `wns.ts` совпали с checkout (`35264e1c…` / `e87eabad…`). Все три `WNS_*` пусты или отсутствуют, обе VAPID-переменные настроены. CHECK в `user_push_devices` разрешает только `android/ios` и `fcm/apns`, без `windows/wns`. Подтверждены session-bound RPC/внешний ключ, `native_push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)` и наличие отдельной `push_subscriptions`. Значения конфигурации и строки пользователей не извлекались. OAuth, выдача канала и WNS send не выполнялись. |

## Какой путь доступен

- **Без смены текущей дистрибуции:** отдельная Edge PWA с существующим
  [Web Push LETSCUBE](../PUSH_NOTIFICATIONS.md), а не включение Push API
  в WebView2. Клиент [явно исключает Desktop](../../artifacts/kub/src/lib/platform/capabilities.ts)
  из браузерной подписки. [Microsoft Edge](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push)
  поддерживает доставку в PWA при неактивном приложении; состояние брокера и
  [фоновый режим Edge](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/backgroundmodeenabled)
  проверяются отдельно. Это путь без нового издателя и без Entra для LETSCUBE,
  но не обещание доставки при принудительно остановленном браузере и не запуск
  EXE. Для EXE существующий opt-in tray остаётся вариантом с живым процессом.
- **Настоящий WNS без PFN:** Microsoft допускает ограниченный unpackaged режим.
  Он всё равно требует Entra, WinAppSDK bootstrap и работающего
  [Singleton](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/deployment-architecture).
  [Миграционный справочник](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/migrate-to-windows-app-sdk/guides/notifications)
  упоминает ShellExecute, и в [исходниках Microsoft](https://github.com/microsoft/WindowsAppSDK/blob/main/dev/PushNotifications/PushNotificationManager.cpp)
  есть отдельная ветка unpackaged, но [актуальный quickstart](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/push-quickstart)
  требует package identity для поддерживаемого фонового сценария с COM.
  Это отдельный возможный пилот с уже одобренным Entra и реальным каналом,
  не готовая замена cold WNS: на текущем ПК и сервере его предпосылок нет.
- **Поддерживаемый cold WNS для EXE:** [подписанный MSIX с external location](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps)
  оставляет NSIS основным установщиком. Нужны доверенный signer для companion
  с точным Publisher, совпадающий манифест EXE, подтверждённый Microsoft PFN
  mapping, WinAppSDK и COM. Tauri updater signature не создаёт Windows trust.
  Текущий [список регионов Artifact Signing Public Trust](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
  расширился относительно июльского runbook, но России в нём по-прежнему нет.
  Старый Store-продукт не доказывает пригодность его PFN и не даёт ключ подписи.
  Не менялись Store identity, сертификаты, trust store или политики.

## Точный gate и следующий шаг

1. **Владелец release-контура:** подтвердить существующий `Name / Publisher /
   Application Id / PFN`, совместимость с существующим Store-продуктом,
   доступность доверенного signer с совпадающим Subject и статус mapping для
   существующего multitenant Entra app. Для mapping Microsoft запрашивает PFN,
   Application (client) ID и Object ID **service principal**. Quickstart
   использует service-principal Object ID для `CreateChannelAsync`, тогда как
   [API reference](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.windows.pushnotifications.pushnotificationmanager.createchannelasync)
   описывает Application ID: на закреплённой версии SDK подтвердить правильный
   remote ID реальным запросом канала, не подставлять один GUID во все поля.
   OAuth и COM CLSID используют Application (client) ID по quickstart.
   Идентификаторы сверять в релизном контуре; секреты не передавать в отчёте.
2. **После подтверждения:** на изолированной Win11 доказать регистрацию
   подписанного sparse companion, ожидаемый PFN из работающего EXE и
   `IsSupported`/канал с выбранным runtime, затем install/repair/update/remove.
   [Июльский SQL](../../.migration-backup/supabase/migrations/20260724_windows_wns_push_devices.sql)
   не применять как есть: он заменяет публичную регистрацию/отписку и не
   переносит действующий session-bound контракт. Нужен отдельный пересмотр
   с привязкой сессии, logout/revoke, fingerprint recheck и контролями
   существующих провайдеров. В текущем диспетчере `response.ok` пишет
   `sent_at` без проверки `X-WNS-Status`; даже `received` означает приём
   провайдером, а не получение на ПК. Для пилота разделить эти сигналы;
   для срока жизни использовать проверенный `X-WNS-TTL`, не считать
   `X-WNS-Cache-Policy: no-cache` гарантией для toast.
   [Контракт заголовков WNS](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/push-request-response-headers).
3. **Критерий закрытия WNS:** синтетическое событие с контрольным ID отправлено
   после подтверждённого полного выхода LETSCUBE, карта получена на ПК до
   старта EXE либо зафиксирована отдельная холодная WNS-активация для raw,
   нажатие открывает точный маршрут после восстановления разрешённой сессии.
   Повтор после reboot/logon на Win11 и Win10 22H2; mute, sender exclusion,
   revoke/expiry и отсутствие дублей должны пройти отдельно.
   До этого ближайшая полезная приёмка без enrollment: dedicated QA Edge PWA,
   закрыть окно PWA и весь LETSCUBE EXE, проверить реальный Web Push и точный
   маршрут, отдельно зафиксировать состояние фонового Edge. Cold click
   сохранённой локальной карты NSIS проверять отдельно, не вместо WNS.

Продуктовый код, серверная конфигурация и общие документы не менялись.
Не выполнялись push/deploy, регистрация, покупка, установка или миграция.

## Продолжение: Edge PWA / Web Push

**Контрольная точка, 2026-11-05, следующий прогон Task 10/12.**
Холодная доставка и нажатие **не проверены**: нет доказанной привязки новой
подписки к единственному разрешённому получателю. Пройден read-only preflight
провайдера и тёплый offline/reconnect в реальном Windows Edge. Это не WNS,
не авторизованная сессия и не установленное PWA-окно.

- **Точный scope:** Edge `156.0.4314.58` (UA `156.0.0.0`), отдельный временный
  профиль; обычная вкладка `https://app.letscube.ru/login`. Публичный манифест:
  `id`, `start_url` и `scope` = `/`, `display=standalone`. В защищённом
  контексте единственная регистрация обслуживает корень, активный скрипт
  `https://app.letscube.ru/sw.js`, кэш `kub-app-shell-d86e22971566dee8`;
  после перезагрузки скрипт контролировал документ. Push API доступен,
  разрешение `default`, `getSubscription() = null`. Не выдавали разрешение
  и не проверяли фонового брокера.
- **Тёплый offline/reconnect:** после 20 секунд простоя изолированный
  контекст Edge переключили offline и online. Оба состояния баннера видимы;
  одна вкладка, тот же документ и его синтетический маркер, 0 навигаций
  в измеряемом интервале, 0 ошибок страницы и попыток записи в перехватчике.
  Сеть хоста не менялась. Это ограниченная проверка гостевого клиента,
  не часовой soak, не потеря сети всего ПК и не проверка Tauri/WebView2.
  Первичная проверка на `/` не достигла селектора формы, для проверки
  использовали штатный `/login`. Холодный переход после пересоздания браузера
  дал таймаут; две диагностические попытки не подтвердили стабильный
  controller на этапе подготовки. Причина холодного таймаута не установлена.
- **Живой preflight доставки:** read-only каталог подтвердил, что
  `_enqueue_push_after_notification_insert` выбирает активные Web Push
  подписки по получателю, а не по одному installation ID. Service-only
  `push_outbox_delivery_recheck_bound` проверяет точные claim, subscription
  и fingerprint уже после fan-out; обычному authenticated вызов недоступен.
  RLS на `push_subscriptions` включена. `push_foreground_session_touch`
  пишет в БД даже без отправки тестового уведомления. Старый принятый
  provider harness и [его cleanup](2026-10-18-production-completion.md#topic-production-enforcement)
  привязаны к завершённой когорте. Старый read-only transport вернул
  `REMOTE_REFUSED`; каталог подтверждён отдельно штатным SSH в
  `BEGIN READ ONLY … ROLLBACK`. Старые события и подписки не переиспользованы.

**Gate следующего live-прогона:** использовать только выделенную существующую
QA-пару с уже включённым push. До отправки доказать для выбранного синтетического
события, что допускается ровно одна свежая Edge Web Push подписка этой пары
и ни одна другая Web Push, native или внешняя цель; сопоставить subscription
ID и fingerprint с текущим профилем без вывода endpoint/ключей. Глобальный
переключатель аккаунта не использовать для cleanup: `disable()` меняет общее
предпочтение. Заранее проверить точную деактивацию своей записи, локальный
`unsubscribe()` и сверку, что остальные подписки/сессии не изменены.
При подтверждении привязки закрыть PWA/LETSCUBE EXE, отметить состояние Edge,
отправить одно синтетическое событие, отдельно зафиксировать приём и точный
маршрут по нажатию. При несовпадении привязки или неизвестном результате не
отправлять повторно. [Требования Microsoft к Web Push](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push).

В этом прогоне не входили в QA/личные аккаунты, не создали подписок или событий,
не меняли БД, конфигурацию провайдера или режим Edge. Все временные профили
проверены и удалены; скриншотов, трасс и продуктовых правок нет.

## Локальная правка ответа WNS

До правки реальный путь диспетчера считал HTTP 200 с явным
`X-WNS-Status: dropped` успешной отправкой. Теперь `dropped` и
`channelthrottled` не засчитываются; `received` и HTTP 200 без опционального
заголовка означают принятие провайдером, а не получение устройством.
Переадресация запрещена, в лог пишется только известный статус. RED/GREEN
проверен на транспилированном диспетчере, 13 профильных и 67 смежных
проверок прошли. Deno и реальная холодная доставка не проверены; Edge
Function не развёртывалась, FCM и Windows-артефакты не менялись.
[Контракт Microsoft](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/push-request-response-headers#x-wns-status).
