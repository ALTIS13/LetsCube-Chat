# Ordinary member contacts and channel QA (2026-09-27)

Owner: web/backend and Windows shared-web client. The iOS Home Screen client has
a separate owner. Android is on hold at the owner's request; its embedded web
bundle does not receive a web deploy. A063 is not needed for this stage.

## Current stage

Web source commit `050cdda9` reached the sole healthy Coolify web container
`050cdda924836176da8a0d8181bd8902e2a8f645`; the prior replica retired.
The public HTML selected `/assets/index-Of1HcE04.js`, which contains the new
contact, channel and edit-feedback markers. A retained older entry returned
200 without the new contact/edit markers. A subsequent documentation-only
commit may rebuild the same web source and needs its own image check.

## Changes and evidence

- A private `user_contacts` relation supports aliases and contacts independent
  of chat membership. A verified full server backup preceded a transaction
  rehearsal, raising self-check, production apply, and owner/other-user RLS
  smoke with rollback. The migration and `.migration-backup` copy are byte-identical.
- Contacts have a separate mobile/desktop destination with search, add, alias,
  delete confirmation and an error/retry state. A synthetic ordinary-user
  journey covers alias propagation to the chat list/header, removal without
  deleting the conversation, `@username` lookup and reload persistence.
- Text channels in a non-forum group are now discoverable and scoped for
  ordinary participants. A delayed topics read cannot briefly mix another
  channel into General. Archiving the last text channel does not expose its
  retained messages there. A refused channel/category read is visible, not an
  empty success. The group setting says "forum mode" rather than implying
  channels are disabled.
- Account-switch races in profile, chat list, summaries and shared-media/links
  pages reject stale reads. Loaded chats and selection clear atomically on an
  established account change; initial profile arrival retains a pending
  message deep link. A private contact alias cannot turn a two-member chat into
  Saved Messages.
- The voice-room create request now includes the chosen seat limit and speaking
  role. A refused message edit preserves the correction and shows an inline
  error; a zero-row update is not reported as success.
- Search commands no longer appear under unrelated advanced filters, and
  profile search normalizes a leading `@` and PostgREST structural punctuation.

## Validation and limits

Typecheck, production-mode web build (`sw.js build 4c4d83a28da2db11`), full
unit and server suites passed. The final synthetic Playwright matrix passed
181 tests, with 50 explicit platform skips, across Chromium 1440/390 and
WebKit 390. It covers contacts, channel creation/reading/archive, account
switching, shared-media/link scope, message-edit refusal and the mocked voice
rail. The WebKit reload fixture blocks service workers because its synthetic
backend uses `page.route`; this does not prove installed-PWA reload behavior.
Rendered 1440/390 contact and edit-error states were inspected in both themes.
Live read-only metadata confirms four owner-scoped `user_contacts` policies
with RLS enabled and `topics` SELECT guarded by `is_chat_member`, without an
archive predicate.

No signed-in production screenshot or personal data was captured. The live
authenticated member flow and physical Android client are not claimed by the
local fixture. Phone discovery remains governed by the existing verified-phone
privacy gate; the contact list does not expose phone numbers.

Next action: verify the docs-only follow-up deployment reached its intended
image without changing the web behavior. An authenticated ordinary-member
production UI pass is still separate from fixture evidence. The current
Android APK embeds an older web bundle and was not rebuilt here. Continue
D-208 media privacy separately; do not make the bucket private while the
older Android bundle remains in circulation.
