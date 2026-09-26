import { describe, it, expect } from "vitest";
import type { SubscriptionSnapshot } from "@bis/db";
import { planChangeItems } from "./change-plan";

const NEW = { base: "price_B2", voice_minutes: "price_V2", sms: "price_S2", ai_chats: "price_A2" };
const sub = (keys: (string | null)[]): SubscriptionSnapshot => ({
  id: "sub_1", customerId: "cus_1", status: "active", accountId: "a", planId: "p1",
  currentPeriodStart: 1, currentPeriodEnd: 2, startedAt: 1,
  items: keys.map((k, i) => ({ id: `si_${i}`, priceId: `price_old_${i}`, priceKey: k as never, planId: "p1" })),
});

describe("planChangeItems (G15)", () => {
  it("swaps each item's price for the SAME role's new price, in place (mutation: map by position → the meter prices cross, FAILS)", () => {
    expect(planChangeItems(sub(["sms", "base", "ai_chats", "voice_minutes"]), NEW)).toEqual([
      { id: "si_1", price: "price_B2" }, { id: "si_3", price: "price_V2" }, { id: "si_0", price: "price_S2" }, { id: "si_2", price: "price_A2" },
    ]);
  });

  it("refuses a subscription that is not exactly BIS's four roles: a missing, doubled, unknown or extra item (mutation: skip the count check → a hand-added item is left on the old plan, FAILS)", () => {
    expect(planChangeItems(sub(["base", "sms", "ai_chats"]), NEW)).toBeNull();
    expect(planChangeItems(sub(["base", "sms", "sms", "ai_chats", "voice_minutes"]), NEW)).toBeNull();
    expect(planChangeItems(sub(["base", "sms", "ai_chats", "voice_minutes", null]), NEW)).toBeNull();
  });
});
