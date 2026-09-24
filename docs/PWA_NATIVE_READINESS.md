# LETSCUBE PWA Readiness

## Текущий production-путь

Полная web-версия остаётся доступной на всех платформах. Установка PWA предлагается только на iPhone/iPad; Android использует отдельный APK, Windows будет использовать отдельный EXE.

Текущая shell-идентичность:

- `artifacts/kub/public/manifest.json`
  - `name`: `LETSCUBE`
  - `short_name`: `LETSCUBE`
  - `start_url`: `/`
  - `scope`: `/`
  - `display`: `standalone`
  - `display_override`: `window-controls-overlay`, `standalone`, `minimal-ui`
  - `orientation`: `any`
  - icons: 192x192, 512x512 и maskable 512x512.
- `artifacts/kub/index.html`
  - document title: `LETSCUBE`
  - Apple mobile web app title: `LETSCUBE`
  - favicon и Apple touch metadata подключены постоянно;
  - manifest link добавляется до React startup только для iPhone/iPad user agent.

## Installed-режим

- Desktop Chrome/Edge: PWA install не предлагается; Settings проверяет доступность Windows EXE.
- Android browser: PWA install не предлагается; Settings проверяет доступность Android APK.
- iOS/iPadOS: поддерживаемые сторонние браузеры тоже могут предложить «На экран Домой» (с iOS 16.4); установка не привязана к Safari. Web Push работает только при выполнении требований iOS для установленных web apps и разрешений пользователя.
- Capacitor/native Android не показывает browser install CTA; существующий native FCM path остаётся отдельным от Browser Web Push.
- Windows Electron-клиент выведен из эксплуатации. До публикации Tauri 2 Windows release catalog возвращает `available:false`; браузерная версия остаётся рабочим fallback.
- Settings показывают platform-aware блок установки:
  - Windows: `Windows EXE`, режим `Браузер` до установки desktop-клиента.
  - iPhone/iPad: `iPhone / iOS PWA` или `iPad / iOS PWA`, режим `Браузер` или `Установлено`.
  - Android browser: `Android APK`, режим `Браузер`.
  - Android APK: `Android APK`, режим `Native`.
  - Windows EXE: `Windows EXE`, режим `Приложение`.
- На iPhone/iPad кнопка `Установить` раскрывает шаги `Поделиться` -> `На экран Домой` -> `Добавить` для поддерживаемого браузера. На iOS 26+ нужно оставить включённым «Открыть как веб-приложение»; если браузер не предлагает установку, Safari остаётся запасным вариантом. Сайт не может вызвать этот системный диалог программно.
- Проверка нижней полосы установленного PWA описана в [операционном протоколе](operations/ios-pwa-viewport-validation.md); desktop WebKit не заменяет реальный iOS.

## Push и notification click

- In-app notification center остаётся source of truth.
- На первом входе разрешение не запрашивается автоматически. Установленное iPhone PWA показывает ненавязчивую карточку над списком чатов: `Включить` начинает Web Push-подписку непосредственно по нажатию, `Позже` скрывает подсказку на 30 дней для этого аккаунта. При `denied` карточка и настройки показывают путь через системные «Уведомления» iPhone без повторного бесполезного запроса. На Android/Windows карточки нет.
- Service Worker подготавливается заранее: на iOS вызов `PushManager.subscribe()` для новой подписки должен происходить в том же пользовательском жесте, до любых `await`.
- Если Service Worker не готов через восемь секунд или регистрация отклонена, настройки показывают ошибку и кнопку повторной подготовки. После восстановления пользователь отдельно нажимает «Включить», чтобы сохранить требуемый iOS жест. Путь через системные настройки iPhone показывается только установленному PWA, не обычной вкладке браузера.
- Browser/PWA push использует Service Worker `artifacts/kub/public/sw.js`.
- Release status использует `https://api.letscube.ru/releases/v1/{android,windows}/stable.json`; проверка не блокирует auth/chat startup и сохраняет последний валидный результат на шесть часов.
- Message push collapses/grouping выполняется через стабильный `tag`, например `message:chat:<chat_id>`.
- Перед `showNotification` Service Worker закрывает существующие notifications с тем же `tag`, насколько это поддерживает браузер/OS.
- `notificationclick` фокусирует существующее окно LETSCUBE или открывает безопасный относительный route внутри текущего origin.
- Service Worker не кэширует Supabase Auth, REST, Realtime, Storage, Edge Functions и любые non-GET/cross-origin requests.

## Offline/update поведение

- Navigation requests используют network-first с fallback на `offline.html`.
- Статические same-origin assets под `/assets/` используют stale-while-revalidate.
- `skipWaiting` отправляется только после действия пользователя в update banner.
- `clients.claim()` не используется.
- Offline/reconnect banner не сбрасывает draft, staged attachments, staged voice/video и текущий UI state.
- В просмотрщике фото установленного iPhone PWA, если доступен Web Share Level 2 для файла, показывается системное «Поделиться» (в том числе для сохранения через меню iOS). Фото подготавливается до нажатия; без поддержки/при ошибке остаётся честное «Сохранить» через download. Видео не предзагружается для этого действия.

## Что не входит в этот этап

- Android release signing/AAB и store/public distribution.
- Публичная подпись Windows EXE, native Windows notifications и auto-update apply.
- Android/iOS deep links/app links.
- SMS provider rollout.
- Offline mutation queue/background replay.

## Validation checklist

После PWA shell-изменений:

- `git diff --check`
- `pnpm.cmd --filter @workspace/kub run typecheck`
- `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`
- `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts`
- `pnpm.cmd exec playwright test tests/e2e/pwa-install-settings.spec.ts`
- `pnpm.cmd exec playwright test tests/e2e/letscube-brand-auth-layout.spec.ts`

Manual/browser checks:

- document title и installed-app title показывают `LETSCUBE`;
- PWA install guidance появляется только на iPhone/iPad; Android/Windows получают только APK/EXE status;
- iPhone/iPad Settings показывают home-screen install guidance;
- standalone launch открывает `/`;
- direct refresh `/tasks` и `/admin` отдаёт app shell;
- browser/PWA push click открывает правильный route;
- auth, chats, tasks, media, camera/voice/video-circle и notification center не регрессируют.
