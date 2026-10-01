const PHONE_INPUT_RE = /^\+?[0-9\s()-]+$/;
const E164_RE = /^\+[1-9][0-9]{7,14}$/;

/**
 * A whole telephone number, as the search sends it: E.164, or null for
 * anything that is not a whole number. Written the ways a number is written —
 * international from «+», or a Russian one from 8 or 7 — and turned into the
 * form the database stores (`_normalize_phone_e164`), which normalises the
 * query again on its side. Part of a number is not a lookup (tracker item 74).
 */
export function normalizePhoneSearchQuery(value: string): string | null {
  const trimmed = value.trim();
  if (!PHONE_INPUT_RE.test(trimmed)) return null;

  const compact = trimmed.replace(/[\s()-]/g, "");
  const e164 = compact.startsWith("+")
    ? compact
    : /^[78][0-9]{10}$/.test(compact)
      ? `+7${compact.slice(1)}`
      : null;
  return e164 && E164_RE.test(e164) ? e164 : null;
}
