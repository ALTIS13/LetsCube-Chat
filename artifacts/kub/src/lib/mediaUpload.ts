const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function validateAvatarImage(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "Выберите файл изображения.";
  }
  if (!IMAGE_EXTENSIONS[file.type]) {
    return "Поддерживаются JPG, PNG, WEBP и GIF.";
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return "Изображение слишком большое. Максимум 5 МБ.";
  }
  return null;
}

export function avatarUploadPath(kind: "user" | "chat", ownerId: string, file: File): string {
  const ext = IMAGE_EXTENSIONS[file.type] ?? "bin";
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;
  const prefix = kind === "user" ? "avatars" : "chat-avatars";
  return `${prefix}/${ownerId}/avatar-${unique}.${ext}`;
}
