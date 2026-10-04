# Emoji Message Measurement - 2026-10-04

Owner: Codex coordinator. D-340 / tracker item 79. Current candidate web source;
not the tester's unidentified installed build or a physical-device observation.

## Result

Forced oversized emoji-only presentation was **not reproduced**. The current
`MessageBubble` uses ordinary message typography, with no separate jumbo branch.
Do not shrink the reader's text-size preference to close an unmeasured report.

[Focused browser guard](../../tests/e2e/message-emoji-size.spec.ts) renders fictional
plain text, one and multiple emoji, a ZWJ family, a skin-tone sequence, a keycap
reply and mixed text. The final twelve cases pass in 28.5s at 1440/390,
dark/light, with sizes 13/16/22. An absent stored preference yields literal
16px/26px leading. The
probe is calibrated with an actual temporary rendered 48px/78px subject: its
glyph rectangle grows to 59px instead of the ordinary 16/20/26px. This is a
measurement control, not a claim that shipped code previously used 48px.

| Text Size | Ordinary/Single-Emoji Bubble Height | Emoji Glyph Rectangle |
| --- | ---: | ---: |
| 13px | 35.125px | 16px |
| 16px (default) | 40px | 20px |
| 22px | 49.75px | 26px |

These values matched both tested viewports/themes. Text and footer stay inside
the bubble and do not overlap, including the quoted reply. Glyph rectangles
measure rendered layout, not the platform's exact painted emoji artwork.
Four default-size screenshots were visually inspected; both themes differ and
the selected content/metadata fit. Metrics and fictional pixels are ignored
under `output/message-emoji-size-reply-verified/`, not production captures.

The reply additionally requires one visible preview with literal referenced text
`Reference`, inside the bubble and above/separate from body and footer. Actual
rendered controls hide the preview or move it 600px outside: both are detected,
then removal restores the original assertions. The earlier measurement lacked
this coverage; independent review found that test gap, not a product defect.

At the default size, mobile tap and desktop context-menu entry points expose
the reply and copy menu items. The copy labels are intentionally different:
mobile `Копировать`, desktop `Копировать текст`. Menus close via Escape; commands
are not executed and no message or clipboard mutation is claimed.

The first desktop probe falsely counted the intentionally external reaction
button as bubble overflow. Its oracle now checks actual glyph/footer geometry;
that failure was a measurement defect, **not** application RED or an app fix.
Additional probe corrections use the actual menuitem role and platform-specific
copy label; those selector failures also were not application defects.
Reply controls use a short untruncated fictional reference and a unique opening
message; an overly long expected quote and a non-unique helper selector failed
before those fixture corrections, not because the application lost the reply.
External hosts are blocked, loopback configuration is required, auto captures
are off and `KUB_QA_ALLOW_MUTATIONS=0`; no message POST occurred.

## Remaining Work

D-340 stays open until the tester's exact platform/build/preference and rendering
can be compared, or the reported state is reproduced. Windows-hosted Chromium
mobile emulation does not prove Android/iOS emoji fonts, Safari, an installed
PWA or native release bytes. No application sizing/style change, device session,
paid minute, provider request or production deployment occurred in this step.
