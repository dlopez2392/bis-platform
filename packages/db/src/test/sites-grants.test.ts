import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";

/**
 * The boundary 0029 draws, pinned in both directions at the level that can
 * see it (unit tests that mock the db are blind to grants). The three tables
 * are read-only for `authenticated` under the member policy; every write is
 * the cron's, through the service role.
 *
 * Mutation: drop the `revoke insert, update, delete …` line for `sites` in
 * 0029 — the first test's row list grows past SELECT.
 */
const TABLES = ["sites", "site_traffic_daily", "site_traffic_breakdown"] as const;

describe("0029 sites/traffic privileges", () => {
  for (const table of TABLES) {
    it(`${table}: authenticated has SELECT and nothing else; anon has nothing`, async () => {
      await withRollback(async (c) => {
        const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
          `select grantee, privilege_type from information_schema.role_table_grants
            where table_schema = 'public' and table_name = $1
              and grantee in ('authenticated', 'anon')
            order by grantee, privilege_type`,
          [table],
        );
        expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
      });
    });
  }
});

async function seedTwoSites(c: any) {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [a] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, brand_name, client_access_enabled) values ($1,'org_SITE_A','Alpha','Alpha',true) returning id", [agency.id]);
  const { rows: [b] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, brand_name, client_access_enabled) values ($1,'org_SITE_B','Bravo','Bravo',true) returning id", [agency.id]);
  const { rows: [sa] } = await c.query(
    "insert into sites (account_id, vercel_project_id, domain) values ($1,'prj_A','alpha.example') returning id", [a.id]);
  const { rows: [sb] } = await c.query(
    "insert into sites (account_id, vercel_project_id, domain) values ($1,'prj_B','bravo.example') returning id", [b.id]);
  await c.query(
    "insert into site_traffic_daily (site_id, account_id, day, visitors, pageviews) values ($1,$2,'2026-09-01',10,20),($3,$4,'2026-09-01',30,40)",
    [sa.id, a.id, sb.id, b.id]);
  await c.query(
    "insert into site_traffic_breakdown (site_id, account_id, day, dimension, value, visitors, pageviews) values ($1,$2,'2026-09-01','page','/',10,20),($3,$4,'2026-09-01','page','/',30,40)",
    [sa.id, a.id, sb.id, b.id]);
  return { a: a.id as string, b: b.id as string, sa: sa.id as string };
}

describe("0029 sites/traffic RLS", () => {
  it("a client reads only its own site, daily rows and breakdown rows", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoSites(c);
      await actAs(c, { org_id: "org_SITE_A" });
      const sites = await c.query("select account_id from sites");
      expect(sites.rows.map((r: any) => r.account_id)).toEqual([a]);
      const daily = await c.query("select account_id from site_traffic_daily");
      expect(daily.rows.map((r: any) => r.account_id)).toEqual([a]);
      const bd = await c.query("select account_id from site_traffic_breakdown");
      expect(bd.rows.map((r: any) => r.account_id)).toEqual([a]);
    }));

  // One refused statement per transaction (a refusal aborts it; the next
  // statement reports 25P02, not its own reason).
  it("a client cannot INSERT a site, and the refusal is insufficient_privilege (42501)", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoSites(c);
      await actAs(c, { org_id: "org_SITE_A" });
      await expect(
        c.query("insert into sites (account_id, vercel_project_id, domain) values ($1,'prj_X','x.example')", [a]),
      ).rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot UPDATE a daily row, and the refusal is 42501", () =>
    withRollback(async (c) => {
      const { sa } = await seedTwoSites(c);
      await actAs(c, { org_id: "org_SITE_A" });
      await expect(
        c.query("update site_traffic_daily set visitors = 999 where site_id = $1", [sa]),
      ).rejects.toMatchObject({ code: "42501" });
    }));

  it("the agency reads every row", () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoSites(c);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query("select account_id from sites where account_id in ($1,$2) order by vercel_project_id", [a, b]);
      expect(rows.map((r: any) => r.account_id)).toEqual([a, b]);
    }));
});
