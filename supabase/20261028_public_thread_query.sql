-- Apply in a non-production environment first. This function only exposes rows
-- already visible through approved_messages_public; it does not bypass RLS/view permissions.
begin;

create index if not exists messages_reply_to_flag_created_id_idx
  on public.messages (reply_to, flag, created_at, id);

create or replace function public.approved_message_thread(p_root_id text)
returns setof public.approved_messages_public
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive thread_ids(id) as (
    select root.id
    from public.approved_messages_public root
    where root.id = case
      when p_root_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then p_root_id::uuid else null::uuid end
      and root.reply_to is null
    union
    select child.id
    from public.approved_messages_public child
    join thread_ids parent on child.reply_to = parent.id
  )
  select message.*
  from public.approved_messages_public message
  join thread_ids thread on message.id = thread.id;
$$;

revoke all on function public.approved_message_thread(text) from public;
grant execute on function public.approved_message_thread(text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
