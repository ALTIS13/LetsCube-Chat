const PUBLIC_ROUTES = new Set(["/privacy", "/support"]);
const AUTH_ROUTES = new Set(["/login", "/register"]);

export function isPublicRoute(location: string): boolean {
  return PUBLIC_ROUTES.has(normalizeRoutePath(location));
}

export function isAuthRoute(location: string): boolean {
  const path = normalizeRoutePath(location);
  return AUTH_ROUTES.has(path) || path === "/auth" || path.startsWith("/auth/");
}

function normalizeRoutePath(location: string): string {
  const path = location.split(/[?#]/, 1)[0]?.trim() || "/";
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}
