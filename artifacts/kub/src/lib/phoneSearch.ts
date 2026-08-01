const PHONE_INPUT_RE = /^\+[0-9\s()-]+$/;
const E164_RE = /^\+[1-9][0-9]{7,14}$/;

export function normalizePhoneSearchQuery(value: string): string | null {
  const trimmed = value.trim();
  if (!PHONE_INPUT_RE.test(trimmed)) return null;

  const compact = trimmed.replace(/[\s()-]/g, "");
  return E164_RE.test(compact) ? compact : null;
}
