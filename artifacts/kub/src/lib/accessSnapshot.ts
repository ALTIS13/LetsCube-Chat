export interface AccessSnapshot {
  globalRoleKeys: Set<string>;
  globalPermissionKeys: Set<string>;
  locationPermissionKeys: Map<string, Set<string>>;
}

export function normalizeAccessSnapshot(value: unknown): AccessSnapshot {
  const record = isRecord(value) ? value : {};
  const locationPermissionKeys = new Map<string, Set<string>>();
  const locations = isRecord(record.location_permissions)
    ? record.location_permissions
    : {};

  for (const [locationId, permissions] of Object.entries(locations)) {
    if (!locationId) continue;
    locationPermissionKeys.set(locationId, toStringSet(permissions));
  }

  return {
    globalRoleKeys: toStringSet(record.global_role_keys),
    globalPermissionKeys: toStringSet(record.global_permission_keys),
    locationPermissionKeys,
  };
}

export function isAccessSnapshotUnavailable(error: unknown): boolean {
  const record = isRecord(error) ? error : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";
  return (
    (code === "PGRST202" || code === "42883") &&
    message.includes("current_user_access_snapshot")
  );
}

export function isAccessSnapshotEnabled(value: unknown): boolean {
  return value === "1";
}

export function selectPermissionKeys(
  snapshot: AccessSnapshot,
  permissionKeys: readonly string[],
  options: { locationId?: string | null; locationOnly?: boolean },
): Set<string> {
  const allowed = new Set<string>();
  const locationId = options.locationId ?? null;
  const locationKeys = locationId
    ? (snapshot.locationPermissionKeys.get(locationId) ?? new Set<string>())
    : new Set<string>();

  for (const permissionKey of permissionKeys) {
    const hasGlobal = snapshot.globalPermissionKeys.has(permissionKey);
    if (
      (!options.locationOnly && hasGlobal) ||
      (locationId && (hasGlobal || locationKeys.has(permissionKey)))
    ) {
      allowed.add(permissionKey);
    }
  }

  return allowed;
}

export function selectAnyLocationPermissionKeys(
  snapshot: AccessSnapshot,
  permissionKeys: readonly string[],
  locationIds: readonly string[],
): Set<string> {
  const allowed = new Set<string>();
  const locationSets = locationIds.map(
    (locationId) =>
      snapshot.locationPermissionKeys.get(locationId) ?? new Set<string>(),
  );

  for (const permissionKey of permissionKeys) {
    if (
      snapshot.globalPermissionKeys.has(permissionKey) ||
      locationSets.some((locationKeys) => locationKeys.has(permissionKey))
    ) {
      allowed.add(permissionKey);
    }
  }

  return allowed;
}

function toStringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(
    value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
