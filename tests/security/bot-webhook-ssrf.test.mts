import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import {
  createServer as createHttpsServer,
  request as httpsRequest,
  type RequestOptions,
} from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  decryptWebhookSecret,
  deliverWebhook,
  encryptWebhookSecret,
  requestPinnedWebhook,
  resolveWebhookEncryptionKey,
  validateWebhookTarget,
  type WebhookResolver,
} from "../../artifacts/api-server/src/bot/webhookSecurity.ts";

const publicResolver: WebhookResolver = async () => [
  { address: "93.184.216.34", family: 4 },
  { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
];
const TEST_WEBHOOK_SECRET = randomBytes(24).toString("base64url");

test("webhook URL policy rejects non-HTTPS, credentials, fragments, and every IP literal form", async () => {
  for (const url of [
    "http://hooks.example.test/path",
    "https://user:pass@hooks.example.test/path",
    "https://hooks.example.test/path#fragment",
    "https://127.0.0.1/path",
    "https://2130706433/path",
    "https://0177.0.0.1/path",
    "https://0x7f000001/path",
    "https://[::1]/path",
    "https://[::ffff:127.0.0.1]/path",
  ]) {
    await assert.rejects(validateWebhookTarget(url, publicResolver), {
      message: "webhook_target_invalid",
    });
  }
});

test("webhook DNS policy rejects empty, mixed, and special IPv4 answers", async () => {
  const blocked = [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
  ];
  for (const address of blocked) {
    await assert.rejects(
      validateWebhookTarget("https://hooks.example.test/path", async () => [
        { address, family: 4 },
      ]),
      { message: "webhook_target_blocked" },
    );
  }
  await assert.rejects(
    validateWebhookTarget("https://hooks.example.test/path", async () => []),
    { message: "webhook_dns_invalid" },
  );
  await assert.rejects(
    validateWebhookTarget("https://hooks.example.test/path", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
    { message: "webhook_target_blocked" },
  );
});

test("webhook DNS policy rejects special IPv6 and transition answers", async () => {
  for (const address of [
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "100::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
  ]) {
    await assert.rejects(
      validateWebhookTarget("https://hooks.example.test/path", async () => [
        { address, family: 6 },
      ]),
      { message: "webhook_target_blocked" },
    );
  }
});

test("normal public HTTPS target preserves canonical hostname and all answers", async () => {
  const target = await validateWebhookTarget(
    "https://Hooks.Example.Test:443/a/../hook?kind=message",
    publicResolver,
  );
  assert.equal(target.url.href, "https://hooks.example.test/hook?kind=message");
  assert.equal(target.hostname, "hooks.example.test");
  assert.deepEqual(target.addresses, [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ]);
});

test("AES-256-GCM secret handling requires a canonical 32-byte key and rejects tampering", () => {
  const encodedKey = randomBytes(32).toString("base64url");
  const key = resolveWebhookEncryptionKey({
    BOT_WEBHOOK_ENCRYPTION_KEY: encodedKey,
  });
  const encrypted = encryptWebhookSecret(TEST_WEBHOOK_SECRET, key);
  assert.match(encrypted.ciphertext, /^enc:v1:[A-Za-z0-9_-]+$/);
  assert.match(encrypted.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(decryptWebhookSecret(encrypted.ciphertext, key), TEST_WEBHOOK_SECRET);
  const suffix = encrypted.ciphertext.endsWith("A") ? "B" : "A";
  assert.throws(() => decryptWebhookSecret(encrypted.ciphertext.slice(0, -1) + suffix, key), {
    message: "webhook_secret_invalid",
  });
  assert.throws(() => resolveWebhookEncryptionKey({ BOT_WEBHOOK_ENCRYPTION_KEY: "short" }), {
    message: "bot_gateway_config_invalid",
  });
});

test("delivery re-resolves every same-origin redirect and rejects private rebinding before transport", async () => {
  let resolveCount = 0;
  let transportCount = 0;
  const result = await deliverWebhook({
    url: "https://hooks.example.test/start",
    payload: { update_id: 7, message: { id: "bounded" } },
    secret: TEST_WEBHOOK_SECRET,
    resolver: async () => {
      resolveCount += 1;
      return resolveCount === 1
        ? [{ address: "93.184.216.34", family: 4 as const }]
        : [{ address: "127.0.0.1", family: 4 as const }];
    },
    transport: async () => {
      transportCount += 1;
      return {
        statusCode: 302,
        location: "/next",
      };
    },
  });
  assert.deepEqual(result, {
    kind: "dead_letter",
    errorCode: "redirect_target_invalid",
    httpStatus: 302,
  });
  assert.equal(resolveCount, 2);
  assert.equal(transportCount, 1);
});

test("delivery follows at most two same-origin redirects and never follows cross-origin", async () => {
  const visited: string[] = [];
  const sameOrigin = await deliverWebhook({
    url: "https://hooks.example.test/start",
    payload: { update_id: 8 },
    secret: TEST_WEBHOOK_SECRET,
    resolver: publicResolver,
    transport: async ({ target }) => {
      visited.push(target.url.pathname);
      if (target.url.pathname === "/start") {
        return { statusCode: 307, location: "/middle" };
      }
      if (target.url.pathname === "/middle") {
        return { statusCode: 308, location: "/finish" };
      }
      return { statusCode: 204 };
    },
  });
  assert.deepEqual(sameOrigin, {
    kind: "delivered",
    errorCode: null,
    httpStatus: 204,
  });
  assert.deepEqual(visited, ["/start", "/middle", "/finish"]);

  const crossOrigin = await deliverWebhook({
    url: "https://hooks.example.test/start",
    payload: { update_id: 9 },
    secret: TEST_WEBHOOK_SECRET,
    resolver: publicResolver,
    transport: async () => ({
      statusCode: 302,
      location: "https://other.example.test/hook",
    }),
  });
  assert.deepEqual(crossOrigin, {
    kind: "dead_letter",
    errorCode: "redirect_origin_invalid",
    httpStatus: 302,
  });
});

test("delivery classification retries only transient HTTP and network failures", async () => {
  for (const statusCode of [408, 409, 425, 429, 500, 503]) {
    const result = await deliverWebhook({
      url: "https://hooks.example.test/hook",
      payload: { update_id: statusCode },
      secret: TEST_WEBHOOK_SECRET,
      resolver: publicResolver,
      transport: async () => ({ statusCode }),
    });
    assert.equal(result.kind, "retry");
    assert.equal(result.httpStatus, statusCode);
  }
  const permanent = await deliverWebhook({
    url: "https://hooks.example.test/hook",
    payload: { update_id: 400 },
    secret: TEST_WEBHOOK_SECRET,
    resolver: publicResolver,
    transport: async () => ({ statusCode: 400 }),
  });
  assert.deepEqual(permanent, {
    kind: "dead_letter",
    errorCode: "http_client_error",
    httpStatus: 400,
  });
});

test("pinned HTTPS transport preserves TLS hostname and bounds timeout and chunked responses", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "letscube-webhook-tls-"));
  const keyPath = path.join(directory, "key.pem");
  const certPath = path.join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=hooks.example.test",
      "-addext",
      "subjectAltName=DNS:hooks.example.test",
    ],
    { stdio: "ignore" },
  );
  const certificate = readFileSync(certPath);
  const observedSecrets: string[] = [];
  const server = createHttpsServer(
    { key: readFileSync(keyPath), cert: certificate },
    (request, response) => {
      const secret = request.headers["x-letscube-bot-webhook-secret"];
      if (typeof secret === "string") observedSecrets.push(secret);
      if (request.url === "/timeout") return;
      if (request.url === "/large") {
        response.writeHead(200);
        response.write(Buffer.alloc(129, 1));
        response.end();
        return;
      }
      response.writeHead(204);
      response.end();
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const localRequest: typeof httpsRequest = ((
    originalUrl: URL,
    options: RequestOptions,
    callback: Parameters<typeof httpsRequest>[2],
  ) => {
    assert.equal(options.servername, originalUrl.hostname);
    assert.equal(typeof options.lookup, "function");
    options.lookup?.("hooks.example.test", {}, (error, pinned, family) => {
      assert.ifError(error);
      assert.equal(pinned, "93.184.216.34");
      assert.equal(family, 4);
    });
    return httpsRequest(
      new URL(`https://127.0.0.1:${address.port}${originalUrl.pathname}`),
      {
        ...options,
        lookup: (_hostname, _lookupOptions, done) => done(null, "127.0.0.1", 4),
      },
      callback,
    );
  }) as typeof httpsRequest;
  const target = {
    url: new URL("https://hooks.example.test/ok"),
    hostname: "hooks.example.test",
    addresses: [{ address: "93.184.216.34", family: 4 as const }],
  };
  const secret = randomBytes(24).toString("base64url");

  assert.deepEqual(
    await requestPinnedWebhook({
      target,
      body: Buffer.from("{}"),
      secret,
      tls: { ca: certificate },
      request: localRequest,
    }),
    { statusCode: 204 },
  );
  assert.deepEqual(observedSecrets, [secret]);

  await assert.rejects(
    requestPinnedWebhook({
      target: { ...target, url: new URL("https://hooks.example.test/timeout") },
      body: Buffer.from("{}"),
      secret,
      timeoutMs: 50,
      tls: { ca: certificate },
      request: localRequest,
    }),
    { message: "webhook_timeout" },
  );
  await assert.rejects(
    requestPinnedWebhook({
      target: { ...target, url: new URL("https://hooks.example.test/large") },
      body: Buffer.from("{}"),
      secret,
      maxResponseBytes: 128,
      tls: { ca: certificate },
      request: localRequest,
    }),
    { message: "response_too_large" },
  );
  await assert.rejects(
    requestPinnedWebhook({
      target: {
        ...target,
        url: new URL("https://other.example.test/ok"),
        hostname: "other.example.test",
      },
      body: Buffer.from("{}"),
      secret,
      tls: { ca: certificate },
      request: localRequest,
    }),
    { message: "tls_error" },
  );
});
