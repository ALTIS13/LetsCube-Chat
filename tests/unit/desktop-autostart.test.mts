import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_AUTOSTART_ERROR_CODES,
  DESKTOP_AUTOSTART_GENERIC_ERROR,
  describeAutostartDisagreement,
  describeAutostartState,
  describeDesktopAutostartError,
  isDesktopAutostartErrorCode,
  isDesktopAutostartAvailable,
  readDesktopAutostartState,
  setDesktopAutostart,
  isStartMinimizedSwitchEnabled,
  isStartMinimizedSwitchOn,
  normalizeAutostartRequest,
  parseDesktopAutostartState,
  toDesktopAutostartErrorCode,
  type DesktopAutostartState,
} from "../../artifacts/kub/src/lib/platform/desktopAutostart.ts";

/** The shell serialises the Rust struct as-is, so the wire is snake_case. */
const BASE_PAYLOAD = {
  enabled: true,
  start_minimized: false,
  entry_present: true,
  entry_matches_install: true,
  blocked_by_windows: false,
};

function fixture(overrides: Record<string, unknown> = {}): DesktopAutostartState {
  const state = parseDesktopAutostartState({ ...BASE_PAYLOAD, ...overrides });
  assert.ok(state);
  return state;
}

test("a shell payload becomes the five booleans and nothing else", () => {
  const state = fixture({ start_minimized: true });
  assert.deepEqual(state, {
    enabled: true,
    startMinimized: true,
    entryPresent: true,
    entryMatchesInstall: true,
    blockedByWindows: false,
  });
});

test("a payload missing any field is refused rather than half-read", () => {
  for (const field of Object.keys(BASE_PAYLOAD)) {
    const partial: Record<string, unknown> = { ...BASE_PAYLOAD };
    delete partial[field];
    assert.equal(
      parseDesktopAutostartState(partial),
      null,
      `dropping ${field} must not produce a state`,
    );
  }
});

test("a field of the wrong type is refused, truthiness included", () => {
  // The dangerous shape: a shell that answered with strings would otherwise
  // draw both switches on, because "false" is truthy.
  assert.equal(parseDesktopAutostartState({ ...BASE_PAYLOAD, enabled: "false" }), null);
  assert.equal(parseDesktopAutostartState({ ...BASE_PAYLOAD, start_minimized: 1 }), null);
  assert.equal(parseDesktopAutostartState({ ...BASE_PAYLOAD, blocked_by_windows: null }), null);
});

test("anything that is not an object is not a state", () => {
  for (const payload of [null, undefined, 0, "", "ok", [], [BASE_PAYLOAD], true]) {
    assert.equal(parseDesktopAutostartState(payload), null);
  }
});

test("only the shell's own vocabulary survives a rejection", () => {
  for (const code of DESKTOP_AUTOSTART_ERROR_CODES) {
    assert.equal(toDesktopAutostartErrorCode(code), code);
    assert.equal(toDesktopAutostartErrorCode(new Error(code)), code);
    assert.ok(isDesktopAutostartErrorCode(code));
  }
});

test("an unrecognised rejection cannot carry its own text to the screen", () => {
  // The shapes that matter: a Windows path, a Rust panic, an object.
  for (const reason of [
    "C:\\Users\\Ivan\\AppData\\Local\\LETSCUBE",
    new Error("called `Option::unwrap()` on a `None` value"),
    { code: "autostart_unavailable" },
    undefined,
    42,
  ]) {
    const code = toDesktopAutostartErrorCode(reason);
    assert.equal(code, DESKTOP_AUTOSTART_GENERIC_ERROR);
    const message = describeDesktopAutostartError(code);
    assert.ok(message.length > 0);
    assert.ok(!message.includes("C:\\"));
    assert.ok(!message.includes("Option"));
  }
});

test("every known code has a message of its own", () => {
  const messages = DESKTOP_AUTOSTART_ERROR_CODES.map((code) =>
    describeDesktopAutostartError(code),
  );
  assert.equal(new Set(messages).size, messages.length);
  for (const message of messages) assert.ok(message.trim().length > 0);
});

test("the tray flag cannot be written without a sign-in launch to describe", () => {
  assert.deepEqual(
    normalizeAutostartRequest({ enabled: false, startMinimized: true }),
    { enabled: false, startMinimized: false },
  );
  assert.deepEqual(
    normalizeAutostartRequest({ enabled: true, startMinimized: true }),
    { enabled: true, startMinimized: true },
  );
  assert.deepEqual(
    normalizeAutostartRequest({ enabled: true, startMinimized: false }),
    { enabled: true, startMinimized: false },
  );
});

test("the second switch is unavailable while autostart is off or a write is in flight", () => {
  assert.equal(isStartMinimizedSwitchEnabled(fixture(), false), true);
  assert.equal(isStartMinimizedSwitchEnabled(fixture(), true), false);
  assert.equal(
    isStartMinimizedSwitchEnabled(fixture({ enabled: false, entry_present: false }), false),
    false,
  );
  // Nothing measured yet is not the same as "off", but it is equally untouchable.
  assert.equal(isStartMinimizedSwitchEnabled(null, false), false);
});

test("an unanswered shell says so instead of reading as off", () => {
  const unknown = describeAutostartState(null);
  const off = describeAutostartState(
    fixture({ enabled: false, entry_present: false, entry_matches_install: false }),
  );
  assert.notEqual(unknown, off);
  assert.match(unknown, /Читаем/);
  assert.equal(describeAutostartDisagreement(null), null);
});

test("each state the registry can be in gets its own line", () => {
  const lines = [
    describeAutostartState(fixture({ enabled: false, entry_present: false })),
    describeAutostartState(fixture()),
    describeAutostartState(fixture({ start_minimized: true })),
    describeAutostartState(
      fixture({ enabled: false, blocked_by_windows: true, start_minimized: true }),
    ),
    describeAutostartState(fixture({ entry_matches_install: false })),
  ];
  assert.equal(new Set(lines).size, lines.length);
});

test("a switch-off made in the Windows task manager is explained, not hidden", () => {
  const blocked = fixture({ enabled: false, blocked_by_windows: true });
  assert.match(describeAutostartState(blocked), /Автозагрузк/);
  const note = describeAutostartDisagreement(blocked);
  assert.ok(note);
  assert.match(note, /диспетчер/i);
});

test("an entry pointing at another copy is explained rather than shown as healthy", () => {
  const moved = fixture({ entry_matches_install: false });
  const note = describeAutostartDisagreement(moved);
  assert.ok(note);
  assert.match(note, /друго/);
});

test("an agreeing state has nothing to explain", () => {
  assert.equal(describeAutostartDisagreement(fixture()), null);
  assert.equal(describeAutostartDisagreement(fixture({ start_minimized: true })), null);
  assert.equal(
    describeAutostartDisagreement(fixture({ enabled: false, entry_present: false })),
    null,
  );
});

test("every user-facing string is Russian", () => {
  const strings = [
    describeAutostartState(null),
    describeAutostartState(fixture()),
    describeAutostartState(fixture({ start_minimized: true })),
    describeAutostartState(fixture({ enabled: false, entry_present: false })),
    describeAutostartState(fixture({ enabled: false, blocked_by_windows: true })),
    describeAutostartState(fixture({ entry_matches_install: false })),
    describeAutostartDisagreement(fixture({ enabled: false, blocked_by_windows: true })),
    describeAutostartDisagreement(fixture({ entry_matches_install: false })),
    ...DESKTOP_AUTOSTART_ERROR_CODES.map((code) => describeDesktopAutostartError(code)),
    describeDesktopAutostartError(DESKTOP_AUTOSTART_GENERIC_ERROR),
  ];
  for (const value of strings) {
    assert.ok(value);
    assert.match(value, /[а-яё]/i, `not Russian: ${value}`);
  }
});

test("the tray switch is drawn off while there is no launch for it to describe", () => {
  // The registry keeps the word on an entry Windows has switched off, and
  // reading it straight onto the switch drew «on» above a line saying the
  // setting was unavailable — a contradiction the 1440 light capture showed.
  const blocked = fixture({
    enabled: false,
    start_minimized: true,
    blocked_by_windows: true,
  });
  assert.equal(blocked.startMinimized, true, "the registry still says so");
  assert.equal(isStartMinimizedSwitchOn(blocked), false, "the switch must not");

  assert.equal(isStartMinimizedSwitchOn(fixture({ start_minimized: true })), true);
  assert.equal(isStartMinimizedSwitchOn(fixture()), false);
  assert.equal(isStartMinimizedSwitchOn(null), false);
});

test("what the tray switch shows is what a write of that state would store", () => {
  // The two rules are one rule: the switch may only draw what
  // `normalizeAutostartRequest` would actually write.
  for (const enabled of [true, false]) {
    for (const startMinimized of [true, false]) {
      const state = fixture({
        enabled,
        start_minimized: startMinimized,
        entry_present: enabled,
        entry_matches_install: enabled,
      });
      assert.equal(
        isStartMinimizedSwitchOn(state),
        normalizeAutostartRequest({ enabled, startMinimized }).startMinimized,
      );
    }
  }
});

/**
 * What a shell that cannot do this answers.
 *
 * Three different absences, and none of them may become "off": a browser with
 * no bridge at all, a shell of some other platform, and — the one that actually
 * reaches users — a Windows shell installed before these two methods existed,
 * running a page deployed after. The web application updates on deploy and the
 * desktop shell updates when somebody installs a new one, so that window is
 * days wide every time.
 */
test("a shell that cannot start at sign-in says unavailable, never off", async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
  const setWindow = (value: unknown) => {
    Object.defineProperty(globalThis, "window", {
      value,
      configurable: true,
      writable: true,
    });
  };

  try {
    // A browser: no bridge at all.
    setWindow(undefined);
    assert.equal(isDesktopAutostartAvailable(), false);
    assert.equal(await readDesktopAutostartState(), null);
    assert.equal(await setDesktopAutostart({ enabled: true, startMinimized: true }), null);

    // A shell of some other platform must not be mistaken for the Windows one.
    setWindow({
      letscubeDesktop: {
        platform: "linux",
        getAutostart: async () => ({}),
        setAutostart: async () => ({}),
      },
    });
    assert.equal(isDesktopAutostartAvailable(), false);
    assert.equal(await readDesktopAutostartState(), null);

    // A Windows shell too old to carry these methods: every other method it has
    // is irrelevant, and a half-present bridge is still absent.
    setWindow({ letscubeDesktop: { platform: "windows", getStorageState: async () => ({}) } });
    assert.equal(isDesktopAutostartAvailable(), false);
    assert.equal(await readDesktopAutostartState(), null);

    setWindow({ letscubeDesktop: { platform: "windows", getAutostart: async () => ({}) } });
    assert.equal(isDesktopAutostartAvailable(), false, "one of the two methods is not the pair");

    // And a complete one is available.
    setWindow({
      letscubeDesktop: {
        platform: "windows",
        getAutostart: async () => BASE_PAYLOAD,
        setAutostart: async () => BASE_PAYLOAD,
      },
    });
    assert.equal(isDesktopAutostartAvailable(), true);
    assert.deepEqual(await readDesktopAutostartState(), fixture());
  } finally {
    if (saved) Object.defineProperty(globalThis, "window", saved);
    else delete (globalThis as Record<string, unknown>).window;
  }
});

/**
 * What a refused write says: the shell's own code, translated, and never the
 * switch moving to where it was pushed.
 */
test("a refused write rejects with a code the panel can translate", async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
  const bridge = (reject: unknown) => ({
    letscubeDesktop: {
      platform: "windows",
      getAutostart: async () => BASE_PAYLOAD,
      setAutostart: async () => {
        throw reject;
      },
    },
  });

  try {
    for (const [thrown, expected] of [
      ["autostart_write_failed", "autostart_write_failed"],
      ["unauthorized", "unauthorized"],
      ["autostart_path_unsupported", "autostart_path_unsupported"],
      ["something nobody wrote down", DESKTOP_AUTOSTART_GENERIC_ERROR],
    ] as const) {
      Object.defineProperty(globalThis, "window", {
        value: bridge(thrown),
        configurable: true,
        writable: true,
      });
      await assert.rejects(
        () => setDesktopAutostart({ enabled: true, startMinimized: false }),
        (error: Error) => error.message === expected,
      );
    }

    // A shell that answers with a payload this module cannot parse is a failure
    // too: better a message than two switches drawn over a guess.
    Object.defineProperty(globalThis, "window", {
      value: {
        letscubeDesktop: {
          platform: "windows",
          getAutostart: async () => ({ enabled: true }),
          setAutostart: async () => ({ enabled: true }),
        },
      },
      configurable: true,
      writable: true,
    });
    await assert.rejects(
      () => readDesktopAutostartState(),
      (error: Error) => error.message === DESKTOP_AUTOSTART_GENERIC_ERROR,
    );
  } finally {
    if (saved) Object.defineProperty(globalThis, "window", saved);
    else delete (globalThis as Record<string, unknown>).window;
  }
});
