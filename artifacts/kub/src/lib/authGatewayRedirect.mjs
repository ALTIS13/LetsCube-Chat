export function resolveAuthGatewayRedirect(explicitRedirectTo, getFallbackRedirectTo) {
  return explicitRedirectTo ?? getFallbackRedirectTo();
}
