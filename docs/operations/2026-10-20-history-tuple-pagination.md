# Older-History Tuple Pagination

## Resume

- Owner: Codex coordinator; canonical `android-current-20261015`, branch
  `codex/ui-motion-updates-20261019`, released baseline `41b775c7` / Stable32.
- Stage: D-388 source repair, affected checks and final review are accepted.
  Candidate metadata is Android0.1.32/build33, not yet built/published.
- Source boundary: `useMessages.loadOlderMessages`, its actual-hook/installed-SDK
  tests and the affected lifetime/account fixtures. No SQL, history retention,
  media body, native updater or notification-privacy contract change.
- Next: build/verify the immutable
  candidate, then device/publication/live-web proof. Do not claim this implements
  persistent received-text history.

## Confirmed Failure

The server page sorts by `created_at DESC, id DESC`, but the older-page filter
uses only `created_at < oldest.created_at`. A timestamp shared across page
boundaries therefore excludes older IDs at that same timestamp. The controlled
shipped-source case passes five controls and fails the tied-page assertion:
after asking for the second page it still holds100 tied rows instead of200.

The new bounded case executes the compiled full hook, installed PostgREST SDK
and a synthetic HTTP leaf. Its375-row corpus includes250 tied timestamps and125
earlier rows. It is not a live PostgreSQL/PostgREST or physical-device proof.
The earlier fixture run and its corrected busy-finally oracle are retained;
setup/oracle failures are not presented as product defects.

## Repair and Review Boundaries

Use the same exclusive pair as the server order: strictly earlier time, or equal
time and smaller UUID. Preserve the server's timestamp string/microseconds/offset;
validate cursor UUID/time before constructing the quoted logical predicate.
The SDK performs URL encoding. [PostgREST logical operators](https://docs.postgrest.org/en/stable/references/api/tables_views.html#logical-operators)
and [reserved-character quoting](https://docs.postgrest.org/en/v16/references/api/url_grammar.html#reserved-characters)
describe this grammar; the installed-SDK tests also retain both the general-topic
OR and the older-page OR rather than overwriting the former.

Final review found an important mixed-list case: an old failed/pending `tmp:`
message must remain visible but cannot become a server UUID cursor and block all
older reads. The cursor must come from confirmed server rows. Existing display
sorting also rounds timestamps to milliseconds, so array position alone cannot
establish the minimum server tuple when rows differ only in microseconds. These
cases were reproduced RED0/7 before the final selection repair. The cursor now
uses the actual minimum microseconds/ordinal-UUID pair among confirmed rows.
Local-only lists do not dispatch a raw cursor or discard their `hasMore` state;
invalid confirmed rows still refuse before transport.

The existing clear/topic/deleted-row filters, request/account/lifetime/privacy
generations and older busy ownership must remain. Invalid confirmed cursors still
refuse before transport; a local draft must not be removed to make loading pass.
The all-hidden-page/raw-cursor issue predates this change and is a distinct
unreproduced follow-up, not silently claimed fixed by the tuple predicate.

## Verification and Release

New pagination checks pass33/33, with ten loaded literal omissions refused.
Coordinator's final integrated affected cohort passes155/155, zero skips, and
typecheck/diff checks pass. Independent final source review is clean after the
mixed-local/minimum-tuple finding was fixed. Source SHA256
`f785bf546b9239672aa5174104f8645083d54034cb22a3e2b218e1b3ac0bcfe8`.

The first integrated run was138/140 because the existing account fixture could
not evaluate a newly referenced scheduler dependency. The same ReferenceError
was proven against shipped baseline41b775c7 before repair. The fixture now runs
the real scheduler/current fetch callback with finite timers, rather than a
no-op; its epoch/retirement positive control and loaded lifecycle omission fail
for the expected assertions. This is a test-harness repair, not an app defect.

Native candidate/release acceptance remains next. No Stable33, actual in-app
32 ->33 update, live pagination canary or persisted received-history feature is
claimed by this checkpoint.
