import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isValidElement, type ReactNode } from "react";
import type { Plan } from "@bis/db";

/**
 * The page is the agency boundary for a client who types /dashboard/plans:
 * the agency nav can list Plans whenever it renders without an account, so
 * `requireAgency()` as the page's first line is the real gate, and the only
 * one: the reads go through serviceDb(), which bypasses RLS.
 * The page is CALLED, not rendered: the props each piece receives are found
 * by walking the element tree it returns.
 */
const dbMocks = vi.hoisted(() => ({
  listPlans: vi.fn(),
  countBilledAccountsByPlan: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({ tag: "service" }),
}));

/** requireAgency REDIRECTS (throws in Next) for a client; the fixture throws
 *  too, so "nothing is read first" is observable. */
const guard = vi.hoisted(() => ({ agency: true, calls: 0 }));
vi.mock("@/lib/auth", () => ({
  requireAgency: async () => {
    guard.calls += 1;
    if (!guard.agency) throw new Error("NEXT_REDIRECT");
    return { userId: "user_agency" };
  },
}));

// A "use server" module: stubbed with sentinels, so the page's wiring of
// each action to the list is checkable by identity.
const actions = vi.hoisted(() => ({
  createPlanAction: async () => ({ ok: true as const }),
  updatePlanAction: async () => ({ ok: true as const }),
  archivePlanAction: async () => ({ ok: true as const }),
  restorePlanAction: async () => ({ ok: true as const }),
}));
vi.mock("./actions", () => actions);

import { m } from "@/lib/messages";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/ui/notice";
import { NewPlanButton } from "./plan-dialog";
import { PlansList } from "./plans-list";
import type { PlanRowView } from "@/lib/billing/plan-rows";

const { default: PlansPage } = await import("./page");

const plan = (id: string, name: string): Plan => ({
  id, agencyId: "agency_1", currency: "usd", name, monthlyPriceCents: 4900,
  features: { voice_receptionist: true, web_concierge: false },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
  stripeProductId: "prod_1",
  stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "2026-09-24T10:00:00.123456+00:00", updatedAt: "2026-09-24T10:00:00.123456+00:00",
});

type Props = Record<string, unknown>;

/** Every element of `type` in the tree, depth first, looking inside
 *  children AND the element-valued props (`actions`, `action`) that carry
 *  the New plan button. */
function findAll(node: ReactNode, type: unknown, out: Props[] = []): Props[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child as ReactNode, type, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const props = node.props as Props;
  if (node.type === type) out.push(props);
  for (const key of ["children", "actions", "action"]) findAll(props[key] as ReactNode, type, out);
  return out;
}

/** Exactly one element of `type`: zero, or a second copy, is a failure. */
function one(node: ReactNode, type: unknown): Props {
  const hits = findAll(node, type);
  expect(hits).toHaveLength(1);
  return hits[0]!;
}

beforeEach(() => {
  Object.values(dbMocks).forEach((fn) => fn.mockReset());
  guard.agency = true;
  guard.calls = 0;
  dbMocks.listPlans.mockResolvedValue([]);
  dbMocks.countBilledAccountsByPlan.mockResolvedValue({});
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_page_fixture");
  vi.stubEnv("VERCEL_ENV", "");
  // Pinned, whatever the ambient environment holds: a machine whose env still
  // names production would otherwise flip every "Stripe connected" case.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://odnobiodsftffphuuosz.supabase.co");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PlansPage — the agency boundary", () => {
  it("a client is redirected BEFORE either read is issued (mutation: move requireAgency below the reads → FAILS)", async () => {
    guard.agency = false;
    await expect(PlansPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(guard.calls).toBe(1);
    expect(dbMocks.listPlans).not.toHaveBeenCalled();
    expect(dbMocks.countBilledAccountsByPlan).not.toHaveBeenCalled();
  });
});

describe("PlansPage — the reads ARE the page", () => {
  it("a failed listPlans reaches the error boundary, never the empty state (mutation: catch and render empty → FAILS)", async () => {
    dbMocks.listPlans.mockRejectedValue(new Error("plans read failed"));
    await expect(PlansPage()).rejects.toThrow("plans read failed");
  });

  it("a failed client count propagates too, rather than showing every plan with no clients (mutation: catch the count and use {} → FAILS)", async () => {
    dbMocks.listPlans.mockResolvedValue([plan("p1", "Growth")]);
    dbMocks.countBilledAccountsByPlan.mockRejectedValue(new Error("count read failed"));
    await expect(PlansPage()).rejects.toThrow("count read failed");
  });
});

describe("PlansPage — states", () => {
  it("empty: the empty state carries New plan and the header carries NO button (rule 8; mutation: always put New plan in the header → FAILS)", async () => {
    const tree = await PlansPage();
    const header = one(tree, PageHeader);
    expect(header.actions).toBeUndefined();
    const empty = one(tree, EmptyState);
    expect(empty.body).toBe(m["plans.empty.body"]);
    expect(findAll(empty.action as ReactNode, NewPlanButton)).toHaveLength(1);
    expect(findAll(tree, PlansList)).toHaveLength(0);
    // Exactly one primary in the WHOLE tree (rule 8), not just within the
    // header's own slot: a second New plan anywhere else (e.g. a list
    // branch that also rendered one) would double the view's primary.
    expect(findAll(tree, NewPlanButton)).toHaveLength(1);
  });

  it("loaded: New plan sits in the header, the list gets each plan's own client count and the real actions (mutation: planRowView(p, 0) → FAILS)", async () => {
    dbMocks.listPlans.mockResolvedValue([plan("p1", "Growth"), plan("p2", "Starter")]);
    dbMocks.countBilledAccountsByPlan.mockResolvedValue({ p1: 3 });
    const tree = await PlansPage();

    const header = one(tree, PageHeader);
    expect(findAll(header.actions as ReactNode, NewPlanButton)).toHaveLength(1);
    expect(findAll(tree, EmptyState)).toHaveLength(0);
    // Exactly one primary in the WHOLE loaded tree (rule 8; mutation: a
    // second New plan rendered in the list branch too → FAILS).
    expect(findAll(tree, NewPlanButton)).toHaveLength(1);

    const list = one(tree, PlansList);
    const rows = list.rows as PlanRowView[];
    expect(rows.map((r) => [r.id, r.clients])).toEqual([
      ["p1", m["plans.clients.many"].replace("{count}", "3")],
      ["p2", m["plans.clients.none"]],
    ]);
    expect(list.canEdit).toBe(true);
    expect(list.update).toBe(actions.updatePlanAction);
    expect(list.archive).toBe(actions.archivePlanAction);
    expect(list.restore).toBe(actions.restorePlanAction);
    const newPlan = one(header.actions as ReactNode, NewPlanButton);
    expect(newPlan.create).toBe(actions.createPlanAction);
    expect(newPlan.disabled).toBe(false);
    expect(findAll(tree, Notice)).toHaveLength(0);
  });

  it("Stripe not connected: a warn Notice names the fix, New plan is disabled, rows cannot Edit (mutation: canEdit={true} → FAILS)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    dbMocks.listPlans.mockResolvedValue([plan("p1", "Growth")]);
    const tree = await PlansPage();

    const notice = one(tree, Notice);
    expect(notice.tone).toBe("warn");
    expect(notice.children).toBe(m["plans.stripe.missing"]);
    const header = one(tree, PageHeader);
    const newPlan = one(header.actions as ReactNode, NewPlanButton);
    expect(newPlan.disabled).toBe(true);
    const list = one(tree, PlansList);
    expect(list.canEdit).toBe(false);
  });

  it("a Stripe TEST key on a copy of the app that uses production's database: the Notice says why, New plan is disabled, rows cannot Edit (mutation: the page builds its verdict from STRIPE_SECRET_KEY and VERCEL_ENV only → FAILS)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://tlbkbmlrfafquucsmsmm.supabase.co");
    dbMocks.listPlans.mockResolvedValue([plan("p1", "Growth")]);
    const tree = await PlansPage();

    const notice = one(tree, Notice);
    expect(notice.tone).toBe("warn");
    expect(notice.children).toBe(m["plans.stripe.test_key_on_production_data"]);
    const header = one(tree, PageHeader);
    expect(one(header.actions as ReactNode, NewPlanButton).disabled).toBe(true);
    expect(one(tree, PlansList).canEdit).toBe(false);
  });
});
