create index if not exists push_foreground_sessions_current_chat_idx
  on public.push_foreground_sessions (current_chat_id);
