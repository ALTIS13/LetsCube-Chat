import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type CleanupCandidate = {
  user_id: string;
  signup_kind: "public" | "invite";
};

export interface RegistrationCleanupRepository {
  purgeAudit(now: string): Promise<number>;
  claim(
    limit: number,
    claimToken: string,
    now: string,
  ): Promise<CleanupCandidate[]>;
  recheck(userId: string, claimToken: string, now: string): Promise<boolean>;
  deleteCandidate(userId: string, claimToken: string, now: string): Promise<boolean>;
  report(userId: string, claimToken: string, reason: string): Promise<void>;
  finish(
    userId: string,
    claimToken: string,
    action: "skipped" | "failed",
    reason: string,
  ): Promise<void>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error("registration_cleanup_credentials_missing");
  return value;
}

function requireRpcData<T>(
  result: { data: T | null; error: unknown },
  code: string,
): T {
  if (result.error || result.data === null) throw new Error(code);
  return result.data;
}

function requireRpcSuccess(result: { error: unknown }, code: string): void {
  if (result.error) throw new Error(code);
}

function projectCandidate(value: unknown): CleanupCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("registration_cleanup_claim_invalid_data");
  }
  const candidate = value as Record<string, unknown>;
  const userId = candidate.user_id;
  const signupKind = candidate.signup_kind;
  if (
    typeof userId !== "string" ||
    !UUID_RE.test(userId) ||
    (signupKind !== "public" && signupKind !== "invite")
  ) {
    throw new Error("registration_cleanup_claim_invalid_data");
  }
  return { user_id: userId, signup_kind: signupKind };
}

function createServiceRoleClient(
  environment: NodeJS.ProcessEnv,
): SupabaseClient {
  return createClient(
    required(environment, "SUPABASE_URL"),
    required(environment, "SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

export function createRegistrationCleanupRepository(
  environment: NodeJS.ProcessEnv = process.env,
  client: Pick<SupabaseClient, "rpc"> = createServiceRoleClient(
    environment,
  ),
): RegistrationCleanupRepository {
  return {
    async purgeAudit(now) {
      const data = requireRpcData<number>(
        await client.rpc("registration_cleanup_purge_audit", {
          p_limit: 1000,
          p_now: now,
        }),
        "registration_cleanup_purge_failed",
      );
      if (!Number.isSafeInteger(data) || data < 0 || data > 1000) {
        throw new Error("registration_cleanup_purge_invalid_data");
      }
      return data;
    },

    async claim(limit, claimToken, now) {
      const data = requireRpcData<unknown[]>(
        await client.rpc("registration_cleanup_claim", {
          p_limit: limit,
          p_claim_token: claimToken,
          p_now: now,
        }),
        "registration_cleanup_claim_failed",
      );
      if (!Array.isArray(data)) {
        throw new Error("registration_cleanup_claim_invalid_data");
      }
      return data.map(projectCandidate);
    },

    async recheck(userId, claimToken, now) {
      const data = requireRpcData<boolean>(
        await client.rpc("registration_cleanup_recheck", {
          p_user_id: userId,
          p_claim_token: claimToken,
          p_now: now,
        }),
        "registration_cleanup_recheck_failed",
      );
      if (typeof data !== "boolean") {
        throw new Error("registration_cleanup_recheck_invalid_data");
      }
      return data;
    },

    async deleteCandidate(userId, claimToken, now) {
      const data = requireRpcData<boolean>(
        await client.rpc("registration_cleanup_delete", {
          p_user_id: userId,
          p_claim_token: claimToken,
          p_now: now,
        }),
        "registration_cleanup_delete_failed",
      );
      if (typeof data !== "boolean") {
        throw new Error("registration_cleanup_delete_invalid_data");
      }
      return data;
    },

    async report(userId, claimToken, reason) {
      requireRpcSuccess(
        await client.rpc("registration_cleanup_finish", {
          p_user_id: userId,
          p_claim_token: claimToken,
          p_action: "reported",
          p_reason_code: reason,
        }),
        "registration_cleanup_report_failed",
      );
    },

    async finish(userId, claimToken, action, reason) {
      requireRpcSuccess(
        await client.rpc("registration_cleanup_finish", {
          p_user_id: userId,
          p_claim_token: claimToken,
          p_action: action,
          p_reason_code: reason,
        }),
        "registration_cleanup_finish_failed",
      );
    },
  };
}
