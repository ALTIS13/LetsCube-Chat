# Production Monitoring

## Provider

KUB uses a Sentry-compatible browser monitoring foundation through `@sentry/react`.
The SDK is initialized only when a DSN is present in frontend environment variables.
Without a DSN the monitoring module is a no-op and does not send network requests.

## Coolify environment

Set these variables in the frontend deployment environment when production reporting is ready:

```env
VITE_SENTRY_DSN=<public Sentry browser DSN>
VITE_APP_ENV=production
VITE_APP_VERSION=<release version>
VITE_APP_COMMIT=<git commit sha>
```

Optional:

```env
VITE_SENTRY_TRACES_SAMPLE_RATE=0
```

Do not put DSN values, auth tokens, Supabase keys, QA credentials, or passwords in repo files or docs.
Although a Sentry browser DSN is public by design, KUB still treats it as deployment config.

## Data policy

The frontend monitoring layer redacts:

- passwords;
- access/refresh/id tokens;
- authorization headers;
- Supabase publishable/secret key shaped strings;
- service-role shaped key names;
- email addresses;
- raw message/content/body/text fields;
- media URLs, signed URLs, public URLs, and storage URLs;
- URL query secrets such as `token`, `access_token`, `refresh_token`, `apikey`, `signature`.

Monitoring user identity is limited to `user.id`. Email is not sent.
Raw chat message content, media URLs and uploaded file names are not sent.

## Reported events

First production pass reports:

- React `AppErrorBoundary` exceptions;
- global `window.error`;
- global `unhandledrejection`;
- auth callback and password recovery failures;
- message send ack timeout/failure categories;
- staged attachment upload/send failures without file names or media URLs;
- media playback failures;
- PWA service worker registration/update-check failures.

The app does not instrument every RPC. Add new categories deliberately when they help diagnose production incidents.

## Update and PWA behavior

Monitoring does not change PWA update behavior:

- no auto reload on focus;
- service worker `skipWaiting` remains user-click gated;
- offline/reconnect banner keeps working without monitoring config.

## Verification

Local checks:

```powershell
pnpm.cmd exec playwright test tests/e2e/monitoring.spec.ts
pnpm.cmd --filter @workspace/kub run typecheck
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
```

Production smoke after setting `VITE_SENTRY_DSN`:

1. Deploy with the variables above.
2. Open the app and confirm normal login/chat flow.
3. Trigger a controlled test error only in a safe QA environment.
4. Confirm the Sentry event includes release/environment and does not include email, tokens, message content or media URLs.
