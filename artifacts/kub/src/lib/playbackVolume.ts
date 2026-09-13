/**
 * One volume for everything a conversation plays, and one place that owns it
 * (D-149).
 *
 * There were two, and they wrote to the same `<audio>` element:
 *
 * - the sound settings' `voicePlaybackVolume`, under `kub:audio-settings:v1`,
 *   which a voice bubble applied to its own element on mount, on every change
 *   of the setting, and again on each press of play;
 * - the player's own `volume`, under `kub.mediaPlayback.v1`, which
 *   `ChatMediaPlaybackProvider` applies to whatever element it activates — and
 *   for a voice message that element is the bubble's.
 *
 * Neither knew about the other, so the volume a person heard was decided by
 * whichever wrote last. Pressing play on a bubble went bubble-then-player, so
 * the player's slider won; changing the setting afterwards, or anything that
 * re-mounted the bubble, handed it back to the setting. A volume lowered to
 * 20% in the settings played at 100% the moment it was started from the bubble,
 * and a slider dragged in the player jumped back on the next re-render. Both
 * controls were «working» and neither was in charge.
 *
 * They were never two different things. A voice message's sound and a video's
 * sound are the same sound, played through the same element by the same player,
 * so naming them apart would only have made the collision harder to see. The
 * player owns the volume now; the settings screen's second slider is gone, and
 * a value it had stored is adopted once, below, so nobody's lowered volume is
 * silently thrown away by this change.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

export const PLAYBACK_SETTINGS_KEY = "kub.mediaPlayback.v1";
/** The sound settings, whose `voicePlaybackVolume` used to be the second writer. */
export const AUDIO_SETTINGS_KEY = "kub:audio-settings:v1";

export const PLAYBACK_RATES = [0.5, 1, 1.5, 2];

export interface StoredPlayback {
  playbackRate: number;
  volume: number;
}

export const DEFAULT_PLAYBACK: StoredPlayback = { playbackRate: 1, volume: 1 };

export function normalizePlaybackRate(value: unknown): number {
  const rate = Number(value);
  return PLAYBACK_RATES.includes(rate) ? rate : DEFAULT_PLAYBACK.playbackRate;
}

/** `HTMLMediaElement.volume` takes 0..1 and throws on anything else. */
export function normalizeVolume(value: unknown): number {
  const volume = storedNumber(value);
  if (volume === null) return DEFAULT_PLAYBACK.volume;
  if (volume < 0) return 0;
  if (volume > 1) return 1;
  return volume;
}

/**
 * A stored number, or null where there is none.
 *
 * `Number()` alone will not do: it reads `null` and `""` as zero, and zero is a
 * volume — silence — so a key that was never written would arrive as somebody
 * having muted the player, and would then outrank the value being inherited
 * below.
 */
function storedNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * What the player starts with, from the two stored strings.
 *
 * The second argument is read once, and only to be inherited: a person who had
 * turned voice messages down in the sound settings keeps that volume when the
 * player takes ownership of it. Once the player has stored a volume of its own,
 * the settings value is never consulted again — which is the whole point of
 * D-149, and why this takes the raw strings rather than reading storage itself.
 */
export function readStoredPlayback(
  playbackRaw: string | null | undefined,
  soundSettingsRaw: string | null | undefined,
): StoredPlayback {
  const stored = parseObject(playbackRaw);
  const rate = normalizePlaybackRate(stored?.playbackRate);
  const own = storedNumber(stored?.volume);
  if (own !== null) return { playbackRate: rate, volume: normalizeVolume(own) };
  const inherited = storedNumber(parseObject(soundSettingsRaw)?.voicePlaybackVolume);
  if (inherited !== null) return { playbackRate: rate, volume: normalizeVolume(inherited) };
  return { playbackRate: rate, volume: DEFAULT_PLAYBACK.volume };
}

/**
 * What an element is actually set to.
 *
 * Under a finger nothing draws a volume control, so nothing stored may turn the
 * sound down there: the phone's own keys are the only volume, and a value
 * lowered on a desktop must not follow a person to a screen with nothing on it
 * to raise the sound again (D-118).
 */
export function elementVolume(stored: number, pointerIsCoarse: boolean): number {
  return pointerIsCoarse ? 1 : normalizeVolume(stored);
}

function parseObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Storage can hold anything, including half of something. Defaults apply.
    return null;
  }
}
