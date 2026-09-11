import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { coarsePointer } from "../../artifacts/kub/src/lib/pointer.ts";

/**
 * Two reports from testers on 2026-09-11, D-118 and D-119: a volume slider where
 * a phone's own keys already set how loud it plays, and a quality to choose on
 * every send. Telegram asks neither. A phone plays at the device's volume; a
 * photo from the gallery goes compressed without a question; «Файл» is the
 * function that sends the original, and it says so.
 *
 * The sending is pinned in a browser by
 * `tests/e2e/media-send-without-compression.spec.ts`. These pin what no fixture
 * there reaches: that the controls which asked are gone, and that nothing hidden
 * under a finger can still keep the sound turned down.
 */

const source = (path: string) => readFileSync(new URL(`../../artifacts/kub/src/${path}`, import.meta.url), "utf8");

function withWindow(value: unknown, run: () => void) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value });
  try {
    run();
  } finally {
    if (saved) Object.defineProperty(globalThis, "window", saved);
    else delete (globalThis as { window?: unknown }).window;
  }
}

const pointer = (coarse: boolean) => ({
  matchMedia: (query: string) => ({ matches: coarse && query === "(pointer: coarse)" }),
});

test("a finger is told from a mouse, and a page that cannot ask plays as a desktop", () => {
  withWindow(pointer(true), () => assert.equal(coarsePointer(), true));
  withWindow(pointer(false), () => assert.equal(coarsePointer(), false));
  withWindow({}, () => assert.equal(coarsePointer(), false, "no matchMedia"));
  withWindow(undefined, () => assert.equal(coarsePointer(), false, "no window"));
});

test("sending asks for no quality: no selector, no second gallery item, no remembered choice (D-119)", () => {
  const input = source("components/chat/MessageInput.tsx");
  for (const gone of [
    "MediaQualitySelector",
    "media-quality-selector",
    "onMediaQualityChange",
    "MEDIA_QUALITY_OPTIONS",
    'label: "Без сжатия"',
    "mediaSendShape",
  ]) {
    assert.equal(input.includes(gone), false, `MessageInput still carries ${gone}`);
  }
  // A quality chosen before is not read back either: nothing on screen could change it.
  const chat = source("components/chat/ChatWindow.tsx");
  for (const gone of ["MEDIA_QUALITY_STORAGE_KEY", "onMediaQualityChange", "setMediaQuality", "applyVideoQualityToAttachments"]) {
    assert.equal(chat.includes(gone), false, `ChatWindow still carries ${gone}`);
  }
});

test("«Файл» sends the original and says so under its name, and the gallery stays compressed (D-119)", () => {
  const input = source("components/chat/MessageInput.tsx");
  const file = /\{ icon: "file",[\s\S]*?\} \},/.exec(input)?.[0] ?? "";
  const gallery = /\{ icon: "image",[\s\S]*?\} \},/.exec(input)?.[0] ?? "";
  assert.match(file, /label: "Файл"/);
  assert.match(file, /hint: "Без сжатия"/);
  assert.match(file, /pickerCompressRef\.current = false;/);
  assert.match(file, /fileInputRef\.current\?\.click\(\);/);
  assert.match(gallery, /pickerCompressRef\.current = true;/, "the gallery goes compressed without a question");
  // The hint is the item's description, not part of its name.
  assert.match(input, /aria-label=\{hint \? label : undefined\}/);
  assert.match(input, /aria-describedby=\{hint \? `\$\{attachHintId\}-\$\{icon\}` : undefined\}/);
  assert.match(input, /id=\{`\$\{attachHintId\}-\$\{icon\}`\}/);
});

test("under a finger nothing draws a playback volume, and nothing hidden keeps it down (D-118)", () => {
  const playback = source("components/chat/ChatMediaPlayback.tsx");
  const slider = /<label\b(?:(?!<label\b)[\s\S])*?data-testid="chat-media-playback-volume"/.exec(playback)?.[0] ?? "";
  assert.match(slider, /pointer-coarse:hidden/, "the playback bar's volume slider is a desktop's");
  assert.match(playback, /const volume = coarsePointer\(\) \? 1 : playbackSettings\.volume;/);
  assert.match(playback, /title="Громкость"/);
  assert.match(playback, /aria-label="Громкость воспроизведения"/);
  assert.doesNotMatch(playback, /Р“|Рѕ|Рј/, "the control's names were Cyrillic decoded as Windows-1251");

  const voice = source("components/chat/AudioMessage.tsx");
  assert.match(voice, /const voicePlaybackVolume = coarsePointer\(\) \? 1 : settings\.voicePlaybackVolume;/);
  assert.doesNotMatch(
    voice,
    /clampAudioElementVolume\(settings\.voicePlaybackVolume\)/,
    "a voice message is given its volume only through the finger check",
  );

  const settings = source("components/sidebar/AudioSettingsSection.tsx");
  assert.match(settings, /const deviceSetsVolume = coarsePointer\(\);/);
  assert.match(settings, /\{!deviceSetsVolume && \(\s*<SliderRow\s+label="Голосовые сообщения"/);
  assert.match(settings, /\{selfMonitoring && !deviceSetsVolume && \(\s*<SliderRow\s+label="Громкость прослушивания"/);
});
