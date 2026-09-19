import { mapPgError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { subscribeByTable } from "@/lib/realtimeTableChannels";

export const SUPPORT_PERMISSIONS = [
  "support.view",
  "support.claim",
  "support.reply",
  "support.transfer",
  "support.escalate",
  "support.lookup_customer",
  "support.manage",
  "support.settings",
] as const;

export type SupportPermission = (typeof SUPPORT_PERMISSIONS)[number];
export type SupportTicketStatus =
  | "new"
  | "in_progress"
  | "waiting_user"
  | "waiting_support"
  | "escalated"
  | "resolved"
  | "closed"
  | "spam";
export type SupportQueueFilter = "pool" | "mine" | "urgent" | "waiting" | "resolved" | "spam";

export interface SupportTicket {
  id: string;
  publicReference: string;
  requesterUserId: string | null;
  source: string;
  status: SupportTicketStatus;
  category: string;
  subject: string;
  priority: "low" | "normal" | "high" | "urgent";
  assignedOperatorId: string | null;
  assignedAt: string | null;
  urgent: boolean;
  linkedTicketId: string | null;
  resolutionSummary: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  lastRequesterMessageAt: string | null;
  lastOperatorMessageAt: string | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SupportTicketContact {
  ticketId: string;
  contactName: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}

export interface SupportTicketMessage {
  id: string;
  ticketId: string;
  authorUserId: string | null;
  authorKind: "requester" | "operator" | "system" | "email";
  source: string;
  body: string;
  createdAt: string;
}

export interface SupportTicketEvent {
  id: string;
  ticketId: string;
  eventType: string;
  actorUserId: string | null;
  visibility: "requester" | "operator";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SupportTicketDetails {
  ticket: SupportTicket;
  contact: SupportTicketContact | null;
  messages: SupportTicketMessage[];
  events: SupportTicketEvent[];
}

export interface SupportOperator {
  id: string;
  fullName: string;
  username: string | null;
}

export interface SupportCustomerCandidate {
  userId: string;
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
  emailMasked: string;
  phoneMasked: string;
  matchBasis: string;
}

export interface SupportSettings {
  intakeEnabled: boolean;
  guestIntakeEnabled: boolean;
  closedMessage: string;
  ticketLimit15m: number;
  ticketLimitDay: number;
  messageLimit5m: number;
  messageLimitDay: number;
}

export interface SupportOperatorPreferences {
  notifyNewPool: boolean;
  notifyUrgentOnly: boolean;
  notifyAssignedMessages: boolean;
  notifyTransfers: boolean;
  notifyEscalations: boolean;
  pushEnabled: boolean;
}

export interface SupportTicketActionInput {
  ticketId: string;
  comment?: string;
  operatorId?: string;
  urgent?: boolean;
  status?: "waiting_user" | "waiting_support";
}

type ApiError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type ApiResult<T> = PromiseLike<{ data: T | null; error: ApiError | null; count?: number | null }>;

interface QueryBuilder<T> extends PromiseLike<{ data: T | null; error: ApiError | null; count?: number | null }> {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  is(column: string, value: null): QueryBuilder<T>;
  in(column: string, values: readonly unknown[]): QueryBuilder<T>;
  not(column: string, operator: string, value: unknown): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
  range(from: number, to: number): QueryBuilder<T>;
  limit(count: number): QueryBuilder<T>;
  upsert(
    values: unknown,
    options?: { onConflict?: string },
  ): QueryBuilder<T>;
}

interface RealtimeChannel {
  on(
    event: "postgres_changes",
    filter: { event: "*"; schema: "public"; table: string },
    callback: () => void,
  ): RealtimeChannel;
  subscribe(): RealtimeChannel;
}

interface SupportDataClient {
  from<T>(table: string): QueryBuilder<T>;
  rpc<T>(name: string, args?: Record<string, unknown>): ApiResult<T>;
  channel(name: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): PromiseLike<unknown>;
}

const TICKET_COLUMNS = [
  "id",
  "public_reference",
  "requester_user_id",
  "source",
  "status",
  "category",
  "subject",
  "priority",
  "assigned_operator_id",
  "assigned_at",
  "urgent",
  "linked_ticket_id",
  "resolution_summary",
  "resolved_at",
  "closed_at",
  "last_requester_message_at",
  "last_operator_message_at",
  "last_activity_at",
  "created_at",
  "updated_at",
  "version",
].join(",");

const MESSAGE_COLUMNS =
  "id,ticket_id,author_user_id,author_kind,source,body,created_at";
const EVENT_COLUMNS =
  "id,ticket_id,event_type,actor_user_id,visibility,payload,created_at";
const CONTACT_COLUMNS =
  "ticket_id,contact_name,email_original,phone_e164,email_verified,phone_verified";
const SETTINGS_COLUMNS =
  "intake_enabled,guest_intake_enabled,closed_message,ticket_limit_15m,ticket_limit_day,message_limit_5m,message_limit_day";
const PREFERENCE_COLUMNS =
  "operator_user_id,notify_new_pool,notify_urgent_only,notify_assigned_messages,notify_transfers,notify_escalations,push_enabled";

function client(): SupportDataClient {
  return createClient() as unknown as SupportDataClient;
}

export async function listSupportTickets(
  filter: SupportQueueFilter,
  currentUserId: string,
  page = 0,
  pageSize = 75,
): Promise<SupportTicket[]> {
  let query = client()
    .from<Record<string, unknown>[]>("support_tickets")
    .select(TICKET_COLUMNS)
    .order("urgent", { ascending: false })
    .order("last_activity_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  if (filter === "pool") {
    query = query
      .is("assigned_operator_id", null)
      .in("status", ["new", "waiting_support", "escalated"]);
  } else if (filter === "mine") {
    query = query
      .eq("assigned_operator_id", currentUserId)
      .not("status", "in", "(resolved,closed,spam)");
  } else if (filter === "urgent") {
    query = query.eq("urgent", true).not("status", "in", "(resolved,closed,spam)");
  } else if (filter === "waiting") {
    query = query.in("status", ["waiting_user", "waiting_support"]);
  } else if (filter === "resolved") {
    query = query.in("status", ["resolved", "closed"]);
  } else {
    query = query.eq("status", "spam");
  }

  const { data, error } = await query;
  if (error) throw new SupportOperatorApiError(mapSupportOperatorError(error), error);
  return (data ?? []).map(readTicket).filter(isPresent);
}

export async function loadSupportTicket(
  ticketId: string,
  options: { revealContact: boolean },
): Promise<SupportTicketDetails> {
  const dataClient = client();
  const ticketPromise = dataClient
    .from<Record<string, unknown>[]>("support_tickets")
    .select(TICKET_COLUMNS)
    .eq("id", ticketId)
    .limit(1);
  const messagesPromise = dataClient
    .from<Record<string, unknown>[]>("support_ticket_messages")
    .select(MESSAGE_COLUMNS)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .limit(300);
  const eventsPromise = dataClient
    .from<Record<string, unknown>[]>("support_ticket_events")
    .select(EVENT_COLUMNS)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(300);
  const contactPromise = options.revealContact
    ? dataClient
        .from<Record<string, unknown>[]>("support_ticket_contacts")
        .select(CONTACT_COLUMNS)
        .eq("ticket_id", ticketId)
        .limit(1)
    : Promise.resolve({ data: [], error: null });

  const [ticketResult, messagesResult, eventsResult, contactResult] = await Promise.all([
    ticketPromise,
    messagesPromise,
    eventsPromise,
    contactPromise,
  ]);
  const error =
    ticketResult.error ?? messagesResult.error ?? eventsResult.error ?? contactResult.error;
  if (error) throw new SupportOperatorApiError(mapSupportOperatorError(error), error);

  const ticket = readTicket(ticketResult.data?.[0]);
  if (!ticket) {
    throw new SupportOperatorApiError("Обращение не найдено или больше недоступно.");
  }

  return {
    ticket,
    contact: options.revealContact ? readContact(contactResult.data?.[0]) : null,
    messages: (messagesResult.data ?? []).map(readMessage).filter(isPresent),
    events: (eventsResult.data ?? []).map(readEvent).filter(isPresent),
  };
}

export async function listSupportOperators(): Promise<SupportOperator[]> {
  const rows = await runRpc<Record<string, unknown>[]>("support_operator_directory", {});
  return (rows ?? [])
    .map((row) => {
      const id = stringValue(row.id);
      if (!id) return null;
      return {
        id,
        fullName: stringValue(row.full_name) ?? "Пользователь",
        username: stringValue(row.username),
      };
    })
    .filter(isPresent);
}

export async function getSupportSettings(): Promise<SupportSettings | null> {
  const { data, error } = await client()
    .from<Record<string, unknown>[]>("support_settings")
    .select(SETTINGS_COLUMNS)
    .limit(1);
  if (error) throw new SupportOperatorApiError(mapSupportOperatorError(error), error);
  const row = data?.[0];
  return row ? readSettings(row) : null;
}

export async function getSupportOperatorPreferences(
  operatorUserId: string,
): Promise<SupportOperatorPreferences> {
  const { data, error } = await client()
    .from<Record<string, unknown>[]>("support_operator_preferences")
    .select(PREFERENCE_COLUMNS)
    .eq("operator_user_id", operatorUserId)
    .limit(1);
  if (error) throw new SupportOperatorApiError(mapSupportOperatorError(error), error);
  return readOperatorPreferences(data?.[0]);
}

export async function updateSupportOperatorPreferences(
  operatorUserId: string,
  preferences: SupportOperatorPreferences,
): Promise<SupportOperatorPreferences> {
  const { data, error } = await client()
    .from<Record<string, unknown>[]>("support_operator_preferences")
    .upsert(
      {
        operator_user_id: operatorUserId,
        notify_new_pool: preferences.notifyNewPool,
        notify_urgent_only: preferences.notifyUrgentOnly,
        notify_assigned_messages: preferences.notifyAssignedMessages,
        notify_transfers: preferences.notifyTransfers,
        notify_escalations: preferences.notifyEscalations,
        push_enabled: preferences.pushEnabled,
      },
      { onConflict: "operator_user_id" },
    )
    .select(PREFERENCE_COLUMNS)
    .limit(1);
  if (error) throw new SupportOperatorApiError(mapSupportOperatorError(error), error);
  return readOperatorPreferences(data?.[0]);
}

export async function claimSupportTicket(ticketId: string): Promise<void> {
  await runRpc("support_ticket_claim", { p_ticket_id: ticketId });
}

export async function replyToSupportTicket(ticketId: string, body: string): Promise<void> {
  await runRpc("support_operator_message_create", {
    p_ticket_id: ticketId,
    p_body: body.trim(),
  });
}

export async function transferSupportTicket(
  ticketId: string,
  operatorId: string,
  comment: string,
): Promise<void> {
  await runRpc("support_ticket_transfer", {
    p_ticket_id: ticketId,
    p_operator_id: operatorId,
    p_comment: comment.trim(),
  });
}

export async function returnSupportTicketToPool(
  ticketId: string,
  reason: string,
  urgent: boolean,
): Promise<void> {
  await runRpc("support_ticket_return_to_pool", {
    p_ticket_id: ticketId,
    p_reason: reason.trim(),
    p_urgent: urgent,
  });
}

export async function escalateSupportTicket(ticketId: string, reason: string): Promise<void> {
  await runRpc("support_ticket_escalate", {
    p_ticket_id: ticketId,
    p_reason: reason.trim(),
  });
}

export async function markSupportTicketWaiting(
  ticketId: string,
  status: "waiting_user" | "waiting_support",
): Promise<void> {
  await runRpc("support_ticket_mark_waiting", {
    p_ticket_id: ticketId,
    p_status: status,
  });
}

export async function resolveSupportTicket(ticketId: string, summary: string): Promise<void> {
  await runRpc("support_ticket_resolve", {
    p_ticket_id: ticketId,
    p_summary: summary.trim(),
  });
}

export async function closeSupportTicket(ticketId: string, summary: string): Promise<void> {
  await runRpc("support_ticket_close", {
    p_ticket_id: ticketId,
    p_summary: summary.trim(),
  });
}

export async function reopenSupportTicket(ticketId: string): Promise<string> {
  return runRpc<string>("support_ticket_reopen", { p_ticket_id: ticketId });
}

export async function lookupSupportCustomer(
  ticketId: string,
  query: string,
): Promise<SupportCustomerCandidate[]> {
  const rows = await runRpc<Record<string, unknown>[]>("support_ticket_lookup_customer", {
    p_ticket_id: ticketId,
    p_query: query.trim(),
  });
  return (rows ?? []).map((row) => ({
    userId: stringValue(row.user_id) ?? "",
    fullName: stringValue(row.full_name),
    username: stringValue(row.username),
    avatarUrl: stringValue(row.avatar_url),
    emailMasked: stringValue(row.email_masked) ?? "—",
    phoneMasked: stringValue(row.phone_masked) ?? "—",
    matchBasis: stringValue(row.match_basis) ?? "profile",
  })).filter((candidate) => Boolean(candidate.userId));
}

export async function updateSupportSettings(settings: SupportSettings): Promise<SupportSettings> {
  const row = await runRpc<Record<string, unknown>>("support_settings_update_v2", {
    p_intake_enabled: settings.intakeEnabled,
    p_guest_intake_enabled: settings.guestIntakeEnabled,
    p_closed_message: settings.closedMessage.trim(),
    p_ticket_limit_15m: settings.ticketLimit15m,
    p_ticket_limit_day: settings.ticketLimitDay,
    p_message_limit_5m: settings.messageLimit5m,
    p_message_limit_day: settings.messageLimitDay,
  });
  return readSettings(row);
}

export function subscribeToSupportChanges(onChange: () => void): () => void {
  const dataClient = client();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const notify = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 250);
  };
  // One channel per table, through the helper, because a channel is only as
  // live as its least live binding — measured on production on 2026-09-05 and
  // written up in `lib/realtimeTableChannels.ts`. This subscription carried
  // three tables on one channel from the day the operator workspace landed
  // (c44df3e9, 2026-07-27), the exact construction that measurement outlawed,
  // and it reported SUBSCRIBED throughout.
  //
  // Nothing is narrowed, and the policies say why, read read-only on
  // production on 2026-09-20. The operator select policy on `support_tickets`
  // is has_permission(uid, support.view) with no row key at all; the messages
  // and events policies reach the same permission through the parent ticket.
  // The only reader-keyed branch is the requester one
  // (requester_user_id = uid), and this function serves the operator console,
  // which exists to watch every ticket it may see. All three tables carry the
  // default replica identity (measured the same day), so by Supabase's
  // documented rule — a filter reaches a DELETE only under REPLICA IDENTITY
  // FULL, read rather than measured here — a filter on any column but `id`
  // would have dropped their DELETE events as well.
  //
  // `RealtimeChannel` here is this file's own structural shim below, not the
  // supabase-js type the other repaired call sites import: importing that name
  // into this module collides with the local declaration and fails typecheck.
  const channels = subscribeByTable<typeof notify, RealtimeChannel>(
    dataClient,
    `support-operator:${crypto.randomUUID()}`,
    [
      { event: "*", schema: "public", table: "support_tickets", handler: notify },
      { event: "*", schema: "public", table: "support_ticket_messages", handler: notify },
      { event: "*", schema: "public", table: "support_ticket_events", handler: notify },
    ],
  );

  return () => {
    if (timer) clearTimeout(timer);
    for (const { channel } of channels) void dataClient.removeChannel(channel);
  };
}

export class SupportOperatorApiError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SupportOperatorApiError";
    this.cause = cause;
  }
}

export function mapSupportOperatorError(error: unknown): string {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  const code = typeof record.code === "string" ? record.code.toUpperCase() : "";

  if (message.includes("support_ticket_already_claimed_or_unavailable")) {
    return "Обращение уже принял другой оператор. Очередь обновлена.";
  }
  if (message.includes("support_ticket_not_found")) {
    return "Обращение не найдено или больше недоступно.";
  }
  if (message.includes("support_ticket_transition_denied")) {
    return "Это действие недоступно для текущего состояния обращения.";
  }
  if (message.includes("support_ticket_not_writable")) {
    return "В закрытое обращение нельзя отправить сообщение.";
  }
  if (
    message.includes("support_operator_message_create") ||
    code === "PGRST202" ||
    code === "42883"
  ) {
    return "Ответы оператора временно недоступны: серверная функция ещё не обновлена.";
  }
  const friendly = mapPgError(error);
  return friendly === "Не удалось выполнить операцию. Попробуйте позже."
    ? "Не удалось выполнить действие. Попробуйте ещё раз."
    : friendly;
}

async function runRpc<T = string>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc<T>(name, args);
  if (error) throw new SupportOperatorApiError(mapSupportOperatorError(error), error);
  return data as T;
}

function readTicket(row: Record<string, unknown> | undefined): SupportTicket | null {
  if (!row) return null;
  const id = stringValue(row.id);
  const publicReference = stringValue(row.public_reference);
  const status = stringValue(row.status) as SupportTicketStatus | null;
  const subject = stringValue(row.subject);
  const lastActivityAt = stringValue(row.last_activity_at);
  const createdAt = stringValue(row.created_at);
  const updatedAt = stringValue(row.updated_at);
  if (!id || !publicReference || !status || !subject || !lastActivityAt || !createdAt || !updatedAt) return null;
  return {
    id,
    publicReference,
    requesterUserId: stringValue(row.requester_user_id),
    source: stringValue(row.source) ?? "web_guest",
    status,
    category: stringValue(row.category) ?? "other",
    subject,
    priority: (stringValue(row.priority) as SupportTicket["priority"]) ?? "normal",
    assignedOperatorId: stringValue(row.assigned_operator_id),
    assignedAt: stringValue(row.assigned_at),
    urgent: Boolean(row.urgent),
    linkedTicketId: stringValue(row.linked_ticket_id),
    resolutionSummary: stringValue(row.resolution_summary),
    resolvedAt: stringValue(row.resolved_at),
    closedAt: stringValue(row.closed_at),
    lastRequesterMessageAt: stringValue(row.last_requester_message_at),
    lastOperatorMessageAt: stringValue(row.last_operator_message_at),
    lastActivityAt,
    createdAt,
    updatedAt,
    version: typeof row.version === "number" ? row.version : 1,
  };
}

function readContact(row: Record<string, unknown> | undefined): SupportTicketContact | null {
  if (!row) return null;
  const ticketId = stringValue(row.ticket_id);
  if (!ticketId) return null;
  return {
    ticketId,
    contactName: stringValue(row.contact_name) ?? "Не указано",
    email: stringValue(row.email_original) ?? "Не указана",
    phone: stringValue(row.phone_e164) ?? "Не указан",
    emailVerified: Boolean(row.email_verified),
    phoneVerified: Boolean(row.phone_verified),
  };
}

function readMessage(row: Record<string, unknown>): SupportTicketMessage | null {
  const id = stringValue(row.id);
  const ticketId = stringValue(row.ticket_id);
  const body = stringValue(row.body);
  const createdAt = stringValue(row.created_at);
  if (!id || !ticketId || !body || !createdAt) return null;
  return {
    id,
    ticketId,
    authorUserId: stringValue(row.author_user_id),
    authorKind: (stringValue(row.author_kind) as SupportTicketMessage["authorKind"]) ?? "system",
    source: stringValue(row.source) ?? "web",
    body,
    createdAt,
  };
}

function readEvent(row: Record<string, unknown>): SupportTicketEvent | null {
  const id = stringValue(row.id);
  const ticketId = stringValue(row.ticket_id);
  const eventType = stringValue(row.event_type);
  const createdAt = stringValue(row.created_at);
  if (!id || !ticketId || !eventType || !createdAt) return null;
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};
  return {
    id,
    ticketId,
    eventType,
    actorUserId: stringValue(row.actor_user_id),
    visibility: row.visibility === "requester" ? "requester" : "operator",
    payload,
    createdAt,
  };
}

function readSettings(row: Record<string, unknown>): SupportSettings {
  return {
    intakeEnabled: Boolean(row.intake_enabled),
    guestIntakeEnabled: Boolean(row.guest_intake_enabled),
    closedMessage: stringValue(row.closed_message) ?? "Приём обращений временно закрыт.",
    ticketLimit15m: numberValue(row.ticket_limit_15m, 3),
    ticketLimitDay: numberValue(row.ticket_limit_day, 10),
    messageLimit5m: numberValue(row.message_limit_5m, 20),
    messageLimitDay: numberValue(row.message_limit_day, 200),
  };
}

function readOperatorPreferences(
  row: Record<string, unknown> | undefined,
): SupportOperatorPreferences {
  return {
    notifyNewPool: row ? Boolean(row.notify_new_pool) : true,
    notifyUrgentOnly: row ? Boolean(row.notify_urgent_only) : false,
    notifyAssignedMessages: row ? Boolean(row.notify_assigned_messages) : true,
    notifyTransfers: row ? Boolean(row.notify_transfers) : true,
    notifyEscalations: row ? Boolean(row.notify_escalations) : true,
    pushEnabled: row ? Boolean(row.push_enabled) : true,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
