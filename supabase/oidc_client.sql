-- ISA Spectrum OIDC-to-RLS bridge.
-- Run only in the BUSINESS Supabase project.
-- OAuth transactions and browser sessions live in Cloudflare D1; this file
-- stores business identity and applies RLS to every user-scoped operation.

begin;

create extension if not exists pgcrypto;

create table if not exists public.business_users (
  user_id uuid primary key,
  identity_provider text,
  identity_subject text,
  display_name text check (display_name is null or char_length(display_name) <= 120),
  email text check (email is null or char_length(email) <= 320),
  avatar_url text,
  is_checker boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

alter table public.business_users add column if not exists identity_provider text;
alter table public.business_users add column if not exists identity_subject text;
alter table public.business_users add column if not exists avatar_url text;
create unique index if not exists business_users_external_identity_key
  on public.business_users (identity_provider, identity_subject)
  where identity_provider is not null and identity_subject is not null;

alter table public.business_users enable row level security;
revoke all on table public.business_users from public, anon, authenticated;
grant select on table public.business_users to authenticated;
grant insert (user_id, identity_provider, identity_subject, display_name, email, last_login_at)
  on table public.business_users to authenticated;
grant update (display_name, email, avatar_url, last_login_at)
  on table public.business_users to authenticated;

drop policy if exists business_users_select_self on public.business_users;
create policy business_users_select_self
on public.business_users for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists business_users_insert_self on public.business_users;
create policy business_users_insert_self
on public.business_users for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and identity_provider = (select auth.jwt() ->> 'provider_iss')
  and identity_subject = (select auth.jwt() ->> 'provider_sub')
  and is_checker = false
);

drop policy if exists business_users_update_self on public.business_users;
create policy business_users_update_self
on public.business_users for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and identity_provider = (select auth.jwt() ->> 'provider_iss')
  and identity_subject = (select auth.jwt() ->> 'provider_sub')
);

-- Business features bind to the RLS user id minted after a verified OIDC login.
alter table public.meal_ratings
  add column if not exists business_user_id uuid
  references public.business_users(user_id) on delete cascade;
alter table public.meal_ratings alter column user_id drop not null;
create unique index if not exists meal_ratings_business_user_date_key
  on public.meal_ratings (business_user_id, rating_date)
  where business_user_id is not null;

alter table public.meal_ratings enable row level security;
revoke all on table public.meal_ratings from public, anon, authenticated;
grant select, insert, update on table public.meal_ratings to authenticated;
do $$
declare
  v_sequence text;
begin
  v_sequence := pg_get_serial_sequence('public.meal_ratings', 'id');
  if v_sequence is not null then
    execute format('grant usage, select on sequence %s to authenticated', v_sequence);
  end if;
end $$;

drop policy if exists meal_ratings_select_self on public.meal_ratings;
create policy meal_ratings_select_self
on public.meal_ratings for select to authenticated
using ((select auth.uid()) = business_user_id);

drop policy if exists meal_ratings_insert_self on public.meal_ratings;
create policy meal_ratings_insert_self
on public.meal_ratings for insert to authenticated
with check ((select auth.uid()) = business_user_id);

drop policy if exists meal_ratings_update_self on public.meal_ratings;
create policy meal_ratings_update_self
on public.meal_ratings for update to authenticated
using ((select auth.uid()) = business_user_id)
with check ((select auth.uid()) = business_user_id);

alter table public.messages
  add column if not exists business_user_id uuid
  references public.business_users(user_id) on delete set null;
alter table public.messages alter column user_id drop not null;
create index if not exists messages_business_user_id_idx
  on public.messages (business_user_id);

alter table public.messages enable row level security;
revoke all on table public.messages from public, anon, authenticated;
grant select, insert on table public.messages to authenticated;
do $$
declare
  v_sequence text;
begin
  v_sequence := pg_get_serial_sequence('public.messages', 'id');
  if v_sequence is not null then
    execute format('grant usage, select on sequence %s to authenticated', v_sequence);
  end if;
end $$;

drop policy if exists messages_select_own_or_checker on public.messages;
create policy messages_select_own_or_checker
on public.messages for select to authenticated
using (
  business_user_id = (select auth.uid())
  or exists (
    select 1 from public.business_users u
    where u.user_id = (select auth.uid()) and u.is_checker = true
  )
);

drop policy if exists messages_insert_self_pending on public.messages;
create policy messages_insert_self_pending
on public.messages for insert to authenticated
with check (
  business_user_id = (select auth.uid())
  and flag = 0
);

-- Public readers only get the already-approved safe projection.
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
grant select on table public.business_notifications to authenticated;
grant update (read) on table public.business_notifications to authenticated;

drop policy if exists business_notifications_select_self on public.business_notifications;
create policy business_notifications_select_self
on public.business_notifications for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists business_notifications_update_self on public.business_notifications;
create policy business_notifications_update_self
on public.business_notifications for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

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
grant select on table public.business_moderation_logs to authenticated;

drop policy if exists moderation_logs_checker_select on public.business_moderation_logs;
create policy moderation_logs_checker_select
on public.business_moderation_logs for select to authenticated
using (
  exists (
    select 1 from public.business_users u
    where u.user_id = (select auth.uid()) and u.is_checker = true
  )
);

create or replace function public.notify_business_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
begin
  insert into public.business_notifications (user_id, title, content, type, related_id)
  select u.user_id, '新留言待审核', '用户：' || new.username || E'\n内容：' || left(new.content, 80), 'audit', new.id
  from public.business_users u
  where u.is_checker = true;

  if new.reply_to is not null then
    select m.business_user_id into v_target
    from public.messages m where m.id = new.reply_to;
    if v_target is not null and v_target <> new.business_user_id then
      insert into public.business_notifications (user_id, title, content, type, related_id)
      values (v_target, new.username || ' 回复了你', left(new.content, 160), 'reply', new.id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_business_message() from public, anon, authenticated;

drop trigger if exists messages_notify_business_users on public.messages;
create trigger messages_notify_business_users
after insert on public.messages
for each row execute function public.notify_business_message();

create or replace function public.moderate_business_message(
  p_message_id bigint,
  p_action text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from integer;
  v_to integer;
  v_user_id uuid;
  v_title text;
  v_content text;
begin
  if not exists (
    select 1 from public.business_users u
    where u.user_id = auth.uid() and u.is_checker = true
  ) then
    raise exception 'forbidden';
  end if;

  if p_action = 'approve' then v_from := 0; v_to := 1; v_title := '留言审核通过'; v_content := '你的留言、评论或回复已审核通过并公开显示';
  elsif p_action = 'reject' then v_from := 0; v_to := 2; v_title := '留言未通过审核'; v_content := '拒绝原因：' || trim(p_reason);
  elsif p_action = 'delete' then v_from := 1; v_to := 2; v_title := '留言已被删除'; v_content := '删除原因：' || trim(p_reason);
  elsif p_action = 'restore' then v_from := 2; v_to := 1; v_title := '留言已恢复'; v_content := '你的留言已恢复并重新公开显示';
  else raise exception 'invalid moderation action';
  end if;
  if p_action in ('reject', 'delete') and coalesce(char_length(trim(p_reason)), 0) = 0 then
    raise exception 'moderation reason required';
  end if;

  update public.messages
    set flag = v_to,
        reject_reason = case when v_to = 2 then left(trim(p_reason), 1000) else null end
  where id = p_message_id and flag = v_from
  returning business_user_id into v_user_id;
  if not found then raise exception 'message state conflict'; end if;

  insert into public.business_moderation_logs (operator_user_id, message_id, action, reason)
  values (auth.uid(), p_message_id, p_action, nullif(left(trim(p_reason), 1000), ''));

  if v_user_id is not null then
    insert into public.business_notifications (user_id, title, content, type, related_id)
    values (v_user_id, v_title, v_content, 'audit', p_message_id);
  end if;
end;
$$;
revoke all on function public.moderate_business_message(bigint, text, text) from public, anon;
grant execute on function public.moderate_business_message(bigint, text, text) to authenticated;

-- Storage requests carry the same short-lived authenticated JWT, so ownership
-- is enforced by the first path segment after "business/".
drop policy if exists business_users_upload_message_images on storage.objects;
create policy business_users_upload_message_images
on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-pics'
  and (storage.foldername(name))[1] = 'business'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists business_users_upload_avatar on storage.objects;
create policy business_users_upload_avatar
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'business'
  and split_part((storage.filename(name)), '.', 1) = (select auth.uid())::text
);

drop policy if exists business_users_update_avatar on storage.objects;
create policy business_users_update_avatar
on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'business'
  and split_part((storage.filename(name)), '.', 1) = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'business'
  and split_part((storage.filename(name)), '.', 1) = (select auth.uid())::text
);

-- Old privileged auth tables may exist from a previous draft. They are left in
-- place for safe rollback, but the application no longer reads or writes them.

commit;
