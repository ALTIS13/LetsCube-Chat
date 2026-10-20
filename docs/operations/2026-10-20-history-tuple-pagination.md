# Older-History Tuple Pagination

## Resume

- Owner: Codex coordinator; canonical `android-current-20261015`, branch
  `codex/ui-motion-updates-20261019`, released baseline `41b775c7` / Stable32.
- Stage: D-388 RELEASED at `b50dda0f`; Android0.1.32/build33 Stable.
- Source boundary: `useMessages.loadOlderMessages`, its actual-hook/installed-SDK
  tests and the affected lifetime/account fixtures. No SQL, history retention,
  media body, native updater or notification-privacy contract change.
- Next: fix the distinct actual updater-bridge thread failure found by the
  A06332 ->33 canary. Do not claim this implements persistent received history.

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

## Release

Product `b50dda0f0f33a4ea8259f50c2f1e21c1c0b15506` built freshly:
`sw.js build 846d0c412bd39c77`, `built in 23.99s`, `BUILD SUCCESSFUL in 14s`.
APK7,816,337B SHA256
`59262f006cb8cfe72fc920abcc2431922b3b24050a62ed5c9939d5d1dd50658e`;
AAB7,440,653B SHA256
`c926fbcc18cadd23e26ca29add6ead2e3b918e65984533cabee925a5127ba4ce`.
Original sole signer/APKv2, exact Firebase4, false QA flags and42-file web/config/
DEX parity pass. Updater5 class definitions/registration/permission/provider pass;
these are artifact checks, not proof of its JS/native entry point.

Realme32 ->33 keeps UID/data/firstInstall and opens the guest interface, fatal0.
The initial locked-screen refusal was before installation; ordinary non-secure
keyguard dismissal changes that input and the accepted attempt follows. Stable33
publication at2026-10-20 21:03:20Z has mandatory=false, old32 rollback retained
and exact complete public APK bytes/SHA. No DB migration, Windows shell or native
Apple binary change.

Sole-healthy shared web image `b50dda0f`, build `affacc90ed0418d6`, has public/
container HTML/JS/SW parity. The new cursor marker is absent from old41b775c7,
present in the released tree/served entry, with the old timestamp-only selector
removed from the new source at21:06:39Z. Windows remote renderer/shared PWA receive
this repair; full physical pagination is not claimed from source/guest checks.

Actual A06332 ->33 in-app canary is REFUSED before download. Its separate
[bridge-thread cause and Native34 repair](2026-10-21-android-update-bridge-thread.md)
remain explicit; no successful built-in installation or disk history is claimed.
