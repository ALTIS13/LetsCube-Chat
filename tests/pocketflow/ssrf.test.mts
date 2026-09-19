import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";

import {
  SsrfError,
  checkUrl,
  classifyAddress,
  createPinnedLookup,
  normalizeHostname,
  resolveSafeTarget,
  socketMatchesPin,
  type DnsResolver,
  type ResolvedAddress,
  type SafeTarget,
} from "../../artifacts/pocketflow/src/lib/ssrf.ts";
import {
  SafeFetchError,
  performHop,
  safeFetch,
  type Hop,
  type HopRequest,
} from "../../artifacts/pocketflow/src/lib/safeFetch.ts";

/**
 * The SSRF guard, measured rather than described.
 *
 * Nothing here opens a socket to anywhere but a server this file starts on
 * 127.0.0.1, and nothing here resolves a name: every DNS answer is supplied by
 * the test. A test that reached 169.254.169.254 to see what happened would be
 * a probe of the machine it ran on, not a test of this code.
 */

const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";

function resolverReturning(...addresses: ResolvedAddress[]): DnsResolver {
  return async () => addresses;
}

const publicResolver = resolverReturning({ address: PUBLIC_V4, family: 4 });

function denialOf(fn: () => unknown): SsrfError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof SsrfError, `expected SsrfError, got ${String(error)}`);
    return error;
  }
  throw new assert.AssertionError({ message: "expected a denial, got none" });
}

async function denialOfAsync(promise: Promise<unknown>): Promise<SsrfError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SsrfError, `expected SsrfError, got ${String(error)}`);
    return error;
  }
  throw new assert.AssertionError({ message: "expected a denial, got none" });
}

// ---------------------------------------------------------------------------
// The allow direction, first, so nothing below can be vacuous
// ---------------------------------------------------------------------------

test("a guard that refuses everything would be useless: these are allowed", async () => {
  // If this test ever goes red because the guard got stricter, every
  // "is refused" assertion in this file stops meaning anything.
  const allowed = [
    PUBLIC_V4,
    "1.1.1.1",
    "8.8.8.8",
    "151.101.1.140",
    // Immediately outside each blocked range, which is where an off-by-one
    // in a CIDR mask would show up.
    "172.15.255.255",
    "172.32.0.0",
    "100.63.255.255",
    "192.169.0.1",
    "11.0.0.1",
    "126.255.255.255",
    "128.0.0.1",
    // IPv4-mapped IPv6 of a public address stays allowed; only the mapping of
    // a blocked address is refused. See the mapped tests below.
    `::ffff:${PUBLIC_V4}`,
    PUBLIC_V6,
    "2a00:1450:4001:80e::200e",
    "2001:4860:4860::8888",
  ];
  for (const address of allowed) {
    assert.equal(classifyAddress(address), null, `${address} must be allowed`);
  }

  const target = await resolveSafeTarget("https://example.com/status", {
    resolver: publicResolver,
  });
  assert.equal(target.hostname, "example.com");
  assert.equal(target.addresses[0]?.address, PUBLIC_V4);

  // And a whole fetch of a public URL succeeds, with a fake hop so no socket
  // is opened. This is the shape the watcher uses.
  const hop: Hop = async () => ({
    status: 200,
    headers: {},
    body: Buffer.from("ok"),
    truncated: false,
    remoteAddress: PUBLIC_V4,
  });
  const result = await safeFetch("https://example.com/status", {
    resolver: publicResolver,
    hop,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.toString("utf8"), "ok");
});

// ---------------------------------------------------------------------------
// What is refused, and why
// ---------------------------------------------------------------------------

test("every private, reserved and metadata range is refused, with the right reason", () => {
  const expected: readonly (readonly [string, string])[] = [
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "unspecified"],
    ["10.0.0.1", "private_network"],
    ["10.255.255.255", "private_network"],
    ["172.16.0.1", "private_network"],
    ["172.31.255.255", "private_network"],
    ["192.168.0.1", "private_network"],
    ["192.168.255.255", "private_network"],
    ["100.64.0.1", "shared_address_space"],
    // Alibaba Cloud's metadata endpoint. Inside CGNAT, which is why a list
    // built only from RFC 1918 misses it.
    ["100.100.100.200", "shared_address_space"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    // AWS / GCP / Azure / DigitalOcean / Oracle all answer here.
    ["169.254.169.254", "link_local"],
    ["169.254.0.1", "link_local"],
    // Azure's wireserver: a routable public address that is NOT in any
    // reserved range, and is missed by every list built from RFCs alone.
    ["168.63.129.16", "cloud_metadata"],
    // Oracle Cloud's second metadata address, inside IETF protocol assignments.
    ["192.0.0.192", "reserved"],
    ["192.0.2.1", "documentation"],
    ["198.51.100.1", "documentation"],
    ["203.0.113.1", "documentation"],
    ["198.18.0.1", "benchmarking"],
    ["192.88.99.1", "reserved"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "reserved"],
    ["::1", "loopback"],
    ["::", "loopback"],
    ["fe80::1", "link_local"],
    ["fe80::a00:27ff:fe4e:66a1", "link_local"],
    ["febf::1", "link_local"],
    ["fc00::1", "unique_local"],
    ["fd12:3456:789a::1", "unique_local"],
    ["fec0::1", "site_local"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "documentation"],
    ["3fff::1", "documentation"],
    ["100::1", "reserved"],
    ["2001::1", "reserved"],
    // NAT64 and 6to4 both embed an IPv4 address; the whole prefix goes.
    ["64:ff9b::7f00:1", "translation_prefix"],
    ["64:ff9b:1::1", "translation_prefix"],
    ["2002:7f00:1::", "translation_prefix"],
    // IPv6 IANA has not allocated is not a public host. Fail closed.
    ["9999:9999::1", "not_global_unicast"],
    ["4000::1", "not_global_unicast"],
  ];
  for (const [address, reason] of expected) {
    assert.equal(classifyAddress(address), reason, `${address}`);
  }
});

test("a malformed address is refused rather than passed through", () => {
  // net.BlockList.check() answers `false` — "not blocked" — for a string that
  // is not an IP at all, so a guard built on it alone fails open on garbage.
  // Every address here is parsed to bytes first.
  for (const address of [
    "",
    "nonsense",
    "127.0.0.1.1",
    "999.1.1.1",
    "127.0.0",
    "0x7f000001",
    "2130706433",
    // A zone id must not be parsed away: "fe80::1%eth0" is not "fe80::1".
    "fe80::1%eth0",
    "::ffff:127.0.0.1%1",
    "::::1",
    "1:2:3:4:5:6:7:8:9",
  ]) {
    assert.equal(classifyAddress(address), "address_invalid", JSON.stringify(address));
  }
  // A family that disagrees with the address is a refusal, not a coercion.
  assert.equal(classifyAddress(PUBLIC_V4, 6), "address_invalid");
  assert.equal(classifyAddress("::1", 4), "address_invalid");
});

// ---------------------------------------------------------------------------
// Notations. Each one pinned, and the parser's part of it proved, not assumed.
// ---------------------------------------------------------------------------

test("legacy IPv4 notations are canonicalised by the URL parser, and then refused", () => {
  // Proved, not assumed: the WHATWG host parser turns every one of these into
  // a dotted quad, which is what makes one address check enough.
  const canonical: readonly (readonly [string, string])[] = [
    ["http://0x7f.1/", "127.0.0.1"],
    ["http://0x7f000001/", "127.0.0.1"],
    ["http://2130706433/", "127.0.0.1"],
    ["http://0177.0.0.1/", "127.0.0.1"],
    ["http://127.1/", "127.0.0.1"],
    ["http://127.0.1/", "127.0.0.1"],
    ["http://0/", "0.0.0.0"],
    ["http://0xa000001/", "10.0.0.1"],
    ["http://2852039166/", "169.254.169.254"],
  ];
  for (const [raw, hostname] of canonical) {
    assert.equal(new URL(raw).hostname, hostname, `URL parser: ${raw}`);
    const denial = denialOf(() => checkUrl(raw));
    assert.ok(
      denial.reason === "loopback" ||
        denial.reason === "unspecified" ||
        denial.reason === "private_network" ||
        denial.reason === "link_local",
      `${raw} -> ${denial.reason}`,
    );
  }
});

test("IPv6 literals: brackets, IPv4-mapped, and the zone id the parser refuses", () => {
  assert.equal(normalizeHostname("[::1]"), "::1");
  assert.equal(denialOf(() => checkUrl("http://[::1]/")).reason, "loopback");

  // The mapped form is normalised to hex by the parser, so a string match on
  // "127.0.0.1" would miss it entirely. The check unwraps it numerically.
  assert.equal(new URL("http://[::ffff:127.0.0.1]/").hostname, "[::ffff:7f00:1]");
  assert.equal(denialOf(() => checkUrl("http://[::ffff:127.0.0.1]/")).reason, "loopback");
  assert.equal(denialOf(() => checkUrl("http://[::ffff:7f00:1]/")).reason, "loopback");
  assert.equal(denialOf(() => checkUrl("http://[0:0:0:0:0:ffff:127.0.0.1]/")).reason, "loopback");
  assert.equal(
    denialOf(() => checkUrl("http://[::ffff:169.254.169.254]/")).reason,
    "link_local",
  );
  // …and the same mapping of a public address is still allowed, or the rule
  // above would just be "refuse anything mapped".
  assert.equal(checkUrl(`http://[::ffff:${PUBLIC_V4}]/`).literal?.family, 6);

  assert.equal(denialOf(() => checkUrl("http://[fe80::1]/")).reason, "link_local");
  // A zone id never reaches the check: the URL parser rejects the URL.
  assert.throws(() => new URL("http://[fe80::1%25eth0]/"));
  assert.equal(denialOf(() => checkUrl("http://[fe80::1%25eth0]/")).reason, "url_invalid");
});

test("a trailing dot is a different string and the same host", () => {
  // The parser keeps it, so `hostname === "localhost"` is not a check.
  assert.equal(new URL("http://localhost./").hostname, "localhost.");
  assert.equal(normalizeHostname("localhost."), "localhost");
  assert.equal(denialOf(() => checkUrl("http://localhost./")).reason, "internal_name");
  assert.equal(denialOf(() => checkUrl("http://LOCALHOST/")).reason, "internal_name");
  assert.equal(
    denialOf(() => checkUrl("http://metadata.google.internal./")).reason,
    "internal_name",
  );
});

test("an IDN homograph is a different name, and the address check is what stops it", async () => {
  // Cyrillic о and с. The parser punycodes it, so it is NOT the string
  // "localhost" and is NOT caught by the name rule — which is correct.
  const homograph = "http://lосalhost.example.com/";
  assert.equal(new URL(homograph).hostname, "xn--lalhost-9ig1a.example.com");
  assert.notEqual(new URL(homograph).hostname, "localhost.example.com");
  // It passes the syntactic check, exactly as any unknown name does…
  assert.equal(checkUrl(homograph).hostname, "xn--lalhost-9ig1a.example.com");
  // …and is refused the moment it says where it points.
  const denial = await denialOfAsync(
    resolveSafeTarget(homograph, {
      resolver: resolverReturning({ address: "127.0.0.1", family: 4 }),
    }),
  );
  assert.equal(denial.reason, "loopback");
  // The deliberate limit, stated: a homograph pointing at a *public* address
  // is allowed. This guard is about where a request goes, not about whether a
  // name is trying to look like another one.
  const allowed = await resolveSafeTarget(homograph, { resolver: publicResolver });
  assert.equal(allowed.addresses[0]?.address, PUBLIC_V4);
});

test("userinfo cannot smuggle a host, and is refused before anything else", () => {
  // `http://example.com@127.0.0.1/` has host 127.0.0.1 and username example.com.
  assert.equal(new URL("http://example.com@127.0.0.1/").hostname, "127.0.0.1");
  assert.equal(new URL("http://example.com@127.0.0.1/").username, "example.com");
  assert.equal(
    denialOf(() => checkUrl("http://example.com@127.0.0.1/")).reason,
    "credentials_in_url",
  );
  assert.equal(
    denialOf(() => checkUrl("https://user:pass@example.com/")).reason,
    "credentials_in_url",
  );
});

test("the syntactic policy: scheme, port, length, dotless names", () => {
  for (const [raw, reason] of [
    ["ftp://example.com/x", "scheme_not_allowed"],
    ["file:///etc/passwd", "scheme_not_allowed"],
    ["gopher://example.com/x", "scheme_not_allowed"],
    ["data:text/plain,hello", "scheme_not_allowed"],
    ["not a url", "url_invalid"],
    ["https://example.com:22/", "port_not_allowed"],
    ["https://example.com:6379/", "port_not_allowed"],
    ["https://example.com:5432/", "port_not_allowed"],
    ["https://example.com:25/", "port_not_allowed"],
    // A single-label name resolves through the host's search domain. No
    // public host is reachable by one, so the whole family goes at once.
    ["http://intranet/", "internal_name"],
    ["http://metadata/", "internal_name"],
    ["http://wpad/", "internal_name"],
    ["http://kubernetes/", "internal_name"],
    ["http://wiki.local/", "internal_name"],
    ["http://db.internal/", "internal_name"],
    ["http://svc.cluster.local/", "internal_name"],
    ["http://box.home.arpa/", "internal_name"],
    ["http://api.corp/", "internal_name"],
    ["http://thing.test/", "internal_name"],
    ["http://thing.example/", "internal_name"],
    ["http://thing.invalid/", "internal_name"],
    ["http://x.onion/", "internal_name"],
    ["http://ip-10-0-0-1.ec2.internal/", "internal_name"],
  ] as const) {
    assert.equal(denialOf(() => checkUrl(raw)).reason, reason, raw);
  }
  assert.equal(denialOf(() => checkUrl(`https://a.example.com/${"x".repeat(4000)}`)).reason, "url_too_long");
  // An ordinary port is fine, or the port rule would be a blanket refusal.
  assert.equal(checkUrl("https://example.com:8443/x").hostname, "example.com");
  assert.equal(checkUrl("http://example.com:8080/x").hostname, "example.com");
});

// ---------------------------------------------------------------------------
// DNS
// ---------------------------------------------------------------------------

test("every answer is judged, not only the one that will be used", async () => {
  // The interesting order: a public answer first, so a guard that checked only
  // `answers[0]` would pass this and then let the socket pick the other one.
  const denial = await denialOfAsync(
    resolveSafeTarget("https://mixed.example.com/", {
      resolver: resolverReturning(
        { address: PUBLIC_V4, family: 4 },
        { address: "127.0.0.1", family: 4 },
      ),
    }),
  );
  assert.equal(denial.reason, "loopback");
  assert.equal(denial.target, "mixed.example.com");
});

test("an unusable DNS answer is a refusal, in each of its shapes", async () => {
  assert.equal(
    (await denialOfAsync(resolveSafeTarget("https://a.example.com/", { resolver: resolverReturning() })))
      .reason,
    "dns_no_answer",
  );
  const many = Array.from({ length: 33 }, () => ({ address: PUBLIC_V4, family: 4 as const }));
  assert.equal(
    (
      await denialOfAsync(
        resolveSafeTarget("https://a.example.com/", { resolver: resolverReturning(...many) }),
      )
    ).reason,
    "dns_too_many_answers",
  );
  assert.equal(
    (
      await denialOfAsync(
        resolveSafeTarget("https://a.example.com/", {
          resolver: async () => {
            throw new Error("ENOTFOUND");
          },
        }),
      )
    ).reason,
    "dns_failed",
  );
  assert.equal(
    (
      await denialOfAsync(
        resolveSafeTarget("https://a.example.com/", {
          resolver: resolverReturning({ address: "not-an-address", family: 4 }),
        }),
      )
    ).reason,
    "address_invalid",
  );
});

test("an IP literal is judged directly and never resolved", async () => {
  let resolverCalls = 0;
  const counting: DnsResolver = async () => {
    resolverCalls += 1;
    return [{ address: PUBLIC_V4, family: 4 }];
  };
  const target = await resolveSafeTarget(`https://${PUBLIC_V4}/x`, { resolver: counting });
  assert.equal(resolverCalls, 0);
  assert.equal(target.addresses[0]?.address, PUBLIC_V4);
});

// ---------------------------------------------------------------------------
// DNS rebinding
// ---------------------------------------------------------------------------

test("the pinned lookup answers with the checked address and never resolves again", async () => {
  // A resolver that tells the truth once and then lies — the shape of a
  // rebinding attack, where the TTL is 0 and the second answer is internal.
  let call = 0;
  const rebinding: DnsResolver = async () => {
    call += 1;
    return call === 1
      ? [{ address: PUBLIC_V4, family: 4 }]
      : [{ address: "169.254.169.254", family: 4 }];
  };

  const target = await resolveSafeTarget("https://rebind.example.com/", { resolver: rebinding });
  assert.equal(target.addresses[0]?.address, PUBLIC_V4);

  // The socket layer is handed this, not the hostname. There is no second
  // resolution for the attacker's second answer to win.
  const lookup = createPinnedLookup(target.addresses[0] as ResolvedAddress);

  const withAll = await new Promise<unknown>((resolve) => {
    (lookup as (h: string, o: unknown, cb: (e: unknown, a: unknown) => void) => void)(
      "rebind.example.com",
      { all: true },
      (_error, addresses) => resolve(addresses),
    );
  });
  assert.deepEqual(withAll, [{ address: PUBLIC_V4, family: 4 }]);

  const single = await new Promise<[unknown, unknown]>((resolve) => {
    (
      lookup as (h: string, o: unknown, cb: (e: unknown, a: unknown, f: unknown) => void) => void
    )("rebind.example.com", {}, (_error, address, family) => resolve([address, family]));
  });
  assert.deepEqual(single, [PUBLIC_V4, 4]);

  // The resolver was consulted exactly once, by resolveSafeTarget. The pin
  // itself never calls it — which is the whole point.
  assert.equal(call, 1);
});

test("socketMatchesPin is the receipt, and it is not a rubber stamp", () => {
  assert.equal(socketMatchesPin(PUBLIC_V4, { address: PUBLIC_V4, family: 4 }), true);
  // Node reports a v4 peer on a v6 socket in mapped form. Same host.
  assert.equal(socketMatchesPin(`::ffff:${PUBLIC_V4}`, { address: PUBLIC_V4, family: 4 }), true);
  assert.equal(socketMatchesPin("127.0.0.1", { address: PUBLIC_V4, family: 4 }), false);
  assert.equal(socketMatchesPin("::1", { address: PUBLIC_V4, family: 4 }), false);
  assert.equal(socketMatchesPin(undefined, { address: PUBLIC_V4, family: 4 }), false);
  assert.equal(socketMatchesPin("nonsense", { address: PUBLIC_V4, family: 4 }), false);
});

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

function redirectingHop(steps: readonly (string | number)[]): {
  hop: Hop;
  seen: HopRequest[];
} {
  const seen: HopRequest[] = [];
  let index = 0;
  const hop: Hop = async (request) => {
    seen.push(request);
    const step = steps[index] ?? 200;
    index += 1;
    if (typeof step === "string") {
      return {
        status: 302,
        headers: { location: step },
        body: Buffer.alloc(0),
        truncated: false,
        remoteAddress: PUBLIC_V4,
      };
    }
    return {
      status: step,
      headers: {},
      body: Buffer.from("final"),
      truncated: false,
      remoteAddress: PUBLIC_V4,
    };
  };
  return { hop, seen };
}

test("every redirect target is re-resolved and re-judged", async () => {
  const resolved: string[] = [];
  const resolver: DnsResolver = async (hostname) => {
    resolved.push(hostname);
    // The first host is public; the one it redirects to is internal. A guard
    // applied only to the URL the person typed would follow this.
    return hostname === "first.example.com"
      ? [{ address: PUBLIC_V4, family: 4 }]
      : [{ address: "10.0.0.5", family: 4 }];
  };
  const { hop, seen } = redirectingHop(["https://second.example.com/next"]);

  const denial = await denialOfAsync(
    safeFetch("https://first.example.com/", { resolver, hop }),
  );
  assert.equal(denial.reason, "private_network");
  assert.equal(denial.target, "second.example.com");
  // Both names were resolved, in order, and only the first hop was dialled.
  assert.deepEqual(resolved, ["first.example.com", "second.example.com"]);
  assert.equal(seen.length, 1);
});

test("a relative redirect is resolved against the hop it came from", async () => {
  const { hop, seen } = redirectingHop(["/moved", 200]);
  const result = await safeFetch("https://first.example.com/a/b", {
    resolver: publicResolver,
    hop,
  });
  assert.equal(result.redirects, 1);
  assert.equal(result.finalUrl, "https://first.example.com/moved");
  assert.equal(seen[1]?.target.url.pathname, "/moved");
});

test("redirects are bounded, and the bound is not off by one", async () => {
  const chain = ["https://a.example.com/1", "https://a.example.com/2", "https://a.example.com/3", 200];
  // Three redirects with maxRedirects 3: allowed.
  const ok = await safeFetch("https://a.example.com/0", {
    resolver: publicResolver,
    hop: redirectingHop(chain).hop,
    maxRedirects: 3,
  });
  assert.equal(ok.redirects, 3);
  assert.equal(ok.status, 200);

  // The same chain with a bound of 2: refused rather than followed.
  await assert.rejects(
    safeFetch("https://a.example.com/0", {
      resolver: publicResolver,
      hop: redirectingHop(chain).hop,
      maxRedirects: 2,
    }),
    (error: unknown) => error instanceof SafeFetchError && error.code === "redirect_limit",
  );

  // A pair of URLs pointing at each other terminates instead of spinning.
  const loop: Hop = async (request) => ({
    status: 301,
    headers: {
      location: request.target.url.pathname === "/a" ? "https://a.example.com/b" : "https://a.example.com/a",
    },
    body: Buffer.alloc(0),
    truncated: false,
    remoteAddress: PUBLIC_V4,
  });
  await assert.rejects(
    safeFetch("https://a.example.com/a", { resolver: publicResolver, hop: loop }),
    (error: unknown) => error instanceof SafeFetchError && error.code === "redirect_limit",
  );
});

test("a 3xx without a location, and an https to http downgrade, are both refused", async () => {
  const noLocation: Hop = async () => ({
    status: 302,
    headers: {},
    body: Buffer.alloc(0),
    truncated: false,
    remoteAddress: PUBLIC_V4,
  });
  await assert.rejects(
    safeFetch("https://a.example.com/", { resolver: publicResolver, hop: noLocation }),
    (error: unknown) => error instanceof SafeFetchError && error.code === "redirect_invalid",
  );

  await assert.rejects(
    safeFetch("https://a.example.com/", {
      resolver: publicResolver,
      hop: redirectingHop(["http://a.example.com/plain"]).hop,
    }),
    (error: unknown) => error instanceof SafeFetchError && error.code === "redirect_downgrade",
  );

  // http -> https is an upgrade and is followed.
  const upgraded = await safeFetch("http://a.example.com/", {
    resolver: publicResolver,
    hop: redirectingHop(["https://a.example.com/secure", 200]).hop,
  });
  assert.equal(upgraded.finalUrl, "https://a.example.com/secure");
});

test("the timeout is a total budget, not a per-hop one", async () => {
  let clock = 1_000;
  const slowHop: Hop = async () => {
    clock += 400;
    return {
      status: 302,
      headers: { location: "https://a.example.com/next" },
      body: Buffer.alloc(0),
      truncated: false,
      remoteAddress: PUBLIC_V4,
    };
  };
  await assert.rejects(
    safeFetch("https://a.example.com/", {
      resolver: publicResolver,
      hop: slowHop,
      now: () => clock,
      timeoutMs: 1_000,
      maxRedirects: 10,
    }),
    (error: unknown) => error instanceof SafeFetchError && error.code === "timeout",
  );
  // Three hops of 400ms against a 1000ms budget: the fourth is refused.
  assert.equal(clock, 1_000 + 400 * 3);
});

test("a blocked URL is refused before a single hop is attempted", async () => {
  let hopCalls = 0;
  const counting: Hop = async () => {
    hopCalls += 1;
    return {
      status: 200,
      headers: {},
      body: Buffer.alloc(0),
      truncated: false,
      remoteAddress: "127.0.0.1",
    };
  };
  for (const url of [
    "http://127.0.0.1:9/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://localhost./",
    "ftp://example.com/",
  ]) {
    await assert.rejects(safeFetch(url, { hop: counting }), (error: unknown) => error instanceof SsrfError);
  }
  assert.equal(hopCalls, 0);
});

// ---------------------------------------------------------------------------
// The socket path, against a server this test owns
// ---------------------------------------------------------------------------

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (target: (path: string) => SafeTarget) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    await run((path) => ({
      // The hostname is a name that does not resolve anywhere. If `lookup`
      // were ignored, this request could not connect at all — which is how
      // this fixture proves the pin is honoured rather than assuming it.
      url: new URL(`http://pinned.invalid:${port}${path}`),
      hostname: "pinned.invalid",
      addresses: [{ address: "127.0.0.1", family: 4 }],
    }));
  } finally {
    server.close();
    await once(server, "close");
  }
}

function hopRequest(target: SafeTarget, overrides?: Partial<HopRequest>): HopRequest {
  return {
    target,
    method: "GET",
    headers: { "user-agent": "pocketflow-test", "accept-encoding": "identity" },
    timeoutMs: 5_000,
    maxBytes: 64 * 1_024,
    onOversize: "error",
    ...overrides,
  };
}

test("performHop honours the pinned address, so an unresolvable name still connects", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("pinned");
    },
    async (target) => {
      const response = await performHop(hopRequest(target("/")));
      assert.equal(response.status, 200);
      assert.equal(response.body.toString("utf8"), "pinned");
      assert.equal(response.headers["content-type"], "text/plain");
      // The receipt: the kernel says we landed on the address we pinned.
      assert.equal(socketMatchesPin(response.remoteAddress ?? undefined, {
        address: "127.0.0.1",
        family: 4,
      }), true);
    },
  );
});

test("the byte cap is enforced on arrival, and both policies do what they say", async () => {
  const big = Buffer.alloc(40_000, 0x61);
  await withServer(
    (_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      // Several writes, so the cap has to hold across chunks rather than
      // against one content-length it could have read up front.
      for (let index = 0; index < 4; index += 1) response.write(big);
      response.end();
    },
    async (target) => {
      await assert.rejects(
        performHop(hopRequest(target("/"), { maxBytes: 10_000, onOversize: "error" })),
        (error: unknown) =>
          error instanceof SafeFetchError && error.code === "response_too_large",
      );

      const truncated = await performHop(
        hopRequest(target("/"), { maxBytes: 10_000, onOversize: "truncate" }),
      );
      assert.equal(truncated.status, 200);
      assert.equal(truncated.truncated, true);
      assert.equal(truncated.body.byteLength, 10_000);

      // …and a body under the cap is not touched, or "truncate" would just
      // mean "always cut".
      const whole = await performHop(
        hopRequest(target("/"), { maxBytes: 1_000_000, onOversize: "truncate" }),
      );
      assert.equal(whole.truncated, false);
      assert.equal(whole.body.byteLength, big.byteLength * 4);
    },
  );
});

test("a host that never answers is abandoned at the timeout", async () => {
  await withServer(
    () => {
      // Never respond. The socket stays open until the timeout fires.
    },
    async (target) => {
      const startedAt = Date.now();
      await assert.rejects(
        performHop(hopRequest(target("/"), { timeoutMs: 250 })),
        (error: unknown) => error instanceof SafeFetchError && error.code === "timeout",
      );
      assert.ok(Date.now() - startedAt < 4_000, "gave up near the deadline");
    },
  );
});

test("the request carries no credential and asks for no compression", async () => {
  const seen: Record<string, string | undefined> = {};
  await withServer(
    (request, response) => {
      Object.assign(seen, request.headers);
      response.writeHead(204);
      response.end();
    },
    async (target) => {
      await performHop(hopRequest(target("/")));
    },
  );
  // A byte cap counted on a gzip stream is not a byte cap.
  assert.equal(seen["accept-encoding"], "identity");
  assert.equal(seen.authorization, undefined);
  assert.equal(seen.cookie, undefined);
});

// ---------------------------------------------------------------------------
// What a person is told
// ---------------------------------------------------------------------------

test("a denial explains only what the person already knew", () => {
  // Derivable from their own URL: say it.
  assert.match(new SsrfError("scheme_not_allowed", "x").publicMessage, /http/);
  assert.match(new SsrfError("internal_name", "x").publicMessage, /внутренн/);
  // Learned only by resolving: one generic answer, the same for all of them,
  // so the bot cannot be used to map the network it runs in.
  const generic = new SsrfError("loopback", "x").publicMessage;
  for (const reason of ["loopback", "private_network", "link_local", "cloud_metadata", "not_global_unicast"] as const) {
    assert.equal(new SsrfError(reason, "x").publicMessage, generic);
  }
  assert.doesNotMatch(generic, /127|10\.|169\.254|loopback|private/);
});
