# LETSCUBE PWA Readiness

## Текущий production-путь

Standalone web/PWA остаётся основным production-клиентом LETSCUBE, пока native APK/FCM, release signing и deep links отложены.

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
  - manifest, favicon, apple touch icon и mobile web app meta tags подключены.

## Installed-режим

- Desktop Chrome/Edge: установка должна открывать отдельное standalone-окно без обычного browser chrome, если платформа поддерживает PWA install.
- Android browser: установка через браузерный install/home-screen flow остаётся web/PWA-режимом, не native APK.
- iOS/iPadOS: home-screen app зависит от Safari/WebKit ограничений. Web Push работает только при выполнении требований iOS для установленных web apps и разрешений пользователя.
- Capacitor/native Android не должен показывать browser install CTA; native push/FCM остаётся отдельным этапом.
- Settings показывают platform-aware блок установки:
  - ПК: `ПК Web/PWA`, режим `Браузер` или `Установлено`.
  - iPhone/iPad: `iPhone / iOS PWA` или `iPad / iOS PWA`, режим `Safari` или `Установлено`.
  - Android browser: `Android Web/PWA`, режим `Браузер` или `Установлено`.
  - Android APK: `Android APK`, режим `Native`.
- На iPhone/iPad кнопка `Установить` раскрывает шаги Safari `Поделиться` -> `На экран Домой` -> `Добавить`, потому что iOS не разрешает сайтам запускать системную установку программно.

## Push и notification click

- In-app notification center остаётся source of truth.
- Browser/PWA push использует Service Worker `artifacts/kub/public/sw.js`.
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

- Native Android FCM/device-token model.
- APK release signing/AAB.
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
- install prompt появляется там, где browser поддерживает `beforeinstallprompt`;
- iPhone/iPad Settings показывают home-screen install guidance;
- standalone launch открывает `/`;
- direct refresh `/tasks` и `/admin` отдаёт app shell;
- browser/PWA push click открывает правильный route;
- auth, chats, tasks, media, camera/voice/video-circle и notification center не регрессируют.
