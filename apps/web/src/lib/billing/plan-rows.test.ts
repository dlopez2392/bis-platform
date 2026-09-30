import { describe, it, expect } from "vitest";
import type { Plan } from "@bis/db";
import { m } from "@/lib/messages";
import { PLAN_STATUS_TREATMENTS, planRowView } from "./plan-rows";

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: "plan_1", agencyId: "agency_1", currency: "usd", name: "Growth", monthlyPriceCents: 104900,
  features: { voice_receptionist: true, web_concierge: true },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
  stripeProductId: "prod_1",
  stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "2026-09-24T10:00:00Z", updatedAt: "2026-09-24T10:00:00Z", ...over,
});

describe("planRowView", () => {
  it("renders an active plan's price, allowances, overage and features as plain text (mutation: show sms overage in the voice slot → FAILS)", () => {
    const v = planRowView(plan(), 3);
    expect(v).toEqual({
      id: "plan_1", status: "active",
      price: "$1,049.00/month",
      allowances: "500 minutes · 1,000 texts · 200 chats included",
      overage: "Extra: $0.12/minute · $0.03/text · $0.25/chat",
      features: "Phone receptionist · Website chat assistant",
      clients: "3 clients",
      plan: plan(),
    });
  });

  it("an archived plan reads as archived, with its own dot and word (mutation: status from name → FAILS)", () => {
    const v = planRowView(plan({ archivedAt: "2026-09-24T11:00:00Z" }), 0);
    expect(v.status).toBe("archived");
    expect(PLAN_STATUS_TREATMENTS[v.status].label).toBe(m["plans.status.archived"]);
    expect(PLAN_STATUS_TREATMENTS.active.dot).not.toBe(PLAN_STATUS_TREATMENTS.archived.dot);
  });

  it("client counts read as words: none, one, many (mutation: '1 clients' → FAILS)", () => {
    expect([0, 1, 12].map((n) => planRowView(plan(), n).clients))
      .toEqual([m["plans.clients.none"], "1 client", "12 clients"]);
  });

  it("a plan with neither premium feature says so rather than showing a blank (mutation: join an empty list → FAILS)", () => {
    const v = planRowView(plan({ features: { voice_receptionist: false, web_concierge: false } }), 0);
    expect(v.features).toBe(m["plans.features.none"]);
  });
});
