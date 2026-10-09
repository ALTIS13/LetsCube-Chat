# Native preview: fixed local-page health measurement

Date: 2026-10-09. Status: R3 physical measurement PASS / COMPLETE.
This is a separate anonymous diagnostic context, not a product repair or Task5
Auth/provider acceptance. Main/web `4765bcad` and Stable 0.1.14/build15 are unchanged.

## Changed Context

The new diagnostic loads one fixed local main-frame URL. Its owned WebViewClient
serves constant in-memory page bytes once, without a localhost network escape.
Readiness requires the exact owned view, URL and served-main-frame flag before
the single fixed anonymous health GET. Other requests remain blocked; there is
no favicon exemption, trust change, credential, Firebase or production-class use.

This eliminates the diagnostic's data/history bootstrap ambiguity by design.
It does **not** identify the callback or cause of the older failed R2 measurement.
[R1/R2 failures, compiler repair and limitations remain immutable](2026-10-09-native-preview-user0-health.md).

## Reviewed Inputs

Accepted private reviews, under the native-preview-device-binding plan workspace:

| Review | SHA256 prefix |
| --- | --- |
| `task-5-user0-health-local-page-source-review.md` | `222DAB6056AFCBD5` |
| `task-5-user0-health-local-page-build-binding-review.md` | `6CF5D9D795FC15C1` |
| `task-5-user0-health-local-page-host-review.md` | `AE3E7BDAB8287AEE` |
| `task-5-user0-health-local-page-device-binding-review.md` | `68E1FEE5868C00E6` |
| `task-5-user0-health-local-page-artifact-review.md` | `50C89A53CD534DE7` |

R3 APK: 20,890 bytes, SHA256
`56905EB63DFE510FDE28944557FE3B5220366D9D2D0FBCE2B0E23A84C64A89E3`.
Build result: `3F92EA81336E494AEF1C9F5707B72AFFBEC78F63EDE97D877DC33D49D7BE76EB`.
Builder `256F18DE`, host `0AC08DF3`, Activity `2EE08FAD`, unchanged
Instrumentation `D7B91E68` and manifest `478D7F6C` match the sealed receipts.
Source digest `EFBFFD45` binds the three ordered source pins. The accepted build
has two Java sources, no production sources and a separate diagnostic signer.

## Actual Measurement And Cleanup

One coordinator invocation on Realme, in a separate own package under user 0:

```text
node .ops-private/native-preview-user0-health-device-r3-20261009.mjs --prepare
```

The finite process closed with exit 0. Installation was observed at 19:04:57
Moscow; the coordinator recorded completion at 19:05:22. No repeat was performed.
Ten fixed `device-r3` JSON records were independently checked against the sealed
source/build/APK/public-signer pins and intent -> install ACK -> owner -> core
intent -> measurement / cleanup correlations. UID/incarnation checks stayed private.

`local_ready`, `request_started`, `health_get_observed`, `web_completed`,
`web_response` and `web_401` are true; `web_2xx` is false. Route/admission refusal,
timeout, rejection and all resource-error flags are false. This proves an HTTP 401
response in this anonymous app-UID/WebView context, not an authenticated success.
All 35 boolean fields match the fixed schema; all four app cleanup fields are true.

Exact own-package uninstall ACK and cleanup are PASS, with `targetAbsent=true`.
Main APK, installed test APK and users are preserved; the coordinator separately
confirmed exact package absence under user 0. Local original test bytes are not
the installed test baseline. No production screen, message or credential capture
was taken, and no PIN was used.

The native KeyguardManager admission passed even though the shell policy
projection still reported showing=true. That projection alone is not authority
for the native admission result. This is **not** an unlocking claim or an
explanation of the historical refusal.

Fixed receipt hashes:

| Record | SHA256 |
| --- | --- |
| `prepare-observation.json` | `5018C398347B21179F6153DE5FB192CB74CEF7B8703D0BC029BB2C7E41542EBC` |
| `prepare-outcome.json` | `DC4CB8271A1888450A5B36CFFB0C6702FBDC16C15F1C316D525CC9E8A1EFA265` |
| `cleanup-receipt.json` | `391E0B48197D9539B5DE9D3247DCE8528C07F97E52B328F04A5B724439B99E86` |

## Remaining Boundary

Health has no Firebase/provider or SDK Auth/resolver integration. The separate QA
package still lacks genuine provider Android-client configuration and verified
app/signature restrictions. Next: obtain that legitimate isolated configuration,
then normal owned-QA UI sign-in, own SDK registration, live-session resolver and
native verification/logout/cleanup under the [verification-only bridge contract](2026-10-08-native-preview-verification-bridge-plan.md).
No copied token, fabricated row or primary-package fallback supplies that proof.
This result does not establish primary-app connectivity, FCM delivery, vault
composition or rich display. Protocol 0 and false rich/native-positive flags are
not promoted; D335 and Task5 remain open.
