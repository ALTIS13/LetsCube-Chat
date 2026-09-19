import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AUDIO_GAIN_HINT,
  AUDIO_MODE_SEGMENTS,
  AUDIO_PROCESSING_SWITCHES,
  audioDeviceOptions,
  audioLevelPercent,
  processingRefusalNote,
  selfMonitorHint,
  type AudioModeSegment,
  type AudioProcessingKey,
} from "../../artifacts/kub/src/lib/audioSettingsSurface.ts";

/**
 * The sound settings, as words and as a surface.
 *
 * The section used to be a small application of its own dropped into the middle
 * of the settings screen: three boxes filled from the page ground, a box inside
 * a box, two bare checkboxes where the product uses a switch, the current mode
 * printed twice and a text link where every other action is a row. Everything
 * it said lived inline, so no test could reach a single one of those strings.
 *
 * What is held here is of two kinds and they are kept apart on purpose:
 *
 *  - the **decisions**, in `lib/audioSettingsSurface.ts`, which imports nothing
 *    and is therefore reachable from `node --test` in full;
 *  - the **vocabulary** the component speaks, read off its source, because a
 *    class list is not reachable any other way from here. What those classes
 *    actually paint is measured in `tests/e2e/audio-settings-vocabulary.spec.ts`
 *    from the rendered page, which is the half a source scan cannot do.
 */

const SECTION = fileURLToPath(
  new URL("../../artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx", import.meta.url),
);
const MODULE = fileURLToPath(new URL("../../artifacts/kub/src/lib/audioSettingsSurface.ts", import.meta.url));
/** The screen this panel sits inside. Read only — it belongs to another track. */
const SCREEN = fileURLToPath(
  new URL("../../artifacts/kub/src/components/settings/SettingsScreen.tsx", import.meta.url),
);

const read = (file: string) => readFileSync(file, "utf8");

/**
 * Class lists live in quoted strings, and a sentence *about* a class in a
 * comment is a quoted string too — which is rule 9 of the material contract,
 * and the reason every scan below blanks comments first. Writing prose about a
 * token would otherwise be a way to fail or to pass a test.
 */
const blankComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const strings = (text: string) => [...text.matchAll(/(["'`])([^"'`\n]*?)\1/g)].map((m) => m[2]);

// ── the checkers, as pure functions so a mutation can be run through them ────

/** The page ground, painted anywhere but on the one well it belongs to. */
const PAGE_GROUND = "bg-[var(--kub-bg)]";
const TRACK = "p-0.5";

function pageGroundOffTheTrack(text: string): string[] {
  return strings(blankComments(text)).filter((s) => s.includes(PAGE_GROUND) && !s.includes(TRACK));
}

/** An on/off control that is not the product's switch. */
function bareCheckboxes(text: string): string[] {
  return [...blankComments(text).matchAll(/type=\{?"checkbox"\}?/g)].map((m) => m[0]);
}

/**
 * A viewport breakpoint deciding this section's layout.
 *
 * The settings screen is a ~350px column from `md` upwards, so a breakpoint
 * keyed on the window answers a question nobody asked: at 1440 the two device
 * selects sat side by side in 296px and both names came out as «Системный м…».
 * Measured widths are in the component's own comments.
 */
function viewportBreakpoints(text: string): string[] {
  return strings(blankComments(text)).flatMap((s) =>
    [...s.matchAll(/(?:^|\s)(sm|md|lg|xl|2xl):[^\s]+/g)].map((m) => m[0].trim()),
  );
}

/** Perimeters drawn in the sheet-edge colour, which rule 11 allows only on a target. */
const EDGE = "border-[color:var(--kub-border-color)]";
const SIDE = /^(?:[a-z-]+:)*border-[trblxy](?:-\d+)?$/;
const WIDTH = /^(?:[a-z-]+:)*border(?:-[0248])?$/;

function perimeters(text: string): string[] {
  return strings(blankComments(text)).filter((s) => {
    if (!s.includes(EDGE)) return false;
    const toks = s.trim().split(/\s+/);
    return toks.some((t) => WIDTH.test(t)) && !toks.some((t) => SIDE.test(t));
  });
}

/** What the picker offers, checked as a shape rather than as three equalities. */
function pickerComplaints(segments: readonly AudioModeSegment[]): string[] {
  const out: string[] = [];
  const modes = segments.map((s) => s.mode);
  if (modes.join(",") !== "clean,raw,custom") out.push(`modes are ${modes.join(",")}`);
  if (segments.some((s) => !s.label.trim())) out.push("a segment has no label");
  if (new Set(segments.map((s) => s.label)).size !== segments.length) out.push("two segments share a label");
  const unselectable = segments.filter((s) => !s.selectable).map((s) => s.mode);
  if (unselectable.join(",") !== "custom") {
    out.push(`what cannot be chosen is ${unselectable.join(",") || "nothing"}, and it has to be exactly custom`);
  }
  return out;
}

// ── the decisions ───────────────────────────────────────────────────────────

test("the picker offers the three modes in order, and only «Вручную» cannot be chosen", () => {
  assert.deepEqual(pickerComplaints(AUDIO_MODE_SEGMENTS), []);
});

test("the picker guarantee fails when the state becomes a choice", () => {
  // `custom` is what `inferProcessingMode` answers when the three switches do
  // not agree. Making it pressable hands the component a mode
  // `settingsForProcessingMode` has no branch for.
  const broken = AUDIO_MODE_SEGMENTS.map((s) =>
    s.mode === "custom" ? { ...s, selectable: true } : s,
  ) as unknown as readonly AudioModeSegment[];
  assert.equal(pickerComplaints(broken).length, 1);
});

test("the picker guarantee fails when a mode goes missing", () => {
  const broken = AUDIO_MODE_SEGMENTS.filter((s) => s.mode !== "raw");
  assert.ok(pickerComplaints(broken).length >= 1);
});

test("the system device is offered first, and never a second time under its own id", () => {
  // Chromium really does enumerate an `audioinput` whose deviceId is "default".
  const options = audioDeviceOptions("default", "Системный микрофон", [
    { deviceId: "default", label: "Default - Микрофон (Realtek)" },
    { deviceId: "abc123", label: "Микрофон (USB)" },
  ]);
  assert.deepEqual(
    options.map((o) => o.deviceId),
    ["default", "abc123"],
  );
  assert.equal(options[0].label, "Системный микрофон");
  assert.equal(options.filter((o) => o.deviceId === "default").length, 1);
});

test("the device options keep the order the browser gave, after the system entry", () => {
  const options = audioDeviceOptions("default", "Системный вывод", [
    { deviceId: "b", label: "Наушники" },
    { deviceId: "a", label: "Динамики" },
  ]);
  assert.deepEqual(
    options.map((o) => o.deviceId),
    ["default", "b", "a"],
  );
});

test("the meter's width is a percentage, whatever the analyser answered", () => {
  assert.equal(audioLevelPercent(0), 0);
  assert.equal(audioLevelPercent(1), 100);
  assert.equal(audioLevelPercent(0.5), 50);
  // Above one is what a peak over the analyser's midpoint gives, below zero is
  // what a sign error gives, and NaN is what an empty buffer or a closed
  // context gives — which reached the style as a width of NaN% and left the bar
  // wherever it last was.
  assert.equal(audioLevelPercent(4), 100);
  assert.equal(audioLevelPercent(-1), 0);
  assert.equal(audioLevelPercent(Number.NaN), 0);
  assert.equal(audioLevelPercent(Number.POSITIVE_INFINITY), 0);
});

test("a running test is not told the thing it is running is merely available", () => {
  const off = selfMonitorHint(false, false);
  const ready = selfMonitorHint(false, true);
  const on = selfMonitorHint(true, true);
  assert.equal(new Set([off, ready, on]).size, 3, "two of the three branches say the same thing");
  assert.match(off, /Доступно во время проверки/);
  assert.doesNotMatch(ready, /Доступно во время проверки/);
  for (const line of [off, ready, on]) assert.ok(line.trim().length > 0);
});

/* ── what the browser did with the three constraints ──────────────────────── */

const ALL_ON: Record<AudioProcessingKey, boolean> = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

test("the three processing switches are the browser's three constraints, named once", () => {
  assert.deepEqual(
    AUDIO_PROCESSING_SWITCHES.map((entry) => entry.key),
    ["noiseSuppression", "echoCancellation", "autoGainControl"],
  );
  assert.equal(new Set(AUDIO_PROCESSING_SWITCHES.map((entry) => entry.label)).size, 3);
  for (const entry of AUDIO_PROCESSING_SWITCHES) {
    assert.ok(entry.label.trim().length > 0);
    assert.ok(entry.hint.trim().length > 0);
  }
});

test("nothing on this screen claims processing the product does not perform", () => {
  // Krisp is a commercial product; LiveKit's integration of it is a paid
  // add-on. Neither is installed, and no word here may suggest otherwise — nor
  // may any word claim a noise engine of the product's own. What the three
  // switches reach is `getUserMedia` on the person's own browser, and that is
  // all there is.
  const words = [
    AUDIO_GAIN_HINT,
    ...AUDIO_PROCESSING_SWITCHES.flatMap((entry) => [entry.label, entry.hint]),
    processingRefusalNote(ALL_ON, { noiseSuppression: false, echoCancellation: false, autoGainControl: false }) ?? "",
  ].join(" ");
  assert.doesNotMatch(words, /krisp/i);
  assert.doesNotMatch(words, /нейросет|наш движок|собственн\w+ (движок|обработк)/i);
});

test("a constraint the browser refused is said, and one it granted is not", () => {
  // The defect class this note exists for: a switch drawn in the position the
  // person left it while the microphone does something else. A constraint is a
  // request, and `getSettings()` is the only place the answer lives.
  assert.equal(processingRefusalNote(ALL_ON, { noiseSuppression: true, echoCancellation: true, autoGainControl: true }), null);
  const one = processingRefusalNote(ALL_ON, { noiseSuppression: false, echoCancellation: true, autoGainControl: true });
  assert.ok(one, "a refused constraint produced no note at all");
  assert.match(one, /Убрать шум/);
  assert.doesNotMatch(one, /Убрать эхо/);
  assert.match(one, /выключено/);

  // The other direction: asked off, handed back on. A headset with its own
  // processing really does this.
  const forcedOn = processingRefusalNote(
    { noiseSuppression: false, echoCancellation: false, autoGainControl: false },
    { noiseSuppression: true, echoCancellation: false, autoGainControl: false },
  );
  assert.ok(forcedOn);
  assert.match(forcedOn, /включено/);
});

test("a browser that reports nothing is not accused of anything", () => {
  // WebKit's `getSettings()` omits all three. A note built out of `undefined`
  // would put a warning in front of every Safari user on the strength of a
  // missing field.
  assert.equal(processingRefusalNote(ALL_ON, {}), null);
  assert.equal(processingRefusalNote(ALL_ON, { noiseSuppression: undefined }), null);
  assert.equal(processingRefusalNote(ALL_ON, { noiseSuppression: "true" }), null);
  assert.equal(processingRefusalNote(ALL_ON, { noiseSuppression: 1 }), null);
});

// ── the vocabulary, read off the section's source ────────────────────────────

test("the page ground is painted on the picker's track and nowhere else", () => {
  const text = read(SECTION);
  assert.deepEqual(pageGroundOffTheTrack(text), []);
  // And it really is still on the track: an assertion that only forbids would
  // pass just as well on a section that had stopped drawing one.
  assert.equal(
    strings(blankComments(text)).filter((s) => s.includes(PAGE_GROUND) && s.includes(TRACK)).length,
    1,
  );
});

test("on and off are said with the product's switch", () => {
  const text = read(SECTION);
  assert.deepEqual(bareCheckboxes(text), []);
  assert.match(text, /<KubSwitch\b/, "the section says on and off with nothing at all");
});

test("no viewport breakpoint decides the layout of a fixed-width column", () => {
  assert.deepEqual(viewportBreakpoints(read(SECTION)), []);
});

/**
 * D-121, stated as the thing it actually asks for: this section is drawn in
 * **the screen's own idiom**, not in one of its own that happens to look
 * similar today.
 *
 * Every assertion above pins a class string that appears in this file. None of
 * them ties that string to `SettingsScreen.tsx`, where `SettingsGroup` draws
 * the four groups outside this panel — so the settings screen could move to a
 * different group shape and this section would silently become a dialect
 * again, which is the whole of the defect the owner reported. The two are
 * compared rather than described.
 *
 * `SettingsScreen.tsx` belongs to another track; it is read here and never
 * written.
 */
test("a group here is the same object the settings screen draws", () => {
  const group = (text: string) =>
    strings(blankComments(text)).filter((value) => /^overflow-hidden rounded-xl divide-y/.test(value));
  const mine = group(read(SECTION));
  const theirs = group(read(SCREEN));
  assert.equal(mine.length, 1, `the audio panel draws ${mine.length} group shapes: ${mine.join(" | ")}`);
  assert.equal(theirs.length, 1, `the settings screen draws ${theirs.length} group shapes: ${theirs.join(" | ")}`);
  assert.equal(
    mine[0],
    theirs[0],
    "the sound settings and the screen around them no longer draw a group the same way (D-121)",
  );
});

test("the idiom guarantee fails when either side drifts", () => {
  const group = (text: string) =>
    strings(blankComments(text)).filter((value) => /^overflow-hidden rounded-xl divide-y/.test(value));
  // Broken on this side: a rule of the edge's weight instead of `--kub-rule`.
  const mine = group(
    mutate(
      read(SECTION),
      '"overflow-hidden rounded-xl divide-y divide-[color:var(--kub-rule)] kub-raise"',
      '"overflow-hidden rounded-xl divide-y divide-[color:var(--kub-border-color)] kub-raise"',
    ),
  );
  assert.notEqual(mine[0], group(read(SCREEN))[0]);
  // And on the other: the screen moves and this section does not follow.
  const theirs = group(
    mutate(
      read(SCREEN),
      '"overflow-hidden rounded-xl divide-y divide-[color:var(--kub-rule)] kub-raise"',
      '"overflow-hidden rounded-2xl divide-y divide-[color:var(--kub-rule)] kub-raise"',
    ),
  );
  assert.notEqual(group(read(SECTION))[0], theirs[0]);
});

/**
 * Which two boxes keep a perimeter, named rather than counted.
 *
 * Six went with this rewrite — three group boxes, two label boxes and a
 * checkbox row — and `tests/unit/edge-vocabulary.test.mjs` took its global
 * ceiling down by exactly those six. The two that stay are both targets in the
 * sense of rule 11: a field, and a segmented track whose selection, hover and
 * unavailable states all speak in that line.
 */
test("the only perimeters left are the device field and the picker's track", () => {
  const kept = perimeters(read(SECTION));
  assert.equal(kept.length, 2, `perimeters: ${kept.join(" | ")}`);
  assert.equal(kept.filter((s) => s.includes("kub-field")).length, 1);
  assert.equal(kept.filter((s) => s.includes(TRACK)).length, 1);
});

/**
 * One sampler, which is the first thing D-261 asked to be established before
 * anything was designed.
 *
 * This panel used to build its own `AudioContext`, its own `AnalyserNode` and
 * its own `requestAnimationFrame` loop — a second answer to «how loud is this
 * microphone», at sixty readings a second against the twenty
 * `lib/micLevel.ts` takes for a call, and post-gain against that module's raw
 * track. A threshold placed against the one was being compared, in the call,
 * against the other.
 *
 * A source scan and honest about it: what it catches is somebody building a
 * second sampler again. That the surviving one *works* is measured in
 * `tests/e2e/audio-settings-meter.spec.ts`, which drives a known level into the
 * page and reads the bar back out.
 */
function secondSampler(text: string): string[] {
  const source = blankComments(text);
  return ["createAnalyser", "getByteTimeDomainData", "getByteFrequencyData", "requestAnimationFrame"].filter(
    (marker) => source.includes(marker),
  );
}

test("the meter reads the level through the module a call reads it with", () => {
  const text = read(SECTION);
  assert.deepEqual(secondSampler(text), [], "the sound settings have built a second level sampler");
  // And it really does read the shared one: an assertion that only forbids
  // would pass just as well on a panel that had stopped measuring at all.
  assert.match(blankComments(text), /openMicLevelSource\(/);
});

test("the one-sampler guarantee fails when an analyser comes back", () => {
  const broken = mutate(
    read(SECTION),
    "      const source = track ? openMicLevelSource(track, receiveLevel) : null;",
    "      const analyser = new AudioContextCtor().createAnalyser();\n      const source = track ? openMicLevelSource(track, receiveLevel) : null;",
  );
  assert.deepEqual(secondSampler(broken), ["createAnalyser"]);
});

// ── mutation: each source guarantee is proved by breaking it ─────────────────

/**
 * One substitution on a copy of the text, proved applied by the hash rather
 * than by looking for the anchor afterwards — an insertion leaves the anchor in
 * place and would report success either way. A non-unique anchor is refused
 * rather than guessed at.
 */
function mutate(text: string, anchor: string, replacement: string): string {
  const occurrences = text.split(anchor).length - 1;
  assert.equal(occurrences > 0, true, `anchor absent: ${anchor.slice(0, 70)}`);
  assert.equal(occurrences, 1, `anchor is not unique (${occurrences}x): ${anchor.slice(0, 70)}`);
  const before = createHash("sha256").update(text).digest("hex");
  const mutated = text.replace(anchor, replacement);
  assert.notEqual(createHash("sha256").update(mutated).digest("hex"), before);
  return mutated;
}

test("the ground guarantee fails when a group paints the page ground again", () => {
  const text = read(SECTION);
  assert.equal(pageGroundOffTheTrack(text).length, 0);
  const broken = mutate(
    text,
    '"overflow-hidden rounded-xl divide-y divide-[color:var(--kub-rule)] kub-raise"',
    '"overflow-hidden rounded-xl divide-y divide-[color:var(--kub-rule)] bg-[var(--kub-bg)]"',
  );
  assert.equal(pageGroundOffTheTrack(broken).length, 1);
});

test("the switch guarantee fails when a checkbox comes back", () => {
  const text = read(SECTION);
  assert.equal(bareCheckboxes(text).length, 0);
  const broken = mutate(text, '<input\n        type="range"', '<input\n        type="checkbox"');
  assert.equal(bareCheckboxes(broken).length, 1);
});

test("the breakpoint guarantee fails when the window decides the column again", () => {
  const text = read(SECTION);
  assert.equal(viewportBreakpoints(text).length, 0);
  // The device row, which is the one the breakpoint really was on. `mutate`
  // refuses a non-unique anchor and the row's own class string is shared with
  // the slider's, so the anchor takes the caption under it as well.
  const broken = mutate(
    text,
    '<label className="block min-w-0 px-3 py-2">\n      <span className="mb-1 block min-w-0 text-sm',
    '<label className="block min-w-0 px-3 py-2 sm:grid sm:grid-cols-2">\n      <span className="mb-1 block min-w-0 text-sm',
  );
  assert.equal(viewportBreakpoints(broken).length, 2);
});

test("the perimeter guarantee fails when a group is outlined again", () => {
  const text = read(SECTION);
  assert.equal(perimeters(text).length, 2);
  const broken = mutate(
    text,
    '"overflow-hidden rounded-xl divide-y divide-[color:var(--kub-rule)] kub-raise"',
    '"overflow-hidden rounded-xl border border-[color:var(--kub-border-color)] kub-raise"',
  );
  assert.equal(perimeters(broken).length, 3);
});

// ── mutation: the decisions are proved by breaking the module itself ─────────

/**
 * The four functions above cannot be broken by handing them a different input —
 * they *are* the thing under test — so the module is rebuilt with one
 * substitution and imported from disk. Same rule: the hash proves the
 * substitution landed, and a non-unique anchor is refused.
 */
async function withMutatedModule<T>(
  anchor: string,
  replacement: string,
  body: (mod: Record<string, unknown>) => Promise<T> | T,
): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "kub-audio-surface-"));
  try {
    const file = path.join(dir, "audioSettingsSurface.ts");
    writeFileSync(file, mutate(read(MODULE), anchor, replacement), "utf8");
    return await body((await import(pathToFileURL(file).href)) as Record<string, unknown>);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the meter guarantee fails when the clamp is taken off", async () => {
  await withMutatedModule(
    "  if (!Number.isFinite(level)) return 0;\n  return Math.round(Math.min(1, Math.max(0, level)) * 100);",
    "  return Math.round(level * 100);",
    (mod) => {
      const percent = mod.audioLevelPercent as (n: number) => number;
      assert.equal(percent(4), 400, "the substitution did not reach the export");
      assert.ok(Number.isNaN(percent(Number.NaN)));
    },
  );
});

test("the hint guarantee fails when a running test is called available again", async () => {
  await withMutatedModule(
    '  if (testing) return "Наденьте наушники, иначе микрофон услышит сам себя.";\n',
    "",
    (mod) => {
      const hint = mod.selfMonitorHint as (a: boolean, b: boolean) => string;
      assert.equal(hint(false, true), hint(false, false));
      assert.match(hint(false, true), /Доступно во время проверки/);
    },
  );
});

test("the refusal guarantee fails when the note stops comparing", async () => {
  // The mutation that matters is the one that makes the note trust the switch
  // instead of the track: with the comparison gone, a browser that granted
  // every constraint is still accused of refusing them, and — worse — the
  // caller can no longer tell «all well» from «could not tell».
  await withMutatedModule(
    "    return typeof value === \"boolean\" && value !== asked[entry.key];",
    "    return typeof value === \"boolean\";",
    (mod) => {
      const note = mod.processingRefusalNote as (
        a: Record<string, boolean>,
        b: Record<string, unknown>,
      ) => string | null;
      assert.notEqual(
        note(ALL_ON, { noiseSuppression: true, echoCancellation: true, autoGainControl: true }),
        null,
        "the substitution did not reach the export",
      );
    },
  );
});

test("the device-option guarantee fails when the system entry stops being unique", async () => {
  await withMutatedModule(
    "    ...devices.filter((device) => device.deviceId !== defaultId),",
    "    ...devices,",
    (mod) => {
      const options = mod.audioDeviceOptions as (
        a: string,
        b: string,
        c: readonly { deviceId: string; label: string }[],
      ) => readonly { deviceId: string }[];
      const answer = options("default", "Системный микрофон", [{ deviceId: "default", label: "Default" }]);
      assert.equal(answer.filter((o) => o.deviceId === "default").length, 2);
    },
  );
});
