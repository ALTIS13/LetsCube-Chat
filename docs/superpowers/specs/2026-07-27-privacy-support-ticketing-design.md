# LETSCUBE Privacy Policy And Support Ticketing Design

Date: 2026-07-27  
Status: approved product design; implementation plan pending

## 1. Purpose

LETSCUBE processes account data, messages, attachments, voice and video
recordings, operational task data, device notification identifiers and, only
after an explicit user action, geolocation. The product therefore needs:

1. a public and accurate privacy policy at `https://app.letscube.ru/privacy`;
2. a public support entry point at `https://app.letscube.ru/support`;
3. a protected support-ticket workflow for guests, users and authorized
   operators;
4. auditable personal-data access, assignment and retention controls;
5. support contact addresses on the existing Russian self-hosted mail
   infrastructure.

The policy must describe the system that actually exists. Features that are
not yet deployed must not be represented as active. Material changes to data
processing require a new policy version and a product review.

This design is based on the current requirements of Federal Law No. 152-FZ
and the Microsoft Store privacy requirements, but it is not a substitute for
review by a qualified Russian privacy lawyer before publication or Store
certification.

Official references:

- [Federal Law No. 152-FZ](https://ips.pravo.gov.ru/api/ips/legislation/document?baseid=None&hash=98490812b3409e2a8d78a11ca9010f434ea3d9250a11dbbdb78690cd5551bdd6)
- [Microsoft Store Policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)
- [Microsoft Windows privacy guidance](https://learn.microsoft.com/en-us/windows/apps/get-started/best-practices)
- [Microsoft support and privacy metadata guidance](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/pwa/support-info)

## 2. Legal Operator

The privacy policy identifies the operator as:

- short name: ООО «КУБ»;
- full name: ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «КУБ»;
- INN: `3666275395`;
- KPP: `366301001`;
- OGRN: `1253600009630`;
- legal address: `394033, Воронежская область, г. Воронеж, ул. Димитрова,
  д. 51/3, офис 3`;
- General Director: Панков Никита Юрьевич;
- personal-data requests: `privacy@app.letscube.ru`;
- product support: `support@app.letscube.ru`.

Before publication, the legal name, address, KPP and director must be compared
with a current EGRUL extract. A discrepancy blocks publication.

## 3. Age Model

LETSCUBE is available to users aged 14 and older.

- The product is not intended for independent use by children under 14.
- Users aged 14-17 must have consent from a legal representative where Russian
  law requires it.
- Registration and support consent text must not claim that the product can
  independently verify age when no reliable age-verification mechanism exists.
- A later enforcement stage may add a date-of-birth or guardian-consent flow;
  until then, the policy states the rule and provides a contact path for a
  legal representative.

## 4. Privacy Policy Surface

`/privacy` is a public route and must never redirect an unauthenticated visitor
to `/login`. It contains:

- a short plain-language summary;
- the complete policy;
- a table of contents;
- policy version and effective date;
- operator and contact details;
- a print-friendly layout;
- a material-change notice and version history.

Links to `/privacy` appear on:

- registration and password recovery;
- the public support form;
- authenticated Settings/About;
- relevant consent controls;
- the Microsoft Store listing.

Every registration and support submission records the accepted policy version,
time, subject or ticket reference, and acceptance context. The system does not
store a CAPTCHA token as consent evidence. Acknowledging the policy is recorded
separately from any consent that is required for a particular optional
processing purpose; viewing a policy is not treated as blanket consent.

## 5. Personal Data Covered By The Policy

### 5.1 Data subjects

- registered users;
- club clients and employees;
- administrators and support operators;
- guests who contact support;
- message participants and task participants;
- legal representatives acting for a minor.

### 5.2 Data categories

- name, username, email, phone, avatar and profile fields;
- club, role, position and work assignments;
- authentication, session and recovery metadata;
- IP address, user agent, device/app version and security events;
- message text, reactions, membership, delivery/read state and timestamps;
- photos, documents, voice recordings and video recordings;
- tasks, assignments, status history and operational comments;
- geolocation attached only through an explicit send-location action;
- push subscription and device tokens and notification preferences;
- support contacts, ticket content, messages, actions and attachments;
- CAPTCHA validation result and anti-abuse signals.

Passwords are represented as cryptographic password verifiers managed by
self-hosted Supabase Auth; the policy must not imply that plaintext passwords
are stored.

Voice and image data may contain personal characteristics, but LETSCUBE does
not use them for biometric identification, face recognition, speaker
recognition or biometric-template creation.

### 5.3 Purposes and legal bases

The policy maps each category to a concrete purpose:

- account creation, authentication and recovery;
- performance of the LETSCUBE user agreement;
- message, file and notification delivery;
- club, role, location and task workflows;
- support request handling;
- fraud, spam, attack and abuse prevention;
- compliance with legal obligations and lawful authority requests;
- optional processing based on an explicit action or consent, including
  geolocation and operating-system push notifications.

LETSCUBE does not sell personal data and does not use it for third-party
advertising.

## 6. Data Location And Third Parties

The primary database, Auth, Realtime, Storage, backend and Mailcow services run
on LETSCUBE self-hosted infrastructure in Russia.

The policy accurately identifies limited external recipients:

- the Russian infrastructure/hosting provider;
- Yandex SmartCaptcha for server-side anti-bot validation;
- recipient email providers during email delivery;
- Google/Firebase, Apple and Microsoft when the user enables the corresponding
  operating-system push delivery;
- public authorities only on a valid legal basis.

Supabase and Coolify are self-hosted software components, not independent SaaS
recipients in the current production topology.

Push providers may receive a device token, application identifiers, routing
metadata, title and a bounded message preview when previews are enabled. Users
can disable push and must eventually be able to hide notification content.
Potential cross-border transfer for foreign push providers requires a separate
legal compliance checkpoint and must not be concealed by generic policy
language.

## 7. Retention Model

| Data | Target retention |
| --- | --- |
| Account and profile | Account lifetime, then up to 30 days for active-system removal |
| Messages and attachments | Until user/admin deletion or the processing purpose ends |
| Security and audit records | 12 months |
| Closed support tickets | 3 years |
| Spam/rejected support requests | 90 days |
| Push/device tokens | While enabled and valid; invalid tokens are revoked |
| Location shared in a message | Same retention as that message |
| Rotating backups | No more than 90 days |

Account deletion must not corrupt shared conversations. The target behavior is
to anonymize the deleted profile in shared history and process a separate
content-deletion request where no legal basis requires retention. This
behavior must be technically verified before the policy promises it.

Retention jobs are server-owned, idempotent and auditable. A frontend timer is
not a deletion control.

## 8. User Rights

The policy explains how a person can:

- obtain information about processing;
- request an export or copy;
- correct inaccurate data;
- withdraw optional consent;
- disable location and push access;
- request restriction, blocking or deletion;
- contact Roskomnadzor or a court.

Requests are accepted at `/support` and `privacy@app.letscube.ru`. Sensitive
requests require identity verification appropriate to their risk. A support
operator cannot disclose account data merely because a requester knows an
email address or phone number.

## 9. Support Product Model

### 9.1 Public entry

`/support` is public. Its web form requires:

- name;
- email for replies;
- phone in international format;
- category;
- subject;
- request description;
- acceptance of the current privacy policy;
- Yandex SmartCaptcha.

After successful submission, the guest ticket chat opens immediately in the
same interface. Email confirmation is not required for the first access.

Email and phone remain marked unverified. A matching profile or club client is
never linked automatically.

### 9.2 Guest session

The server returns a cryptographically random guest secret once. The database
stores only its hash. The browser stores the raw secret in IndexedDB.

- The secret is passed in a dedicated request header, not a URL.
- It is excluded from logs, analytics, notifications and error reports.
- It can be revoked on compromise, recovery or closure.
- It expires after 30 days without use and has a 90-day absolute lifetime;
  access can then be recovered through the submitted email.
- Email recovery can issue a replacement secret for another device without
  being required for initial entry.

### 9.3 Statuses

- `new`: unassigned common pool;
- `in_progress`: assigned and active;
- `waiting_user`: operator is waiting for the requester;
- `waiting_support`: requester has sent a new message;
- `escalated`: sent to a senior operator;
- `resolved`: a solution was recorded;
- `closed`: conversation ended;
- `spam`: isolated from operational queues.

A requester can reopen a resolved ticket within seven days. After that it is
closed automatically. Reopening a closed ticket creates a new ticket linked to
the previous one instead of silently mutating old history.

### 9.4 Assignment

Claim is atomic. Only one operator can successfully move an unassigned ticket
from the pool into their ownership.

- Transfer selects a colleague and requires a comment.
- Escalation requires a reason and notifies support managers.
- Returning a ticket to the pool requires a reason and an optional urgent flag.
- Resolution/closure requires a summary.
- Every transition is recorded as an immutable support event.

## 10. Support Permissions

The dynamic permission model gains:

- `support.view`;
- `support.claim`;
- `support.reply`;
- `support.transfer`;
- `support.escalate`;
- `support.lookup_customer`;
- `support.manage`;
- `support.settings`.

Owner and tech_admin receive all support permissions through the existing
system-role seed. Other roles receive only explicitly assigned permissions.

Customer lookup is an explicit, audited action. `support.lookup_customer`
returns a bounded candidate summary; it does not expose unrestricted contact
search. Linking requires operator confirmation.

## 11. Data Model

### 11.1 Exposed RLS tables

- `support_tickets`: workflow metadata without raw contact fields;
- `support_ticket_messages`: bounded user/operator/system messages;
- `support_ticket_events`: append-only lifecycle history;
- `support_operator_preferences`: per-operator delivery preferences;
- `support_settings`: singleton service configuration;
- `privacy_policy_versions`: published policy metadata;
- `privacy_acceptances`: acceptance evidence.

### 11.2 Restricted contact/session data

- `support_ticket_contacts`: raw and normalized contact data plus safe hashes;
- `support_guest_sessions`: token hashes, expiry and revocation;
- `support_email_messages`: mail ingestion/delivery deduplication metadata;
- private anti-abuse counters/signals.

Contact and session tables are not available through unrestricted Data API
selects. Raw CAPTCHA tokens, guest secrets and mail credentials are never
stored in these tables.

### 11.3 RLS invariants

- `anon` has no direct access to support tables.
- A registered requester can read only their own tickets.
- Operators require the relevant dynamic permission.
- Pool queries return masked contacts.
- Full contact details require assignment or `support.manage`.
- All state transitions are server functions; clients cannot directly mutate
  assignment, status, priority or service notifications.
- `service_role` remains backend-only.
- Every exposed table has RLS enabled and explicit grants.

## 12. RPC And Gateway Contracts

Authenticated state transitions use atomic RPCs:

- `support_ticket_claim`;
- `support_ticket_transfer`;
- `support_ticket_return_to_pool`;
- `support_ticket_escalate`;
- `support_ticket_mark_waiting`;
- `support_ticket_resolve`;
- `support_ticket_close`;
- `support_ticket_reopen`;
- `support_ticket_lookup_customer`;
- `support_settings_update`.

The public `support-gateway` Edge Function:

- verifies Yandex SmartCaptcha server-side;
- enforces intake settings and rate limits;
- creates guest tickets and session hashes;
- reads a ticket using a guest secret;
- posts guest messages;
- requests session recovery;
- returns sanitized, bounded errors.

No public request can insert a ticket directly into PostgREST.

## 13. Anti-Abuse

The public form uses:

- server-verified Yandex SmartCaptcha;
- a honeypot field;
- minimum realistic form-completion time;
- limits by IP, IP prefix, email hash, phone hash and guest session;
- a default aggregate limit of three new tickets per 15 minutes and ten per
  day;
- separate message-rate limits;
- bounded field lengths and normalized E.164 phone numbers;
- quarantine instead of immediate destructive deletion.

Initial web submission is text-only. Ticket attachments are enabled only after
MIME/signature validation, size limits and antivirus scanning. Until scanning
finishes, operators see a non-downloadable `checking` state.

## 14. Notifications

Authorized operators receive a `Support` category in Notification Center.
Support events include:

- new ticket;
- assigned ticket;
- new message;
- transfer;
- urgent pool return;
- escalation;
- resolution and closure.

Once claimed, pool-wide message delivery stops. Subsequent notifications go to
the assigned operator and requester as appropriate.

`support_operator_preferences` controls:

- all new tickets;
- urgent tickets only;
- assigned-ticket messages;
- transfers/escalations;
- email delivery;
- push delivery.

In-app notifications remain the semantic source of truth. Email and OS push are
delivery layers and do not create duplicate ticket/message rows.

## 15. Mailcow Integration

The planned mail domain is `app.letscube.ru` with:

- `support@app.letscube.ru`;
- `privacy@app.letscube.ru`;
- `dmarc@app.letscube.ru`;
- `postmaster@app.letscube.ru`.

Required DNS:

| Type | Name | Value |
| --- | --- | --- |
| MX | `app` | `mailserver.letscube.ru.` priority 10 |
| TXT | `app` | `v=spf1 mx -all` |
| TXT | `_dmarc.app` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@app.letscube.ru; fo=1; adkim=s; aspf=s; pct=100` |
| TXT | Mailcow selector under `_domainkey.app` | Exact DKIM value generated by Mailcow |

The backend mail worker:

- sends ticket replies through SMTP;
- polls the support mailbox through IMAP;
- maps replies using an opaque per-ticket inbound alias;
- sanitizes HTML and blocks trackers/active content;
- deduplicates by `Message-ID`;
- creates a new email-originated ticket for direct mail.

A direct email ticket can lack a phone number and is marked accordingly. The
web support form still requires phone. SMTP/IMAP credentials remain only in
server secrets.

## 16. User Interfaces

### `/support`

- public form and service-availability notice;
- immediate guest chat;
- locally remembered tickets;
- ticket status/timeline;
- authenticated profile prefill with per-ticket edits;
- responsive layouts without horizontal overflow.

### `/admin/support`

- common pool, mine, urgent, waiting, resolved and spam views;
- ticket-number search and filters;
- conversation, masked/unmasked contacts and timeline;
- claim, transfer, pool return, escalation, resolution and closure;
- customer lookup;
- operator preferences and global support settings.

### Global settings

- intake enabled/disabled;
- web form, guest chat and email channels;
- closure/maintenance message;
- working hours;
- limits and attachment policy;
- automatic closure;
- reminder and notification behavior.

## 17. Implementation Order

1. Public routes, Privacy UI, links and versioned policy content.
2. Migration proposal, generated types and RLS/security tests. Do not apply the
   proposal without explicit approval.
3. Support gateway, UI, permissions and notifications.
4. Review and manually apply the migration after approval.
5. Deploy and run browser/multi-account QA.
6. Configure Mailcow domain and publish DKIM/DNS.
7. Enable SMTP/IMAP integration and verify external mail.
8. Add attachment antivirus scanning and retention jobs.

Work that does not depend on MX/SPF/DKIM/DMARC starts first.

## 18. Acceptance And QA

Automated and physical QA must prove:

- public `/privacy` and `/support` do not redirect to login;
- only one of two operators can claim the same ticket;
- users cannot read another user's ticket;
- operators without permission cannot read the queue or contacts;
- contact details remain masked before assignment;
- guest access fails after token revocation;
- support notifications reach only authorized recipients;
- server intake closure cannot be bypassed through REST;
- CAPTCHA/rate limits cannot be bypassed through direct requests;
- no raw email, phone, guest secret, CAPTCHA token, SMTP credential or stack is
  exposed in logs or UI;
- status transitions and immutable events stay consistent;
- registration, chat, task and existing notification behavior do not regress;
- layouts pass at `3840x2160`, `1920x1080`, `1440x900`, `390x844` and
  `412x915`;
- browser console has zero unexpected errors and network requests have no
  unexplained failures.

Mail delivery QA runs only after Mailcow and DNS are ready. Missing mail
configuration must not break the web form, ticket chat or operator workflow.

## 19. Non-Goals For The First Delivery

- AI-generated support replies or automatic content decisions;
- public attachment upload before antivirus scanning exists;
- automatic account linking from an unverified email or phone;
- exposing IMAP/SMTP access to the frontend;
- changing existing chat semantics, push providers or package identity;
- automatically applying SQL or changing production DNS from the repository.
