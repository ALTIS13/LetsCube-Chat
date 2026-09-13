/**
 * What a PostgREST request was for, named the way the counting gates report it.
 *
 * This is the rule `chat-list-event-cost.spec.ts` counts by, and it used to
 * live inside that spec with one bucket too few. `GET /rest/v1/messages` is
 * asked by two different owners, and the old rule called both of them
 * `GET messages:list`:
 *
 * - the open conversation, for its page of history (`useMessages.fetchMessages`);
 * - the chat list, for one chat's preview line — the newest rows it may show
 *   (`useChats.fetchFallbackChatSummary`), one request per chat, on the
 *   compatibility path a deployment without the `chat_list_summaries` RPC takes.
 *
 * Because both landed in one bucket, a single allowed revalidation of a
 * six-chat list read as seven revalidations of the open chat, and that is what
 * D-173 was filed as. Measured 2026-09-13 on the fixture backend: coming back
 * to the tab after 16.5s hidden counted `GET messages:list` 7, of which
 * `fetchMessages` ran exactly once and `fetchFallbackChatSummary` six times —
 * once per chat. With `VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED=1` the same phase
 * counted 1, the six previews replaced by one `POST rpc/chat_list_summaries`.
 * So the number a gate saw depended on which summary path the server under
 * test was built for, while the failure text named only the conversation.
 *
 * The two are told apart by their projection, because that is the only thing
 * about them the server sees differ: the conversation asks for reactions and
 * the replied-to row (`MESSAGE_SELECT_WITH_JOINS`), the preview asks for
 * neither (`MESSAGE_LAST_MESSAGE_SELECT`). `tests/unit/request-labels.test.mts`
 * pins that against both constants as the product declares them, so a change
 * that made the two projections indistinguishable fails there rather than
 * quietly putting this bucket back the way it was.
 */

/** The conversation's own page of history, with reactions and replied-to rows. */
export const MESSAGES_HISTORY = "GET messages:list";
/** One chat's preview line for the sidebar, on the per-chat compatibility path. */
export const MESSAGES_PREVIEW = "GET messages:preview";

/** The part of the projection only the conversation's query asks for. */
const CONVERSATION_PROJECTION_MARKER = "reactions(";

export interface PostgrestRequest {
  method: string;
  url: URL;
  /** Lower-cased header names, as Playwright's `route.request().headers()` gives them. */
  headers: Record<string, string>;
}

export function labelPostgrestRequest({ method, url, headers }: PostgrestRequest): string {
  const path = url.pathname;
  if (path.startsWith("/auth/v1/")) return `${method} auth${path.slice("/auth/v1".length)}`;
  const resource = path.match(/^\/rest\/v1\/(.+)$/)?.[1];
  if (!resource) return `${method} ${path}`;
  if (resource === "messages" && method === "GET") {
    if ((headers.prefer ?? "").includes("count=")) return "GET messages:count";
    if (url.searchParams.get("id")?.startsWith("eq.") || url.searchParams.get("client_message_id")) return "GET messages:one";
    if (url.searchParams.get("pinned")) return "GET messages:pinned";
    return (url.searchParams.get("select") ?? "").includes(CONVERSATION_PROJECTION_MARKER)
      ? MESSAGES_HISTORY
      : MESSAGES_PREVIEW;
  }
  return `${method} ${resource}`;
}
