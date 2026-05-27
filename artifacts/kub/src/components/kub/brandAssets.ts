const BRAND_ASSET_BASE = "brand/letscube/";

export function kubBrandAsset(name: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}${BRAND_ASSET_BASE}${name}`;
}
