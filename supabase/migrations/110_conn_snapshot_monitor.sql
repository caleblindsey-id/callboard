-- Read-only monitoring RPC for the connection-exhaustion watch.
-- Returns Postgres client-connection counts grouped by user/application/state,
-- plus max_connections and the current client-backend total on every row.
-- Added 2026-06-12 after the connection-slot exhaustion outage (login hung on
-- "Signing in…" because the 60 direct slots were saturated). Read-only; no schema impact.
-- Called via REST: POST /rest/v1/rpc/conn_snapshot  (service_role only).
create or replace function public.conn_snapshot()
returns table (
  usename text,
  application_name text,
  state text,
  conns bigint,
  max_conn int,
  total bigint
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    coalesce(a.usename::text, '(none)')      as usename,
    coalesce(a.application_name, '(none)')   as application_name,
    coalesce(a.state, '(none)')              as state,
    count(*)                                 as conns,
    (select setting::int from pg_settings where name = 'max_connections') as max_conn,
    (select count(*) from pg_stat_activity where backend_type = 'client backend') as total
  from pg_stat_activity a
  where a.backend_type = 'client backend'
  group by 1, 2, 3
  order by conns desc;
$$;

revoke all on function public.conn_snapshot() from public;
grant execute on function public.conn_snapshot() to service_role;
