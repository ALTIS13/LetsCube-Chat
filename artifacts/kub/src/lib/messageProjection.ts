export const BOT_PUBLIC_MESSAGE_COLUMNS =
  "id,username,display_name,description,avatar_url,state,created_at,updated_at";

export const MESSAGE_LAST_MESSAGE_SELECT =
  `*,sender:profiles!user_id(*),bot:bots!bot_id(${BOT_PUBLIC_MESSAGE_COLUMNS})`;

/**
 * Who wrote the original of a forwarded message (D-291).
 *
 * The same embed shape `reply_to` uses, and it costs the same: a left join that
 * is empty for every row with no `forwarded_from_id`. Narrow on purpose — the
 * identity and nothing else. The forwarded copy already carries the content,
 * the media and the metadata in its own columns, so anything more here would be
 * a second copy of what is already on screen.
 *
 * `deleted_at` is in the list because the name must not outlive the message it
 * belonged to; `messageForwardOrigin.ts` is where that is decided.
 *
 * RLS answers this embed as it answers any other read of `public.messages`:
 * `is_chat_member(chat_id)`. A reader who is not in the source chat gets
 * `null` here, which is «Переслано» without a name, exactly as before. Nothing
 * is widened and no policy is touched.
 */
const FORWARDED_FROM_JOIN =
  `forwarded_from:messages!forwarded_from_id(id,type,deleted_at,user_id,bot_id,sender:profiles!user_id(id,full_name,username,avatar_url),bot:bots!bot_id(${BOT_PUBLIC_MESSAGE_COLUMNS}))`;

export const MESSAGE_SELECT_WITH_JOINS =
  `*,sender:profiles!user_id(*),bot:bots!bot_id(${BOT_PUBLIC_MESSAGE_COLUMNS}),reply_to:messages!reply_to_id(id,content,type,media_url,media_metadata,deleted_at,user_id,bot_id,sender:profiles!user_id(id,full_name,username,avatar_url),bot:bots!bot_id(${BOT_PUBLIC_MESSAGE_COLUMNS})),${FORWARDED_FROM_JOIN},reactions(*)`;
