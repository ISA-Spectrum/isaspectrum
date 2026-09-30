create table if not exists oauth_transactions (
  state_hash text primary key,
  browser_binding_hash text not null,
  code_verifier text not null,
  nonce text not null,
  redirect_path text not null,
  created_at text not null,
  expires_at text not null
);

create index if not exists oauth_transactions_expires_at_idx
  on oauth_transactions (expires_at);

create table if not exists business_sessions (
  session_hash text primary key,
  previous_session_hash text,
  previous_valid_until text,
  user_id text not null,
  identity_provider text not null,
  identity_subject text not null,
  email text,
  display_name text,
  is_checker integer not null default 0,
  created_at text not null,
  last_seen_at text not null,
  expires_at text not null,
  absolute_expires_at text not null,
  revoked_at text,
  auth_time text,
  amr text not null default '[]',
  acr text
);

create index if not exists business_sessions_expires_at_idx
  on business_sessions (expires_at);

pragma optimize;
