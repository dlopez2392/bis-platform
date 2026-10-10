import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback } from "./db";

/**
 * THE SCHEMA-WIDE GUARD. Every relation in `public` that the data API can
 * expose (tables, partitioned tables, views, materialized views, foreign
 * tables):
 *   - has row level security on;
 *   - has no policy that applies to PUBLIC;
 *   - gives `anon` and `authenticated` EXACTLY the write privileges allow-listed below.
 * Supabase's default privileges grant ALL on every new table AND view to anon
 * and authenticated (packages/db/supabase/bootstrap/ci-project.sql:58-63), so a
 * migration that forgets its revoke fails here, naming the relation. A view
 * or materialized view cannot enable row level security, so one created in
 * `public` always lands in `rlsOff`: that is deliberate, and it forces an
 * explicit, reviewed decision here rather than a silent read path around the
 * tables' policies. There are none today. The allow-list IS the client role's
 * write surface, written out: changing it is a deliberate, reviewed edit.
 * Privileges are read with has_table_privilege / has_column_privilege, which
 * count a grant to PUBLIC as the role's own and see PG17's MAINTAIN.
 * information_schema lists a PUBLIC grant only under grantee 'PUBLIC' (so a
 * per-role filter misses it) and never lists MAINTAIN.
 */
const RUN = Math.random().toString(36).slice(2, 10);

type Surface = { rlsOff: string[]; publicPolicies: string[]; writes: Record<string, string[]> };

async function writeSurface(c: Client): Promise<Surface> {
  const { rows: rls } = await c.query<{ t: string }>(
    `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p','v','m','f') and not c.relrowsecurity order by 1`);
  const { rows: pol } = await c.query<{ p: string }>(
    `select tablename || '.' || policyname as p from pg_policies
      where schemaname = 'public' and 'public' = any(roles) order by 1`);
  const { rows } = await c.query<{ k: string; p: string }>(
    `with t as (select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')),
          r(role) as (values ('anon'::name), ('authenticated'::name)),
          tp(priv) as (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')),
          cp(priv) as (values ('INSERT'), ('UPDATE'), ('REFERENCES'))
     select r.role || ' ' || t.relname as k, tp.priv as p
       from t cross join r cross join tp
      where has_table_privilege(r.role, t.oid, tp.priv)
     union all
     select r.role || ' ' || t.relname as k, cp.priv || '(' || a.attname || ')' as p
       from t cross join r cross join cp
       join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
      where not has_table_privilege(r.role, t.oid, cp.priv)
        and has_column_privilege(r.role, t.oid, a.attnum, cp.priv)`);
  const writes: Record<string, string[]> = {};
  for (const { k, p } of rows) (writes[k] ??= []).push(p);
  for (const k of Object.keys(writes)) writes[k]!.sort();
  return { rlsOff: rls.map((r) => r.t), publicPolicies: pol.map((r) => r.p), writes };
}

const IUD = ["DELETE", "INSERT", "UPDATE"];
const update = (cols: string[]) => cols.map((c) => `UPDATE(${c})`);
const insertDeleteAndUpdate = (cols: string[]) => ["DELETE", "INSERT", ...update(cols)].sort();

/** anon: nothing anywhere. authenticated: exactly this. */
const EXPECTED_WRITES: Record<string, string[]> = {
  "authenticated accounts": insertDeleteAndUpdate([
    "brand_color", "brand_corners", "brand_logo_path", "brand_mode", "brand_name", "brand_neutral", "brand_type",
    "mailing_address", "reply_to_email",
  ]),
  "authenticated agencies": IUD,
  "authenticated blueprints": IUD,
  "authenticated calendars": update([
    "buffer_minutes", "enabled", "followup_body", "followup_enabled", "max_advance_days", "meeting_type",
    "min_notice_hours", "notify_emails", "open_hours", "slot_duration_minutes", "updated_at",
  ]).sort(),
  "authenticated checklist_items": IUD,
  "authenticated contact_duplicate_flags": IUD,
  "authenticated contact_tags": IUD,
  "authenticated contacts": insertDeleteAndUpdate([
    "assigned_to", "attribution", "company_name", "custom", "dnd", "email", "first_name", "last_name",
    "marketing_email_opted_out_at", "phone", "phone_country_unconfirmed", "source", "updated_at",
  ]),
  "authenticated custom_fields": IUD,
  "authenticated custom_values": IUD,
  "authenticated forms": IUD,
  "authenticated notes": IUD,
  "authenticated opportunities": insertDeleteAndUpdate([
    "assigned_to", "contact_id", "custom", "monetary_value", "name", "pipeline_id", "stage_changed_at", "stage_id",
    "status", "status_changed_at", "updated_at",
  ]),
  "authenticated pipeline_stages": IUD,
  "authenticated pipelines": IUD,
  "authenticated tags": IUD,
  "authenticated tasks": IUD,
};

describe("schema guard: every public table, view, materialized view and foreign table", () => {
  it("has row level security enabled (mutation: disable it on any table, or create any view -> FAILS naming it)", () =>
    withRollback(async (c) => { expect((await writeSurface(c)).rlsOff).toEqual([]); }));

  it("has no policy that applies to PUBLIC", () =>
    withRollback(async (c) => { expect((await writeSurface(c)).publicPolicies).toEqual([]); }));

  it("gives anon nothing and authenticated exactly the allow-listed writes (mutation: re-grant insert on messages -> FAILS)", () =>
    withRollback(async (c) => { expect((await writeSurface(c)).writes).toEqual(EXPECTED_WRITES); }));
});

describe("schema guard: the guard sees what it claims to (positive controls, rolled back)", () => {
  it("a new table with write grants and no RLS is reported, for both roles", () =>
    withRollback(async (c) => {
      const probe = `zz_guard_probe_${RUN}`;
      await c.query(`create table public.${probe} (id int, note text)`);
      // Explicit, so the control does not depend on the default ACL (which adds more on top).
      await c.query(`grant insert, update, delete on public.${probe} to anon, authenticated`);
      const s = await writeSurface(c);
      expect(s.rlsOff).toContain(probe);
      expect(s.writes[`authenticated ${probe}`]).toEqual(expect.arrayContaining(IUD));
      expect(s.writes[`anon ${probe}`]).toEqual(expect.arrayContaining(IUD));
    }));

  it("a new view is reported as having no row level security, with its write grants, for both roles (mutation: scan tables only -> FAILS)", () =>
    withRollback(async (c) => {
      const probe = `zz_guard_view_${RUN}`;
      await c.query(`create view public.${probe} as select 1 as x`);
      // Explicit, so the control does not depend on the default ACL (which adds more on top).
      await c.query(`grant insert, update, delete on public.${probe} to anon, authenticated`);
      const s = await writeSurface(c);
      expect(s.rlsOff).toContain(probe);
      expect(s.writes[`authenticated ${probe}`]).toEqual(expect.arrayContaining(IUD));
      expect(s.writes[`anon ${probe}`]).toEqual(expect.arrayContaining(IUD));
    }));

  it("a column-level grant and a PUBLIC policy are reported, and nothing else about that table", () =>
    withRollback(async (c) => {
      const probe = `zz_guard_col_${RUN}`;
      await c.query(`create table public.${probe} (id int, secret text)`);
      await c.query(`alter table public.${probe} enable row level security`);
      await c.query(`revoke all on public.${probe} from anon, authenticated`);
      await c.query(`grant update (secret) on public.${probe} to authenticated`);
      await c.query(`create policy open_read on public.${probe} for select using (true)`);
      const s = await writeSurface(c);
      expect(s.writes[`authenticated ${probe}`]).toEqual(["UPDATE(secret)"]);
      expect(s.writes[`anon ${probe}`]).toBeUndefined();
      expect(s.rlsOff).not.toContain(probe);
      expect(s.publicPolicies).toContain(`${probe}.open_read`);
    }));
});
