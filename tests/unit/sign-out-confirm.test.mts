// The question asked before a session ends.
//
// D-135: «Выйти» signed out on the tap, from both account menus. It is the one
// irreversible row on a list whose every other item opens a screen, it sits
// under «Помощь» where a thumb arrives by accident, and on a shared device the
// session it ends is somebody's.
//
// The wording is data rather than markup because there are two menus — the
// phone's avatar menu and the computer's side list — and a confirmation worded
// one way in one place and another way in the other reads as two different
// actions. What is pinned here is what the question has to say and how it
// identifies the account; that both menus really ask it is proved on the screen,
// in `tests/e2e/settings-exit-confirmations.spec.ts`.

import assert from "node:assert/strict";
import test from "node:test";

import { signOutAccountHandle, signOutConfirm } from "../../artifacts/kub/src/lib/signOutConfirm.ts";

test("it asks rather than announces, and offers a way back out", () => {
  const request = signOutConfirm({ username: "maks" });
  // Short on purpose: the dialog truncates its title to one line, and at 390
  // the register's proposed «Вы действительно хотите выйти?» was cut to «Вы
  // действительно хотите в...». A question has to survive the phone.
  assert.equal(request.title, "Выйти из аккаунта?");
  assert.ok(request.title.length <= 24, "a title this long is cut off on a phone");
  assert.equal(request.confirmLabel, "Выйти");
  assert.equal(request.cancelLabel, "Отмена");
  // Destructive, so the dialog draws the confirming button as such; and the
  // icon is the menu row's own, so the question looks like where it came from.
  assert.equal(request.tone, "danger");
  assert.equal(request.icon, "logout");
});

test("it tells the person what ends and what it takes to come back", () => {
  const { description } = signOutConfirm({ username: "maks" });
  assert.match(description, /завершится/);
  assert.match(description, /войти снова/);
});

test("nothing in it scolds or shouts", () => {
  // A confirmation is not the place to tell somebody off for reaching a row
  // the product put in front of them.
  for (const username of ["maks", null]) {
    const request = signOutConfirm({ username });
    const copy = [request.title, request.description, request.confirmLabel, request.cancelLabel].join(" ");
    assert.equal(copy.includes("!"), false, `«${copy}» carries an exclamation mark`);
    assert.equal(/[A-ZА-Я]{4,}/.test(copy), false, "nothing is shouted in capitals");
  }
});

test("the account is named when something names it", () => {
  assert.match(signOutConfirm({ username: "maks" }).description, /@maks/);
  // And the sentence still stands where nothing does: the menu the question was
  // raised from carries the person's name and picture either way, so a clause
  // about an account nobody can identify is worse than no clause.
  const anonymous = signOutConfirm({ username: null }).description;
  assert.equal(anonymous.includes("@"), false);
  assert.match(anonymous, /^Сеанс на этом устройстве завершится\./);
  assert.equal(signOutConfirm().description, anonymous, "an unknown account reads the same as an absent one");
});

test("the никнейм is cleaned before it is printed", () => {
  assert.equal(signOutAccountHandle("maks"), "@maks");
  assert.equal(signOutAccountHandle("  maks  "), "@maks");
  assert.equal(signOutAccountHandle("@maks"), "@maks", "one «@» and not two");
  assert.equal(signOutAccountHandle("@@maks"), "@maks");
  assert.equal(signOutAccountHandle(""), null);
  assert.equal(signOutAccountHandle("   "), null);
  assert.equal(signOutAccountHandle("@"), null, "an «@» alone identifies nobody");
  assert.equal(signOutAccountHandle(null), null);
  assert.equal(signOutAccountHandle(undefined), null);
});
