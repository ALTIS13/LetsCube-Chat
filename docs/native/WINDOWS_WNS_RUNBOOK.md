# Windows WNS Killed-Process Delivery Runbook

The in-app notification row remains the source of truth. Browser Web Push,
Android FCM and Windows WNS are separate delivery providers for the same
semantic notification.

The current Tauri NSIS client is unpackaged. Its Realtime/native toast bridge
works while the process or tray is running, but an unpackaged process cannot
reliably receive Windows push activation after termination. Do not label this
path production-ready until every gate below passes.

## Required Windows identity

Use a Windows package with external location (sparse package identity) so the
existing Tauri executable and NSIS lifecycle can remain in place:

1. Reserve a stable package identity and publisher.
2. Add a signed identity package and matching side-by-side application
   manifest to the Windows release build.
3. Register the identity package during install before the first app launch.
4. Register the required out-of-process/COM push activator according to the
   current Windows App SDK push-notification documentation.
5. Remove the identity registration during uninstall.
6. Verify install, repair, upgrade and uninstall on Windows 10 22H2 and
   Windows 11.

Package identity values are public metadata, but they must be stable. Do not
invent or change them independently of the Microsoft registration.

The repository now has a fail-closed renderer and SDK preflight for this
contract. Follow `docs/native/WINDOWS_PACKAGE_IDENTITY_RUNBOOK.md`; generated
manifests and the unsigned validation package stay under ignored `.local`
storage. The renderer deliberately cannot supply the Microsoft-issued package
name, publisher, application ID, Entra remote ID or PFN. Preflight reports all
missing public metadata in one pass and the generated client contract includes
the expected PFN for a fail-closed runtime identity check.

## Microsoft application registration

1. Create an Entra application for LETSCUBE Windows push.
2. Configure the account type required by Windows App SDK push registration.
3. Map the app's Package Family Name to the Entra application through the
   Microsoft Windows push onboarding process.
4. Wait for Microsoft confirmation before expecting channel acquisition to
   succeed.
5. Keep the client ID and tenant ID as deployment configuration.
6. Keep the client secret only in Supabase Edge Function secrets.

The Edge Function expects these secret names:

```text
WNS_TENANT_ID
WNS_CLIENT_ID
WNS_CLIENT_SECRET
```

It exchanges them for a scoped WNS access token and never returns that token to
the frontend.

## Device schema gap

The existing `user_push_devices` schema supports Android FCM and an APNS
placeholder. A future reviewed migration must:

- allow provider `wns` for platform `windows`;
- accept only authenticated self-registration through an RPC or Edge Function;
- store the WNS channel URI as the private device token;
- deduplicate through a server-generated token hash;
- never return another user's channel URI;
- revoke expired channels after WNS `404` or `410`;
- preserve message/task/system preferences and sender exclusion;
- enqueue Windows rows in `notifications_native_push_outbox`.

No schema change is applied by this stage. Do not reuse browser
`push_subscriptions` for WNS.

## Delivery behavior already prepared

The native dispatcher now isolates providers:

- FCM rows continue through Google OAuth and FCM HTTP v1.
- WNS rows use Microsoft OAuth and only an HTTPS
  `*.notify.windows.com` channel.
- Missing provider credentials leave rows pending without consuming retry
  attempts.
- Invalid channel hosts are rejected before network access.
- Expired WNS channels are revoked without logging their URI.
- Message payloads keep exact internal chat/message routing and one stable chat
  header; tasks stay separate.
- Raw media URLs, access tokens and credentials are excluded.

## Client activation and QA gates

After package identity and PFN mapping exist, implement the Windows App SDK
client registration and COM activation bridge. Registration must:

1. Acquire a WNS channel only in the identified Windows package.
2. Send it through an authenticated server registration path.
3. Refresh it on login/resume and revoke it on logout.
4. Store no raw channel URI in browser local storage or logs.
5. Queue a validated relative route when activation occurs before auth restore.
6. Reuse the current exact chat/message routing and read cleanup.

Required physical scenarios:

- foreground, tray-hidden, terminated process and reboot;
- message grouping by chat with exact card routes;
- task delivery isolated from messages;
- muted chat and disabled device suppression;
- sender receives no self-push;
- route waits for login/session restore;
- malformed payload produces no ErrorBoundary;
- channel expiry and re-registration;
- Windows 10 22H2 and Windows 11.

Until package identity, PFN mapping, schema, client channel registration,
credentials and physical terminated-process QA all pass, Settings must continue
to say that Windows notifications work only while LETSCUBE is running.
