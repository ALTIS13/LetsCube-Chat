export interface LocalMediaSaveResult {
  saved: boolean;
  location?: "Pictures/LETSCUBE" | "Movies/LETSCUBE";
}

export interface LocalMediaBridge {
  localCapabilities(): Promise<{ version: number; maxBytes: number; chunkBytes: number }>;
  beginLocal(input: { fileName: string; mimeType: string; size: number; sha256: string }): Promise<{ id: string }>;
  appendLocal(input: { id: string; offset: number; data: string }): Promise<{ written: number }>;
  finishLocal(input: { id: string }): Promise<LocalMediaSaveResult>;
  abortLocal(input: { id: string }): Promise<void>;
}

export class LocalMediaUnavailableError extends Error {
  constructor() { super("local_media_export_unavailable"); }
}

const MAX_BYTES = 32 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
const extensions: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"],
  "image/gif": ["gif"], "image/avif": ["avif"], "image/heic": ["heic"],
  "video/mp4": ["mp4"], "video/webm": ["webm"], "video/quicktime": ["mov"],
};

function fileMetadata(blob: Blob, name: string, hint?: string) {
  if (!Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > MAX_BYTES
    || !/^[A-Za-z0-9 ._()-]{1,120}$/.test(name) || !name.trim()) {
    throw Error("local_media_export_source");
  }
  const dot = name.lastIndexOf(".");
  let mimeType = blob.type.toLowerCase();
  // Match the existing native exporter's binary Content-Type compatibility.
  if (!mimeType || mimeType === "application/octet-stream") {
    const known = hint?.trim().toLowerCase();
    mimeType = known && known !== "application/octet-stream" ? known
      : Object.entries(extensions).find(([, suffixes]) => dot > 0 && suffixes.includes(name.slice(dot + 1).toLowerCase()))?.[0] ?? "";
  }
  const allowed = extensions[mimeType];
  if (!allowed) throw Error("local_media_export_source");
  if (dot > 0 && allowed.includes(name.slice(dot + 1).toLowerCase())) return { fileName: name, mimeType };
  const extension = allowed[0]!;
  const base = (dot > 0 ? name.slice(0, dot) : name).slice(0, 119 - extension.length).trim();
  if (!base) throw Error("local_media_export_source");
  return { fileName: `${base}.${extension}`, mimeType };
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Explicit save intent; the source lease must remain current until native finish. */
export async function exportLocalMedia(
  bridge: LocalMediaBridge,
  input: { blob: Blob; fileName: string; mimeType?: string; isCurrent: () => boolean },
): Promise<LocalMediaSaveResult> {
  const metadata = fileMetadata(input.blob, input.fileName, input.mimeType);
  const current = () => { if (!input.isCurrent()) throw Error("local_media_export_retired"); };
  current();
  let caps;
  try { caps = await bridge.localCapabilities(); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error
      && (error.code === "UNIMPLEMENTED" || error.code === "UNAVAILABLE")) throw new LocalMediaUnavailableError();
    throw error;
  }
  current();
  if (caps.version !== 1 || !Number.isSafeInteger(caps.maxBytes) || caps.maxBytes < input.blob.size
    || !Number.isSafeInteger(caps.chunkBytes) || caps.chunkBytes < 1) throw new LocalMediaUnavailableError();
  const chunkBytes = Math.min(CHUNK_BYTES, caps.chunkBytes);
  const digest = await crypto.subtle.digest("SHA-256", await input.blob.arrayBuffer());
  current();
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  let id: string | null = null, finished = false;
  try {
    const started = await bridge.beginLocal({ ...metadata, size: input.blob.size, sha256 });
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(started.id)) throw Error("local_media_export_session");
    id = started.id;
    current();
    for (let offset = 0; offset < input.blob.size; offset += chunkBytes) {
      const bytes = new Uint8Array(await input.blob.slice(offset, offset + chunkBytes).arrayBuffer());
      current();
      const reply = await bridge.appendLocal({ id, offset, data: base64(bytes) });
      current();
      if (reply.written !== offset + bytes.length) throw Error("local_media_export_offset");
    }
    current();
    const result = await bridge.finishLocal({ id });
    finished = true;
    current();
    return result;
  } finally {
    if (id && !finished) await bridge.abortLocal({ id }).catch(() => {});
  }
}
