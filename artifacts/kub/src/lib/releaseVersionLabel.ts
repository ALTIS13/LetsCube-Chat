const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function getVisibleReleaseVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const version = value.trim();
  if (!version || version === "0.0.0" || !SEMANTIC_VERSION_PATTERN.test(version)) return null;

  return `Версия ${version}`;
}
