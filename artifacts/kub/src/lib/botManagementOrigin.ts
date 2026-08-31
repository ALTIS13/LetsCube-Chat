export function resolveBotManagementOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    const localQaHost =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (
      parsed.origin !== value ||
      (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localQaHost))
    ) {
      throw new Error("bot_management_origin_invalid");
    }
    return parsed.origin;
  } catch {
    throw new Error("bot_management_origin_invalid");
  }
}
