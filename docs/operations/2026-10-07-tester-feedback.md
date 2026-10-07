# Tester feedback - 2026-10-07

Owner: coordinator. Authorized incremental intake from the existing selected
owner/tester conversation; no account or conversation enumeration.

## Verified Intake

The read-only, bounded intake found 16 new messages from 2026-10-05 to
2026-10-07: eight text, two image, three voice and three video attachments.
The previous cursor and membership positive controls passed; limits were not
reached. No qualifying edits appeared in the bounded seven-day preceding window.
This is not an all-history edit audit.

Three voices were transcribed locally, 213.2 seconds total. Images and sampled
video frames were processed locally. Only privacy-safe structural reconstructions
were viewed, not personal media or production screens. No inference upload was
used; original bodies, identifiers, URLs, media, ASR, OCR and model prompts remain
in ignored private storage.

## Grounded Reported Issues

These are reports, not reproduced bugs. Private source anchors match the original
ASR segments; that linkage does not certify ASR accuracy or prove the cause.

| Task | Report | Unresolved Boundary |
| --- | --- | --- |
| D-348 / item 84 | Starting another voice-message recording asks for microphone access again. | Client/build and system permission dialog versus app prompt are unknown. Releasing capture between clips is intentional; keeping the microphone open is not an acceptable workaround. |
| D-349 / item 85 | Notifications remain after reading. | Client/build and in-app centre versus OS notification history are unknown. Reading a chat is not necessarily reading every newer notification. |
| Item 86, preliminary | Frequent reloads while working with tasks. | Manual versus automatic reload, triggering operation, client and build are unknown. Task editing specifically is not established. |
| Item 87, preliminary | Delayed loading of interface elements and messages. | Screen, state, client, build and cause are unknown. No cache explanation is accepted; closed item 58 is comparison context, not a reopened regression. |

Neither is declared a regression of a previously closed defect. Repeated
microphone access differs from D-309 push-permission presentation and D-190
recorder hint overlap. Read-notification cleanup differs from D-335 preview
content, D-344 activation routing, D-345 account-card retirement and D-347 push
preference ownership.

## Coverage Limits And Next Work

The first multi-source drafts failed grounding/schema checks and are not findings.
General gestures, keyboard-adjacent spacing, naming and ordering wording
has not passed sufficient source/surface validation. No cache, avatar-worker,
automatic chat-opening or own-profile root cause is asserted.

The bounded remaining text/voice pass completed once per source: two voices and
eight texts, reusing saved input without another export. Nine of ten sources have
accepted private fragment linkage. One text and the ambiguous surface/gesture
descriptions remain unresolved, not proof that they contain no feedback. Two
additional preliminary observations above passed linkage, not reproduction or
complete semantic validation. Source diagnosis found independent real capture,
receipt and read-state ownership defects; these are tracked separately from the
unidentified tester client. Sampled/redacted geometry is not continuous-motion
or visual acceptance.
Preserve ambiguities rather than removing a native keyboard accessory or claiming
that unresolved material contains no further issues.

Next: identify the applicable capture/read-cleanup boundary, reproduce a concrete
failure with fictional data before patching, and retain client/device acceptance
separately. Do not rerun accepted unrelated suites.
