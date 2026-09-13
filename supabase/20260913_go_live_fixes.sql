-- ISA Spectrum go-live corrections for projects that already ran oidc_client.sql.
-- This migration preserves existing data and stops with a clear error instead
-- of discarding legacy numeric references that cannot map to UUID messages.

begin;

do $$
declare
  v_message_id_type text;
begin
  if to_regclass('public.messages') is null
     or to_regclass('public.business_notifications') is null
     or to_regclass('public.business_moderation_logs') is null
     or to_regclass('public.meal_ratings') is null then
    raise exception 'Run supabase/oidc_client.sql before this corrective migration';
  end if;

  select format_type(a.atttypid, a.atttypmod)
    into v_message_id_type
  from pg_attribute a
  where a.attrelid = 'public.messages'::regclass
    and a.attname = 'id'
    and not a.attisdropped;
  if v_message_id_type is distinct from 'uuid' then
    raise exception 'Expected public.messages.id to be uuid, found %', v_message_id_type;
  end if;
end;
$$;

-- Stop trigger/RPC execution while their reference columns are corrected.
drop trigger if exists messages_notify_business_users on public.messages;
drop function if exists public.notify_business_message();
drop function if exists public.moderate_business_message(bigint, text, text);
drop function if exists public.moderate_business_message(uuid, text, text);

do $$
declare
  v_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_type
  from pg_attribute a
  where a.attrelid = 'public.business_notifications'::regclass
    and a.attname = 'related_id'
    and not a.attisdropped;

  if v_type is distinct from 'uuid' then
    if exists (select 1 from public.business_notifications where related_id is not null) then
      raise exception 'business_notifications.related_id contains legacy numeric values; migrate them manually before applying UUID correction';
    end if;
    alter table public.business_notifications
      alter column related_id type uuid using null::uuid;
  end if;
end;
$$;

do $$
declare
  v_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_type
  from pg_attribute a
  where a.attrelid = 'public.business_moderation_logs'::regclass
    and a.attname = 'message_id'
    and not a.attisdropped;

  if v_type is distinct from 'uuid' then
    if exists (select 1 from public.business_moderation_logs) then
      raise exception 'business_moderation_logs contains legacy numeric message IDs; migrate them manually before applying UUID correction';
    end if;
    alter table public.business_moderation_logs
      alter column message_id type uuid using null::uuid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_notifications'::regclass
      and conname = 'business_notifications_related_id_fkey'
  ) then
    alter table public.business_notifications
      add constraint business_notifications_related_id_fkey
      foreign key (related_id) references public.messages(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_moderation_logs'::regclass
      and conname = 'business_moderation_logs_message_id_fkey'
  ) then
    alter table public.business_moderation_logs
      add constraint business_moderation_logs_message_id_fkey
      foreign key (message_id) references public.messages(id) on delete restrict;
  end if;
end;
$$;

-- PostgreSQL unique indexes allow multiple NULL values. A non-partial index is
-- required so PostgREST can use ON CONFLICT (business_user_id, rating_date).
do $$
begin
  if exists (
    select 1
    from public.meal_ratings
    where business_user_id is not null
    group by business_user_id, rating_date
    having count(*) > 1
  ) then
    raise exception 'Duplicate business meal ratings exist; resolve them before recreating the upsert index';
  end if;
end;
$$;

drop index if exists public.meal_ratings_business_user_date_key;
create unique index meal_ratings_business_user_date_key
  on public.meal_ratings (business_user_id, rating_date);

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

create trigger messages_notify_business_users
after insert on public.messages
for each row execute function public.notify_business_message();

create or replace function public.moderate_business_message(
  p_message_id uuid,
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
revoke all on function public.moderate_business_message(uuid, text, text) from public, anon;
grant execute on function public.moderate_business_message(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
