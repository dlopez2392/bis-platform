import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Plan, PlanWrite } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listPlans: vi.fn(),
  getPlan: vi.fn(),
  insertPlan: vi.fn(),
  updatePlan: vi.fn(),
  setPlanArchived: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({ tag: "service" }),
}));

/** requireAgency REDIRECTS (throws in Next) for a client, so the fixture
 *  throws too: that is what makes "the guard runs before anything" testable. */
const guard = vi.hoisted(() => ({ agency: true }));
vi.mock("@/lib/auth", () => ({
  requireAgency: async () => {
    if (!guard.agency) throw new Error("NEXT_REDIRECT");
    return { userId: "user_agency" };
  },
}));

/** Only the env reader is replaced: FakeGateway.createPrice runs the REAL
 *  `priceCreateParams` money guard from this same module, so the rest of
 *  it must stay the original. */
const stripeState = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/billing/stripe-gateway", async (importOriginal) => ({
  ...(await importOriginal<object>()), billingGatewayFromEnv: () => stripeState.value,
}));

import { m } from "@/lib/messages";
import { FakeGateway } from "@/lib/billing/fake-gateway";
import { archivePlanAction, createPlanAction, restorePlanAction, updatePlanAction } from "./actions";

const DRAFT = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";
const VERSION = "2026-09-24T10:00:00.000+00:00";
const TERMS = {
  name: "Growth", monthlyPriceCents: 4900,
  features: { voice_receptionist: true, web_concierge: false },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
};
const OLD_IDS = { base: "price_base_old", voice_minutes: "price_vm_old", sms: "price_sms_old", ai_chats: "price_ai_old" };

const planRow = (over: Partial<Plan> = {}): Plan => ({
  id: PLAN_ID, agencyId: "agency_1", currency: "usd", ...TERMS,
  stripeProductId: "prod_existing", stripePriceIds: OLD_IDS,
  archivedAt: null, createdAt: VERSION, updatedAt: VERSION, ...over,
});

function form(over: Record<string, string | null> = {}): FormData {
  const base: Record<string, string | null> = {
    name: "Growth", monthlyPrice: "49.00",
    "allowance.voice_minutes": "500", "overage.voice_minutes": "0.12",
    "allowance.sms": "1000", "overage.sms": "0.03",
    "allowance.ai_chats": "200", "overage.ai_chats": "0.25",
    "feature.voice_receptionist": "on", "feature.web_concierge": null,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) fd.set(k, v);
  return fd;
}

let fake: FakeGateway;

beforeEach(() => {
  Object.values(dbMocks).forEach((fn) => fn.mockReset());
  guard.agency = true;
  fake = new FakeGateway();
  fake.meters = [
    { id: "mtr_vm", eventName: "bis_voice_minutes" },
    { id: "mtr_sms", eventName: "bis_sms_segments" },
    { id: "mtr_ai", eventName: "bis_ai_chats" },
  ];
  stripeState.value = { ok: true, gateway: fake };
  dbMocks.listPlans.mockResolvedValue([]);
  dbMocks.getPlan.mockResolvedValue(planRow());
  dbMocks.insertPlan.mockImplementation(async (_db, input) => ({ ok: true, plan: { ...planRow(), id: input.id } }));
  dbMocks.updatePlan.mockImplementation(async () => ({ ok: true, plan: planRow() }));
  dbMocks.setPlanArchived.mockResolvedValue(true);
});

const nothingTouched = () => {
  expect(fake.calls).toEqual([]);
  expect(dbMocks.listPlans).not.toHaveBeenCalled();
  expect(dbMocks.insertPlan).not.toHaveBeenCalled();
};

/** A first Save that LANDED (its insert succeeded) but whose response the
 *  dialog never saw. Returns the row the database now holds, and leaves the
 *  mocks answering as they would to a retry of the same draft: the draft's
 *  own row in the list, its insert refused as `id_taken`, getPlan returning
 *  what was stored. */
async function firstSaveLandedThenRetry(): Promise<Plan> {
  expect(await createPlanAction(DRAFT, form())).toEqual({ ok: true });
  const stored = dbMocks.insertPlan.mock.calls[0]![1] as { id: string } & PlanWrite;
  const row = planRow({
    id: DRAFT, ...stored.terms, stripeProductId: stored.stripeProductId, stripePriceIds: stored.stripePriceIds,
  });
  dbMocks.listPlans.mockResolvedValue([row]);
  dbMocks.insertPlan.mockReset().mockResolvedValue({ ok: false, reason: "id_taken" });
  dbMocks.getPlan.mockResolvedValue(row);
  return row;
}

describe("createPlanAction", () => {
  it("a client is redirected before any read or Stripe call (mutation: move requireAgency below listPlans → FAILS)", async () => {
    guard.agency = false;
    await expect(createPlanAction(DRAFT, form())).rejects.toThrow("NEXT_REDIRECT");
    nothingTouched();
  });

  it("saves the plan under the draft id with the four Stripe prices Stripe returned (mutation: insert the old/empty ids → FAILS)", async () => {
    expect(await createPlanAction(DRAFT, form())).toEqual({ ok: true });
    const prices = fake.created.filter((c) => c.op === "createPrice").map((c) => c.id);
    const product = fake.created.find((c) => c.op === "createProduct")!.id;
    expect(dbMocks.insertPlan).toHaveBeenCalledWith({ tag: "service" }, {
      id: DRAFT, terms: TERMS, stripeProductId: product,
      stripePriceIds: { base: prices[0], voice_minutes: prices[1], sms: prices[2], ai_chats: prices[3] },
    });
  });

  it("a form error returns its message and touches neither Stripe nor the database (mutation: sync before parsing → FAILS)", async () => {
    expect(await createPlanAction(DRAFT, form({ monthlyPrice: "free" }))).toEqual({ ok: false, error: m["plans.error.monthlyPrice"] });
    nothingTouched();
  });

  it("Stripe not connected: says so and writes nothing (mutation: fall through with no gateway → throws, FAILS)", async () => {
    stripeState.value = { ok: false, reason: "missing" };
    expect(await createPlanAction(DRAFT, form())).toEqual({ ok: false, error: m["plans.error.stripeNotConnected"] });
    expect(dbMocks.insertPlan).not.toHaveBeenCalled();
  });

  it("a name another plan holds is refused BEFORE Stripe is called (mutation: drop the pre-check → Stripe objects are made, FAILS)", async () => {
    dbMocks.listPlans.mockResolvedValue([planRow({ id: PLAN_ID, name: "Growth" })]);
    expect(await createPlanAction(DRAFT, form())).toEqual({ ok: false, error: m["plans.error.nameTaken"] });
    expect(fake.calls).toEqual([]);
  });

  it("Stripe failing part-way returns the Stripe message and inserts nothing (mutation: insert before syncing → FAILS)", async () => {
    fake.failOn = { op: "createPrice", after: 1 };
    expect(await createPlanAction(DRAFT, form())).toEqual({ ok: false, error: m["plans.error.stripeFailed"] });
    expect(dbMocks.insertPlan).not.toHaveBeenCalled();
  });

  it("a draft id that is not a uuid is refused before anything runs (mutation: drop the UUID test → FAILS)", async () => {
    expect(await createPlanAction("not-a-uuid", form())).toEqual({ ok: false, error: m["plans.error.reload"] });
    nothingTouched();
  });

  describe("a retry whose insert reports id_taken (binding correction 4)", () => {
    it("an identical retry replays Stripe and is reported as saved (mutations: map every id_taken to a failure → FAILS; drop the draft's own row from the name pre-check exemption → FAILS)", async () => {
      await firstSaveLandedThenRetry();
      expect(await createPlanAction(DRAFT, form())).toEqual({ ok: true });
      // The replay made nothing new in Stripe: still one product and four prices from the first save.
      expect(fake.created.map((c) => c.op)).toEqual(["createProduct", "createPrice", "createPrice", "createPrice", "createPrice"]);
      expect(dbMocks.getPlan).toHaveBeenCalledWith({ tag: "service" }, DRAFT);
    });

    it("a retry RENAMED after the first save landed is not claimed as saved (mutation: treat any id_taken as success → FAILS)", async () => {
      await firstSaveLandedThenRetry();
      expect(await createPlanAction(DRAFT, form({ name: "Growth Plus" }))).toEqual({ ok: false, error: m["plans.error.alreadySaved"] });
      // The new name made a second product (an accepted orphan); the database kept the first.
      expect(fake.created.filter((c) => c.op === "createProduct")).toHaveLength(2);
    });

    it("same terms but Stripe ids that differ from what the row stores are not claimed as saved (mutation: compare the terms only, not the Stripe ids → FAILS)", async () => {
      // e.g. a retry after Stripe's ~24h key window: identical terms, fresh objects.
      const row = await firstSaveLandedThenRetry();
      dbMocks.getPlan.mockResolvedValue({ ...row, stripeProductId: "prod_from_an_earlier_day", stripePriceIds: OLD_IDS });
      expect(await createPlanAction(DRAFT, form())).toEqual({ ok: false, error: m["plans.error.alreadySaved"] });
    });
  });
});

describe("updatePlanAction", () => {
  it("a client is redirected before any read (mutation: move requireAgency below getPlan → FAILS)", async () => {
    guard.agency = false;
    await expect(updatePlanAction(PLAN_ID, VERSION, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMocks.getPlan).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
  });

  it("a stale version is refused BEFORE Stripe is called (mutation: drop the version pre-check → a new price is made, FAILS)", async () => {
    dbMocks.getPlan.mockResolvedValue(planRow({ updatedAt: "2026-09-24T11:00:00.000+00:00" }));
    expect(await updatePlanAction(PLAN_ID, VERSION, form({ monthlyPrice: "59" }))).toEqual({ ok: false, error: m["plans.error.stale"] });
    expect(fake.calls).toEqual([]);
    expect(dbMocks.updatePlan).not.toHaveBeenCalled();
  });

  it("an archived plan cannot be edited (mutation: drop the archived check → FAILS)", async () => {
    dbMocks.getPlan.mockResolvedValue(planRow({ archivedAt: VERSION }));
    expect(await updatePlanAction(PLAN_ID, VERSION, form())).toEqual({ ok: false, error: m["plans.error.archived"] });
    expect(fake.calls).toEqual([]);
  });

  it("a price change writes ONE new base price, keeps the three metered prices, and passes the version it checked (mutation: pass a fresh version → FAILS)", async () => {
    expect(await updatePlanAction(PLAN_ID, VERSION, form({ monthlyPrice: "59" }))).toEqual({ ok: true });
    const created = fake.created.filter((c) => c.op === "createPrice");
    expect(created).toHaveLength(1);
    expect(dbMocks.updatePlan).toHaveBeenCalledWith({ tag: "service" }, PLAN_ID, VERSION, {
      terms: { ...TERMS, monthlyPriceCents: 5900 }, stripeProductId: "prod_existing",
      stripePriceIds: { ...OLD_IDS, base: created[0]!.id },
    });
  });

  it("a MICROSECOND version (a never-edited plan, updated_at from now()) is passed through untouched (binding correction 1; mutation: normalise via new Date(x).toISOString() → FAILS)", async () => {
    const MICRO = "2026-09-24T10:00:00.123456+00:00";
    dbMocks.getPlan.mockResolvedValue(planRow({ updatedAt: MICRO }));
    expect(await updatePlanAction(PLAN_ID, MICRO, form({ monthlyPrice: "59" }))).toEqual({ ok: true });
    expect(dbMocks.updatePlan).toHaveBeenCalledTimes(1);
    expect(dbMocks.updatePlan.mock.calls[0]![2]).toBe(MICRO);
  });

  it("the database's own stale verdict (a race after the check) is reported (mutation: ignore updatePlan's result → FAILS)", async () => {
    dbMocks.updatePlan.mockResolvedValue({ ok: false, reason: "stale" });
    expect(await updatePlanAction(PLAN_ID, VERSION, form({ monthlyPrice: "59" }))).toEqual({ ok: false, error: m["plans.error.stale"] });
  });
});

describe("archivePlanAction / restorePlanAction", () => {
  it("archive sets archived and restore clears it (mutation: restore passes true → FAILS)", async () => {
    expect(await archivePlanAction(PLAN_ID)).toEqual({ ok: true });
    expect(await restorePlanAction(PLAN_ID)).toEqual({ ok: true });
    expect(dbMocks.setPlanArchived.mock.calls.map((c) => [c[1], c[2]])).toEqual([[PLAN_ID, true], [PLAN_ID, false]]);
  });

  it("a plan that was not there to change is reported, not claimed (mutation: ignore the boolean → FAILS)", async () => {
    dbMocks.setPlanArchived.mockResolvedValue(false);
    expect(await archivePlanAction(PLAN_ID)).toEqual({ ok: false, error: m["plans.error.notFound"] });
  });

  it("a client is redirected and nothing is written (mutation: drop requireAgency from archive → FAILS)", async () => {
    guard.agency = false;
    await expect(archivePlanAction(PLAN_ID)).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMocks.setPlanArchived).not.toHaveBeenCalled();
  });
});
