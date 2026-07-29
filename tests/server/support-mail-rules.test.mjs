import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

const rules =
  await import("../../artifacts/api-server/src/workers/supportMailRules.ts").catch(
    () => ({}),
  );
const transport =
  await import(
    "../../artifacts/api-server/src/workers/supportMailTransport.ts"
  ).catch(() => ({}));

function requireRule(name) {
  assert.equal(typeof rules[name], "function", `missing ${name}`);
  return rules[name];
}

test("IMAP socket errors are observed instead of terminating the worker", () => {
  assert.equal(
    typeof transport.observeImapClientErrors,
    "function",
    "missing observeImapClientErrors",
  );
  const client = new EventEmitter();
  transport.observeImapClientErrors(client);

  assert.doesNotThrow(() => {
    client.emit("error", Object.assign(new Error("Socket timeout"), {
      code: "ETIMEOUT",
    }));
  });
});

test("IMAP messages are marked seen only after the fetch iterator completes", async () => {
  assert.equal(
    typeof transport.processSupportInboxFetch,
    "function",
    "missing processSupportInboxFetch",
  );

  class FakeImapClient extends EventEmitter {
    usable = true;
    mailbox = { uidValidity: "42" };
    fetching = false;
    markedSeen = [];

    async connect() {}
    async getMailboxLock() {
      return { release() {} };
    }
    async search() {
      return [7];
    }
    async *fetch() {
      this.fetching = true;
      try {
        yield {
          uid: 7,
          size: 0,
          source: undefined,
          envelope: {
            messageId: "<test@example.test>",
            inReplyTo: null,
            subject: "Test",
            from: [{ name: "QA", address: "qa@example.test" }],
            to: [{ address: "support@app.example.test" }],
          },
        };
      } finally {
        this.fetching = false;
      }
    }
    async messageFlagsAdd(uid) {
      assert.equal(this.fetching, false, "nested IMAP command during fetch");
      this.markedSeen.push(uid);
    }
    async logout() {
      this.usable = false;
    }
    close() {
      this.usable = false;
    }
  }

  const client = new FakeImapClient();
  const processed = await transport.processSupportInboxFetch(
    client,
    [7],
    async () => true,
  );

  assert.equal(processed, 1);
  assert.deepEqual(client.markedSeen, [7]);
});

test("support mail config is fail-closed and does not expose credentials", () => {
  const readConfig = requireRule("readSupportMailConfig");

  assert.deepEqual(readConfig({ SUPPORT_MAIL_ENABLED: "0" }), {
    enabled: false,
  });
  assert.throws(
    () => readConfig({ SUPPORT_MAIL_ENABLED: "1" }),
    /support_mail_config_invalid/,
  );

  const config = readConfig({
    SUPPORT_MAIL_ENABLED: "1",
    SUPABASE_URL: "https://core.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "server-key",
    SUPPORT_MAIL_HOST: "mail.example.test",
    SUPPORT_MAIL_IMAP_PORT: "993",
    SUPPORT_MAIL_SMTP_PORT: "465",
    SUPPORT_MAIL_TLS: "1",
    SUPPORT_MAIL_USER: "support@app.example.test",
    SUPPORT_MAIL_PASSWORD: "private-password",
    SUPPORT_MAIL_FROM: "support@app.example.test",
    SUPPORT_MAIL_FROM_NAME: "LETSCUBE Support",
    SUPPORT_MAIL_TRUSTED_AUTH_SERVER: "mail.example.test",
    SUPPORT_MAIL_HMAC_SECRET: "a".repeat(64),
    SUPPORT_GUEST_SECRET_HMAC_KEY: "c".repeat(64),
    SUPPORT_MAIL_POLL_MS: "30000",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.imap.port, 993);
  assert.equal(config.smtp.secure, true);
  assert.equal(config.trustedAuthServer, "mail.example.test");
  assert.doesNotMatch(
    JSON.stringify(config.publicState),
    /server-key|private-password/,
  );
  assert.throws(
    () =>
      readConfig({
        SUPPORT_MAIL_ENABLED: "1",
        SUPPORT_MAIL_TLS: "0",
      }),
    /support_mail_config_invalid/,
  );
});

test("sender authentication trusts only the local MTA result and aligned domains", () => {
  const senderAuthenticated = requireRule("hasTrustedSenderAuthentication");

  assert.equal(
    senderAuthenticated(
      [
        "mail.example.test; dkim=pass header.d=sender.example; spf=pass smtp.mailfrom=sender.example; dmarc=pass header.from=sender.example",
      ],
      "mail.example.test",
      "person@sender.example",
    ),
    true,
  );
  assert.equal(
    senderAuthenticated(
      [
        "attacker.example; dmarc=pass header.from=sender.example",
        "mail.example.test; dmarc=fail header.from=sender.example",
      ],
      "mail.example.test",
      "person@sender.example",
    ),
    false,
  );
  assert.equal(
    senderAuthenticated(
      ["mail.example.test; dkim=pass header.d=sender.example"],
      "mail.example.test",
      "person@sender.example",
    ),
    true,
  );
  assert.equal(
    senderAuthenticated(
      ["mail.example.test; spf=pass smtp.mailfrom=other.example"],
      "mail.example.test",
      "person@sender.example",
    ),
    false,
  );
});

test("inbound normalization bounds fields and rejects automated loops", () => {
  const normalize = requireRule("normalizeInboundMail");

  const accepted = normalize({
    messageId: " <message-1@example.test> ",
    fromName: "  Анна  ",
    fromAddress: "ANNA@example.test",
    recipientAddress: "support@app.example.test",
    subject: "  Не работает вход  ",
    textBody: "Здравствуйте!\r\n\r\nПомогите войти.\r\n> старая цитата",
    htmlBody: null,
    autoSubmitted: null,
    precedence: null,
    attachmentCount: 0,
  });

  assert.equal(accepted.kind, "accepted");
  assert.equal(accepted.value.fromAddress, "anna@example.test");
  assert.equal(accepted.value.subject, "Не работает вход");
  assert.equal(accepted.value.body, "Здравствуйте!\n\nПомогите войти.");

  const automated = normalize({
    messageId: "<auto@example.test>",
    fromName: "Mailer daemon",
    fromAddress: "daemon@example.test",
    recipientAddress: "support@app.example.test",
    subject: "Automatic reply",
    textBody: "Out of office",
    htmlBody: null,
    autoSubmitted: "auto-replied",
    precedence: "bulk",
    attachmentCount: 0,
  });
  assert.deepEqual(automated, {
    kind: "quarantine",
    code: "automated_message",
  });
});

test("support mail identifiers are deterministic, opaque and bounded", () => {
  const buildReplyAddress = requireRule("buildSupportReplyAddress");
  const buildMessageId = requireRule("buildOutboundMessageId");
  const hashMailValue = requireRule("hashMailValue");
  const hashMessageIdentifier = requireRule("hashMessageIdentifier");

  const ticketId = "11111111-1111-4111-8111-111111111111";
  const outboxId = "22222222-2222-4222-8222-222222222222";
  const secret = "b".repeat(64);

  const address = buildReplyAddress(ticketId, "app.example.test", secret);
  assert.match(address, /^support\+[a-f0-9]{32}@app\.example\.test$/);
  assert.doesNotMatch(address, /11111111/);
  assert.equal(
    address,
    buildReplyAddress(ticketId, "app.example.test", secret),
  );

  const messageId = buildMessageId(outboxId, "app.example.test");
  assert.equal(
    messageId,
    "<support-22222222222242228222222222222222@app.example.test>",
  );
  assert.match(hashMessageIdentifier(messageId), /^[a-f0-9]{64}$/);
  assert.notEqual(
    hashMessageIdentifier(messageId),
    hashMailValue(messageId, secret),
  );
  assert.match(hashMailValue(messageId, secret), /^[a-f0-9]{64}$/);
});

test("error codes and HTML output cannot leak provider payloads", () => {
  const sanitizeErrorCode = requireRule("sanitizeSupportMailErrorCode");
  const render = requireRule("renderSupportReplyEmail");

  assert.equal(sanitizeErrorCode({ code: "ETIMEDOUT" }), "etimedout");
  assert.equal(
    sanitizeErrorCode(new Error("SMTP 535 user@example.test rejected")),
    "unknown",
  );

  const rendered = render({
    publicReference: "LC-2026-ABCDEF123456",
    contactName: "Анна <script>",
    subject: "Проблема <входа>",
    body: "Готово & проверено",
  });
  assert.match(rendered.subject, /LC-2026-ABCDEF123456/);
  assert.match(rendered.html, /Анна &lt;script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/i);
  assert.match(rendered.text, /Готово & проверено/);
});
