export const BOT_PUBLIC_MESSAGE_COLUMNS =
  "id,username,display_name,description,avatar_url,state,created_at,updated_at";

export const MESSAGE_LAST_MESSAGE_SELECT =
  `*,sender:profiles!user_id(*),bot:bots!bot_id(${BOT_PUBLIC_MESSAGE_COLUMNS})`;

export const MESSAGE_SELECT_WITH_JOINS =
  `*,sender:profiles!user_id(*),bot:bots!bot_id(${BOT_PUBLIC_MESSAGE_COLUMNS}),reply_to:messages!reply_to_id(id,content,type,media_url,media_metadata,deleted_at,user_id,bot_id,sender:profiles!user_id(id,full_name,username,avatar_url),bot:bots!bot_id(${BOT_PUBLIC_MESSAGE_COLUMNS})),reactions(*)`;
