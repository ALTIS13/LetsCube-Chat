# Task 11 of 12: controlled uptime alert lifecycle

**Resume:** Task 11 monitoring owner. Local lifecycle verified; external delivery
**NOT RUN**. No eligible LETSCUBE QA route was found in the checked scopes.
Next: identify or provision one isolated external QA delivery binding with
recipient-side readback, then run the bounded recipe below. External provider
rules/schedules remain unknown. Task 12 and the shared tracker are coordinator-owned.

## Evidence and limits

On **2026-11-05 19:22:34 UTC**, read-only Coolify
`search_resources(query="app.letscube.ru", types="application")` matched exactly
one `letscube-web` with the expected domain.
`list_env_keys(resource="application", uuid=<matched UUID>)` returned 28 key-name
rows, with `PORT`, `BASE_PATH` and `VITE_SUPABASE_URL` as positive controls.
No row named `VITE_SENTRY_DSN`, `VITE_APP_ENV`, `VITE_APP_VERSION`,
`VITE_APP_COMMIT` or `VITE_SENTRY_TRACES_SAMPLE_RATE` was returned. No values
were requested. This is the direct app configuration view, not shared/inherited
variables, exact served-bundle configuration or proof of inactive ingestion.

The [browser monitoring module](../../artifacts/kub/src/lib/monitoring.ts) gates
Sentry initialization on a DSN and applies key/pattern-based sanitization. The
[monitoring guide](../PRODUCTION_MONITORING.md) describes intended setup; neither
proves deployment, complete envelope redaction or actual event delivery.
No current frontend/Edge/worker error rule or independent uptime schedule was
verified. The [2026-10-18 backup inventory](2026-10-18-backup-monitoring.md)
recorded six disabled Coolify channels and no events at that time; it is not
current recipient or uptime evidence. The backup contract is unchanged.

## Local contract

The [ops reducer](../../scripts/ops/uptime-canary.mjs) takes only
`{ observedAt, outcome }`: integer UTC epoch seconds and `PASS`, `FAIL` or
`UNKNOWN`. The proposed fixture policy is one accepted observation per
60-second UTC slot; repeated and older slots do not vote. Two consecutive
failures open one incident, two consecutive passes recover it, and both votes
must be at most 120 seconds old when they confirm the transition. Missing
slots, `UNKNOWN` and opposite outcomes break confirmation. Malformed, stale,
future or over-specified input is discarded without echoing it.

An explicit retirement call closes an open incident with `RETIRED`, not
`RECOVERED`; retiring an idle canary is quiet. A retired canary cannot reopen
through late samples. Notices contain only the fixed monitor alias, kind and
original opening timestamp. The fixture sink collects those notices in memory;
there is no HTTP check, provider adapter, durable state, scheduler or retry
queue. Deduplication is proven across sequential observations on the same
state, not across processes, crashes or provider retries.

```powershell
node --test tests/unit/uptime-canary.test.mjs
node tests/rehearsal/uptime-canary-mutations.mjs
```

Node 24.15.0: the new suite was red before the module existed, then 10/10
passed. The unmodified mutation control passed and 12/12 variants failed
assertions: slot length, age, future time, old and duplicate slots, single-vote
confirmation, missing slots, expired first vote, unknown reset, private fields,
retired-state fencing and retirement mislabeled as recovery. No production
probe, provider test send, alert change, host command, capacity change or release
was run.

## Read-only inventory checklist

1. **Application errors.** Start with the exact running web image/build ID.
   Confirm the DSN presence boolean for that build and enumerate key names only
   in its application and inherited build configuration. In the owner's
   monitoring project, list web and worker/Edge projects/rules with a read-only
   role: service/environment/release, rule alias, enabled status, filter and
   threshold/window, cooldown, last matching-event UTC and last successful
   notification UTC. Do not open/export raw events. If there is no verified
   project or access, record `UNKNOWN` with the inaccessible scope.
2. **Uptime.** In the operator's existing external probe service, list checks
   for `app.letscube.ru`, `core.letscube.ru`, `mailserver.letscube.ru` and
   `deploy.letscube.ru`; include any separately routed worker/gateway. Record
   probe alias, public origin/path without query or credentials, method/protocol,
   location outside the production host and control plane, interval/timeout,
   success predicate, failure/recovery thresholds, enabled status, last
   completed poll UTC and destination alias. Require a page/entry asset control
   for web (SPA HTTP 200 alone is insufficient), a confirmed anonymous
   read-only health contract for Supabase, a configured TCP/TLS check for mail
   (no mail send), and public HTTPS/TLS for Coolify (not admin/DB health).
   Missing access or partial listings are `UNKNOWN`, not zero checks.
3. **Destination.** For each existing rule, confirm an owner-approved operator
   destination and whether delivery works with the app, host and its DB
   unavailable. Inspect enabled/event-routing booleans and acknowledgement
   timestamps only, never contact values, tokens, webhook URLs or message
   bodies. Distinguish configured, delivered and unknown. Do not use a product
   chat, change settings or bypass strict SSH host-key checks to fill gaps.

## Separate acceptance and retirement

With explicit authority for delivery, use a dedicated synthetic target and
operator destination independent of the production host/DB. Calibrate the
healthy probe, make only the synthetic target fail through its threshold,
leave it failing through additional polls, then restore it. Require exactly
one received open and one recovery for the same incident. Repeat with an open
synthetic incident and retire that exact canary; confirm its distinct closure,
no scheduled checks or pending retries remain, and normal rules are unchanged.
Record UTC, opaque canary/incident aliases, sanitized outcome, notification
count and actual recipient acknowledgement for each transition. Before enabling
any application-error rule, use an isolated staged event and inspect its
outbound envelope for fictional secrets, free text, route/media data and
identity leakage, without introducing a production error. A future adapter
needs durable state and a retry/idempotency policy keyed by monitor instance,
incident and transition; local fixture notices do not supply that guarantee.

No capacity or storage change is proposed. First measure sustained headroom,
trend and the actual limiting resource; require a reversible change and a
rollback trigger before acting.

## Coordinator follow-up

An actual [loopback HTTP rehearsal](../../tests/rehearsal/uptime-canary-loopback.test.mjs)
passed with a synthetic health endpoint and recipient: one opening, one
recovery, one later opening and its distinct retirement. A confirmed in-flight
response after retirement emitted nothing; the recipient saw only the four
redacted transition envelopes. The reducer plus this rehearsal passed 11 tests.
This is not external recipient or durable scheduler acceptance.

At `2026-11-05T19:29:43Z`, public web HTML, entry and service-worker hashes
matched the accepted `d86e22971566dee8` receipt. Anonymous Supabase Auth
health returned 401 and the Coolify public root returned 302; those establish
HTTPS responses, not internal service health. No live rule, recipient, monitor
schedule or capacity change was dispatched.

## Delivery inventory follow-up, 2026-11-05 UTC

| Scope | Read-only result | Delivery decision |
| --- | --- | --- |
| Coolify LETSCUBE project | Exact `app.letscube.ru` / `letscube-web` positive control. Complete project listing: five applications, one page, one environment. No monitoring/QA resource in that listing. Project and environment shared key-name lists were empty. Application key-name views showed no candidate monitoring binding; web returned 28 rows with `PORT`, `BASE_PATH` and `VITE_SUPABASE_URL` as controls. | Only the views queried; not a claim about runtime, host injection or other providers. |
| Coolify team notification channels | `get` succeeded for email, Discord, Slack, Telegram, Pushover and webhook. SMTP, Resend and instance-email use were false; all five other channel enable flags were false. `server_unreachable` flags were true, but `server_reachable` and `status_change` flags were false across the six. Only booleans were retained. | No enabled team delivery route. Do not enable or test-send on shared settings. |
| Documented monitoring DNS candidates | `status.letscube.ru` and `monitor.letscube.ru` each returned an A record matching the app and production SSH host. Bounded HTTPS HEAD, without following redirects, failed certificate verification for both (curl exit 60). The same check passed TLS on app (200) and Coolify (302). | Neither name established an independent HTTPS probe or recipient; TLS validation was not bypassed. |
| Production host names | Strict-host-key SSH metadata only: Docker names/images matched the Coolify and two Mailcow controls but no monitoring/QA candidate pattern. Systemd matched the backup-timer control and two old transient `letscube-bot-chat-canary-20260831*` units, both failed. No unit command, log or environment contents were read. | Historical product-chat tests are not a monitoring route; left untouched. Pattern inventory is not proof about arbitrary service names or off-host schedules. |
| Repository and local ops metadata | Repository monitoring references are plans or source; `.ops-private` filenames through depth 3 and existing tool capabilities yielded no identified external QA recipient or receipt reader. `letscube-support-mail` is documented as the live support-ticket bridge, with matching mail key names in Coolify. | Support mail and product chats are not QA destinations. No private file contents or live inbox contents were read. |

No external monitoring account or rule list was accessible as a verified
LETSCUBE resource. This establishes a missing usable binding in the inspected
scope, not that no third-party monitor exists. There were no external sends,
recipient acknowledgements, created canary resources or pending test retries to
clean up. No provider settings, production rules, shared state or release changed.

## Minimal wiring to unblock

Supply or provision one binding, proposed alias `letscube-task11-qa`, in a
LETSCUBE-controlled service outside the production host and app/DB. It must
route to exactly one operator-only QA inbox or channel, with no forwarding,
mentions or fan-out. Supply the service/project and route aliases, one scoped
send binding in its secret store, and read-only receipt access or a named
operator to acknowledge the four items. A provider's send/test API alone is
not sufficient. No production rule, Sentry deployment, shared channel change
or new provider purchase is required for this delivery-only proof.

1. **Preflight.** Verify ownership, exact destination, one-recipient scope and
   provider retry horizon using metadata. Confirm the isolated receipt view
   can count items by a fresh opaque run alias. Use a one-shot runner and a
   disposable synthetic target, never a production service. Pin the test
   target and recipient; abort if either is ambiguous or if the provider's
   retries cannot be inspected or bounded for this run.
2. **Bind the reducer.** Feed only completed observations of the synthetic
   target: calibrated 200 is `PASS`, intentional synthetic 503 is `FAIL`,
   all other results are `UNKNOWN`. Dispatch only non-null notices from
   `observeUptimeCanary`, adding the opaque run alias. Use the fixed monitor,
   transition and incident timestamp, with delivery key
   `(runAlias, incidentOpenedAt, kind)`. Send to the pinned route only, with a
   finite timeout, no redirects or automatic retries. An uncertain send stops
   the run for recipient reconciliation; do not resend it speculatively.
   Do not log transport addresses, credentials, bodies or raw failures.
3. **Run two cycles.** Use 14 consecutive UTC minute slots, numbered 0 to 13:
   `P F F F F P P P F F F P P P`. Replay each observation once in its same
   slot. The recipient must see `OPENED`/`RECOVERED` at slots 2/6 for incident
   one and 9/12 for incident two, with exact per-transition counts of one.
   Collect the observed receipt UTC and opaque IDs independently of the sender;
   the slots identify emission, not receipt time. Cap the run and observation
   window at 20 minutes; if the retry horizon is not settled by then, report
   duplicate status as unverified. HTTP success is only transport acceptance.
4. **Retire and clean up.** On success retire the idle reducer (no notice),
   stop the runner and remove only the exact disposable target and per-run
   scheduling/routing artifacts, if any. Check no owned checks or retries
   remain and normal rules are unchanged. On abort, stop polling and reconcile
   any open incident as retired/aborted, never as recovered without two passes.
   Preserve only sanitized receipt/count/cleanup metadata. A live `RETIRED`
   notification is a separate acceptance cohort; it is not one of these four.

**Proof audit:** Node 24.15.0, unit + real loopback 11/11, mutation control
passed and 12/12 mutants rejected. A separate in-process replay of the exact
14-slot recipe (with 14 same-slot replays) emitted only the two expected pairs;
idle retirement and a late observation added nothing. That replay validates
the recipe against the unchanged reducer, not delivery, remote scheduling,
provider retries or restart-safe idempotency. No generic live adapter was added
without a verified destination contract.

## Capacity sample, 2026-11-05 21:33Z

Read only the five exact LETSCUBE containers, not host-wide or other-project
statistics. Database: 30 observed backends with configured max 100;
126,471,315 bytes for the project database. The isolated snapshot showed web
8.7 MiB, database 321.4 MiB, Storage 135.7 MiB, Kong 847.5 MiB, Edge
179.4 MiB. The common Docker denominator is not a dedicated capacity budget.
One idle/transient sample proves no bottleneck, SLA or growth trend. No
resource limits or storage settings changed.

## Durable local state, 2026-11-06

The [SQLite store](../../scripts/ops/uptime-canary-state.mjs) commits a reducer
transition and its unique event together. It records the exact intent before
handing out a dispatch claim. After restart, an unknown ACK is not leased
again. Normal claims are ordered, including OPENED before RECOVERED. A
retirement can supersede old unclaimed events but not an unresolved attempt.
Provider dispatch ACK and exact QA recipient receipt remain distinct.

[12 local cases](../../tests/rehearsal/uptime-canary-state.test.mjs) passed
on Node 24.15.0, including a process exit after the committed intent, two
concurrent processes, transaction rollback, ordering and retirement.
The out-of-order claim was reproduced before the fix; three focused
ordering mutations were refused. This is local persistence/dispatch-fence
evidence, not a scheduler, live monitoring installation or external QA
receipt. No transport or production changes.
