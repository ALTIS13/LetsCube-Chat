import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LookupAddress } from "node:dns";
import type { RequestOptions } from "node:http";

/**
 * Where a URL is allowed to point.
 *
 * §6 of the brief asks for a URL watcher and §20 asks that it not become a
 * proxy into the network the bot runs in. That is the whole of this module: it
 * decides, before a socket exists, whether an address may be dialled, and it
 * decides it about the **address**, never about the name.
 *
 * The three mistakes this file exists to not make:
 *
 *   1. **Checking the hostname.** `internal.example.com` is a perfectly public
 *      name that resolves to 10.0.0.5, and `0x7f.1` is a perfectly
 *      internal-looking address that a naive string check misses. Only the
 *      resolved bytes mean anything, so every decision below is taken on
 *      16 bytes of address.
 *
 *   2. **Resolving and then fetching.** Two lookups of the same name may return
 *      different answers — that is DNS rebinding, and it is a feature of DNS
 *      rather than an attack on it. The check therefore does not hand a
 *      *hostname* to the socket layer; it hands the exact address it approved,
 *      through `createPinnedLookup`. `safeFetch` then confirms the socket
 *      actually landed there.
 *
 *   3. **Failing open on a malformed address.** `net.BlockList.check()` returns
 *      `false` — "not blocked" — for a string that is not an IP at all. A guard
 *      built on it alone says "allowed" about garbage. Every address here is
 *      parsed to bytes first and refused if it does not parse.
 *
 * **Reused, deliberately, from `artifacts/api-server/src/bot/webhookSecurity.ts`.**
 * The Bot Gateway solves the same problem for outbound webhooks, and its
 * `createPinnedWebhookLookup` is the correct answer to (2). PocketFlow is a
 * third-party application (§21) and must not import from the platform's server,
 * so the *idea* and the IANA global-unicast table are carried over by hand
 * rather than imported. A second, divergent table would be the real bug; where
 * they differ below it is on purpose and said so in place.
 */

export type IpFamily = 4 | 6;

export type ResolvedAddress = {
  address: string;
  family: IpFamily;
};

/** Injectable so a test never touches a resolver, and never the network. */
export type DnsResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export type SsrfDenyReason =
  // Decidable from the URL text alone, before any lookup.
  | "url_invalid"
  | "url_too_long"
  | "scheme_not_allowed"
  | "credentials_in_url"
  | "port_not_allowed"
  | "hostname_invalid"
  | "internal_name"
  // Decidable only after a lookup.
  | "dns_failed"
  | "dns_no_answer"
  | "dns_too_many_answers"
  | "address_invalid"
  // Properties of the resolved address itself.
  | "unspecified"
  | "loopback"
  | "private_network"
  | "shared_address_space"
  | "link_local"
  | "cloud_metadata"
  | "documentation"
  | "benchmarking"
  | "multicast"
  | "reserved"
  | "unique_local"
  | "site_local"
  | "translation_prefix"
  | "not_global_unicast";

/**
 * Reasons a person may be told verbatim.
 *
 * Everything else collapses into one message, because "this name resolves to a
 * private address" is an oracle: repeated against a list of names it maps the
 * network the bot runs in. The reasons below are the ones the person could have
 * worked out from their own URL without asking us, so saying them adds nothing.
 */
const PUBLICLY_EXPLAINABLE: ReadonlySet<SsrfDenyReason> = new Set<SsrfDenyReason>([
  "url_invalid",
  "url_too_long",
  "scheme_not_allowed",
  "credentials_in_url",
  "port_not_allowed",
  "hostname_invalid",
  "internal_name",
]);

const GENERIC_DENY_MESSAGE =
  "Этот адрес наблюдать нельзя: он не ведёт в публичную сеть.";

const EXPLAINED: Partial<Record<SsrfDenyReason, string>> = {
  url_invalid: "Это не похоже на адрес. Нужен полный URL, например https://example.com/status.",
  url_too_long: "Адрес слишком длинный.",
  scheme_not_allowed: "Наблюдать можно только http и https.",
  credentials_in_url: "Уберите логин и пароль из адреса.",
  port_not_allowed: "Этот порт наблюдать нельзя.",
  hostname_invalid: "В адресе нет имени хоста.",
  internal_name: "Это имя ведёт во внутреннюю сеть, а не в публичную.",
};

export class SsrfError extends Error {
  readonly reason: SsrfDenyReason;
  /** The hostname or address that caused it. Never a full URL — a URL carries a query. */
  readonly target: string;

  constructor(reason: SsrfDenyReason, target: string) {
    super(`ssrf_denied:${reason}`);
    this.name = "SsrfError";
    this.reason = reason;
    this.target = target;
  }

  /** What a person is allowed to be told. See PUBLICLY_EXPLAINABLE. */
  get publicMessage(): string {
    return PUBLICLY_EXPLAINABLE.has(this.reason)
      ? (EXPLAINED[this.reason] ?? GENERIC_DENY_MESSAGE)
      : GENERIC_DENY_MESSAGE;
  }
}

export const MAX_URL_BYTES = 2_048;
const MAX_DNS_ANSWERS = 32;

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * Ports that are never an HTTP endpoint worth watching, and are frequently a
 * line-oriented service that can be made to act on a well-formed HTTP request.
 *
 * This is belt on top of braces: anything on these ports inside the network is
 * already refused by address. It costs nothing and it closes the case of a
 * genuinely public host that also runs Redis.
 */
const DENIED_PORTS: ReadonlySet<number> = new Set([
  22, 23, 25, 110, 135, 137, 138, 139, 143, 445, 465, 587, 993, 995, 1433, 1521,
  2049, 2375, 2376, 3306, 3389, 5432, 5672, 5984, 6379, 6380, 9092, 9200, 9300,
  11211, 27017, 27018, 50070,
]);

/**
 * Name suffixes that are reserved for something other than the public internet.
 *
 * `.local` is mDNS (RFC 6762), `.home.arpa` is RFC 8375, `.internal` is what
 * every cloud calls its private zone, `.test`/`.example`/`.invalid` are
 * RFC 2606, `.onion` needs Tor and `.alt` is RFC 9476. A name ending in any of
 * them either cannot resolve publicly or resolves only inside somebody's
 * network, and in both cases watching it is not the feature.
 */
const INTERNAL_SUFFIXES: readonly string[] = [
  ".localhost",
  ".localdomain",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".home",
  ".corp",
  ".private",
  ".test",
  ".example",
  ".invalid",
  ".alt",
  ".onion",
  ".svc",
  ".cluster.local",
  ".ec2.internal",
  ".compute.internal",
];

/**
 * Names a cloud hands its instances, which resolve to a metadata service.
 *
 * All of them also resolve to a blocked address, so this list is not what makes
 * them safe — it makes them *refused without a lookup*, which matters because a
 * lookup is itself a signal sent to somebody else's resolver.
 */
const METADATA_NAMES: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata.azure.com",
  "instance-data.ec2.internal",
  "100.100.100.200.metadata.aliyun.com",
]);

type Cidr = readonly [network: string, prefixBits: number, reason: SsrfDenyReason];

/**
 * IPv4, refused.
 *
 * Deliberately a denylist: IPv4 is fully allocated, the special ranges are
 * enumerated by IANA, and an allowlist would be "everything except these"
 * written backwards.
 */
const DENIED_IPV4: readonly Cidr[] = [
  ["0.0.0.0", 8, "unspecified"], // "this network"; 0.0.0.0 itself dials localhost on Linux
  ["10.0.0.0", 8, "private_network"], // RFC 1918
  ["100.64.0.0", 10, "shared_address_space"], // RFC 6598 CGNAT; Alibaba metadata 100.100.100.200 lives here
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link_local"], // RFC 3927; 169.254.169.254 is AWS/GCP/Azure/DO/Oracle metadata
  ["172.16.0.0", 12, "private_network"], // RFC 1918
  ["192.0.0.0", 24, "reserved"], // IETF protocol assignments; Oracle metadata 192.0.0.192 lives here
  ["192.0.2.0", 24, "documentation"], // TEST-NET-1
  ["192.88.99.0", 24, "reserved"], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16, "private_network"], // RFC 1918
  ["198.18.0.0", 15, "benchmarking"], // RFC 2544
  ["198.51.100.0", 24, "documentation"], // TEST-NET-2
  ["203.0.113.0", 24, "documentation"], // TEST-NET-3
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"], // includes 255.255.255.255
  // Azure's Instance Metadata wireserver. This one is NOT in any reserved
  // range — it is a routable public address that Azure intercepts inside the
  // VM — so every SSRF list built only from RFC 1918 plus link-local misses it.
  ["168.63.129.16", 32, "cloud_metadata"],
];

/**
 * IPv6, refused.
 *
 * `::/96` covers both `::` and `::1`, so loopback and unspecified come from one
 * entry. IPv4-mapped (`::ffff:0:0/96`) is absent on purpose: it is unwrapped to
 * its IPv4 address before this table is consulted, so `::ffff:127.0.0.1` is
 * refused as loopback rather than as "some IPv6 thing", and
 * `::ffff:93.184.216.34` is allowed. `webhookSecurity.ts` blocks the whole /96
 * instead; that is the one place this module deliberately differs, and it
 * differs towards being more precise rather than more permissive.
 */
const DENIED_IPV6: readonly Cidr[] = [
  ["::", 96, "loopback"], // ::1 and ::, plus the deprecated IPv4-compatible space
  ["64:ff9b::", 96, "translation_prefix"], // NAT64 well-known; embeds an IPv4 address
  ["64:ff9b:1::", 48, "translation_prefix"], // NAT64 local-use
  ["100::", 64, "reserved"], // discard-only
  ["2001::", 23, "reserved"], // IETF protocol assignments, incl. Teredo 2001::/32
  ["2001:db8::", 32, "documentation"],
  ["2002::", 16, "translation_prefix"], // 6to4; embeds an IPv4 address in the next 32 bits
  ["3fff::", 20, "documentation"], // RFC 9637
  ["fc00::", 7, "unique_local"], // the IPv6 RFC 1918
  ["fe80::", 10, "link_local"], // required by §20 by name
  ["fec0::", 10, "site_local"], // deprecated, still configured in places
  ["ff00::", 8, "multicast"],
];

/**
 * IPv6 global unicast, allowed.
 *
 * IPv6 is mostly unallocated, so the denylist above cannot be the whole story:
 * an address in space IANA has not handed out is not a public host, and a
 * denylist would let it through. Carried over from `webhookSecurity.ts`
 * (reviewed there 2026-08-31) precisely so the two do not drift.
 */
const GLOBAL_UNICAST_IPV6: readonly (readonly [string, number])[] = [
  ["2001:200::", 23],
  ["2001:400::", 23],
  ["2001:600::", 23],
  ["2001:800::", 22],
  ["2001:c00::", 23],
  ["2001:e00::", 23],
  ["2001:1200::", 23],
  ["2001:1400::", 22],
  ["2001:1800::", 23],
  ["2001:1a00::", 23],
  ["2001:1c00::", 22],
  ["2001:2000::", 19],
  ["2001:4000::", 23],
  ["2001:4200::", 23],
  ["2001:4400::", 23],
  ["2001:4600::", 23],
  ["2001:4800::", 23],
  ["2001:4a00::", 23],
  ["2001:4c00::", 23],
  ["2001:5000::", 20],
  ["2001:8000::", 19],
  ["2001:a000::", 20],
  ["2001:b000::", 20],
  ["2003::", 18],
  ["2400::", 11],
  ["2600::", 12],
  ["2610::", 23],
  ["2620::", 23],
  ["2630::", 12],
  ["2800::", 12],
  ["2a00::", 11],
  ["2c00::", 12],
];

// ---------------------------------------------------------------------------
// Addresses, as bytes
// ---------------------------------------------------------------------------

/**
 * Four octets, or null.
 *
 * Strict on purpose. `isIP` has already agreed this is an IPv4 address by the
 * time we get here, and a second parser that agrees is how we notice if it ever
 * does not — see `addressBytes`, which fails closed on disagreement.
 */
function ipv4Bytes(address: string): Uint8Array | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    const part = parts[index];
    if (part === undefined || part.length === 0 || part.length > 3) return null;
    for (const character of part) {
      if (character < "0" || character > "9") return null;
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    out[index] = value;
  }
  return out;
}

/** Sixteen octets, or null. Handles "::" compression and a trailing dotted quad. */
function ipv6Bytes(address: string): Uint8Array | null {
  // A zone id cannot reach here (the URL parser refuses one), but a resolver
  // may hand one back, and "fe80::1%eth0" must not be parsed as "fe80::1".
  if (address.includes("%")) return null;

  const doubleColonAt = address.indexOf("::");
  if (doubleColonAt !== address.lastIndexOf("::")) return null;

  const head = doubleColonAt === -1 ? address : address.slice(0, doubleColonAt);
  const tail = doubleColonAt === -1 ? "" : address.slice(doubleColonAt + 2);

  const expand = (section: string): number[] | null => {
    if (section.length === 0) return [];
    const groups: number[] = [];
    const pieces = section.split(":");
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      if (piece === undefined) return null;
      if (piece.includes(".")) {
        // An embedded IPv4, only ever in the last position.
        if (index !== pieces.length - 1) return null;
        const quad = ipv4Bytes(piece);
        if (!quad) return null;
        groups.push((quad[0] as number) * 256 + (quad[1] as number));
        groups.push((quad[2] as number) * 256 + (quad[3] as number));
        continue;
      }
      if (piece.length === 0 || piece.length > 4) return null;
      let value = 0;
      for (const character of piece) {
        // parseInt on a single character is NaN for anything that is not a hex
        // digit, which includes a sign, a space and a fullwidth digit.
        const digit = Number.parseInt(character, 16);
        if (!Number.isInteger(digit)) return null;
        value = value * 16 + digit;
      }
      groups.push(value);
    }
    return groups;
  };

  const headGroups = expand(head);
  const tailGroups = expand(tail);
  if (!headGroups || !tailGroups) return null;

  let groups: number[];
  if (doubleColonAt === -1) {
    if (headGroups.length !== 8) return null;
    groups = headGroups;
  } else {
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 1) return null;
    groups = [...headGroups, ...new Array<number>(missing).fill(0), ...tailGroups];
  }
  if (groups.length !== 8) return null;

  const out = new Uint8Array(16);
  for (let index = 0; index < 8; index += 1) {
    const group = groups[index] as number;
    out[index * 2] = (group >> 8) & 0xff;
    out[index * 2 + 1] = group & 0xff;
  }
  return out;
}

/** True when the 16 bytes are `::ffff:a.b.c.d`. */
function isMappedIpv4(bytes: Uint8Array): boolean {
  for (let index = 0; index < 10; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

function withinPrefix(address: Uint8Array, network: Uint8Array, prefixBits: number): boolean {
  const wholeBytes = prefixBits >> 3;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (address[index] !== network[index]) return false;
  }
  const remainingBits = prefixBits & 7;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return ((address[wholeBytes] as number) & mask) === ((network[wholeBytes] as number) & mask);
}

/**
 * Bytes for an address, with the family we were told, or null.
 *
 * Null means "refuse". The two parsers must agree with `isIP`; a disagreement
 * is not something to reason about at runtime, it is something to fail on.
 */
function addressBytes(address: string, family: IpFamily): Uint8Array | null {
  const detected = isIP(address);
  if (detected !== family) return null;
  return family === 4 ? ipv4Bytes(address) : ipv6Bytes(address);
}

/**
 * Why this address may not be dialled, or null if it may.
 *
 * The one function every other decision in this module reduces to.
 */
export function classifyAddress(address: string, family?: IpFamily): SsrfDenyReason | null {
  const detected = isIP(address);
  if (detected !== 4 && detected !== 6) return "address_invalid";
  if (family !== undefined && family !== detected) return "address_invalid";

  let bytes = addressBytes(address, detected);
  if (!bytes) return "address_invalid";

  let effectiveFamily: IpFamily = detected;
  if (detected === 6 && isMappedIpv4(bytes)) {
    // `::ffff:127.0.0.1` is 127.0.0.1 wearing a hat. Judge it as the IPv4
    // address it is, so the reason is "loopback" and not "some IPv6 thing",
    // and so a mapped *public* address is still allowed.
    bytes = bytes.slice(12);
    effectiveFamily = 4;
  }

  if (effectiveFamily === 4) {
    for (const [network, prefixBits, reason] of DENIED_IPV4) {
      const networkBytes = ipv4Bytes(network);
      if (networkBytes && withinPrefix(bytes, networkBytes, prefixBits)) return reason;
    }
    return null;
  }

  for (const [network, prefixBits, reason] of DENIED_IPV6) {
    const networkBytes = ipv6Bytes(network);
    if (networkBytes && withinPrefix(bytes, networkBytes, prefixBits)) return reason;
  }
  for (const [network, prefixBits] of GLOBAL_UNICAST_IPV6) {
    const networkBytes = ipv6Bytes(network);
    if (networkBytes && withinPrefix(bytes, networkBytes, prefixBits)) return null;
  }
  // Unallocated IPv6 is not a public host. Fail closed.
  return "not_global_unicast";
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * The hostname as a name, with the two decorations the URL parser keeps.
 *
 * Brackets, because `url.hostname` for an IPv6 literal is `[::1]` and `isIP`
 * wants `::1`. And the trailing dot, because `new URL("http://localhost./")`
 * has hostname `localhost.` — a root-anchored name that resolves exactly the
 * same and is not equal to the string `localhost`. Dropping it is the
 * difference between a check and a formality.
 */
export function normalizeHostname(hostname: string): string {
  const unbracketed =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  // Only one trailing dot is meaningful; "a.." is not a name.
  return unbracketed.endsWith(".") ? unbracketed.slice(0, -1) : unbracketed;
}

function internalName(hostname: string): boolean {
  const name = hostname.toLowerCase();
  if (METADATA_NAMES.has(name)) return true;
  // A name with no dot is a single label, and a single label resolves through
  // the host's search domain — `intranet`, `wiki`, `localhost`, `metadata`,
  // `kubernetes`, `wpad`. No public host is reachable by one, so this one rule
  // closes a whole family without naming its members.
  if (!name.includes(".")) return true;
  return INTERNAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export type UrlCheck = {
  url: URL;
  /** Unbracketed, no trailing dot, lowercase as the parser left it. */
  hostname: string;
  /** Set when the host was written as an IP literal; no DNS is needed for it. */
  literal: ResolvedAddress | null;
};

/**
 * Everything decidable about a URL before a lookup.
 *
 * Note what is *not* here: no check that the hostname "looks internal" beyond
 * the reserved suffixes above. A homograph like `lосalhost` (Cyrillic о, с) is
 * punycoded by the URL parser into `xn--lalhost-9ig1a`, which is a different
 * name and is treated as one — it gets resolved and judged by its address, and
 * if it resolves to 127.0.0.1 it is refused there. That is the correct
 * outcome, and it is why the address check, not the name check, is the guard.
 */
export function checkUrl(rawUrl: string): UrlCheck {
  if (rawUrl.length > MAX_URL_BYTES) throw new SsrfError("url_too_long", "");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("url_invalid", "");
  }
  if (Buffer.byteLength(url.href, "utf8") > MAX_URL_BYTES) {
    throw new SsrfError("url_too_long", url.hostname);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfError("scheme_not_allowed", url.hostname);
  }
  // Credentials in a watched URL would be replayed to every redirect target.
  if (url.username.length > 0 || url.password.length > 0) {
    throw new SsrfError("credentials_in_url", url.hostname);
  }

  const hostname = normalizeHostname(url.hostname);
  if (hostname.length === 0) throw new SsrfError("hostname_invalid", "");

  if (url.port.length > 0) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new SsrfError("port_not_allowed", hostname);
    }
    if (DENIED_PORTS.has(port)) throw new SsrfError("port_not_allowed", hostname);
  }

  const family = isIP(hostname);
  if (family === 4 || family === 6) {
    // A literal is judged now and never resolved. Every legacy notation —
    // `0x7f.1`, `2130706433`, `0177.0.0.1`, `127.1` — has already been
    // canonicalised to dotted-quad by the URL parser, which is what makes one
    // check enough; `tests/pocketflow/ssrf.test.mts` pins that rather than
    // assuming it.
    const reason = classifyAddress(hostname, family);
    if (reason) throw new SsrfError(reason, hostname);
    return { url, hostname, literal: { address: hostname, family } };
  }

  if (internalName(hostname)) throw new SsrfError("internal_name", hostname);
  return { url, hostname, literal: null };
}

// ---------------------------------------------------------------------------
// Resolution, and the pin that survives it
// ---------------------------------------------------------------------------

export const systemResolver: DnsResolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer: LookupAddress) => {
    if (answer.family !== 4 && answer.family !== 6) {
      throw new SsrfError("address_invalid", hostname);
    }
    return { address: answer.address, family: answer.family };
  });
};

export type SafeTarget = {
  url: URL;
  hostname: string;
  /** Every answer, all of them checked. The first is the one that will be dialled. */
  addresses: ResolvedAddress[];
};

/**
 * A URL that may be dialled, and the exact address to dial.
 *
 * **Every** answer is checked, not only the one we will use. A resolver that
 * returns `[93.184.216.34, 127.0.0.1]` is a resolver under somebody's control,
 * and which of the two a later socket picks is not a thing worth betting on.
 */
export async function resolveSafeTarget(
  rawUrl: string,
  options?: { resolver?: DnsResolver },
): Promise<SafeTarget> {
  const checked = checkUrl(rawUrl);
  if (checked.literal) {
    return { url: checked.url, hostname: checked.hostname, addresses: [checked.literal] };
  }

  const resolver = options?.resolver ?? systemResolver;
  let answers: readonly ResolvedAddress[];
  try {
    answers = await resolver(checked.hostname);
  } catch (error) {
    if (error instanceof SsrfError) throw error;
    throw new SsrfError("dns_failed", checked.hostname);
  }
  if (answers.length === 0) throw new SsrfError("dns_no_answer", checked.hostname);
  if (answers.length > MAX_DNS_ANSWERS) {
    throw new SsrfError("dns_too_many_answers", checked.hostname);
  }
  for (const answer of answers) {
    const reason = classifyAddress(answer.address, answer.family);
    if (reason) throw new SsrfError(reason, checked.hostname);
  }

  return {
    url: checked.url,
    hostname: checked.hostname,
    addresses: answers.map((answer) => ({ ...answer })),
  };
}

/**
 * A `lookup` for `http.request` that answers with one already-checked address.
 *
 * This is the answer to DNS rebinding, and it is the same one
 * `createPinnedWebhookLookup` gives in `artifacts/api-server/src/bot/webhookSecurity.ts`.
 * Without it the sequence is: resolve, approve, then hand the *name* to the
 * socket layer, which resolves it a second time — and a TTL of 0 makes those
 * two answers different whenever the name's owner wants them to be. With it
 * there is no second resolution to win.
 *
 * Both callback shapes are honoured because Node calls `lookup` with `all:true`
 * in some paths and without it in others, and a lookup that answers the wrong
 * shape produces an error far away from here.
 *
 * **It does not re-check `selected`, on purpose.** The obvious extra line here
 * — refuse a pinned address that `classifyAddress` rejects — is redundant
 * (every production pin comes from `resolveSafeTarget`, which has already
 * refused it) and it is expensive in a way that is not obvious: it makes the
 * socket path impossible to test, because every address a test can bind a
 * server to is a blocked one. The guarantee is kept where it can be measured
 * instead: `safeFetch` refuses the URL before any hop runs, and `performHop`
 * checks `socketMatchesPin` after the socket connects. Both are pinned by
 * `tests/pocketflow/ssrf.test.mts`.
 */
export function createPinnedLookup(
  selected: ResolvedAddress,
): NonNullable<RequestOptions["lookup"]> {
  return ((_hostname, options, callback) => {
    if (typeof options === "object" && options !== null && options.all === true) {
      (
        callback as (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void
      )(null, [{ address: selected.address, family: selected.family }]);
      return;
    }
    (
      callback as (
        error: NodeJS.ErrnoException | null,
        address: string,
        family: number,
      ) => void
    )(null, selected.address, selected.family);
  }) as NonNullable<RequestOptions["lookup"]>;
}

/**
 * True when a socket that claims to have connected to `expected` really did.
 *
 * The pin above is the defence; this is the receipt. `socket.remoteAddress` is
 * reported by the kernel rather than by anything we passed in, so a redirect
 * handled by a layer that ignored our `lookup`, or an agent that reused a
 * pooled socket to a different host, shows up here as a mismatch.
 */
export function socketMatchesPin(
  remoteAddress: string | undefined,
  expected: ResolvedAddress,
): boolean {
  if (!remoteAddress) return false;
  const remote = addressBytes(remoteAddress, isIP(remoteAddress) === 4 ? 4 : 6);
  const pinned = addressBytes(expected.address, expected.family);
  if (!remote || !pinned) return false;
  // A v4 pin answered by a v4-mapped socket address is the same host. Node
  // reports `::ffff:1.2.3.4` when the socket is v6 with a v4 peer.
  const left = remote.length === 16 && isMappedIpv4(remote) ? remote.slice(12) : remote;
  const right = pinned.length === 16 && isMappedIpv4(pinned) ? pinned.slice(12) : pinned;
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}
