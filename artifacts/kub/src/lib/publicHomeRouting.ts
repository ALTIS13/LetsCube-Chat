export type RootExperience = "public_home" | "login" | "messenger" | "loading";

export function decideRootExperience(input: {
  loading: boolean;
  authenticated: boolean;
  nativeShell: boolean;
}): RootExperience {
  if (input.loading) return "loading";
  if (input.authenticated) return "messenger";
  return input.nativeShell ? "login" : "public_home";
}
