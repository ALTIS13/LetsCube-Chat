export type NativePushCategory = "message" | "task" | "system";

export function nativePushCategory(kind: string): NativePushCategory {
  const normalized = kind.toLowerCase();
  if (normalized.includes("message")) return "message";
  if (normalized === "task" || normalized.startsWith("task_")) return "task";
  return "system";
}

// A provider may deliver an accepted push after its token is rebound to another
// account. Keep native OS payloads free of account content until the installed
// client can authenticate the recipient before displaying them.
export function nativePushDisplay(category: NativePushCategory) {
  return {
    title: "LETSCUBE",
    body: category === "message" ? "Новое сообщение"
      : category === "task" ? "Новая задача" : "Новое уведомление",
  };
}
