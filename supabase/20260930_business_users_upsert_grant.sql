-- Fix the business_users upsert path used by functions/_lib/supabase.js resolveIdentity().
--
-- Run this in the BUSINESS Supabase project SQL editor. Safe to run more than once.
--
-- Why this is needed
-- ------------------
-- The login callback calls:
--   POST /rest/v1/business_users?on_conflict=user_id&select=user_id,is_checker
--   Prefer: resolution=merge-duplicates,return=representation
-- PostgREST expands that to:
--   INSERT INTO business_users (<every payload column>) VALUES (...)
--   ON CONFLICT (user_id) DO UPDATE SET <every payload column> = EXCLUDED.<column>
--   RETURNING ...
-- With ON CONFLICT DO UPDATE present, Postgres also requires UPDATE privilege on the
-- columns that the update branch writes. oidc_client.sql granted
--   insert (user_id, identity_provider, identity_subject, display_name, email, last_login_at)
--   update (display_name, email, avatar_url, last_login_at)
-- so `identity_provider` and `identity_subject` had no UPDATE privilege. The upsert
-- then fails with 42501 "permission denied for table business_users", which the
-- callback reports as business_store_unavailable (before the error-code split it was
-- silently masked as "invalid_id_token"). Because the business session is only minted
-- after resolveIdentity() returns, D1 never received a single session row.
--
-- Why this is safe: the row level security policy business_users_update_self already
-- pins both columns to the caller's own verified token claims, so a user still cannot
-- move someone else's identity onto their row:
--   with check (
--     (select auth.uid()) = user_id
--     and identity_provider = (select auth.jwt() ->> 'provider_iss')
--     and identity_subject = (select auth.jwt() ->> 'provider_sub')
--   )
--
-- Scope: this is the only column-level gap. messages, meal_ratings and
-- business_notifications already carry table-level grants for the operations the app
-- performs (see supabase/oidc_client.sql), so nothing else needs changing.
--
-- Optional read-only check before/after:
--   select privilege_type, column_name
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'business_users'
--      and grantee = 'authenticated'
--    order by privilege_type, column_name;

begin;

-- user_id is included because PostgREST's DO UPDATE SET writes every column present in
-- the request payload, including the conflict target. Granting it is still safe: the
-- business_users_update_self policy requires the post-update user_id to equal
-- auth.uid(), so a row can only keep its own owner. is_checker is deliberately NOT
-- granted, because the policy does not constrain it and granting it would let any user
-- promote themselves to reviewer.
grant update (user_id, identity_provider, identity_subject)
  on table public.business_users to authenticated;

commit;
