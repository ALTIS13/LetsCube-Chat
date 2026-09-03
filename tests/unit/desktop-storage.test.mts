import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_STORAGE_ERROR_CODES,
  DESKTOP_STORAGE_GENERIC_ERROR,
  createDesktopStorageStore,
  describeDesktopStorageError,
  formatStorageBytes,
  getCacheLimitOptions,
  isAbsoluteWindowsPath,
  parseDesktopStorageState,
  readDesktopStorageState,
  setDesktopStorageLocation,
  toDesktopStorageErrorCode,
  type DesktopStorageState,
} from "../../artifacts/kub/src/lib/platform/desktopStorage.ts";

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

/** The shell serialises the Rust struct as-is, so the wire is snake_case. */
const BASE_PAYLOAD = {
  location: "C:\\Users\\person\\AppData\\Local\\LETSCUBE\\webview-production-v1",
  is_default_location: true,
  total_bytes: 3 * GIBIBYTE,
  cache_bytes: 1 * GIBIBYTE,
  cache_limit_bytes: 2 * GIBIBYTE,
  min_cache_limit_bytes: 128 * MEBIBYTE,
  max_cache_limit_bytes: 20 * GIBIBYTE,
  pending_location: null,
};

function fixture(overrides: Record<string, unknown> = {}): DesktopStorageState {
  const state = parseDesktopStorageState({ ...BASE_PAYLOAD, ...overrides });
  assert.ok(state);
  return state;
}

/**
 * `ru-RU` groups thousands with a non-breaking space, which is correct and
 * matches the rest of the settings panel — but asserting on a literal would make
 * these tests depend on an invisible character in this file.
 */
function visibleSpaces(value: string): string {
  return value.replace(/\s/g, " ");
}

test("byte sizes read in Russian units and never show a broken number", () => {
  assert.equal(formatStorageBytes(0), "0 Б");
  assert.equal(visibleSpaces(formatStorageBytes(1023)), "1 023 Б");
  assert.equal(formatStorageBytes(1024), "1 КБ");
  assert.equal(formatStorageBytes(128 * MEBIBYTE), "128 МБ");
  assert.equal(formatStorageBytes(20 * GIBIBYTE), "20 ГБ");

  // A settings row must not be able to print `NaN Б` or a negative size, so
  // everything that is not a real non-negative number collapses to zero.
  for (const broken of [-1, Number.NaN, Number.POSITIVE_INFINITY, "2048", null, undefined]) {
    assert.equal(formatStorageBytes(broken), "0 Б");
  }
});

test("a size just under a unit carries instead of rendering 1024 of the smaller one", () => {
  // 1 048 575 B is 1023.999… KB. Rounded to one decimal that is 1024,0 КБ — a
  // unit that should have carried, and the reason rounding happens before the
  // unit is finally chosen.
  assert.equal(formatStorageBytes(MEBIBYTE - 1), "1 МБ");
  assert.equal(formatStorageBytes(GIBIBYTE - 1), "1 ГБ");
  // One decimal is kept where it actually distinguishes two sizes.
  assert.equal(formatStorageBytes(1536), "1,5 КБ");
});

test("the parser maps the snake_case bridge payload onto the camelCase state", () => {
  const state = fixture({
    is_default_location: false,
    pending_location: "D:\\LETSCUBE\\webview-production-v1",
  });

  assert.deepEqual(state, {
    location: BASE_PAYLOAD.location,
    isDefaultLocation: false,
    totalBytes: 3 * GIBIBYTE,
    cacheBytes: 1 * GIBIBYTE,
    cacheLimitBytes: 2 * GIBIBYTE,
    minCacheLimitBytes: 128 * MEBIBYTE,
    maxCacheLimitBytes: 20 * GIBIBYTE,
    pendingLocation: "D:\\LETSCUBE\\webview-production-v1",
  });
});

test("the parser rejects malformed bridge payloads rather than rendering them", () => {
  const invalid: unknown[] = [
    null,
    "storage",
    [BASE_PAYLOAD],
    { ...BASE_PAYLOAD, location: "" },
    { ...BASE_PAYLOAD, location: 42 },
    { ...BASE_PAYLOAD, location: "C".repeat(4_097) },
    { ...BASE_PAYLOAD, is_default_location: "yes" },
    { ...BASE_PAYLOAD, total_bytes: -1 },
    { ...BASE_PAYLOAD, total_bytes: 1.5 },
    { ...BASE_PAYLOAD, cache_bytes: Number.POSITIVE_INFINITY },
    { ...BASE_PAYLOAD, pending_location: "" },
    { ...BASE_PAYLOAD, pending_location: 7 },
    // camelCase is not the contract: reading it would silently produce a state
    // whose every field is undefined.
    { ...BASE_PAYLOAD, cacheLimitBytes: 2 * GIBIBYTE, cache_limit_bytes: undefined },
  ];

  for (const value of invalid) {
    assert.equal(parseDesktopStorageState(value), null);
  }
});

test("the parser enforces the invariants the settings screen depends on", () => {
  // Cache is part of the profile, so it can never be larger than the whole.
  assert.equal(
    parseDesktopStorageState({ ...BASE_PAYLOAD, cache_bytes: 4 * GIBIBYTE }),
    null,
  );
  // An inverted range would leave the limit selector with nothing to render.
  assert.equal(
    parseDesktopStorageState({
      ...BASE_PAYLOAD,
      min_cache_limit_bytes: 20 * GIBIBYTE,
      max_cache_limit_bytes: 128 * MEBIBYTE,
    }),
    null,
  );
  // A stored limit outside the range would leave no option checked.
  assert.equal(parseDesktopStorageState({ ...BASE_PAYLOAD, cache_limit_bytes: 64 * MEBIBYTE }), null);
  assert.equal(parseDesktopStorageState({ ...BASE_PAYLOAD, cache_limit_bytes: 40 * GIBIBYTE }), null);
});

test("every rejection code has its own Russian sentence and none leaks the code", () => {
  const seen = new Set<string>();
  for (const code of DESKTOP_STORAGE_ERROR_CODES) {
    const message = describeDesktopStorageError(code);
    assert.ok(message.length > 0);
    // The person is told what to do, not what the shell called it.
    assert.doesNotMatch(message, /[a-z]+_[a-z]/);
    assert.match(message, /[А-Яа-я]/);
    assert.equal(seen.has(message), false, `duplicate message for ${code}`);
    seen.add(message);
  }
});

test("an unrecognised rejection becomes the generic message, not the raw reason", () => {
  const generic = describeDesktopStorageError(DESKTOP_STORAGE_GENERIC_ERROR);

  for (const reason of [null, undefined, 7, { code: "not_writable" }, "C:\\secret\\token"]) {
    assert.equal(describeDesktopStorageError(reason), generic);
  }
  assert.doesNotMatch(generic, /secret|token/);
});

test("a native rejection is reduced to a known code before anything else sees it", () => {
  // Tauri rejects with the bare `Err(String)`, but a thrown Error or an object
  // is just as possible, and any of them could carry a path.
  assert.equal(toDesktopStorageErrorCode("not_writable"), "not_writable");
  assert.equal(toDesktopStorageErrorCode(new Error("system_directory")), "system_directory");
  assert.equal(
    toDesktopStorageErrorCode("failed to open C:\\Users\\person\\must-not-escape"),
    DESKTOP_STORAGE_GENERIC_ERROR,
  );
  assert.equal(
    toDesktopStorageErrorCode({ message: "must-not-escape" }),
    DESKTOP_STORAGE_GENERIC_ERROR,
  );
});

test("the limit ladder stays inside the bounds the shell reports", () => {
  const options = getCacheLimitOptions(fixture());

  assert.deepEqual(options, [
    128 * MEBIBYTE,
    512 * MEBIBYTE,
    1 * GIBIBYTE,
    2 * GIBIBYTE,
    5 * GIBIBYTE,
    10 * GIBIBYTE,
    20 * GIBIBYTE,
  ]);
  // Sorted, unique, and never outside what the shell would accept.
  assert.deepEqual([...options].sort((a, b) => a - b), options);
  assert.equal(new Set(options).size, options.length);
});

test("a narrower shell range shortens the ladder and keeps its own ends", () => {
  const options = getCacheLimitOptions(fixture({
    min_cache_limit_bytes: 700 * MEBIBYTE,
    max_cache_limit_bytes: 3 * GIBIBYTE,
    cache_limit_bytes: 2 * GIBIBYTE,
  }));

  assert.deepEqual(options, [700 * MEBIBYTE, 1 * GIBIBYTE, 2 * GIBIBYTE, 3 * GIBIBYTE]);
});

test("a limit written by another build is still offered, so one option stays checked", () => {
  // The radio group checks by equality. A stored 3 GiB that the ladder does not
  // contain would otherwise render a group with nothing selected.
  const options = getCacheLimitOptions(fixture({ cache_limit_bytes: 3 * GIBIBYTE }));

  assert.ok(options.includes(3 * GIBIBYTE));
  assert.deepEqual([...options].sort((a, b) => a - b), options);
});

test("an absolute Windows path is told apart from a relative one before the round trip", () => {
  for (const absolute of [
    "D:\\LETSCUBE",
    "d:/letscube",
    "C:\\Users\\person\\Documents\\LETSCUBE",
    "\\\\nas\\share",
    "  D:\\LETSCUBE  ",
  ]) {
    assert.equal(isAbsoluteWindowsPath(absolute), true, absolute);
  }

  for (const relative of ["", "   ", "Загрузки", ".\\data", "..\\data", "D:", "\\onlyroot", "/etc"]) {
    assert.equal(isAbsoluteWindowsPath(relative), false, JSON.stringify(relative));
  }
});

test("a relative path is refused locally with the code the shell would have sent", async () => {
  await assert.rejects(setDesktopStorageLocation("Загрузки"), (error: unknown) => {
    assert.equal((error as Error).message, "not_absolute");
    return true;
  });
});

test("the storage adapter is inert without the desktop bridge", async () => {
  const previousWindow = globalThis.window;
  try {
    globalThis.window = {} as typeof window;
    assert.equal(await readDesktopStorageState(), null);
    assert.equal(await setDesktopStorageLocation(null), null);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("a failed command keeps the last good sizes and adds a readable message", async () => {
  const good = fixture();
  const store = createDesktopStorageStore({
    isActive: () => true,
    read: async () => good,
    setLocation: async () => {
      throw new Error("not_writable");
    },
    setCacheLimit: async () => good,
    clearCache: async () => good,
  });

  await store.refresh();
  assert.equal(store.getSnapshot().state, good);

  await store.setLocation("D:\\LETSCUBE");
  assert.equal(store.getSnapshot().state, good, "the sizes on screen are still true");
  assert.equal(store.getSnapshot().errorMessage, describeDesktopStorageError("not_writable"));
  assert.equal(store.getSnapshot().commandPending, false);

  store.dismissError();
  assert.equal(store.getSnapshot().errorMessage, null);
});

test("one external store snapshot notifies every subscriber", async () => {
  const next = fixture({ pending_location: "D:\\LETSCUBE\\webview-production-v1" });
  const store = createDesktopStorageStore({
    isActive: () => true,
    read: async () => next,
    setLocation: async () => next,
    setCacheLimit: async () => next,
    clearCache: async () => next,
  });
  const observed: unknown[] = [];
  const unsubscribeA = store.subscribe(() => observed.push(store.getSnapshot()));
  const unsubscribeB = store.subscribe(() => observed.push(store.getSnapshot()));

  await store.refresh();

  assert.equal(observed.length, 2);
  assert.equal(observed[0], observed[1]);
  assert.equal(store.getSnapshot().state?.pendingLocation, "D:\\LETSCUBE\\webview-production-v1");
  unsubscribeA();
  unsubscribeB();
});
