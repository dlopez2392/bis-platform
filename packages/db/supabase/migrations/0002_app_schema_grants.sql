-- RLS policies call app.jwt() / app.is_agency() / app.current_account_id() as the *caller*,
-- so every app role needs USAGE on schema app — without it every policy check raises
-- "permission denied for schema app" instead of evaluating. Found by the Task 5 isolation suite.
grant usage on schema app to authenticated, anon, service_role;
grant execute on all functions in schema app to authenticated, anon, service_role;
alter default privileges in schema app
  grant execute on functions to authenticated, anon, service_role;
