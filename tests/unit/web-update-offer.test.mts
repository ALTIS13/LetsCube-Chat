import assert from "node:assert/strict";
import test from "node:test";

import {
  currentWebUpdateOffer,
  offerWebUpdate,
  subscribeWebUpdateOffer,
  withdrawWebUpdate,
} from "../../artifacts/kub/src/lib/pwa/webUpdateOffer.ts";

// Tracker item 42. On the Windows app a new web build is offered in the
// caption; AppUpdateBanner still decides when, and hands the offer over here.

test("an offer is held until withdrawn, and each change is announced once", () => {
  withdrawWebUpdate();
  let heard = 0;
  const stop = subscribeWebUpdateOffer(() => {
    heard += 1;
  });
  assert.equal(currentWebUpdateOffer(), null);

  offerWebUpdate(null);
  assert.deepEqual(currentWebUpdateOffer(), { registration: null });
  assert.equal(heard, 1);

  offerWebUpdate(null);
  assert.equal(heard, 1, "the same offer made twice is not news");

  withdrawWebUpdate();
  assert.equal(currentWebUpdateOffer(), null);
  assert.equal(heard, 2);

  withdrawWebUpdate();
  assert.equal(heard, 2, "withdrawing nothing is not news either");

  stop();
  offerWebUpdate(null);
  assert.equal(heard, 2, "an unsubscribed listener hears nothing");
  withdrawWebUpdate();
});
