import assert from "node:assert/strict";
import test from "node:test";

import { createFeatures } from "../../artifacts/pocketflow/src/app/features.ts";
import { START_SCREEN_ACTIONS } from "../../artifacts/pocketflow/src/app/inbox.ts";
import { createRouter } from "../../artifacts/pocketflow/src/app/router.ts";

/**
 * The assembled bot, checked for the two ways a feature registry goes wrong.
 *
 * Features are written independently and meet only here, so the failures worth
 * catching are integration ones rather than logic ones:
 *
 *   - **two features claiming the same command or callback action.** The router
 *     throws on this, which is only useful if something constructs it before a
 *     person does;
 *   - **a button whose action nobody registered.** `/start` draws four, each
 *     owned by a different feature. A missing one is a button that answers
 *     «Эта кнопка больше не действует» — and nothing else would notice, because
 *     the router's fallback is deliberately polite.
 *
 * The second is the one that pays for this file. The first would show up on the
 * first message; the second only when somebody presses that particular button.
 */

test("the real feature list assembles into a router", () => {
  assert.doesNotThrow(() => createRouter(createFeatures()));
});

test("every action the start screen draws is owned by some feature", () => {
  const features = createFeatures();
  const actions = new Set(features.flatMap((feature) => Object.keys(feature.callbacks ?? {})));

  // These four are the buttons on `/start`, each registered by a different
  // feature than the one that draws them.
  for (const action of START_SCREEN_ACTIONS) {
    assert.ok(actions.has(action), `no feature registers the callback action ${action}`);
  }
});

test("every action the inbox offers for a message is owned by some feature", () => {
  const features = createFeatures();
  const actions = new Set(features.flatMap((feature) => Object.keys(feature.callbacks ?? {})));
  // The inbox hands these two across a feature boundary: it draws «Напомнить»
  // and «Следить», and reminders and watcher own them.
  for (const action of ["remind.from", "watch.from"]) {
    assert.ok(actions.has(action), `no feature registers the callback action ${action}`);
  }
});

test("the command menu is unique, lowercase and within the platform's grammar", () => {
  const router = createRouter(createFeatures());
  const commands = router.commandList();
  assert.ok(commands.length > 0);
  const seen = new Set<string>();
  for (const entry of commands) {
    assert.ok(!seen.has(entry.command), `duplicate command /${entry.command}`);
    seen.add(entry.command);
    // The platform's own schema: `^[a-z][a-z0-9_]{0,31}$`, and a description
    // of 1..256 characters. A command that fails this makes `setMyCommands`
    // reject the whole list, so every command would vanish from the menu.
    assert.match(entry.command, /^[a-z][a-z0-9_]{0,31}$/, `bad command name ${entry.command}`);
    assert.ok(
      entry.description.trim().length > 0 && entry.description.length <= 256,
      `bad description for /${entry.command}`,
    );
  }
  assert.ok(commands.length <= 100, "the platform accepts at most 100 commands");
});

test("every registered command handler is reachable, and every menu entry has one", () => {
  const features = createFeatures();
  const handlers = new Set(features.flatMap((feature) => Object.keys(feature.commands ?? {})));
  const menu = features.flatMap((feature) => feature.commandList ?? []);
  for (const entry of menu) {
    assert.ok(
      handlers.has(entry.command),
      `/${entry.command} is offered in the menu but nothing handles it`,
    );
  }
});

test("the inbox is asked last, so a feature mid-conversation claims its answer first", () => {
  const names = createFeatures().map((feature) => feature.name);
  assert.equal(names[names.length - 1], "inbox", "the inbox must be asked last");
  const inbox = names.indexOf("inbox");
  for (const earlier of ["reminders", "watcher", "webhooks", "settings", "group", "selftest"]) {
    const index = names.indexOf(earlier);
    assert.ok(index >= 0, `${earlier} is not registered`);
    assert.ok(index < inbox, `${earlier} must be asked before the inbox`);
  }
});
