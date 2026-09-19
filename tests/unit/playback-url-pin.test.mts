import assert from "node:assert/strict";
import test from "node:test";

import {
  choosePlaybackUrl,
  isResignatureOf,
  shouldRetryWithFreshAddress,
  signedObjectIdentity,
} from "../../artifacts/kub/src/lib/media/playbackUrlPin.ts";

/**
 * D-208: what a `<video>` or an `<audio>` is allowed to have its `src` changed
 * to while somebody is watching.
 *
 * Setting `src` reloads a media element — playback stops, the position goes to
 * zero, the buffer is thrown away. That has never mattered here because a
 * public URL is a constant. A signature is not: it is replaced at 80% of its
 * life, so without a rule the renewal restarts whatever was playing when it
 * happened.
 *
 * The rule cannot simply be "never change the src", because two of the changes
 * the product already makes are deliberate: the 720p re-encode arriving beside
 * the original, and the fallback to the original after a failure. So what is
 * held back is exactly one thing — the same object signed again.
 */

const SIGN = "https://core.letscube.ru/storage/v1/object/sign/media";
const PUBLIC = "https://core.letscube.ru/storage/v1/object/public/media";
const OWNER = "3adfd4e6-fff4-4bea-8092-04b62a45a177";

const original = `${PUBLIC}/${OWNER}/1757000000000-clip.mp4`;
const video720p = `${PUBLIC}/variants/messages/c/m/video_720p.mp4`;
const signedAt0 = `${SIGN}/${OWNER}/1757000000000-clip.mp4?token=aaa.bbb.ccc`;
const signedAt48 = `${SIGN}/${OWNER}/1757000000000-clip.mp4?token=ddd.eee.fff`;
const signed720p = `${SIGN}/variants/messages/c/m/video_720p.mp4?token=ggg.hhh.iii`;

test("a signed URL is identified by its object, not by its token", () => {
  // Bucket and path, so two buckets holding the same leaf name are not one.
  assert.equal(signedObjectIdentity(signedAt0), `media/${OWNER}/1757000000000-clip.mp4`);
  assert.equal(signedObjectIdentity(signedAt0), signedObjectIdentity(signedAt48));
  assert.notEqual(signedObjectIdentity(signedAt0), signedObjectIdentity(signed720p));
});

test("a public URL has no signed identity at all", () => {
  // This is the line that makes the shipped mode byte-identical: in `"public"`
  // nothing below can hold anything back, whatever the element is doing.
  assert.equal(signedObjectIdentity(original), null);
  assert.equal(signedObjectIdentity(null), null);
  assert.equal(signedObjectIdentity(""), null);
  assert.equal(signedObjectIdentity("not a url at all"), null);
});

test("public mode: the element always takes the address it is offered", () => {
  for (const engaged of [false, true]) {
    assert.equal(choosePlaybackUrl({ pinned: original, incoming: video720p, engaged }), video720p);
    assert.equal(choosePlaybackUrl({ pinned: video720p, incoming: original, engaged }), original);
    assert.equal(choosePlaybackUrl({ pinned: original, incoming: original, engaged }), original);
  }
});

test("a renewal does not reach an element that is mid-playback", () => {
  assert.equal(choosePlaybackUrl({ pinned: signedAt0, incoming: signedAt48, engaged: true }), signedAt0);
});

test("an idle element takes the renewal at once", () => {
  // So that the element holding a token about to expire is never the idle one:
  // it is the only one that can swap without costing anybody their place.
  assert.equal(choosePlaybackUrl({ pinned: signedAt0, incoming: signedAt48, engaged: false }), signedAt48);
});

test("a different object reaches the element even mid-playback", () => {
  // The 720p re-encode arriving, and the fallback to the original after a
  // failure. Both are a deliberate change of what is playing, and a rule that
  // held them back would break `MediaVideo`'s recovery rather than protect it.
  assert.equal(choosePlaybackUrl({ pinned: signedAt0, incoming: signed720p, engaged: true }), signed720p);
  assert.equal(choosePlaybackUrl({ pinned: signed720p, incoming: signedAt0, engaged: true }), signedAt0);
});

test("nothing is held when there is nothing to hold", () => {
  assert.equal(choosePlaybackUrl({ pinned: null, incoming: signedAt0, engaged: true }), signedAt0);
  assert.equal(choosePlaybackUrl({ pinned: signedAt0, incoming: null, engaged: true }), null);
});

test("two addresses are a re-signature only when they differ", () => {
  assert.equal(isResignatureOf(signedAt0, signedAt48), true);
  assert.equal(isResignatureOf(signedAt0, signedAt0), false);
  assert.equal(isResignatureOf(original, original), false);
  assert.equal(isResignatureOf(signedAt0, original), false);
  assert.equal(isResignatureOf(null, signedAt48), false);
});

test("a failure is retried with a fresh signature, and only then", () => {
  // The other half of the hold. An element that kept a signature through a
  // renewal is holding one that will die; when it does, the address on offer is
  // already the fresh one, because the renewal it refused has happened.
  assert.equal(shouldRetryWithFreshAddress(signedAt0, signedAt48), true);
  // A public URL that 400s is a deleted object or a policy, not an expiry, and
  // swapping to the same string would spin.
  assert.equal(shouldRetryWithFreshAddress(original, original), false);
  assert.equal(shouldRetryWithFreshAddress(original, video720p), false);
  // The second failure on the same fresh address falls through to the error the
  // component already shows, rather than looping.
  assert.equal(shouldRetryWithFreshAddress(signedAt48, signedAt48), false);
});
