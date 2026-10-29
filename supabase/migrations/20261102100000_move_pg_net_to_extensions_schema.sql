-- Moves the pg_net extension (the database's web requests, used to wake the SMS sender and run the
-- scheduled jobs) into the "extensions" schema, as Supabase recommends. Its functions stay in the
-- "net" schema either way.
--
-- Already applied to the live project as "move_pg_net_to_extensions_schema" (written there as
-- `drop extension if exists pg_net; create extension pg_net schema extensions;`). This version does
-- the same only where it's needed, so it can run again harmlessly and on databases without pg_net.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and not exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_net' and n.nspname = 'extensions') then
    create schema if not exists extensions;
    drop extension if exists pg_net;
    create extension pg_net schema extensions;
  end if;
end;
$$;
