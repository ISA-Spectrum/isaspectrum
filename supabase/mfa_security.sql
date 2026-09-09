-- MFA security helpers for ISA Spectrum.
-- Run this in the Supabase SQL editor after enabling TOTP in Auth settings.
-- Existing table policies differ between deployments, so this migration adds
-- reusable checks without replacing existing Messages/Checkers policies.

create or replace function public.has_aal2()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select auth.jwt()->>'aal' = 'aal2'), false);
$$;

create or replace function public.is_checker()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.checkers
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_checker() from public;
grant execute on function public.is_checker() to authenticated;
grant execute on function public.has_aal2() to authenticated;

-- Use BOTH checks in every policy that exposes pending/rejected messages,
-- contact_email, logs, or moderation updates:
--   using ((select public.is_checker()) and (select public.has_aal2()))
--   with check ((select public.is_checker()) and (select public.has_aal2()))
-- Do not replace the public policy for approved messages with an aal2-only rule.
