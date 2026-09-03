import { createClient } from "@/lib/supabase/client";
import { isNativeAndroid } from "@/lib/platform/capabilities";
import { isDesktopApp } from "@/lib/platform/desktop";

/**
 * Support for someone who is already signed in.
 *
 * Reading goes straight through RLS — a person may select their own tickets
 * and the messages on them — so only the two writes need a function, and those
 * are `support_user_ticket_create` and `support_user_message_create`. Neither
 * asks for a captcha, a name, an email or a phone number: the account already
 * answers all four, and asking again is what made the guest form the wrong
 * place to send a signed-in person.
 */

export type UserTicketStatus =
  | "new"
  | "in_progress"
  | "waiting_user"
  | "waiting_support"
  | "escalated"
  | "resolved"
  | "closed"
  | "spam";

export interface UserSupportTicket {
  id: string;
  publicReference: string;
  status: UserTicketStatus;
  category: string;
  subject: string;
  lastActivityAt: string;
  createdAt: string;
}

export interface UserSupportMessage {
  id: string;
  ticketId: string;
  /** "requester" is this person; everything else came from support. */
  authorKind: "requester" | "operator" | "system" | "email";
  body: string;
  createdAt: string;
}

export const SUPPORT_CATEGORIES = [
  { value: "technical", label: "Техническая проблема" },
  { value: "account", label: "Аккаунт" },
  { value: "access", label: "Доступ" },
  { value: "messages", label: "Сообщения" },
  { value: "media", label: "Файлы и медиа" },
  { value: "tasks", label: "Задачи" },
  { value: "privacy", label: "Конфиденциальность" },
  { value: "abuse", label: "Жалоба" },
  { value: "other", label: "Другое" },
] as const;

export const OPEN_TICKET_STATUSES: readonly UserTicketStatus[] = [
  "new",
  "in_progress",
  "waiting_user",
  "waiting_support",
  "escalated",
];

const TICKET_COLUMNS =
  "id,public_reference,status,category,subject,last_activity_at,created_at";
const MESSAGE_COLUMNS = "id,ticket_id,author_kind,body,created_at";

/** The support tables and these two functions are not in the generated types;
 *  this is the same façade the operator side uses. */
interface SupportRpcClient {
  rpc<T>(name: string, args?: Record<string, unknown>): PromiseLike<{ data: T; error: unknown }>;
}

function client(): SupportRpcClient {
  return createClient() as unknown as SupportRpcClient;
}

/** Which build the message was written from, for the operator's context. */
export function currentSupportClientKind(): "web" | "android" | "windows" {
  if (isNativeAndroid()) return "android";
  if (isDesktopApp()) return "windows";
  return "web";
}

export class UserSupportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "UserSupportError";
  }
}

const MESSAGES: Record<string, string> = {
  support_not_authenticated: "Войдите в аккаунт, чтобы обратиться в поддержку.",
  support_request_invalid: "Проверьте тему и текст обращения.",
  support_message_invalid: "Сообщение пустое или слишком длинное.",
  support_intake_closed: "Приём обращений временно закрыт.",
  support_rate_limited: "Слишком много обращений подряд. Попробуйте позже.",
  support_message_rate_limited: "Слишком много сообщений подряд. Попробуйте позже.",
  support_open_ticket_limit:
    "У вас уже пять открытых обращений. Дождитесь ответа по одному из них.",
  support_ticket_closed: "Обращение закрыто. Создайте новое.",
  support_ticket_not_found: "Обращение не найдено.",
};

export function supportErrorMessage(error: unknown): string {
  const code = error instanceof UserSupportError ? error.code : "";
  return MESSAGES[code] ?? "Не удалось связаться с поддержкой. Попробуйте ещё раз.";
}

/** Postgres surfaces our `raise exception` text in `message`. */
function readErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "service_unavailable";
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return "service_unavailable";
  const match = message.match(/support_[a-z_]+/);
  return match ? match[0] : "service_unavailable";
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

export function projectTicket(row: Record<string, unknown>): UserSupportTicket | null {
  const id = readString(row, "id");
  if (!id) return null;
  return {
    id,
    publicReference: readString(row, "public_reference"),
    status: (readString(row, "status") || "new") as UserTicketStatus,
    category: readString(row, "category"),
    subject: readString(row, "subject"),
    lastActivityAt: readString(row, "last_activity_at"),
    createdAt: readString(row, "created_at"),
  };
}

export function projectMessage(row: Record<string, unknown>): UserSupportMessage | null {
  const id = readString(row, "id");
  const ticketId = readString(row, "ticket_id");
  if (!id || !ticketId) return null;
  const authorKind = readString(row, "author_kind");
  return {
    id,
    ticketId,
    authorKind:
      authorKind === "requester" || authorKind === "operator" || authorKind === "email"
        ? authorKind
        : "system",
    body: readString(row, "body"),
    createdAt: readString(row, "created_at"),
  };
}

export async function listMyTickets(userId: string): Promise<UserSupportTicket[]> {
  const { data, error } = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("support_tickets" as any)
    .select(TICKET_COLUMNS)
    .eq("requester_user_id", userId)
    .order("last_activity_at", { ascending: false })
    .limit(50);
  if (error) throw new UserSupportError(readErrorCode(error));
  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map(projectTicket)
    .filter((ticket): ticket is UserSupportTicket => ticket !== null);
}

export async function listTicketMessages(ticketId: string): Promise<UserSupportMessage[]> {
  const { data, error } = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("support_ticket_messages" as any)
    .select(MESSAGE_COLUMNS)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw new UserSupportError(readErrorCode(error));
  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map(projectMessage)
    .filter((message): message is UserSupportMessage => message !== null);
}

export async function createTicket(input: {
  category: string;
  subject: string;
  message: string;
}): Promise<{ id: string; publicReference: string }> {
  const { data, error } = await client().rpc<{ id: string; publicReference: string }>(
    "support_user_ticket_create",
    {
      p_category: input.category,
      p_subject: input.subject,
      p_message: input.message,
      p_client: currentSupportClientKind(),
    },
  );
  if (error) throw new UserSupportError(readErrorCode(error));
  return data;
}

export async function sendTicketMessage(ticketId: string, body: string): Promise<void> {
  const { error } = await client().rpc("support_user_message_create", {
    p_ticket_id: ticketId,
    p_body: body,
    p_client: currentSupportClientKind(),
  });
  if (error) throw new UserSupportError(readErrorCode(error));
}
