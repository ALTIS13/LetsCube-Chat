import type { KubIconName } from "@/components/kub";

export const KUB_APP_DIALOG_EVENT = "kub:app-dialog";

export type AppDialogTone = "default" | "danger";

export interface AppDialogRequest {
  id: number;
  kind: "alert" | "confirm";
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: AppDialogTone;
  icon?: KubIconName;
  resolve: (confirmed: boolean) => void;
}

let nextDialogId = 1;

export function requestAppConfirm(options: {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: AppDialogTone;
  icon?: KubIconName;
}): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<AppDialogRequest>(KUB_APP_DIALOG_EVENT, {
      detail: {
        id: nextDialogId++,
        kind: "confirm",
        title: options.title,
        description: options.description,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        tone: options.tone ?? "default",
        icon: options.icon,
        resolve,
      },
    }));
  });
}

export function showAppAlert(message: string, title = "Сообщение", icon: KubIconName = "alert"): void {
  if (typeof window === "undefined") {
    console.warn(message);
    return;
  }
  window.dispatchEvent(new CustomEvent<AppDialogRequest>(KUB_APP_DIALOG_EVENT, {
    detail: {
      id: nextDialogId++,
      kind: "alert",
      title,
      description: message,
      confirmLabel: "Понятно",
      tone: "default",
      icon,
      resolve: () => undefined,
    },
  }));
}
