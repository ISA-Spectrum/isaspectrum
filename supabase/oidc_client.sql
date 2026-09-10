-- ISA Spectrum business-side OAuth/OIDC client storage.
-- Run this only in the BUSINESS website's Supabase project.
-- Never run it in baoyuechi/2fa_safemodule_dev or the Authorization Server database.

begin;

create extension if not exists pgcrypto;

create table if not exists public.business_users (
  user_id uuid primary key default gen_random_uuid(),
  display_name text check (display_name is null or char_length(display_name) <= 120),
  email text check (email is null or char_length(email) <= 320),
  is_checker boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create table if not exists public.external_identities (
  identity_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.business_users(user_id) on delete cascade,
  issuer text not null check (char_length(issuer) between 1 and 500),
  subject text not null check (char_length(subject) between 1 and 255),
  email text check (email is null or char_length(email) <= 320),
  display_name text check (display_name is null or char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  unique (issuer, subject)
);

create index if not exists external_identities_user_id_idx
  on public.external_identities (user_id);

create table if not exists public.oauth_transactions (
  state_hash text primary key check (char_length(state_hash) between 32 and 128),
  browser_binding_hash text not null check (char_length(browser_binding_hash) between 32 and 128),
  code_verifier text not null check (char_length(code_verifier) between 43 and 128),
  nonce text not null check (char_length(nonce) between 32 and 128),
  redirect_path text not null check (redirect_path like '/%' and redirect_path not like '//%'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);

create index if not exists oauth_transactions_expires_at_idx
  on public.oauth_transactions (expires_at);

create table if not exists public.business_sessions (
  session_hash text primary key check (char_length(session_hash) between 32 and 128),
  previous_session_hash text check (previous_session_hash is null or char_length(previous_session_hash) between 32 and 128),
  previous_valid_until timestamptz,
  user_id uuid not null references public.business_users(user_id) on delete cascade,
  identity_id uuid not null references public.external_identities(identity_id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  auth_time timestamptz,
  amr jsonb not null default '[]'::jsonb check (jsonb_typeof(amr) = 'array'),
  acr text check (acr is null or char_length(acr) <= 255),
  check (expires_at > created_at),
  check (absolute_expires_at >= expires_at)
);

alter table public.business_sessions add column if not exists previous_session_hash text;
alter table public.business_sessions add column if not exists previous_valid_until timestamptz;
alter table public.business_sessions add column if not exists absolute_expires_at timestamptz;
update public.business_sessions set absolute_expires_at = expires_at where absolute_expires_at is null;
alter table public.business_sessions alter column absolute_expires_at set not null;

create index if not exists business_sessions_user_id_idx
  on public.business_sessions (user_id);
create index if not exists business_sessions_expires_at_idx
  on public.business_sessions (expires_at)
  where revoked_at is null;

alter table public.business_users enable row level security;
alter table public.external_identities enable row level security;
alter table public.oauth_transactions enable row level security;
alter table public.business_sessions enable row level security;

revoke all on table public.business_users from public, anon, authenticated;
revoke all on table public.external_identities from public, anon, authenticated;
revoke all on table public.oauth_transactions from public, anon, authenticated;
revoke all on table public.business_sessions from public, anon, authenticated;
grant all on table public.business_users to service_role;
grant all on table public.external_identities to service_role;
grant all on table public.oauth_transactions to service_role;
grant all on table public.business_sessions to service_role;

create or replace function public.consume_oauth_transaction(
  p_state_hash text,
  p_binding_hash text
)
returns table (
  code_verifier text,
  nonce text,
  redirect_path text
)
language sql
security definer
set search_path = ''
as $$
  delete from public.oauth_transactions
  where state_hash = p_state_hash
    and browser_binding_hash = p_binding_hash
    and consumed_at is null
    and expires_at > now()
  returning code_verifier, nonce, redirect_path;
$$;

create or replace function public.prune_business_auth_state()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.oauth_transactions where expires_at <= now() or consumed_at is not null;
  delete from public.business_sessions
  where expires_at <= now()
     or absolute_expires_at <= now()
     or (revoked_at is not null and revoked_at < now() - interval '1 day');
end;
$$;

create or replace function public.resolve_oidc_identity(
  p_issuer text,
  p_subject text,
  p_email text,
  p_display_name text
)
returns table (user_id uuid, identity_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_identity_id uuid;
begin
  select ei.user_id, ei.identity_id
    into v_user_id, v_identity_id
  from public.external_identities ei
  where ei.issuer = p_issuer and ei.subject = p_subject
  for update;

  if found then
    update public.external_identities
      set email = p_email,
          display_name = p_display_name,
          last_login_at = now()
      where external_identities.identity_id = v_identity_id;
    update public.business_users
      set email = p_email,
          display_name = coalesce(p_display_name, display_name),
          last_login_at = now()
      where business_users.user_id = v_user_id;
    return query select v_user_id, v_identity_id;
    return;
  end if;

  insert into public.business_users (display_name, email)
    values (p_display_name, p_email)
    returning business_users.user_id into v_user_id;

  begin
    insert into public.external_identities (user_id, issuer, subject, email, display_name)
      values (v_user_id, p_issuer, p_subject, p_email, p_display_name)
      returning external_identities.identity_id into v_identity_id;
  exception when unique_violation then
    delete from public.business_users where business_users.user_id = v_user_id;
    select ei.user_id, ei.identity_id
      into v_user_id, v_identity_id
    from public.external_identities ei
    where ei.issuer = p_issuer and ei.subject = p_subject;
  end;

  return query select v_user_id, v_identity_id;
end;
$$;

create or replace function public.read_business_session(p_session_hash text)
returns table (
  user_id uuid,
  identity_provider text,
  identity_subject text,
  email text,
  display_name text,
  is_checker boolean,
  created_at timestamptz,
  last_seen_at timestamptz,
  expires_at timestamptz,
  absolute_expires_at timestamptz,
  auth_time timestamptz,
  amr jsonb,
  acr text
)
language sql
security definer
set search_path = ''
stable
as $$
  select s.user_id,
         i.issuer,
         i.subject,
         coalesce(i.email, u.email),
         coalesce(i.display_name, u.display_name),
         u.is_checker,
         s.created_at,
         s.last_seen_at,
         s.expires_at,
         s.absolute_expires_at,
         s.auth_time,
         s.amr,
         s.acr
  from public.business_sessions s
  join public.business_users u on u.user_id = s.user_id
  join public.external_identities i on i.identity_id = s.identity_id
  where (s.session_hash = p_session_hash
      or (s.previous_session_hash = p_session_hash and s.previous_valid_until > now()))
    and s.revoked_at is null
    and s.expires_at > now()
    and s.absolute_expires_at > now();
$$;

create or replace function public.rotate_business_session(
  p_previous_hash text,
  p_next_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.business_sessions
    set previous_session_hash = session_hash,
        previous_valid_until = now() + interval '60 seconds',
        session_hash = p_next_hash,
        last_seen_at = now(),
        expires_at = least(p_expires_at, absolute_expires_at)
  where session_hash = p_previous_hash
    and revoked_at is null
    and expires_at > now()
    and absolute_expires_at > now();
  return found;
end;
$$;

create or replace function public.revoke_business_session(p_session_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.business_sessions
  set revoked_at = now()
  where (session_hash = p_session_hash
      or (previous_session_hash = p_session_hash and previous_valid_until > now()))
    and revoked_at is null;
$$;

revoke all on function public.consume_oauth_transaction(text, text) from public, anon, authenticated;
revoke all on function public.prune_business_auth_state() from public, anon, authenticated;
revoke all on function public.resolve_oidc_identity(text, text, text, text) from public, anon, authenticated;
revoke all on function public.read_business_session(text) from public, anon, authenticated;
revoke all on function public.rotate_business_session(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_business_session(text) from public, anon, authenticated;
grant execute on function public.consume_oauth_transaction(text, text) to service_role;
grant execute on function public.prune_business_auth_state() to service_role;
grant execute on function public.resolve_oidc_identity(text, text, text, text) to service_role;
grant execute on function public.read_business_session(text) to service_role;
grant execute on function public.rotate_business_session(text, text, timestamptz) to service_role;
grant execute on function public.revoke_business_session(text) to service_role;

-- Business features now bind to the business user, not auth.users from the IdP.
alter table public.business_users
  add column if not exists avatar_url text;

alter table public.meal_ratings
  add column if not exists business_user_id uuid
  references public.business_users(user_id) on delete cascade;
alter table public.meal_ratings alter column user_id drop not null;
create unique index if not exists meal_ratings_business_user_date_key
  on public.meal_ratings (business_user_id, rating_date)
  where business_user_id is not null;
revoke all on table public.meal_ratings from anon, authenticated;
grant all on table public.meal_ratings to service_role;

alter table public.messages
  add column if not exists business_user_id uuid
  references public.business_users(user_id) on delete set null;
alter table public.messages alter column user_id drop not null;
create index if not exists messages_business_user_id_idx
  on public.messages (business_user_id);
revoke all on table public.messages from anon, authenticated;
grant all on table public.messages to service_role;
revoke all on table public.approved_messages_public from public, anon, authenticated;

-- Never expose either the legacy auth.users id or the business user id publicly.
-- The legacy view may contain extra columns, which cannot be removed with
-- CREATE OR REPLACE VIEW, so recreate it atomically inside this transaction.
drop view if exists public.approved_messages_public;
create view public.approved_messages_public
with (security_barrier = true)
as
select id, username, content, zone, pic_url, created_at, reply_to
from public.messages
where flag = 1;

revoke all on table public.approved_messages_public from public;
grant select on table public.approved_messages_public to anon, authenticated;

create table if not exists public.business_notifications (
  id bigint generated by default as identity primary key,
  user_id uuid not null references public.business_users(user_id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  content text not null check (char_length(content) between 1 and 2000),
  type text not null default 'system' check (char_length(type) <= 40),
  related_id bigint,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists business_notifications_user_created_idx
  on public.business_notifications (user_id, created_at desc);
alter table public.business_notifications enable row level security;
revoke all on table public.business_notifications from public, anon, authenticated;
grant all on table public.business_notifications to service_role;
grant usage, select on sequence public.business_notifications_id_seq to service_role;

create table if not exists public.business_moderation_logs (
  id bigint generated by default as identity primary key,
  operator_user_id uuid not null references public.business_users(user_id) on delete restrict,
  message_id bigint not null,
  action text not null check (action in ('approve', 'reject', 'delete', 'restore')),
  reason text check (reason is null or char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists business_moderation_logs_message_idx
  on public.business_moderation_logs (message_id, created_at desc);
alter table public.business_moderation_logs enable row level security;
revoke all on table public.business_moderation_logs from public, anon, authenticated;
grant all on table public.business_moderation_logs to service_role;
grant usage, select on sequence public.business_moderation_logs_id_seq to service_role;

create or replace function public.moderate_business_message(
  p_message_id bigint,
  p_operator_user_id uuid,
  p_action text,
  p_reason text
)
returns table (business_user_id uuid, new_flag integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from integer;
  v_to integer;
  v_user_id uuid;
begin
  if p_action = 'approve' then v_from := 0; v_to := 1;
  elsif p_action = 'reject' then v_from := 0; v_to := 2;
  elsif p_action = 'delete' then v_from := 1; v_to := 2;
  elsif p_action = 'restore' then v_from := 2; v_to := 1;
  else raise exception 'invalid moderation action';
  end if;
  if p_action in ('reject', 'delete') and coalesce(char_length(trim(p_reason)), 0) = 0 then
    raise exception 'moderation reason required';
  end if;

  update public.messages
    set flag = v_to,
        reject_reason = case when v_to = 2 then left(trim(p_reason), 1000) else null end
  where id = p_message_id and flag = v_from
  returning messages.business_user_id into v_user_id;
  if not found then raise exception 'message state conflict'; end if;

  insert into public.business_moderation_logs (operator_user_id, message_id, action, reason)
  values (p_operator_user_id, p_message_id, p_action, nullif(left(trim(p_reason), 1000), ''));
  return query select v_user_id, v_to;
end;
$$;
revoke all on function public.moderate_business_message(bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.moderate_business_message(bigint, uuid, text, text) to service_role;

commit;
