import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, type FormEvent } from "react";

import { KubButton, KubInput } from "@/components/kub";
import { botManagement } from "@/lib/botManagement";

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(token: string, botId: string): void;
};

export function BotCreateModal({ open, onOpenChange, onCreated }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) return;
    setDisplayName("");
    setUsername("");
    setDescription("");
    setError(null);
    setBusy(false);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = displayName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 64) {
      setError("Название должно содержать от 2 до 64 символов.");
      return;
    }
    if (!/^[a-z][a-z0-9_]{4,31}$/.test(username)) {
      setError("Имя: 5–32 символа, строчные латинские буквы, цифры и _. ");
      return;
    }
    if (description.length > 512) {
      setError("Описание не должно превышать 512 символов.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await botManagement.createOnce({
        display_name: trimmedName,
        username,
        description,
      });
      onOpenChange(false);
      onCreated(result.token, result.bot.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать бота.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/70" />
        <Dialog.Content className="fixed bottom-0 left-0 right-0 z-[71] max-h-[92dvh] overflow-y-auto rounded-t-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-5 shadow-2xl focus:outline-none sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6">
          <Dialog.Title className="text-lg font-semibold text-[color:var(--kub-text)]">Создать бота</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-[color:var(--kub-muted)]">
            Имя пользователя изменить нельзя. Токен будет показан один раз после создания.
          </Dialog.Description>
          <form className="mt-5 space-y-4" onSubmit={submit}>
            <KubInput label="Название" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={64} autoFocus aria-invalid={Boolean(error)} hint={`${displayName.length}/64`} />
            <KubInput label="Имя пользователя" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} maxLength={32} placeholder="release_bot" aria-invalid={Boolean(error)} hint="5–32 символа, например release_bot" />
            <div>
              <label htmlFor="bot-create-description" className="text-xs font-medium uppercase text-[color:var(--kub-muted)]">Описание</label>
              <textarea id="bot-create-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={512} rows={4} className="mt-1.5 w-full resize-none rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]" />
              <div className="mt-1 text-right text-xs text-[color:var(--kub-muted)]">{description.length}/512</div>
            </div>
            {error && <p role="alert" className="text-sm text-[color:var(--kub-danger)]">{error}</p>}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <KubButton type="button" variant="secondary" className="min-h-11" onClick={() => onOpenChange(false)} disabled={busy}>Отмена</KubButton>
              <KubButton type="submit" variant="primary" className="min-h-11" disabled={busy}>{busy ? "Создаём…" : "Создать"}</KubButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
