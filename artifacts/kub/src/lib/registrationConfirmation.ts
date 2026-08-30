export function maskRegistrationEmail(value: string): string {
  const [local, domain, extra] = value.trim().toLowerCase().split("@");
  if (!local || !domain || extra) return "";
  const visible = local.length === 1 ? local : `${local[0]}***${local.at(-1)}`;
  return `${visible}${local.length === 1 ? "***" : ""}@${domain}`;
}
