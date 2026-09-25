import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import {
  listPlans, getPlan, insertPlan, updatePlan, setPlanArchived, countBilledAccountsByPlan, type PlanWrite,
} from "../billing";

/**
 * billing.ts, live through serviceDb(). `plans` is AGENCY-scoped, so
 * withTestAccount gives these rows no isolation: every name is stamped with
 * this run's id (fixtures.ts's testBlueprintName reasoning) and every test
 * deletes the plans it made, in `finally`.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const planName = (label: string) => `${label} ${RUN}`;

function write(name: string, over: Partial<PlanWrite["terms"]> = {}): PlanWrite {
  return {
    terms: {
      name, monthlyPriceCents: 4900,
      features: { voice_receptionist: true, web_concierge: false },
      allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
      overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
      ...over,
    },
    stripeProductId: "prod_t_mod",
    stripePriceIds: { base: "price_t_b", voice_minutes: "price_t_v", sms: "price_t_s", ai_chats: "price_t_a" },
  };
}

async function withPlans(fn: (made: string[]) => Promise<void>): Promise<void> {
  const made: string[] = [];
  try { await fn(made); } finally {
    if (made.length) await serviceDb().from("plans").delete().in("id", made);
  }
}

async function mustInsert(made: string[], w: PlanWrite): Promise<string> {
  const id = randomUUID();
  const r = await insertPlan(serviceDb(), { id, ...w });
  if (!r.ok) throw new Error(`fixture insert refused: ${r.reason}`);
  made.push(id);
  return id;
}

describe("billing.ts plans, live", () => {
  it("insertPlan round-trips every field, each under its own name (mutation: map overageCents from allowances in toPlan → FAILS)", () =>
    withPlans(async (made) => {
      const w = write(planName("Roundtrip"), {
        monthlyPriceCents: 12345,
        features: { voice_receptionist: false, web_concierge: true },
        allowances: { voice_minutes: 1, sms: 2, ai_chats: 3 },
        overageCents: { voice_minutes: 4, sms: 5, ai_chats: 6 },
      });
      const id = await mustInsert(made, w);
      expect(await getPlan(serviceDb(), id)).toMatchObject({
        id, currency: "usd", archivedAt: null, ...w.terms,
        stripeProductId: w.stripeProductId, stripePriceIds: w.stripePriceIds,
      });
    }));

  it("insertPlan reports a taken name as name_taken, not a throw (mutation: drop the plans_agency_name_key branch → throws, FAILS)", () =>
    withPlans(async (made) => {
      await mustInsert(made, write(planName("Taken")));
      const r = await insertPlan(serviceDb(), { id: randomUUID(), ...write(planName("Taken")) });
      expect(r).toEqual({ ok: false, reason: "name_taken" });
    }));

  it("insertPlan reports a reused id as id_taken, the double-submit case (mutation: drop the plans_pkey branch → throws, FAILS)", () =>
    withPlans(async (made) => {
      const id = await mustInsert(made, write(planName("Once")));
      const r = await insertPlan(serviceDb(), { id, ...write(planName("Twice")) });
      expect(r).toEqual({ ok: false, reason: "id_taken" });
    }));

  it("updatePlan writes when updatedAt matches, then refuses that same stale updatedAt (mutation: drop .eq('updated_at') → second write lands, FAILS)", () =>
    withPlans(async (made) => {
      const id = await mustInsert(made, write(planName("Versioned")));
      const before = (await getPlan(serviceDb(), id))!;
      const first = await updatePlan(serviceDb(), id, before.updatedAt, write(planName("Versioned"), { monthlyPriceCents: 5900 }));
      expect(first.ok && first.plan.monthlyPriceCents).toBe(5900);
      const second = await updatePlan(serviceDb(), id, before.updatedAt, write(planName("Versioned"), { monthlyPriceCents: 6900 }));
      expect(second).toEqual({ ok: false, reason: "stale" });
      expect((await getPlan(serviceDb(), id))!.monthlyPriceCents).toBe(5900);
    }));

  it("updatePlan refuses an archived plan as stale (mutation: drop .is('archived_at', null) → FAILS)", () =>
    withPlans(async (made) => {
      const id = await mustInsert(made, write(planName("Shelved")));
      await setPlanArchived(serviceDb(), id, true);
      const current = (await getPlan(serviceDb(), id))!;
      const r = await updatePlan(serviceDb(), id, current.updatedAt, write(planName("Shelved"), { monthlyPriceCents: 9900 }));
      expect(r).toEqual({ ok: false, reason: "stale" });
    }));

  it("updatePlan reports a name another plan holds as name_taken (mutation: drop the unique-violation branch → throws, FAILS)", () =>
    withPlans(async (made) => {
      await mustInsert(made, write(planName("Holder")));
      const id = await mustInsert(made, write(planName("Mover")));
      const current = (await getPlan(serviceDb(), id))!;
      const r = await updatePlan(serviceDb(), id, current.updatedAt, write(planName("Holder")));
      expect(r).toEqual({ ok: false, reason: "name_taken" });
    }));

  it("setPlanArchived archives once then reports false; listPlans puts it after the active plans; restore clears it (mutation: drop the is-null filter → second archive returns true, FAILS)", () =>
    withPlans(async (made) => {
      const aId = await mustInsert(made, write(planName("A-archived")));
      const bId = await mustInsert(made, write(planName("B-active")));
      expect(await setPlanArchived(serviceDb(), aId, true)).toBe(true);
      expect(await setPlanArchived(serviceDb(), aId, true)).toBe(false);
      const ours = (await listPlans(serviceDb())).filter((p) => p.id === aId || p.id === bId);
      expect(ours.map((p) => [p.id, p.archivedAt === null])).toEqual([[bId, true], [aId, false]]);
      expect(await setPlanArchived(serviceDb(), aId, false)).toBe(true);
      expect((await getPlan(serviceDb(), aId))!.archivedAt).toBeNull();
    }));

  it("countBilledAccountsByPlan counts billing rows per plan (mutation: count 1 per plan instead of per row → FAILS)", () =>
    withPlans(async (made) => {
      const planId = await mustInsert(made, write(planName("Counted")));
      await withTestAccount(async (db, a) => {
        await withTestAccount(async (_db, b) => {
          for (const acct of [a, b]) {
            expect((await db.from("account_billing").insert({ account_id: acct, plan_id: planId })).error).toBeNull();
          }
          expect((await countBilledAccountsByPlan(serviceDb()))[planId]).toBe(2);
        });
      });
    }));
});
