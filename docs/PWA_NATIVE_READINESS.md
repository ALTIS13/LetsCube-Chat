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
- iOS/iPadOS: home-screen app зависит от Safari/WebKit ограничений. Web Push работает только при выполнении требований iOS для установленных web apps и разрешений пользователя.
- Capacitor/native Android не показывает browser install CTA; существующий native FCM path остаётся отдельным от Browser Web Push.
- Settings показывают platform-aware блок установки:
  - Windows: `Windows EXE`, режим `Браузер` до установки desktop-клиента.
  - iPhone/iPad: `iPhone / iOS PWA` или `iPad / iOS PWA`, режим `Safari` или `Установлено`.
  - Android browser: `Android APK`, режим `Браузер`.
  - Android APK: `Android APK`, режим `Native`.
- На iPhone/iPad кнопка `Установить` раскрывает шаги Safari `Поделиться` -> `На экран Домой` -> `Добавить`, потому что iOS не разрешает сайтам запускать системную установку программно.

## Push и notification click

- In-app notification center остаётся source of truth.
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

## Что не входит в этот этап

- Android release signing/AAB и store/public distribution.
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
