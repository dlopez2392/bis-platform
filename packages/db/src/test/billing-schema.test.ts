import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";

/**
 * 0051 (M7a billing, rollout step 1) at the level that can see it: real SQL
 * inside a rolled-back transaction for grants, RLS and constraints, and
 * serviceDb() under withTestAccount for the one behaviour a rollback cannot
 * show (the account-delete cascade). A unit test that mocks the db is blind
 * to every assertion in this file.
 *
 * Money tier: every test names the mutation that turns it red.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_BILL_${label}_${RUN}`;

const TABLES = ["plans", "account_billing", "usage_events", "stripe_webhook_events"] as const;
const CLIENT_SELECTABLE = ["plans", "account_billing", "usage_events"] as const;

const FEATURES = { voice_receptionist: true, web_concierge: false };
const ALLOWANCES = { voice_minutes: 500, sms: 1000, ai_chats: 200 };
const OVERAGE = { voice_minutes: 12, sms: 3, ai_chats: 25 };
const PRICE_IDS = { base: "price_t_base", voice_minutes: "price_t_vm", sms: "price_t_sms", ai_chats: "price_t_ai" };

const SERVICE_ROLE_ALL = ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]
  .map((privilege_type) => ({ grantee: "service_role", privilege_type }));

type Seeded = { agencyId: string; a: string; b: string; off: string; plan: string };

/** Three accounts (A and B with client access on, OFF with it off), one
 *  plan, a billing row and a usage row for EACH account, one webhook event.
 *  Every RLS assertion below therefore has a foreign row present to leak. */
async function seed(c: Client): Promise<Seeded> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const mk = async (label: string, access: boolean) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,$4) returning id",
    [agency!.id, orgId(label), `Billing ${label}`, access])).rows[0]!.id;
  const a = await mk("A", true);
  const b = await mk("B", true);
  const off = await mk("OFF", false);
  const plan = (await c.query<{ id: string }>(
    `insert into plans (agency_id, name, monthly_price_cents, features, allowances, overage_cents,
                        stripe_product_id, stripe_price_ids)
       values ($1, $2, 4900, $3, $4, $5, 'prod_t_1', $6) returning id`,
    [agency!.id, `Growth ${RUN}`, JSON.stringify(FEATURES), JSON.stringify(ALLOWANCES),
      JSON.stringify(OVERAGE), JSON.stringify(PRICE_IDS)])).rows[0]!.id;
  for (const acct of [a, b, off]) {
    await c.query("insert into account_billing (account_id, plan_id) values ($1,$2)", [acct, plan]);
    await c.query(
      "insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,'sms',2,now(),$2)",
      [acct, `message:${acct}`]);
  }
  await c.query("insert into stripe_webhook_events (event_id, type) values ($1,'invoice.paid')", [`evt_t_${RUN}`]);
  return { agencyId: agency!.id, a, b, off, plan };
}

const PLAN_SQL = `insert into plans (agency_id, name, monthly_price_cents, currency, features, allowances,
                                     overage_cents, stripe_product_id, stripe_price_ids)
                  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

type PlanOverrides = Partial<{
  name: string; cents: number; currency: string; features: unknown; allowances: unknown;
  overage: unknown; product: string; prices: unknown;
}>;

function planParams(agencyId: string, name: string, over: PlanOverrides = {}): unknown[] {
  return [agencyId, over.name ?? name, over.cents ?? 4900, over.currency ?? "usd",
    JSON.stringify(over.features ?? FEATURES), JSON.stringify(over.allowances ?? ALLOWANCES),
    JSON.stringify(over.overage ?? OVERAGE), over.product ?? "prod_t_2", JSON.stringify(over.prices ?? PRICE_IDS)];
}

/** Each statement in its own savepoint, so one refusal cannot hide the next. */
async function verdicts(c: Client, cases: Record<string, [string, unknown[]]>): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  for (const [label, [sql, params]] of Object.entries(cases)) {
    await c.query("savepoint v");
    try { await c.query(sql, params); out[label] = undefined; }
    catch (e) { out[label] = (e as { code?: string }).code; }
    await c.query("rollback to savepoint v");
  }
  return out;
}

describe("0051 tables exist (guards every assertion below from vacuity)", () => {
  for (const table of TABLES) {
    it(`${table} exists`, () => withRollback(async (c) => {
      const { rows } = await c.query<{ oid: string | null }>(`select to_regclass('public.${table}')::text as oid`);
      expect(rows[0]!.oid?.replace(/^public\./, "")).toBe(table);
    }));
  }
});

describe("0051 grants", () => {
  for (const table of CLIENT_SELECTABLE) {
    // EXACT set, not containment: the default ACL hands TRUNCATE to
    // authenticated on every new table (call-proposals-grants.test.ts).
    it(`${table}: authenticated holds EXACTLY select (mutation: grant insert on ${table} to authenticated → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select grantee, privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee = 'authenticated' order by privilege_type`, [table]);
        expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
      }));
  }

  it("stripe_webhook_events: authenticated holds nothing (mutation: grant select on it to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'stripe_webhook_events' and grantee = 'authenticated'`);
      expect(rows).toEqual([]);
    }));

  for (const table of TABLES) {
    it(`${table}: anon holds nothing (mutation: drop the revoke from anon → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee = 'anon'`, [table]);
        expect(rows).toEqual([]);
      }));

    // role_table_grants does not report MAINTAIN at all; has_table_privilege
    // reads the real ACL. The only assertion here that can see PG17's `m` bit.
    it(`${table}: neither authenticated nor anon holds MAINTAIN (mutation: enumerate the revoke like 0025 → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query<{ auth: boolean; anon: boolean }>(
          `select has_table_privilege('authenticated', 'public.${table}', 'MAINTAIN') as auth,
                  has_table_privilege('anon', 'public.${table}', 'MAINTAIN') as anon`);
        expect(rows[0]).toEqual({ auth: false, anon: false });
      }));

    it(`${table}: the whole grant set across every role but postgres (mutation: grant select on ${table} to public → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select grantee, privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee <> 'postgres' order by grantee, privilege_type`, [table]);
        const authenticated = table === "stripe_webhook_events" ? [] : [{ grantee: "authenticated", privilege_type: "SELECT" }];
        expect(rows).toEqual([...authenticated, ...SERVICE_ROLE_ALL]);
      }));

    it(`${table}: row level security is on (mutation: drop its enable row level security → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query<{ relrowsecurity: boolean }>(
          `select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`);
        expect(rows[0]!.relrowsecurity).toBe(true);
      }));
  }
});

describe("0051 RLS reads: a foreign row is PRESENT in every case", () => {
  it("a client reads only its own account_billing row (mutation: account_billing_tenant USING (true) → FAILS, sees B and OFF)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      const { rows } = await c.query<{ account_id: string }>("select account_id from account_billing");
      expect(rows.map((r) => r.account_id)).toEqual([s.a]);
    }));

  it("a client reads only its own usage rows (mutation: usage_events_tenant USING (true) → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      const { rows } = await c.query("select account_id, quantity from usage_events");
      expect(rows).toEqual([{ account_id: s.a, quantity: 2 }]);
    }));

  it("a client reads no plans at all (mutation: plans_agency_read USING (true) → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { rows: asOwner } = await c.query("select id from plans where id = $1", [s.plan]);
      expect(asOwner).toHaveLength(1); // the plan IS there to leak
      await actAs(c, { org_id: orgId("A") });
      const { rows } = await c.query("select id from plans");
      expect(rows).toEqual([]);
    }));

  it("a client whose access is switched off reads neither billing nor usage (mutation: policy matches org_id directly instead of app.current_account_id() → FAILS)", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, { org_id: orgId("OFF") });
      const billing = await c.query("select account_id from account_billing");
      const usage = await c.query("select account_id from usage_events");
      expect([billing.rows, usage.rows]).toEqual([[], []]);
    }));

  it("the agency reads every account's billing and usage rows, and the plan (mutation: drop app.is_agency() from a policy → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { app_role: "agency_admin" });
      const ids = [s.a, s.b, s.off];
      const billing = await c.query("select account_id from account_billing where account_id = any($1::uuid[])", [ids]);
      const usage = await c.query("select account_id from usage_events where account_id = any($1::uuid[])", [ids]);
      const plan = await c.query("select id from plans where id = $1", [s.plan]);
      expect([billing.rows.length, usage.rows.length, plan.rows.length]).toEqual([3, 3, 1]);
    }));

  // ONE refused statement per withRollback: the abort would hide the reason of any later one.
  it("a client cannot SELECT stripe_webhook_events: 42501 (mutation: grant select on it to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("select event_id from stripe_webhook_events")).rejects.toMatchObject({ code: "42501" });
    }));

  it("the agency cannot SELECT stripe_webhook_events either (service role only): 42501", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, { app_role: "agency_admin" });
      await expect(c.query("select event_id from stripe_webhook_events")).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0051 writes: only service_role writes (42501, the GRANT refusing, never 'an error')", () => {
  it("a client cannot INSERT a plan (mutation: grant insert on plans to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query(PLAN_SQL, planParams(s.agencyId, `Client ${RUN}`))).rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot UPDATE a plan's price (mutation: grant update on plans to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("update plans set monthly_price_cents = 100 where id = $1", [s.plan]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  it("even the agency's own JWT cannot INSERT a plan directly: writes go through serviceDb() after requireAgency() (mutation: grant insert on plans to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { app_role: "agency_admin" });
      await expect(c.query(PLAN_SQL, planParams(s.agencyId, `Agency ${RUN}`))).rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot mark its own account complimentary (mutation: grant update on account_billing to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("update account_billing set complimentary = true where account_id = $1", [s.a]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot INSERT usage for its own account (mutation: grant insert on usage_events to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query(
        "insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,'sms',1,now(),'message:forged')", [s.a],
      )).rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot DELETE its own usage (erasing its bill) (mutation: grant delete on usage_events to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("delete from usage_events where account_id = $1", [s.a]))
        .rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0051 constraints (23514 check, 23505 unique, 23503 foreign key)", () => {
  it("plans: every malformed field is refused, and the valid control row is not (mutation: delete any one CHECK → its rows turn undefined, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const cases: Record<string, PlanOverrides> = {
        "the valid control row": {},
        "a currency other than usd": { currency: "eur" },
        "a monthly price under 50 cents": { cents: 49 },
        "a monthly price over $10,000": { cents: 1000001 },
        "a name with surrounding spaces": { name: " Padded " },
        "an empty name": { name: "" },
        "features missing web_concierge": { features: { voice_receptionist: true } },
        "features with an extra key": { features: { ...FEATURES, sms: true } },
        "a feature that is not a boolean": { features: { voice_receptionist: "yes", web_concierge: false } },
        "features that are an array": { features: [true, false] },
        "a negative allowance": { allowances: { ...ALLOWANCES, sms: -1 } },
        "a fractional allowance": { allowances: { ...ALLOWANCES, sms: 1.5 } },
        "an allowance written as a string": { allowances: { ...ALLOWANCES, sms: "5" } },
        "an allowance over a million": { allowances: { ...ALLOWANCES, voice_minutes: 1000001 } },
        "allowances missing ai_chats": { allowances: { voice_minutes: 1, sms: 1 } },
        "allowances with an unknown meter": { allowances: { ...ALLOWANCES, email: 1 } },
        "an overage over $100 a unit": { overage: { ...OVERAGE, sms: 10001 } },
        "a negative overage": { overage: { ...OVERAGE, ai_chats: -1 } },
        "price ids missing ai_chats": { prices: { base: "price_a", voice_minutes: "price_b", sms: "price_c" } },
        "a price id that is not a Stripe price": { prices: { ...PRICE_IDS, base: "prod_x" } },
        "a product id that is not a Stripe product": { product: "price_x" },
      };
      // Built imperatively: a .map() returning [label, [sql, params]] infers
      // an array, not a tuple, and would not typecheck as the verdicts input.
      const statements: Record<string, [string, unknown[]]> = {};
      Object.entries(cases).forEach(([label, over], i) => {
        statements[label] = [PLAN_SQL, planParams(s.agencyId, `V${i} ${RUN}`, over)];
      });
      const result = await verdicts(c, statements);
      expect(result).toEqual(Object.fromEntries(Object.keys(cases).map((label) =>
        [label, label === "the valid control row" ? undefined : "23514"])));
    }));

  it("account_billing: complimentary is never paused or subscribed; status and subscription travel together; ids are Stripe-shaped (mutation: delete any one CHECK → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const on = (set: string): [string, unknown[]] => [`update account_billing set ${set} where account_id = $1`, [s.a]];
      const result = await verdicts(c, {
        "the valid control: an active subscription": on("stripe_customer_id = 'cus_t', stripe_subscription_id = 'sub_t', subscription_status = 'active'"),
        "the valid control: complimentary with no subscription": on("complimentary = true"),
        "complimentary with a Stripe subscription": on("complimentary = true, stripe_subscription_id = 'sub_t2', subscription_status = 'active'"),
        "complimentary and paused": on("complimentary = true, billing_paused_at = now()"),
        "a status Stripe does not have": on("stripe_subscription_id = 'sub_t3', subscription_status = 'paid'"),
        "a status without a subscription": on("subscription_status = 'active'"),
        "a subscription without a status": on("stripe_subscription_id = 'sub_t4'"),
        "a customer id that is not a Stripe customer": on("stripe_customer_id = 'sub_x'"),
        "a subscription id that is not a Stripe subscription": on("stripe_subscription_id = 'cus_x', subscription_status = 'active'"),
      });
      expect(result).toEqual({
        "the valid control: an active subscription": undefined,
        "the valid control: complimentary with no subscription": undefined,
        "complimentary with a Stripe subscription": "23514",
        "complimentary and paused": "23514",
        "a status Stripe does not have": "23514",
        "a status without a subscription": "23514",
        "a subscription without a status": "23514",
        "a customer id that is not a Stripe customer": "23514",
        "a subscription id that is not a Stripe subscription": "23514",
      });
    }));

  it("usage_events: quantity is positive, the meter is one of three (ai_chats, not ai_chat), source_ref is not empty (mutation: delete any one CHECK → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const ins = (meter: string, qty: number, ref: string): [string, unknown[]] => [
        "insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,$2,$3,now(),$4)",
        [s.a, meter, qty, ref]];
      const result = await verdicts(c, {
        "the valid control": ins("voice_minutes", 3, "call:ctl"),
        "a zero quantity": ins("voice_minutes", 0, "call:zero"),
        "a negative quantity": ins("voice_minutes", -3, "call:neg"),
        "an unmetered channel": ins("email", 1, "email:1"),
        "the singular spelling ai_chat": ins("ai_chat", 1, "conversation:1"),
        "an empty source_ref": ins("sms", 1, ""),
      });
      expect(result).toEqual({
        "the valid control": undefined, "a zero quantity": "23514", "a negative quantity": "23514",
        "an unmetered channel": "23514", "the singular spelling ai_chat": "23514", "an empty source_ref": "23514",
      });
    }));

  it("usage_events: one source counts once per meter, even from another account: 23505 (mutation: add account_id to the unique key → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(
        "insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,'sms',1,now(),$2)",
        [s.b, `message:${s.a}`],
      )).rejects.toMatchObject({ code: "23505" });
    }));

  it("usage_events: the same source on a DIFFERENT meter is allowed (mutation: unique on source_ref alone → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(
        "insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,'voice_minutes',1,now(),$2)",
        [s.a, `message:${s.a}`],
      )).resolves.toMatchObject({ rowCount: 1 });
    }));

  it("a plan with billed accounts cannot be deleted: 23503 (mutation: on delete cascade → FAILS, and would silently unbill three accounts)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query("delete from plans where id = $1", [s.plan])).rejects.toMatchObject({ code: "23503" });
    }));

  it("a plan name is unique per agency: 23505 (mutation: drop plans_agency_name_key → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(PLAN_SQL, planParams(s.agencyId, `Growth ${RUN}`)))
        .rejects.toMatchObject({ code: "23505" });
    }));
});

describe("0051 cascade, live (serviceDb under withTestAccount)", () => {
  it("deleting an account deletes its billing row and its usage rows (mutation: on delete restrict on either → teardown throws, FAILS)", async () => {
    const db = serviceDb();
    const { data: agency, error: agErr } = await db.from("agencies").select("id").limit(1).single();
    expect(agErr).toBeNull();
    const { data: plan, error: planErr } = await db.from("plans").insert({
      agency_id: (agency as { id: string }).id, name: `Cascade ${RUN}`, monthly_price_cents: 4900,
      features: FEATURES, allowances: ALLOWANCES, overage_cents: OVERAGE,
      stripe_product_id: "prod_t_cascade", stripe_price_ids: PRICE_IDS,
    }).select("id").single();
    expect(planErr).toBeNull();
    const planId = (plan as { id: string }).id;
    let accountId = "";
    try {
      await withTestAccount(async (tdb, id) => {
        accountId = id;
        expect((await tdb.from("account_billing").insert({ account_id: id, plan_id: planId })).error).toBeNull();
        expect((await tdb.from("usage_events").insert({
          account_id: id, meter: "sms", quantity: 1, occurred_at: new Date().toISOString(), source_ref: `message:cascade:${RUN}`,
        })).error).toBeNull();
      });
      expect(accountId).not.toBe("");
      for (const table of ["account_billing", "usage_events"]) {
        const { data, error } = await db.from(table).select("account_id").eq("account_id", accountId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    } finally {
      // plans is agency-scoped, so it cannot ride withTestAccount's account
      // loop; and a swallowed delete error strands the row for the next run.
      const { error: delErr } = await db.from("plans").delete().eq("id", planId);
      if (delErr) throw new Error(`billing-schema cleanup failed on plans: ${delErr.message}`);
    }
  });
});
