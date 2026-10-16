# Existing Vault And Native Credential Consumption

Owner: coordinator. Item76/D-335. This advances cuts1/2 of the
[runtime continuation](2026-10-16-native-preview-runtime-next.md), not production
activation. The earlier real Settings cycle and renderer checks remain accepted.

## Source

- `MessagePreviewExistingVault` opens only an existing app-owned CE namespace,
  installation marker and metadata key, off the main thread. It does not mint a
  key, initialize a namespace, write a new head or infer recovery from a missing
  key. Android AtomicFile may perform its own documented backup recovery while
  opening a journal; this is not a claim of zero physical filesystem changes.
- Authenticated reads retain the stored kind, generation and vault revision.
  Committed reads additionally refuse non-COMMITTED, expired or wall-clock-below-
  highwater records. Current-head comparisons read again and compare every header
  field and the complete encrypted credential, not only a cached generation.
- `CredentialEnvelope.consume` supplies the decoded owner tuple, expiry and
  borrowed access bytes to one synchronous native-only callback. The existing
  AEAD format and parser are shared with `verifyMatch`; no bridge or token getter
  was added. Temporary plaintext/access buffers are scrubbed on success and on
  callback failure. Callback exceptions propagate rather than pretending no
  external effect could have occurred.
- Neither primitive is publication authority. The ordinary lifecycle still must
  serialize retirement/choice and recheck the authenticated head at use and final
  publication. No background lease is inferred from the old QA foreground lease.

## Verification

The loader's first RED was feature absence. Final compiled loader36/36 includes
eight literal omission controls, real JVM files/AES-GCM and labeled Android
policy/Keystore doubles. During review, an Android-specific FD ownership defect
was found: unlike the JDK, Android's FileInputStream(FileDescriptor) borrows its
descriptor. A separate `EXPLICIT_FD_CLOSE` case failed before repair; the reader
now uses Os.read and explicit Os.close in finally. Final36/36 includes read/close
failure and the FD-close omission control.
[Android stream ownership](https://developer.android.com/reference/java/io/FileInputStream#FileInputStream(java.io.FileDescriptor))
and [public Os.read](https://developer.android.com/reference/android/system/Os#read(java.io.FileDescriptor,%20byte[],%20int,%20int)).

Credential author verification accepts134 checks, including37 omission controls;
the last corrected control was rerun separately and the unchanged133 were reused.
The coordinator's affected provisioning/producer run passed172 and exposed one
stale mutation anchor for the old three-argument verifier. The production call
already has the current-owner fourth argument; correcting that test anchor makes
the compiled bypass fail its intended runtime oracle. That selected test passes
1/1. This is173 accepted affected cases, not a claim of an all-project green suite.
The old codec dependency pin was also updated to the already committed
producer-permit revision3924d35a; no dependency implementation changed here.

Commands used with `KUB_QA_ALLOW_MUTATIONS=0`:

```text
node --test tests/unit/native-message-preview-existing-vault.test.mjs
node --test tests/unit/native-message-preview-credential-consumer.test.mjs tests/unit/native-message-preview-credential-envelope.test.mjs
node --test tests/unit/native-message-preview-vault-provisioning.test.mjs tests/unit/native-message-preview-verification-producer.test.mjs
node --test --test-name-pattern="compiled literal omission: fresh verification invocation$" tests/unit/native-message-preview-vault-provisioning.test.mjs
```

Independent source review found only the FD issue above in the new loader and
shared credential parser. Its repair is covered RED-to-GREEN, not by relabeling a
JDK close as Android proof. Unchanged renderer/transport/Settings checks were not
replayed. The actual isolated SDK/device results below are separate evidence,
not implied by the JVM doubles.

## Actual Android Boundary

The final SDK artifact is a41368-byte, self-targeting instrumentation APK,
package `com.letscube.qa.previewvault20261016`, minSDK24/targetSDK35. No permissions,
activities, providers or network capability. Actual Javac/D8/AAPT2, signed manifest,
QA-only signature and alignment passed; final source/tool pins matched before and
after. SHA256:
`5e7ba222b1045a0239a6d2abb920947bad57ff49ea6f38fae61ce336431019ab`.
This is an isolated native test, not a new app release or replacement of Stable.

On Realme RMX3830/Android15, the final finite attempt passes
`PASS_TWO_PROCESS_EXISTING_VAULT`: seed11 checks and resume18 checks in different
processes. The second process reads the already committed G9/rev47 and existing
AndroidKeyStore keys before any fixture creation. It consumes the fictional
credential and checks callback failure/byte scrubbing, wrong head/key/ciphertext,
expiry/rollback, EMPTY/PENDING/RETIRING, corruption and key loss. Loader reads
preserve fixture bytes/inodes; missing keys are not repaired. Twenty repeated
loads leave the process FD count106 ->106.

Private receipts are under
`.ops-private/native-preview-existing-vault-device-20261016/build-r3/` and
`.ops-private/native-preview-existing-vault-coordinator-20261016/attempt-r3/`.
Earlier build refusals are retained: output-basename contract and compiled AAPT2
attribute projection, the latter corrected RED-to-GREEN6/6. The first two host
attempts misclassified successful ADB installation preambles and did not dispatch
instrumentation. Their exact APK cleanup/protected-state checks passed. The
retained output digest identifies incremental -> streamed -> Success; the corrected
host parser passes5/5. These refusals are not renamed device successes.

The accepted final attempt uninstalls exactly its APK (hash checked first), proves
package absence across the original users, and matches before/after primary20,
existing test installation, UID/CE/DE inodes, APK hashes and users. No wake setting,
UI capture, personal data, A063, Auth, provider request, release signing or database
operation was used. This proves the named native storage boundary, not FCM,
background notification delivery, lock-screen privacy or ordinary user choice.

## Remaining Connections

Next is ordinary Auth/producer durable provisioning and retirement, then ordinary
confirmed choice and reserve-before-lookup initial delivery. In particular, the
existing initializer still needs an adoption path that initializes its fence and
accepted revision from the authenticated loaded head. Do not reset it to G0/-1
or infer an interrupted PENDING/RETIRING operation's in-memory history.

The legacy create-only `AtomicBackend.MarkerIO` also uses borrowed FD streams;
its descriptor ownership needs the same Android-specific audit before ordinary
lifecycle reuse. This is an adjacent inactive path, not a silently completed fix.

Refresh ruling from current source: keep the existing Supabase client as refresh
owner (`autoRefreshToken:true` in `lib/supabase/client.ts`), not a competing native
refresh loop. `nativeVoiceCalls.ts` already subscribes to Auth and
`nativeVoiceController.signalSession` retires/rebinds preview candidates even for
same-identity token changes. Route this handoff through the producer once, not
ordinary verification followed by a second use of its ticket. Background after
JWT expiry must fall back to generic until a newly verified token is committed;
these primitives do not promise indefinite offline readability.

Protocol0/generic/richfalse remain. No production deploy, migration, provider
change or release replacement is authorized by these source tests alone.
