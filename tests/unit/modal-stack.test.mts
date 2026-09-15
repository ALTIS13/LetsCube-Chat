// Escape belongs to the modal on top, and to no other.
//
// Every open `KubModal` adds its own `keydown` listener to `window`, so one
// Escape was answered by all of them. Below `md` the settings are a `KubModal`
// rather than a column, so a confirmation raised inside them closed itself and
// the settings screen underneath, in a single press. Found on 2026-09-15 by an
// e2e test that pressed Escape over «Удалить фото профиля?» and then looked for
// the control it had come from — the dialog had gone and so had the screen. The
// same test passed at 1440, where the settings are a column and there is only
// one modal to answer.
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  isTopModalLayer,
  openModalLayerCount,
  popModalLayer,
  pushModalLayer,
  resetModalLayers,
} from "../../artifacts/kub/src/lib/modalStack.ts";

beforeEach(() => resetModalLayers());

test("the last one opened is the one on top", () => {
  const settings = pushModalLayer("settings");
  assert.equal(isTopModalLayer(settings), true);

  const confirm = pushModalLayer("confirm");
  assert.equal(isTopModalLayer(confirm), true);
  assert.equal(
    isTopModalLayer(settings),
    false,
    "the settings still answer Escape while a confirmation stands over them",
  );
});

test("closing the top hands Escape back to the one underneath", () => {
  const settings = pushModalLayer("settings");
  const confirm = pushModalLayer("confirm");
  popModalLayer(confirm);
  assert.equal(isTopModalLayer(settings), true);
  assert.equal(openModalLayerCount(), 1);
});

test("closing out of order removes the right one", () => {
  // React does not promise that effects tear down in the order they ran, and a
  // modal can be closed from underneath by its owner re-rendering.
  const a = pushModalLayer("a");
  const b = pushModalLayer("b");
  const c = pushModalLayer("c");
  popModalLayer(b);
  assert.equal(openModalLayerCount(), 2);
  assert.equal(isTopModalLayer(c), true);
  popModalLayer(c);
  assert.equal(isTopModalLayer(a), true);
});

test("a layer nobody registered is not the top one", () => {
  // Fail closed. Answering `true` for an unknown id would put the old
  // behaviour back for anything that forgets to register.
  assert.equal(isTopModalLayer("never-opened"), false);
  pushModalLayer("real");
  assert.equal(isTopModalLayer("never-opened"), false);
});

test("popping something twice does not take a stranger with it", () => {
  const a = pushModalLayer("dup");
  const b = pushModalLayer("dup");
  popModalLayer(b);
  assert.equal(openModalLayerCount(), 1);
  popModalLayer(a);
  assert.equal(openModalLayerCount(), 0);
  popModalLayer(a);
  assert.equal(openModalLayerCount(), 0, "an extra pop emptied something it did not own");
});

test("the modal registers itself and asks before it closes", () => {
  const source = readFileSync("artifacts/kub/src/components/kub/KubModal.tsx", "utf8");
  assert.match(source, /pushModalLayer\(/u, "KubModal no longer joins the stack");
  assert.match(source, /if \(!isTopModalLayer\(layer\)\) return;/u, "KubModal answers Escape from underneath again");
  assert.match(source, /popModalLayer\(layer\)/u, "KubModal never leaves the stack, so it blocks every later modal");

  // The D-181 guard has to survive alongside it: a dialog opened by a key press
  // is not closed by that same press, and being on top is no protection —
  // it is on top precisely then.
  assert.match(source, /if \(e\.timeStamp <= openedAt\) return;/u, "the D-181 guard is gone");
});
