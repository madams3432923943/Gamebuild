-- The http extension lives in the extensions schema, while migration helper
-- functions intentionally run with search_path=public. Expose one tightly
-- scoped wrapper there so the NFL generated-data sync can fetch its source.
create or replace function public.http_get(uri text)
returns extensions.http_response
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.http_get(uri::varchar);
$$;

revoke all on function public.http_get(text) from public, anon, authenticated;
grant execute on function public.http_get(text) to service_role;
