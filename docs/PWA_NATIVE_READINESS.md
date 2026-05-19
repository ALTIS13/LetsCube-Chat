# PWA and Native Readiness

## Current PWA baseline

- `artifacts/kub/public/manifest.json` defines the installable app identity:
  - `name`: `KUB Messenger`
  - `short_name`: `KUB`
  - `start_url`: `/`
  - `scope`: `/`
  - `display`: `standalone`
  - `orientation`: `any`
  - icons: 192x192, 512x512, and 512x512 maskable.
- `artifacts/kub/index.html` links the manifest, favicon, apple touch icon, theme color, and mobile web app meta tags.
- `artifacts/kub/src/hooks/usePwa.ts` registers the service worker from the app runtime and exposes browser install prompt state.
- Settings show an install action when the browser exposes `beforeinstallprompt`; otherwise they show browser-menu install guidance.
- Browser push setup is documented in [PUSH_NOTIFICATIONS.md](./PUSH_NOTIFICATIONS.md). Real delivery requires manual VAPID, DB migration, and Edge Function/scheduler setup.

## Service worker strategy

The service worker is intentionally conservative because KUB is an authenticated realtime app.

Cached:

- app shell navigation fallback;
- `index.html`;
- `manifest.json`;
- `offline.html`;
- favicon and PWA icons;
- same-origin Vite static assets under `/assets/`.

Not cached:

- Supabase Auth, REST, Realtime, Storage, and Edge Function requests;
- non-GET requests;
- cross-origin requests;
- authenticated API responses.

Navigation requests use network-first behavior with an offline shell fallback. Static assets use stale-while-revalidate. Offline send queue and background mutation replay are not implemented in this stage.

## Update behavior

- The existing `AppUpdateBanner` still detects changed Vite bundle paths.
- Service worker waiting updates also surface through the same update banner.
- `skipWaiting` is sent only after the user clicks the update button.
- `clients.claim()` is not used.
- The app reloads only after explicit user update action; focus/visibility checks never force a reload.
- Frontend monitoring does not alter PWA update or offline behavior; Sentry is initialized only when `VITE_SENTRY_DSN` is configured.

## Offline and reconnect UI

- `PwaRuntime` renders a compact offline/reconnect banner.
- Offline state shows: `Нет подключения`.
- Reconnect state shows: `Подключение восстановлено` and hides automatically.
- Existing in-memory state, drafts, staged attachments, staged voice/video, and loaded UI state are not reset by the banner.
- Actual message/media upload still requires an online server response.

## Native packaging later

Do not add native wrappers until the web PWA baseline is stable.

Future Android/iOS work:

- Capacitor shell;
- camera and microphone permission mapping;
- file/media picker permissions;
- push notification registration and deep links;
- phone verification SMS provider setup, documented in [PHONE_VERIFICATION.md](./PHONE_VERIFICATION.md);
- Supabase Auth callback/deep-link configuration;
- offline mutation queue if product requires it.

Future Windows/macOS/Linux work:

- Tauri or Electron wrapper;
- app update channel;
- local notification bridge;
- camera/microphone/file permissions;
- tray/background behavior policy.

## Validation checklist

After PWA changes:

- `pnpm.cmd --filter @workspace/kub run typecheck`
- `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`
- `pnpm.cmd e2e:smoke`
- `pnpm.cmd rls:smoke`
- `pnpm.cmd db:types:check`
- `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts`

Manual browser checks:

- install prompt appears where supported;
- standalone launch opens `/` correctly;
- direct refresh of `/tasks` and `/admin` still reaches the app shell;
- `/auth/callback` and recovery links keep query/hash parameters;
- camera, microphone, media viewer, and push notification permission prompts still work.
