# LETSCUBE Auth Anti-Abuse Operator Smoke

This smoke is for repeatable production safety checks after auth/proxy/CAPTCHA changes. It does not print API keys, passwords, CAPTCHA tokens, emails, or raw response bodies.

Command:

```powershell
pnpm.cmd auth:anti-abuse:smoke
```

The script reads the same local QA env convention as the RLS probes:

- `KUB_QA_ENV_FILE`;
- `.local/secrets/letscube-infra.env`;
- `%USERPROFILE%\.kub-messenger-qa.env`.

Required non-secret/public values:

- `SUPABASE_URL` or `VITE_SUPABASE_URL`;
- `SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, or `VITE_SUPABASE_PUBLISHABLE_KEY`;
- `KUB_AUTH_GATEWAY_URL` or `VITE_AUTH_GATEWAY_URL`; if omitted, the script uses `<SUPABASE_URL>/functions/v1/auth-yandex-gateway`.

Optional values:

- `KUB_AUTH_SMOKE_APP_ORIGIN`, defaults to `https://app.letscube.ru`.
- `KUB_AUTH_SMOKE_STRICT=1` to fail if a check is skipped.
- `KUB_AUTH_SMOKE_STRESS_RATE_LIMIT=1` or `--stress-rate-limit` to run the opt-in repeated gateway rate-limit probe.

## What It Checks

Default checks:

- Direct external `/auth/v1/signup` is protected and does not reach Auth validation.
- Direct external `/auth/v1/recover` is protected and does not reach Auth validation.
- `auth-yandex-gateway` signup without CAPTCHA stops at `captcha_required` or `rate_limited`.
- `auth-yandex-gateway` recovery without CAPTCHA stops at `captcha_required` or `rate_limited`.

The direct Auth bypass checks intentionally send invalid email input. If the proxy block is broken, Auth may return validation HTTP 400, and the smoke fails without creating a user.

The gateway checks use valid synthetic `example.invalid` emails without CAPTCHA. The gateway must reject before calling Supabase Auth, so this should not create users.

## Stress Rate-Limit Check

Run only when you intentionally want to exercise the gateway limiter:

```powershell
pnpm.cmd auth:anti-abuse:smoke -- --stress-rate-limit
```

or:

```powershell
$env:KUB_AUTH_SMOKE_STRESS_RATE_LIMIT="1"
pnpm.cmd auth:anti-abuse:smoke
```

This sends repeated no-CAPTCHA gateway signup attempts using one synthetic email and expects at least one HTTP 429 `rate_limited` response. Do not run it in tight loops because the gateway also has an IP bucket.

## Expected Production Baseline

- Direct signup: `403` or another protected status (`401`, `404`, `429`).
- Direct recovery: `403` or another protected status (`401`, `404`, `429`).
- Gateway signup without CAPTCHA: `400 captcha_required` or `429 rate_limited`.
- Gateway recovery without CAPTCHA: `400 captcha_required` or `429 rate_limited`.

If direct endpoints return HTTP 400 validation, the proxy protection is probably bypassable and must be fixed before treating public auth as production safe.
