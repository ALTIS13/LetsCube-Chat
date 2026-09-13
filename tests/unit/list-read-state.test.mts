// What a list shows when its read fails (D-140).
//
// The sanctions tab rendered «Активных банов нет» for a refused query, because
// it read `data ?? []` and never `error`. A moderator reading that concludes
// nobody is restricted. These are the four answers that make the difference
// between "there is nothing" and "I could not find out" visible.
import assert from "node:assert/strict";
import test from "node:test";

import {
  listReadView,
  readReplacesScreen,
} from "../../artifacts/kub/src/lib/listReadState.ts";

test("a refused first read is unavailable, never empty", () => {
  assert.equal(
    listReadView({ loading: false, error: "Недостаточно прав.", loadedOnce: false }),
    "unavailable",
  );
});

test("a refused later read keeps the rows and calls them stale", () => {
  // The rows are older than the database, but they are true. Replacing them
  // with an empty state would replace something true with something false.
  assert.equal(
    listReadView({ loading: false, error: "Сеть недоступна.", loadedOnce: true }),
    "stale",
  );
});

test("a successful read is ready whether or not it is the first", () => {
  assert.equal(listReadView({ loading: false, error: null, loadedOnce: false }), "ready");
  assert.equal(listReadView({ loading: false, error: null, loadedOnce: true }), "ready");
});

test("loading wins over everything, including a previous failure", () => {
  // A retry is in flight: showing the old error beside a spinner would say the
  // read has failed when it is happening.
  for (const loadedOnce of [false, true]) {
    for (const error of [null, "Сеть недоступна."]) {
      assert.equal(
        listReadView({ loading: true, error, loadedOnce }),
        "loading",
        `loading lost to error=${JSON.stringify(error)} loadedOnce=${loadedOnce}`,
      );
    }
  }
});

test("only a first read or a deliberate retry may blank the screen", () => {
  // The realtime subscription fires while somebody is reading the list; the old
  // code answered every one of those by replacing the tab with a spinner.
  assert.equal(readReplacesScreen({ background: true, loadedOnce: true }), false);
  // Nothing on screen yet, so there is nothing to protect.
  assert.equal(readReplacesScreen({ background: true, loadedOnce: false }), true);
  // A person pressed «Повторить» and should see that something is happening.
  assert.equal(readReplacesScreen({ background: false, loadedOnce: true }), true);
  assert.equal(readReplacesScreen({ background: false, loadedOnce: false }), true);
});
