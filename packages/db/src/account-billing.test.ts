import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decideMirror, mirrorSubscription, markComplimentary, unmarkComplimentary, changeComplimentaryPlan,
  claimWebhookEvent, saveBillingLink,
  type AccountBilling, type SubscriptionSnapshot,
} from "./account-billing";

/**
 * account-billing.ts without a database: the mirror's decisions (pure), and
 * the exact writes around them. The live round trips are
 * ./test/account-billing.test.ts.
 */
const NOW = new Date("2026-10-01T12:00:00.000Z");
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const AGENCY = "33333333-3333-4333-8333-333333333333";
const START = 1_790_000_000; // seconds
const iso = (sec: number) => new Date(sec * 1000).toISOString();

const snap = (over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
  id: "sub_1", customerId: "cus_1", status: "active", accountId: ACCOUNT, planId: PLAN,
  currentPeriodStart: START, currentPeriodEnd: START + 2_592_000, startedAt: START,
  items: [], ...over,
});
const stored = (over: Partial<AccountBilling> = {}): AccountBilling => ({
  accountId: ACCOUNT, planId: PLAN, complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: null, currentPeriodEnd: null, pastDueSince: null,
  billingPausedAt: null, billingStartedAt: "2026-09-01T00:00:00.123456+00:00",
  createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00", ...over,
});
const base = {
  account: { id: ACCOUNT, agencyId: AGENCY },
  plan: { id: PLAN, agencyId: AGENCY, features: { voice_receptionist: true, web_concierge: false } },
  link: { stripeCustomerId: "cus_1" } as { stripeCustomerId: string } | null,
  existing: null as AccountBilling | null,
  now: NOW,
};

describe("decideMirror: a subscription BIS made becomes the billed row", () => {
  it("writes a NEW row from Stripe's own values: billing starts at the subscription's start_date, the period from its items, the plan's features as permissions (mutation: billing_started_at = now → FAILS; period from now → FAILS)", () => {
    const d = decideMirror({ ...base, snapshot: snap() });
    expect(d).toEqual({
      kind: "write",
      permissions: { voice_receptionist: true, web_concierge: false },
      row: {
        account_id: ACCOUNT, plan_id: PLAN, complimentary: false, stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1", subscription_status: "active",
        current_period_start: iso(START), current_period_end: iso(START + 2_592_000),
        past_due_since: null, billing_started_at: iso(START), updated_at: NOW.toISOString(),
      },
    });
  });

  it("keeps the stored billing start, microseconds and all, for the SAME subscription; a NEW subscription after an ended one starts afresh; updated_at (the B5 version) always moves, even within the stored millisecond (mutation: always use start_date → FAILS; always keep the stored start → FAILS; write updated_at = now unconditionally → the same-millisecond write leaves the version unchanged, FAILS)", () => {
    const same = decideMirror({ ...base, existing: stored({ updatedAt: "2026-10-01T12:00:00.000456+00:00" }), snapshot: snap() });
    expect(same.kind === "write" && same.row.billing_started_at).toBe("2026-09-01T00:00:00.123456+00:00");
    expect(same.kind === "write" && same.row.updated_at).toBe("2026-10-01T12:00:00.001Z");
    const renewed = decideMirror({
      ...base, existing: stored({ stripeSubscriptionId: "sub_old", subscriptionStatus: "canceled" }),
      snapshot: snap({ startedAt: START + 99 }),
    });
    expect(renewed.kind === "write" && renewed.row.billing_started_at).toBe(iso(START + 99));
  });

  it("turns a complimentary row into a paid one, with the billing start moved to the subscription's start (G1) (mutation: keep complimentary true → FAILS; keep the complimentary start → FAILS)", () => {
    const d = decideMirror({
      ...base,
      existing: stored({ complimentary: true, stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: null }),
      snapshot: snap(),
    });
    expect(d.kind === "write" && [d.row.complimentary, d.row.billing_started_at]).toEqual([false, iso(START)]);
  });
});

describe("decideMirror: past_due_since (G8)", () => {
  it("stamps now on the first unpaid read, keeps the earlier stamp while still unpaid, clears it once paid (mutation: always stamp now → FAILS; never clear → FAILS)", () => {
    const first = decideMirror({ ...base, existing: stored(), snapshot: snap({ status: "past_due" }) });
    expect(first.kind === "write" && first.row.past_due_since).toBe(NOW.toISOString());
    const later = decideMirror({
      ...base, existing: stored({ subscriptionStatus: "past_due", pastDueSince: "2026-09-28T00:00:00+00:00" }),
      snapshot: snap({ status: "unpaid" }),
    });
    expect(later.kind === "write" && later.row.past_due_since).toBe("2026-09-28T00:00:00+00:00");
    const paid = decideMirror({
      ...base, existing: stored({ subscriptionStatus: "past_due", pastDueSince: "2026-09-28T00:00:00+00:00" }),
      snapshot: snap({ status: "active" }),
    });
    expect(paid.kind === "write" && paid.row.past_due_since).toBeNull();
  });
});

describe("decideMirror: named refusals (G7, G10)", () => {
  it("refuses a subscription whose customer is neither the stored nor the linked one: a hand-made subscription with a guessed bis_account_id never lands on an account (mutation: drop the customer check → FAILS)", () => {
    expect(decideMirror({ ...base, link: null, snapshot: snap({ customerId: "cus_other" }) }))
      .toEqual({ kind: "refused", reason: "customer_mismatch" });
  });

  it("once the billed row holds a customer, only THAT customer's subscription is accepted, even when a newer link names another (G3) (mutation: accept the stored OR the linked customer → the link's customer overwrites stripe_customer_id, FAILS)", () => {
    expect(decideMirror({
      ...base, existing: stored({ stripeCustomerId: "cus_A", subscriptionStatus: "canceled" }),
      link: { stripeCustomerId: "cus_B" }, snapshot: snap({ id: "sub_2", customerId: "cus_B" }),
    })).toEqual({ kind: "refused", reason: "customer_changed" });
  });

  it("refuses a DIFFERENT subscription while the stored one is not ended, and accepts it once the stored one is canceled (mutation: drop the live-subscription guard → FAILS)", () => {
    expect(decideMirror({ ...base, existing: stored({ subscriptionStatus: "past_due" }), snapshot: snap({ id: "sub_2" }) }))
      .toEqual({ kind: "refused", reason: "another_live_subscription" });
    expect(decideMirror({ ...base, existing: stored({ subscriptionStatus: "canceled" }), snapshot: snap({ id: "sub_2" })}).kind)
      .toBe("write");
  });

  it("refuses an ENDED subscription that is not the stored one and started BEFORE it, so a late event for an old canceled subscription never replaces a newer ended one (id rewritten, billing start moved backwards); a live replacement and the stored subscription's own end are still written (review minor d) (mutation: drop the ended-other guard → the old subscription is written, FAILS; compare the wrong way → FAILS)", () => {
    const newerEnded = stored({ stripeSubscriptionId: "sub_new", subscriptionStatus: "canceled", billingStartedAt: iso(START + 500) });
    expect(decideMirror({ ...base, existing: newerEnded, snapshot: snap({ id: "sub_old", status: "canceled" }) }))
      .toEqual({ kind: "refused", reason: "ended_other_subscription" });
    expect(decideMirror({ ...base, existing: newerEnded, snapshot: snap({ id: "sub_old", status: "incomplete_expired" }) }))
      .toEqual({ kind: "refused", reason: "ended_other_subscription" });
    expect(decideMirror({ ...base, existing: newerEnded, snapshot: snap({ id: "sub_3", status: "active" }) }).kind).toBe("write");
    expect(decideMirror({ ...base, existing: stored({ subscriptionStatus: "active" }), snapshot: snap({ status: "canceled" }) }).kind)
      .toBe("write");
  });

  it("refuses an unknown account, an unknown plan, a plan of another agency, and a status BIS does not know (mutation: drop the agency check → FAILS; cast the status → FAILS)", () => {
    expect(decideMirror({ ...base, account: null, snapshot: snap() })).toEqual({ kind: "refused", reason: "unknown_account" });
    expect(decideMirror({ ...base, plan: null, snapshot: snap() })).toEqual({ kind: "refused", reason: "unknown_plan" });
    expect(decideMirror({ ...base, plan: { ...base.plan, agencyId: "44444444-4444-4444-8444-444444444444" }, snapshot: snap() }))
      .toEqual({ kind: "refused", reason: "plan_other_agency" });
    expect(decideMirror({ ...base, snapshot: snap({ status: "on_hold" }) })).toEqual({ kind: "refused", reason: "unknown_status" });
  });
});

/** A 23505 exactly as PostgREST relays Postgres's: the constraint named in
 *  quotes in the message (billing.ts's uniqueViolation reads the same text). */
const unique = (constraint: string) => ({
  code: "23505", message: `duplicate key value violates unique constraint "${constraint}"`,
});

/** A fake PostgREST that records every call and answers each read from `reads`. */
function recorder(reads: Record<string, unknown>) {
  const calls: unknown[][] = [];
  const db = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const rec = (op: string) => (...args: unknown[]) => { calls.push([table, op, ...args]); return chain; };
      for (const op of ["select", "eq", "is", "delete", "update"]) chain[op] = rec(op);
      chain.upsert = (...args: unknown[]) => { calls.push([table, "upsert", ...args]); return Promise.resolve({ error: null }); };
      chain.insert = (...args: unknown[]) => { calls.push([table, "insert", ...args]); return Promise.resolve({ error: null }); };
      chain.maybeSingle = () => Promise.resolve({ data: reads[table] ?? null, error: null });
      chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("mirrorSubscription: the writes", () => {
  it("refuses a subscription with no uuid bis_account_id BEFORE reading the database (mutation: drop the uuid check → the database is read, FAILS)", async () => {
    const { db, calls } = recorder({});
    expect(await mirrorSubscription(db, async () => snap({ accountId: "acct_x" }), () => NOW)).toEqual({ kind: "refused", reason: "no_account" });
    expect(calls).toEqual([]);
  });

  it("with no stored row it INSERTS (never an upsert: B5), then writes EXACTLY the plan's two features into accounts.permissions, then consumes the link it led to, keyed by account, customer AND session (mutation: drop writePermissions' filter, the ONLY one since decideMirror passes the plan's features through → FAILS; delete the link by account alone → FAILS; drop the session filter → FAILS)", async () => {
    const { db, calls } = recorder({
      accounts: { id: ACCOUNT, agency_id: AGENCY },
      plans: { id: PLAN, agency_id: AGENCY, features: { voice_receptionist: true, web_concierge: false, extra: true }, archived_at: null },
      // Sent BEFORE the subscription started (START, 2026-09-21T14:13:20Z):
      // this is the subscription the link led to.
      billing_links: {
        account_id: ACCOUNT, plan_id: PLAN, stripe_customer_id: "cus_1", checkout_session_id: "cs_1",
        checkout_url: "https://x", sent_to: "a@b.co", expires_at: "2026-10-02T00:00:00+00:00",
        sent_at: "2026-09-20T00:00:00+00:00", updated_at: "2026-09-20T00:00:00+00:00",
      },
    });
    expect(await mirrorSubscription(db, async () => snap(), () => NOW)).toEqual({ kind: "written", accountId: ACCOUNT, planId: PLAN, status: "active" });
    const at = (table: string, op: string) => calls.findIndex((c) => c[0] === table && c[1] === op);
    const insert = at("account_billing", "insert");
    const perms = at("accounts", "update");
    const del = at("billing_links", "delete");
    expect(calls[insert]).toEqual(["account_billing", "insert",
      expect.objectContaining({ account_id: ACCOUNT, stripe_subscription_id: "sub_1", updated_at: NOW.toISOString() })]);
    expect(calls.some((c) => c[1] === "upsert")).toBe(false);
    expect(calls[perms]).toEqual(["accounts", "update", { permissions: { voice_receptionist: true, web_concierge: false } }]);
    expect(insert).toBeGreaterThan(-1);
    expect(perms).toBeGreaterThan(insert);
    expect(del).toBeGreaterThan(perms);
    expect(calls.slice(del + 1, del + 4)).toEqual([
      ["billing_links", "eq", "account_id", ACCOUNT], ["billing_links", "eq", "stripe_customer_id", "cus_1"],
      ["billing_links", "eq", "checkout_session_id", "cs_1"],
    ]);
  });

  it("B5: the stored row is read BEFORE Stripe and written only while unchanged; losing that race re-reads both, so an EARLIER read of Stripe never overwrites a LATER one (mutation: update without the updated_at condition → the stale 'incomplete' is written, FAILS; read the row after asking Stripe → the order FAILS)", async () => {
    const V0 = "2026-10-01T11:00:00+00:00";
    const V1 = "2026-10-01T11:59:59.5+00:00";
    const dbRow = (updatedAt: string, status: string) => ({
      account_id: ACCOUNT, plan_id: PLAN, complimentary: false, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1",
      subscription_status: status, current_period_start: null, current_period_end: null, past_due_since: null,
      billing_paused_at: null, billing_started_at: "2026-09-01T00:00:00+00:00", created_at: "2026-09-01T00:00:00+00:00",
      updated_at: updatedAt,
    });
    let stored: Record<string, unknown> = dbRow(V0, "incomplete");
    const log: string[] = [];
    const writes: { status: unknown; version: unknown }[] = [];
    const db = {
      from: (table: string) => {
        const filters: [string, unknown][] = [];
        let patch: Record<string, unknown> | null = null;
        const chain: Record<string, unknown> = {
          select: () => chain, delete: () => chain,
          eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
          update: (p: Record<string, unknown>) => { patch = p; return chain; },
          insert: async () => ({ error: null }),
          maybeSingle: async () => {
            if (table === "account_billing") { log.push("row"); return { data: { ...stored }, error: null }; }
            if (table === "accounts") return { data: { id: ACCOUNT, agency_id: AGENCY }, error: null };
            if (table === "plans") {
              return { data: { id: PLAN, agency_id: AGENCY, features: { voice_receptionist: true, web_concierge: false }, archived_at: null }, error: null };
            }
            return { data: null, error: null };
          },
          then: (ok: (v: unknown) => unknown) => {
            let result: { data: unknown[]; error: null } = { data: [], error: null };
            if (table === "account_billing" && patch) {
              const version = filters.find(([c]) => c === "updated_at")?.[1];
              writes.push({ status: patch.subscription_status, version });
              if (version === undefined || version === stored.updated_at) {
                stored = { ...stored, ...patch };
                result = { data: [{ account_id: ACCOUNT }], error: null };
              }
            }
            return Promise.resolve(result).then(ok);
          },
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    // Stripe: the first read only names the account; the second is THIS
    // delivery's (stale) read; right after it, another delivery that read
    // Stripe LATER ("active") lands its write first; the third is the retry.
    const answers = [snap({ status: "incomplete" }), snap({ status: "incomplete" }), snap({ status: "active" })];
    let n = 0;
    const read = async () => {
      log.push("stripe");
      const s = answers[Math.min(n, answers.length - 1)]!;
      n += 1;
      if (n === 2) stored = dbRow(V1, "active");
      return s;
    };
    expect(await mirrorSubscription(db, read, () => NOW)).toEqual({ kind: "written", accountId: ACCOUNT, planId: PLAN, status: "active" });
    expect(log).toEqual(["stripe", "row", "stripe", "row", "stripe"]);
    expect(writes).toEqual([{ status: "incomplete", version: V0 }, { status: "active", version: V1 }]);
    expect(stored.subscription_status).toBe("active");
  });
});

/**
 * A small stateful "database" for the first-checkout races: one
 * account_billing row (or none), one billing link (or none), and a log of
 * every row read and every write attempt. `concurrent` is what ANOTHER
 * delivery writes; the tests call it from inside the Stripe reader, i.e.
 * between this delivery's row read and its write.
 */
function world(opts: {
  row?: Record<string, unknown> | null; updatesNeverMatch?: boolean; insertRefusedOn?: string;
  link?: Record<string, unknown>;
} = {}) {
  const state: { row: Record<string, unknown> | null; link: Record<string, unknown> | null } = {
    row: opts.row ?? null,
    // By default the first checkout's link: sent BEFORE START, the subscription's start.
    link: {
      account_id: ACCOUNT, plan_id: PLAN, stripe_customer_id: "cus_1", checkout_session_id: "cs_1",
      checkout_url: "https://checkout.stripe.com/x", sent_to: "a@b.co", expires_at: "2026-10-02T00:00:00+00:00",
      sent_at: "2026-09-20T00:00:00+00:00", updated_at: "2026-09-20T00:00:00+00:00",
      ...opts.link,
    },
  };
  const log: string[] = [];
  /** The filters of every billing_links delete, in order. */
  const linkDeletes: [string, unknown][][] = [];
  const db = {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let patch: Record<string, unknown> | null = null;
      let del = false;
      const chain: Record<string, unknown> = {
        select: () => chain,
        delete: () => { del = true; return chain; },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
        update: (p: Record<string, unknown>) => { patch = p; return chain; },
        insert: async (r: Record<string, unknown>) => {
          log.push("insert");
          if (opts.insertRefusedOn) return { error: unique(opts.insertRefusedOn) };
          if (state.row) return { error: unique("account_billing_pkey") };
          state.row = { ...r };
          return { error: null };
        },
        maybeSingle: async () => {
          if (table === "account_billing") { log.push("row"); return { data: state.row ? { ...state.row } : null, error: null }; }
          if (table === "billing_links") return { data: state.link ? { ...state.link } : null, error: null };
          if (table === "accounts") return { data: { id: ACCOUNT, agency_id: AGENCY }, error: null };
          if (table === "plans") {
            return { data: { id: PLAN, agency_id: AGENCY, features: { voice_receptionist: true, web_concierge: false }, archived_at: null }, error: null };
          }
          return { data: null, error: null };
        },
        then: (ok: (v: unknown) => unknown) => {
          let result: { data: unknown[]; error: null } = { data: [], error: null };
          if (table === "account_billing" && patch) {
            const version = filters.find(([c]) => c === "updated_at")?.[1];
            log.push(`update@${String(version)}`);
            if (!opts.updatesNeverMatch && state.row && (version === undefined || version === state.row.updated_at)) {
              state.row = { ...state.row, ...patch };
              result = { data: [{ account_id: ACCOUNT }], error: null };
            }
          }
          if (table === "billing_links" && del) {
            linkDeletes.push([...filters]);
            if (state.link && filters.every(([c, v]) => state.link?.[c] === v)) state.link = null;
          }
          return Promise.resolve(result).then(ok);
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  /** Another delivery's first write: it read Stripe EARLIER ("incomplete"). */
  const concurrent = (consumeLink: boolean) => {
    state.row = {
      account_id: ACCOUNT, plan_id: PLAN, complimentary: false, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1",
      subscription_status: "incomplete", current_period_start: null, current_period_end: null, past_due_since: null,
      billing_paused_at: null, billing_started_at: "2026-09-01T00:00:00+00:00", created_at: "2026-10-01T11:59:59+00:00",
      updated_at: "2026-10-01T11:59:59.9+00:00",
    };
    if (consumeLink) state.link = null;
  };
  return { db, state, log, concurrent, linkDeletes };
}

/** A stored paid row on `subId`, as PostgREST returns it. */
const paidRow = (subId: string, status: string, over: Record<string, unknown> = {}) => ({
  account_id: ACCOUNT, plan_id: PLAN, complimentary: false, stripe_customer_id: "cus_1", stripe_subscription_id: subId,
  subscription_status: status, current_period_start: null, current_period_end: null, past_due_since: null,
  billing_paused_at: null, billing_started_at: iso(START), created_at: iso(START), updated_at: "2026-09-30T00:00:00.123456+00:00",
  ...over,
});
/** A new link on the SAME customer (Send reuses it, G3), sent 2026-10-01, after START. */
const NEW_LINK = { checkout_session_id: "cs_NEW", sent_at: "2026-10-01T00:00:00+00:00", updated_at: "2026-10-01T00:00:00+00:00" };
const AFTER_NEW_LINK = Date.parse("2026-10-01T06:00:00Z") / 1000;

describe("mirrorSubscription: a link is consumed only by the subscription it led to (review item 1, G2)", () => {
  it("an OLD subscription's event on the reused customer writes its row but leaves the NEW open link alone, so the next Send can still find and expire it (mutation: consume whenever the customer matches → the new link is deleted and a second open session becomes possible, FAILS)", async () => {
    const w = world({ row: paidRow("sub_old", "canceled"), link: NEW_LINK });
    expect(await mirrorSubscription(w.db, async () => snap({ id: "sub_old", status: "canceled" }), () => NOW))
      .toEqual({ kind: "written", accountId: ACCOUNT, planId: PLAN, status: "canceled" });
    expect(w.linkDeletes).toEqual([]);
    expect(w.state.link?.checkout_session_id).toBe("cs_NEW");
  });

  it("the NEW subscription (started after the link was sent) consumes exactly that link: by account, customer and session (mutation: drop the session filter → FAILS)", async () => {
    const w = world({ row: paidRow("sub_old", "canceled"), link: NEW_LINK });
    expect(await mirrorSubscription(w.db, async () => snap({ id: "sub_new", startedAt: AFTER_NEW_LINK }), () => NOW))
      .toEqual({ kind: "written", accountId: ACCOUNT, planId: PLAN, status: "active" });
    expect(w.linkDeletes).toEqual([[["account_id", ACCOUNT], ["stripe_customer_id", "cus_1"], ["checkout_session_id", "cs_NEW"]]]);
    expect(w.state.link).toBeNull();
  });

  it("the link is consumed when the subscription started EXACTLY at the send instant: the rule is 'started at or after', and start_date is whole seconds (mutation: '>' instead of '>=' → the link is left, FAILS)", async () => {
    const SENT = "2026-10-01T00:00:00+00:00";
    const w = world({ link: { sent_at: SENT } });
    expect((await mirrorSubscription(w.db, async () => snap({ startedAt: Date.parse(SENT) / 1000 }), () => NOW)).kind)
      .toBe("written");
    expect(w.state.link).toBeNull();
  });

  it("a NEWER subscription that has already ended (paid, then incomplete_expired before its first event was processed) replaces an OLDER ended one and consumes its link, so a completed session never blocks Send for good (review re-check 1) (mutation: refuse every ended other subscription → the link stays and Send answers checkout_finished forever, FAILS)", async () => {
    const w = world({ row: paidRow("sub_old", "canceled"), link: NEW_LINK });
    expect(await mirrorSubscription(w.db, async () => snap({ id: "sub_new", status: "incomplete_expired", startedAt: AFTER_NEW_LINK }), () => NOW))
      .toEqual({ kind: "written", accountId: ACCOUNT, planId: PLAN, status: "incomplete_expired" });
    expect(w.state.row).toMatchObject({ stripe_subscription_id: "sub_new", billing_started_at: iso(AFTER_NEW_LINK) });
    expect(w.state.link).toBeNull();
  });

  it("a replay AFTER the row already holds the new subscription still consumes its link (a first delivery whose delete failed, or lost to a concurrent writer): the rule is the subscription's start vs the link's send, NOT 'this write changed the subscription id' (mutation: also require existing.stripeSubscriptionId !== snapshot.id → the link is never consumed, FAILS)", async () => {
    const w = world({ row: paidRow("sub_new", "active", { billing_started_at: iso(AFTER_NEW_LINK) }), link: NEW_LINK });
    expect((await mirrorSubscription(w.db, async () => snap({ id: "sub_new", startedAt: AFTER_NEW_LINK }), () => NOW)).kind)
      .toBe("written");
    expect(w.state.link).toBeNull();
  });
});

describe("mirrorSubscription: the first checkout's event burst (B5)", () => {
  it("a REFUSAL decided on a row that changed meanwhile is a conflict, not final: another delivery inserted the row AND consumed the link after this one's row read, so this attempt sees no customer anywhere; it re-reads and writes Stripe's newer state (mutation: return the refusal without re-reading the row → customer_mismatch is stamped and the row stays 'incomplete', FAILS)", async () => {
    const w = world();
    let n = 0;
    const read = async () => { n += 1; if (n === 2) w.concurrent(true); return snap({ status: "active" }); };
    expect(await mirrorSubscription(w.db, read, () => NOW)).toEqual({ kind: "written", accountId: ACCOUNT, planId: PLAN, status: "active" });
    expect(w.state.row?.subscription_status).toBe("active");
  });

  it("an insert that hits 23505 (another delivery inserted first) is a conflict: the next attempt reads THAT row and updates it on its version (mutation: throw on 23505 → FAILS; report the lost insert as written → the row stays 'incomplete', FAILS)", async () => {
    const w = world();
    let n = 0;
    const read = async () => { n += 1; if (n === 2) w.concurrent(false); return snap({ status: "active" }); };
    expect(await mirrorSubscription(w.db, read, () => NOW)).toEqual({ kind: "written", accountId: ACCOUNT, planId: PLAN, status: "active" });
    expect(w.log).toEqual(["row", "insert", "row", "update@2026-10-01T11:59:59.9+00:00"]);
    expect(w.state.row?.subscription_status).toBe("active");
  });

  it("a row that keeps changing is given up on after EXACTLY MIRROR_ATTEMPTS (3) row reads, by THROWING (so the event stays unstamped and Stripe retries), never by a refusal (mutation: return a refusal when the attempts run out → it would be stamped and lost, FAILS; MIRROR_ATTEMPTS = 100 → FAILS)", async () => {
    const w = world({ updatesNeverMatch: true });
    w.concurrent(false);
    await expect(mirrorSubscription(w.db, async () => snap({ status: "active" }), () => NOW)).rejects.toThrow(/kept changing/);
    expect(w.log.filter((e) => e === "row")).toHaveLength(3);
  });
});

describe("markComplimentary: the agency check comes first (G10)", () => {
  it("refuses a plan of another agency and an archived plan WITHOUT writing (mutation: drop either check → an insert is attempted, FAILS)", async () => {
    const other = recorder({ accounts: { id: ACCOUNT, agency_id: AGENCY }, plans: { id: PLAN, agency_id: "x", features: {}, archived_at: null } });
    expect(await markComplimentary(other.db, { accountId: ACCOUNT, planId: PLAN, now: NOW })).toEqual({ ok: false, reason: "plan_other_agency" });
    const archived = recorder({ accounts: { id: ACCOUNT, agency_id: AGENCY }, plans: { id: PLAN, agency_id: AGENCY, features: {}, archived_at: "2026-09-01T00:00:00Z" } });
    expect(await markComplimentary(archived.db, { accountId: ACCOUNT, planId: PLAN, now: NOW })).toEqual({ ok: false, reason: "plan_archived" });
    expect([...other.calls, ...archived.calls].filter((c) => c[1] === "insert" || c[1] === "upsert")).toEqual([]);
  });

  it("writes EXACTLY the two feature flags even when the plan read carries another key: writePermissions' filter is the only one on the complimentary paths (review minor a) (mutation: drop writePermissions' filter → the extra key is written, FAILS)", async () => {
    const { db, calls } = recorder({
      accounts: { id: ACCOUNT, agency_id: AGENCY },
      plans: { id: PLAN, agency_id: AGENCY, features: { voice_receptionist: false, web_concierge: true, extra: true }, archived_at: null },
    });
    expect(await markComplimentary(db, { accountId: ACCOUNT, planId: PLAN, now: NOW })).toEqual({ ok: true });
    expect(calls).toContainEqual(["accounts", "update", { permissions: { voice_receptionist: false, web_concierge: true } }]);
  });
});

describe("unmarkComplimentary and changeComplimentaryPlan never touch a PAID row (review item 2)", () => {
  it("unmark deletes only where complimentary is true, and with no row matched it writes NO permissions (mutation: drop .eq('complimentary', true) → FAILS; reset permissions before checking the match → FAILS)", async () => {
    const { db, calls } = recorder({});
    expect(await unmarkComplimentary(db, ACCOUNT)).toBe(false);
    expect(calls).toContainEqual(["account_billing", "delete"]);
    expect(calls).toContainEqual(["account_billing", "eq", "account_id", ACCOUNT]);
    expect(calls).toContainEqual(["account_billing", "eq", "complimentary", true]);
    expect(calls.filter((c) => c[0] === "accounts")).toEqual([]);
  });

  it("change plan updates only a complimentary row still on the plan the caller saw; with no row matched it is stale and writes NO permissions (mutation: drop the complimentary filter → FAILS; drop the expected-plan filter → FAILS; write permissions before checking the match → FAILS)", async () => {
    const OTHER_PLAN = "55555555-5555-4555-8555-555555555555";
    const { db, calls } = recorder({
      accounts: { id: ACCOUNT, agency_id: AGENCY },
      plans: { id: OTHER_PLAN, agency_id: AGENCY, features: { voice_receptionist: true, web_concierge: true }, archived_at: null },
    });
    expect(await changeComplimentaryPlan(db, { accountId: ACCOUNT, planId: OTHER_PLAN, expectedPlanId: PLAN, now: NOW }))
      .toEqual({ ok: false, reason: "stale" });
    expect(calls).toContainEqual(["account_billing", "update", { plan_id: OTHER_PLAN, updated_at: NOW.toISOString() }]);
    expect(calls).toContainEqual(["account_billing", "eq", "complimentary", true]);
    expect(calls).toContainEqual(["account_billing", "eq", "plan_id", PLAN]);
    expect(calls.filter((c) => c[0] === "accounts" && c[1] === "update")).toEqual([]);
  });
});

describe("claimWebhookEvent and saveBillingLink: the concurrency answers", () => {
  it("claim: an inserted row is 'new'; a stored row is 'retry' until processed_at is set, then 'done' (mutation: treat every stored row as done → a failed event is never retried, FAILS)", async () => {
    const claim = (inserted: boolean, processedAt: string | null) => claimWebhookEvent({
      from: () => ({
        upsert: () => ({ select: async () => ({ data: inserted ? [{ event_id: "evt_1" }] : [], error: null }) }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { processed_at: processedAt }, error: null }) }) }),
      }),
    } as unknown as SupabaseClient, "evt_1", "invoice.paid");
    expect(await claim(true, null)).toBe("new");
    expect(await claim(false, null)).toBe("retry");
    expect(await claim(false, "2026-10-01T00:00:00Z")).toBe("done");
  });

  it("save: with a previous session it UPDATES only while that session is still the stored one, and reports a lost race as false (mutation: drop the .eq on the previous session → a racing tab overwrites the other's link, FAILS)", async () => {
    const seen: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    chain.update = (row: unknown) => { seen.push(["update", row]); return chain; };
    chain.eq = (col: string, v: unknown) => { seen.push(["eq", col, v]); return chain; };
    chain.select = async () => ({ data: [], error: null });
    const ok = await saveBillingLink({ from: () => chain } as unknown as SupabaseClient, {
      accountId: ACCOUNT, planId: PLAN, stripeCustomerId: "cus_1", checkoutSessionId: "cs_new",
      checkoutUrl: "https://checkout.stripe.com/x", sentTo: "a@b.co", expiresAt: "2026-10-02T12:00:00.000Z",
    }, "cs_old", NOW);
    expect(ok).toBe(false);
    expect(seen).toContainEqual(["eq", "checkout_session_id", "cs_old"]);
  });
});

/**
 * Review correction (Task 1 review, 2026-09-25). account_billing and
 * billing_links each carry MORE than one unique key, so "23505" alone does not
 * mean "lost the race for this account's row". Only the PRIMARY KEY (the
 * account's own row) is that race. A 23505 on a customer or subscription key
 * means ANOTHER account already holds that Stripe object: retrying cannot fix
 * it, so it must throw, naming the constraint, rather than loop.
 */
describe("23505: only the primary key is a race; another unique key throws, naming it", () => {
  it("mirror insert: account_billing_pkey is a conflict (the burst test above); account_billing_stripe_subscription_id_key THROWS on the first insert, never retried, and the link is kept (mutation: treat every 23505 as a conflict → it retries MIRROR_ATTEMPTS times and throws 'kept changing' without the constraint's name, FAILS)", async () => {
    const other = world({ insertRefusedOn: "account_billing_stripe_subscription_id_key" });
    await expect(mirrorSubscription(other.db, async () => snap(), () => NOW))
      .rejects.toThrow(/account_billing_stripe_subscription_id_key/);
    expect(other.log).toEqual(["row", "insert"]);
    expect(other.state.link).not.toBeNull();
  });

  it("saveBillingLink insert: billing_links_pkey (another tab saved this account's link first) is false; billing_links_stripe_customer_id_key (ANOTHER account's link holds this customer) THROWS naming it (mutation: return false on every 23505 → the agency is told 'Something changed' forever, FAILS)", async () => {
    const insertRefusedOn = (constraint: string) => ({
      from: () => ({ insert: async () => ({ error: unique(constraint) }) }),
    } as unknown as SupabaseClient);
    const link = {
      accountId: ACCOUNT, planId: PLAN, stripeCustomerId: "cus_1", checkoutSessionId: "cs_new",
      checkoutUrl: "https://checkout.stripe.com/x", sentTo: "a@b.co", expiresAt: "2026-10-02T12:00:00.000Z",
    };
    expect(await saveBillingLink(insertRefusedOn("billing_links_pkey"), link, null, NOW)).toBe(false);
    await expect(saveBillingLink(insertRefusedOn("billing_links_stripe_customer_id_key"), link, null, NOW))
      .rejects.toThrow(/billing_links_stripe_customer_id_key/);
  });

  it("the constraint is read from PostgREST's MESSAGE (PostgrestError has code, details, hint, message and no `constraint` field), and its quoted name must equal the primary key's EXACTLY: a look-alike name that merely contains it is another key, so it throws (mutation: match with message.includes('billing_links_pkey') → the look-alike returns false, FAILS; read error.constraint → undefined, the real pkey text throws, FAILS; an unparseable message counts as the pkey → the unquoted one returns false, FAILS)", async () => {
    const refusedWith = (error: Record<string, unknown>) => ({
      from: () => ({ insert: async () => ({ error }) }),
    } as unknown as SupabaseClient);
    const link = {
      accountId: ACCOUNT, planId: PLAN, stripeCustomerId: "cus_1", checkoutSessionId: "cs_new",
      checkoutUrl: "https://checkout.stripe.com/x", sentTo: "a@b.co", expiresAt: "2026-10-02T12:00:00.000Z",
    };
    // Verbatim the body PostgREST returns (postgrest-js JSON.parses it into `error`).
    const real = {
      code: "23505", details: `Key (account_id)=(${ACCOUNT}) already exists.`, hint: null,
      message: 'duplicate key value violates unique constraint "billing_links_pkey"',
    };
    expect(await saveBillingLink(refusedWith(real), link, null, NOW)).toBe(false);
    await expect(saveBillingLink(refusedWith({
      ...real, message: 'duplicate key value violates unique constraint "billing_links_pkey_v2"',
    }), link, null, NOW)).rejects.toThrow(/billing_links_pkey_v2/);
    // Fail closed: a 23505 whose message names no QUOTED constraint is never
    // taken for the primary key (review minor b).
    await expect(saveBillingLink(refusedWith({
      ...real, message: "duplicate key value violates unique constraint billing_links_pkey",
    }), link, null, NOW)).rejects.toThrow(/refused by unique key \(unnamed\)/);
  });

  it("markComplimentary insert: account_billing_pkey is already_billed; any other unique key THROWS naming it (mutation: every 23505 is already_billed → FAILS)", async () => {
    const insertRefusedOn = (constraint: string) => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = async () => ({
          data: table === "accounts"
            ? { id: ACCOUNT, agency_id: AGENCY }
            : { id: PLAN, agency_id: AGENCY, features: { voice_receptionist: true, web_concierge: false }, archived_at: null },
          error: null,
        });
        chain.insert = async () => ({ error: unique(constraint) });
        return chain;
      },
    } as unknown as SupabaseClient);
    expect(await markComplimentary(insertRefusedOn("account_billing_pkey"), { accountId: ACCOUNT, planId: PLAN, now: NOW }))
      .toEqual({ ok: false, reason: "already_billed" });
    await expect(markComplimentary(insertRefusedOn("account_billing_stripe_customer_id_key"), { accountId: ACCOUNT, planId: PLAN, now: NOW }))
      .rejects.toThrow(/account_billing_stripe_customer_id_key/);
  });
});
