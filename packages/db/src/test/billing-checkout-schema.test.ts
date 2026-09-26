import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";

/**
 * 0052 (M7a billing, rollout step 3) at the level that can see it: real SQL
 * in a rolled-back transaction for grants and constraints, and serviceDb()
 * under withTestAccount for the account-delete cascade. Money tier: every
 * test names the mutation that turns it red.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_BLINK_${label}_${RUN}`;
const PRICE_IDS = { base: "price_t_base", voice_minutes: "price_t_vm", sms: "price_t_sms", ai_chats: "price_t_ai" };
const FEATURES = { voice_receptionist: true, web_concierge: false };
const ZERO = { voice_minutes: 0, sms: 0, ai_chats: 0 };

type Seeded = { a: string; b: string; plan: string };

async function seed(c: Client): Promise<Seeded> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const mk = async (label: string) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency!.id, orgId(label), `Link ${label}`])).rows[0]!.id;
  const a = await mk("A");
  const b = await mk("B");
  const plan = (await c.query<{ id: string }>(
    `insert into plans (agency_id, name, monthly_price_cents, features, allowances, overage_cents,
                        stripe_product_id, stripe_price_ids)
       values ($1, $2, 4900, $3, $4, $4, 'prod_t_link', $5) returning id`,
    [agency!.id, `Link plan ${RUN}`, JSON.stringify(FEATURES), JSON.stringify(ZERO), JSON.stringify(PRICE_IDS)],
  )).rows[0]!.id;
  return { a, b, plan };
}

const LINK_SQL = `insert into billing_links
  (account_id, plan_id, stripe_customer_id, checkout_session_id, checkout_url, sent_to, expires_at)
  values ($1, $2, $3, $4, $5, $6, now() + interval '1 day')`;
const linkParams = (s: Seeded, over: Partial<Record<"account" | "customer" | "session" | "url" | "to", string>> = {}) => [
  over.account ?? s.a, s.plan, over.customer ?? `cus_t_${RUN}`, over.session ?? `cs_test_${RUN}`,
  over.url ?? "https://checkout.stripe.com/c/pay/cs_test_x", over.to ?? "owner@example.com",
];

/** One statement expected to fail, inside a savepoint so the transaction
 *  survives for the next one (a failed statement aborts a Postgres txn). */
async function refused(c: Client, sql: string, params: unknown[]): Promise<unknown> {
  await c.query("savepoint probe");
  try {
    await c.query(sql, params);
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query("rollback to savepoint probe");
  }
}

const denied = (table: string) => ({
  code: "42501",
  message: expect.stringMatching(new RegExp(`permission denied for table ${table}`, "i")),
});

// Same house shape as billing-schema.test.ts's stripe_webhook_events block:
// service_role holds every privilege, authenticated and anon hold none at
// all (not just refused by RLS — no grant to refuse in the first place).
const SERVICE_ROLE_ALL = ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]
  .map((privilege_type) => ({ grantee: "service_role", privilege_type }));

describe("0052 billing_links: grants, anon and RLS (house pattern from stripe_webhook_events)", () => {
  it("billing_links: anon holds nothing (mutation: drop the revoke from anon → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'billing_links' and grantee = 'anon'`);
      expect(rows).toEqual([]);
    }));

  it("billing_links: neither authenticated nor anon holds MAINTAIN (mutation: enumerate the revoke like 0025 → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ auth: boolean; anon: boolean }>(
        `select has_table_privilege('authenticated', 'public.billing_links', 'MAINTAIN') as auth,
                has_table_privilege('anon', 'public.billing_links', 'MAINTAIN') as anon`);
      expect(rows[0]).toEqual({ auth: false, anon: false });
    }));

  it("billing_links: the whole grant set across every role but postgres is exactly service_role's default ACL (mutation: grant select on billing_links to authenticated → FAILS; also catches service_role missing UPDATE or DELETE)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select grantee, privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'billing_links' and grantee <> 'postgres'
           order by grantee, privilege_type`);
      expect(rows).toEqual(SERVICE_ROLE_ALL);
    }));

  it("billing_links: row level security is on (mutation: drop its enable row level security → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = 'public.billing_links'::regclass`);
      expect(rows[0]!.relrowsecurity).toBe(true);
    }));
});

describe("0052 billing_links: service_role only (42501 AND 'permission denied for table billing_links': the GRANT refusing)", () => {
  it("neither a client nor the agency's own JWT can READ a link (it holds the payer's email and a live payment URL) (mutation: grant select on billing_links to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(LINK_SQL, linkParams(s));
      await actAs(c, { org_id: orgId("A") });
      expect(await refused(c, "select * from billing_links", [])).toMatchObject(denied("billing_links"));
      await actAs(c, { app_role: "agency_admin" });
      expect(await refused(c, "select * from billing_links", [])).toMatchObject(denied("billing_links"));
    }));

  it("no authenticated role can WRITE a link: writes go through serviceDb() after requireAgency() (mutation: grant insert or update on billing_links to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { app_role: "agency_admin" });
      expect(await refused(c, LINK_SQL, linkParams(s))).toMatchObject(denied("billing_links"));
      expect(await refused(c, "update billing_links set sent_to = 'x@y.z'", [])).toMatchObject(denied("billing_links"));
    }));
});

describe("0052 billing_links: shape", () => {
  it("refuses a non-customer id, a non-session id, a non-https URL and an address with no @ (mutation: drop any one of the four CHECKs → that insert succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refused(c, LINK_SQL, linkParams(s, { customer: "acct_1" })))
        .toMatchObject({ code: "23514", constraint: "billing_links_customer_check" });
      expect(await refused(c, LINK_SQL, linkParams(s, { session: "pi_1" })))
        .toMatchObject({ code: "23514", constraint: "billing_links_session_check" });
      expect(await refused(c, LINK_SQL, linkParams(s, { url: "http://checkout.stripe.com/x" })))
        .toMatchObject({ code: "23514", constraint: "billing_links_url_check" });
      expect(await refused(c, LINK_SQL, linkParams(s, { to: "owner.example.com" })))
        .toMatchObject({ code: "23514", constraint: "billing_links_sent_to_check" });
    }));

  it("one link per account, and one account per Stripe customer (mutation: drop the unique on stripe_customer_id → the second account's insert succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(LINK_SQL, linkParams(s));
      expect(await refused(c, LINK_SQL, linkParams(s, { session: `cs_test_2_${RUN}` })))
        .toMatchObject({ code: "23505", constraint: "billing_links_pkey" });
      expect(await refused(c, LINK_SQL, linkParams(s, { account: s.b, session: `cs_test_3_${RUN}` })))
        .toMatchObject({ code: "23505", constraint: "billing_links_stripe_customer_id_key" });
    }));

  it("a plan with a pending link cannot be deleted (plans are archived, never deleted) (mutation: plan_id on delete cascade → the delete succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(LINK_SQL, linkParams(s));
      expect(await refused(c, "delete from plans where id = $1", [s.plan])).toMatchObject({ code: "23503" });
    }));
});

describe("0052 account_billing: the billing start and the period start", () => {
  it("billing_started_at defaults to now() and can never be null; current_period_start is optional (mutation: drop the default → the fixture insert FAILS with 23502; drop NOT NULL → the update to null succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("insert into account_billing (account_id, plan_id) values ($1, $2)", [s.a, s.plan]);
      const { rows: [row] } = await c.query<{ started_ok: boolean; period_start: string | null }>(
        `select billing_started_at between now() - interval '1 minute' and now() as started_ok,
                current_period_start as period_start
           from account_billing where account_id = $1`, [s.a]);
      expect(row).toEqual({ started_ok: true, period_start: null });
      expect(await refused(c, "update account_billing set billing_started_at = null where account_id = $1", [s.a]))
        .toMatchObject({ code: "23502" });
    }));
});

describe("0052 billing_links, live: the account's own deletion carries its link away", () => {
  it("a link cascades with its account, so it needs no ACCOUNT_OWNED_TABLES entry (mutation: account_id on delete restrict → withTestAccount's teardown FAILS; drop the cascade → the orphan read finds the row, FAILS)", async () => {
    const db = serviceDb();
    const { data: agency, error: agErr } = await db.from("agencies").select("id").limit(1).single();
    expect(agErr).toBeNull();
    const { data: plan, error: planErr } = await db.from("plans").insert({
      agency_id: (agency as { id: string }).id, name: `Link cascade ${RUN}`, monthly_price_cents: 4900,
      features: FEATURES, allowances: ZERO, overage_cents: ZERO,
      stripe_product_id: "prod_t_link_cascade", stripe_price_ids: PRICE_IDS,
    }).select("id").single();
    expect(planErr).toBeNull();
    const planId = (plan as { id: string }).id;
    let accountId = "";
    let bodyOk = false;
    try {
      await withTestAccount(async (tdb, id) => {
        accountId = id;
        const { error } = await tdb.from("billing_links").insert({
          account_id: id, plan_id: planId, stripe_customer_id: `cus_t_cascade_${RUN}`,
          checkout_session_id: `cs_test_cascade_${RUN}`, checkout_url: "https://checkout.stripe.com/c/pay/x",
          sent_to: "owner@example.com", expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        });
        expect(error).toBeNull();
      });
      const { data: left, error } = await db.from("billing_links").select("account_id").eq("account_id", accountId);
      expect(error).toBeNull();
      expect(left).toEqual([]);
      bodyOk = true;
    } finally {
      const { error } = await db.from("plans").delete().eq("id", planId);
      if (error) {
        const msg = `billing-checkout-schema cleanup failed on plans: ${error.message}`;
        if (bodyOk) throw new Error(msg);
        console.error(msg);
      }
    }
  });
});
