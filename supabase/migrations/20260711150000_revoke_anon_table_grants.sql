-- Defense-in-depth: revoke the inert anon/authenticated default grants.
--
-- Verified 2026-07-11 (SQL-editor probe, see docs/supabase-live-state.md):
-- every public table has RLS enabled with 0 policies => deny-all for
-- anon/authenticated already. But 14 older tables still carry Supabase's
-- default table grants (SELECT/INSERT/.../DELETE for anon) — harmless today,
-- yet a single accidental permissive policy (or an RLS disable) would arm
-- them. The KCS-era tables (inquiry_*, analytics_events, email_template_
-- settings) already had these grants revoked; this brings the rest in line.
--
-- Zero app impact: both apps access Supabase exclusively with the service
-- role key, which is unaffected by these grants and by RLS.

revoke all on table public.cruise_changes          from anon, authenticated;
revoke all on table public.cruise_locations        from anon, authenticated;
revoke all on table public.cruise_offers           from anon, authenticated;
revoke all on table public.cruise_providers        from anon, authenticated;
revoke all on table public.cruise_watch            from anon, authenticated;
revoke all on table public.discovery_queries       from anon, authenticated;
revoke all on table public.offer_media_candidates  from anon, authenticated;
revoke all on table public.provider_locations      from anon, authenticated;
revoke all on table public.provider_pages          from anon, authenticated;
revoke all on table public.providers               from anon, authenticated;
revoke all on table public.raw_search_results      from anon, authenticated;
revoke all on table public.region_conditions       from anon, authenticated;
revoke all on table public.rejected_providers      from anon, authenticated;
revoke all on table public.wind_stats              from anon, authenticated;

-- Future tables created via the SQL editor (role postgres) should not get
-- the default anon/authenticated grants either.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

-- Verify afterwards (expect anon_grants = NULL on every row):
--   select c.relname,
--          (select string_agg(distinct privilege_type, ',')
--             from information_schema.role_table_grants g
--            where g.table_schema = 'public'
--              and g.table_name  = c.relname
--              and g.grantee     = 'anon') as anon_grants
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind in ('r','p')
--    order by c.relname;
