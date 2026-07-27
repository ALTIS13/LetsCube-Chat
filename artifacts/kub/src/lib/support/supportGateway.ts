import {
  getSupabasePublicUrl,
  getSupabasePublishableKey,
} from "@/lib/supabase/client";
import { SupportGatewayError } from "./errors";
import type {
  CreatedSupportTicket,
  GuestSupportSession,
  NormalizedSupportRequest,
  PublicSupportTicket,
} from "./types";

export const SUPPORT_SECRET_HEADER = "x-letscube-support-secret";

export async function createSupportTicket(
  request: NormalizedSupportRequest,
): Promise<CreatedSupportTicket> {
  return gatewayRequest<CreatedSupportTicket>("/tickets", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function loadGuestSupportTicket(
  session: GuestSupportSession,
): Promise<PublicSupportTicket> {
  return gatewayRequest<PublicSupportTicket>(
    `/tickets/${encodeURIComponent(session.ticketId)}`,
    { method: "GET" },
    session.secret,
  );
}

export async function sendGuestSupportMessage(
  session: GuestSupportSession,
  body: string,
): Promise<PublicSupportTicket> {
  return gatewayRequest<PublicSupportTicket>(
    `/tickets/${encodeURIComponent(session.ticketId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
    session.secret,
  );
}

export async function revokeGuestSupportSession(
  session: GuestSupportSession,
): Promise<void> {
  await gatewayRequest<{ ok: true }>(
    `/tickets/${encodeURIComponent(session.ticketId)}/session`,
    { method: "DELETE" },
    session.secret,
  );
}

async function gatewayRequest<T>(
  path: string,
  init: RequestInit,
  guestSecret?: string,
): Promise<T> {
  let publicUrl: string;
  let publicKey: string;
  try {
    publicUrl = getSupabasePublicUrl();
    publicKey = getSupabasePublishableKey();
  } catch {
    throw new SupportGatewayError("not_configured", 503);
  }

  const endpoint = new URL(`/functions/v1/support-gateway${path}`, publicUrl);
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("apikey", publicKey);
  headers.set("authorization", `Bearer ${publicKey}`);
  if (init.body) headers.set("content-type", "application/json");
  if (guestSecret) headers.set(SUPPORT_SECRET_HEADER, guestSecret);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...init,
      headers,
      credentials: "omit",
      referrerPolicy: "strict-origin-when-cross-origin",
    });
  } catch {
    throw new SupportGatewayError("service_unavailable", 503);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const code = readErrorCode(payload);
    throw new SupportGatewayError(code, response.status);
  }

  return payload as T;
}

function readErrorCode(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "service_unavailable";
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" ? error : "service_unavailable";
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (response.ok && response.status === 204) return { ok: true };
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}
