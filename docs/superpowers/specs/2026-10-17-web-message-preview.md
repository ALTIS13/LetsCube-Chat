# Web message preview DB/client contract

2026-10-17. Owner: DB sidecar. Stage: API fixed, SQL/tests in progress. Source-only; no live apply or iPhone acceptance. Same planned release as Android readable previews; Android/native and topic implementations unchanged.

## Stable RPC ABI

PostgREST RPCs return `TABLE`: JSON array, exactly one row on success, `[]` on unavailable/refused lookup/context. No arbitrary Map root. Names below are final for client preparation.

- `web_message_preview_context(p_subscription_id uuid)` authenticated only. Returns own current context, including durable revision even when retired; not display authority.
- `web_message_preview_enroll(p_subscription_id uuid, p_expected_revision bigint, p_subscription_fingerprint text, p_preview_level text, p_grant_hash text, p_ttl_seconds integer DEFAULT 2592000)` authenticated only. `p_grant_hash` is exactly 64 lowercase hex: SHA-256 of UTF-8 canonical `grant_secret`, NOT of the unencoded random bytes. Only this hash is sent during authenticated enrollment; no secret reaches that RPC or its response. Explicit installation consent: level must be `sender|message` and match current account preference. Requires exact current descriptor fingerprint and live authenticated session. Initial revision is 0; success increments it. Max TTL 30 days, capped by live session `not_after`. Foreground authenticated caller only; DB cannot observe page visibility. Renewal is a fresh secret/enroll/CAS/rotation, never anonymous. CAS/stale/invalid requests raise fixed errors without input values; no automatic retry/adoption after unknown ACK.
- `web_message_preview_revoke(p_subscription_id uuid, p_expected_revision bigint)` authenticated only. Own subscription, CAS; retires grant and increments revision. Returns retired context; no secret. Missing initial context at revision 0 creates a retired revision 1 so a held initial enroll cannot win afterward.
- `web_message_preview_content(p_grant_secret text, p_notification_id uuid)` callable by `anon` only, using the public API key, not a user JWT/service key. Grant plus selector are the only inputs. Malformed, stale, foreign or ineligible requests return `[]`; no content in errors.

Common context row has exactly 10 keys:

```ts
type WebPreviewContext = {
  preview_v: 1;
  recipient_id: string; session_id: string; subscription_id: string;
  subscription_fingerprint: string; // v1:<64 lowercase hex>; server-derived
  revision: number; // safe integer 0..9007199254740991
  preview_level: "none" | "sender" | "message";
  installation_consent: boolean;
  observed_at_epoch_ms: number; // server clock, safe integer
  expires_at_epoch_ms: number | null;
};
// Context, enroll and revoke all return exactly these same 10 keys.
// Browser CSPRNG: crypto.getRandomValues(new Uint8Array(32)), lowercase hex.
// grant_secret = "wpg1_" + that 64-character hex (256 random bits).
```

Context reports `none/false/null` unless the grant is currently usable by this exact auth session/descriptor/account choice. The row's revision still reflects the latest durable context. No RPC returns a stored secret/hash. Revoke returns the same 10-key retired row. `grant_secret` lives only in worker-private durable context; never push payload, URL, argv, logs, notification data, localStorage, or a client bundle. No refresh token mirror is required by this API. Anonymous content lookup necessarily receives the secret over fixed HTTPS POST to prove possession; request/error/body logging is forbidden.

Worker-private storage envelope (not a UI DTO): `{storage_v:1, context:WebPreviewContext, grant_secret:string}`. Store only after exact matching enroll ACK and durable readback; no plaintext content cache. Add caller-local monotonic owner/retirement intent generation outside this server DTO, never send it as server authority. Before/after every await, require the same owner/session/subscription/revision and live local intent. On unknown enroll ACK retire local admission; fresh authenticated context/CAS rotation, not automatic reuse of the unacknowledged secret.

Content row has exactly 15 keys:

```ts
type WebPreviewContent = {
  preview_v: 1;
  recipient_id: string; session_id: string; subscription_id: string;
  subscription_fingerprint: string; revision: number;
  notification_id: string; chat_id: string; message_id: string;
  preview_level: "sender" | "message";
  sender_name: string; title: string; body: string;
  observed_at_epoch_ms: number; expires_at_epoch_ms: number;
};
```

Sender/title max 96 characters, body max 240, whitespace/control characters collapsed, no raw provider text/media URL. `sender` body is `Новое сообщение`; `message` uses current text or safe media-kind label. Response expiry is the minimum of current grant/session expiry and server-now + 15 seconds. UUIDs/fingerprint/revision/level must exactly match the worker's current enrolled context and selected notification. Client uses bounded elapsed time plus server lifetime; rollback/expiry/retirement fail closed, not a claimed OS compare-and-swap.

Proposed provider selector for coordinator-owned wiring: `web_preview: {preview_v: 1, subscription_id: UUID, notification_id: UUID}`. It contains no authority or secret. Current generic declarative fallback stays generic. Worker publishes once after bounded content lookup/current-context recheck, otherwise generic; no late rich upgrade. DB requires an actual single-Web outbox association or exact eligible album membership/delivery for that subscription. No native device impersonation.

## Server invariants / implementation boundary

- Only a hash is persisted for the grant; tuple/revision/installation consent/expiry and exact descriptor are server-owned. At most one context per subscription. The browser alone owns its freshly generated secret; DB cannot attest client RNG quality. An unknown enroll ACK is not permission: read context, explicitly revoke/rotate with a fresh secret under fresh auth when safe.
- Existing `notification_preview_preferences` remains the account ceiling, not implicit browser consent. Level change/delete revokes existing browser grants and advances revisions; restoring the old level cannot revive them. Subscription descriptor/owner/active-state change similarly retires grants. Privacy revocation remains possible at the maximum revision, but further enroll is refused.
- Every content lookup checks current auth session existence/owner/expiry, subscription descriptor/active owner, explicit matching consent, current unread notification and actual message, real visibility and current push/topic server gates. No supplied sender/body/URL is accepted.
- New tables are private, RLS enabled, no direct anon/authenticated/service_role access. Fixed-search-path security-definer public wrappers have exact role ACLs and bounded inputs. Proposal/rollback raise on prestate/selfcheck drift; rollback retires grants and disables enrollment/content rather than reviving old permissions.

## Checkpoint

Owner changed the provisional server-issued-secret ABI to client-generated/hash-enroll before client integration: enroll signature now has `p_grant_hash`, no secret response, common DTO remains exactly 10 keys; content unchanged. Next: finish real SQL owned-fixture verification and omission controls. No production/clone SQL, provider calls, shared source edits, or commits. Client/module work may target this ABI now; lifecycle/worker storage and physical iPhone proof remain separate same-release work.
