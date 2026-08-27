import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

type AuthCallbackClient = {
  exchangeCodeForSession(code: string): Promise<{
    data: { session: Session | null };
    error: unknown;
  }>;
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<{
    data: { session: Session | null };
    error: unknown;
  }>;
  onAuthStateChange(
    listener: (event: AuthChangeEvent, session: Session | null) => void,
  ): { data: { subscription: { unsubscribe(): void } } };
};

export type AuthCallbackSessionResult =
  | { kind: "invalid" }
  | { kind: "session" | "recovery"; session: Session };

export async function establishAuthCallbackSession(
  auth: AuthCallbackClient,
  url: URL,
): Promise<AuthCallbackSessionResult> {
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const parameterSets = [url.searchParams, hashParams];
  const explicitRecovery = parameterSets.some((params) => params.get("type") === "recovery");
  const code = parameterSets.map((params) => params.get("code")).find(Boolean);

  if (code) {
    let recoveryEvent = false;
    const { data: { subscription } } = auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") recoveryEvent = true;
    });
    try {
      const { data, error } = await auth.exchangeCodeForSession(code);
      if (error) throw error;
      if (!data.session) return { kind: "invalid" };
      return {
        kind: explicitRecovery || recoveryEvent ? "recovery" : "session",
        session: data.session,
      };
    } finally {
      subscription.unsubscribe();
    }
  }

  const tokenParams = parameterSets.find(
    (params) => params.has("access_token") || params.has("refresh_token"),
  );
  if (!tokenParams) return { kind: "invalid" };

  const accessToken = tokenParams.get("access_token");
  const refreshToken = tokenParams.get("refresh_token");
  if (!accessToken || !refreshToken) return { kind: "invalid" };

  const { data, error } = await auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
  if (!data.session) return { kind: "invalid" };

  return {
    kind: explicitRecovery ? "recovery" : "session",
    session: data.session,
  };
}
