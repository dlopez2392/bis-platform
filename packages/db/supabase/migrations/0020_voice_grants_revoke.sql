-- Correction to 0019 (append-only, the 0017-fixes-0016 precedent): Supabase
-- default privileges auto-granted ALL on the three voice tables to anon and
-- authenticated. The voice design requires serviceDb-only writes — a client
-- who could UPDATE phone_numbers.e164 could corrupt tenant call routing, and
-- calls are records. authenticated keeps SELECT (operator/client visibility
-- through RLS); anon gets nothing (no anon surface reads voice data).

revoke insert, update, delete, truncate, references, trigger
  on public.phone_numbers, public.voice_profiles, public.calls
  from authenticated;

revoke all
  on public.phone_numbers, public.voice_profiles, public.calls
  from anon;
