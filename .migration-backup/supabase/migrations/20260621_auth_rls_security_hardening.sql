-- Proposal only. Do not apply automatically.
--
-- Goal:
--   Tighten SECURITY DEFINER helper safety after the 2026-06-21 auth/RLS
--   audit. All public tables currently have RLS enabled, but two existing
--   SECURITY DEFINER functions do not have an explicit search_path.
--
-- Why:
--   SECURITY DEFINER functions should not depend on the caller's search_path.
--   Pinning search_path avoids accidental or malicious object shadowing.
--
-- Manual apply target:
--   self-hosted LETSCUBE Supabase Postgres.
--
-- Live read-only audit on 2026-06-21:
--   public.get_my_chat_ids() and public.handle_new_user() are the two
--   SECURITY DEFINER functions still missing explicit search_path.
--   No SQL was applied during the audit.

begin;

alter function public.get_my_chat_ids()
  set search_path = public;

alter function public.handle_new_user()
  set search_path = public;

commit;
