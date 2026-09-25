const AUTO_ORIGINAL_LIMIT_BYTES = 1_048_576;

/** Previews are cheap; a known large original waits until the viewer is opened. */
export function inlineImageSource(
  previewUrl: string | null | undefined,
  originalUrl: string | null,
  metadata: unknown,
): string | null {
  if (previewUrl) return previewUrl;
  if (!originalUrl) return null;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return originalUrl;
  const size = (metadata as Record<string, unknown>).size_bytes;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return originalUrl;
  return size <= AUTO_ORIGINAL_LIMIT_BYTES ? originalUrl : null;
}
