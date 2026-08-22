-- 0016 granted authenticated exactly the seven settings columns, and
-- updateCalendarSettings stamps updated_at on every save — so every real
-- settings save through the RLS client failed `permission denied`, agency and
-- client alike, while the unit suite stayed green: withTestAccount hands tests
-- the service role, which column grants do not bind. Found by the milestone's
-- OWN e2e on its first run. Granting the timestamp is harmless — a client
-- "forging" their own row's updated_at is meaningless — and honest: the column
-- exists to record exactly these saves.
grant update (updated_at) on public.calendars to authenticated;
