# Admin / Ops Security Report

Админская вкладка `/admin/ops` показывает операторский отчёт по auth/invite-защите без чувствительных данных.

## Что видно в UI

- публичная CAPTCHA-конфигурация текущей сборки;
- признак, что auth gateway используется для Yandex SmartCaptcha;
- напоминание про smoke-команду `pnpm.cmd auth:anti-abuse:smoke`;
- агрегаты по пользователям, профилям, invite-only режиму, активным/истёкшим/отозванным инвайтам;
- последние invite/auth события только как action label + target kind + timestamp.

UI не показывает email, IP-адреса, пароли, recovery-токены, CAPTCHA-токены, FCM/push-токены, actor_id или target_id.

## SQL prerequisite

Live-агрегаты требуют ручного применения proposal:

```text
.migration-backup/supabase/migrations/20260622_admin_ops_security_report.sql
```

SQL автоматически не применялся. До применения proposal вкладка остаётся доступной, но показывает понятное предупреждение, что RPC `admin_ops_security_report` ещё не установлен.

## Проверка после применения

1. Зайти под owner/tech_admin/admin.
2. Открыть `/admin/ops`.
3. Убедиться, что предупреждение о migration исчезло.
4. Проверить, что агрегаты отображаются без email/IP/token/id.
5. Запустить:

```powershell
pnpm.cmd auth:anti-abuse:smoke
```

6. При необходимости открыть обычный `/admin/audit` для детального журнала действий.

## Границы

Этот отчёт не заменяет полноценный SIEM/Sentry/лог-агрегатор. Он закрывает быстрый operator-facing слой для текущих auth/invite рисков и остаётся read-only.
