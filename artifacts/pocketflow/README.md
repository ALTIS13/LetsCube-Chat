# PocketFlow

A personal smart inbox, a few quick utilities, and a home for small
automations — and, at the same time, the reference bot for the LETSCUBE Bot
Platform. Send it a link, a note, a file or a JSON payload and it works out what
the thing is and offers what can be done with it; point a monitoring service at
one of its webhooks and the alert arrives as a card in your conversation.

It is an **outside application**. It talks to the messenger only through the
public Bot API, keeps its own database, and shares nothing with the platform's
schema. That is deliberate: if PocketFlow needed a private door, it would prove
nothing about whether a third-party developer could build the same thing.

## What it does

- **Smart inbox.** Text, URL, JSON, photo, document, voice, location — each is
  recognised and offered the actions that suit it. Everything you keep goes to
  `/saved`, which is searchable.
- **Reminders.** `/remind 20m проверить сервер`, `/remind завтра 18:00 позвонить`,
  or the quick buttons. They survive a restart, they know your time zone, and
  they can be snoozed or completed from the message they arrive in.
- **Webhook inbox.** `/hook` gives you an HTTPS endpoint and a secret. Anything
  that can POST JSON — GitHub, Grafana, Uptime Kuma, a CI job, a shell script —
  becomes a readable card in your chat. One generic endpoint rather than five
  integrations.
- **Watcher.** `/watch` follows a URL and tells you when its state *changes*:
  «🔴 example.com недоступен, 200 → 503», and the green one on recovery. Not on
  every poll — on a change.
- **`/selftest`.** A capability report for the platform itself, with five
  statuses and no flattery. See below.

## `/selftest` is the point, for us

PocketFlow is also a compliance test of the Bot Platform, and `/selftest` is
where that shows. Every capability reports one of:

| status | meaning |
|---|---|
| `PASS` | exercised, and it worked |
| `FAIL` | the platform has it and it did not work |
| `UNSUPPORTED` | the platform does not have it — **never reported as FAIL** |
| `USER_ACTION_REQUIRED` | needs a person; not `PASS` until they act |
| `SKIPPED` | a prerequisite was absent |

Two of those rules are the reason the report is worth reading. An unsupported
capability is a known gap, not a regression, and merging the two would bury a
real failure in noise. And a `callback_query` cannot be proved by *sending* a
button — it is proved when the press comes back, so the row stays
`USER_ACTION_REQUIRED` until it does.

Each run is stored, so two runs can be compared after a platform change.

## What this platform cannot do yet

Found while building this and recorded in
`docs/proposals/2026-09-19-pocketflow-reference-bot.md`. The short version:

- **A bot cannot send a file (G-1).** `sendPhoto` and its siblings take a
  storage object path, the gateway requires the object to already exist, and
  nothing in the public API lets a bot upload one or learn the path of a file it
  received. So QR codes, format conversion and «send it back» are absent rather
  than broken.
- **No inline mode (G-2)** and **no polls (G-3)**.
- **No `editMessageReplyMarkup` (G-4)** — `editMessageText` carries
  `reply_markup`, so editing markup costs a text round trip.
- **No `parse_mode`, but formatting is applied anyway (G-5).** The client
  renders `*italic*`, `` `code` `` and `~~strike~~` in every message, and there
  is no escape character. `src/lib/render.ts` is how PocketFlow sends a string
  that means what it says; read its header before printing anything a user or a
  webhook supplied.
- Rich messages, streaming, ephemeral messages, reactions and Mini Apps do not
  exist on this platform (G-6).

`/selftest` reports each of these as `UNSUPPORTED` with its reason, so the day
the platform gains one, the report changes on its own.

## Running it

### Configuration

| variable | required | meaning |
|---|---|---|
| `BOT_TOKEN` | yes | from the bot's owner panel |
| `BOT_API_BASE_URL` | yes | `https://api.letscube.ru` |
| `DATABASE_URL` | yes | PocketFlow's own Postgres |
| `TRANSPORT` | no | `polling` (default) or `webhook` |
| `PUBLIC_BASE_URL` | with `webhook` | this service's public HTTPS address |
| `WEBHOOK_SECRET` | with `webhook` | 16–256 of `[A-Za-z0-9_-]` |
| `DEVELOPER_IDS` | no | comma-separated user ids allowed to use `/dev` |
| `PORT` | no | default `8099` |
| `DEFAULT_TIME_ZONE` | no | default `Europe/Moscow` |

None of these ever reaches a log: the config object redacts itself, and the
logger drops `token`, `secret`, `authorization`, `text` and `content` wherever
they appear in a field tree.

### Locally

```bash
export BOT_TOKEN=...            # never commit this
export BOT_API_BASE_URL=https://api.letscube.ru
export DATABASE_URL=postgres://pocketflow@localhost/pocketflow
pnpm --filter @workspace/pocketflow run dev
```

Polling needs no public address, which is why it is the default for local work.
Migrations run on boot; each file is applied in its own transaction and
recorded, so a failed one leaves nothing behind and is retried next start.

### In production

Webhook transport is preferred, because it is the half of the platform that
needs exercising — and PocketFlow needs a public HTTPS endpoint anyway for
`/hook`.

```bash
export TRANSPORT=webhook
export PUBLIC_BASE_URL=https://pocketflow.example.com
export WEBHOOK_SECRET=...
pnpm --filter @workspace/pocketflow run build
node artifacts/pocketflow/dist/index.mjs
```

### Tests

```bash
node --test tests/pocketflow/*.test.mts
```

They need neither a database nor a network: the transport and the store are
parameters, and the fakes are in the test files.

## Running it against Telegram

The brief that commissioned PocketFlow asked that the same source run against
Telegram with only the base URL and token changed. That is not literally
possible against today's LETSCUBE API — the two wire formats disagree on the
shape of an identifier, on how a file is addressed, and on whether a write
carries an idempotency key.

So the promise is kept one level up. `src/app/` is written against the neutral
interface in `src/transport/types.ts` and never sees a UUID, a storage path or
an idempotency key. `src/transport/letscube.ts` is the only module that knows
this platform's wire format. A `src/transport/telegram.ts` beside it is the
whole of what a Telegram build needs, and nothing in `src/app/` changes.

## Layout

```
src/
  transport/   the Bot API adapter — the only place that knows the wire format
  app/         features: inbox, reminders, webhooks, watcher, selftest
  store/       Postgres access, one module per thing
  http/        incoming: the update webhook, and /hook/<id>
  scheduler/   background jobs
  lib/         pure helpers with their own tests
migrations/    PocketFlow's own schema
```

`src/app/router.ts` is the spine: features register commands, callback actions
and a message handler, and the router asks them in order. A registry rather
than a `switch` because `/selftest` has to enumerate what the bot can do, and a
list written by hand beside a dispatch written by hand is two lists that drift.
