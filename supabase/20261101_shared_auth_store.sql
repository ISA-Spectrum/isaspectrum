-- Run once in Supabase SQL Editor. Existing business tables are untouched.
-- Dedicated private tables avoid collisions with older oauth/session schemas.
begin;
create schema if not exists isa_auth_private;
revoke all on schema isa_auth_private from public, anon, authenticated;
create table if not exists isa_auth_private.transactions (
  state_hash text primary key,
  browser_binding_hash text not null,
  expires_at timestamptz not null,
  data jsonb not null
);
create table if not exists isa_auth_private.sessions (
  session_hash text primary key,
  previous_session_hash text,
  previous_valid_until timestamptz,
  expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  data jsonb not null
);
create index if not exists isa_auth_transactions_expiry on isa_auth_private.transactions(expires_at);
create index if not exists isa_auth_sessions_expiry on isa_auth_private.sessions(expires_at);
create index if not exists isa_auth_sessions_previous on isa_auth_private.sessions(previous_session_hash);
alter table isa_auth_private.transactions enable row level security;
alter table isa_auth_private.sessions enable row level security;
revoke all on all tables in schema isa_auth_private from public, anon, authenticated;

create or replace function public.isa_auth_store(operation text, args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; changed integer;
begin
  case operation
  when 'create_transaction' then
    insert into isa_auth_private.transactions values
      (args->>'state_hash', args->>'browser_binding_hash', (args->>'expires_at')::timestamptz, args);
    return 'null'::jsonb;
  when 'consume_transaction' then
    delete from isa_auth_private.transactions
    where state_hash = args->>'state' and browser_binding_hash = args->>'binding' and expires_at > now()
    returning data into result;
    return coalesce(result, 'null'::jsonb);
  when 'create_session' then
    insert into isa_auth_private.sessions(session_hash, expires_at, absolute_expires_at, data)
    values (args->>'session_hash', (args->>'expires_at')::timestamptz,
      (args->>'absolute_expires_at')::timestamptz,
      jsonb_build_object('created_at', now(), 'last_seen_at', now()) || args);
    return 'null'::jsonb;
  when 'read_session' then
    select data || jsonb_build_object('session_hash', session_hash, 'expires_at', expires_at,
      'absolute_expires_at', absolute_expires_at) into result
    from isa_auth_private.sessions
    where (session_hash = args->>'hash' or (previous_session_hash = args->>'hash' and previous_valid_until > now()))
      and revoked_at is null and expires_at > now() and absolute_expires_at > now() limit 1;
    return coalesce(result, 'null'::jsonb);
  when 'rotate_session' then
    update isa_auth_private.sessions
    set previous_session_hash = session_hash, previous_valid_until = now() + interval '60 seconds',
      session_hash = args->>'next', expires_at = least((args->>'expires')::timestamptz, absolute_expires_at),
      data = data || jsonb_build_object('last_seen_at', now())
    where session_hash = args->>'previous' and revoked_at is null and expires_at > now() and absolute_expires_at > now();
    get diagnostics changed = row_count;
    return to_jsonb(changed = 1);
  when 'revoke_session' then
    update isa_auth_private.sessions set revoked_at = now()
    where (session_hash = args->>'hash' or (previous_session_hash = args->>'hash' and previous_valid_until > now()))
      and revoked_at is null;
    return 'null'::jsonb;
  when 'prune' then
    delete from isa_auth_private.transactions where expires_at <= now();
    delete from isa_auth_private.sessions where expires_at <= now() or absolute_expires_at <= now()
      or revoked_at < now() - interval '1 day';
    return 'null'::jsonb;
  else raise exception 'invalid auth operation';
  end case;
end;
$$;
revoke all on function public.isa_auth_store(text, jsonb) from public, anon, authenticated;
grant execute on function public.isa_auth_store(text, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
