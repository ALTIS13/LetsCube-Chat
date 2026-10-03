# Storage SDK HTTP Boundary - 2026-10-03

## Result

Owner: Codex coordinator, `codex/bot-inline-media-20261002`; runtime source
`3976348f`, inline checkpoint `a4ee56de`. Actual installed Supabase JS **2.105.1**
and Node fetch run through owned loopback HTTP. **9/9** transport cases and
**5/5** compiled control/mutation tests pass; with the seven unchanged Storage
unit controls, the joint result is **21/21**, no skips. No runtime patch is needed
for this measured boundary. Initial fixture validation incorrectly required a
token field on the finish RPC; correcting that harness expectation is not a
product fix or a reproduced production defect.

## Cases And Oracles

[HTTP fixture](../../tests/server/bot-media-storage-sdk-http.fixture.mjs) supplies
controlled RPC and Storage responses, never a real provider or durable SQL state.
It constructs a fresh synthetic key/pepper, passes only explicit loopback config,
and permits no DELETE, unexpected RPC or automatic repeated PUT. Unexpected
fixture assertions are retained and raised independently of SDK error mapping.
The owned server closes all its connections in test cleanup.

[Nine cases](../../tests/server/bot-media-storage-sdk-http.test.mjs) cover normal
insert-only upload, equal 409 bytes, same-length changed bytes, short and oversized
bodies, GET/PUT connection resets, 403 and malformed successful response. Begin
intent HTTP response precedes the single PUT. Only successful verified content
records acknowledged; failures record unknown, with sanitized public errors.

The oversized response deliberately leaves its remainder unfinished. The actual
streaming consumer rejects and closes it before the server ends the body; a
buffered download cannot pass by consuming a timed complete response.
[Compiled mutants](../../tests/server/bot-media-storage-sdk-http-mutations.test.mjs)
remove the digest check, admit a short body, mark a lost upload acknowledged or
omit both stream abort/cancel. Each is rejected by literal consumer assertions;
the compiled unmodified repository passes the same oracles. Four mutants, not
five; the fifth test is the positive control.

## Frozen Inputs

Before the final child-process run, **25 reachable local inputs** and four
installed package identities were frozen; final/current hashes match. Supabase
JS, Storage JS and PostgREST JS are each **2.105.1**; esbuild is **0.27.3**.
Manifest SHA256:
`3570b01dbdf4fd21f25e51ffc24fb1e8466a018b9c044520685475a447206eb4`.
The final 21/21 completed at `2026-10-03T16:27:33.720Z`.
Independent scoped review reread the final unfinished-body oracle and has no
findings; execution and source-hash verification belong to the coordinator.

## Continuity And Limits

This is distinct from [6/6 actual SQL/PostgREST inline recovery](2026-10-03-bot-media-inline-http.md).
No production account/configuration, provider PUT/GET, physical generation,
terminality, quota refund, migration, main deployment or native operation is
involved. HTTP RPC replies here do not prove durable intent or authorization.
Existing broader authority REDs remain open; there is no all-green release claim.

Next: [deferred PUT across real SQL lease takeover](2026-10-03-bot-media-external-io-next.md#smallest-next-source-test),
then the separate deployed-equivalent Storage/generation and avatar/variant
participants. No DB transaction may span network I/O. Whole-chat-media and
Android/native holds stay in force; do not replay accepted SQL or enable cleanup.
