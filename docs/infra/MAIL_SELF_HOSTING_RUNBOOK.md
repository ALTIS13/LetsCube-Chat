# Mail Self-Hosting Runbook

KUB needs transactional email for Supabase Auth flows:

- email confirmation;
- password recovery;
- magic links if enabled;
- operational admin notifications if added later.

## Recommendation

Use a reliable transactional SMTP provider unless there is a strong reason to
self-host mail. Self-hosted mail requires deliverability work that is separate
from KUB application correctness.

## DNS requirements

- SPF.
- DKIM.
- DMARC.
- Reverse DNS if running your own MTA.

## Supabase Auth settings

Configure SMTP in self-hosted Supabase. Use placeholders in docs:

```text
SMTP_HOST=<smtp host>
SMTP_USER=<smtp user>
SMTP_PASS=<stored outside git>
SMTP_ADMIN_EMAIL=admin@example.com
```

Do not commit SMTP credentials.

## QA

- Register new user.
- Confirm email.
- Password recovery.
- Expired/invalid link shows friendly UI.
- Auth callback route works on `https://kub.example.com/auth/callback`.
