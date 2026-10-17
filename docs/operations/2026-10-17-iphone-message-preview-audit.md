# iPhone PWA: readable message preview audit

Дата: 2026-10-17. Owner requirement: текст сообщений на iPhone входит в тот же планируемый релиз, чтобы Никита мог проверить его одновременно с Android. Это source-only audit, не разрешение на deploy и не доказательство доставки на телефон.

## Причина и существующие границы

| Текущий исходник | Установленный факт |
| --- | --- |
| `supabase/functions/send-push-notifications/webpush.ts:20` | `buildDeclarativeWebPushPayload()` намеренно заменяет title/body общими и очищает sender/preview. Это причина отсутствия текста, а не установленный дефект iOS permission. |
| `supabase/functions/send-push-notifications/index.ts:243,756` | И album, и одиночный WebPush проходят эту нейтрализацию. TTL обоих путей 86400 секунд. |
| `artifacts/kub/public/sw.js:215,228,271` | Worker нормализует входной payload и передаёт body в `showNotification`. Нет authenticated content lookup, preview context или проверки согласия. `safeText` не является авторизацией. |
| `artifacts/kub/src/components/settings/SettingsScreen.tsx:773` | Выбор `none/sender/message` показан только `nativeAndroid`; iPhone не получает этот control. |
| `artifacts/kub/src/hooks/useNativeMessagePreview.ts:61` | Hook закрыт `nativeMessagePreviewsAvailable()`, то есть Android plugin. Расширять этот native gate на PWA нельзя. |
| `supabase/migrations/20261007210924_native_message_preview.sql:113,143,165,198` | Уже есть account preference с RLS и проверкой действующей auth session. Native capability/content RPC дополнительно требуют Android/FCM device; браузер не может представляться таким устройством. |
| `artifacts/kub/src/lib/browserPushSubscription.ts:42` | Регистрация содержит user и endpoint/keys, но не session/consent revision или отдельную preview authority. |
| `artifacts/kub/src/components/PwaRuntime.tsx:21,108` | Logout/switch закрывают карточки и unsubscribe best-effort. Это не отзывает принятый provider push; worker не получает durable preview retirement. Same-UID relogin не является сменой `previousUserId`. |
| `artifacts/kub/public/manifest.json`, `artifacts/kub/index.html:29,59` | Есть root-scoped standalone manifest и Apple web-app metadata. `usePush.ts:568` сохраняет subscription непосредственно в user gesture. Конфигурационную причину отсутствия текста исходники не показывают. |

`push_outbox_delivery_recheck_bound` (`index.ts:411,771`) проверяет отправку по текущему outbox/claim/subscription descriptor, но возвращает status, не permission на отображение текста позднее. Сохраняются существующие owner, read, topic, descriptor и retirement gates. Значения deployed VAPID/origin, iOS version и состояние подписки Никиты здесь не проверялись.

## Рекомендуемый минимальный scope для координатора

1. **Additive Web preview authority, без изменения Android RPC.** Новая migration/RPC для server-validated binding `(recipient, live session, subscription id + exact descriptor, binding revision, expiry)` и чтения preview по notification selector. Предпочтителен ограниченный отзывной preview grant: в worker только его secret, на сервере hash, без `service_role` или копии refresh token. Grant не даёт произвольного чтения сообщений. На каждом lookup заново проверяются session, активный descriptor, текущая account choice и существующая eligibility конкретного notification/message, включая read/topic/membership/privacy gates. Push IDs только selectors; body/имя/уровень из push не authority.
2. **Browser choice и lifecycle.** Новые `artifacts/kub/src/lib/platform/webMessagePreviews.ts` и `artifacts/kub/src/hooks/useWebMessagePreview.ts`; узкие изменения `SettingsScreen.tsx`, `usePush.ts`, `browserPushSubscription.ts`, `PwaRuntime.tsx` и явного logout в `artifacts/kub/src/hooks/useUser.ts:258`. Переиспользовать `app.store.ts:402,419` с его `accountEpoch/authSessionIdentity`, не новый общий owner framework; обработать также auth events вне явного logout. Использовать существующие `none/sender/message` и account preference, но отдельно подтвердить текущую установку/подписку. Не считать старый Android choice автоматическим browser opt-in. Worker context хранится отдельно с owner/session/subscription/revision/expiry; обычная page memory и Android Keystore не доступны как готовый background context. None/logout/same-UID reauth/subscription replacement сначала retire admission; старый async ACK не может её вернуть. Отсутствие durable readback/контекста означает generic, не default allow.
3. **Web-only selector transport и одно первое отображение.** Узкие изменения `send-push-notifications/{index,webpush}.ts` и `public/sw.js`: сохранить generic declarative fallback и все provider rechecks; добавить только проверяемый selector envelope. Worker выполняет один bounded lookup **до первого** `showNotification`, затем повторно проверяет current context/expiry/retirement. `message` показывает серверный текст, `sender` только отправителя и общий body, `none` общий текст. Ошибка/timeout/offline/evicted storage/старый worker дают generic без retry и позднего generic-to-rich обновления. Сохранить tag, grouping, renotify и same-origin route; покрыть single и album. Нельзя просто перестать neutralizing payload или читать `raw.preview_level`.
4. **Один общий release checkpoint.** Backend contract, Edge, worker build и PWA settings доставляются согласованно, со старым worker/new server и новым worker/old server fail-closed. Android22, native Java/protocol, FCM/WNS и принятый topic guard не меняются. Реальный iPhone canary является частью этого же релиза, не отдельным обещанием на потом.

Точная схема grant/worker storage требует реализации и её проверки, а не предполагается существующей. Шифрование payload само по себе не решает logout, queued delivery и consent rollback; перенос Android crypto без отдельного worker key lifecycle не является сокращением scope. Срок grant и renewal должны поддерживать заявленный background сценарий; короткий access-token-only прототип нельзя выдавать за полную поддержку длительно закрытого PWA.

## Минимальные проверки изменённого поведения

- Сохранить существующий `tests/unit/web-push-delivery.test.mjs:31`: оба provider display fallback остаются generic даже при богатом исходном payload. Новые worker tests исполняют настоящий push handler, а не собственную копию formatter.
- Реальные server/RLS fixtures: own active tuple разрешён; foreign recipient/session/descriptor, expired/revoked grant, none, read/deleted/hidden message, topic deny и потеря membership запрещены. Подмена selector или caller body не возвращает чужой текст; album выбирает только допустимый настоящий member.
- Held races: None/logout/account switch/same-UID relogin/replacement во время lookup; stale registration/choice ACK; worker restart, IDB failure/eviction, timeout и malformed response. После retirement нет нового rich notify; одна publication attempt, без позднего upgrade/retry после неизвестного результата.
- Positive `message`/`sender`, negative `none`; старый и новый worker/server; exact tag/route и фиктивный canary. Literal omission controls должны ломать реальные assertions owner/consent/fallback/once, не читать изменяемую константу как expected.
- На установленном Home Screen PWA iPhone: настоящий background/closed-app WebPush с известным фиктивным текстом, Settings readback/remount, tap в точный чат, None и logout queued case. Без personal captures, sender/message logs или утверждений о реальном iPhone по Node/WebKit fixtures.

## Платформенные пределы

WebKit поддерживает WebPush для Home Screen web apps начиная с iOS/iPadOS 16.4; permission требует прямого user gesture. Платная Apple Developer membership для этого не требуется. [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

Declarative WebPush может показать fallback без worker; доступный worker может заменить его уведомлением, но при неуспехе браузер показывает исходный fallback. Поэтому тот остаётся общим. Legacy WebPush требует видимого уведомления, а не silent-only fetch. [WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/)

Показ на lock screen дополнительно ограничивается пользовательским iOS Show Previews. Приложение не определяет unlocked по focus и не обещает обход `When Unlocked`/`Never`. Уже опубликованную ОС карточку нельзя считать атомарно отозванной сменой choice; close только best-effort. [Apple](https://support.apple.com/en-ie/guide/iphone/iph7c3d96bab/ios)

## Handoff

Owner: bounded audit sidecar. Stage: source cause/scope ready. Evidence: перечисленные текущие файлы и primary docs; существующие suites не запускались повторно. Blocker: Web preview binding/content/lifecycle пока отсутствуют, physical iPhone delivery не доказана. Next: coordinator назначает эти additive изменения в общий release scope; provider/SW исходники этим audit не изменены. Создан только этот отчёт; Android, frozen guard и private artifacts не затронуты.

## Implementation Follow-Up

The source-only DB proposal/rollback now exists and passes50 coordinator
PGlite cases, with genuine denial/omission tests and runtime OFF. The frozen
spec uses a browser-generated secret and hash-only authenticated enrollment;
no raw secret is generated/returned by enroll. Actual single/album Edge paths
now carry selectors only;114 affected tests and the focused loaded-omission
checks pass while both display fallbacks remain generic. This is not a deployed
feature. Browser settings/lifecycle and worker implementation now pass their
source and isolated-render checks; runtime/phone acceptance remains separate.
Real PG17/HTTP, safe migration and physical iPhone canary remain same-release
requirements. MobileNext local inventory works; its cloud catalog request
timed out, with no device reservation or paid minutes consumed.

One actual PG17 DDL rehearsal now passes on the exact owned R5 clone. The
byte-pinned proposal runs unchanged except its sole terminal COMMIT becomes
ROLLBACK. Real dependency prestate, types, owners, ACLs, RLS and raising selfcheck
pass with0 stderr; catalog and epoch are identical before/after. Receipt:
76c5aebc80996de402f7b87c623c770a8db79f3b83964f79e23f9b55564e07a3.
No feature objects remain, runtime was OFF, no content/HTTP/phone acceptance is
inferred. This reuses the accepted clone recovery; no production backup/apply,
new restore, session renewal or fixture reset occurred.

Browser lifecycle/settings30, worker25, adjacent subscription ownership64 and
legacy dispatcher53 checks now pass. Worker count25 is the actual Node test
count, not the implementer's earlier scenario count. The final source review
found one P2: SQL counts Unicode code points, while JavaScript String.length
counts UTF16 units. Actual SQL96/240-character boundary values reproduced the
generic-fallback regression; counting code points fixes it without broadening
the limits. An adjacent mutation anchor was updated for the new concurrent
retirement await, preserving its independent late-subscribe oracle.

The opt-in legacy API worker now uses a generic display whitelist plus the same
identifier-only selector, rather than raw payload serialization. Its deployment
ownership, opt-in default and token-bound claim/recheck/ACK flow are unchanged.
The API build completed. The four exact settings renders1440/390, light/dark
were inspected on fictional data: fit, pending/error state and44px radio targets
pass. None of these results is evidence of real iPhone push delivery.

Final canonical typecheck and web build pass:7471 modules, SW build
`d14bd7d50ba1fb9a`, Vite `built in17.31s`. Nonfatal sourcemap, mixed-import and
chunk-size warnings remain. This is a local artifact marker, not a production
marker: production embeds different public configuration.
