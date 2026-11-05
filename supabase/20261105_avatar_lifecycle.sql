-- Required before deploying PR #1. No existing objects are deleted by this migration.
-- Per-user locking coordinates storage insertion/deletion with profile updates.
begin;
create or replace function public.isa_avatar_can_insert(object_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid text := auth.uid()::text; n integer;
begin
  if uid is null or object_name !~ ('^business/' || uid || '\.[a-f0-9]{64}\.png$') then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('isa-avatar:' || uid, 0));
  select count(*) into n from storage.objects where bucket_id='avatars' and name like 'business/' || uid || '.%';
  return n < 64;
end;
$$;
create or replace function public.isa_avatar_can_delete(object_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid text := auth.uid()::text;
begin
  if uid is null or object_name not like 'business/' || uid || '.%' then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('isa-avatar:' || uid, 0));
  return not exists (select 1 from public.business_users where split_part(avatar_url, '/storage/v1/object/public/avatars/', 2)=object_name);
end;
$$;
create or replace function public.isa_validate_avatar_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
declare object_name text;
begin
  if new.avatar_url is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('isa-avatar:' || new.user_id::text, 0));
  object_name := split_part(new.avatar_url, '/storage/v1/object/public/avatars/', 2);
  if object_name not like 'business/' || new.user_id::text || '.%' or not exists (select 1 from storage.objects where bucket_id='avatars' and name=object_name) then
    raise exception 'avatar_object_missing';
  end if;
  return new;
end;
$$;
revoke all on function public.isa_avatar_can_insert(text), public.isa_avatar_can_delete(text), public.isa_validate_avatar_reference() from public, anon;
grant execute on function public.isa_avatar_can_insert(text), public.isa_avatar_can_delete(text) to authenticated;
drop policy if exists business_users_upload_avatar on storage.objects;
create policy business_users_upload_avatar on storage.objects for insert to authenticated with check (bucket_id='avatars' and public.isa_avatar_can_insert(name));
-- Stop stale clients overwriting a currently displayed avatar.
drop policy if exists business_users_update_avatar on storage.objects;
drop policy if exists business_users_list_avatar on storage.objects;
create policy business_users_list_avatar on storage.objects for select to authenticated using (bucket_id='avatars' and name like 'business/' || auth.uid()::text || '.%');
drop policy if exists business_users_delete_avatar on storage.objects;
create policy business_users_delete_avatar on storage.objects for delete to authenticated using (bucket_id='avatars' and created_at < now() - interval '7 days' and public.isa_avatar_can_delete(name));
drop trigger if exists isa_validate_avatar_reference on public.business_users;
create trigger isa_validate_avatar_reference before insert or update of avatar_url on public.business_users for each row execute function public.isa_validate_avatar_reference();
notify pgrst, 'reload schema';
commit;
