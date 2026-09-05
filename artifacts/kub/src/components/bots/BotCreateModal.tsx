import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, type FormEvent } from "react";

import { KubButton, KubInput } from "@/components/kub";
import { BotManagementError, botManagement } from "@/lib/botManagement";

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(token: string, botId: string): void;
  onUncertain(): Promise<unknown> | unknown;
};

type FieldErrors = Partial<{
  displayName: string;
  username: string;
  description: string;
}>;

export function BotCreateModal({ open, onOpenChange, onCreated, onUncertain }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) return;
    setDisplayName("");
    setUsername("");
    setDescription("");
    setError(null);
    setFieldErrors({});
    setUncertain(false);
    setBusy(false);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = displayName.trim();
    const nextErrors: FieldErrors = {};
    if (trimmedName.length < 2 || trimmedName.length > 64) {
      nextErrors.displayName = "Название должно содержать от 2 до 64 символов.";
    }
    if (!/^[a-z][a-z0-9_]{4,31}$/.test(username)) {
      nextErrors.username = "Имя: 5–32 символа, строчные латинские буквы, цифры и _.";
    }
    if (description.length > 512) {
      nextErrors.description = "Описание не должно превышать 512 символов.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await botManagement.createOnce({
        display_name: trimmedName,
        username,
        description,
      });
      onOpenChange(false);
      onCreated(result.token, result.bot.id);
    } catch (cause) {
      if (cause instanceof BotManagementError && cause.code === "uncertain_result") {
        setUncertain(true);
        setError(
          "Запрос мог выполниться. Мы обновили список ботов. Не повторяйте создание: если бот появился, откройте его вкладку API и выпустите новый токен.",
        );
        try {
          await onUncertain();
        } catch {
          // The explicit uncertainty guidance remains valid if refresh also fails.
        }
      } else {
        setError(cause instanceof Error ? cause.message : "Не удалось создать бота.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/45" />
        <Dialog.Content className="bots-management-surface kub-glass-strong fixed bottom-0 left-0 right-0 z-[71] max-h-[92dvh] overflow-y-auto rounded-t-lg border border-[color:var(--kub-border-color)] p-5 focus:outline-none sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6">
          <Dialog.Title className="text-lg font-semibold text-[color:var(--kub-text)]">Создать бота</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-[color:var(--kub-muted)]">
            Имя пользователя изменить нельзя. Токен будет показан один раз после создания.
          </Dialog.Description>
          <form className="mt-5 space-y-4" onSubmit={submit}>
            <KubInput label="Название" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setFieldErrors((current) => ({ ...current, displayName: undefined })); }} maxLength={64} autoFocus aria-invalid={Boolean(fieldErrors.displayName)} aria-describedby={fieldErrors.displayName ? "bot-create-display-name-error" : undefined} error={fieldErrors.displayName} errorId="bot-create-display-name-error" hint={`${displayName.length}/64`} />
            <KubInput label="Имя пользователя" value={username} onChange={(event) => { setUsername(event.target.value.toLowerCase()); setFieldErrors((current) => ({ ...current, username: undefined })); }} maxLength={32} placeholder="release_bot" aria-invalid={Boolean(fieldErrors.username)} aria-describedby={fieldErrors.username ? "bot-create-username-error" : undefined} error={fieldErrors.username} errorId="bot-create-username-error" hint="5–32 символа, например release_bot" />
            <div>
              <label htmlFor="bot-create-description" className="text-xs font-medium uppercase text-[color:var(--kub-muted)]">Описание</label>
              <textarea id="bot-create-description" value={description} onChange={(event) => { setDescription(event.target.value); setFieldErrors((current) => ({ ...current, description: undefined })); }} maxLength={512} rows={4} aria-invalid={Boolean(fieldErrors.description)} aria-describedby={fieldErrors.description ? "bot-create-description-error" : undefined} className="mt-1.5 w-full resize-none rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)] aria-[invalid=true]:border-[color:var(--kub-danger)]" />
              {fieldErrors.description && <p id="bot-create-description-error" className="mt-1 text-xs text-[color:var(--kub-danger-text)]">{fieldErrors.description}</p>}
              <div className="mt-1 text-right text-xs text-[color:var(--kub-muted)]">{description.length}/512</div>
            </div>
            {error && <p role="alert" className="text-sm text-[color:var(--kub-danger-text)]">{error}</p>}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <KubButton type="button" variant="secondary" className="min-h-11" onClick={() => onOpenChange(false)} disabled={busy}>Отмена</KubButton>
              <KubButton type="submit" variant="primary" className="min-h-11" disabled={busy || uncertain}>{busy ? "Создаём…" : "Создать"}</KubButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
