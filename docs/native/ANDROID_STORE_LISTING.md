# Android Store Listing

## Listing copy

- App name: LETSCUBE
- Short description: Private messaging for the LETSCUBE community.
- Full description: LETSCUBE is a messenger for conversations, media sharing,
  voice messages, calls, and shared tasks. Sign in to keep in touch with the
  people and groups available to your account.
- Support URL: https://app.letscube.ru/support
- Privacy policy URL: https://app.letscube.ru/privacy

## Permissions

- Camera: selected by the user to capture photos and video for a message.
- Microphone: selected by the user for two different things, and they are
  declared differently below — recording a voice message or a video's audio,
  which produces a file, and joining a voice channel, which transmits live
  audio and produces none. The permission is requested at the moment the user
  chooses one of them, never at launch.
- Photos, video, and audio: selected by the user to attach existing media.
- Location: selected by the user when sharing a location in a conversation.
- Notifications: selected by the user to receive message and task alerts.

## Data Safety Inventory

Complete Google Play Data Safety answers from the current Privacy Policy and
the shipped build. The release owner must review the following app features:

- Account details used to create and access an account.
- Messages and media that users send to conversations.
- Audio and video that users choose to record or share — a voice message, a
  video message or an attached file. These produce stored files.
- **Live call audio, which is transmitted and not stored.** A voice channel
  carries audio between participants through the operator's own media server;
  nothing records it. Verified against the deployment rather than assumed: the
  media server's configuration declares no egress and no recording, and no
  recording or egress container runs. In Play's taxonomy this is audio that
  leaves the device, so it is collected — and it is the case Play's own
  «processed ephemerally» answer exists for. **The release owner must confirm
  that answer in the console**; this file cannot make the declaration.
- What a call does leave behind, which is metadata rather than audio: the
  voice channel's own settings, a record of who is present while they are
  present, and a service line in the conversation saying a call started and
  ended. Section 7 of the Privacy Policy states each of these and its
  retention.
- Approximate or precise location when a user explicitly shares it.
- Diagnostics needed to operate and improve the application.

The listing's full description has promised «calls» for some time, and until
2026-09-18 the Privacy Policy mentioned none — a listing that promises a
feature the policy does not describe is the kind of gap a Data Safety review
finds. Section 7 «Голосовые звонки» closes it, and the policy's version and
effective date moved with it.

This file is store-listing preparation, not a substitute for the Privacy Policy
or legal review.
