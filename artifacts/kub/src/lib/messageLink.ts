/**
 * A link that opens one message.
 *
 * The application already follows these: a signed-in load of `/?chat=…&message=…`
 * opens the chat and jumps to the message (`hooks/usePush.ts`, which is how a
 * notification lands on its message, through `lib/chatJumpEvents.ts`). «Копировать
 * ссылку» only has to write the same shape.
 *
 * The origin is the application's own when it has a web one. The Windows and
 * Android shells do not — their origin is a scheme nobody else can open — so a
 * link copied there points at the public web application instead.
 */

export const PUBLIC_APP_ORIGIN = "https://app.letscube.ru";

export function messageLink(chatId: string, messageId: string, origin?: string | null): string {
  const base = origin && /^https?:\/\/[^/]+$/i.test(origin) ? origin : PUBLIC_APP_ORIGIN;
  const url = new URL("/", base);
  url.searchParams.set("chat", chatId);
  url.searchParams.set("message", messageId);
  return url.toString();
}
