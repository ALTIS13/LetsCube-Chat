# End-to-end encryption for voice, and the key layer it needs

**Status:** proposal. Nothing here is built. Asked for by the owner on
2026-09-18, alongside the Discord-shaped voice work, so that the voice system
ships whole rather than in a shape that has to be reopened.

**The one-sentence version.** LiveKit already carries the encryption; what does
not exist is any way to agree on a key, and that is the whole of the work.

---

## 1. What is already true

**MEASURED**, by reading the repository on 2026-09-18:

- The media stack is **LiveKit** — `livekit-client ^2.22.3` in
  `artifacts/kub/package.json`. Its E2EE is `insertable streams` (encoded
  transforms) with **AES-GCM**, applied in a worker between the encoder and the
  transport, so the SFU forwards ciphertext it cannot read.
- **There is no per-account key material anywhere in this product.**
  `crypto.subtle` appears twice in the whole client — `usePush.ts:660` and
  `pwa/serviceWorkerBuild.ts:90` — and both are SHA-256 digests. No keypair, no
  public key column, no key table, nothing in the migrations under
  `public_key`, `device_key`, `identity_key` or `prekey`.
- LiveKit's own documentation is explicit that this half is ours: it «does not
  (and cannot) store or transport encryption keys for you». The built-in key
  provider takes a shared secret that the application has already agreed on.

So the question «how hard is E2E voice» is entirely the question «how do two
people who have never exchanged a key agree on one without the server learning
it».

## 2. Why voice is the cheap place to start

This matters for sequencing, because the instinct is to do messages first and
the instinct is wrong here.

**A voice key only has to live as long as the call.** There is no history to
re-key, no backlog to re-encrypt, no new device that needs to read last year's
messages, no multi-device sync of a ratchet, no «this message could not be
decrypted» state to design. When the call ends the key is garbage. That removes
the three hardest problems in end-to-end messaging and leaves one: agreeing on
a key for the next ten seconds.

Doing voice first therefore builds the identity layer — a keypair per account,
published public halves, a way to verify them — which is **the same layer
message encryption would need later**, at a fraction of the risk, because a
mistake costs one call rather than a mailbox.

## 3. The shape

### 3.1 An identity key per account

A long-lived keypair per **device**, not per account: a person signing in on a
phone and a computer has two, and both publish. Per-device is what makes
«revoke this device» possible later and what stops a stolen session token from
being a stolen key.

- Generated on the client with `crypto.subtle.generateKey`, **non-extractable**
  where the platform allows it, stored in IndexedDB. A non-extractable key
  cannot be read out by any script, including ours, including a compromised
  dependency.
- The public half is published to a new table. The private half never leaves
  the device and is never sent anywhere. **If the server ever receives a private
  key, this design has failed and the feature should be turned off rather than
  shipped.**
- X25519 (ECDH) for agreement. Ed25519 for signing, if the platform has it;
  otherwise ECDSA P-256, which every WebCrypto implementation has.

### 3.2 A room key per call, wrapped to each participant

Whoever opens the room generates a random 256-bit key. For each participant it
is wrapped with a key agreed from the two devices' public halves, and the
wrapped copies are what travel. The server stores and forwards a set of opaque
blobs; it holds no key that opens any of them.

**Rotation is not optional.** Someone who leaves the room keeps the key they
had, so without rotation they can keep listening to a call they were removed
from — which is the whole point of removing them. The key rotates on **every**
join and leave. LiveKit's key provider supports a key ratchet for exactly this.

### 3.3 Verification, or it is not end-to-end against us

The server distributes public keys. A server that wanted to listen could hand
out its own public key instead of yours, wrap the room key to itself, and
forward. Everything would work and nothing would look wrong. Encryption without
verification protects against a passive operator and a breach of the media
path, and **not** against the product's own infrastructure.

Say that plainly in the interface, or build verification. The proposal is to
build it: a **fingerprint of the two devices' public keys**, shown as a short
code or a QR both sides can compare out of band, the way Signal's safety
numbers work. It is cheap — it is a hash and a screen — and it is the
difference between a true claim and a padlock drawn on.

Discord's own «Защищено сквозным шифрованием» badge, which the owner's
screenshot shows, does not come with user-facing verification of this kind.
We should not copy that part.

### 3.4 Where it cannot work, said out loud

- **Firefox has no `RTCRtpScriptTransform`**, so it cannot do insertable
  streams and cannot do this. Our own shells are all Chromium — the Windows
  Tauri shell on WebView2, the Android WebView, and Chrome or Edge in a browser
  — so every shipped shell is fine; a Firefox user on the web is not.
- A room with **one participant that cannot encrypt** cannot be an encrypted
  room. The choice is to refuse them or to drop the whole room to plaintext,
  and the second must never happen silently.
- Recording, transcription and any server-side processing of audio become
  impossible by construction. That is the point, and it is worth knowing before
  somebody asks for call recording.

## 4. What the interface must never say

The badge on the owner's screenshot — «Защищено сквозным шифрованием» — is a
claim about a property, and this product has a rule about claims it cannot
support: `ProfileRoleSummary` printed «Пользователь» to almost everybody
because an enum default was rendered as a fact (D-213), and the invite card
printed a policy it had never read (D-165). The same rule applies here and
more sharply.

**Decided by the owner on 2026-09-18**, answering the question at the end of
this document: no padlock in an unverified room. Either nothing, or a padlock
that is **red, with a lightning bolt or broken**, and a hover that says the call
is not protected.

Taking the second, because nothing is worse than something wrong: an absent
indicator reads as «this screen has no opinion», and a person cannot tell it
apart from a screen that has not loaded. A broken padlock is an opinion.

So three marks, one per state, and the **wording** carries the distinction the
icon cannot:

1. **Encrypted and verified** — a closed padlock, and the sentence the owner's
   screenshot shows.
2. **Encrypted, not verified** — the broken padlock, per the decision above.
   Its hover says what is actually true: the media is encrypted and the person
   on the other end has not been verified, with the verification a tap away.
   **Not «звонок не защищён»**, and this is worth one sentence of argument: an
   unverified encrypted call *is* protected against the media path and against
   a passive operator. Telling somebody their call is unprotected when it is
   partly protected is a false alarm, and an indicator that cries wolf is an
   indicator people learn to ignore — which costs exactly the case in state 3.
   The icon is the owner's; the sentence has to be the true one.
3. **Not encrypted** — the same broken padlock and the blunt sentence:
   «Звонок не защищён». With the reason, because a room that quietly fell back
   is worse than one that never claimed anything.

The two red states share an icon and differ in words. If that turns out to read
as one state rather than two, the fix is a second icon rather than a softer
sentence.

## 5. Sequencing

The voice work the owner asked for is a separate, larger list — the connection
monitor, the connection test, push-to-talk, devices, per-participant volume and
the rest. This one is ordered against it as follows:

1. **The connection monitor first.** It is the owner's own example, the data is
   already there in LiveKit's `ConnectionQualityChanged` and `getStats()`, and
   it is the cheapest visible thing in the whole list.
2. **The identity layer** — keypair, publication, fingerprint — which is
   useful on its own and is the prerequisite for everything below.
3. **Encrypted rooms**, with rotation, refusing rather than falling back.
4. **Verification**, and only then the padlock.

Each of 2–4 needs a migration and each is reviewable on its own. None of them
should be merged into the voice feature work, because a feature that is late is
a feature that is late, and a key layer that is wrong is a promise that was
never true.

## 6. Open questions for the owner

- ~~**Should an unverified room show a padlock?**~~ **Answered 2026-09-18:**
  not a green one. A red padlock, with a lightning bolt or broken, and an
  explanation on hover. Written into section 4 above, with the one refinement
  that the *wording* for «encrypted but unverified» must not claim the call is
  unprotected, because it is not — only unverified.
- **What happens to a participant whose device cannot encrypt** — refused, or
  the room stays plaintext and says so? The recommendation is refused, with a
  sentence naming the browser.
- **Is call recording ever wanted?** If yes, it and end-to-end encryption
  cannot both exist for the same room, and the choice has to be per channel
  rather than product-wide.
